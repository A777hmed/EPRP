-- EPRP Weekly Sprint 2D — scope-item RLS for weekly_entries.
--
-- THE MISMATCH
--   Sprint 2C made the Weekly UI scope-item based: a Required Action /
--   Support row is written with `discipline_id` set to the Program & Study or
--   Discipline it belongs to. Row-level security did not follow. The four
--   policies created in 20260810000002_weekly_rls.sql pass a literal NULL as
--   the scope item:
--
--     public.weekly_can_access_scope(<project>, department_id, null)
--
--   under an inline comment reading "No discipline column: entries are
--   department-grain". That comment is FACTUALLY WRONG.
--   public.weekly_entries.discipline_id has existed since
--   20260719000007_weekly_entries.sql.
--
--   Because `weekly_can_access_scope` treats a NULL scope item as "the
--   department's shared input, reachable by anyone assigned to that
--   department", passing NULL unconditionally granted every scoped member
--   read AND write access to every other member's scope-item entries in the
--   same department. A direct PostgREST call was enough to exploit it.
--
-- THE AUDIT — the canonical relationship, reused, not reinvented
--   weekly_entries.weekly_report_id -> weekly_reports.id -> project_id
--   weekly_entries.department_id    -> departments.id
--   weekly_entries.discipline_id    -> disciplines.id   (the scope item)
--
--   That is the SAME triple weekly_submissions carries, with the same column
--   names and the same NULL semantic. Entries are siblings of submissions
--   under a report, not children of them: there is no FK from weekly_entries
--   to weekly_submissions, and an entry legitimately exists for a scope item
--   that has no submission row yet. So the entry's own department + scope item
--   IS the existing relational path, and deriving scope through a submission
--   would invent a dependency the schema does not have.
--
--   NO SCHEMA CHANGE IS REQUIRED. This migration changes policies only.
--
-- WHAT CHANGES
--   The four weekly_entries policies now pass `discipline_id` instead of
--   NULL. Nothing else. `weekly_can_access_scope` already implements the
--   required matrix and is not touched:
--
--     system admin ................ every entry, every project
--     project control / reporting . every entry in their projects
--     department manager .......... every entry in departments they manage
--     scoped member ............... entries on scope items assigned to them,
--                                   plus that department's NULL-scope shared
--                                   entries
--     no assignment ............... nothing
--
-- WHAT IS PRESERVED
--   No row is read, written, moved or deleted. Entry ids, include_in_monthly,
--   Required Action / Support rows, the General Department Update, the report
--   lifecycle and the existing Admin / Project Control / Department Manager
--   access are all untouched. Only a scoped member's reach narrows, which is
--   the defect being fixed.
--
--   Reversible: re-run the four policy definitions from
--   20260810000002_weekly_rls.sql to restore department-grain behaviour.
--
-- NOTE ON discipline_id's FK
--   `on delete set null` means deleting a Discipline master record would widen
--   its entries back to department-shared. Master data is archived rather than
--   deleted (the safe-archive rule), so this is recorded, not relied upon.
--
-- VERIFICATION
--   The access matrix was proved against these policies at database level, as
--   the `authenticated` role with auth.uid() supplied through
--   request.jwt.claims — the same path a PostgREST request takes. That test
--   creates its own fixtures and is deliberately NOT part of this migration:
--   it ends in a rollback so it leaves no rows behind and does not re-run on
--   every fresh database. It is kept with the sprint record.

/* ---------------------------- Pre-conditions ------------------------------ */

do $$
declare
  has_column integer;
  admins     integer;
begin
  select count(*) into has_column
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'weekly_entries'
     and column_name  = 'discipline_id';

  if has_column = 0 then
    raise exception
      'Aborting: public.weekly_entries has no discipline_id column, so entry scope cannot be enforced without a schema change.';
  end if;

  -- Same lockout guard as the original Weekly RLS migration: every predicate
  -- short-circuits on is_system_admin(), so an administrator must exist.
  select count(*) into admins
    from public.profiles where role = 'system_admin' and active;
  if admins = 0 then
    raise exception
      'Refusing to tighten Weekly entry RLS: no active system_admin profile exists.';
  end if;

  raise notice 'Pre-check passed: discipline_id present, % active system_admin profile(s).', admins;
end;
$$;

/* -------------------------------- Policies -------------------------------- */

drop policy if exists weekly_entries_select on public.weekly_entries;
drop policy if exists weekly_entries_insert on public.weekly_entries;
drop policy if exists weekly_entries_update on public.weekly_entries;
drop policy if exists weekly_entries_delete on public.weekly_entries;

-- A report-level entry (no department) stays a project-grain record: it
-- belongs to the report as a whole, not to any one department's scope.
create policy weekly_entries_select on public.weekly_entries
  for select to authenticated
  using (
    case when department_id is null
      then public.weekly_can_access_project(public.weekly_report_project(weekly_report_id))
      else public.weekly_can_access_scope(
             public.weekly_report_project(weekly_report_id),
             department_id,
             discipline_id)
    end
  );

create policy weekly_entries_insert on public.weekly_entries
  for insert to authenticated
  with check (
    case when department_id is null
      then public.weekly_can_access_project(public.weekly_report_project(weekly_report_id))
      else public.weekly_can_access_scope(
             public.weekly_report_project(weekly_report_id),
             department_id,
             discipline_id)
    end
  );

-- USING governs the row as it stands, WITH CHECK the row as it would become,
-- so an entry cannot be moved onto a scope item the caller may not reach.
create policy weekly_entries_update on public.weekly_entries
  for update to authenticated
  using (
    case when department_id is null
      then public.weekly_can_access_project(public.weekly_report_project(weekly_report_id))
      else public.weekly_can_access_scope(
             public.weekly_report_project(weekly_report_id),
             department_id,
             discipline_id)
    end
  )
  with check (
    case when department_id is null
      then public.weekly_can_access_project(public.weekly_report_project(weekly_report_id))
      else public.weekly_can_access_scope(
             public.weekly_report_project(weekly_report_id),
             department_id,
             discipline_id)
    end
  );

create policy weekly_entries_delete on public.weekly_entries
  for delete to authenticated
  using (
    case when department_id is null
      then public.weekly_can_access_project(public.weekly_report_project(weekly_report_id))
      else public.weekly_can_access_scope(
             public.weekly_report_project(weekly_report_id),
             department_id,
             discipline_id)
    end
  );

comment on column public.weekly_entries.discipline_id is
  'The scope item this entry belongs to — a Program & Study on PSM/PSAIM projects, a Discipline elsewhere. NULL means a department-level shared entry, reachable by anyone assigned to that department. Enforced by the weekly_entries policies, which pass this column to weekly_can_access_scope().';

/* --------------------------- Structural check ----------------------------- */

do $$
declare
  scoped  integer;
  blanket integer;
begin
  -- Every policy must now mention the column. A policy that still passes NULL
  -- would not, so this catches a partial application.
  select count(*) into scoped
    from pg_policies
   where schemaname = 'public'
     and tablename  = 'weekly_entries'
     and coalesce(qual, '') || coalesce(with_check, '') like '%discipline_id%';

  select count(*) into blanket
    from pg_policies
   where schemaname = 'public'
     and tablename  = 'weekly_entries'
     and (qual = 'true' or with_check = 'true');

  if scoped <> 4 then
    raise exception
      'Post-check failed: % of 4 weekly_entries policies reference discipline_id.', scoped;
  end if;
  if blanket > 0 then
    raise exception 'Post-check failed: % blanket policy/policies on weekly_entries.', blanket;
  end if;

  raise notice 'weekly_entries policies are scope-item aware (4/4, 0 blanket).';
end;
$$;

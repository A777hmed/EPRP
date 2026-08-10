-- EPRP Weekly Sprint 1B — enforce the Weekly scope model at database level.
--
-- BEFORE THIS MIGRATION
--   Every Weekly table carried `for all to authenticated using (true) with
--   check (true)`. Any authenticated user could read and write every project's
--   Weekly data. The TypeScript scope resolver decided correctly but could be
--   bypassed with a direct PostgREST call.
--
-- WHAT THIS DOES
--   Replaces those blanket policies with the SAME rules the resolver applies,
--   expressed once as SQL predicates. The rules are not re-invented here:
--   they read `projects`, `project_departments` and `project_contacts`, which
--   is exactly what `resolveWeeklyScope()` reads.
--
--     system admin ................ everything, every project
--     project control / reporting . every department of their projects
--     department manager .......... every scope item in departments they manage
--     scoped member ............... only their own scope items, plus that
--                                   department's shared (NULL scope item) rows
--     anyone else ................. nothing
--
-- LOCKOUT PREVENTION — the part that matters most
--   The only account today is a system_admin whose `profiles.contact_id` is
--   NULL, because no contact matched its email (see the Sprint 1B identity
--   audit). Every predicate therefore short-circuits on `is_system_admin()`
--   BEFORE any contact lookup, so an unlinked admin keeps full access. The
--   migration also refuses to run at all if no active system_admin profile
--   exists, so it cannot be the thing that locks everyone out.
--
--   Emergency recovery if it ever does: policies are additive to the table,
--   so `alter table public.weekly_reports disable row level security;` as the
--   service role restores access immediately.
--
-- SECURITY DEFINER
--   The helpers run as owner so they can read `profiles` (whose own policy
--   restricts a user to their own row) without recursion, and pin
--   `search_path` so a caller cannot shadow the tables they consult.
--   They are STABLE, so the planner evaluates them once per statement.

/* --------------------------- Lockout pre-check ---------------------------- */

do $$
declare admins integer;
begin
  select count(*) into admins
    from public.profiles
   where role = 'system_admin' and active;

  if admins = 0 then
    raise exception
      'Refusing to enable Weekly RLS: no active system_admin profile exists, so this would lock every account out.';
  end if;

  raise notice 'Lockout pre-check passed: % active system_admin profile(s).', admins;
end;
$$;

/* ------------------------------- Identity --------------------------------- */

create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and role = 'system_admin' and active
  );
$$;

comment on function public.is_system_admin() is
  'True when the caller is an active system administrator. Checked first in every Weekly predicate so an administrator whose profile is not linked to a contact still has full access.';

create or replace function public.current_contact_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select contact_id from public.profiles
   where id = auth.uid() and active;
$$;

comment on function public.current_contact_id() is
  'The contacts row this account is linked to, or NULL when the account has not been mapped. A NULL result grants no scope — mapping is a deliberate administrative act.';

/* ---------------------------- Scope predicates ---------------------------- */

create or replace function public.weekly_can_access_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_system_admin()
    or (
      public.current_contact_id() is not null
      and (
        -- Project-wide consolidation roles, read from the project itself.
        exists (
          select 1 from public.projects pr
           where pr.id = p_project
             and (pr.project_control_manager_id = public.current_contact_id()
               or pr.reporting_coordinator_id  = public.current_contact_id())
        )
        -- Or any scoped assignment on this project at all. Which departments
        -- and items they actually reach is decided at the row grain below;
        -- this only decides whether the project is theirs to see.
        or exists (
          select 1 from public.project_contacts pc
           where pc.project_id = p_project
             and pc.contact_id = public.current_contact_id()
        )
      )
    );
$$;

comment on function public.weekly_can_access_project(uuid) is
  'Whether the caller may see a project''s Weekly at all. Project grain only — department and scope-item filtering is weekly_can_access_scope().';

create or replace function public.weekly_can_access_scope(
  p_project    uuid,
  p_department uuid,
  p_discipline uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_system_admin()
    or (
      public.current_contact_id() is not null
      and (
        -- Project control / reporting coordinator: every department.
        exists (
          select 1 from public.projects pr
           where pr.id = p_project
             and (pr.project_control_manager_id = public.current_contact_id()
               or pr.reporting_coordinator_id  = public.current_contact_id())
        )
        or (
          p_department is not null
          -- Business rule 1: the department must belong to the project.
          and exists (
            select 1 from public.project_departments pd
             where pd.project_id = p_project
               and pd.department_id = p_department
          )
          and (
            -- Department Manager: the whole department, whatever the item,
            -- and however few items they personally hold.
            exists (
              select 1 from public.project_contacts pc
               where pc.project_id     = p_project
                 and pc.contact_id     = public.current_contact_id()
                 and pc.department_id  = p_department
                 and pc.assignment_role = 'department_manager'
            )
            -- Scoped member: their own items. A row with no scope item is the
            -- department's shared input, so any assignment there reaches it —
            -- mirroring filterWeeklyRows() in scope.ts exactly.
            or exists (
              select 1 from public.project_contacts pc
               where pc.project_id    = p_project
                 and pc.contact_id    = public.current_contact_id()
                 and pc.department_id = p_department
                 and (p_discipline is null or pc.discipline_id = p_discipline)
            )
          )
        )
      )
    );
$$;

comment on function public.weekly_can_access_scope(uuid, uuid, uuid) is
  'Row-grain Weekly access: project + department + optional scope item. Mirrors resolveWeeklyScope()/filterWeeklyRows() in src/features/weekly-reports/scope.ts. A NULL scope item means department-level shared input.';

/* Resolve a Weekly row back to its project without repeating the join. */
create or replace function public.weekly_report_project(p_report uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select project_id from public.weekly_reports where id = p_report;
$$;

/* ------------------------------- Policies --------------------------------- */

-- weekly_reports ------------------------------------------------------------
drop policy if exists weekly_reports_authenticated_all on public.weekly_reports;
drop policy if exists weekly_reports_select on public.weekly_reports;
drop policy if exists weekly_reports_insert on public.weekly_reports;
drop policy if exists weekly_reports_update on public.weekly_reports;
drop policy if exists weekly_reports_delete on public.weekly_reports;

create policy weekly_reports_select on public.weekly_reports
  for select to authenticated
  using (public.weekly_can_access_project(project_id));

-- Creating and deleting a project's Weekly is a consolidation act, so it is
-- limited to the roles that own the project report rather than to anyone with
-- an assignment inside it.
create policy weekly_reports_insert on public.weekly_reports
  for insert to authenticated
  with check (
    public.is_system_admin()
    or exists (
      select 1 from public.projects pr
       where pr.id = project_id
         and public.current_contact_id() is not null
         and (pr.project_control_manager_id = public.current_contact_id()
           or pr.reporting_coordinator_id  = public.current_contact_id())
    )
  );

create policy weekly_reports_update on public.weekly_reports
  for update to authenticated
  using (public.weekly_can_access_project(project_id))
  with check (public.weekly_can_access_project(project_id));

create policy weekly_reports_delete on public.weekly_reports
  for delete to authenticated
  using (
    public.is_system_admin()
    or exists (
      select 1 from public.projects pr
       where pr.id = project_id
         and public.current_contact_id() is not null
         and (pr.project_control_manager_id = public.current_contact_id()
           or pr.reporting_coordinator_id  = public.current_contact_id())
    )
  );

-- weekly_submissions --------------------------------------------------------
drop policy if exists weekly_submissions_authenticated_all on public.weekly_submissions;
drop policy if exists weekly_submissions_select on public.weekly_submissions;
drop policy if exists weekly_submissions_insert on public.weekly_submissions;
drop policy if exists weekly_submissions_update on public.weekly_submissions;
drop policy if exists weekly_submissions_delete on public.weekly_submissions;

create policy weekly_submissions_select on public.weekly_submissions
  for select to authenticated
  using (public.weekly_can_access_scope(
    public.weekly_report_project(weekly_report_id), department_id, discipline_id));

create policy weekly_submissions_insert on public.weekly_submissions
  for insert to authenticated
  with check (public.weekly_can_access_scope(
    public.weekly_report_project(weekly_report_id), department_id, discipline_id));

create policy weekly_submissions_update on public.weekly_submissions
  for update to authenticated
  using (public.weekly_can_access_scope(
    public.weekly_report_project(weekly_report_id), department_id, discipline_id))
  with check (public.weekly_can_access_scope(
    public.weekly_report_project(weekly_report_id), department_id, discipline_id));

create policy weekly_submissions_delete on public.weekly_submissions
  for delete to authenticated
  using (public.weekly_can_access_scope(
    public.weekly_report_project(weekly_report_id), department_id, discipline_id));

-- weekly_activities ---------------------------------------------------------
drop policy if exists weekly_activities_authenticated_all on public.weekly_activities;
drop policy if exists weekly_activities_select on public.weekly_activities;
drop policy if exists weekly_activities_insert on public.weekly_activities;
drop policy if exists weekly_activities_update on public.weekly_activities;
drop policy if exists weekly_activities_delete on public.weekly_activities;

create policy weekly_activities_select on public.weekly_activities
  for select to authenticated
  using (public.weekly_can_access_scope(
    public.weekly_report_project(weekly_report_id), department_id, discipline_id));

create policy weekly_activities_insert on public.weekly_activities
  for insert to authenticated
  with check (public.weekly_can_access_scope(
    public.weekly_report_project(weekly_report_id), department_id, discipline_id));

create policy weekly_activities_update on public.weekly_activities
  for update to authenticated
  using (public.weekly_can_access_scope(
    public.weekly_report_project(weekly_report_id), department_id, discipline_id))
  with check (public.weekly_can_access_scope(
    public.weekly_report_project(weekly_report_id), department_id, discipline_id));

create policy weekly_activities_delete on public.weekly_activities
  for delete to authenticated
  using (public.weekly_can_access_scope(
    public.weekly_report_project(weekly_report_id), department_id, discipline_id));

-- weekly_entries ------------------------------------------------------------
-- No discipline column: entries are department-grain, so the scope item is
-- passed as NULL and department access governs them.
drop policy if exists weekly_entries_authenticated_all on public.weekly_entries;
drop policy if exists weekly_entries_select on public.weekly_entries;
drop policy if exists weekly_entries_insert on public.weekly_entries;
drop policy if exists weekly_entries_update on public.weekly_entries;
drop policy if exists weekly_entries_delete on public.weekly_entries;

create policy weekly_entries_select on public.weekly_entries
  for select to authenticated
  using (
    case when department_id is null
      then public.weekly_can_access_project(public.weekly_report_project(weekly_report_id))
      else public.weekly_can_access_scope(
             public.weekly_report_project(weekly_report_id), department_id, null)
    end
  );

create policy weekly_entries_insert on public.weekly_entries
  for insert to authenticated
  with check (
    case when department_id is null
      then public.weekly_can_access_project(public.weekly_report_project(weekly_report_id))
      else public.weekly_can_access_scope(
             public.weekly_report_project(weekly_report_id), department_id, null)
    end
  );

create policy weekly_entries_update on public.weekly_entries
  for update to authenticated
  using (
    case when department_id is null
      then public.weekly_can_access_project(public.weekly_report_project(weekly_report_id))
      else public.weekly_can_access_scope(
             public.weekly_report_project(weekly_report_id), department_id, null)
    end
  )
  with check (
    case when department_id is null
      then public.weekly_can_access_project(public.weekly_report_project(weekly_report_id))
      else public.weekly_can_access_scope(
             public.weekly_report_project(weekly_report_id), department_id, null)
    end
  );

create policy weekly_entries_delete on public.weekly_entries
  for delete to authenticated
  using (
    case when department_id is null
      then public.weekly_can_access_project(public.weekly_report_project(weekly_report_id))
      else public.weekly_can_access_scope(
             public.weekly_report_project(weekly_report_id), department_id, null)
    end
  );

/* -------------------------- Post-condition check -------------------------- */

do $$
declare open_weekly integer; total integer;
begin
  select count(*) into open_weekly
    from pg_policies
   where schemaname = 'public'
     and tablename in ('weekly_reports','weekly_submissions','weekly_activities','weekly_entries')
     and (qual = 'true' or with_check = 'true');

  select count(*) into total
    from pg_policies
   where schemaname = 'public'
     and tablename in ('weekly_reports','weekly_submissions','weekly_activities','weekly_entries');

  if open_weekly > 0 then
    raise exception 'Post-check failed: % blanket policy/policies survive on Weekly tables.', open_weekly;
  end if;

  raise notice 'Weekly RLS in place: % scoped policies, 0 blanket policies.', total;
end;
$$;

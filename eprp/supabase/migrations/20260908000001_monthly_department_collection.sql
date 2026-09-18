-- =============================================================================
-- Monthly department collection: submission state, a semantic third source for
-- department-authored comments, and the lifecycle gate that waits for them.
--
-- WHY A MIGRATION IS REQUIRED AT ALL
--
--   The Monthly tier can already be COMPILED and REVIEWED, but it has nowhere
--   to record that a department was asked for input, that the department
--   answered, or that its manager accepted the answer. Three things are missing
--   and none of them can be expressed with the tables that exist:
--
--     1. NO SUBMISSION STATE. `monthly_department_summaries` holds narrative
--        text per (report, department, system, scope item). It is content, not
--        state: it cannot say "sent", "waiting", "submitted", "returned" or
--        "approved", it has no deadline, and it has no submitted/reviewed
--        attribution. Weekly solved this with `weekly_submissions`; Monthly has
--        no equivalent.
--
--     2. NO SEMANTIC SOURCE for a department-authored Monthly comment.
--        `monthly_comments.source_kind` is constrained to
--        ('weekly', 'monthly_manual'). A comment a department adds during the
--        Monthly round is neither: it is not compiled from a Weekly, and
--        recording it as `monthly_manual` would make it indistinguishable from
--        Project Control's own additions — so "who said this, and in which
--        round?" would be unanswerable from the data.
--
--     3. NO STAGE CONDITION on the Monthly lifecycle.
--        `set_monthly_report_status()` checks authority and transition SHAPE
--        and stops there — unlike `set_weekly_report_status()`, which consults
--        `weekly_transition_blockers()`. There is therefore no way to hold a
--        Monthly in the department round until the departments have answered.
--
-- THREE CONTAINMENT CORRECTIONS TO EXISTING MONTHLY OBJECTS
--
--   Found by review before this file was ever applied. All three are in
--   `20260812000001` and none of them is introduced by the department round —
--   but the round is what makes each of them reachable, so they are closed
--   here rather than shipped alongside.
--
--     A. PROJECT CONTROL ADMIN was read-everything / write-nothing on Monthly,
--        because `monthly_can_manage_project()` read `is_system_admin()` where
--        the rest of the platform reads `has_global_operational_authority()`.
--        Redefined to use the existing canonical helper. Strictly additive.
--
--     B. WEEKLY-DERIVED COMMENTS were editable — and deletable — by the
--        department user who authored the original Weekly entry, because
--        compilation preserves them as `created_by_contact_id` and the
--        department branch tested only authorship. Every department-reachable
--        branch of monthly_comments now also tests `source_kind`.
--
--     C. SUBMISSION READS were project-wide, so any department could read every
--        other department's follow-up state. Narrowed to the row's own
--        department.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
--   * NO NEW LIFECYCLE STATUS. Monthly already collects from departments in
--     `department_review` — draft -> auto_compiled -> department_review ->
--     under_review -> ... — seeded into `report_transition_allowed` by
--     20260820000005 and already exercised in production. Adding a `collecting`
--     status beside it would duplicate a stage that exists, require re-seeding a
--     deployed lifecycle table, and invalidate a Monthly flow that has just been
--     verified. The UI names this stage for the reader; the data model does not
--     grow a synonym.
--
--   * NO CHANGE TO WEEKLY. No weekly table, policy, function or trigger is
--     touched. `is_weekly_department_manager()` and `weekly_can_access_scope()`
--     are READ here because they answer project-scoped questions that are not
--     specific to a report tier — the manager of a department is the manager of
--     that department whichever report is asking.
--
--   * NO CHANGE TO WEEKLY IMPORT. `monthly_comments.source_weekly_entry_id`
--     keeps its UNIQUE constraint and the compile path keeps its
--     ignore-duplicates upsert, so "Update from Weekly Reports" remains
--     idempotent. This migration only widens which OTHER source kinds may
--     exist beside the imported ones.
--
--   * ONE GRAIN, NOT TWO. `monthly_submissions` is keyed on
--     (report, department) alone. Weekly carries a second, scope-item grain in
--     the same table, and reading the two as one is exactly what broke the
--     Weekly lifecycle count (see 20260906000003). The Monthly round is a
--     department answering for its department, so one row per department is the
--     whole model.
-- =============================================================================

/* ------------------- Monthly operational authority (P1) ------------------- */

/*
 * Project Control Admin is a PLATFORM-WIDE operational authority, and Monthly
 * did not treat it as one.
 *
 * `monthly_can_manage_project()` resolved to
 *   is_system_admin() OR weekly_can_manage_project(p)
 *   = is_system_admin() OR is_project_consolidator(p)
 *
 * so a Project Control Admin could READ every Monthly — `can_access_project()`
 * admits them through `has_global_operational_authority()` — while every
 * Monthly WRITE refused them unless they were separately assigned as a
 * consolidator on that specific project. Read-everything / write-nothing is not
 * the approved role model, and it is an inherited asymmetry rather than a
 * decision anyone took for Monthly.
 *
 * The fix reuses the EXISTING authoritative helper rather than naming roles
 * again: `has_global_operational_authority()` (20260824000001) is already the
 * canonical "System Admin or Project Control Admin" predicate, and is already
 * what `can_access_project()` reads. No parallel role model is introduced.
 *
 * STRICTLY ADDITIVE. The new definition is a superset of the old:
 *   was  is_system_admin()                    OR is_project_consolidator(p)
 *   now  has_global_operational_authority()   OR is_project_consolidator(p)
 * and has_global_operational_authority() = is_system_admin() OR
 * is_project_control_admin(). Nobody who could manage a Monthly loses anything,
 * and no department-scoped branch is touched — this predicate appears only in
 * the MANAGE branches of the Monthly policies.
 */
create or replace function public.monthly_can_manage_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.has_global_operational_authority()
      or public.is_project_consolidator(p_project);
$fn$;

comment on function public.monthly_can_manage_project(uuid) is
  'Whether the caller may perform Monthly OPERATIONAL actions on this project: platform-wide operational authority (System Admin or Project Control Admin, per has_global_operational_authority()) or an assigned project consolidator (Project Control Manager / Reporting Coordinator, per is_project_consolidator()). Grants nothing department-scoped; the department branches of the Monthly policies are separate and unchanged.';

/* --------------------------- Department submissions ----------------------- */

create table if not exists public.monthly_submissions (
  id                      uuid primary key default gen_random_uuid(),
  monthly_report_id       uuid not null references public.monthly_reports(id) on delete cascade,
  department_id           uuid not null references public.departments(id) on delete restrict,
  status                  text not null default 'pending',
  /*
   * Silence is not an answer. A department that genuinely has nothing to add
   * says so explicitly, so Project Control can tell "reviewed, nothing to add"
   * apart from "never opened it".
   */
  no_additional_comments  boolean not null default false,
  sent_at                 timestamptz,
  due_at                  timestamptz,
  submitted_by_contact_id uuid references public.contacts(id) on delete set null,
  submitted_at            timestamptz,
  reviewed_by_contact_id  uuid references public.contacts(id) on delete set null,
  reviewed_at             timestamptz,
  return_reason           text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint monthly_submissions_status check (
    status in ('pending', 'in_progress', 'submitted', 'returned', 'approved')
  ),
  constraint monthly_submissions_report_department_unique
    unique (monthly_report_id, department_id)
);

comment on table public.monthly_submissions is
  'One department''s participation in one Monthly report: distribution timing, department input status, and the Department Manager''s verdict. One row per (report, department) — the Monthly round is department-grained, unlike weekly_submissions which also carries a scope-item grain.';

comment on column public.monthly_submissions.no_additional_comments is
  'The department reviewed the month and had nothing to add. Distinguishes a deliberate nil return from no response at all.';

create index if not exists idx_monthly_submissions_report
  on public.monthly_submissions(monthly_report_id, department_id);

-- Dropped first for the same reason the stamping trigger below is: every other
-- statement in this file is guarded, and an unguarded CREATE TRIGGER is the one
-- thing that would make a re-run fail against a database where the table
-- already exists. Postgres has no CREATE TRIGGER IF NOT EXISTS.
drop trigger if exists set_updated_at on public.monthly_submissions;
create trigger set_updated_at
  before update on public.monthly_submissions
  for each row execute function public.set_updated_at();

/* ----------------------------- Activity stamping -------------------------- */

/*
 * Stamp WHO and WHEN at the moment a row changes hands, rather than trusting a
 * client to send it. Mirrors the reasoning of 20260906000002 for Weekly, and
 * additionally records the reviewer — the Weekly table has no reviewer columns,
 * so a Weekly verdict records no attribution at all. A new table should not
 * repeat that gap.
 */
create or replace function public.stamp_monthly_submission_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_was text := case when tg_op = 'UPDATE' then old.status else null end;
begin
  if new.status = 'submitted' and v_was is distinct from 'submitted' then
    new.submitted_at := coalesce(new.submitted_at, now());
    new.submitted_by_contact_id :=
      coalesce(new.submitted_by_contact_id, public.current_contact_id());
  end if;

  -- Back to working state: the previous submission no longer stands.
  if new.status in ('pending', 'in_progress')
     and v_was is distinct from new.status then
    new.submitted_at := null;
    new.submitted_by_contact_id := null;
  end if;

  if new.status in ('approved', 'returned')
     and v_was is distinct from new.status then
    new.reviewed_at := now();
    new.reviewed_by_contact_id := public.current_contact_id();
  end if;

  -- A verdict that is no longer a verdict keeps no reviewer.
  if new.status in ('pending', 'in_progress', 'submitted')
     and v_was in ('approved', 'returned') then
    new.reviewed_at := null;
    new.reviewed_by_contact_id := null;
    new.return_reason := null;
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_stamp_monthly_submission_activity
  on public.monthly_submissions;
create trigger trg_stamp_monthly_submission_activity
  before insert or update on public.monthly_submissions
  for each row execute function public.stamp_monthly_submission_activity();

/* ------------------------ Is the round open for input? -------------------- */

/*
 * The Monthly mirror of weekly_report_accepts_department_input(). The status
 * list is the Monthly workflow's own `editableIn` set from
 * src/config/workflows.ts, not the Weekly one: Monthly's editable stages are
 * draft, auto_compiled, department_review and returned.
 */
create or replace function public.monthly_report_accepts_department_input(
  p_report uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from public.monthly_reports mr
     where mr.id = p_report
       and mr.status in ('draft', 'auto_compiled', 'department_review', 'returned')
  );
$fn$;

comment on function public.monthly_report_accepts_department_input(uuid) is
  'True while a Monthly Report is still open for department input (draft, auto_compiled, department_review, returned). Mirrors monthlyWorkflow.editableIn in src/config/workflows.ts. Used only by the department branches of the monthly write policies; Project Control authority does not depend on it.';

revoke execute on function public.monthly_report_accepts_department_input(uuid)
  from public, anon;
grant execute on function public.monthly_report_accepts_department_input(uuid)
  to authenticated, service_role;

/* --------------------------------- Policies ------------------------------- */

alter table public.monthly_submissions enable row level security;

/*
 * Reading is department-scoped, not project-wide.
 *
 * The follow-up picture — who is late, who has answered — belongs to whoever
 * runs the round. A department is answering for itself and has no business
 * reading another department's submission state, so the read is narrowed to the
 * row's OWN department rather than to the project.
 *
 *   Operational authority ... every row on projects they control.
 *   Department            ... only departments they are actually assigned to,
 *                             via the same `weekly_can_access_scope()` the
 *                             write branches use. Passing NULL as the scope
 *                             item means "the department-level grain", which is
 *                             the only grain this table has.
 *
 * Cross-project is impossible in both branches: each resolves the project from
 * the row's own report, and every underlying predicate is project-scoped.
 */
drop policy if exists monthly_submissions_select on public.monthly_submissions;
create policy monthly_submissions_select on public.monthly_submissions
  for select to authenticated
  using (
    public.monthly_can_manage_project(
      public.monthly_report_project(monthly_report_id))
    or public.weekly_can_access_scope(
         public.monthly_report_project(monthly_report_id),
         department_id,
         null)
  );

-- Rows are created by starting collection, which is Project Control's act.
-- A department cannot enrol itself.
drop policy if exists monthly_submissions_insert on public.monthly_submissions;
create policy monthly_submissions_insert on public.monthly_submissions
  for insert to authenticated
  with check (
    public.monthly_can_manage_project(
      public.monthly_report_project(monthly_report_id))
  );

/*
 * Three branches, and the same predicate in USING and WITH CHECK so a caller can
 * neither reach a row they may not touch nor move a row into a state they may
 * not set:
 *
 *   Project Control / admin ... anything, at any time.
 *   Department contributor .... the input statuses only, while the round is
 *                               open. `weekly_can_access_scope(project, dept,
 *                               null)` is the existing project-scoped test for
 *                               "assigned to this department" and is what
 *                               monthly_comments already uses.
 *   Department Manager ........ additionally the verdict pair, for the
 *                               department they actually manage. Authority
 *                               comes from the project assignment
 *                               (project_contacts.assignment_role), never from
 *                               a platform role.
 */
drop policy if exists monthly_submissions_update on public.monthly_submissions;
create policy monthly_submissions_update on public.monthly_submissions
  for update to authenticated
  using (
    public.monthly_can_manage_project(
      public.monthly_report_project(monthly_report_id))
    or (
      public.monthly_report_accepts_department_input(monthly_report_id)
      and (
        (
          status in ('pending', 'in_progress', 'submitted')
          and public.weekly_can_access_scope(
                public.monthly_report_project(monthly_report_id),
                department_id,
                null)
        )
        or (
          status in ('pending', 'in_progress', 'submitted', 'returned', 'approved')
          and public.is_weekly_department_manager(
                public.monthly_report_project(monthly_report_id),
                department_id)
        )
      )
    )
  )
  with check (
    public.monthly_can_manage_project(
      public.monthly_report_project(monthly_report_id))
    or (
      public.monthly_report_accepts_department_input(monthly_report_id)
      and (
        (
          status in ('pending', 'in_progress', 'submitted')
          and public.weekly_can_access_scope(
                public.monthly_report_project(monthly_report_id),
                department_id,
                null)
        )
        or (
          status in ('pending', 'in_progress', 'submitted', 'returned', 'approved')
          and public.is_weekly_department_manager(
                public.monthly_report_project(monthly_report_id),
                department_id)
        )
      )
    )
  );

drop policy if exists monthly_submissions_delete on public.monthly_submissions;
create policy monthly_submissions_delete on public.monthly_submissions
  for delete to authenticated
  using (
    public.monthly_can_manage_project(
      public.monthly_report_project(monthly_report_id))
  );

/* ------------------- A semantic source for department input --------------- */

/*
 * 'monthly_department' — a comment authored by a department during the Monthly
 * round. Additive: 'weekly' and 'monthly_manual' keep their exact meaning, and
 * every existing row already satisfies the widened constraint, so nothing is
 * rewritten and no backfill is required.
 *
 * The constraint is replaced rather than dropped: leaving the column
 * unconstrained would let any string become a "source".
 */
alter table public.monthly_comments
  drop constraint if exists monthly_comments_source_kind;

alter table public.monthly_comments
  add constraint monthly_comments_source_kind
  check (source_kind in ('weekly', 'monthly_manual', 'monthly_department'));

comment on column public.monthly_comments.source_kind is
  'Where this Monthly comment came from: weekly (compiled from an approved Weekly entry, keyed by source_weekly_entry_id), monthly_manual (added by Project Control directly on the Monthly), or monthly_department (added by a department during the Monthly department round). Display wording lives in the application; this column is the stored meaning.';

/* ------------- Weekly-derived comments are read-only to departments ------- */

/*
 * A compiled Weekly item is the MONTH'S RECORD OF AN APPROVED WEEKLY, and a
 * department must not be able to rewrite it.
 *
 * The hole: `compileFromWeeklies` deliberately preserves the Weekly entry's
 * author as `created_by_contact_id`, so the imported row is "owned" by the
 * department user who wrote the original Weekly entry — and the department
 * branch of `monthly_comments_update` was `created_by_contact_id =
 * current_contact_id()` with no source test. The UI renders these read-only and
 * the service only ever writes `presentation_text` for them, but neither is a
 * boundary: a direct PostgREST call could rewrite `original_text` on a row
 * compiled from a LOCKED Weekly. The Weekly itself was never reachable —
 * `weekly_entries` is a different table with its own policies — but the
 * Monthly's copy of it was.
 *
 * USING gates the row as it STANDS, WITH CHECK the row as it WOULD BE. Both
 * carry the source test, so a department can neither reach a `weekly` row nor
 * turn one of its own rows into one by claiming the provenance.
 *
 * Project Control keeps curating: the manage branch is unchanged and untested
 * for source, which is what lets `presentation_text` be edited on a compiled
 * item exactly as the existing design intends.
 *
 * No row is read, written or backfilled by this change.
 */
drop policy if exists monthly_comments_update on public.monthly_comments;
create policy monthly_comments_update on public.monthly_comments
  for update to authenticated
  using (
    public.monthly_can_manage_project(
      public.monthly_report_project(monthly_report_id))
    or (
      source_kind <> 'weekly'
      and created_by_contact_id = public.current_contact_id()
    )
  )
  with check (
    public.monthly_can_manage_project(
      public.monthly_report_project(monthly_report_id))
    or (
      source_kind <> 'weekly'
      and department_id is not null
      and public.weekly_can_access_scope(
            public.monthly_report_project(monthly_report_id),
            department_id,
            discipline_id)
    )
  );

/*
 * Immutable means immutable, so DELETE carries the same test.
 *
 * `monthly_comments_delete` was the mirror image of the UPDATE hole: the same
 * `created_by_contact_id = current_contact_id()` branch, with no source test,
 * would have let the original Weekly author DELETE the compiled Monthly item
 * outright. Leaving it open would make "read-only to departments" true of edits
 * and false of removal.
 */
drop policy if exists monthly_comments_delete on public.monthly_comments;
create policy monthly_comments_delete on public.monthly_comments
  for delete to authenticated
  using (
    public.monthly_can_manage_project(
      public.monthly_report_project(monthly_report_id))
    or (
      source_kind <> 'weekly'
      and created_by_contact_id = public.current_contact_id()
    )
  );

/*
 * The same containment on the way IN.
 *
 * Without this a department could INSERT a row claiming `source_kind =
 * 'weekly'` — forged provenance that would read on the Monthly as though it had
 * come from an approved Weekly Report. The department branch is therefore
 * pinned to the one kind a department round produces. Project Control's own
 * additions (`monthly_manual`) and compilation (`weekly`) both travel the
 * manage branch and are unaffected.
 */
drop policy if exists monthly_comments_insert on public.monthly_comments;
create policy monthly_comments_insert on public.monthly_comments
  for insert to authenticated
  with check (
    public.monthly_can_manage_project(
      public.monthly_report_project(monthly_report_id))
    or (
      source_kind = 'monthly_department'
      and department_id is not null
      and public.weekly_can_access_scope(
            public.monthly_report_project(monthly_report_id),
            department_id,
            discipline_id)
    )
  );

/* --------------------------- Lifecycle stage gate ------------------------- */

/*
 * What must be true before a Monthly may leave the department round.
 *
 * Returns the reasons it may not, so the caller can state them. Mirrors
 * weekly_transition_blockers() in shape and in wording, and its TypeScript
 * pre-flight mirror lives in src/features/monthly-reports/monthly-lifecycle.ts.
 *
 * NO SUBMISSIONS IS NOT A BLOCKER, and that is deliberate. A Monthly that never
 * ran a department round has nothing to wait for, and blocking it would break
 * every Monthly compiled straight from approved Weekly data — the flow that is
 * already in production. The gate distinguishes "collection was not used" from
 * "collection is unfinished"; only the second holds the report.
 */
create or replace function public.monthly_transition_blockers(
  p_report uuid, p_to text
)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_total    integer;
  v_approved integer;
  v_out      text[] := '{}';
begin
  select count(*),
         count(*) filter (where status = 'approved')
    into v_total, v_approved
    from public.monthly_submissions
   where monthly_report_id = p_report;

  if p_to in ('under_review', 'approved', 'finalized', 'locked')
     and v_total > 0
     and v_approved < v_total then
    v_out := array_append(v_out, format(
      '%s of %s department%s approved - every department in the Monthly collection must be approved by its Department Manager.',
      v_approved, v_total, case when v_total = 1 then '' else 's' end));
  end if;

  return v_out;
end;
$fn$;

comment on function public.monthly_transition_blockers(uuid, text) is
  'Stage conditions for a Monthly transition, as a list of reasons it may not proceed. A Monthly with no department collection rows is never blocked: nothing was asked for, so nothing is outstanding.';

revoke execute on function public.monthly_transition_blockers(uuid, text)
  from public, anon;
grant execute on function public.monthly_transition_blockers(uuid, text)
  to authenticated, service_role;

/*
 * Wire the gate into the boundary.
 *
 * Re-declared in full because CREATE OR REPLACE FUNCTION has no partial form.
 * Everything except the added blocker check is character-for-character the
 * 20260820000005 definition, so authority, shape checking, the archive branch
 * and the eprp.status_change guard handshake all behave exactly as they do now.
 */
create or replace function public.set_monthly_report_status(
  p_report uuid, p_to text
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_project  uuid;
  v_from     text;
  v_blockers text[];
begin
  select project_id, status into v_project, v_from
    from public.monthly_reports where id = p_report;

  if v_project is null then
    raise exception 'Monthly report % not found.', p_report using errcode = 'no_data_found';
  end if;

  if not public.monthly_can_manage_project(v_project) then
    raise exception 'Only Project Control may change the status of this monthly report.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_from = p_to then
    return v_from;
  end if;

  if not public.report_transition_allowed('monthly', v_from, p_to) then
    raise exception 'Cannot move a monthly report from % to %.', v_from, p_to
      using errcode = 'check_violation';
  end if;

  -- Archiving is an escape hatch and is never held by an unfinished round.
  if p_to <> 'archived' then
    v_blockers := public.monthly_transition_blockers(p_report, p_to);
    if array_length(v_blockers, 1) > 0 then
      raise exception 'Cannot move this monthly report to %: %',
        p_to, array_to_string(v_blockers, ' ')
        using errcode = 'check_violation';
    end if;
  end if;

  perform set_config('eprp.status_change', 'monthly:' || p_report::text, true);
  if p_to = 'archived' then
    update public.monthly_reports
       set status = p_to, active = false, archived_at = now()
     where id = p_report;
  else
    update public.monthly_reports set status = p_to where id = p_report;
  end if;
  perform set_config('eprp.status_change', '', true);

  return p_to;
end;
$fn$;

revoke execute on function public.set_monthly_report_status(uuid, text)
  from public, anon;
grant execute on function public.set_monthly_report_status(uuid, text)
  to authenticated;

/* -------------------------- Post-condition checks ------------------------- */

do $$
declare
  blanket    integer;
  kinds      integer;
  unguarded  integer;
  pca_ok     boolean;
begin
  select count(*) into blanket
    from pg_policies
   where schemaname = 'public'
     and tablename in ('monthly_submissions', 'monthly_comments')
     and (qual = 'true' or with_check = 'true');
  if blanket > 0 then
    raise exception
      'Post-check failed: % blanket policy/policies on the Monthly tables.', blanket;
  end if;

  /*
   * Every department-reachable branch on monthly_comments must carry the
   * source test. Checked by inspecting the policy bodies rather than trusting
   * this file to have been applied in full.
   */
  select count(*) into unguarded
    from pg_policies
   where schemaname = 'public'
     and tablename = 'monthly_comments'
     and cmd in ('UPDATE', 'DELETE', 'INSERT')
     and coalesce(qual, '') || coalesce(with_check, '') not like '%source_kind%';
  if unguarded > 0 then
    raise exception
      'Post-check failed: % monthly_comments write policy/policies do not test source_kind, so a Weekly-derived row is not read-only to departments.',
      unguarded;
  end if;

  -- Project Control Admin must now reach Monthly operational authority.
  select pg_get_functiondef(p.oid) like '%has_global_operational_authority%'
    into pca_ok
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'monthly_can_manage_project';
  if not coalesce(pca_ok, false) then
    raise exception
      'Post-check failed: monthly_can_manage_project() does not read has_global_operational_authority(), so Project Control Admin remains read-only on Monthly.';
  end if;

  -- The widened constraint must admit the new kind and still reject nonsense.
  select count(*) into kinds
    from pg_constraint
   where conname = 'monthly_comments_source_kind'
     and pg_get_constraintdef(oid) like '%monthly_department%';
  if kinds <> 1 then
    raise exception
      'Post-check failed: monthly_comments_source_kind does not admit monthly_department.';
  end if;

  raise notice 'Monthly department collection installed: submissions table, department source kind, lifecycle gate, department-scoped reads, Weekly-derived comments read-only to departments, Project Control Admin operational authority.';
end;
$$;

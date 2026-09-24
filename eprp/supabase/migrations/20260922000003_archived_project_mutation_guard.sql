-- Access & Visibility Reconciliation hotfix, Round 6 — archived-project
-- mutation guard for Weekly/Monthly reporting.
--
-- CONFIRMED GAP (read-only investigation against the local Postgres
-- instance this session, zero DDL/DML until this migration)
--   `weekly-report-detail-view.tsx` already treats an archived PROJECT as
--   fully read-only client-side (`projectArchived`, gating Edit/Duplicate/
--   Archive/status-transition buttons — Round 1/2). The Distribution &
--   Follow-up panel's "Start Collection"/"Remind" buttons
--   (`weekly-distribution-panel.tsx`) were NEVER gated on that flag at
--   all — confirmed by reading the component: `canEditScope` only disables
--   the department-scope checkboxes, never the Start Collection buttons.
--
--   Worse, and the reason this is a migration and not only a UI fix: the
--   REAL server-side boundary has the same gap. `can_manage_reporting_
--   workflow()` -- the authority predicate behind 24 INSERT/UPDATE/DELETE
--   policies across weekly_reports, weekly_submissions, weekly_entries,
--   weekly_activities, weekly_plan_items, monthly_reports, monthly_
--   department_summaries and monthly_plan_items -- never checked the
--   PROJECT's own `status`, only the caller's role/assignment. Verified
--   directly: `select policyname, qual, with_check from pg_policies where
--   qual ilike '%can_manage_reporting_workflow%' or with_check ilike
--   '%can_manage_reporting_workflow%'` returned all 24, none archived-
--   aware. A Project Control / Planning holder or Report Coordinator could
--   therefore mutate an archived project's Weekly/Monthly reports through
--   the API directly, regardless of what the UI shows or hides.
--
--   Two narrower, PARALLEL predicates carried the identical gap for the
--   department-contributor write path, which does not go through
--   `can_manage_reporting_workflow()` at all:
--     - `weekly_report_accepts_department_input()` / `monthly_report_
--       accepts_department_input()` -- checked only the REPORT's own
--       status (draft/collecting/returned, or the Monthly equivalents),
--       never the project's.
--     - `can_edit_department_report_comment()` -- its `is_department_user()`
--       branch (comments) had no status or archived check of any kind.
--
-- WHY `is_department_user()` / `weekly_can_access_scope()` ARE NOT TOUCHED
--   Both are also read-path predicates (`weekly_submissions_select` reads
--   through `weekly_can_access_scope()`, which reads through `is_
--   department_user()`). Archived-gating THOSE would make an archived
--   project's Weekly content invisible to the department users who
--   prepared it -- turning "read-only" into "gone", which is the opposite
--   of `05_PERMISSION_MODEL.md`'s archived-project rule. Every function
--   this migration edits is a WRITE-path predicate only.
--
-- WHY `can_manage_project_operations()` IS DELIBERATELY NOT TOUCHED HERE
--   It gates the report lifecycle RPCs' approve/return/reject/finalize/
--   lock/archive branch (`set_weekly_report_status()` / `set_monthly_
--   report_status()`), so an archived project's report can still, today,
--   have its status force-moved through that path. That is a real,
--   confirmed gap of the identical shape -- but `can_manage_project_
--   operations()` is also the authority behind 39 policies far outside
--   Weekly/Monthly reporting (Master Milestones, Master Deliverables,
--   every Planning table, Project Setup, Organization Chart, Documents).
--   Archived-gating it is very likely the correct eventual fix, but it is
--   a materially larger, cross-cutting change this round's declared scope
--   ("Archived Weekly Workspace") does not cover, and CLAUDE.md's "ask
--   before a business assumption that changes the documented workflow"
--   applies squarely -- whether an archived project should ALSO freeze
--   Planning/Milestone data untouched by Weekly/Monthly reporting is a
--   product decision, not an obvious bug fix. Reported as the primary
--   remaining blocker for this item; see the session's completion report.
--
-- SCOPE
--   One new helper, four existing functions altered in place
--   (`create or replace`, same signature, same security/volatility
--   attributes -- verified via `pg_get_functiondef()` before writing this
--   migration and reproduced exactly except for the one added clause).
--   Zero policy text changes (every policy already calls these functions
--   by name, so the fix reaches all 24+ call sites without touching a
--   single `CREATE POLICY` statement). Zero new tables, zero write
--   surface widened -- every change makes an existing write REFUSE a case
--   it previously allowed; nothing that used to be refused is now
--   admitted.

/* ------------------------------- helper ------------------------------- */

create function public.project_is_archived(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.projects p
     where p.id = p_project
       and p.status = 'archived'
  );
$fn$;

comment on function public.project_is_archived(uuid) is
  'Access & Visibility hotfix R6. Read-only helper: true when the project itself (not any one report on it) carries status = archived. Used ONLY by write-path authority predicates (can_manage_reporting_workflow, weekly/monthly_report_accepts_department_input, can_edit_department_report_comment) -- never by a SELECT policy, so it can only ever narrow a write, never hide a read.';

/* ------------------- consolidator / coordinator authority ------------------- */

create or replace function public.can_manage_reporting_workflow(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select (
    public.has_global_operational_authority()
    or public.is_project_control_planning(p_project)
    or public.is_report_coordinator(p_project)
  )
  and not public.project_is_archived(p_project);
$fn$;

comment on function public.can_manage_reporting_workflow(uuid) is
  'Access & Visibility hotfix R6: added "and not project_is_archived()". Authority is otherwise unchanged -- this only withdraws it once the PROJECT (not the report) is archived. Backs 24 INSERT/UPDATE/DELETE policies across weekly_reports, weekly_submissions, weekly_entries, weekly_activities, weekly_plan_items, monthly_reports, monthly_department_summaries, monthly_plan_items -- fixing it here reaches all of them without a policy edit.';

create or replace function public.monthly_can_manage_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $fn$
  select (
    public.has_global_operational_authority()
    or public.is_project_consolidator(p_project)
  )
  and not public.project_is_archived(p_project);
$fn$;

comment on function public.monthly_can_manage_project(uuid) is
  'Access & Visibility hotfix R6: added "and not project_is_archived()", mirroring can_manage_reporting_workflow(). Backs monthly_comments/monthly_submissions consolidator-authority branches.';

/* ------------------------ department input window ------------------------ */

create or replace function public.weekly_report_accepts_department_input(p_report uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from public.weekly_reports wr
     where wr.id = p_report
       and wr.status in ('draft', 'collecting', 'returned')
       and not public.project_is_archived(wr.project_id)
  );
$fn$;

comment on function public.weekly_report_accepts_department_input(uuid) is
  'Access & Visibility hotfix R6: added "and not project_is_archived(project_id)". Previously checked only the REPORT''s own status -- a report left in draft/collecting/returned on a project that was later archived still accepted department input. Backs the department-contributor branch of weekly_submissions_insert/update and (via weekly_report_accepts_department_input-gated callers) weekly_entries.';

create or replace function public.monthly_report_accepts_department_input(p_report uuid)
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
       and not public.project_is_archived(mr.project_id)
  );
$fn$;

comment on function public.monthly_report_accepts_department_input(uuid) is
  'Monthly mirror of weekly_report_accepts_department_input(uuid) -- same R6 fix, same reasoning. Backs the department-contributor branch of monthly_submissions_update.';

/* ------------------------------ comments ------------------------------- */

create or replace function public.can_edit_department_report_comment(p_project uuid, p_department uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.can_manage_reporting_workflow(p_project)
      or (
        public.is_department_user(p_project, p_department)
        and not public.project_is_archived(p_project)
      );
$fn$;

comment on function public.can_edit_department_report_comment(uuid, uuid) is
  'Access & Visibility hotfix R6: added "and not project_is_archived()" to the is_department_user() branch specifically -- that branch carried no status or archived check of any kind (unlike weekly_submissions, it is not also gated by weekly_report_accepts_department_input()). The can_manage_reporting_workflow() branch was already fixed by that function''s own R6 change above; restated here only because both branches feed the same OR.';

/* ----------------------------- postconditions ----------------------------- */

do $post$
declare
  v_src text;
begin
  -- Every altered function must literally reference the new guard --
  -- present in the compiled source, not merely a claim in this comment.
  select prosrc into v_src from pg_proc where proname = 'can_manage_reporting_workflow';
  if v_src is null or v_src not ilike '%project_is_archived%' then
    raise exception 'Post-check failed: can_manage_reporting_workflow() does not reference project_is_archived().';
  end if;

  select prosrc into v_src from pg_proc where proname = 'monthly_can_manage_project';
  if v_src is null or v_src not ilike '%project_is_archived%' then
    raise exception 'Post-check failed: monthly_can_manage_project() does not reference project_is_archived().';
  end if;

  select prosrc into v_src from pg_proc where proname = 'weekly_report_accepts_department_input';
  if v_src is null or v_src not ilike '%project_is_archived%' then
    raise exception 'Post-check failed: weekly_report_accepts_department_input() does not reference project_is_archived().';
  end if;

  select prosrc into v_src from pg_proc where proname = 'monthly_report_accepts_department_input';
  if v_src is null or v_src not ilike '%project_is_archived%' then
    raise exception 'Post-check failed: monthly_report_accepts_department_input() does not reference project_is_archived().';
  end if;

  select prosrc into v_src from pg_proc where proname = 'can_edit_department_report_comment';
  if v_src is null or v_src not ilike '%project_is_archived%' then
    raise exception 'Post-check failed: can_edit_department_report_comment() does not reference project_is_archived().';
  end if;

  -- Read-path predicates must remain UNTOUCHED -- an archived project's
  -- Weekly/Monthly content must stay readable, never newly hidden.
  select prosrc into v_src from pg_proc where proname = 'is_department_user';
  if v_src ilike '%project_is_archived%' or v_src ilike '%archived%' then
    raise exception 'Post-check failed: is_department_user() (a read-path predicate) was modified -- it must stay archived-agnostic.';
  end if;

  select prosrc into v_src from pg_proc where proname = 'weekly_can_access_scope';
  if v_src ilike '%project_is_archived%' or v_src ilike '%archived%' then
    raise exception 'Post-check failed: weekly_can_access_scope() (a read-path predicate) was modified -- it must stay archived-agnostic.';
  end if;

  raise notice 'Archived-project mutation guard applied: project_is_archived() added; can_manage_reporting_workflow(), monthly_can_manage_project(), weekly_report_accepts_department_input(), monthly_report_accepts_department_input() and can_edit_department_report_comment() now refuse writes once the project is archived. Read-path predicates (is_department_user, weekly_can_access_scope, and every *_select policy) are unchanged. can_manage_project_operations() -- the report lifecycle RPCs'' approve/return/reject/finalize/lock/archive branch, and 38 other policies outside reporting -- is NOT covered; see this migration''s header.';
end;
$post$;

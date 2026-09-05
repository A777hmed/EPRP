-- =============================================================================
-- Project-scoped visibility for projects and their Weekly/Monthly reports.
--
-- WHAT WAS WRONG
--
-- Two separate blanket branches let an account read records belonging to
-- projects it holds no assignment on:
--
--   1. `projects_select` was `USING (true)` — every authenticated account
--      received every project row. The Projects register and every project
--      picker therefore listed the whole portfolio to a department user, and
--      the Dashboard had to re-filter in React to undo it.
--
--   2. `weekly_reports_select` / `monthly_reports_select` and their six child
--      tables carried `... OR report_status_is_approved(status)` (directly, or
--      as `weekly_report_is_approved()` / `monthly_report_is_approved()`).
--      Any approved, finalized or locked report was readable by EVERY
--      authenticated account, whatever project it belonged to.
--
-- The pilot surfaced (2) concretely: a Department User assigned only to
-- PILOT-PSAIM-001 was shown a locked Weekly belonging to the unrelated
-- PSAIM-001, and the workspace then correctly told them they had no
-- assignment on it — a record they should never have received at all.
--
-- Hiding those rows in React would not have fixed it: the same rows are
-- returned to any direct PostgREST call with the same token. This closes it
-- at the authorization boundary instead.
--
-- WHAT THIS CHANGES
--
-- One rule, applied consistently: a project's records are visible to accounts
-- that can reach the PROJECT. `can_access_project()` is that rule, and it is
-- the existing membership rule — nothing here is new authority:
--
--     has_global_operational_authority()   System Admin, Project Control Admin
--  OR is_project_control_planning(project) assigned Project Control / Planning
--  OR is_report_coordinator(project)       assigned Report Coordinator
--  OR any project_contacts row              any assignment, any department
--
-- Approved reports stay fully readable INSIDE an accessible project — the
-- "you may read the whole published report, not just your own department's
-- rows" behaviour the child policies existed for is preserved by
-- `weekly_report_readable()` / `monthly_report_readable()`, which simply add
-- the project check the blanket branch was missing.
--
-- WHAT THIS DELIBERATELY DOES NOT CHANGE
--
--   * `executive_reports_select` keeps `executive_can_manage() OR
--     report_status_is_approved(status)`. `executive_reports` has NO project
--     column — portfolio Executive Reports are cross-project by definition, so
--     there is no project scope to apply. Narrowing it would restrict approved
--     portfolio reports to global authorities only, which would remove the
--     `executive` platform role's entire purpose. That is a product decision,
--     not a defect, and is left to the product owner.
--   * No write policy. No table, column or grant. Reads only.
--   * Every mutation policy, and every function that decides a WRITE, is
--     untouched — `is_department_user()`, `can_edit_department_report_comment()`
--     and `can_manage_reporting_workflow()` behave exactly as before, so
--     department input authority is unaffected.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The canonical project-access predicate.
--
-- This is `weekly_can_access_project()`'s body, given the name the rule
-- actually deserves: it answers "may this account reach this project?" and has
-- nothing to do with Weekly specifically. `weekly_can_access_project()` becomes
-- a delegating alias just below, so its existing callers keep working and
-- there is exactly ONE definition of the rule rather than two that can drift.
-- ---------------------------------------------------------------------------
create or replace function public.can_access_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select public.has_global_operational_authority()
      or public.is_project_control_planning(p_project)
      or public.is_report_coordinator(p_project)
      or (
        public.current_contact_id() is not null
        and exists (
          select 1
            from public.project_contacts pc
           where pc.project_id = p_project
             and pc.contact_id = public.current_contact_id()
        )
      );
$$;

comment on function public.can_access_project(uuid) is
  'Canonical project READ predicate: global operational authority, assigned '
  'Project Control / Planning, assigned Report Coordinator, or any '
  'project_contacts assignment. Grants no write authority of any kind — use '
  'can_manage_project_operations() for operations and '
  'can_manage_reporting_workflow() for reporting.';

-- Delegating alias. Kept so the ten existing call sites need no edit.
create or replace function public.weekly_can_access_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select public.can_access_project(p_project);
$$;

comment on function public.weekly_can_access_project(uuid) is
  'Deprecated alias for can_access_project(). The rule was never Weekly-'
  'specific; retained so existing policies continue to resolve.';

-- ---------------------------------------------------------------------------
-- 2. "Published AND mine to read."
--
-- The child tables used bare `*_report_is_approved()` as a branch meaning
-- "everyone may read an approved report". These add the project check that
-- branch was missing, and keep the part that was right: within a project you
-- can reach, an approved report is readable in full rather than only the rows
-- matching your own department scope.
-- ---------------------------------------------------------------------------
create or replace function public.weekly_report_readable(p_report uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select public.weekly_report_is_approved(p_report)
     and public.can_access_project(public.weekly_report_project(p_report));
$$;

comment on function public.weekly_report_readable(uuid) is
  'An approved/finalized/locked Weekly report on a project the reader can '
  'access. Replaces the unscoped weekly_report_is_approved() branch in SELECT '
  'policies.';

create or replace function public.monthly_report_readable(p_report uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select public.monthly_report_is_approved(p_report)
     and public.can_access_project(public.monthly_report_project(p_report));
$$;

comment on function public.monthly_report_readable(uuid) is
  'An approved/finalized/locked Monthly report on a project the reader can '
  'access. Replaces the unscoped monthly_report_is_approved() branch in SELECT '
  'policies.';

-- ---------------------------------------------------------------------------
-- 3. Projects.
--
-- `USING (true)` becomes the membership rule. A global authority still sees
-- the whole portfolio, because can_access_project() admits it first.
-- ---------------------------------------------------------------------------
alter policy projects_select on public.projects
  using (public.can_access_project(id));

-- ---------------------------------------------------------------------------
-- 4. Report parents.
--
-- The approved branch is dropped outright rather than scoped: once project
-- access is required, "approved AND accessible" is a subset of "accessible",
-- so it would add nothing.
-- ---------------------------------------------------------------------------
alter policy weekly_reports_select on public.weekly_reports
  using (public.can_access_project(project_id));

alter policy monthly_reports_select on public.monthly_reports
  using (public.can_access_project(project_id));

-- ---------------------------------------------------------------------------
-- 5. Report children — same scope checks as before, scoped published branch.
-- ---------------------------------------------------------------------------
alter policy weekly_entries_select on public.weekly_entries
  using (
    case
      when department_id is null
        then public.weekly_can_access_project(public.weekly_report_project(weekly_report_id))
      else public.weekly_can_access_scope(
             public.weekly_report_project(weekly_report_id), department_id, discipline_id)
    end
    or public.weekly_report_readable(weekly_report_id)
  );

alter policy weekly_activities_select on public.weekly_activities
  using (
    public.weekly_can_access_scope(
      public.weekly_report_project(weekly_report_id), department_id, discipline_id)
    or public.weekly_report_readable(weekly_report_id)
  );

alter policy weekly_submissions_select on public.weekly_submissions
  using (
    public.weekly_can_access_scope(
      public.weekly_report_project(weekly_report_id), department_id, discipline_id)
    or public.weekly_report_readable(weekly_report_id)
  );

alter policy weekly_plan_items_select on public.weekly_plan_items
  using (
    public.weekly_can_access_project(public.weekly_report_project(weekly_report_id))
    or public.weekly_report_readable(weekly_report_id)
  );

alter policy monthly_comments_select on public.monthly_comments
  using (
    public.weekly_can_access_project(public.monthly_report_project(monthly_report_id))
    or public.monthly_report_readable(monthly_report_id)
  );

alter policy monthly_department_summaries_select on public.monthly_department_summaries
  using (
    public.weekly_can_access_project(public.monthly_report_project(monthly_report_id))
    or public.monthly_report_readable(monthly_report_id)
  );

alter policy monthly_plan_items_select on public.monthly_plan_items
  using (
    public.weekly_can_access_project(public.monthly_report_project(monthly_report_id))
    or public.monthly_report_readable(monthly_report_id)
  );

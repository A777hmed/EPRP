-- =============================================================================
-- Department input on a Weekly Report: let the department that OWNS a
-- submission actually write it.
--
-- WHAT WAS WRONG
--
-- `20260824000001_authorization_foundation_wave1.sql` rewrote every Weekly
-- write policy around `can_manage_reporting_workflow()`. For
-- `weekly_reports` and `weekly_activities` that is right — raising a Weekly
-- and editing the project-wide report body are Project Control acts. For
-- `weekly_submissions` it closed the wrong door: a submission row IS the
-- department's input, and the policies left NO branch for the department.
--
--     weekly_submissions_insert  WITH CHECK can_manage_reporting_workflow(...)
--     weekly_submissions_update  USING/CHECK can_manage_reporting_workflow(...)
--
-- So an assigned department team member — the Department Engineer of
-- docs/05_PERMISSION_MODEL.md §1.1, whose whole role is "enters their
-- department's updates … submits the department's input" — could READ their
-- own row (`weekly_can_access_scope` governs SELECT) and could not write it.
-- The Weekly workspace rendered an editable form for them and every save
-- returned
--
--     new row violates row-level security policy for table "weekly_submissions"
--
-- Observed on the pilot: a department user assigned to PILOT-PSAIM-001 /
-- Inspection could not record a single figure against their own scope item.
-- `weekly_entries` already carries the department branch it needs
-- (`can_edit_department_report_comment`), which is why authored comments
-- worked and the submission behind them did not — the two had drifted apart.
--
-- WHAT THIS CHANGES
--
-- One branch is ADDED to the two write policies. Nothing is removed, and no
-- authority Project Control holds today is altered in any way.
--
--   `weekly_can_access_scope(project, department, scope item)` decides the
--   department branch. That is the SAME function the SELECT policy already
--   uses and the same rule `resolveWeeklyScope()` applies in TypeScript, so
--   this grants exactly what the viewer can already see and not one row more:
--
--     Department Manager .. every scope item in the departments they manage
--     Scoped member ....... their own scope items, plus that department's
--                           department-level (NULL scope item) shared row
--     anyone else ......... nothing
--
--   A row with no department is project-grain content and stays outside the
--   branch entirely — `department_id is not null` is checked first.
--
-- WHAT IT DELIBERATELY DOES NOT GRANT
--
--   * Not a lifecycle act. `status` is confined to the collection values
--     `pending | in_progress | submitted`. `approved` and `returned` are the
--     verdicts of the Department Lead and Project Control (§1.2), and remain
--     reachable only through `can_manage_reporting_workflow()`. A department
--     user can therefore submit their input and cannot accept it.
--   * Not a write onto a closed report. The branch requires the Weekly to
--     still be collecting — `draft | collecting | returned`. Once the project
--     Weekly is submitted, under review, approved, finalized, locked,
--     rejected or archived, department input is closed at the database, not
--     merely hidden in the UI.
--   * No DELETE. Removing a submission row is scope management and stays
--     `can_manage_reporting_workflow()`.
--   * `weekly_reports`, `weekly_activities` and `weekly_entries` are not
--     touched. Report lifecycle, project-wide body and the entry rules are
--     exactly as they were.
--
-- Reads are unchanged: `weekly_submissions_select` is not redefined here.
-- =============================================================================

/* -------------------- Is this Weekly still collecting? -------------------- */

create or replace function public.weekly_report_accepts_department_input(
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
      from public.weekly_reports wr
     where wr.id = p_report
       and wr.status in ('draft', 'collecting', 'returned')
  );
$fn$;

comment on function public.weekly_report_accepts_department_input(uuid) is
  'True while a Weekly Report is still open for department input (draft, collecting, returned). Used only by the department branch of the weekly_submissions write policies; Project Control authority does not depend on it.';

revoke execute on function public.weekly_report_accepts_department_input(uuid)
  from public, anon;
grant execute on function public.weekly_report_accepts_department_input(uuid)
  to authenticated, service_role;

/* ---------------------------- Write policies ------------------------------ */

drop policy if exists weekly_submissions_insert on public.weekly_submissions;
drop policy if exists weekly_submissions_update on public.weekly_submissions;

create policy weekly_submissions_insert on public.weekly_submissions
  for insert to authenticated
  with check (
    public.can_manage_reporting_workflow(
      public.weekly_report_project(weekly_report_id))
    or (
      department_id is not null
      and status in ('pending', 'in_progress', 'submitted')
      and public.weekly_can_access_scope(
            public.weekly_report_project(weekly_report_id),
            department_id,
            discipline_id)
      and public.weekly_report_accepts_department_input(weekly_report_id)
    )
  );

/*
 * USING and WITH CHECK carry the same predicate on purpose: USING decides
 * which row may be touched, WITH CHECK what it may become. Identical
 * predicates mean a department user can neither reach another department's
 * row nor move their own row into one.
 */
create policy weekly_submissions_update on public.weekly_submissions
  for update to authenticated
  using (
    public.can_manage_reporting_workflow(
      public.weekly_report_project(weekly_report_id))
    or (
      department_id is not null
      and status in ('pending', 'in_progress', 'submitted')
      and public.weekly_can_access_scope(
            public.weekly_report_project(weekly_report_id),
            department_id,
            discipline_id)
      and public.weekly_report_accepts_department_input(weekly_report_id)
    )
  )
  with check (
    public.can_manage_reporting_workflow(
      public.weekly_report_project(weekly_report_id))
    or (
      department_id is not null
      and status in ('pending', 'in_progress', 'submitted')
      and public.weekly_can_access_scope(
            public.weekly_report_project(weekly_report_id),
            department_id,
            discipline_id)
      and public.weekly_report_accepts_department_input(weekly_report_id)
    )
  );

/* -------------------------- Post-condition check -------------------------- */

do $$
declare blanket integer;
begin
  select count(*) into blanket
    from pg_policies
   where schemaname = 'public'
     and tablename = 'weekly_submissions'
     and (qual = 'true' or with_check = 'true');

  if blanket > 0 then
    raise exception
      'Post-check failed: % blanket policy/policies on weekly_submissions.', blanket;
  end if;

  raise notice 'weekly_submissions write policies rebuilt with the department branch.';
end;
$$;

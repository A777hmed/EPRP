-- =============================================================================
-- Department Manager approval of a department's Weekly submission, and a
-- lifecycle guard that counts DEPARTMENTS instead of rows.
--
-- TWO DEFECTS, ONE CAUSE
--
-- weekly_submissions holds two grains against one department: the canonical
-- department-level row (discipline_id is null) and one row per scope item that
-- department covers. Both the guard and the approval rule were written as
-- though the table held one row per department.
--
--   1. LIFECYCLE COUNT. weekly_transition_blockers() counted rows:
--
--          select count(*), count(*) filter (where status = 'approved')
--            from public.weekly_submissions where weekly_report_id = p_report;
--
--      On the pilot, one department (Inspection) carrying one scope item
--      (RBI Study) is two rows, so Project Control was refused with
--
--          0 of 2 department submissions approved - all are required.
--
--      beside a Weekly scope that showed exactly one department. Nothing in the
--      product ever approves a scope item, so the denominator could never be
--      reached and the Weekly could not leave Collecting by any route.
--
--   2. WHO APPROVES. 20260906000001 gave the department branch of
--      weekly_submissions_update the input statuses only
--      (pending | in_progress | submitted), leaving approved and returned to
--      can_manage_reporting_workflow(). That made Project Control the
--      department approver. docs/05_PERMISSION_MODEL.md 1.2 says the opposite:
--      the Department Lead approves the department's Weekly submission, and a
--      department's submission cannot skip the Lead; 1.3 has the Coordinator
--      chasing completeness, not granting it. There was no manager-specific
--      predicate anywhere in the schema, so the authority the specification
--      names could not be expressed at all.
--
-- WHAT THIS CHANGES
--
--   * is_weekly_department_manager(project, department) - new predicate, the
--     database's statement of the rule isDepartmentManager() in
--     src/features/weekly-reports/scope.ts already applies in TypeScript: the
--     contact assigned assignment_role = 'department_manager' for THIS project
--     and THIS department. Read from project_contacts; no name, address or id
--     is written into this file.
--
--   * weekly_transition_blockers() counts departments, and approves a
--     department only on its canonical row. Mirrors departmentApproval() in
--     src/features/weekly-reports/lifecycle-guards.ts, wording included, so the
--     two layers cannot drift.
--
--   * weekly_submissions_update gains ONE branch: a Department Manager may set
--     the verdict on the CANONICAL row of a department they manage.
--
-- WHAT IT DELIBERATELY DOES NOT GRANT
--
--   * Not another department. The predicate takes the row's own department_id,
--     so a manager reaches only what they manage.
--   * Not a scope item. The manager verdict branch requires
--     discipline_id is null. Scope-item rows keep the contributor statuses,
--     which is what a scope item means - working state, not a verdict.
--   * Not to a Team Member. assignment_role = 'department_manager' is the whole
--     rule; team_member and team_member_lead do not satisfy it.
--   * Not the report lifecycle. set_weekly_report_status() still demands
--     weekly_can_manage_project(), untouched. A manager approves their
--     department and cannot move the Weekly.
--   * Not outside the collection window. The branch requires
--     weekly_report_accepts_department_input() - the same predicate the
--     contributor branch uses, so a verdict cannot be rewritten once the Weekly
--     has left the departments.
--   * No INSERT. A canonical row is seeded when the Weekly is raised and
--     reaches submitted through the department; it is never born approved.
--   * weekly_reports, weekly_activities, weekly_entries and every read policy
--     are untouched.
-- =============================================================================

/* ------------------------- Department Manager ----------------------------- */

create or replace function public.is_weekly_department_manager(
  p_project uuid,
  p_department uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select p_department is not null
     and public.current_contact_id() is not null
     and exists (
       select 1
         from public.project_contacts pc
         join public.project_departments pd
           on pd.project_id = pc.project_id
          and pd.department_id = pc.department_id
        where pc.project_id = p_project
          and pc.department_id = p_department
          and pc.contact_id = public.current_contact_id()
          and pc.role = 'team_member'
          and pc.assignment_role = 'department_manager'
     );
$fn$;

comment on function public.is_weekly_department_manager(uuid, uuid) is
  'True when the caller is the assigned Department Manager of this department on this project (project_contacts.assignment_role = department_manager). The database statement of docs/05_PERMISSION_MODEL.md 1.2; mirrors isDepartmentManager() in src/features/weekly-reports/scope.ts. Grants a verdict on that canonical Weekly submission and nothing else.';

revoke execute on function public.is_weekly_department_manager(uuid, uuid)
  from public, anon;
grant execute on function public.is_weekly_department_manager(uuid, uuid)
  to authenticated, service_role;

/* --------------------- Lifecycle blockers, by department ------------------ */

-- Mirrors unmetConditions()/departmentApproval() in
-- src/features/weekly-reports/lifecycle-guards.ts. The TypeScript is a
-- pre-flight that produces the better message; THIS is the boundary, and the
-- two must agree.
create or replace function public.weekly_transition_blockers(
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
  v_reviewer uuid;
  v_approver uuid;
  v_out      text[] := '{}';
begin
  select reviewed_by_contact_id, approved_by_contact_id
    into v_reviewer, v_approver
    from public.weekly_reports where id = p_report;

  /*
   * Departments, not rows.
   *
   * v_total    every department with any submission row on this Weekly - the
   *            Weekly department scope as the data holds it.
   * v_approved departments whose CANONICAL row (discipline_id is null) is
   *            approved. A department in scope with no canonical row raises
   *            the total and not the approvals, because the submission that
   *            would be approved does not exist.
   */
  select count(distinct department_id),
         count(distinct department_id) filter (
           where discipline_id is null and status = 'approved')
    into v_total, v_approved
    from public.weekly_submissions
   where weekly_report_id = p_report
     and department_id is not null;

  if p_to in ('under_review', 'approved', 'finalized', 'locked') then
    if v_total = 0 then
      v_out := array_append(v_out, 'No department submissions exist for this report.');
    elsif v_approved < v_total then
      v_out := array_append(v_out, format(
        '%s of %s department%s approved - every department in the Weekly scope must be approved by its Department Manager.',
        v_approved, v_total, case when v_total = 1 then '' else 's' end));
    end if;
  end if;

  if p_to in ('approved', 'finalized', 'locked') and v_reviewer is null then
    v_out := array_append(v_out, 'No reviewer recorded.');
  end if;

  if p_to in ('finalized', 'locked') and v_approver is null then
    v_out := array_append(v_out, 'No approver recorded.');
  end if;

  return v_out;
end;
$fn$;

/* ----------------------- Submission write policy -------------------------- */

drop policy if exists weekly_submissions_update on public.weekly_submissions;

/*
 * USING and WITH CHECK carry the same predicate: USING decides which row may be
 * touched, WITH CHECK what it may become. Identical predicates mean a manager
 * can neither reach another department row nor move their own row into one,
 * and a contributor can neither reach an approved row nor produce one.
 */
create policy weekly_submissions_update on public.weekly_submissions
  for update to authenticated
  using (
    public.can_manage_reporting_workflow(
      public.weekly_report_project(weekly_report_id))
    or (
      department_id is not null
      and public.weekly_report_accepts_department_input(weekly_report_id)
      and (
        (
          status in ('pending', 'in_progress', 'submitted')
          and public.weekly_can_access_scope(
                public.weekly_report_project(weekly_report_id),
                department_id,
                discipline_id)
        )
        or (
          discipline_id is null
          and status in ('pending', 'in_progress', 'submitted', 'returned', 'approved')
          and public.is_weekly_department_manager(
                public.weekly_report_project(weekly_report_id),
                department_id)
        )
      )
    )
  )
  with check (
    public.can_manage_reporting_workflow(
      public.weekly_report_project(weekly_report_id))
    or (
      department_id is not null
      and public.weekly_report_accepts_department_input(weekly_report_id)
      and (
        (
          status in ('pending', 'in_progress', 'submitted')
          and public.weekly_can_access_scope(
                public.weekly_report_project(weekly_report_id),
                department_id,
                discipline_id)
        )
        or (
          discipline_id is null
          and status in ('pending', 'in_progress', 'submitted', 'returned', 'approved')
          and public.is_weekly_department_manager(
                public.weekly_report_project(weekly_report_id),
                department_id)
        )
      )
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

  raise notice 'Department Manager verdict branch added; lifecycle blockers now count departments.';
end;
$$;

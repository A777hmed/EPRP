-- EPRP — Phase A2: narrow whole-report lifecycle authority to the approved
-- model, and stop the Report Coordinator from setting a department verdict
-- through the broad reporting-workflow branch.
--
-- THE APPROVED MODEL
--   Report Coordinator: preparation/consolidation ONLY. Allowed whole-report
--   transitions:
--     weekly:  draft->collecting, collecting->under_review, returned->collecting
--     monthly: draft->auto_compiled, auto_compiled->department_review,
--              department_review->under_review, returned->department_review
--   Every other whole-report transition -- approve, return outside those
--   preparation paths, reject, finalize, lock, archive, and any transition
--   not yet invented -- requires can_manage_project_operations(project):
--   System Admin, Project Control Admin, or the project's assigned Project
--   Control / Planning holder.
--
-- SECURITY DESIGN: ALLOWLIST, NOT BLACKLIST
--   report_preparation_transition() below is the only place the Coordinator's
--   broad authority is admitted. An unrecognised (from, to) pair -- including
--   any transition added later that nobody updates this list for -- falls
--   through to the narrow can_manage_project_operations() branch by
--   construction, never the other way around. This mirrors
--   report_transition_allowed()'s own shape deliberately, so the two are easy
--   to read side by side.
--
-- WHAT THIS PRESERVES, UNCHANGED
--   * report_transition_allowed() -- transition SHAPE is untouched; this
--     migration only changes WHO may attempt a shape-legal transition.
--   * weekly_transition_blockers() / monthly_transition_blockers() -- content
--     completeness gates, including the Phase A1 signatories-JSONB fix
--     (20260912000001), untouched.
--   * guard_weekly_status_change() / guard_monthly_status_change() -- the
--     eprp.status_change trigger handshake is untouched; both controlled
--     writers still use it exactly as before.
--   * is_weekly_department_manager() -- untouched in its own definition.
--     Department Manager approval of their OWN department's canonical
--     submission row continues to come from project_contacts.assignment_role
--     = 'department_manager', never from a platform role, never from a job
--     title.
--   * can_manage_reporting_workflow() / can_manage_project_operations() /
--     weekly_can_manage_project() / monthly_can_manage_project() -- none of
--     these predicates are redefined.
--
-- NO-OP ORDERING: RESTORED TO THE ORIGINAL, AUTHORITY-FIRST SEQUENCE
--   An earlier draft of this migration moved the v_from = p_to no-op
--   short-circuit BEFORE the authority check, to spare a Report Coordinator a
--   refusal on a true no-op. That draft is corrected here: authority is
--   checked FIRST again, exactly as set_weekly_report_status() /
--   set_monthly_report_status() have always done.
--
--   WHY THE REORDERING WAS WRONG. select project_id, status into ... from
--   weekly_reports where id = p_report runs as this SECURITY DEFINER
--   function's owner, which is exempt from weekly_reports' RLS -- the lookup
--   sees the row's real status regardless of whether the CALLING account
--   could read it at all. With the no-op check first, ANY authenticated
--   caller -- no project assignment, no read access, nothing -- could probe
--   set_weekly_report_status(report_id, guess) across every possible status
--   value and learn the report's true current status from which guess alone
--   returns success instead of an exception: an oracle with zero
--   authorization risk on its face, but a real one on inspection. That fails
--   "zero disclosure risk," so the reordering is reverted rather than kept
--   for the Coordinator convenience it bought.
--
--   ONE SIDE EFFECT, ACCEPTED. With authority checked first and the
--   allowlist keyed on (from, to) pairs that always change status, a
--   same-status call (e.g. Coordinator requesting 'collecting' while already
--   'collecting') now falls to the narrow branch and is refused for a
--   Coordinator, where a true no-op would previously have succeeded for any
--   broad-authority caller. No UI path sends a same-status call --
--   allowedTransitions is built from weeklyWorkflow.transitions[status],
--   which never lists the current status as a target -- so this has no
--   observed application impact. Left as-is rather than special-cased,
--   since special-casing it would mean checking v_from = p_to before
--   authority again, reopening the disclosure risk above for that one value.
--
-- DEPARTMENT VERDICT AUTHORITY ON weekly_submissions / monthly_submissions:
-- DEPARTMENT MANAGER ONLY, NO OVERRIDE
--   Both UPDATE policies originally OR'd the department-scoped branches with
--   an unconditional can_manage_reporting_workflow(project) / monthly_can_
--   manage_project(project) branch -- which admitted Report Coordinator for
--   ANY write to ANY submission row, including setting status to 'approved'
--   or 'returned' directly. A first correction narrowed that branch to
--   can_manage_project_operations() for verdict statuses, which stopped the
--   Coordinator but still let Project Control / Planning and every global
--   authority (System Admin, Project Control Admin) set a department's
--   verdict directly, in place of its Department Manager. The approved
--   product model is stricter than that: normal workflow admits NOBODY but
--   the assigned Department Manager of that EXACT project + department to
--   set a verdict -- not Coordinator, not Planning, not a global authority.
--   An administrative override, if the product ever needs one, is explicitly
--   deferred to a later, separately designed, audited mechanism -- it is not
--   hidden inside this policy as a quiet OR-branch.
--
--   THE FIX: remove the verdict-status branch entirely. What remains, for
--   status in ('approved','returned'), is ONLY the existing
--   is_weekly_department_manager() branch (discipline_id is null, this exact
--   department) -- unchanged in its own logic, now the sole path to a
--   verdict for anyone. The broad can_manage_reporting_workflow() /
--   monthly_can_manage_project() branch is kept, but ONLY for status NOT IN
--   ('approved','returned') -- legitimate preparation/content-edit work
--   (pending/in_progress/submitted) stays open to Coordinator, Planning and
--   global authorities exactly as before. Cross-department denial is
--   unaffected: is_weekly_department_manager() already takes the row's own
--   department_id, so a manager of one department was never admitted to
--   another's, and still is not.
--
-- SCOPE
--   Two new/replaced functions, four replaced functions (CREATE OR REPLACE,
--   no signature change), two replaced policies. No table, column, or
--   constraint is created, altered, or dropped. No GRANT/REVOKE is reissued
--   for set_weekly_report_status()/set_monthly_report_status() -- their ACL
--   already excludes anon/public from the migration that first defined them;
--   this migration verifies that, rather than reasserting it.

/* --------------------- The preparation-transition allowlist ---------------- */

create or replace function public.report_preparation_transition(
  p_type text, p_from text, p_to text
)
returns boolean
language sql
immutable
as $fn$
  select exists (
    select 1
      from (values
        -- weekly: Report Coordinator preparation/consolidation only
        ('weekly',  'draft',             'collecting'),
        ('weekly',  'collecting',        'under_review'),
        ('weekly',  'returned',          'collecting'),
        -- monthly: Report Coordinator preparation/consolidation only
        ('monthly', 'draft',             'auto_compiled'),
        ('monthly', 'auto_compiled',     'department_review'),
        ('monthly', 'department_review', 'under_review'),
        ('monthly', 'returned',          'department_review')
      ) as t(kind, from_status, to_status)
     where t.kind = p_type and t.from_status = p_from and t.to_status = p_to
  );
$fn$;

comment on function public.report_preparation_transition(text, text, text) is
  'The ONLY (from, to) pairs a Report Coordinator may perform on a whole report. Every other transition -- approve, return outside these paths, reject, finalize, lock, archive, or any future addition -- falls through to can_manage_project_operations() by construction (allowlist, not a blacklist of target statuses). Mirrors report_transition_allowed() in shape; the two are read together.';

/* ------------------------- The two controlled writers ---------------------- */

create or replace function public.set_weekly_report_status(
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
    from public.weekly_reports where id = p_report;

  if v_project is null then
    raise exception 'Weekly report % not found.', p_report using errcode = 'no_data_found';
  end if;

  -- Authority FIRST, so a caller with no rights learns nothing about the
  -- report -- including whether a guessed target status is its current one
  -- (see migration header: NO-OP ORDERING). The Coordinator's broad
  -- authority is admitted ONLY for the explicit preparation pairs; everything
  -- else requires Project Control / Planning (or a global authority, already
  -- included in both predicates).
  if public.report_preparation_transition('weekly', v_from, p_to) then
    if not public.weekly_can_manage_project(v_project) then
      raise exception 'Only Project Control may change the status of this weekly report.'
        using errcode = 'insufficient_privilege';
    end if;
  else
    if not public.can_manage_project_operations(v_project) then
      raise exception 'Only Project Control / Planning may approve, return, reject, finalize, lock or archive this weekly report.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if v_from = p_to then
    return v_from;
  end if;

  if not public.report_transition_allowed('weekly', v_from, p_to) then
    raise exception 'Cannot move a weekly report from % to %.', v_from, p_to
      using errcode = 'check_violation';
  end if;

  -- Archiving withdraws a report; it asserts nothing about its content, so it
  -- carries no stage conditions -- matching changeStatus() in the service.
  if p_to <> 'archived' then
    v_blockers := public.weekly_transition_blockers(p_report, p_to);
    if coalesce(array_length(v_blockers, 1), 0) > 0 then
      raise exception 'Cannot move this weekly report to %: %',
        p_to, array_to_string(v_blockers, ' | ')
        using errcode = 'check_violation';
    end if;
  end if;

  perform set_config('eprp.status_change', 'weekly:' || p_report::text, true);
  if p_to = 'archived' then
    update public.weekly_reports
       set status = p_to, active = false, archived_at = now()
     where id = p_report;
  else
    update public.weekly_reports set status = p_to where id = p_report;
  end if;
  perform set_config('eprp.status_change', '', true);

  return p_to;
end;
$fn$;

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

  -- Authority FIRST -- see set_weekly_report_status() above; same reasoning
  -- (migration header: NO-OP ORDERING).
  if public.report_preparation_transition('monthly', v_from, p_to) then
    if not public.monthly_can_manage_project(v_project) then
      raise exception 'Only Project Control may change the status of this monthly report.'
        using errcode = 'insufficient_privilege';
    end if;
  else
    if not public.can_manage_project_operations(v_project) then
      raise exception 'Only Project Control / Planning may approve, return, reject, finalize, lock or archive this monthly report.'
        using errcode = 'insufficient_privilege';
    end if;
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

/* ------------- Department verdict authority on weekly_submissions ---------- */

drop policy if exists weekly_submissions_update on public.weekly_submissions;

create policy weekly_submissions_update on public.weekly_submissions
  for update to authenticated
  using (
    (
      status not in ('approved', 'returned')
      and public.can_manage_reporting_workflow(
            public.weekly_report_project(weekly_report_id))
    )
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
    (
      status not in ('approved', 'returned')
      and public.can_manage_reporting_workflow(
            public.weekly_report_project(weekly_report_id))
    )
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

comment on policy weekly_submissions_update on public.weekly_submissions is
  'UPDATE authority on a Weekly submission row. A verdict value (approved/returned) has exactly ONE path: is_weekly_department_manager() for that exact department. Not Report Coordinator, not Project Control/Planning, not a global authority -- normal workflow admits nobody else, by design; an administrative override, if ever needed, is a separate, explicitly audited mechanism, not a branch here. A non-verdict status remains reachable under the broader can_manage_reporting_workflow(), which still admits Coordinator/Planning/global for legitimate preparation/content-edit work.';

/* ------------ Department verdict authority on monthly_submissions ---------- */

drop policy if exists monthly_submissions_update on public.monthly_submissions;

create policy monthly_submissions_update on public.monthly_submissions
  for update to authenticated
  using (
    (
      status not in ('approved', 'returned')
      and public.monthly_can_manage_project(
            public.monthly_report_project(monthly_report_id))
    )
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
    (
      status not in ('approved', 'returned')
      and public.monthly_can_manage_project(
            public.monthly_report_project(monthly_report_id))
    )
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

comment on policy monthly_submissions_update on public.monthly_submissions is
  'UPDATE authority on a Monthly submission row. Mirrors weekly_submissions_update: a verdict value (approved/returned) has exactly ONE path, is_weekly_department_manager() for that exact department -- not Coordinator, not Planning, not a global authority. Non-verdict statuses remain reachable under monthly_can_manage_project() for legitimate preparation work.';

/* -------------------------- Post-condition checks --------------------------- */

do $post$
declare
  v_fn_count integer;
  v_anon     integer;
  v_blanket  integer;
  v_override integer;
begin
  -- All three functions exist.
  select count(*) into v_fn_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('report_preparation_transition',
                        'set_weekly_report_status',
                        'set_monthly_report_status');
  if v_fn_count <> 3 then
    raise exception 'Post-check failed: expected 3 functions, found %.', v_fn_count;
  end if;

  -- The controlled writers remain inaccessible to anon -- unchanged from
  -- 20260820000005, verified rather than reasserted (no GRANT/REVOKE issued
  -- by this migration).
  select count(*) into v_anon
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('set_weekly_report_status', 'set_monthly_report_status')
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_anon > 0 then
    raise exception 'Post-check failed: % controlled writer(s) executable by anon.', v_anon;
  end if;

  -- No blanket (unconditional true) policy crept onto either submissions
  -- table -- same guard 20260906000003 used for weekly_submissions, repeated
  -- here for both tables since this migration replaces both policies.
  select count(*) into v_blanket
    from pg_policies
   where schemaname = 'public'
     and tablename in ('weekly_submissions', 'monthly_submissions')
     and policyname in ('weekly_submissions_update', 'monthly_submissions_update')
     and (qual = 'true' or with_check = 'true');
  if v_blanket > 0 then
    raise exception 'Post-check failed: % blanket policy/policies on submissions update.', v_blanket;
  end if;

  -- No verdict-override path for Project Control / Planning or a global
  -- authority survives in either policy -- proves the branch is genuinely
  -- gone from the live policy text, not merely absent from this file.
  select count(*) into v_override
    from pg_policies
   where schemaname = 'public'
     and tablename in ('weekly_submissions', 'monthly_submissions')
     and policyname in ('weekly_submissions_update', 'monthly_submissions_update')
     and (
       qual like '%can_manage_project_operations%'
       or with_check like '%can_manage_project_operations%'
     );
  if v_override > 0 then
    raise exception 'Post-check failed: % submissions-update policy/policies still reference can_manage_project_operations() -- a verdict override survived.', v_override;
  end if;

  -- Sanity on the allowlist itself, so a typo cannot pass silently -- same
  -- style as report_transition_allowed()'s own post-check.
  if not public.report_preparation_transition('weekly', 'draft', 'collecting')
     or not public.report_preparation_transition('weekly', 'collecting', 'under_review')
     or not public.report_preparation_transition('weekly', 'returned', 'collecting')
     or public.report_preparation_transition('weekly', 'under_review', 'approved')
     or public.report_preparation_transition('weekly', 'approved', 'finalized')
     or public.report_preparation_transition('weekly', 'finalized', 'locked')
     or public.report_preparation_transition('weekly', 'draft', 'archived')
     or not public.report_preparation_transition('monthly', 'draft', 'auto_compiled')
     or not public.report_preparation_transition('monthly', 'auto_compiled', 'department_review')
     or not public.report_preparation_transition('monthly', 'department_review', 'under_review')
     or not public.report_preparation_transition('monthly', 'returned', 'department_review')
     or public.report_preparation_transition('monthly', 'under_review', 'approved')
     or public.report_preparation_transition('monthly', 'department_review', 'returned')
     or public.report_preparation_transition('monthly', 'approved', 'finalized') then
    raise exception 'Post-check failed: report_preparation_transition() does not behave as specified.';
  end if;

  raise notice 'Phase A2 applied: preparation allowlist installed, whole-report lifecycle authority narrowed (authority checked before the same-status no-op), department-verdict branch on both submissions tables admits only is_weekly_department_manager() for that exact department -- no Coordinator, Planning, or global-authority override.';
end;
$post$;

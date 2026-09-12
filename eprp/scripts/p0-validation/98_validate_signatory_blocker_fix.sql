-- EPRP — targeted validation for the weekly_transition_blockers() signatory
-- regression fix (supabase/migrations/20260912000001_weekly_signatory_blocker_
-- regression_fix.sql).
--
-- WHAT THIS PROVES
--   Reviewer/approver "recorded" is satisfied by EITHER the legacy
--   contact-id column OR the signatories JSONB snapshot, independently of
--   each other; either alone is sufficient. Missing reviewer/approver still
--   blocks exactly where the lifecycle requires it. Department completeness
--   counting (20260906000003_weekly_department_manager_approval.sql) is
--   exercised and confirmed unchanged.
--
--   This calls public.weekly_transition_blockers() directly — it is a pure,
--   stable, no-side-effect function, so calling it as the owning role is
--   sufficient to test its logic. Authority to actually PERFORM a transition
--   (set_weekly_report_status()) is already covered by 05_validate_p03.sql;
--   this script is scoped to the blocker function alone, per the fix's scope.
--
-- HOW TO RUN
--   Requires 01_setup_test_fixtures.sql to have been run first (same fixture
--   project/department/contact 05_validate_p03.sql uses).
--
--   psql "<pooler connection string>" -f 98_validate_signatory_blocker_fix.sql
--
-- Runs inside a transaction that is ROLLED BACK. Creates its own disposable
-- Weekly on the ZZ-P0TEST fixture project and touches nothing else.

\set ON_ERROR_STOP on

begin;

do $val$
declare
  v_project  uuid;
  v_dept     uuid;
  v_contact  uuid;
  v_report   uuid;
  v_blockers text[];
  v_fail     integer := 0;
  t1 boolean; t2 boolean; t3 boolean; t4 boolean;
  t5 boolean; t6 boolean; t7a boolean; t7b boolean; t8 boolean;
begin
  select id into v_project from public.projects where code = 'ZZ-P0TEST-PRJ';
  if v_project is null then
    raise exception 'Fixtures missing. Run 01_setup_test_fixtures.sql first.';
  end if;
  select id into v_dept from public.departments where code = 'ZZ-P0TEST-DEPT';
  select id into v_contact from public.contacts where name = 'ZZ-P0TEST Member';
  if v_dept is null or v_contact is null then
    raise exception 'Fixtures incomplete (department or contact missing). Run 01_setup_test_fixtures.sql first.';
  end if;

  insert into public.weekly_reports
    (report_number, project_id, status, week_number, period_start, period_end)
  values ('ZZ-P0TEST-SIG01', v_project, 'collecting', 1,
          current_date, current_date + 6)
  returning id into v_report;

  insert into public.weekly_submissions
    (weekly_report_id, department_id, status)
  values (v_report, v_dept, 'in_progress');

  /* ===================== T7a. Outstanding department blocks =============== */
  -- Department not yet approved: the department-completeness message must
  -- appear for under_review (and, by the same branch, approved/finalized/
  -- locked), regardless of reviewer/approver state.
  v_blockers := public.weekly_transition_blockers(v_report, 'under_review');
  t7a := exists (
    select 1 from unnest(v_blockers) b
     where b like '%department%approved by its Department Manager%');

  -- Approve the department's canonical row. Direct owner-role write: fixture
  -- setup, not the behaviour under test (RLS/authority is 05_validate_p03's
  -- scope, not this script's).
  update public.weekly_submissions set status = 'approved'
   where weekly_report_id = v_report and department_id = v_dept;

  /* ===================== T7b. Resolving it clears the block ================ */
  v_blockers := public.weekly_transition_blockers(v_report, 'under_review');
  t7b := coalesce(array_length(v_blockers, 1), 0) = 0;

  /* ===================== T5. Missing reviewer blocks 'approved' ============ */
  v_blockers := public.weekly_transition_blockers(v_report, 'approved');
  t5 := exists (select 1 from unnest(v_blockers) b where b = 'No reviewer recorded.');

  /* ============= T1. Reviewer via LEGACY COLUMN only satisfies it ========== */
  update public.weekly_reports set reviewed_by_contact_id = v_contact
   where id = v_report;
  v_blockers := public.weekly_transition_blockers(v_report, 'approved');
  t1 := not exists (select 1 from unnest(v_blockers) b where b = 'No reviewer recorded.');
  update public.weekly_reports set reviewed_by_contact_id = null
   where id = v_report;

  /* ============== T3. Reviewer via SIGNATORIES JSONB only satisfies it ===== */
  update public.weekly_reports
     set signatories = jsonb_set(signatories, '{reviewed}',
           '[{"name":"ZZ-P0TEST Reviewer","title":"Test Reviewer","contactId":null}]'::jsonb)
   where id = v_report;
  v_blockers := public.weekly_transition_blockers(v_report, 'approved');
  t3 := not exists (select 1 from unnest(v_blockers) b where b = 'No reviewer recorded.');

  /* ===================== T6. Missing approver blocks 'finalized' =========== */
  v_blockers := public.weekly_transition_blockers(v_report, 'finalized');
  t6 := exists (select 1 from unnest(v_blockers) b where b = 'No approver recorded.');

  /* ============= T2. Approver via LEGACY COLUMN only satisfies it ========== */
  update public.weekly_reports set approved_by_contact_id = v_contact
   where id = v_report;
  v_blockers := public.weekly_transition_blockers(v_report, 'finalized');
  t2 := not exists (select 1 from unnest(v_blockers) b where b = 'No approver recorded.');
  update public.weekly_reports set approved_by_contact_id = null
   where id = v_report;

  /* ============== T4. Approver via SIGNATORIES JSONB only satisfies it ===== */
  update public.weekly_reports
     set signatories = jsonb_set(signatories, '{approved}',
           '[{"name":"ZZ-P0TEST Approver","title":"Test Approver","contactId":null}]'::jsonb)
   where id = v_report;
  v_blockers := public.weekly_transition_blockers(v_report, 'finalized');
  t4 := not exists (select 1 from unnest(v_blockers) b where b = 'No approver recorded.');

  /* ===================== T8. Fully satisfied case passes ==================== */
  -- Department approved (T7b setup), reviewer in signatories (T3 setup),
  -- approver in signatories (T4 setup), both legacy columns null. 'locked' is
  -- the strictest target status: no blocker of any kind should remain.
  v_blockers := public.weekly_transition_blockers(v_report, 'locked');
  t8 := coalesce(array_length(v_blockers, 1), 0) = 0;

  /* ================================ Report =================================== */

  raise notice '--- department completeness (unchanged from 20260906000003) ---';
  if t7a then raise notice 'PASS  T7a under_review blocked while the department is unapproved';
  else raise notice 'FAIL  T7a department-completeness gate did not fire'; v_fail := v_fail + 1; end if;

  if t7b then raise notice 'PASS  T7b under_review clears once the department is approved';
  else raise notice 'FAIL  T7b department approval did not lift the block'; v_fail := v_fail + 1; end if;

  raise notice '--- missing evidence still blocks ---';
  if t5 then raise notice 'PASS  T5 approved refused with no reviewer recorded (neither column nor signatories)';
  else raise notice 'FAIL  T5 missing-reviewer block did not fire'; v_fail := v_fail + 1; end if;

  if t6 then raise notice 'PASS  T6 finalized refused with no approver recorded (neither column nor signatories)';
  else raise notice 'FAIL  T6 missing-approver block did not fire'; v_fail := v_fail + 1; end if;

  raise notice '--- either evidence shape alone is sufficient (the regression) ---';
  if t1 then raise notice 'PASS  T1 reviewed_by_contact_id alone satisfies the reviewer check';
  else raise notice 'FAIL  T1 legacy reviewer column alone was not accepted'; v_fail := v_fail + 1; end if;

  if t2 then raise notice 'PASS  T2 approved_by_contact_id alone satisfies the approver check';
  else raise notice 'FAIL  T2 legacy approver column alone was not accepted'; v_fail := v_fail + 1; end if;

  if t3 then raise notice 'PASS  T3 signatories.reviewed alone satisfies the reviewer check (the regression, now fixed)';
  else raise notice 'FAIL  T3 signatories-only reviewer was NOT accepted -- regression still present'; v_fail := v_fail + 1; end if;

  if t4 then raise notice 'PASS  T4 signatories.approved alone satisfies the approver check (the regression, now fixed)';
  else raise notice 'FAIL  T4 signatories-only approver was NOT accepted -- regression still present'; v_fail := v_fail + 1; end if;

  raise notice '--- fully satisfied case ---';
  if t8 then raise notice 'PASS  T8 locked has zero blockers once department + both signatories are recorded';
  else raise notice 'FAIL  T8 a legitimate, fully satisfied report was still blocked'; v_fail := v_fail + 1; end if;

  raise notice '---';
  if v_fail = 0 then
    raise notice 'SIGNATORY BLOCKER FIX VALIDATION: ALL 9 CHECKS PASSED';
  else
    raise notice 'SIGNATORY BLOCKER FIX VALIDATION: % CHECK(S) FAILED - DO NOT ACCEPT', v_fail;
  end if;
end;
$val$;

rollback;

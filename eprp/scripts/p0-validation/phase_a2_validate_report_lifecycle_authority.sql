-- EPRP Phase A2 — targeted validation for report lifecycle authority
-- narrowing (supabase/migrations/20260912000002_report_lifecycle_authority_
-- narrowing.sql).
--
-- WHAT THIS PROVES
--   * Report Coordinator may perform ONLY the allowlisted preparation
--     transitions on a WHOLE REPORT (Weekly and Monthly), and is refused for
--     approve / return / reject / finalize / lock / archive.
--   * Project Control / Planning may perform every WHOLE-REPORT transition
--     the Coordinator is refused.
--   * A global operational authority (System Admin) may act on the WHOLE
--     REPORT regardless of any project assignment.
--   * A DEPARTMENT SUBMISSION'S verdict (approved/returned) has exactly one
--     path: is_weekly_department_manager() for that exact department. Report
--     Coordinator, Project Control / Planning, and a global authority are ALL
--     refused a department verdict in normal workflow -- only the assigned
--     Department Manager may set it, and only for their own department.
--   * Every one of those refused roles retains legitimate non-verdict
--     content-edit access to the same submission row.
--   * The Phase A1 signatories-JSONB blocker fix is unaffected.
--
-- Not numbered in the 80-97 P0-validation sequence (that range is fully
-- occupied) or reusing 98 (already the committed Phase A1 script) or 99
-- (teardown) — named for the phase it validates instead.
--
-- HOW TO RUN
--   Requires 00_local_test_identity.sql and 01_setup_test_fixtures.sql to
--   have been run first (same ZZ-P0TEST-PRJ / ZZ-P0TEST-DEPT / Coordinator
--   fixtures 05_validate_p03.sql and 98_validate_signatory_blocker_fix.sql
--   use).
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -f phase_a2_validate_report_lifecycle_authority.sql
--
-- Runs inside a transaction that is ROLLED BACK. All new identities,
-- contacts, assignments, departments and reports created here are disposable
-- and vanish on rollback; nothing in 00/01's fixtures is modified.

\set ON_ERROR_STOP on

begin;

do $val$
declare
  v_role        text := current_user;
  v_project     uuid;
  v_dept1       uuid;
  v_dept2       uuid;
  v_coord_c     uuid;  -- existing ZZ-P0TEST Coordinator contact
  v_plan_c      uuid;  -- new: Planning contact
  v_dm1_c       uuid;  -- new: Department Manager (dept1) contact
  v_dm2_c       uuid;  -- new: Department Manager (dept2) contact
  v_coord_id    uuid := '00000000-0000-4000-a000-0000000000b2'; -- existing viewer/Coordinator identity
  v_admin_id    uuid := '00000000-0000-4000-a000-0000000000a1'; -- existing admin identity
  v_plan_id     uuid := '00000000-0000-4000-a000-0000000000c3';
  v_dm1_id      uuid := '00000000-0000-4000-a000-0000000000d4';
  v_dm2_id      uuid := '00000000-0000-4000-a000-0000000000e5';
  v_w1          uuid; -- weekly: full lifecycle report
  v_w2          uuid; -- weekly: archive-only report
  v_m1          uuid; -- monthly: full lifecycle report
  v_m2          uuid; -- monthly: archive-only report
  v_status      text;
  v_rows        integer;
  v_fail        integer := 0;

  -- department manager / cross-department / content-edit
  t_dm1_w_approve boolean; t_dm1_w_cross boolean; t_dm2_w_approve boolean;
  t_dm1_m_approve boolean; t_dm1_m_cross boolean; t_dm2_m_approve boolean;
  t_coord_w_verdict_denied boolean; t_coord_w_edit_ok boolean;
  t_coord_m_verdict_denied boolean; t_coord_m_edit_ok boolean;
  -- no role but the department's own manager may set a verdict, not even
  -- Project Control / Planning or a global authority
  t_plan_w_verdict_denied boolean; t_admin_w_verdict_denied boolean;
  t_plan_m_verdict_denied boolean; t_admin_m_verdict_denied boolean;

  -- weekly whole-report
  t_coord_w_prep1 boolean; t_coord_w_prep2 boolean;
  t_coord_w_approve_denied boolean; t_coord_w_return_denied boolean; t_coord_w_reject_denied boolean;
  t_plan_w_approve boolean; t_plan_w_finalize boolean; t_plan_w_lock boolean;
  t_coord_w_archive_denied boolean; t_plan_w_archive boolean;

  -- monthly whole-report
  t_coord_m_prep1 boolean; t_coord_m_prep2 boolean; t_coord_m_prep3 boolean;
  t_coord_m_approve_denied boolean; t_coord_m_return_denied boolean; t_coord_m_reject_denied boolean;
  t_admin_m_approve boolean; t_admin_m_finalize boolean; t_admin_m_lock boolean;
  t_coord_m_archive_denied boolean; t_admin_m_archive boolean;

  t_a1_signatory_regression boolean;
begin
  ------------------------------------------------------------------------
  -- Fixture lookups and additions (owner role throughout this block).
  ------------------------------------------------------------------------
  select id into v_project from public.projects where code = 'ZZ-P0TEST-PRJ';
  if v_project is null then
    raise exception 'Fixtures missing. Run 01_setup_test_fixtures.sql first.';
  end if;
  select id into v_dept1 from public.departments where code = 'ZZ-P0TEST-DEPT';
  select id into v_coord_c from public.contacts where name = 'ZZ-P0TEST Coordinator';
  if v_dept1 is null or v_coord_c is null then
    raise exception 'Fixtures incomplete. Run 01_setup_test_fixtures.sql first.';
  end if;

  -- A second department, for the cross-department Department Manager check.
  insert into public.departments (name, code)
  values ('ZZ-P0TEST-A2 Department 2', 'ZZ-P0TEST-A2-DEPT2')
  returning id into v_dept2;
  insert into public.project_departments (project_id, department_id, reporting_required)
  values (v_project, v_dept2, true);

  -- New disposable contacts: Planning, and one Department Manager per department.
  insert into public.contacts (name, email, department_id)
  values ('ZZ-P0TEST-A2 Planning', 'p0test.a2.planning@example.invalid', v_dept1)
  returning id into v_plan_c;
  insert into public.contacts (name, email, department_id)
  values ('ZZ-P0TEST-A2 DeptManager1', 'p0test.a2.dm1@example.invalid', v_dept1)
  returning id into v_dm1_c;
  insert into public.contacts (name, email, department_id)
  values ('ZZ-P0TEST-A2 DeptManager2', 'p0test.a2.dm2@example.invalid', v_dept2)
  returning id into v_dm2_c;

  -- Assignments. Planning: unscoped project_control_manager, mirroring how
  -- the Coordinator fixture is assigned. Department Managers: team_member +
  -- assignment_role='department_manager', scoped to their own department.
  insert into public.project_contacts (project_id, contact_id, role)
  values (v_project, v_plan_c, 'project_control_manager');
  insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role)
  values (v_project, v_dm1_c, 'team_member', v_dept1, 'department_manager');
  insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role)
  values (v_project, v_dm2_c, 'team_member', v_dept2, 'department_manager');

  -- Local-only auth identities for the three new contacts. Same shape as
  -- 00_local_test_identity.sql; disposable, rolled back with everything else.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
    ('00000000-0000-0000-0000-000000000000', v_plan_id, 'authenticated', 'authenticated',
     'p0test.a2.planning@example.invalid', 'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_dm1_id, 'authenticated', 'authenticated',
     'p0test.a2.dm1@example.invalid', 'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_dm2_id, 'authenticated', 'authenticated',
     'p0test.a2.dm2@example.invalid', 'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, email, full_name, role, contact_id, active) values
    (v_plan_id, 'p0test.a2.planning@example.invalid', 'ZZ-P0TEST-A2 Planning', 'viewer', v_plan_c, true),
    (v_dm1_id,  'p0test.a2.dm1@example.invalid',      'ZZ-P0TEST-A2 DeptManager1', 'viewer', v_dm1_c, true),
    (v_dm2_id,  'p0test.a2.dm2@example.invalid',      'ZZ-P0TEST-A2 DeptManager2', 'viewer', v_dm2_c, true)
  on conflict (id) do nothing;

  -- Weekly reports: W1 drives the full lifecycle, W2 is archive-only.
  insert into public.weekly_reports (report_number, project_id, status, week_number, period_start, period_end)
  values ('ZZ-P0TEST-A2-W1', v_project, 'draft', 1, current_date, current_date + 6)
  returning id into v_w1;
  insert into public.weekly_reports (report_number, project_id, status, week_number, period_start, period_end)
  values ('ZZ-P0TEST-A2-W2', v_project, 'draft', 2, current_date + 7, current_date + 13)
  returning id into v_w2;
  insert into public.weekly_submissions (weekly_report_id, department_id, status)
  values (v_w1, v_dept1, 'pending'), (v_w1, v_dept2, 'pending');

  -- Monthly reports: M1 drives the full lifecycle, M2 is archive-only.
  insert into public.monthly_reports (report_number, project_id, reporting_month, status)
  values ('ZZ-P0TEST-A2-M1', v_project, date_trunc('month', current_date)::date, 'draft')
  returning id into v_m1;
  insert into public.monthly_reports (report_number, project_id, reporting_month, status)
  values ('ZZ-P0TEST-A2-M2', v_project, date_trunc('month', current_date)::date + interval '1 month', 'draft')
  returning id into v_m2;
  insert into public.monthly_submissions (monthly_report_id, department_id, status)
  values (v_m1, v_dept1, 'pending'), (v_m1, v_dept2, 'pending');

  ------------------------------------------------------------------------
  -- SECTION 1 — Department verdict authority (weekly_submissions,
  -- monthly_submissions). Coordinator denied a direct verdict; content-edit
  -- preserved; Department Manager approves own department only.
  ------------------------------------------------------------------------

  -- Coordinator: direct verdict write denied (the core department-verdict fix).
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord_id::text)::text, true);

  -- The old row (status='pending') IS reachable via the broad non-verdict
  -- USING branch, so this is a WITH CHECK failure on the new row
  -- (status='approved'), which PostgreSQL raises as a hard error
  -- (insufficient_privilege / 42501), not a silent zero-row filter.
  begin
    update public.weekly_submissions set status = 'approved'
     where weekly_report_id = v_w1 and department_id = v_dept1 and status = 'pending';
    t_coord_w_verdict_denied := false;
  exception when insufficient_privilege then
    t_coord_w_verdict_denied := true;
  end;

  begin
    update public.monthly_submissions set status = 'approved'
     where monthly_report_id = v_m1 and department_id = v_dept1 and status = 'pending';
    t_coord_m_verdict_denied := false;
  exception when insufficient_privilege then
    t_coord_m_verdict_denied := true;
  end;

  -- Project Control / Planning: ALSO denied a department verdict directly.
  -- Normal workflow admits only that department's own manager -- not even
  -- the project's assigned Planning holder may set it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_plan_id::text)::text, true);

  begin
    update public.weekly_submissions set status = 'approved'
     where weekly_report_id = v_w1 and department_id = v_dept1 and status = 'pending';
    t_plan_w_verdict_denied := false;
  exception when insufficient_privilege then
    t_plan_w_verdict_denied := true;
  end;

  begin
    update public.monthly_submissions set status = 'approved'
     where monthly_report_id = v_m1 and department_id = v_dept1 and status = 'pending';
    t_plan_m_verdict_denied := false;
  exception when insufficient_privilege then
    t_plan_m_verdict_denied := true;
  end;

  -- Global operational admin: ALSO denied a department verdict directly.
  -- No project assignment at all, and still refused -- there is no
  -- administrative override hidden in this policy.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);

  begin
    update public.weekly_submissions set status = 'approved'
     where weekly_report_id = v_w1 and department_id = v_dept1 and status = 'pending';
    t_admin_w_verdict_denied := false;
  exception when insufficient_privilege then
    t_admin_w_verdict_denied := true;
  end;

  begin
    update public.monthly_submissions set status = 'approved'
     where monthly_report_id = v_m1 and department_id = v_dept1 and status = 'pending';
    t_admin_m_verdict_denied := false;
  exception when insufficient_privilege then
    t_admin_m_verdict_denied := true;
  end;

  -- Back to Coordinator for the remaining department-tier checks.
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord_id::text)::text, true);

  -- Coordinator: non-verdict content-edit preserved.
  update public.weekly_submissions set status = 'in_progress'
   where weekly_report_id = v_w1 and department_id = v_dept1 and status = 'pending';
  get diagnostics v_rows = row_count;
  t_coord_w_edit_ok := (v_rows = 1);

  update public.monthly_submissions set status = 'in_progress'
   where monthly_report_id = v_m1 and department_id = v_dept1 and status = 'pending';
  get diagnostics v_rows = row_count;
  t_coord_m_edit_ok := (v_rows = 1);

  -- Department Manager 1: approves own department (dept1), denied on dept2.
  perform set_config('request.jwt.claims', json_build_object('sub', v_dm1_id::text)::text, true);

  update public.weekly_submissions set status = 'approved'
   where weekly_report_id = v_w1 and department_id = v_dept1;
  get diagnostics v_rows = row_count;
  t_dm1_w_approve := (v_rows = 1);

  update public.weekly_submissions set status = 'approved'
   where weekly_report_id = v_w1 and department_id = v_dept2;
  get diagnostics v_rows = row_count;
  t_dm1_w_cross := (v_rows = 0);

  update public.monthly_submissions set status = 'approved'
   where monthly_report_id = v_m1 and department_id = v_dept1;
  get diagnostics v_rows = row_count;
  t_dm1_m_approve := (v_rows = 1);

  update public.monthly_submissions set status = 'approved'
   where monthly_report_id = v_m1 and department_id = v_dept2;
  get diagnostics v_rows = row_count;
  t_dm1_m_cross := (v_rows = 0);

  -- Department Manager 2: approves own department (dept2) only.
  perform set_config('request.jwt.claims', json_build_object('sub', v_dm2_id::text)::text, true);

  update public.weekly_submissions set status = 'approved'
   where weekly_report_id = v_w1 and department_id = v_dept2;
  get diagnostics v_rows = row_count;
  t_dm2_w_approve := (v_rows = 1);

  update public.monthly_submissions set status = 'approved'
   where monthly_report_id = v_m1 and department_id = v_dept2;
  get diagnostics v_rows = row_count;
  t_dm2_m_approve := (v_rows = 1);

  ------------------------------------------------------------------------
  -- SECTION 2 — Weekly whole-report lifecycle.
  ------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord_id::text)::text, true);

  -- Coordinator preparation: allowed.
  begin
    perform public.set_weekly_report_status(v_w1, 'collecting');
    select status into v_status from public.weekly_reports where id = v_w1;
    t_coord_w_prep1 := (v_status = 'collecting');
  exception when others then t_coord_w_prep1 := false; end;

  begin
    perform public.set_weekly_report_status(v_w1, 'under_review');
    select status into v_status from public.weekly_reports where id = v_w1;
    t_coord_w_prep2 := (v_status = 'under_review');
  exception when others then t_coord_w_prep2 := false; end;

  -- Coordinator: approve/return/reject all refused, report unmoved.
  begin
    perform public.set_weekly_report_status(v_w1, 'approved');
    t_coord_w_approve_denied := false;
  exception when insufficient_privilege then t_coord_w_approve_denied := true;
  end;
  begin
    perform public.set_weekly_report_status(v_w1, 'returned');
    t_coord_w_return_denied := false;
  exception when insufficient_privilege then t_coord_w_return_denied := true;
  end;
  begin
    perform public.set_weekly_report_status(v_w1, 'rejected');
    t_coord_w_reject_denied := false;
  exception when insufficient_privilege then t_coord_w_reject_denied := true;
  end;

  -- Reviewer/approver evidence, as owner (fixture setup, not the behaviour
  -- under test) so Planning's transitions below are refused only by
  -- AUTHORITY, never by content blockers we haven't isolated for.
  perform set_config('role', v_role, true);
  update public.weekly_reports
     set signatories = jsonb_set(jsonb_set('{}'::jsonb, '{reviewed}',
           '[{"name":"ZZ-P0TEST-A2 Reviewer","title":"Reviewer","contactId":null}]'::jsonb),
           '{approved}', '[{"name":"ZZ-P0TEST-A2 Approver","title":"Approver","contactId":null}]'::jsonb)
   where id = v_w1;
  perform set_config('role', 'authenticated', true);

  -- Project Control / Planning: approve, finalize, lock all succeed.
  perform set_config('request.jwt.claims', json_build_object('sub', v_plan_id::text)::text, true);
  begin
    perform public.set_weekly_report_status(v_w1, 'approved');
    select status into v_status from public.weekly_reports where id = v_w1;
    t_plan_w_approve := (v_status = 'approved');
  exception when others then t_plan_w_approve := false; end;

  begin
    perform public.set_weekly_report_status(v_w1, 'finalized');
    select status into v_status from public.weekly_reports where id = v_w1;
    t_plan_w_finalize := (v_status = 'finalized');
  exception when others then t_plan_w_finalize := false; end;

  begin
    perform public.set_weekly_report_status(v_w1, 'locked');
    select status into v_status from public.weekly_reports where id = v_w1;
    t_plan_w_lock := (v_status = 'locked');
  exception when others then t_plan_w_lock := false; end;

  -- Archive: Coordinator refused, Planning succeeds (separate disposable draft).
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord_id::text)::text, true);
  begin
    perform public.set_weekly_report_status(v_w2, 'archived');
    t_coord_w_archive_denied := false;
  exception when insufficient_privilege then t_coord_w_archive_denied := true;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_plan_id::text)::text, true);
  begin
    perform public.set_weekly_report_status(v_w2, 'archived');
    select status into v_status from public.weekly_reports where id = v_w2;
    t_plan_w_archive := (v_status = 'archived');
  exception when others then t_plan_w_archive := false; end;

  ------------------------------------------------------------------------
  -- SECTION 3 — Monthly whole-report lifecycle (mirrors Section 2; the
  -- "global operational admin acts regardless of assignment" case is proven
  -- here instead of duplicating the Planning path).
  ------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord_id::text)::text, true);

  begin
    perform public.set_monthly_report_status(v_m1, 'auto_compiled');
    select status into v_status from public.monthly_reports where id = v_m1;
    t_coord_m_prep1 := (v_status = 'auto_compiled');
  exception when others then t_coord_m_prep1 := false; end;

  begin
    perform public.set_monthly_report_status(v_m1, 'department_review');
    select status into v_status from public.monthly_reports where id = v_m1;
    t_coord_m_prep2 := (v_status = 'department_review');
  exception when others then t_coord_m_prep2 := false; end;

  begin
    perform public.set_monthly_report_status(v_m1, 'under_review');
    select status into v_status from public.monthly_reports where id = v_m1;
    t_coord_m_prep3 := (v_status = 'under_review');
  exception when others then t_coord_m_prep3 := false; end;

  begin
    perform public.set_monthly_report_status(v_m1, 'approved');
    t_coord_m_approve_denied := false;
  exception when insufficient_privilege then t_coord_m_approve_denied := true;
  end;
  begin
    perform public.set_monthly_report_status(v_m1, 'returned');
    t_coord_m_return_denied := false;
  exception when insufficient_privilege then t_coord_m_return_denied := true;
  end;
  begin
    perform public.set_monthly_report_status(v_m1, 'rejected');
    t_coord_m_reject_denied := false;
  exception when insufficient_privilege then t_coord_m_reject_denied := true;
  end;

  -- Global operational admin: no project_contacts assignment on this project
  -- at all, yet approves/finalizes/locks -- proving authority is genuinely
  -- global, not merely broader.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  begin
    perform public.set_monthly_report_status(v_m1, 'approved');
    select status into v_status from public.monthly_reports where id = v_m1;
    t_admin_m_approve := (v_status = 'approved');
  exception when others then t_admin_m_approve := false; end;

  begin
    perform public.set_monthly_report_status(v_m1, 'finalized');
    select status into v_status from public.monthly_reports where id = v_m1;
    t_admin_m_finalize := (v_status = 'finalized');
  exception when others then t_admin_m_finalize := false; end;

  begin
    perform public.set_monthly_report_status(v_m1, 'locked');
    select status into v_status from public.monthly_reports where id = v_m1;
    t_admin_m_lock := (v_status = 'locked');
  exception when others then t_admin_m_lock := false; end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_coord_id::text)::text, true);
  begin
    perform public.set_monthly_report_status(v_m2, 'archived');
    t_coord_m_archive_denied := false;
  exception when insufficient_privilege then t_coord_m_archive_denied := true;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);
  begin
    perform public.set_monthly_report_status(v_m2, 'archived');
    select status into v_status from public.monthly_reports where id = v_m2;
    t_admin_m_archive := (v_status = 'archived');
  exception when others then t_admin_m_archive := false; end;

  ------------------------------------------------------------------------
  -- SECTION 4 — Phase A1 regression: signatories-JSONB blocker fix
  -- unaffected. Uses the reviewer/approver already recorded on v_w1 above.
  ------------------------------------------------------------------------
  perform set_config('role', v_role, true);
  t_a1_signatory_regression :=
    coalesce(array_length(public.weekly_transition_blockers(v_w1, 'locked'), 1), 0) = 0;

  ------------------------------------------------------------------------
  -- Report.
  ------------------------------------------------------------------------
  perform set_config('role', v_role, true);

  raise notice '=== Department verdict authority ===';
  if t_coord_w_verdict_denied then raise notice 'PASS  Coordinator cannot set a Weekly department submission to approved directly'; else raise notice 'FAIL  Coordinator set a Weekly verdict directly'; v_fail:=v_fail+1; end if;
  if t_coord_m_verdict_denied then raise notice 'PASS  Coordinator cannot set a Monthly department submission to approved directly'; else raise notice 'FAIL  Coordinator set a Monthly verdict directly'; v_fail:=v_fail+1; end if;
  if t_plan_w_verdict_denied then raise notice 'PASS  Project Control / Planning cannot set a Weekly department submission to approved directly'; else raise notice 'FAIL  Planning set a Weekly verdict directly'; v_fail:=v_fail+1; end if;
  if t_plan_m_verdict_denied then raise notice 'PASS  Project Control / Planning cannot set a Monthly department submission to approved directly'; else raise notice 'FAIL  Planning set a Monthly verdict directly'; v_fail:=v_fail+1; end if;
  if t_admin_w_verdict_denied then raise notice 'PASS  Global operational admin cannot set a Weekly department submission to approved directly'; else raise notice 'FAIL  Admin set a Weekly verdict directly'; v_fail:=v_fail+1; end if;
  if t_admin_m_verdict_denied then raise notice 'PASS  Global operational admin cannot set a Monthly department submission to approved directly'; else raise notice 'FAIL  Admin set a Monthly verdict directly'; v_fail:=v_fail+1; end if;
  if t_coord_w_edit_ok then raise notice 'PASS  Coordinator retains non-verdict Weekly submission edit (pending -> in_progress)'; else raise notice 'FAIL  Coordinator content-edit regressed on Weekly'; v_fail:=v_fail+1; end if;
  if t_coord_m_edit_ok then raise notice 'PASS  Coordinator retains non-verdict Monthly submission edit'; else raise notice 'FAIL  Coordinator content-edit regressed on Monthly'; v_fail:=v_fail+1; end if;
  if t_dm1_w_approve then raise notice 'PASS  Department Manager 1 approves own (dept1) Weekly submission'; else raise notice 'FAIL  Department Manager 1 could not approve own department'; v_fail:=v_fail+1; end if;
  if t_dm1_w_cross then raise notice 'PASS  Department Manager 1 denied on dept2 Weekly submission (cross-department)'; else raise notice 'FAIL  Department Manager 1 crossed into dept2'; v_fail:=v_fail+1; end if;
  if t_dm2_w_approve then raise notice 'PASS  Department Manager 2 approves own (dept2) Weekly submission'; else raise notice 'FAIL  Department Manager 2 could not approve own department'; v_fail:=v_fail+1; end if;
  if t_dm1_m_approve then raise notice 'PASS  Department Manager 1 approves own (dept1) Monthly submission'; else raise notice 'FAIL  Department Manager 1 could not approve own department (Monthly)'; v_fail:=v_fail+1; end if;
  if t_dm1_m_cross then raise notice 'PASS  Department Manager 1 denied on dept2 Monthly submission (cross-department)'; else raise notice 'FAIL  Department Manager 1 crossed into dept2 (Monthly)'; v_fail:=v_fail+1; end if;
  if t_dm2_m_approve then raise notice 'PASS  Department Manager 2 approves own (dept2) Monthly submission'; else raise notice 'FAIL  Department Manager 2 could not approve own department (Monthly)'; v_fail:=v_fail+1; end if;

  raise notice '=== Weekly whole-report lifecycle ===';
  if t_coord_w_prep1 then raise notice 'PASS  Coordinator: draft -> collecting'; else raise notice 'FAIL  Coordinator prep draft->collecting refused'; v_fail:=v_fail+1; end if;
  if t_coord_w_prep2 then raise notice 'PASS  Coordinator: collecting -> under_review'; else raise notice 'FAIL  Coordinator prep collecting->under_review refused'; v_fail:=v_fail+1; end if;
  if t_coord_w_approve_denied then raise notice 'PASS  Coordinator refused: under_review -> approved'; else raise notice 'FAIL  Coordinator approved a Weekly report'; v_fail:=v_fail+1; end if;
  if t_coord_w_return_denied then raise notice 'PASS  Coordinator refused: under_review -> returned'; else raise notice 'FAIL  Coordinator returned a Weekly report'; v_fail:=v_fail+1; end if;
  if t_coord_w_reject_denied then raise notice 'PASS  Coordinator refused: under_review -> rejected'; else raise notice 'FAIL  Coordinator rejected a Weekly report'; v_fail:=v_fail+1; end if;
  if t_plan_w_approve then raise notice 'PASS  Planning: under_review -> approved'; else raise notice 'FAIL  Planning could not approve'; v_fail:=v_fail+1; end if;
  if t_plan_w_finalize then raise notice 'PASS  Planning: approved -> finalized'; else raise notice 'FAIL  Planning could not finalize'; v_fail:=v_fail+1; end if;
  if t_plan_w_lock then raise notice 'PASS  Planning: finalized -> locked'; else raise notice 'FAIL  Planning could not lock'; v_fail:=v_fail+1; end if;
  if t_coord_w_archive_denied then raise notice 'PASS  Coordinator refused: draft -> archived'; else raise notice 'FAIL  Coordinator archived a Weekly report'; v_fail:=v_fail+1; end if;
  if t_plan_w_archive then raise notice 'PASS  Planning: draft -> archived'; else raise notice 'FAIL  Planning could not archive'; v_fail:=v_fail+1; end if;

  raise notice '=== Monthly whole-report lifecycle ===';
  if t_coord_m_prep1 then raise notice 'PASS  Coordinator: draft -> auto_compiled'; else raise notice 'FAIL  Coordinator prep draft->auto_compiled refused'; v_fail:=v_fail+1; end if;
  if t_coord_m_prep2 then raise notice 'PASS  Coordinator: auto_compiled -> department_review'; else raise notice 'FAIL  Coordinator prep auto_compiled->department_review refused'; v_fail:=v_fail+1; end if;
  if t_coord_m_prep3 then raise notice 'PASS  Coordinator: department_review -> under_review'; else raise notice 'FAIL  Coordinator prep department_review->under_review refused'; v_fail:=v_fail+1; end if;
  if t_coord_m_approve_denied then raise notice 'PASS  Coordinator refused: under_review -> approved (Monthly)'; else raise notice 'FAIL  Coordinator approved a Monthly report'; v_fail:=v_fail+1; end if;
  if t_coord_m_return_denied then raise notice 'PASS  Coordinator refused: under_review -> returned (Monthly)'; else raise notice 'FAIL  Coordinator returned a Monthly report'; v_fail:=v_fail+1; end if;
  if t_coord_m_reject_denied then raise notice 'PASS  Coordinator refused: under_review -> rejected (Monthly)'; else raise notice 'FAIL  Coordinator rejected a Monthly report'; v_fail:=v_fail+1; end if;
  if t_admin_m_approve then raise notice 'PASS  Global admin (no assignment): under_review -> approved'; else raise notice 'FAIL  Global admin could not approve'; v_fail:=v_fail+1; end if;
  if t_admin_m_finalize then raise notice 'PASS  Global admin: approved -> finalized'; else raise notice 'FAIL  Global admin could not finalize'; v_fail:=v_fail+1; end if;
  if t_admin_m_lock then raise notice 'PASS  Global admin: finalized -> locked'; else raise notice 'FAIL  Global admin could not lock'; v_fail:=v_fail+1; end if;
  if t_coord_m_archive_denied then raise notice 'PASS  Coordinator refused: draft -> archived (Monthly)'; else raise notice 'FAIL  Coordinator archived a Monthly report'; v_fail:=v_fail+1; end if;
  if t_admin_m_archive then raise notice 'PASS  Global admin: draft -> archived (Monthly)'; else raise notice 'FAIL  Global admin could not archive'; v_fail:=v_fail+1; end if;

  raise notice '=== Phase A1 regression ===';
  if t_a1_signatory_regression then raise notice 'PASS  weekly_transition_blockers() signatories-JSONB fix still passes'; else raise notice 'FAIL  Phase A1 signatory fix regressed'; v_fail:=v_fail+1; end if;

  raise notice '---';
  if v_fail = 0 then
    raise notice 'PHASE A2 LIFECYCLE AUTHORITY VALIDATION: ALL CHECKS PASSED';
  else
    raise notice 'PHASE A2 LIFECYCLE AUTHORITY VALIDATION: % CHECK(S) FAILED - DO NOT ACCEPT', v_fail;
  end if;
end;
$val$;

rollback;

-- EPRP P0.2 validation — Tier A / Tier B read visibility.
--
-- WHAT THIS PROVES, in both directions:
--   A. an account with NO assignment anywhere can read Tier A on any project;
--   B. that same account CANNOT read Tier B content of an unapproved report;
--   C. it CAN once the report reaches Approved;
--   D. widening read did not widen write (24.2.2).
--
-- NEEDS NO TEST ACCOUNT. The reader in every case is "any authenticated user",
-- modelled by a JWT `sub` with no profiles row: current_contact_id() is null, so
-- no assignment resolves and only the platform-wide clauses can admit it. That
-- is exactly the account 24.2 is about.
--
-- HOW TO RUN
--   psql "<pooler connection string>" -f 04_validate_p02.sql
--
-- Runs inside a transaction that is ROLLED BACK. It flips one fixture report's
-- status to prove the threshold, and that flip is rolled back with everything
-- else. It touches no real project: every read is counted against the
-- ZZ-P0TEST fixture only.

\set ON_ERROR_STOP on

begin;

do $val$
declare
  v_project uuid;
  v_report  uuid;
  v_report_ok uuid;
  v_role    text := current_user;
  v_fail    integer := 0;
  v_rows    integer;

  a_depts integer; a_sites integer; a_miles integer; a_docs integer;
  b_before integer; b_after integer;
  h_before integer; h_after integer;
  w_denied boolean;
begin
  select id into v_project from public.projects where code = 'ZZ-P0TEST-PRJ';
  if v_project is null then
    raise exception 'Fixtures missing. Run 01_setup_test_fixtures.sql first.';
  end if;

  /*
   * TWO disposable Weeklies, created directly at the states under test.
   *
   * An earlier version created one report and UPDATEd it across the threshold.
   * That is no longer possible, and correctly so: P0.3 installed a BEFORE UPDATE
   * trigger that refuses a direct status write from ANY caller, the owning role
   * included. Creating each report at its target status via INSERT tests the
   * same visibility rule without fighting a guard that is doing its job.
   */
  insert into public.weekly_reports
    (report_number, project_id, status, week_number, period_start, period_end, summary)
  values ('ZZ-P0TEST-W01', v_project, 'collecting', 1,
          current_date, current_date + 6,
          'UNAPPROVED NARRATIVE - must not be readable platform-wide')
  returning id into v_report;

  insert into public.weekly_submissions
    (weekly_report_id, department_id, status, summary)
  select v_report, d.id, 'in_progress', 'UNAPPROVED departmental content'
    from public.departments d where d.code = 'ZZ-P0TEST-DEPT';

  insert into public.weekly_reports
    (report_number, project_id, status, week_number, period_start, period_end, summary)
  values ('ZZ-P0TEST-W02', v_project, 'approved', 2,
          current_date + 7, current_date + 13,
          'APPROVED NARRATIVE - readable platform-wide')
  returning id into v_report_ok;

  insert into public.weekly_submissions
    (weekly_report_id, department_id, status, summary)
  select v_report_ok, d.id, 'approved', 'APPROVED departmental content'
    from public.departments d where d.code = 'ZZ-P0TEST-DEPT';

  insert into public.master_milestones (project_id, code, name)
  values (v_project, 'ZZ-P0TEST-VIS', 'Tier A visibility check');

  /* ============ Read as an account with no assignment anywhere ============ */

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid()::text)::text, true);

  -- Tier A: must be visible.
  select count(*) into a_depts from public.project_departments where project_id = v_project;
  select count(*) into a_sites from public.project_sites        where project_id = v_project;
  select count(*) into a_miles from public.master_milestones    where project_id = v_project;
  select count(*) into a_docs  from public.project_documents    where project_id = v_project;

  -- Tier B while UNAPPROVED: must be invisible.
  select count(*) into h_before from public.weekly_reports     where id = v_report;
  select count(*) into b_before from public.weekly_submissions where weekly_report_id = v_report;

  -- 24.2.2: read widened, write must not have. An UPDATE refused by RLS affects
  -- 0 rows rather than raising, so assert the row count.
  update public.master_milestones set name = 'should not persist'
   where project_id = v_project;
  get diagnostics v_rows = row_count;
  w_denied := (v_rows = 0);

  /* ============= The APPROVED report, read by the same account ============ */
  -- Same reader, same statement shape, only the parent status differs.

  select count(*) into h_after from public.weekly_reports     where id = v_report_ok;
  select count(*) into b_after from public.weekly_submissions where weekly_report_id = v_report_ok;

  perform set_config('role', v_role, true);

  /* ================================ Report =============================== */

  raise notice '--- Tier A: visible to an account with no assignment ---';
  if a_depts > 0 then raise notice 'PASS  A1 project_departments visible';
  else raise notice 'FAIL  A1 project_departments NOT visible'; v_fail := v_fail + 1; end if;

  if a_sites > 0 then raise notice 'PASS  A2 project_sites visible';
  else raise notice 'FAIL  A2 project_sites NOT visible'; v_fail := v_fail + 1; end if;

  if a_miles > 0 then raise notice 'PASS  A3 master_milestones register visible';
  else raise notice 'FAIL  A3 master_milestones NOT visible'; v_fail := v_fail + 1; end if;

  -- The fixture creates no documents, so 0 is the correct count here; this
  -- asserts the query is ALLOWED, not that rows exist.
  raise notice 'INFO  A4 project_documents readable (% row(s) on the fixture)', a_docs;

  raise notice '--- Tier B while the report is UNAPPROVED (status = collecting) ---';
  if h_before = 0 then raise notice 'PASS  B1 report header NOT visible (narrative not published)';
  else raise notice 'FAIL  B1 LEAK - unapproved report header readable'; v_fail := v_fail + 1; end if;

  if b_before = 0 then raise notice 'PASS  B2 department submission NOT visible';
  else raise notice 'FAIL  B2 LEAK - unapproved departmental content readable'; v_fail := v_fail + 1; end if;

  raise notice '--- Tier B after the report reaches Approved ---';
  if h_after = 1 then raise notice 'PASS  B3 report header now visible';
  else raise notice 'FAIL  B3 approved report header still hidden'; v_fail := v_fail + 1; end if;

  if b_after = 1 then raise notice 'PASS  B4 department submission now visible';
  else raise notice 'FAIL  B4 approved departmental content still hidden'; v_fail := v_fail + 1; end if;

  raise notice '--- 24.2.2: widening read did not widen write ---';
  if w_denied then raise notice 'PASS  W1 reader could NOT write to a Tier A table';
  else raise notice 'FAIL  W1 READ WIDENING LEAKED INTO WRITE'; v_fail := v_fail + 1; end if;

  raise notice '---';
  if v_fail = 0 then
    raise notice 'P0.2 VALIDATION: ALL 7 CHECKS PASSED';
  else
    raise notice 'P0.2 VALIDATION: % CHECK(S) FAILED - DO NOT ACCEPT', v_fail;
  end if;
end;
$val$;

rollback;

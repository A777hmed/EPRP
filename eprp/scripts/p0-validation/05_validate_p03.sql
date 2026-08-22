-- EPRP P0.3 validation — server-side Weekly / Monthly lifecycle enforcement.
--
-- WHAT THIS PROVES
--   The bypass is closed: a direct PATCH of `status` is refused whoever sends
--   it, the transition shape is enforced, the stage conditions are enforced, and
--   authority is checked before any of it.
--
-- NEEDS NO TEST ACCOUNT for the negative cases: the bypass attempt is made as an
-- authenticated account with no authority, modelled by a JWT `sub` with no
-- profiles row. The positive path is exercised as the owning role.
--
-- HOW TO RUN
--   psql "<pooler connection string>" -f 05_validate_p03.sql
--
-- Runs inside a transaction that is ROLLED BACK. It creates its own disposable
-- Weekly on the ZZ-P0TEST fixture project and touches nothing else.

\set ON_ERROR_STOP on

begin;

do $val$
declare
  v_project uuid;
  v_dept    uuid;
  v_contact uuid;
  v_report  uuid;
  v_role    text := current_user;
  -- The local admin identity from 00_local_test_identity.sql. The POSITIVE path
  -- must be driven by a caller the database recognises as Project Control: the
  -- owning role has no JWT, so is_system_admin() is false for it and the
  -- controlled function refuses it -- correctly.
  v_admin   uuid := '00000000-0000-4000-a000-0000000000a1';
  v_fail    integer := 0;
  v_status  text;
  g1 boolean; g2 boolean; g3 boolean; g4 boolean;
  g5 boolean; g6 boolean; g7 boolean; g8 boolean;
begin
  select id into v_project from public.projects where code = 'ZZ-P0TEST-PRJ';
  if v_project is null then
    raise exception 'Fixtures missing. Run 01_setup_test_fixtures.sql first.';
  end if;
  select id into v_dept from public.departments where code = 'ZZ-P0TEST-DEPT';
  select id into v_contact from public.contacts where name = 'ZZ-P0TEST Member';

  insert into public.weekly_reports
    (report_number, project_id, status, week_number, period_start, period_end)
  values ('ZZ-P0TEST-W03', v_project, 'collecting', 3,
          current_date, current_date + 6)
  returning id into v_report;

  insert into public.weekly_submissions
    (weekly_report_id, department_id, status)
  values (v_report, v_dept, 'in_progress');

  /* =========== 1. Direct status write is refused, for everyone =========== */

  -- As the OWNING role. RLS does not apply to the owner, so if the guard were
  -- policy-based this would silently succeed. It is a trigger, so it must not.
  begin
    update public.weekly_reports set status = 'finalized' where id = v_report;
    g1 := false;
  exception when insufficient_privilege then
    g1 := true;
  end;

  -- As an authenticated account with no authority: the original bypass.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid()::text)::text, true);

  begin
    update public.weekly_reports set status = 'finalized' where id = v_report;
    -- RLS may refuse the row before the trigger fires; either outcome is a pass,
    -- so long as the status did not change.
    g2 := not exists (
      select 1 from public.weekly_reports where id = v_report and status = 'finalized');
  exception when insufficient_privilege then
    g2 := true;
  end;

  /* ============= 2. The controlled function checks authority ============= */

  begin
    perform public.set_weekly_report_status(v_report, 'under_review');
    g3 := false;
  exception
    when insufficient_privilege then g3 := true;
    when others then g3 := false;
  end;

  /* ================ 3. Transition shape and stage conditions ============= */
  -- Still the `authenticated` role, now carrying the ADMIN identity.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text)::text, true);

  -- Illegal shape: collecting -> locked is not in the table.
  begin
    perform public.set_weekly_report_status(v_report, 'locked');
    g4 := false;
  exception when check_violation then
    g4 := true;
  end;

  -- Legal shape, unmet condition: one submission still in_progress.
  begin
    perform public.set_weekly_report_status(v_report, 'under_review');
    g5 := false;
  exception when check_violation then
    g5 := true;
  end;

  -- Approve the submission; under_review now has its condition met.
  -- Done as the owning role: this is fixture setup, not the behaviour under test.
  perform set_config('role', v_role, true);
  update public.weekly_submissions set status = 'approved'
   where weekly_report_id = v_report;
  perform set_config('role', 'authenticated', true);

  begin
    perform public.set_weekly_report_status(v_report, 'under_review');
    select status into v_status from public.weekly_reports where id = v_report;
    g6 := (v_status = 'under_review');
  exception when others then
    g6 := false;
  end;

  -- approved still needs a reviewer recorded.
  begin
    perform public.set_weekly_report_status(v_report, 'approved');
    g7 := false;
  exception when check_violation then
    g7 := true;
  end;

  -- Record one, and it goes through.
  perform set_config('role', v_role, true);
  update public.weekly_reports set reviewed_by_contact_id = v_contact
   where id = v_report;
  perform set_config('role', 'authenticated', true);

  begin
    perform public.set_weekly_report_status(v_report, 'approved');
    select status into v_status from public.weekly_reports where id = v_report;
    g8 := (v_status = 'approved');
  exception when others then
    g8 := false;
  end;

  /* ================================ Report =============================== */

  raise notice '--- the bypass ---';
  if g1 then raise notice 'PASS  G1 direct status UPDATE refused even for the table owner';
  else raise notice 'FAIL  G1 BYPASS OPEN - direct status write succeeded'; v_fail := v_fail + 1; end if;

  if g2 then raise notice 'PASS  G2 direct status UPDATE did not take effect for an unauthorised account';
  else raise notice 'FAIL  G2 BYPASS OPEN - unauthorised account changed status'; v_fail := v_fail + 1; end if;

  raise notice '--- authority ---';
  if g3 then raise notice 'PASS  G3 controlled function refused an account with no authority';
  else raise notice 'FAIL  G3 authority check did not fire'; v_fail := v_fail + 1; end if;

  raise notice '--- transition shape ---';
  if g4 then raise notice 'PASS  G4 collecting -> locked refused as an illegal transition';
  else raise notice 'FAIL  G4 illegal transition allowed'; v_fail := v_fail + 1; end if;

  raise notice '--- stage conditions ---';
  if g5 then raise notice 'PASS  G5 under_review refused while a submission is unapproved';
  else raise notice 'FAIL  G5 stage condition not enforced'; v_fail := v_fail + 1; end if;

  if g6 then raise notice 'PASS  G6 under_review ALLOWED once every submission is approved';
  else raise notice 'FAIL  G6 legitimate transition refused - the condition may be unsatisfiable'; v_fail := v_fail + 1; end if;

  if g7 then raise notice 'PASS  G7 approved refused with no reviewer recorded';
  else raise notice 'FAIL  G7 reviewer condition not enforced'; v_fail := v_fail + 1; end if;

  if g8 then raise notice 'PASS  G8 approved ALLOWED once a reviewer is recorded';
  else raise notice 'FAIL  G8 legitimate transition refused'; v_fail := v_fail + 1; end if;

  raise notice '---';
  if v_fail = 0 then
    raise notice 'P0.3 VALIDATION: ALL 8 CHECKS PASSED';
  else
    raise notice 'P0.3 VALIDATION: % CHECK(S) FAILED - DO NOT ACCEPT', v_fail;
  end if;
end;
$val$;

rollback;

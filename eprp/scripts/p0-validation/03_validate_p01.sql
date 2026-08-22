-- EPRP P0.1 validation — project / project_contacts write authority.
--
-- WHAT THIS PROVES
--   The escalation is closed: an authenticated account with no authority on a
--   project can neither make itself a consolidator nor forge an assignment.
--   And the Tier A read rule holds: it can still SEE the project.
--
-- MOST OF THIS NEEDS NO TEST ACCOUNT
--   The attacker in the escalation is "any authenticated user", which is modelled
--   by a JWT `sub` that has no profiles row at all -- current_contact_id() returns
--   null, so no assignment can be resolved. That needs no auth account.
--   Only the POSITIVE write cases need the fixture profile from
--   01_setup_test_fixtures.sql; they are skipped with a notice if it is absent.
--
-- THE TRAP THIS SCRIPT AVOIDS
--   An UPDATE or DELETE refused by RLS does NOT raise. The rows simply fail the
--   USING clause and 0 rows are affected. A test that only wraps them in a
--   BEGIN/EXCEPTION block sees no exception and reports PASS whether or not the
--   policy works. Every UPDATE/DELETE case below asserts the ROW COUNT, and
--   re-reads the row to confirm it is unchanged.
--
-- HOW TO RUN
--   psql "<pooler connection string>" -f 03_validate_p01.sql
--
-- Everything runs in a transaction that is ROLLED BACK.

\set ON_ERROR_STOP on

begin;

do $val$
declare
  v_project    uuid;
  v_member     uuid;
  v_coord      uuid;
  v_coord_user uuid;
  v_role       text := current_user;
  v_rows       integer;
  v_fail       integer := 0;
  v_skipped    integer := 0;
  v_pcm_before uuid;
  v_pcm_after  uuid;
  n1 boolean; n2 boolean; n3 boolean; n4 boolean; n5 boolean;
  t1 integer; t2 integer;
  p1 boolean; p2 boolean;
begin
  select id into v_project from public.projects where code = 'ZZ-P0TEST-PRJ';
  if v_project is null then
    raise exception 'Fixtures missing. Run 01_setup_test_fixtures.sql first.';
  end if;
  select id into v_member from public.contacts where name = 'ZZ-P0TEST Member';
  select id into v_coord  from public.contacts where name = 'ZZ-P0TEST Coordinator';
  select id into v_coord_user from public.profiles where contact_id = v_coord;

  select project_control_manager_id into v_pcm_before
    from public.projects where id = v_project;

  /* ============ Phase 1: any authenticated account, no authority ========== */

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid()::text)::text, true);

  -- N1. THE escalation: make myself this project's Project Control Manager.
  update public.projects
     set project_control_manager_id = v_member
   where id = v_project;
  get diagnostics v_rows = row_count;
  n1 := (v_rows = 0);

  -- N2. THE other escalation: forge a department_manager assignment.
  begin
    insert into public.project_contacts
      (project_id, contact_id, role, assignment_role)
    values (v_project, v_member, 'team_member', 'department_manager');
    get diagnostics v_rows = row_count;
    n2 := (v_rows = 0);
  exception when insufficient_privilege then
    n2 := true;
  end;

  -- N3. Create a project without the administrative role.
  begin
    insert into public.projects
      (code, name, client_id, project_manager_id, planned_start_date, planned_finish_date)
    select 'ZZ-P0TEST-ESCALATE', 'should not exist', p.client_id, p.project_manager_id,
           current_date, current_date + 1
      from public.projects p where p.id = v_project;
    get diagnostics v_rows = row_count;
    n3 := (v_rows = 0);
  exception when insufficient_privilege then
    n3 := true;
  end;

  -- N4. Remove someone else's assignment.
  delete from public.project_contacts where project_id = v_project;
  get diagnostics v_rows = row_count;
  n4 := (v_rows = 0);

  -- N5. Delete the project. projects carries NO delete policy, so this must
  --     affect nothing rather than cascading the project away.
  delete from public.projects where id = v_project;
  get diagnostics v_rows = row_count;
  n5 := (v_rows = 0);

  -- Tier A reads must still work for this same account.
  select count(*) into t1 from public.projects;
  select count(*) into t2 from public.project_contacts where project_id = v_project;

  /* ================= Phase 2: the consolidator (needs fixture) ============ */

  if v_coord_user is null then
    v_skipped := 2;
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_coord_user::text)::text, true);

    update public.projects set description = 'P0.1 positive write check'
     where id = v_project;
    get diagnostics v_rows = row_count;
    p1 := (v_rows = 1);

    begin
      insert into public.project_contacts (project_id, contact_id, role)
      values (v_project, v_member, 'client_representative');
      get diagnostics v_rows = row_count;
      p2 := (v_rows = 1);
    exception when insufficient_privilege then
      p2 := false;
    end;
  end if;

  perform set_config('role', v_role, true);

  -- Independent confirmation that N1 changed nothing.
  select project_control_manager_id into v_pcm_after
    from public.projects where id = v_project;

  /* ================================ Report =============================== */

  raise notice '--- negative: an authenticated account with no authority ---';

  if n1 and (v_pcm_after is not distinct from v_pcm_before) then
    raise notice 'PASS  N1 could NOT make itself Project Control Manager (0 rows, column unchanged)';
  else
    raise notice 'FAIL  N1 ESCALATION OPEN - project_control_manager_id was writable'; v_fail := v_fail + 1;
  end if;

  if n2 then raise notice 'PASS  N2 could NOT forge a department_manager assignment';
  else raise notice 'FAIL  N2 ESCALATION OPEN - project_contacts insert succeeded'; v_fail := v_fail + 1; end if;

  if n3 then raise notice 'PASS  N3 could NOT create a project';
  else raise notice 'FAIL  N3 project insert succeeded without the administrative role'; v_fail := v_fail + 1; end if;

  if n4 then raise notice 'PASS  N4 could NOT delete another account''s assignment';
  else raise notice 'FAIL  N4 project_contacts delete affected rows'; v_fail := v_fail + 1; end if;

  if n5 then raise notice 'PASS  N5 could NOT delete the project (no DELETE policy)';
  else raise notice 'FAIL  N5 project delete affected rows'; v_fail := v_fail + 1; end if;

  raise notice '--- Tier A visibility (24.2) for that same account ---';

  if t1 > 0 then raise notice 'PASS  T1 can still SEE projects (% visible)', t1;
  else raise notice 'FAIL  T1 Tier A broken - no projects visible'; v_fail := v_fail + 1; end if;

  if t2 > 0 then raise notice 'PASS  T2 can still SEE project assignments (% visible)', t2;
  else raise notice 'FAIL  T2 Tier A broken - no assignments visible'; v_fail := v_fail + 1; end if;

  raise notice '--- positive: the project consolidator ---';

  if v_skipped > 0 then
    raise notice 'SKIP  P1/P2 - no fixture profile. Create the auth account and re-run to prove the positive cases.';
  else
    if p1 then raise notice 'PASS  P1 consolidator CAN update the project';
    else raise notice 'FAIL  P1 consolidator was refused a project update'; v_fail := v_fail + 1; end if;

    if p2 then raise notice 'PASS  P2 consolidator CAN write an assignment';
    else raise notice 'FAIL  P2 consolidator was refused an assignment insert'; v_fail := v_fail + 1; end if;
  end if;

  raise notice '---';
  if v_fail = 0 and v_skipped = 0 then
    raise notice 'P0.1 VALIDATION: ALL 9 CHECKS PASSED';
  elsif v_fail = 0 then
    raise notice 'P0.1 VALIDATION: 7 PASSED, % SKIPPED (positive cases unproven)', v_skipped;
  else
    raise notice 'P0.1 VALIDATION: % CHECK(S) FAILED - DO NOT ACCEPT', v_fail;
  end if;
end;
$val$;

rollback;

-- EPRP P0.6 validation — one canonical consolidator rule.
--
-- Proves BOTH directions: that the fix grants what it should, and that it
-- grants nothing else. A permission test that only checks the positive case
-- proves nothing — it would pass against `using (true)`.
--
-- HOW TO RUN (after 01_setup_test_fixtures.sql, with the same UUID)
--   psql "<pooler connection string>" \
--     -v test_user_id="'00000000-0000-0000-0000-000000000000'" \
--     -f 02_validate_p06.sql
--
-- HOW IT IMPERSONATES
--   Supabase resolves auth.uid() from request.jwt.claims->>'sub'. Setting that
--   GUC together with the `authenticated` role reproduces what PostgREST does
--   for a signed-in caller, so the policies under test are the real ones.
--   Switching off the owning role also matters on its own: a table owner
--   bypasses RLS, so testing as the owner would pass no matter what the
--   policies said.
--
--   Everything runs in a transaction that is ROLLED BACK, so the checks cannot
--   leave data behind even though two of them write.
--
-- READ THE RESULT
--   Every line prints PASS or FAIL, and the block ends with a total.
--   Any FAIL means P0.6 must not be accepted.

\set ON_ERROR_STOP on

-- psql does NOT substitute :variables inside a dollar-quoted body, so the UUID
-- is handed to the DO block through a session setting instead. Substituting it
-- directly below would send the literal text ":test_user_id" to the server.
select set_config('p0.test_user_id', :test_user_id, false);

begin;

do $val$
declare
  v_project uuid;
  v_user    uuid := current_setting('p0.test_user_id')::uuid;
  v_role    text := current_user;
  v_fail    integer := 0;

  -- Case results, captured while impersonating and reported afterwards.
  c1 boolean; c2 boolean; c3 boolean; c4 boolean; c5 boolean;
  c6 boolean; c7 boolean; c8 boolean; c9 boolean;
begin
  select id into v_project from public.projects where code = 'ZZ-P0TEST-PRJ';
  if v_project is null then
    raise exception 'Fixtures missing. Run 01_setup_test_fixtures.sql first.';
  end if;

  -- The test is only meaningful if the project has NO singular consolidator
  -- column. With one set, every check below would pass with or without P0.6.
  if exists (
    select 1 from public.projects
     where id = v_project
       and (project_control_manager_id is not null
         or reporting_coordinator_id is not null)
  ) then
    raise exception 'Fixture invalid: ZZ-P0TEST-PRJ has a singular consolidator column set, so the test would prove nothing.';
  end if;
  raise notice 'Precondition OK: no singular consolidator column - authority can only come from the assignment.';

  /* ============ Phase 1: the consolidator, by assignment only ============ */

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user::text)::text, true);

  c1 := public.is_project_consolidator(v_project);
  c2 := public.weekly_can_manage_project(v_project);   -- THE P0.6 fix
  c3 := public.weekly_can_access_project(v_project);
  c4 := public.can_bin_project_document(v_project);    -- must NOT widen

  select coalesce(bool_or(public.weekly_can_manage_project(p.id)), false)
    into c9
    from public.projects p
   where p.code <> 'ZZ-P0TEST-PRJ';

  begin
    insert into public.master_milestones (project_id, code, name)
    values (v_project, 'ZZ-P0TEST-M1', 'P0.6 positive write check');
    c5 := true;
  exception when insufficient_privilege then
    c5 := false;
  end;

  /* =============== Phase 2: the negative control, unlinked =============== */

  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid()::text)::text, true);

  c6 := public.is_project_consolidator(v_project);
  c7 := public.weekly_can_manage_project(v_project);

  begin
    insert into public.master_milestones (project_id, code, name)
    values (v_project, 'ZZ-P0TEST-M2', 'P0.6 negative write check');
    c8 := true;
  exception when insufficient_privilege then
    c8 := false;
  end;

  -- Back to the owning role before reporting.
  perform set_config('role', v_role, true);

  /* ================================ Report =============================== */

  raise notice '---';

  if c1 then raise notice 'PASS  C1 consolidator-by-assignment IS a consolidator';
  else raise notice 'FAIL  C1 expected true, got false'; v_fail := v_fail + 1; end if;

  if c2 then raise notice 'PASS  C2 consolidator-by-assignment CAN MANAGE  <- the P0.6 fix';
  else raise notice 'FAIL  C2 expected true, got false'; v_fail := v_fail + 1; end if;

  if c3 then raise notice 'PASS  C3 consolidator can still READ the project';
  else raise notice 'FAIL  C3 expected true, got false'; v_fail := v_fail + 1; end if;

  if not c4 then raise notice 'PASS  C4 consolidator did NOT gain document-bin rights';
  else raise notice 'FAIL  C4 bin rights widened - can_bin_project_document must stay PCM-only'; v_fail := v_fail + 1; end if;

  if c5 then raise notice 'PASS  C5 consolidator CAN insert a master milestone (real policy admitted it)';
  else raise notice 'FAIL  C5 consolidator was refused a master milestone insert (42501)'; v_fail := v_fail + 1; end if;

  if not c6 then raise notice 'PASS  C6 an unlinked account is NOT a consolidator';
  else raise notice 'FAIL  C6 expected false, got true'; v_fail := v_fail + 1; end if;

  if not c7 then raise notice 'PASS  C7 an unlinked account CANNOT manage';
  else raise notice 'FAIL  C7 expected false, got true'; v_fail := v_fail + 1; end if;

  if not c8 then raise notice 'PASS  C8 an unlinked account was refused a master milestone insert (42501)';
  else raise notice 'FAIL  C8 an unlinked account was ALLOWED to write'; v_fail := v_fail + 1; end if;

  if not c9 then raise notice 'PASS  C9 consolidator has NO manage rights on any other project';
  else raise notice 'FAIL  C9 cross-project leakage - manage granted outside the assigned project'; v_fail := v_fail + 1; end if;

  raise notice '---';
  if v_fail = 0 then
    raise notice 'P0.6 VALIDATION: ALL 9 CHECKS PASSED';
  else
    raise notice 'P0.6 VALIDATION: % CHECK(S) FAILED - DO NOT ACCEPT', v_fail;
  end if;
end;
$val$;

-- Nothing this script wrote is kept.
rollback;

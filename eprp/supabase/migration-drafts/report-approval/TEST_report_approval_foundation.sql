-- ============================================================================
-- Authenticated authorization test — report approval foundation (DRAFT A + B)
-- ============================================================================
--
-- NOT YET RUN. Run only on the LOCAL stack, after DRAFT_A and DRAFT_B have
-- been promoted to supabase/migrations and applied, and after
-- scripts/p0-validation/00_local_test_identity.sql and 01_setup_test_fixtures.sql:
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -v ON_ERROR_STOP=1 -f TEST_report_approval_foundation.sql
--
-- EVERYTHING RUNS IN ONE TRANSACTION THAT ENDS IN ROLLBACK. It creates no
-- users and leaves no rows behind. It impersonates the two fixture identities
-- the same way PostgREST does (role + request.jwt.claims):
--   admin  00000000-0000-4000-a000-0000000000a1  (active system_admin)
--   viewer 00000000-0000-4000-a000-0000000000b2  (non-admin)
-- It needs two non-archived projects; for the decision-log recorder cases it
-- also needs one Weekly Report (skipped with a NOTICE if there is none).
-- Any failed expectation raises and aborts; success prints PASS lines.
-- ============================================================================

\set ON_ERROR_STOP on

do $guard$
begin
  if inet_server_addr() is not null
     and host(inet_server_addr()) not in ('127.0.0.1', '::1', 'localhost') then
    raise exception 'REFUSING TO RUN: not a local database.';
  end if;
end;
$guard$;

begin;

-- expect_error(sql, sqlstate): the statement must fail with exactly that code.
create function pg_temp.expect_error(p_sql text, p_code text, p_label text)
returns void language plpgsql as $fn$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_code then
      raise notice 'PASS  %', p_label;
      return;
    end if;
    raise exception 'FAIL  % -- expected %, got % (%)', p_label, p_code, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL  % -- expected %, statement succeeded', p_label, p_code;
end;
$fn$;

create function pg_temp.expect(p_ok boolean, p_label text)
returns void language plpgsql as $fn$
begin
  if p_ok is distinct from true then
    raise exception 'FAIL  %', p_label;
  end if;
  raise notice 'PASS  %', p_label;
end;
$fn$;

create function pg_temp.act_as(p_sub text)
returns void language sql as $fn$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
$fn$;

-- Temp functions are EXECUTE-to-PUBLIC by default and this session's own temp
-- schema is reachable after SET ROLE, so no extra grant is needed.

-- Fixture selection (as the migration owner).
do $pick$
declare v_p1 uuid; v_p2 uuid; v_wr uuid;
begin
  if not exists (select 1 from public.profiles where id = '00000000-0000-4000-a000-0000000000a1' and role = 'system_admin' and active)
     or not exists (select 1 from public.profiles where id = '00000000-0000-4000-a000-0000000000b2' and active) then
    raise exception 'Fixtures missing: run 00_local_test_identity.sql and 01_setup_test_fixtures.sql first.';
  end if;

  select wr.id, wr.project_id into v_wr, v_p1
    from public.weekly_reports wr join public.projects p on p.id = wr.project_id
   where p.status is distinct from 'archived'
   order by wr.id limit 1;
  if v_p1 is null then
    select id into v_p1 from public.projects where status is distinct from 'archived' order by id limit 1;
  end if;
  select id into v_p2 from public.projects
   where status is distinct from 'archived' and id <> v_p1 order by id limit 1;
  if v_p1 is null or v_p2 is null then
    raise exception 'Need two non-archived projects.';
  end if;

  perform set_config('t.p1', v_p1::text, true);
  perform set_config('t.p2', v_p2::text, true);
  perform set_config('t.wr', coalesce(v_wr::text, ''), true);
end;
$pick$;

/* ------------------------------ Anonymous --------------------------------- */

set local role anon;
select pg_temp.expect_error('select * from public.report_approval_grants', '42501', 'anon cannot read grants');
select pg_temp.expect_error('select * from public.report_decision_log', '42501', 'anon cannot read the decision log');
select pg_temp.expect_error(format('select public.grant_report_approval(%L, %L, %L)',
  '00000000-0000-4000-a000-0000000000b2', current_setting('t.p1'), 'weekly'), '42501', 'anon cannot grant');
select pg_temp.expect_error(format('select public.has_report_approval_grant(%L, %L)',
  current_setting('t.p1'), 'weekly'), '42501', 'anon cannot call the helper');
reset role;

/* ------------------- Baseline: viewer's existing predicates ---------------- */

select pg_temp.act_as('00000000-0000-4000-a000-0000000000b2');
set local role authenticated;
select set_config('t.before', concat_ws(',',
  public.can_access_project(current_setting('t.p1')::uuid),
  public.can_manage_project_operations(current_setting('t.p1')::uuid),
  public.can_manage_reporting_workflow(current_setting('t.p1')::uuid),
  public.has_global_operational_authority(),
  public.is_system_admin()), true);

select pg_temp.expect_error(format('select public.grant_report_approval(%L, %L, %L)',
  '00000000-0000-4000-a000-0000000000b2', current_setting('t.p1'), 'weekly'), '42501', 'non-admin cannot grant (not even to self)');
select pg_temp.expect_error(format(
  'insert into public.report_approval_grants (profile_id, project_id, scope, granted_by) values (%L, %L, %L, %L)',
  '00000000-0000-4000-a000-0000000000b2', current_setting('t.p1'), 'weekly', '00000000-0000-4000-a000-0000000000a1'),
  '42501', 'non-admin cannot insert a grant directly (forged grantor)');
select pg_temp.expect(not public.has_report_approval_grant(current_setting('t.p1')::uuid, 'weekly'), 'viewer has no grant before granting');
reset role;

/* ------------------------------ Admin grants ------------------------------ */

select pg_temp.act_as('00000000-0000-4000-a000-0000000000a1');
set local role authenticated;
select set_config('t.g_weekly', public.grant_report_approval(
  '00000000-0000-4000-a000-0000000000b2', current_setting('t.p1')::uuid, 'weekly', 'test')::text, true);
select set_config('t.g_monthly', public.grant_report_approval(
  '00000000-0000-4000-a000-0000000000b2', current_setting('t.p1')::uuid, 'monthly')::text, true);
select pg_temp.expect(
  (select granted_by from public.report_approval_grants where id = current_setting('t.g_weekly')::uuid)
    = '00000000-0000-4000-a000-0000000000a1', 'granted_by is the authenticated admin');
select pg_temp.expect_error(format('select public.grant_report_approval(%L, %L, %L)',
  '00000000-0000-4000-a000-0000000000b2', current_setting('t.p1'), 'weekly'), '23505', 'duplicate active grant refused');
select pg_temp.expect_error(format('select public.grant_report_approval(%L, %L, %L)',
  '00000000-0000-4000-a000-0000000000b2', current_setting('t.p1'), 'executive_report'), '22023', 'unknown scope refused');
select pg_temp.expect_error(format(
  'update public.report_approval_grants set scope = %L where id = %L', 'executive_contribution', current_setting('t.g_weekly')),
  '42501', 'admin cannot edit a grant directly');
select pg_temp.expect_error(format(
  'delete from public.report_approval_grants where id = %L', current_setting('t.g_weekly')),
  '42501', 'admin cannot delete a grant');
reset role;

/* ------------------------- Isolation, as the viewer ------------------------ */

select pg_temp.act_as('00000000-0000-4000-a000-0000000000b2');
set local role authenticated;
select pg_temp.expect(public.has_report_approval_grant(current_setting('t.p1')::uuid, 'weekly'), 'weekly grant on P1 active');
select pg_temp.expect(public.has_report_approval_grant(current_setting('t.p1')::uuid, 'monthly'), 'monthly grant on P1 active (independent)');
select pg_temp.expect(not public.has_report_approval_grant(current_setting('t.p1')::uuid, 'executive_contribution'), 'no executive_contribution grant on P1');
select pg_temp.expect(not public.has_report_approval_grant(current_setting('t.p2')::uuid, 'weekly'), 'no grant on P2 (project isolation)');
select pg_temp.expect((select count(*) from public.report_approval_grants) = 2, 'viewer reads exactly their own 2 grants');
select pg_temp.expect(
  current_setting('t.before') = concat_ws(',',
    public.can_access_project(current_setting('t.p1')::uuid),
    public.can_manage_project_operations(current_setting('t.p1')::uuid),
    public.can_manage_reporting_workflow(current_setting('t.p1')::uuid),
    public.has_global_operational_authority(),
    public.is_system_admin()),
  'grants change no read, operations, workflow or admin predicate');
select pg_temp.expect_error(format('select public.revoke_report_approval(%L, %L)', current_setting('t.g_weekly'), 'self'),
  '42501', 'grantee cannot revoke');
select pg_temp.expect_error(format('update public.report_approval_grants set revoked_at = null where id = %L', current_setting('t.g_weekly')),
  '42501', 'grantee cannot update own grant');
reset role;

/* ----------------- Lifecycle: inactive account, archived project ----------- */

savepoint s_inactive;
update public.profiles set active = false where id = '00000000-0000-4000-a000-0000000000b2';
select pg_temp.act_as('00000000-0000-4000-a000-0000000000b2');
set local role authenticated;
select pg_temp.expect(not public.has_report_approval_grant(current_setting('t.p1')::uuid, 'weekly'), 'inactive account: grant ineffective');
reset role;
select pg_temp.act_as('00000000-0000-4000-a000-0000000000a1');
set local role authenticated;
select pg_temp.expect_error(format('select public.grant_report_approval(%L, %L, %L)',
  '00000000-0000-4000-a000-0000000000b2', current_setting('t.p2'), 'weekly'), '22023', 'cannot grant to an inactive account');
reset role;
rollback to savepoint s_inactive;

savepoint s_archived;
update public.projects set status = 'archived' where id = current_setting('t.p1')::uuid;
select pg_temp.act_as('00000000-0000-4000-a000-0000000000b2');
set local role authenticated;
select pg_temp.expect(not public.has_report_approval_grant(current_setting('t.p1')::uuid, 'weekly'), 'archived project: grant ineffective');
reset role;
select pg_temp.act_as('00000000-0000-4000-a000-0000000000a1');
set local role authenticated;
select pg_temp.expect_error(format('select public.grant_report_approval(%L, %L, %L)',
  '00000000-0000-4000-a000-0000000000b2', current_setting('t.p1'), 'executive_contribution'), '22023', 'cannot grant on an archived project');
reset role;
rollback to savepoint s_archived;

/* --------------------------- Decision log (writes) ------------------------- */

select pg_temp.act_as('00000000-0000-4000-a000-0000000000a1');
set local role authenticated;
select pg_temp.expect_error(format(
  'insert into public.report_decision_log (subject_type, subject_id, project_id, from_status, to_status, actor_profile_id, actor_name, authority) values (%L, %L, %L, %L, %L, %L, %L, %L)',
  'weekly_report', gen_random_uuid(), current_setting('t.p1'), 'under_review', 'approved',
  '00000000-0000-4000-a000-0000000000b2', 'forged', 'global_authority'),
  '42501', 'client cannot insert a decision (forged actor)');
select pg_temp.expect_error(format(
  'select public.record_report_decision(%L, %L, %L, %L, %L, %L)',
  'weekly_report', gen_random_uuid(), current_setting('t.p1'), 'under_review', 'approved', 'global_authority'),
  '42501', 'client cannot call the recorder');
reset role;

do $decisions$
declare
  v_wr   uuid := nullif(current_setting('t.wr'), '')::uuid;
  v_p1   uuid := current_setting('t.p1')::uuid;
  v_g    uuid := current_setting('t.g_weekly')::uuid;
  v_d1   uuid;
  v_d2   uuid;
begin
  if v_wr is null then
    raise notice 'SKIP  recorder cases: no Weekly Report on a non-archived project.';
    return;
  end if;

  -- Recorder as the owner would run it from a status function; actor = claims.
  perform pg_temp.act_as('00000000-0000-4000-a000-0000000000a1');
  v_d1 := public.record_report_decision('weekly_report', v_wr, v_p1, 'under_review', 'returned', 'global_authority', null, 'test');
  perform pg_temp.expect((select actor_profile_id from public.report_decision_log where id = v_d1)
                           = '00000000-0000-4000-a000-0000000000a1', 'decision actor is the authenticated admin');

  perform pg_temp.act_as('00000000-0000-4000-a000-0000000000b2');
  perform pg_temp.expect_error(format('select public.record_report_decision(%L, %L, %L, %L, %L, %L)',
    'weekly_report', v_wr, v_p1, 'under_review', 'approved', 'global_authority'),
    '42501', 'viewer cannot claim global authority');
  perform pg_temp.expect_error(format('select public.record_report_decision(%L, %L, %L, %L, %L, %L, %L)',
    'monthly_report', v_wr, v_p1, 'under_review', 'approved', 'delegated_grant', v_g),
    '22023', 'subject must belong to the stated type and project');
  perform pg_temp.expect_error(format('select public.record_report_decision(%L, %L, %L, %L, %L, %L, %L)',
    'weekly_report', v_wr, v_p1, 'under_review', 'approved', 'delegated_grant', current_setting('t.g_monthly')),
    '42501', 'a monthly grant cannot authorise a weekly decision');
  v_d2 := public.record_report_decision('weekly_report', v_wr, v_p1, 'under_review', 'approved', 'delegated_grant', v_g);
  perform pg_temp.expect((select grant_id from public.report_decision_log where id = v_d2) = v_g, 'delegated decision records its grant');

  -- Revoke, then the same grant can no longer authorise, but history stays.
  perform pg_temp.act_as('00000000-0000-4000-a000-0000000000a1');
  perform pg_temp.expect_error(format('select public.revoke_report_approval(%L, %L)', v_g, '  '), '22023', 'revocation needs a reason');
  perform public.revoke_report_approval(v_g, 'test revocation');
  perform pg_temp.expect_error(format('select public.revoke_report_approval(%L, %L)', v_g, 'again'), 'P0002', 'double revocation refused');

  perform pg_temp.act_as('00000000-0000-4000-a000-0000000000b2');
  perform pg_temp.expect(not public.has_report_approval_grant(v_p1, 'weekly'), 'revocation effective immediately');
  perform pg_temp.expect_error(format('select public.record_report_decision(%L, %L, %L, %L, %L, %L, %L)',
    'weekly_report', v_wr, v_p1, 'returned', 'under_review', 'delegated_grant', v_g),
    '42501', 'revoked grant cannot authorise a decision');
  perform pg_temp.expect(exists (select 1 from public.report_decision_log where id = v_d2 and grant_id = v_g),
    'decision history preserved after revocation');

  -- Immutability applies even to the table owner.
  perform pg_temp.expect_error(format('update public.report_decision_log set to_status = %L where id = %L', 'rejected', v_d2),
    '42501', 'owner cannot update a decision');
  perform pg_temp.expect_error(format('delete from public.report_decision_log where id = %L', v_d2),
    '42501', 'owner cannot delete a decision');
  perform pg_temp.expect_error('truncate public.report_decision_log', '42501', 'owner cannot truncate the decision log');
  perform pg_temp.expect_error(format('delete from public.report_approval_grants where id = %L', v_g),
    '42501', 'owner cannot delete a revoked grant');
  perform pg_temp.expect_error(format('update public.report_approval_grants set revoke_reason = %L where id = %L', 'edited', v_g),
    '42501', 'revoked grant is immutable');

  -- Re-granting after revocation creates a new row.
  perform pg_temp.act_as('00000000-0000-4000-a000-0000000000a1');
  perform pg_temp.expect(public.grant_report_approval('00000000-0000-4000-a000-0000000000b2', v_p1, 'weekly') <> v_g,
    're-grant after revocation creates a new grant');
end;
$decisions$;

-- Read path: the delegated actor sees their own decision even without project access.
select pg_temp.act_as('00000000-0000-4000-a000-0000000000b2');
set local role authenticated;
select pg_temp.expect(
  nullif(current_setting('t.wr'), '') is null
  or exists (select 1 from public.report_decision_log
              where actor_profile_id = '00000000-0000-4000-a000-0000000000b2'),
  'actor can read own decisions');
reset role;

rollback;
\echo 'Report approval foundation: all expectations passed; transaction rolled back.'

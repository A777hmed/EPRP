-- Phase 2C.3C Project Team Membership — RUNTIME verification. LOCAL DATABASE ONLY.
--
-- Proves 20261007150000_project_team_membership.sql and the controlled-write
-- finalization 20261011090000_project_team_controlled_writes.sql against real PostgreSQL,
-- real RLS and real authenticated roles. Everything — fixtures, users and
-- every write — runs in ONE transaction that is ROLLED BACK. Nothing persists.
--
--   1  add member through the RPC; stale version refused (PT409)
--   2  one ACTIVE membership per person; leave and rejoin keeps history
--   3  new/edited memberships need Party + Project Role; created active only
--   4  Party must belong to the same project
--   5  Reports To: same project, active, no self, no direct/indirect cycle,
--      cross-party allowed
--   6  inactive person refused
--   7  ending: separate operation, refused while members report to the person,
--      ended rows immutable, history never deleted
--   8  legacy backfilled rows: editing requires completion; ending does not
--   9  archived projects are read-only for membership
--  10  assigned-project authority isolation (Project Control / Planning)
--  11  membership grants NO authorization
--  12  a subcontractor with team history cannot be removed (friendly message)
--  13  controlled writes only: authenticated callers have no direct INSERT /
--      UPDATE / DELETE (even when authorized); the writers are hardened
--      SECURITY DEFINER functions executable by authenticated only. The
--      trigger / constraint invariants are re-proved as the table owner.
--
-- Uses existing data read-only (a backfilled legacy row on MDP-PIPE-04 and an
-- archived project) and creates its own projects, people and accounts inside
-- the rolled-back transaction.
--
-- HOW TO RUN (after the migration is applied; from eprp/):
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < scripts/p0-validation/114_runtime_2c3c_project_team.sql

\set ON_ERROR_STOP off
\set QUIET on
\pset pager off

do $guard$
begin
  if inet_server_addr() is not null
     and host(inet_server_addr()) not in ('127.0.0.1', '::1', 'localhost') then
    raise exception 'REFUSING TO RUN: this connection is not local (server address %).',
      host(inet_server_addr());
  end if;
end;
$guard$;

begin;

create temp table r(seq int, area text, item text, verdict text) on commit drop;
grant all on r to authenticated, anon;
do $g$
begin
  execute format('grant usage on schema %I to authenticated, anon',
                 (select nspname from pg_namespace where oid = pg_my_temp_schema()));
end $g$;

create or replace function pg_temp.chk(
  p_seq int, p_area text, p_item text, p_ok boolean, p_detail text default ''
) returns void language plpgsql as $$
begin
  insert into r values (p_seq, p_area, p_item,
    case when p_ok then 'PASS' else 'FAIL' end ||
    case when p_detail = '' then '' else ' — ' || p_detail end);
end $$;

-- Refused, and (optionally) refused for the expected reason.
create or replace function pg_temp.must_fail(
  p_seq int, p_area text, p_item text, p_sql text, p_expect text default null
) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp.chk(p_seq, p_area, p_item, false, 'statement was ACCEPTED');
exception when others then
  perform pg_temp.chk(p_seq, p_area, p_item,
    p_expect is null or position(p_expect in sqlerrm) > 0 or sqlstate = p_expect,
    'refused [' || sqlstate || ']: ' || left(sqlerrm, 100));
end $$;

create or replace function pg_temp.must_pass(
  p_seq int, p_area text, p_item text, p_sql text
) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp.chk(p_seq, p_area, p_item, true);
exception when others then
  perform pg_temp.chk(p_seq, p_area, p_item, false, '[' || sqlstate || '] ' || left(sqlerrm, 110));
end $$;

create or replace function pg_temp.version(p_code text) returns timestamptz
language sql as $$ select updated_at from public.projects where code = p_code $$;
create or replace function pg_temp.project(p_code text) returns uuid
language sql as $$ select id from public.projects where code = p_code $$;
create or replace function pg_temp.person(p_name text) returns uuid
language sql as $$ select id from public.contacts where name = p_name $$;
create or replace function pg_temp.party(p_code text, p_kind text) returns uuid
language sql as $$ select pp.id from public.project_parties pp
                    join public.projects p on p.id = pp.project_id
                   where p.code = p_code and pp.kind = p_kind limit 1 $$;
create or replace function pg_temp.member(p_code text, p_name text) returns uuid
language sql as $$ select m.id from public.project_members m
                    where m.project_id = pg_temp.project(p_code)
                      and m.contact_id = pg_temp.person(p_name)
                      and m.ended_at is null $$;

/* ========================= fixtures (as postgres) ========================= */

do $fix$
declare
  v_template uuid := (select id from public.projects where code = 'MDP-PIPE-04');
begin
  if v_template is null then
    raise exception 'MDP-PIPE-04 not found — this script expects the local development dataset.';
  end if;
  if to_regclass('public.project_members') is null then
    raise exception 'project_members not found — apply 20261007150000_project_team_membership.sql first.';
  end if;

  insert into public.projects (code, name, client_id, planned_start_date, planned_finish_date, status)
  select 'ZZ-2C3C-' || s, 'ZZ 2C.3C ' || s, p.client_id, p.planned_start_date, p.planned_finish_date, 'planning'
    from public.projects p, (values ('A'), ('B')) v(s)
   where p.id = v_template;

  insert into public.project_parties (project_id, kind, name, scope, engagement_status, sort_order)
  select id, 'subcontractor', 'ZZ 2C.3C Subcontractor', 'Civil works', 'active', 2
    from public.projects where code = 'ZZ-2C3C-A';

  insert into public.contacts (name, email, active) values
    ('ZZ 2C3C P1', 'zz.2c3c.p1@example.invalid', true),
    ('ZZ 2C3C P2', 'zz.2c3c.p2@example.invalid', true),
    ('ZZ 2C3C P3', 'zz.2c3c.p3@example.invalid', true),
    ('ZZ 2C3C P4', 'zz.2c3c.p4@example.invalid', true),
    ('ZZ 2C3C PCM', 'zz.2c3c.pcm@example.invalid', true),
    ('ZZ 2C3C PCA', 'zz.2c3c.pca@example.invalid', true),
    ('ZZ 2C3C Inactive', 'zz.2c3c.inactive@example.invalid', false);

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-0000002c3c01', 'authenticated', 'authenticated',
     'zz.2c3c.pcm@example.invalid', 'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-0000002c3c02', 'authenticated', 'authenticated',
     'zz.2c3c.p1@example.invalid', 'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-0000002c3c03', 'authenticated', 'authenticated',
     'zz.2c3c.pca@example.invalid', 'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

  insert into public.profiles (id, email, full_name, role, contact_id, active) values
    ('00000000-0000-4000-a000-0000002c3c01', 'zz.2c3c.pcm@example.invalid', 'ZZ 2C3C PCM', 'viewer',
     (select id from public.contacts where name = 'ZZ 2C3C PCM'), true),
    ('00000000-0000-4000-a000-0000002c3c02', 'zz.2c3c.p1@example.invalid', 'ZZ 2C3C P1', 'viewer',
     (select id from public.contacts where name = 'ZZ 2C3C P1'), true),
    ('00000000-0000-4000-a000-0000002c3c03', 'zz.2c3c.pca@example.invalid', 'ZZ 2C3C PCA', 'project_control_admin',
     (select id from public.contacts where name = 'ZZ 2C3C PCA'), true);

  -- Project Control / Planning assigned on ZZ-2C3C-A ONLY (the existing model).
  insert into public.project_contacts (project_id, contact_id, role)
  values (pg_temp.project('ZZ-2C3C-A'), (select id from public.contacts where name = 'ZZ 2C3C PCM'),
          'project_control_manager');

  -- One member on project B, written as the table owner, for cross-project tests.
  insert into public.project_members (project_id, contact_id, party_id, project_role)
  values (pg_temp.project('ZZ-2C3C-B'), (select id from public.contacts where name = 'ZZ 2C3C P4'),
          pg_temp.party('ZZ-2C3C-B', 'eprom'), 'Engineer B');
end;
$fix$;

-- Project B is NOT visible to the project-A user (visibility follows the
-- existing project_contacts / global model, not membership), so its ids are
-- captured here, as the table owner, for the cross-project tests.
create temp table ids(key text primary key, id uuid, at timestamptz) on commit drop;
grant select on ids to authenticated;
insert into ids values
  ('B', pg_temp.project('ZZ-2C3C-B'), pg_temp.version('ZZ-2C3C-B')),
  ('B_OWNER', pg_temp.party('ZZ-2C3C-B', 'owner'), null),
  ('B_EPROM', pg_temp.party('ZZ-2C3C-B', 'eprom'), null),
  ('B_MEMBER', (select id from public.project_members where project_id = pg_temp.project('ZZ-2C3C-B')), null);
create or replace function pg_temp.id(p_key text) returns uuid
language sql as $$ select id from ids where key = p_key $$;

/* ================= As Project Control / Planning on project A ============= */

do $pcp$
declare
  A uuid := pg_temp.project('ZZ-2C3C-A');
  B uuid := pg_temp.id('B');
  v_old timestamptz;
  v_result jsonb;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3c01","role":"authenticated"}';

  /* 1. add + stale */
  v_old := pg_temp.version('ZZ-2C3C-A');
  begin
    v_result := public.add_project_member(A, v_old, pg_temp.person('ZZ 2C3C P1'),
      pg_temp.party('ZZ-2C3C-A', 'eprom'), '  Lead Engineer  ', null);
    perform pg_temp.chk(1, '1 ADD', 'add_project_member creates an active EPROM member',
      (select ended_at is null and project_role = 'Lead Engineer' from public.project_members where id = (v_result->>'member_id')::uuid));
    perform pg_temp.chk(1, '1 ADD', 'returned version is the project''s new version',
      (v_result->>'version')::timestamptz = pg_temp.version('ZZ-2C3C-A'));
  exception when others then
    perform pg_temp.chk(1, '1 ADD', 'add_project_member creates an active EPROM member', false, left(sqlerrm, 110));
  end;
  perform pg_temp.must_fail(1, '1 STALE', 'an old project version is refused as stale',
    format('select public.add_project_member(%L, %L, %L, %L, %L)', A, v_old, pg_temp.person('ZZ 2C3C P2'),
           pg_temp.party('ZZ-2C3C-A', 'eprom'), 'Engineer'), 'PT409');

  /* 2. one active membership */
  perform pg_temp.must_fail(2, '2 ONE ACTIVE', 'adding an already-active person is refused',
    format('select public.add_project_member(%L, %L, %L, %L, %L)', A, pg_temp.version('ZZ-2C3C-A'),
           pg_temp.person('ZZ 2C3C P1'), pg_temp.party('ZZ-2C3C-A', 'eprom'), 'Again'), 'ALREADY_MEMBER');
  perform pg_temp.must_fail(13, '13 CONTROLLED WRITES', 'an AUTHORIZED user cannot INSERT directly (bypassing the version check)',
    format('insert into public.project_members (project_id, contact_id, party_id, project_role) values (%L, %L, %L, %L)',
           A, pg_temp.person('ZZ 2C3C P4'), pg_temp.party('ZZ-2C3C-A', 'eprom'), 'Direct'), 'permission denied for table project_members');

  /* 3. required data, created active only */
  perform pg_temp.must_fail(3, '3 REQUIRED', 'add without a Party is refused',
    format('select public.add_project_member(%L, %L, %L, null, %L)', A, pg_temp.version('ZZ-2C3C-A'),
           pg_temp.person('ZZ 2C3C P2'), 'Engineer'), 'PARTY_REQUIRED');
  perform pg_temp.must_fail(3, '3 REQUIRED', 'add without a Project Role is refused',
    format('select public.add_project_member(%L, %L, %L, %L, %L)', A, pg_temp.version('ZZ-2C3C-A'),
           pg_temp.person('ZZ 2C3C P2'), pg_temp.party('ZZ-2C3C-A', 'eprom'), '   '), 'PROJECT_ROLE_REQUIRED');
  perform pg_temp.must_fail(3, '3 REQUIRED', 'a Project Role over 80 characters is refused',
    format('select public.add_project_member(%L, %L, %L, %L, %L)', A, pg_temp.version('ZZ-2C3C-A'),
           pg_temp.person('ZZ 2C3C P2'), pg_temp.party('ZZ-2C3C-A', 'eprom'), repeat('x', 81)), 'PROJECT_ROLE_REQUIRED');

  /* 4. same-project Party */
  perform pg_temp.must_fail(4, '4 PARTY', 'a Party from another project is refused',
    format('select public.add_project_member(%L, %L, %L, %L, %L)', A, pg_temp.version('ZZ-2C3C-A'),
           pg_temp.person('ZZ 2C3C P2'), pg_temp.id('B_OWNER'), 'Client Engineer'), 'project_members_party_same_project');

  /* 5. Reports To */
  perform pg_temp.must_pass(5, '5 REPORTS TO', 'cross-party Reports To (Owner member -> EPROM member) is allowed',
    format('select public.add_project_member(%L, %L, %L, %L, %L, %L)', A, pg_temp.version('ZZ-2C3C-A'),
           pg_temp.person('ZZ 2C3C P2'), pg_temp.party('ZZ-2C3C-A', 'owner'), 'Client Engineer',
           pg_temp.member('ZZ-2C3C-A', 'ZZ 2C3C P1')));
  perform pg_temp.must_pass(5, '5 REPORTS TO', 'a subcontractor member may report to an Owner member',
    format('select public.add_project_member(%L, %L, %L, %L, %L, %L)', A, pg_temp.version('ZZ-2C3C-A'),
           pg_temp.person('ZZ 2C3C P3'), pg_temp.party('ZZ-2C3C-A', 'subcontractor'), 'Site Supervisor',
           pg_temp.member('ZZ-2C3C-A', 'ZZ 2C3C P2')));
  perform pg_temp.must_fail(5, '5 REPORTS TO', 'self-reporting is refused',
    format('select public.update_project_member(%L, %L, %L, %L, %L, %L)', A, pg_temp.version('ZZ-2C3C-A'),
           pg_temp.member('ZZ-2C3C-A', 'ZZ 2C3C P1'), pg_temp.party('ZZ-2C3C-A', 'eprom'), 'Lead Engineer',
           pg_temp.member('ZZ-2C3C-A', 'ZZ 2C3C P1')), 'SELF_REPORT');
  perform pg_temp.must_fail(5, '5 REPORTS TO', 'a direct cycle (P1 -> P2 -> P1) is refused',
    format('select public.update_project_member(%L, %L, %L, %L, %L, %L)', A, pg_temp.version('ZZ-2C3C-A'),
           pg_temp.member('ZZ-2C3C-A', 'ZZ 2C3C P1'), pg_temp.party('ZZ-2C3C-A', 'eprom'), 'Lead Engineer',
           pg_temp.member('ZZ-2C3C-A', 'ZZ 2C3C P2')), 'REPORTS_TO_CYCLE');
  perform pg_temp.must_fail(5, '5 REPORTS TO', 'an indirect cycle (P1 -> P3 -> P2 -> P1) is refused',
    format('select public.update_project_member(%L, %L, %L, %L, %L, %L)', A, pg_temp.version('ZZ-2C3C-A'),
           pg_temp.member('ZZ-2C3C-A', 'ZZ 2C3C P1'), pg_temp.party('ZZ-2C3C-A', 'eprom'), 'Lead Engineer',
           pg_temp.member('ZZ-2C3C-A', 'ZZ 2C3C P3')), 'REPORTS_TO_CYCLE');
  perform pg_temp.must_fail(13, '13 CONTROLLED WRITES', 'an AUTHORIZED user cannot UPDATE directly',
    format('update public.project_members set project_role = %L where id = %L',
           'Direct edit', pg_temp.member('ZZ-2C3C-A', 'ZZ 2C3C P1')), 'permission denied for table project_members');
  perform pg_temp.must_fail(5, '5 REPORTS TO', 'Reports To a member of another project is refused',
    format('select public.update_project_member(%L, %L, %L, %L, %L, %L)', A, pg_temp.version('ZZ-2C3C-A'),
           pg_temp.member('ZZ-2C3C-A', 'ZZ 2C3C P1'), pg_temp.party('ZZ-2C3C-A', 'eprom'), 'Lead Engineer',
           pg_temp.id('B_MEMBER')), 'REPORTS_TO_INACTIVE');

  /* 6. inactive person */
  perform pg_temp.must_fail(6, '6 INACTIVE', 'an inactive person cannot join',
    format('select public.add_project_member(%L, %L, %L, %L, %L)', A, pg_temp.version('ZZ-2C3C-A'),
           pg_temp.person('ZZ 2C3C Inactive'), pg_temp.party('ZZ-2C3C-A', 'eprom'), 'Engineer'), 'INACTIVE_PERSON');

  /* 7. ending */
  perform pg_temp.must_fail(7, '7 END', 'ending a person others still report to is refused',
    format('select public.end_project_member(%L, %L, %L)', A, pg_temp.version('ZZ-2C3C-A'),
           pg_temp.member('ZZ-2C3C-A', 'ZZ 2C3C P2')), 'HAS_ACTIVE_REPORTS');
  perform pg_temp.must_pass(7, '7 END', 'ending a membership through the RPC succeeds',
    format('select public.end_project_member(%L, %L, %L)', A, pg_temp.version('ZZ-2C3C-A'),
           pg_temp.member('ZZ-2C3C-A', 'ZZ 2C3C P3')));
  perform pg_temp.must_pass(2, '2 REJOIN', 'a person may rejoin after their membership ended',
    format('select public.add_project_member(%L, %L, %L, %L, %L)', A, pg_temp.version('ZZ-2C3C-A'),
           pg_temp.person('ZZ 2C3C P3'), pg_temp.party('ZZ-2C3C-A', 'subcontractor'), 'Site Supervisor'));
  perform pg_temp.chk(2, '2 REJOIN', 'history kept: one ended + one active row for the rejoined person',
    (select count(*) filter (where ended_at is not null) = 1 and count(*) filter (where ended_at is null) = 1
       from public.project_members where project_id = A and contact_id = pg_temp.person('ZZ 2C3C P3')));
  perform pg_temp.must_fail(13, '13 CONTROLLED WRITES', 'an AUTHORIZED user cannot DELETE membership history',
    format('delete from public.project_members where project_id = %L', A), 'permission denied for table project_members');

  /* 10. assigned-project isolation */
  perform pg_temp.must_fail(10, '10 ISOLATION', 'the RPC refuses a project the user is not assigned to',
    format('select public.add_project_member(%L, %L, %L, %L, %L)', B, (select at from ids where key = 'B'),
           pg_temp.person('ZZ 2C3C P2'), pg_temp.id('B_EPROM'), 'Engineer'), 'NOT_AUTHORIZED');
  perform pg_temp.must_fail(10, '10 ISOLATION', 'a direct insert on an unassigned project is refused',
    format('insert into public.project_members (project_id, contact_id, party_id, project_role) values (%L, %L, %L, %L)',
           B, pg_temp.person('ZZ 2C3C P2'), pg_temp.id('B_EPROM'), 'Engineer'), 'permission denied for table project_members');
  perform pg_temp.must_fail(10, '10 ISOLATION', 'a direct update on an unassigned project is refused',
    format('update public.project_members set project_role = %L where project_id = %L', 'Hijacked', B), 'permission denied for table project_members');
  perform pg_temp.must_fail(10, '10 ISOLATION', 'update_project_member on an unassigned project is refused',
    format('select public.update_project_member(%L, %L, %L, %L, %L)', B, (select at from ids where key = 'B'),
           pg_temp.id('B_MEMBER'), pg_temp.id('B_EPROM'), 'Hijacked'), 'NOT_AUTHORIZED');
  perform pg_temp.must_fail(10, '10 ISOLATION', 'end_project_member on an unassigned project is refused',
    format('select public.end_project_member(%L, %L, %L)', B, (select at from ids where key = 'B'),
           pg_temp.id('B_MEMBER')), 'NOT_AUTHORIZED');
  perform pg_temp.must_fail(10, '10 ISOLATION', 'a member id from another project cannot be edited through this project',
    format('select public.update_project_member(%L, %L, %L, %L, %L)', A, pg_temp.version('ZZ-2C3C-A'),
           pg_temp.id('B_MEMBER'), pg_temp.party('ZZ-2C3C-A', 'eprom'), 'Hijacked'), 'NOT_FOUND');

  /* 12. subcontractor with team history (ended member still counts) */
  perform pg_temp.must_fail(12, '12 PARTY HISTORY', 'Project Information cannot remove a subcontractor with team history',
    format('select public.save_project_setup_relation(%L, %L, %L, %L::jsonb)', A, pg_temp.version('ZZ-2C3C-A'), 'parties', '[]'),
    'This subcontractor cannot be removed because project team history exists.');
end $pcp$;
reset role;

select pg_temp.chk(10, '10 ISOLATION', '... and changed nothing on the unassigned project (checked as table owner)',
  (select project_role from public.project_members where id = pg_temp.id('B_MEMBER')) = 'Engineer B');

-- The guard reads history regardless of who deletes (table owner here).
select pg_temp.must_fail(12, '12 PARTY HISTORY', 'a direct delete of that party is refused with the same sentence',
  format('delete from public.project_parties where id = %L', pg_temp.party('ZZ-2C3C-A', 'subcontractor')),
  'This subcontractor cannot be removed because project team history exists.');
select pg_temp.must_fail(7, '7 HISTORY', 'even the table owner cannot delete membership history',
  format('delete from public.project_members where project_id = %L', pg_temp.project('ZZ-2C3C-A')), 'MEMBER_HISTORY_PRESERVED');
/* ---- Defense in depth: the table's own invariants, proved as the table owner ---- */
select pg_temp.must_fail(2, '2 ONE ACTIVE', 'owner: a second active row is refused by the partial unique index',
  format('insert into public.project_members (project_id, contact_id, party_id, project_role) values (%L, %L, %L, %L)',
         pg_temp.project('ZZ-2C3C-A'), pg_temp.person('ZZ 2C3C P1'), pg_temp.party('ZZ-2C3C-A', 'eprom'), 'Again'),
  'project_members_one_active');
select pg_temp.must_fail(3, '3 REQUIRED', 'owner: an active insert without Party/Role is refused (constraint)',
  format('insert into public.project_members (project_id, contact_id) values (%L, %L)',
         pg_temp.project('ZZ-2C3C-A'), pg_temp.person('ZZ 2C3C P4')),
  'project_members_active_requires_party_and_role');
select pg_temp.must_fail(3, '3 REQUIRED', 'owner: creating an already-ended membership is refused',
  format('insert into public.project_members (project_id, contact_id, ended_at) values (%L, %L, now())',
         pg_temp.project('ZZ-2C3C-A'), pg_temp.person('ZZ 2C3C P4')), 'MEMBER_MUST_START_ACTIVE');
select pg_temp.must_fail(5, '5 REPORTS TO', 'owner: a direct UPDATE creating a cycle is refused',
  format('update public.project_members set reports_to_member_id = %L where id = %L',
         pg_temp.member('ZZ-2C3C-A', 'ZZ 2C3C P2'), pg_temp.member('ZZ-2C3C-A', 'ZZ 2C3C P1')), 'REPORTS_TO_CYCLE');
select pg_temp.must_fail(7, '7 END', 'owner: ending together with another change is refused',
  format('update public.project_members set ended_at = now(), project_role = %L where id = %L',
         'Changed', pg_temp.member('ZZ-2C3C-A', 'ZZ 2C3C P3')), 'END_IS_SEPARATE');
select pg_temp.must_fail(7, '7 END', 'owner: an ended membership cannot be edited',
  format('update public.project_members set project_role = %L where project_id = %L and contact_id = %L and ended_at is not null',
         'Edited', pg_temp.project('ZZ-2C3C-A'), pg_temp.person('ZZ 2C3C P3')), 'MEMBER_ENDED');
select pg_temp.must_fail(8, '8 LEGACY', 'owner: a partial edit of a legacy row is refused (must complete Party + Role)',
  format('update public.project_members set project_role = %L where id = (select m.id from public.project_members m join public.projects p on p.id = m.project_id where p.code = %L and m.party_id is null and m.ended_at is null limit 1)',
         'Sponsor', 'MDP-PIPE-04'), 'project_members_active_requires_party_and_role');
select pg_temp.must_fail(9, '9 ARCHIVED', 'owner: a direct write on an archived project is refused by the trigger',
  format('update public.project_members set ended_at = now() where id = (select m.id from public.project_members m join public.projects p on p.id = m.project_id where p.status = %L and m.ended_at is null limit 1)',
         'archived'), 'PROJECT_ARCHIVED');

/* ---- 13. The privilege model itself ---- */
select pg_temp.chk(13, '13 CONTROLLED WRITES', 'authenticated: SELECT only — no INSERT / UPDATE / DELETE on project_members',
  has_table_privilege('authenticated', 'public.project_members', 'SELECT')
  and not has_table_privilege('authenticated', 'public.project_members', 'INSERT')
  and not has_table_privilege('authenticated', 'public.project_members', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.project_members', 'DELETE'));
select pg_temp.chk(13, '13 CONTROLLED WRITES', 'anon: no access to project_members',
  not has_table_privilege('anon', 'public.project_members', 'SELECT')
  and not has_table_privilege('anon', 'public.project_members', 'INSERT')
  and not has_table_privilege('anon', 'public.project_members', 'UPDATE'));
select pg_temp.chk(13, '13 CONTROLLED WRITES', 'no write policy remains on project_members',
  not exists (select 1 from pg_catalog.pg_policies where tablename = 'project_members' and cmd <> 'SELECT'));
select pg_temp.chk(13, '13 CONTROLLED WRITES', 'the three writers are SECURITY DEFINER with an empty search_path',
  (select count(*) from pg_catalog.pg_proc
    where proname in ('add_project_member', 'update_project_member', 'end_project_member')
      and prosecdef and proconfig @> array['search_path=""']) = 3);
select pg_temp.chk(13, '13 CONTROLLED WRITES', 'EXECUTE: authenticated yes; anon, service_role and PUBLIC no',
  (select bool_and(has_function_privilege('authenticated', oid, 'EXECUTE')
                   and not has_function_privilege('anon', oid, 'EXECUTE')
                   and not has_function_privilege('service_role', oid, 'EXECUTE'))
     from pg_catalog.pg_proc where proname in ('add_project_member', 'update_project_member', 'end_project_member')));
-- Built as the table owner (anon cannot read the lookup tables), run as anon.
create temp table anon_sql(q text) on commit drop;
grant select on anon_sql to anon;
insert into anon_sql
select format('select public.add_project_member(%L, now(), %L, %L, %L)', pg_temp.project('ZZ-2C3C-A'),
              pg_temp.person('ZZ 2C3C P4'), pg_temp.party('ZZ-2C3C-A', 'eprom'), 'Anon');
do $anon$
declare
  v_sql text := (select q from anon_sql);
begin
  set local role anon;
  perform pg_temp.must_fail(13, '13 CONTROLLED WRITES', 'anon cannot execute add_project_member',
    v_sql, 'permission denied for function');
end $anon$;
reset role;
select pg_temp.chk(13, '13 CONTROLLED WRITES', 'rows written through the RPC record the signed-in caller as created_by',
  (select created_by from public.project_members
    where project_id = pg_temp.project('ZZ-2C3C-A') and contact_id = pg_temp.person('ZZ 2C3C P1') and ended_at is null)
  = '00000000-0000-4000-a000-0000002c3c01');

select pg_temp.must_pass(12, '12 PARTY HISTORY', 'a subcontractor with no team history can still be removed',
  format('insert into public.project_parties (project_id, kind, name, scope, engagement_status, sort_order) values (%L, %L, %L, %L, %L, 3); '
         'delete from public.project_parties where project_id = %L and name = %L',
         pg_temp.project('ZZ-2C3C-A'), 'subcontractor', 'ZZ Unused Sub', 'Paint', 'planned',
         pg_temp.project('ZZ-2C3C-A'), 'ZZ Unused Sub'));

/* ================== As a plain member (P1 on project A) ================== */

select pg_temp.chk(11, '11 NO AUTHORITY', 'P1 IS an active project member with Party and Project Role (checked as table owner)',
  exists (select 1 from public.project_members m
           where m.project_id = pg_temp.project('ZZ-2C3C-A') and m.contact_id = pg_temp.person('ZZ 2C3C P1')
             and m.ended_at is null and m.party_id is not null and m.project_role is not null));
select pg_temp.chk(11, '11 NO AUTHORITY', 'P1 has no project_contacts assignment on A (membership is the only link)',
  not exists (select 1 from public.project_contacts pc
               where pc.project_id = pg_temp.project('ZZ-2C3C-A') and pc.contact_id = pg_temp.person('ZZ 2C3C P1')));
create temp table a_version(at timestamptz) on commit drop;
grant select on a_version to authenticated;
insert into a_version values (pg_temp.version('ZZ-2C3C-A'));

do $member$
declare
  A uuid := pg_temp.project('ZZ-2C3C-A');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3c02","role":"authenticated"}';
  perform pg_temp.chk(11, '11 NO AUTHORITY', 'the signed-in member resolves to P1''s person record',
    public.current_contact_id() = pg_temp.person('ZZ 2C3C P1'));
  perform pg_temp.chk(11, '11 NO AUTHORITY', 'membership grants no Project Setup / Responsibility / Operations authority',
    not public.can_manage_project_setup(A) and not public.can_manage_project_responsibilities(A)
    and not public.can_manage_project_operations(A));
  perform pg_temp.chk(11, '11 NO AUTHORITY', 'membership grants no Project Control / Report Coordinator / reporting authority',
    not public.is_project_control_planning(A) and not public.is_report_coordinator(A)
    and not public.can_manage_reporting_workflow(A));
  perform pg_temp.chk(11, '11 NO AUTHORITY', 'membership grants no global authority',
    not public.has_global_operational_authority() and not public.is_system_admin());
  perform pg_temp.must_fail(11, '11 NO AUTHORITY', 'a member cannot manage the team through the RPC',
    format('select public.add_project_member(%L, %L, %L, %L, %L)', A, (select at from a_version),
           pg_temp.person('ZZ 2C3C P4'), pg_temp.party('ZZ-2C3C-A', 'eprom'), 'Engineer'), 'NOT_AUTHORIZED');
  perform pg_temp.chk(11, '11 VISIBILITY', 'membership grants no operational project access either (existing model unchanged)',
    not public.has_operational_project_access(A));
end $member$;
reset role;

/* ============== As Project Control Admin: legacy + archived ============== */

-- Since 2C.3D Wave 2 a membership cannot end while the person holds a fixed
-- responsibility, a project position or a department assignment. Every
-- backfilled legacy member holds one of those, so (rolled back, as the owner)
-- the chosen member's fixed responsibility is cleared first: check 8 still
-- proves the 2C.3C rule that ending needs no Party / Project Role.
do $release$
declare
  v_member public.project_members;
begin
  select m.* into v_member from public.project_members m join public.projects p on p.id = m.project_id
   where p.code = 'MDP-PIPE-04' and m.party_id is null and m.ended_at is null order by m.id limit 1;
  update public.projects p
     set project_manager_id = nullif(p.project_manager_id, v_member.contact_id),
         project_control_manager_id = nullif(p.project_control_manager_id, v_member.contact_id),
         reporting_coordinator_id = nullif(p.reporting_coordinator_id, v_member.contact_id),
         client_representative_id = nullif(p.client_representative_id, v_member.contact_id),
         project_sponsor_id = nullif(p.project_sponsor_id, v_member.contact_id)
   where p.id = v_member.project_id;
end $release$;

do $pca$
declare
  LEGACY uuid := (select m.id from public.project_members m
                   join public.projects p on p.id = m.project_id
                  where p.code = 'MDP-PIPE-04' and m.party_id is null and m.ended_at is null
                  order by m.id limit 1);
  ARCHIVED_MEMBER uuid := (select m.id from public.project_members m
                            join public.projects p on p.id = m.project_id
                           where p.status = 'archived' and m.ended_at is null limit 1);
  ARCHIVED uuid := (select m.project_id from public.project_members m where m.id = ARCHIVED_MEMBER);
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3c03","role":"authenticated"}';

  /* 8. legacy */
  perform pg_temp.chk(8, '8 LEGACY', 'a backfilled legacy row exists (Needs party / Needs project role)',
    LEGACY is not null);
  perform pg_temp.must_fail(8, '8 LEGACY', 'editing a legacy member without a Project Role is refused',
    format('select public.update_project_member(%L, %L, %L, %L, %L)', pg_temp.project('MDP-PIPE-04'),
           pg_temp.version('MDP-PIPE-04'), LEGACY, pg_temp.party('MDP-PIPE-04', 'eprom'), ''), 'PROJECT_ROLE_REQUIRED');
  perform pg_temp.must_fail(13, '13 CONTROLLED WRITES', 'even a global authority cannot UPDATE directly',
    format('update public.project_members set project_role = %L where id = %L', 'Sponsor', LEGACY), 'permission denied for table project_members');
  perform pg_temp.must_pass(8, '8 LEGACY', 'an incomplete legacy membership can be ENDED as it is',
    format('select public.end_project_member(%L, %L, %L)', pg_temp.project('MDP-PIPE-04'),
           pg_temp.version('MDP-PIPE-04'), LEGACY));

  /* 9. archived */
  perform pg_temp.must_fail(9, '9 ARCHIVED', 'update on an archived project is refused',
    format('select public.update_project_member(%L, now(), %L, %L, %L)', ARCHIVED, ARCHIVED_MEMBER,
           (select id from public.project_parties where project_id = ARCHIVED and kind = 'eprom'), 'Role'), 'PROJECT_ARCHIVED');
  perform pg_temp.must_fail(9, '9 ARCHIVED', 'end on an archived project is refused',
    format('select public.end_project_member(%L, now(), %L)', ARCHIVED, ARCHIVED_MEMBER), 'PROJECT_ARCHIVED');
  perform pg_temp.must_fail(9, '9 ARCHIVED', 'add on an archived project is refused',
    format('select public.add_project_member(%L, now(), %L, %L, %L)', ARCHIVED, pg_temp.person('ZZ 2C3C P4'),
           (select id from public.project_parties where project_id = ARCHIVED and kind = 'eprom'), 'Role'), 'PROJECT_ARCHIVED');
end $pca$;
reset role;

/* =============================== results ================================= */

\set QUIET off
select seq, area, item, verdict from r order by seq, area, item;
select count(*) filter (where verdict like 'PASS%') as passed,
       count(*) filter (where verdict like 'FAIL%') as failed,
       count(*) as total
  from r;

rollback;
\echo 2C.3C runtime verification complete. Transaction rolled back; nothing persisted.

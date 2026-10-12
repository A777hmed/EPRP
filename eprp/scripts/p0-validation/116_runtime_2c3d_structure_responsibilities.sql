-- Phase 2C.3D Wave 1 Structure Responsibilities — RUNTIME verification. LOCAL DATABASE ONLY.
--
-- Proves 20261012100000_structure_responsibilities.sql against real
-- PostgreSQL, real RLS and real authenticated roles. Everything — fixtures,
-- accounts and every write — runs in ONE transaction that is ROLLED BACK.
-- Nothing persists.
--
--   0  baseline: both tables exist and start empty (no backfill)
--   1  the writer saves one unit's people; stale version refused (PT409);
--      re-saving the same state changes no row
--   2  controlled writes only: no direct INSERT / UPDATE / DELETE for callers
--   3  many-to-many: one person in several units
--   4  Unit Lead: must be a unit member; one active Lead; changing the Lead
--      keeps the person's member row and their responsibilities
--   5  Weekly / Monthly responsibility: unit member only, unit must owe the
--      report, Backup needs a Responsible, Responsible != Backup; replacing
--      the Responsible keeps an unchanged Backup's history
--   6  state: inactive / cross-project member, cross-project / archived unit,
--      duplicate input
--   7  explicit guards: membership end, unit archive, flag-off, hard delete
--   8  table invariants bind even the table owner: created active, ended rows
--      immutable, identity immutable, never deleted, Lead / responsibility
--      ordering, Backup checked at commit, Other projects only
--   9  completed membership (Party + Project Role) for Lead / Responsible /
--      Backup; an incomplete legacy member may still be a normal unit member
--  10  archived projects are read-only
--  11  authority: global admin and assigned Project Control / Planning only;
--      Reporting Coordinator, outsiders and anon refused
--  12  ZERO authority: a Unit Lead / Responsible gains no access or write right
--  13  catalog: privileges, hardened writer, triggers, no authority readers
--  14  history is kept: ended rows exist, nothing was deleted
--
-- Uses existing data read-only (ZZ-P0TEST-PRJ as a fixture template and the
-- legacy incomplete members of ZZ-STRUCT-UI-01) and creates its own projects,
-- people and accounts inside the rolled-back transaction.
--
-- HOW TO RUN (after the migration is applied; from eprp/):
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < scripts/p0-validation/116_runtime_2c3d_structure_responsibilities.sql

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
    case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end ||
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

-- The Backup rule is checked when the transaction commits. This rehearsal
-- never commits, so the pending check is forced here and then deferred again.
create or replace function pg_temp.must_fail_at_commit(
  p_seq int, p_area text, p_item text, p_sql text, p_expect text
) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    execute 'set constraints public.check_structure_report_backup immediate';
    perform pg_temp.chk(p_seq, p_area, p_item, false, 'statement was ACCEPTED at commit');
  exception when others then
    perform pg_temp.chk(p_seq, p_area, p_item, position(p_expect in sqlerrm) > 0,
      'refused [' || sqlstate || ']: ' || left(sqlerrm, 100));
  end;
  execute 'set constraints public.check_structure_report_backup deferred';
end $$;

create or replace function pg_temp.commit_check_passes(p_seq int, p_area text, p_item text)
returns void language plpgsql as $$
begin
  begin
    execute 'set constraints public.check_structure_report_backup immediate';
    perform pg_temp.chk(p_seq, p_area, p_item, true);
  exception when others then
    perform pg_temp.chk(p_seq, p_area, p_item, false, '[' || sqlstate || '] ' || left(sqlerrm, 110));
  end;
  execute 'set constraints public.check_structure_report_backup deferred';
end $$;

create or replace function pg_temp.project(p_code text) returns uuid
language sql as $$ select id from public.projects where code = p_code $$;
create or replace function pg_temp.version(p_code text) returns timestamptz
language sql as $$ select updated_at from public.projects where code = p_code $$;
create or replace function pg_temp.person(p_name text) returns uuid
language sql as $$ select id from public.contacts where name = p_name $$;
create or replace function pg_temp.party(p_code text, p_kind text) returns uuid
language sql as $$ select pp.id from public.project_parties pp join public.projects p on p.id = pp.project_id
                    where p.code = p_code and pp.kind = p_kind limit 1 $$;
create or replace function pg_temp.member(p_code text, p_name text) returns uuid
language sql as $$ select m.id from public.project_members m
                    where m.project_id = pg_temp.project(p_code) and m.contact_id = pg_temp.person(p_name)
                    order by (m.ended_at is null) desc, m.created_at desc limit 1 $$;
create or replace function pg_temp.node(p_code text, p_name text) returns uuid
language sql as $$ select n.id from public.project_structure_nodes n
                    where n.project_id = pg_temp.project(p_code) and n.name = p_name $$;
-- One writer call as SQL text, with the CURRENT project version unless given.
create or replace function pg_temp.save_sql(
  p_project uuid, p_node uuid, p_members uuid[], p_lead uuid default null,
  p_wr uuid default null, p_wb uuid default null, p_mr uuid default null, p_mb uuid default null,
  p_version timestamptz default null
) returns text language sql as $$
  select format('select public.save_structure_unit_responsibilities(%L::uuid, %L::timestamptz, %L::uuid, %L::uuid[], %L::uuid, %L::uuid, %L::uuid, %L::uuid, %L::uuid)',
                p_project, coalesce(p_version, (select updated_at from public.projects where id = p_project)),
                p_node, p_members, p_lead, p_wr, p_wb, p_mr, p_mb)
$$;
create or replace function pg_temp.active_unit(p_node uuid, p_member uuid, p_role text) returns uuid
language sql as $$ select a.id from public.project_structure_unit_members a
                    where a.node_id = p_node and a.member_id = p_member and a.unit_role = p_role and a.ended_at is null $$;
create or replace function pg_temp.active_resp(p_node uuid, p_kind text, p_resp text) returns uuid
language sql as $$ select r.member_id from public.project_structure_report_responsibilities r
                    where r.node_id = p_node and r.report_kind = p_kind and r.responsibility = p_resp and r.ended_at is null $$;

/* ============================ 0. baseline ============================== */

do $baseline$
begin
  if to_regclass('public.project_structure_unit_members') is null then
    raise exception 'project_structure_unit_members not found — apply 20261012100000_structure_responsibilities.sql first.';
  end if;
  perform pg_temp.chk(0, '00 BASELINE', 'both new tables start empty (no backfill, no fabricated assignments)',
    (select count(*) from public.project_structure_unit_members) = 0
    and (select count(*) from public.project_structure_report_responsibilities) = 0);
end $baseline$;

/* ========================= fixtures (as postgres) ======================== */

do $fix$
declare
  v_template uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  v_type uuid;
begin
  if v_template is null then
    raise exception 'ZZ-P0TEST-PRJ not found — this script expects the local development dataset.';
  end if;

  insert into public.project_types (name, code) values ('ZZ 2C.3D Category', 'ZZ-2C3D-CAT') returning id into v_type;
  insert into public.projects (code, name, client_id, planned_start_date, planned_finish_date,
                               status, structure_family, project_type_id)
  select 'ZZ-2C3D-' || v.s, 'ZZ 2C.3D ' || v.s, p.client_id, p.planned_start_date, p.planned_finish_date,
         'active', v.family, case when v.family = 'other' then v_type end
    from public.projects p,
         (values ('A', 'other'), ('B', 'other'), ('ARC', 'other'), ('PSM', 'psm')) v(s, family)
   where p.id = v_template;

  insert into public.contacts (name, email, active) values
    ('ZZ 2C3D P1', 'zz.2c3d.p1@example.invalid', true),
    ('ZZ 2C3D P2', 'zz.2c3d.p2@example.invalid', true),
    ('ZZ 2C3D P3', 'zz.2c3d.p3@example.invalid', true),
    ('ZZ 2C3D P4', 'zz.2c3d.p4@example.invalid', true),
    ('ZZ 2C3D P5', 'zz.2c3d.p5@example.invalid', true),
    ('ZZ 2C3D P6', 'zz.2c3d.p6@example.invalid', true),
    ('ZZ 2C3D PCM', 'zz.2c3d.pcm@example.invalid', true),
    ('ZZ 2C3D PCA', 'zz.2c3d.pca@example.invalid', true),
    ('ZZ 2C3D RC', 'zz.2c3d.rc@example.invalid', true),
    ('ZZ 2C3D OUT', 'zz.2c3d.out@example.invalid', true);

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', v.id::uuid, 'authenticated', 'authenticated', v.email,
         'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb,
         '{}'::jsonb, now(), now()
    from (values ('00000000-0000-4000-a000-0000002c3d01', 'zz.2c3d.pcm@example.invalid'),
                 ('00000000-0000-4000-a000-0000002c3d02', 'zz.2c3d.pca@example.invalid'),
                 ('00000000-0000-4000-a000-0000002c3d03', 'zz.2c3d.rc@example.invalid'),
                 ('00000000-0000-4000-a000-0000002c3d04', 'zz.2c3d.out@example.invalid'),
                 ('00000000-0000-4000-a000-0000002c3d05', 'zz.2c3d.p1@example.invalid')) v(id, email);

  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select v.id::uuid, v.email, v.name, v.role, pg_temp.person(v.name), true
    from (values ('00000000-0000-4000-a000-0000002c3d01', 'zz.2c3d.pcm@example.invalid', 'ZZ 2C3D PCM', 'viewer'),
                 ('00000000-0000-4000-a000-0000002c3d02', 'zz.2c3d.pca@example.invalid', 'ZZ 2C3D PCA', 'project_control_admin'),
                 ('00000000-0000-4000-a000-0000002c3d03', 'zz.2c3d.rc@example.invalid', 'ZZ 2C3D RC', 'viewer'),
                 ('00000000-0000-4000-a000-0000002c3d04', 'zz.2c3d.out@example.invalid', 'ZZ 2C3D OUT', 'viewer'),
                 ('00000000-0000-4000-a000-0000002c3d05', 'zz.2c3d.p1@example.invalid', 'ZZ 2C3D P1', 'viewer')) v(id, email, name, role);

  -- Project Control / Planning on A and ARC only (the existing model); a
  -- Reporting Coordinator on A.
  insert into public.project_contacts (project_id, contact_id, role)
  values (pg_temp.project('ZZ-2C3D-A'), pg_temp.person('ZZ 2C3D PCM'), 'project_control_manager'),
         (pg_temp.project('ZZ-2C3D-ARC'), pg_temp.person('ZZ 2C3D PCM'), 'project_control_manager'),
         (pg_temp.project('ZZ-2C3D-A'), pg_temp.person('ZZ 2C3D RC'), 'reporting_coordinator');

  -- Complete memberships (as the table owner; triggers still apply).
  insert into public.project_members (project_id, contact_id, party_id, project_role)
  select pg_temp.project(v.code), pg_temp.person(v.name), pg_temp.party(v.code, v.kind), v.role
    from (values ('ZZ-2C3D-A', 'ZZ 2C3D P1', 'eprom', 'Civil Lead'),
                 ('ZZ-2C3D-A', 'ZZ 2C3D P2', 'owner', 'Client Engineer'),
                 ('ZZ-2C3D-A', 'ZZ 2C3D P3', 'eprom', 'Engineer'),
                 ('ZZ-2C3D-A', 'ZZ 2C3D P5', 'eprom', 'Piping Engineer'),
                 ('ZZ-2C3D-A', 'ZZ 2C3D P6', 'eprom', 'Former Engineer'),
                 ('ZZ-2C3D-B', 'ZZ 2C3D P4', 'eprom', 'Engineer B'),
                 ('ZZ-2C3D-ARC', 'ZZ 2C3D P1', 'eprom', 'Archived Lead')) v(code, name, kind, role);
  update public.project_members set ended_at = clock_timestamp()
   where id = pg_temp.member('ZZ-2C3D-A', 'ZZ 2C3D P6');

  -- Structures.
  insert into public.project_structure_levels (project_id, level_number, singular_label, plural_label)
  values (pg_temp.project('ZZ-2C3D-A'), 1, 'Function', 'Functions'),
         (pg_temp.project('ZZ-2C3D-A'), 2, 'Workstream', 'Workstreams'),
         (pg_temp.project('ZZ-2C3D-B'), 1, 'Package', 'Packages'),
         (pg_temp.project('ZZ-2C3D-ARC'), 1, 'Phase', 'Phases');
  insert into public.project_structure_nodes (project_id, level_number, name, code, weekly_reporting_required)
  values (pg_temp.project('ZZ-2C3D-A'), 1, 'Civil', 'CIV', true),
         (pg_temp.project('ZZ-2C3D-A'), 1, 'Mech', 'MEC', false),
         (pg_temp.project('ZZ-2C3D-A'), 1, 'Spare', 'SPR', false),
         (pg_temp.project('ZZ-2C3D-B'), 1, 'B Unit', 'BU', true),
         (pg_temp.project('ZZ-2C3D-ARC'), 1, 'ARC Unit', 'AU', true);
  insert into public.project_structure_nodes (project_id, level_number, parent_id, name, code, monthly_reporting_required)
  values (pg_temp.project('ZZ-2C3D-A'), 2, pg_temp.node('ZZ-2C3D-A', 'Civil'), 'Earthworks', 'EW', true),
         (pg_temp.project('ZZ-2C3D-A'), 2, pg_temp.node('ZZ-2C3D-A', 'Mech'), 'Piping', 'PIP', false);

  -- ARC: people assigned before the project is archived (as the owner).
  insert into public.project_structure_unit_members (project_id, node_id, member_id, unit_role)
  values (pg_temp.project('ZZ-2C3D-ARC'), pg_temp.node('ZZ-2C3D-ARC', 'ARC Unit'),
          pg_temp.member('ZZ-2C3D-ARC', 'ZZ 2C3D P1'), 'member');
  insert into public.project_structure_report_responsibilities
    (project_id, node_id, member_id, unit_member_id, report_kind, responsibility)
  select a.project_id, a.node_id, a.member_id, a.id, 'weekly', 'responsible'
    from public.project_structure_unit_members a where a.node_id = pg_temp.node('ZZ-2C3D-ARC', 'ARC Unit');
  update public.projects set status = 'archived' where id = pg_temp.project('ZZ-2C3D-ARC');
end;
$fix$;

-- Ids of rows the project-A user cannot see, captured as the table owner.
create temp table ids(key text primary key, id uuid) on commit drop;
grant select on ids to authenticated, anon;
insert into ids values
  ('B', pg_temp.project('ZZ-2C3D-B')),
  ('B_UNIT', pg_temp.node('ZZ-2C3D-B', 'B Unit')),
  ('B_MEMBER', pg_temp.member('ZZ-2C3D-B', 'ZZ 2C3D P4')),
  ('ARC', pg_temp.project('ZZ-2C3D-ARC')),
  ('ARC_UNIT', pg_temp.node('ZZ-2C3D-ARC', 'ARC Unit')),
  ('ARC_MEMBER', pg_temp.member('ZZ-2C3D-ARC', 'ZZ 2C3D P1')),
  ('PSM', pg_temp.project('ZZ-2C3D-PSM'));
create or replace function pg_temp.id(p_key text) returns uuid
language sql as $$ select id from ids where key = p_key $$;

/* ============ As Project Control / Planning assigned to project A ======== */

do $pcm$
declare
  -- Resolved BEFORE the identity switch (DECLARE runs first).
  A      uuid := pg_temp.project('ZZ-2C3D-A');
  CIVIL  uuid := pg_temp.node('ZZ-2C3D-A', 'Civil');
  EARTH  uuid := pg_temp.node('ZZ-2C3D-A', 'Earthworks');
  MECH   uuid := pg_temp.node('ZZ-2C3D-A', 'Mech');
  PIPING uuid := pg_temp.node('ZZ-2C3D-A', 'Piping');
  SPARE  uuid := pg_temp.node('ZZ-2C3D-A', 'Spare');
  P1 uuid := pg_temp.member('ZZ-2C3D-A', 'ZZ 2C3D P1');
  P2 uuid := pg_temp.member('ZZ-2C3D-A', 'ZZ 2C3D P2');
  P3 uuid := pg_temp.member('ZZ-2C3D-A', 'ZZ 2C3D P3');
  P5 uuid := pg_temp.member('ZZ-2C3D-A', 'ZZ 2C3D P5');
  P6 uuid := pg_temp.member('ZZ-2C3D-A', 'ZZ 2C3D P6');
  v_old timestamptz;
  v_res jsonb;
  v_rows bigint;
  v_p1_member uuid;
  v_backup_row uuid;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3d01","role":"authenticated"}';

  /* 1. writer basics */
  v_old := pg_temp.version('ZZ-2C3D-A');
  begin
    v_res := public.save_structure_unit_responsibilities(A, v_old, CIVIL, array[P1, P2, P3], P1, P1, P2, null, null);
    perform pg_temp.chk(1, '01 WRITER', 'saves Civil: 3 members, Lead P1, Weekly Responsible P1, Backup P2',
      (select count(*) from public.project_structure_unit_members where node_id = CIVIL and unit_role = 'member' and ended_at is null) = 3
      and pg_temp.active_unit(CIVIL, P1, 'lead') is not null
      and pg_temp.active_resp(CIVIL, 'weekly', 'responsible') = P1
      and pg_temp.active_resp(CIVIL, 'weekly', 'backup') = P2);
    perform pg_temp.chk(1, '01 WRITER', 'returns the project''s new version',
      (v_res->>'version')::timestamptz = pg_temp.version('ZZ-2C3D-A'));
  exception when others then
    perform pg_temp.chk(1, '01 WRITER', 'saves Civil: 3 members, Lead P1, Weekly Responsible P1, Backup P2', false, left(sqlerrm, 110));
  end;
  perform pg_temp.must_fail(1, '01 STALE', 'an old project version is refused as stale (PT409)',
    pg_temp.save_sql(A, CIVIL, array[P1, P2], p_version => v_old), 'PT409');
  v_rows := (select count(*) from public.project_structure_unit_members where project_id = A)
          + (select count(*) from public.project_structure_report_responsibilities where project_id = A);
  perform pg_temp.must_pass(1, '01 WRITER', 're-saving the same state is accepted',
    pg_temp.save_sql(A, CIVIL, array[P1, P2, P3], P1, P1, P2));
  perform pg_temp.chk(1, '01 WRITER', 're-saving the same state adds and ends no row',
    v_rows = (select count(*) from public.project_structure_unit_members where project_id = A)
           + (select count(*) from public.project_structure_report_responsibilities where project_id = A)
    and not exists (select 1 from public.project_structure_unit_members where project_id = A and ended_at is not null));

  /* 2. controlled writes only */
  perform pg_temp.must_fail(2, '02 CONTROLLED WRITES', 'an AUTHORIZED user cannot INSERT a unit member directly',
    format('insert into public.project_structure_unit_members (project_id, node_id, member_id, unit_role) values (%L, %L, %L, %L)',
           A, MECH, P1, 'member'), 'permission denied');
  perform pg_temp.must_fail(2, '02 CONTROLLED WRITES', 'an AUTHORIZED user cannot UPDATE a unit member directly',
    format('update public.project_structure_unit_members set ended_at = now() where node_id = %L', CIVIL), 'permission denied');
  perform pg_temp.must_fail(2, '02 CONTROLLED WRITES', 'an AUTHORIZED user cannot DELETE a responsibility directly',
    format('delete from public.project_structure_report_responsibilities where node_id = %L', CIVIL), 'permission denied');
  perform pg_temp.must_fail(2, '02 CONTROLLED WRITES', 'an AUTHORIZED user cannot INSERT a responsibility directly',
    format('insert into public.project_structure_report_responsibilities (project_id, node_id, member_id, unit_member_id, report_kind, responsibility) values (%L, %L, %L, %L, %L, %L)',
           A, CIVIL, P3, pg_temp.active_unit(CIVIL, P3, 'member'), 'weekly', 'backup'), 'permission denied');

  /* 3. many-to-many */
  perform pg_temp.must_pass(3, '03 MANY-TO-MANY', 'Earthworks: members P1 + P3, Monthly Responsible P3, Backup P1',
    pg_temp.save_sql(A, EARTH, array[P1, P3], null, null, null, P3, P1));
  perform pg_temp.chk(3, '03 MANY-TO-MANY', 'P1 is an active member of two units',
    (select count(*) from public.project_structure_unit_members
      where project_id = A and member_id = P1 and unit_role = 'member' and ended_at is null) = 2);

  /* 4. Unit Lead */
  perform pg_temp.must_fail(4, '04 LEAD', 'a Lead who is not in the unit''s members is refused',
    pg_temp.save_sql(A, CIVIL, array[P1, P2, P3], P5, P1, P2), 'LEAD_NOT_UNIT_MEMBER');
  v_p1_member := pg_temp.active_unit(CIVIL, P1, 'member');
  perform pg_temp.must_pass(4, '04 LEAD', 'changing the Lead from P1 to P3 is accepted',
    pg_temp.save_sql(A, CIVIL, array[P1, P2, P3], P3, P1, P2));
  perform pg_temp.chk(4, '04 LEAD', 'the old Lead row is ended (history) and P3 is the one active Lead',
    pg_temp.active_unit(CIVIL, P1, 'lead') is null
    and pg_temp.active_unit(CIVIL, P3, 'lead') is not null
    and exists (select 1 from public.project_structure_unit_members
                 where node_id = CIVIL and member_id = P1 and unit_role = 'lead' and ended_at is not null)
    and (select count(*) from public.project_structure_unit_members where node_id = CIVIL and unit_role = 'lead' and ended_at is null) = 1);
  perform pg_temp.chk(4, '04 LEAD', 'P1''s member row and Weekly responsibility are untouched by the Lead change',
    pg_temp.active_unit(CIVIL, P1, 'member') = v_p1_member
    and exists (select 1 from public.project_structure_report_responsibilities
                 where node_id = CIVIL and member_id = P1 and unit_member_id = v_p1_member
                   and report_kind = 'weekly' and responsibility = 'responsible' and ended_at is null));

  /* 5. reporting responsibility */
  perform pg_temp.must_fail(5, '05 RESPONSIBILITY', 'a Responsible from outside the unit is refused',
    pg_temp.save_sql(A, CIVIL, array[P1, P2, P3], P3, P5, null), 'RESPONSIBLE_NOT_UNIT_MEMBER');
  perform pg_temp.must_fail(5, '05 RESPONSIBILITY', 'a Backup without a Responsible is refused',
    pg_temp.save_sql(A, CIVIL, array[P1, P2, P3], P3, null, P2), 'BACKUP_WITHOUT_RESPONSIBLE');
  perform pg_temp.must_fail(5, '05 RESPONSIBILITY', 'the same person as Responsible and Backup is refused',
    pg_temp.save_sql(A, CIVIL, array[P1, P2, P3], P3, P1, P1), 'SAME_PERSON');
  perform pg_temp.must_fail(5, '05 RESPONSIBILITY', 'Weekly responsibility on a unit without Weekly input is refused',
    pg_temp.save_sql(A, MECH, array[P1], null, P1), 'UNIT_NOT_REPORTING');
  perform pg_temp.must_fail(5, '05 RESPONSIBILITY', 'Monthly responsibility on a unit without Monthly input is refused',
    pg_temp.save_sql(A, CIVIL, array[P1, P2, P3], P3, P1, P2, P1), 'UNIT_NOT_REPORTING');
  v_backup_row := (select id from public.project_structure_report_responsibilities
                    where node_id = CIVIL and report_kind = 'weekly' and responsibility = 'backup' and ended_at is null);
  perform pg_temp.must_pass(5, '05 RESPONSIBILITY', 'replacing the Weekly Responsible (P1 -> P3) with the Backup unchanged is accepted',
    pg_temp.save_sql(A, CIVIL, array[P1, P2, P3], P3, P3, P2));
  perform pg_temp.chk(5, '05 RESPONSIBILITY', 'old Responsible ended; Backup row kept with the same id',
    pg_temp.active_resp(CIVIL, 'weekly', 'responsible') = P3
    and exists (select 1 from public.project_structure_report_responsibilities
                 where node_id = CIVIL and member_id = P1 and report_kind = 'weekly' and ended_at is not null)
    and (select id from public.project_structure_report_responsibilities
          where node_id = CIVIL and report_kind = 'weekly' and responsibility = 'backup' and ended_at is null) = v_backup_row);
  perform pg_temp.commit_check_passes(5, '05 RESPONSIBILITY', 'the commit-time Backup check passes after the replacement');
  perform pg_temp.must_pass(5, '05 RESPONSIBILITY', 'swapping Responsible and Backup (P2 responsible, P3 backup) is accepted',
    pg_temp.save_sql(A, CIVIL, array[P1, P2, P3], P3, P2, P3));
  perform pg_temp.chk(5, '05 RESPONSIBILITY', 'after the swap: P2 Responsible, P3 Backup, one of each',
    pg_temp.active_resp(CIVIL, 'weekly', 'responsible') = P2 and pg_temp.active_resp(CIVIL, 'weekly', 'backup') = P3);
  perform pg_temp.must_pass(5, '05 RESPONSIBILITY', 'clearing the Backup is accepted',
    pg_temp.save_sql(A, CIVIL, array[P1, P2, P3], P3, P2, null));
  perform pg_temp.chk(5, '05 RESPONSIBILITY', 'no active Weekly Backup remains on Civil',
    pg_temp.active_resp(CIVIL, 'weekly', 'backup') is null);

  /* 6. state */
  perform pg_temp.must_fail(6, '06 STATE', 'an ended project member is refused',
    pg_temp.save_sql(A, MECH, array[P6]), 'MEMBER_NOT_ACTIVE');
  perform pg_temp.must_fail(6, '06 STATE', 'a member of another project is refused',
    pg_temp.save_sql(A, MECH, array[pg_temp.id('B_MEMBER')]), 'MEMBER_NOT_ACTIVE');
  perform pg_temp.must_fail(6, '06 STATE', 'a unit of another project is refused',
    pg_temp.save_sql(A, pg_temp.id('B_UNIT'), array[P1]), 'UNIT_NOT_FOUND');
  perform pg_temp.must_fail(6, '06 STATE', 'a member listed twice is refused',
    pg_temp.save_sql(A, MECH, array[P1, P1]), 'INVALID_INPUT');

  /* 7. explicit guards */
  perform pg_temp.must_pass(7, '07 GUARDS', 'Piping: P5 as a plain member is accepted',
    pg_temp.save_sql(A, PIPING, array[P5]));
  perform pg_temp.must_fail(7, '07 GUARDS', 'ending the membership of a plain unit member is refused',
    format('select public.end_project_member(%L, %L, %L)', A, pg_temp.version('ZZ-2C3D-A'), P5), 'MEMBER_HAS_UNIT_ASSIGNMENTS');
  perform pg_temp.must_fail(7, '07 GUARDS', 'ending the membership of a Lead / Responsible is refused',
    format('select public.end_project_member(%L, %L, %L)', A, pg_temp.version('ZZ-2C3D-A'), P3), 'MEMBER_HAS_UNIT_RESPONSIBILITY');
  perform pg_temp.must_fail(7, '07 GUARDS', 'ending the membership of a Backup is refused',
    format('select public.end_project_member(%L, %L, %L)', A, pg_temp.version('ZZ-2C3D-A'), P1), 'MEMBER_HAS_UNIT_RESPONSIBILITY');
  perform pg_temp.must_fail(7, '07 GUARDS', 'archiving a unit with active people is refused',
    format('update public.project_structure_nodes set archived_at = now() where id = %L', PIPING), 'UNIT_HAS_ACTIVE_PEOPLE');
  perform pg_temp.must_fail(7, '07 GUARDS', 'turning off Weekly input with an active Weekly Responsible is refused',
    format('update public.project_structure_nodes set weekly_reporting_required = false where id = %L', CIVIL), 'WEEKLY_RESPONSIBILITY_EXISTS');
  perform pg_temp.must_fail(7, '07 GUARDS', 'turning off Monthly input with an active Monthly Responsible is refused',
    format('update public.project_structure_nodes set monthly_reporting_required = false where id = %L', EARTH), 'MONTHLY_RESPONSIBILITY_EXISTS');
  perform pg_temp.must_pass(7, '07 GUARDS', 'removing P5 from Piping (empty member list) is accepted',
    pg_temp.save_sql(A, PIPING, array[]::uuid[]));
  perform pg_temp.must_pass(7, '07 GUARDS', 'then ending P5''s project membership is accepted',
    format('select public.end_project_member(%L, %L, %L)', A, pg_temp.version('ZZ-2C3D-A'), P5));
  perform pg_temp.chk(7, '07 GUARDS', 'P5''s ended Piping row is kept as history',
    exists (select 1 from public.project_structure_unit_members where node_id = PIPING and member_id = P5 and ended_at is not null));
  perform pg_temp.must_fail(7, '07 GUARDS', 'hard-deleting a unit with people history is refused (archive instead)',
    format('delete from public.project_structure_nodes where id = %L', PIPING), 'UNIT_HAS_PEOPLE_HISTORY');
  perform pg_temp.must_pass(7, '07 GUARDS', 'archiving a unit whose people are all ended is accepted',
    format('update public.project_structure_nodes set archived_at = now() where id = %L', PIPING));
  perform pg_temp.must_fail(7, '07 GUARDS', 'saving people on an archived unit is refused',
    pg_temp.save_sql(A, PIPING, array[P1]), 'UNIT_ARCHIVED');
  perform pg_temp.must_pass(7, '07 GUARDS', 'a unit with no people history can still be deleted',
    format('delete from public.project_structure_nodes where id = %L', SPARE));

  /* 12. read visibility for the assigned user */
  perform pg_temp.chk(12, '12 READ', 'the assigned user reads the project''s unit rows and responsibilities',
    (select count(*) from public.project_structure_unit_members where project_id = A) > 0
    and (select count(*) from public.project_structure_report_responsibilities where project_id = A) > 0);
end $pcm$;

reset role;

/* ============= 8. table invariants (as the table owner, RLS bypassed) ==== */

do $owner$
declare
  A      uuid := pg_temp.project('ZZ-2C3D-A');
  CIVIL  uuid := pg_temp.node('ZZ-2C3D-A', 'Civil');
  EARTH  uuid := pg_temp.node('ZZ-2C3D-A', 'Earthworks');
  MECH   uuid := pg_temp.node('ZZ-2C3D-A', 'Mech');
  P1 uuid := pg_temp.member('ZZ-2C3D-A', 'ZZ 2C3D P1');
  P2 uuid := pg_temp.member('ZZ-2C3D-A', 'ZZ 2C3D P2');
  P3 uuid := pg_temp.member('ZZ-2C3D-A', 'ZZ 2C3D P3');
begin
  perform pg_temp.must_fail(8, '08 INVARIANTS', 'a unit assignment cannot be created already ended',
    format('insert into public.project_structure_unit_members (project_id, node_id, member_id, unit_role, ended_at) values (%L, %L, %L, %L, now())',
           A, MECH, P1, 'member'), 'ASSIGNMENT_MUST_START_ACTIVE');
  perform pg_temp.must_fail(8, '08 INVARIANTS', 'a unit of another project is refused with a domain message (not a raw FK error)',
    format('insert into public.project_structure_unit_members (project_id, node_id, member_id, unit_role) values (%L, %L, %L, %L)',
           A, pg_temp.id('B_UNIT'), P1, 'member'), 'UNIT_NOT_FOUND');
  perform pg_temp.must_fail(8, '08 INVARIANTS', 'a member of another project is refused with a domain message',
    format('insert into public.project_structure_unit_members (project_id, node_id, member_id, unit_role) values (%L, %L, %L, %L)',
           A, MECH, pg_temp.id('B_MEMBER'), 'member'), 'MEMBER_NOT_ACTIVE');
  perform pg_temp.must_fail(8, '08 INVARIANTS', 'a second active Lead in one unit is refused',
    format('insert into public.project_structure_unit_members (project_id, node_id, member_id, unit_role) values (%L, %L, %L, %L)',
           A, CIVIL, P1, 'lead'), 'project_structure_unit_members_one_lead');
  perform pg_temp.must_fail(8, '08 INVARIANTS', 'a Lead row without the person''s member row is refused',
    format('insert into public.project_structure_unit_members (project_id, node_id, member_id, unit_role) values (%L, %L, %L, %L)',
           A, MECH, P2, 'lead'), 'LEAD_NOT_UNIT_MEMBER');
  perform pg_temp.must_fail(8, '08 INVARIANTS', 'an ended assignment cannot be changed',
    format('update public.project_structure_unit_members set ended_at = now() where node_id = %L and member_id = %L and unit_role = %L and ended_at is not null',
           CIVIL, P1, 'lead'), 'ASSIGNMENT_ENDED');
  perform pg_temp.must_fail(8, '08 INVARIANTS', 'an assignment keeps its role (identity is immutable)',
    format('update public.project_structure_unit_members set unit_role = %L where id = %L', 'lead', pg_temp.active_unit(CIVIL, P2, 'member')),
    'ASSIGNMENT_IMMUTABLE');
  perform pg_temp.must_fail(8, '08 INVARIANTS', 'ending the member row of the unit''s Lead is refused',
    format('update public.project_structure_unit_members set ended_at = now() where id = %L', pg_temp.active_unit(CIVIL, P3, 'member')),
    'UNIT_MEMBER_IS_LEAD');
  perform pg_temp.must_fail(8, '08 INVARIANTS', 'ending the member row of a Weekly Responsible is refused',
    format('update public.project_structure_unit_members set ended_at = now() where id = %L', pg_temp.active_unit(CIVIL, P2, 'member')),
    'UNIT_MEMBER_HAS_RESPONSIBILITY');
  perform pg_temp.must_fail(8, '08 INVARIANTS', 'a unit assignment is never deleted',
    format('delete from public.project_structure_unit_members where id = %L', pg_temp.active_unit(CIVIL, P1, 'member')),
    'ASSIGNMENT_HISTORY_PRESERVED');
  perform pg_temp.must_fail(8, '08 INVARIANTS', 'a reporting responsibility is never deleted',
    format('delete from public.project_structure_report_responsibilities where node_id = %L', CIVIL),
    'ASSIGNMENT_HISTORY_PRESERVED');
  perform pg_temp.must_fail(8, '08 INVARIANTS', 'a responsibility held through a Lead row (not the member row) is refused',
    format('insert into public.project_structure_report_responsibilities (project_id, node_id, member_id, unit_member_id, report_kind, responsibility) values (%L, %L, %L, %L, %L, %L)',
           A, CIVIL, P3, pg_temp.active_unit(CIVIL, P3, 'lead'), 'weekly', 'backup'), 'RESPONSIBLE_NOT_UNIT_MEMBER');
  perform pg_temp.must_fail(8, '08 INVARIANTS', 'a Backup inserted with no active Responsible is refused',
    format('insert into public.project_structure_unit_members (project_id, node_id, member_id, unit_role) values (%L, %L, %L, %L); '
           'insert into public.project_structure_report_responsibilities (project_id, node_id, member_id, unit_member_id, report_kind, responsibility) '
           'select project_id, node_id, member_id, id, %L, %L from public.project_structure_unit_members where node_id = %L and member_id = %L and unit_role = %L and ended_at is null',
           pg_temp.id('B'), pg_temp.id('B_UNIT'), pg_temp.id('B_MEMBER'), 'member', 'weekly', 'backup',
           pg_temp.id('B_UNIT'), pg_temp.id('B_MEMBER'), 'member'), 'BACKUP_WITHOUT_RESPONSIBLE');
  perform pg_temp.must_fail_at_commit(8, '08 INVARIANTS', 'ending a Responsible while its Backup stays is refused at commit',
    format('update public.project_structure_report_responsibilities set ended_at = clock_timestamp() where node_id = %L and report_kind = %L and responsibility = %L and ended_at is null',
           EARTH, 'monthly', 'responsible'), 'BACKUP_WITHOUT_RESPONSIBLE');
  perform pg_temp.chk(8, '08 INVARIANTS', 'the refused end left the Monthly Responsible active',
    pg_temp.active_resp(EARTH, 'monthly', 'responsible') = P3);
  perform pg_temp.must_fail(8, '08 INVARIANTS', 'unit assignments exist on Other projects only',
    format('insert into public.project_structure_unit_members (project_id, node_id, member_id, unit_role) values (%L, %L, %L, %L)',
           pg_temp.id('PSM'), CIVIL, P1, 'member'), 'NOT_OTHER');
  perform pg_temp.must_fail(10, '10 ARCHIVED', 'owner: ending a responsibility on an archived project is refused',
    format('update public.project_structure_report_responsibilities set ended_at = now() where node_id = %L', pg_temp.id('ARC_UNIT')),
    'PROJECT_ARCHIVED');
  perform pg_temp.must_fail(10, '10 ARCHIVED', 'owner: ending a unit assignment on an archived project is refused',
    format('update public.project_structure_unit_members set ended_at = now() where node_id = %L', pg_temp.id('ARC_UNIT')),
    'PROJECT_ARCHIVED');
end $owner$;

/* ===================== As Project Control Admin (global) ================= */

do $pca$
declare
  A        uuid := pg_temp.project('ZZ-2C3D-A');
  EARTH    uuid := pg_temp.node('ZZ-2C3D-A', 'Earthworks');
  P1       uuid := pg_temp.member('ZZ-2C3D-A', 'ZZ 2C3D P1');
  P3       uuid := pg_temp.member('ZZ-2C3D-A', 'ZZ 2C3D P3');
  UI       uuid := pg_temp.project('ZZ-STRUCT-UI-01');
  UI_CIVIL uuid := pg_temp.node('ZZ-STRUCT-UI-01', 'Civil');
  DINA     uuid := pg_temp.member('ZZ-STRUCT-UI-01', 'Dina Samir (Demo)');
  KHALED   uuid := pg_temp.member('ZZ-STRUCT-UI-01', 'Khaled Fahmy (Demo)');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3d02","role":"authenticated"}';

  perform pg_temp.must_pass(11, '11 AUTHORITY', 'Project Control Admin (global) may save on any Other project',
    pg_temp.save_sql(A, EARTH, array[P1, P3], P3, null, null, P3, P1));

  /* 9. completed membership for accountable roles (legacy data, rolled back) */
  if UI is null or UI_CIVIL is null or DINA is null or KHALED is null then
    perform pg_temp.chk(9, '09 COMPLETE MEMBERSHIP', 'ZZ-STRUCT-UI-01 legacy fixtures present', false, 'not found');
  else
    perform pg_temp.chk(9, '09 COMPLETE MEMBERSHIP', 'fixture: Dina Samir (Demo) is an active, incomplete legacy member',
      exists (select 1 from public.project_members where id = DINA and ended_at is null and (party_id is null or project_role is null)));
    perform pg_temp.must_pass(9, '09 COMPLETE MEMBERSHIP', 'an incomplete legacy member may be a normal unit member',
      pg_temp.save_sql(UI, UI_CIVIL, array[DINA, KHALED]));
    perform pg_temp.must_fail(9, '09 COMPLETE MEMBERSHIP', 'an incomplete member cannot be Unit Lead',
      pg_temp.save_sql(UI, UI_CIVIL, array[DINA, KHALED], DINA), 'MEMBERSHIP_INCOMPLETE');
    perform pg_temp.must_fail(9, '09 COMPLETE MEMBERSHIP', 'an incomplete member cannot be Weekly Responsible',
      pg_temp.save_sql(UI, UI_CIVIL, array[DINA, KHALED], null, DINA), 'MEMBERSHIP_INCOMPLETE');
    perform pg_temp.must_fail(9, '09 COMPLETE MEMBERSHIP', 'an incomplete member cannot be Weekly Backup',
      pg_temp.save_sql(UI, UI_CIVIL, array[DINA, KHALED], null, KHALED, DINA), 'MEMBERSHIP_INCOMPLETE');
    perform pg_temp.must_pass(9, '09 COMPLETE MEMBERSHIP', 'a complete member may be Lead and Weekly Responsible',
      pg_temp.save_sql(UI, UI_CIVIL, array[DINA, KHALED], KHALED, KHALED));
  end if;

  /* 10. archived project, and Other projects only */
  perform pg_temp.must_fail(10, '10 ARCHIVED', 'the writer refuses an archived project',
    pg_temp.save_sql(pg_temp.id('ARC'), pg_temp.id('ARC_UNIT'), array[pg_temp.id('ARC_MEMBER')]), 'PROJECT_ARCHIVED');
  perform pg_temp.must_fail(8, '08 INVARIANTS', 'the writer refuses a PSM project',
    pg_temp.save_sql(pg_temp.id('PSM'), EARTH, array[]::uuid[]), 'NOT_OTHER');
end $pca$;

reset role;

/* 9 (owner): the database guard, not only the writer, enforces completion. */
do $incomplete$
declare
  UI_CIVIL uuid := pg_temp.node('ZZ-STRUCT-UI-01', 'Civil');
  DINA     uuid := pg_temp.member('ZZ-STRUCT-UI-01', 'Dina Samir (Demo)');
begin
  perform pg_temp.must_fail(9, '09 COMPLETE MEMBERSHIP', 'owner: a Lead row for an incomplete member is refused by the guard',
    format('insert into public.project_structure_unit_members (project_id, node_id, member_id, unit_role) values (%L, %L, %L, %L)',
           pg_temp.project('ZZ-STRUCT-UI-01'), UI_CIVIL, DINA, 'lead'), 'MEMBERSHIP_INCOMPLETE');
  perform pg_temp.must_fail(9, '09 COMPLETE MEMBERSHIP', 'owner: a responsibility for an incomplete member is refused by the guard',
    format('insert into public.project_structure_report_responsibilities (project_id, node_id, member_id, unit_member_id, report_kind, responsibility) '
           'select project_id, node_id, member_id, id, %L, %L from public.project_structure_unit_members where node_id = %L and member_id = %L and unit_role = %L and ended_at is null',
           'weekly', 'backup', UI_CIVIL, DINA, 'member'), 'MEMBERSHIP_INCOMPLETE');
end $incomplete$;

/* ============ 11. refused callers: other project, coordinator, outsider === */

do $pcm_other$
declare
  B_UNIT uuid := pg_temp.id('B_UNIT');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3d01","role":"authenticated"}';
  perform pg_temp.must_fail(11, '11 AUTHORITY', 'Project Control / Planning cannot save on a project they are not assigned to',
    pg_temp.save_sql(pg_temp.id('B'), B_UNIT, array[pg_temp.id('B_MEMBER')]), 'NOT_AUTHORIZED');
end $pcm_other$;
reset role;

do $rc$
declare
  A     uuid := pg_temp.project('ZZ-2C3D-A');
  CIVIL uuid := pg_temp.node('ZZ-2C3D-A', 'Civil');
  P1    uuid := pg_temp.member('ZZ-2C3D-A', 'ZZ 2C3D P1');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3d03","role":"authenticated"}';
  perform pg_temp.must_fail(11, '11 AUTHORITY', 'a Reporting Coordinator on the project cannot save responsibilities',
    pg_temp.save_sql(A, CIVIL, array[P1]), 'NOT_AUTHORIZED');
end $rc$;
reset role;

do $out$
declare
  A     uuid := pg_temp.project('ZZ-2C3D-A');
  CIVIL uuid := pg_temp.node('ZZ-2C3D-A', 'Civil');
  P1    uuid := pg_temp.member('ZZ-2C3D-A', 'ZZ 2C3D P1');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3d04","role":"authenticated"}';
  perform pg_temp.must_fail(11, '11 AUTHORITY', 'an outsider cannot save responsibilities',
    pg_temp.save_sql(A, CIVIL, array[P1], p_version => now()), 'NOT_AUTHORIZED');
  perform pg_temp.chk(11, '11 AUTHORITY', 'an outsider reads no unit rows of a project they cannot see',
    (select count(*) from public.project_structure_unit_members where project_id = A) = 0);
end $out$;
reset role;

do $anon$
declare
  A     uuid := pg_temp.project('ZZ-2C3D-A');
  CIVIL uuid := pg_temp.node('ZZ-2C3D-A', 'Civil');
begin
  set local role anon;
  perform pg_temp.must_fail(11, '11 AUTHORITY', 'anon cannot execute the writer',
    format('select public.save_structure_unit_responsibilities(%L, now(), %L, %L::uuid[])', A, CIVIL, '{}'), 'permission denied');
  perform pg_temp.must_fail(11, '11 AUTHORITY', 'anon cannot read unit assignments',
    'select count(*) from public.project_structure_unit_members', 'permission denied');
end $anon$;
reset role;

/* ===== 12. ZERO authority: P1 is a member, Backup and former Lead on A ==== */

do $p1$
declare
  A     uuid := pg_temp.project('ZZ-2C3D-A');
  CIVIL uuid := pg_temp.node('ZZ-2C3D-A', 'Civil');
  P1    uuid := pg_temp.member('ZZ-2C3D-A', 'ZZ 2C3D P1');
  v_any_department uuid := (select department_id from public.project_departments limit 1);
  v_granted text;
  v_null text;
begin
  perform pg_temp.chk(12, '12 ZERO AUTHORITY', 'fixture: P1 holds active unit rows and a Monthly Backup on A',
    exists (select 1 from public.project_structure_unit_members where member_id = P1 and ended_at is null)
    and exists (select 1 from public.project_structure_report_responsibilities where member_id = P1 and ended_at is null));
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3d05","role":"authenticated"}';
  perform pg_temp.chk(12, '12 ZERO AUTHORITY', 'unit roles do not make the project visible',
    (select count(*) from public.projects where id = A) = 0);
  -- Each predicate is reported by name, so a failure says which one granted.
  -- Only TRUE grants. can_access_project() (and its alias
  -- weekly_can_access_project()) is NULL, not false, for an account with no
  -- portfolio-read grant: pre-existing three-valued behaviour that RLS treats
  -- as a refusal. NULL results are listed in the detail for transparency.
  select string_agg(v.name, ', ') filter (where v.granted is true),
         string_agg(v.name, ', ') filter (where v.granted is null)
    into v_granted, v_null
    from (values ('can_manage_project_setup', public.can_manage_project_setup(A)),
                 ('can_manage_project_responsibilities', public.can_manage_project_responsibilities(A)),
                 ('can_manage_reporting_workflow', public.can_manage_reporting_workflow(A)),
                 ('weekly_can_access_project', public.weekly_can_access_project(A)),
                 ('is_project_control_planning', public.is_project_control_planning(A)),
                 ('is_report_coordinator', public.is_report_coordinator(A)),
                 ('is_department_user', public.is_department_user(A, v_any_department))) v(name, granted);
  perform pg_temp.chk(12, '12 ZERO AUTHORITY', 'unit roles grant no setup, responsibility or reporting authority',
    v_granted is null,
    coalesce('GRANTED: ' || v_granted, '') || coalesce('null (refused by RLS): ' || v_null, ''));
  perform pg_temp.must_fail(12, '12 ZERO AUTHORITY', 'a unit Backup cannot save responsibilities',
    pg_temp.save_sql(A, CIVIL, array[P1], p_version => now()), 'NOT_AUTHORIZED');
end $p1$;
reset role;

/* ======================== 13. catalog (as postgres) ===================== */

do $catalog$
declare
  v_table text;
begin
  foreach v_table in array array['project_structure_unit_members', 'project_structure_report_responsibilities'] loop
    perform pg_temp.chk(13, '13 CATALOG', v_table || ': authenticated SELECT only; anon nothing',
      has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
      and not has_table_privilege('authenticated', 'public.' || v_table, 'INSERT')
      and not has_table_privilege('authenticated', 'public.' || v_table, 'UPDATE')
      and not has_table_privilege('authenticated', 'public.' || v_table, 'DELETE')
      and not has_table_privilege('authenticated', 'public.' || v_table, 'TRUNCATE')
      and not has_table_privilege('anon', 'public.' || v_table, 'SELECT'));
    perform pg_temp.chk(13, '13 CATALOG', v_table || ': RLS on, SELECT policy only',
      (select relrowsecurity from pg_class where oid = ('public.' || v_table)::regclass)
      and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = v_table and cmd <> 'SELECT')
      and exists (select 1 from pg_policies where schemaname = 'public' and tablename = v_table and cmd = 'SELECT'));
  end loop;
  perform pg_temp.chk(13, '13 CATALOG', 'the writer is SECURITY DEFINER with an empty search_path, EXECUTE for authenticated only',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'save_structure_unit_responsibilities'
               and p.prosecdef and p.proconfig @> array['search_path=""']
               and has_function_privilege('authenticated', p.oid, 'EXECUTE')
               and not has_function_privilege('anon', p.oid, 'EXECUTE')
               and not has_function_privilege('service_role', p.oid, 'EXECUTE')));
  perform pg_temp.chk(13, '13 CATALOG', 'guards are installed on project_structure_nodes and project_members',
    exists (select 1 from pg_trigger where tgname = 'guard_structure_node_people' and tgrelid = 'public.project_structure_nodes'::regclass)
    and exists (select 1 from pg_trigger where tgname = 'guard_project_member_unit_assignments' and tgrelid = 'public.project_members'::regclass));
  perform pg_temp.chk(13, '13 CATALOG', 'the Backup check is a constraint trigger deferred to commit',
    exists (select 1 from pg_trigger where tgname = 'check_structure_report_backup' and tgdeferrable and tginitdeferred));
  perform pg_temp.chk(13, '13 CATALOG', 'no authorization helper reads structure responsibilities or membership',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public'
                   and (p.proname ~ '^(can_|is_|has_|current_user_|current_contact_|weekly_can_|monthly_can_|executive_can_)'
                        or p.proname ~ '_accepts_department_input$')
                   and (p.prosrc ilike '%project_structure_unit_members%'
                        or p.prosrc ilike '%project_structure_report_responsibilities%'
                        or p.prosrc ilike '%project_members%')));
  perform pg_temp.chk(13, '13 CATALOG', 'no other table''s policy reads structure responsibilities',
    not exists (select 1 from pg_policies
                 where tablename not in ('project_structure_unit_members', 'project_structure_report_responsibilities')
                   and (coalesce(qual, '') ilike '%project_structure_%responsib%'
                        or coalesce(qual, '') ilike '%project_structure_unit_members%'
                        or coalesce(with_check, '') ilike '%project_structure_unit_members%'
                        or coalesce(with_check, '') ilike '%project_structure_report_responsibilities%')));
  /* 14. history */
  perform pg_temp.chk(14, '14 HISTORY', 'ended rows are kept in both tables',
    exists (select 1 from public.project_structure_unit_members where ended_at is not null)
    and exists (select 1 from public.project_structure_report_responsibilities where ended_at is not null));
end $catalog$;

/* ================================ report ================================ */

select seq, area, item, verdict from r order by seq, area, item;
select count(*) filter (where verdict like 'PASS%') as passed,
       count(*) filter (where verdict like 'FAIL%') as failed,
       count(*) as total
  from r;

rollback;

-- Phase 2C.3E authority-bearing assignment rules + archived Project Setup
-- read-only — RUNTIME verification. LOCAL DATABASE ONLY.
--
-- Proves 20261012180000_setup_authority_and_archived_read_only.sql against
-- real PostgreSQL, real RLS and real authenticated roles. Everything —
-- fixtures, accounts and every write — runs in ONE transaction that is ROLLED
-- BACK. Nothing persists.
--
--   1  archived PSM project: every setup write path refused (patch, every
--      relation, direct table writes, Replace Person, Type Correction, team),
--      for the assigned Project Control AND the global authorities; reads work
--   2  archived Other project: the same, plus structure / responsibilities
--   3  lifecycle: archiving is still allowed; active projects stay writable;
--      deleting a whole project still cascades
--   4  explicit authority sources unchanged: Project Control / Planning,
--      Reporting Coordinator, Department Manager / department user — each
--      project-scoped; archived turns reporting authority off
--   5  descriptive assignments grant nothing: membership, Party, Project
--      Role, Reports To, Other Unit Lead / Member / Weekly / Monthly
--      Responsible / Backup; the malformed legacy rows grant nothing
--   6  changing / removing Project Control or Reporting Coordinator changes
--      authority in the same transaction
--   7  a direct write cannot leave PCM / RC authority with anyone but the
--      named holder (commit-time guard, forced with SET CONSTRAINTS)
--   8  catalog: guards installed, not client-executable, no authority helper
--      or policy reads descriptive assignments; earlier guards still present
--
-- HOW TO RUN (after the migration is applied; from eprp/):
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < scripts/p0-validation/118_runtime_2c3e_setup_authority_archived.sql

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

create temp table ids(key text primary key, id uuid, note text) on commit drop;
grant select on ids to authenticated, anon;

create or replace function pg_temp.chk(
  p_seq int, p_area text, p_item text, p_ok boolean, p_detail text default ''
) returns void language plpgsql as $$
begin
  insert into r values (p_seq, p_area, p_item,
    case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end ||
    case when p_detail = '' then '' else ' — ' || p_detail end);
end $$;

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

-- A write whose verdict is only known at COMMIT: the deferred guard is forced
-- to run now, inside a subtransaction that is then undone either way.
create or replace function pg_temp.at_commit(
  p_seq int, p_area text, p_item text, p_sql text, p_should_pass boolean
) returns void language plpgsql as $$
declare
  v_ok boolean;
  v_detail text := '';
begin
  -- The verdict is kept in variables: the subtransaction is always undone.
  begin
    execute p_sql;
    set constraints guard_project_authority_rows immediate;
    v_ok := p_should_pass;
    v_detail := case when p_should_pass then '' else 'ACCEPTED at commit' end;
    raise exception 'ZZ_UNDO';
  exception when others then
    if sqlerrm <> 'ZZ_UNDO' then
      v_ok := not p_should_pass and position('AUTHORITY_HOLDER_MISMATCH' in sqlerrm) > 0;
      v_detail := 'refused [' || sqlstate || ']: ' || left(sqlerrm, 100);
    end if;
  end;
  set constraints guard_project_authority_rows deferred;
  perform pg_temp.chk(p_seq, p_area, p_item, v_ok, v_detail);
end $$;

create or replace function pg_temp.project(p_code text) returns uuid
language sql as $$ select id from public.projects where code = p_code $$;
create or replace function pg_temp.person(p_name text) returns uuid
language sql as $$ select id from public.contacts where name = p_name $$;
create or replace function pg_temp.party(p_code text, p_kind text) returns uuid
language sql as $$ select pp.id from public.project_parties pp join public.projects p on p.id = pp.project_id
                    where p.code = p_code and pp.kind = p_kind limit 1 $$;
create or replace function pg_temp.member(p_code text, p_name text) returns uuid
language sql as $$ select m.id from public.project_members m
                    where m.project_id = pg_temp.project(p_code) and m.contact_id = pg_temp.person(p_name) and m.ended_at is null $$;
create or replace function pg_temp.version(p_code text) returns timestamptz
language sql as $$ select updated_at from public.projects where code = p_code $$;
create or replace function pg_temp.id(p_key text) returns uuid
language sql as $$ select id from ids where key = p_key $$;
-- Setup RPC calls as SQL text, at the CURRENT project version.
create or replace function pg_temp.patch_sql(p_code text, p_columns jsonb) returns text
language sql as $$
  select format('select public.save_project_setup_patch(%L::uuid, %L::timestamptz, %L::jsonb, %L::jsonb)',
                pg_temp.project(p_code), pg_temp.version(p_code), p_columns, '{}')
$$;
create or replace function pg_temp.relation_sql(p_code text, p_relation text, p_rows jsonb) returns text
language sql as $$
  select format('select public.save_project_setup_relation(%L::uuid, %L::timestamptz, %L, %L::jsonb)',
                pg_temp.project(p_code), pg_temp.version(p_code), p_relation, p_rows)
$$;
-- Every authority helper this phase must keep false for a descriptive-only person.
create or replace function pg_temp.any_authority(p_project uuid, p_department uuid) returns boolean
language sql as $$
  select coalesce(public.can_manage_project_setup(p_project), false)
      or coalesce(public.can_manage_project_operations(p_project), false)
      or coalesce(public.can_manage_project_responsibilities(p_project), false)
      or coalesce(public.can_manage_reporting_workflow(p_project), false)
      or coalesce(public.monthly_can_manage_project(p_project), false)
      or coalesce(public.is_project_consolidator(p_project), false)
      or coalesce(public.has_operational_project_access(p_project), false)
      or coalesce(public.is_department_user(p_project, p_department), false)
      or coalesce(public.is_weekly_department_manager(p_project, p_department), false)
$$;

/* ========================= fixtures (as postgres) ========================= */

insert into ids(key, note)
select 'MALFORMED', md5(string_agg(pc.id::text || pc.contact_id || pc.role || coalesce(pc.department_id::text, '')
                                     || coalesce(pc.assignment_role, ''), ',' order by pc.id))
  from public.project_contacts pc
 where pc.role <> 'team_member' and pc.department_id is not null;

do $fix$
declare
  v_template uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  v_type uuid;
  D uuid := (select id from public.departments order by name limit 1);
begin
  if v_template is null then
    raise exception 'ZZ-P0TEST-PRJ not found — this script expects the local development dataset.';
  end if;
  if to_regprocedure('public.guard_archived_project_setup()') is null then
    raise exception 'guard_archived_project_setup() not found — apply 20261012180000_setup_authority_and_archived_read_only.sql first.';
  end if;
  insert into ids(key, id) values ('DEPT', D);

  insert into public.project_types (name, code) values ('ZZ 2C.3E Category', 'ZZ-2C3E-CAT') returning id into v_type;
  insert into ids(key, id) values ('TYPE', v_type);
  insert into public.projects (code, name, client_id, planned_start_date, planned_finish_date,
                               status, structure_family, project_type_id)
  select 'ZZ-2C3E-' || v.s, 'ZZ 2C.3E ' || v.s, p.client_id, p.planned_start_date, p.planned_finish_date,
         'active', v.family, case when v.family = 'other' then v_type end
    from public.projects p,
         (values ('PSM', 'psm'), ('PSM2', 'psm'), ('OTH', 'other'), ('ARCP', 'psm'), ('ARCO', 'other'), ('DEL', 'psm')) v(s, family)
   where p.id = v_template;

  insert into public.project_departments (project_id, department_id)
  select pg_temp.project('ZZ-2C3E-' || s), D from (values ('PSM'), ('PSM2'), ('ARCP'), ('DEL')) v(s);

  insert into public.contacts (name, email, active)
  select 'ZZ 2C3E ' || s, 'zz.2c3e.' || lower(s) || '@example.invalid', true
    from (values ('X'), ('Y'), ('M'), ('T'), ('Z'), ('W'), ('R'), ('L'), ('B'), ('SA'), ('PCA')) v(s);

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', ('00000000-0000-4000-a000-0000002c3e' || v.n)::uuid,
         'authenticated', 'authenticated', 'zz.2c3e.' || lower(v.s) || '@example.invalid',
         'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
    from (values ('X', '01'), ('Y', '02'), ('M', '03'), ('T', '04'), ('Z', '05'), ('W', '06'),
                 ('L', '07'), ('B', '08'), ('PCA', '10')) v(s, n);
  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select ('00000000-0000-4000-a000-0000002c3e' || v.n)::uuid, 'zz.2c3e.' || lower(v.s) || '@example.invalid',
         'ZZ 2C3E ' || v.s, v.role, pg_temp.person('ZZ 2C3E ' || v.s), true
    from (values ('X', '01', 'viewer'), ('Y', '02', 'viewer'), ('M', '03', 'viewer'), ('T', '04', 'viewer'),
                 ('Z', '05', 'viewer'), ('W', '06', 'viewer'), ('L', '07', 'viewer'), ('B', '08', 'viewer'),
                 ('PCA', '10', 'project_control_admin')) v(s, n, role);
  -- At most two active System Administrators may exist: reuse one (identity only).
  insert into ids(key, id) values ('SA_PROFILE', (select id from public.profiles where role = 'system_admin' and active order by created_at limit 1));

  -- Memberships (complete Party + Project Role).
  insert into public.project_members (project_id, contact_id, party_id, project_role)
  select pg_temp.project(v.code), pg_temp.person('ZZ 2C3E ' || v.s), pg_temp.party(v.code, 'eprom'), v.role
    from (values ('ZZ-2C3E-PSM', 'X', 'Project Controls'), ('ZZ-2C3E-PSM', 'Y', 'Reporting Coordinator'),
                 ('ZZ-2C3E-PSM', 'M', 'Department Manager'), ('ZZ-2C3E-PSM', 'T', 'Engineer'),
                 ('ZZ-2C3E-PSM', 'W', 'Senior Engineer'), ('ZZ-2C3E-PSM', 'R', 'Engineer'),
                 ('ZZ-2C3E-PSM', 'Z', 'Planner'),
                 ('ZZ-2C3E-OTH', 'L', 'Unit Lead'), ('ZZ-2C3E-OTH', 'B', 'Engineer'),
                 ('ZZ-2C3E-ARCP', 'X', 'Project Controls'), ('ZZ-2C3E-ARCP', 'Y', 'Reporting Coordinator'),
                 ('ZZ-2C3E-ARCO', 'X', 'Project Controls'), ('ZZ-2C3E-DEL', 'X', 'Project Controls')) v(code, s, role);
  -- Reports To is descriptive: R reports to W.
  update public.project_members set reports_to_member_id = pg_temp.member('ZZ-2C3E-PSM', 'ZZ 2C3E W')
   where id = pg_temp.member('ZZ-2C3E-PSM', 'ZZ 2C3E R');

  -- Named Project Control / Reporting Coordinator: the authority row and the
  -- holder column together, as the setup patch writes them.
  insert into public.project_contacts (project_id, contact_id, role)
  select pg_temp.project(v.code), pg_temp.person('ZZ 2C3E ' || v.s), v.role
    from (values ('ZZ-2C3E-PSM', 'X', 'project_control_manager'), ('ZZ-2C3E-PSM', 'Y', 'reporting_coordinator'),
                 ('ZZ-2C3E-ARCP', 'X', 'project_control_manager'), ('ZZ-2C3E-ARCP', 'Y', 'reporting_coordinator'),
                 ('ZZ-2C3E-ARCO', 'X', 'project_control_manager'), ('ZZ-2C3E-DEL', 'X', 'project_control_manager')) v(code, s, role);
  update public.projects p
     set project_control_manager_id = pg_temp.person('ZZ 2C3E X'),
         reporting_coordinator_id = case when p.code in ('ZZ-2C3E-PSM', 'ZZ-2C3E-ARCP') then pg_temp.person('ZZ 2C3E Y') end
   where p.code in ('ZZ-2C3E-PSM', 'ZZ-2C3E-ARCP', 'ZZ-2C3E-ARCO', 'ZZ-2C3E-DEL');

  -- PSM department assignments: M Department Manager, T Team Member.
  insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role, reports_to_contact_id)
  values (pg_temp.project('ZZ-2C3E-PSM'), pg_temp.person('ZZ 2C3E M'), 'team_member', D, 'department_manager', null),
         (pg_temp.project('ZZ-2C3E-PSM'), pg_temp.person('ZZ 2C3E T'), 'team_member', D, 'team_member', pg_temp.person('ZZ 2C3E M'));

  -- Other project: one unit with Weekly and Monthly input; L is Unit Lead,
  -- Weekly Responsible and Monthly Backup; B is Weekly Backup and Monthly
  -- Responsible. None of it is authority.
  insert into public.project_structure_levels (project_id, level_number, singular_label, plural_label)
  values (pg_temp.project('ZZ-2C3E-OTH'), 1, 'Unit', 'Units'), (pg_temp.project('ZZ-2C3E-ARCO'), 1, 'Phase', 'Phases');
  insert into public.project_structure_nodes (project_id, level_number, name, code, weekly_reporting_required, monthly_reporting_required)
  values (pg_temp.project('ZZ-2C3E-OTH'), 1, 'ZZ Unit', 'ZU', true, true),
         (pg_temp.project('ZZ-2C3E-ARCO'), 1, 'ZZ Arc Unit', 'ZA', true, false);
  insert into ids(key, id) values
    ('OTH_UNIT', (select id from public.project_structure_nodes where project_id = pg_temp.project('ZZ-2C3E-OTH'))),
    ('ARCO_UNIT', (select id from public.project_structure_nodes where project_id = pg_temp.project('ZZ-2C3E-ARCO')));
  insert into public.project_structure_unit_members (project_id, node_id, member_id, unit_role)
  values (pg_temp.project('ZZ-2C3E-OTH'), pg_temp.id('OTH_UNIT'), pg_temp.member('ZZ-2C3E-OTH', 'ZZ 2C3E L'), 'member'),
         (pg_temp.project('ZZ-2C3E-OTH'), pg_temp.id('OTH_UNIT'), pg_temp.member('ZZ-2C3E-OTH', 'ZZ 2C3E L'), 'lead'),
         (pg_temp.project('ZZ-2C3E-OTH'), pg_temp.id('OTH_UNIT'), pg_temp.member('ZZ-2C3E-OTH', 'ZZ 2C3E B'), 'member');
  -- Responsibles first: a Backup needs one.
  insert into public.project_structure_report_responsibilities
    (project_id, node_id, member_id, unit_member_id, report_kind, responsibility)
  select a.project_id, a.node_id, a.member_id, a.id, v.kind, v.resp
    from public.project_structure_unit_members a
    join (values ('ZZ 2C3E L', 'weekly', 'responsible'), ('ZZ 2C3E B', 'monthly', 'responsible')) v(s, kind, resp)
      on a.member_id = pg_temp.member('ZZ-2C3E-OTH', v.s)
   where a.node_id = pg_temp.id('OTH_UNIT') and a.unit_role = 'member';
  insert into public.project_structure_report_responsibilities
    (project_id, node_id, member_id, unit_member_id, report_kind, responsibility)
  select a.project_id, a.node_id, a.member_id, a.id, v.kind, v.resp
    from public.project_structure_unit_members a
    join (values ('ZZ 2C3E B', 'weekly', 'backup'), ('ZZ 2C3E L', 'monthly', 'backup')) v(s, kind, resp)
      on a.member_id = pg_temp.member('ZZ-2C3E-OTH', v.s)
   where a.node_id = pg_temp.id('OTH_UNIT') and a.unit_role = 'member';
end;
$fix$;

/* ============ 3. lifecycle: archiving is allowed (as assigned PCM) ======== */

do $archive$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3e01","role":"authenticated"}';
  perform pg_temp.must_pass(3, '03 LIFECYCLE', 'the assigned Project Control can still archive an active PSM project',
    format('update public.projects set status = %L, active = false, archived_at = now() where id = %L', 'archived', pg_temp.project('ZZ-2C3E-ARCP')));
  perform pg_temp.must_pass(3, '03 LIFECYCLE', 'the assigned Project Control can still archive an active Other project',
    format('update public.projects set status = %L, active = false, archived_at = now() where id = %L', 'archived', pg_temp.project('ZZ-2C3E-ARCO')));
  perform pg_temp.must_pass(3, '03 LIFECYCLE', 'and the DEL project (deleted later)',
    format('update public.projects set status = %L where id = %L', 'archived', pg_temp.project('ZZ-2C3E-DEL')));
end $archive$;
reset role;

-- Fingerprint every setup row of the archived projects before any attempt.
insert into ids(key, note)
select 'ARC_PRINT', md5(coalesce(string_agg(t, ',' order by t), '')) from (
  select 'p:' || p.id || p.name || p.status || coalesce(p.project_control_manager_id::text, '') || p.updated_at as t
    from public.projects p where p.code in ('ZZ-2C3E-ARCP', 'ZZ-2C3E-ARCO')
  union all select 'd:' || id from public.project_departments where project_id in (pg_temp.project('ZZ-2C3E-ARCP'), pg_temp.project('ZZ-2C3E-ARCO'))
  union all select 'c:' || id || contact_id || role from public.project_contacts where project_id in (pg_temp.project('ZZ-2C3E-ARCP'), pg_temp.project('ZZ-2C3E-ARCO'))
  union all select 'pp:' || id || name from public.project_parties where project_id in (pg_temp.project('ZZ-2C3E-ARCP'), pg_temp.project('ZZ-2C3E-ARCO'))
  union all select 'm:' || id || coalesce(ended_at::text, '') from public.project_members where project_id in (pg_temp.project('ZZ-2C3E-ARCP'), pg_temp.project('ZZ-2C3E-ARCO'))
  union all select 'n:' || id || name from public.project_structure_nodes where project_id = pg_temp.project('ZZ-2C3E-ARCO')
) s;

/* ============ 1. archived PSM: every setup write path refused ============= */

do $arcp$
declare
  P uuid := pg_temp.project('ZZ-2C3E-ARCP');
  D uuid := pg_temp.id('DEPT');
  D2 uuid := (select id from public.departments where id <> pg_temp.id('DEPT') order by name limit 1);
  X uuid := pg_temp.person('ZZ 2C3E X');
  Y uuid := pg_temp.person('ZZ 2C3E Y');
  W uuid := pg_temp.person('ZZ 2C3E W');
  v_patch text := pg_temp.patch_sql('ZZ-2C3E-ARCP', '{"name":"ZZ changed"}');
  v_rel text;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3e01","role":"authenticated"}';

  perform pg_temp.chk(1, '01 ARCHIVED PSM', 'setup stays readable: project, department and named holders are visible to its Project Control',
    exists (select 1 from public.projects where id = P and status = 'archived')
    and exists (select 1 from public.project_departments where project_id = P)
    and exists (select 1 from public.project_contacts where project_id = P and role = 'project_control_manager'));
  perform pg_temp.must_fail(1, '01 ARCHIVED PSM', 'Project Information save (setup patch) is refused', v_patch, 'PROJECT_ARCHIVED');
  foreach v_rel in array array['departments', 'disciplines', 'team', 'sites', 'positions', 'delegations', 'parties'] loop
    perform pg_temp.must_fail(1, '01 ARCHIVED PSM', 'setup relation save is refused: ' || v_rel,
      pg_temp.relation_sql('ZZ-2C3E-ARCP', v_rel,
        case v_rel when 'departments' then jsonb_build_array(jsonb_build_object('departmentId', D, 'reportingRequired', true, 'systems', '[]'::jsonb)) else '[]'::jsonb end),
      'PROJECT_ARCHIVED');
  end loop;
  perform pg_temp.must_fail(1, '01 ARCHIVED PSM', 'direct INSERT of a department is refused',
    format('insert into public.project_departments (project_id, department_id) values (%L, %L)', P, D2), 'PROJECT_ARCHIVED');
  perform pg_temp.must_fail(1, '01 ARCHIVED PSM', 'direct DELETE of a department is refused',
    format('delete from public.project_departments where project_id = %L', P), 'PROJECT_ARCHIVED');
  perform pg_temp.must_fail(1, '01 ARCHIVED PSM', 'direct INSERT of a department assignment is refused',
    format('insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role) values (%L, %L, %L, %L, %L)',
           P, X, 'team_member', D, 'department_manager'), 'PROJECT_ARCHIVED');
  perform pg_temp.must_fail(1, '01 ARCHIVED PSM', 'direct UPDATE of the project row is refused',
    format('update public.projects set name = %L where id = %L', 'ZZ changed', P), 'PROJECT_ARCHIVED');
  perform pg_temp.must_fail(1, '01 ARCHIVED PSM', 'direct INSERT of a subcontractor party is refused',
    format('insert into public.project_parties (project_id, kind, name, scope, engagement_status, sort_order) values (%L, %L, %L, %L, %L, 9)',
           P, 'subcontractor', 'ZZ Sub', 'Civil', 'active'), 'PROJECT_ARCHIVED');
  perform pg_temp.must_fail(1, '01 ARCHIVED PSM', 'Replace Person (Project Control -> Reporting Coordinator holder) is refused',
    format('select public.replace_project_responsibility(%L, %L, %L, %L, %L, null, null, null, %L)',
           P, 'fixed_responsibility', X, Y, 'project_control_manager', 'Runtime check'), 'PROJECT_ARCHIVED');
  perform pg_temp.must_fail(1, '01 ARCHIVED PSM', 'adding a Project Team member is refused (2C.3C, unchanged)',
    format('select public.add_project_member(%L, %L, %L, %L, %L, null)', P, pg_temp.version('ZZ-2C3E-ARCP'), W,
           pg_temp.party('ZZ-2C3E-ARCP', 'eprom'), 'Engineer'), 'PROJECT_ARCHIVED');
end $arcp$;
reset role;

do $arcp_global$
declare
  P uuid := pg_temp.project('ZZ-2C3E-ARCP');
  v_patch text := pg_temp.patch_sql('ZZ-2C3E-ARCP', '{"name":"ZZ changed"}');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3e10","role":"authenticated"}';
  perform pg_temp.must_fail(1, '01 ARCHIVED PSM', 'Project Control Admin (global) cannot save it either', v_patch, 'PROJECT_ARCHIVED');
  perform pg_temp.must_fail(1, '01 ARCHIVED PSM', 'Project Control Admin direct UPDATE is refused',
    format('update public.projects set name = %L where id = %L', 'ZZ changed', P), 'PROJECT_ARCHIVED');
end $arcp_global$;
reset role;

do $arcp_admin$
declare
  P uuid := pg_temp.project('ZZ-2C3E-ARCP');
  v_sql text := format('select public.correct_project_structure_family(%L, %L, %L, %L, null, %L)', pg_temp.project('ZZ-2C3E-ARCP'),
                       pg_temp.version('ZZ-2C3E-ARCP'), 'other', pg_temp.id('TYPE'), 'Runtime check');
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.id('SA_PROFILE'), 'role', 'authenticated')::text, true);
  perform pg_temp.chk(1, '01 ARCHIVED PSM', 'the System Administrator can read it', exists (select 1 from public.projects where id = P));
  perform pg_temp.must_fail(1, '01 ARCHIVED PSM', 'System Administrator Project Type correction is refused', v_sql, 'PROJECT_ARCHIVED');
end $arcp_admin$;
reset role;

/* ============ 2. archived Other: every setup write path refused =========== */

do $arco$
declare
  P uuid := pg_temp.project('ZZ-2C3E-ARCO');
  U uuid := pg_temp.id('ARCO_UNIT');
  X uuid := pg_temp.person('ZZ 2C3E X');
  XM uuid := pg_temp.member('ZZ-2C3E-ARCO', 'ZZ 2C3E X');
  v_patch text := pg_temp.patch_sql('ZZ-2C3E-ARCO', '{"name":"ZZ changed"}');
  v_parties text := pg_temp.relation_sql('ZZ-2C3E-ARCO', 'parties', '[]');
  v_levels text := format('select public.configure_project_structure_levels(%L, %L, %L::jsonb)', pg_temp.project('ZZ-2C3E-ARCO'),
                          pg_temp.version('ZZ-2C3E-ARCO'), '[{"level_number":1,"singular_label":"Stage","plural_label":"Stages"}]');
  v_unit text := format('select public.save_structure_unit_responsibilities(%L, %L, %L, %L::uuid[], null, null, null, null, null)',
                        pg_temp.project('ZZ-2C3E-ARCO'), pg_temp.version('ZZ-2C3E-ARCO'), pg_temp.id('ARCO_UNIT'),
                        array[pg_temp.member('ZZ-2C3E-ARCO', 'ZZ 2C3E X')]);
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3e01","role":"authenticated"}';
  perform pg_temp.chk(2, '02 ARCHIVED OTHER', 'structure, team and holders stay readable',
    exists (select 1 from public.project_structure_nodes where id = U)
    and exists (select 1 from public.project_members where project_id = P)
    and exists (select 1 from public.project_contacts where project_id = P and contact_id = X));
  perform pg_temp.must_fail(2, '02 ARCHIVED OTHER', 'Project Information save (setup patch) is refused', v_patch, 'PROJECT_ARCHIVED');
  perform pg_temp.must_fail(2, '02 ARCHIVED OTHER', 'Project Parties save is refused', v_parties, 'PROJECT_ARCHIVED');
  perform pg_temp.must_fail(2, '02 ARCHIVED OTHER', 'structure levels are refused (2C.1c, unchanged)', v_levels, 'PROJECT_ARCHIVED');
  perform pg_temp.must_fail(2, '02 ARCHIVED OTHER', 'a new structure unit is refused (2C.1c, unchanged)',
    format('insert into public.project_structure_nodes (project_id, level_number, name, code) values (%L, 1, %L, %L)', P, 'ZZ New', 'ZN'),
    'PROJECT_ARCHIVED');
  perform pg_temp.must_fail(2, '02 ARCHIVED OTHER', 'unit responsibilities are refused (2C.3D, unchanged)', v_unit, 'PROJECT_ARCHIVED');
  perform pg_temp.must_fail(2, '02 ARCHIVED OTHER', 'ending a membership is refused (2C.3C, unchanged)',
    format('select public.end_project_member(%L, %L, %L)', P, pg_temp.version('ZZ-2C3E-ARCO'), XM), 'PROJECT_ARCHIVED');
  perform pg_temp.must_fail(2, '02 ARCHIVED OTHER', 'direct INSERT of a contact row is refused',
    format('insert into public.project_contacts (project_id, contact_id, role) values (%L, %L, %L)', P, X, 'project_sponsor'),
    'PROJECT_ARCHIVED');
end $arco$;
reset role;

do $unchanged$
begin
  perform pg_temp.chk(1, '01 ARCHIVED PSM', 'every refusal left the archived projects exactly as they were (fingerprint)',
    (select md5(coalesce(string_agg(t, ',' order by t), '')) from (
      select 'p:' || p.id || p.name || p.status || coalesce(p.project_control_manager_id::text, '') || p.updated_at as t
        from public.projects p where p.code in ('ZZ-2C3E-ARCP', 'ZZ-2C3E-ARCO')
      union all select 'd:' || id from public.project_departments where project_id in (pg_temp.project('ZZ-2C3E-ARCP'), pg_temp.project('ZZ-2C3E-ARCO'))
      union all select 'c:' || id || contact_id || role from public.project_contacts where project_id in (pg_temp.project('ZZ-2C3E-ARCP'), pg_temp.project('ZZ-2C3E-ARCO'))
      union all select 'pp:' || id || name from public.project_parties where project_id in (pg_temp.project('ZZ-2C3E-ARCP'), pg_temp.project('ZZ-2C3E-ARCO'))
      union all select 'm:' || id || coalesce(ended_at::text, '') from public.project_members where project_id in (pg_temp.project('ZZ-2C3E-ARCP'), pg_temp.project('ZZ-2C3E-ARCO'))
      union all select 'n:' || id || name from public.project_structure_nodes where project_id = pg_temp.project('ZZ-2C3E-ARCO')
    ) s) = (select note from ids where key = 'ARC_PRINT'));
end $unchanged$;

/* =========== 3. lifecycle: active projects stay writable ================== */

do $active$
declare
  v_patch text := pg_temp.patch_sql('ZZ-2C3E-PSM', '{"name":"ZZ 2C.3E PSM renamed"}');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3e01","role":"authenticated"}';
  perform pg_temp.must_pass(3, '03 LIFECYCLE', 'an ACTIVE project''s Project Information still saves', v_patch);
end $active$;
reset role;
do $active2$
declare
  v_rel text := pg_temp.relation_sql('ZZ-2C3E-PSM', 'departments', jsonb_build_array(jsonb_build_object('departmentId', pg_temp.id('DEPT'), 'reportingRequired', true, 'systems', '[]'::jsonb)));
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3e01","role":"authenticated"}';
  perform pg_temp.must_pass(3, '03 LIFECYCLE', 'an ACTIVE project''s departments still save', v_rel);
end $active2$;
reset role;

/* ======================= 4. explicit authority sources ==================== */

do $pcm$
declare
  P uuid := pg_temp.project('ZZ-2C3E-PSM'); P2 uuid := pg_temp.project('ZZ-2C3E-PSM2');
  A uuid := pg_temp.project('ZZ-2C3E-ARCP');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3e01","role":"authenticated"}';
  perform pg_temp.chk(4, '04 AUTHORITY', 'Project Control / Planning: full setup, operations and reporting authority on its OWN project',
    public.can_manage_project_setup(P) and public.can_manage_project_operations(P) and public.can_manage_reporting_workflow(P));
  perform pg_temp.chk(4, '04 AUTHORITY', 'Project Control / Planning: none on another project (view-only there)',
    coalesce(public.can_manage_project_setup(P2), false) = false and coalesce(public.can_manage_reporting_workflow(P2), false) = false);
  perform pg_temp.chk(4, '04 AUTHORITY', 'archived: reporting authority is off even for its Project Control',
    coalesce(public.can_manage_reporting_workflow(A), false) = false and coalesce(public.monthly_can_manage_project(A), false) = false);
  perform pg_temp.must_fail(4, '04 AUTHORITY', 'Project Control cannot write another project''s setup (RLS)',
    format('insert into public.project_departments (project_id, department_id) values (%L, %L)', P2,
           (select id from public.departments where id <> pg_temp.id('DEPT') order by name limit 1)));
end $pcm$;
reset role;

do $rc$
declare P uuid := pg_temp.project('ZZ-2C3E-PSM'); P2 uuid := pg_temp.project('ZZ-2C3E-PSM2');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3e02","role":"authenticated"}';
  perform pg_temp.chk(4, '04 AUTHORITY', 'Reporting Coordinator: reporting workflow on its own project (unchanged)',
    public.can_manage_reporting_workflow(P) and public.is_report_coordinator(P));
  perform pg_temp.chk(4, '04 AUTHORITY', 'Reporting Coordinator: NO Project Setup, operations or responsibility authority',
    coalesce(public.can_manage_project_setup(P), false) = false and coalesce(public.can_manage_project_operations(P), false) = false
    and coalesce(public.can_manage_project_responsibilities(P), false) = false);
  perform pg_temp.chk(4, '04 AUTHORITY', 'Reporting Coordinator: nothing on another project',
    coalesce(public.can_manage_reporting_workflow(P2), false) = false);
end $rc$;
reset role;

do $dm$
declare P uuid := pg_temp.project('ZZ-2C3E-PSM'); P2 uuid := pg_temp.project('ZZ-2C3E-PSM2'); D uuid := pg_temp.id('DEPT');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3e03","role":"authenticated"}';
  perform pg_temp.chk(4, '04 AUTHORITY', 'valid PSM Department Manager keeps department-user and approve / return authority',
    public.is_department_user(P, D) and public.is_weekly_department_manager(P, D));
  perform pg_temp.chk(4, '04 AUTHORITY', 'the Department Manager holds no setup authority and nothing on another project',
    coalesce(public.can_manage_project_setup(P), false) = false and coalesce(public.is_department_user(P2, D), false) = false);
end $dm$;
reset role;

do $tm$
declare P uuid := pg_temp.project('ZZ-2C3E-PSM'); D uuid := pg_temp.id('DEPT');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3e04","role":"authenticated"}';
  perform pg_temp.chk(4, '04 AUTHORITY', 'a Team Member is a department user but not the Department Manager',
    public.is_department_user(P, D) and coalesce(public.is_weekly_department_manager(P, D), false) = false);
end $tm$;
reset role;

/* ===================== 5. descriptive assignments: zero =================== */

do $w$
declare
  P uuid := pg_temp.project('ZZ-2C3E-PSM'); D uuid := pg_temp.id('DEPT');
  -- Read as the owner, before the identity switch.
  v_descriptive boolean := exists (
    select 1 from public.project_members w
     where w.contact_id = pg_temp.person('ZZ 2C3E W') and w.party_id is not null and w.project_role is not null
       and exists (select 1 from public.project_members r where r.reports_to_member_id = w.id and r.ended_at is null));
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3e06","role":"authenticated"}';
  perform pg_temp.chk(5, '05 ZERO AUTHORITY', 'membership + Party + Project Role + being someone''s Reports To grant nothing',
    v_descriptive and not pg_temp.any_authority(P, D));
end $w$;
reset role;

do $lb$
declare P uuid := pg_temp.project('ZZ-2C3E-OTH'); D uuid := pg_temp.id('DEPT');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3e07","role":"authenticated"}';
  perform pg_temp.chk(5, '05 ZERO AUTHORITY', 'Other Unit Lead + Weekly Responsible + Monthly Backup grant nothing', not pg_temp.any_authority(P, D));
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3e08","role":"authenticated"}';
  perform pg_temp.chk(5, '05 ZERO AUTHORITY', 'Other Unit Member + Weekly Backup + Monthly Responsible grant nothing', not pg_temp.any_authority(P, D));
end $lb$;
reset role;

do $malformed$
declare
  v_project uuid; v_department uuid; v_contact uuid; v_profile uuid;
begin
  select pc.project_id, pc.department_id, pc.contact_id into v_project, v_department, v_contact
    from public.project_contacts pc
   where pc.role = 'project_manager' and pc.assignment_role = 'department_manager' limit 1;
  if v_project is null then
    perform pg_temp.chk(5, '05 MALFORMED', 'a malformed row grants no Department Manager authority', true, 'skipped: no malformed row present');
    return;
  end if;
  select p.id into v_profile from public.profiles p where p.contact_id = v_contact and p.active limit 1;
  if v_profile is null then
    v_profile := '00000000-0000-4000-a000-0000002c3e99';
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', v_profile, 'authenticated', 'authenticated', 'zz.2c3e.malformed@example.invalid',
            'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());
    insert into public.profiles (id, email, full_name, role, contact_id, active)
    values (v_profile, 'zz.2c3e.malformed@example.invalid', 'ZZ 2C3E Malformed', 'viewer', v_contact, true);
  end if;
  insert into ids(key, id) values ('M_PROJECT', v_project), ('M_DEPT', v_department), ('M_PROFILE', v_profile);
end $malformed$;

do $malformed_as_user$
declare P uuid := pg_temp.id('M_PROJECT'); D uuid := pg_temp.id('M_DEPT'); U uuid := pg_temp.id('M_PROFILE');
begin
  if P is null then return; end if;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', U, 'role', 'authenticated')::text, true);
  perform pg_temp.chk(5, '05 MALFORMED', 'a malformed legacy row (role = project_manager + department_manager) grants no Department Manager authority',
    coalesce(public.is_weekly_department_manager(P, D), false) = false and coalesce(public.is_department_user(P, D), false) = false);
end $malformed_as_user$;
reset role;

/* ========== 7. a direct write cannot misplace PCM / RC authority ========== */

do $mismatch$
declare
  P uuid := pg_temp.project('ZZ-2C3E-PSM');
  Y uuid := pg_temp.person('ZZ 2C3E Y');
  W uuid := pg_temp.person('ZZ 2C3E W');
  M uuid := pg_temp.person('ZZ 2C3E M');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3e01","role":"authenticated"}';
  perform pg_temp.at_commit(7, '07 HOLDER', 'a hidden Project Control row for someone not named on the project is refused',
    format('insert into public.project_contacts (project_id, contact_id, role) values (%L, %L, %L)', P, W, 'project_control_manager'), false);
  perform pg_temp.at_commit(7, '07 HOLDER', 'renaming the Reporting Coordinator column alone (old holder''s authority left behind) is refused',
    format('update public.projects set reporting_coordinator_id = %L where id = %L', M, P), false);
  perform pg_temp.at_commit(7, '07 HOLDER', 'clearing the Project Control column alone (authority left behind) is refused',
    format('update public.projects set project_control_manager_id = null where id = %L', P), false);
  -- Holder first: the existing removal guard keeps a still-named holder's last row.
  perform pg_temp.at_commit(7, '07 HOLDER', 'moving the named holder AND the authority row together is accepted',
    format('update public.projects set reporting_coordinator_id = %L where id = %L; '
           'update public.project_contacts set contact_id = %L where project_id = %L and role = %L and department_id is null',
           M, P, M, P, 'reporting_coordinator'), true);
end $mismatch$;
reset role;

/* ===== 6. changing / removing PCM or RC changes authority immediately ===== */

do $change$
declare
  v_pcm text := pg_temp.patch_sql('ZZ-2C3E-PSM', jsonb_build_object('project_control_manager_id', pg_temp.person('ZZ 2C3E Z')));
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3e10","role":"authenticated"}';
  perform pg_temp.must_pass(6, '06 CHANGE', 'Project Control Admin names a new Project Control (setup patch)', v_pcm);
end $change$;
reset role;
do $change_rc$
declare v_rc text := pg_temp.patch_sql('ZZ-2C3E-PSM', '{"reporting_coordinator_id":null}');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3e10","role":"authenticated"}';
  perform pg_temp.must_pass(6, '06 CHANGE', 'Project Control Admin removes the Reporting Coordinator (setup patch)', v_rc);
end $change_rc$;
reset role;
do $after$
declare P uuid := pg_temp.project('ZZ-2C3E-PSM');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3e01","role":"authenticated"}';
  perform pg_temp.chk(6, '06 CHANGE', 'the replaced Project Control loses setup and reporting authority at once',
    coalesce(public.can_manage_project_setup(P), false) = false and coalesce(public.can_manage_reporting_workflow(P), false) = false);
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3e05","role":"authenticated"}';
  perform pg_temp.chk(6, '06 CHANGE', 'the newly named Project Control gains it at once',
    public.can_manage_project_setup(P) and public.can_manage_reporting_workflow(P));
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3e02","role":"authenticated"}';
  perform pg_temp.chk(6, '06 CHANGE', 'the removed Reporting Coordinator loses reporting authority at once',
    coalesce(public.can_manage_reporting_workflow(P), false) = false and coalesce(public.is_report_coordinator(P), false) = false);
end $after$;
reset role;
do $consistent$
begin
  begin
    set constraints guard_project_authority_rows immediate;
    perform pg_temp.chk(6, '06 CHANGE', 'every change made through the application paths is consistent at commit', true);
  exception when others then
    perform pg_temp.chk(6, '06 CHANGE', 'every change made through the application paths is consistent at commit', false, left(sqlerrm, 110));
  end;
  set constraints guard_project_authority_rows deferred;
end $consistent$;

/* ============ 3. lifecycle: deleting a whole project still cascades ========= */

do $delete$
begin
  perform pg_temp.must_pass(3, '03 LIFECYCLE', 'deleting an archived project as a whole still cascades (owner)',
    format('delete from public.projects where id = %L', pg_temp.project('ZZ-2C3E-DEL')));
end $delete$;

/* ============================= 8. catalog =================================== */

do $catalog$
begin
  perform pg_temp.chk(8, '08 CATALOG', 'the archived guard is installed on the project row and all seven setup tables',
    (select count(*) from pg_trigger where tgname = 'block_archived_project_setup') = 8);
  perform pg_temp.chk(8, '08 CATALOG', 'the commit-time holder guard is installed on project_contacts and projects, deferred',
    (select count(*) from pg_trigger where tgname = 'guard_project_authority_rows' and tgdeferrable and tginitdeferred) = 2);
  perform pg_temp.chk(8, '08 CATALOG', 'the guard functions are not executable by clients',
    not has_function_privilege('authenticated', 'public.guard_archived_project_setup()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.guard_archived_project_update()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.guard_project_authority_rows()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.guard_archived_project_setup()', 'EXECUTE'));
  perform pg_temp.chk(8, '08 CATALOG', 'no authorization helper reads a descriptive assignment',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public'
                   and (p.proname ~ '^(can_|is_|has_|current_user_|current_contact_|weekly_can_|monthly_can_|executive_can_)'
                        or p.proname ~ '_accepts_department_input$')
                   and p.prosrc ~* '(project_members|project_parties|project_positions|project_delegations|project_structure_unit_members|project_structure_report_responsibilities|reports_to|functional_title|project_role)'));
  perform pg_temp.chk(8, '08 CATALOG', 'no other table''s policy reads membership or structure responsibilities',
    not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename not in ('project_members', 'project_structure_unit_members', 'project_structure_report_responsibilities')
                 and (coalesce(qual, '') || coalesce(with_check, '')) ~* '(project_members|project_structure_unit_members|project_structure_report_responsibilities)'));
  perform pg_temp.chk(8, '08 CATALOG', '2C.3C / 2C.3D Wave 1 / Wave 2 guards are still installed',
    exists (select 1 from pg_trigger where tgname = 'guard_project_member_write')
    and exists (select 1 from pg_trigger where tgname = 'guard_project_member_unit_assignments')
    and exists (select 1 from pg_trigger where tgname = 'guard_psm_assignment_membership')
    and exists (select 1 from pg_trigger where tgname = 'guard_project_member_psm_responsibilities'));
  perform pg_temp.chk(5, '05 MALFORMED', 'the six malformed legacy rows are untouched (same count and fingerprint)',
    (select count(*) from public.project_contacts where role <> 'team_member' and department_id is not null) = 6
    and (select md5(string_agg(pc.id::text || pc.contact_id || pc.role || coalesce(pc.department_id::text, '')
                                 || coalesce(pc.assignment_role, ''), ',' order by pc.id))
           from public.project_contacts pc where pc.role <> 'team_member' and pc.department_id is not null)
        = (select note from ids where key = 'MALFORMED'));
end $catalog$;

/* ================================ report ================================ */

select seq, area, item, verdict from r order by seq, area, item;
select count(*) filter (where verdict like 'PASS%') as passed,
       count(*) filter (where verdict like 'FAIL%') as failed,
       count(*) as total
  from r;

rollback;

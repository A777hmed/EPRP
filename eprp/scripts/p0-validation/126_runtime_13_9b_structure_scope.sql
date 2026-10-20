-- Phase 13.9B — Project Setup Governance — Step 4: structure / scope
-- governance — RUNTIME verification. LOCAL DATABASE ONLY.
--
-- Proves 20261019090000_project_setup_structure_governance.sql through the
-- REAL write paths (direct structure DML under RLS as the client service does
-- it, configure_project_structure_levels(), save_project_setup_relation(),
-- request_project_structure_amendment(), decide_ / withdraw_
-- project_setup_amendment()) with real authenticated roles. Everything runs in
-- ONE transaction that is ROLLED BACK.
--
-- Because an approval authorises its change "in the same transaction", and
-- this whole script is one transaction, every DIRECT-refusal case (02, 03)
-- runs BEFORE the first approval; the later cases (08) then prove the
-- binding is per project and per target, not per transaction alone.
--
--   01  not Controlled: direct structure writes work as today; a structure
--       request is refused (SETUP_NOT_CONTROLLED); nothing is logged
--   02  Other, Controlled: direct add / rename / code / move / archive /
--       reporting scope / delete / level rename / level add refused; unchanged
--       saves, display order and descriptions allowed and logged
--   03  PSM, Controlled: unchanged Departments / Programs & Studies saves pass
--       (rows kept, nothing logged); lead and project description free and
--       logged; system order ignored; add / remove system, reporting scope,
--       add / remove department, add / remove / move Program & Study refused
--   04  request validation and authority (reason, action, no-change, levels,
--       parent level, active children, duplicate name, family, field key,
--       viewer, unassigned Project Control)
--   05  Other units and levels: request → pending (target, state, labels);
--       duplicate refused; unrelated target allowed; self-approval and
--       non-approver refused; approve applies atomically (history in the same
--       transaction); rename · archive · restore · move · add · reporting
--       scope · reject (comment) · stale by state · stale by validity · level
--       rename / add / remove · duplicate label · withdraw
--   06  PSM scope: department systems and reporting, add / remove department,
--       add / move / remove Program & Study, guarded removals, free change
--       does not make a request stale
--   07  archived: pending request frozen (approve / withdraw / new request /
--       direct write refused; row unchanged)
--   08  binding: approvals in this transaction authorise no other target and
--       no other project
--   09  catalog
--
-- HOW TO RUN (after the migration is applied; from eprp/; the APP database):
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < scripts/p0-validation/126_runtime_13_9b_structure_scope.sql

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
  -- Fails (and the script writes nothing) if BEGIN did not open a transaction.
  if (select count(*) from pg_class where relname = 'r' and relpersistence = 't') <> 1 then
    raise exception 'not inside the expected transaction';
  end if;
  execute format('grant usage on schema %I to authenticated, anon',
                 (select nspname from pg_namespace where oid = pg_my_temp_schema()));
end $g$;

create temp table ids(key text primary key, id uuid, note text) on commit drop;
grant all on ids to authenticated, anon;

create or replace function pg_temp.chk(
  p_seq int, p_area text, p_item text, p_ok boolean, p_detail text default ''
) returns void language plpgsql as $$
begin
  insert into r values (p_seq, p_area, p_item,
    case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end ||
    case when coalesce(p_detail, '') = '' then '' else ' — ' || p_detail end);
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
    'refused [' || sqlstate || ']: ' || left(sqlerrm, 110));
end $$;
create or replace function pg_temp.must_pass(
  p_seq int, p_area text, p_item text, p_sql text
) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp.chk(p_seq, p_area, p_item, true);
exception when others then
  perform pg_temp.chk(p_seq, p_area, p_item, false, '[' || sqlstate || '] ' || left(sqlerrm, 120));
end $$;
create or replace function pg_temp.act(p_profile uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_profile, 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create or replace function pg_temp.id(p_key text) returns uuid language sql as $$ select id from ids where key = p_key $$;
create or replace function pg_temp.project(p_code text) returns uuid
language sql as $$ select id from ids where key = 'PRJ:' || p_code $$;
create or replace function pg_temp.person(p_name text) returns uuid
language sql as $$ select id from public.contacts where name = p_name $$;
create or replace function pg_temp.party(p_code text, p_kind text) returns uuid
language sql as $$ select pp.id from public.project_parties pp where pp.project_id = pg_temp.project(p_code) and pp.kind = p_kind limit 1 $$;
create or replace function pg_temp.n(p_key text) returns uuid language sql as $$ select id from ids where key = 'N:' || p_key $$;
create or replace function pg_temp.node(p_key text) returns public.project_structure_nodes
language sql as $$ select * from public.project_structure_nodes where id = pg_temp.n(p_key) $$;
create or replace function pg_temp.rel_sql(p_project uuid, p_relation text, p_rows jsonb) returns text
language sql as $$
  select format('select public.save_project_setup_relation(%L::uuid, (select updated_at from public.projects where id = %L::uuid), %L, %L::jsonb)',
                p_project, p_project, p_relation, p_rows)
$$;
create or replace function pg_temp.levels_sql(p_project uuid, p_levels jsonb) returns text
language sql as $$
  select format('select public.configure_project_structure_levels(%L::uuid, (select updated_at from public.projects where id = %L::uuid), %L::jsonb)',
                p_project, p_project, p_levels)
$$;
-- The editors' payloads, built from what is stored (ids kept).
create or replace function pg_temp.levels(p_project uuid) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'level_number', level_number, 'singular_label', singular_label,
                                               'plural_label', plural_label) order by level_number), '[]'::jsonb)
    from public.project_structure_levels where project_id = p_project
$$;
create or replace function pg_temp.depts(p_project uuid) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('departmentId', department_id, 'projectDescription', project_description,
                                               'leadName', lead_name, 'reportingRequired', reporting_required,
                                               'systems', systems) order by department_id), '[]'::jsonb)
    from public.project_departments where project_id = p_project
$$;
create or replace function pg_temp.discs(p_project uuid) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('disciplineId', discipline_id, 'departmentId', department_id,
                                               'systemId', system_id) order by discipline_id), '[]'::jsonb)
    from public.project_disciplines where project_id = p_project
$$;
create or replace function pg_temp.sys_entry(p_key text) returns jsonb language sql as $$
  select jsonb_build_object('id', y.id, 'code', y.code, 'name', y.name) from public.systems y where y.id = pg_temp.id(p_key)
$$;
-- The SET of system ids in a department's scope (test-side copy; the
-- migration's project_system_ids() is internal).
create or replace function pg_temp.sys_ids(p_systems jsonb) returns jsonb language sql as $$
  select coalesce((select jsonb_agg(distinct s ->> 'id' order by s ->> 'id')
                     from jsonb_array_elements(coalesce(p_systems, '[]'::jsonb)) s), '[]'::jsonb)
$$;
create or replace function pg_temp.log_count(p_project uuid, p_relation text default null) returns bigint
language sql as $$ select count(*) from public.project_setup_relation_changes
                    where project_id = p_project and (p_relation is null or relation = p_relation) $$;
-- Request: expect NULL = accepted and pending (id stored under p_key);
-- otherwise the refusal tag or SQLSTATE.
create or replace function pg_temp.req(
  p_seq int, p_area text, p_item text, p_key text, p_project uuid, p_field text, p_proposed jsonb,
  p_expect text default null, p_reason text default 'ZZ 139E structure change'
) returns void language plpgsql as $$
declare v public.project_setup_amendments;
begin
  select * into v from public.request_project_structure_amendment(p_project, p_field, p_proposed, p_reason);
  if p_key is not null then
    insert into ids(key, id) values (p_key, v.id) on conflict (key) do update set id = excluded.id;
  end if;
  perform pg_temp.chk(p_seq, p_area, p_item, p_expect is null and v.status = 'pending',
    case when p_expect is null then '' else 'request was ACCEPTED' end);
exception when others then
  perform pg_temp.chk(p_seq, p_area, p_item,
    p_expect is not null and (position(p_expect in sqlerrm) > 0 or sqlstate = p_expect),
    'refused [' || sqlstate || ']: ' || left(sqlerrm, 110));
end $$;
-- Decide: expect a resulting status (approved / rejected / stale) or a refusal tag.
create or replace function pg_temp.decide(
  p_seq int, p_area text, p_item text, p_key text, p_decision text, p_expect text, p_comment text default null
) returns void language plpgsql as $$
declare v public.project_setup_amendments;
begin
  select * into v from public.decide_project_setup_amendment(pg_temp.id(p_key), p_decision, p_comment);
  perform pg_temp.chk(p_seq, p_area, p_item, v.status = p_expect,
    'status ' || v.status || coalesce(' — ' || v.decision_comment, ''));
exception when others then
  perform pg_temp.chk(p_seq, p_area, p_item, position(p_expect in sqlerrm) > 0,
    'refused [' || sqlstate || ']: ' || left(sqlerrm, 110));
end $$;
create or replace function pg_temp.amd(p_key text) returns public.project_setup_amendments
language sql as $$ select * from public.project_setup_amendments where id = pg_temp.id(p_key) $$;

/* ========================= fixtures (as postgres) ========================= */

do $fix$
declare
  v_template uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  v_type uuid;
begin
  if v_template is null then
    raise exception 'ZZ-P0TEST-PRJ not found — this script expects the local development dataset.';
  end if;
  if to_regprocedure('public.request_project_structure_amendment(uuid,text,jsonb,text)') is null then
    raise exception 'request_project_structure_amendment not found — apply 20261019090000_project_setup_structure_governance.sql first.';
  end if;

  insert into public.project_types (name, code) values ('ZZ 139E Category', 'ZZ-139E-CAT') returning id into v_type;
  insert into public.projects (code, name, client_id, planned_start_date, planned_finish_date, status,
                               structure_family, project_type_id)
  select 'ZZ-139E-' || v.s, 'ZZ 13.9B-4 ' || v.s, p.client_id, '2026-01-01', '2027-06-30', 'active',
         v.fam, case v.fam when 'other' then v_type end
    from public.projects p,
         (values ('OFREE', 'other'), ('OTH', 'other'), ('ARC', 'other'), ('X2P', 'other'),
                 ('PFREE', 'psm'), ('PSM', 'psm')) v(s, fam)
   where p.id = v_template;
  insert into ids(key, id) select 'PRJ:' || code, id from public.projects where code like 'ZZ-139E-%';

  -- X = assigned Project Control everywhere except X2P; X2 = assigned on X2P
  -- only; Y = Reporting Coordinator; V = plain viewer; PCA / PCA2 = Project
  -- Control Admins.
  insert into public.contacts (name, email, active)
  select 'ZZ 139E ' || s, 'zz.139e.' || lower(s) || '@example.invalid', true
    from (values ('X'), ('X2'), ('Y'), ('V'), ('PCA'), ('PCA2')) v(s);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', ('00000000-0000-4000-e000-000000139e' || v.n)::uuid,
         'authenticated', 'authenticated', 'zz.139e.' || lower(v.s) || '@example.invalid',
         'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
    from (values ('X', '01'), ('X2', '02'), ('Y', '03'), ('V', '04'), ('PCA', '05'), ('PCA2', '06')) v(s, n);
  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select ('00000000-0000-4000-e000-000000139e' || v.n)::uuid, 'zz.139e.' || lower(v.s) || '@example.invalid',
         'ZZ 139E ' || v.s, v.role, pg_temp.person('ZZ 139E ' || v.s), true
    from (values ('X', '01', 'viewer'), ('X2', '02', 'viewer'), ('Y', '03', 'viewer'), ('V', '04', 'viewer'),
                 ('PCA', '05', 'project_control_admin'), ('PCA2', '06', 'project_control_admin')) v(s, n, role);
  insert into ids(key, id) values
    ('P_X', '00000000-0000-4000-e000-000000139e01'), ('P_X2', '00000000-0000-4000-e000-000000139e02'),
    ('P_Y', '00000000-0000-4000-e000-000000139e03'), ('P_V', '00000000-0000-4000-e000-000000139e04'),
    ('P_PCA', '00000000-0000-4000-e000-000000139e05'), ('P_PCA2', '00000000-0000-4000-e000-000000139e06');

  insert into public.project_members (project_id, contact_id, party_id, project_role)
  select pg_temp.project('ZZ-139E-' || p.s), pg_temp.person('ZZ 139E ' || m.s), pg_temp.party('ZZ-139E-' || p.s, 'eprom'), m.role
    from (values ('OFREE'), ('OTH'), ('ARC'), ('PFREE'), ('PSM')) p(s),
         (values ('X', 'Project Controls'), ('Y', 'Reporting Coordinator')) m(s, role);
  insert into public.project_contacts (project_id, contact_id, role)
  select pg_temp.project('ZZ-139E-' || p.s), pg_temp.person('ZZ 139E ' || m.s), m.role
    from (values ('OFREE'), ('OTH'), ('ARC'), ('PFREE'), ('PSM')) p(s),
         (values ('X', 'project_control_manager'), ('Y', 'reporting_coordinator')) m(s, role);
  update public.projects set project_control_manager_id = pg_temp.person('ZZ 139E X'),
                             reporting_coordinator_id = pg_temp.person('ZZ 139E Y')
   where code in ('ZZ-139E-OFREE', 'ZZ-139E-OTH', 'ZZ-139E-ARC', 'ZZ-139E-PFREE', 'ZZ-139E-PSM');
  insert into public.project_members (project_id, contact_id, party_id, project_role)
  values (pg_temp.project('ZZ-139E-X2P'), pg_temp.person('ZZ 139E X2'), pg_temp.party('ZZ-139E-X2P', 'eprom'), 'Project Controls');
  insert into public.project_contacts (project_id, contact_id, role)
  values (pg_temp.project('ZZ-139E-X2P'), pg_temp.person('ZZ 139E X2'), 'project_control_manager');
  update public.projects set project_control_manager_id = pg_temp.person('ZZ 139E X2') where code = 'ZZ-139E-X2P';
  insert into public.project_planning_settings (project_id, onboarding_mode)
  select id, 'new_project' from public.projects where code like 'ZZ-139E-%';

  -- PSM master data: Department A (systems A1, A2; Programs & Studies 1, 2),
  -- Department B (system B1; Program & Study 3).
  insert into public.departments (name, code) values ('ZZ 139E Dept A', 'ZZ139E-DA'), ('ZZ 139E Dept B', 'ZZ139E-DB');
  insert into ids(key, id) select case code when 'ZZ139E-DA' then 'D:A' else 'D:B' end, id
    from public.departments where code like 'ZZ139E-D%';
  insert into public.systems (name, code, department_id) values
    ('ZZ 139E Sys A1', 'ZZ139E-SA1', pg_temp.id('D:A')), ('ZZ 139E Sys A2', 'ZZ139E-SA2', pg_temp.id('D:A')),
    ('ZZ 139E Sys B1', 'ZZ139E-SB1', pg_temp.id('D:B'));
  insert into ids(key, id) select 'S:' || right(code, 2), id from public.systems where code like 'ZZ139E-S%';
  insert into public.disciplines (name, code, department_id) values
    ('ZZ 139E P&S 1', 'ZZ139E-PS1', pg_temp.id('D:A')), ('ZZ 139E P&S 2', 'ZZ139E-PS2', pg_temp.id('D:A')),
    ('ZZ 139E P&S 3', 'ZZ139E-PS3', pg_temp.id('D:B'));
  insert into ids(key, id) select 'PS:' || right(code, 1), id from public.disciplines where code like 'ZZ139E-PS%';

  insert into public.project_departments (project_id, department_id, reporting_required, systems, lead_name)
  select pg_temp.project(c), pg_temp.id('D:A'), true, jsonb_build_array(pg_temp.sys_entry('S:A1')), 'Lead One'
    from (values ('ZZ-139E-PFREE'), ('ZZ-139E-PSM')) v(c);
  insert into public.project_disciplines (project_id, discipline_id, department_id, system_id)
  select pg_temp.project(c), pg_temp.id('PS:1'), pg_temp.id('D:A'), pg_temp.id('S:A1')
    from (values ('ZZ-139E-PFREE'), ('ZZ-139E-PSM')) v(c);

  -- Other structures (before Controlled, so written directly).
  insert into public.project_structure_levels (project_id, level_number, singular_label, plural_label)
  select pg_temp.project('ZZ-139E-' || p.s), l.n, l.sg, l.pl
    from (values ('OFREE'), ('OTH'), ('ARC'), ('X2P')) p(s),
         (values (1, 'Area', 'Areas'), (2, 'Unit', 'Units'), (3, 'Package', 'Packages')) l(n, sg, pl);
  insert into public.project_structure_nodes (project_id, level_number, name, code, sort_order)
  select pg_temp.project('ZZ-139E-' || v.p), 1, v.name, v.code, v.o
    from (values ('OTH', 'A1', 'ZZE-A1', 0), ('OTH', 'A2', null, 1), ('OFREE', 'F1', null, 0),
                 ('ARC', 'R1', null, 0), ('X2P', 'Q1', null, 0)) v(p, name, code, o);
  insert into ids(key, id) select 'N:' || n.name, n.id from public.projects p join public.project_structure_nodes n on n.project_id = p.id
   where p.code like 'ZZ-139E-%';
  insert into public.project_structure_nodes (project_id, level_number, parent_id, name, weekly_reporting_required, sort_order)
  values (pg_temp.project('ZZ-139E-OTH'), 2, pg_temp.n('A1'), 'U1', true, 0),
         (pg_temp.project('ZZ-139E-OTH'), 2, pg_temp.n('A1'), 'U2', false, 1);
  insert into ids(key, id) select 'N:' || name, id from public.project_structure_nodes
   where project_id = pg_temp.project('ZZ-139E-OTH') and name in ('U1', 'U2');
  insert into public.project_structure_nodes (project_id, level_number, parent_id, name)
  values (pg_temp.project('ZZ-139E-OTH'), 3, pg_temp.n('U1'), 'K1');
  insert into ids(key, id) select 'N:K1', id from public.project_structure_nodes
   where project_id = pg_temp.project('ZZ-139E-OTH') and name = 'K1';
end;
$fix$;

-- OTH, ARC and PSM become Controlled by the real confirmed first publish
-- (X2P by its own assigned Project Control).
select pg_temp.act(pg_temp.id('P_X'));
do $anchor$
begin
  perform pg_temp.must_pass(0, '00 FIXTURE', 'OTH, ARC and PSM are Controlled by a confirmed first publish',
    format('select public.publish_planning_snapshot(p_project_id => %L::uuid, p_data_date => %L::date, p_confirm_setup_control => true)',
           pg_temp.project('ZZ-139E-OTH'), '2026-10-10') || '; ' ||
    format('select public.publish_planning_snapshot(p_project_id => %L::uuid, p_data_date => %L::date, p_confirm_setup_control => true)',
           pg_temp.project('ZZ-139E-ARC'), '2026-10-10') || '; ' ||
    format('select public.publish_planning_snapshot(p_project_id => %L::uuid, p_data_date => %L::date, p_confirm_setup_control => true)',
           pg_temp.project('ZZ-139E-PSM'), '2026-10-10'));
end $anchor$;
select pg_temp.act(pg_temp.id('P_X2'));
do $anchor2$ begin
  perform pg_temp.must_pass(0, '00 FIXTURE', 'X2P is Controlled by its own assigned Project Control',
    format('select public.publish_planning_snapshot(p_project_id => %L::uuid, p_data_date => %L::date, p_confirm_setup_control => true)',
           pg_temp.project('ZZ-139E-X2P'), '2026-10-10'));
end $anchor2$;
select pg_temp.act(pg_temp.id('P_X'));
do $anchor3$ begin
  perform pg_temp.chk(0, '00 FIXTURE', 'Controlled state: OTH / ARC / PSM / X2P yes; OFREE / PFREE no',
    public.project_setup_controlled(pg_temp.project('ZZ-139E-OTH')) and public.project_setup_controlled(pg_temp.project('ZZ-139E-ARC'))
    and public.project_setup_controlled(pg_temp.project('ZZ-139E-PSM')) and public.project_setup_controlled(pg_temp.project('ZZ-139E-X2P'))
    and not public.project_setup_controlled(pg_temp.project('ZZ-139E-OFREE'))
    and not public.project_setup_controlled(pg_temp.project('ZZ-139E-PFREE')));
end $anchor3$;

/* ======================== 01. not Controlled ============================= */

do $s01$
declare F uuid := pg_temp.project('ZZ-139E-OFREE'); P uuid := pg_temp.project('ZZ-139E-PFREE');
begin
  perform pg_temp.must_pass(1, '01 NOT CONTROLLED', 'Other: add, rename, archive a unit and add a level directly (as today)',
    format($q$insert into public.project_structure_nodes (project_id, level_number, parent_id, name) values (%L, 2, %L, 'F1-child')$q$, F, pg_temp.n('F1'))
    || '; ' || format($q$update public.project_structure_nodes set name = 'F1 renamed', code = 'ZZE-F1' where id = %L$q$, pg_temp.n('F1'))
    || '; ' || format($q$update public.project_structure_nodes set archived_at = now() where project_id = %L and name = 'F1-child'$q$, F)
    || '; ' || pg_temp.levels_sql(F, pg_temp.levels(F) || '[{"level_number": 4, "singular_label": "Task", "plural_label": "Tasks"}]'));
  perform pg_temp.must_pass(1, '01 NOT CONTROLLED', 'PSM: add a department and a Program & Study directly (as today)',
    pg_temp.rel_sql(P, 'departments', pg_temp.depts(P) || jsonb_build_array(jsonb_build_object(
      'departmentId', pg_temp.id('D:B'), 'reportingRequired', false, 'systems', jsonb_build_array(pg_temp.sys_entry('S:B1')))))
    || '; ' || pg_temp.rel_sql(P, 'disciplines', pg_temp.discs(P) || jsonb_build_array(jsonb_build_object(
      'disciplineId', pg_temp.id('PS:3'), 'departmentId', pg_temp.id('D:B'), 'systemId', pg_temp.id('S:B1')))));
  perform pg_temp.req(1, '01 NOT CONTROLLED', 'a structure request on a project that is not Controlled is refused',
    null, F, 'structure_units', jsonb_build_object('action', 'rename', 'unit_id', pg_temp.n('F1'), 'name', 'Nope'), 'SETUP_NOT_CONTROLLED');
  perform pg_temp.chk(1, '01 NOT CONTROLLED', 'nothing is logged for either project',
    pg_temp.log_count(F) = 0 and pg_temp.log_count(P) = 0);
end $s01$;

/* ================== 02. Other, Controlled: direct writes ================= */

do $s02$
declare O uuid := pg_temp.project('ZZ-139E-OTH');
begin
  perform pg_temp.must_fail(2, '02 OTHER DIRECT', 'add a unit directly → refused',
    format($q$insert into public.project_structure_nodes (project_id, level_number, parent_id, name) values (%L, 2, %L, 'U-direct')$q$, O, pg_temp.n('A2')),
    'SETUP_CONTROLLED');
  perform pg_temp.must_fail(2, '02 OTHER DIRECT', 'rename a unit directly → refused',
    format($q$update public.project_structure_nodes set name = 'U2 renamed' where id = %L$q$, pg_temp.n('U2')), 'SETUP_CONTROLLED');
  perform pg_temp.must_fail(2, '02 OTHER DIRECT', 'change a unit code directly → refused',
    format($q$update public.project_structure_nodes set code = 'ZZE-A1X' where id = %L$q$, pg_temp.n('A1')), 'SETUP_CONTROLLED');
  perform pg_temp.must_fail(2, '02 OTHER DIRECT', 're-parent a unit directly → refused',
    format('update public.project_structure_nodes set parent_id = %L where id = %L', pg_temp.n('A2'), pg_temp.n('U2')), 'SETUP_CONTROLLED');
  perform pg_temp.must_fail(2, '02 OTHER DIRECT', 'archive a unit directly → refused',
    format('update public.project_structure_nodes set archived_at = now() where id = %L', pg_temp.n('K1')), 'SETUP_CONTROLLED');
  perform pg_temp.must_fail(2, '02 OTHER DIRECT', 'change a unit''s reporting scope directly → refused',
    format('update public.project_structure_nodes set monthly_reporting_required = true where id = %L', pg_temp.n('U2')), 'SETUP_CONTROLLED');
  perform pg_temp.must_fail(2, '02 OTHER DIRECT', 'delete a unit directly → refused',
    format('delete from public.project_structure_nodes where id = %L', pg_temp.n('K1')), 'SETUP_CONTROLLED');
  perform pg_temp.must_fail(2, '02 OTHER DIRECT', 'rename a level through the levels editor → refused',
    pg_temp.levels_sql(O, (select jsonb_agg(case when e->>'level_number' = '3' then e || '{"singular_label": "Pkg", "plural_label": "Pkgs"}' else e end)
                             from jsonb_array_elements(pg_temp.levels(O)) e)), 'SETUP_CONTROLLED');
  perform pg_temp.must_fail(2, '02 OTHER DIRECT', 'add a level through the levels editor → refused',
    pg_temp.levels_sql(O, pg_temp.levels(O) || '[{"level_number": 4, "singular_label": "Task", "plural_label": "Tasks"}]'), 'SETUP_CONTROLLED');
  perform pg_temp.must_pass(2, '02 OTHER DIRECT', 'an unchanged levels save passes',
    pg_temp.levels_sql(O, pg_temp.levels(O)));
  perform pg_temp.must_pass(2, '02 OTHER DIRECT', 'an unchanged unit save (same name, code, flags) passes',
    format('update public.project_structure_nodes set name = name, code = code, weekly_reporting_required = weekly_reporting_required where id = %L',
           pg_temp.n('U1')));
  perform pg_temp.chk(2, '02 OTHER DIRECT', 'nothing governed changed and nothing was logged',
    (pg_temp.node('U2')).name = 'U2' and (pg_temp.node('K1')).archived_at is null
    and (select count(*) from public.project_structure_levels where project_id = O) = 3 and pg_temp.log_count(O) = 0);
  perform pg_temp.must_pass(2, '02 OTHER DIRECT', 'display order and description are free',
    format($q$update public.project_structure_nodes set sort_order = 5, description = 'Main processing area' where id = %L$q$, pg_temp.n('A1')));
  perform pg_temp.chk(2, '02 OTHER DIRECT', 'and logged: one structure_units row with before / after order and description',
    (select count(*) from public.project_setup_relation_changes where project_id = O) = 1
    and exists (select 1 from public.project_setup_relation_changes
                 where project_id = O and relation = 'structure_units' and record_id = pg_temp.n('A1') and action = 'changed'
                   and previous_value ->> 'sort_order' = '0' and new_value ->> 'sort_order' = '5'
                   and new_value ->> 'description' = 'Main processing area' and new_value ->> 'name' = 'A1'
                   and changed_by = pg_temp.id('P_X')));
end $s02$;

/* =================== 03. PSM, Controlled: direct saves =================== */

do $s03$
declare
  P uuid := pg_temp.project('ZZ-139E-PSM');
  v_row uuid := (select id from public.project_disciplines where project_id = pg_temp.project('ZZ-139E-PSM') and discipline_id = pg_temp.id('PS:1'));
begin
  perform pg_temp.must_pass(3, '03 PSM DIRECT', 'an unchanged Departments save passes',
    pg_temp.rel_sql(P, 'departments', pg_temp.depts(P)));
  perform pg_temp.must_pass(3, '03 PSM DIRECT', 'an unchanged Programs & Studies save passes',
    pg_temp.rel_sql(P, 'disciplines', pg_temp.discs(P)));
  perform pg_temp.chk(3, '03 PSM DIRECT', 'the Program & Study row is kept (difference save), nothing logged',
    (select id from public.project_disciplines where project_id = P and discipline_id = pg_temp.id('PS:1')) = v_row
    and pg_temp.log_count(P) = 0);
  perform pg_temp.must_pass(3, '03 PSM DIRECT', 'department lead and project description are free',
    pg_temp.rel_sql(P, 'departments', (select jsonb_agg(e || '{"leadName": "Lead Two", "projectDescription": "Crude unit scope"}')
                                         from jsonb_array_elements(pg_temp.depts(P)) e)));
  perform pg_temp.chk(3, '03 PSM DIRECT', 'and logged as one departments change (lead, description)',
    (select count(*) from public.project_setup_relation_changes where project_id = P and relation = 'departments') = 1
    and exists (select 1 from public.project_setup_relation_changes where project_id = P and relation = 'departments'
                 and previous_value ->> 'lead_name' = 'Lead One' and new_value ->> 'lead_name' = 'Lead Two'
                 and new_value ->> 'department_name' = 'ZZ 139E Dept A'));
  perform pg_temp.must_fail(3, '03 PSM DIRECT', 'add a system to the department''s scope → refused',
    pg_temp.rel_sql(P, 'departments', (select jsonb_agg(jsonb_set(e, '{systems}', (e -> 'systems') || jsonb_build_array(pg_temp.sys_entry('S:A2'))))
                                         from jsonb_array_elements(pg_temp.depts(P)) e)), 'SETUP_CONTROLLED');
  perform pg_temp.must_fail(3, '03 PSM DIRECT', 'remove the department''s last system → refused',
    pg_temp.rel_sql(P, 'departments', (select jsonb_agg(jsonb_set(e, '{systems}', '[]')) from jsonb_array_elements(pg_temp.depts(P)) e)),
    'SETUP_CONTROLLED');
  perform pg_temp.must_fail(3, '03 PSM DIRECT', 'turn the department''s reporting off → refused',
    pg_temp.rel_sql(P, 'departments', (select jsonb_agg(e || '{"reportingRequired": false}') from jsonb_array_elements(pg_temp.depts(P)) e)),
    'SETUP_CONTROLLED');
  perform pg_temp.must_fail(3, '03 PSM DIRECT', 'add a department → refused',
    pg_temp.rel_sql(P, 'departments', pg_temp.depts(P) || jsonb_build_array(jsonb_build_object(
      'departmentId', pg_temp.id('D:B'), 'reportingRequired', false, 'systems', '[]'::jsonb))), 'SETUP_CONTROLLED');
  perform pg_temp.must_fail(3, '03 PSM DIRECT', 'remove a department → refused',
    pg_temp.rel_sql(P, 'departments', '[]'), 'SETUP_CONTROLLED');
  perform pg_temp.must_fail(3, '03 PSM DIRECT', 'add a Program & Study → refused',
    pg_temp.rel_sql(P, 'disciplines', pg_temp.discs(P) || jsonb_build_array(jsonb_build_object(
      'disciplineId', pg_temp.id('PS:2'), 'departmentId', pg_temp.id('D:A'), 'systemId', pg_temp.id('S:A1')))), 'SETUP_CONTROLLED');
  perform pg_temp.must_fail(3, '03 PSM DIRECT', 'remove a Program & Study → refused',
    pg_temp.rel_sql(P, 'disciplines', '[]'), 'SETUP_CONTROLLED');
  perform pg_temp.must_fail(3, '03 PSM DIRECT', 'move a Program & Study to no system → refused',
    pg_temp.rel_sql(P, 'disciplines', (select jsonb_agg(e || '{"systemId": null}') from jsonb_array_elements(pg_temp.discs(P)) e)),
    'SETUP_CONTROLLED');
end $s03$;
select pg_temp.owner();
do $s03o$
declare P uuid := pg_temp.project('ZZ-139E-PSM');
begin
  -- System order and the stored system entry are not the governed set.
  perform pg_temp.chk(3, '03 PSM DIRECT', 'a department''s systems compare as a set (order and entry shape ignored)',
    public.project_system_ids(jsonb_build_array(pg_temp.sys_entry('S:A2'), pg_temp.sys_entry('S:A1')))
      = public.project_system_ids(jsonb_build_array(jsonb_build_object('id', pg_temp.id('S:A1')), pg_temp.sys_entry('S:A2'))));
  perform pg_temp.chk(3, '03 PSM DIRECT', 'the refused saves left the governed state unchanged',
    (select public.project_system_ids(systems) = jsonb_build_array(pg_temp.id('S:A1')::text) and reporting_required
       from public.project_departments where project_id = P)
    and (select count(*) from public.project_disciplines where project_id = P) = 1);
end $s03o$;

/* ==================== 04. request validation and authority =============== */

select pg_temp.act(pg_temp.id('P_X'));
do $s04$
declare O uuid := pg_temp.project('ZZ-139E-OTH'); P uuid := pg_temp.project('ZZ-139E-PSM');
begin
  perform pg_temp.req(4, '04 VALIDATION', 'a reason is required', null, O, 'structure_units',
    jsonb_build_object('action', 'rename', 'unit_id', pg_temp.n('U2'), 'name', 'X'), 'REASON_REQUIRED', '  ');
  perform pg_temp.req(4, '04 VALIDATION', 'an unknown action is refused', null, O, 'structure_units',
    jsonb_build_object('action', 'explode', 'unit_id', pg_temp.n('U2')), 'INVALID_STRUCTURE_CHANGE');
  perform pg_temp.req(4, '04 VALIDATION', 'a rename to the same name is refused', null, O, 'structure_units',
    jsonb_build_object('action', 'rename', 'unit_id', pg_temp.n('U2'), 'name', 'U2'), 'NO_CHANGE');
  perform pg_temp.req(4, '04 VALIDATION', 'a move to a parent on the wrong level is refused', null, O, 'structure_units',
    jsonb_build_object('action', 'move', 'unit_id', pg_temp.n('K1'), 'parent_id', pg_temp.n('A2')), 'INVALID_STRUCTURE_CHANGE');
  perform pg_temp.req(4, '04 VALIDATION', 'archiving a unit with active children is refused', null, O, 'structure_units',
    jsonb_build_object('action', 'archive', 'unit_id', pg_temp.n('A1')), 'ACTIVE_CHILDREN');
  perform pg_temp.req(4, '04 VALIDATION', 'adding a unit with an active sibling''s name is refused', null, O, 'structure_units',
    jsonb_build_object('action', 'add', 'level_number', 2, 'parent_id', pg_temp.n('A1'), 'name', 'u1'), 'DUPLICATE_UNIT');
  perform pg_temp.req(4, '04 VALIDATION', 'a reporting scope overlapping an ancestor is refused', null, O, 'structure_units',
    jsonb_build_object('action', 'set_reporting_scope', 'unit_id', pg_temp.n('K1'),
                       'weekly_reporting_required', true, 'monthly_reporting_required', false), 'REPORTING_OVERLAP');
  perform pg_temp.req(4, '04 VALIDATION', 'removing a level that has units is refused', null, O, 'structure_levels',
    jsonb_build_object('action', 'remove_level', 'level_number', 3), 'LEVEL_IN_USE');
  perform pg_temp.req(4, '04 VALIDATION', 'a level added out of order is refused', null, O, 'structure_levels',
    jsonb_build_object('action', 'add_level', 'level_number', 5, 'singular_label', 'Five', 'plural_label', 'Fives'), 'INVALID_STRUCTURE_CHANGE');
  perform pg_temp.req(4, '04 VALIDATION', 'a PSM change on an Other project is refused', null, O, 'structure_departments',
    jsonb_build_object('action', 'remove_department', 'department_id', pg_temp.id('D:A')), 'INVALID_STRUCTURE_CHANGE');
  perform pg_temp.req(4, '04 VALIDATION', 'a unit change on a PSM project is refused', null, P, 'structure_units',
    jsonb_build_object('action', 'archive', 'unit_id', pg_temp.n('A2')), 'INVALID_STRUCTURE_CHANGE');
  perform pg_temp.req(4, '04 VALIDATION', 'a field key is not a structure change', null, O, 'code',
    jsonb_build_object('action', 'rename'), 'FIELD_NOT_AMENDABLE');
  perform pg_temp.req(4, '04 VALIDATION', 'removing a department that still has a Program & Study is refused', null, P, 'structure_departments',
    jsonb_build_object('action', 'remove_department', 'department_id', pg_temp.id('D:A')), 'INVALID_STRUCTURE_CHANGE');
  perform pg_temp.req(4, '04 VALIDATION', 'a department scope with another department''s system is refused', null, P, 'structure_departments',
    jsonb_build_object('action', 'set_department_scope', 'department_id', pg_temp.id('D:A'),
                       'system_ids', jsonb_build_array(pg_temp.id('S:B1')), 'reporting_required', true), 'INVALID_STRUCTURE_CHANGE');
  perform pg_temp.req(4, '04 VALIDATION', 'a Program & Study on a department outside the project is refused', null, P, 'structure_disciplines',
    jsonb_build_object('action', 'add_discipline', 'discipline_id', pg_temp.id('PS:3'), 'department_id', pg_temp.id('D:B')), 'INVALID_STRUCTURE_CHANGE');
  perform pg_temp.req(4, '04 AUTHORITY', 'assigned Project Control cannot propose on a project it is not assigned to', null,
    pg_temp.project('ZZ-139E-X2P'), 'structure_units',
    jsonb_build_object('action', 'rename', 'unit_id', pg_temp.n('Q1'), 'name', 'Q1 renamed'), 'NOT_AUTHORIZED');
  perform pg_temp.chk(4, '04 VALIDATION', 'no request row was written by any refusal',
    not exists (select 1 from public.project_setup_amendments a
                 where a.project_id in (O, P, pg_temp.project('ZZ-139E-X2P')) and a.target_key <> ''));
end $s04$;
select pg_temp.act(pg_temp.id('P_V'));
do $s04v$ begin
  perform pg_temp.req(4, '04 AUTHORITY', 'a plain viewer cannot propose a structure change', null, pg_temp.project('ZZ-139E-OTH'),
    'structure_units', jsonb_build_object('action', 'rename', 'unit_id', pg_temp.n('U2'), 'name', 'V'), 'NOT_AUTHORIZED');
end $s04v$;

/* ===================== 05. Other: units and levels flow ================== */

select pg_temp.act(pg_temp.id('P_X'));
do $s05a$
declare O uuid := pg_temp.project('ZZ-139E-OTH');
begin
  perform pg_temp.req(5, '05 UNITS', 'X proposes renaming U2 → pending', 'AM_RENAME', O, 'structure_units',
    jsonb_build_object('action', 'rename', 'unit_id', pg_temp.n('U2'), 'name', 'Unit Two', 'code', 'ZZE-U2', 'junk', 'dropped'));
  perform pg_temp.chk(5, '05 UNITS', 'the request names target, action, state, labels, impact (unknown keys dropped)',
    (select a.target_key = 'unit:' || pg_temp.n('U2') and a.amendment_class = 'governed'
            and a.previous_value -> 'unit' ->> 'name' = 'U2' and a.previous_value -> 'unit' ->> 'parent_id' = pg_temp.n('A1')::text
            and a.proposed_value ->> 'action' = 'rename' and a.proposed_value ->> 'name' = 'Unit Two'
            and not a.proposed_value ? 'junk' and a.proposed_value -> 'labels' ->> 'target' = 'U2'
            and a.proposed_value -> 'labels' ->> 'level' = 'Unit' and a.impact_code = 'STRUCTURE_SCOPE'
            and a.requested_by_name = 'ZZ 139E X'
       from public.project_setup_amendments a where a.id = pg_temp.id('AM_RENAME')));
  perform pg_temp.req(5, '05 UNITS', 'a second request on the same unit is refused', null, O, 'structure_units',
    jsonb_build_object('action', 'archive', 'unit_id', pg_temp.n('U2')), 'AMENDMENT_PENDING');
  perform pg_temp.req(5, '05 UNITS', 'a request on another unit may be pending at the same time', 'AM_ARCHIVE', O, 'structure_units',
    jsonb_build_object('action', 'archive', 'unit_id', pg_temp.n('K1')));
  perform pg_temp.decide(5, '05 UNITS', 'the requester cannot approve their own request', 'AM_RENAME', 'approve', 'SELF_APPROVAL');
  perform pg_temp.chk(5, '05 UNITS', 'still pending and nothing applied',
    (pg_temp.amd('AM_RENAME')).status = 'pending' and (pg_temp.node('U2')).name = 'U2');
end $s05a$;
select pg_temp.act(pg_temp.id('P_V'));
do $s05v$ begin
  perform pg_temp.decide(5, '05 UNITS', 'a plain viewer cannot approve', 'AM_RENAME', 'approve', 'NOT_AUTHORIZED');
end $s05v$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s05b$
declare O uuid := pg_temp.project('ZZ-139E-OTH');
begin
  perform pg_temp.decide(5, '05 UNITS', 'a different Project Control Admin approves the rename', 'AM_RENAME', 'approve', 'approved');
  perform pg_temp.chk(5, '05 UNITS', 'applied atomically: name / code changed, history row in the approval transaction, by the approver',
    (pg_temp.node('U2')).name = 'Unit Two' and (pg_temp.node('U2')).code = 'ZZE-U2'
    and exists (select 1 from public.project_setup_relation_changes c
                 where c.project_id = O and c.relation = 'structure_units' and c.record_id = pg_temp.n('U2')
                   and c.previous_value ->> 'name' = 'U2' and c.new_value ->> 'name' = 'Unit Two'
                   and c.changed_by = pg_temp.id('P_PCA')
                   and c.transaction_id = (pg_temp.amd('AM_RENAME')).applied_transaction_id));
  perform pg_temp.decide(5, '05 UNITS', 'approving an already decided request is refused', 'AM_RENAME', 'approve', 'AMENDMENT_NOT_PENDING');
  perform pg_temp.decide(5, '05 UNITS', 'archive K1 approved', 'AM_ARCHIVE', 'approve', 'approved');
  perform pg_temp.chk(5, '05 UNITS', 'K1 archived with its reporting flags cleared',
    (pg_temp.node('K1')).archived_at is not null and not (pg_temp.node('K1')).weekly_reporting_required);
end $s05b$;
select pg_temp.act(pg_temp.id('P_X'));
do $s05c$
declare O uuid := pg_temp.project('ZZ-139E-OTH');
begin
  perform pg_temp.req(5, '05 UNITS', 'propose restoring K1', 'AM_RESTORE', O, 'structure_units',
    jsonb_build_object('action', 'restore', 'unit_id', pg_temp.n('K1')));
  perform pg_temp.req(5, '05 UNITS', 'propose moving Unit Two under A2', 'AM_MOVE', O, 'structure_units',
    jsonb_build_object('action', 'move', 'unit_id', pg_temp.n('U2'), 'parent_id', pg_temp.n('A2')));
  perform pg_temp.req(5, '05 UNITS', 'propose adding U3 under A2 with Weekly input', 'AM_ADD', O, 'structure_units',
    jsonb_build_object('action', 'add', 'level_number', 2, 'parent_id', pg_temp.n('A2'), 'name', 'U3', 'weekly_reporting_required', true));
  perform pg_temp.chk(5, '05 UNITS', 'an add request is keyed by parent, level and name',
    (pg_temp.amd('AM_ADD')).target_key = 'add:' || pg_temp.n('A2') || ':2:u3'
    and (pg_temp.amd('AM_ADD')).proposed_value -> 'labels' ->> 'parent' = 'A2');
  perform pg_temp.req(5, '05 UNITS', 'propose renaming A1', 'AM_REJECT', O, 'structure_units',
    jsonb_build_object('action', 'rename', 'unit_id', pg_temp.n('A1'), 'name', 'Area One', 'code', 'ZZE-A1'));
end $s05c$;
select pg_temp.act(pg_temp.id('P_PCA2'));
do $s05d$
declare O uuid := pg_temp.project('ZZ-139E-OTH');
begin
  perform pg_temp.decide(5, '05 UNITS', 'restore K1 approved (another approver)', 'AM_RESTORE', 'approve', 'approved');
  perform pg_temp.decide(5, '05 UNITS', 'move approved', 'AM_MOVE', 'approve', 'approved');
  perform pg_temp.decide(5, '05 UNITS', 'add approved', 'AM_ADD', 'approve', 'approved');
  perform pg_temp.chk(5, '05 UNITS', 'K1 active, Unit Two under A2, U3 exists under A2 with Weekly input',
    (pg_temp.node('K1')).archived_at is null and (pg_temp.node('U2')).parent_id = pg_temp.n('A2')
    and exists (select 1 from public.project_structure_nodes n where n.project_id = O and n.name = 'U3'
                 and n.parent_id = pg_temp.n('A2') and n.level_number = 2 and n.weekly_reporting_required));
  perform pg_temp.decide(5, '05 UNITS', 'a rejection needs a comment', 'AM_REJECT', 'reject', 'DECISION_COMMENT_REQUIRED');
  perform pg_temp.decide(5, '05 UNITS', 'rejected with a comment', 'AM_REJECT', 'reject', 'rejected', 'Keep the contract name.');
  perform pg_temp.chk(5, '05 UNITS', 'the rejected rename applied nothing',
    (pg_temp.node('A1')).name = 'A1');
end $s05d$;
insert into ids(key, id) select 'N:U3', id from public.project_structure_nodes
 where project_id = (select id from ids where key = 'PRJ:ZZ-139E-OTH') and name = 'U3';

-- Stale by state: an add whose parent changes before the decision.
select pg_temp.act(pg_temp.id('P_X'));
do $s05e$
declare O uuid := pg_temp.project('ZZ-139E-OTH');
begin
  perform pg_temp.req(5, '05 STALE', 'propose adding U9 under A2', 'AM_STALE', O, 'structure_units',
    jsonb_build_object('action', 'add', 'level_number', 2, 'parent_id', pg_temp.n('A2'), 'name', 'U9'));
  perform pg_temp.req(5, '05 STALE', 'propose Monthly input on A2', 'AM_A2', O, 'structure_units',
    jsonb_build_object('action', 'set_reporting_scope', 'unit_id', pg_temp.n('A2'),
                       'weekly_reporting_required', false, 'monthly_reporting_required', true));
  -- Stale by validity: a rename whose name another unit takes first.
  perform pg_temp.req(5, '05 STALE', 'propose renaming Unit Two to Clash', 'AM_CLASH', O, 'structure_units',
    jsonb_build_object('action', 'rename', 'unit_id', pg_temp.n('U2'), 'name', 'Clash'));
end $s05e$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s05f$
declare O uuid := pg_temp.project('ZZ-139E-OTH');
begin
  perform pg_temp.decide(5, '05 STALE', 'A2 reporting scope approved', 'AM_A2', 'approve', 'approved');
  perform pg_temp.decide(5, '05 STALE', 'the add under A2 is now stale (its parent changed)', 'AM_STALE', 'approve', 'stale');
  perform pg_temp.chk(5, '05 STALE', 'stale: nothing applied, no decider, explained',
    not exists (select 1 from public.project_structure_nodes where project_id = O and name = 'U9')
    and (pg_temp.amd('AM_STALE')).decided_by is null
    and (pg_temp.amd('AM_STALE')).decision_comment like 'The structure changed after this request%');
end $s05f$;
select pg_temp.act(pg_temp.id('P_X'));
do $s05g$ begin
  perform pg_temp.req(5, '05 STALE', 'propose adding Clash under A2', 'AM_CLASH_ADD', pg_temp.project('ZZ-139E-OTH'), 'structure_units',
    jsonb_build_object('action', 'add', 'level_number', 2, 'parent_id', pg_temp.n('A2'), 'name', 'Clash'));
end $s05g$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s05h$ begin
  perform pg_temp.decide(5, '05 STALE', 'the add of Clash is approved', 'AM_CLASH_ADD', 'approve', 'approved');
  perform pg_temp.decide(5, '05 STALE', 'the rename to Clash is now stale (no longer valid)', 'AM_CLASH', 'approve', 'stale');
  perform pg_temp.chk(5, '05 STALE', 'the stale reason names why; Unit Two keeps its name',
    (pg_temp.amd('AM_CLASH')).decision_comment like '%can no longer be applied: Another active unit with this name%'
    and (pg_temp.node('U2')).name = 'Unit Two');
end $s05h$;

-- Levels.
select pg_temp.act(pg_temp.id('P_X'));
do $s05i$
declare O uuid := pg_temp.project('ZZ-139E-OTH');
begin
  perform pg_temp.req(5, '05 LEVELS', 'a level label already used by another level is refused', null, O, 'structure_levels',
    jsonb_build_object('action', 'rename_level', 'level_number', 3, 'singular_label', 'area', 'plural_label', 'Work Packages'), 'DUPLICATE_LABEL');
  perform pg_temp.req(5, '05 LEVELS', 'propose renaming level 3 to Work Package', 'AM_LVL_RENAME', O, 'structure_levels',
    jsonb_build_object('action', 'rename_level', 'level_number', 3, 'singular_label', 'Work Package', 'plural_label', 'Work Packages'));
  perform pg_temp.req(5, '05 LEVELS', 'one level request at a time (the level set is one target)', null, O, 'structure_levels',
    jsonb_build_object('action', 'add_level', 'level_number', 4, 'singular_label', 'Task', 'plural_label', 'Tasks'), 'AMENDMENT_PENDING');
end $s05i$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s05j$ begin
  perform pg_temp.decide(5, '05 LEVELS', 'level rename approved', 'AM_LVL_RENAME', 'approve', 'approved');
end $s05j$;
select pg_temp.act(pg_temp.id('P_X'));
do $s05k$ begin
  perform pg_temp.req(5, '05 LEVELS', 'propose adding level 4', 'AM_LVL_ADD', pg_temp.project('ZZ-139E-OTH'), 'structure_levels',
    jsonb_build_object('action', 'add_level', 'level_number', 4, 'singular_label', 'Task', 'plural_label', 'Tasks'));
end $s05k$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s05l$ begin
  perform pg_temp.decide(5, '05 LEVELS', 'level add approved', 'AM_LVL_ADD', 'approve', 'approved');
end $s05l$;
select pg_temp.act(pg_temp.id('P_X'));
do $s05m$ begin
  perform pg_temp.req(5, '05 LEVELS', 'propose removing the (empty) level 4', 'AM_LVL_DEL', pg_temp.project('ZZ-139E-OTH'), 'structure_levels',
    jsonb_build_object('action', 'remove_level', 'level_number', 4));
end $s05m$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s05n$
declare O uuid := pg_temp.project('ZZ-139E-OTH');
begin
  perform pg_temp.decide(5, '05 LEVELS', 'level removal approved', 'AM_LVL_DEL', 'approve', 'approved');
  perform pg_temp.chk(5, '05 LEVELS', 'three levels, level 3 renamed; level history recorded',
    (select count(*) from public.project_structure_levels where project_id = O) = 3
    and (select singular_label || '/' || plural_label from public.project_structure_levels where project_id = O and level_number = 3)
        = 'Work Package/Work Packages'
    and exists (select 1 from public.project_setup_relation_changes where project_id = O and relation = 'structure_levels'
                 and previous_value ->> 'singular_label' = 'Package' and new_value ->> 'singular_label' = 'Work Package'));
end $s05n$;

-- Withdraw.
select pg_temp.act(pg_temp.id('P_X'));
do $s05o$ begin
  perform pg_temp.req(5, '05 WITHDRAW', 'propose archiving U3', 'AM_WD', pg_temp.project('ZZ-139E-OTH'), 'structure_units',
    jsonb_build_object('action', 'archive', 'unit_id', pg_temp.n('U3')));
  perform pg_temp.must_pass(5, '05 WITHDRAW', 'the requester withdraws it',
    format('select public.withdraw_project_setup_amendment(%L::uuid, %L)', pg_temp.id('AM_WD'), 'Not needed'));
  perform pg_temp.chk(5, '05 WITHDRAW', 'withdrawn, nothing applied, and the target is free for a new request',
    (pg_temp.amd('AM_WD')).status = 'withdrawn' and (pg_temp.node('U3')).archived_at is null
    and not exists (select 1 from public.project_setup_amendments where project_id = pg_temp.project('ZZ-139E-OTH')
                     and target_key = 'unit:' || pg_temp.n('U3') and status = 'pending'));
end $s05o$;

/* ============================== 06. PSM scope ============================ */

do $s06a$
declare P uuid := pg_temp.project('ZZ-139E-PSM');
begin
  perform pg_temp.req(6, '06 PSM', 'propose adding system A2 to Department A', 'AM_DA', P, 'structure_departments',
    jsonb_build_object('action', 'set_department_scope', 'department_id', pg_temp.id('D:A'),
                       'system_ids', jsonb_build_array(pg_temp.id('S:A2'), pg_temp.id('S:A1')), 'reporting_required', true));
  perform pg_temp.chk(6, '06 PSM', 'labels show the department and both system sets',
    (pg_temp.amd('AM_DA')).proposed_value -> 'labels' = jsonb_build_object(
      'target', 'ZZ 139E Dept A', 'systems', '["ZZ 139E Sys A1", "ZZ 139E Sys A2"]'::jsonb,
      'current_systems', '["ZZ 139E Sys A1"]'::jsonb, 'current_reporting_required', true));
  perform pg_temp.req(6, '06 PSM', 'propose adding Department B (system B1, not reporting)', 'AM_DB', P, 'structure_departments',
    jsonb_build_object('action', 'add_department', 'department_id', pg_temp.id('D:B'),
                       'system_ids', jsonb_build_array(pg_temp.id('S:B1')), 'reporting_required', false));
end $s06a$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s06b$
declare P uuid := pg_temp.project('ZZ-139E-PSM');
begin
  perform pg_temp.decide(6, '06 PSM', 'department scope approved', 'AM_DA', 'approve', 'approved');
  perform pg_temp.decide(6, '06 PSM', 'department add approved', 'AM_DB', 'approve', 'approved');
  perform pg_temp.chk(6, '06 PSM', 'Department A holds A1 and A2 (stored shape), Department B added',
    (select pg_temp.sys_ids(systems) = pg_temp.sys_ids(jsonb_build_array(pg_temp.sys_entry('S:A1'), pg_temp.sys_entry('S:A2')))
            and systems @> jsonb_build_array(pg_temp.sys_entry('S:A2')) and lead_name = 'Lead Two'
       from public.project_departments where project_id = P and department_id = pg_temp.id('D:A'))
    and exists (select 1 from public.project_departments where project_id = P and department_id = pg_temp.id('D:B')
                 and not reporting_required));
end $s06b$;
select pg_temp.act(pg_temp.id('P_X'));
do $s06c$
declare P uuid := pg_temp.project('ZZ-139E-PSM');
begin
  perform pg_temp.req(6, '06 PSM', 'propose adding Program & Study 3 to Department B / B1', 'AM_PS3', P, 'structure_disciplines',
    jsonb_build_object('action', 'add_discipline', 'discipline_id', pg_temp.id('PS:3'), 'department_id', pg_temp.id('D:B'),
                       'system_id', pg_temp.id('S:B1')));
  perform pg_temp.req(6, '06 PSM', 'propose moving Program & Study 1 to system A2', 'AM_PS1', P, 'structure_disciplines',
    jsonb_build_object('action', 'move_discipline', 'discipline_id', pg_temp.id('PS:1'), 'department_id', pg_temp.id('D:A'),
                       'system_id', pg_temp.id('S:A2')));
end $s06c$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s06d$
declare P uuid := pg_temp.project('ZZ-139E-PSM');
begin
  perform pg_temp.decide(6, '06 PSM', 'Program & Study add approved', 'AM_PS3', 'approve', 'approved');
  perform pg_temp.decide(6, '06 PSM', 'Program & Study move approved', 'AM_PS1', 'approve', 'approved');
  perform pg_temp.chk(6, '06 PSM', 'Program & Study 3 on B / B1; Program & Study 1 on A / A2 (row kept)',
    exists (select 1 from public.project_disciplines where project_id = P and discipline_id = pg_temp.id('PS:3')
             and department_id = pg_temp.id('D:B') and system_id = pg_temp.id('S:B1'))
    and exists (select 1 from public.project_disciplines where project_id = P and discipline_id = pg_temp.id('PS:1')
                 and system_id = pg_temp.id('S:A2')));
end $s06d$;
select pg_temp.act(pg_temp.id('P_X'));
do $s06e$
declare P uuid := pg_temp.project('ZZ-139E-PSM');
begin
  perform pg_temp.req(6, '06 PSM', 'removing system A2 while Program & Study 1 uses it is refused', null, P, 'structure_departments',
    jsonb_build_object('action', 'set_department_scope', 'department_id', pg_temp.id('D:A'),
                       'system_ids', jsonb_build_array(pg_temp.id('S:A1')), 'reporting_required', true), 'INVALID_STRUCTURE_CHANGE');
  perform pg_temp.req(6, '06 PSM', 'removing Department B while Program & Study 3 is on it is refused', null, P, 'structure_departments',
    jsonb_build_object('action', 'remove_department', 'department_id', pg_temp.id('D:B')), 'INVALID_STRUCTURE_CHANGE');
  perform pg_temp.req(6, '06 PSM', 'propose removing Program & Study 3', 'AM_PS3_DEL', P, 'structure_disciplines',
    jsonb_build_object('action', 'remove_discipline', 'discipline_id', pg_temp.id('PS:3')));
  perform pg_temp.req(6, '06 PSM', 'propose turning Department A''s reporting off', 'AM_DA_REP', P, 'structure_departments',
    jsonb_build_object('action', 'set_department_scope', 'department_id', pg_temp.id('D:A'),
                       'system_ids', jsonb_build_array(pg_temp.id('S:A1'), pg_temp.id('S:A2')), 'reporting_required', false));
  -- A free change to the same department while that request is pending.
  perform pg_temp.must_pass(6, '06 PSM', 'meanwhile the department lead changes (free)',
    pg_temp.rel_sql(P, 'departments', (select jsonb_agg(case when e ->> 'departmentId' = pg_temp.id('D:A')::text
                                                             then e || '{"leadName": "Lead Three"}' else e end)
                                         from jsonb_array_elements(pg_temp.depts(P)) e)));
end $s06e$;
select pg_temp.act(pg_temp.id('P_PCA2'));
do $s06f$
declare P uuid := pg_temp.project('ZZ-139E-PSM');
begin
  perform pg_temp.decide(6, '06 PSM', 'a free change does not make the pending request stale: approved', 'AM_DA_REP', 'approve', 'approved');
  perform pg_temp.decide(6, '06 PSM', 'Program & Study removal approved', 'AM_PS3_DEL', 'approve', 'approved');
  perform pg_temp.chk(6, '06 PSM', 'Department A no longer reports, keeps its lead; Program & Study 3 removed',
    (select not reporting_required and lead_name = 'Lead Three' from public.project_departments
      where project_id = P and department_id = pg_temp.id('D:A'))
    and not exists (select 1 from public.project_disciplines where project_id = P and discipline_id = pg_temp.id('PS:3')));
end $s06f$;
select pg_temp.act(pg_temp.id('P_X'));
do $s06g$ begin
  perform pg_temp.req(6, '06 PSM', 'propose removing the now-empty Department B', 'AM_DB_DEL', pg_temp.project('ZZ-139E-PSM'), 'structure_departments',
    jsonb_build_object('action', 'remove_department', 'department_id', pg_temp.id('D:B')));
end $s06g$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s06h$
declare P uuid := pg_temp.project('ZZ-139E-PSM');
begin
  perform pg_temp.decide(6, '06 PSM', 'department removal approved', 'AM_DB_DEL', 'approve', 'approved');
  perform pg_temp.chk(6, '06 PSM', 'Department B removed; history holds Department A and Program & Study 1 changes',
    not exists (select 1 from public.project_departments where project_id = P and department_id = pg_temp.id('D:B'))
    and exists (select 1 from public.project_setup_relation_changes where project_id = P and relation = 'departments'
                 and action = 'changed' and new_value ->> 'department_name' = 'ZZ 139E Dept A'
                 and new_value -> 'systems' = '["ZZ 139E Sys A1", "ZZ 139E Sys A2"]'::jsonb)
    and exists (select 1 from public.project_setup_relation_changes where project_id = P and relation = 'disciplines'
                 and action = 'changed' and previous_value ->> 'system_name' = 'ZZ 139E Sys A1'
                 and new_value ->> 'system_name' = 'ZZ 139E Sys A2' and new_value ->> 'discipline_name' = 'ZZ 139E P&S 1'));
end $s06h$;

/* =============================== 07. archived ============================ */

select pg_temp.act(pg_temp.id('P_X'));
do $s07a$ begin
  perform pg_temp.req(7, '07 ARCHIVED', 'before archiving: a rename of R1 is pending', 'AM_ARC', pg_temp.project('ZZ-139E-ARC'), 'structure_units',
    jsonb_build_object('action', 'rename', 'unit_id', pg_temp.n('R1'), 'name', 'R1 renamed'));
end $s07a$;
select pg_temp.owner();
do $s07o$ begin
  insert into ids(key, note) values ('ARC_PRINT', (select md5(to_jsonb(a)::text) from public.project_setup_amendments a where a.id = pg_temp.id('AM_ARC')));
  update public.projects set status = 'archived', active = false, archived_at = now() where id = pg_temp.project('ZZ-139E-ARC');
end $s07o$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s07b$ begin
  perform pg_temp.decide(7, '07 ARCHIVED', 'approving the frozen request is refused', 'AM_ARC', 'approve', 'PROJECT_ARCHIVED');
  perform pg_temp.decide(7, '07 ARCHIVED', 'rejecting the frozen request is refused', 'AM_ARC', 'reject', 'PROJECT_ARCHIVED', 'no');
end $s07b$;
select pg_temp.act(pg_temp.id('P_X'));
do $s07c$
declare R uuid := pg_temp.project('ZZ-139E-ARC');
begin
  perform pg_temp.must_fail(7, '07 ARCHIVED', 'withdrawing the frozen request is refused',
    format('select public.withdraw_project_setup_amendment(%L::uuid)', pg_temp.id('AM_ARC')), '42501');
  perform pg_temp.req(7, '07 ARCHIVED', 'a new structure request is refused', null, R, 'structure_units',
    jsonb_build_object('action', 'archive', 'unit_id', pg_temp.n('R1')), '42501');
  perform pg_temp.must_fail(7, '07 ARCHIVED', 'a direct structure write is refused',
    format($q$insert into public.project_structure_nodes (project_id, level_number, name) values (%L, 1, 'R2')$q$, R), '42501');
  perform pg_temp.chk(7, '07 ARCHIVED', 'the pending request is byte-for-byte unchanged and R1 keeps its name',
    (select md5(to_jsonb(a)::text) from public.project_setup_amendments a where a.id = pg_temp.id('AM_ARC'))
      = (select note from ids where key = 'ARC_PRINT')
    and (pg_temp.node('R1')).name = 'R1');
end $s07c$;

/* ================================ 08. binding ============================ */

-- This transaction has approved many structure_units amendments on OTH. They
-- authorise exactly their own targets on OTH, nothing else.
select pg_temp.act(pg_temp.id('P_X'));
do $s08$
declare O uuid := pg_temp.project('ZZ-139E-OTH');
begin
  perform pg_temp.must_fail(8, '08 BINDING', 'a direct rename of A1 (whose request was rejected) is still refused',
    format($q$update public.project_structure_nodes set name = 'Area One' where id = %L$q$, pg_temp.n('A1')), 'SETUP_CONTROLLED');
  perform pg_temp.must_fail(8, '08 BINDING', 'a direct add of a unit nobody approved is still refused',
    format($q$insert into public.project_structure_nodes (project_id, level_number, parent_id, name) values (%L, 2, %L, 'U-unapproved')$q$,
           O, pg_temp.n('A2')), 'SETUP_CONTROLLED');
  -- (Program & Study 1 was approved in this transaction, so only another one
  -- shows the per-target binding.)
  perform pg_temp.must_fail(8, '08 BINDING', 'a direct add of Program & Study 2 (nobody approved it) is still refused',
    pg_temp.rel_sql(pg_temp.project('ZZ-139E-PSM'), 'disciplines',
      pg_temp.discs(pg_temp.project('ZZ-139E-PSM')) || jsonb_build_array(jsonb_build_object(
        'disciplineId', pg_temp.id('PS:2'), 'departmentId', pg_temp.id('D:A'), 'systemId', pg_temp.id('S:A1')))),
    'SETUP_CONTROLLED');
end $s08$;
select pg_temp.act(pg_temp.id('P_X2'));
do $s08b$ begin
  perform pg_temp.must_fail(8, '08 BINDING', 'OTH approvals authorise nothing on another project (X2P direct rename refused)',
    format($q$update public.project_structure_nodes set name = 'Q1 renamed' where id = %L$q$, pg_temp.n('Q1')), 'SETUP_CONTROLLED');
end $s08b$;

/* ================================ 09. catalog ============================ */

select pg_temp.owner();
do $s09$
begin
  perform pg_temp.chk(9, '09 CATALOG', 'the structure guard is on exactly the four structure tables',
    (select string_agg(tgrelid::regclass::text, ',' order by tgrelid::regclass::text) from pg_trigger
      where tgname = 'guard_structure_setup_controlled')
      = 'project_departments,project_disciplines,project_structure_levels,project_structure_nodes');
  perform pg_temp.chk(9, '09 CATALOG', 'the relation history trigger is on the three Step 3 and four structure tables',
    (select count(*) from pg_trigger where tgname = 'log_project_setup_relation_change') = 7);
  perform pg_temp.chk(9, '09 CATALOG', 'one pending request per project, field key and target',
    (select indexdef from pg_indexes where indexname = 'project_setup_amendments_one_pending')
      like '%(project_id, field_key, target_key) WHERE (status = ''pending''::text)%');
  perform pg_temp.chk(9, '09 CATALOG', 'request is callable by authenticated only; apply / validate / guard are internal',
    has_function_privilege('authenticated', 'public.request_project_structure_amendment(uuid,text,jsonb,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.request_project_structure_amendment(uuid,text,jsonb,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.project_setup_apply_structure(uuid,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.project_setup_apply_structure(uuid,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.project_structure_validate(uuid,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.guard_structure_setup_controlled()', 'EXECUTE'));
  perform pg_temp.chk(9, '09 CATALOG', 'the registry structure keys are governed from 13.9B-4; order and notes free',
    (select string_agg(field_key || ':' || field_class, ',' order by field_key) from public.project_setup_field_registry()
      where field_key like 'structure\_%' and field_key <> 'structure_family')
      = 'structure_departments:governed,structure_disciplines:governed,structure_display_order:free_logged,structure_levels:governed,structure_notes:free_logged,structure_units:governed');
  perform pg_temp.chk(9, '09 CATALOG', 'the eight 2C.3E block_archived_project_setup guards are unchanged in number',
    (select count(*) from pg_trigger where tgname = 'block_archived_project_setup') = 8);
end $s09$;

/* ================================ report ================================ */

select seq, area, item, verdict from r order by seq, area, item;
select count(*) filter (where verdict like 'PASS%') as passed,
       count(*) filter (where verdict like 'FAIL%') as failed,
       count(*) as total
  from r;

rollback;

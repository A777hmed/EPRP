-- Phase 13.9B — actionable notifications for STRUCTURE governance requests —
-- RUNTIME verification. LOCAL DATABASE ONLY.
--
-- Suite 127 proves the notification contract with field amendments. This suite
-- proves the SAME contract (one trigger, one table, one visibility rule) for
-- EVERY governed structure action, through the real
-- request_project_structure_amendment() / decide_ / withdraw_ functions on real
-- RLS. One transaction, ROLLED BACK.
--
--   01  SUBMIT, PSM: add department · remove department · change a
--       department's systems · add / move / remove a Program & Study — each
--       notifies exactly the active System Administrators / Project Control
--       Admins except the requester (not the inactive one, not a viewer); the
--       row carries project, request and requester
--   02  SUBMIT, Other: add · rename · move · archive · restore · reporting
--       scope (units) and add level (levels) — same recipients
--   03  one row per recipient and request; inbox rules (own rows, read_at only)
--   04  APPROVED -> requester notified (approver named); leaves approvers' inbox
--   05  REJECTED -> requester notified; the mandatory reason is on the request
--   06  STALE -> requester notified; nothing applied
--   07  WITHDRAWN -> nobody notified; leaves every approver's inbox
--   08  FROZEN (archive) -> requester notified; leaves approvers' inbox; the
--       request is byte-for-byte unchanged (still pending)
--   09  reconcile: a late approver finds every pending structure request once;
--       idempotent; decided / withdrawn / frozen ones never come back
--   10  eligibility: demoted / deactivated approvers see nothing
--
-- HOW TO RUN (after the migrations are applied; from eprp/; the APP database):
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < scripts/p0-validation/128_runtime_13_9b_structure_notifications.sql

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
create or replace function pg_temp.amend(p_key text) returns public.project_setup_amendments
language sql as $$ select * from public.project_setup_amendments where id = (select id from ids where key = p_key) $$;
create or replace function pg_temp.seen(p_key text, p_event text default null) returns bigint
language sql as $$
  select count(*) from public.user_notifications
   where source_id = pg_temp.id(p_key) and (p_event is null or event_type = p_event)
$$;
create or replace function pg_temp.recipients(p_key text, p_event text) returns uuid[]
language sql as $$
  select coalesce(array_agg(recipient_id order by recipient_id), array[]::uuid[])
    from public.user_notifications where source_id = pg_temp.id(p_key) and event_type = p_event
$$;
create or replace function pg_temp.approvers_except(p_except uuid) returns uuid[]
language sql as $$
  select coalesce(array_agg(id order by id), array[]::uuid[]) from public.profiles
   where active and role in ('system_admin', 'project_control_admin') and id <> p_except
$$;
create or replace function pg_temp.total_rows() returns bigint language sql as $$
  select count(*) from public.user_notifications
$$;
-- A structure request through the REAL function; stores its id under p_key.
create or replace function pg_temp.req(
  p_key text, p_project uuid, p_field text, p_proposed jsonb, p_reason text default 'ZZ 139G structure change'
) returns text language sql as $$
  select format('insert into ids(key, id) select %L, (public.request_project_structure_amendment(%L::uuid, %L, %L::jsonb, %L)).id',
                p_key, p_project, p_field, p_proposed, p_reason)
$$;
-- Submitted: every approver except the requester is notified once, nobody else.
create or replace function pg_temp.check_submit(p_seq int, p_area text, p_label text, p_key text, p_requester text) returns void
language plpgsql as $$
declare v_requester uuid := pg_temp.id(p_requester);
begin
  perform pg_temp.chk(p_seq, p_area, p_label || ': exactly the active approvers except the requester are notified',
    pg_temp.recipients(p_key, 'amendment_submitted') = pg_temp.approvers_except(v_requester)
    and cardinality(pg_temp.recipients(p_key, 'amendment_submitted')) >= 2);
  perform pg_temp.chk(p_seq, p_area, p_label || ': the requester, the inactive approver and a viewer are not notified',
    not v_requester = any (pg_temp.recipients(p_key, 'amendment_submitted'))
    and not pg_temp.id('P_PCAI') = any (pg_temp.recipients(p_key, 'amendment_submitted'))
    and not pg_temp.id('P_V') = any (pg_temp.recipients(p_key, 'amendment_submitted')));
  perform pg_temp.chk(p_seq, p_area, p_label || ': the row names the project, the exact request and the requester',
    (select bool_and(source_id = pg_temp.id(p_key) and project_id = (pg_temp.amend(p_key)).project_id
                     and actor_name = (pg_temp.amend(p_key)).requested_by_name and read_at is null)
       from public.user_notifications where source_id = pg_temp.id(p_key))
    and (select count(*) from public.user_notifications where source_id = pg_temp.id(p_key))
        = cardinality(pg_temp.approvers_except(v_requester)));
  perform pg_temp.chk(p_seq, p_area, p_label || ': the request is a governed structure request keyed by its target',
    (pg_temp.amend(p_key)).amendment_class = 'governed' and (pg_temp.amend(p_key)).status = 'pending'
    and (pg_temp.amend(p_key)).target_key <> '');
end $$;

/* ========================= fixtures (as postgres) ========================= */

do $fix$
declare
  v_template uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  v_type uuid;
begin
  if v_template is null then
    raise exception 'ZZ-P0TEST-PRJ not found — this script expects the local development dataset.';
  end if;
  if to_regclass('public.user_notifications') is null then
    raise exception 'user_notifications not found — apply 20261020090000_project_setup_amendment_notifications.sql first.';
  end if;

  insert into public.project_types (name, code) values ('ZZ 139G Category', 'ZZ-139G-CAT') returning id into v_type;
  insert into public.projects (code, name, client_id, planned_start_date, planned_finish_date, status, structure_family, project_type_id)
  select 'ZZ-139G-' || v.s, 'ZZ 13.9B-S ' || v.s, p.client_id, '2026-01-01', '2027-06-30', 'active', v.fam,
         case v.fam when 'other' then v_type end
    from public.projects p, (values ('PSM', 'psm'), ('OTH', 'other'), ('ARC', 'other')) v(s, fam)
   where p.id = v_template;
  insert into ids(key, id) select 'PRJ:' || code, id from public.projects where code like 'ZZ-139G-%';

  -- X = assigned Project Control (requester); PCA / PCA2 = active Project Control Admins;
  -- PCAI = INACTIVE Project Control Admin; V = plain viewer; Y = Reporting Coordinator.
  insert into public.contacts (name, email, active)
  select 'ZZ 139G ' || s, 'zz.139g.' || lower(s) || '@example.invalid', true
    from (values ('X'), ('Y'), ('V'), ('PCA'), ('PCA2'), ('PCAI')) v(s);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', ('00000000-0000-4000-f100-0000001390' || v.n)::uuid,
         'authenticated', 'authenticated', 'zz.139g.' || lower(v.s) || '@example.invalid',
         'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
    from (values ('X', '01'), ('Y', '02'), ('V', '03'), ('PCA', '04'), ('PCA2', '05'), ('PCAI', '06')) v(s, n);
  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select ('00000000-0000-4000-f100-0000001390' || v.n)::uuid, 'zz.139g.' || lower(v.s) || '@example.invalid',
         'ZZ 139G ' || v.s, v.role, pg_temp.person('ZZ 139G ' || v.s), v.active
    from (values ('X', '01', 'viewer', true), ('Y', '02', 'viewer', true), ('V', '03', 'viewer', true),
                 ('PCA', '04', 'project_control_admin', true), ('PCA2', '05', 'project_control_admin', true),
                 ('PCAI', '06', 'project_control_admin', false)) v(s, n, role, active);
  insert into ids(key, id) values
    ('P_X', '00000000-0000-4000-f100-000000139001'), ('P_Y', '00000000-0000-4000-f100-000000139002'),
    ('P_V', '00000000-0000-4000-f100-000000139003'), ('P_PCA', '00000000-0000-4000-f100-000000139004'),
    ('P_PCA2', '00000000-0000-4000-f100-000000139005'), ('P_PCAI', '00000000-0000-4000-f100-000000139006');

  insert into public.project_members (project_id, contact_id, party_id, project_role)
  select pg_temp.project('ZZ-139G-' || p.s), pg_temp.person('ZZ 139G ' || m.s), pg_temp.party('ZZ-139G-' || p.s, 'eprom'), m.role
    from (values ('PSM'), ('OTH'), ('ARC')) p(s), (values ('X', 'Project Controls'), ('Y', 'Reporting Coordinator')) m(s, role);
  insert into public.project_contacts (project_id, contact_id, role)
  select pg_temp.project('ZZ-139G-' || p.s), pg_temp.person('ZZ 139G ' || m.s), m.role
    from (values ('PSM'), ('OTH'), ('ARC')) p(s), (values ('X', 'project_control_manager'), ('Y', 'reporting_coordinator')) m(s, role);
  update public.projects set project_control_manager_id = pg_temp.person('ZZ 139G X'),
                             reporting_coordinator_id = pg_temp.person('ZZ 139G Y')
   where code like 'ZZ-139G-%';
  insert into public.project_planning_settings (project_id, onboarding_mode)
  select id, 'new_project' from public.projects where code like 'ZZ-139G-%';

  -- PSM master data. Dept A: systems A1, A2; Dept C: system C1; Dept D (not in the project): system D1.
  insert into public.departments (name, code) values
    ('ZZ 139G Dept A', 'ZZ139G-DA'), ('ZZ 139G Dept C', 'ZZ139G-DC'), ('ZZ 139G Dept D', 'ZZ139G-DD');
  insert into ids(key, id) select 'D:' || right(code, 1), id from public.departments where code like 'ZZ139G-D%';
  insert into public.systems (name, code, department_id) values
    ('ZZ 139G Sys A1', 'ZZ139G-SA1', pg_temp.id('D:A')), ('ZZ 139G Sys A2', 'ZZ139G-SA2', pg_temp.id('D:A')),
    ('ZZ 139G Sys C1', 'ZZ139G-SC1', pg_temp.id('D:C')), ('ZZ 139G Sys D1', 'ZZ139G-SD1', pg_temp.id('D:D'));
  insert into ids(key, id) select 'S:' || right(code, 2), id from public.systems where code like 'ZZ139G-S%';
  insert into public.disciplines (name, code, department_id) values
    ('ZZ 139G P&S 1', 'ZZ139G-PS1', pg_temp.id('D:A')), ('ZZ 139G P&S 2', 'ZZ139G-PS2', pg_temp.id('D:A')),
    ('ZZ 139G P&S 3', 'ZZ139G-PS3', pg_temp.id('D:A'));
  insert into ids(key, id) select 'PS:' || right(code, 1), id from public.disciplines where code like 'ZZ139G-PS%';
  insert into public.project_departments (project_id, department_id, reporting_required, systems)
  select pg_temp.project('ZZ-139G-PSM'), pg_temp.id('D:A'), true,
         (select jsonb_agg(jsonb_build_object('id', y.id, 'name', y.name, 'code', y.code) order by y.name)
            from public.systems y where y.id in (pg_temp.id('S:A1'), pg_temp.id('S:A2')));
  insert into public.project_departments (project_id, department_id, reporting_required, systems)
  select pg_temp.project('ZZ-139G-PSM'), pg_temp.id('D:C'), true,
         (select jsonb_agg(jsonb_build_object('id', y.id, 'name', y.name, 'code', y.code)) from public.systems y where y.id = pg_temp.id('S:C1'));
  insert into public.project_disciplines (project_id, discipline_id, department_id, system_id)
  values (pg_temp.project('ZZ-139G-PSM'), pg_temp.id('PS:1'), pg_temp.id('D:A'), pg_temp.id('S:A1')),
         (pg_temp.project('ZZ-139G-PSM'), pg_temp.id('PS:3'), pg_temp.id('D:A'), pg_temp.id('S:A1'));

  -- Other projects: levels Area / Unit; OTH has units, ARC has one.
  insert into public.project_structure_levels (project_id, level_number, singular_label, plural_label)
  select pg_temp.project('ZZ-139G-' || p.s), l.n, l.sg, l.pl
    from (values ('OTH'), ('ARC')) p(s), (values (1, 'Area', 'Areas'), (2, 'Unit', 'Units')) l(n, sg, pl);
  insert into public.project_structure_nodes (project_id, level_number, name, code, sort_order)
  values (pg_temp.project('ZZ-139G-OTH'), 1, 'A1', 'ZZG-A1', 0), (pg_temp.project('ZZ-139G-OTH'), 1, 'A2', null, 1),
         (pg_temp.project('ZZ-139G-ARC'), 1, 'R1', null, 0);
  insert into ids(key, id) select 'N:' || name, id from public.project_structure_nodes where project_id in (pg_temp.project('ZZ-139G-OTH'), pg_temp.project('ZZ-139G-ARC'));
  insert into public.project_structure_nodes (project_id, level_number, parent_id, name, sort_order)
  values (pg_temp.project('ZZ-139G-OTH'), 2, pg_temp.n('A1'), 'U1', 0), (pg_temp.project('ZZ-139G-OTH'), 2, pg_temp.n('A1'), 'U2', 1),
         (pg_temp.project('ZZ-139G-OTH'), 2, pg_temp.n('A1'), 'U3', 2);
  insert into ids(key, id) select 'N:' || name, id from public.project_structure_nodes
   where project_id = pg_temp.project('ZZ-139G-OTH') and name in ('U1', 'U2', 'U3');
  -- U3 starts archived (for the restore request).
  update public.project_structure_nodes set archived_at = now() where id = pg_temp.n('U3');
end;
$fix$;

select pg_temp.act(pg_temp.id('P_X'));
do $anchor$ begin
  perform pg_temp.must_pass(0, '00 FIXTURE', 'PSM, OTH and ARC are Controlled by a confirmed first publish',
    format('select public.publish_planning_snapshot(p_project_id => %L::uuid, p_data_date => %L::date, p_confirm_setup_control => true)', pg_temp.project('ZZ-139G-PSM'), '2026-10-10') || '; ' ||
    format('select public.publish_planning_snapshot(p_project_id => %L::uuid, p_data_date => %L::date, p_confirm_setup_control => true)', pg_temp.project('ZZ-139G-OTH'), '2026-10-10') || '; ' ||
    format('select public.publish_planning_snapshot(p_project_id => %L::uuid, p_data_date => %L::date, p_confirm_setup_control => true)', pg_temp.project('ZZ-139G-ARC'), '2026-10-10'));
end $anchor$;

/* ===================== 01. SUBMIT — PSM structure actions ================= */

do $s01$
declare P uuid := pg_temp.project('ZZ-139G-PSM');
begin
  perform pg_temp.must_pass(1, '01 PSM SUBMIT', 'X requests: add department D',
    pg_temp.req('S_ADD_D', P, 'structure_departments', jsonb_build_object('action', 'add_department', 'department_id', pg_temp.id('D:D'),
      'system_ids', jsonb_build_array(pg_temp.id('S:D1')), 'reporting_required', true)));
  perform pg_temp.must_pass(1, '01 PSM SUBMIT', 'X requests: remove department C',
    pg_temp.req('S_REM_C', P, 'structure_departments', jsonb_build_object('action', 'remove_department', 'department_id', pg_temp.id('D:C'))));
  perform pg_temp.must_pass(1, '01 PSM SUBMIT', 'X requests: change department A''s systems (keep A1, drop reporting)',
    pg_temp.req('S_SCOPE_A', P, 'structure_departments', jsonb_build_object('action', 'set_department_scope', 'department_id', pg_temp.id('D:A'),
      'system_ids', jsonb_build_array(pg_temp.id('S:A1'), pg_temp.id('S:A2')), 'reporting_required', false)));
  perform pg_temp.must_pass(1, '01 PSM SUBMIT', 'X requests: add Program & Study 2',
    pg_temp.req('S_ADD_PS2', P, 'structure_disciplines', jsonb_build_object('action', 'add_discipline', 'discipline_id', pg_temp.id('PS:2'),
      'department_id', pg_temp.id('D:A'), 'system_id', pg_temp.id('S:A1'))));
  perform pg_temp.must_pass(1, '01 PSM SUBMIT', 'X requests: move Program & Study 1 to system A2',
    pg_temp.req('S_MOVE_PS1', P, 'structure_disciplines', jsonb_build_object('action', 'move_discipline', 'discipline_id', pg_temp.id('PS:1'),
      'department_id', pg_temp.id('D:A'), 'system_id', pg_temp.id('S:A2'))));
  perform pg_temp.must_pass(1, '01 PSM SUBMIT', 'X requests: remove Program & Study 3',
    pg_temp.req('S_REM_PS3', P, 'structure_disciplines', jsonb_build_object('action', 'remove_discipline', 'discipline_id', pg_temp.id('PS:3'))));
end $s01$;
select pg_temp.owner();
do $s01o$ begin
  perform pg_temp.check_submit(1, '01 PSM SUBMIT', 'add department', 'S_ADD_D', 'P_X');
  perform pg_temp.check_submit(1, '01 PSM SUBMIT', 'remove department', 'S_REM_C', 'P_X');
  perform pg_temp.check_submit(1, '01 PSM SUBMIT', 'system scope change', 'S_SCOPE_A', 'P_X');
  perform pg_temp.check_submit(1, '01 PSM SUBMIT', 'add Program & Study', 'S_ADD_PS2', 'P_X');
  perform pg_temp.check_submit(1, '01 PSM SUBMIT', 'move Program & Study', 'S_MOVE_PS1', 'P_X');
  perform pg_temp.check_submit(1, '01 PSM SUBMIT', 'remove Program & Study', 'S_REM_PS3', 'P_X');
  perform pg_temp.chk(1, '01 PSM SUBMIT', 'the request carries action, labels and the target''s state for the notification wording',
    (pg_temp.amend('S_ADD_D')).proposed_value ->> 'action' = 'add_department'
    and (pg_temp.amend('S_ADD_D')).proposed_value -> 'labels' ->> 'target' = 'ZZ 139G Dept D'
    and (pg_temp.amend('S_ADD_D')).reason = 'ZZ 139G structure change'
    and (pg_temp.amend('S_SCOPE_A')).previous_value -> 'assignment' ->> 'reporting_required' = 'true'
    and (pg_temp.amend('S_SCOPE_A')).impact_warning <> '');
end $s01o$;

/* ==================== 02. SUBMIT — Other project actions =================== */

select pg_temp.act(pg_temp.id('P_X'));
do $s02$
declare O uuid := pg_temp.project('ZZ-139G-OTH');
begin
  perform pg_temp.must_pass(2, '02 OTHER SUBMIT', 'X requests: add a unit under A2',
    pg_temp.req('S_U_ADD', O, 'structure_units', jsonb_build_object('action', 'add', 'level_number', 2, 'parent_id', pg_temp.n('A2'), 'name', 'U9')));
  perform pg_temp.must_pass(2, '02 OTHER SUBMIT', 'X requests: rename U1',
    pg_temp.req('S_U_REN', O, 'structure_units', jsonb_build_object('action', 'rename', 'unit_id', pg_temp.n('U1'), 'name', 'Unit One')));
  perform pg_temp.must_pass(2, '02 OTHER SUBMIT', 'X requests: move U2 under A2',
    pg_temp.req('S_U_MOVE', O, 'structure_units', jsonb_build_object('action', 'move', 'unit_id', pg_temp.n('U2'), 'parent_id', pg_temp.n('A2'))));
  perform pg_temp.must_pass(2, '02 OTHER SUBMIT', 'X requests: archive A2 (an empty area)',
    pg_temp.req('S_U_ARCH', O, 'structure_units', jsonb_build_object('action', 'archive', 'unit_id', pg_temp.n('A2'))));
  perform pg_temp.must_pass(2, '02 OTHER SUBMIT', 'X requests: restore U3',
    pg_temp.req('S_U_REST', O, 'structure_units', jsonb_build_object('action', 'restore', 'unit_id', pg_temp.n('U3'))));
  perform pg_temp.must_pass(2, '02 OTHER SUBMIT', 'X requests: Weekly input on A1',
    pg_temp.req('S_U_SCOPE', O, 'structure_units', jsonb_build_object('action', 'set_reporting_scope', 'unit_id', pg_temp.n('A1'),
      'weekly_reporting_required', true, 'monthly_reporting_required', false)));
  perform pg_temp.must_pass(2, '02 OTHER SUBMIT', 'X requests: add a third level',
    pg_temp.req('S_L_ADD', O, 'structure_levels', jsonb_build_object('action', 'add_level', 'level_number', 3, 'singular_label', 'Package', 'plural_label', 'Packages')));
end $s02$;
select pg_temp.owner();
do $s02o$ begin
  perform pg_temp.check_submit(2, '02 OTHER SUBMIT', 'add unit', 'S_U_ADD', 'P_X');
  perform pg_temp.check_submit(2, '02 OTHER SUBMIT', 'rename unit', 'S_U_REN', 'P_X');
  perform pg_temp.check_submit(2, '02 OTHER SUBMIT', 'move unit', 'S_U_MOVE', 'P_X');
  perform pg_temp.check_submit(2, '02 OTHER SUBMIT', 'archive unit', 'S_U_ARCH', 'P_X');
  perform pg_temp.check_submit(2, '02 OTHER SUBMIT', 'restore unit', 'S_U_REST', 'P_X');
  perform pg_temp.check_submit(2, '02 OTHER SUBMIT', 'reporting scope', 'S_U_SCOPE', 'P_X');
  perform pg_temp.check_submit(2, '02 OTHER SUBMIT', 'add level', 'S_L_ADD', 'P_X');
end $s02o$;

/* ====================== 03. one row each; inbox rules ====================== */

select pg_temp.act(pg_temp.id('P_PCA'));
do $s03$ begin
  perform pg_temp.chk(3, '03 INBOX', 'PCA sees exactly one row for each of the 13 pending structure requests',
    (select count(*) from public.user_notifications n join public.project_setup_amendments a on a.id = n.source_id
      where a.target_key <> '' and a.project_id in (pg_temp.project('ZZ-139G-PSM'), pg_temp.project('ZZ-139G-OTH'))) = 13
    and (select count(distinct source_id) from public.user_notifications n join public.project_setup_amendments a on a.id = n.source_id
          where a.target_key <> '' and a.project_id in (pg_temp.project('ZZ-139G-PSM'), pg_temp.project('ZZ-139G-OTH'))) = 13);
  perform pg_temp.must_pass(3, '03 INBOX', 'PCA marks one read', format('update public.user_notifications set read_at = now() where source_id = %L', pg_temp.id('S_ADD_D')));
  perform pg_temp.must_fail(3, '03 INBOX', 'PCA cannot rewrite the event',
    format('update public.user_notifications set event_type = %L where source_id = %L', 'amendment_approved', pg_temp.id('S_ADD_D')), '42501');
end $s03$;
select pg_temp.act(pg_temp.id('P_PCA2'));
do $s03b$ begin
  perform pg_temp.chk(3, '03 INBOX', 'PCA2''s own row for the same request is still unread',
    (select read_at is null from public.user_notifications where source_id = pg_temp.id('S_ADD_D')));
end $s03b$;
select pg_temp.act(pg_temp.id('P_X'));
do $s03x$ begin
  perform pg_temp.chk(3, '03 INBOX', 'the requester sees none of the approvers'' rows for any structure request',
    (select count(*) from public.user_notifications where event_type = 'amendment_submitted') = 0);
end $s03x$;
select pg_temp.act(pg_temp.id('P_V'));
do $s03v$ begin
  perform pg_temp.chk(3, '03 INBOX', 'a plain viewer sees nothing', (select count(*) from public.user_notifications) = 0);
end $s03v$;

/* ========================= 04. APPROVED outcomes =========================== */

select pg_temp.act(pg_temp.id('P_PCA2'));
do $s04$ begin
  perform pg_temp.must_pass(4, '04 APPROVED', 'PCA2 approves "add department D"', format('select public.decide_project_setup_amendment(%L, %L)', pg_temp.id('S_ADD_D'), 'approve'));
  perform pg_temp.must_pass(4, '04 APPROVED', 'PCA2 approves "rename U1"', format('select public.decide_project_setup_amendment(%L, %L)', pg_temp.id('S_U_REN'), 'approve'));
  perform pg_temp.chk(4, '04 APPROVED', 'both left PCA2''s inbox', pg_temp.seen('S_ADD_D', 'amendment_submitted') = 0 and pg_temp.seen('S_U_REN', 'amendment_submitted') = 0);
end $s04$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s04b$ begin
  perform pg_temp.chk(4, '04 APPROVED', 'and left PCA''s inbox (nothing left to decide)', pg_temp.seen('S_ADD_D', 'amendment_submitted') = 0 and pg_temp.seen('S_U_REN', 'amendment_submitted') = 0);
end $s04b$;
select pg_temp.act(pg_temp.id('P_X'));
do $s04x$ begin
  perform pg_temp.chk(4, '04 APPROVED', 'the requester has one "approved" notification for each, naming the approver',
    pg_temp.seen('S_ADD_D', 'amendment_approved') = 1 and pg_temp.seen('S_U_REN', 'amendment_approved') = 1
    and (select bool_and(actor_name = 'ZZ 139G PCA2' and read_at is null) from public.user_notifications where event_type = 'amendment_approved'));
  perform pg_temp.chk(4, '04 APPROVED', 'what was applied is on the request the notification opens',
    (pg_temp.amend('S_ADD_D')).status = 'approved' and (pg_temp.amend('S_ADD_D')).decided_by_name = 'ZZ 139G PCA2'
    and exists (select 1 from public.project_departments where project_id = pg_temp.project('ZZ-139G-PSM') and department_id = pg_temp.id('D:D'))
    and (select name from public.project_structure_nodes where id = pg_temp.n('U1')) = 'Unit One');
end $s04x$;

/* ========================= 05. REJECTED outcomes =========================== */

select pg_temp.act(pg_temp.id('P_PCA'));
do $s05$ begin
  perform pg_temp.must_fail(5, '05 REJECTED', 'a rejection without a reason is refused',
    format('select public.decide_project_setup_amendment(%L, %L)', pg_temp.id('S_REM_C'), 'reject'), 'DECISION_COMMENT_REQUIRED');
  perform pg_temp.must_pass(5, '05 REJECTED', 'PCA rejects "remove department C" with a reason',
    format('select public.decide_project_setup_amendment(%L, %L, %L)', pg_temp.id('S_REM_C'), 'reject', 'Civil works still need Department C.'));
  perform pg_temp.must_pass(5, '05 REJECTED', 'PCA rejects "add a third level" with a reason',
    format('select public.decide_project_setup_amendment(%L, %L, %L)', pg_temp.id('S_L_ADD'), 'reject', 'Two levels are enough for now.'));
end $s05$;
select pg_temp.act(pg_temp.id('P_X'));
do $s05x$ begin
  perform pg_temp.chk(5, '05 REJECTED', 'the requester has one "rejected" notification each; the reason is on the request they open',
    pg_temp.seen('S_REM_C', 'amendment_rejected') = 1 and pg_temp.seen('S_L_ADD', 'amendment_rejected') = 1
    and (pg_temp.amend('S_REM_C')).decision_comment = 'Civil works still need Department C.'
    and (pg_temp.amend('S_L_ADD')).decision_comment = 'Two levels are enough for now.'
    and (pg_temp.amend('S_REM_C')).status = 'rejected');
  perform pg_temp.chk(5, '05 REJECTED', 'nothing was applied: Department C is still in the project, still two levels',
    exists (select 1 from public.project_departments where project_id = pg_temp.project('ZZ-139G-PSM') and department_id = pg_temp.id('D:C'))
    and (select count(*) from public.project_structure_levels where project_id = pg_temp.project('ZZ-139G-OTH')) = 2);
end $s05x$;

/* ============================ 06. STALE outcome ============================ */

-- Program & Study 1's placement changes under the pending "move to A2" request
-- (guard lifted inside this rolled-back transaction only).
select pg_temp.owner();
set constraints all immediate;
alter table public.project_disciplines disable trigger guard_structure_setup_controlled;
update public.project_disciplines set system_id = null where project_id = pg_temp.project('ZZ-139G-PSM') and discipline_id = pg_temp.id('PS:1');
alter table public.project_disciplines enable trigger guard_structure_setup_controlled;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s06$ begin
  perform pg_temp.must_pass(6, '06 STALE', 'approving "move Program & Study 1" resolves it as stale (returns normally)',
    format('select public.decide_project_setup_amendment(%L, %L)', pg_temp.id('S_MOVE_PS1'), 'approve'));
  perform pg_temp.chk(6, '06 STALE', 'recorded stale, nothing applied, explained on the request',
    (pg_temp.amend('S_MOVE_PS1')).status = 'stale' and (pg_temp.amend('S_MOVE_PS1')).decision_comment like 'The structure changed after this request%'
    and (select system_id is null from public.project_disciplines where project_id = pg_temp.project('ZZ-139G-PSM') and discipline_id = pg_temp.id('PS:1')));
end $s06$;
select pg_temp.act(pg_temp.id('P_X'));
do $s06x$ begin
  perform pg_temp.chk(6, '06 STALE', 'the requester has one "stale" notification', pg_temp.seen('S_MOVE_PS1', 'amendment_stale') = 1);
end $s06x$;

/* =========================== 07. WITHDRAWN ================================= */

select pg_temp.act(pg_temp.id('P_PCA'));
do $s07a$ begin
  perform pg_temp.chk(7, '07 WITHDRAWN', 'before withdrawal the approver sees "change department A''s systems"', pg_temp.seen('S_SCOPE_A', 'amendment_submitted') = 1);
end $s07a$;
select pg_temp.owner();
insert into ids(key, note) select 'BEFORE_WD', pg_temp.total_rows()::text;
select pg_temp.act(pg_temp.id('P_X'));
do $s07$ begin
  perform pg_temp.must_pass(7, '07 WITHDRAWN', 'the requester withdraws it',
    format('select public.withdraw_project_setup_amendment(%L::uuid, %L)', pg_temp.id('S_SCOPE_A'), 'Not needed'));
end $s07$;
select pg_temp.owner();
do $s07o$ begin
  perform pg_temp.chk(7, '07 WITHDRAWN', 'no notification was created by the withdrawal', pg_temp.total_rows() = (select note::bigint from ids where key = 'BEFORE_WD'));
end $s07o$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s07p$ begin
  perform pg_temp.chk(7, '07 WITHDRAWN', 'it is no longer actionable for any approver', pg_temp.seen('S_SCOPE_A') = 0);
end $s07p$;
select pg_temp.act(pg_temp.id('P_X'));
do $s07x$ begin
  perform pg_temp.chk(7, '07 WITHDRAWN', 'the requester has nothing for it; the request says withdrawn',
    pg_temp.seen('S_SCOPE_A') = 0 and (pg_temp.amend('S_SCOPE_A')).status = 'withdrawn');
end $s07x$;

/* ============================ 08. FROZEN (archived) ======================== */

select pg_temp.act(pg_temp.id('P_X'));
do $s08$ begin
  perform pg_temp.must_pass(8, '08 FROZEN', 'X requests a rename of R1 on ARC',
    pg_temp.req('S_ARC', pg_temp.project('ZZ-139G-ARC'), 'structure_units', jsonb_build_object('action', 'rename', 'unit_id', pg_temp.n('R1'), 'name', 'R1 renamed')));
end $s08$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s08a$ begin
  perform pg_temp.chk(8, '08 FROZEN', 'while active the approver sees it', pg_temp.seen('S_ARC', 'amendment_submitted') = 1);
end $s08a$;
select pg_temp.owner();
do $s08o$ begin
  insert into ids(key, note) values ('ARC_PRINT', (select md5(to_jsonb(a)::text) from public.project_setup_amendments a where a.id = pg_temp.id('S_ARC')));
  update public.projects set status = 'archived', active = false, archived_at = now() where id = pg_temp.project('ZZ-139G-ARC');
end $s08o$;
select pg_temp.act(pg_temp.id('P_PCA'));
do $s08b$ begin
  perform pg_temp.chk(8, '08 FROZEN', 'the frozen request is no longer actionable for an approver', pg_temp.seen('S_ARC', 'amendment_submitted') = 0);
end $s08b$;
select pg_temp.act(pg_temp.id('P_X'));
do $s08x$ begin
  perform pg_temp.chk(8, '08 FROZEN', 'the requester has one "frozen" notification', pg_temp.seen('S_ARC', 'amendment_frozen') = 1);
  perform pg_temp.chk(8, '08 FROZEN', 'the request is byte-for-byte unchanged (still pending)',
    (select md5(to_jsonb(a)::text) from public.project_setup_amendments a where a.id = pg_temp.id('S_ARC')) = (select note from ids where key = 'ARC_PRINT')
    and (pg_temp.amend('S_ARC')).status = 'pending');
end $s08x$;

/* ============================= 09. reconcile =============================== */

select pg_temp.owner();
insert into public.contacts (name, email, active) values ('ZZ 139G PCA3', 'zz.139g.pca3@example.invalid', true);
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-f100-000000139007', 'authenticated', 'authenticated',
        'zz.139g.pca3@example.invalid', 'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());
insert into public.profiles (id, email, full_name, role, contact_id, active)
values ('00000000-0000-4000-f100-000000139007', 'zz.139g.pca3@example.invalid', 'ZZ 139G PCA3', 'project_control_admin', pg_temp.person('ZZ 139G PCA3'), true);
insert into ids(key, id) values ('P_PCA3', '00000000-0000-4000-f100-000000139007');
select pg_temp.act(pg_temp.id('P_PCA3'));
do $s09$
declare v_pending int; v_fixture int;
begin
  -- Reconcile covers EVERY pending governed request the caller may decide, so the local
  -- dataset's own pending requests count too; the fixtures' share is checked separately.
  select count(*) into v_pending from public.project_setup_amendments a
   where a.status = 'pending' and a.amendment_class = 'governed' and not public.project_is_archived(a.project_id);
  select count(*) into v_fixture from public.project_setup_amendments a
   where a.status = 'pending' and a.target_key <> '' and a.project_id in (pg_temp.project('ZZ-139G-PSM'), pg_temp.project('ZZ-139G-OTH'));
  perform pg_temp.chk(9, '09 RECONCILE', 'a late approver has no rows before reconciling', (select count(*) from public.user_notifications) = 0);
  perform pg_temp.must_pass(9, '09 RECONCILE', 'reconcile runs for the caller', 'select public.reconcile_my_setup_amendment_notifications()');
  perform pg_temp.chk(9, '09 RECONCILE', 'the late approver finds every pending request exactly once, the 7 still-pending structure requests included',
    v_fixture = 7
    and (select count(*) from public.user_notifications) = v_pending
    and (select count(distinct source_id) from public.user_notifications) = v_pending
    and (select count(*) from public.user_notifications n join public.project_setup_amendments a on a.id = n.source_id
          where a.target_key <> '' and a.project_id in (pg_temp.project('ZZ-139G-PSM'), pg_temp.project('ZZ-139G-OTH'))) = v_fixture);
  perform pg_temp.chk(9, '09 RECONCILE', 'decided, withdrawn and frozen requests never come back',
    pg_temp.seen('S_ADD_D') = 0 and pg_temp.seen('S_REM_C') = 0 and pg_temp.seen('S_MOVE_PS1') = 0
    and pg_temp.seen('S_SCOPE_A') = 0 and pg_temp.seen('S_ARC') = 0);
  perform pg_temp.must_pass(9, '09 RECONCILE', 'running it again is idempotent', 'select public.reconcile_my_setup_amendment_notifications()');
  perform pg_temp.chk(9, '09 RECONCILE', 'no duplicate', (select count(*) from public.user_notifications) = v_pending);
end $s09$;
select pg_temp.act(pg_temp.id('P_X'));
do $s09x$ begin
  perform pg_temp.must_pass(9, '09 RECONCILE', 'the requester may call it', 'select public.reconcile_my_setup_amendment_notifications()');
  perform pg_temp.chk(9, '09 RECONCILE', 'but gets no approval notification for their own requests',
    (select count(*) from public.user_notifications where event_type = 'amendment_submitted') = 0);
end $s09x$;

/* ============================ 10. eligibility ============================== */

select pg_temp.owner();
update public.profiles set role = 'viewer' where id = pg_temp.id('P_PCA2');
update public.profiles set active = false where id = pg_temp.id('P_PCA3');
select pg_temp.act(pg_temp.id('P_PCA2'));
do $s10a$ begin
  perform pg_temp.chk(10, '10 ELIGIBILITY', 'demoted to viewer: no structure request is visible', pg_temp.seen('S_U_ADD') = 0 and pg_temp.seen('S_U_ARCH') = 0);
end $s10a$;
select pg_temp.act(pg_temp.id('P_PCA3'));
do $s10b$ begin
  perform pg_temp.chk(10, '10 ELIGIBILITY', 'deactivated: nothing is visible', (select count(*) from public.user_notifications) = 0);
end $s10b$;
select pg_temp.act(pg_temp.id('P_PCAI'));
do $s10c$ begin
  perform pg_temp.chk(10, '10 ELIGIBILITY', 'an inactive approver never had a row and sees nothing', (select count(*) from public.user_notifications) = 0);
end $s10c$;

/* ================================ report ================================ */

select seq, area, item, verdict from r order by seq, area, item;
select count(*) filter (where verdict like 'PASS%') as passed,
       count(*) filter (where verdict like 'FAIL%') as failed,
       count(*) as total
  from r;

rollback;

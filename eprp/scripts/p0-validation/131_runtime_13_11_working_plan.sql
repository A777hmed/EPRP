-- Phase 13.11 Working Plan hardening — RUNTIME verification. LOCAL DATABASE ONLY.
--
-- Proves 20261022090000_working_plan_hardening.sql against real PostgreSQL,
-- real RLS and real authenticated roles. Everything — fixtures, accounts and
-- every write — runs in ONE transaction that is ROLLED BACK. Nothing persists.
--
--   01  authority: Project Control (assigned PC, Project Control Admin, System
--       Administrator) edits the Working Plan; Reporting Coordinator and a
--       member cannot
--   02  integrity: kind/method, weight range, no new milestone nodes (legacy
--       rows stay editable), attach to an active node, never detach, PSM and
--       Other reporting-unit mapping (family, same project, archived unit)
--   03  change log: governed edits logged with the database's actor and
--       time; imported schedule fields left to the review decision; the log
--       is append-only and its reason rules hold
--   04  weight decisions (W3): proportional rescale (§26.5 RBI case), equal
--       split, adopt recorded, the Project root; stale / incomplete / wrong /
--       unreasoned decisions refused; unchanged children still logged
--   05  Planning Configuration: one writer, logged, stale refused, reasons
--       for a weight-source switch, onboarding mode untouched, no-formal-
--       schedule refused, onboarding not chosen refused
--   06  archived project: every 13.11 write refused for every role; reads work
--   07  boundaries: (13.12) the legacy normal publish is retired; no-formal-
--       schedule publish still refused; existing projects' weights were not
--       reinterpreted
--   08  catalog: guards answer after the 13.9 guard, functions not client-
--       callable, authority predicate byte-for-byte unchanged
--
-- HOW TO RUN (after the migration is applied; from eprp/):
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < scripts/p0-validation/131_runtime_13_11_working_plan.sql

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
grant select, insert on ids to authenticated, anon;

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

create or replace function pg_temp.act(p_profile uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_profile, 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.project(p_code text) returns uuid
language sql as $$ select id from public.projects where code = p_code $$;
create or replace function pg_temp.person(p_name text) returns uuid
language sql as $$ select id from public.contacts where name = p_name $$;
create or replace function pg_temp.party(p_code text, p_kind text) returns uuid
language sql as $$ select pp.id from public.project_parties pp join public.projects p on p.id = pp.project_id
                    where p.code = p_code and pp.kind = p_kind limit 1 $$;
create or replace function pg_temp.id(p_key text) returns uuid
language sql as $$ select id from ids where key = p_key $$;
create or replace function pg_temp.wi(p_key text) returns public.planning_work_items
language sql as $$ select * from public.planning_work_items where id = pg_temp.id(p_key) $$;
create or replace function pg_temp.ac(p_key text) returns public.planning_activities
language sql as $$ select * from public.planning_activities where id = pg_temp.id(p_key) $$;
create or replace function pg_temp.settings(p_code text) returns public.project_planning_settings
language sql as $$ select * from public.project_planning_settings where project_id = pg_temp.project(p_code) $$;

-- One node / activity insert as SQL text (run as the acting account).
create or replace function pg_temp.ins_node(p_key text, p_project text, p_code text, p_extra text default '')
returns text language sql as $$
  select format('with x as (insert into public.planning_work_items (project_id, code, name%s) values (%L, %L, %L%s) returning id) insert into ids(key, id) select %L, id from x',
    case when p_extra = '' then '' else ', ' || split_part(p_extra, '|', 1) end,
    pg_temp.project(p_project), p_code, p_code,
    case when p_extra = '' then '' else ', ' || split_part(p_extra, '|', 2) end,
    p_key)
$$;
create or replace function pg_temp.decision(p_project text, p_parent text, p_mode text, p_children jsonb, p_reason text)
returns text language sql as $$
  select format('select public.record_planning_weight_decision(%L::uuid, %s, %L, %L::jsonb, %L)',
    pg_temp.project(p_project),
    case when p_parent is null then 'null' else quote_literal(pg_temp.id(p_parent)) || '::uuid' end,
    p_mode, p_children::text, p_reason)
$$;
create or replace function pg_temp.child(p_kind text, p_key text, p_before numeric, p_after numeric)
returns jsonb language sql as $$
  select jsonb_build_object('kind', p_kind, 'id', pg_temp.id(p_key), 'before', p_before, 'after', p_after)
$$;
create or replace function pg_temp.save_config(p_code text, p_labels text[], p_ca int, p_source text, p_method text,
                                               p_expected timestamptz, p_reason text default null)
returns text language sql as $$
  select format('select public.save_planning_configuration(%L::uuid, %L::text[], %s, %s, %s, %L::timestamptz, %s)',
    pg_temp.project(p_code), p_labels, coalesce(p_ca::text, 'null'),
    coalesce(quote_literal(p_source), 'null'), coalesce(quote_literal(p_method), 'null'), p_expected,
    coalesce(quote_literal(p_reason), 'null'))
$$;

-- Snapshot of every non-fixture project's recorded and local weights.
create temp table weights_before on commit drop as
  select 'wi' as t, w.id, w.weight_percent, w.local_weight_percent from public.planning_work_items w
  union all select 'ac', a.id, a.weight_percent, a.local_weight_percent from public.planning_activities a;

/* ========================= fixtures (as postgres) ========================= */

do $fix$
declare
  v_template uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  v_type uuid;
begin
  if v_template is null then
    raise exception 'ZZ-P0TEST-PRJ not found — this script expects the local development dataset.';
  end if;
  if to_regprocedure('public.record_planning_weight_decision(uuid,uuid,text,jsonb,text)') is null then
    raise exception 'record_planning_weight_decision() not found — apply 20261022090000_working_plan_hardening.sql first.';
  end if;

  insert into public.project_types (name, code) values ('ZZ 1311 Category', 'ZZ-1311-CAT') returning id into v_type;
  insert into public.projects (code, name, client_id, planned_start_date, planned_finish_date, status,
                               structure_family, project_type_id)
  select 'ZZ-1311-' || v.s, 'ZZ 13.11 ' || v.s, p.client_id, '2026-01-01', '2027-06-30', 'active',
         v.fam, case v.fam when 'other' then v_type end
    from public.projects p,
         (values ('PSM', 'psm'), ('OTH', 'other'), ('OTH2', 'other'), ('NF', 'psm'), ('ARC', 'psm'),
                 ('NOSET', 'psm'), ('GOV', 'psm')) v(s, fam)
   where p.id = v_template;

  -- X = assigned Project Control; Y = Reporting Coordinator; M = member;
  -- PCA = Project Control Admin; SA = an existing System Administrator.
  insert into public.contacts (name, email, active)
  select 'ZZ 1311 ' || s, 'zz.1311.' || lower(s) || '@example.invalid', true
    from (values ('X'), ('Y'), ('M'), ('PCA')) v(s);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', ('00000000-0000-4000-c000-0000001311' || v.n)::uuid,
         'authenticated', 'authenticated', 'zz.1311.' || lower(v.s) || '@example.invalid',
         'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
    from (values ('X', '01'), ('Y', '02'), ('M', '03'), ('PCA', '04')) v(s, n);
  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select ('00000000-0000-4000-c000-0000001311' || v.n)::uuid, 'zz.1311.' || lower(v.s) || '@example.invalid',
         'ZZ 1311 ' || v.s, v.role, pg_temp.person('ZZ 1311 ' || v.s), true
    from (values ('X', '01', 'viewer'), ('Y', '02', 'viewer'), ('M', '03', 'viewer'),
                 ('PCA', '04', 'project_control_admin')) v(s, n, role);
  insert into ids(key, id) values
    ('P_X', '00000000-0000-4000-c000-000000131101'), ('P_Y', '00000000-0000-4000-c000-000000131102'),
    ('P_M', '00000000-0000-4000-c000-000000131103'), ('P_PCA', '00000000-0000-4000-c000-000000131104'),
    ('P_SA', (select id from public.profiles where role = 'system_admin' and active and contact_id is not null
               order by created_at limit 1));
  if pg_temp.id('P_SA') is null then
    raise exception 'No active System Administrator with a contact exists in the local dataset.';
  end if;

  insert into public.project_members (project_id, contact_id, party_id, project_role)
  select pg_temp.project('ZZ-1311-' || p.s), pg_temp.person('ZZ 1311 ' || m.s), pg_temp.party('ZZ-1311-' || p.s, 'eprom'), m.role
    from (values ('PSM'), ('OTH'), ('OTH2'), ('NF'), ('ARC'), ('NOSET'), ('GOV')) p(s),
         (values ('X', 'Project Controls'), ('Y', 'Reporting Coordinator'), ('M', 'Engineer')) m(s, role);
  insert into public.project_contacts (project_id, contact_id, role)
  select pg_temp.project('ZZ-1311-' || p.s), pg_temp.person('ZZ 1311 ' || m.s), m.role
    from (values ('PSM'), ('OTH'), ('OTH2'), ('NF'), ('ARC'), ('NOSET'), ('GOV')) p(s),
         (values ('X', 'project_control_manager'), ('Y', 'reporting_coordinator')) m(s, role);
  update public.projects
     set project_control_manager_id = pg_temp.person('ZZ 1311 X'), reporting_coordinator_id = pg_temp.person('ZZ 1311 Y')
   where code like 'ZZ-1311-%';

  insert into public.project_planning_settings (project_id, onboarding_mode)
  select pg_temp.project('ZZ-1311-' || v.s), v.mode
    from (values ('PSM', 'new_project'), ('OTH', 'new_project'), ('OTH2', 'new_project'),
                 ('NF', 'no_formal_schedule'), ('ARC', 'new_project'), ('GOV', 'new_project')) v(s, mode);

  -- PSM master data: Dept A (system A1, Program & Study 1), Dept B (system B1).
  insert into public.departments (name, code) values ('ZZ 1311 Dept A', 'ZZ1311-DA'), ('ZZ 1311 Dept B', 'ZZ1311-DB');
  insert into ids(key, id) select case code when 'ZZ1311-DA' then 'D:A' else 'D:B' end, id
    from public.departments where code like 'ZZ1311-D%';
  insert into public.systems (name, code, department_id) values
    ('ZZ 1311 Sys A1', 'ZZ1311-SA1', pg_temp.id('D:A')), ('ZZ 1311 Sys B1', 'ZZ1311-SB1', pg_temp.id('D:B'));
  insert into ids(key, id) select 'S:' || right(code, 2), id from public.systems where code like 'ZZ1311-S%';
  insert into public.disciplines (name, code, department_id) values ('ZZ 1311 P&S 1', 'ZZ1311-PS1', pg_temp.id('D:A'));
  insert into ids(key, id) select 'PS:1', id from public.disciplines where code = 'ZZ1311-PS1';
  insert into public.project_departments (project_id, department_id, reporting_required, systems)
  values (pg_temp.project('ZZ-1311-PSM'), pg_temp.id('D:A'), true,
          jsonb_build_array(jsonb_build_object('id', pg_temp.id('S:A1'), 'code', 'ZZ1311-SA1', 'name', 'ZZ 1311 Sys A1')));
  insert into public.project_disciplines (project_id, discipline_id, department_id, system_id)
  values (pg_temp.project('ZZ-1311-PSM'), pg_temp.id('PS:1'), pg_temp.id('D:A'), pg_temp.id('S:A1'));

  -- Other structures: OTH has U1 (active) and U2 (archived); OTH2 has Z1.
  insert into public.project_structure_levels (project_id, level_number, singular_label, plural_label)
  select pg_temp.project(c), 1, 'Area', 'Areas' from (values ('ZZ-1311-OTH'), ('ZZ-1311-OTH2')) v(c);
  insert into public.project_structure_nodes (project_id, level_number, name, sort_order)
  values (pg_temp.project('ZZ-1311-OTH'), 1, 'U1', 0), (pg_temp.project('ZZ-1311-OTH'), 1, 'U2', 1),
         (pg_temp.project('ZZ-1311-OTH2'), 1, 'Z1', 0);
  insert into ids(key, id) select 'U:' || n.name, n.id from public.project_structure_nodes n
   where n.project_id in (pg_temp.project('ZZ-1311-OTH'), pg_temp.project('ZZ-1311-OTH2'));
  update public.project_structure_nodes set archived_at = now() where id = pg_temp.id('U:U2');
end;
$fix$;

/* ============================ 01. Authority ============================== */

do $s01$
declare
  v_actor text;
begin
  foreach v_actor in array array['P_X', 'P_PCA', 'P_SA'] loop
    perform pg_temp.act(pg_temp.id(v_actor));
    perform pg_temp.must_pass(1, '01 AUTHORITY', v_actor || ' adds a node with local weight, Control Account flag and default method',
      pg_temp.ins_node('N:' || v_actor, 'ZZ-1311-PSM', 'AUTH-' || v_actor,
        'local_weight_percent, is_control_account, earning_method, item_type|10, true, ''zero_hundred'', ''engineering'''));
  end loop;
  foreach v_actor in array array['P_Y', 'P_M'] loop
    perform pg_temp.act(pg_temp.id(v_actor));
    perform pg_temp.must_fail(1, '01 AUTHORITY', v_actor || ' cannot add a node',
      pg_temp.ins_node('N:' || v_actor, 'ZZ-1311-PSM', 'AUTH-' || v_actor), '42501');
    execute format('update public.planning_work_items set local_weight_percent = 99 where id = %L', pg_temp.id('N:P_X'));
    if v_actor = 'P_Y' then
      perform pg_temp.chk(1, '01 AUTHORITY', 'the Reporting Coordinator can still READ the Working Plan',
        (select count(*) from public.planning_work_items where project_id = pg_temp.project('ZZ-1311-PSM')) = 3);
    end if;
    perform pg_temp.owner();
    perform pg_temp.chk(1, '01 AUTHORITY', v_actor || ' cannot change a local weight (RLS: no row updated)',
      (select local_weight_percent from public.planning_work_items where id = pg_temp.id('N:P_X')) = 10);
  end loop;
  perform pg_temp.owner();
end $s01$;

/* ============================ 02. Integrity ============================== */

do $s02$
declare
  P uuid := pg_temp.project('ZZ-1311-PSM');
  O uuid := pg_temp.project('ZZ-1311-OTH');
begin
  perform pg_temp.act(pg_temp.id('P_X'));
  perform pg_temp.must_pass(2, '02 INTEGRITY', 'node RBI + children VDU / CDU / UTL',
    pg_temp.ins_node('N:RBI', 'ZZ-1311-PSM', 'RBI'));
  execute format('insert into public.planning_work_items (project_id, code, name, parent_work_item_id) values (%L, ''VDU'', ''VDU'', %L), (%L, ''CDU'', ''CDU'', %L), (%L, ''UTL'', ''UTL'', %L), (%L, ''OTHER-NODE'', ''Other'', null)',
                 P, pg_temp.id('N:RBI'), P, pg_temp.id('N:RBI'), P, pg_temp.id('N:RBI'), P);
  insert into ids(key, id) select 'N:' || code, id from public.planning_work_items
   where project_id = P and code in ('VDU', 'CDU', 'UTL', 'OTHER-NODE');

  -- Kind and method agree.
  perform pg_temp.must_fail(2, '02 INTEGRITY', 'a task cannot earn by the Milestone method',
    format('insert into public.planning_activities (project_id, work_item_id, name, earning_method) values (%L, %L, ''T'', ''milestone'')', P, pg_temp.id('N:VDU')),
    'planning_activities_kind_method_consistent');
  perform pg_temp.must_fail(2, '02 INTEGRITY', 'a true milestone earns only by the Milestone method',
    format('insert into public.planning_activities (project_id, work_item_id, name, is_milestone, earning_method) values (%L, %L, ''M'', true, ''percent_complete'')', P, pg_temp.id('N:VDU')),
    'planning_activities_kind_method_consistent');
  perform pg_temp.must_fail(2, '02 INTEGRITY', 'a local weight above 100 is refused',
    format('update public.planning_work_items set local_weight_percent = 100.5 where id = %L', pg_temp.id('N:VDU')),
    'local_weight_range');
  perform pg_temp.must_pass(2, '02 INTEGRITY', 'a manual task and a true milestone under VDU',
    format('with x as (insert into public.planning_activities (project_id, work_item_id, code, name, source, earning_method, planned_start_date, planned_finish_date, weight_percent) values (%L, %L, ''VDU-A10'', ''Data collection'', ''manual'', ''percent_complete'', ''2026-09-01'', ''2026-09-30'', 70) returning id) insert into ids(key, id) select ''A:VDU-A10'', id from x', P, pg_temp.id('N:VDU')));
  perform pg_temp.must_pass(2, '02 INTEGRITY', '... and an imported task under CDU',
    format('with x as (insert into public.planning_activities (project_id, work_item_id, code, external_id, name, source, planned_start_date) values (%L, %L, ''CDU-A10'', ''P6-CDU-A10'', ''Data collection'', ''import'', ''2026-09-01'') returning id) insert into ids(key, id) select ''A:CDU-A10'', id from x', P, pg_temp.id('N:CDU')));

  -- H5: no new milestone nodes; legacy rows stay editable.
  perform pg_temp.must_fail(2, '02 INTEGRITY', 'a new node classified "milestone" is refused',
    pg_temp.ins_node('N:MS', 'ZZ-1311-PSM', 'MS-NODE', 'item_type|''milestone'''), '[NODE_NOT_MILESTONE]');
  perform pg_temp.must_fail(2, '02 INTEGRITY', 'a new node flagged is_milestone is refused',
    pg_temp.ins_node('N:MS2', 'ZZ-1311-PSM', 'MS-NODE2', 'is_milestone|true'), '[NODE_NOT_MILESTONE]');
  perform pg_temp.must_fail(2, '02 INTEGRITY', 'an existing node cannot become a milestone',
    format('update public.planning_work_items set item_type = ''milestone'' where id = %L', pg_temp.id('N:UTL')), '[NODE_NOT_MILESTONE]');
  perform pg_temp.owner();
  alter table public.planning_work_items disable trigger guard_working_plan_item;
  insert into public.planning_work_items (project_id, code, name, item_type, is_milestone)
  values (P, 'LEGACY-MS', 'Legacy milestone node', 'milestone', true);
  alter table public.planning_work_items enable trigger guard_working_plan_item;
  insert into ids(key, id) select 'N:LEGACY', id from public.planning_work_items where project_id = P and code = 'LEGACY-MS';
  perform pg_temp.act(pg_temp.id('P_X'));
  perform pg_temp.must_pass(2, '02 INTEGRITY', 'a legacy milestone node stays readable and editable on its other fields',
    format('update public.planning_work_items set name = ''Legacy milestone node (renamed)'' where id = %L', pg_temp.id('N:LEGACY')));

  -- H3: attach to an active node; move, never detach.
  update public.planning_work_items set active = false, archived_at = now() where id = pg_temp.id('N:OTHER-NODE');
  perform pg_temp.must_fail(2, '02 INTEGRITY', 'an activity cannot attach to an archived node',
    format('update public.planning_activities set work_item_id = %L where id = %L', pg_temp.id('N:OTHER-NODE'), pg_temp.id('A:VDU-A10')),
    '[NODE_ARCHIVED]');
  perform pg_temp.must_fail(2, '02 INTEGRITY', 'an attached activity cannot be detached',
    format('update public.planning_activities set work_item_id = null where id = %L', pg_temp.id('A:CDU-A10')),
    '[ACTIVITY_DETACH]');
  perform pg_temp.must_pass(2, '02 INTEGRITY', 'an attached activity can be moved to another active node',
    format('update public.planning_activities set work_item_id = %L where id = %L', pg_temp.id('N:UTL'), pg_temp.id('A:CDU-A10')));
  execute format('update public.planning_activities set work_item_id = %L where id = %L', pg_temp.id('N:CDU'), pg_temp.id('A:CDU-A10'));
  perform pg_temp.must_fail(2, '02 INTEGRITY', 'an activity cannot attach to another project''s node (unchanged guard)',
    format('insert into public.planning_activities (project_id, work_item_id, name) values (%L, %L, ''X'')', O, pg_temp.id('N:VDU')),
    '23503');

  -- PSM mapping (H6, H7).
  perform pg_temp.must_pass(2, '02 INTEGRITY', 'PSM: a node maps to its Department → System → Program & Study',
    format('update public.planning_work_items set department_id = %L, system_id = %L, discipline_id = %L where id = %L',
           pg_temp.id('D:A'), pg_temp.id('S:A1'), pg_temp.id('PS:1'), pg_temp.id('N:VDU')));
  perform pg_temp.must_pass(2, '02 INTEGRITY', 'PSM: an activity overrides with its own department',
    format('update public.planning_activities set department_id = %L where id = %L', pg_temp.id('D:A'), pg_temp.id('A:VDU-A10')));
  perform pg_temp.must_fail(2, '02 INTEGRITY', 'PSM: a department not in the project is refused',
    format('update public.planning_work_items set department_id = %L where id = %L', pg_temp.id('D:B'), pg_temp.id('N:CDU')),
    '[REPORTING_UNIT_NOT_IN_PROJECT]');
  perform pg_temp.must_fail(2, '02 INTEGRITY', 'PSM: a system outside the department is refused',
    format('update public.planning_work_items set department_id = %L, system_id = %L where id = %L', pg_temp.id('D:A'), pg_temp.id('S:B1'), pg_temp.id('N:CDU')),
    '[REPORTING_UNIT_NOT_IN_PROJECT]');
  perform pg_temp.must_fail(2, '02 INTEGRITY', 'PSM: a system without its department is refused',
    format('update public.planning_activities set department_id = null, system_id = %L where id = %L', pg_temp.id('S:A1'), pg_temp.id('A:VDU-A10')),
    '[REPORTING_UNIT_INCOMPLETE]');
  perform pg_temp.must_fail(2, '02 INTEGRITY', 'PSM: a Project Structure unit is refused on a PSM project',
    format('update public.planning_work_items set structure_node_id = %L where id = %L', pg_temp.id('U:U1'), pg_temp.id('N:CDU')),
    '[REPORTING_UNIT_FAMILY]');

  -- Other mapping.
  perform pg_temp.must_pass(2, '02 INTEGRITY', 'Other: a node maps to one of its own active units',
    format('with x as (insert into public.planning_work_items (project_id, code, name, structure_node_id) values (%L, ''O-1'', ''O-1'', %L) returning id) insert into ids(key, id) select ''N:O-1'', id from x', O, pg_temp.id('U:U1')));
  perform pg_temp.must_fail(2, '02 INTEGRITY', 'Other: an archived unit is refused',
    format('update public.planning_work_items set structure_node_id = %L where id = %L', pg_temp.id('U:U2'), pg_temp.id('N:O-1')),
    '[REPORTING_UNIT_ARCHIVED]');
  perform pg_temp.must_fail(2, '02 INTEGRITY', 'Other: another project''s unit is refused',
    format('update public.planning_work_items set structure_node_id = %L where id = %L', pg_temp.id('U:Z1'), pg_temp.id('N:O-1')),
    '23503');
  perform pg_temp.must_fail(2, '02 INTEGRITY', 'Other: PSM columns are refused on an Other project',
    format('update public.planning_work_items set department_id = %L where id = %L', pg_temp.id('D:A'), pg_temp.id('N:O-1')),
    '[REPORTING_UNIT_FAMILY]');
  perform pg_temp.owner();
end $s02$;

/* ============================ 03. Change log ============================= */

do $s03$
declare
  v_before int;
  v_row public.planning_confirmations;
begin
  perform pg_temp.act(pg_temp.id('P_X'));
  execute format('update public.planning_work_items set local_weight_percent = 40 where id = %L', pg_temp.id('N:VDU'));
  select * into v_row from public.planning_confirmations
   where work_item_id = pg_temp.id('N:VDU') and field_name = 'local_weight_percent' order by confirmed_at desc limit 1;
  perform pg_temp.chk(3, '03 LOG', 'a local-weight edit is logged as an edit, previous → new, no reason needed',
    v_row.action = 'edit' and v_row.previous_value is null and v_row.new_value::numeric = 40 and v_row.reason is null);
  perform pg_temp.chk(3, '03 LOG', 'the actor is stamped by the database (account and contact)',
    v_row.actor_user_id = pg_temp.id('P_X') and v_row.confirmed_by_contact_id = pg_temp.person('ZZ 1311 X'));
  perform pg_temp.chk(3, '03 LOG', 'the PSM mapping edit (department, system, Program & Study) was logged',
    (select count(*) from public.planning_confirmations where work_item_id = pg_temp.id('N:VDU')
      and field_name in ('department_id', 'system_id', 'discipline_id')) = 3);

  select count(*) into v_before from public.planning_confirmations where activity_id = pg_temp.id('A:CDU-A10');
  execute format('update public.planning_activities set planned_start_date = ''2026-09-02'', status = ''x'' where id = %L', pg_temp.id('A:CDU-A10'));
  perform pg_temp.chk(3, '03 LOG', 'an IMPORTED activity''s schedule fields are left to the import review decision',
    (select count(*) from public.planning_confirmations where activity_id = pg_temp.id('A:CDU-A10')) = v_before);
  execute format('update public.planning_activities set earning_method = ''fifty_fifty'' where id = %L', pg_temp.id('A:CDU-A10'));
  perform pg_temp.chk(3, '03 LOG', '... but its EPRP-owned earning method is logged',
    exists (select 1 from public.planning_confirmations where activity_id = pg_temp.id('A:CDU-A10')
             and field_name = 'earning_method' and new_value = 'fifty_fifty' and action = 'edit'));
  perform pg_temp.chk(3, '03 LOG', 'the earlier node moves of CDU-A10 were logged (UTL, then back to CDU)',
    (select count(*) from public.planning_confirmations where activity_id = pg_temp.id('A:CDU-A10') and field_name = 'work_item_id') = 2);
  execute format('update public.planning_activities set planned_finish_date = ''2026-10-01'' where id = %L', pg_temp.id('A:VDU-A10'));
  perform pg_temp.chk(3, '03 LOG', 'a MANUAL activity''s schedule fields are logged',
    exists (select 1 from public.planning_confirmations where activity_id = pg_temp.id('A:VDU-A10')
             and field_name = 'planned_finish_date' and previous_value = '2026-09-30' and new_value = '2026-10-01'));

  perform pg_temp.must_pass(3, '03 LOG', 'a client-written edit row is accepted; actor and time are the database''s',
    format('insert into public.planning_confirmations (activity_id, action, field_name, actor_user_id, confirmed_at, confirmed_by_contact_id) values (%L, ''edit'', ''note'', %L, ''2000-01-01'', %L)',
           pg_temp.id('A:VDU-A10'), pg_temp.id('P_SA'), pg_temp.person('ZZ 1311 PCA')));
  perform pg_temp.chk(3, '03 LOG', '... the actor cannot be forged and the time cannot be back-dated',
    exists (select 1 from public.planning_confirmations where activity_id = pg_temp.id('A:VDU-A10') and field_name = 'note'
             and actor_user_id = pg_temp.id('P_X') and confirmed_at > '2026-01-01'));
  perform pg_temp.must_fail(3, '03 LOG', 'an adjust without a reason is refused',
    format('insert into public.planning_confirmations (activity_id, action, field_name) values (%L, ''adjust'', ''x'')', pg_temp.id('A:VDU-A10')),
    'planning_confirmations_reason_valid');
  perform pg_temp.must_fail(3, '03 LOG', 'a normalise row without its decision mode is refused',
    format('insert into public.planning_confirmations (activity_id, action, field_name, reason) values (%L, ''normalise'', ''x'', ''r'')', pg_temp.id('A:VDU-A10')),
    'planning_confirmations_normalise_has_mode');
  execute format('update public.planning_confirmations set reason = ''rewritten'' where activity_id = %L', pg_temp.id('A:VDU-A10'));
  execute format('delete from public.planning_confirmations where activity_id = %L', pg_temp.id('A:VDU-A10'));
  perform pg_temp.chk(3, '03 LOG', 'the log stays append-only for Project Control (no row updated or deleted)',
    not exists (select 1 from public.planning_confirmations where reason = 'rewritten')
    and (select count(*) from public.planning_confirmations where activity_id = pg_temp.id('A:VDU-A10')) >= 2);
  perform pg_temp.owner();
end $s03$;

/* ========================== 04. Weight decisions ========================= */

do $s04$
declare
  v_decision uuid;
begin
  perform pg_temp.owner();
  -- RBI: VDU 40 (set above), CDU 35, UTL blank — the §26.5 "Utilities blank" case.
  update public.planning_work_items set local_weight_percent = 35 where id = pg_temp.id('N:CDU');

  foreach v_decision in array array[pg_temp.id('P_Y'), pg_temp.id('P_M')] loop
    perform pg_temp.act(v_decision);
    perform pg_temp.must_fail(4, '04 DECISION', 'a non-Project-Control account cannot decide weights',
      pg_temp.decision('ZZ-1311-PSM', 'N:RBI', 'proportional_rescale',
        jsonb_build_array(pg_temp.child('node', 'N:VDU', 40, 53.333), pg_temp.child('node', 'N:CDU', 35, 46.667),
                          pg_temp.child('node', 'N:UTL', null, 0)), 'r'), '[NOT_AUTHORIZED]');
  end loop;

  perform pg_temp.act(pg_temp.id('P_X'));
  perform pg_temp.must_fail(4, '04 DECISION', 'a decision without a reason is refused',
    pg_temp.decision('ZZ-1311-PSM', 'N:RBI', 'proportional_rescale',
      jsonb_build_array(pg_temp.child('node', 'N:VDU', 40, 53.333), pg_temp.child('node', 'N:CDU', 35, 46.667),
                        pg_temp.child('node', 'N:UTL', null, 0)), '  '), '[REASON_REQUIRED]');
  perform pg_temp.must_fail(4, '04 DECISION', 'a decision that omits a child is refused as stale',
    pg_temp.decision('ZZ-1311-PSM', 'N:RBI', 'proportional_rescale',
      jsonb_build_array(pg_temp.child('node', 'N:VDU', 40, 53.333), pg_temp.child('node', 'N:CDU', 35, 46.667)), 'r'), 'PT409');
  perform pg_temp.must_fail(4, '04 DECISION', 'a decision built on old weights is refused as stale',
    pg_temp.decision('ZZ-1311-PSM', 'N:RBI', 'proportional_rescale',
      jsonb_build_array(pg_temp.child('node', 'N:VDU', 30, 53.333), pg_temp.child('node', 'N:CDU', 35, 46.667),
                        pg_temp.child('node', 'N:UTL', null, 0)), 'r'), 'PT409');
  perform pg_temp.must_fail(4, '04 DECISION', 'results that do not match the mode are refused',
    pg_temp.decision('ZZ-1311-PSM', 'N:RBI', 'proportional_rescale',
      jsonb_build_array(pg_temp.child('node', 'N:VDU', 40, 50), pg_temp.child('node', 'N:CDU', 35, 50),
                        pg_temp.child('node', 'N:UTL', null, 0)), 'r'), '[INVALID_DECISION]');
  perform pg_temp.must_fail(4, '04 DECISION', 'results that do not total exactly 100 are refused',
    pg_temp.decision('ZZ-1311-PSM', 'N:RBI', 'proportional_rescale',
      jsonb_build_array(pg_temp.child('node', 'N:VDU', 40, 53.333), pg_temp.child('node', 'N:CDU', 35, 46.666),
                        pg_temp.child('node', 'N:UTL', null, 0)), 'r'), '[INVALID_DECISION]');
  perform pg_temp.must_fail(4, '04 DECISION', 'equal split is refused when a weight is entered',
    pg_temp.decision('ZZ-1311-PSM', 'N:RBI', 'equal_split',
      jsonb_build_array(pg_temp.child('node', 'N:VDU', 40, 33.334), pg_temp.child('node', 'N:CDU', 35, 33.333),
                        pg_temp.child('node', 'N:UTL', null, 33.333)), 'r'), '[INVALID_DECISION]');

  execute pg_temp.decision('ZZ-1311-PSM', 'N:RBI', 'proportional_rescale',
    jsonb_build_array(pg_temp.child('node', 'N:VDU', 40, 53.333), pg_temp.child('node', 'N:CDU', 35, 46.667),
                      pg_temp.child('node', 'N:UTL', null, 0)), 'Utilities not yet scoped') into v_decision;
  perform pg_temp.chk(4, '04 DECISION', '§26.5: proportional rescale → VDU 53.333, CDU 46.667, UTL 0',
    (pg_temp.wi('N:VDU')).local_weight_percent = 53.333 and (pg_temp.wi('N:CDU')).local_weight_percent = 46.667
    and (pg_temp.wi('N:UTL')).local_weight_percent = 0);
  perform pg_temp.chk(4, '04 DECISION', 'one logged row per child: normalise, mode, decision id, parent, reason, actor',
    (select count(*) from public.planning_confirmations
      where decision_id = v_decision and action = 'normalise' and decision_mode = 'proportional_rescale'
        and decision_parent_work_item_id = pg_temp.id('N:RBI') and reason = 'Utilities not yet scoped'
        and actor_user_id = pg_temp.id('P_X') and field_name = 'local_weight_percent') = 3);
  perform pg_temp.chk(4, '04 DECISION', 'the logged previous values are the weights before the decision',
    exists (select 1 from public.planning_confirmations where decision_id = v_decision
             and work_item_id = pg_temp.id('N:UTL') and previous_value is null and new_value::numeric = 0));
  perform pg_temp.must_fail(4, '04 DECISION', 'the same decision again is refused: those weights are no longer current',
    pg_temp.decision('ZZ-1311-PSM', 'N:RBI', 'proportional_rescale',
      jsonb_build_array(pg_temp.child('node', 'N:VDU', 40, 53.333), pg_temp.child('node', 'N:CDU', 35, 46.667),
                        pg_temp.child('node', 'N:UTL', null, 0)), 'r'), 'PT409');
  perform pg_temp.must_fail(4, '04 DECISION', 'weights already totalling 100 have nothing to normalise',
    pg_temp.decision('ZZ-1311-PSM', 'N:RBI', 'proportional_rescale',
      jsonb_build_array(pg_temp.child('node', 'N:VDU', 53.333, 53.333), pg_temp.child('node', 'N:CDU', 46.667, 46.667),
                        pg_temp.child('node', 'N:UTL', 0, 0)), 'r'), '[INVALID_DECISION]');

  -- A child the decision leaves unchanged is still part of it (50 / 0 / 25 → 66.667 / 0 / 33.333).
  perform pg_temp.owner();
  insert into public.planning_work_items (project_id, code, name, parent_work_item_id, local_weight_percent)
  select pg_temp.project('ZZ-1311-PSM'), v.c, v.c, pg_temp.id('N:UTL'), v.w
    from (values ('U-A', 50::numeric), ('U-B', 0), ('U-C', 25)) v(c, w);
  insert into ids(key, id) select 'N:' || code, id from public.planning_work_items
   where project_id = pg_temp.project('ZZ-1311-PSM') and code in ('U-A', 'U-B', 'U-C');
  perform pg_temp.act(pg_temp.id('P_PCA'));
  execute pg_temp.decision('ZZ-1311-PSM', 'N:UTL', 'proportional_rescale',
    jsonb_build_array(pg_temp.child('node', 'N:U-A', 50, 66.667), pg_temp.child('node', 'N:U-B', 0, 0),
                      pg_temp.child('node', 'N:U-C', 25, 33.333)), 'Rescaled after scope review') into v_decision;
  perform pg_temp.chk(4, '04 DECISION', 'Project Control Admin decides; the unchanged child is logged as part of the decision',
    (select count(*) from public.planning_confirmations where decision_id = v_decision) = 3
    and exists (select 1 from public.planning_confirmations where decision_id = v_decision
                 and work_item_id = pg_temp.id('N:U-B') and previous_value::numeric = 0 and new_value::numeric = 0));

  -- Equal split on blank children; nodes and activities share one parent.
  perform pg_temp.owner();
  insert into public.planning_activities (project_id, work_item_id, code, name)
  select pg_temp.project('ZZ-1311-PSM'), pg_temp.id('N:U-B'), v.c, v.c from (values ('B-1'), ('B-2'), ('B-3')) v(c);
  insert into ids(key, id) select 'A:' || code, id from public.planning_activities
   where project_id = pg_temp.project('ZZ-1311-PSM') and code in ('B-1', 'B-2', 'B-3');
  perform pg_temp.act(pg_temp.id('P_SA'));
  perform pg_temp.must_pass(4, '04 DECISION', 'System Administrator: equal split of three blank activities → 33.334 / 33.333 / 33.333',
    pg_temp.decision('ZZ-1311-PSM', 'N:U-B', 'equal_split',
      jsonb_build_array(pg_temp.child('activity', 'A:B-1', null, 33.334), pg_temp.child('activity', 'A:B-2', null, 33.333),
                        pg_temp.child('activity', 'A:B-3', null, 33.333)), 'No basis to differ'));
  perform pg_temp.chk(4, '04 DECISION', '... and the weights total exactly 100',
    (select sum(local_weight_percent) from public.planning_activities where work_item_id = pg_temp.id('N:U-B')) = 100);
  perform pg_temp.must_fail(4, '04 DECISION', 'a child listed with the wrong kind is refused as stale',
    pg_temp.decision('ZZ-1311-PSM', 'N:U-B', 'proportional_rescale',
      jsonb_build_array(pg_temp.child('node', 'A:B-1', 33.334, 33.334), pg_temp.child('activity', 'A:B-2', 33.333, 33.333),
                        pg_temp.child('activity', 'A:B-3', 33.333, 33.333)), 'r'), 'PT409');

  -- Adopt recorded weights — the review of an existing project into the local model.
  perform pg_temp.owner();
  insert into public.planning_activities (project_id, work_item_id, code, name, weight_percent)
  select pg_temp.project('ZZ-1311-PSM'), pg_temp.id('N:U-C'), v.c, v.c, v.w from (values ('R-1', 60::numeric), ('R-2', 40)) v(c, w);
  insert into ids(key, id) select 'A:' || code, id from public.planning_activities
   where project_id = pg_temp.project('ZZ-1311-PSM') and code in ('R-1', 'R-2');
  perform pg_temp.act(pg_temp.id('P_X'));
  perform pg_temp.must_fail(4, '04 DECISION', 'adopting anything but the recorded weight is refused',
    pg_temp.decision('ZZ-1311-PSM', 'N:U-C', 'adopt_recorded',
      jsonb_build_array(pg_temp.child('activity', 'A:R-1', null, 61)), 'r'), '[INVALID_DECISION]');
  execute pg_temp.decision('ZZ-1311-PSM', 'N:U-C', 'adopt_recorded',
    jsonb_build_array(pg_temp.child('activity', 'A:R-1', null, 60), pg_temp.child('activity', 'A:R-2', null, 40)),
    'Imported weights reviewed: they are shares of U-C') into v_decision;
  perform pg_temp.chk(4, '04 DECISION', 'adopt recorded: local = recorded, logged as an adjust with its mode; recorded value untouched',
    (pg_temp.ac('A:R-1')).local_weight_percent = 60 and (pg_temp.ac('A:R-1')).weight_percent = 60
    and (select count(*) from public.planning_confirmations where decision_id = v_decision
          and action = 'adjust' and decision_mode = 'adopt_recorded') = 2);
  perform pg_temp.must_fail(4, '04 DECISION', 'a recorded weight never overwrites an entered local weight',
    pg_temp.decision('ZZ-1311-PSM', 'N:U-C', 'adopt_recorded',
      jsonb_build_array(pg_temp.child('activity', 'A:R-1', 60, 60)), 'r'), '[INVALID_DECISION]');

  -- The Project root: top-level nodes (and unattached activities) share 100%.
  perform pg_temp.chk(4, '04 DECISION', 'the Project root decision is reachable with a null parent',
    position('null' in pg_temp.decision('ZZ-1311-PSM', null, 'proportional_rescale', '[]'::jsonb, 'r')) > 0);
  perform pg_temp.must_fail(4, '04 DECISION', 'an empty decision is refused',
    pg_temp.decision('ZZ-1311-PSM', null, 'proportional_rescale', '[]'::jsonb, 'r'), '[INVALID_DECISION]');
  perform pg_temp.must_fail(4, '04 DECISION', 'a parent from another project is refused',
    pg_temp.decision('ZZ-1311-OTH', 'N:RBI', 'equal_split',
      jsonb_build_array(pg_temp.child('node', 'N:VDU', null, 100)), 'r'), '[NOT_FOUND]');
  perform pg_temp.owner();
end $s04$;

/* ======================== 05. Planning Configuration ===================== */

do $s05$
declare
  v_at timestamptz;
  v_count int;
begin
  v_at := (pg_temp.settings('ZZ-1311-PSM')).updated_at;
  foreach v_count in array array[2, 3] loop
    perform pg_temp.act(pg_temp.id(case v_count when 2 then 'P_Y' else 'P_M' end));
    perform pg_temp.must_fail(5, '05 CONFIG', 'a non-Project-Control account cannot save the planning configuration',
      pg_temp.save_config('ZZ-1311-PSM', array['Control Account', 'Unit'], 1, 'eprp', 'percent_complete', v_at), '[NOT_AUTHORIZED]');
  end loop;

  perform pg_temp.act(pg_temp.id('P_X'));
  perform pg_temp.must_fail(5, '05 CONFIG', 'a stale version is refused (PT409)',
    pg_temp.save_config('ZZ-1311-PSM', array['Control Account'], 1, 'eprp', 'percent_complete', '2000-01-01'), 'PT409');
  perform pg_temp.must_fail(5, '05 CONFIG', 'the reporting level must be a named level',
    pg_temp.save_config('ZZ-1311-PSM', array['Control Account'], 2, 'eprp', 'percent_complete', v_at), '[INVALID_CONFIGURATION]');
  perform pg_temp.must_fail(5, '05 CONFIG', 'at most eight levels',
    pg_temp.save_config('ZZ-1311-PSM', array['1','2','3','4','5','6','7','8','9'], 1, 'eprp', 'percent_complete', v_at),
    'project_planning_settings_level_labels_valid');
  perform pg_temp.must_fail(5, '05 CONFIG', 'a blank level name is refused',
    pg_temp.save_config('ZZ-1311-PSM', array['Control Account', '   '], 1, 'eprp', 'percent_complete', v_at),
    'project_planning_settings_level_labels_valid');
  perform pg_temp.must_fail(5, '05 CONFIG', 'an unknown weight source is refused',
    pg_temp.save_config('ZZ-1311-PSM', array['Control Account'], 1, 'excel', 'percent_complete', v_at),
    'project_planning_settings_weight_source_valid');
  perform pg_temp.must_pass(5, '05 CONFIG', 'Project Control saves levels, reporting level, weight source and default method',
    pg_temp.save_config('ZZ-1311-PSM', array[' Control Account ', 'Unit', 'Work Package'], 1, 'eprp', 'percent_complete', v_at));
  perform pg_temp.chk(5, '05 CONFIG', 'saved as one configuration; labels trimmed; onboarding mode untouched',
    (pg_temp.settings('ZZ-1311-PSM')).level_labels = array['Control Account', 'Unit', 'Work Package']
    and (pg_temp.settings('ZZ-1311-PSM')).control_account_level = 1
    and (pg_temp.settings('ZZ-1311-PSM')).weight_source = 'eprp'
    and (pg_temp.settings('ZZ-1311-PSM')).default_earning_method = 'percent_complete'
    and (pg_temp.settings('ZZ-1311-PSM')).onboarding_mode = 'new_project');
  perform pg_temp.chk(5, '05 CONFIG', 'four change-log rows, with the actor',
    (select count(*) from public.planning_configuration_changes
      where project_id = pg_temp.project('ZZ-1311-PSM') and changed_by_user_id = pg_temp.id('P_X')
        and changed_by_contact_id = pg_temp.person('ZZ 1311 X')) = 4);

  v_at := (pg_temp.settings('ZZ-1311-PSM')).updated_at;
  perform pg_temp.must_fail(5, '05 CONFIG', 'switching the weight source once local weights exist needs a reason',
    pg_temp.save_config('ZZ-1311-PSM', array['Control Account', 'Unit', 'Work Package'], 1, 'imported', 'percent_complete', v_at),
    '[REASON_REQUIRED]');
  perform pg_temp.must_fail(5, '05 CONFIG', '... also through a direct table update',
    format('update public.project_planning_settings set weight_source = ''imported'' where project_id = %L', pg_temp.project('ZZ-1311-PSM')),
    '[REASON_REQUIRED]');
  perform pg_temp.must_pass(5, '05 CONFIG', '... and is accepted with one',
    pg_temp.save_config('ZZ-1311-PSM', array['Control Account', 'Unit', 'Work Package'], 1, 'imported', 'percent_complete', v_at,
                        'Weights now come with the P6 schedule'));
  perform pg_temp.chk(5, '05 CONFIG', 'the switch is logged with its reason',
    exists (select 1 from public.planning_configuration_changes where project_id = pg_temp.project('ZZ-1311-PSM')
             and field_key = 'weight_source' and previous_value = '"eprp"' and new_value = '"imported"'
             and reason = 'Weights now come with the P6 schedule'));
  execute format('update public.project_planning_settings set default_earning_method = ''zero_hundred'' where project_id = %L',
                 pg_temp.project('ZZ-1311-PSM'));
  perform pg_temp.chk(5, '05 CONFIG', 'a direct table update by Project Control is still logged (no unlogged route)',
    exists (select 1 from public.planning_configuration_changes where project_id = pg_temp.project('ZZ-1311-PSM')
             and field_key = 'default_earning_method' and new_value = '"zero_hundred"'));
  select count(*) into v_count from public.planning_configuration_changes where project_id = pg_temp.project('ZZ-1311-PSM');
  execute format('insert into public.project_planning_settings (project_id, onboarding_mode) values (%L, ''new_project'') on conflict (project_id) do update set onboarding_mode = excluded.onboarding_mode',
                 pg_temp.project('ZZ-1311-PSM'));
  perform pg_temp.chk(5, '05 CONFIG', 'a Project Setup onboarding save leaves the configuration and its log untouched',
    (pg_temp.settings('ZZ-1311-PSM')).level_labels = array['Control Account', 'Unit', 'Work Package']
    and (select count(*) from public.planning_configuration_changes where project_id = pg_temp.project('ZZ-1311-PSM')) = v_count);

  perform pg_temp.must_fail(5, '05 CONFIG', 'no settings row: decide the onboarding mode first',
    pg_temp.save_config('ZZ-1311-NOSET', array['A'], 1, 'eprp', 'percent_complete', now()), '[ONBOARDING_NOT_CHOSEN]');
  perform pg_temp.must_fail(5, '05 CONFIG', 'a no-formal-schedule project has no planning configuration',
    pg_temp.save_config('ZZ-1311-NF', array['A'], 1, 'eprp', 'percent_complete', (pg_temp.settings('ZZ-1311-NF')).updated_at),
    '[NOT_PLANNING_GOVERNED]');
  perform pg_temp.must_pass(5, '05 CONFIG', 'Other Project: the same configuration model',
    pg_temp.save_config('ZZ-1311-OTH', array['Package', 'Area'], 2, 'eprp', 'fifty_fifty', (pg_temp.settings('ZZ-1311-OTH')).updated_at));

  perform pg_temp.must_fail(5, '05 CONFIG', 'the configuration history cannot be written by a client',
    format('insert into public.planning_configuration_changes (project_id, field_key) values (%L, ''weight_source'')', pg_temp.project('ZZ-1311-PSM')),
    '42501');
  execute format('delete from public.planning_configuration_changes where project_id = %L', pg_temp.project('ZZ-1311-PSM'));
  perform pg_temp.chk(5, '05 CONFIG', 'the configuration history cannot be deleted by a client (no row removed)',
    (select count(*) from public.planning_configuration_changes where project_id = pg_temp.project('ZZ-1311-PSM')) = v_count);
  perform pg_temp.act(pg_temp.id('P_Y'));
  perform pg_temp.chk(5, '05 CONFIG', 'a project reader (Reporting Coordinator) can read the configuration history',
    (select count(*) from public.planning_configuration_changes where project_id = pg_temp.project('ZZ-1311-PSM')) = v_count);
  perform pg_temp.owner();
  perform pg_temp.must_fail(5, '05 CONFIG', 'even the owner cannot rewrite configuration history',
    format('update public.planning_configuration_changes set reason = ''x'' where project_id = %L', pg_temp.project('ZZ-1311-PSM')),
    'append-only');
end $s05$;

/* ============================== 06. Archived ============================= */

do $s06$
declare
  A uuid := pg_temp.project('ZZ-1311-ARC');
  v_actor text;
  v_fp text;
begin
  insert into public.planning_work_items (project_id, code, name, local_weight_percent) values (A, 'ARC-N', 'Arc node', 60);
  insert into ids(key, id) select 'N:ARC', id from public.planning_work_items where project_id = A and code = 'ARC-N';
  insert into public.planning_work_items (project_id, code, name, local_weight_percent) values (A, 'ARC-M', 'Arc node 2', 30);
  insert into ids(key, id) select 'N:ARC2', id from public.planning_work_items where project_id = A and code = 'ARC-M';
  update public.projects set status = 'archived', active = false, archived_at = now() where id = A;
  v_fp := (select md5(string_agg(to_jsonb(w)::text, '' order by w.id)) from public.planning_work_items w where w.project_id = A)
       || (select md5(to_jsonb(s)::text) from public.project_planning_settings s where s.project_id = A);

  foreach v_actor in array array['P_X', 'P_PCA', 'P_SA'] loop
    perform pg_temp.act(pg_temp.id(v_actor));
    perform pg_temp.must_fail(6, '06 ARCHIVED', v_actor || ': local weight edit refused',
      format('update public.planning_work_items set local_weight_percent = 70 where id = %L', pg_temp.id('N:ARC')), '[PROJECT_ARCHIVED]');
    perform pg_temp.must_fail(6, '06 ARCHIVED', v_actor || ': new activity refused',
      format('insert into public.planning_activities (project_id, work_item_id, name) values (%L, %L, ''x'')', A, pg_temp.id('N:ARC')),
      '[PROJECT_ARCHIVED]');
    perform pg_temp.must_fail(6, '06 ARCHIVED', v_actor || ': weight decision refused',
      pg_temp.decision('ZZ-1311-ARC', null, 'proportional_rescale',
        jsonb_build_array(pg_temp.child('node', 'N:ARC', 60, 66.667), pg_temp.child('node', 'N:ARC2', 30, 33.333)), 'r'),
      '[PROJECT_ARCHIVED]');
    perform pg_temp.must_fail(6, '06 ARCHIVED', v_actor || ': planning configuration refused',
      pg_temp.save_config('ZZ-1311-ARC', array['A'], 1, 'eprp', 'percent_complete', (pg_temp.settings('ZZ-1311-ARC')).updated_at),
      '[PROJECT_ARCHIVED]');
    perform pg_temp.chk(6, '06 ARCHIVED', v_actor || ': the archived Working Plan is still readable',
      (select count(*) from public.planning_work_items where project_id = A) = 2);
  end loop;
  perform pg_temp.owner();
  perform pg_temp.must_fail(6, '06 ARCHIVED', 'owner: a configuration-history row for an archived project is refused',
    format('insert into public.planning_configuration_changes (project_id, field_key) values (%L, ''weight_source'')', A),
    '[PROJECT_ARCHIVED]');
  perform pg_temp.chk(6, '06 ARCHIVED', 'the archived project''s Working Plan and configuration are byte-for-byte unchanged',
    v_fp = (select md5(string_agg(to_jsonb(w)::text, '' order by w.id)) from public.planning_work_items w where w.project_id = A)
        || (select md5(to_jsonb(s)::text) from public.project_planning_settings s where s.project_id = A));
end $s06$;

/* ============================= 07. Boundaries ============================ */

do $s07$
declare
  G uuid := pg_temp.project('ZZ-1311-GOV');
  v_snapshot uuid;
begin
  insert into public.planning_work_items (project_id, code, name, local_weight_percent) values (G, 'G-N', 'G node', 100);
  insert into public.planning_activities (project_id, work_item_id, code, name, source, weight_percent, local_weight_percent,
                                          earning_method, planned_start_date, planned_finish_date)
  select G, w.id, 'G-A', 'G activity', 'manual', 70, 100, 'percent_complete', '2026-09-01', '2026-09-30'
    from public.planning_work_items w where w.project_id = G and w.code = 'G-N';

  perform pg_temp.act(pg_temp.id('P_X'));
  -- 13.12 (docs/02 §26.25 D-D) replaced the "publish unchanged until 13.12"
  -- boundary: a normal publish is now v2 only — the Planning Engine on the
  -- server and its trusted writer. That writer still copies the RECORDED
  -- weight into the legacy column and keeps the whole-row archive, with the
  -- engine's view in separate v2 columns (proved in 133 §05).
  perform pg_temp.must_fail(7, '07 BOUNDARY', '13.12: the legacy normal publish is retired ([V2_PUBLISH_REQUIRED])',
    format('select public.publish_planning_snapshot(%L::uuid, null, null, false, ''13.11 boundary'', null, ''2026-10-31'', true)', G),
    'V2_PUBLISH_REQUIRED');
  perform pg_temp.chk(7, '07 BOUNDARY', 'the snapshot activity table keeps its legacy weight column; 13.12 adds the engine''s view separately',
    exists (select 1 from information_schema.columns where table_schema = 'public'
             and table_name = 'planning_snapshot_activities' and column_name = 'weight_percent')
    and exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'planning_snapshot_activities' and column_name = 'local_weight')
    and not exists (select 1 from information_schema.columns where table_schema = 'public'
                     and table_name = 'planning_snapshot_activities' and column_name = 'local_weight_percent'));
  perform pg_temp.must_fail(7, '07 BOUNDARY', 'publishing a no-formal-schedule project is still refused (13.9B unchanged)',
    format('select public.publish_planning_snapshot(%L::uuid, null, null, false, null, null, ''2026-10-31'', true)', pg_temp.project('ZZ-1311-NF')));
  perform pg_temp.owner();

  perform pg_temp.chk(7, '07 BOUNDARY', 'no pre-existing node or activity weight was reinterpreted or changed',
    not exists (select 1 from weights_before b
                  join public.planning_work_items w on b.t = 'wi' and w.id = b.id
                 where w.weight_percent is distinct from b.weight_percent
                    or w.local_weight_percent is distinct from b.local_weight_percent)
    and not exists (select 1 from weights_before b
                  join public.planning_activities a on b.t = 'ac' and a.id = b.id
                 where a.weight_percent is distinct from b.weight_percent
                    or a.local_weight_percent is distinct from b.local_weight_percent));
end $s07$;

/* ====================== 09. No formal schedule (UAT P1) =================== */

-- 20261023090000: while a project's Planning Approach is no_formal_schedule,
-- no planning authoring row can be written, by any role or route; reads keep
-- working; changing the approach in Project Setup re-enables authoring.
do $s09$
declare
  F uuid := pg_temp.project('ZZ-1311-NF');
  v_actor text;
begin
  -- Legacy data on the project (written before the guard existed).
  alter table public.planning_work_items disable trigger guard_no_formal_schedule_planning;
  insert into public.planning_work_items (project_id, code, name) values (F, 'NF-LEGACY', 'Legacy node');
  alter table public.planning_work_items enable trigger guard_no_formal_schedule_planning;
  insert into ids(key, id) select 'N:NF-LEGACY', id from public.planning_work_items where project_id = F and code = 'NF-LEGACY';

  foreach v_actor in array array['P_X', 'P_PCA', 'P_SA'] loop
    perform pg_temp.act(pg_temp.id(v_actor));
    perform pg_temp.must_fail(9, '09 NO FORMAL', v_actor || ': Add Node refused',
      pg_temp.ins_node('N:NF-' || v_actor, 'ZZ-1311-NF', 'NF-' || v_actor), '[NOT_PLANNING_GOVERNED]');
    perform pg_temp.must_fail(9, '09 NO FORMAL', v_actor || ': Add Activity refused',
      format('insert into public.planning_activities (project_id, name) values (%L, ''x'')', F), '[NOT_PLANNING_GOVERNED]');
    perform pg_temp.must_fail(9, '09 NO FORMAL', v_actor || ': schedule import refused',
      format('insert into public.planning_import_batches (project_id, source_type) values (%L, ''p6'')', F), '[NOT_PLANNING_GOVERNED]');
    -- 13.12: no client inserts a baseline at all (42501); a no-formal-schedule
    -- baseline REQUEST is refused [NOT_PLANNING_GOVERNED] (133 §09).
    perform pg_temp.must_fail(9, '09 NO FORMAL', v_actor || ': baseline refused',
      format('insert into public.planning_baselines (project_id, name, baseline_date) values (%L, ''BL'', ''2026-10-01'')', F),
      '42501');
    perform pg_temp.must_fail(9, '09 NO FORMAL', v_actor || ': Opening Position refused',
      format('insert into public.planning_opening_positions (project_id, data_date, source) values (%L, ''2026-10-01'', ''x'')', F),
      '[NOT_PLANNING_GOVERNED]');
    perform pg_temp.must_fail(9, '09 NO FORMAL', v_actor || ': editing a legacy node refused',
      format('update public.planning_work_items set name = ''renamed'' where id = %L', pg_temp.id('N:NF-LEGACY')),
      '[NOT_PLANNING_GOVERNED]');
    perform pg_temp.must_fail(9, '09 NO FORMAL', v_actor || ': weight decision refused',
      pg_temp.decision('ZZ-1311-NF', null, 'equal_split',
        jsonb_build_array(pg_temp.child('node', 'N:NF-LEGACY', null, 100)), 'r'), '[NOT_PLANNING_GOVERNED]');
    perform pg_temp.chk(9, '09 NO FORMAL', v_actor || ': the Working Plan stays readable',
      (select count(*) from public.planning_work_items where project_id = F) = 1);
  end loop;
  perform pg_temp.owner();
  perform pg_temp.must_fail(9, '09 NO FORMAL', 'owner: no bypass of the guard',
    format('insert into public.planning_activities (project_id, name) values (%L, ''x'')', F), '[NOT_PLANNING_GOVERNED]');

  -- Changing the Planning Approach (not yet Controlled: a free change) re-enables authoring.
  update public.project_planning_settings set onboarding_mode = 'new_project' where project_id = F;
  perform pg_temp.act(pg_temp.id('P_X'));
  perform pg_temp.must_pass(9, '09 NO FORMAL', 'after the approach changes to "Start planning in EPRP", Add Node works again',
    pg_temp.ins_node('N:NF-AFTER', 'ZZ-1311-NF', 'NF-AFTER'));
  perform pg_temp.must_pass(9, '09 NO FORMAL', '... and the legacy node is editable again',
    format('update public.planning_work_items set name = ''renamed'' where id = %L', pg_temp.id('N:NF-LEGACY')));
  perform pg_temp.owner();

  -- Other projects are unaffected: a PSM (new_project) node insert still works.
  perform pg_temp.act(pg_temp.id('P_X'));
  perform pg_temp.must_pass(9, '09 NO FORMAL', 'a schedule-governed project is unaffected',
    pg_temp.ins_node('N:PSM-AFTER', 'ZZ-1311-PSM', 'PSM-AFTER'));
  perform pg_temp.owner();

  perform pg_temp.chk(9, '09 NO FORMAL', 'catalog: guard on exactly its 8 authoring tables, after the archived guard, not client-callable',
    (select count(*) from pg_trigger where tgname = 'guard_no_formal_schedule_planning') = 8
    and not exists (select 1 from pg_trigger where tgname = 'guard_no_formal_schedule_planning'
                     and tgrelid in ('public.planning_snapshots'::regclass, 'public.planning_snapshot_activities'::regclass))
    and not has_function_privilege('authenticated', 'public.guard_no_formal_schedule_planning()', 'EXECUTE'));
end $s09$;

/* ============================== 08. Catalog ============================== */

do $s08$
begin
  perform pg_temp.chk(8, '08 CATALOG', 'the 13.9 archived guard answers before every 13.11 BEFORE trigger',
    not exists (select 1 from pg_trigger g
                 where g.tgrelid in ('public.planning_work_items'::regclass, 'public.planning_activities'::regclass,
                                     'public.project_planning_settings'::regclass, 'public.planning_confirmations'::regclass)
                   and not g.tgisinternal and (g.tgtype & 3) = 3
                   and g.tgname < 'block_archived_project_planning'));
  perform pg_temp.chk(8, '08 CATALOG', 'the archived guard on the new history table answers first',
    not exists (select 1 from pg_trigger g where g.tgrelid = 'public.planning_configuration_changes'::regclass
                 and not g.tgisinternal and (g.tgtype & 3) = 3 and g.tgname < 'block_archived_planning_configuration'));
  perform pg_temp.chk(8, '08 CATALOG', 'trigger functions are not client-callable; the two writers are (signed-in only)',
    not has_function_privilege('authenticated', 'public.guard_working_plan_item()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.log_working_plan_change()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.stamp_planning_confirmation()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.log_planning_configuration_change()', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.record_planning_weight_decision(uuid,uuid,text,jsonb,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.save_planning_configuration(uuid,text[],integer,text,text,timestamptz,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.record_planning_weight_decision(uuid,uuid,text,jsonb,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.save_planning_configuration(uuid,text[],integer,text,text,timestamptz,text)', 'EXECUTE'));
  perform pg_temp.chk(8, '08 CATALOG', 'the configuration history has one policy: SELECT, for signed-in accounts only',
    (select count(*) from pg_policy where polrelid = 'public.planning_configuration_changes'::regclass) = 1
    and exists (select 1 from pg_policy where polrelid = 'public.planning_configuration_changes'::regclass
                 and polcmd = 'r' and polroles = array['authenticated'::regrole::oid]));
  perform pg_temp.chk(8, '08 CATALOG', 'can_manage_project_operations() is byte-for-byte unchanged (pre-13.9 fingerprint)',
    (select md5(prosrc) from pg_proc where oid = 'public.can_manage_project_operations(uuid)'::regprocedure)
    = '05c5f58290be4341497507fffc05c2a0');
  perform pg_temp.chk(8, '08 CATALOG', 'the 13.9 archived planning guard stays on exactly its 16 tables',
    (select count(*) from pg_trigger where tgname = 'block_archived_project_planning') = 16);
  perform pg_temp.chk(8, '08 CATALOG', 'publish_planning_snapshot() does not read any 13.11 column (Snapshot v2 is 13.12)',
    (select prosrc from pg_proc where proname = 'publish_planning_snapshot' and pronamespace = 'public'::regnamespace
      order by pronargs desc limit 1) !~ 'local_weight_percent|earning_method|is_control_account|structure_node_id');
end $s08$;

/* ================================ report ================================ */

select seq, area, item, verdict from r order by seq, area, item;
select count(*) filter (where verdict like 'PASS%') as passed,
       count(*) filter (where verdict like 'FAIL%') as failed,
       count(*) as total
  from r;

rollback;

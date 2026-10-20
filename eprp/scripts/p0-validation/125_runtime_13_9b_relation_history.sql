-- Phase 13.9B — Project Setup Governance — Step 3: Contacts / Sites / Parties
-- history — RUNTIME verification. LOCAL DATABASE ONLY.
--
-- Proves 20261018090000_project_setup_relation_history.sql through the REAL
-- write path (save_project_setup_relation(), as the assigned Project Control)
-- on real RLS. Everything runs in ONE transaction that is ROLLED BACK.
--
--   01  not Controlled: relation saves log nothing
--   02  Sites: add / unchanged re-save (no noise, including the is_primary
--       clear-and-reset) / change / primary switch / remove, with net before /
--       after, actor and time
--   03  Parties: subcontractor add / change / remove; required parties untouched
--   04  Contacts: team rows logged with the contact's name; project-level
--       responsibility holders excluded (their projects columns are logged)
--   05  immutability and authority: no client write, the owner cannot edit or
--       delete a committed-style row, readable by project readers only
--   06  archived: relation saves refused, history readable and unchanged
--   07  catalog: triggers, registry, grants
--
-- NOTE: earlier versions of this repository's runtime scripts were broken by a
-- swallowed BEGIN (2026-10-17). This script checks that it is inside a
-- transaction before it writes anything.
--
-- HOW TO RUN (after the migration is applied; from eprp/; the APP database):
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < scripts/p0-validation/125_runtime_13_9b_relation_history.sql

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
  -- Fails (and the script writes nothing) if BEGIN did not open a transaction:
  -- the temp table above is ON COMMIT DROP, so it only exists inside one.
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
create or replace function pg_temp.rel_sql(p_project uuid, p_relation text, p_rows jsonb) returns text
language sql as $$
  select format('select public.save_project_setup_relation(%L::uuid, (select updated_at from public.projects where id = %L::uuid), %L, %L::jsonb)',
                p_project, p_project, p_relation, p_rows)
$$;
create or replace function pg_temp.log_count(p_project uuid, p_relation text default null) returns bigint
language sql as $$ select count(*) from public.project_setup_relation_changes
                    where project_id = p_project and (p_relation is null or relation = p_relation) $$;
-- The current site rows as the editor would send them (ids kept).
create or replace function pg_temp.sites(p_project uuid) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'country', country, 'city', city,
                                               'isPrimary', is_primary) order by sort_order), '[]'::jsonb)
    from public.project_sites where project_id = p_project
$$;
create or replace function pg_temp.parties(p_project uuid) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'name', name, 'shortName', short_name,
                                               'scope', scope, 'contractReference', contract_reference,
                                               'engagementStatus', engagement_status) order by sort_order), '[]'::jsonb)
    from public.project_parties where project_id = p_project and kind = 'subcontractor'
$$;

/* ========================= fixtures (as postgres) ========================= */

do $fix$
declare v_template uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
begin
  if v_template is null then
    raise exception 'ZZ-P0TEST-PRJ not found — this script expects the local development dataset.';
  end if;
  if to_regclass('public.project_setup_relation_changes') is null then
    raise exception 'project_setup_relation_changes not found — apply 20261018090000_project_setup_relation_history.sql first.';
  end if;
  insert into public.projects (code, name, client_id, planned_start_date, planned_finish_date, status, structure_family)
  select 'ZZ-139D-' || v.s, 'ZZ 13.9B-3 ' || v.s, p.client_id, '2026-01-01', '2027-06-30', 'active', 'psm'
    from public.projects p, (values ('FREE'), ('ACT'), ('ARC')) v(s) where p.id = v_template;
  insert into ids(key, id) select 'PRJ:' || code, id from public.projects where code like 'ZZ-139D-%';

  insert into public.contacts (name, email, active)
  select 'ZZ 139D ' || s, 'zz.139d.' || lower(s) || '@example.invalid', true from (values ('X'), ('Y'), ('V'), ('T')) v(s);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', ('00000000-0000-4000-d000-000000139d' || v.n)::uuid,
         'authenticated', 'authenticated', 'zz.139d.' || lower(v.s) || '@example.invalid',
         'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
    from (values ('X', '01'), ('Y', '02'), ('V', '03')) v(s, n);
  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select ('00000000-0000-4000-d000-000000139d' || v.n)::uuid, 'zz.139d.' || lower(v.s) || '@example.invalid',
         'ZZ 139D ' || v.s, 'viewer', pg_temp.person('ZZ 139D ' || v.s), true
    from (values ('X', '01'), ('Y', '02'), ('V', '03')) v(s, n);
  insert into ids(key, id) values ('P_X', '00000000-0000-4000-d000-000000139d01'),
    ('P_Y', '00000000-0000-4000-d000-000000139d02'), ('P_V', '00000000-0000-4000-d000-000000139d03');

  -- X = assigned Project Control, Y = Reporting Coordinator, T = a team member.
  insert into public.project_members (project_id, contact_id, party_id, project_role)
  select pg_temp.project('ZZ-139D-' || p.s), pg_temp.person('ZZ 139D ' || m.s), pg_temp.party('ZZ-139D-' || p.s, 'eprom'), m.role
    from (values ('FREE'), ('ACT'), ('ARC')) p(s),
         (values ('X', 'Project Controls'), ('Y', 'Reporting Coordinator'), ('T', 'Engineer')) m(s, role);
  insert into public.project_contacts (project_id, contact_id, role)
  select pg_temp.project('ZZ-139D-' || p.s), pg_temp.person('ZZ 139D ' || m.s), m.role
    from (values ('FREE'), ('ACT'), ('ARC')) p(s),
         (values ('X', 'project_control_manager'), ('Y', 'reporting_coordinator')) m(s, role);
  update public.projects set project_control_manager_id = pg_temp.person('ZZ 139D X'),
                             reporting_coordinator_id = pg_temp.person('ZZ 139D Y')
   where code like 'ZZ-139D-%';
  insert into public.project_planning_settings (project_id, onboarding_mode)
  select id, 'new_project' from public.projects where code like 'ZZ-139D-%';
end;
$fix$;

-- ACT and ARC become Controlled through the real publish (first anchor, confirmed).
select pg_temp.act(pg_temp.id('P_X'));
do $anchor$
begin
  -- Sites that exist before Controlled: they are the "already stored" rows a
  -- later re-save sends back (nothing is logged for them now).
  perform pg_temp.must_pass(0, '00 FIXTURE', 'ACT has two sites before it is Controlled (nothing logged)',
    pg_temp.rel_sql(pg_temp.project('ZZ-139D-ACT'), 'sites',
      '[{"name": "Pre 1", "country": "Egypt", "city": "Cairo", "isPrimary": true},
        {"name": "Pre 2", "country": "Egypt", "city": "Giza", "isPrimary": false}]'));
  perform pg_temp.must_pass(0, '00 FIXTURE', 'ACT and ARC are Controlled by a confirmed first publish',
    format('select public.publish_planning_snapshot(p_project_id => %L::uuid, p_data_date => %L::date, p_confirm_setup_control => true)',
           pg_temp.project('ZZ-139D-ACT'), '2026-10-10') || '; ' ||
    format('select public.publish_planning_snapshot(p_project_id => %L::uuid, p_data_date => %L::date, p_confirm_setup_control => true)',
           pg_temp.project('ZZ-139D-ARC'), '2026-10-10'));
end $anchor$;

/* ======================== 01. not Controlled ============================= */

do $s01$
declare F uuid := pg_temp.project('ZZ-139D-FREE');
begin
  perform pg_temp.must_pass(1, '01 NOT CONTROLLED', 'a Sites save on a project that is not Controlled works as today',
    pg_temp.rel_sql(F, 'sites', '[{"name": "Free Site", "country": "Egypt", "city": "Suez", "isPrimary": true}]'));
  perform pg_temp.chk(1, '01 NOT CONTROLLED', 'nothing is logged', pg_temp.log_count(F) = 0);
end $s01$;

/* ================================ 02. Sites ============================== */

do $s02$
declare A uuid := pg_temp.project('ZZ-139D-ACT');
begin
  -- The editor re-sends the stored rows unchanged: the save clears every
  -- is_primary and sets it again, which must leave NO history row.
  perform pg_temp.must_pass(2, '02 SITES', 'an unchanged re-save of the stored sites is accepted',
    pg_temp.rel_sql(A, 'sites', pg_temp.sites(A)));
  perform pg_temp.chk(2, '02 SITES', 'it logs nothing (no is_primary clear-and-reset noise, no re-sent-row noise)',
    pg_temp.log_count(A) = 0);
  perform pg_temp.must_pass(2, '02 SITES', 'Pre 2''s city changes',
    pg_temp.rel_sql(A, 'sites', (select jsonb_agg(case when e->>'name' = 'Pre 2' then jsonb_set(e, '{city}', '"Alexandria"') else e end)
                                   from jsonb_array_elements(pg_temp.sites(A)) e)));
  perform pg_temp.chk(2, '02 SITES', 'one "changed" row: net before / after, actor and name',
    (select count(*) from public.project_setup_relation_changes where project_id = A and relation = 'sites') = 1
    and (select action = 'changed'
            and previous_value = '{"name": "Pre 2", "country": "Egypt", "city": "Giza", "is_primary": false}'
            and new_value = '{"name": "Pre 2", "country": "Egypt", "city": "Alexandria", "is_primary": false}'
            and changed_by = pg_temp.id('P_X') and changed_by_name = 'ZZ 139D X'
       from public.project_setup_relation_changes where project_id = A and relation = 'sites'));
  perform pg_temp.must_pass(2, '02 SITES', 'a new site is added',
    pg_temp.rel_sql(A, 'sites', pg_temp.sites(A) || '[{"name": "Site A", "country": "Egypt", "city": "Suez", "isPrimary": false}]'));
  perform pg_temp.chk(2, '02 SITES', 'logged as "added" with no previous image',
    exists (select 1 from public.project_setup_relation_changes where project_id = A and relation = 'sites'
             and action = 'added' and previous_value is null
             and new_value = '{"name": "Site A", "country": "Egypt", "city": "Suez", "is_primary": false}'));
  perform pg_temp.must_pass(2, '02 SITES', 'Pre 1 is removed and Pre 2 becomes primary',
    pg_temp.rel_sql(A, 'sites', (select jsonb_agg(case when e->>'name' = 'Pre 2' then jsonb_set(e, '{isPrimary}', 'true')
                                                       else jsonb_set(e, '{isPrimary}', 'false') end)
                                   from jsonb_array_elements(pg_temp.sites(A)) e where e->>'name' <> 'Pre 1')));
  perform pg_temp.chk(2, '02 SITES', 'Pre 1 logged "removed" with its stored image; one net row per record',
    exists (select 1 from public.project_setup_relation_changes where project_id = A and relation = 'sites'
             and action = 'removed' and new_value is null
             and previous_value = '{"name": "Pre 1", "country": "Egypt", "city": "Cairo", "is_primary": true}')
    and (select count(*) from public.project_setup_relation_changes where project_id = A and relation = 'sites') = 3);
end $s02$;

/* =============================== 03. Parties ============================= */

do $s03$
declare A uuid := pg_temp.project('ZZ-139D-ACT');
begin
  perform pg_temp.must_pass(3, '03 PARTIES', 'a subcontractor is added',
    pg_temp.rel_sql(A, 'parties', '[{"kind": "subcontractor", "name": "ZZ Scaffold Co", "scope": "Access scaffolding", "engagementStatus": "planned"}]'));
  perform pg_temp.chk(3, '03 PARTIES', 'one "added" row with the business fields (no ids, no ordering)',
    (select count(*) from public.project_setup_relation_changes where project_id = A and relation = 'parties' and action = 'added') = 1
    and (select new_value from public.project_setup_relation_changes where project_id = A and relation = 'parties')
        = '{"kind": "subcontractor", "name": "ZZ Scaffold Co", "scope": "Access scaffolding", "short_name": null, "contract_reference": null, "engagement_status": "planned"}');
  perform pg_temp.chk(3, '03 PARTIES', 'the required parties (EPROM, client) produced no rows',
    not exists (select 1 from public.project_setup_relation_changes where project_id = A and relation = 'parties'
                 and new_value ->> 'kind' <> 'subcontractor'));
end $s03$;

/* =============================== 04. Contacts ============================ */

do $s04$
declare A uuid := pg_temp.project('ZZ-139D-ACT');
begin
  perform pg_temp.must_pass(4, '04 CONTACTS', 'a team member is added through the Contacts (team) relation',
    pg_temp.rel_sql(A, 'team', jsonb_build_array(jsonb_build_object('contactId', pg_temp.person('ZZ 139D T'), 'functionalTitle', 'Inspector'))));
  perform pg_temp.chk(4, '04 CONTACTS', 'logged as added, with the contact''s name captured at the time',
    exists (select 1 from public.project_setup_relation_changes where project_id = A and relation = 'contacts' and action = 'added'
             and new_value ->> 'contact_name' = 'ZZ 139D T' and new_value ->> 'role' = 'team_member'
             and new_value ->> 'functional_title' = 'Inspector'));
end $s04$;
select pg_temp.owner();
do $s04o$
declare A uuid := pg_temp.project('ZZ-139D-ACT');
begin
  perform pg_temp.chk(4, '04 CONTACTS', 'project-level responsibility holders are excluded (their projects columns are logged)',
    public.project_setup_relation_image('contacts', '{"role": "project_manager", "department_id": null, "system_id": null, "discipline_id": null}') is null
    and public.project_setup_relation_image('contacts', jsonb_build_object('role', 'project_manager', 'department_id', gen_random_uuid())) is not null
    and not exists (select 1 from public.project_setup_relation_changes where project_id = A and relation = 'contacts'
                     and new_value ->> 'role' in ('project_control_manager', 'reporting_coordinator')));
end $s04o$;
select pg_temp.act(pg_temp.id('P_X'));

/* ========================= 05. immutability / reads ====================== */

do $s05$
declare A uuid := pg_temp.project('ZZ-139D-ACT');
begin
  perform pg_temp.must_fail(5, '05 IMMUTABLE', 'a client cannot insert into the relation history',
    format('insert into public.project_setup_relation_changes (project_id, relation, record_id, new_value) values (%L, %L, gen_random_uuid(), %L)',
           A, 'sites', '{"name": "forged"}'), '42501');
end $s05$;
select pg_temp.act(pg_temp.id('P_Y'));
do $s05y$ begin
  perform pg_temp.chk(5, '05 IMMUTABLE', 'the Reporting Coordinator (a project reader) can read the history',
    pg_temp.log_count(pg_temp.project('ZZ-139D-ACT')) >= 3);
end $s05y$;
select pg_temp.act(pg_temp.id('P_V'));
do $s05v$ begin
  perform pg_temp.chk(5, '05 IMMUTABLE', 'a viewer without project access reads nothing',
    pg_temp.log_count(pg_temp.project('ZZ-139D-ACT')) = 0);
end $s05v$;
select pg_temp.owner();
do $s05o$
declare A uuid := pg_temp.project('ZZ-139D-ACT');
begin
  perform pg_temp.must_fail(5, '05 IMMUTABLE', 'owner: a history row cannot be edited outside the logging trigger',
    format('update public.project_setup_relation_changes set new_value = %L where project_id = %L', '{"name": "rewritten"}', A),
    'SETUP_HISTORY_IMMUTABLE');
  perform pg_temp.must_fail(5, '05 IMMUTABLE', 'owner: a history row cannot be deleted outside the logging trigger',
    format('delete from public.project_setup_relation_changes where project_id = %L', A), 'SETUP_HISTORY_IMMUTABLE');
end $s05o$;

/* =============================== 06. archived ============================ */

select pg_temp.act(pg_temp.id('P_X'));
do $s06a$ begin
  perform pg_temp.must_pass(6, '06 ARCHIVED', 'before archiving: ARC gets a site (logged)',
    pg_temp.rel_sql(pg_temp.project('ZZ-139D-ARC'), 'sites', '[{"name": "Arc Site", "country": "Egypt", "city": "Port Said", "isPrimary": true}]'));
end $s06a$;
select pg_temp.owner();
do $s06o$
declare R uuid := pg_temp.project('ZZ-139D-ARC');
begin
  insert into ids(key, note) values ('ARC_PRINT',
    (select md5(string_agg(to_jsonb(c)::text, '|' order by c.id)) from public.project_setup_relation_changes c where c.project_id = R));
  update public.projects set status = 'archived', active = false, archived_at = now() where id = R;
  perform pg_temp.must_fail(6, '06 ARCHIVED', 'owner: the archived project''s history cannot be changed (archived guard first)',
    format('update public.project_setup_relation_changes set new_value = %L where project_id = %L', '{"name": "x"}', R), 'PROJECT_ARCHIVED');
end $s06o$;
select pg_temp.act(pg_temp.id('P_X'));
do $s06$
declare R uuid := pg_temp.project('ZZ-139D-ARC');
begin
  perform pg_temp.must_fail(6, '06 ARCHIVED', 'a Sites save on the archived project is refused (2C.3E, unchanged)',
    pg_temp.rel_sql(R, 'sites', '[]'), 'PROJECT_ARCHIVED');
  perform pg_temp.chk(6, '06 ARCHIVED', 'its history is readable and byte-for-byte unchanged',
    pg_temp.log_count(R) = 1
    and (select md5(string_agg(to_jsonb(c)::text, '|' order by c.id)) from public.project_setup_relation_changes c where c.project_id = R)
        = (select note from ids where key = 'ARC_PRINT'));
end $s06$;

/* ================================ 07. catalog ============================ */

select pg_temp.owner();
do $s07$
begin
  -- 13.9B Step 4 (20261019090000) deliberately extends the same history to
  -- the four structure tables; 126 proves those. This suite pins its own three.
  perform pg_temp.chk(7, '07 CATALOG', 'the logging trigger is on project_contacts, project_sites and project_parties (+ the four Step 4 structure tables)',
    (select string_agg(tgrelid::regclass::text, ',' order by tgrelid::regclass::text) from pg_trigger
      where tgname = 'log_project_setup_relation_change')
      = 'project_contacts,project_departments,project_disciplines,project_parties,project_sites,project_structure_levels,project_structure_nodes');
  perform pg_temp.chk(7, '07 CATALOG', 'no free / logged relation is left unlogged in the registry',
    not exists (select 1 from public.project_setup_field_registry() where enforced_from = 'as_today')
    and (select string_agg(enforced_from, ',') from public.project_setup_field_registry()
          where field_key in ('contacts', 'sites', 'parties')) = '13.9B-3,13.9B-3,13.9B-3');
  perform pg_temp.chk(7, '07 CATALOG', 'no client can write the history; the trigger functions are not callable',
    not has_table_privilege('authenticated', 'public.project_setup_relation_changes', 'INSERT,UPDATE,DELETE')
    and not has_table_privilege('anon', 'public.project_setup_relation_changes', 'SELECT')
    and not has_function_privilege('authenticated', 'public.log_project_setup_relation_change()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.project_setup_relation_image(text,jsonb)', 'EXECUTE'));
  perform pg_temp.chk(7, '07 CATALOG', 'the eight 2C.3E block_archived_project_setup guards are unchanged in number',
    (select count(*) from pg_trigger where tgname = 'block_archived_project_setup') = 8);
end $s07$;

/* ================================ report ================================ */

select seq, area, item, verdict from r order by seq, area, item;
select count(*) filter (where verdict like 'PASS%') as passed,
       count(*) filter (where verdict like 'FAIL%') as failed,
       count(*) as total
  from r;

rollback;

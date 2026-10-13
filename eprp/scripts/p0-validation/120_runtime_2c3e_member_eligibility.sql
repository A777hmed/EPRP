-- Phase 2C.3E final alignment: an ACTIVE member of the same project is
-- sufficient eligibility — RUNTIME verification. LOCAL DATABASE ONLY.
--
-- Proves 20261013120000_member_eligibility_for_responsibilities.sql against
-- real PostgreSQL, real RLS and real authenticated roles. Everything —
-- fixtures, accounts and every write — runs in ONE transaction that is ROLLED
-- BACK.
--
--   1  Replace Person, fixed responsibility: an active member with NO prior
--      project row takes over (history written, the role's row moved); a
--      non-member, an ENDED member and another project's member are refused
--   2  Project Information position: an active member with no prior project
--      row receives a NEW position; the same three are refused (setup save
--      and direct write); an unchanged re-save passes
--   3  Replace Person, project position: the same eligibility
--   4  authority: a member who takes over Project Control gets exactly that
--      responsibility's authority; a position holder and a plain member get
--      none; no membership is ever created
--   5  PSM Department Manager replacement unchanged (2C.3D Wave 2)
--   6  archived projects refused first (2C.3E)
--   7  new project creation unchanged
--   8  catalog
--
-- HOW TO RUN (after the migration is applied; from eprp/):
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < scripts/p0-validation/120_runtime_2c3e_member_eligibility.sql

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
create or replace function pg_temp.replace_sql(
  p_code text, p_kind text, p_from text, p_to text, p_role text default null,
  p_department uuid default null, p_assignment text default null, p_position uuid default null
) returns text language sql as $$
  select format('select public.replace_project_responsibility(%L, %L, %L, %L, %L, %L, %L, %L, %L)',
                pg_temp.project(p_code), p_kind, pg_temp.person(p_from), pg_temp.person(p_to), p_role,
                p_department, p_assignment, p_position, 'Runtime check')
$$;
-- Project Information's positions save: the existing position plus one new row.
create or replace function pg_temp.positions_sql(p_code text, p_new_holder text) returns text
language sql as $$
  select format('select public.save_project_setup_relation(%L::uuid, %L::timestamptz, %L, %L::jsonb)',
    pg_temp.project(p_code), pg_temp.version(p_code), 'positions',
    (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'jobTitleId', p.job_title_id, 'contactId', p.contact_id)
                               order by p.sort_order), '[]'::jsonb)
       from public.project_positions p where p.project_id = pg_temp.project(p_code))
    || case when p_new_holder is null then '[]'::jsonb
            else jsonb_build_array(jsonb_build_object('jobTitleId', pg_temp.id('TITLE'), 'contactId', pg_temp.person(p_new_holder))) end)
$$;
-- Every authority helper a descriptive-only person must not satisfy.
create or replace function pg_temp.any_authority(p_project uuid) returns boolean
language sql as $$
  select coalesce(public.can_manage_project_setup(p_project), false)
      or coalesce(public.can_manage_project_operations(p_project), false)
      or coalesce(public.can_manage_reporting_workflow(p_project), false)
      or coalesce(public.is_project_consolidator(p_project), false)
      or coalesce(public.has_operational_project_access(p_project), false)
$$;

/* ========================= fixtures (as postgres) ========================= */

do $fix$
declare
  v_template uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  D uuid := (select id from public.departments order by name limit 1);
  v_title uuid := (select id from public.job_titles order by name limit 1);
  v_position uuid;
begin
  if v_template is null then
    raise exception 'ZZ-P0TEST-PRJ not found — this script expects the local development dataset.';
  end if;
  if (select prosrc from pg_proc where oid = 'public.replace_project_responsibility(uuid,text,uuid,uuid,text,uuid,text,uuid,text)'::regprocedure)
       !~ 'from public\.project_members m' then
    raise exception 'apply 20261013120000_member_eligibility_for_responsibilities.sql first.';
  end if;
  if v_title is null then
    raise exception 'No job title master row: positions cannot be exercised on this dataset.';
  end if;
  insert into ids(key, id) values ('DEPT', D), ('TITLE', v_title);

  insert into public.projects (code, name, client_id, planned_start_date, planned_finish_date, status, structure_family)
  select 'ZZ-2C3EM-' || v.s, 'ZZ 2C.3E eligibility ' || v.s, p.client_id, p.planned_start_date, p.planned_finish_date, 'active', 'psm'
    from public.projects p, (values ('A'), ('B'), ('ARC')) v(s)
   where p.id = v_template;
  insert into public.project_departments (project_id, department_id)
  select pg_temp.project('ZZ-2C3EM-' || s), D from (values ('A'), ('B'), ('ARC')) v(s);

  insert into public.contacts (name, email, active)
  select 'ZZ 2C3EM ' || s, 'zz.2c3em.' || lower(s) || '@example.invalid', true
    from (values ('P'), ('X'), ('M'), ('W'), ('E'), ('V'), ('Z1'), ('Z2'), ('Z3'), ('Z4'), ('Z5'), ('PCA')) v(s);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', ('00000000-0000-4000-a000-0000002c4e' || v.n)::uuid,
         'authenticated', 'authenticated', 'zz.2c3em.' || lower(v.s) || '@example.invalid',
         'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
    from (values ('P', '01'), ('PCA', '02'), ('Z2', '03'), ('Z3', '04'), ('Z5', '05')) v(s, n);
  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select ('00000000-0000-4000-a000-0000002c4e' || v.n)::uuid, 'zz.2c3em.' || lower(v.s) || '@example.invalid',
         'ZZ 2C3EM ' || v.s, v.role, pg_temp.person('ZZ 2C3EM ' || v.s), true
    from (values ('P', '01', 'viewer'), ('PCA', '02', 'project_control_admin'), ('Z2', '03', 'viewer'),
                 ('Z3', '04', 'viewer'), ('Z5', '05', 'viewer')) v(s, n, role);

  -- Memberships. Z1-Z5 are members with NO project_contacts row at all.
  insert into public.project_members (project_id, contact_id, party_id, project_role)
  select pg_temp.project(v.code), pg_temp.person('ZZ 2C3EM ' || v.s), pg_temp.party(v.code, 'eprom'), 'Engineer'
    from (values ('ZZ-2C3EM-A', 'P'), ('ZZ-2C3EM-A', 'X'), ('ZZ-2C3EM-A', 'M'), ('ZZ-2C3EM-A', 'E'),
                 ('ZZ-2C3EM-A', 'Z1'), ('ZZ-2C3EM-A', 'Z2'), ('ZZ-2C3EM-A', 'Z3'), ('ZZ-2C3EM-A', 'Z4'), ('ZZ-2C3EM-A', 'Z5'),
                 ('ZZ-2C3EM-B', 'V'), ('ZZ-2C3EM-ARC', 'X'), ('ZZ-2C3EM-ARC', 'Z1')) v(code, s);
  update public.project_members set ended_at = clock_timestamp() where id = pg_temp.member('ZZ-2C3EM-A', 'ZZ 2C3EM E');

  -- Named holders (row, then column). W (NOT a member) and E (ENDED member)
  -- hold vacant-filled roles, so both DO have a project row.
  insert into public.project_contacts (project_id, contact_id, role)
  select pg_temp.project(v.code), pg_temp.person('ZZ 2C3EM ' || v.s), v.role
    from (values ('ZZ-2C3EM-A', 'P', 'project_control_manager'), ('ZZ-2C3EM-A', 'X', 'project_manager'),
                 ('ZZ-2C3EM-A', 'W', 'project_sponsor'), ('ZZ-2C3EM-A', 'E', 'client_representative'),
                 ('ZZ-2C3EM-ARC', 'X', 'project_manager')) v(code, s, role);
  update public.projects p
     set project_control_manager_id = case when p.code = 'ZZ-2C3EM-A' then pg_temp.person('ZZ 2C3EM P') end,
         project_manager_id = pg_temp.person('ZZ 2C3EM X'),
         project_sponsor_id = case when p.code = 'ZZ-2C3EM-A' then pg_temp.person('ZZ 2C3EM W') end,
         client_representative_id = case when p.code = 'ZZ-2C3EM-A' then pg_temp.person('ZZ 2C3EM E') end
   where p.code in ('ZZ-2C3EM-A', 'ZZ-2C3EM-ARC');

  -- M: Department Manager on A; V: a legacy row on A, but a member of B only.
  insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role)
  values (pg_temp.project('ZZ-2C3EM-A'), pg_temp.person('ZZ 2C3EM M'), 'team_member', D, 'department_manager');
  set local session_replication_role = replica;
  insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role)
  values (pg_temp.project('ZZ-2C3EM-A'), pg_temp.person('ZZ 2C3EM V'), 'team_member', D, 'team_member');
  set local session_replication_role = origin;

  -- An existing position on A, held by M.
  insert into public.project_positions (project_id, job_title_id, contact_id)
  values (pg_temp.project('ZZ-2C3EM-A'), v_title, pg_temp.person('ZZ 2C3EM M')) returning id into v_position;
  insert into ids(key, id) values ('POSITION', v_position);

  update public.projects set status = 'archived' where code = 'ZZ-2C3EM-ARC';
  insert into ids(key, note) values
    ('HISTORY_BEFORE', (select count(*)::text from public.project_responsibility_history where project_id = pg_temp.project('ZZ-2C3EM-A'))),
    ('MEMBERS_BEFORE', (select count(*)::text from public.project_members where project_id = pg_temp.project('ZZ-2C3EM-A')));
end;
$fix$;

/* ============== 1. Replace Person, fixed responsibility (as PCM) ========== */

do $fixed$
declare
  v_w text := pg_temp.replace_sql('ZZ-2C3EM-A', 'fixed_responsibility', 'ZZ 2C3EM X', 'ZZ 2C3EM W', 'project_manager');
  v_e text := pg_temp.replace_sql('ZZ-2C3EM-A', 'fixed_responsibility', 'ZZ 2C3EM X', 'ZZ 2C3EM E', 'project_manager');
  v_v text := pg_temp.replace_sql('ZZ-2C3EM-A', 'fixed_responsibility', 'ZZ 2C3EM X', 'ZZ 2C3EM V', 'project_manager');
  v_z1 text := pg_temp.replace_sql('ZZ-2C3EM-A', 'fixed_responsibility', 'ZZ 2C3EM X', 'ZZ 2C3EM Z1', 'project_manager');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c4e01","role":"authenticated"}';
  perform pg_temp.must_fail(1, '01 REPLACE FIXED', 'a non-member (who has a project row) is refused', v_w, 'NOT_PROJECT_MEMBER');
  perform pg_temp.must_fail(1, '01 REPLACE FIXED', 'an ENDED member is refused', v_e, 'NOT_PROJECT_MEMBER');
  perform pg_temp.must_fail(1, '01 REPLACE FIXED', 'a member of ANOTHER project is refused', v_v, 'NOT_PROJECT_MEMBER');
  perform pg_temp.must_pass(1, '01 REPLACE FIXED', 'an active member with NO prior project row takes over the Project Manager role', v_z1);
end $fixed$;
reset role;

do $fixed_check$
begin
  perform pg_temp.chk(1, '01 REPLACE FIXED', 'holder and role row moved to the member; exactly ONE history row (refusals wrote none)',
    (select project_manager_id from public.projects where code = 'ZZ-2C3EM-A') = pg_temp.person('ZZ 2C3EM Z1')
    and exists (select 1 from public.project_contacts where project_id = pg_temp.project('ZZ-2C3EM-A')
                 and role = 'project_manager' and contact_id = pg_temp.person('ZZ 2C3EM Z1') and department_id is null)
    and not exists (select 1 from public.project_contacts where project_id = pg_temp.project('ZZ-2C3EM-A')
                     and role = 'project_manager' and contact_id = pg_temp.person('ZZ 2C3EM X'))
    and (select count(*) from public.project_responsibility_history where project_id = pg_temp.project('ZZ-2C3EM-A'))
        = (select note::bigint from ids where key = 'HISTORY_BEFORE') + 1);
end $fixed_check$;

/* ======== 2. Project Information: a NEW position for an active member ======= */

do $positions$
declare
  v_w text := pg_temp.positions_sql('ZZ-2C3EM-A', 'ZZ 2C3EM W');
  v_e text := pg_temp.positions_sql('ZZ-2C3EM-A', 'ZZ 2C3EM E');
  v_v text := pg_temp.positions_sql('ZZ-2C3EM-A', 'ZZ 2C3EM V');
  v_z3 text := pg_temp.positions_sql('ZZ-2C3EM-A', 'ZZ 2C3EM Z3');
  A uuid := pg_temp.project('ZZ-2C3EM-A');
  W uuid := pg_temp.person('ZZ 2C3EM W');
  T uuid := pg_temp.id('TITLE');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c4e02","role":"authenticated"}';
  perform pg_temp.must_fail(2, '02 NEW POSITION', 'a non-member (who has a project row) cannot receive a position', v_w, 'HOLDER_MEMBER_REQUIRED');
  perform pg_temp.must_fail(2, '02 NEW POSITION', 'an ENDED member cannot', v_e, 'HOLDER_MEMBER_REQUIRED');
  perform pg_temp.must_fail(2, '02 NEW POSITION', 'a member of ANOTHER project cannot', v_v, 'HOLDER_MEMBER_REQUIRED');
  perform pg_temp.must_fail(2, '02 NEW POSITION', 'a direct INSERT for a non-member is refused too',
    format('insert into public.project_positions (project_id, job_title_id, contact_id) values (%L, %L, %L)', A, T, W), 'HOLDER_MEMBER_REQUIRED');
  perform pg_temp.must_pass(2, '02 NEW POSITION', 'an active member with NO prior project row receives a new position (Project Information save)', v_z3);
end $positions$;
reset role;

do $positions_again$
declare v_same text := pg_temp.positions_sql('ZZ-2C3EM-A', null);
begin
  perform pg_temp.chk(2, '02 NEW POSITION', 'the position is stored for the member, and no project row or membership was created for them',
    exists (select 1 from public.project_positions where project_id = pg_temp.project('ZZ-2C3EM-A') and contact_id = pg_temp.person('ZZ 2C3EM Z3'))
    and not exists (select 1 from public.project_contacts where project_id = pg_temp.project('ZZ-2C3EM-A') and contact_id = pg_temp.person('ZZ 2C3EM Z3'))
    and (select count(*) from public.project_members where project_id = pg_temp.project('ZZ-2C3EM-A'))
        = (select note::bigint from ids where key = 'MEMBERS_BEFORE'));
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c4e02","role":"authenticated"}';
  perform pg_temp.must_pass(2, '02 NEW POSITION', 'an unchanged re-save of every position passes', v_same);
end $positions_again$;
reset role;

/* ================= 3. Replace Person, project position ================== */

do $position_replace$
declare
  v_w text := pg_temp.replace_sql('ZZ-2C3EM-A', 'project_position', 'ZZ 2C3EM M', 'ZZ 2C3EM W', null, null, null, pg_temp.id('POSITION'));
  v_z4 text := pg_temp.replace_sql('ZZ-2C3EM-A', 'project_position', 'ZZ 2C3EM M', 'ZZ 2C3EM Z4', null, null, null, pg_temp.id('POSITION'));
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c4e02","role":"authenticated"}';
  perform pg_temp.must_fail(3, '03 REPLACE POSITION', 'a non-member cannot take a position over', v_w, 'NOT_PROJECT_MEMBER');
  perform pg_temp.must_pass(3, '03 REPLACE POSITION', 'an active member with NO prior project row takes a position over', v_z4);
end $position_replace$;
reset role;

/* ============ 4. authority: exactly the responsibility's own ============== */

do $pcm$
declare v_z2 text := pg_temp.replace_sql('ZZ-2C3EM-A', 'fixed_responsibility', 'ZZ 2C3EM P', 'ZZ 2C3EM Z2', 'project_control_manager');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c4e02","role":"authenticated"}';
  perform pg_temp.must_pass(4, '04 AUTHORITY', 'Project Control Admin hands Project Control to an active member with no prior row', v_z2);
end $pcm$;
reset role;

do $authority$
declare A uuid := pg_temp.project('ZZ-2C3EM-A');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c4e03","role":"authenticated"}';
  perform pg_temp.chk(4, '04 AUTHORITY', 'the new Project Control has that responsibility''s authority (via the moved role row)',
    public.can_manage_project_setup(A) and public.can_manage_reporting_workflow(A));
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c4e01","role":"authenticated"}';
  perform pg_temp.chk(4, '04 AUTHORITY', 'the replaced Project Control loses it at once', not pg_temp.any_authority(A));
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c4e04","role":"authenticated"}';
  perform pg_temp.chk(4, '04 AUTHORITY', 'a position holder gains no authority', not pg_temp.any_authority(A));
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c4e05","role":"authenticated"}';
  perform pg_temp.chk(4, '04 AUTHORITY', 'a plain active member gains no authority', not pg_temp.any_authority(A));
end $authority$;
reset role;

do $no_membership$
begin
  perform pg_temp.chk(4, '04 AUTHORITY', 'no membership was created anywhere in this run',
    (select count(*) from public.project_members where project_id = pg_temp.project('ZZ-2C3EM-A'))
    = (select note::bigint from ids where key = 'MEMBERS_BEFORE'));
end $no_membership$;

/* ================= 5. PSM Department Manager unchanged ==================== */

do $department$
declare
  v_w text := pg_temp.replace_sql('ZZ-2C3EM-A', 'department_assignment', 'ZZ 2C3EM M', 'ZZ 2C3EM W', null,
                                  pg_temp.id('DEPT'), 'department_manager');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c4e02","role":"authenticated"}';
  perform pg_temp.must_fail(5, '05 PSM UNCHANGED', 'Department Manager replacement by a non-member keeps its Wave 2 refusal', v_w, 'PSM_MEMBER_REQUIRED');
end $department$;
reset role;

/* ========================= 6. archived refused first ====================== */

do $archived$
declare
  v_z1 text := pg_temp.replace_sql('ZZ-2C3EM-ARC', 'fixed_responsibility', 'ZZ 2C3EM X', 'ZZ 2C3EM Z1', 'project_manager');
  v_pos text := format('select public.save_project_setup_relation(%L::uuid, %L::timestamptz, %L, %L::jsonb)',
                       pg_temp.project('ZZ-2C3EM-ARC'), pg_temp.version('ZZ-2C3EM-ARC'), 'positions',
                       jsonb_build_array(jsonb_build_object('jobTitleId', pg_temp.id('TITLE'), 'contactId', pg_temp.person('ZZ 2C3EM Z1'))));
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c4e02","role":"authenticated"}';
  perform pg_temp.must_fail(6, '06 ARCHIVED', 'Replace Person on an archived project is refused, even to an active member', v_z1, 'PROJECT_ARCHIVED');
  perform pg_temp.must_fail(6, '06 ARCHIVED', 'a new position on an archived project is refused', v_pos, 'PROJECT_ARCHIVED');
end $archived$;
reset role;

/* ===================== 7. new project creation unchanged ================== */

do $create$
declare
  v_project uuid;
  v_version timestamptz;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c4e02","role":"authenticated"}';
  insert into public.projects (code, name, client_id, planned_start_date, planned_finish_date, status, structure_family)
  select 'ZZ-2C3EM-NEW', 'ZZ 2C.3E eligibility NEW', p.client_id, p.planned_start_date, p.planned_finish_date, 'planning', 'psm'
    from public.projects p where p.code = 'ZZ-2C3EM-A'
  returning id into v_project;
  select updated_at into v_version from public.projects where id = v_project;
  perform pg_temp.must_pass(7, '07 NEW PROJECT', 'a new project names its first holders without any membership (unchanged)',
    format('select public.save_project_setup_patch(%L, %L, %L::jsonb, %L::jsonb)', v_project, v_version,
           jsonb_build_object('project_manager_id', pg_temp.person('ZZ 2C3EM W'),
                              'project_control_manager_id', pg_temp.person('ZZ 2C3EM PCA')), '{}'));
end $create$;
reset role;

/* ================================ 8. catalog ============================== */

do $catalog$
declare
  v_replace text := (select prosrc from pg_proc where oid = 'public.replace_project_responsibility(uuid,text,uuid,uuid,text,uuid,text,uuid,text)'::regprocedure);
begin
  perform pg_temp.chk(8, '08 CATALOG', 'Replace Person checks active membership twice and no longer requires a project_contacts row',
    (select count(*) from regexp_matches(v_replace, 'from public\.project_members m', 'g')) = 2
    and v_replace !~ 'select 1 from public\.project_contacts\s+where project_id = p_project and contact_id = p_to_contact');
  perform pg_temp.chk(8, '08 CATALOG', 'Replace Person keeps its privileges (authenticated yes, anon no) and one history insert',
    has_function_privilege('authenticated', 'public.replace_project_responsibility(uuid,text,uuid,uuid,text,uuid,text,uuid,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.replace_project_responsibility(uuid,text,uuid,uuid,text,uuid,text,uuid,text)', 'EXECUTE')
    and (select count(*) from regexp_matches(v_replace, 'insert into public\.project_responsibility_history', 'g')) = 1);
  perform pg_temp.chk(8, '08 CATALOG', 'the guard functions stay non-executable by clients',
    not has_function_privilege('authenticated', 'public.guard_project_position_membership()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.guard_fixed_project_responsibility_membership()', 'EXECUTE'));
  perform pg_temp.chk(8, '08 CATALOG', 'membership still grants nothing: no authorization helper reads project_members',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public'
                   and (p.proname ~ '^(can_|is_|has_|current_user_|current_contact_|weekly_can_|monthly_can_|executive_can_)'
                        or p.proname ~ '_accepts_department_input$')
                   and p.prosrc ilike '%project_members%'));
end $catalog$;

/* ================================ report ================================ */

select seq, area, item, verdict from r order by seq, area, item;
select count(*) filter (where verdict like 'PASS%') as passed,
       count(*) filter (where verdict like 'FAIL%') as failed,
       count(*) as total
  from r;

rollback;

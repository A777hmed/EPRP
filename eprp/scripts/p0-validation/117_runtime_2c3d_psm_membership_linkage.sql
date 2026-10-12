-- Phase 2C.3D Wave 2 PSM linkage to project membership — RUNTIME verification. LOCAL DATABASE ONLY.
--
-- Proves 20261012150000_psm_membership_linkage.sql against real PostgreSQL,
-- real RLS and real authenticated roles. Everything — fixtures, accounts and
-- every write — runs in ONE transaction that is ROLLED BACK. Nothing persists.
--
--   1  a NEW scoped PSM assignment needs an ACTIVE member of the SAME project
--      (global-only person, other-project member, ended member refused;
--      active member accepted) — through the Contacts step's RPC
--   2  inactive person refused even with an active membership
--   3  legacy rows (written before the guard) stay readable; re-saving them
--      unchanged is accepted; editing them requires membership
--   4  Replace Person's department branch: the replacement needs membership
--   5  ending a membership is refused while the person holds a department
--      assignment, a fixed responsibility or a project position
--   6  PSM authority unchanged: Department Manager approve / department-user
--      predicates still come from project_contacts only; membership grants
--      nothing; the six malformed legacy rows grant nothing and are untouched
--   7  catalog: triggers installed, functions not executable by clients,
--      no authority helper or policy reads membership
--
-- Uses existing data read-only (ZZ-P0TEST-PRJ as a fixture template; the six
-- malformed MDP rows, fingerprinted and re-checked).
--
-- HOW TO RUN (after the migration is applied; from eprp/):
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < scripts/p0-validation/117_runtime_2c3d_psm_membership_linkage.sql

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
-- The Contacts step's save of the WHOLE team relation, as SQL text, at the current version.
create or replace function pg_temp.save_team_sql(p_code text, p_rows jsonb) returns text
language sql as $$
  select format('select public.save_project_setup_relation(%L::uuid, %L::timestamptz, %L, %L::jsonb)',
                pg_temp.project(p_code), (select updated_at from public.projects where code = p_code), 'team', p_rows)
$$;
create or replace function pg_temp.team_row(p_name text, p_role text default 'team_member', p_title text default null, p_reports text default null)
returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('contactId', pg_temp.person(p_name), 'departmentId', (select id from ids where key = 'DEPT'),
         'assignmentRole', p_role, 'functionalTitle', p_title, 'reportsToContactId', pg_temp.person(p_reports)))
$$;


/* ========================= fixtures (as postgres) ========================= */

-- The six malformed legacy rows, fingerprinted before anything runs.
insert into ids(key, note)
select 'MALFORMED', md5(string_agg(pc.id::text || pc.contact_id || pc.role || coalesce(pc.department_id::text, '')
                                     || coalesce(pc.assignment_role, ''), ',' order by pc.id))
  from public.project_contacts pc
 where pc.role <> 'team_member' and pc.department_id is not null;

do $fix$
declare
  v_template uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
begin
  if v_template is null then
    raise exception 'ZZ-P0TEST-PRJ not found — this script expects the local development dataset.';
  end if;
  if to_regprocedure('public.guard_psm_assignment_membership()') is null then
    raise exception 'guard_psm_assignment_membership() not found — apply 20261012150000_psm_membership_linkage.sql first.';
  end if;

  insert into public.projects (code, name, client_id, planned_start_date, planned_finish_date, status, structure_family)
  select 'ZZ-2C3DW2-' || v.s, 'ZZ 2C.3D W2 ' || v.s, p.client_id, p.planned_start_date, p.planned_finish_date, 'active', 'psm'
    from public.projects p, (values ('A'), ('B')) v(s)
   where p.id = v_template;

  insert into ids(key, id) values ('DEPT', (select id from public.departments order by name limit 1));
  insert into public.project_departments (project_id, department_id)
  select pg_temp.project('ZZ-2C3DW2-' || s), (select id from ids where key = 'DEPT') from (values ('A'), ('B')) v(s);

  insert into public.contacts (name, email, active) values
    ('ZZ W2 Manager', 'zz.w2.manager@example.invalid', true),
    ('ZZ W2 Lead', 'zz.w2.lead@example.invalid', true),
    ('ZZ W2 Member', 'zz.w2.member@example.invalid', true),
    ('ZZ W2 Global Only', 'zz.w2.global@example.invalid', true),
    ('ZZ W2 Other Project', 'zz.w2.other@example.invalid', true),
    ('ZZ W2 Former', 'zz.w2.former@example.invalid', true),
    ('ZZ W2 Deactivated', 'zz.w2.deactivated@example.invalid', true),
    ('ZZ W2 Legacy', 'zz.w2.legacy@example.invalid', true),
    ('ZZ W2 Holder', 'zz.w2.holder@example.invalid', true),
    ('ZZ W2 PCM', 'zz.w2.pcm@example.invalid', true),
    ('ZZ W2 OUT', 'zz.w2.out@example.invalid', true);

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', v.id::uuid, 'authenticated', 'authenticated', v.email,
         'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
    from (values ('00000000-0000-4000-a000-00000002c3e1', 'zz.w2.pcm@example.invalid'),
                 ('00000000-0000-4000-a000-00000002c3e2', 'zz.w2.out@example.invalid'),
                 ('00000000-0000-4000-a000-00000002c3e3', 'zz.w2.manager@example.invalid'),
                 ('00000000-0000-4000-a000-00000002c3e4', 'zz.w2.member@example.invalid')) v(id, email);
  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select v.id::uuid, v.email, v.name, 'viewer', pg_temp.person(v.name), true
    from (values ('00000000-0000-4000-a000-00000002c3e1', 'zz.w2.pcm@example.invalid', 'ZZ W2 PCM'),
                 ('00000000-0000-4000-a000-00000002c3e2', 'zz.w2.out@example.invalid', 'ZZ W2 OUT'),
                 ('00000000-0000-4000-a000-00000002c3e3', 'zz.w2.manager@example.invalid', 'ZZ W2 Manager'),
                 ('00000000-0000-4000-a000-00000002c3e4', 'zz.w2.member@example.invalid', 'ZZ W2 Member')) v(id, email, name);

  -- Project Control / Planning on A only (the existing model).
  insert into public.project_contacts (project_id, contact_id, role)
  values (pg_temp.project('ZZ-2C3DW2-A'), pg_temp.person('ZZ W2 PCM'), 'project_control_manager');

  -- Memberships (as the table owner; triggers still apply).
  insert into public.project_members (project_id, contact_id, party_id, project_role)
  select pg_temp.project(v.code), pg_temp.person(v.name), pg_temp.party(v.code, 'eprom'), v.role
    from (values ('ZZ-2C3DW2-A', 'ZZ W2 Manager', 'Department Manager'),
                 ('ZZ-2C3DW2-A', 'ZZ W2 Lead', 'Lead Engineer'),
                 ('ZZ-2C3DW2-A', 'ZZ W2 Member', 'Engineer'),
                 ('ZZ-2C3DW2-A', 'ZZ W2 Former', 'Engineer'),
                 ('ZZ-2C3DW2-A', 'ZZ W2 Deactivated', 'Engineer'),
                 ('ZZ-2C3DW2-A', 'ZZ W2 Holder', 'Project Manager'),
                 ('ZZ-2C3DW2-B', 'ZZ W2 Other Project', 'Engineer')) v(code, name, role);
  update public.project_members set ended_at = clock_timestamp()
   where id = pg_temp.member('ZZ-2C3DW2-A', 'ZZ W2 Former');
  update public.contacts set active = false where id = pg_temp.person('ZZ W2 Deactivated');

  -- A fixed responsibility holder on A (mirror row first, then the column).
  insert into public.project_contacts (project_id, contact_id, role)
  values (pg_temp.project('ZZ-2C3DW2-A'), pg_temp.person('ZZ W2 Holder'), 'project_manager');
  update public.projects set project_manager_id = pg_temp.person('ZZ W2 Holder') where code = 'ZZ-2C3DW2-A';

  -- A LEGACY scoped row written before the guard existed: its person has no
  -- membership. Triggers are bypassed for this one fixture row only.
  set local session_replication_role = replica;
  insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role)
  values (pg_temp.project('ZZ-2C3DW2-A'), pg_temp.person('ZZ W2 Legacy'), 'team_member',
          (select id from ids where key = 'DEPT'), 'team_member');
  set local session_replication_role = origin;
end;
$fix$;

/* ============ As Project Control / Planning assigned to project A ========= */

do $pcm$
declare
  A uuid := pg_temp.project('ZZ-2C3DW2-A');
  LEGACY jsonb := pg_temp.team_row('ZZ W2 Legacy');
  MANAGER jsonb := pg_temp.team_row('ZZ W2 Manager', 'department_manager');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-00000002c3e1","role":"authenticated"}';

  /* 3. legacy rows stay readable; an unchanged re-save is accepted */
  perform pg_temp.chk(3, '03 LEGACY', 'the legacy assignment (person without membership) is readable',
    exists (select 1 from public.project_contacts where project_id = A and contact_id = pg_temp.person('ZZ W2 Legacy')));
  perform pg_temp.must_pass(3, '03 LEGACY', 're-saving the team with the legacy row unchanged is accepted',
    pg_temp.save_team_sql('ZZ-2C3DW2-A', jsonb_build_array(LEGACY)));

  /* 1. new assignments need an active member of THIS project */
  perform pg_temp.must_fail(1, '01 NEW ASSIGNMENT', 'a person from the global People master only is refused',
    pg_temp.save_team_sql('ZZ-2C3DW2-A', jsonb_build_array(LEGACY, pg_temp.team_row('ZZ W2 Global Only'))), 'PSM_MEMBER_REQUIRED');
  perform pg_temp.must_fail(1, '01 NEW ASSIGNMENT', 'a member of ANOTHER project only is refused',
    pg_temp.save_team_sql('ZZ-2C3DW2-A', jsonb_build_array(LEGACY, pg_temp.team_row('ZZ W2 Other Project'))), 'PSM_MEMBER_REQUIRED');
  perform pg_temp.must_fail(1, '01 NEW ASSIGNMENT', 'an ENDED member is refused',
    pg_temp.save_team_sql('ZZ-2C3DW2-A', jsonb_build_array(LEGACY, pg_temp.team_row('ZZ W2 Former'))), 'PSM_MEMBER_REQUIRED');
  /* 2. inactive person */
  perform pg_temp.must_fail(2, '02 INACTIVE', 'an active member whose person record is inactive is refused',
    pg_temp.save_team_sql('ZZ-2C3DW2-A', jsonb_build_array(LEGACY, pg_temp.team_row('ZZ W2 Deactivated'))), 'PSM_PERSON_INACTIVE');
  perform pg_temp.must_pass(1, '01 NEW ASSIGNMENT', 'active members: Department Manager, Lead -> Manager, Member -> Lead are accepted',
    pg_temp.save_team_sql('ZZ-2C3DW2-A', jsonb_build_array(LEGACY, MANAGER,
      pg_temp.team_row('ZZ W2 Lead', 'team_member_lead', null, 'ZZ W2 Manager'),
      pg_temp.team_row('ZZ W2 Member', 'team_member', null, 'ZZ W2 Lead'))));
  perform pg_temp.chk(1, '01 NEW ASSIGNMENT', 'the three new rows are stored with their roles and reporting lines',
    (select count(*) from public.project_contacts where project_id = A and role = 'team_member') = 4
    and exists (select 1 from public.project_contacts where project_id = A and assignment_role = 'department_manager'
                 and contact_id = pg_temp.person('ZZ W2 Manager')));

  /* 3. editing a legacy assignment requires membership on save */
  perform pg_temp.must_fail(3, '03 LEGACY', 'editing the legacy row (functional title) without membership is refused',
    pg_temp.save_team_sql('ZZ-2C3DW2-A', jsonb_build_array(pg_temp.team_row('ZZ W2 Legacy', 'team_member', 'Inspector'), MANAGER,
      pg_temp.team_row('ZZ W2 Lead', 'team_member_lead', null, 'ZZ W2 Manager'),
      pg_temp.team_row('ZZ W2 Member', 'team_member', null, 'ZZ W2 Lead'))), 'PSM_MEMBER_REQUIRED');
  perform pg_temp.must_pass(3, '03 LEGACY', 'removing the legacy row (no membership needed to remove) is accepted',
    pg_temp.save_team_sql('ZZ-2C3DW2-A', jsonb_build_array(MANAGER,
      pg_temp.team_row('ZZ W2 Lead', 'team_member_lead', null, 'ZZ W2 Manager'),
      pg_temp.team_row('ZZ W2 Member', 'team_member', null, 'ZZ W2 Lead'))));

  /* 4. Replace Person: the replacement needs membership */
  perform pg_temp.must_fail(4, '04 REPLACE PERSON', 'replacing the Department Manager with a non-member (who holds another project row) is refused',
    format('select public.replace_project_responsibility(%L, %L, %L, %L, null, %L, %L, null, %L)', A, 'department_assignment',
           pg_temp.person('ZZ W2 Manager'), pg_temp.person('ZZ W2 PCM'), (select id from ids where key = 'DEPT'),
           'department_manager', 'Runtime check'), 'PSM_MEMBER_REQUIRED');
  perform pg_temp.chk(4, '04 REPLACE PERSON', 'the refused replacement changed nothing',
    exists (select 1 from public.project_contacts where project_id = A and assignment_role = 'department_manager'
             and contact_id = pg_temp.person('ZZ W2 Manager')));

  /* 5. ending a membership over PSM responsibility */
  perform pg_temp.must_fail(5, '05 END MEMBERSHIP', 'a Department Manager''s membership cannot end',
    format('select public.end_project_member(%L, %L, %L)', A, (select updated_at from public.projects where id = A),
           pg_temp.member('ZZ-2C3DW2-A', 'ZZ W2 Manager')), 'MEMBER_HAS_PSM_ASSIGNMENTS');
  perform pg_temp.must_fail(5, '05 END MEMBERSHIP', 'a Team Member''s membership cannot end',
    format('select public.end_project_member(%L, %L, %L)', A, (select updated_at from public.projects where id = A),
           pg_temp.member('ZZ-2C3DW2-A', 'ZZ W2 Member')), 'MEMBER_HAS_PSM_ASSIGNMENTS');
  perform pg_temp.must_fail(5, '05 END MEMBERSHIP', 'a fixed responsibility holder''s (Project Manager) membership cannot end',
    format('select public.end_project_member(%L, %L, %L)', A, (select updated_at from public.projects where id = A),
           pg_temp.member('ZZ-2C3DW2-A', 'ZZ W2 Holder')), 'MEMBER_HAS_PROJECT_RESPONSIBILITY');
  perform pg_temp.must_pass(5, '05 END MEMBERSHIP', 'a member with no PSM responsibility can end (Deactivated person)',
    format('select public.end_project_member(%L, %L, %L)', A, (select updated_at from public.projects where id = A),
           pg_temp.member('ZZ-2C3DW2-A', 'ZZ W2 Deactivated')));
  perform pg_temp.chk(5, '05 END MEMBERSHIP', 'refusals removed or reassigned nothing',
    (select count(*) from public.project_contacts where project_id = A and role = 'team_member') = 3);
end $pcm$;
reset role;

/* 5 (owner): a project position also blocks ending. */
do $position$
declare
  A uuid := pg_temp.project('ZZ-2C3DW2-A');
  v_title uuid := (select id from public.job_titles order by name limit 1);
begin
  if v_title is null then
    perform pg_temp.chk(5, '05 END MEMBERSHIP', 'a project position holder''s membership cannot end', true, 'skipped: no job title master row');
    return;
  end if;
  insert into public.project_positions (project_id, job_title_id, contact_id)
  values (A, v_title, pg_temp.person('ZZ W2 Lead'));
  delete from public.project_contacts where project_id = A and contact_id = pg_temp.person('ZZ W2 Member') and role = 'team_member';
  perform pg_temp.must_fail(5, '05 END MEMBERSHIP', 'a project position holder''s membership cannot end',
    format('update public.project_members set ended_at = clock_timestamp() where id = %L', pg_temp.member('ZZ-2C3DW2-A', 'ZZ W2 Lead')),
    'MEMBER_HAS_PROJECT_RESPONSIBILITY');
  perform pg_temp.must_pass(5, '05 END MEMBERSHIP', 'once the department assignment is removed, the member ends normally',
    format('update public.project_members set ended_at = clock_timestamp() where id = %L', pg_temp.member('ZZ-2C3DW2-A', 'ZZ W2 Member')));
end $position$;

/* ========================== 6. PSM authority unchanged ==================== */

do $manager$
declare
  A uuid := pg_temp.project('ZZ-2C3DW2-A');
  D uuid := (select id from ids where key = 'DEPT');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-00000002c3e3","role":"authenticated"}';
  perform pg_temp.chk(6, '06 AUTHORITY', 'the assigned Department Manager keeps department-user and approve / return authority (project_contacts)',
    public.is_department_user(A, D) is true and public.is_weekly_department_manager(A, D) is true);
  perform pg_temp.chk(6, '06 AUTHORITY', 'department authority does not extend to another project (B)',
    public.is_department_user(pg_temp.project('ZZ-2C3DW2-B'), D) is not true);
end $manager$;
reset role;

do $memberonly$
declare
  B uuid := pg_temp.project('ZZ-2C3DW2-B');
  D uuid := (select id from ids where key = 'DEPT');
begin
  -- ZZ W2 Member is a project MEMBER of B? No: give them a membership on B only (owner), no assignment.
  insert into public.project_members (project_id, contact_id, party_id, project_role)
  values (B, pg_temp.person('ZZ W2 Member'), pg_temp.party('ZZ-2C3DW2-B', 'eprom'), 'Engineer');
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-00000002c3e4","role":"authenticated"}';
  perform pg_temp.chk(6, '06 AUTHORITY', 'membership alone grants no project, department or setup authority',
    public.is_department_user(B, D) is not true and public.is_weekly_department_manager(B, D) is not true
    and public.can_manage_project_setup(B) is not true and public.can_manage_project_responsibilities(B) is not true
    and public.can_access_project(B) is not true);
end $memberonly$;
reset role;

do $malformed$
declare
  v_project uuid;
  v_department uuid;
  v_contact uuid;
  v_profile uuid := '00000000-0000-4000-a000-00000002c3e9';
begin
  select pc.project_id, pc.department_id, pc.contact_id into v_project, v_department, v_contact
    from public.project_contacts pc
   where pc.role = 'project_manager' and pc.assignment_role = 'department_manager' limit 1;
  if v_project is null then
    perform pg_temp.chk(6, '06 MALFORMED', 'a malformed row grants no Department Manager authority', true, 'skipped: no malformed row present');
    return;
  end if;
  -- An account for that row's person: reuse an existing active profile, or
  -- create one inside the rolled-back transaction.
  select p.id into v_profile from public.profiles p where p.contact_id = v_contact and p.active limit 1;
  if v_profile is null then
    v_profile := '00000000-0000-4000-a000-00000002c3e9';
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', v_profile, 'authenticated', 'authenticated', 'zz.w2.malformed@example.invalid',
            'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());
    insert into public.profiles (id, email, full_name, role, contact_id, active)
    values (v_profile, 'zz.w2.malformed@example.invalid', 'ZZ W2 Malformed', 'viewer', v_contact, true);
  end if;
  insert into ids(key, id) values ('M_PROJECT', v_project), ('M_DEPT', v_department), ('M_PROFILE', v_profile);
end $malformed$;

do $malformed_as_user$
declare
  P uuid := (select id from ids where key = 'M_PROJECT');
  D uuid := (select id from ids where key = 'M_DEPT');
  U uuid := (select id from ids where key = 'M_PROFILE');
begin
  if P is null then return; end if;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', U, 'role', 'authenticated')::text, true);
  perform pg_temp.chk(6, '06 MALFORMED', 'a malformed row (role = project_manager + department_manager) grants no Department Manager authority',
    public.is_weekly_department_manager(P, D) is not true and public.is_department_user(P, D) is not true);
end $malformed_as_user$;
reset role;

/* outsider: setup authority unchanged */
do $out$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-00000002c3e2","role":"authenticated"}';
  perform pg_temp.must_fail(6, '06 AUTHORITY', 'an unassigned account still cannot save a PSM team (setup authority unchanged)',
    pg_temp.save_team_sql('ZZ-2C3DW2-A', jsonb_build_array(pg_temp.team_row('ZZ W2 Manager', 'department_manager'))));
end $out$;
reset role;

/* ========================= 7. catalog and untouched data =================== */

do $catalog$
begin
  perform pg_temp.chk(7, '07 CATALOG', 'both guards are installed',
    exists (select 1 from pg_trigger where tgname = 'guard_psm_assignment_membership' and tgrelid = 'public.project_contacts'::regclass)
    and exists (select 1 from pg_trigger where tgname = 'guard_project_member_psm_responsibilities' and tgrelid = 'public.project_members'::regclass));
  perform pg_temp.chk(7, '07 CATALOG', 'the guard functions are not executable by clients',
    not has_function_privilege('authenticated', 'public.guard_psm_assignment_membership()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.guard_psm_assignment_membership()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.guard_project_member_psm_responsibilities()', 'EXECUTE'));
  perform pg_temp.chk(7, '07 CATALOG', 'no authorization helper reads project_members',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public'
                   and (p.proname ~ '^(can_|is_|has_|current_user_|current_contact_|weekly_can_|monthly_can_|executive_can_)'
                        or p.proname ~ '_accepts_department_input$')
                   and p.prosrc ilike '%project_members%'));
  perform pg_temp.chk(7, '07 CATALOG', 'the 2C.3D Wave 1 guard on project_members is still installed',
    exists (select 1 from pg_trigger where tgname = 'guard_project_member_unit_assignments' and tgrelid = 'public.project_members'::regclass));
  perform pg_temp.chk(6, '06 MALFORMED', 'the six malformed legacy rows are untouched (same count and fingerprint)',
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

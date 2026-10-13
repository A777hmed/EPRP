-- Phase 2C.3E follow-up: replacing a held project-level responsibility needs
-- an ACTIVE member of the same project — RUNTIME verification. LOCAL DATABASE
-- ONLY.
--
-- Proves 20261013090000_responsibility_holder_membership.sql against real
-- PostgreSQL, real RLS and real authenticated roles. Everything — fixtures,
-- accounts and every write — runs in ONE transaction that is ROLLED BACK.
--
--   1  Replace Person, fixed responsibility: a non-member, an ENDED member and
--      a member of ANOTHER project are refused; an active member succeeds,
--      with its history; refused attempts write no history
--   2  the same rule through the setup patch and direct writes; filling a
--      vacant responsibility and clearing one are not replacements (unchanged)
--   3  project positions: the same rule (Replace Person and direct writes)
--   4  PSM department assignment Replace Person unchanged (2C.3D Wave 2)
--   5  archived projects still refused first (2C.3E)
--   6  new project creation unchanged: first holders need no membership
--   7  catalog
--
-- HOW TO RUN (after the migration is applied; from eprp/):
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < scripts/p0-validation/119_runtime_2c3e_holder_membership.sql

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
create or replace function pg_temp.patch_sql(p_code text, p_columns jsonb) returns text
language sql as $$
  select format('select public.save_project_setup_patch(%L::uuid, %L::timestamptz, %L::jsonb, %L::jsonb)',
                pg_temp.project(p_code), pg_temp.version(p_code), p_columns, '{}')
$$;
-- Replace Person as SQL text.
create or replace function pg_temp.replace_sql(
  p_code text, p_kind text, p_from text, p_to text, p_role text default null,
  p_department uuid default null, p_assignment text default null, p_position uuid default null
) returns text language sql as $$
  select format('select public.replace_project_responsibility(%L, %L, %L, %L, %L, %L, %L, %L, %L)',
                pg_temp.project(p_code), p_kind, pg_temp.person(p_from), pg_temp.person(p_to), p_role,
                p_department, p_assignment, p_position, 'Runtime check')
$$;

/* ========================= fixtures (as postgres) ========================= */

do $fix$
declare
  v_template uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  D uuid := (select id from public.departments order by name limit 1);
  v_title uuid := (select id from public.job_titles order by name limit 1);
begin
  if v_template is null then
    raise exception 'ZZ-P0TEST-PRJ not found — this script expects the local development dataset.';
  end if;
  if to_regprocedure('public.guard_fixed_holder_replacement()') is null then
    raise exception 'guard_fixed_holder_replacement() not found — apply 20261013090000_responsibility_holder_membership.sql first.';
  end if;
  insert into ids(key, id) values ('DEPT', D), ('TITLE', v_title);

  insert into public.projects (code, name, client_id, planned_start_date, planned_finish_date, status, structure_family)
  select 'ZZ-2C3EH-' || v.s, 'ZZ 2C.3E holder ' || v.s, p.client_id, p.planned_start_date, p.planned_finish_date, 'active', 'psm'
    from public.projects p, (values ('A'), ('B'), ('ARC')) v(s)
   where p.id = v_template;
  insert into public.project_departments (project_id, department_id)
  select pg_temp.project('ZZ-2C3EH-' || s), D from (values ('A'), ('B'), ('ARC')) v(s);

  insert into public.contacts (name, email, active)
  select 'ZZ 2C3EH ' || s, 'zz.2c3eh.' || lower(s) || '@example.invalid', true
    from (values ('P'), ('X'), ('Y'), ('Z'), ('W'), ('E'), ('V'), ('M'), ('PCA')) v(s);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', ('00000000-0000-4000-a000-0000002c3f' || v.n)::uuid,
         'authenticated', 'authenticated', 'zz.2c3eh.' || lower(v.s) || '@example.invalid',
         'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
    from (values ('P', '01'), ('PCA', '02')) v(s, n);
  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select ('00000000-0000-4000-a000-0000002c3f' || v.n)::uuid, 'zz.2c3eh.' || lower(v.s) || '@example.invalid',
         'ZZ 2C3EH ' || v.s, v.role, pg_temp.person('ZZ 2C3EH ' || v.s), true
    from (values ('P', '01', 'viewer'), ('PCA', '02', 'project_control_admin')) v(s, n, role);

  -- Memberships: P, X, Y, Z, M, E on A (E then ends); V on B only; P, X on ARC.
  insert into public.project_members (project_id, contact_id, party_id, project_role)
  select pg_temp.project(v.code), pg_temp.person('ZZ 2C3EH ' || v.s), pg_temp.party(v.code, 'eprom'), 'Engineer'
    from (values ('ZZ-2C3EH-A', 'P'), ('ZZ-2C3EH-A', 'X'), ('ZZ-2C3EH-A', 'Y'), ('ZZ-2C3EH-A', 'Z'),
                 ('ZZ-2C3EH-A', 'M'), ('ZZ-2C3EH-A', 'E'), ('ZZ-2C3EH-B', 'V'),
                 ('ZZ-2C3EH-ARC', 'P'), ('ZZ-2C3EH-ARC', 'X'), ('ZZ-2C3EH-ARC', 'Y')) v(code, s);
  update public.project_members set ended_at = clock_timestamp() where id = pg_temp.member('ZZ-2C3EH-A', 'ZZ 2C3EH E');

  -- Named holders on A (row, then column): P Project Control, X Project
  -- Manager; W (NOT a member) Sponsor and E (ENDED member) Client
  -- Representative were named while those roles were vacant — allowed.
  insert into public.project_contacts (project_id, contact_id, role)
  select pg_temp.project(v.code), pg_temp.person('ZZ 2C3EH ' || v.s), v.role
    from (values ('ZZ-2C3EH-A', 'P', 'project_control_manager'), ('ZZ-2C3EH-A', 'X', 'project_manager'),
                 ('ZZ-2C3EH-A', 'W', 'project_sponsor'), ('ZZ-2C3EH-A', 'E', 'client_representative'),
                 ('ZZ-2C3EH-ARC', 'P', 'project_control_manager'), ('ZZ-2C3EH-ARC', 'X', 'project_manager'),
                 ('ZZ-2C3EH-ARC', 'Y', 'project_sponsor')) v(code, s, role);
  update public.projects p
     set project_control_manager_id = pg_temp.person('ZZ 2C3EH P'),
         project_manager_id = pg_temp.person('ZZ 2C3EH X'),
         project_sponsor_id = case when p.code = 'ZZ-2C3EH-A' then pg_temp.person('ZZ 2C3EH W') else pg_temp.person('ZZ 2C3EH Y') end,
         client_representative_id = case when p.code = 'ZZ-2C3EH-A' then pg_temp.person('ZZ 2C3EH E') end
   where p.code in ('ZZ-2C3EH-A', 'ZZ-2C3EH-ARC');

  -- Department assignments on A: M Department Manager, Y Team Member.
  insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role, reports_to_contact_id)
  values (pg_temp.project('ZZ-2C3EH-A'), pg_temp.person('ZZ 2C3EH M'), 'team_member', D, 'department_manager', null),
         (pg_temp.project('ZZ-2C3EH-A'), pg_temp.person('ZZ 2C3EH Y'), 'team_member', D, 'team_member', pg_temp.person('ZZ 2C3EH M'));
  -- V: a LEGACY row on A (written before membership existed) but a member of B only.
  set local session_replication_role = replica;
  insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role)
  values (pg_temp.project('ZZ-2C3EH-A'), pg_temp.person('ZZ 2C3EH V'), 'team_member', D, 'team_member');
  set local session_replication_role = origin;

  -- A project position held by M (when a job title exists).
  if v_title is not null then
    insert into public.project_positions (project_id, job_title_id, contact_id)
    values (pg_temp.project('ZZ-2C3EH-A'), v_title, pg_temp.person('ZZ 2C3EH M'))
    returning id into v_title;
    insert into ids(key, id) values ('POSITION', v_title);
  end if;

  update public.projects set status = 'archived' where code = 'ZZ-2C3EH-ARC';
  insert into ids(key, note) values ('HISTORY_BEFORE',
    (select count(*)::text from public.project_responsibility_history where project_id = pg_temp.project('ZZ-2C3EH-A')));
end;
$fix$;

/* ============ 1. Replace Person, fixed responsibility (as PCM) ============ */

do $fixed$
declare
  v_w text := pg_temp.replace_sql('ZZ-2C3EH-A', 'fixed_responsibility', 'ZZ 2C3EH X', 'ZZ 2C3EH W', 'project_manager');
  v_e text := pg_temp.replace_sql('ZZ-2C3EH-A', 'fixed_responsibility', 'ZZ 2C3EH X', 'ZZ 2C3EH E', 'project_manager');
  v_v text := pg_temp.replace_sql('ZZ-2C3EH-A', 'fixed_responsibility', 'ZZ 2C3EH X', 'ZZ 2C3EH V', 'project_manager');
  v_y text := pg_temp.replace_sql('ZZ-2C3EH-A', 'fixed_responsibility', 'ZZ 2C3EH X', 'ZZ 2C3EH Y', 'project_manager');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3f01","role":"authenticated"}';
  -- Replace Person's own check ([NOT_PROJECT_MEMBER], since 20261013120000) or
  -- the holder guard ([HOLDER_MEMBER_REQUIRED]) answers, in the same words.
  -- A member with no project row yet now SUCCEEDS: 120_runtime_2c3e_member_eligibility.sql.
  perform pg_temp.must_fail(1, '01 REPLACE FIXED', 'a non-member (holding another role here) is refused', v_w, 'Only an active member of this project');
  perform pg_temp.must_fail(1, '01 REPLACE FIXED', 'an ENDED member is refused', v_e, 'Only an active member of this project');
  perform pg_temp.must_fail(1, '01 REPLACE FIXED', 'a member of ANOTHER project only is refused (same project required)', v_v, 'Only an active member of this project');
  perform pg_temp.must_pass(1, '01 REPLACE FIXED', 'an active member of this project takes over the Project Manager role', v_y);
end $fixed$;
reset role;

do $fixed_check$
begin
  perform pg_temp.chk(1, '01 REPLACE FIXED', 'the accepted replacement moved the holder and its row, and wrote ONE history row (refusals wrote none)',
    (select project_manager_id from public.projects where code = 'ZZ-2C3EH-A') = pg_temp.person('ZZ 2C3EH Y')
    and exists (select 1 from public.project_contacts where project_id = pg_temp.project('ZZ-2C3EH-A')
                 and role = 'project_manager' and contact_id = pg_temp.person('ZZ 2C3EH Y'))
    and (select count(*) from public.project_responsibility_history where project_id = pg_temp.project('ZZ-2C3EH-A'))
        = (select note::bigint from ids where key = 'HISTORY_BEFORE') + 1);
end $fixed_check$;

/* ===== 2. the same rule through the setup patch and direct writes ======== */

do $patch$
declare
  v_to_w text := pg_temp.patch_sql('ZZ-2C3EH-A', jsonb_build_object('project_manager_id', pg_temp.person('ZZ 2C3EH W')));
  v_vacant text := pg_temp.patch_sql('ZZ-2C3EH-A', jsonb_build_object('reporting_coordinator_id', pg_temp.person('ZZ 2C3EH Z')));
  A uuid := pg_temp.project('ZZ-2C3EH-A');
  W uuid := pg_temp.person('ZZ 2C3EH W');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3f01","role":"authenticated"}';
  perform pg_temp.must_fail(2, '02 BYPASS', 'Project Information save cannot hand the Project Manager role to a non-member', v_to_w, 'HOLDER_MEMBER_REQUIRED');
  perform pg_temp.must_fail(2, '02 BYPASS', 'a direct table write cannot either',
    format('update public.projects set project_manager_id = %L where id = %L', W, A), 'HOLDER_MEMBER_REQUIRED');
  perform pg_temp.must_pass(2, '02 BYPASS', 'filling a VACANT responsibility is not a replacement (unchanged)', v_vacant);
end $patch$;
reset role;
do $clear$
declare v_clear text := pg_temp.patch_sql('ZZ-2C3EH-A', '{"client_representative_id":null}');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3f01","role":"authenticated"}';
  perform pg_temp.must_pass(2, '02 BYPASS', 'clearing a responsibility is not a replacement (unchanged)', v_clear);
end $clear$;
reset role;

/* ============================ 3. project positions ======================== */

do $position$
declare
  POS uuid := pg_temp.id('POSITION');
  v_w text := pg_temp.replace_sql('ZZ-2C3EH-A', 'project_position', 'ZZ 2C3EH M', 'ZZ 2C3EH W', null, null, null, pg_temp.id('POSITION'));
  v_y text := pg_temp.replace_sql('ZZ-2C3EH-A', 'project_position', 'ZZ 2C3EH M', 'ZZ 2C3EH Y', null, null, null, pg_temp.id('POSITION'));
  W uuid := pg_temp.person('ZZ 2C3EH W');
begin
  if POS is null then
    perform pg_temp.chk(3, '03 POSITION', 'project positions follow the same rule', true, 'skipped: no job title master row');
    return;
  end if;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3f01","role":"authenticated"}';
  perform pg_temp.must_fail(3, '03 POSITION', 'Replace Person cannot give a position to a non-member', v_w, 'Only an active member of this project');
  perform pg_temp.must_fail(3, '03 POSITION', 'a direct write cannot either',
    format('update public.project_positions set contact_id = %L where id = %L', W, POS), 'HOLDER_MEMBER_REQUIRED');
  perform pg_temp.must_pass(3, '03 POSITION', 'an active member takes the position over', v_y);
end $position$;
reset role;

/* ================= 4. PSM department assignment unchanged ================= */

do $department$
declare
  v_w text := pg_temp.replace_sql('ZZ-2C3EH-A', 'department_assignment', 'ZZ 2C3EH M', 'ZZ 2C3EH W', null,
                                  pg_temp.id('DEPT'), 'department_manager');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3f01","role":"authenticated"}';
  perform pg_temp.must_fail(4, '04 PSM UNCHANGED', 'Department Manager replacement by a non-member keeps its Wave 2 refusal', v_w, 'PSM_MEMBER_REQUIRED');
end $department$;
reset role;

/* ========================= 5. archived still refused ====================== */

do $archived$
declare
  v_y text := pg_temp.replace_sql('ZZ-2C3EH-ARC', 'fixed_responsibility', 'ZZ 2C3EH X', 'ZZ 2C3EH Y', 'project_manager');
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3f01","role":"authenticated"}';
  perform pg_temp.must_fail(5, '05 ARCHIVED', 'an archived project refuses even a valid member replacement', v_y, 'PROJECT_ARCHIVED');
end $archived$;
reset role;

/* ===================== 6. new project creation unchanged ================== */

do $create$
declare
  v_project uuid;
  v_version timestamptz;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000002c3f02","role":"authenticated"}';
  insert into public.projects (code, name, client_id, planned_start_date, planned_finish_date, status, structure_family)
  select 'ZZ-2C3EH-NEW', 'ZZ 2C.3E holder NEW', p.client_id, p.planned_start_date, p.planned_finish_date, 'planning', 'psm'
    from public.projects p where p.code = 'ZZ-2C3EH-A'
  returning id, updated_at into v_project, v_version;
  select updated_at into v_version from public.projects where id = v_project;
  perform pg_temp.must_pass(6, '06 NEW PROJECT', 'a new project names its first holders without any membership (unchanged creation flow)',
    format('select public.save_project_setup_patch(%L, %L, %L::jsonb, %L::jsonb)', v_project, v_version,
           jsonb_build_object('project_manager_id', pg_temp.person('ZZ 2C3EH W'),
                              'project_control_manager_id', pg_temp.person('ZZ 2C3EH P')), '{}'));
end $create$;
reset role;

/* ================================ 7. catalog ============================== */

do $catalog$
begin
  perform pg_temp.chk(7, '07 CATALOG', 'both replacement guards are installed',
    exists (select 1 from pg_trigger where tgname = 'guard_fixed_holder_replacement' and tgrelid = 'public.projects'::regclass)
    and exists (select 1 from pg_trigger where tgname = 'guard_position_holder_replacement' and tgrelid = 'public.project_positions'::regclass));
  perform pg_temp.chk(7, '07 CATALOG', 'the guard functions are not executable by clients',
    not has_function_privilege('authenticated', 'public.guard_fixed_holder_replacement()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.guard_position_holder_replacement()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.guard_fixed_holder_replacement()', 'EXECUTE'));
  perform pg_temp.chk(7, '07 CATALOG', 'membership still grants nothing: no authorization helper reads project_members',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public'
                   and (p.proname ~ '^(can_|is_|has_|current_user_|current_contact_|weekly_can_|monthly_can_|executive_can_)'
                        or p.proname ~ '_accepts_department_input$')
                   and p.prosrc ilike '%project_members%'));
  perform pg_temp.chk(7, '07 CATALOG', 'the 2C.3E archived and holder-authority guards are still installed',
    (select count(*) from pg_trigger where tgname = 'block_archived_project_setup') = 8
    and (select count(*) from pg_trigger where tgname = 'guard_project_authority_rows') = 2);
end $catalog$;

/* ================================ report ================================ */

select seq, area, item, verdict from r order by seq, area, item;
select count(*) filter (where verdict like 'PASS%') as passed,
       count(*) filter (where verdict like 'FAIL%') as failed,
       count(*) as total
  from r;

rollback;

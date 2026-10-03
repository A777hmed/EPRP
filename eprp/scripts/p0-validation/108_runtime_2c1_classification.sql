-- Phase 2C.1 Classification — RUNTIME verification. LOCAL REHEARSAL DATABASE ONLY.
--
-- DRAFT: written for review, NOT YET RUN against any database.
--
-- Proves 20261001000001_project_setup_classification.sql:
--   1. NULL -> psm and NULL -> other are allowed (legacy classify-once)
--   2. a normal psm -> other change is rejected by the lock trigger, through
--      both a direct table UPDATE and save_project_setup_patch()
--   3. System Admin correction (6-argument form):
--      PSM -> Other needs an active category (+ custom name when required),
--      Other -> PSM clears category and custom name; each writes one audit
--      row with old/new family, category and custom name; stale versions,
--      PSM targets carrying a category and legacy projects are refused;
--      history cannot be UPDATEd, even by a System Admin
--   4. a non-System Admin correction is rejected (Project Control Manager)
--   5. a blank / whitespace reason is rejected
--   6. structure_family = other without a Project Category is rejected
--   7. custom-name rule: required for an allows_custom_name category,
--      refused for a normal category, refused for psm / legacy projects
--   8. portfolio_group_id now persists through save_project_setup_patch()
--   9. an ordinary user cannot write the audit table directly
--  10. an Other project can never use a PSM-family category (by code or by
--      name), through a direct write, the patch RPC or the System Admin
--      correction; a valid non-PSM category is accepted; PSM has no category
--
-- Requires 00_local_test_identity.sql and 01_setup_test_fixtures.sql first
-- (ZZ-P0TEST-PRJ fixture; identity ...a1 is the active system_admin).
-- Everything below runs in one transaction and is rolled back.
--
-- HOW TO RUN
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < 108_runtime_2c1_classification.sql

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
grant all on r to authenticated;
do $g$
begin
  execute format('grant usage on schema %I to authenticated',
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

create or replace function pg_temp.must_fail(
  p_seq int, p_area text, p_item text, p_sql text
) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp.chk(p_seq, p_area, p_item, false, 'statement was ACCEPTED');
exception when others then
  perform pg_temp.chk(p_seq, p_area, p_item, true, 'refused: ' || left(sqlerrm, 90));
end $$;

/* ========================= fixtures (as postgres) ========================= */

do $fix$
declare
  v_project uuid;
begin
  select id into v_project from public.projects where code = 'ZZ-P0TEST-PRJ';
  if v_project is null then
    raise exception 'ZZ-P0TEST-PRJ not found — run 00_local_test_identity.sql and 01_setup_test_fixtures.sql first.';
  end if;

  -- Two extra projects so every rule starts from a clean, unclassified row.
  -- No fixed responsibility holders: guard_fixed_project_responsibility_
  -- membership() requires a same-project project_contacts row for every
  -- non-NULL holder, and project_manager_id is nullable for exactly this
  -- staged state (20260824000001). Nothing in this script needs a holder.
  insert into public.projects (code, name, client_id,
                               planned_start_date, planned_finish_date, status)
  select 'ZZ-2C1-' || s, 'ZZ 2C.1 ' || s, p.client_id,
         p.planned_start_date, p.planned_finish_date, p.status
    from public.projects p, (values ('A'), ('B')) v(s)
   where p.id = v_project;

  -- Categories (local fixture rows only; the migration itself seeds nothing).
  insert into public.project_types (name, code, allows_custom_name) values
    ('ZZ 2C.1 Normal Category', 'ZZ-2C1-NORMAL', false),
    ('ZZ 2C.1 Other (specify)', 'ZZ-2C1-OTHER', true),
    -- PSM-family rows: one by code, one by name only (no code).
    ('ZZ 2C.1 PSAIM Category', 'PSAIM-ZZ2C1', false),
    ('ZZ 2C.1 Process Safety Programme', null, false);

  insert into public.portfolio_groups (name, code)
  values ('ZZ 2C.1 Portfolio Group', 'ZZ-2C1-PG');

  -- b1: Project Control Manager on ZZ-2C1-A (setup authority, not System Admin).
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-0000000108b1',
    'authenticated', 'authenticated', 'p0test.2c1-pcm@example.invalid',
    'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ) on conflict (id) do nothing;
  insert into public.contacts (name, email)
  values ('ZZ-P0TEST 2C1 PCM', 'p0test.2c1-pcm@example.invalid')
  on conflict do nothing;
  insert into public.project_contacts (project_id, contact_id, role)
  select p.id, c.id, 'project_control_manager'
    from public.projects p, public.contacts c
   where p.code in ('ZZ-2C1-A', 'ZZ-2C1-B') and c.name = 'ZZ-P0TEST 2C1 PCM';
  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select '00000000-0000-4000-a000-0000000108b1', 'p0test.2c1-pcm@example.invalid',
         'ZZ-P0TEST 2C1 PCM', 'viewer', c.id, true
    from public.contacts c where c.name = 'ZZ-P0TEST 2C1 PCM'
  on conflict (id) do nothing;
end;
$fix$;

/* ============================= the test run ================================ */

do $t$
declare
  P_A uuid := (select id from public.projects where code = 'ZZ-2C1-A');
  P_B uuid := (select id from public.projects where code = 'ZZ-2C1-B');
  T_NORMAL uuid := (select id from public.project_types where code = 'ZZ-2C1-NORMAL');
  T_OTHER uuid := (select id from public.project_types where code = 'ZZ-2C1-OTHER');
begin
  /* 1. NULL -> psm / NULL -> other (as postgres: table rules only) */
  begin
    update public.projects set structure_family = 'psm' where id = P_A;
    perform pg_temp.chk(1, '1 CLASSIFY ONCE', 'NULL -> psm is allowed', true);
  exception when others then
    perform pg_temp.chk(1, '1 CLASSIFY ONCE', 'NULL -> psm is allowed', false, left(sqlerrm, 120));
  end;
  begin
    update public.projects set structure_family = 'other', project_type_id = T_NORMAL where id = P_B;
    perform pg_temp.chk(1, '1 CLASSIFY ONCE', 'NULL -> other (with category) is allowed', true);
  exception when others then
    perform pg_temp.chk(1, '1 CLASSIFY ONCE', 'NULL -> other (with category) is allowed', false, left(sqlerrm, 120));
  end;

  /* 2. Normal psm -> other is rejected */
  perform pg_temp.must_fail(2, '2 LOCKED', 'direct UPDATE psm -> other is refused',
    format('update public.projects set structure_family = %L, project_type_id = %L where id = %L',
           'other', T_NORMAL, P_A));
  perform pg_temp.must_fail(2, '2 LOCKED', 'psm -> NULL is refused',
    format('update public.projects set structure_family = null where id = %L', P_A));

  /* 6. Other without a category is rejected */
  perform pg_temp.must_fail(6, '6 OTHER NEEDS CATEGORY', 'clearing the category of an Other project is refused',
    format('update public.projects set project_type_id = null where id = %L', P_B));

  /* 10. PSM-family categories never belong to an Other project; PSM has no category */
  perform pg_temp.must_fail(10, '10 PSM FAMILY', 'Other + PSM-family category (by code) is refused',
    format('update public.projects set project_type_id = (select id from public.project_types where code = %L) where id = %L',
           'PSAIM-ZZ2C1', P_B));
  perform pg_temp.must_fail(10, '10 PSM FAMILY', 'Other + PSM-family category (by name, no code) is refused',
    format('update public.projects set project_type_id = (select id from public.project_types where name = %L) where id = %L',
           'ZZ 2C.1 Process Safety Programme', P_B));
  perform pg_temp.must_fail(10, '10 PSM FAMILY', 'a PSM project cannot be given a category',
    format('update public.projects set project_type_id = %L where id = %L', T_NORMAL, P_A));
  perform pg_temp.chk(10, '10 PSM FAMILY', 'a valid non-PSM category remains on the Other project',
    (select project_type_id from public.projects where id = P_B) = T_NORMAL);
  perform pg_temp.chk(10, '10 PSM FAMILY', 'the SQL rule agrees with the app rule on PSAIM-01 / AIM-01 / name fallback',
    public.is_psm_family_project_type('PSAIM-01', 'x')
    and not public.is_psm_family_project_type('AIM-01', 'Process Safety')
    and public.is_psm_family_project_type(null, 'Process Safety Programme')
    and not public.is_psm_family_project_type('INSP', 'Inspection'));

  /* 7. Custom-name rule */
  perform pg_temp.must_fail(7, '7 CUSTOM NAME', 'allows_custom_name category without detail is refused',
    format('update public.projects set project_type_id = %L where id = %L', T_OTHER, P_B));
  perform pg_temp.must_fail(7, '7 CUSTOM NAME', 'detail on a normal category is refused',
    format('update public.projects set project_category_detail = %L where id = %L', 'Tank Inspection', P_B));
  perform pg_temp.must_fail(7, '7 CUSTOM NAME', 'blank detail is refused',
    format('update public.projects set project_type_id = %L, project_category_detail = %L where id = %L', T_OTHER, '   ', P_B));
  perform pg_temp.must_fail(7, '7 CUSTOM NAME', 'detail on a psm project is refused',
    format('update public.projects set project_category_detail = %L where id = %L', 'Tank Inspection', P_A));
  begin
    update public.projects set project_type_id = T_OTHER, project_category_detail = 'Tank Inspection' where id = P_B;
    perform pg_temp.chk(7, '7 CUSTOM NAME', 'allows_custom_name category with detail is accepted', true);
  exception when others then
    perform pg_temp.chk(7, '7 CUSTOM NAME', 'allows_custom_name category with detail is accepted', false, left(sqlerrm, 120));
  end;
  begin
    update public.project_types set allows_custom_name = false where id = T_OTHER;
    update public.projects set name = name where id = P_B;
    perform pg_temp.chk(7, '7 CUSTOM NAME', 'toggling a master row does not block unrelated project saves', true);
  exception when others then
    perform pg_temp.chk(7, '7 CUSTOM NAME', 'toggling a master row does not block unrelated project saves', false, left(sqlerrm, 120));
  end;
  update public.project_types set allows_custom_name = true where id = T_OTHER;
end $t$;

/* 2b / 4 / 5 / 8 / 9 as the Project Control Manager (setup authority, not admin) */
do $pcm$
declare
  P_A uuid := (select id from public.projects where code = 'ZZ-2C1-A');
  T_NORMAL uuid := (select id from public.project_types where code = 'ZZ-2C1-NORMAL');
  PG uuid := (select id from public.portfolio_groups where code = 'ZZ-2C1-PG');
  v_version timestamptz;
  v_pg uuid;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000108b1","role":"authenticated"}';

  select updated_at into v_version from public.projects where id = P_A;
  perform pg_temp.must_fail(2, '2 LOCKED', 'patch RPC psm -> other is refused',
    format('select public.save_project_setup_patch(%L, %L, %L::jsonb, %L::jsonb)',
           P_A, v_version,
           jsonb_build_object('structure_family', 'other', 'project_type_id', T_NORMAL), '{}'));

  /* 8. Portfolio Group persists through the patch RPC */
  begin
    select updated_at into v_version from public.projects where id = P_A;
    perform public.save_project_setup_patch(P_A, v_version,
      jsonb_build_object('portfolio_group_id', PG), '{}'::jsonb);
    select portfolio_group_id into v_pg from public.projects where id = P_A;
    perform pg_temp.chk(8, '8 PORTFOLIO GROUP', 'portfolio_group_id persists through save_project_setup_patch', v_pg = PG);
  exception when others then
    perform pg_temp.chk(8, '8 PORTFOLIO GROUP', 'portfolio_group_id persists through save_project_setup_patch', false, left(sqlerrm, 120));
  end;

  /* 10b. The Project Setup patch RPC applies the same PSM-family rule */
  select updated_at into v_version from public.projects where code = 'ZZ-2C1-B';
  perform pg_temp.must_fail(10, '10 PSM FAMILY', 'patch RPC: Other + PSM-family category is refused',
    format('select public.save_project_setup_patch((select id from public.projects where code = %L), %L, %L::jsonb, %L::jsonb)',
           'ZZ-2C1-B', v_version,
           jsonb_build_object('project_type_id', (select id from public.project_types where code = 'PSAIM-ZZ2C1'),
                              'project_category_detail', null),
           '{}'));
  begin
    select updated_at into v_version from public.projects where code = 'ZZ-2C1-B';
    perform public.save_project_setup_patch((select id from public.projects where code = 'ZZ-2C1-B'), v_version,
      jsonb_build_object('project_type_id', T_NORMAL, 'project_category_detail', null), '{}'::jsonb);
    perform pg_temp.chk(10, '10 PSM FAMILY', 'patch RPC: a valid non-PSM category is accepted',
      (select project_type_id from public.projects where code = 'ZZ-2C1-B') = T_NORMAL);
  exception when others then
    perform pg_temp.chk(10, '10 PSM FAMILY', 'patch RPC: a valid non-PSM category is accepted', false, left(sqlerrm, 120));
  end;

  /* 4. Non-System Admin correction */
  select updated_at into v_version from public.projects where id = P_A;
  perform pg_temp.must_fail(4, '4 NOT ADMIN', 'Project Control Manager cannot correct the Project Type',
    format('select public.correct_project_structure_family(%L, %L, %L, %L, null, %L)',
           P_A, v_version, 'other', T_NORMAL, 'Wrong type'));

  /* 9. Audit table has no direct write path */
  perform pg_temp.must_fail(9, '9 AUDIT WRITE', 'direct INSERT into the audit table is refused',
    format('insert into public.project_classification_corrections (project_id, old_family, new_family, reason) values (%L, %L, %L, %L)',
           P_A, 'psm', 'other', 'bypass'));
end $pcm$;

reset role;

/* 3 / 5 as System Admin */
do $admin$
declare
  P_A uuid := (select id from public.projects where code = 'ZZ-2C1-A');
  T_NORMAL uuid := (select id from public.project_types where code = 'ZZ-2C1-NORMAL');
  T_OTHER uuid := (select id from public.project_types where code = 'ZZ-2C1-OTHER');
  v_version timestamptz;
  v_family text;
  v_type uuid;
  v_detail text;
  v_n int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000a1","role":"authenticated"}';

  select updated_at into v_version from public.projects where id = P_A;

  perform pg_temp.must_fail(5, '5 REASON', 'blank reason is refused',
    format('select public.correct_project_structure_family(%L, %L, %L, %L, null, %L)', P_A, v_version, 'other', T_NORMAL, '   '));
  perform pg_temp.must_fail(5, '5 REASON', 'NULL reason is refused',
    format('select public.correct_project_structure_family(%L, %L, %L, %L, null, null)', P_A, v_version, 'other', T_NORMAL));

  /* PSM -> Other target rules */
  perform pg_temp.must_fail(3, '3 ADMIN CORRECTION', 'PSM -> Other without a category is refused',
    format('select public.correct_project_structure_family(%L, %L, %L, null, null, %L)', P_A, v_version, 'other', 'Why'));
  perform pg_temp.must_fail(3, '3 ADMIN CORRECTION', 'custom-name category without its name is refused',
    format('select public.correct_project_structure_family(%L, %L, %L, %L, null, %L)', P_A, v_version, 'other', T_OTHER, 'Why'));
  perform pg_temp.must_fail(3, '3 ADMIN CORRECTION', 'a stale version is refused',
    format('select public.correct_project_structure_family(%L, %L, %L, %L, null, %L)', P_A, v_version - interval '1 second', 'other', T_NORMAL, 'Why'));

  perform pg_temp.must_fail(10, '10 PSM FAMILY', 'System Admin correction to Other + PSM-family category is refused',
    format('select public.correct_project_structure_family(%L, %L, %L, (select id from public.project_types where code = %L), null, %L)',
           P_A, v_version, 'other', 'PSAIM-ZZ2C1', 'Why'));

  /* PSM -> Other succeeds with category + custom name, fully audited */
  begin
    perform public.correct_project_structure_family(P_A, v_version, 'other', T_OTHER, 'Tank Inspection', 'Created as PSM by mistake');
    select structure_family, project_type_id, project_category_detail
      into v_family, v_type, v_detail from public.projects where id = P_A;
    select count(*) into v_n from public.project_classification_corrections
     where project_id = P_A and old_family = 'psm' and new_family = 'other'
       and old_project_type_id is null and new_project_type_id = T_OTHER
       and new_project_type_name = 'ZZ 2C.1 Other (specify)'
       and new_category_detail = 'Tank Inspection'
       and reason = 'Created as PSM by mistake'
       and corrected_by = '00000000-0000-4000-a000-0000000000a1';
    perform pg_temp.chk(3, '3 ADMIN CORRECTION', 'PSM -> Other with category + custom name succeeds and is audited',
      v_family = 'other' and v_type = T_OTHER and v_detail = 'Tank Inspection' and v_n = 1,
      format('family=%s detail=%s audit_rows=%s', v_family, v_detail, v_n));
  exception when others then
    perform pg_temp.chk(3, '3 ADMIN CORRECTION', 'PSM -> Other with category + custom name succeeds and is audited',
      false, left(sqlerrm, 120));
  end;

  /* Other -> PSM clears category + custom name, fully audited */
  begin
    select updated_at into v_version from public.projects where id = P_A;
    perform public.correct_project_structure_family(P_A, v_version, 'psm', null, null, 'Actually a PSM project');
    select structure_family, project_type_id, project_category_detail
      into v_family, v_type, v_detail from public.projects where id = P_A;
    select count(*) into v_n from public.project_classification_corrections
     where project_id = P_A and old_family = 'other' and new_family = 'psm'
       and old_project_type_id = T_OTHER and new_project_type_id is null
       and old_category_detail = 'Tank Inspection' and new_category_detail is null;
    perform pg_temp.chk(3, '3 ADMIN CORRECTION', 'Other -> PSM clears category and custom name and is audited',
      v_family = 'psm' and v_type is null and v_detail is null and v_n = 1,
      format('family=%s type=%s detail=%s audit_rows=%s', v_family, v_type, v_detail, v_n));
  exception when others then
    perform pg_temp.chk(3, '3 ADMIN CORRECTION', 'Other -> PSM clears category and custom name and is audited',
      false, left(sqlerrm, 120));
  end;

  perform pg_temp.must_fail(3, '3 ADMIN CORRECTION', 'a PSM target carrying a category is refused',
    format('select public.correct_project_structure_family(p.id, p.updated_at, %L, %L, null, %L) from public.projects p where p.code = %L',
           'psm', T_NORMAL, 'x', 'ZZ-2C1-B'));
  perform pg_temp.must_fail(3, '3 ADMIN CORRECTION', 'correction of an unclassified (legacy NULL) project is refused',
    format('select public.correct_project_structure_family(p.id, p.updated_at, %L, null, null, %L) from public.projects p where p.code = %L',
           'psm', 'Legacy', 'ZZ-P0TEST-PRJ'));
  perform pg_temp.must_fail(9, '9 AUDIT IMMUTABLE', 'even a System Admin cannot UPDATE correction history',
    format('update public.project_classification_corrections set reason = %L where project_id = %L', 'rewritten', P_A));
end $admin$;

reset role;

select seq, area, item, verdict from r order by seq, area, item;

select count(*) filter (where verdict like 'PASS%') as pass,
       count(*) filter (where verdict like 'FAIL%') as fail
  from r;

rollback;

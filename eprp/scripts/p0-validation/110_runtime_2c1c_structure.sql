-- Phase 2C.1c-a Other Project Structure — RUNTIME verification. LOCAL MAIN REHEARSAL DATABASE ONLY.
--
-- DRAFT: written for review, NOT YET RUN against any database.
--
-- Proves 20261003000001_project_structure_foundation.sql. Every fixture row is
-- created inside ONE transaction that is rolled back; the final query (after
-- ROLLBACK) proves none survived.
--
-- ------------------------------------------------------------------------
-- TARGET SAFETY — this script FAILS CLOSED before touching anything
-- ------------------------------------------------------------------------
--   ON_ERROR_STOP is ON for the whole script, so any refusal below ends psql
--   with a non-zero exit before BEGIN, and any unexpected error later ends it
--   with the transaction uncommitted (rolled back by the server).
--
--   The run must be invoked EXPLICITLY with two variables:
--     rehearsal_target = eprp-main-local
--     expected_cluster = the PostgreSQL system identifier of the MAIN local
--                        database container (supabase_db_eprp, project_id
--                        "eprp", host port 54322 in supabase/config.toml)
--   and the connection itself must then prove ALL of:
--     1. it is a Unix-socket or loopback connection (never a remote host);
--     2. its cluster's system identifier equals expected_cluster — the only
--        value that tells this container apart from the restore container
--        (supabase_db_eprp-restore-a), which is also local and also named
--        "postgres"; the restore cluster has its own, different identifier;
--     3. the database is "postgres";
--     4. the Phase 2C.1 and 2C.1c objects exist (production has neither);
--     5. the local-only P0 fixtures exist: ZZ-P0TEST-PRJ and the
--        ...a1 system_admin whose email ends in @example.invalid;
--     6. none of this script's own fixtures already exist (no collision).
--   Supplying the variables alone is never enough: production fails 1, 2, 4
--   and 5; the restore database fails 2.
--
-- HOW TO RUN (from eprp/scripts/p0-validation, local stack only)
--   1. Read the MAIN container's identifier (read-only):
--        docker exec supabase_db_eprp psql -U postgres -d postgres -tAc \
--          "select system_identifier from pg_control_system()"
--   2. Run, passing that value:
--        docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--          -v rehearsal_target=eprp-main-local -v expected_cluster=<value from step 1> \
--          -f - < 110_runtime_2c1c_structure.sql
--
-- Requires 00_local_test_identity.sql and 01_setup_test_fixtures.sql first.
--
-- COVERAGE (seq numbers in the results)
--    1 valid 1 level                 13 nested Monthly overlap refused
--    2 valid 4 levels                14 Weekly/Monthly combinations allowed
--    3 fifth level refused           15 PSM project structure write refused
--    4 level gap refused             16 legacy (unclassified) write refused
--    5 wrong-level parent refused    17 non-manager: no read, no write
--    6 cross-project parent refused  18 assigned Project Control Manager allowed
--    7 duplicate active sibling      19 archived-project write refused
--    8 duplicate active code         20 stale level configuration refused
--    9 archived reporting invalid    21 Other -> PSM refused with active units
--   10 archive parent, active child  22 Other -> PSM allowed once all archived
--   11 restore under archived parent 23 rollback leaves no fixture data
--   12 nested Weekly overlap refused
--   24 Project Control Manager refused on an UNASSIGNED project
--   25 multi-row archive / restore in one statement
--   26 multi-row reporting-overlap changes in one statement
--   27 moving an unflagged subtree that holds flagged descendants
--   28 levels change while units exist: append, remove deepest unused,
--      refused middle insertion / in-use removal, label swap
--   29 returned project version advances
--   30 whole-project cascade deletion
--    0 identity and delete restrictions

\set ON_ERROR_STOP on
\set QUIET on
\pset pager off

/* ============================ target guard ================================ */

\if :{?rehearsal_target}
\else
  \echo 'REFUSING TO RUN: pass -v rehearsal_target=eprp-main-local (see HOW TO RUN).'
  do $refuse$ begin raise exception 'REFUSING TO RUN: rehearsal_target is not set.'; end $refuse$;
\endif
\if :{?expected_cluster}
\else
  \echo 'REFUSING TO RUN: pass -v expected_cluster=<system identifier of supabase_db_eprp> (see HOW TO RUN).'
  do $refuse$ begin raise exception 'REFUSING TO RUN: expected_cluster is not set.'; end $refuse$;
\endif

select pg_catalog.set_config('eprp.rehearsal_target', :'rehearsal_target', false),
       pg_catalog.set_config('eprp.expected_cluster', :'expected_cluster', false);

do $guard$
declare
  v_cluster text;
begin
  if current_setting('eprp.rehearsal_target') <> 'eprp-main-local' then
    raise exception 'REFUSING TO RUN: rehearsal_target must be eprp-main-local.';
  end if;

  if inet_server_addr() is not null
     and host(inet_server_addr()) not in ('127.0.0.1', '::1') then
    raise exception 'REFUSING TO RUN: not a Unix-socket or loopback connection (server address %).',
      host(inet_server_addr());
  end if;

  begin
    select system_identifier::text into v_cluster from pg_catalog.pg_control_system();
  exception when others then
    raise exception 'REFUSING TO RUN: cannot read this cluster''s system identifier (%).', sqlerrm;
  end;
  if v_cluster is distinct from current_setting('eprp.expected_cluster') then
    raise exception 'REFUSING TO RUN: this is not the expected main local cluster (connected cluster %).', v_cluster;
  end if;

  if current_database() <> 'postgres' then
    raise exception 'REFUSING TO RUN: unexpected database %.', current_database();
  end if;

  if to_regclass('public.project_structure_nodes') is null
     or to_regclass('public.project_structure_levels') is null
     or to_regclass('public.project_classification_corrections') is null then
    raise exception 'REFUSING TO RUN: the Phase 2C.1 / 2C.1c migrations are not applied here.';
  end if;

  if not exists (select 1 from public.projects where code = 'ZZ-P0TEST-PRJ')
     or not exists (select 1 from auth.users
                     where id = '00000000-0000-4000-a000-0000000000a1'
                       and email like '%@example.invalid') then
    raise exception 'REFUSING TO RUN: local P0 fixtures not found — run 00_local_test_identity.sql and 01_setup_test_fixtures.sql on the MAIN local database first.';
  end if;

  if exists (select 1 from public.projects where code like 'ZZ-2C1C-%')
     or exists (select 1 from public.project_types where code = 'ZZ-2C1C-CAT')
     or exists (select 1 from public.contacts where name like 'ZZ-P0TEST 2C1C %')
     or exists (select 1 from auth.users where id in ('00000000-0000-4000-a000-0000000110b1',
                                                      '00000000-0000-4000-a000-0000000110c1'))
     or exists (select 1 from public.profiles where id in ('00000000-0000-4000-a000-0000000110b1',
                                                           '00000000-0000-4000-a000-0000000110c1')) then
    raise exception 'REFUSING TO RUN: 2C.1c fixture rows already exist; investigate before rehearsing.';
  end if;
end;
$guard$;

/* ================================ run ===================================== */

begin;

create temp table r(seq int, area text, item text, verdict text) on commit drop;
-- Fixture ids captured as postgres, so later identity switches never depend
-- on what the switched account can see.
create temp table fx(code text primary key, id uuid not null) on commit drop;
grant all on r to authenticated;
grant select on fx to authenticated;
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

-- Refused with this exact [TAG] in the message, or this exact SQLSTATE.
create or replace function pg_temp.must_fail_tag(
  p_seq int, p_area text, p_item text, p_sql text, p_tag text
) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp.chk(p_seq, p_area, p_item, false, 'statement was ACCEPTED');
exception when others then
  perform pg_temp.chk(p_seq, p_area, p_item,
    position(p_tag in sqlerrm) > 0 or sqlstate = p_tag,
    sqlstate || ' ' || left(sqlerrm, 90));
end $$;

-- Accepted (the statement runs and persists in this transaction).
create or replace function pg_temp.must_pass(
  p_seq int, p_area text, p_item text, p_sql text
) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp.chk(p_seq, p_area, p_item, true);
exception when others then
  perform pg_temp.chk(p_seq, p_area, p_item, false, sqlstate || ' ' || left(sqlerrm, 110));
end $$;

-- Runs a statement and reports how many rows it changed (RLS-hidden rows are
-- simply not changed, which is the refusal for UPDATE / DELETE).
create or replace function pg_temp.rows_changed(p_sql text) returns integer language plpgsql as $$
declare v integer;
begin
  execute p_sql;
  get diagnostics v = row_count;
  return v;
end $$;

create or replace function pg_temp.pid(p_code text) returns uuid language sql as $$
  select id from fx where code = p_code
$$;
create or replace function pg_temp.nid(p_project text, p_code text) returns uuid language sql as $$
  select n.id from public.project_structure_nodes n
   where n.project_id = pg_temp.pid(p_project) and n.code = p_code
$$;
create or replace function pg_temp.lid(p_project text, p_level int) returns uuid language sql as $$
  select l.id from public.project_structure_levels l
   where l.project_id = pg_temp.pid(p_project) and l.level_number = p_level
$$;

-- Error codes used below.
--   42501  RLS / authority refusal          23505  unique violation
--   23503  foreign key violation            23514  check / tagged rule violation

/* ========================= fixtures (as postgres) ========================= */

do $fix$
declare
  v_source uuid;
  v_type   uuid;
begin
  select id into v_source from public.projects where code = 'ZZ-P0TEST-PRJ';

  insert into public.project_types (name, code)
  values ('ZZ 2C.1c Category', 'ZZ-2C1C-CAT')
  returning id into v_type;

  -- No fixed responsibility holders (see 108): nothing here needs one.
  --   A, B, C, D, ARC: Other projects assigned to the Project Control Manager.
  --   U: an Other project the manager is NOT assigned to.
  --   PSM: a PSM project. LEG: unclassified (legacy).
  insert into public.projects (code, name, client_id, planned_start_date, planned_finish_date,
                               status, structure_family, project_type_id)
  select 'ZZ-2C1C-' || v.s, 'ZZ 2C.1c ' || v.s, p.client_id,
         p.planned_start_date, p.planned_finish_date, 'active', v.family,
         case when v.family = 'other' then v_type end
    from public.projects p,
         (values ('A', 'other'), ('B', 'other'), ('C', 'other'), ('D', 'other'),
                 ('U', 'other'), ('ARC', 'other'), ('PSM', 'psm'), ('LEG', null)) v(s, family)
   where p.id = v_source;

  insert into fx (code, id)
  select code, id from public.projects where code like 'ZZ-2C1C-%';

  -- b1: Project Control Manager on every fixture project EXCEPT U.
  -- c1: an authenticated account with no assignment and no portfolio read.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
    ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-0000000110b1',
     'authenticated', 'authenticated', 'p0test.2c1c-pcm@example.invalid',
     'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-0000000110c1',
     'authenticated', 'authenticated', 'p0test.2c1c-outsider@example.invalid',
     'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

  insert into public.contacts (name, email) values
    ('ZZ-P0TEST 2C1C PCM', 'p0test.2c1c-pcm@example.invalid'),
    ('ZZ-P0TEST 2C1C OUTSIDER', 'p0test.2c1c-outsider@example.invalid');

  insert into public.project_contacts (project_id, contact_id, role)
  select p.id, c.id, 'project_control_manager'
    from public.projects p, public.contacts c
   where p.code like 'ZZ-2C1C-%' and p.code <> 'ZZ-2C1C-U'
     and c.name = 'ZZ-P0TEST 2C1C PCM';

  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select '00000000-0000-4000-a000-0000000110b1', 'p0test.2c1c-pcm@example.invalid',
         'ZZ-P0TEST 2C1C PCM', 'viewer', c.id, true
    from public.contacts c where c.name = 'ZZ-P0TEST 2C1C PCM';
  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select '00000000-0000-4000-a000-0000000110c1', 'p0test.2c1c-outsider@example.invalid',
         'ZZ-P0TEST 2C1C OUTSIDER', 'viewer', c.id, true
    from public.contacts c where c.name = 'ZZ-P0TEST 2C1C OUTSIDER';

  -- U gets one level and one unit (as postgres) so refusals there are about
  -- authority, not about a missing level.
  insert into public.project_structure_levels (project_id, level_number, singular_label, plural_label)
  values (pg_temp.pid('ZZ-2C1C-U'), 1, 'Package', 'Packages');
  insert into public.project_structure_nodes (project_id, level_number, name, code)
  values (pg_temp.pid('ZZ-2C1C-U'), 1, 'Unassigned package', 'ZZ-U1');
end;
$fix$;

/* ==================== table rules (as postgres: RLS bypassed) ============= */

do $t$
declare
  A uuid := pg_temp.pid('ZZ-2C1C-A');
  B uuid := pg_temp.pid('ZZ-2C1C-B');
begin
  /* 1 / 2. Valid structures */
  perform pg_temp.must_pass(1, '01 ONE LEVEL', 'level 1 alone is accepted',
    format($q$insert into public.project_structure_levels (project_id, level_number, singular_label, plural_label)
              values (%L, 1, 'Package', 'Packages')$q$, A));
  perform pg_temp.must_pass(2, '02 FOUR LEVELS', 'levels 2..4 are accepted in one statement',
    format($q$insert into public.project_structure_levels (project_id, level_number, singular_label, plural_label)
              values (%1$L, 2, 'Area', 'Areas'), (%1$L, 3, 'Discipline', 'Disciplines'), (%1$L, 4, 'Team', 'Teams')$q$, A));
  perform pg_temp.chk(2, '02 FOUR LEVELS', 'the project now has exactly levels 1..4',
    (select array_agg(level_number order by level_number) from public.project_structure_levels where project_id = A) = array[1, 2, 3, 4]);

  /* 3. Fifth level */
  perform pg_temp.must_fail_tag(3, '03 MAX FOUR', 'level 5 is refused',
    format($q$insert into public.project_structure_levels (project_id, level_number, singular_label, plural_label)
              values (%L, 5, 'Crew', 'Crews')$q$, A), '23514');

  /* 4. Gaps and labels */
  perform pg_temp.must_fail_tag(4, '04 NO GAPS', 'level 2 without level 1 is refused',
    format($q$insert into public.project_structure_levels (project_id, level_number, singular_label, plural_label)
              values (%L, 2, 'Area', 'Areas')$q$, B), '[LEVEL_GAP]');
  perform pg_temp.must_fail_tag(4, '04 NO GAPS', 'removing a middle level is refused',
    format('delete from public.project_structure_levels where project_id = %L and level_number = 2', A), '[LEVEL_GAP]');
  perform pg_temp.must_fail_tag(4, '04 NO GAPS', 'a duplicate level label (case-insensitive) is refused',
    format('update public.project_structure_levels set singular_label = %L where project_id = %L and level_number = 2', 'PACKAGE', A), '23505');
  perform pg_temp.must_fail_tag(4, '04 NO GAPS', 'an untrimmed label is refused',
    format('update public.project_structure_levels set plural_label = %L where project_id = %L and level_number = 2', ' Areas', A), '23514');

  /* Units on A: P1 > A1 > D1 > E1, P2 > A2 */
  perform pg_temp.must_pass(2, '02 FOUR LEVELS', 'level-1 units are accepted',
    format($q$insert into public.project_structure_nodes (project_id, level_number, name, code)
              values (%1$L, 1, 'Package 1', 'ZZ-P1'), (%1$L, 1, 'Package 2', 'ZZ-P2')$q$, A));
  perform pg_temp.must_pass(2, '02 FOUR LEVELS', 'level-2 units are accepted',
    format($q$insert into public.project_structure_nodes (project_id, level_number, parent_id, name, code)
              values (%1$L, 2, %2$L, 'Area 1', 'ZZ-A1'), (%1$L, 2, %3$L, 'Area 2', 'ZZ-A2')$q$,
           A, pg_temp.nid('ZZ-2C1C-A', 'ZZ-P1'), pg_temp.nid('ZZ-2C1C-A', 'ZZ-P2')));
  perform pg_temp.must_pass(2, '02 FOUR LEVELS', 'a level-3 unit is accepted',
    format($q$insert into public.project_structure_nodes (project_id, level_number, parent_id, name, code)
              values (%L, 3, %L, 'Discipline 1', 'ZZ-D1')$q$, A, pg_temp.nid('ZZ-2C1C-A', 'ZZ-A1')));
  perform pg_temp.must_pass(2, '02 FOUR LEVELS', 'a level-4 unit is accepted',
    format($q$insert into public.project_structure_nodes (project_id, level_number, parent_id, name, code)
              values (%L, 4, %L, 'Team 1', 'ZZ-E1')$q$, A, pg_temp.nid('ZZ-2C1C-A', 'ZZ-D1')));

  /* 0. Identity and delete rules */
  perform pg_temp.must_fail_tag(0, '00 IDENTITY', 'a level''s number cannot change',
    format('update public.project_structure_levels set level_number = 3 where id = %L', pg_temp.lid('ZZ-2C1C-A', 4)), '[LEVEL_IMMUTABLE]');
  perform pg_temp.must_fail_tag(0, '00 IDENTITY', 'a unit''s level cannot change',
    format('update public.project_structure_nodes set level_number = 2 where id = %L', pg_temp.nid('ZZ-2C1C-A', 'ZZ-P2')), '[LEVEL_IMMUTABLE]');
  perform pg_temp.must_fail_tag(0, '00 IDENTITY', 'a unit with children cannot be deleted',
    format('delete from public.project_structure_nodes where id = %L', pg_temp.nid('ZZ-2C1C-A', 'ZZ-D1')), '23503');
  perform pg_temp.must_fail_tag(0, '00 IDENTITY', 'a level that has units cannot be removed',
    format('delete from public.project_structure_levels where project_id = %L and level_number = 4', A), '23503');

  /* 5. Wrong-level parent */
  perform pg_temp.must_fail_tag(5, '05 PARENT LEVEL', 'a level-3 unit under a level-1 parent is refused',
    format($q$insert into public.project_structure_nodes (project_id, level_number, parent_id, name)
              values (%L, 3, %L, 'Skips a level')$q$, A, pg_temp.nid('ZZ-2C1C-A', 'ZZ-P1')), '[PARENT_LEVEL]');
  perform pg_temp.must_fail_tag(5, '05 PARENT LEVEL', 'a level-1 unit with a parent is refused',
    format($q$insert into public.project_structure_nodes (project_id, level_number, parent_id, name)
              values (%L, 1, %L, 'Root with parent')$q$, A, pg_temp.nid('ZZ-2C1C-A', 'ZZ-P1')), '23514');
  perform pg_temp.must_fail_tag(5, '05 PARENT LEVEL', 'a level-2 unit without a parent is refused',
    format($q$insert into public.project_structure_nodes (project_id, level_number, name)
              values (%L, 2, 'Orphan area')$q$, A), '23514');
  perform pg_temp.must_fail_tag(5, '05 PARENT LEVEL', 'moving a unit under a parent two levels up is refused',
    format('update public.project_structure_nodes set parent_id = %L where id = %L',
           pg_temp.nid('ZZ-2C1C-A', 'ZZ-P1'), pg_temp.nid('ZZ-2C1C-A', 'ZZ-D1')), '[PARENT_LEVEL]');
  perform pg_temp.must_fail_tag(5, '05 PARENT LEVEL', 'a unit at a level the project does not define is refused',
    format($q$insert into public.project_structure_nodes (project_id, level_number, name) values (%L, 1, 'No levels')$q$,
           pg_temp.pid('ZZ-2C1C-C')), '23503');

  /* 6. Cross-project parent */
  insert into public.project_structure_levels (project_id, level_number, singular_label, plural_label)
  values (B, 1, 'Plant', 'Plants'), (B, 2, 'Unit', 'Units');
  insert into public.project_structure_nodes (project_id, level_number, name, code) values (B, 1, 'Plant B', 'ZZ-BP1');
  insert into public.project_structure_nodes (project_id, level_number, parent_id, name, code)
  values (B, 2, pg_temp.nid('ZZ-2C1C-B', 'ZZ-BP1'), 'Unit B', 'ZZ-BU1');
  perform pg_temp.must_fail_tag(6, '06 SAME PROJECT', 'a parent from another project is refused',
    format($q$insert into public.project_structure_nodes (project_id, level_number, parent_id, name)
              values (%L, 2, %L, 'Cross-project area')$q$, A, pg_temp.nid('ZZ-2C1C-B', 'ZZ-BP1')), '23503');

  /* 7. Duplicate active sibling names */
  perform pg_temp.must_fail_tag(7, '07 SIBLING NAME', 'a second root named "package 1" is refused',
    format($q$insert into public.project_structure_nodes (project_id, level_number, name) values (%L, 1, 'package 1')$q$, A), '23505');
  perform pg_temp.must_pass(7, '07 SIBLING NAME', 'the same name under a different parent is accepted',
    format($q$insert into public.project_structure_nodes (project_id, level_number, parent_id, name)
              values (%L, 2, %L, 'Area 1')$q$, A, pg_temp.nid('ZZ-2C1C-A', 'ZZ-P2')));

  /* 8. Duplicate active project codes */
  perform pg_temp.must_fail_tag(8, '08 PROJECT CODE', 'code "zz-p1" (case-insensitive) is refused at another level',
    format($q$insert into public.project_structure_nodes (project_id, level_number, parent_id, name, code)
              values (%L, 2, %L, 'Area X', 'zz-p1')$q$, A, pg_temp.nid('ZZ-2C1C-A', 'ZZ-P1')), '23505');
  perform pg_temp.must_pass(8, '08 PROJECT CODE', 'the same code in another project is accepted',
    format($q$insert into public.project_structure_nodes (project_id, level_number, name, code) values (%L, 1, 'Plant P1', 'ZZ-P1')$q$, B));

  /* 9. Archived units carry no reporting flags */
  perform pg_temp.must_fail_tag(9, '09 ARCHIVED FLAGS', 'archiving while keeping Weekly is refused',
    format('update public.project_structure_nodes set archived_at = now(), weekly_reporting_required = true where id = %L',
           pg_temp.nid('ZZ-2C1C-A', 'ZZ-E1')), '23514');

  /* 10. Archive a parent that still has an active child */
  perform pg_temp.must_fail_tag(10, '10 ARCHIVE ORDER', 'archiving Area 1 while Discipline 1 is active is refused',
    format('update public.project_structure_nodes set archived_at = now() where id = %L', pg_temp.nid('ZZ-2C1C-A', 'ZZ-A1')), '[ACTIVE_CHILDREN]');

  /* 11. Restore under an archived parent */
  perform pg_temp.must_pass(11, '11 RESTORE ORDER', 'archiving the leaf Team 1 is accepted',
    format('update public.project_structure_nodes set archived_at = now() where id = %L', pg_temp.nid('ZZ-2C1C-A', 'ZZ-E1')));
  perform pg_temp.must_pass(11, '11 RESTORE ORDER', 'then archiving its parent Discipline 1 is accepted',
    format('update public.project_structure_nodes set archived_at = now() where id = %L', pg_temp.nid('ZZ-2C1C-A', 'ZZ-D1')));
  perform pg_temp.must_fail_tag(11, '11 RESTORE ORDER', 'restoring Team 1 under archived Discipline 1 is refused',
    format('update public.project_structure_nodes set archived_at = null where id = %L', pg_temp.nid('ZZ-2C1C-A', 'ZZ-E1')), '[PARENT_ARCHIVED]');
  perform pg_temp.must_fail_tag(11, '11 RESTORE ORDER', 'adding an active unit under an archived parent is refused',
    format($q$insert into public.project_structure_nodes (project_id, level_number, parent_id, name)
              values (%L, 4, %L, 'Team 2')$q$, A, pg_temp.nid('ZZ-2C1C-A', 'ZZ-D1')), '[PARENT_ARCHIVED]');

  /* 25. Multi-row restore and archive in one statement */
  perform pg_temp.must_pass(25, '25 MULTI-ROW', 'restoring Discipline 1 and Team 1 in one statement is accepted',
    format('update public.project_structure_nodes set archived_at = null where id in (%L, %L)',
           pg_temp.nid('ZZ-2C1C-A', 'ZZ-D1'), pg_temp.nid('ZZ-2C1C-A', 'ZZ-E1')));
  perform pg_temp.chk(25, '25 MULTI-ROW', 'both are active again',
    (select count(*) from public.project_structure_nodes
      where id in (pg_temp.nid('ZZ-2C1C-A', 'ZZ-D1'), pg_temp.nid('ZZ-2C1C-A', 'ZZ-E1')) and archived_at is null) = 2);
  perform pg_temp.must_fail_tag(25, '25 MULTI-ROW', 'archiving Area 1 and Discipline 1 but not Team 1 in one statement is refused',
    format('update public.project_structure_nodes set archived_at = now() where id in (%L, %L)',
           pg_temp.nid('ZZ-2C1C-A', 'ZZ-A1'), pg_temp.nid('ZZ-2C1C-A', 'ZZ-D1')), '[ACTIVE_CHILDREN]');

  /* 12. Nested Weekly overlap */
  perform pg_temp.must_pass(12, '12 WEEKLY OVERLAP', 'Package 1 owes Weekly',
    format('update public.project_structure_nodes set weekly_reporting_required = true where id = %L', pg_temp.nid('ZZ-2C1C-A', 'ZZ-P1')));
  perform pg_temp.must_fail_tag(12, '12 WEEKLY OVERLAP', 'its child Area 1 owing Weekly too is refused',
    format('update public.project_structure_nodes set weekly_reporting_required = true where id = %L', pg_temp.nid('ZZ-2C1C-A', 'ZZ-A1')), '[REPORTING_OVERLAP]');
  perform pg_temp.must_fail_tag(12, '12 WEEKLY OVERLAP', 'its grandchild Discipline 1 owing Weekly too is refused',
    format('update public.project_structure_nodes set weekly_reporting_required = true where id = %L', pg_temp.nid('ZZ-2C1C-A', 'ZZ-D1')), '[REPORTING_OVERLAP]');
  perform pg_temp.must_pass(12, '12 WEEKLY OVERLAP', 'Area 2 (other branch) owing Weekly is accepted',
    format('update public.project_structure_nodes set weekly_reporting_required = true where id = %L', pg_temp.nid('ZZ-2C1C-A', 'ZZ-A2')));
  perform pg_temp.must_fail_tag(12, '12 WEEKLY OVERLAP', 'then Package 2 (ancestor of Area 2) owing Weekly is refused',
    format('update public.project_structure_nodes set weekly_reporting_required = true where id = %L', pg_temp.nid('ZZ-2C1C-A', 'ZZ-P2')), '[REPORTING_OVERLAP]');

  /* 26. Multi-row reporting changes in one statement */
  perform pg_temp.must_fail_tag(26, '26 MULTI-ROW FLAGS', 'flagging Area 1 and its child Discipline 1 for Monthly together is refused',
    format('update public.project_structure_nodes set monthly_reporting_required = true where id in (%L, %L)',
           pg_temp.nid('ZZ-2C1C-A', 'ZZ-A1'), pg_temp.nid('ZZ-2C1C-A', 'ZZ-D1')), '[REPORTING_OVERLAP]');
  perform pg_temp.must_pass(26, '26 MULTI-ROW FLAGS', 'moving Weekly from Package 1 down to Area 1 in one statement is accepted',
    format('update public.project_structure_nodes set weekly_reporting_required = (id = %L) where id in (%L, %L)',
           pg_temp.nid('ZZ-2C1C-A', 'ZZ-A1'), pg_temp.nid('ZZ-2C1C-A', 'ZZ-P1'), pg_temp.nid('ZZ-2C1C-A', 'ZZ-A1')));
  perform pg_temp.must_pass(26, '26 MULTI-ROW FLAGS', 'and moving it back up in one statement is accepted',
    format('update public.project_structure_nodes set weekly_reporting_required = (id = %L) where id in (%L, %L)',
           pg_temp.nid('ZZ-2C1C-A', 'ZZ-P1'), pg_temp.nid('ZZ-2C1C-A', 'ZZ-P1'), pg_temp.nid('ZZ-2C1C-A', 'ZZ-A1')));

  /* 13. Nested Monthly overlap */
  perform pg_temp.must_pass(13, '13 MONTHLY OVERLAP', 'Discipline 1 owes Monthly',
    format('update public.project_structure_nodes set monthly_reporting_required = true where id = %L', pg_temp.nid('ZZ-2C1C-A', 'ZZ-D1')));
  perform pg_temp.must_fail_tag(13, '13 MONTHLY OVERLAP', 'its ancestor Package 1 owing Monthly too is refused',
    format('update public.project_structure_nodes set monthly_reporting_required = true where id = %L', pg_temp.nid('ZZ-2C1C-A', 'ZZ-P1')), '[REPORTING_OVERLAP]');
  perform pg_temp.must_fail_tag(13, '13 MONTHLY OVERLAP', 'its child Team 1 owing Monthly too is refused',
    format('update public.project_structure_nodes set monthly_reporting_required = true where id = %L', pg_temp.nid('ZZ-2C1C-A', 'ZZ-E1')), '[REPORTING_OVERLAP]');

  /* 14. Combinations: Weekly only, Monthly only, both, neither; different levels */
  perform pg_temp.chk(14, '14 COMBINATIONS', 'Package 1 Weekly-only (L1) and Discipline 1 Monthly-only (L3) coexist on one branch',
    (select weekly_reporting_required and not monthly_reporting_required from public.project_structure_nodes where id = pg_temp.nid('ZZ-2C1C-A', 'ZZ-P1'))
    and (select monthly_reporting_required and not weekly_reporting_required from public.project_structure_nodes where id = pg_temp.nid('ZZ-2C1C-A', 'ZZ-D1')));
  perform pg_temp.must_pass(14, '14 COMBINATIONS', 'Area 2 owing both Weekly and Monthly is accepted',
    format('update public.project_structure_nodes set monthly_reporting_required = true where id = %L', pg_temp.nid('ZZ-2C1C-A', 'ZZ-A2')));
  perform pg_temp.chk(14, '14 COMBINATIONS', 'Area 1 owes neither',
    (select not weekly_reporting_required and not monthly_reporting_required from public.project_structure_nodes where id = pg_temp.nid('ZZ-2C1C-A', 'ZZ-A1')));
  perform pg_temp.must_fail_tag(14, '14 COMBINATIONS', 'moving Weekly Area 2 under Weekly Package 1 is refused',
    format('update public.project_structure_nodes set parent_id = %L where id = %L',
           pg_temp.nid('ZZ-2C1C-A', 'ZZ-P1'), pg_temp.nid('ZZ-2C1C-A', 'ZZ-A2')), '[REPORTING_OVERLAP]');

  /* 27. Moving an UNFLAGGED unit whose descendant is flagged */
  insert into public.project_structure_nodes (project_id, level_number, name, code)
  values (A, 1, 'Package 5', 'ZZ-P5');
  insert into public.project_structure_nodes (project_id, level_number, parent_id, name, code)
  values (A, 2, pg_temp.nid('ZZ-2C1C-A', 'ZZ-P5'), 'Area 6', 'ZZ-A6');
  insert into public.project_structure_nodes (project_id, level_number, parent_id, name, code, weekly_reporting_required)
  values (A, 3, pg_temp.nid('ZZ-2C1C-A', 'ZZ-A6'), 'Discipline 6', 'ZZ-D6', true);
  perform pg_temp.must_fail_tag(27, '27 SUBTREE MOVE', 'moving unflagged Area 6 (Weekly child) under Weekly Package 1 is refused',
    format('update public.project_structure_nodes set parent_id = %L where id = %L',
           pg_temp.nid('ZZ-2C1C-A', 'ZZ-P1'), pg_temp.nid('ZZ-2C1C-A', 'ZZ-A6')), '[REPORTING_OVERLAP]');
  perform pg_temp.must_pass(27, '27 SUBTREE MOVE', 'moving Area 6 under unflagged Package 2 is accepted',
    format('update public.project_structure_nodes set parent_id = %L where id = %L',
           pg_temp.nid('ZZ-2C1C-A', 'ZZ-P2'), pg_temp.nid('ZZ-2C1C-A', 'ZZ-A6')));

  /* 15 / 16. Structure only on Other projects */
  perform pg_temp.must_fail_tag(15, '15 PSM PROJECT', 'a level on a PSM project is refused',
    format($q$insert into public.project_structure_levels (project_id, level_number, singular_label, plural_label)
              values (%L, 1, 'Package', 'Packages')$q$, pg_temp.pid('ZZ-2C1C-PSM')), '[NOT_OTHER]');
  perform pg_temp.must_fail_tag(16, '16 LEGACY PROJECT', 'a level on an unclassified project is refused',
    format($q$insert into public.project_structure_levels (project_id, level_number, singular_label, plural_label)
              values (%L, 1, 'Package', 'Packages')$q$, pg_temp.pid('ZZ-2C1C-LEG')), '[NOT_OTHER]');

  /* 19. Archived project is read-only */
  insert into public.project_structure_levels (project_id, level_number, singular_label, plural_label)
  values (pg_temp.pid('ZZ-2C1C-ARC'), 1, 'Phase', 'Phases');
  update public.projects set status = 'archived' where id = pg_temp.pid('ZZ-2C1C-ARC');
  perform pg_temp.must_fail_tag(19, '19 ARCHIVED PROJECT', 'adding a unit to an archived project is refused',
    format($q$insert into public.project_structure_nodes (project_id, level_number, name) values (%L, 1, 'Phase 1')$q$,
           pg_temp.pid('ZZ-2C1C-ARC')), '[PROJECT_ARCHIVED]');
  perform pg_temp.must_fail_tag(19, '19 ARCHIVED PROJECT', 'renaming a level of an archived project is refused',
    format('update public.project_structure_levels set singular_label = %L where project_id = %L', 'Stage', pg_temp.pid('ZZ-2C1C-ARC')), '[PROJECT_ARCHIVED]');
end $t$;

/* ================= 17. a non-manager account (no project access) ========== */

do $outsider$
declare
  -- Resolved BEFORE the identity switch (DECLARE runs first).
  A  uuid := pg_temp.pid('ZZ-2C1C-A');
  P1 uuid := pg_temp.nid('ZZ-2C1C-A', 'ZZ-P1');
  L1 uuid := pg_temp.lid('ZZ-2C1C-A', 1);
  v_version timestamptz := (select updated_at from public.projects where id = pg_temp.pid('ZZ-2C1C-A'));
  v_rows integer;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000110c1","role":"authenticated"}';

  perform pg_temp.chk(17, '17 NOT A MANAGER', 'the project itself is not visible to this account',
    not exists (select 1 from public.projects where id = A));
  perform pg_temp.chk(17, '17 NOT A MANAGER', 'so its structure is not visible either (read follows project visibility)',
    not exists (select 1 from public.project_structure_nodes where project_id = A)
    and not exists (select 1 from public.project_structure_levels where project_id = A));
  perform pg_temp.must_fail_tag(17, '17 NOT A MANAGER', 'inserting a unit is refused by RLS',
    format($q$insert into public.project_structure_nodes (project_id, level_number, name) values (%L, 1, 'Outsider package')$q$, A),
    '42501');
  v_rows := pg_temp.rows_changed(format('update public.project_structure_nodes set name = %L where id = %L', 'Hijacked', P1));
  perform pg_temp.chk(17, '17 NOT A MANAGER', 'updating a unit changes no row', v_rows = 0, format('rows=%s', v_rows));
  v_rows := pg_temp.rows_changed(format('delete from public.project_structure_levels where id = %L', L1));
  perform pg_temp.chk(17, '17 NOT A MANAGER', 'deleting a level changes no row', v_rows = 0, format('rows=%s', v_rows));
  perform pg_temp.must_fail_tag(17, '17 NOT A MANAGER', 'the level RPC is refused',
    format('select public.configure_project_structure_levels(%L, %L, %L::jsonb)', A, v_version,
           '[{"level_number":1,"singular_label":"X","plural_label":"Xs"}]'), '[NOT_AUTHORIZED]');
end $outsider$;

reset role;

do $outsider_check$
begin
  perform pg_temp.chk(17, '17 NOT A MANAGER', 'nothing was changed (verified as postgres)',
    (select name from public.project_structure_nodes where id = pg_temp.nid('ZZ-2C1C-A', 'ZZ-P1')) = 'Package 1'
    and pg_temp.lid('ZZ-2C1C-A', 1) is not null);
end $outsider_check$;

/* ===== 18 / 20 / 24 / 28 / 29 as the assigned Project Control Manager ===== */

do $pcm$
declare
  -- Resolved BEFORE the identity switch.
  A  uuid := pg_temp.pid('ZZ-2C1C-A');
  C  uuid := pg_temp.pid('ZZ-2C1C-C');
  D  uuid := pg_temp.pid('ZZ-2C1C-D');
  U  uuid := pg_temp.pid('ZZ-2C1C-U');
  U1 uuid := pg_temp.nid('ZZ-2C1C-U', 'ZZ-U1');
  l1 text := pg_temp.lid('ZZ-2C1C-A', 1)::text;
  l2 text := pg_temp.lid('ZZ-2C1C-A', 2)::text;
  l3 text := pg_temp.lid('ZZ-2C1C-A', 3)::text;
  l4 text := pg_temp.lid('ZZ-2C1C-A', 4)::text;
  v_u_version timestamptz := (select updated_at from public.projects where id = pg_temp.pid('ZZ-2C1C-U'));
  v_version  timestamptz;
  v_returned timestamptz;
  v_labels   text[];
  v_rows     integer;
  d1 text;
  d2 text;
  d3 text;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000110b1","role":"authenticated"}';

  /* 18. Own project: read, direct writes and the RPC are allowed */
  perform pg_temp.chk(18, '18 PCM ALLOWED', 'the manager can read its own project''s structure',
    (select count(*) from public.project_structure_nodes where project_id = A) > 0);
  perform pg_temp.must_pass(18, '18 PCM ALLOWED', 'adding a unit on its own project is accepted',
    format($q$insert into public.project_structure_nodes (project_id, level_number, name, code) values (%L, 1, 'Package 3', 'ZZ-P3')$q$, A));

  /* 24. The same manager on a project it is NOT assigned to */
  perform pg_temp.chk(24, '24 PCM UNASSIGNED', 'the unassigned project''s structure is not visible',
    not exists (select 1 from public.project_structure_nodes where project_id = U));
  perform pg_temp.must_fail_tag(24, '24 PCM UNASSIGNED', 'inserting a unit there is refused by RLS',
    format($q$insert into public.project_structure_nodes (project_id, level_number, name) values (%L, 1, 'Not mine')$q$, U), '42501');
  v_rows := pg_temp.rows_changed(format('update public.project_structure_nodes set name = %L where id = %L', 'Not mine', U1));
  perform pg_temp.chk(24, '24 PCM UNASSIGNED', 'updating a unit there changes no row', v_rows = 0, format('rows=%s', v_rows));
  perform pg_temp.must_fail_tag(24, '24 PCM UNASSIGNED', 'the level RPC there is refused',
    format('select public.configure_project_structure_levels(%L, %L, %L::jsonb)', U, v_u_version,
           '[{"level_number":1,"singular_label":"Zone","plural_label":"Zones"}]'), '[NOT_AUTHORIZED]');

  /* Level RPC with no units yet (project C): positional */
  select updated_at into v_version from public.projects where id = C;
  perform pg_temp.must_pass(1, '01 ONE LEVEL', 'RPC: one level on an empty structure',
    format('select public.configure_project_structure_levels(%L, %L, %L::jsonb)', C, v_version,
           '[{"level_number":1,"singular_label":"Work Package","plural_label":"Work Packages"}]'));
  select updated_at into v_version from public.projects where id = C;
  perform pg_temp.must_pass(2, '02 FOUR LEVELS', 'RPC: four levels at once',
    format('select public.configure_project_structure_levels(%L, %L, %L::jsonb)', C, v_version,
           '[{"level_number":1,"singular_label":"Phase","plural_label":"Phases"},{"level_number":2,"singular_label":"Work Package","plural_label":"Work Packages"},{"level_number":3,"singular_label":"Team","plural_label":"Teams"},{"level_number":4,"singular_label":"Crew","plural_label":"Crews"}]'));
  select updated_at into v_version from public.projects where id = C;
  perform pg_temp.must_pass(2, '02 FOUR LEVELS', 'RPC: shrink to two levels while no units exist',
    format('select public.configure_project_structure_levels(%L, %L, %L::jsonb)', C, v_version,
           '[{"level_number":1,"singular_label":"Phase","plural_label":"Phases"},{"level_number":2,"singular_label":"Team","plural_label":"Teams"}]'));
  perform pg_temp.chk(2, '02 FOUR LEVELS', 'RPC result: Phase / Team',
    (select array_agg(singular_label order by level_number) from public.project_structure_levels where project_id = C) = array['Phase', 'Team']);

  select updated_at into v_version from public.projects where id = C;
  perform pg_temp.must_fail_tag(3, '03 MAX FOUR', 'RPC: five levels are refused',
    format('select public.configure_project_structure_levels(%L, %L, %L::jsonb)', C, v_version,
           '[{"level_number":1,"singular_label":"a","plural_label":"as"},{"level_number":2,"singular_label":"b","plural_label":"bs"},{"level_number":3,"singular_label":"c","plural_label":"cs"},{"level_number":4,"singular_label":"d","plural_label":"ds"},{"level_number":5,"singular_label":"e","plural_label":"es"}]'),
    '[LEVEL_LIMIT]');
  perform pg_temp.must_fail_tag(4, '04 NO GAPS', 'RPC: levels 1 and 3 are refused',
    format('select public.configure_project_structure_levels(%L, %L, %L::jsonb)', C, v_version,
           '[{"level_number":1,"singular_label":"a","plural_label":"as"},{"level_number":3,"singular_label":"c","plural_label":"cs"}]'),
    '[LEVEL_GAP]');
  perform pg_temp.must_fail_tag(4, '04 NO GAPS', 'RPC: duplicate labels are refused',
    format('select public.configure_project_structure_levels(%L, %L, %L::jsonb)', C, v_version,
           '[{"level_number":1,"singular_label":"Team","plural_label":"Teams"},{"level_number":2,"singular_label":"team","plural_label":"Crews"}]'),
    '[DUPLICATE_LABEL]');
  perform pg_temp.must_fail_tag(4, '04 NO GAPS', 'RPC: an empty level list is refused',
    format('select public.configure_project_structure_levels(%L, %L, %L::jsonb)', C, v_version, '[]'), '[INVALID_LEVELS]');
  perform pg_temp.must_fail_tag(4, '04 NO GAPS', 'RPC: a non-string label is refused (no coercion)',
    format('select public.configure_project_structure_levels(%L, %L, %L::jsonb)', C, v_version,
           '[{"level_number":1,"singular_label":123,"plural_label":"Teams"}]'), '[INVALID_LEVELS]');

  /* 20. Stale version */
  perform pg_temp.must_fail_tag(20, '20 STALE', 'RPC with an older project version is refused',
    format('select public.configure_project_structure_levels(%L, %L, %L::jsonb)', C, v_version - interval '1 second',
           '[{"level_number":1,"singular_label":"Phase","plural_label":"Phases"}]'), '[STALE]');

  /* 28 / 29. Levels while units exist (project D) */
  select updated_at into v_version from public.projects where id = D;
  begin
    v_returned := public.configure_project_structure_levels(D, v_version,
      '[{"level_number":1,"singular_label":"Plant","plural_label":"Plants"},{"level_number":2,"singular_label":"Unit","plural_label":"Units"}]'::jsonb);
    perform pg_temp.chk(29, '29 VERSION', 'RPC returns an advanced project version equal to the stored one',
      v_returned > v_version and v_returned = (select updated_at from public.projects where id = D),
      format('before=%s returned=%s', v_version, v_returned));
  exception when others then
    perform pg_temp.chk(29, '29 VERSION', 'RPC returns an advanced project version equal to the stored one',
      false, sqlstate || ' ' || left(sqlerrm, 110));
  end;
  perform pg_temp.must_pass(28, '28 LEVELS IN USE', 'units on both levels are accepted',
    format($q$insert into public.project_structure_nodes (project_id, level_number, name, code) values (%L, 1, 'Plant 1', 'ZZ-DP1')$q$, D));
  perform pg_temp.must_pass(28, '28 LEVELS IN USE', 'a level-2 unit is accepted',
    format($q$insert into public.project_structure_nodes (project_id, level_number, parent_id, name, code) values (%L, 2, %L, 'Unit 1', 'ZZ-DU1')$q$,
           D, (select id from public.project_structure_nodes where project_id = D and code = 'ZZ-DP1')));
  d1 := (select id::text from public.project_structure_levels where project_id = D and level_number = 1);
  d2 := (select id::text from public.project_structure_levels where project_id = D and level_number = 2);

  select updated_at into v_version from public.projects where id = D;
  perform pg_temp.must_pass(28, '28 LEVELS IN USE', 'RPC: appending a deeper level while units exist is accepted',
    format('select public.configure_project_structure_levels(%L, %L, %L::jsonb)', D, v_version,
           jsonb_build_array(
             jsonb_build_object('id', d1, 'level_number', 1, 'singular_label', 'Plant', 'plural_label', 'Plants'),
             jsonb_build_object('id', d2, 'level_number', 2, 'singular_label', 'Unit', 'plural_label', 'Units'),
             jsonb_build_object('level_number', 3, 'singular_label', 'Equipment Type', 'plural_label', 'Equipment Types'))));
  perform pg_temp.chk(28, '28 LEVELS IN USE', 'the project now has three levels',
    (select count(*) from public.project_structure_levels where project_id = D) = 3);
  d3 := (select id::text from public.project_structure_levels where project_id = D and level_number = 3);
  select updated_at into v_version from public.projects where id = D;
  perform pg_temp.must_pass(28, '28 LEVELS IN USE', 'RPC: removing the deepest UNUSED level while units exist is accepted',
    format('select public.configure_project_structure_levels(%L, %L, %L::jsonb)', D, v_version,
           jsonb_build_array(
             jsonb_build_object('id', d1, 'level_number', 1, 'singular_label', 'Plant', 'plural_label', 'Plants'),
             jsonb_build_object('id', d2, 'level_number', 2, 'singular_label', 'Unit', 'plural_label', 'Units'))));
  perform pg_temp.chk(28, '28 LEVELS IN USE', 'the project is back to two levels, ids unchanged',
    (select array_agg(id::text order by level_number) from public.project_structure_levels where project_id = D) = array[d1, d2]
    and d3 is not null);

  /* Project A (units on every level) */
  select updated_at into v_version from public.projects where id = A;
  perform pg_temp.must_pass(18, '18 PCM ALLOWED', 'RPC: renaming levels in place (with their ids) is accepted',
    format('select public.configure_project_structure_levels(%L, %L, %L::jsonb)', A, v_version,
           jsonb_build_array(
             jsonb_build_object('id', l1, 'level_number', 1, 'singular_label', 'Contract Package', 'plural_label', 'Contract Packages'),
             jsonb_build_object('id', l2, 'level_number', 2, 'singular_label', 'Area', 'plural_label', 'Areas'),
             jsonb_build_object('id', l3, 'level_number', 3, 'singular_label', 'Discipline', 'plural_label', 'Disciplines'),
             jsonb_build_object('id', l4, 'level_number', 4, 'singular_label', 'Team', 'plural_label', 'Teams'))));
  select updated_at into v_version from public.projects where id = A;
  perform pg_temp.must_pass(28, '28 LEVELS IN USE', 'RPC: swapping two level names in one save is accepted',
    format('select public.configure_project_structure_levels(%L, %L, %L::jsonb)', A, v_version,
           jsonb_build_array(
             jsonb_build_object('id', l1, 'level_number', 1, 'singular_label', 'Contract Package', 'plural_label', 'Contract Packages'),
             jsonb_build_object('id', l2, 'level_number', 2, 'singular_label', 'Discipline', 'plural_label', 'Disciplines'),
             jsonb_build_object('id', l3, 'level_number', 3, 'singular_label', 'Area', 'plural_label', 'Areas'),
             jsonb_build_object('id', l4, 'level_number', 4, 'singular_label', 'Team', 'plural_label', 'Teams'))));
  select array_agg(singular_label order by level_number) into v_labels from public.project_structure_levels where project_id = A;
  perform pg_temp.chk(28, '28 LEVELS IN USE', 'RPC result after the swap', v_labels = array['Contract Package', 'Discipline', 'Area', 'Team'],
    array_to_string(v_labels, ' / '));

  select updated_at into v_version from public.projects where id = A;
  perform pg_temp.must_fail_tag(28, '28 LEVELS IN USE', 'RPC: inserting a middle level once units exist is refused',
    format('select public.configure_project_structure_levels(%L, %L, %L::jsonb)', A, v_version,
           jsonb_build_array(
             jsonb_build_object('id', l1, 'level_number', 1, 'singular_label', 'Contract Package', 'plural_label', 'Contract Packages'),
             jsonb_build_object('level_number', 2, 'singular_label', 'Zone', 'plural_label', 'Zones'),
             jsonb_build_object('id', l2, 'level_number', 3, 'singular_label', 'Discipline', 'plural_label', 'Disciplines'),
             jsonb_build_object('id', l3, 'level_number', 4, 'singular_label', 'Area', 'plural_label', 'Areas'))),
    '[LEVEL_IN_USE]');
  perform pg_temp.must_fail_tag(28, '28 LEVELS IN USE', 'RPC: removing a level that has units is refused',
    format('select public.configure_project_structure_levels(%L, %L, %L::jsonb)', A, v_version,
           jsonb_build_array(
             jsonb_build_object('id', l1, 'level_number', 1, 'singular_label', 'Contract Package', 'plural_label', 'Contract Packages'),
             jsonb_build_object('id', l2, 'level_number', 2, 'singular_label', 'Discipline', 'plural_label', 'Disciplines'),
             jsonb_build_object('id', l3, 'level_number', 3, 'singular_label', 'Area', 'plural_label', 'Areas'))),
    '[LEVEL_IN_USE]');

  perform pg_temp.must_fail_tag(15, '15 PSM PROJECT', 'RPC on a PSM project is refused',
    format('select public.configure_project_structure_levels(%L, %L, %L::jsonb)', pg_temp.pid('ZZ-2C1C-PSM'),
           (select updated_at from public.projects where id = pg_temp.pid('ZZ-2C1C-PSM')),
           '[{"level_number":1,"singular_label":"Package","plural_label":"Packages"}]'), '[NOT_OTHER]');
  perform pg_temp.must_fail_tag(16, '16 LEGACY PROJECT', 'RPC on an unclassified project is refused',
    format('select public.configure_project_structure_levels(%L, %L, %L::jsonb)', pg_temp.pid('ZZ-2C1C-LEG'),
           (select updated_at from public.projects where id = pg_temp.pid('ZZ-2C1C-LEG')),
           '[{"level_number":1,"singular_label":"Package","plural_label":"Packages"}]'), '[NOT_OTHER]');
  perform pg_temp.must_fail_tag(19, '19 ARCHIVED PROJECT', 'RPC on an archived project is refused',
    format('select public.configure_project_structure_levels(%L, %L, %L::jsonb)', pg_temp.pid('ZZ-2C1C-ARC'),
           (select updated_at from public.projects where id = pg_temp.pid('ZZ-2C1C-ARC')),
           '[{"level_number":1,"singular_label":"Stage","plural_label":"Stages"}]'), '[PROJECT_ARCHIVED]');
end $pcm$;

reset role;

/* ===================== 21 / 22 Other -> PSM correction ==================== */

do $admin$
declare
  A uuid := pg_temp.pid('ZZ-2C1C-A');
  v_version timestamptz := (select updated_at from public.projects where id = pg_temp.pid('ZZ-2C1C-A'));
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000a1","role":"authenticated"}';

  perform pg_temp.must_fail_tag(21, '21 CORRECTION GUARD', 'Other -> PSM with active units is refused',
    format('select public.correct_project_structure_family(%L, %L, %L, null, null, %L)', A, v_version, 'psm', 'Wrong type'),
    '[STRUCTURE_EXISTS]');
  perform pg_temp.chk(21, '21 CORRECTION GUARD', 'the refused correction wrote no audit row',
    not exists (select 1 from public.project_classification_corrections where project_id = A));
end $admin$;

reset role;

-- Archive every unit in ONE statement (flags cleared in the same update): the
-- node rules are checked at the end of the statement, so a whole tree can be
-- archived at once.
do $archive$
begin
  perform pg_temp.must_pass(22, '22 CORRECTION GUARD', 'archiving the whole structure in one statement is accepted',
    format($q$update public.project_structure_nodes
                 set archived_at = now(), weekly_reporting_required = false, monthly_reporting_required = false
               where project_id = %L and archived_at is null$q$, pg_temp.pid('ZZ-2C1C-A')));
end $archive$;

do $admin2$
declare
  A uuid := pg_temp.pid('ZZ-2C1C-A');
  v_version timestamptz := (select updated_at from public.projects where id = pg_temp.pid('ZZ-2C1C-A'));
  v_family text;
  v_n int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000a1","role":"authenticated"}';
  begin
    perform public.correct_project_structure_family(A, v_version, 'psm', null, null, 'Actually a PSM project');
    select structure_family into v_family from public.projects where id = A;
    select count(*) into v_n from public.project_classification_corrections
     where project_id = A and old_family = 'other' and new_family = 'psm';
    perform pg_temp.chk(22, '22 CORRECTION GUARD', 'Other -> PSM succeeds once all units are archived, and is audited',
      v_family = 'psm' and v_n = 1, format('family=%s audit_rows=%s', v_family, v_n));
  exception when others then
    perform pg_temp.chk(22, '22 CORRECTION GUARD', 'Other -> PSM succeeds once all units are archived, and is audited',
      false, sqlstate || ' ' || left(sqlerrm, 110));
  end;
end $admin2$;

reset role;

do $tail$
declare
  B uuid := pg_temp.pid('ZZ-2C1C-B');
begin
  perform pg_temp.must_fail_tag(22, '22 CORRECTION GUARD', 'the now-PSM project accepts no new structure',
    format($q$insert into public.project_structure_nodes (project_id, level_number, name) values (%L, 1, 'Late package')$q$,
           pg_temp.pid('ZZ-2C1C-A')), '[NOT_OTHER]');

  /* 30. Whole-project cascade deletion (B has two levels and three units) */
  perform pg_temp.chk(30, '30 CASCADE', 'project B has structure before deletion',
    (select count(*) from public.project_structure_levels where project_id = B) = 2
    and (select count(*) from public.project_structure_nodes where project_id = B) = 3);
  perform pg_temp.must_pass(30, '30 CASCADE', 'deleting the whole project is accepted',
    format('delete from public.projects where id = %L', B));
  perform pg_temp.chk(30, '30 CASCADE', 'its levels and units are gone with it',
    not exists (select 1 from public.project_structure_levels where project_id = B)
    and not exists (select 1 from public.project_structure_nodes where project_id = B));
end $tail$;

select seq, area, item, verdict from r order by seq, area, item;

select count(*) filter (where verdict like 'PASS%') as pass,
       count(*) filter (where verdict like 'FAIL%') as fail,
       count(*) as total
  from r;

rollback;

/* 23. Nothing survives the rollback */
select '23 ROLLBACK CLEAN' as check,
       (select count(*) from public.projects where code like 'ZZ-2C1C-%') as projects,
       (select count(*) from public.project_types where code = 'ZZ-2C1C-CAT') as categories,
       (select count(*) from public.contacts where name like 'ZZ-P0TEST 2C1C %') as contacts,
       (select count(*) from public.profiles where id in ('00000000-0000-4000-a000-0000000110b1',
                                                         '00000000-0000-4000-a000-0000000110c1')) as profiles,
       (select count(*) from auth.users where id in ('00000000-0000-4000-a000-0000000110b1',
                                                     '00000000-0000-4000-a000-0000000110c1')) as users,
       (select count(*) from public.project_structure_nodes n
         where not exists (select 1 from public.projects p where p.id = n.project_id)
            or n.code like 'ZZ-%') as structure_nodes,
       (select count(*) from public.project_structure_levels l
         where not exists (select 1 from public.projects p where p.id = l.project_id)) as orphan_levels,
       case when (select count(*) from public.projects where code like 'ZZ-2C1C-%') = 0
             and (select count(*) from public.project_types where code = 'ZZ-2C1C-CAT') = 0
             and (select count(*) from public.contacts where name like 'ZZ-P0TEST 2C1C %') = 0
             and (select count(*) from public.profiles where id in ('00000000-0000-4000-a000-0000000110b1',
                                                                   '00000000-0000-4000-a000-0000000110c1')) = 0
             and (select count(*) from auth.users where id in ('00000000-0000-4000-a000-0000000110b1',
                                                               '00000000-0000-4000-a000-0000000110c1')) = 0
             and (select count(*) from public.project_structure_nodes where code like 'ZZ-%') = 0
            then 'PASS' else 'FAIL' end as verdict;

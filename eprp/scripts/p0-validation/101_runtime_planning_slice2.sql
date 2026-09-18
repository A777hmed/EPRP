-- EPRP Planning Slice 2 — RUNTIME verification. LOCAL REHEARSAL DATABASE ONLY.
--
-- Covers exactly what 20260914000001_planning_slice2_schema.sql added on top
-- of Slice 1, proven through RLS as real authenticated identities:
--   * planning_work_items.item_type taxonomy (valid accepted, invalid refused)
--   * planning_work_items.master_deliverable_id — reference, not a duplicate
--   * planning_confirmations targeting an ACTIVITY (not only a work item),
--     the one-target constraint, and that this widening did not loosen who
--     may write
--   * publish_planning_snapshot() copying the full Slice 2 column model
--     (actuals, remaining duration, actual/physical %, status, PV/EV,
--     external_id) into the immutable planning_snapshot_activities row
--
-- Requires 00_local_test_identity.sql and 01_setup_test_fixtures.sql to have
-- been run first (same ZZ-P0TEST-PRJ fixture every script here shares) and
-- creates its own c3 (Project Control Manager) identity inside its own
-- rolled-back transaction, exactly as 100_runtime_planning_slice1.sql does.
--
-- HOW TO RUN
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < 101_runtime_planning_slice2.sql

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

create or replace function pg_temp.must_not_modify(
  p_seq int, p_area text, p_item text, p_sql text
) returns void language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  perform pg_temp.chk(p_seq, p_area, p_item, n = 0, format('%s row(s) modified', n));
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

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-0000000000c3',
    'authenticated', 'authenticated', 'p0test.planning-mgr@example.invalid',
    'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ) on conflict (id) do nothing;

  insert into public.contacts (name, email, department_id)
  select 'ZZ-P0TEST Planning Manager', 'p0test.planning-mgr@example.invalid', d.id
    from public.departments d where d.code = 'ZZ-P0TEST-DEPT'
  on conflict do nothing;

  insert into public.project_contacts (project_id, contact_id, role)
  select v_project, c.id, 'project_control_manager'
    from public.contacts c where c.name = 'ZZ-P0TEST Planning Manager'
  on conflict do nothing;

  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select '00000000-0000-4000-a000-0000000000c3', 'p0test.planning-mgr@example.invalid',
         'ZZ-P0TEST Planning Manager', 'viewer', c.id, true
    from public.contacts c where c.name = 'ZZ-P0TEST Planning Manager'
  on conflict (id) do nothing;

  -- A governed Master Deliverable to link a work item to, so the "link, never
  -- duplicate" rule has something real to prove itself against.
  insert into public.master_deliverables (project_id, code, title)
  values (v_project, 'ZZRT-D1', 'Runtime deliverable fixture')
  on conflict do nothing;

  -- A second one on an UNRELATED project, so the cross-project guard has a
  -- real foreign id to be tested against — not one that merely vanishes
  -- under c3's own RLS visibility (which is what a naive "where project_id
  -- <> mine" subquery run AS c3 would silently resolve to NULL, not to a
  -- genuine cross-project id).
  insert into public.master_deliverables (project_id, code, title)
  select id, 'ZZRT-D2-OTHER', 'Runtime deliverable fixture (other project)'
    from public.projects where code = 'PSAIM-001'
  on conflict do nothing;
end;
$fix$;

/* ============================= the test run ================================ */

do $t$
declare
  P_A uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  D_A uuid := (select department_id from public.project_departments
                where project_id = (select id from public.projects where code = 'ZZ-P0TEST-PRJ')
                limit 1);
  v_deliverable uuid := (select id from public.master_deliverables where code = 'ZZRT-D1');
  -- Fetched here, in the DECLARE initializer, which evaluates before the body
  -- sets `local role authenticated` below — still as postgres, so RLS cannot
  -- hide this row and turn the guard test into a no-op.
  v_other_project_deliverable uuid := (select id from public.master_deliverables where code = 'ZZRT-D2-OTHER');
  v_work_item uuid; v_activity uuid; v_snap uuid;
  v_n int; v_item_type text; v_master_deliverable uuid;
  v_status text; v_external_id text; v_actual_start date; v_percent_physical numeric;
  v_planned_value numeric; v_earned_value numeric;
begin

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000c3","role":"authenticated"}';

  /* ---------------------------------------------------------------------
   * 1. item_type taxonomy
   * ------------------------------------------------------------------- */
  insert into public.planning_work_items (project_id, department_id, code, name, item_type)
  values (P_A, D_A, 'ZZRT-WI-1', 'Runtime deliverable work item', 'deliverable')
  returning id into v_work_item;
  perform pg_temp.chk(1, '1 ITEM TYPE', 'a valid item_type (deliverable) is accepted', v_work_item is not null);

  perform pg_temp.must_fail(1, '1 ITEM TYPE', 'an invalid item_type is refused by the CHECK constraint',
    format('insert into public.planning_work_items (project_id, department_id, code, name, item_type) values (%L, %L, %L, %L, %L)',
           P_A, D_A, 'ZZRT-WI-BAD', 'Bad type', 'not_a_real_type'));

  /* ---------------------------------------------------------------------
   * 2. master_deliverable_id — reference, not a duplicate
   * ------------------------------------------------------------------- */
  update public.planning_work_items set master_deliverable_id = v_deliverable where id = v_work_item;
  select item_type, master_deliverable_id into v_item_type, v_master_deliverable
    from public.planning_work_items where id = v_work_item;
  perform pg_temp.chk(2, '2 DELIVERABLE LINK', 'work item links to the governed Master Deliverable',
    v_master_deliverable = v_deliverable);

  select count(*) into v_n from public.master_deliverables
   where id = v_deliverable and title = 'Runtime deliverable fixture';
  perform pg_temp.chk(2, '2 DELIVERABLE LINK', 'the Master Deliverable itself is untouched (no field copied/denormalized)',
    v_n = 1);

  perform pg_temp.chk(2, '2 DELIVERABLE LINK', 'fixture: the other-project deliverable resolved to a real id',
    v_other_project_deliverable is not null);
  perform pg_temp.must_fail(2, '2 DELIVERABLE LINK', 'linking to a deliverable from another project is refused',
    format('update public.planning_work_items set master_deliverable_id = %L where id = %L',
           v_other_project_deliverable, v_work_item));

  /* ---------------------------------------------------------------------
   * 3. planning_confirmations targeting an ACTIVITY
   * ------------------------------------------------------------------- */
  insert into public.planning_activities (project_id, work_item_id, external_id, code, name, source)
  values (P_A, v_work_item, 'ZZRT-A-1', 'A-1', 'Runtime activity fixture', 'manual')
  returning id into v_activity;

  insert into public.planning_confirmations (activity_id, action, field_name, previous_value, new_value, reason)
  values (v_activity, 'adjust', 'plannedPercent', '40', '55', 'Runtime fixture adjustment');
  perform pg_temp.chk(3, '3 CONFIRM ACTIVITY', 'a confirmation may target an activity directly', true);

  perform pg_temp.must_fail(3, '3 CONFIRM ACTIVITY', 'a confirmation with BOTH work_item_id and activity_id is refused',
    format('insert into public.planning_confirmations (work_item_id, activity_id, action, field_name, reason) values (%L, %L, %L, %L, %L)',
           v_work_item, v_activity, 'confirm', 'name', 'both targets set'));
  perform pg_temp.must_fail(3, '3 CONFIRM ACTIVITY', 'a confirmation with NEITHER target is refused',
    format('insert into public.planning_confirmations (action, field_name, reason) values (%L, %L, %L)',
           'confirm', 'name', 'no target set'));

  perform pg_temp.must_not_modify(3, '3 CONFIRM ACTIVITY', 'an activity-targeted confirmation cannot be edited after the fact',
    format('update public.planning_confirmations set reason = %L where activity_id = %L', 'tampered', v_activity));

  /* ---------------------------------------------------------------------
   * 4. publish_planning_snapshot() copies the widened column model
   * ------------------------------------------------------------------- */
  update public.planning_activities
     set actual_start_date = date '2026-09-10',
         percent_complete_physical = 62,
         status = 'In Progress',
         planned_value = 50000,
         earned_value = 31000
   where id = v_activity;

  select public.publish_planning_snapshot(p_project_id := P_A, p_data_date := date '2026-09-10') into v_snap;
  perform pg_temp.chk(4, '4 SNAPSHOT COPY', 'publish succeeded', v_snap is not null);

  select external_id, status, actual_start_date, percent_complete_physical, planned_value, earned_value
    into v_external_id, v_status, v_actual_start, v_percent_physical, v_planned_value, v_earned_value
    from public.planning_snapshot_activities
   where snapshot_id = v_snap and source_activity_id = v_activity;

  perform pg_temp.chk(4, '4 SNAPSHOT COPY', 'external_id copied (the Planning Review matching key)',
    v_external_id = 'ZZRT-A-1');
  perform pg_temp.chk(4, '4 SNAPSHOT COPY', 'status copied verbatim, uninterpreted',
    v_status = 'In Progress');
  perform pg_temp.chk(4, '4 SNAPSHOT COPY', 'actual_start_date copied',
    v_actual_start = date '2026-09-10');
  perform pg_temp.chk(4, '4 SNAPSHOT COPY', 'percent_complete_physical copied (distinct from planned/actual %)',
    v_percent_physical = 62);
  perform pg_temp.chk(4, '4 SNAPSHOT COPY', 'planned_value and earned_value both copied',
    v_planned_value = 50000 and v_earned_value = 31000);

  -- Immutability holds over the widened columns too — a later live edit must
  -- not reach back into this snapshot's copy.
  update public.planning_activities set percent_complete_physical = 99 where id = v_activity;
  select percent_complete_physical into v_percent_physical
    from public.planning_snapshot_activities where snapshot_id = v_snap and source_activity_id = v_activity;
  perform pg_temp.chk(4, '4 SNAPSHOT COPY', 'a later live edit never alters the published copy',
    v_percent_physical = 62);

  /* ---------------------------------------------------------------------
   * 5. Regression: the confirmations policy redefinition narrowed nothing
   * ------------------------------------------------------------------- */
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000b2","role":"authenticated"}';

  perform pg_temp.must_fail(5, '5 REGRESSION', 'Reporting Coordinator still cannot confirm an activity value',
    format('insert into public.planning_confirmations (activity_id, action, field_name, reason) values (%L, %L, %L, %L)',
           v_activity, 'confirm', 'name', 'coordinator attempt'));

  select count(*) into v_n from public.planning_confirmations where activity_id = v_activity;
  perform pg_temp.chk(5, '5 REGRESSION', 'Reporting Coordinator can still READ the confirmation history (can_access_project)',
    v_n >= 1, format('%s rows', v_n));

end $t$;

reset role;

select seq, area, item, verdict from r order by seq, area, item;

select count(*) filter (where verdict like 'PASS%') as pass,
       count(*) filter (where verdict like 'FAIL%') as fail
  from r;

rollback;

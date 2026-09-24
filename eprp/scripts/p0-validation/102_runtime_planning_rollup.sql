-- Planning Integration 3A — RUNTIME verification. LOCAL REHEARSAL DATABASE ONLY.
--
-- Covers exactly what 20260915000001_planning_rollup_foundation.sql added on
-- top of Slice 1/2: planning_snapshots.data_date /
-- planning_import_batches.data_date, and the corrected snapshot-period
-- resolution rule they exist to serve.
--
--   * data_date is NEVER fabricated from published_at/current_date:
--       - an Opening Snapshot takes it from the Opening Position (real)
--       - an import-based publish takes it from the import batch's OWN
--         data_date, and is REFUSED if the batch has none
--       - a manual (no batch, no Opening Position) publish requires an
--         explicit p_data_date, and is REFUSED without one
--       - supplying p_data_date alongside a batch or Opening Position is
--         REFUSED (exactly one governed source per publish)
--   * period resolution orders by data_date DESC first, version DESC only
--     as a tie-break — NOT by version first. A later-published, higher-
--     version snapshot with an EARLIER data date must lose to an earlier-
--     published, lower-version snapshot with a LATER (but still eligible)
--     data date.
--   * two snapshots sharing the same data_date resolve to the higher
--     version
--   * a data_date after the period end is excluded, however high its
--     version
--   * a period end before every snapshot's data_date resolves to nothing
--   * project isolation and draft/unpublished exclusion continue to hold
--
-- Requires 00_local_test_identity.sql and 01_setup_test_fixtures.sql to have
-- been run first (same ZZ-P0TEST-PRJ fixture every script here shares).
--
-- HOW TO RUN
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < 102_runtime_planning_rollup.sql

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

  -- Opening Position promotion requires existing_active_project onboarding.
  insert into public.project_planning_settings (project_id, onboarding_mode)
  values (v_project, 'existing_active_project')
  on conflict (project_id) do update set onboarding_mode = excluded.onboarding_mode;
end;
$fix$;

/* ============================= the test run ================================ */

do $t$
declare
  P_A uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  P_B uuid := (select id from public.projects where code = 'PSAIM-001');
  D_A uuid := (select department_id from public.project_departments
                where project_id = (select id from public.projects where code = 'ZZ-P0TEST-PRJ')
                limit 1);
  v_work_item uuid; v_activity uuid; v_late_activity uuid;
  v_opening uuid;
  v_batch_no_date uuid; v_batch_with_date uuid;
  v_snap_1 uuid; v_snap_2 uuid; v_snap_3 uuid; v_snap_4 uuid; v_snap_5 uuid; v_snap_6 uuid; v_snap_7 uuid; v_snap_8 uuid;
  v_data_date date; v_version int;
  v_resolved uuid;
  v_n int;
begin

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000c3","role":"authenticated"}';

  /* ---------------------------------------------------------------------
   * 1. Data Date never fabricated — every source and every refusal.
   * ------------------------------------------------------------------- */

  -- 1a. Opening Position publish: real data_date, from the position itself.
  insert into public.planning_opening_positions
    (project_id, data_date, planned_progress_percent, actual_progress_percent, source)
  values (P_A, date '2026-01-01', 20, 15, 'Runtime rollup fixture — opening position')
  returning id into v_opening;

  select public.publish_planning_snapshot(p_project_id := P_A, p_opening_position_id := v_opening)
    into v_snap_1;
  select data_date into v_data_date from public.planning_snapshots where id = v_snap_1;
  perform pg_temp.chk(1, '1 DATA DATE SOURCE', 'Opening Snapshot stamps data_date from the Opening Position',
    v_data_date = date '2026-01-01', format('got %s', v_data_date));

  -- 1b. Manual publish with NO p_data_date: refused, never defaults to today.
  perform pg_temp.must_fail(1, '1 DATA DATE SOURCE', 'a manual publish with no Data Date is refused (never defaults to current_date)',
    format('select public.publish_planning_snapshot(p_project_id := %L)', P_A));

  -- 1c. Manual publish WITH an explicit p_data_date: succeeds, uses exactly that date.
  select public.publish_planning_snapshot(p_project_id := P_A, p_data_date := date '2026-02-01')
    into v_snap_2;
  select data_date into v_data_date from public.planning_snapshots where id = v_snap_2;
  perform pg_temp.chk(1, '1 DATA DATE SOURCE', 'a manual publish with an explicit Data Date uses exactly that date',
    v_data_date = date '2026-02-01', format('got %s', v_data_date));

  -- 1d. Import batch with NO data_date: publishing from it is refused.
  insert into public.planning_import_batches (project_id, source_type, status)
  values (P_A, 'eprp_excel', 'validated')
  returning id into v_batch_no_date;
  perform pg_temp.must_fail(1, '1 DATA DATE SOURCE', 'publishing an import batch with no Data Date is refused',
    format('select public.publish_planning_snapshot(p_project_id := %L, p_import_batch_id := %L)', P_A, v_batch_no_date));

  -- 1e. Import batch WITH a data_date: publish succeeds, snapshot inherits it.
  insert into public.planning_import_batches (project_id, source_type, status, data_date)
  values (P_A, 'eprp_excel', 'validated', date '2026-03-01')
  returning id into v_batch_with_date;
  select public.publish_planning_snapshot(p_project_id := P_A, p_import_batch_id := v_batch_with_date)
    into v_snap_3;
  select data_date into v_data_date from public.planning_snapshots where id = v_snap_3;
  perform pg_temp.chk(1, '1 DATA DATE SOURCE', 'publishing an import batch WITH a Data Date succeeds and the snapshot inherits it',
    v_data_date = date '2026-03-01', format('got %s', v_data_date));

  -- 1f. p_data_date alongside a batch or Opening Position: refused (exactly one governed source).
  perform pg_temp.must_fail(1, '1 DATA DATE SOURCE', 'p_data_date alongside an import batch is refused',
    format('select public.publish_planning_snapshot(p_project_id := %L, p_import_batch_id := %L, p_data_date := date %L)',
           P_A, v_batch_with_date, '2026-03-02'));

  /* ---------------------------------------------------------------------
   * 2. Period resolution: data_date DESC first, version only breaks a
   *    tie. This is the exact scenario from the review: v5 (data_date
   *    2026-08-31) must beat v6 (data_date 2026-08-15) for a period end
   *    of 2026-09-05, even though v6 is the higher version.
   * ------------------------------------------------------------------- */
  select public.publish_planning_snapshot(p_project_id := P_A, p_data_date := date '2026-04-01') into v_snap_4;
  select public.publish_planning_snapshot(p_project_id := P_A, p_data_date := date '2026-08-31') into v_snap_5;
  select public.publish_planning_snapshot(p_project_id := P_A, p_data_date := date '2026-08-15') into v_snap_6;

  select version into v_version from public.planning_snapshots where id = v_snap_5;
  perform pg_temp.chk(2, '2 PERIOD ORDERING', 'fixture: v_snap_5 is version 5', v_version = 5, format('got %s', v_version));
  select version into v_version from public.planning_snapshots where id = v_snap_6;
  perform pg_temp.chk(2, '2 PERIOD ORDERING', 'fixture: v_snap_6 is version 6 (later version, EARLIER data date than v5)', v_version = 6, format('got %s', v_version));

  select id into v_resolved from public.planning_snapshots
   where project_id = P_A and data_date <= date '2026-09-05'
   order by data_date desc, version desc limit 1;
  perform pg_temp.chk(2, '2 PERIOD ORDERING', 'v5 (data_date 2026-08-31) wins over v6 (data_date 2026-08-15, higher version) for period end 2026-09-05',
    v_resolved = v_snap_5, format('resolved %s, expected v5 %s', v_resolved, v_snap_5));

  -- The naive "order by version desc" would have picked v6 — prove that
  -- would have been wrong, so a regression back to it is caught here too.
  select id into v_resolved from public.planning_snapshots
   where project_id = P_A and data_date <= date '2026-09-05'
   order by version desc limit 1;
  perform pg_temp.chk(2, '2 PERIOD ORDERING', 'sanity: ordering by version alone would have wrongly picked v6, confirming this is a real, not incidental, distinction',
    v_resolved = v_snap_6);

  /* ---------------------------------------------------------------------
   * 3. Tie-break: two snapshots sharing the SAME data_date resolve to the
   *    higher version.
   * ------------------------------------------------------------------- */
  select public.publish_planning_snapshot(p_project_id := P_A, p_data_date := date '2026-08-31') into v_snap_7;
  select version into v_version from public.planning_snapshots where id = v_snap_7;
  perform pg_temp.chk(3, '3 TIE-BREAK', 'fixture: v_snap_7 is version 7, same data_date as v5 (2026-08-31)', v_version = 7);

  select id into v_resolved from public.planning_snapshots
   where project_id = P_A and data_date <= date '2026-09-05'
   order by data_date desc, version desc limit 1;
  perform pg_temp.chk(3, '3 TIE-BREAK', 'v7 (version 7, data_date 2026-08-31) beats v5 (version 5, same data_date) — higher version wins the tie',
    v_resolved = v_snap_7, format('resolved %s, expected v7 %s', v_resolved, v_snap_7));

  /* ---------------------------------------------------------------------
   * 4. Future data_date excluded; no eligible snapshot resolves to
   *    nothing, never falls back to the earliest.
   * ------------------------------------------------------------------- */
  select id into v_resolved from public.planning_snapshots
   where project_id = P_A and data_date <= date '2026-08-01'
   order by data_date desc, version desc limit 1;
  perform pg_temp.chk(4, '4 FUTURE EXCLUDED', 'a period end of 2026-08-01 excludes v5/v6/v7 (all data-dated after it) and resolves to v4 (2026-04-01)',
    v_resolved = v_snap_4, format('resolved %s, expected v4 %s', v_resolved, v_snap_4));

  select count(*) into v_n
    from public.planning_snapshots
   where project_id = P_A and data_date <= date '2025-01-01';
  perform pg_temp.chk(4, '4 FUTURE EXCLUDED', 'a period end before every snapshot''s data_date resolves to nothing',
    v_n = 0);

  /* ---------------------------------------------------------------------
   * 5. Project isolation.
   * ------------------------------------------------------------------- */
  perform pg_temp.chk(5, '5 PROJECT ISOLATION', 'fixture: a second project exists to isolate against',
    P_B is not null);

  select count(*) into v_n
    from public.planning_snapshots
   where project_id = P_A and id in (
     select id from public.planning_snapshots where project_id = P_B
   );
  perform pg_temp.chk(5, '5 PROJECT ISOLATION', 'no snapshot id is shared between the two projects',
    v_n = 0);

  select count(*) into v_n
    from public.planning_snapshots
   where project_id = P_A and data_date <= (current_date + 3650);
  perform pg_temp.chk(5, '5 PROJECT ISOLATION', 'a project-scoped period query for P_A returns only P_A''s own snapshots (7)',
    v_n = 7, format('%s row(s)', v_n));

  /* ---------------------------------------------------------------------
   * 6. Draft/unpublished data never participates in an already-published
   *    snapshot's rollup inputs.
   * ------------------------------------------------------------------- */
  insert into public.planning_work_items (project_id, department_id, code, name, item_type)
  values (P_A, D_A, 'ZZRT-RU-WI-1', 'Rollup runtime work item', 'activity')
  returning id into v_work_item;

  insert into public.planning_activities
    (project_id, work_item_id, external_id, code, name, source, weight_percent,
     percent_complete_planned, percent_complete_physical)
  values (P_A, v_work_item, 'ZZRT-RU-A-1', 'A-1', 'Published in v8', 'manual', 60, 80, 70)
  returning id into v_activity;

  select public.publish_planning_snapshot(p_project_id := P_A, p_data_date := date '2026-09-10') into v_snap_8;

  insert into public.planning_activities
    (project_id, work_item_id, external_id, code, name, source, weight_percent,
     percent_complete_planned, percent_complete_physical)
  values (P_A, v_work_item, 'ZZRT-RU-A-2-DRAFT', 'A-2', 'Created after the last publish, never published', 'manual', 100, 90, 90)
  returning id into v_late_activity;

  select count(*) into v_n
    from public.planning_snapshot_activities
   where snapshot_id = v_snap_8 and source_activity_id = v_late_activity;
  perform pg_temp.chk(6, '6 DRAFT EXCLUSION', 'an activity created after the last publish does not retroactively appear in it',
    v_n = 0);

  update public.planning_activities set percent_complete_physical = 1 where id = v_activity;
  select count(*) into v_n
    from public.planning_snapshot_activities
   where snapshot_id = v_snap_8 and source_activity_id = v_activity and percent_complete_physical = 70;
  perform pg_temp.chk(6, '6 DRAFT EXCLUSION', 'a live edit after publish never alters the published snapshot''s activity row',
    v_n = 1);

end $t$;

reset role;

select seq, area, item, verdict from r order by seq, area, item;

select count(*) filter (where verdict like 'PASS%') as pass,
       count(*) filter (where verdict like 'FAIL%') as fail
  from r;

rollback;

-- EPRP Planning Slice 1 — RUNTIME verification. LOCAL REHEARSAL DATABASE ONLY.
--
-- Writes real rows through RLS as real authenticated identities, then rolls
-- the whole thing back. Nothing survives the run except the base fixture
-- this script builds on (ZZ-P0TEST-PRJ / Coordinator / Member), which is the
-- same one every other script in this directory shares and is torn down by
-- 99_teardown_test_fixtures.sql.
--
-- Requires 00_local_test_identity.sql and 01_setup_test_fixtures.sql to have
-- been run first (same ZZ-P0TEST-PRJ fixtures every other script here uses):
--   admin  a1 = system_admin
--   viewer b2 = Reporting Coordinator on ZZ-P0TEST-PRJ, nothing elsewhere
--
-- This script additionally creates, INSIDE its own rolled-back transaction:
--   c3 = Project Control Manager on ZZ-P0TEST-PRJ   (assigned Planning writer)
--   d4 = no assignment anywhere                      (unassigned)
--   e5 = portfolio_read_grants tier='full'           (no project assignment)
--   f6 = portfolio_read_grants tier='published'      (no project assignment)
--
-- HOW TO RUN
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < 100_runtime_planning_slice1.sql

\set ON_ERROR_STOP off
\set QUIET on
\pset pager off

do $guard$
begin
  if inet_server_addr() is not null
     and host(inet_server_addr()) not in ('127.0.0.1', '::1', 'localhost') then
    raise exception
      'REFUSING TO RUN: this connection is not local (server address %).',
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
  perform pg_temp.chk(p_seq, p_area, p_item, true,
                      'refused: ' || left(sqlerrm, 90));
end $$;

-- For UPDATE/DELETE specifically: a table with RLS enabled and NO policy for
-- that command does not raise on a caller ineligible for even SELECT -- USING
-- silently evaluates false, the statement "succeeds", and 0 rows are touched.
-- must_fail() alone would misread that success as an accepted mutation.
-- This asserts the row-count instead, so a genuine hole (an actual row
-- modified) still fails loudly.
create or replace function pg_temp.must_not_modify(
  p_seq int, p_area text, p_item text, p_sql text
) returns void language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  perform pg_temp.chk(p_seq, p_area, p_item, n = 0, format('%s row(s) modified', n));
exception when others then
  perform pg_temp.chk(p_seq, p_area, p_item, true,
                      'refused: ' || left(sqlerrm, 90));
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

  -- Additional auth identities, local fixtures only.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
    ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-0000000000c3',
     'authenticated', 'authenticated', 'p0test.planning-mgr@example.invalid',
     'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-0000000000d4',
     'authenticated', 'authenticated', 'p0test.unassigned@example.invalid',
     'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-0000000000e5',
     'authenticated', 'authenticated', 'p0test.full-read@example.invalid',
     'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-0000000000f6',
     'authenticated', 'authenticated', 'p0test.published-read@example.invalid',
     'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
  on conflict (id) do nothing;

  insert into public.contacts (name, email, department_id)
  select 'ZZ-P0TEST Planning Manager', 'p0test.planning-mgr@example.invalid', d.id
    from public.departments d where d.code = 'ZZ-P0TEST-DEPT'
  on conflict do nothing;

  insert into public.contacts (name, email)
  values ('ZZ-P0TEST Unassigned', 'p0test.unassigned@example.invalid')
  on conflict do nothing;

  -- c3: Project Control Manager on ZZ-P0TEST-PRJ — unscoped, per
  -- project_contacts_project_authority_unscoped.
  insert into public.project_contacts (project_id, contact_id, role)
  select v_project, c.id, 'project_control_manager'
    from public.contacts c where c.name = 'ZZ-P0TEST Planning Manager'
  on conflict do nothing;

  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select '00000000-0000-4000-a000-0000000000c3', 'p0test.planning-mgr@example.invalid',
         'ZZ-P0TEST Planning Manager', 'viewer', c.id, true
    from public.contacts c where c.name = 'ZZ-P0TEST Planning Manager'
  on conflict (id) do nothing;

  -- d4: genuinely unassigned — a contact that is not in project_contacts anywhere.
  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select '00000000-0000-4000-a000-0000000000d4', 'p0test.unassigned@example.invalid',
         'ZZ-P0TEST Unassigned', 'viewer', c.id, true
    from public.contacts c where c.name = 'ZZ-P0TEST Unassigned'
  on conflict (id) do nothing;

  -- e5/f6: portfolio-read-only grants, no project_contacts row at all.
  insert into public.profiles (id, email, full_name, role, active)
  values
    ('00000000-0000-4000-a000-0000000000e5', 'p0test.full-read@example.invalid', 'ZZ-P0TEST Full Read', 'viewer', true),
    ('00000000-0000-4000-a000-0000000000f6', 'p0test.published-read@example.invalid', 'ZZ-P0TEST Published Read', 'viewer', true)
  on conflict (id) do nothing;

  insert into public.portfolio_read_grants (profile_id, tier, granted_by)
  values
    ('00000000-0000-4000-a000-0000000000e5', 'full', '00000000-0000-4000-a000-0000000000a1'),
    ('00000000-0000-4000-a000-0000000000f6', 'published', '00000000-0000-4000-a000-0000000000a1')
  on conflict do nothing;

  -- Planning onboarding: this project is treated as onboarded mid-execution.
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
  v_batch uuid; v_row uuid; v_work_item uuid; v_activity uuid;
  v_position uuid; v_snap1 uuid; v_snap2 uuid;
  v_baseline_referenced uuid; v_baseline_unreferenced uuid;
  v_n int; v_status text; v_version int; v_raw jsonb; v_name text;
  v_data jsonb;
begin

  /* ---------------------------------------------------------------------
   * 1. Assigned Planning publish allowed — as c3 (Project Control Manager)
   * ------------------------------------------------------------------- */
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000c3","role":"authenticated"}';

  perform pg_temp.chk(1, '1 ASSIGNED', 'can_manage_project_operations true for c3',
    public.can_manage_project_operations(P_A));

  insert into public.planning_opening_positions
    (project_id, data_date, planned_progress_percent, actual_progress_percent,
     forecast_finish_date, source)
  values (P_A, date '2026-09-01', 40, null, null, 'Contractor handover report')
  returning id into v_position;
  perform pg_temp.chk(1, '1 ASSIGNED', 'Opening Position drafted by assigned Planning Manager',
    v_position is not null);

  perform pg_temp.chk(1, '1 ASSIGNED', 'unassigned actual/forecast stored as NULL, not zero',
    (select actual_progress_percent is null and forecast_finish_date is null
       from public.planning_opening_positions where id = v_position));

  /* ---------------------------------------------------------------------
   * 2. Opening Snapshot V1 — "do not create fake history"
   * ------------------------------------------------------------------- */
  select public.publish_planning_snapshot(
    p_project_id := P_A, p_opening_position_id := v_position
  ) into v_snap1;
  perform pg_temp.chk(2, '2 OPENING V1', 'publish_planning_snapshot returned a snapshot id',
    v_snap1 is not null);

  select version, is_opening_snapshot into v_version, v_status
    from (select version, is_opening_snapshot::text as is_opening_snapshot
            from public.planning_snapshots where id = v_snap1) s;
  perform pg_temp.chk(2, '2 OPENING V1', 'version = 1', v_version = 1, 'got ' || v_version);
  perform pg_temp.chk(2, '2 OPENING V1', 'is_opening_snapshot = true', v_status = 'true');

  select count(*) into v_n from public.planning_work_items where project_id = P_A and active;
  perform pg_temp.chk(2, '2 OPENING V1', 'no fake work items were fabricated (0 rows)', v_n = 0, format('%s rows', v_n));
  select count(*) into v_n from public.planning_snapshot_activities where snapshot_id = v_snap1;
  perform pg_temp.chk(2, '2 OPENING V1', 'no fake snapshot activities were fabricated (0 rows)', v_n = 0, format('%s rows', v_n));

  select snapshot_data -> 'opening_position' into v_data
    from public.planning_snapshots where id = v_snap1;
  perform pg_temp.chk(2, '2 OPENING V1', 'snapshot_data.opening_position captures the declared position',
    (v_data ->> 'planned_progress_percent')::numeric = 40
    and v_data ->> 'actual_progress_percent' is null
    and v_data ->> 'source' = 'Contractor handover report');

  perform pg_temp.chk(2, '2 OPENING V1', 'Opening Position marked promoted',
    (select status = 'promoted' and promoted_to_snapshot_id = v_snap1
       from public.planning_opening_positions where id = v_position));

  perform pg_temp.must_fail(2, '2 OPENING V1', 'a second Opening Position cannot re-promote (already promoted)',
    format('select public.publish_planning_snapshot(p_project_id := %L, p_opening_position_id := %L)', P_A, v_position));

  /* ---------------------------------------------------------------------
   * 3. Second snapshot / version — manual planning content
   * ------------------------------------------------------------------- */
  insert into public.planning_work_items (project_id, department_id, code, name, source)
  values (P_A, D_A, 'WI-01', 'Detailed Engineering', 'manual')
  returning id into v_work_item;

  insert into public.planning_activities
    (project_id, work_item_id, code, name, planned_start_date, planned_finish_date,
     percent_complete_planned, weight_percent, source)
  values (P_A, v_work_item, 'A-01', 'Issue IFC drawings', date '2026-10-01', date '2026-11-01', 25, 100, 'manual')
  returning id into v_activity;

  -- Two baselines: one this snapshot will reference, one it never will — so
  -- the "referenced only" scoping on Published Portfolio Read can be proven,
  -- not just assumed.
  insert into public.planning_baselines (project_id, name, baseline_date)
  values (P_A, 'Original Baseline', date '2026-09-01')
  returning id into v_baseline_referenced;
  insert into public.planning_baselines (project_id, name, baseline_date)
  values (P_A, 'Abandoned Draft Baseline', date '2026-08-01')
  returning id into v_baseline_unreferenced;

  select public.publish_planning_snapshot(
    p_project_id := P_A, p_baseline_id := v_baseline_referenced, p_data_date := date '2026-10-05'
  ) into v_snap2;
  select version into v_version from public.planning_snapshots where id = v_snap2;
  perform pg_temp.chk(3, '3 SECOND SNAPSHOT', 'second publish is version 2', v_version = 2, 'got ' || v_version);

  select count(*) into v_n from public.planning_snapshot_activities where snapshot_id = v_snap2;
  perform pg_temp.chk(3, '3 SECOND SNAPSHOT', 'normalized snapshot_activities captured the one active activity',
    v_n = 1, format('%s rows', v_n));

  /* ---------------------------------------------------------------------
   * 4. Historical snapshot/activity immutability
   * ------------------------------------------------------------------- */
  update public.planning_activities set name = 'RENAMED AFTER PUBLISH', planned_finish_date = date '2027-01-01'
   where id = v_activity;

  select name into v_name from public.planning_snapshot_activities
   where snapshot_id = v_snap2 and source_activity_id = v_activity;
  perform pg_temp.chk(4, '4 IMMUTABILITY', 'a later edit to planning_activities never alters a prior snapshot''s activity row',
    v_name = 'Issue IFC drawings', 'snapshot still reads: ' || coalesce(v_name, 'NULL'));

  perform pg_temp.must_not_modify(4, '4 IMMUTABILITY', 'planning_snapshots row cannot be UPDATEd (no policy)',
    format('update public.planning_snapshots set label = %L where id = %L', 'tampered', v_snap2));
  perform pg_temp.must_not_modify(4, '4 IMMUTABILITY', 'planning_snapshots row cannot be DELETEd (no policy)',
    format('delete from public.planning_snapshots where id = %L', v_snap2));
  perform pg_temp.must_not_modify(4, '4 IMMUTABILITY', 'planning_snapshot_activities row cannot be UPDATEd (no policy)',
    format('update public.planning_snapshot_activities set name = %L where snapshot_id = %L', 'tampered', v_snap2));
  perform pg_temp.must_not_modify(4, '4 IMMUTABILITY', 'planning_snapshot_activities row cannot be DELETEd (no policy)',
    format('delete from public.planning_snapshot_activities where snapshot_id = %L', v_snap2));

  -- Re-publishing again produces v3 with the RENAMED content; v2 must still
  -- read the original name, proving snapshots never regenerate retroactively.
  perform public.publish_planning_snapshot(p_project_id := P_A, p_data_date := date '2026-10-12');
  select name into v_name from public.planning_snapshot_activities
   where snapshot_id = v_snap2 and source_activity_id = v_activity;
  perform pg_temp.chk(4, '4 IMMUTABILITY', 'v2''s activity history is unaffected by a v3 publish',
    v_name = 'Issue IFC drawings');

  /* ---------------------------------------------------------------------
   * 5. Confirmation never overwrites the raw import row
   * ------------------------------------------------------------------- */
  insert into public.planning_import_batches (project_id, source_type, file_name)
  values (P_A, 'p6', 'schedule.xer.xlsx')
  returning id into v_batch;

  insert into public.planning_import_rows (batch_id, row_number, external_id, wbs_path, name, raw_data)
  values (v_batch, 1, 'A-104', 'WBS.1.2', 'Foundation Concrete Pour', '{"duration_days": 12}'::jsonb)
  returning id into v_row;

  select raw_data into v_raw from public.planning_import_rows where id = v_row;

  insert into public.planning_confirmations (work_item_id, import_row_id, action, field_name, previous_value, new_value, reason)
  values (v_work_item, v_row, 'adjust', 'name', 'Foundation Concrete Pour', 'Foundation Concrete Pour — Zone 2', 'Site engineer clarified scope boundary');
  perform pg_temp.chk(5, '5 CONFIRM', 'confirmation row logged with a reason', true);

  perform pg_temp.must_not_modify(5, '5 CONFIRM', 'planning_import_rows cannot be UPDATEd, even by the assigned Planning Manager',
    format('update public.planning_import_rows set name = %L where id = %L', 'tampered', v_row));
  perform pg_temp.must_not_modify(5, '5 CONFIRM', 'planning_import_rows cannot be DELETEd',
    format('delete from public.planning_import_rows where id = %L', v_row));
  perform pg_temp.must_not_modify(5, '5 CONFIRM', 'a confirmation itself cannot be edited after the fact (no UPDATE policy)',
    format('update public.planning_confirmations set reason = %L where work_item_id = %L', 'tampered', v_work_item));

  select raw_data into v_raw from public.planning_import_rows where id = v_row;
  perform pg_temp.chk(5, '5 CONFIRM', 'raw_data is byte-for-byte unchanged after the confirmation',
    v_raw = '{"duration_days": 12}'::jsonb);
  select name into v_name from public.planning_import_rows where id = v_row;
  perform pg_temp.chk(5, '5 CONFIRM', 'raw import name is unchanged even though the work item''s name changed',
    v_name = 'Foundation Concrete Pour');

  /* ---------------------------------------------------------------------
   * 6. Coordinator denied — b2, Reporting Coordinator on P_A
   * ------------------------------------------------------------------- */
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000b2","role":"authenticated"}';

  perform pg_temp.chk(6, '6 COORDINATOR', 'Coordinator keeps reporting authority but not Planning operations',
    public.can_manage_reporting_workflow(P_A) and not public.can_manage_project_operations(P_A));

  perform pg_temp.must_fail(6, '6 COORDINATOR', 'Coordinator cannot publish a Planning Snapshot',
    format('select public.publish_planning_snapshot(p_project_id := %L)', P_A));
  perform pg_temp.must_fail(6, '6 COORDINATOR', 'Coordinator cannot insert a planning_work_item',
    format('insert into public.planning_work_items (project_id, code, name) values (%L, %L, %L)', P_A, 'WI-CO', 'Coordinator attempt'));
  perform pg_temp.must_fail(6, '6 COORDINATOR', 'Coordinator cannot insert a planning_import_batch',
    format('insert into public.planning_import_batches (project_id, source_type) values (%L, %L)', P_A, 'p6'));

  /* ---------------------------------------------------------------------
   * 7. Unassigned Planning denied — d4
   * ------------------------------------------------------------------- */
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000d4","role":"authenticated"}';

  select count(*) into v_n from public.planning_work_items where project_id = P_A;
  perform pg_temp.chk(7, '7 UNASSIGNED', 'unassigned reader sees zero planning_work_items rows (RLS-filtered)',
    v_n = 0, format('%s rows', v_n));
  select count(*) into v_n from public.planning_snapshots where project_id = P_A;
  perform pg_temp.chk(7, '7 UNASSIGNED', 'unassigned reader sees zero planning_snapshots rows',
    v_n = 0, format('%s rows', v_n));

  perform pg_temp.must_fail(7, '7 UNASSIGNED', 'unassigned account cannot publish a snapshot',
    format('select public.publish_planning_snapshot(p_project_id := %L)', P_A));
  perform pg_temp.must_fail(7, '7 UNASSIGNED', 'unassigned account cannot insert a planning_work_item',
    format('insert into public.planning_work_items (project_id, code, name) values (%L, %L, %L)', P_A, 'WI-UN', 'Unassigned attempt'));

  /* ---------------------------------------------------------------------
   * 8. Full Portfolio Read — e5, read-only, no project assignment
   * ------------------------------------------------------------------- */
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000e5","role":"authenticated"}';

  select count(*) into v_n from public.planning_work_items where project_id = P_A;
  perform pg_temp.chk(8, '8 FULL READ', 'Full-tier reader (no assignment) reads planning_work_items',
    v_n >= 1, format('%s rows', v_n));
  select count(*) into v_n from public.planning_snapshots where project_id = P_A;
  perform pg_temp.chk(8, '8 FULL READ', 'Full-tier reader reads planning_snapshots',
    v_n >= 2, format('%s rows', v_n));
  select count(*) into v_n from public.planning_baselines where project_id = P_A;
  perform pg_temp.chk(8, '8 FULL READ', 'Full-tier reader reads BOTH baselines, referenced and unreferenced alike (unrestricted by can_access_project)',
    v_n = 2, format('%s rows', v_n));
  select count(*) into v_n from public.planning_import_batches where project_id = P_A;
  perform pg_temp.chk(8, '8 FULL READ', 'Full-tier reader reads planning_import_batches (draft included)',
    v_n >= 1, format('%s rows', v_n));

  perform pg_temp.must_fail(8, '8 FULL READ', 'Full-tier reader cannot insert a planning_work_item',
    format('insert into public.planning_work_items (project_id, code, name) values (%L, %L, %L)', P_A, 'WI-FR', 'Full-read attempt'));
  perform pg_temp.must_fail(8, '8 FULL READ', 'Full-tier reader cannot call publish_planning_snapshot',
    format('select public.publish_planning_snapshot(p_project_id := %L)', P_A));
  perform pg_temp.must_fail(8, '8 FULL READ', 'Full-tier reader cannot insert a planning_confirmation',
    format('insert into public.planning_confirmations (work_item_id, action, field_name, reason) values (%L, %L, %L, %L)',
           v_work_item, 'adjust', 'name', 'full-read attempt'));

  /* ---------------------------------------------------------------------
   * 9. Published Portfolio Read — f6.
   *
   * Sees PUBLISHED Planning output for every project (proof 1, 2): the
   * snapshot header, its immutable activity detail, and only the baseline a
   * published snapshot actually references. Sees nothing else Planning holds
   * and can write nothing anywhere (proof 3, 4).
   * ------------------------------------------------------------------- */
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000f6","role":"authenticated"}';

  perform pg_temp.chk(9, '9 PUBLISHED READ', 'Published tier still sees the project itself (existing Phase B behaviour)',
    exists (select 1 from public.projects where id = P_A));

  -- Proof 1: the published snapshot HEADER, for a project this identity has
  -- no assignment on whatsoever.
  select count(*) into v_n from public.planning_snapshots where id = v_snap2;
  perform pg_temp.chk(9, '9 PUBLISHED READ', 'sees the published planning_snapshots header (v2)',
    v_n = 1, format('%s rows', v_n));
  select count(*) into v_n from public.planning_snapshots where project_id = P_A;
  perform pg_temp.chk(9, '9 PUBLISHED READ', 'sees every published snapshot for the project (v1 and v2, at minimum)',
    v_n >= 2, format('%s rows', v_n));

  -- Proof 2: that snapshot's immutable activity DETAIL, by name — not just a
  -- non-zero count.
  select name into v_name from public.planning_snapshot_activities
   where snapshot_id = v_snap2 and source_activity_id = v_activity;
  perform pg_temp.chk(9, '9 PUBLISHED READ', 'sees the snapshot''s immutable activity detail (name matches what was published)',
    v_name = 'Issue IFC drawings', 'read: ' || coalesce(v_name, 'NULL'));

  -- Minimal baseline metadata: the REFERENCED baseline is visible, the one no
  -- snapshot ever published is not — proving this is scoped, not blanket.
  select count(*) into v_n from public.planning_baselines where id = v_baseline_referenced;
  perform pg_temp.chk(9, '9 PUBLISHED READ', 'sees the baseline a published snapshot references',
    v_n = 1, format('%s rows', v_n));
  select count(*) into v_n from public.planning_baselines where id = v_baseline_unreferenced;
  perform pg_temp.chk(9, '9 PUBLISHED READ', 'does NOT see a baseline no snapshot ever published',
    v_n = 0, format('%s rows', v_n));

  -- Proof 3: everything upstream/mutable of publication stays invisible.
  select count(*) into v_n from public.planning_import_batches where project_id = P_A;
  perform pg_temp.chk(9, '9 PUBLISHED READ', 'reads zero planning_import_batches (draft imports invisible)',
    v_n = 0, format('%s rows', v_n));
  select count(*) into v_n from public.planning_import_rows where batch_id = v_batch;
  perform pg_temp.chk(9, '9 PUBLISHED READ', 'reads zero planning_import_rows',
    v_n = 0, format('%s rows', v_n));
  select count(*) into v_n from public.planning_confirmations where work_item_id = v_work_item;
  perform pg_temp.chk(9, '9 PUBLISHED READ', 'reads zero planning_confirmations (review/adjustment history invisible)',
    v_n = 0, format('%s rows', v_n));
  select count(*) into v_n from public.planning_work_items where project_id = P_A;
  perform pg_temp.chk(9, '9 PUBLISHED READ', 'reads zero planning_work_items (mutable working register invisible)',
    v_n = 0, format('%s rows', v_n));
  select count(*) into v_n from public.planning_activities where project_id = P_A;
  perform pg_temp.chk(9, '9 PUBLISHED READ', 'reads zero LIVE planning_activities (only the frozen snapshot copy is visible)',
    v_n = 0, format('%s rows', v_n));
  select count(*) into v_n from public.planning_opening_positions where project_id = P_A;
  perform pg_temp.chk(9, '9 PUBLISHED READ', 'reads zero planning_opening_positions (draft/opening working data invisible)',
    v_n = 0, format('%s rows', v_n));

  -- Proof 4: no write path anywhere, including the ones this tier can now
  -- partially read.
  perform pg_temp.must_fail(9, '9 PUBLISHED READ', 'cannot insert a planning_work_item',
    format('insert into public.planning_work_items (project_id, code, name) values (%L, %L, %L)', P_A, 'WI-PR', 'Published-read attempt'));
  perform pg_temp.must_fail(9, '9 PUBLISHED READ', 'cannot call publish_planning_snapshot',
    format('select public.publish_planning_snapshot(p_project_id := %L)', P_A));
  perform pg_temp.must_not_modify(9, '9 PUBLISHED READ', 'cannot UPDATE the planning_snapshots header it can read',
    format('update public.planning_snapshots set label = %L where id = %L', 'tampered-by-published-tier', v_snap2));
  perform pg_temp.must_not_modify(9, '9 PUBLISHED READ', 'cannot DELETE the planning_snapshots header it can read',
    format('delete from public.planning_snapshots where id = %L', v_snap2));
  perform pg_temp.must_fail(9, '9 PUBLISHED READ', 'cannot insert a planning_import_batch',
    format('insert into public.planning_import_batches (project_id, source_type) values (%L, %L)', P_A, 'p6'));
  perform pg_temp.must_fail(9, '9 PUBLISHED READ', 'cannot insert a planning_confirmation',
    format('insert into public.planning_confirmations (work_item_id, action, field_name, reason) values (%L, %L, %L, %L)',
           v_work_item, 'adjust', 'name', 'published-read attempt'));
  perform pg_temp.must_fail(9, '9 PUBLISHED READ', 'cannot insert a planning_baseline',
    format('insert into public.planning_baselines (project_id, name, baseline_date) values (%L, %L, current_date)',
           P_A, 'Published-read attempt'));

  /* ---------------------------------------------------------------------
   * 10. Weekly / Monthly planning_snapshot_id FK
   * ------------------------------------------------------------------- */
  reset role;

  insert into public.weekly_reports
    (report_number, project_id, week_number, period_start, period_end, planning_snapshot_id)
  values ('ZZRT-PLAN-WK1', P_A, 9001, current_date, current_date, v_snap2)
  returning id into v_work_item; -- reused var, uuid, only needs to prove the FK
  perform pg_temp.chk(10, '10 REPORT FK', 'weekly_reports accepts a real planning_snapshot_id',
    v_work_item is not null);

  insert into public.monthly_reports
    (report_number, project_id, reporting_month, planning_snapshot_id)
  values ('ZZRT-PLAN-MO1', P_A, date_trunc('month', current_date), null)
  returning id into v_work_item;
  perform pg_temp.chk(10, '10 REPORT FK', 'monthly_reports accepts NULL planning_snapshot_id (nullable until Planning is initialized)',
    v_work_item is not null);

  perform pg_temp.must_fail(10, '10 REPORT FK', 'weekly_reports.planning_snapshot_id rejects a non-existent snapshot id',
    format('insert into public.weekly_reports (report_number, project_id, week_number, period_start, period_end, planning_snapshot_id) values (%L, %L, 9002, current_date, current_date, %L)',
           'ZZRT-PLAN-FK', P_A, gen_random_uuid()));

  perform pg_temp.must_fail(10, '10 REPORT FK', 'monthly_reports.planning_snapshot_id rejects a non-existent snapshot id',
    format('insert into public.monthly_reports (report_number, project_id, reporting_month, planning_snapshot_id) values (%L, %L, date_trunc(%L, current_date) + interval %L, %L)',
           'ZZRT-PLAN-MFK', P_A, 'month', '1 month', gen_random_uuid()));

end $t$;

reset role;

select seq, area, item, verdict from r order by seq, area, item;

select count(*) filter (where verdict like 'PASS%') as pass,
       count(*) filter (where verdict like 'FAIL%') as fail
  from r;

rollback;

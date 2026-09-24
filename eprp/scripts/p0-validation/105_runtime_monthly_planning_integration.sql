-- Planning Integration 3C — Monthly RLS fix + snapshot pinning. RUNTIME
-- verification. LOCAL REHEARSAL DATABASE ONLY.
--
-- Combines what 104 (Weekly P0) and 103 (Weekly 3B pin) each proved,
-- for Monthly:
--
--   * an assigned Project Control / Planning identity CAN create a
--     Monthly Report — INSERT ... RETURNING (the exact shape
--     `monthlyReportService.create()`'s `.insert(...).select("*").single()`
--     issues) succeeds, proving 20260916000002_monthly_report_returning_
--     rls_fix.sql fixed the identical self-referential-RETURNING defect
--     Weekly had before 20260916000001
--   * an UNASSIGNED identity on the same project still CANNOT (the
--     monthly_reports_insert WITH CHECK, can_manage_reporting_workflow(),
--     is untouched by this fix)
--   * an assigned Reporting Coordinator CAN create one too
--   * a Planning-backed create (planning_snapshot_id set, the real 3C
--     create() shape) succeeds via INSERT ... RETURNING and the pin
--     persists on read-back
--   * a snapshot dated AFTER the reporting month's period end is excluded
--     from resolution — the exact query `getSnapshotForPeriod` runs
--   * a NEW resolution for the same period end, run AFTER a later
--     snapshot is published, genuinely differs from what an EXISTING
--     pinned Monthly report holds — the concrete case rule 4 ("never
--     re-resolve for an existing report") exists to prevent
--   * project isolation
--   * Full Portfolio Read / Published Portfolio Read / genuinely
--     unassigned behave on monthly_reports exactly as they do on
--     weekly_reports — no visibility broadened by this fix
--
-- Requires 00_local_test_identity.sql and 01_setup_test_fixtures.sql to have
-- been run first (same ZZ-P0TEST-PRJ fixture every script here shares).
--
-- HOW TO RUN
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < 105_runtime_monthly_planning_integration.sql

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
  ) values
    ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-0000000000e3',
     'authenticated', 'authenticated', 'p0test.monthly-planning-mgr@example.invalid',
     'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-0000000000e4',
     'authenticated', 'authenticated', 'p0test.monthly-unassigned@example.invalid',
     'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-0000000000e5',
     'authenticated', 'authenticated', 'p0test.monthly-full-read@example.invalid',
     'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-0000000000e6',
     'authenticated', 'authenticated', 'p0test.monthly-published-read@example.invalid',
     'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-0000000000e7',
     'authenticated', 'authenticated', 'p0test.monthly-coordinator@example.invalid',
     'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
  on conflict (id) do nothing;

  insert into public.contacts (name, email, department_id)
  select 'ZZ-P0TEST Monthly Planning Mgr', 'p0test.monthly-planning-mgr@example.invalid', d.id
    from public.departments d where d.code = 'ZZ-P0TEST-DEPT'
  on conflict do nothing;
  insert into public.contacts (name, email)
  values ('ZZ-P0TEST Monthly Unassigned', 'p0test.monthly-unassigned@example.invalid')
  on conflict do nothing;
  insert into public.contacts (name, email, department_id)
  select 'ZZ-P0TEST Monthly Coordinator', 'p0test.monthly-coordinator@example.invalid', d.id
    from public.departments d where d.code = 'ZZ-P0TEST-DEPT'
  on conflict do nothing;

  -- m3: Project Control / Planning on ZZ-P0TEST-PRJ, unscoped.
  insert into public.project_contacts (project_id, contact_id, role)
  select v_project, c.id, 'project_control_manager'
    from public.contacts c where c.name = 'ZZ-P0TEST Monthly Planning Mgr'
  on conflict do nothing;
  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select '00000000-0000-4000-a000-0000000000e3', 'p0test.monthly-planning-mgr@example.invalid',
         'ZZ-P0TEST Monthly Planning Mgr', 'viewer', c.id, true
    from public.contacts c where c.name = 'ZZ-P0TEST Monthly Planning Mgr'
  on conflict (id) do nothing;

  -- m4: genuinely unassigned — a contact never in project_contacts anywhere.
  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select '00000000-0000-4000-a000-0000000000e4', 'p0test.monthly-unassigned@example.invalid',
         'ZZ-P0TEST Monthly Unassigned', 'viewer', c.id, true
    from public.contacts c where c.name = 'ZZ-P0TEST Monthly Unassigned'
  on conflict (id) do nothing;

  -- m5/m6: portfolio-read-only grants, no project_contacts row at all.
  insert into public.profiles (id, email, full_name, role, active)
  values
    ('00000000-0000-4000-a000-0000000000e5', 'p0test.monthly-full-read@example.invalid', 'ZZ-P0TEST Monthly Full Read', 'viewer', true),
    ('00000000-0000-4000-a000-0000000000e6', 'p0test.monthly-published-read@example.invalid', 'ZZ-P0TEST Monthly Published Read', 'viewer', true)
  on conflict (id) do nothing;
  insert into public.portfolio_read_grants (profile_id, tier, granted_by)
  values
    ('00000000-0000-4000-a000-0000000000e5', 'full', '00000000-0000-4000-a000-0000000000a1'),
    ('00000000-0000-4000-a000-0000000000e6', 'published', '00000000-0000-4000-a000-0000000000a1')
  on conflict do nothing;

  -- m7: Reporting Coordinator on ZZ-P0TEST-PRJ, unscoped.
  insert into public.project_contacts (project_id, contact_id, role)
  select v_project, c.id, 'reporting_coordinator'
    from public.contacts c where c.name = 'ZZ-P0TEST Monthly Coordinator'
  on conflict do nothing;
  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select '00000000-0000-4000-a000-0000000000e7', 'p0test.monthly-coordinator@example.invalid',
         'ZZ-P0TEST Monthly Coordinator', 'viewer', c.id, true
    from public.contacts c where c.name = 'ZZ-P0TEST Monthly Coordinator'
  on conflict (id) do nothing;

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
  v_report_pcm uuid;
  v_report_coord uuid;
  v_report_planning uuid;
  v_snap uuid;
  v_snap_future uuid;
  v_snap_eligible uuid;
  v_snap_early uuid;
  v_snap_late uuid;
  v_monthly_norere uuid;
  v_resolved uuid;
  v_resolved_at_creation uuid;
  v_resolved_now uuid;
  v_pinned_after uuid;
  v_read_back text;
  v_n int;
begin

  /* ---------------------------------------------------------------------
   * 1. Assigned Project Control / Planning: INSERT ... RETURNING succeeds,
   *    and a separate follow-up SELECT also succeeds. Proves
   *    20260916000002's fix for the same self-referential RETURNING
   *    defect Weekly had.
   * ------------------------------------------------------------------- */
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000e3","role":"authenticated"}';

  begin
    insert into public.monthly_reports (project_id, report_number, reporting_month, status, planned_progress, actual_progress)
    values (P_A, 'ZZRT-M-PCM-1', date '2026-01-01', 'draft', 0, 0)
    returning id into v_report_pcm;
    perform pg_temp.chk(1, '1 PCM CREATE', 'INSERT ... RETURNING succeeds for an assigned Project Control / Planning identity',
      v_report_pcm is not null);
  exception when others then
    perform pg_temp.chk(1, '1 PCM CREATE', 'INSERT ... RETURNING succeeds for an assigned Project Control / Planning identity',
      false, 'raised: ' || left(sqlerrm, 120));
  end;

  if v_report_pcm is not null then
    select report_number into v_read_back from public.monthly_reports where id = v_report_pcm;
    perform pg_temp.chk(1, '1 PCM CREATE', 'a separate follow-up SELECT of the created row also succeeds',
      v_read_back = 'ZZRT-M-PCM-1');
  end if;

  /* ---------------------------------------------------------------------
   * 2. Unassigned identity on the same project: still refused. The
   *    WITH CHECK this exercises (can_manage_reporting_workflow, via
   *    monthly_reports_insert) is untouched by the fix.
   * ------------------------------------------------------------------- */
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000e4","role":"authenticated"}';

  perform pg_temp.must_fail(2, '2 UNASSIGNED REFUSED', 'an unassigned identity cannot create a Monthly Report on this project',
    format('insert into public.monthly_reports (project_id, report_number, reporting_month, status, planned_progress, actual_progress) values (%L, %L, %L, %L, %L, %L)',
           P_A, 'ZZRT-M-UNASSIGNED', date '2026-02-01', 'draft', 0, 0));

  /* ---------------------------------------------------------------------
   * 3. Assigned Reporting Coordinator: creation also works.
   * ------------------------------------------------------------------- */
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000e7","role":"authenticated"}';

  begin
    insert into public.monthly_reports (project_id, report_number, reporting_month, status, planned_progress, actual_progress)
    values (P_A, 'ZZRT-M-COORD-1', date '2026-03-01', 'draft', 0, 0)
    returning id into v_report_coord;
    perform pg_temp.chk(3, '3 COORDINATOR CREATE', 'INSERT ... RETURNING succeeds for an assigned Reporting Coordinator',
      v_report_coord is not null);
  exception when others then
    perform pg_temp.chk(3, '3 COORDINATOR CREATE', 'INSERT ... RETURNING succeeds for an assigned Reporting Coordinator',
      false, 'raised: ' || left(sqlerrm, 120));
  end;

  /* ---------------------------------------------------------------------
   * 4. Planning-backed creation (the real 3C create() shape: a report row
   *    that ALSO sets planning_snapshot_id, with Planned/Actual derived
   *    from the resolved rollup) succeeds via INSERT ... RETURNING and the
   *    pin persists on read-back. "Is the rollup usable" itself
   *    (deriveMonthlyPlanningFigures) is pure TS logic, proven in
   *    verify_monthly_planning_integration.ts, not re-proven here.
   * ------------------------------------------------------------------- */
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000e3","role":"authenticated"}';

  select public.publish_planning_snapshot(p_project_id := P_A, p_data_date := date '2026-04-15')
    into v_snap;

  begin
    insert into public.monthly_reports
      (project_id, report_number, reporting_month, status, planned_progress, actual_progress, planning_snapshot_id)
    values (P_A, 'ZZRT-M-PLANNING-1', date '2026-04-01', 'draft', 70, 60, v_snap)
    returning id into v_report_planning;
    perform pg_temp.chk(4, '4 PLANNING-BACKED CREATE', 'INSERT ... RETURNING succeeds with planning_snapshot_id set (the real create() shape)',
      v_report_planning is not null);
  exception when others then
    perform pg_temp.chk(4, '4 PLANNING-BACKED CREATE', 'INSERT ... RETURNING succeeds with planning_snapshot_id set (the real create() shape)',
      false, 'raised: ' || left(sqlerrm, 120));
  end;

  if v_report_planning is not null then
    select planning_snapshot_id into v_snap from public.monthly_reports where id = v_report_planning;
    perform pg_temp.chk(4, '4 PLANNING-BACKED CREATE', 'the pin persists and reads back correctly',
      v_snap is not null);
  end if;

  /* ---------------------------------------------------------------------
   * 5. A snapshot dated AFTER the reporting month's period end is
   *    excluded from resolution — the exact query getSnapshotForPeriod
   *    (planning-service.ts) runs: `where data_date <= periodEnd order by
   *    data_date desc, version desc limit 1`. Month 2026-05, period end
   *    2026-05-31.
   * ------------------------------------------------------------------- */
  select public.publish_planning_snapshot(p_project_id := P_A, p_data_date := date '2026-06-15')
    into v_snap_future;
  select public.publish_planning_snapshot(p_project_id := P_A, p_data_date := date '2026-05-10')
    into v_snap_eligible;

  select id into v_resolved
    from public.planning_snapshots
   where project_id = P_A and data_date <= date '2026-05-31'
   order by data_date desc, version desc limit 1;
  perform pg_temp.chk(5, '5 FUTURE SNAPSHOT EXCLUDED', 'resolution for a May period end does not select the June (future) snapshot',
    v_resolved <> v_snap_future);
  perform pg_temp.chk(5, '5 FUTURE SNAPSHOT EXCLUDED', 'resolution for a May period end selects the eligible May snapshot instead',
    v_resolved = v_snap_eligible);

  /* ---------------------------------------------------------------------
   * 6. Historical integrity (rule 4): a Monthly report pinned at creation
   *    keeps that exact pin even after a NEWER snapshot publishes for the
   *    same project and period. A fresh resolution differs; the existing
   *    report's pin does not move. Month 2026-07, period end 2026-07-31.
   * ------------------------------------------------------------------- */
  select public.publish_planning_snapshot(p_project_id := P_A, p_data_date := date '2026-07-05')
    into v_snap_early;

  select id into v_resolved_at_creation
    from public.planning_snapshots
   where project_id = P_A and data_date <= date '2026-07-31'
   order by data_date desc, version desc limit 1;
  perform pg_temp.chk(6, '6 NO RE-RESOLUTION', 'resolution at creation time finds the only snapshot published so far',
    v_resolved_at_creation = v_snap_early);

  insert into public.monthly_reports
    (project_id, report_number, reporting_month, status, planned_progress, actual_progress, planning_snapshot_id)
  values (P_A, 'ZZRT-M-NORERE-1', date '2026-07-01', 'draft', 0, 0, v_resolved_at_creation)
  returning id into v_monthly_norere;

  select public.publish_planning_snapshot(p_project_id := P_A, p_data_date := date '2026-07-20')
    into v_snap_late;

  select id into v_resolved_now
    from public.planning_snapshots
   where project_id = P_A and data_date <= date '2026-07-31'
   order by data_date desc, version desc limit 1;
  perform pg_temp.chk(6, '6 NO RE-RESOLUTION', 'a NEW resolution for the same period end now finds the later snapshot',
    v_resolved_now = v_snap_late, format('resolved %s, expected v_snap_late %s', v_resolved_now, v_snap_late));

  select planning_snapshot_id into v_pinned_after
    from public.monthly_reports where id = v_monthly_norere;
  perform pg_temp.chk(6, '6 NO RE-RESOLUTION', 'the EXISTING Monthly report''s pin is unchanged by the later publish',
    v_pinned_after = v_snap_early, format('pinned %s, expected the original %s', v_pinned_after, v_snap_early));
  perform pg_temp.chk(6, '6 NO RE-RESOLUTION', 'the existing report''s pin genuinely differs from what a new resolution would find now',
    v_pinned_after <> v_resolved_now);

  /* ---------------------------------------------------------------------
   * 7. Project isolation.
   * ------------------------------------------------------------------- */
  perform pg_temp.chk(7, '7 PROJECT ISOLATION', 'fixture: a second project exists to isolate against',
    P_B is not null);

  select count(*) into v_n
    from public.monthly_reports
   where project_id = P_A and id in (select id from public.monthly_reports where project_id = P_B);
  perform pg_temp.chk(7, '7 PROJECT ISOLATION', 'no monthly report id is shared between the two projects',
    v_n = 0);

  /* ---------------------------------------------------------------------
   * 8. No regression: Full/Published Portfolio Read and the genuinely
   *    unassigned identity behave exactly as they do on weekly_reports.
   * ------------------------------------------------------------------- */
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000e5","role":"authenticated"}';
  select count(*) into v_n from public.monthly_reports where id = v_report_pcm;
  perform pg_temp.chk(8, '8 NO REGRESSION', 'Full Portfolio Read still sees a draft report regardless of status',
    v_n = 1);

  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000e6","role":"authenticated"}';
  select count(*) into v_n from public.monthly_reports where id = v_report_pcm;
  perform pg_temp.chk(8, '8 NO REGRESSION', 'Published Portfolio Read still does NOT see a draft report',
    v_n = 0);

  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000e4","role":"authenticated"}';
  select count(*) into v_n from public.monthly_reports where project_id = P_A;
  perform pg_temp.chk(8, '8 NO REGRESSION', 'the genuinely unassigned identity still sees zero rows on this project',
    v_n = 0, format('%s rows', v_n));

end $t$;

/* Published Portfolio Read, narrower branch: a fresh row inserted directly
 * as 'finalized' (as postgres — the lifecycle guard trigger only fires on
 * UPDATE) proves the rewritten policy's published-tier branch still
 * resolves correctly once a row genuinely qualifies. */
reset role;
insert into public.monthly_reports
  (project_id, report_number, reporting_month, status, planned_progress, actual_progress)
select id, 'ZZRT-M-FINALIZED-1', date '2026-08-01', 'finalized', 0, 0
  from public.projects where code = 'ZZ-P0TEST-PRJ';

do $t2$
declare
  v_n int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000e6","role":"authenticated"}';
  select count(*) into v_n from public.monthly_reports where report_number = 'ZZRT-M-FINALIZED-1';
  perform pg_temp.chk(8, '8 NO REGRESSION', 'Published Portfolio Read sees a genuinely finalized report (the published-tier branch still works)',
    v_n = 1);
end $t2$;

reset role;

select seq, area, item, verdict from r order by seq, area, item;

select count(*) filter (where verdict like 'PASS%') as pass,
       count(*) filter (where verdict like 'FAIL%') as fail
  from r;

rollback;

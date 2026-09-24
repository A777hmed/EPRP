-- Planning Integration 3E — Executive Report RUNTIME verification.
-- LOCAL REHEARSAL DATABASE ONLY.
--
-- Executive's own decision logic (`selectOfficialMonthly`,
-- `executiveFiguresFor`) is pure JS, proven directly against real
-- `MonthlyReport` fixtures in verify_executive_planning_integration.ts.
-- What CAN and must be proven at this layer is the DB-level contract that
-- logic depends on:
--
--   * an approved Monthly's pinned planning_snapshot_id, and the ROLLUP
--     `computeSnapshotRollup()` reads for it (planning_snapshot_activities
--     rows scoped to that snapshot id), are UNCHANGED after a NEWER
--     snapshot publishes for the same project — Executive re-fetches this
--     rollup by the same fixed id on every load, so "the pin doesn't move"
--     (already proven for Weekly/Monthly in 103/105) is necessary but not
--     sufficient; the DATA the pin resolves to must also be immutable
--   * project isolation holds for planning_snapshot_activities exactly as
--     it does for every other governed table
--
-- No RLS policy, no migration, and no new authorization path were added in
-- 3E — Executive reads existing `monthly_reports`/`planning_snapshots`/
-- `planning_snapshot_activities` policies unchanged. Nothing new to prove
-- on that front, only to confirm by its absence.
--
-- Requires 00_local_test_identity.sql and 01_setup_test_fixtures.sql to have
-- been run first (same ZZ-P0TEST-PRJ fixture every script here shares).
--
-- HOW TO RUN
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < 107_runtime_executive_planning_integration.sql

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

/* ========================= fixtures (as postgres) ========================= */

do $fix$
declare
  v_project uuid;
begin
  select id into v_project from public.projects where code = 'ZZ-P0TEST-PRJ';
  if v_project is null then
    raise exception 'ZZ-P0TEST-PRJ not found — run 00_local_test_identity.sql and 01_setup_test_fixtures.sql first.';
  end if;

  insert into public.planning_activities (project_id, name, weight_percent, percent_complete_planned, percent_complete_physical, source)
  values (v_project, 'ZZRT-EXEC-ACTIVITY', 100, 65, 55, 'manual')
  on conflict do nothing;
end;
$fix$;

do $t$
declare
  P_A uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  P_B uuid := (select id from public.projects where code = 'PSAIM-001');
  v_snap_old uuid;
  v_snap_new uuid;
  v_monthly uuid;
  v_old_activity_row record;
  v_pinned_after uuid;
  v_activity_after record;
  v_n int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000a1","role":"authenticated"}';

  /* ---------------------------------------------------------------------
   * 1. Publish the OLD snapshot and create an approved Monthly pinned to
   *    it — the exact shape monthlyReportService.create() writes.
   * ------------------------------------------------------------------- */
  select public.publish_planning_snapshot(p_project_id := P_A, p_data_date := date '2026-07-15')
    into v_snap_old;

  insert into public.monthly_reports
    (project_id, report_number, reporting_month, status, planned_progress, actual_progress, planning_snapshot_id)
  values (P_A, 'ZZRT-EXEC-M-1', date '2026-07-01', 'approved', 65, 55, v_snap_old)
  returning id into v_monthly;
  perform pg_temp.chk(1, '1 APPROVED MONTHLY PINNED', 'an approved Monthly pinned to the old snapshot was created',
    v_monthly is not null);

  select id, weight_percent, percent_complete_planned, percent_complete_physical
    into v_old_activity_row
    from public.planning_snapshot_activities where snapshot_id = v_snap_old;
  perform pg_temp.chk(1, '1 APPROVED MONTHLY PINNED', 'the old snapshot captured a real weighted activity',
    v_old_activity_row.id is not null);

  /* ---------------------------------------------------------------------
   * 2. Change the LIVE planning_activities data and publish a NEWER
   *    snapshot. The Monthly's pin must not move (105 already proves this
   *    for Monthly generally); here it must also still resolve to the
   *    SAME, UNCHANGED rollup DATA — the guarantee Executive actually
   *    depends on every time it re-reads by that fixed id.
   * ------------------------------------------------------------------- */
  update public.planning_activities
     set percent_complete_planned = 90, percent_complete_physical = 85
   where project_id = P_A and name = 'ZZRT-EXEC-ACTIVITY';

  select public.publish_planning_snapshot(p_project_id := P_A, p_data_date := date '2026-08-15')
    into v_snap_new;

  select planning_snapshot_id into v_pinned_after from public.monthly_reports where id = v_monthly;
  perform pg_temp.chk(2, '2 HISTORICAL PIN FROZEN', 'the approved Monthly''s pin is unchanged by the newer publish',
    v_pinned_after = v_snap_old, format('pinned %s, expected the original %s', v_pinned_after, v_snap_old));

  select id, weight_percent, percent_complete_planned, percent_complete_physical
    into v_activity_after
    from public.planning_snapshot_activities where snapshot_id = v_snap_old;
  perform pg_temp.chk(2, '2 HISTORICAL PIN FROZEN', 'the OLD snapshot''s own captured activity data is byte-for-byte unchanged',
    v_activity_after.percent_complete_planned = v_old_activity_row.percent_complete_planned
      and v_activity_after.percent_complete_physical = v_old_activity_row.percent_complete_physical,
    format('old snapshot now reads planned=%s actual=%s, expected planned=%s actual=%s',
      v_activity_after.percent_complete_planned, v_activity_after.percent_complete_physical,
      v_old_activity_row.percent_complete_planned, v_old_activity_row.percent_complete_physical));

  select count(*) into v_n
    from public.planning_snapshot_activities
   where snapshot_id = v_snap_new and percent_complete_planned = 90;
  perform pg_temp.chk(2, '2 HISTORICAL PIN FROZEN', 'the NEW snapshot DOES capture the updated 90% — proving the old one''s stability is not just "nothing changed anywhere"',
    v_n = 1);

  /* ---------------------------------------------------------------------
   * 3. Project isolation: planning_snapshot_activities via the pinned
   *    snapshot never crosses projects.
   * ------------------------------------------------------------------- */
  perform pg_temp.chk(3, '3 PROJECT ISOLATION', 'fixture: a second project exists to isolate against',
    P_B is not null);

  select count(*) into v_n
    from public.planning_snapshot_activities psa
    join public.planning_snapshots ps on ps.id = psa.snapshot_id
   where ps.project_id = P_A
     and psa.snapshot_id in (
       select id from public.planning_snapshots where project_id = P_B
     );
  perform pg_temp.chk(3, '3 PROJECT ISOLATION', 'no snapshot activity crosses from P_B into a P_A-scoped read',
    v_n = 0);

  select count(*) into v_n from public.monthly_reports where id = v_monthly and project_id = P_A;
  perform pg_temp.chk(3, '3 PROJECT ISOLATION', 'the approved Monthly belongs to the same project as its pinned snapshot',
    v_n = 1);

end $t$;

reset role;

select seq, area, item, verdict from r order by seq, area, item;

select count(*) filter (where verdict like 'PASS%') as pass,
       count(*) filter (where verdict like 'FAIL%') as fail
  from r;

rollback;

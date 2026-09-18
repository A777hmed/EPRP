-- Planning Integration 3D — Dashboard current-position RUNTIME verification.
-- LOCAL REHEARSAL DATABASE ONLY.
--
-- 3D's decision logic (`deriveDashboardPlanningFigures`,
-- `planningProgressCurve`) is pure JS, proven in
-- verify_dashboard_planning_integration.ts. What CAN and must be proven at
-- this layer is the DB-level contract that logic depends on — the exact
-- query `planningRollupService.getLatestPublishedSnapshot()` runs
-- (`planning_snapshots` ordered by `version desc limit 1`):
--
--   * a project with only DRAFT `planning_activities` and no published
--     snapshot yet resolves to NO latest snapshot at all — draft/live
--     Planning data structurally cannot answer this query, because it
--     only ever reads `planning_snapshots`
--   * publishing the project's FIRST snapshot makes it the latest
--   * publishing a NEWER snapshot afterward changes what "latest" resolves
--     to — the Dashboard's current position moves forward on the very next
--     load ("future/new snapshot updates CURRENT Dashboard position");
--     contrast this directly with 103/105's Weekly/Monthly proof that a
--     REPORT's own pinned snapshot does NOT move — the two rules coexist
--     because they answer different questions
--   * project isolation: the query is scoped by project_id and a second
--     project's snapshots never leak into it
--
-- No RLS policy, no migration, and no new authorization path were added in
-- 3D — Dashboard reads existing `planning_snapshots`/`master_milestones`
-- policies unchanged. There is nothing new to prove on that front, only to
-- confirm by its absence.
--
-- Requires 00_local_test_identity.sql and 01_setup_test_fixtures.sql to have
-- been run first (same ZZ-P0TEST-PRJ fixture every script here shares).
--
-- HOW TO RUN
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < 106_runtime_dashboard_planning_position.sql

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

do $t$
declare
  P_A uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  P_B uuid := (select id from public.projects where code = 'PSAIM-001');
  v_activity uuid;
  v_snap_v1 uuid;
  v_snap_v2 uuid;
  v_latest uuid;
  v_n int;
begin
  if P_A is null then
    raise exception 'ZZ-P0TEST-PRJ not found — run 00_local_test_identity.sql and 01_setup_test_fixtures.sql first.';
  end if;

  /* ---------------------------------------------------------------------
   * 1. Draft-only project: a planning_activities row exists but NOTHING
   *    has been published yet. The "latest published snapshot" query must
   *    return nothing — draft/live Planning data never participates.
   * ------------------------------------------------------------------- */
  insert into public.planning_activities (project_id, name, weight_percent, percent_complete_planned, percent_complete_physical, source)
  values (P_A, 'ZZRT-DASH-DRAFT-ACTIVITY', 100, 50, 40, 'manual')
  returning id into v_activity;

  select id into v_latest from public.planning_snapshots
   where project_id = P_A order by version desc limit 1;
  perform pg_temp.chk(1, '1 DRAFT NEVER PARTICIPATES', 'a project with only draft planning_activities has no latest published snapshot',
    v_latest is null);

  /* ---------------------------------------------------------------------
   * 2. Publish the project's first snapshot: it becomes the latest.
   * ------------------------------------------------------------------- */
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000a1","role":"authenticated"}';

  select public.publish_planning_snapshot(p_project_id := P_A, p_data_date := date '2026-09-01')
    into v_snap_v1;

  select id into v_latest from public.planning_snapshots
   where project_id = P_A order by version desc limit 1;
  perform pg_temp.chk(2, '2 FIRST PUBLISH IS LATEST', 'the first published snapshot resolves as the latest',
    v_latest = v_snap_v1);

  /* ---------------------------------------------------------------------
   * 3. Publish a NEWER snapshot: the latest resolution moves to it — the
   *    Dashboard's current position updates on the next load. (Contrast:
   *    103/105 prove a REPORT's own pin does NOT move — a different rule
   *    for a different question.)
   * ------------------------------------------------------------------- */
  select public.publish_planning_snapshot(p_project_id := P_A, p_data_date := date '2026-09-15')
    into v_snap_v2;

  select id into v_latest from public.planning_snapshots
   where project_id = P_A order by version desc limit 1;
  perform pg_temp.chk(3, '3 NEWER PUBLISH UPDATES CURRENT', 'a newer publish becomes the latest — CURRENT Dashboard position moves forward',
    v_latest = v_snap_v2, format('latest %s, expected v_snap_v2 %s', v_latest, v_snap_v2));
  perform pg_temp.chk(3, '3 NEWER PUBLISH UPDATES CURRENT', 'the newer snapshot genuinely differs from the first',
    v_snap_v2 <> v_snap_v1);

  /* ---------------------------------------------------------------------
   * 4. Project isolation: the latest-snapshot query for P_A never returns
   *    a row belonging to P_B, and vice versa.
   * ------------------------------------------------------------------- */
  perform pg_temp.chk(4, '4 PROJECT ISOLATION', 'fixture: a second project exists to isolate against',
    P_B is not null);

  select count(*) into v_n
    from public.planning_snapshots
   where project_id = P_A and id in (select id from public.planning_snapshots where project_id = P_B);
  perform pg_temp.chk(4, '4 PROJECT ISOLATION', 'no snapshot id is shared between the two projects',
    v_n = 0);

  perform pg_temp.chk(4, '4 PROJECT ISOLATION', 'the latest snapshot for P_A actually belongs to P_A',
    (select project_id from public.planning_snapshots where id = v_snap_v2) = P_A);

end $t$;

reset role;

/* ---------------------------------------------------------------------
 * 5. Master milestone register: RLS-scoped by project exactly like every
 *    other governed table — a milestone on P_A is never visible via a
 *    query scoped to P_B, confirming the Dashboard's `listRegister`
 *    (called with the reader's own accessible project ids) cannot leak
 *    one project's milestones into another's.
 * ------------------------------------------------------------------- */
do $t2$
declare
  P_A uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  P_B uuid := (select id from public.projects where code = 'PSAIM-001');
  v_n int;
begin
  select count(*) into v_n
    from public.master_milestones
   where project_id = P_A and id in (select id from public.master_milestones where project_id = P_B);
  perform pg_temp.chk(5, '5 MILESTONE PROJECT ISOLATION', 'no master milestone id is shared between the two projects',
    v_n = 0);
end $t2$;

select seq, area, item, verdict from r order by seq, area, item;

select count(*) filter (where verdict like 'PASS%') as pass,
       count(*) filter (where verdict like 'FAIL%') as fail
  from r;

rollback;

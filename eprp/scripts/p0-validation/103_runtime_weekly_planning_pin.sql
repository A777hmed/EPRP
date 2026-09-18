-- Planning Integration 3B — Weekly snapshot pinning. RUNTIME verification.
-- LOCAL REHEARSAL DATABASE ONLY.
--
-- 3B's creation/update logic itself lives in
-- src/services/supabase-weekly-report-service.ts (plain JS orchestration,
-- not a database function), so it cannot be exercised by a SQL script the
-- way publish_planning_snapshot() can. What CAN and must be proven at this
-- layer is the DB-level contract that logic depends on:
--
--   * a weekly_reports row's planning_snapshot_id, once set, is never
--     touched by a later snapshot publish for the same project — the pin
--     is real, not merely "whatever getSnapshotForPeriod returns right now"
--   * a NEW resolution for the same project/period, run AFTER a later
--     snapshot exists, genuinely differs from what an EXISTING pinned
--     report holds — the concrete case rule 3 ("never re-resolve latest
--     for an existing report") exists to prevent
--   * project isolation continues to hold for this join
--   * the FK still refuses a non-existent snapshot id (unchanged from
--     Slice 1 — reconfirmed here because this suite is what a reviewer
--     will actually run for 3B)
--
-- No migration, no RLS policy, and no new authorization path were added in
-- 3B — there is nothing new to prove on that front, only to confirm by its
-- absence (see the accompanying review).
--
-- Requires 00_local_test_identity.sql and 01_setup_test_fixtures.sql to have
-- been run first (same ZZ-P0TEST-PRJ fixture every script here shares).
--
-- HOW TO RUN
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < 103_runtime_weekly_planning_pin.sql

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
end;
$fix$;

/* ============================= the test run ================================ */

do $t$
declare
  P_A uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  P_B uuid := (select id from public.projects where code = 'PSAIM-001');
  v_snap_early uuid; v_snap_late uuid;
  v_weekly uuid;
  v_resolved_at_creation uuid; v_resolved_now uuid;
  v_pinned_after uuid;
  v_n int;
begin

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000c3","role":"authenticated"}';

  /* ---------------------------------------------------------------------
   * 1. Two published snapshots, ordered in time — the "existing report"
   *    scenario: a report is created and pinned while only the early one
   *    exists.
   * ------------------------------------------------------------------- */
  select public.publish_planning_snapshot(p_project_id := P_A, p_data_date := date '2026-09-01')
    into v_snap_early;

  select id into v_resolved_at_creation
    from public.planning_snapshots
   where project_id = P_A and data_date <= date '2026-09-05'
   order by data_date desc, version desc limit 1;
  perform pg_temp.chk(1, '1 PIN AT CREATION', 'resolution at creation time finds the only snapshot published so far',
    v_resolved_at_creation = v_snap_early);

  -- The application's create() would insert this weekly_reports row with
  -- planning_snapshot_id = v_resolved_at_creation. Reproduced directly here
  -- since the orchestration itself lives in JS, not in a database function.
  --
  -- INSERT ... RETURNING deliberately avoided: a separately-noted, pre-
  -- existing quirk makes weekly_reports' RETURNING-clause RLS check
  -- (weekly_report_viewable, via the SELECT policy) fail for a Project-
  -- Control-Manager-only identity even though a plain INSERT followed by a
  -- separate SELECT both succeed, and the same RETURNING succeeds outright
  -- for a global admin identity. Reproduced and confirmed unrelated to any
  -- 3B change (no weekly_reports policy touched this slice) — flagged
  -- separately rather than worked around silently in application code.
  insert into public.weekly_reports
    (project_id, report_number, status, source, week_number, period_start, period_end,
     planned_progress, actual_progress, planning_snapshot_id)
  values
    (P_A, 'ZZRT-W-PIN-1', 'draft', 'platform', 36, date '2026-08-30', date '2026-09-05',
     0, 0, v_resolved_at_creation);
  select id into v_weekly from public.weekly_reports where report_number = 'ZZRT-W-PIN-1';
  perform pg_temp.chk(1, '1 PIN AT CREATION', 'the weekly report is pinned to the resolved snapshot',
    v_weekly is not null);

  /* ---------------------------------------------------------------------
   * 2. A LATER, more current snapshot is published for the SAME project.
   *    A brand-new resolution for the SAME period end must now find it —
   *    but the EXISTING report's pin must not move.
   * ------------------------------------------------------------------- */
  select public.publish_planning_snapshot(p_project_id := P_A, p_data_date := date '2026-09-04')
    into v_snap_late;

  select id into v_resolved_now
    from public.planning_snapshots
   where project_id = P_A and data_date <= date '2026-09-05'
   order by data_date desc, version desc limit 1;
  perform pg_temp.chk(2, '2 NO RE-RESOLUTION', 'a NEW resolution for the same period end now finds the later snapshot',
    v_resolved_now = v_snap_late, format('resolved %s, expected v_snap_late %s', v_resolved_now, v_snap_late));

  select planning_snapshot_id into v_pinned_after
    from public.weekly_reports where id = v_weekly;
  perform pg_temp.chk(2, '2 NO RE-RESOLUTION', 'the EXISTING weekly report''s pin is unchanged by the later publish',
    v_pinned_after = v_snap_early, format('pinned %s, expected the original %s', v_pinned_after, v_snap_early));
  perform pg_temp.chk(2, '2 NO RE-RESOLUTION', 'the existing report''s pin genuinely differs from what a new resolution would find now',
    v_pinned_after <> v_resolved_now);

  /* ---------------------------------------------------------------------
   * 3. Project isolation: the resolution this report was pinned through
   *    is always scoped to its own project.
   * ------------------------------------------------------------------- */
  perform pg_temp.chk(3, '3 PROJECT ISOLATION', 'fixture: a second project exists to isolate against',
    P_B is not null);

  select count(*) into v_n
    from public.planning_snapshots
   where project_id = P_A and id in (select id from public.planning_snapshots where project_id = P_B);
  perform pg_temp.chk(3, '3 PROJECT ISOLATION', 'no snapshot id is shared between the two projects',
    v_n = 0);

  select count(*) into v_n from public.weekly_reports
   where id = v_weekly and project_id = P_A;
  perform pg_temp.chk(3, '3 PROJECT ISOLATION', 'the pinned weekly report belongs to the same project as its snapshot',
    v_n = 1);

  /* ---------------------------------------------------------------------
   * 4. FK integrity unchanged from Slice 1.
   * ------------------------------------------------------------------- */
  perform pg_temp.must_fail(4, '4 FK INTEGRITY', 'planning_snapshot_id rejects a non-existent snapshot id',
    format('update public.weekly_reports set planning_snapshot_id = %L where id = %L',
           gen_random_uuid(), v_weekly));

end $t$;

reset role;

select seq, area, item, verdict from r order by seq, area, item;

select count(*) filter (where verdict like 'PASS%') as pass,
       count(*) filter (where verdict like 'FAIL%') as fail
  from r;

rollback;

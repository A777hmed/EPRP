-- Weekly Report P0 fix — RUNTIME verification. LOCAL REHEARSAL DATABASE ONLY.
--
-- Proves 20260916000001_weekly_report_returning_rls_fix.sql:
--   * an assigned Project Control Manager CAN create a Weekly Report —
--     INSERT ... RETURNING (the exact shape PostgREST's
--     .insert().select().single() issues) succeeds, and a separate
--     follow-up SELECT of the created row also succeeds
--   * an UNASSIGNED identity on the same project still CANNOT (the
--     weekly_reports_insert WITH CHECK is untouched by this fix — this
--     proves the fix did not broaden it)
--   * an assigned Reporting Coordinator CAN create one too — the same
--     bug silently broke this role as well (is_report_coordinator is one
--     of has_operational_project_access's OR-branches), now restored
--   * a Planning-backed create (planning_snapshot_id set, the real 3B
--     create() shape) succeeds via INSERT ... RETURNING without the
--     manual-insert-as-postgres workaround 3B's own browser check needed
--   * Full Portfolio Read still sees the row regardless of status
--     (unaffected: has_full_portfolio_read() OR's in ahead of anything
--     this fix changed)
--   * Published Portfolio Read still sees ONLY a finalized/locked row,
--     never a draft — the exact narrower branch this fix rewrote, proven
--     to still behave identically
--   * the genuinely unassigned identity still sees zero rows — no
--     visibility broadened by this fix
--
-- Requires 00_local_test_identity.sql and 01_setup_test_fixtures.sql to have
-- been run first (same ZZ-P0TEST-PRJ fixture every script here shares).
--
-- HOW TO RUN
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < 104_runtime_weekly_report_p0_fix.sql

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
     'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-0000000000a7',
     'authenticated', 'authenticated', 'p0test.coordinator@example.invalid',
     'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())
  on conflict (id) do nothing;

  insert into public.contacts (name, email, department_id)
  select 'ZZ-P0TEST Planning Manager', 'p0test.planning-mgr@example.invalid', d.id
    from public.departments d where d.code = 'ZZ-P0TEST-DEPT'
  on conflict do nothing;
  insert into public.contacts (name, email)
  values ('ZZ-P0TEST Unassigned', 'p0test.unassigned@example.invalid')
  on conflict do nothing;
  insert into public.contacts (name, email, department_id)
  select 'ZZ-P0TEST Coordinator', 'p0test.coordinator@example.invalid', d.id
    from public.departments d where d.code = 'ZZ-P0TEST-DEPT'
  on conflict do nothing;

  -- c3: Project Control Manager on ZZ-P0TEST-PRJ, unscoped.
  insert into public.project_contacts (project_id, contact_id, role)
  select v_project, c.id, 'project_control_manager'
    from public.contacts c where c.name = 'ZZ-P0TEST Planning Manager'
  on conflict do nothing;
  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select '00000000-0000-4000-a000-0000000000c3', 'p0test.planning-mgr@example.invalid',
         'ZZ-P0TEST Planning Manager', 'viewer', c.id, true
    from public.contacts c where c.name = 'ZZ-P0TEST Planning Manager'
  on conflict (id) do nothing;

  -- d4: genuinely unassigned — a contact never in project_contacts anywhere.
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

  -- g7: Reporting Coordinator on ZZ-P0TEST-PRJ, unscoped.
  insert into public.project_contacts (project_id, contact_id, role)
  select v_project, c.id, 'reporting_coordinator'
    from public.contacts c where c.name = 'ZZ-P0TEST Coordinator'
  on conflict do nothing;
  insert into public.profiles (id, email, full_name, role, contact_id, active)
  select '00000000-0000-4000-a000-0000000000a7', 'p0test.coordinator@example.invalid',
         'ZZ-P0TEST Coordinator', 'viewer', c.id, true
    from public.contacts c where c.name = 'ZZ-P0TEST Coordinator'
  on conflict (id) do nothing;

  -- Planning onboarding, needed for the Planning-backed creation proof.
  insert into public.project_planning_settings (project_id, onboarding_mode)
  values (v_project, 'existing_active_project')
  on conflict (project_id) do update set onboarding_mode = excluded.onboarding_mode;
end;
$fix$;

/* ============================= the test run ================================ */

do $t$
declare
  P_A uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  v_report_pcm uuid;
  v_report_coord uuid;
  v_snap uuid;
  v_report_planning uuid;
  v_read_back text;
  v_n int;
begin

  /* ---------------------------------------------------------------------
   * 1. Assigned Project Control Manager: INSERT ... RETURNING succeeds,
   *    and a separate follow-up SELECT also succeeds.
   * ------------------------------------------------------------------- */
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000c3","role":"authenticated"}';

  begin
    insert into public.weekly_reports
      (project_id, report_number, status, source, week_number, period_start, period_end,
       planned_progress, actual_progress)
    values (P_A, 'ZZRT-P0-PCM-1', 'draft', 'platform', 40, date '2026-09-27', date '2026-10-01', 0, 0)
    returning id into v_report_pcm;
    perform pg_temp.chk(1, '1 PCM CREATE', 'INSERT ... RETURNING succeeds for an assigned Project Control Manager',
      v_report_pcm is not null);
  exception when others then
    perform pg_temp.chk(1, '1 PCM CREATE', 'INSERT ... RETURNING succeeds for an assigned Project Control Manager',
      false, 'raised: ' || left(sqlerrm, 120));
  end;

  if v_report_pcm is not null then
    select report_number into v_read_back from public.weekly_reports where id = v_report_pcm;
    perform pg_temp.chk(1, '1 PCM CREATE', 'a separate follow-up SELECT of the created row also succeeds',
      v_read_back = 'ZZRT-P0-PCM-1');
  end if;

  /* ---------------------------------------------------------------------
   * 2. Unassigned identity on the same project: still refused. The
   *    WITH CHECK this exercises (weekly_reports_insert) is untouched by
   *    the fix — this proves nothing was broadened.
   * ------------------------------------------------------------------- */
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000d4","role":"authenticated"}';

  perform pg_temp.must_fail(2, '2 UNASSIGNED REFUSED', 'an unassigned identity cannot create a Weekly Report on this project',
    format('insert into public.weekly_reports (project_id, report_number, status, source, week_number, period_start, period_end, planned_progress, actual_progress) values (%L, %L, %L, %L, %L, %L, %L, %L, %L)',
           P_A, 'ZZRT-P0-UNASSIGNED', 'draft', 'platform', 40, date '2026-09-27', date '2026-10-01', 0, 0));

  /* ---------------------------------------------------------------------
   * 3. Assigned Reporting Coordinator: was ALSO silently broken by the
   *    same bug (is_report_coordinator is one of
   *    has_operational_project_access's OR-branches) — now restored.
   * ------------------------------------------------------------------- */
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000a7","role":"authenticated"}';

  begin
    insert into public.weekly_reports
      (project_id, report_number, status, source, week_number, period_start, period_end,
       planned_progress, actual_progress)
    values (P_A, 'ZZRT-P0-COORD-1', 'draft', 'platform', 41, date '2026-10-04', date '2026-10-08', 0, 0)
    returning id into v_report_coord;
    perform pg_temp.chk(3, '3 COORDINATOR CREATE', 'INSERT ... RETURNING succeeds for an assigned Reporting Coordinator',
      v_report_coord is not null);
  exception when others then
    perform pg_temp.chk(3, '3 COORDINATOR CREATE', 'INSERT ... RETURNING succeeds for an assigned Reporting Coordinator',
      false, 'raised: ' || left(sqlerrm, 120));
  end;

  /* ---------------------------------------------------------------------
   * 4. Planning-backed creation (the real 3B create() shape: a report
   *    row that ALSO sets planning_snapshot_id) succeeds via
   *    INSERT ... RETURNING — no manual-insert-as-postgres workaround
   *    needed now.
   * ------------------------------------------------------------------- */
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000c3","role":"authenticated"}';

  select public.publish_planning_snapshot(p_project_id := P_A, p_data_date := date '2026-10-18')
    into v_snap;

  begin
    insert into public.weekly_reports
      (project_id, report_number, status, source, week_number, period_start, period_end,
       planned_progress, actual_progress, planning_snapshot_id)
    values (P_A, 'ZZRT-P0-PLANNING-1', 'draft', 'platform', 43, date '2026-10-18', date '2026-10-22', 70, 60, v_snap)
    returning id into v_report_planning;
    perform pg_temp.chk(4, '4 PLANNING-BACKED CREATE', 'INSERT ... RETURNING succeeds with planning_snapshot_id set (the real create() shape)',
      v_report_planning is not null);
  exception when others then
    perform pg_temp.chk(4, '4 PLANNING-BACKED CREATE', 'INSERT ... RETURNING succeeds with planning_snapshot_id set (the real create() shape)',
      false, 'raised: ' || left(sqlerrm, 120));
  end;

  if v_report_planning is not null then
    select planning_snapshot_id into v_snap from public.weekly_reports where id = v_report_planning;
    perform pg_temp.chk(4, '4 PLANNING-BACKED CREATE', 'the pin persists and reads back correctly',
      v_snap is not null);
  end if;

  /* ---------------------------------------------------------------------
   * 5. No regression: Full/Published Portfolio Read and the genuinely
   *    unassigned identity behave exactly as before.
   * ------------------------------------------------------------------- */
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000e5","role":"authenticated"}';
  select count(*) into v_n from public.weekly_reports where id = v_report_pcm;
  perform pg_temp.chk(5, '5 NO REGRESSION', 'Full Portfolio Read still sees a draft report regardless of status',
    v_n = 1);

  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000f6","role":"authenticated"}';
  select count(*) into v_n from public.weekly_reports where id = v_report_pcm;
  perform pg_temp.chk(5, '5 NO REGRESSION', 'Published Portfolio Read still does NOT see a draft report',
    v_n = 0);

  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000d4","role":"authenticated"}';
  select count(*) into v_n from public.weekly_reports where project_id = P_A;
  perform pg_temp.chk(5, '5 NO REGRESSION', 'the genuinely unassigned identity still sees zero rows on this project',
    v_n = 0, format('%s rows', v_n));

end $t$;

/* Published Portfolio Read, narrower branch: a fresh row inserted directly
 * as 'finalized' (as postgres — the lifecycle guard trigger only fires on
 * UPDATE, and walking the real transition graph is out of scope for this
 * check) proves the rewritten policy's published-tier branch
 * (has_published_portfolio_read() and weekly_report_completed(status))
 * still resolves correctly once a row genuinely qualifies. */
reset role;
insert into public.weekly_reports
  (project_id, report_number, status, source, week_number, period_start, period_end,
   planned_progress, actual_progress)
select id, 'ZZRT-P0-FINALIZED-1', 'finalized', 'platform', 42, date '2026-10-11', date '2026-10-15', 0, 0
  from public.projects where code = 'ZZ-P0TEST-PRJ';

do $t2$
declare
  v_n int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"00000000-0000-4000-a000-0000000000f6","role":"authenticated"}';
  select count(*) into v_n from public.weekly_reports where report_number = 'ZZRT-P0-FINALIZED-1';
  perform pg_temp.chk(5, '5 NO REGRESSION', 'Published Portfolio Read sees a genuinely finalized report (the published-tier branch still works)',
    v_n = 1);
end $t2$;

reset role;

select seq, area, item, verdict from r order by seq, area, item;

select count(*) filter (where verdict like 'PASS%') as pass,
       count(*) filter (where verdict like 'FAIL%') as fail
  from r;

rollback;

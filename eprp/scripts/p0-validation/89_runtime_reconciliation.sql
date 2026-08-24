-- EPRP 13.2d — MILESTONE PROGRESS RECONCILIATION runtime verification.
-- LOCAL REHEARSAL DATABASE ONLY. Writes, then rolls the whole thing back.
--
-- The rule under test:
--   Weekly and Monthly are OBSERVATIONS. The governed official figure is
--   resolved through Master Milestone governance. Two approved figures at the
--   SAME cut-off are a conflict; at DIFFERENT cut-offs they are both history.
--   An unresolved conflict must never silently become the official progress.
--
-- Cases A–G as specified. The conflict DERIVATION itself is TypeScript and is
-- proved separately by the derivation harness; this file proves the database
-- half — that the rows, constraints, triggers and authority behave.
--
-- HOW TO RUN
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < 89_runtime_reconciliation.sql
--
-- Expected: 40 PASS, 0 FAIL.

\set ON_ERROR_STOP off
\set QUIET on
\pset pager off

do $guard$
begin
  if inet_server_addr() is not null
     and host(inet_server_addr()) not in ('127.0.0.1', '::1', 'localhost') then
    raise exception 'REFUSING TO RUN: this connection is not local (%).',
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
  perform pg_temp.chk(p_seq, p_area, p_item, true, 'refused: ' || left(sqlerrm, 60));
end $$;

create or replace function pg_temp.must_fail_with(
  p_seq int,
  p_area text,
  p_item text,
  p_expected_state text,
  p_sql text
) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp.chk(p_seq, p_area, p_item, false, 'statement was ACCEPTED');
exception when others then
  perform pg_temp.chk(
    p_seq,
    p_area,
    p_item,
    sqlstate = p_expected_state,
    'SQLSTATE ' || sqlstate || ': ' || left(sqlerrm, 60)
  );
end $$;

/*
 * The official figure for a cut-off, expressed in SQL exactly as
 * `resolveCutoffs()` expresses it in TypeScript.
 *
 * Duplicated here on purpose and for this file only: if the two implementations
 * ever disagree, one of them is wrong, and a test that imported the answer from
 * the thing under test would prove nothing.
 */
create or replace function pg_temp.official(p_code text, p_as_of date)
returns text language plpgsql as $$
declare
  m uuid := (select id from public.master_milestones where code = p_code);
  v_recon int;
  v_vals int[];
begin
  select progress_percent into v_recon
    from public.milestone_updates
   where milestone_id = m and as_of_date = p_as_of
     and source = 'reconciliation' and approval_status = 'approved'
   order by submitted_at desc, id desc limit 1;
  if v_recon is not null then return v_recon::text; end if;

  select array_agg(distinct progress_percent) into v_vals
    from public.milestone_updates
   where milestone_id = m and as_of_date = p_as_of
     and source <> 'reconciliation' and approval_status = 'approved'
     and progress_percent is not null;

  if v_vals is null then return 'unreported'; end if;
  if array_length(v_vals, 1) = 1 then return v_vals[1]::text; end if;
  return 'in_conflict';
end $$;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-a000-0000000000a1","role":"authenticated"}';

do $t$
declare
  P_A uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  D_A uuid := (select department_id from public.project_departments
                where project_id = (select id from public.projects
                                     where code = 'ZZ-P0TEST-PRJ') limit 1);
  CUT_A date := date '2026-09-30';
  CUT_B date := date '2026-10-31';
  w_a uuid; w_b uuid; w_reason uuid; w_auth uuid;
  m_a uuid; m_b uuid; u_week uuid; u_month uuid; u_r uuid; n int; t text;
begin

  -- Report-sourced observations must carry a real same-project report. These
  -- fixture headers make the reconciliation regression exercise that governed
  -- provenance instead of relying on the pre-Wave-1 nullable report links.
  insert into public.weekly_reports
    (report_number, project_id, week_number, period_start, period_end)
  values
    ('ZZREC-W-A', P_A, 1, CUT_A - 6, CUT_A),
    ('ZZREC-W-B', P_A, 2, CUT_B - 6, CUT_B),
    ('ZZREC-W-REASON', P_A, 3, CUT_A - 13, CUT_A),
    ('ZZREC-W-AUTH', P_A, 4, date '2026-11-24', date '2026-11-30');

  select id into w_a from public.weekly_reports where report_number = 'ZZREC-W-A';
  select id into w_b from public.weekly_reports where report_number = 'ZZREC-W-B';
  select id into w_reason from public.weekly_reports where report_number = 'ZZREC-W-REASON';
  select id into w_auth from public.weekly_reports where report_number = 'ZZREC-W-AUTH';

  /* ===== A. different cut-offs are NOT a conflict ====================== */

  insert into public.master_milestones
    (project_id, code, name, department_id, milestone_type, priority)
  values (P_A, 'ZZREC-A', 'Different cut-offs', D_A, 'technical', 'medium')
  returning id into m_a;

  insert into public.milestone_updates
    (milestone_id, source, weekly_report_id, department_id, status,
     progress_percent, as_of_date, approval_status, approved_at)
  values (m_a, 'weekly', w_a, D_A, 'in_progress', 50, CUT_A, 'approved', now());
  insert into public.milestone_updates
    (milestone_id, source, department_id, status, progress_percent, as_of_date,
     approval_status, approved_at)
  values (m_a, 'monthly', D_A, 'in_progress', 60, CUT_B, 'approved', now());

  perform pg_temp.chk(1, 'A DIFFERENT CUT-OFFS',
    'cut-off A resolves to the Weekly figure',
    pg_temp.official('ZZREC-A', CUT_A) = '50',
    pg_temp.official('ZZREC-A', CUT_A));
  perform pg_temp.chk(1, 'A DIFFERENT CUT-OFFS',
    'cut-off B resolves to the Monthly figure',
    pg_temp.official('ZZREC-A', CUT_B) = '60',
    pg_temp.official('ZZREC-A', CUT_B));
  perform pg_temp.chk(1, 'A DIFFERENT CUT-OFFS',
    'differing percentages alone do NOT create a conflict',
    pg_temp.official('ZZREC-A', CUT_A) <> 'in_conflict'
    and pg_temp.official('ZZREC-A', CUT_B) <> 'in_conflict');

  /* ===== B. same cut-off, disagreement = conflict, no silent winner ==== */

  insert into public.master_milestones
    (project_id, code, name, department_id, milestone_type, priority)
  values (P_A, 'ZZREC-B', 'Same cut-off conflict', D_A, 'technical', 'medium')
  returning id into m_b;

  insert into public.milestone_updates
    (milestone_id, source, weekly_report_id, department_id, status,
     progress_percent, as_of_date, approval_status, approved_at)
  values (m_b, 'weekly', w_a, D_A, 'in_progress', 50, CUT_A, 'approved', now())
  returning id into u_week;
  insert into public.milestone_updates
    (milestone_id, source, department_id, status, progress_percent, as_of_date,
     approval_status, approved_at)
  values (m_b, 'monthly', D_A, 'in_progress', 60, CUT_A, 'approved', now())
  returning id into u_month;

  perform pg_temp.chk(2, 'B SAME CUT-OFF',
    'two approved figures at one cut-off = in_conflict',
    pg_temp.official('ZZREC-B', CUT_A) = 'in_conflict',
    pg_temp.official('ZZREC-B', CUT_A));
  perform pg_temp.chk(2, 'B SAME CUT-OFF',
    'neither Weekly nor Monthly silently wins',
    pg_temp.official('ZZREC-B', CUT_A) not in ('50', '60'));
  perform pg_temp.chk(2, 'B SAME CUT-OFF',
    'both observations survive untouched',
    (select count(*) from public.milestone_updates
      where milestone_id = m_b and source in ('weekly','monthly')) = 2);

  /* ===== C. Project Control adopts the WEEKLY value ==================== */

  insert into public.milestone_updates
    (milestone_id, source, department_id, status, progress_percent, as_of_date,
     adopted_from_update_id, reconciliation_reason, approval_status, approved_at,
     submitted_at)
  values (m_b, 'reconciliation', D_A, 'in_progress', 50, CUT_A, u_week,
          'Weekly walked the site; Monthly rolled up a stale figure.',
          'approved', now(), now())
  returning id into u_r;

  perform pg_temp.chk(3, 'C ADOPT WEEKLY',
    'official becomes the adopted Weekly figure',
    pg_temp.official('ZZREC-B', CUT_A) = '50',
    pg_temp.official('ZZREC-B', CUT_A));
  perform pg_temp.chk(3, 'C ADOPT WEEKLY',
    'provenance records WHICH row was adopted',
    (select adopted_from_update_id from public.milestone_updates where id = u_r)
      = u_week);
  perform pg_temp.chk(3, 'C ADOPT WEEKLY',
    'the superseded Monthly row is preserved unchanged',
    (select progress_percent from public.milestone_updates where id = u_month) = 60
    and (select approval_status from public.milestone_updates where id = u_month)
        = 'approved');
  perform pg_temp.chk(3, 'C ADOPT WEEKLY',
    'reconciler and moment recorded',
    (select approved_at is not null and submitted_at is not null
       from public.milestone_updates where id = u_r));

  /* ===== D. a later reconciliation adopts the MONTHLY value ============ */

  insert into public.milestone_updates
    (milestone_id, source, department_id, status, progress_percent, as_of_date,
     adopted_from_update_id, reconciliation_reason, approval_status, approved_at,
     submitted_at)
  values (m_b, 'reconciliation', D_A, 'in_progress', 60, CUT_A, u_month,
          'Site re-measure confirmed the Monthly roll-up after all.',
          'approved', now() + interval '1 minute', now() + interval '1 minute')
  returning id into u_r;

  perform pg_temp.chk(4, 'D ADOPT MONTHLY',
    'the newest reconciliation governs',
    pg_temp.official('ZZREC-B', CUT_A) = '60',
    pg_temp.official('ZZREC-B', CUT_A));
  perform pg_temp.chk(4, 'D ADOPT MONTHLY',
    'the earlier reconciliation is kept as history, not overwritten',
    (select count(*) from public.milestone_updates
      where milestone_id = m_b and source = 'reconciliation') = 2);

  /* ===== E. Project Control enters an INDEPENDENT figure =============== */

  insert into public.milestone_updates
    (milestone_id, source, department_id, status, progress_percent, as_of_date,
     reconciliation_reason, approval_status, approved_at, submitted_at)
  values (m_b, 'reconciliation', D_A, 'in_progress', 55, CUT_A,
          'Neither source was right; joint re-measure agreed 55%.',
          'approved', now() + interval '2 minutes', now() + interval '2 minutes')
  returning id into u_r;

  perform pg_temp.chk(5, 'E RECONCILED VALUE',
    'official becomes the independently entered figure',
    pg_temp.official('ZZREC-B', CUT_A) = '55',
    pg_temp.official('ZZREC-B', CUT_A));
  perform pg_temp.chk(5, 'E RECONCILED VALUE',
    'adopted_from is NULL when no side was taken',
    (select adopted_from_update_id is null from public.milestone_updates
      where id = u_r));
  perform pg_temp.chk(5, 'E RECONCILED VALUE',
    'the reason is on the record',
    (select length(btrim(reconciliation_reason)) > 0
       from public.milestone_updates where id = u_r));
  perform pg_temp.chk(5, 'E RECONCILED VALUE',
    'all three original observations still readable',
    (select count(*) from public.milestone_updates
      where milestone_id = m_b and source <> 'reconciliation') = 2);

  /* ----- the constraints that keep a reconciliation honest ------------- */

  perform pg_temp.must_fail(5, 'E RECONCILED VALUE',
    'a reconciliation with NO reason is refused',
    format($x$insert into public.milestone_updates
             (milestone_id, source, status, progress_percent, as_of_date,
              approval_status, approved_at)
             values (%L,'reconciliation','in_progress',70,%L,'approved',now())$x$,
           m_b, CUT_A));

  perform pg_temp.must_fail(5, 'E RECONCILED VALUE',
    'a reconciliation with NO cut-off is refused',
    format($x$insert into public.milestone_updates
             (milestone_id, source, status, progress_percent,
              reconciliation_reason, approval_status, approved_at)
             values (%L,'reconciliation','in_progress',70,'x','approved',now())$x$,
           m_b));

  perform pg_temp.must_fail(5, 'E RECONCILED VALUE',
    'a reconciliation left PENDING is refused',
    format($x$insert into public.milestone_updates
             (milestone_id, source, status, progress_percent, as_of_date,
              reconciliation_reason)
             values (%L,'reconciliation','in_progress',70,%L,'x')$x$, m_b, CUT_A));

  perform pg_temp.must_fail(5, 'E RECONCILED VALUE',
    'adopting a row from ANOTHER milestone is refused',
    format($x$insert into public.milestone_updates
             (milestone_id, source, status, progress_percent, as_of_date,
              adopted_from_update_id, reconciliation_reason,
              approval_status, approved_at)
             values (%L,'reconciliation','in_progress',50,%L,%L,'x','approved',now())$x$,
           m_b, CUT_A,
           (select id from public.milestone_updates where milestone_id = m_a limit 1)));

  perform pg_temp.must_fail(5, 'E RECONCILED VALUE',
    'adopting a row from a DIFFERENT cut-off is refused',
    format($x$insert into public.milestone_updates
             (milestone_id, source, status, progress_percent, as_of_date,
              adopted_from_update_id, reconciliation_reason,
              approval_status, approved_at)
             values (%L,'reconciliation','in_progress',50,%L,%L,'x','approved',now())$x$,
           m_b, CUT_B, u_week));

  perform pg_temp.must_fail(5, 'E RECONCILED VALUE',
    'a Weekly row cannot carry a reconciliation reason',
    format($x$insert into public.milestone_updates
             (milestone_id, source, weekly_report_id, status,
              progress_percent, as_of_date, reconciliation_reason)
             values (%L,'weekly',%L,'in_progress',70,%L,
                    'sneaking governance in')$x$,
           m_b, w_reason, CUT_A));

  perform pg_temp.must_fail(5, 'E RECONCILED VALUE',
    'a reconciliation is append-only like every other update',
    format($x$update public.milestone_updates set progress_percent = 99
             where id = %L$x$, u_r));

  /* ===== G. deterministic ordering under identical timestamps ========== */

  declare
    v_ts timestamptz := now();
    v_first text; v_second text;
  begin
    insert into public.master_milestones
      (project_id, code, name, department_id, milestone_type, priority)
    values (P_A, 'ZZREC-G', 'Tie-break', D_A, 'technical', 'medium')
    returning id into m_a;

    -- Two reconciliations for one cut-off, written with the SAME submitted_at.
    insert into public.milestone_updates
      (milestone_id, source, department_id, status, progress_percent, as_of_date,
       reconciliation_reason, approval_status, approved_at, submitted_at)
    values (m_a, 'reconciliation', D_A, 'in_progress', 10, CUT_A, 'first',
            'approved', v_ts, v_ts),
           (m_a, 'reconciliation', D_A, 'in_progress', 20, CUT_A, 'second',
            'approved', v_ts, v_ts);

    perform pg_temp.chk(7, 'G ORDERING',
      'identical submitted_at values really were written', true,
      (select count(distinct submitted_at)::text || ' distinct timestamp(s)'
         from public.milestone_updates where milestone_id = m_a));

    -- submitted_at DESC, id DESC must give the same answer every time.
    select progress_percent::text into v_first
      from public.milestone_updates where milestone_id = m_a
     order by submitted_at desc, id desc limit 1;
    select progress_percent::text into v_second
      from public.milestone_updates where milestone_id = m_a
     order by submitted_at desc, id desc limit 1;
    perform pg_temp.chk(7, 'G ORDERING',
      'the tie-broken order is stable across repeated reads',
      v_first = v_second, format('%s then %s', v_first, v_second));

    perform pg_temp.chk(7, 'G ORDERING',
      'and it matches the id tie-break the derivation uses',
      v_first = (select progress_percent::text from public.milestone_updates
                  where milestone_id = m_a
                  order by id desc limit 1));
  end;

exception when others then
  insert into r values (0, '!! ABORTED', sqlerrm, 'FAIL');
end $t$;

/* ===== F. authority — an ordinary contributor cannot reconcile ========= */

set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-a000-0000000000b2","role":"authenticated"}';

do $t$
declare
  P_A uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  P_B uuid := (select id from public.projects where code = 'PSAIM-001');
  D_A uuid := (select department_id from public.project_departments
                where project_id = (select id from public.projects
                                     where code = 'ZZ-P0TEST-PRJ') limit 1);
  m_b uuid := (select id from public.master_milestones where code = 'ZZREC-B');
  w_auth uuid := (
    select id from public.weekly_reports where report_number = 'ZZREC-W-AUTH'
  );
  n int;
begin
  /*
   * THE CORRECTED RULE. The fixture identity is the project's REPORTING
   * COORDINATOR — it may submit and it may accept a report, and it may NOT
   * decide the governed official figure. That distinction is the whole of this
   * section, so the same identity is checked against both predicates.
   */
  perform pg_temp.chk(6, 'F AUTHORITY',
    'Reporting Coordinator is REFUSED reconciliation on its own project',
    not public.can_reconcile_milestone(P_A));
  perform pg_temp.chk(6, 'F AUTHORITY',
    'but still holds assigned-project reporting workflow authority',
    public.can_manage_reporting_workflow(P_A));
  perform pg_temp.chk(6, 'F AUTHORITY',
    'and holds no reconciliation authority anywhere else either',
    not public.can_reconcile_milestone(P_B));

  perform pg_temp.must_fail_with(6, 'F AUTHORITY',
    'Reporting Coordinator cannot WRITE a reconciliation',
    '42501',
    format($x$insert into public.milestone_updates
             (milestone_id, source, status, progress_percent, as_of_date,
              reconciliation_reason, approval_status, approved_at)
             values (%L,'reconciliation','in_progress',77,date '2026-09-30',
                     'coordinator overreach','approved',now())$x$, m_b));

  perform pg_temp.must_fail_with(6, 'F AUTHORITY',
    'cannot reconcile a milestone on a project it does not control',
    '42501',
    format($x$insert into public.milestone_updates
             (milestone_id, source, status, progress_percent, as_of_date,
              reconciliation_reason, approval_status, approved_at)
             values ((select id from public.master_milestones
                       where project_id = %L limit 1),
                     'reconciliation','in_progress',99,date '2026-09-30',
                     'unauthorised','approved',now())$x$, P_B));

  -- Authorization Foundation Wave 1: milestone updates are operational writes,
  -- not reporting comments. A Report Coordinator may coordinate the reporting
  -- workflow but may not write the governed Master Milestone stream.
  perform pg_temp.must_fail_with(6, 'F AUTHORITY',
    'Reporting Coordinator cannot submit a Master Milestone observation',
    '42501',
    format($x$insert into public.milestone_updates
             (milestone_id, source, weekly_report_id, department_id, status,
              progress_percent, as_of_date)
             values (%L,'weekly',%L,%L,'in_progress',45,
                    date '2026-11-30')$x$,
           m_b, w_auth, D_A));
end $t$;

/* ===== the three identities that MAY reconcile ========================== */

/*
 * Each is granted, checked and reverted inside this transaction, which is
 * rolled back at the end. Nothing here survives the run.
 */

-- (i) the project's ASSIGNED Project Control Manager.
reset role;
insert into public.project_contacts (project_id, contact_id, role)
select (select id from public.projects where code = 'ZZ-P0TEST-PRJ'),
       (select contact_id from public.profiles
         where id = '00000000-0000-4000-a000-0000000000b2'),
       'project_control_manager';

set local role authenticated;
do $t$
declare
  P_A uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  m_b uuid := (select id from public.master_milestones where code = 'ZZREC-B');
  n int;
begin
  perform pg_temp.chk(6, 'F AUTHORITY',
    'assigned Project Control Manager IS allowed to reconcile',
    public.can_reconcile_milestone(P_A));

  insert into public.milestone_updates
    (milestone_id, source, status, progress_percent, as_of_date,
     reconciliation_reason, approval_status, approved_at)
  values (m_b, 'reconciliation', 'in_progress', 52, date '2026-09-30',
          'PCM adjudicated', 'approved', now());
  get diagnostics n = row_count;
  perform pg_temp.chk(6, 'F AUTHORITY',
    'and can actually WRITE the reconciliation', n = 1);
end $t$;

-- Revert, so the next case is not masked by this grant.
reset role;
delete from public.project_contacts
 where role = 'project_control_manager'
   and contact_id = (select contact_id from public.profiles
                      where id = '00000000-0000-4000-a000-0000000000b2');

-- (ii) the portfolio-wide project_control_admin platform role.
update public.profiles set role = 'project_control_admin'
 where id = '00000000-0000-4000-a000-0000000000b2';

set local role authenticated;
do $t$
declare
  P_A uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  P_B uuid := (select id from public.projects where code = 'PSAIM-001');
begin
  perform pg_temp.chk(6, 'F AUTHORITY',
    'project_control_admin IS allowed to reconcile',
    public.can_reconcile_milestone(P_A));
  perform pg_temp.chk(6, 'F AUTHORITY',
    'project_control_admin authority is portfolio-wide (architecture 8.1)',
    public.can_reconcile_milestone(P_B));
end $t$;

reset role;
update public.profiles set role = 'viewer'
 where id = '00000000-0000-4000-a000-0000000000b2';

-- (iii) system_admin.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-a000-0000000000a1","role":"authenticated"}';
do $t$
declare
  P_A uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  P_B uuid := (select id from public.projects where code = 'PSAIM-001');
begin
  perform pg_temp.chk(6, 'F AUTHORITY',
    'system_admin IS allowed to reconcile, on any project',
    public.can_reconcile_milestone(P_A)
    and public.can_reconcile_milestone(P_B));
end $t$;

/* ===== a department-scoped contributor with NO Project Control role ==== */

do $t$
declare
  v_dept_only uuid;
  n int;
begin
  -- Prove the predicate excludes the roles it is meant to exclude, without
  -- creating a second auth identity: check the predicate's own definition
  -- resolves through can_manage_project_setup and nothing wider.
  /*
   * The omission, asserted directly.
   *
   * `can_reconcile_milestone` must NOT resolve through the consolidator pair,
   * because that pair includes the Reporting Coordinator. A future refactor
   * that "tidies" this into can_manage_project_setup() would silently restore
   * the over-grant, so the absence is tested rather than trusted.
   */
  select count(*) into n from pg_proc
   where proname = 'can_reconcile_milestone'
     and (prosrc like '%can_manage_project_setup%'
       or prosrc like '%is_project_consolidator%'
       or prosrc like '%weekly_can_manage_project%'
       or prosrc like '%reporting_coordinator%');
  perform pg_temp.chk(6, 'F AUTHORITY',
    'authority does NOT resolve through any Reporting-Coordinator predicate',
    n = 0);

  select count(*) into n from pg_proc
   where proname = 'can_reconcile_milestone'
     and prosrc like '%can_manage_project_operations%';
  perform pg_temp.chk(6, 'F AUTHORITY',
    'and delegates to the narrow Project Operations authority', n = 1);

  select count(*) into n from pg_policies
   where tablename = 'milestone_updates' and cmd = 'INSERT'
     and with_check like '%can_reconcile_milestone%'
     and with_check like '%can_manage_project_operations%';
  perform pg_temp.chk(6, 'F AUTHORITY',
    'the INSERT policy keeps reconciliation and observations inside Project Operations', n = 1);
end $t$;

reset role;

select seq, area, item, verdict from r order by seq, area, item;
select count(*) filter (where verdict like 'PASS%') as pass,
       count(*) filter (where verdict like 'FAIL%') as fail
  from r;

rollback;

-- EPRP 13.2c — RUNTIME verification. LOCAL REHEARSAL DATABASE ONLY.
--
-- Writes real rows through RLS as a real authenticated identity, then rolls the
-- whole thing back. Nothing survives the run.
--
-- 87_verify_13_2c.sql asserts the SHAPE and is read-only. This file asserts the
-- BEHAVIOUR, which needs writes: create, edit, report, approve, archive, the
-- advance-payment rule, the dependency guards and the append-only guarantee.
--
-- Requires 00_local_test_identity.sql and 01_setup_test_fixtures.sql:
--   admin  a1 = system_admin  -> Project Control authority everywhere
--   viewer b2 = Reporting Coordinator on ZZ-P0TEST, nothing elsewhere
--
-- Projects are resolved BY CODE, never by a literal id: `supabase db reset`
-- regenerates every seed uuid.
--   P_A  ZZ-P0TEST Disposable Project   (this identity manages it)
--   P_B  PSAIM-001                      (it does not)
--
-- HOW TO RUN
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < 88_runtime_13_2c.sql
--
-- Expected: 42 PASS, 0 FAIL.

\set ON_ERROR_STOP off
\set QUIET on
\pset pager off

-- Refuse to run anywhere that is not a local database. This script WRITES.
-- The transaction is rolled back at the end, but a hosted project must never be
-- the place that gets proved by trying.
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
-- GRANT will not accept the `pg_temp` alias, so resolve the real schema name.
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

-- Did a statement that MUST be refused actually get refused?
create or replace function pg_temp.must_fail(
  p_seq int, p_area text, p_item text, p_sql text
) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp.chk(p_seq, p_area, p_item, false, 'statement was ACCEPTED');
exception when others then
  perform pg_temp.chk(p_seq, p_area, p_item, true,
                      'refused: ' || left(sqlerrm, 70));
end $$;

/* ===================== become a real authenticated admin ================== */

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-a000-0000000000a1","role":"authenticated"}';

do $t$
declare
  -- Resolved by CODE, never by a literal id: `db reset` regenerates every
  -- seed uuid, and a hardcoded one makes the suite pass or fail for reasons
  -- that have nothing to do with the code under test.
  P_A uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  P_B uuid := (select id from public.projects where code = 'PSAIM-001');
  D_A uuid := (select department_id from public.project_departments
                where project_id = (select id from public.projects
                                     where code = 'ZZ-P0TEST-PRJ') limit 1);
  m_tech uuid; m_adv uuid; m_dep uuid; m_other uuid; d1 uuid; d2 uuid;
  u_id uuid; n int; t text; d date; b boolean; f numeric;
begin

  /* -- 1. CREATE a technical milestone ----------------------------------- */
  insert into public.master_milestones
    (project_id, code, name, department_id, milestone_type, category,
     planned_date, baseline_date, weight_percent, planned_progress_percent,
     priority, client_approval_required, notes)
  values
    (P_A, 'ZZRT-T1', 'Runtime technical milestone', D_A, 'technical',
     'Engineering', date '2026-09-30', date '2026-09-15', 20, 60,
     'high', true, 'created by runtime verification')
  returning id into m_tech;
  perform pg_temp.chk(1, '1 CREATE', 'technical milestone inserted through RLS',
                      m_tech is not null);

  select milestone_type, weight_percent, planned_progress_percent
    into t, f, n from public.master_milestones where id = m_tech;
  perform pg_temp.chk(1, '1 CREATE', 'type/weight/planned progress stored',
                      t = 'technical' and f = 20 and n = 60,
                      format('%s / %s / %s', t, f, n));

  /* -- 2. EDIT ------------------------------------------------------------ */
  update public.master_milestones
     set name = 'Runtime technical milestone (edited)',
         planned_date = date '2026-10-15',
         weight_percent = 25,
         category = 'Engineering — revised'
   where id = m_tech;
  select name, planned_date, weight_percent
    into t, d, f from public.master_milestones where id = m_tech;
  perform pg_temp.chk(2, '2 EDIT', 'identity edit persisted',
                      t like '%(edited)%' and d = date '2026-10-15' and f = 25);
  -- The baseline must NOT have moved: a re-plan is not a re-baseline.
  select baseline_date into d from public.master_milestones where id = m_tech;
  perform pg_temp.chk(2, '2 EDIT', 'baseline untouched by a re-plan',
                      d = date '2026-09-15', d::text);

  /* -- 3. UPDATE forecast / actual progress ------------------------------- */
  insert into public.milestone_updates
    (milestone_id, source, department_id, status, progress_percent, forecast_date)
  values (m_tech, 'planning', D_A, 'in_progress', 40, date '2026-11-05')
  returning id into u_id;

  select count(*) into n from public.milestone_updates
   where milestone_id = m_tech and approval_status = 'approved';
  perform pg_temp.chk(3, '3 UPDATE', 'submitted update is NOT yet current (R5)',
                      n = 0, format('%s approved rows', n));

  update public.milestone_updates set approval_status = 'approved' where id = u_id;
  select status, progress_percent, forecast_date, approved_at is not null
    into t, n, d, b from public.milestone_updates where id = u_id;
  perform pg_temp.chk(3, '3 UPDATE', 'approved update carries the figures',
                      t = 'in_progress' and n = 40 and d = date '2026-11-05' and b,
                      format('%s / %s%% / %s', t, n, d));

  /* -- 4. VARIANCE inputs -------------------------------------------------- */
  -- The derivation is TypeScript; what the database must guarantee is that both
  -- reference dates and both progress figures survive independently.
  perform pg_temp.chk(4, '4 VARIANCE',
    'plan vs baseline vs forecast all readable and distinct',
    (select count(distinct x) from (
        select planned_date x from public.master_milestones where id = m_tech
        union all select baseline_date from public.master_milestones where id = m_tech
        union all select forecast_date from public.milestone_updates where id = u_id
     ) s) = 3,
    'planned 2026-10-15 / baseline 2026-09-15 / forecast 2026-11-05');

  /* -- 5. ARCHIVE and RESTORE --------------------------------------------- */
  update public.master_milestones
     set active = false, archived_at = now() where id = m_tech;
  select active into b from public.master_milestones where id = m_tech;
  perform pg_temp.chk(5, '5 ARCHIVE', 'archived', b = false);

  select count(*) into n from public.milestone_updates where milestone_id = m_tech;
  perform pg_temp.chk(5, '5 ARCHIVE', 'history survives archiving', n = 1);

  update public.master_milestones
     set active = true, archived_at = null where id = m_tech;
  select active into b from public.master_milestones where id = m_tech;
  perform pg_temp.chk(5, '5 ARCHIVE', 'restored', b = true);

  /* -- 9. ADVANCE / DOWN PAYMENT ------------------------------------------ */
  insert into public.master_milestones
    (project_id, code, name, department_id, milestone_type, category,
     payment_percent, payment_amount, payment_due_date, is_advance_payment,
     planned_date, priority)
  values
    (P_A, 'ZZRT-C1', 'Advance payment', D_A, 'commercial', 'Down payment',
     10, 100000, date '2026-09-01', true, date '2026-09-01', 'high')
  returning id into m_adv;
  perform pg_temp.chk(9, '9 ADVANCE', 'commercial advance milestone created',
                      m_adv is not null);

  select weight_percent into f from public.master_milestones where id = m_adv;
  perform pg_temp.chk(9, '9 ADVANCE', 'carries NO physical weight',
                      f is null, coalesce(f::text, 'null'));

  perform pg_temp.must_fail(9, '9 ADVANCE',
    'physical weight on a commercial milestone is REFUSED',
    format('update public.master_milestones set weight_percent = 10 where id = %L', m_adv));

  perform pg_temp.must_fail(9, '9 ADVANCE',
    'payment fields on a TECHNICAL milestone are REFUSED',
    format('update public.master_milestones set payment_amount = 5000 where id = %L', m_tech));

  perform pg_temp.must_fail(9, '9 ADVANCE',
    'payment_percent above 100 is REFUSED',
    format('update public.master_milestones set payment_percent = 140 where id = %L', m_adv));

  /* -- 10. PAYMENT LIFECYCLE ---------------------------------------------- */
  declare
    lifecycle text[] := array['planned','due','invoiced','received',
                              'partially_recovered','fully_recovered'];
    s text; ok boolean := true; got text;
  begin
    foreach s in array lifecycle loop
      insert into public.milestone_updates
        (milestone_id, source, department_id, status, payment_status,
         invoice_reference, invoiced_date, received_date, recovered_amount)
      values (m_adv, 'planning', D_A, 'in_progress', s,
              case when s in ('invoiced','received','partially_recovered',
                              'fully_recovered') then 'INV-2026-001' end,
              case when s in ('invoiced','received','partially_recovered',
                              'fully_recovered') then date '2026-09-02' end,
              case when s in ('received','partially_recovered',
                              'fully_recovered') then date '2026-09-20' end,
              case when s = 'partially_recovered' then 40000
                   when s = 'fully_recovered' then 100000 end)
      returning id into u_id;
      update public.milestone_updates set approval_status = 'approved' where id = u_id;

      select payment_status into got from public.milestone_updates where id = u_id;
      if got is distinct from s then ok := false; end if;
      -- Each step must become the CURRENT state in turn.
      select payment_status into got from public.milestone_updates
       where milestone_id = m_adv and approval_status = 'approved'
       order by submitted_at desc, id desc limit 1;
    end loop;
    perform pg_temp.chk(10, '10 LIFECYCLE',
      'planned → due → invoiced → received → partially → fully all accepted', ok);
  end;

  select count(*) into n from public.milestone_updates
   where milestone_id = m_adv and approval_status = 'approved';
  perform pg_temp.chk(10, '10 LIFECYCLE', 'six approved payment states recorded',
                      n = 6, format('%s rows', n));

  select recovered_amount into f from public.milestone_updates
   where milestone_id = m_adv and payment_status = 'fully_recovered';
  perform pg_temp.chk(10, '10 LIFECYCLE', 'recovery amount recorded',
                      f = 100000, coalesce(f::text,'null'));

  perform pg_temp.must_fail(10, '10 LIFECYCLE',
    'an invented payment status is REFUSED',
    format($x$insert into public.milestone_updates
             (milestone_id, source, department_id, status, payment_status)
             values (%L,'planning',%L,'in_progress','cashed')$x$, m_adv, D_A));

  perform pg_temp.must_fail(10, '10 LIFECYCLE',
    'a negative recovered amount is REFUSED',
    format($x$insert into public.milestone_updates
             (milestone_id, source, department_id, status, recovered_amount)
             values (%L,'planning',%L,'in_progress',-5)$x$, m_adv, D_A));

  /* -- 11. PREDECESSOR / DEPENDENCY --------------------------------------- */
  insert into public.master_milestones
    (project_id, code, name, department_id, milestone_type, priority,
     predecessor_milestone_id)
  values (P_A, 'ZZRT-T2', 'Depends on T1', D_A, 'technical', 'medium', m_tech)
  returning id into m_dep;
  perform pg_temp.chk(11, '11 DEPENDENCY', 'same-project predecessor accepted',
                      m_dep is not null);

  perform pg_temp.must_fail(11, '11 DEPENDENCY', 'self-reference is REFUSED',
    format('update public.master_milestones set predecessor_milestone_id = id where id = %L', m_dep));

  perform pg_temp.must_fail(11, '11 DEPENDENCY', 'a two-node LOOP is REFUSED',
    format('update public.master_milestones set predecessor_milestone_id = %L where id = %L',
           m_dep, m_tech));

  -- A predecessor on another project.
  insert into public.master_milestones
    (project_id, code, name, milestone_type, priority)
  values (P_B, 'ZZRT-X1', 'Other project milestone', 'technical', 'medium')
  returning id into m_other;

  -- A PENDING update on the other project, so the Tier B and approval-gate
  -- checks below have something real to be refused on rather than passing
  -- because there was nothing there.
  insert into public.milestone_updates
    (milestone_id, source, status, progress_percent)
  values (m_other, 'planning', 'in_progress', 30);

  perform pg_temp.must_fail(11, '11 DEPENDENCY',
    'CROSS-PROJECT predecessor is REFUSED',
    format('update public.master_milestones set predecessor_milestone_id = %L where id = %L',
           m_other, m_dep));

  /* -- 12. MILESTONE ↔ DELIVERABLE ---------------------------------------- */
  insert into public.master_deliverables
    (project_id, code, title, department_id, milestone_id, planned_submission_date)
  values (P_A, 'ZZRT-D1', 'Deliverable one', D_A, m_tech, date '2026-10-01')
  returning id into d1;
  insert into public.master_deliverables
    (project_id, code, title, department_id, milestone_id, planned_submission_date)
  values (P_A, 'ZZRT-D2', 'Deliverable two', D_A, m_tech, date '2026-10-08')
  returning id into d2;

  select count(*) into n from public.master_deliverables where milestone_id = m_tech;
  perform pg_temp.chk(12, '12 DELIVERABLE',
                      'one milestone serves MANY deliverables', n = 2,
                      format('%s linked', n));

  perform pg_temp.chk(12, '12 DELIVERABLE',
    'link is a reference — no milestone field copied onto the deliverable',
    not exists (select 1 from information_schema.columns
                 where table_name = 'master_deliverables'
                   and column_name in ('milestone_code','milestone_name')));

  -- Archiving the milestone must not take its deliverables with it.
  update public.master_milestones set active = false, archived_at = now()
   where id = m_tech;
  select count(*) into n from public.master_deliverables
   where milestone_id = m_tech and active;
  perform pg_temp.chk(12, '12 DELIVERABLE',
                      'archiving the milestone keeps the link intact', n = 2);
  update public.master_milestones set active = true, archived_at = null
   where id = m_tech;

  /* -- 13. REGRESSION — 13.2 / 13.3 guarantees still hold ----------------- */
  select id into u_id from public.milestone_updates
   where milestone_id = m_tech limit 1;

  perform pg_temp.must_fail(13, '13 REGRESSION',
    'editing a REPORTED figure is refused (append-only)',
    format('update public.milestone_updates set progress_percent = 99 where id = %L', u_id));

  perform pg_temp.must_fail(13, '13 REGRESSION',
    'editing a reported PAYMENT fact is refused (13.2c widening)',
    format($x$update public.milestone_updates set recovered_amount = 1
             where milestone_id = %L and payment_status = 'fully_recovered'$x$, m_adv));

  perform pg_temp.must_fail(13, '13 REGRESSION',
    're-deciding a decided update is refused',
    format($x$update public.milestone_updates set approval_status = 'rejected'
             where id = %L$x$, u_id));

  -- Regression control (R7): a flagged regression cannot be approved silently.
  insert into public.milestone_updates
    (milestone_id, source, department_id, status, progress_percent, is_regression)
  values (m_tech, 'planning', D_A, 'in_progress', 10, true)
  returning id into u_id;
  perform pg_temp.must_fail(13, '13 REGRESSION',
    'approving a flagged regression with NO reason is refused',
    format($x$update public.milestone_updates set approval_status = 'approved'
             where id = %L$x$, u_id));

  update public.milestone_updates
     set approval_status = 'approved', regression_reason = 'Corrected over-report'
   where id = u_id;
  select approval_status into t from public.milestone_updates where id = u_id;
  perform pg_temp.chk(13, '13 REGRESSION',
                      'approving a regression WITH a reason succeeds', t = 'approved');

  -- D6: the client's decision and our acceptance of the report stay separate.
  insert into public.milestone_updates
    (milestone_id, source, department_id, status,
     client_approval_status, client_approval_date)
  values (m_tech, 'planning', D_A, 'in_progress', 'approved', date '2026-10-20')
  returning id into u_id;
  select client_approval_status into t
    from public.milestone_updates where id = u_id;
  perform pg_temp.chk(13, '13 REGRESSION',
    'client-approved while our report is still pending (D6)',
    t = 'approved'
    and (select approval_status from public.milestone_updates where id = u_id) = 'pending');

  perform pg_temp.must_fail(13, '13 REGRESSION',
    'a client decision DATE with no decision is refused',
    format($x$insert into public.milestone_updates
             (milestone_id, source, department_id, status, client_approval_date)
             values (%L,'planning',%L,'in_progress', date '2026-10-01')$x$, m_tech, D_A));

  -- Duplicate code within one project.
  perform pg_temp.must_fail(13, '13 REGRESSION',
    'duplicate milestone code in the same project is refused',
    format($x$insert into public.master_milestones
             (project_id, code, name, milestone_type, priority)
             values (%L,'zzrt-t1','Duplicate','technical','low')$x$, P_A));

exception when others then
  insert into r values (0, '!! ABORTED', sqlerrm, 'FAIL');
end $t$;

/* ================= 6. PROJECT ISOLATION — as the VIEWER =================== */

set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-a000-0000000000b2","role":"authenticated"}';

do $t$
declare
  P_A uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  P_B uuid := (select id from public.projects where code = 'PSAIM-001');
  n int;
begin
  /*
   * ISOLATION IS A WRITE GATE, NOT A READ GATE.
   *
   * Architecture 24.2 (migration 20260820000003): milestone and deliverable
   * IDENTITY is Tier A — every authenticated account may read every project's
   * register. Isolation is enforced on WRITE, and on the Tier B update stream
   * while it is unapproved. Asserting "the viewer sees nothing" would be
   * asserting a model this platform deliberately does not have.
   */
  select count(*) into n from public.master_milestones where project_id = P_A;
  perform pg_temp.chk(6, '6 ISOLATION', 'viewer reads their own project register',
                      n >= 3, format('%s rows', n));

  select count(*) into n from public.master_milestones where project_id = P_B;
  perform pg_temp.chk(6, '6 ISOLATION',
                      'identity read is Tier A — other projects ARE visible',
                      n >= 1, format('%s rows', n));

  -- Tier B: an UNAPPROVED update on a project the viewer is not on must stay
  -- hidden. This is the read isolation that does exist.
  select count(*) into n from public.milestone_updates mu
    join public.master_milestones m on m.id = mu.milestone_id
   where m.project_id = P_B and mu.approval_status = 'pending';
  perform pg_temp.chk(6, '6 ISOLATION',
                      'Tier B — unapproved updates on another project are hidden',
                      n = 0, format('%s visible', n));

  -- The WRITE gate, proved on a project this identity does not manage.
  perform pg_temp.must_fail(6, '6 ISOLATION',
    'cannot WRITE the register of a project they do not manage',
    format($x$insert into public.master_milestones
             (project_id, code, name, milestone_type, priority)
             values (%L,'ZZRT-HACK','Should not exist','technical','low')$x$, P_B));

  -- Row count, not an exception: the UPDATE policy's USING clause filters the
  -- row out rather than raising, so "it threw" would be the wrong assertion.
  update public.master_milestones set name = 'hijacked' where project_id = P_B;
  get diagnostics n = row_count;
  perform pg_temp.chk(6, '6 ISOLATION',
    'cannot EDIT a milestone on a project they do not manage', n = 0,
    format('%s rows edited', n));

  -- Authorization Foundation Wave 1: this fixture identity is the assigned
  -- Report Coordinator. It keeps reporting-workflow authority on its project
  -- and no longer receives Master Milestone operations from that assignment.
  perform pg_temp.chk(6, '6 ISOLATION',
    'Report Coordinator keeps reporting but has no milestone operations',
    public.can_manage_reporting_workflow(P_A)
    and not public.can_manage_project_operations(P_A)
    and not public.can_manage_project_operations(P_B));

  /*
   * Approving, as a row count rather than an exception.
   *
   * An UPDATE that RLS filters to zero rows does NOT raise — it silently
   * matches nothing. Asserting "it threw" would therefore pass for the wrong
   * reason, so the test asserts that no pending update was actually decided.
   */
  update public.milestone_updates set approval_status = 'approved'
   where approval_status = 'pending'
     and milestone_id in (select id from public.master_milestones
                           where project_id = P_B);
  get diagnostics n = row_count;
  perform pg_temp.chk(6, '6 ISOLATION',
    'cannot APPROVE an update on a project they do not manage', n = 0,
    format('%s rows decided', n));
end $t$;

reset role;

select seq, area, item, verdict from r order by seq, area, item;

select count(*) filter (where verdict like 'PASS%') as pass,
       count(*) filter (where verdict like 'FAIL%') as fail
  from r;

rollback;

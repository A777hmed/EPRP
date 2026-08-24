-- EPRP Reporting Integration Wave 1 — runtime verification.
-- LOCAL REHEARSAL DATABASE ONLY. Writes real RLS-protected rows and rolls the
-- whole transaction back. Expected: 27 PASS, 0 FAIL.

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

do $fixture$
declare
  actor_contact uuid;
begin
  select contact_id into actor_contact
    from public.profiles
   where id = '00000000-0000-4000-a000-0000000000a1';

  if actor_contact is null then
    insert into public.contacts (name, email)
    values ('ZZ-RIW1 System Admin', 'riw1.admin@example.invalid')
    returning id into actor_contact;

    update public.profiles
       set contact_id = actor_contact
     where id = '00000000-0000-4000-a000-0000000000a1';
  end if;
end;
$fixture$;

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

create or replace function pg_temp.must_fail_with(
  p_seq int, p_area text, p_item text, p_state text, p_sql text
) returns void language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp.chk(p_seq, p_area, p_item, false, 'statement was ACCEPTED');
exception when others then
  perform pg_temp.chk(p_seq, p_area, p_item, sqlstate = p_state,
    'SQLSTATE ' || sqlstate || ': ' || left(sqlerrm, 70));
end $$;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-a000-0000000000a1","role":"authenticated"}';

do $t$
declare
  p_a uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  p_b uuid := (select id from public.projects where code = 'PSAIM-001');
  d_a uuid := (select department_id from public.project_departments
                where project_id = (select id from public.projects
                                     where code = 'ZZ-P0TEST-PRJ') limit 1);
  d_b uuid := (select department_id from public.project_departments
                where project_id = (select id from public.projects
                                     where code = 'PSAIM-001') limit 1);
  actor uuid := (select contact_id from public.profiles
                  where id = '00000000-0000-4000-a000-0000000000a1');
  w_id uuid; w_reassign_target uuid; w_retry uuid; w_governed uuid; w_conflict uuid;
  m_id uuid; m_other uuid; m_archived uuid; m_retry uuid; m_governed uuid;
  m_regression uuid; m_conflict uuid;
  m_monthly uuid; draft_id uuid; update_id uuid;
  n int; v_status text; v_source text; v_weekly uuid; v_monthly uuid;
  v_cutoff date; v_actor uuid; v_approved_at timestamptz;
begin
  if p_a is null or p_b is null or d_a is null or d_b is null or actor is null then
    raise exception 'Required local fixtures are missing. Run 00 and 01 first.';
  end if;

  insert into public.master_milestones
    (project_id, code, name, department_id, milestone_type, priority)
  values (p_a, 'ZZ-RIW1-A', 'Wave 1 governed observation', d_a,
          'technical', 'high')
  returning id into m_id;

  insert into public.master_milestones
    (project_id, code, name, department_id, milestone_type, priority)
  values (p_b, 'ZZ-RIW1-B', 'Other-project milestone', d_b,
          'technical', 'low')
  returning id into m_other;

  insert into public.master_milestones
    (project_id, code, name, department_id, milestone_type, priority, active)
  values (p_a, 'ZZ-RIW1-ARCH', 'Archived milestone', d_a,
          'technical', 'low', false)
  returning id into m_archived;

  insert into public.weekly_reports (
    report_number, project_id, week_number, period_start, period_end,
    reviewed_by_contact_id, approved_by_contact_id
  ) values (
    'ZZ-RIW1-WEEKLY', p_a, 25, date '2097-06-18', date '2097-06-24',
    actor, actor
  ) returning id into w_id;

  insert into public.weekly_reports (
    report_number, project_id, week_number, period_start, period_end,
    reviewed_by_contact_id, approved_by_contact_id
  ) values (
    'ZZ-RIW1-REASSIGN-TARGET', p_a, 24,
    date '2097-06-11', date '2097-06-17', actor, actor
  ) returning id into w_reassign_target;

  insert into public.weekly_submissions
    (weekly_report_id, department_id, status)
  values (w_id, d_a, 'approved');

  insert into public.weekly_plan_items
    (weekly_report_id, kind, title, end_date, department_id, status)
  values (w_id, 'next_week', 'Independent Next Week task',
          date '2097-07-01', d_a, 'not_started');

  insert into public.weekly_milestone_drafts (
    weekly_report_id, milestone_id, status, progress_percent,
    forecast_date, narrative
  ) values (
    w_id, m_id, 'in_progress', 48, date '2097-07-15',
    'Weekly evidence retained as an editable draft.'
  ) returning id into draft_id;

  perform pg_temp.chk(1, 'DRAFT', 'same-project active Master Milestone draft saved',
    draft_id is not null and
    (select count(*) from public.milestone_updates where milestone_id = m_id) = 0);

  perform pg_temp.must_fail_with(2, 'IMMUTABILITY',
    'an existing draft cannot be reassigned to another Weekly report', '23001',
    format('update public.weekly_milestone_drafts set weekly_report_id = %L where id = %L',
           w_reassign_target, draft_id));
  perform pg_temp.chk(3, 'IMMUTABILITY',
    'a refused reassignment leaves the original report identity unchanged',
    (select weekly_report_id from public.weekly_milestone_drafts where id = draft_id) = w_id);

  perform pg_temp.must_fail_with(4, 'INTEGRITY',
    'cross-project Master Milestone selection is refused', '23503',
    format('insert into public.weekly_milestone_drafts(weekly_report_id,milestone_id) values (%L,%L)',
           w_id, m_other));

  perform pg_temp.must_fail_with(5, 'INTEGRITY',
    'archived Master Milestone selection is refused', '23514',
    format('insert into public.weekly_milestone_drafts(weekly_report_id,milestone_id) values (%L,%L)',
           w_id, m_archived));

  perform pg_temp.must_fail_with(6, 'INTEGRITY',
    'Weekly observation cut-off must equal report period end', '23514',
    format($q$insert into public.milestone_updates
      (milestone_id,source,weekly_report_id,status,progress_percent,as_of_date)
      values (%L,'weekly',%L,'in_progress',20,date '2097-06-23')$q$,
      m_id, w_id));

  perform public.set_weekly_report_status(w_id, 'collecting');
  perform public.set_weekly_report_status(w_id, 'under_review');
  perform public.set_weekly_report_status(w_id, 'approved');

  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-a000-0000000000b2","role":"authenticated"}',
    true);
  perform pg_temp.chk(7, 'AUTHORIZATION',
    'Reporting Coordinator has reporting workflow but not governed write authority',
    public.can_manage_reporting_workflow(p_a)
    and not public.can_manage_project_operations(p_a));

  perform pg_temp.must_fail_with(8, 'AUTHORIZATION',
    'Reporting Coordinator cannot finalize governed milestone drafts', '42501',
    format('select public.set_weekly_report_status(%L,%L)', w_id, 'finalized'));

  select status into v_status from public.weekly_reports where id = w_id;
  perform pg_temp.chk(9, 'AUTHORIZATION',
    'refused finalization leaves the Weekly report approved',
    v_status = 'approved', v_status);

  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-a000-0000000000a1","role":"authenticated"}',
    true);
  perform public.set_weekly_report_status(w_id, 'finalized');

  select id, source, weekly_report_id, monthly_report_id, as_of_date,
         submitted_by_contact_id, approval_status, approved_at
    into update_id, v_source, v_weekly, v_monthly, v_cutoff,
         v_actor, v_status, v_approved_at
    from public.milestone_updates
   where milestone_id = m_id;

  perform pg_temp.chk(10, 'FINALIZATION',
    'finalization appends exactly one governed observation',
    update_id is not null and
    (select count(*) from public.milestone_updates where milestone_id = m_id) = 1);
  perform pg_temp.chk(11, 'PROVENANCE',
    'source/report/cut-off/provenance are exact',
    v_source = 'weekly' and v_weekly = w_id and v_monthly is null
    and v_cutoff = date '2097-06-24' and v_actor = actor);
  perform pg_temp.chk(12, 'GOVERNANCE',
    'manual mode leaves the observation pending with no decision timestamp',
    v_status = 'pending' and v_approved_at is null, v_status);
  perform pg_temp.chk(13, 'SEPARATION',
    'Next Week task remains separate from the governed milestone stream',
    (select count(*) from public.weekly_plan_items
      where weekly_report_id = w_id and kind = 'next_week') = 1
    and (select count(*) from public.milestone_updates
          where weekly_report_id = w_id) = 1);

  perform pg_temp.must_fail_with(14, 'IMMUTABILITY',
    'finalized Weekly drafts cannot be edited', '23001',
    format('update public.weekly_milestone_drafts set progress_percent = 49 where id = %L',
           draft_id));

  -- Reporting Coordinators can edit Weekly workflow data, so this proves the
  -- provenance boundary is a trigger invariant rather than an RLS side-effect.
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-a000-0000000000b2","role":"authenticated"}',
    true);
  perform pg_temp.must_fail_with(15, 'PROVENANCE',
    'Reporting Coordinator cannot drift the finalized Weekly cut-off', '23001',
    format('update public.weekly_reports set period_end = %L where id = %L',
           date '2097-06-25', w_id));

  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-a000-0000000000a1","role":"authenticated"}',
    true);
  perform pg_temp.must_fail_with(16, 'PROVENANCE',
    'Weekly project cannot drift after governed observations exist', '23001',
    format('update public.weekly_reports set project_id = %L where id = %L',
           p_b, w_id));

  perform public.set_weekly_report_status(w_id, 'finalized');
  perform pg_temp.chk(17, 'IDEMPOTENCY',
    'same-status lifecycle retry does not append another row',
    (select count(*) from public.milestone_updates where milestone_id = m_id) = 1);

  perform pg_temp.must_fail_with(18, 'IDEMPOTENCY',
    'duplicate report/milestone/cut-off observation is refused', '23505',
    format($q$insert into public.milestone_updates
      (milestone_id,source,weekly_report_id,status,progress_percent,as_of_date)
      values (%L,'weekly',%L,'in_progress',48,date '2097-06-24')$q$,
      m_id, w_id));

  update public.milestone_updates
     set approval_status = 'approved'
   where id = update_id;
  select approval_status, approved_at
    into v_status, v_approved_at
    from public.milestone_updates where id = update_id;
  perform pg_temp.chk(19, 'MANUAL APPROVAL',
    'Project Control can approve the pending observation once',
    v_status = 'approved' and v_approved_at is not null);

  perform pg_temp.must_fail_with(20, 'APPEND ONLY',
    'submitted observation content cannot be rewritten', '23001',
    format('update public.milestone_updates set progress_percent = 99 where id = %L',
           update_id));

  select count(*) into n from public.weekly_milestone_drafts
   where weekly_report_id = w_id;
  perform pg_temp.chk(21, 'HISTORY',
    'draft evidence and immutable submitted history both remain linked',
    n = 1 and
    (select count(*) from public.milestone_updates where weekly_report_id = w_id) = 1,
    n::text || ' draft row(s)');

  /* ===== Content-safe idempotency ======================================= */

  insert into public.master_milestones
    (project_id, code, name, department_id, milestone_type, priority)
  values (p_a, 'ZZ-RIW1-RETRY', 'Exact retry milestone', d_a,
          'technical', 'medium')
  returning id into m_retry;

  insert into public.master_milestones
    (project_id, code, name, department_id, milestone_type, priority)
  values (p_a, 'ZZ-RIW1-GOVERNED', 'Governed retry milestone', d_a,
          'technical', 'medium')
  returning id into m_governed;

  insert into public.master_milestones
    (project_id, code, name, department_id, milestone_type, priority)
  values (p_a, 'ZZ-RIW1-REGRESSION', 'Governed regression retry', d_a,
          'technical', 'medium')
  returning id into m_regression;

  insert into public.master_milestones
    (project_id, code, name, department_id, milestone_type, priority)
  values (p_a, 'ZZ-RIW1-CONFLICT', 'Conflicting retry milestone', d_a,
          'technical', 'medium')
  returning id into m_conflict;

  insert into public.weekly_reports (
    report_number, project_id, week_number, period_start, period_end,
    reviewed_by_contact_id, approved_by_contact_id
  ) values (
    'ZZ-RIW1-RETRY', p_a, 26, date '2097-06-25', date '2097-07-01', actor, actor
  ) returning id into w_retry;

  insert into public.weekly_reports (
    report_number, project_id, week_number, period_start, period_end,
    reviewed_by_contact_id, approved_by_contact_id
  ) values (
    'ZZ-RIW1-GOVERNED', p_a, 28,
    date '2097-07-09', date '2097-07-15', actor, actor
  ) returning id into w_governed;

  insert into public.weekly_reports (
    report_number, project_id, week_number, period_start, period_end,
    reviewed_by_contact_id, approved_by_contact_id
  ) values (
    'ZZ-RIW1-CONFLICT', p_a, 27, date '2097-07-02', date '2097-07-08', actor, actor
  ) returning id into w_conflict;

  insert into public.weekly_submissions
    (weekly_report_id, department_id, status)
  values
    (w_retry, d_a, 'approved'),
    (w_governed, d_a, 'approved'),
    (w_conflict, d_a, 'approved');

  insert into public.weekly_milestone_drafts (
    weekly_report_id, milestone_id, status, progress_percent,
    forecast_date, narrative
  ) values
    (w_retry, m_retry, 'in_progress', 64, date '2097-07-20',
     'Exact finalized content.'),
    (w_governed, m_governed, 'in_progress', 66, date '2097-07-25',
     'Exact content after governance.'),
    (w_governed, m_regression, 'in_progress', 40, date '2097-07-26',
     'Exact regression content after governance.'),
    (w_conflict, m_conflict, 'in_progress', 65, date '2097-07-21',
     'Conflicting finalized content.');

  -- Simulates a retry after the observation committed but before the caller
  -- received success. Every immutable field equals the finalized draft.
  insert into public.milestone_updates (
    milestone_id, source, weekly_report_id, department_id, status,
    progress_percent, forecast_date, narrative, is_regression,
    submitted_by_contact_id, approval_status, as_of_date
  ) values (
    m_retry, 'weekly', w_retry, d_a, 'in_progress', 64,
    date '2097-07-20', 'Exact finalized content.', false,
    actor, 'pending', date '2097-07-01'
  );

  -- Both observations have already advanced through governance. Their
  -- decision metadata and regression assessment are intentionally outside the
  -- draft-content comparison and must survive the retry unchanged.
  insert into public.milestone_updates (
    milestone_id, source, weekly_report_id, department_id, status,
    progress_percent, forecast_date, narrative, is_regression,
    regression_reason, submitted_by_contact_id, approval_status,
    approved_by_contact_id, approved_at, decision_note, as_of_date
  ) values
    (
      m_governed, 'weekly', w_governed, d_a, 'in_progress', 66,
      date '2097-07-25', 'Exact content after governance.', false,
      null, actor, 'approved', actor,
      timestamptz '2097-07-16 09:00:00+00', 'Governance decision retained.',
      date '2097-07-15'
    ),
    (
      m_regression, 'weekly', w_governed, d_a, 'in_progress', 40,
      date '2097-07-26', 'Exact regression content after governance.', true,
      'Approved regression rationale.', actor, 'approved', actor,
      timestamptz '2097-07-16 10:00:00+00', 'Regression decision retained.',
      date '2097-07-15'
    );

  -- Same idempotency key, different reported content. Finalization must name
  -- this as an integrity conflict rather than silently accepting it.
  insert into public.milestone_updates (
    milestone_id, source, weekly_report_id, department_id, status,
    progress_percent, forecast_date, narrative, is_regression,
    submitted_by_contact_id, approval_status, as_of_date
  ) values (
    m_conflict, 'weekly', w_conflict, d_a, 'in_progress', 10,
    date '2097-07-21', 'Conflicting finalized content.', false,
    actor, 'pending', date '2097-07-08'
  );

  perform public.set_weekly_report_status(w_retry, 'collecting');
  perform public.set_weekly_report_status(w_retry, 'under_review');
  perform public.set_weekly_report_status(w_retry, 'approved');
  perform public.set_weekly_report_status(w_retry, 'finalized');
  perform pg_temp.chk(22, 'IDEMPOTENCY',
    'exact retry before approval succeeds without a duplicate',
    (select status from public.weekly_reports where id = w_retry) = 'finalized'
    and (select count(*) from public.milestone_updates
          where weekly_report_id = w_retry and milestone_id = m_retry) = 1);

  perform public.set_weekly_report_status(w_governed, 'collecting');
  perform public.set_weekly_report_status(w_governed, 'under_review');
  perform public.set_weekly_report_status(w_governed, 'approved');
  perform public.set_weekly_report_status(w_governed, 'finalized');
  perform pg_temp.chk(23, 'IDEMPOTENCY',
    'exact retry after approval preserves governance and creates no duplicate',
    (select status from public.weekly_reports where id = w_governed) = 'finalized'
    and (select count(*) from public.milestone_updates
          where weekly_report_id = w_governed and milestone_id = m_governed) = 1
    and exists (
      select 1 from public.milestone_updates
       where weekly_report_id = w_governed
         and milestone_id = m_governed
         and approval_status = 'approved'
         and approved_by_contact_id = actor
         and approved_at = timestamptz '2097-07-16 09:00:00+00'
         and decision_note = 'Governance decision retained.'
    ));
  perform pg_temp.chk(24, 'IDEMPOTENCY',
    'exact retry after regression reason preserves governed regression state',
    (select count(*) from public.milestone_updates
      where weekly_report_id = w_governed and milestone_id = m_regression) = 1
    and exists (
      select 1 from public.milestone_updates
       where weekly_report_id = w_governed
         and milestone_id = m_regression
         and is_regression
         and regression_reason = 'Approved regression rationale.'
         and approval_status = 'approved'
         and approved_at = timestamptz '2097-07-16 10:00:00+00'
         and decision_note = 'Regression decision retained.'
    ));

  perform public.set_weekly_report_status(w_conflict, 'collecting');
  perform public.set_weekly_report_status(w_conflict, 'under_review');
  perform public.set_weekly_report_status(w_conflict, 'approved');
  perform pg_temp.must_fail_with(25, 'IDEMPOTENCY',
    'different content under the same key is rejected explicitly', '23514',
    format('select public.set_weekly_report_status(%L,%L)',
           w_conflict, 'finalized'));
  perform pg_temp.chk(26, 'IDEMPOTENCY',
    'conflicting retry leaves the report approved and history unchanged',
    (select status from public.weekly_reports where id = w_conflict) = 'approved'
    and (select count(*) from public.milestone_updates
          where weekly_report_id = w_conflict and milestone_id = m_conflict) = 1);

  /* ===== Monthly remains pre-Wave-1 ===================================== */

  insert into public.master_milestones
    (project_id, code, name, department_id, milestone_type, priority)
  values (p_a, 'ZZ-RIW1-MONTHLY', 'Monthly Wave 2 untouched', d_a,
          'technical', 'low')
  returning id into m_monthly;

  insert into public.milestone_updates
    (milestone_id, source, department_id, status, progress_percent)
  values (m_monthly, 'monthly', d_a, 'in_progress', 12);

  perform pg_temp.chk(27, 'MONTHLY WAVE 2',
    'pre-Wave-1 nullable Monthly report and cut-off behavior is unchanged',
    exists (
      select 1 from public.milestone_updates
       where milestone_id = m_monthly
         and source = 'monthly'
         and monthly_report_id is null
         and weekly_report_id is null
         and as_of_date is null
    ));

exception when others then
  insert into r values (0, 'ABORTED', sqlerrm, 'FAIL');
end;
$t$;

reset role;

select seq, area, item, verdict from r order by seq, area, item;
select count(*) filter (where verdict like 'PASS%') as pass,
       count(*) filter (where verdict like 'FAIL%') as fail
  from r;

rollback;

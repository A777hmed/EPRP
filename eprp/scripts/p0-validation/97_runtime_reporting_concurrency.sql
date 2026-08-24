-- EPRP Reporting Integration Wave 1 — concurrent draft/finalization tests.
-- ISOLATED TEMPORARY DATABASE ONLY. This script commits test transactions so
-- independent sessions can observe one another, then removes every test row.
-- Expected result: 8 PASS, 0 FAIL.

\set ON_ERROR_STOP on
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

create extension if not exists dblink;

create temp table r(
  seq int primary key,
  area text,
  item text,
  verdict text
);

create or replace function pg_temp.chk(
  p_seq int, p_area text, p_item text, p_ok boolean, p_detail text default ''
) returns void language plpgsql as $$
begin
  insert into r values (
    p_seq, p_area, p_item,
    case when p_ok then 'PASS' else 'FAIL' end ||
    case when p_detail = '' then '' else ' — ' || p_detail end
  );
end $$;

-- Establish committed fixtures. The two remote transactions below must be
-- able to see these rows, so this setup intentionally does not use rollback.
do $actor$
declare
  v_contact uuid;
begin
  select contact_id into v_contact
    from public.profiles
   where id = '00000000-0000-4000-a000-0000000000a1';

  if v_contact is null then
    insert into public.contacts (name, email)
    values ('ZZ-RIW1 Concurrency Admin', 'riw1.concurrent@example.invalid')
    returning id into v_contact;

    update public.profiles
       set contact_id = v_contact
     where id = '00000000-0000-4000-a000-0000000000a1';
  end if;
end;
$actor$;

insert into public.master_milestones
  (project_id, code, name, department_id, milestone_type, priority)
select p.id, 'ZZ-RIW1-CONC-EDIT', 'Concurrent edit observation', pd.department_id,
       'technical', 'medium'
  from public.projects p
  join public.project_departments pd on pd.project_id = p.id
 where p.code = 'ZZ-P0TEST-PRJ'
 limit 1;

insert into public.master_milestones
  (project_id, code, name, department_id, milestone_type, priority)
select p.id, 'ZZ-RIW1-CONC-DELETE', 'Concurrent delete observation', pd.department_id,
       'technical', 'medium'
  from public.projects p
  join public.project_departments pd on pd.project_id = p.id
 where p.code = 'ZZ-P0TEST-PRJ'
 limit 1;

insert into public.master_milestones
  (project_id, code, name, department_id, milestone_type, priority)
select p.id, 'ZZ-RIW1-CONC-INSERT', 'Concurrent insert observation', pd.department_id,
       'technical', 'medium'
  from public.projects p
  join public.project_departments pd on pd.project_id = p.id
 where p.code = 'ZZ-P0TEST-PRJ'
 limit 1;

insert into public.master_milestones
  (project_id, code, name, department_id, milestone_type, priority)
select p.id, 'ZZ-RIW1-CONC-REASSIGN-A', 'Concurrent reassignment observation', pd.department_id,
       'technical', 'medium'
  from public.projects p
  join public.project_departments pd on pd.project_id = p.id
 where p.code = 'ZZ-P0TEST-PRJ'
 limit 1;

insert into public.weekly_reports (
  report_number, project_id, week_number, period_start, period_end,
  reviewed_by_contact_id, approved_by_contact_id
)
select 'ZZ-RIW1-CONC-EDIT', p.id, 40, date '2099-10-01', date '2099-10-07',
       pr.contact_id, pr.contact_id
  from public.projects p
  join public.profiles pr
    on pr.id = '00000000-0000-4000-a000-0000000000a1'
 where p.code = 'ZZ-P0TEST-PRJ';

insert into public.weekly_reports (
  report_number, project_id, week_number, period_start, period_end,
  reviewed_by_contact_id, approved_by_contact_id
)
select 'ZZ-RIW1-CONC-INSERT', p.id, 42, date '2099-10-15', date '2099-10-21',
       pr.contact_id, pr.contact_id
  from public.projects p
  join public.profiles pr
    on pr.id = '00000000-0000-4000-a000-0000000000a1'
 where p.code = 'ZZ-P0TEST-PRJ';

insert into public.weekly_reports (
  report_number, project_id, week_number, period_start, period_end,
  reviewed_by_contact_id, approved_by_contact_id
)
select 'ZZ-RIW1-CONC-REASSIGN-A', p.id, 43, date '2099-10-22', date '2099-10-28',
       pr.contact_id, pr.contact_id
  from public.projects p
  join public.profiles pr
    on pr.id = '00000000-0000-4000-a000-0000000000a1'
 where p.code = 'ZZ-P0TEST-PRJ';

insert into public.weekly_reports (
  report_number, project_id, week_number, period_start, period_end,
  reviewed_by_contact_id, approved_by_contact_id
)
select 'ZZ-RIW1-CONC-REASSIGN-B', p.id, 44, date '2099-10-29', date '2099-11-04',
       pr.contact_id, pr.contact_id
  from public.projects p
  join public.profiles pr
    on pr.id = '00000000-0000-4000-a000-0000000000a1'
 where p.code = 'ZZ-P0TEST-PRJ';

insert into public.weekly_reports (
  report_number, project_id, week_number, period_start, period_end,
  reviewed_by_contact_id, approved_by_contact_id
)
select 'ZZ-RIW1-CONC-DELETE', p.id, 41, date '2099-10-08', date '2099-10-14',
       pr.contact_id, pr.contact_id
  from public.projects p
  join public.profiles pr
    on pr.id = '00000000-0000-4000-a000-0000000000a1'
 where p.code = 'ZZ-P0TEST-PRJ';

insert into public.weekly_submissions (weekly_report_id, department_id, status)
select w.id, m.department_id, 'approved'
  from public.weekly_reports w
  join public.master_milestones m
    on m.code = w.report_number
 where w.report_number in (
   'ZZ-RIW1-CONC-EDIT',
   'ZZ-RIW1-CONC-DELETE',
   'ZZ-RIW1-CONC-INSERT',
   'ZZ-RIW1-CONC-REASSIGN-A'
 );

begin;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-a000-0000000000a1","role":"authenticated"}';

insert into public.weekly_milestone_drafts (
  weekly_report_id, milestone_id, status, progress_percent, narrative
)
select w.id, m.id, 'in_progress',
       case
         when w.report_number = 'ZZ-RIW1-CONC-EDIT' then 60
         when w.report_number = 'ZZ-RIW1-CONC-DELETE' then 70
         else 80
       end,
       case when w.report_number = 'ZZ-RIW1-CONC-EDIT'
          then 'Value before concurrent edit.'
          when w.report_number = 'ZZ-RIW1-CONC-DELETE'
          then 'Draft deleted before finalization.'
          else 'Draft remains on original report.'
       end
  from public.weekly_reports w
  join public.master_milestones m on m.code = w.report_number
 where w.report_number in (
   'ZZ-RIW1-CONC-EDIT',
   'ZZ-RIW1-CONC-DELETE',
   'ZZ-RIW1-CONC-REASSIGN-A'
 );

select public.set_weekly_report_status(id, 'collecting')
  from public.weekly_reports
 where report_number in (
   'ZZ-RIW1-CONC-EDIT', 'ZZ-RIW1-CONC-DELETE',
   'ZZ-RIW1-CONC-INSERT', 'ZZ-RIW1-CONC-REASSIGN-A'
 )
 order by report_number;
select public.set_weekly_report_status(id, 'under_review')
  from public.weekly_reports
 where report_number in (
   'ZZ-RIW1-CONC-EDIT', 'ZZ-RIW1-CONC-DELETE',
   'ZZ-RIW1-CONC-INSERT', 'ZZ-RIW1-CONC-REASSIGN-A'
 )
 order by report_number;
select public.set_weekly_report_status(id, 'approved')
  from public.weekly_reports
 where report_number in (
   'ZZ-RIW1-CONC-EDIT', 'ZZ-RIW1-CONC-DELETE',
   'ZZ-RIW1-CONC-INSERT', 'ZZ-RIW1-CONC-REASSIGN-A'
 )
 order by report_number;
commit;

do $concurrency$
declare
  v_conn text;
  v_finalizer_pid integer;
  v_waiting boolean;
  v_result text;
  v_reassign_status text;
  v_sent integer;
  v_attempt integer;
  v_edit_report uuid := (
    select id from public.weekly_reports
     where report_number = 'ZZ-RIW1-CONC-EDIT'
  );
  v_delete_report uuid := (
    select id from public.weekly_reports
     where report_number = 'ZZ-RIW1-CONC-DELETE'
  );
  v_insert_report uuid := (
    select id from public.weekly_reports
     where report_number = 'ZZ-RIW1-CONC-INSERT'
  );
  v_insert_milestone uuid := (
    select id from public.master_milestones
     where code = 'ZZ-RIW1-CONC-INSERT'
  );
  v_reassign_report uuid := (
    select id from public.weekly_reports
     where report_number = 'ZZ-RIW1-CONC-REASSIGN-A'
  );
  v_reassign_target uuid := (
    select id from public.weekly_reports
     where report_number = 'ZZ-RIW1-CONC-REASSIGN-B'
  );
  v_edit_draft uuid := (
    select id from public.weekly_milestone_drafts
     where weekly_report_id = (
       select id from public.weekly_reports
        where report_number = 'ZZ-RIW1-CONC-EDIT'
     )
  );
  v_delete_draft uuid := (
    select id from public.weekly_milestone_drafts
     where weekly_report_id = (
       select id from public.weekly_reports
        where report_number = 'ZZ-RIW1-CONC-DELETE'
     )
  );
  v_reassign_draft uuid := (
    select id from public.weekly_milestone_drafts
     where weekly_report_id = (
       select id from public.weekly_reports
        where report_number = 'ZZ-RIW1-CONC-REASSIGN-A'
     )
  );
  v_claims text :=
    '{"sub":"00000000-0000-4000-a000-0000000000a1","role":"authenticated"}';
begin
  v_conn := format(
    'host=%s port=%s dbname=%s user=%s',
    coalesce(host(inet_server_addr()), '127.0.0.1'),
    inet_server_port(), current_database(), current_user
  );

  perform dblink_connect('riw1_mutation', v_conn);
  perform dblink_connect('riw1_finalizer', v_conn);

  /* Edit starts first: finalization must wait, then observe edited content. */
  perform dblink_exec('riw1_mutation', 'begin');
  perform dblink_exec('riw1_mutation', 'set local role authenticated');
  perform dblink_exec('riw1_mutation',
    format('set local request.jwt.claims = %L', v_claims));
  perform dblink_exec('riw1_mutation',
    format('update public.weekly_milestone_drafts set progress_percent = 61, narrative = %L where id = %L',
           'Value committed before finalization.', v_edit_draft));

  perform dblink_exec('riw1_finalizer', 'begin');
  perform dblink_exec('riw1_finalizer', 'set local role authenticated');
  perform dblink_exec('riw1_finalizer',
    format('set local request.jwt.claims = %L', v_claims));
  select pid into v_finalizer_pid
    from dblink('riw1_finalizer', 'select pg_backend_pid()') as x(pid integer);
  select dblink_send_query('riw1_finalizer',
    format('select public.set_weekly_report_status(%L,%L)',
           v_edit_report, 'finalized')) into v_sent;

  v_waiting := false;
  for v_attempt in 1..250 loop
    select exists (
      select 1 from pg_stat_activity
       where pid = v_finalizer_pid and wait_event_type = 'Lock'
    ) into v_waiting;
    exit when v_waiting;
    perform pg_sleep(0.02);
  end loop;
  perform pg_temp.chk(1, 'EDIT VS FINALIZE',
    'finalization waits while a draft edit owns the report lock',
    v_sent = 1 and v_waiting and dblink_is_busy('riw1_finalizer') = 1);

  perform dblink_exec('riw1_mutation', 'commit');
  select result into v_result
    from dblink_get_result('riw1_finalizer') as x(result text);
  perform result
    from dblink_get_result('riw1_finalizer') as x(result text);
  perform dblink_exec('riw1_finalizer', 'commit');

  perform pg_temp.chk(2, 'EDIT VS FINALIZE',
    'finalization observes the committed edit and cannot create stale history',
    v_result = 'finalized'
    and exists (
      select 1 from public.milestone_updates u
       where u.weekly_report_id = v_edit_report
         and u.progress_percent = 61
         and u.narrative = 'Value committed before finalization.'
    ));

  /* Delete starts first: finalization waits, then sees that no draft remains. */
  perform dblink_exec('riw1_mutation', 'begin');
  perform dblink_exec('riw1_mutation', 'set local role authenticated');
  perform dblink_exec('riw1_mutation',
    format('set local request.jwt.claims = %L', v_claims));
  perform dblink_exec('riw1_mutation',
    format('delete from public.weekly_milestone_drafts where id = %L',
           v_delete_draft));

  perform dblink_exec('riw1_finalizer', 'begin');
  perform dblink_exec('riw1_finalizer', 'set local role authenticated');
  perform dblink_exec('riw1_finalizer',
    format('set local request.jwt.claims = %L', v_claims));
  select pid into v_finalizer_pid
    from dblink('riw1_finalizer', 'select pg_backend_pid()') as x(pid integer);
  select dblink_send_query('riw1_finalizer',
    format('select public.set_weekly_report_status(%L,%L)',
           v_delete_report, 'finalized')) into v_sent;

  v_waiting := false;
  for v_attempt in 1..250 loop
    select exists (
      select 1 from pg_stat_activity
       where pid = v_finalizer_pid and wait_event_type = 'Lock'
    ) into v_waiting;
    exit when v_waiting;
    perform pg_sleep(0.02);
  end loop;
  perform pg_temp.chk(3, 'DELETE VS FINALIZE',
    'finalization waits while a draft delete owns the report lock',
    v_sent = 1 and v_waiting and dblink_is_busy('riw1_finalizer') = 1);

  perform dblink_exec('riw1_mutation', 'commit');
  select result into v_result
    from dblink_get_result('riw1_finalizer') as x(result text);
  perform result
    from dblink_get_result('riw1_finalizer') as x(result text);
  perform dblink_exec('riw1_finalizer', 'commit');

  perform pg_temp.chk(4, 'DELETE VS FINALIZE',
    'finalization observes the committed delete and creates no stale observation',
    v_result = 'finalized'
    and not exists (
      select 1 from public.weekly_milestone_drafts
       where weekly_report_id = v_delete_report
    )
    and not exists (
      select 1 from public.milestone_updates
       where weekly_report_id = v_delete_report
    ));

  /* Insert starts first: finalization waits, then includes the new draft. */
  perform dblink_exec('riw1_mutation', 'begin');
  perform dblink_exec('riw1_mutation', 'set local role authenticated');
  perform dblink_exec('riw1_mutation',
    format('set local request.jwt.claims = %L', v_claims));
  perform dblink_exec('riw1_mutation',
    format($sql$insert into public.weekly_milestone_drafts
      (weekly_report_id, milestone_id, status, progress_percent, narrative)
      values (%L,%L,'in_progress',75,%L)$sql$,
      v_insert_report, v_insert_milestone,
      'Draft inserted before finalization.'));

  perform dblink_exec('riw1_finalizer', 'begin');
  perform dblink_exec('riw1_finalizer', 'set local role authenticated');
  perform dblink_exec('riw1_finalizer',
    format('set local request.jwt.claims = %L', v_claims));
  select pid into v_finalizer_pid
    from dblink('riw1_finalizer', 'select pg_backend_pid()') as x(pid integer);
  select dblink_send_query('riw1_finalizer',
    format('select public.set_weekly_report_status(%L,%L)',
           v_insert_report, 'finalized')) into v_sent;

  v_waiting := false;
  for v_attempt in 1..250 loop
    select exists (
      select 1 from pg_stat_activity
       where pid = v_finalizer_pid and wait_event_type = 'Lock'
    ) into v_waiting;
    exit when v_waiting;
    perform pg_sleep(0.02);
  end loop;
  perform pg_temp.chk(5, 'INSERT VS FINALIZE',
    'finalization waits while a draft insert owns the report lock',
    v_sent = 1 and v_waiting and dblink_is_busy('riw1_finalizer') = 1);

  perform dblink_exec('riw1_mutation', 'commit');
  select result into v_result
    from dblink_get_result('riw1_finalizer') as x(result text);
  perform result
    from dblink_get_result('riw1_finalizer') as x(result text);
  perform dblink_exec('riw1_finalizer', 'commit');

  perform pg_temp.chk(6, 'INSERT VS FINALIZE',
    'finalization observes the committed insert and records its content',
    v_result = 'finalized'
    and exists (
      select 1 from public.milestone_updates u
       where u.weekly_report_id = v_insert_report
         and u.milestone_id = v_insert_milestone
         and u.progress_percent = 75
         and u.narrative = 'Draft inserted before finalization.'
    ));

  /* Hold the original report lock while finalization starts, then attempt the
     forbidden A-to-B reassignment. No second report lock is introduced. */
  perform dblink_exec('riw1_mutation', 'begin');
  perform dblink_exec('riw1_mutation', 'set local role authenticated');
  perform dblink_exec('riw1_mutation',
    format('set local request.jwt.claims = %L', v_claims));
  perform locked from dblink(
    'riw1_mutation',
    format('select id::text from public.weekly_reports where id = %L for update',
           v_reassign_report)
  ) as x(locked text);

  perform dblink_exec('riw1_finalizer', 'begin');
  perform dblink_exec('riw1_finalizer', 'set local role authenticated');
  perform dblink_exec('riw1_finalizer',
    format('set local request.jwt.claims = %L', v_claims));
  select pid into v_finalizer_pid
    from dblink('riw1_finalizer', 'select pg_backend_pid()') as x(pid integer);
  select dblink_send_query('riw1_finalizer',
    format('select public.set_weekly_report_status(%L,%L)',
           v_reassign_report, 'finalized')) into v_sent;

  v_waiting := false;
  for v_attempt in 1..250 loop
    select exists (
      select 1 from pg_stat_activity
       where pid = v_finalizer_pid and wait_event_type = 'Lock'
    ) into v_waiting;
    exit when v_waiting;
    perform pg_sleep(0.02);
  end loop;
  perform pg_temp.chk(7, 'REASSIGN VS FINALIZE',
    'finalization is serialized on the draft original report',
    v_sent = 1 and v_waiting and dblink_is_busy('riw1_finalizer') = 1);

  select dblink_exec(
    'riw1_mutation',
    format('update public.weekly_milestone_drafts set weekly_report_id = %L where id = %L',
           v_reassign_target, v_reassign_draft),
    false
  ) into v_reassign_status;
  perform dblink_exec('riw1_mutation', 'rollback');

  select result into v_result
    from dblink_get_result('riw1_finalizer') as x(result text);
  perform result
    from dblink_get_result('riw1_finalizer') as x(result text);
  perform dblink_exec('riw1_finalizer', 'commit');

  perform pg_temp.chk(8, 'REASSIGN VS FINALIZE',
    'reassignment is rejected and finalization records only original-report history',
    v_reassign_status = 'ERROR'
    and v_result = 'finalized'
    and exists (
      select 1 from public.weekly_milestone_drafts
       where id = v_reassign_draft
         and weekly_report_id = v_reassign_report
    )
    and not exists (
      select 1 from public.weekly_milestone_drafts
       where id = v_reassign_draft
         and weekly_report_id = v_reassign_target
    )
    and exists (
      select 1 from public.milestone_updates
       where weekly_report_id = v_reassign_report
         and progress_percent = 80
         and narrative = 'Draft remains on original report.'
    )
    and not exists (
      select 1 from public.milestone_updates
       where weekly_report_id = v_reassign_target
    ));

  perform dblink_disconnect('riw1_mutation');
  perform dblink_disconnect('riw1_finalizer');
exception when others then
  begin perform dblink_disconnect('riw1_mutation'); exception when others then null; end;
  begin perform dblink_disconnect('riw1_finalizer'); exception when others then null; end;
  raise;
end;
$concurrency$;

select seq, area, item, verdict from r order by seq;
select count(*) filter (where verdict like 'PASS%') as pass,
       count(*) filter (where verdict like 'FAIL%') as fail
  from r;

-- Owner-level cleanup in the disposable database. No business row is touched.
delete from public.milestone_updates
 where weekly_report_id in (
   select id from public.weekly_reports
    where report_number in (
      'ZZ-RIW1-CONC-EDIT', 'ZZ-RIW1-CONC-DELETE',
      'ZZ-RIW1-CONC-INSERT',
      'ZZ-RIW1-CONC-REASSIGN-A', 'ZZ-RIW1-CONC-REASSIGN-B'
    )
 );
delete from public.weekly_reports
 where report_number in (
   'ZZ-RIW1-CONC-EDIT', 'ZZ-RIW1-CONC-DELETE',
   'ZZ-RIW1-CONC-INSERT',
   'ZZ-RIW1-CONC-REASSIGN-A', 'ZZ-RIW1-CONC-REASSIGN-B'
 );
delete from public.master_milestones
 where code in (
   'ZZ-RIW1-CONC-EDIT', 'ZZ-RIW1-CONC-DELETE',
   'ZZ-RIW1-CONC-INSERT', 'ZZ-RIW1-CONC-REASSIGN-A'
 )
   and project_id = (select id from public.projects where code = 'ZZ-P0TEST-PRJ');

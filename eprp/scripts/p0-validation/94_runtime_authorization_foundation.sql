-- EPRP Authorization Foundation Wave 1 — local runtime/RLS matrix.
--
-- LOCAL DATABASE ONLY. Requires:
--   00_local_test_identity.sql
--   01_setup_test_fixtures.sql
--   migration 20260824000001
--
-- Every fixture and every test write is inside one transaction and ROLLED BACK.

\set ON_ERROR_STOP on

do $guard$
begin
  if inet_server_addr() is not null
     and host(inet_server_addr()) not in ('127.0.0.1', '::1', 'localhost') then
    raise exception
      'REFUSING TO RUN: this authorization runtime suite is local-only (server address %).',
      host(inet_server_addr());
  end if;
  if not exists (select 1 from public.projects where code = 'ZZ-P0TEST-PRJ') then
    raise exception
      'Missing ZZ-P0TEST-PRJ. Run 00_local_test_identity.sql and 01_setup_test_fixtures.sql first.';
  end if;
end;
$guard$;

begin;

create temp table r(seq int, area text, item text, verdict text) on commit drop;
grant all on r to authenticated;
do $g$
begin
  execute format(
    'grant usage on schema %I to authenticated',
    (select nspname from pg_namespace where oid = pg_my_temp_schema())
  );
end;
$g$;

create or replace function pg_temp.chk(
  p_seq int,
  p_area text,
  p_item text,
  p_ok boolean,
  p_detail text default ''
) returns void
language plpgsql
as $fn$
begin
  insert into r values (
    p_seq, p_area, p_item,
    case when p_ok then 'PASS' else 'FAIL' end
    || case when p_detail = '' then '' else ' - ' || p_detail end
  );
end;
$fn$;

create or replace function pg_temp.must_fail_with(
  p_seq int,
  p_area text,
  p_item text,
  p_expected_state text,
  p_sql text
) returns void
language plpgsql
as $fn$
begin
  execute p_sql;
  perform pg_temp.chk(
    p_seq, p_area, p_item, false, 'statement was accepted'
  );
exception when others then
  perform pg_temp.chk(
    p_seq,
    p_area,
    p_item,
    sqlstate = p_expected_state,
    'SQLSTATE ' || sqlstate || ': ' || left(sqlerrm, 80)
  );
end;
$fn$;

/* ------------------------------ fixtures --------------------------------- */

-- Three extra local-only identities: Project Control Admin, assigned Project
-- Control / Planning, and Department User. The existing b2 fixture remains the
-- assigned Report Coordinator.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-a000-0000000000c3',
    'authenticated', 'authenticated', 'auth.pca@example.invalid',
    'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-a000-0000000000d4',
    'authenticated', 'authenticated', 'auth.pc@example.invalid',
    'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-a000-0000000000e5',
    'authenticated', 'authenticated', 'auth.department@example.invalid',
    'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now()
  );

insert into public.departments (name, code)
values ('ZZ-AUTH Other Department', 'ZZ-AUTH-DEPT-B');

insert into public.contacts (name, email)
values
  ('ZZ-AUTH Project Control', 'auth.pc.contact@example.invalid'),
  ('ZZ-AUTH Department User', 'auth.department.contact@example.invalid'),
  ('ZZ-AUTH Non-member', 'auth.nonmember@example.invalid');

insert into public.profiles (id, email, full_name, role, active)
values (
  '00000000-0000-4000-a000-0000000000c3',
  'auth.pca@example.invalid',
  'ZZ-AUTH Project Control Admin',
  'project_control_admin',
  true
);

insert into public.profiles (id, email, full_name, role, contact_id, active)
select
  '00000000-0000-4000-a000-0000000000d4',
  'auth.pc@example.invalid',
  'ZZ-AUTH Project Control',
  'viewer', c.id, true
  from public.contacts c where c.name = 'ZZ-AUTH Project Control';

insert into public.profiles (id, email, full_name, role, contact_id, active)
select
  '00000000-0000-4000-a000-0000000000e5',
  'auth.department@example.invalid',
  'ZZ-AUTH Department User',
  'viewer', c.id, true
  from public.contacts c where c.name = 'ZZ-AUTH Department User';

insert into public.project_departments (
  project_id, department_id, reporting_required
)
select p.id, d.id, true
  from public.projects p, public.departments d
 where p.code = 'ZZ-P0TEST-PRJ'
   and d.code = 'ZZ-AUTH-DEPT-B';

insert into public.project_contacts (project_id, contact_id, role)
select p.id, c.id, 'project_control_manager'
  from public.projects p, public.contacts c
 where p.code = 'ZZ-P0TEST-PRJ'
   and c.name = 'ZZ-AUTH Project Control';

insert into public.project_contacts (
  project_id, contact_id, role, department_id, assignment_role
)
select p.id, c.id, 'team_member', d.id, 'team_member'
  from public.projects p, public.contacts c, public.departments d
 where p.code = 'ZZ-P0TEST-PRJ'
   and c.name = 'ZZ-AUTH Department User'
   and d.code = 'ZZ-P0TEST-DEPT';

insert into public.job_titles (name, code)
values ('ZZ-AUTH Project Responsibility', 'ZZ-AUTH-RESP');

insert into public.weekly_reports (
  report_number, project_id, week_number, period_start, period_end
)
select 'ZZ-AUTH-W-A', p.id, 1, date '2098-01-01', date '2098-01-07'
  from public.projects p where p.code = 'ZZ-P0TEST-PRJ';

insert into public.weekly_reports (
  report_number, project_id, week_number, period_start, period_end
)
select 'ZZ-AUTH-W-B', p.id, 2, date '2098-01-08', date '2098-01-14'
  from public.projects p where p.code = 'PSAIM-001';

insert into public.weekly_submissions (
  weekly_report_id, department_id, status
)
select wr.id, d.id, 'pending'
  from public.weekly_reports wr
  join public.projects p on p.id = wr.project_id
  join public.departments d on d.code = 'ZZ-P0TEST-DEPT'
 where wr.report_number = 'ZZ-AUTH-W-A';

insert into public.monthly_reports (
  report_number, project_id, reporting_month
)
select 'ZZ-AUTH-M-A', p.id, date '2098-01-01'
  from public.projects p where p.code = 'ZZ-P0TEST-PRJ';

insert into public.monthly_reports (
  report_number, project_id, reporting_month
)
select 'ZZ-AUTH-M-B', p.id, date '2098-02-01'
  from public.projects p where p.code = 'PSAIM-001';

insert into public.master_milestones (project_id, code, name, priority)
select p.id, 'ZZ-AUTH-MILESTONE', 'Authorization boundary milestone', 'medium'
  from public.projects p where p.code = 'ZZ-P0TEST-PRJ';

insert into public.organization_charts (project_id, name, status)
select p.id, 'ZZ-AUTH Chart ' || p.code, 'draft'
  from public.projects p
 where p.code in ('ZZ-P0TEST-PRJ', 'PSAIM-001');

insert into public.organization_positions (
  chart_id, project_id, title, contact_id
)
select oc.id, oc.project_id, 'ZZ-AUTH Position ' || p.code, c.id
  from public.organization_charts oc
  join public.projects p on p.id = oc.project_id
  cross join public.contacts c
 where oc.name = 'ZZ-AUTH Chart ' || p.code
   and p.code in ('ZZ-P0TEST-PRJ', 'PSAIM-001')
   and c.name = 'ZZ-P0TEST Member';

-- Owner-level negative control: even a role that bypasses RLS cannot persist a
-- position/chart from project B under project A. The composite FK is the final
-- physical integrity boundary after authorization.
do $t$
declare
  p_a uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  chart_b uuid := (
    select oc.id
      from public.organization_charts oc
      join public.projects p on p.id = oc.project_id
     where p.code = 'PSAIM-001' and oc.name = 'ZZ-AUTH Chart PSAIM-001'
  );
  position_b uuid := (
    select op.id
      from public.organization_positions op
      join public.projects p on p.id = op.project_id
     where p.code = 'PSAIM-001' and op.title = 'ZZ-AUTH Position PSAIM-001'
  );
begin
  perform pg_temp.must_fail_with(0, 'DATABASE INTEGRITY',
    'cross-project assignment-history triple is physically rejected', '23503',
    format(
      'insert into public.position_assignment_history(position_id,chart_id,project_id,action) values (%L,%L,%L,%L)',
      position_b, chart_b, p_a, 'assigned'
    ));
end;
$t$;

/* ------------------------------ System Admin ----------------------------- */

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-a000-0000000000a1","role":"authenticated"}';

do $t$
declare
  p_a uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  p_b uuid := (select id from public.projects where code = 'PSAIM-001');
begin
  perform pg_temp.chk(1, 'SYSTEM ADMIN', 'global operational authority',
    public.has_global_operational_authority());
  perform pg_temp.chk(1, 'SYSTEM ADMIN', 'all-project operations',
    public.can_manage_project_operations(p_a)
    and public.can_manage_project_operations(p_b));
  perform pg_temp.chk(1, 'SYSTEM ADMIN', 'Calendar management',
    public.can_manage_calendar());
end;
$t$;

/* ------------------------- Project Control Admin ------------------------- */

set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-a000-0000000000c3","role":"authenticated"}';

do $t$
declare
  p_a uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  p_b uuid := (select id from public.projects where code = 'PSAIM-001');
  client_id uuid := (select id from public.clients where code = 'ZZ-P0TEST-CLIENT');
  nonmember_contact uuid := (
    select id from public.contacts where name = 'ZZ-AUTH Non-member'
  );
  n integer;
begin
  perform pg_temp.chk(2, 'PROJECT CONTROL ADMIN', 'global operational authority',
    public.has_global_operational_authority());
  perform pg_temp.chk(2, 'PROJECT CONTROL ADMIN', 'all-project reporting',
    public.can_manage_reporting_workflow(p_a)
    and public.can_manage_reporting_workflow(p_b));
  perform pg_temp.chk(2, 'PROJECT CONTROL ADMIN', 'Calendar management',
    public.can_manage_calendar());

  insert into public.project_events (
    project_id, event_type, title, event_date
  ) values (
    p_b, 'meeting', 'ZZ-AUTH PCA Calendar', date '2098-03-01'
  );
  get diagnostics n = row_count;
  perform pg_temp.chk(2, 'PROJECT CONTROL ADMIN',
    'can write Calendar on any project', n = 1);

  perform pg_temp.must_fail_with(2, 'PROJECT CONTROL ADMIN',
    'cannot create a project with an unbacked fixed responsibility', '23503',
    format(
      'insert into public.projects(code,name,client_id,project_manager_id,planned_start_date,planned_finish_date) values (%L,%L,%L,%L,date %L,date %L)',
      'ZZ-AUTH-INVALID-CREATE', 'must be denied', client_id,
      nonmember_contact, '2098-01-01', '2098-12-31'
    ));
end;
$t$;

/* -------------------- assigned Project Control / Planning ---------------- */

set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-a000-0000000000d4","role":"authenticated"}';

do $t$
declare
  p_a uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  p_b uuid := (select id from public.projects where code = 'PSAIM-001');
  member_contact uuid := (
    select c.id from public.contacts c where c.name = 'ZZ-P0TEST Member'
  );
  nonmember_contact uuid := (
    select c.id from public.contacts c where c.name = 'ZZ-AUTH Non-member'
  );
  title_id uuid := (
    select id from public.job_titles where code = 'ZZ-AUTH-RESP'
  );
  department_id uuid := (
    select id from public.departments where code = 'ZZ-P0TEST-DEPT'
  );
  chart_a uuid := (
    select oc.id
      from public.organization_charts oc
      join public.projects p on p.id = oc.project_id
     where p.code = 'ZZ-P0TEST-PRJ'
       and oc.name = 'ZZ-AUTH Chart ZZ-P0TEST-PRJ'
  );
  chart_b uuid := (
    select oc.id
      from public.organization_charts oc
      join public.projects p on p.id = oc.project_id
     where p.code = 'PSAIM-001'
       and oc.name = 'ZZ-AUTH Chart PSAIM-001'
  );
  position_a uuid := (
    select op.id
      from public.organization_positions op
     where op.chart_id = chart_a and op.title = 'ZZ-AUTH Position ZZ-P0TEST-PRJ'
  );
  position_b uuid := (
    select op.id
      from public.organization_positions op
     where op.chart_id = chart_b and op.title = 'ZZ-AUTH Position PSAIM-001'
  );
  n integer;
begin
  perform pg_temp.chk(3, 'PROJECT CONTROL / PLANNING',
    'assigned-project operations',
    public.is_project_control_planning(p_a)
    and public.can_manage_project_operations(p_a));
  perform pg_temp.chk(3, 'PROJECT CONTROL / PLANNING',
    'cross-project operations denied',
    not public.can_manage_project_operations(p_b));
  perform pg_temp.chk(3, 'PROJECT CONTROL / PLANNING',
    'Calendar management denied by default',
    not public.can_manage_calendar());

  insert into public.project_sites (project_id, name)
  values (p_a, 'ZZ-AUTH PC Site');
  get diagnostics n = row_count;
  perform pg_temp.chk(3, 'PROJECT CONTROL / PLANNING',
    'can write own project operations', n = 1);

  perform pg_temp.must_fail_with(3, 'PROJECT CONTROL / PLANNING',
    'cannot write another project', '42501',
    format(
      'insert into public.project_sites(project_id,name) values (%L,%L)',
      p_b, 'ZZ-AUTH Cross-project Site'
    ));

  insert into public.project_positions (
    project_id, job_title_id, contact_id, notes
  ) values (
    p_a, title_id, member_contact, 'valid same-project member'
  );
  get diagnostics n = row_count;
  perform pg_temp.chk(3, 'PROJECT CONTROL / PLANNING',
    'can assign a predefined responsibility to a project member', n = 1);

  perform pg_temp.must_fail_with(3, 'PROJECT CONTROL / PLANNING',
    'cannot assign responsibility to a non-member', '23503',
    format(
      'insert into public.project_positions(project_id,job_title_id,contact_id) values (%L,%L,%L)',
      p_a, title_id, nonmember_contact
    ));

  perform pg_temp.must_fail_with(3, 'PROJECT CONTROL / PLANNING',
    'cannot assign a fixed responsibility to a non-member', '23503',
    format(
      'update public.projects set project_manager_id = %L where id = %L',
      nonmember_contact, p_a
    ));

  insert into public.position_assignment_history (
    position_id, chart_id, project_id, contact_id, action
  ) values (
    position_a, chart_a, p_a, member_contact, 'assigned'
  );
  get diagnostics n = row_count;
  perform pg_temp.chk(3, 'PROJECT CONTROL / PLANNING',
    'can append assignment history for the canonical assigned project', n = 1);

  perform pg_temp.must_fail_with(3, 'PROJECT CONTROL / PLANNING',
    'cannot authorize assignment history through a supplied project id', '42501',
    format(
      'insert into public.position_assignment_history(position_id,chart_id,project_id,action) values (%L,%L,%L,%L)',
      position_b, chart_b, p_a, 'assigned'
    ));

  -- The same person may have several scoped rows. Removing one is valid while
  -- another remains; removing or reassigning the last one must be rejected.
  insert into public.project_contacts (
    project_id, contact_id, role, department_id, assignment_role
  ) values (
    p_a, member_contact, 'team_member', department_id, 'team_member_lead'
  );

  delete from public.project_contacts
   where project_id = p_a
     and contact_id = member_contact
     and role = 'team_member'
     and assignment_role = 'team_member';
  get diagnostics n = row_count;
  perform pg_temp.chk(3, 'PROJECT CONTROL / PLANNING',
    'one of multiple backing memberships may be removed', n = 1);

  perform pg_temp.must_fail_with(3, 'PROJECT CONTROL / PLANNING',
    'last backing membership cannot be reassigned', '23503',
    format(
      'update public.project_contacts set contact_id = %L where project_id = %L and contact_id = %L and role = %L and assignment_role = %L',
      nonmember_contact, p_a, member_contact, 'team_member', 'team_member_lead'
    ));

  perform pg_temp.must_fail_with(3, 'PROJECT CONTROL / PLANNING',
    'last backing membership cannot be deleted', '23503',
    format(
      'delete from public.project_contacts where project_id = %L and contact_id = %L and role = %L and assignment_role = %L',
      p_a, member_contact, 'team_member', 'team_member_lead'
    ));

  insert into public.master_milestones (
    project_id, code, name, priority
  ) values (
    p_a, 'ZZ-AUTH-PC-MILESTONE', 'PC-owned milestone', 'low'
  );
  get diagnostics n = row_count;
  perform pg_temp.chk(3, 'PROJECT CONTROL / PLANNING',
    'can write Master Milestones on assigned project', n = 1);

  perform pg_temp.must_fail_with(3, 'PROJECT CONTROL / PLANNING',
    'cannot write Calendar', '42501',
    format(
      'insert into public.project_events(project_id,event_type,title,event_date) values (%L,%L,%L,date %L)',
      p_a, 'meeting', 'ZZ-AUTH PC forbidden Calendar', '2098-03-02'
    ));
end;
$t$;

/* --------------------------- Report Coordinator -------------------------- */

set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-a000-0000000000b2","role":"authenticated"}';

do $t$
declare
  p_a uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  p_b uuid := (select id from public.projects where code = 'PSAIM-001');
  n integer;
begin
  perform pg_temp.chk(4, 'REPORT COORDINATOR',
    'assigned-project reporting workflow',
    public.is_report_coordinator(p_a)
    and public.can_manage_reporting_workflow(p_a));
  perform pg_temp.chk(4, 'REPORT COORDINATOR',
    'no project operations',
    not public.can_manage_project_operations(p_a));
  perform pg_temp.chk(4, 'REPORT COORDINATOR',
    'no cross-project reporting authority',
    not public.can_manage_reporting_workflow(p_b));
  perform pg_temp.chk(4, 'REPORT COORDINATOR',
    'no Calendar authority',
    not public.can_manage_calendar());

  update public.weekly_reports
     set planned_progress = planned_progress
   where report_number = 'ZZ-AUTH-W-A';
  get diagnostics n = row_count;
  perform pg_temp.chk(4, 'REPORT COORDINATOR',
    'can manage assigned Weekly', n = 1);

  update public.monthly_reports
     set hse_status = 'ZZ-AUTH Coordinator review'
   where report_number = 'ZZ-AUTH-M-A';
  get diagnostics n = row_count;
  perform pg_temp.chk(4, 'REPORT COORDINATOR',
    'can manage assigned Monthly', n = 1);

  insert into public.executive_notes (project_id, body)
  values (p_a, 'ZZ-AUTH assigned-project Executive preparation');
  get diagnostics n = row_count;
  perform pg_temp.chk(4, 'REPORT COORDINATOR',
    'can prepare assigned-project Executive content', n = 1);

  update public.projects set description = description where id = p_a;
  get diagnostics n = row_count;
  perform pg_temp.chk(4, 'REPORT COORDINATOR',
    'Project Setup write is denied', n = 0, n::text || ' rows');

  perform pg_temp.must_fail_with(4, 'REPORT COORDINATOR',
    'Calendar write is denied', '42501',
    format(
      'insert into public.project_events(project_id,event_type,title,event_date) values (%L,%L,%L,date %L)',
      p_a, 'meeting', 'ZZ-AUTH RC forbidden Calendar', '2098-03-03'
    ));

  perform pg_temp.must_fail_with(4, 'REPORT COORDINATOR',
    'Master Milestone write is denied', '42501',
    format(
      'insert into public.master_milestones(project_id,code,name,priority) values (%L,%L,%L,%L)',
      p_a, 'ZZ-AUTH-RC-MILESTONE', 'must be denied', 'low'
    ));

  perform pg_temp.must_fail_with(4, 'REPORT COORDINATOR',
    'cross-project Executive preparation is denied', '42501',
    format(
      'insert into public.executive_notes(project_id,body) values (%L,%L)',
      p_b, 'must be denied'
    ));

  perform pg_temp.must_fail_with(4, 'REPORT COORDINATOR',
    'portfolio Executive authoring is denied', '42501',
    'insert into public.executive_notes(project_id,body) values (null,''must be denied'')');
end;
$t$;

/* ----------------------------- Department User --------------------------- */

set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-a000-0000000000e5","role":"authenticated"}';

do $t$
declare
  p_a uuid := (select id from public.projects where code = 'ZZ-P0TEST-PRJ');
  p_b uuid := (select id from public.projects where code = 'PSAIM-001');
  d_a uuid := (select id from public.departments where code = 'ZZ-P0TEST-DEPT');
  d_other uuid := (select id from public.departments where code = 'ZZ-AUTH-DEPT-B');
  d_b uuid := (
    select pd.department_id
      from public.project_departments pd
     where pd.project_id = p_b
     limit 1
  );
  w_a uuid := (select id from public.weekly_reports where report_number = 'ZZ-AUTH-W-A');
  w_b uuid := (select id from public.weekly_reports where report_number = 'ZZ-AUTH-W-B');
  m_a uuid := (select id from public.monthly_reports where report_number = 'ZZ-AUTH-M-A');
  milestone_id uuid := (
    select id from public.master_milestones where code = 'ZZ-AUTH-MILESTONE'
  );
  weekly_comment uuid;
  monthly_comment uuid;
  n integer;
begin
  perform pg_temp.chk(5, 'DEPARTMENT USER',
    'own department comment scope',
    public.is_department_user(p_a, d_a)
    and public.can_edit_department_report_comment(p_a, d_a));
  perform pg_temp.chk(5, 'DEPARTMENT USER',
    'other department scope denied',
    not public.can_edit_department_report_comment(p_a, d_other));
  perform pg_temp.chk(5, 'DEPARTMENT USER',
    'no reporting workflow or operations authority',
    not public.can_manage_reporting_workflow(p_a)
    and not public.can_manage_project_operations(p_a));

  insert into public.weekly_entries (
    weekly_report_id, department_id, category, priority,
    description, entry_type
  ) values (
    w_a, d_a, 'general', 'low', 'ZZ-AUTH own Weekly comment', 'comment'
  ) returning id into weekly_comment;
  perform pg_temp.chk(5, 'DEPARTMENT USER',
    'can create own-department Weekly comment', weekly_comment is not null);

  update public.weekly_entries
     set description = 'ZZ-AUTH edited Weekly comment'
   where id = weekly_comment;
  get diagnostics n = row_count;
  perform pg_temp.chk(5, 'DEPARTMENT USER',
    'can edit own-department Weekly comment', n = 1);

  perform pg_temp.must_fail_with(5, 'DEPARTMENT USER',
    'cannot create Weekly risk/other content', '42501',
    format(
      'insert into public.weekly_entries(weekly_report_id,department_id,category,priority,description,entry_type) values (%L,%L,%L,%L,%L,%L)',
      w_a, d_a, 'risk', 'high', 'must be denied', 'risk'
    ));

  perform pg_temp.must_fail_with(5, 'DEPARTMENT USER',
    'cannot comment in another department', '42501',
    format(
      'insert into public.weekly_entries(weekly_report_id,department_id,category,priority,description,entry_type) values (%L,%L,%L,%L,%L,%L)',
      w_a, d_other, 'general', 'low', 'must be denied', 'comment'
    ));

  perform pg_temp.must_fail_with(5, 'DEPARTMENT USER',
    'cannot comment in another project', '42501',
    format(
      'insert into public.weekly_entries(weekly_report_id,department_id,category,priority,description,entry_type) values (%L,%L,%L,%L,%L,%L)',
      w_b, d_b, 'general', 'low', 'must be denied', 'comment'
    ));

  update public.weekly_submissions
     set status = 'in_progress'
   where weekly_report_id = w_a and department_id = d_a;
  get diagnostics n = row_count;
  perform pg_temp.chk(5, 'DEPARTMENT USER',
    'cannot edit Weekly submission content', n = 0, n::text || ' rows');

  insert into public.monthly_comments (
    monthly_report_id, source_kind, department_id, update_type,
    original_text, priority, status
  ) values (
    m_a, 'monthly_manual', d_a, 'general',
    'ZZ-AUTH own Monthly comment', 'low', 'open'
  ) returning id into monthly_comment;
  perform pg_temp.chk(5, 'DEPARTMENT USER',
    'can create own-department Monthly comment', monthly_comment is not null);

  update public.monthly_comments
     set presentation_text = 'ZZ-AUTH edited Monthly comment'
   where id = monthly_comment;
  get diagnostics n = row_count;
  perform pg_temp.chk(5, 'DEPARTMENT USER',
    'can edit own-department Monthly comment', n = 1);

  perform pg_temp.must_fail_with(5, 'DEPARTMENT USER',
    'cannot create another-department Monthly comment', '42501',
    format(
      'insert into public.monthly_comments(monthly_report_id,source_kind,department_id,update_type,original_text,priority,status) values (%L,%L,%L,%L,%L,%L,%L)',
      m_a, 'monthly_manual', d_other, 'general', 'must be denied', 'low', 'open'
    ));

  delete from public.weekly_entries where id = weekly_comment;
  get diagnostics n = row_count;
  perform pg_temp.chk(5, 'DEPARTMENT USER',
    'cannot delete Weekly comment', n = 0, n::text || ' rows');

  delete from public.monthly_comments where id = monthly_comment;
  get diagnostics n = row_count;
  perform pg_temp.chk(5, 'DEPARTMENT USER',
    'cannot delete Monthly comment', n = 0, n::text || ' rows');

  perform pg_temp.must_fail_with(5, 'DEPARTMENT USER',
    'cannot submit a Master Milestone update', '42501',
    format(
      'insert into public.milestone_updates(milestone_id,source,department_id,status,progress_percent) values (%L,%L,%L,%L,%s)',
      milestone_id, 'weekly', d_a, 'in_progress', 10
    ));
end;
$t$;

reset role;

select seq, area, item, verdict
  from r
 order by seq, area, item;

select count(*) filter (where verdict like 'PASS%') as pass,
       count(*) filter (where verdict like 'FAIL%') as fail
  from r;

rollback;

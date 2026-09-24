-- Replace Person, Pass A — local runtime smoke test.
--
-- LOCAL DATABASE ONLY. Everything is inside one BEGIN ... ROLLBACK; nothing
-- persists. Mirrors the structure/conventions of
-- scripts/p0-validation/94_runtime_authorization_foundation.sql:
--   - pg_temp.chk() / pg_temp.must_fail_tagged() record PASS/FAIL into a temp
--     table instead of aborting the script on the first failure.
--   - impersonation via `set local role authenticated` +
--     `set local request.jwt.claims`, exactly what PostgREST does for a
--     signed-in caller.
--
-- Requires migrations 20260909000001 and 20260909000002 applied locally.

\set ON_ERROR_STOP on

do $guard$
begin
  if inet_server_addr() is not null
     and host(inet_server_addr()) not in ('127.0.0.1', '::1', 'localhost') then
    raise exception
      'REFUSING TO RUN: this suite is local-only (server address %).',
      host(inet_server_addr());
  end if;
  if not exists (
    select 1 from pg_proc where proname = 'replace_project_responsibility'
  ) then
    raise exception 'Missing replace_project_responsibility(). Run the Pass A migrations first.';
  end if;
end;
$guard$;

begin;
set constraints trg_fixed_project_responsibility_membership deferred;

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
  p_seq int, p_area text, p_item text, p_ok boolean, p_detail text default ''
) returns void language plpgsql as $fn$
begin
  insert into r values (
    p_seq, p_area, p_item,
    case when p_ok then 'PASS' else 'FAIL' end
    || case when p_detail = '' then '' else ' - ' || p_detail end
  );
end;
$fn$;

-- Executes p_sql expecting an exception whose message starts with
-- '[' || p_expected_tag || ']'. Contained in its own EXCEPTION block, so a
-- caught error never poisons the outer transaction (matches must_fail_with()
-- in 94_runtime_authorization_foundation.sql, tag-based instead of SQLSTATE-based
-- since several of this RPC's business refusals intentionally share one SQLSTATE).
create or replace function pg_temp.must_fail_tagged(
  p_seq int, p_area text, p_item text, p_expected_tag text, p_sql text
) returns void language plpgsql as $fn$
begin
  execute p_sql;
  perform pg_temp.chk(p_seq, p_area, p_item, false, 'statement was accepted');
exception when others then
  perform pg_temp.chk(
    p_seq, p_area, p_item,
    sqlerrm like '[' || p_expected_tag || ']%',
    'got: ' || left(sqlerrm, 140)
  );
end;
$fn$;

/* ============================== FIXTURES =================================
   Everything below is disposable, prefixed ZZ-RP, and rolled back at the end.
   ========================================================================= */

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000','00000000-0000-4000-a000-0000000000a1',
   'authenticated','authenticated','p0test.admin@example.invalid',
   'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY',now(),
   '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-4000-b000-0000000000f1',
   'authenticated','authenticated','zz.rp.pca@example.invalid',
   'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY',now(),
   '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-4000-b000-0000000000f2',
   'authenticated','authenticated','zz.rp.pcp@example.invalid',
   'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY',now(),
   '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-4000-b000-0000000000f3',
   'authenticated','authenticated','zz.rp.rc@example.invalid',
   'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY',now(),
   '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-4000-b000-0000000000f4',
   'authenticated','authenticated','zz.rp.dept@example.invalid',
   'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY',now(),
   '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now())
on conflict (id) do nothing;

insert into public.profiles (id, email, full_name, role, active)
values ('00000000-0000-4000-a000-0000000000a1','p0test.admin@example.invalid',
        'ZZ-P0TEST Administrator','system_admin', true)
on conflict (id) do nothing;

insert into public.profiles (id, email, full_name, role, active)
values ('00000000-0000-4000-b000-0000000000f1','zz.rp.pca@example.invalid',
        'ZZ-RP PCA Account','project_control_admin', true)
on conflict (id) do nothing;

insert into public.clients (name, code) values ('ZZ-RP Client', 'ZZ-RP-CLIENT');

insert into public.departments (name, code) values
  ('ZZ-RP Dept A', 'ZZ-RP-DEPT-A'),
  ('ZZ-RP Dept B', 'ZZ-RP-DEPT-B');

insert into public.systems (name, code, department_id)
select 'ZZ-RP System 1', 'ZZ-RP-SYS-1', d.id from public.departments d where d.code='ZZ-RP-DEPT-A';
insert into public.systems (name, code, department_id)
select 'ZZ-RP System 2', 'ZZ-RP-SYS-2', d.id from public.departments d where d.code='ZZ-RP-DEPT-A';

insert into public.job_titles (name, code) values
  ('ZZ-RP Position Title', 'ZZ-RP-POS-TITLE'),
  ('ZZ-RP Other Position Title', 'ZZ-RP-POS-TITLE-OTHER'),
  ('ZZ-RP Orphan Position Title', 'ZZ-RP-POS-TITLE-ORPHAN');

-- Contacts -------------------------------------------------------------------
insert into public.contacts (name, email, department_id, active)
select v.name, v.email, d.id, v.active
  from public.departments d,
       (values
         ('ZZ-RP PC Planning',        'zz.rp.pcplanning@example.invalid',  true),
         ('ZZ-RP Report Coordinator', 'zz.rp.rc.contact@example.invalid',  true),
         ('ZZ-RP Dept Viewer',        'zz.rp.deptviewer@example.invalid',  true),
         ('ZZ-RP Manager A',          'zz.rp.managera@example.invalid',    true),
         ('ZZ-RP Report1',            'zz.rp.report1@example.invalid',     true),
         ('ZZ-RP Report2',           'zz.rp.report2@example.invalid',      true),
         ('ZZ-RP Report2 Replacement','zz.rp.report2repl@example.invalid', true),
         ('ZZ-RP Lead2',              'zz.rp.lead2@example.invalid',       true),
         ('ZZ-RP Dept B Manager',     'zz.rp.deptbmanager@example.invalid',true),
         ('ZZ-RP PM A',               'zz.rp.pma@example.invalid',         true),
         ('ZZ-RP PM B',               'zz.rp.pmb@example.invalid',         true),
         ('ZZ-RP Position Holder A',  'zz.rp.posholdera@example.invalid',  true),
         ('ZZ-RP Position Holder B',  'zz.rp.posholderb@example.invalid',  true),
         ('ZZ-RP Other Position Holder','zz.rp.otherpos@example.invalid',  true),
         ('ZZ-RP Inactive Person',    'zz.rp.inactive@example.invalid',    false),
         ('ZZ-RP Non-member',         'zz.rp.nonmember@example.invalid',   true),
         ('ZZ-RP Orphan Risk Person', 'zz.rp.orphanrisk@example.invalid',  true),
         ('ZZ-RP Orphan Replacement', 'zz.rp.orphanrepl@example.invalid',  true),
         ('ZZ-RP Auth Probe SysAdmin From', 'zz.rp.probe.a1.from@example.invalid', true),
         ('ZZ-RP Auth Probe SysAdmin To',   'zz.rp.probe.a1.to@example.invalid',   true),
         ('ZZ-RP Auth Probe PCA From',      'zz.rp.probe.pca.from@example.invalid', true),
         ('ZZ-RP Auth Probe PCA To',        'zz.rp.probe.pca.to@example.invalid',   true),
         ('ZZ-RP Auth Probe PCP From',      'zz.rp.probe.pcp.from@example.invalid', true),
         ('ZZ-RP Auth Probe PCP To',        'zz.rp.probe.pcp.to@example.invalid',   true),
         ('ZZ-RP Auth Probe Denied From',   'zz.rp.probe.denied.from@example.invalid', true),
         ('ZZ-RP Auth Probe Denied To',     'zz.rp.probe.denied.to@example.invalid',   true)
       ) as v(name, email, active)
 where d.code = 'ZZ-RP-DEPT-A';

update public.contacts set active = false where name = 'ZZ-RP Inactive Person';

-- Link RC/PCP/Dept auth identities to their contacts.
insert into public.profiles (id, email, full_name, role, contact_id, active)
select '00000000-0000-4000-b000-0000000000f2', 'zz.rp.pcp@example.invalid',
       'ZZ-RP PC Planning Account', 'viewer', c.id, true
  from public.contacts c where c.name = 'ZZ-RP PC Planning'
on conflict (id) do nothing;
insert into public.profiles (id, email, full_name, role, contact_id, active)
select '00000000-0000-4000-b000-0000000000f3', 'zz.rp.rc@example.invalid',
       'ZZ-RP Report Coordinator Account', 'viewer', c.id, true
  from public.contacts c where c.name = 'ZZ-RP Report Coordinator'
on conflict (id) do nothing;
insert into public.profiles (id, email, full_name, role, contact_id, active)
select '00000000-0000-4000-b000-0000000000f4', 'zz.rp.dept@example.invalid',
       'ZZ-RP Dept Viewer Account', 'viewer', c.id, true
  from public.contacts c where c.name = 'ZZ-RP Dept Viewer'
on conflict (id) do nothing;

-- Projects ---------------------------------------------------------------
insert into public.projects (
  code, name, client_id, project_manager_id,
  planned_start_date, planned_finish_date, status
)
select 'ZZ-RP-PRJ', 'ZZ-RP Primary Project',
  (select id from public.clients where code='ZZ-RP-CLIENT'),
  (select id from public.contacts where name='ZZ-RP PM A'),
  current_date, current_date + 90, 'active';

insert into public.projects (
  code, name, client_id, project_manager_id,
  planned_start_date, planned_finish_date, status
)
select 'ZZ-RP-PRJ-2', 'ZZ-RP Secondary Project (isolation target)',
  (select id from public.clients where code='ZZ-RP-CLIENT'),
  (select id from public.contacts where name='ZZ-RP Manager A'),
  current_date, current_date + 90, 'active';

insert into public.project_departments (project_id, department_id, reporting_required)
select p.id, d.id, true from public.projects p, public.departments d
 where p.code='ZZ-RP-PRJ' and d.code in ('ZZ-RP-DEPT-A','ZZ-RP-DEPT-B');

-- Fixed-responsibility mirror rows (matches ensureResponsibilityContacts()).
insert into public.project_contacts (project_id, contact_id, role)
select p.id, c.id, 'project_manager'
  from public.projects p, public.contacts c
 where p.code='ZZ-RP-PRJ' and c.name='ZZ-RP PM A';

insert into public.project_contacts (project_id, contact_id, role)
select p.id, c.id, 'project_manager'
  from public.projects p, public.contacts c
 where p.code='ZZ-RP-PRJ-2' and c.name='ZZ-RP Manager A';

-- Auth-matrix subjects: assigned PC/Planning and assigned Report Coordinator
-- on ZZ-RP-PRJ, per is_project_control_planning()/is_report_coordinator() —
-- unscoped rows (department/system/discipline/assignment_role all NULL).
insert into public.project_contacts (project_id, contact_id, role)
select p.id, c.id, 'project_control_manager'
  from public.projects p, public.contacts c
 where p.code='ZZ-RP-PRJ' and c.name='ZZ-RP PC Planning';

insert into public.project_contacts (project_id, contact_id, role)
select p.id, c.id, 'reporting_coordinator'
  from public.projects p, public.contacts c
 where p.code='ZZ-RP-PRJ' and c.name='ZZ-RP Report Coordinator';

-- Plain department viewer — a team member with no responsibility authority.
insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role)
select p.id, c.id, 'team_member', d.id, 'team_member'
  from public.projects p, public.contacts c, public.departments d
 where p.code='ZZ-RP-PRJ' and c.name='ZZ-RP Dept Viewer' and d.code='ZZ-RP-DEPT-A';

-- Department A team: Manager A holds the role via TWO backing rows (two
-- systems) — proves one logical unit, many backing rows.
insert into public.project_contacts (project_id, contact_id, role, department_id, system_id, assignment_role)
select p.id, c.id, 'team_member', d.id, s.id, 'department_manager'
  from public.projects p, public.contacts c, public.departments d, public.systems s
 where p.code='ZZ-RP-PRJ' and c.name='ZZ-RP Manager A' and d.code='ZZ-RP-DEPT-A'
   and s.code in ('ZZ-RP-SYS-1','ZZ-RP-SYS-2');

insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role, reports_to_contact_id)
select p.id, c.id, 'team_member', d.id, 'team_member_lead', m.id
  from public.projects p, public.contacts c, public.departments d, public.contacts m
 where p.code='ZZ-RP-PRJ' and c.name='ZZ-RP Report1' and d.code='ZZ-RP-DEPT-A'
   and m.name='ZZ-RP Manager A';

insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role, reports_to_contact_id)
select p.id, c.id, 'team_member', d.id, 'team_member_lead', m.id
  from public.projects p, public.contacts c, public.departments d, public.contacts m
 where p.code='ZZ-RP-PRJ' and c.name='ZZ-RP Lead2' and d.code='ZZ-RP-DEPT-A'
   and m.name='ZZ-RP Manager A';

insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role, reports_to_contact_id)
select p.id, c.id, 'team_member', d.id, 'team_member', m.id
  from public.projects p, public.contacts c, public.departments d, public.contacts m
 where p.code='ZZ-RP-PRJ' and c.name='ZZ-RP Report2' and d.code='ZZ-RP-DEPT-A'
   and m.name='ZZ-RP Manager A';

-- Department B: unrelated manager, must stay untouched throughout.
insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role)
select p.id, c.id, 'team_member', d.id, 'department_manager'
  from public.projects p, public.contacts c, public.departments d
 where p.code='ZZ-RP-PRJ' and c.name='ZZ-RP Dept B Manager' and d.code='ZZ-RP-DEPT-B';

-- Orphan-risk fixture: this person's ONLY project_contacts row on ZZ-RP-PRJ is
-- the DEPT-B team_member row below, and they ALSO hold a project_positions
-- row on the SAME project (added further down) — the exact shape
-- trg_project_contact_membership_removal (and now the RPC's own pre-check)
-- exists to protect.
insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role)
select p.id, c.id, 'team_member', d.id, 'team_member'
  from public.projects p, public.contacts c, public.departments d
 where p.code='ZZ-RP-PRJ' and c.name='ZZ-RP Orphan Risk Person' and d.code='ZZ-RP-DEPT-B';

-- Delegations: one for Report1 (relevant to the manager replacement), one for
-- Report2 (relevant to the later plain team_member replacement).
insert into public.project_delegations (project_id, department_id, delegate_contact_id, responsibilities, start_date, end_date, active)
select p.id, d.id, c.id, '["review_submissions"]'::jsonb, current_date - 1, current_date + 7, true
  from public.projects p, public.departments d, public.contacts c
 where p.code='ZZ-RP-PRJ' and d.code='ZZ-RP-DEPT-A' and c.name='ZZ-RP Report1';

insert into public.project_delegations (project_id, department_id, delegate_contact_id, responsibilities, start_date, end_date, active)
select p.id, d.id, c.id, '["complete_department"]'::jsonb, current_date - 1, current_date + 7, true
  from public.projects p, public.departments d, public.contacts c
 where p.code='ZZ-RP-PRJ' and d.code='ZZ-RP-DEPT-A' and c.name='ZZ-RP Report2';

-- Project positions: Position Holder A/B, an unrelated same-project position,
-- and a same-job-title position on the OTHER project (cross-project check).
-- Holders must already be project members (guard_project_position_membership()).
insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role)
select p.id, c.id, 'team_member', d.id, 'team_member'
  from public.projects p, public.contacts c, public.departments d
 where p.code='ZZ-RP-PRJ' and c.name in ('ZZ-RP Position Holder A','ZZ-RP Position Holder B','ZZ-RP Other Position Holder')
   and d.code='ZZ-RP-DEPT-A';

insert into public.project_positions (project_id, job_title_id, contact_id, notes)
select p.id, jt.id, c.id, 'ZZ-RP main position under test'
  from public.projects p, public.job_titles jt, public.contacts c
 where p.code='ZZ-RP-PRJ' and jt.code='ZZ-RP-POS-TITLE' and c.name='ZZ-RP Position Holder A';

-- The position that would be orphaned if the fixture below is allowed to
-- proceed unchecked.
insert into public.project_positions (project_id, job_title_id, contact_id, notes)
select p.id, jt.id, c.id, 'ZZ-RP orphan-risk position'
  from public.projects p, public.job_titles jt, public.contacts c
 where p.code='ZZ-RP-PRJ' and jt.code='ZZ-RP-POS-TITLE-ORPHAN' and c.name='ZZ-RP Orphan Risk Person';

insert into public.project_positions (project_id, job_title_id, contact_id, notes)
select p.id, jt.id, c.id, 'ZZ-RP unrelated same-project position'
  from public.projects p, public.job_titles jt, public.contacts c
 where p.code='ZZ-RP-PRJ' and jt.code='ZZ-RP-POS-TITLE-OTHER' and c.name='ZZ-RP Other Position Holder';

insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role)
select p.id, c.id, 'team_member', d.id, 'team_member'
  from public.projects p, public.contacts c, public.departments d
 where p.code='ZZ-RP-PRJ-2' and c.name='ZZ-RP Other Position Holder' and d.code='ZZ-RP-DEPT-A';
-- (department_id above is cosmetic only for the FK; ZZ-RP-PRJ-2 has no
--  project_departments row, membership-guard only needs project_contacts.)

insert into public.project_positions (project_id, job_title_id, contact_id, notes)
select p.id, jt.id, c.id, 'ZZ-RP cross-project same job title'
  from public.projects p, public.job_titles jt, public.contacts c
 where p.code='ZZ-RP-PRJ-2' and jt.code='ZZ-RP-POS-TITLE' and c.name='ZZ-RP Other Position Holder';

-- Auth-matrix probes: three ALLOWED pairs (will actually mutate; each used
-- once) and one DENIED pair (reused for RC and Dept — a denial never mutates).
-- Only the "From" side is seeded as a team member; department_assignment
-- replacement does not require the replacement ("To") to already be a project
-- member (only fixed_responsibility/project_position do) — seeding both sides
-- identically would make every probe collide on DUPLICATE_ASSIGNMENT before
-- authorization is even the thing being measured.
insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role)
select p.id, c.id, 'team_member', d.id, 'team_member'
  from public.projects p, public.contacts c, public.departments d
 where p.code='ZZ-RP-PRJ' and d.code='ZZ-RP-DEPT-A'
   and c.name in (
     'ZZ-RP Auth Probe SysAdmin From',
     'ZZ-RP Auth Probe PCA From',
     'ZZ-RP Auth Probe PCP From',
     'ZZ-RP Auth Probe Denied From'
   );

/* =========================== 1. AUTHORIZATION MATRIX ======================= */

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000000000a1","role":"authenticated"}';
do $t$
declare v_project uuid := (select id from public.projects where code='ZZ-RP-PRJ');
begin
  perform pg_temp.chk(1,'AUTH','A. System Admin allowed',
    (public.replace_project_responsibility(
      v_project,'department_assignment',
      (select id from public.contacts where name='ZZ-RP Auth Probe SysAdmin From'),
      (select id from public.contacts where name='ZZ-RP Auth Probe SysAdmin To'),
      null, (select id from public.departments where code='ZZ-RP-DEPT-A'), 'team_member', null,
      'ZZ-RP auth probe: system admin'
    ) ->> 'historyId') is not null);
end;
$t$;

set local request.jwt.claims = '{"sub":"00000000-0000-4000-b000-0000000000f1","role":"authenticated"}';
do $t$
declare v_project uuid := (select id from public.projects where code='ZZ-RP-PRJ');
begin
  perform pg_temp.chk(1,'AUTH','B. Project Control Admin allowed',
    (public.replace_project_responsibility(
      v_project,'department_assignment',
      (select id from public.contacts where name='ZZ-RP Auth Probe PCA From'),
      (select id from public.contacts where name='ZZ-RP Auth Probe PCA To'),
      null, (select id from public.departments where code='ZZ-RP-DEPT-A'), 'team_member', null,
      'ZZ-RP auth probe: project control admin'
    ) ->> 'historyId') is not null);
end;
$t$;

set local request.jwt.claims = '{"sub":"00000000-0000-4000-b000-0000000000f2","role":"authenticated"}';
do $t$
declare v_project uuid := (select id from public.projects where code='ZZ-RP-PRJ');
begin
  perform pg_temp.chk(1,'AUTH','C. Assigned Project Control / Planning allowed',
    (public.replace_project_responsibility(
      v_project,'department_assignment',
      (select id from public.contacts where name='ZZ-RP Auth Probe PCP From'),
      (select id from public.contacts where name='ZZ-RP Auth Probe PCP To'),
      null, (select id from public.departments where code='ZZ-RP-DEPT-A'), 'team_member', null,
      'ZZ-RP auth probe: assigned project control'
    ) ->> 'historyId') is not null);
end;
$t$;

set local request.jwt.claims = '{"sub":"00000000-0000-4000-b000-0000000000f3","role":"authenticated"}';
do $t$
declare v_project uuid := (select id from public.projects where code='ZZ-RP-PRJ');
begin
  perform pg_temp.must_fail_tagged(1,'AUTH','D. Report Coordinator denied','UNAUTHORIZED',
    format(
      'select public.replace_project_responsibility(%L,%L,%L,%L,null,%L,%L,null,%L)',
      v_project, 'department_assignment',
      (select id from public.contacts where name='ZZ-RP Auth Probe Denied From'),
      (select id from public.contacts where name='ZZ-RP Auth Probe Denied To'),
      (select id from public.departments where code='ZZ-RP-DEPT-A'), 'team_member',
      'ZZ-RP auth probe: report coordinator (must be denied)'
    ));
end;
$t$;

set local request.jwt.claims = '{"sub":"00000000-0000-4000-b000-0000000000f4","role":"authenticated"}';
do $t$
declare v_project uuid := (select id from public.projects where code='ZZ-RP-PRJ');
begin
  perform pg_temp.must_fail_tagged(1,'AUTH','E. Department viewer denied','UNAUTHORIZED',
    format(
      'select public.replace_project_responsibility(%L,%L,%L,%L,null,%L,%L,null,%L)',
      v_project, 'department_assignment',
      (select id from public.contacts where name='ZZ-RP Auth Probe Denied From'),
      (select id from public.contacts where name='ZZ-RP Auth Probe Denied To'),
      (select id from public.departments where code='ZZ-RP-DEPT-A'), 'team_member',
      'ZZ-RP auth probe: department viewer (must be denied)'
    ));
end;
$t$;

-- Confirm the denied probe truly never mutated (both denials targeted it).
do $t$
begin
  perform pg_temp.chk(1,'AUTH','denied probe left untouched',
    exists (
      select 1 from public.project_contacts pc
        join public.contacts c on c.id = pc.contact_id
       where c.name = 'ZZ-RP Auth Probe Denied From' and pc.assignment_role = 'team_member'
    ));
end;
$t$;

/* From here on, act as ZZ-RP PC Planning (assigned Project Control) — an
   allowed, non-global identity, matching who would realistically drive this
   feature day to day. */
set local request.jwt.claims = '{"sub":"00000000-0000-4000-b000-0000000000f2","role":"authenticated"}';

/* ============================ 2. VALIDATION TESTS =========================== */

do $t$
declare
  v_project uuid := (select id from public.projects where code='ZZ-RP-PRJ');
  v_dept_a uuid := (select id from public.departments where code='ZZ-RP-DEPT-A');
  v_manager_a uuid := (select id from public.contacts where name='ZZ-RP Manager A');
  v_report1 uuid := (select id from public.contacts where name='ZZ-RP Report1');
  v_lead2 uuid := (select id from public.contacts where name='ZZ-RP Lead2');
  v_pm_a uuid := (select id from public.contacts where name='ZZ-RP PM A');
  v_nonexistent uuid := '00000000-0000-4000-c000-000000000000';
  v_inactive uuid := (select id from public.contacts where name='ZZ-RP Inactive Person');
  v_dept_b uuid := (select id from public.departments where code='ZZ-RP-DEPT-B');
  v_orphan_risk uuid := (select id from public.contacts where name='ZZ-RP Orphan Risk Person');
  v_orphan_repl uuid := (select id from public.contacts where name='ZZ-RP Orphan Replacement');
begin
  perform pg_temp.must_fail_tagged(2,'VALIDATION','same person selected','SAME_PERSON',
    format('select public.replace_project_responsibility(%L,%L,%L,%L,null,%L,%L,null,%L)',
      v_project,'department_assignment', v_manager_a, v_manager_a, v_dept_a,'department_manager','x'));

  perform pg_temp.must_fail_tagged(2,'VALIDATION','empty reason','REASON_REQUIRED',
    format('select public.replace_project_responsibility(%L,%L,%L,%L,null,%L,%L,null,%L)',
      v_project,'department_assignment', v_manager_a, v_report1, v_dept_a,'department_manager',''));

  perform pg_temp.must_fail_tagged(2,'VALIDATION','whitespace-only reason','REASON_REQUIRED',
    format('select public.replace_project_responsibility(%L,%L,%L,%L,null,%L,%L,null,%L)',
      v_project,'department_assignment', v_manager_a, v_report1, v_dept_a,'department_manager','    '));

  perform pg_temp.must_fail_tagged(2,'VALIDATION','invalid (nonexistent) replacement person','NOT_FOUND',
    format('select public.replace_project_responsibility(%L,%L,%L,%L,null,%L,%L,null,%L)',
      v_project,'department_assignment', v_manager_a, v_nonexistent, v_dept_a,'department_manager','x'));

  perform pg_temp.must_fail_tagged(2,'VALIDATION','inactive replacement contact','INACTIVE_REPLACEMENT',
    format('select public.replace_project_responsibility(%L,%L,%L,%L,null,%L,%L,null,%L)',
      v_project,'department_assignment', v_manager_a, v_inactive, v_dept_a,'department_manager','x'));

  -- stale/missing current assignment: Report1 is team_member_lead, not manager.
  perform pg_temp.must_fail_tagged(2,'VALIDATION','stale/missing current assignment','STALE_ASSIGNMENT',
    format('select public.replace_project_responsibility(%L,%L,%L,%L,null,%L,%L,null,%L)',
      v_project,'department_assignment', v_report1, v_lead2, v_dept_a,'department_manager','x'));

  -- replacement already holds the same logical responsibility: both Report1
  -- and Lead2 are team_member_lead in DEPT-A already.
  perform pg_temp.must_fail_tagged(2,'VALIDATION','replacement already holds same responsibility','DUPLICATE_ASSIGNMENT',
    format('select public.replace_project_responsibility(%L,%L,%L,%L,null,%L,%L,null,%L)',
      v_project,'department_assignment', v_report1, v_lead2, v_dept_a,'team_member_lead','x'));

  -- fixed-responsibility replacement to a non-member is refused cleanly
  -- (the correction migration's own check, re-verified in this full suite).
  perform pg_temp.must_fail_tagged(2,'VALIDATION','fixed responsibility to non-member','NOT_PROJECT_MEMBER',
    format('select public.replace_project_responsibility(%L,%L,%L,%L,%L,null,null,null,%L)',
      v_project,'fixed_responsibility', v_pm_a,
      (select id from public.contacts where name='ZZ-RP Non-member'),
      'project_manager','x'));

  -- Orphan Risk Person's ONLY project_contacts row on ZZ-RP-PRJ is this exact
  -- DEPT-B team_member unit, and they also hold a project_positions row here —
  -- retargeting it away would leave that position pointing at a non-member.
  perform pg_temp.must_fail_tagged(2,'VALIDATION',
    'department replacement would orphan a held position','LAST_MEMBERSHIP_REFERENCED',
    format('select public.replace_project_responsibility(%L,%L,%L,%L,null,%L,%L,null,%L)',
      v_project,'department_assignment', v_orphan_risk, v_orphan_repl, v_dept_b,'team_member','x'));
end;
$t$;

-- Confirm the refused call changed nothing: membership row, position, and
-- history all exactly as before.
do $t$
declare
  v_project uuid := (select id from public.projects where code='ZZ-RP-PRJ');
  v_dept_b uuid := (select id from public.departments where code='ZZ-RP-DEPT-B');
  v_orphan_risk uuid := (select id from public.contacts where name='ZZ-RP Orphan Risk Person');
begin
  perform pg_temp.chk(2,'VALIDATION','orphan-risk membership row untouched',
    exists (
      select 1 from public.project_contacts
       where project_id=v_project and department_id=v_dept_b
         and contact_id=v_orphan_risk and assignment_role='team_member'
    ));
  perform pg_temp.chk(2,'VALIDATION','orphan-risk position untouched',
    exists (
      select 1 from public.project_positions
       where project_id=v_project and contact_id=v_orphan_risk
         and notes='ZZ-RP orphan-risk position'
    ));
  perform pg_temp.chk(2,'VALIDATION','no history event written for the refused attempt',
    not exists (
      select 1 from public.project_responsibility_history
       where previous_contact_id=v_orphan_risk
    ));
end;
$t$;

-- Department Manager conflict: force a drift row (a third contact also
-- holding department_manager in DEPT-A), prove the refusal, then remove the
-- drift so it does not contaminate the functional test below.
insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role)
select p.id, c.id, 'team_member', d.id, 'department_manager'
  from public.projects p, public.contacts c, public.departments d
 where p.code='ZZ-RP-PRJ' and c.name='ZZ-RP Dept B Manager' and d.code='ZZ-RP-DEPT-A';

do $t$
declare
  v_project uuid := (select id from public.projects where code='ZZ-RP-PRJ');
  v_dept_a uuid := (select id from public.departments where code='ZZ-RP-DEPT-A');
  v_manager_a uuid := (select id from public.contacts where name='ZZ-RP Manager A');
  v_report1 uuid := (select id from public.contacts where name='ZZ-RP Report1');
begin
  perform pg_temp.must_fail_tagged(2,'VALIDATION','Department Manager conflict','MANAGER_CONFLICT',
    format('select public.replace_project_responsibility(%L,%L,%L,%L,null,%L,%L,null,%L)',
      v_project,'department_assignment', v_manager_a, v_report1, v_dept_a,'department_manager','x'));
end;
$t$;

delete from public.project_contacts
 where project_id = (select id from public.projects where code='ZZ-RP-PRJ')
   and department_id = (select id from public.departments where code='ZZ-RP-DEPT-A')
   and assignment_role = 'department_manager'
   and contact_id = (select id from public.contacts where name='ZZ-RP Dept B Manager');

/* ===================== 3. DEPARTMENT MANAGER REPLACEMENT =================== */

do $t$
declare
  v_project uuid := (select id from public.projects where code='ZZ-RP-PRJ');
  v_dept_a uuid := (select id from public.departments where code='ZZ-RP-DEPT-A');
  v_dept_b uuid := (select id from public.departments where code='ZZ-RP-DEPT-B');
  v_manager_a uuid := (select id from public.contacts where name='ZZ-RP Manager A');
  v_report1 uuid := (select id from public.contacts where name='ZZ-RP Report1');
  v_report2 uuid := (select id from public.contacts where name='ZZ-RP Report2');
  v_lead2 uuid := (select id from public.contacts where name='ZZ-RP Lead2');
  v_result jsonb;
  v_history_count int;
  v_history_row record;
begin
  v_result := public.replace_project_responsibility(
    v_project, 'department_assignment', v_manager_a, v_report1,
    null, v_dept_a, 'department_manager', null,
    'ZZ-RP test: Manager A leaving, Report1 (existing lead) takes over'
  );

  perform pg_temp.chk(3,'DEPT MANAGER','B becomes Department Manager',
    exists (select 1 from public.project_contacts
             where project_id=v_project and department_id=v_dept_a
               and contact_id=v_report1 and assignment_role='department_manager'));
  perform pg_temp.chk(3,'DEPT MANAGER','rowsUpdated = 2 (two backing system rows)',
    (v_result->>'rowsUpdated')::int = 2, v_result->>'rowsUpdated');

  perform pg_temp.chk(3,'DEPT MANAGER','A no longer holds the Manager unit',
    not exists (select 1 from public.project_contacts
                 where project_id=v_project and department_id=v_dept_a
                   and contact_id=v_manager_a and assignment_role='department_manager'));

  perform pg_temp.chk(3,'DEPT MANAGER','Report2 reports_to repointed to B',
    (select reports_to_contact_id from public.project_contacts
      where project_id=v_project and department_id=v_dept_a and contact_id=v_report2) = v_report1);
  perform pg_temp.chk(3,'DEPT MANAGER','Lead2 reports_to repointed to B',
    (select reports_to_contact_id from public.project_contacts
      where project_id=v_project and department_id=v_dept_a and contact_id=v_lead2
        and assignment_role='team_member_lead') = v_report1);
  perform pg_temp.chk(3,'DEPT MANAGER','reportsRepointed = 2', (v_result->>'reportsRepointed')::int = 2,
    v_result->>'reportsRepointed');

  perform pg_temp.chk(3,'DEPT MANAGER',
    'B does not report to themselves (own pre-existing lead row cleared, not self-pointed)',
    (select reports_to_contact_id from public.project_contacts
      where project_id=v_project and department_id=v_dept_a and contact_id=v_report1
        and assignment_role='team_member_lead') is null,
    'observed side effect, matches the approved spec: clearing the new managers OWN reports_to in that department is unscoped by role');

  perform pg_temp.chk(3,'DEPT MANAGER',
    'B''s pre-existing team_member_lead row itself is untouched (still exists, still that role)',
    exists (select 1 from public.project_contacts
             where project_id=v_project and department_id=v_dept_a
               and contact_id=v_report1 and assignment_role='team_member_lead'));

  perform pg_temp.chk(3,'DEPT MANAGER','Dept B manager unchanged',
    exists (select 1 from public.project_contacts
             where project_id=v_project and department_id=v_dept_b
               and contact_id = (select id from public.contacts where name='ZZ-RP Dept B Manager')
               and assignment_role='department_manager'));

  -- NOT checked here: "Manager A unchanged on the other project" needs
  -- cross-project read visibility that the impersonated PC Planning identity
  -- correctly does not have under the platform's own projects_select policy
  -- (can_access_project(id) — PC Planning is assigned only to ZZ-RP-PRJ, so
  -- ZZ-RP-PRJ-2 is invisible to it, exactly as intended). Verified after
  -- `reset role`, below, from a position with full visibility instead.

  select count(*) into v_history_count from public.project_responsibility_history
   where project_id=v_project and department_id=v_dept_a and assignment_role='department_manager';
  perform pg_temp.chk(3,'DEPT MANAGER','exactly ONE history event despite 2 backing rows',
    v_history_count = 1, v_history_count::text);

  select * into v_history_row from public.project_responsibility_history
   where project_id=v_project and department_id=v_dept_a and assignment_role='department_manager';
  perform pg_temp.chk(3,'DEPT MANAGER','history: previous/replacement/project/reason/timestamp correct',
    v_history_row.previous_contact_id = v_manager_a
    and v_history_row.contact_id = v_report1
    and v_history_row.project_id = v_project
    and v_history_row.reason = 'ZZ-RP test: Manager A leaving, Report1 (existing lead) takes over'
    and v_history_row.created_at is not null);
  perform pg_temp.chk(3,'DEPT MANAGER','history.created_by is the ACTING ACCOUNT, not a contact',
    v_history_row.created_by = '00000000-0000-4000-b000-0000000000f2');

  perform pg_temp.chk(3,'DEPT MANAGER','delegation rows themselves unchanged (still active, still same delegate)',
    (select count(*) from public.project_delegations
      where project_id=v_project and department_id=v_dept_a and active) = 2);
  perform pg_temp.chk(3,'DEPT MANAGER','delegationsAsDelegate = 0 (A was not personally a delegate)',
    (v_result->>'delegationsAsDelegate')::int = 0);
  perform pg_temp.chk(3,'DEPT MANAGER','delegationsRequiringReview = 2 (surfaced, not transferred)',
    (v_result->>'delegationsRequiringReview')::int = 2, v_result->>'delegationsRequiringReview');
end;
$t$;

-- Supplementary: replacing a plain team_member who IS personally a delegate
-- exercises the OTHER delegation-count branch.
do $t$
declare
  v_project uuid := (select id from public.projects where code='ZZ-RP-PRJ');
  v_dept_a uuid := (select id from public.departments where code='ZZ-RP-DEPT-A');
  v_report2 uuid := (select id from public.contacts where name='ZZ-RP Report2');
  v_report2_repl uuid := (select id from public.contacts where name='ZZ-RP Report2 Replacement');
  v_result jsonb;
begin
  -- v_report2_repl is deliberately NOT pre-seeded as a project member —
  -- department_assignment replacement does not require prior membership
  -- (only fixed_responsibility/project_position do); pre-inserting them here
  -- with the same (department, assignment_role) would make them a duplicate
  -- of themselves before the call even runs.
  v_result := public.replace_project_responsibility(
    v_project, 'department_assignment', v_report2, v_report2_repl,
    null, v_dept_a, 'team_member', null,
    'ZZ-RP test: plain team member who is also a delegate'
  );
  perform pg_temp.chk(3,'DEPT MANAGER (supplementary)','delegationsAsDelegate = 1 for a team_member delegate',
    (v_result->>'delegationsAsDelegate')::int = 1, v_result->>'delegationsAsDelegate');
  perform pg_temp.chk(3,'DEPT MANAGER (supplementary)','delegationsRequiringReview = 0 (not a manager replacement)',
    (v_result->>'delegationsRequiringReview')::int = 0);
end;
$t$;

/* ========================= 4. FIXED RESPONSIBILITY ========================= */

do $t$
declare
  v_project uuid := (select id from public.projects where code='ZZ-RP-PRJ');
  v_pm_a uuid := (select id from public.contacts where name='ZZ-RP PM A');
  v_pm_b uuid := (select id from public.contacts where name='ZZ-RP PM B');
  v_result jsonb;
  v_mirror_id_before uuid;
  v_mirror_id_after uuid;
  v_effective_holders int;
begin
  -- PM B must already be a project member before it can become project_manager.
  insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role)
  select v_project, v_pm_b, 'team_member', d.id, 'team_member'
    from public.departments d where d.code='ZZ-RP-DEPT-A';

  select id into v_mirror_id_before from public.project_contacts
   where project_id=v_project and role='project_manager'
     and department_id is null and system_id is null and discipline_id is null and assignment_role is null;

  v_result := public.replace_project_responsibility(
    v_project, 'fixed_responsibility', v_pm_a, v_pm_b,
    'project_manager', null, null, null,
    'ZZ-RP test: fixed responsibility handover'
  );

  perform pg_temp.chk(4,'FIXED RESPONSIBILITY','projects.project_manager_id changed A -> B',
    (select project_manager_id from public.projects where id=v_project) = v_pm_b);

  select id into v_mirror_id_after from public.project_contacts
   where project_id=v_project and role='project_manager'
     and department_id is null and system_id is null and discipline_id is null and assignment_role is null;
  perform pg_temp.chk(4,'FIXED RESPONSIBILITY','mirror row updated in place (same row id, not delete+insert)',
    v_mirror_id_after = v_mirror_id_before);
  perform pg_temp.chk(4,'FIXED RESPONSIBILITY','mirror contact_id changed A -> B',
    (select contact_id from public.project_contacts where id=v_mirror_id_after) = v_pm_b);

  select count(*) into v_effective_holders from public.project_contacts
   where project_id=v_project and role='project_manager'
     and department_id is null and system_id is null and discipline_id is null and assignment_role is null;
  perform pg_temp.chk(4,'FIXED RESPONSIBILITY','no duplicate effective holder (exactly one mirror row)',
    v_effective_holders = 1, v_effective_holders::text);

  perform pg_temp.chk(4,'FIXED RESPONSIBILITY','exactly one history event',
    (select count(*) from public.project_responsibility_history
      where project_id=v_project and responsibility_role='project_manager') = 1);

  -- Stale compare-and-swap: retry with the OLD holder now rejected.
  perform pg_temp.must_fail_tagged(4,'FIXED RESPONSIBILITY',
    'stale compare-and-swap rejects an outdated attempt','STALE_ASSIGNMENT',
    format('select public.replace_project_responsibility(%L,%L,%L,%L,%L,null,null,null,%L)',
      v_project,'fixed_responsibility', v_pm_a, v_pm_b, 'project_manager','retry with stale holder'));
end;
$t$;

/* =========================== 5. PROJECT POSITION ============================ */

do $t$
declare
  v_project uuid := (select id from public.projects where code='ZZ-RP-PRJ');
  v_position_id uuid := (
    select id from public.project_positions
     where project_id=(select id from public.projects where code='ZZ-RP-PRJ')
       and notes='ZZ-RP main position under test'
  );
  v_holder_a uuid := (select id from public.contacts where name='ZZ-RP Position Holder A');
  v_holder_b uuid := (select id from public.contacts where name='ZZ-RP Position Holder B');
  v_other_position_contact_same_project uuid;
  v_other_position_contact_cross_project uuid;
  v_result jsonb;
begin
  v_result := public.replace_project_responsibility(
    v_project, 'project_position', v_holder_a, v_holder_b,
    null, null, null, v_position_id,
    'ZZ-RP test: position handover'
  );

  perform pg_temp.chk(5,'PROJECT POSITION','only the specified position row changed A -> B',
    (select contact_id from public.project_positions where id=v_position_id) = v_holder_b);

  select contact_id into v_other_position_contact_same_project
    from public.project_positions
   where project_id=v_project and notes='ZZ-RP unrelated same-project position';
  perform pg_temp.chk(5,'PROJECT POSITION','unrelated same-project position unchanged',
    v_other_position_contact_same_project = (select id from public.contacts where name='ZZ-RP Other Position Holder'));

  select contact_id into v_other_position_contact_cross_project
    from public.project_positions
   where notes='ZZ-RP cross-project same job title';
  perform pg_temp.chk(5,'PROJECT POSITION','cross-project same-job-title position unchanged',
    v_other_position_contact_cross_project = (select id from public.contacts where name='ZZ-RP Other Position Holder'));

  perform pg_temp.chk(5,'PROJECT POSITION','exactly one history event',
    (select count(*) from public.project_responsibility_history
      where project_position_id=v_position_id) = 1);

  perform pg_temp.must_fail_tagged(5,'PROJECT POSITION',
    'stale compare-and-swap rejects an outdated attempt','STALE_ASSIGNMENT',
    format('select public.replace_project_responsibility(%L,%L,%L,%L,null,null,null,%L,%L)',
      v_project,'project_position', v_holder_a, v_holder_b, v_position_id, 'retry with stale holder'));
end;
$t$;

reset role;

-- Cross-project isolation, verified with full (superuser) visibility rather
-- than through the impersonated PC Planning identity, which is correctly
-- unable to see ZZ-RP-PRJ-2 at all under projects_select's own
-- can_access_project(id) policy (PC Planning is assigned only to ZZ-RP-PRJ).
do $t$
begin
  perform pg_temp.chk(3,'DEPT MANAGER','Manager A unchanged on the OTHER project',
    (select project_manager_id from public.projects where code='ZZ-RP-PRJ-2')
      = (select id from public.contacts where name='ZZ-RP Manager A'));
end;
$t$;

select seq, area, item, verdict from r order by seq, area, item;
select count(*) filter (where verdict like 'PASS%') as pass,
       count(*) filter (where verdict like 'FAIL%') as fail
  from r;

rollback;

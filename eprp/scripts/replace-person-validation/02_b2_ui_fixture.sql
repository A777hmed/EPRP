-- Replace Person, Pass B2 — disposable LOCAL UI fixture.
--
-- LOCAL DATABASE ONLY. Unlike 01_runtime_smoke_test.sql this transaction
-- COMMITS on purpose — it exists to be clicked through by a human in the
-- browser, not asserted against and rolled back. Cleanup is a separate,
-- explicit step run only after the manual test (see the companion cleanup
-- script / report).
--
-- Everything created here is prefixed ZZ-RP-B2 (or ZZ-RP-B2-* for codes) so it
-- is unmistakably disposable and never collides with real data or with the
-- Pass A regression fixtures (ZZ-RP-*, no "B2").
--
-- Gives Khaled Fahmy's EXISTING local login (k.fahmy@eprom.com.eg, see
-- scripts/p0-validation/00b_local_ui_logins.sql) project-scoped Project
-- Control authority on ONE new disposable project, so B2 can be exercised
-- with the same real, sign-in-able account already used for the B1 manual
-- test — no System Admin escalation needed.

\set ON_ERROR_STOP on

do $guard$
begin
  if inet_server_addr() is not null
     and host(inet_server_addr()) not in ('127.0.0.1', '::1', 'localhost') then
    raise exception
      'REFUSING TO RUN: this fixture is local-only (server address %).',
      host(inet_server_addr());
  end if;
  if not exists (select 1 from public.contacts where email = 'k.fahmy@eprom.com.eg') then
    raise exception 'Khaled Fahmy contact (k.fahmy@eprom.com.eg) not found — has the seed changed?';
  end if;
end;
$guard$;

begin;
-- The project row below sets project_control_manager_id before Khaled's own
-- project_contacts mirror row (further down, same transaction) exists.
-- trg_fixed_project_responsibility_membership only checks at COMMIT when
-- deferred, matching the pattern in 01_runtime_smoke_test.sql and
-- scripts/p0-validation/01_setup_test_fixtures.sql.
set constraints trg_fixed_project_responsibility_membership deferred;

insert into public.clients (name, code)
values ('ZZ-RP-B2 Client', 'ZZ-RP-B2-CLIENT');

insert into public.departments (name, code)
values ('ZZ-RP-B2 Department', 'ZZ-RP-B2-DEPT');

insert into public.job_titles (name, code)
values ('ZZ-RP-B2 Position', 'ZZ-RP-B2-POS-TITLE');

-- Contacts ---------------------------------------------------------------
insert into public.contacts (name, email, department_id, active)
select v.name, v.email, d.id, true
  from public.departments d,
       (values
         ('ZZ-RP-B2 Person A',    'zz.rp.b2.persona@example.invalid'),
         ('ZZ-RP-B2 Person B',    'zz.rp.b2.personb@example.invalid'),
         ('ZZ-RP-B2 Subordinate', 'zz.rp.b2.subordinate@example.invalid'),
         ('ZZ-RP-B2 Person C',    'zz.rp.b2.personc@example.invalid'),
         ('ZZ-RP-B2 Person D',    'zz.rp.b2.persond@example.invalid')
       ) as v(name, email)
 where d.code = 'ZZ-RP-B2-DEPT';

-- Project ------------------------------------------------------------------
insert into public.projects (
  code, name, client_id, project_control_manager_id,
  planned_start_date, planned_finish_date, status
)
select 'ZZ-RP-B2-UI-TEST', 'ZZ-RP-B2 UI Test Project',
  (select id from public.clients where code = 'ZZ-RP-B2-CLIENT'),
  (select id from public.contacts where email = 'k.fahmy@eprom.com.eg'),
  current_date, current_date + 30, 'active';

insert into public.project_departments (project_id, department_id, reporting_required)
select p.id, d.id, true
  from public.projects p, public.departments d
 where p.code = 'ZZ-RP-B2-UI-TEST' and d.code = 'ZZ-RP-B2-DEPT';

-- Khaled's mirror row: unscoped project_control_manager row is what
-- is_project_control_planning() / can_manage_project_responsibilities()
-- actually check — the projects.project_control_manager_id column above is
-- the displayed value, not the authority source.
insert into public.project_contacts (project_id, contact_id, role)
select p.id, c.id, 'project_control_manager'
  from public.projects p, public.contacts c
 where p.code = 'ZZ-RP-B2-UI-TEST' and c.email = 'k.fahmy@eprom.com.eg';

-- Department assignment scenario --------------------------------------------
-- Person A: Department Manager. Subordinate: reports to Person A. Person B:
-- an active, already-on-the-project (but unrelated-role) replacement
-- candidate — never the incumbent of the unit under test.
insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role)
select p.id, c.id, 'team_member', d.id, 'department_manager'
  from public.projects p, public.contacts c, public.departments d
 where p.code = 'ZZ-RP-B2-UI-TEST' and c.name = 'ZZ-RP-B2 Person A' and d.code = 'ZZ-RP-B2-DEPT';

insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role, reports_to_contact_id)
select p.id, c.id, 'team_member', d.id, 'team_member', m.id
  from public.projects p, public.contacts c, public.departments d, public.contacts m
 where p.code = 'ZZ-RP-B2-UI-TEST' and c.name = 'ZZ-RP-B2 Subordinate' and d.code = 'ZZ-RP-B2-DEPT'
   and m.name = 'ZZ-RP-B2 Person A';

insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role)
select p.id, c.id, 'team_member', d.id, 'team_member'
  from public.projects p, public.contacts c, public.departments d
 where p.code = 'ZZ-RP-B2-UI-TEST' and c.name = 'ZZ-RP-B2 Person B' and d.code = 'ZZ-RP-B2-DEPT';

-- Project position scenario --------------------------------------------------
-- Both Person C (holder) and Person D (candidate) need a prior project
-- membership row first — guard_project_position_membership() requires it for
-- the holder, and this dialog's own candidate list requires it for anyone
-- offered as a replacement.
insert into public.project_contacts (project_id, contact_id, role, department_id, assignment_role)
select p.id, c.id, 'team_member', d.id, 'team_member'
  from public.projects p, public.contacts c, public.departments d
 where p.code = 'ZZ-RP-B2-UI-TEST'
   and c.name in ('ZZ-RP-B2 Person C', 'ZZ-RP-B2 Person D')
   and d.code = 'ZZ-RP-B2-DEPT';

insert into public.project_positions (project_id, job_title_id, contact_id, notes)
select p.id, jt.id, c.id, 'ZZ-RP-B2 disposable UI test position'
  from public.projects p, public.job_titles jt, public.contacts c
 where p.code = 'ZZ-RP-B2-UI-TEST' and jt.code = 'ZZ-RP-B2-POS-TITLE' and c.name = 'ZZ-RP-B2 Person C';

commit;

-- ------------------------------- report -------------------------------------
select p.id as project_id, p.code, p.name
  from public.projects p where p.code = 'ZZ-RP-B2-UI-TEST';

select c.name, c.id as contact_id, c.email
  from public.contacts c
 where c.name like 'ZZ-RP-B2 %'
 order by c.name;

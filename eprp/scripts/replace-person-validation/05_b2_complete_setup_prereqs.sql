-- Replace Person, Pass B2 — minimum Project Setup prerequisites so the
-- dedicated Contacts step (/setup/contacts) unlocks for the manual
-- Department Manager guard test.
--
-- LOCAL DATABASE ONLY. Companion to 02_b2_ui_fixture.sql and
-- 04_b2_add_discipline.sql, run after both, on the same fixture.
--
-- WHY THESE FIELDS SPECIFICALLY
--   The wizard's step-lock (evaluateProjectWorkflow() in
--   src/config/project-workflow.ts) unlocks "Contacts" only once Info,
--   Departments, Systems and Disciplines are ALL complete (cumulative AND).
--   Reading that function against this fixture's current state:
--     Info (5 of 8 passing)  — missing: project type, current phase, PM
--     Departments (2 of 2)   — already complete (reportingRequired=true)
--     Systems (0 of 1)       — missing: at least one system on the department
--     Disciplines (1 of 1)   — already complete (04_b2_add_discipline.sql)
--   Nothing here touches Contacts' own checks (team/manager already pass) or
--   any governed responsibility already assigned — see the guard below.
--
-- WHAT THIS DOES NOT TOUCH
--   Person A (Department Manager), Person C (position holder), Khaled Fahmy
--   (Project Control) are not modified. Two NEW disposable contacts fill the
--   two responsibility fields that are still genuinely empty (Project
--   Manager, Reporting Coordinator) — an initial assignment to an empty slot,
--   not a reassignment, so it does not touch anything the Replace Person
--   governance guard protects.

\set ON_ERROR_STOP on

do $guard$
begin
  if inet_server_addr() is not null
     and host(inet_server_addr()) not in ('127.0.0.1', '::1', 'localhost') then
    raise exception
      'REFUSING TO RUN: this fixture addendum is local-only (server address %).',
      host(inet_server_addr());
  end if;
  if not exists (select 1 from public.projects where code = 'ZZ-RP-B2-UI-TEST') then
    raise exception 'ZZ-RP-B2-UI-TEST not found — run 02_b2_ui_fixture.sql first.';
  end if;
  if not exists (
    select 1 from public.project_disciplines pd
      join public.projects p on p.id = pd.project_id
     where p.code = 'ZZ-RP-B2-UI-TEST'
  ) then
    raise exception 'No discipline link found — run 04_b2_add_discipline.sql first.';
  end if;
end;
$guard$;

begin;
-- projects.project_manager_id / reporting_coordinator_id are set below before
-- their mirror project_contacts rows exist — same deferred pattern as
-- 02_b2_ui_fixture.sql for project_control_manager_id.
set constraints trg_fixed_project_responsibility_membership deferred;

-- Master data needed only because Project Info requires SOME value in these
-- two fields — disposable, ZZ-RP-B2-scoped, never referenced by anything else.
insert into public.project_types (name, code)
values ('ZZ-RP-B2 Project Type', 'ZZ-RP-B2-TYPE')
on conflict (code) do nothing;

insert into public.project_phases (name, code, display_order)
values ('ZZ-RP-B2 Phase', 'ZZ-RP-B2-PHASE', 0)
on conflict (code) do nothing;

insert into public.systems (name, code, department_id)
select 'ZZ-RP-B2 System', 'ZZ-RP-B2-SYS', d.id
  from public.departments d
 where d.code = 'ZZ-RP-B2-DEPT'
on conflict (code) do nothing;

-- Two new disposable contacts for the two still-EMPTY fixed responsibilities.
-- Every other fixed/team/position holder in the fixture is left exactly as
-- it was — this only fills slots that were never assigned to begin with.
insert into public.contacts (name, email, department_id, active)
select v.name, v.email, d.id, true
  from public.departments d,
       (values
         ('ZZ-RP-B2 PM', 'zz.rp.b2.pm@example.invalid'),
         ('ZZ-RP-B2 RC', 'zz.rp.b2.rc@example.invalid')
       ) as v(name, email)
 where d.code = 'ZZ-RP-B2-DEPT'
   and not exists (select 1 from public.contacts c where c.name = v.name);

update public.projects p
   set project_type_id = (select id from public.project_types where code = 'ZZ-RP-B2-TYPE'),
       current_phase_id = (select id from public.project_phases where code = 'ZZ-RP-B2-PHASE'),
       project_manager_id = (select id from public.contacts where name = 'ZZ-RP-B2 PM'),
       reporting_coordinator_id = (select id from public.contacts where name = 'ZZ-RP-B2 RC')
 where p.code = 'ZZ-RP-B2-UI-TEST';

-- Mirror rows for the two new fixed responsibilities — same reason Khaled's
-- project_control_manager row exists: can_manage_project_responsibilities()-
-- style checks and the membership trigger both key off project_contacts, not
-- the projects columns.
insert into public.project_contacts (project_id, contact_id, role)
select p.id, c.id, 'project_manager'
  from public.projects p, public.contacts c
 where p.code = 'ZZ-RP-B2-UI-TEST' and c.name = 'ZZ-RP-B2 PM';

insert into public.project_contacts (project_id, contact_id, role)
select p.id, c.id, 'reporting_coordinator'
  from public.projects p, public.contacts c
 where p.code = 'ZZ-RP-B2-UI-TEST' and c.name = 'ZZ-RP-B2 RC';

-- One system on the department, so the Systems step's "department has a
-- system" check passes. Stored as the project_departments.systems snapshot,
-- same shape replaceDepartments() writes.
update public.project_departments pdept
   set systems = jsonb_build_array(
         jsonb_build_object('id', s.id, 'name', s.name, 'code', s.code)
       )
  from public.projects p, public.departments d, public.systems s
 where pdept.project_id = p.id
   and pdept.department_id = d.id
   and p.code = 'ZZ-RP-B2-UI-TEST'
   and d.code = 'ZZ-RP-B2-DEPT'
   and s.code = 'ZZ-RP-B2-SYS';

-- Person B/C/D are plain Team Members with no Reports To yet — the fixture
-- never gave them one. Point them at the existing Department Manager
-- (Person A), exactly as instructed, so validateDepartmentAssignments() stops
-- reporting "Reports To is required." Person A's own role and Subordinate's
-- existing Reports To are untouched.
update public.project_contacts pc
   set reports_to_contact_id = (select id from public.contacts where name = 'ZZ-RP-B2 Person A')
  from public.projects p, public.contacts c
 where pc.project_id = p.id
   and pc.contact_id = c.id
   and p.code = 'ZZ-RP-B2-UI-TEST'
   and c.name in ('ZZ-RP-B2 Person B', 'ZZ-RP-B2 Person C', 'ZZ-RP-B2 Person D')
   and pc.assignment_role = 'team_member';

commit;

-- ------------------------------- report -------------------------------------
select p.code, p.project_manager_id, p.reporting_coordinator_id,
       p.project_type_id, p.current_phase_id
  from public.projects p where p.code = 'ZZ-RP-B2-UI-TEST';

select pdept.systems
  from public.project_departments pdept
  join public.projects p on p.id = pdept.project_id
 where p.code = 'ZZ-RP-B2-UI-TEST';

select c.name, pc.assignment_role, pc.reports_to_contact_id
  from public.project_contacts pc
  join public.contacts c on c.id = pc.contact_id
  join public.projects p on p.id = pc.project_id
 where p.code = 'ZZ-RP-B2-UI-TEST' and pc.role = 'team_member'
 order by c.name;

-- Replace Person, Pass B2 — final disposable LOCAL UI fixture cleanup.
--
-- Run once B2 is fully verified end-to-end (department_assignment AND
-- project_position replacements both confirmed via read-only DB checks).
-- Supersedes 03_b2_ui_fixture_cleanup.sql for actual execution — that file
-- only covered what 02_b2_ui_fixture.sql created; this one also removes the
-- addendum rows from 04_b2_add_discipline.sql and
-- 05_b2_complete_setup_prereqs.sql (discipline, system, project type, phase,
-- and the two extra contacts — PM, RC — that script added).
--
-- Order matters: the project is deleted FIRST. Its project_contacts,
-- project_departments, project_disciplines, project_positions, and
-- project_responsibility_history rows all cascade automatically
-- (ON DELETE CASCADE), which is also the case
-- trg_project_contact_membership_removal explicitly allows — deleting
-- project_contacts rows directly first, before the project, would hit
-- "last membership referenced" refusals for Person A/B/C/D (still referenced
-- by the department_manager / position row at that point). Master-data rows
-- (contacts, department, discipline, system, project type, phase, client)
-- are deleted afterward, once nothing on this project references them.
--
-- Khaled Fahmy's own login/profile/contact is NOT touched — only the mirror
-- project_contacts row on this ONE disposable project, which the project
-- delete removes along with everything else on it.

\set ON_ERROR_STOP on

do $guard$
begin
  if inet_server_addr() is not null
     and host(inet_server_addr()) not in ('127.0.0.1', '::1', 'localhost') then
    raise exception
      'REFUSING TO RUN: this cleanup is local-only (server address %).',
      host(inet_server_addr());
  end if;
end;
$guard$;

begin;

-- Cascades project_contacts, project_departments, project_disciplines,
-- project_positions, and both project_responsibility_history rows.
delete from public.projects where code = 'ZZ-RP-B2-UI-TEST';

-- All seven disposable contacts (Person A/B/C/D, Subordinate, PM, RC), only
-- if nothing outside this fixture ended up referencing them — it shouldn't,
-- they were all created fresh by 02_..._fixture.sql / 05_..._prereqs.sql.
delete from public.contacts
 where name like 'ZZ-RP-B2 %'
   and not exists (select 1 from public.project_contacts pc where pc.contact_id = contacts.id)
   and not exists (select 1 from public.project_positions pp where pp.contact_id = contacts.id)
   and not exists (select 1 from public.project_responsibility_history h
                    where h.contact_id = contacts.id or h.previous_contact_id = contacts.id);

delete from public.disciplines where code = 'ZZ-RP-B2-DISC';
delete from public.systems where code = 'ZZ-RP-B2-SYS';
delete from public.job_titles where code = 'ZZ-RP-B2-POS-TITLE';
delete from public.departments where code = 'ZZ-RP-B2-DEPT';
delete from public.project_types where code = 'ZZ-RP-B2-TYPE';
delete from public.project_phases where code = 'ZZ-RP-B2-PHASE';
delete from public.clients where code = 'ZZ-RP-B2-CLIENT';

commit;

-- ------------------------------- report -------------------------------------
select 'projects' as table_name, count(*) as remaining from public.projects where code = 'ZZ-RP-B2-UI-TEST'
union all
select 'history', count(*) from public.project_responsibility_history h
  where h.project_id in (select id from public.projects where code = 'ZZ-RP-B2-UI-TEST')
union all
select 'contacts', count(*) from public.contacts where name like 'ZZ-RP-B2 %'
union all
select 'departments', count(*) from public.departments where code = 'ZZ-RP-B2-DEPT'
union all
select 'disciplines', count(*) from public.disciplines where code = 'ZZ-RP-B2-DISC'
union all
select 'systems', count(*) from public.systems where code = 'ZZ-RP-B2-SYS'
union all
select 'job_titles', count(*) from public.job_titles where code = 'ZZ-RP-B2-POS-TITLE'
union all
select 'project_types', count(*) from public.project_types where code = 'ZZ-RP-B2-TYPE'
union all
select 'project_phases', count(*) from public.project_phases where code = 'ZZ-RP-B2-PHASE'
union all
select 'clients', count(*) from public.clients where code = 'ZZ-RP-B2-CLIENT'
union all
select 'project_positions (orphan check)', count(*) from public.project_positions pp
  where pp.notes like 'ZZ-RP-B2%';

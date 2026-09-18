-- Replace Person, Pass B2 — minimal discipline link for the Department
-- Manager guard's manual UI test.
--
-- LOCAL DATABASE ONLY. Adds exactly what SetupStepContacts needs to stop
-- showing its "No disciplines yet" empty state for ZZ-RP-B2 Department:
-- one disposable discipline, and one project_disciplines row linking it to
-- ZZ-RP-B2-UI-TEST under that department. Nothing else in the fixture is
-- touched — no contact, no project_contacts row, no project_positions row,
-- no responsibility holder changes.
--
-- Companion to 02_b2_ui_fixture.sql; run after it, on the same fixture.

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
end;
$guard$;

begin;

insert into public.disciplines (name, code, department_id)
select 'ZZ-RP-B2 Discipline', 'ZZ-RP-B2-DISC', d.id
  from public.departments d
 where d.code = 'ZZ-RP-B2-DEPT';

insert into public.project_disciplines (project_id, discipline_id, department_id)
select p.id, disc.id, d.id
  from public.projects p, public.disciplines disc, public.departments d
 where p.code = 'ZZ-RP-B2-UI-TEST'
   and disc.code = 'ZZ-RP-B2-DISC'
   and d.code = 'ZZ-RP-B2-DEPT';

commit;

-- ------------------------------- report -------------------------------------
select p.code as project_code, disc.name as discipline_name, disc.code as discipline_code,
       dep.name as department_name
  from public.project_disciplines pd
  join public.projects p on p.id = pd.project_id
  join public.disciplines disc on disc.id = pd.discipline_id
  left join public.departments dep on dep.id = pd.department_id
 where p.code = 'ZZ-RP-B2-UI-TEST';

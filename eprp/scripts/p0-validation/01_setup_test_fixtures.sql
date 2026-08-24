-- EPRP P0 validation — disposable test fixtures.
--
-- PURPOSE
--   One non-admin test account and one disposable test project, used ONLY to
--   validate RLS and permission behaviour. Every row created here carries the
--   'ZZ-P0TEST' prefix so it is identifiable at a glance and removable by
--   99_teardown_test_fixtures.sql.
--
--   NOTHING in this script reads, updates or deletes real project data. It only
--   INSERTs new rows. Run it, validate, then tear it down.
--
-- PREREQUISITE — done by a human, not by this script
--   The auth account must already exist. Create it in the Supabase dashboard:
--     Authentication > Users > Add user
--     email:    p0test@example.invalid   (any address; never used for mail)
--     password: your choice
--     "Auto Confirm User": ON
--   Then copy its UUID.
--
--   The account is created by hand deliberately: auth.users owns password
--   hashing and the auth.identities row, and hand-inserting into it produces an
--   account that cannot sign in.
--
-- HOW TO RUN
--   psql "<your pooler connection string>" \
--     -v test_user_id="'00000000-0000-0000-0000-000000000000'" \
--     -f 01_setup_test_fixtures.sql
--
--   Replace the UUID with the one you copied. The quoting is deliberate: the
--   value must arrive as a SQL string literal.
--
-- WHAT IT CREATES
--   ZZ-P0TEST-CLIENT  client
--   ZZ-P0TEST-DEPT    department
--   ZZ-P0TEST-PRJ     project, with NO reporting_coordinator_id set
--   Two contacts:
--     ZZ-P0TEST Coordinator  — assigned reporting_coordinator ONLY through
--                              project_contacts. This is the case P0.6 exists
--                              to fix: consolidator by assignment, not by the
--                              project's singular column.
--     ZZ-P0TEST Member       — a plain team_member. Must never gain manage rights.
--   One profiles row linking the auth account to the Coordinator contact.

\set ON_ERROR_STOP on

begin;
set constraints trg_fixed_project_responsibility_membership deferred;

-- Guard: refuse to run twice, and refuse if the caller forgot the variable.
do $$
begin
  if exists (select 1 from public.projects where code = 'ZZ-P0TEST-PRJ') then
    raise exception 'Fixtures already exist. Run 99_teardown_test_fixtures.sql first.';
  end if;
end;
$$;

insert into public.clients (name, code)
values ('ZZ-P0TEST Client', 'ZZ-P0TEST-CLIENT');

insert into public.departments (name, code)
values ('ZZ-P0TEST Department', 'ZZ-P0TEST-DEPT');

insert into public.contacts (name, email, department_id)
select 'ZZ-P0TEST Coordinator', 'p0test.coordinator@example.invalid', d.id
  from public.departments d where d.code = 'ZZ-P0TEST-DEPT';

insert into public.contacts (name, email, department_id)
select 'ZZ-P0TEST Member', 'p0test.member@example.invalid', d.id
  from public.departments d where d.code = 'ZZ-P0TEST-DEPT';

-- The project. project_manager_id is NOT NULL, so the Member contact stands in;
-- Project Manager is not a consolidation role and grants nothing here.
--
-- reporting_coordinator_id and project_control_manager_id are LEFT NULL on
-- purpose. That is the whole point of the test: the Coordinator's authority must
-- come from the project_contacts assignment alone.
insert into public.projects (
  code, name, client_id, project_manager_id,
  planned_start_date, planned_finish_date, status
)
select
  'ZZ-P0TEST-PRJ', 'ZZ-P0TEST Disposable Project',
  (select id from public.clients where code = 'ZZ-P0TEST-CLIENT'),
  (select id from public.contacts where name = 'ZZ-P0TEST Member'),
  current_date, current_date + 90, 'active';

insert into public.project_departments (project_id, department_id, reporting_required)
select p.id, d.id, true
  from public.projects p, public.departments d
 where p.code = 'ZZ-P0TEST-PRJ' and d.code = 'ZZ-P0TEST-DEPT';

-- A site, so the Tier A visibility check has a row to actually see. Migration
-- 20260817000003 backfills sites for projects that existed when it ran; this
-- project is created afterwards, so it needs its own.
insert into public.project_sites (project_id, name, country, city)
select p.id, 'ZZ-P0TEST Site', 'Egypt', 'Alexandria'
  from public.projects p where p.code = 'ZZ-P0TEST-PRJ';

-- Consolidator BY ASSIGNMENT ONLY.
insert into public.project_contacts (project_id, contact_id, role)
select p.id, c.id, 'reporting_coordinator'
  from public.projects p, public.contacts c
 where p.code = 'ZZ-P0TEST-PRJ' and c.name = 'ZZ-P0TEST Coordinator';

-- A plain member, scoped to the department. The negative control.
insert into public.project_contacts
  (project_id, contact_id, role, department_id, assignment_role)
select p.id, c.id, 'team_member', d.id, 'team_member'
  from public.projects p, public.contacts c, public.departments d
 where p.code = 'ZZ-P0TEST-PRJ'
   and c.name = 'ZZ-P0TEST Member'
   and d.code = 'ZZ-P0TEST-DEPT';

-- Link the auth account to the Coordinator contact. Role is deliberately a
-- LOW-privilege platform role: the point is to prove that project-assignment
-- authority works on its own, without a privileged platform role masking it.
insert into public.profiles (id, email, full_name, role, contact_id, active)
select
  :test_user_id::uuid,
  'p0test@example.invalid',
  'ZZ-P0TEST Coordinator',
  'viewer',
  (select id from public.contacts where name = 'ZZ-P0TEST Coordinator'),
  true;

commit;

do $$
begin
  raise notice 'Fixtures created. Project ZZ-P0TEST-PRJ, two contacts, one profile.';
  raise notice 'Next: run 02_validate_p06.sql with the same -v test_user_id value.';
end;
$$;

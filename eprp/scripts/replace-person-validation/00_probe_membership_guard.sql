\set ON_ERROR_STOP off
begin;
set constraints trg_fixed_project_responsibility_membership deferred;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-a000-0000000000a1',
  'authenticated', 'authenticated', 'p0test.admin@example.invalid',
  'NOT-A-VALID-HASH-LOCAL-FIXTURE-ONLY', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
) on conflict (id) do nothing;

insert into public.profiles (id, email, full_name, role, active)
values (
  '00000000-0000-4000-a000-0000000000a1', 'p0test.admin@example.invalid',
  'ZZ-P0TEST Administrator', 'system_admin', true
) on conflict (id) do nothing;

insert into public.clients (name, code) values ('ZZ-RPPROBE Client', 'ZZ-RPPROBE-CLIENT');
insert into public.departments (name, code) values ('ZZ-RPPROBE Dept', 'ZZ-RPPROBE-DEPT');

insert into public.contacts (name, email, department_id)
select 'ZZ-RPPROBE PM A', 'zz.rpprobe.pma@example.invalid', d.id
  from public.departments d where d.code = 'ZZ-RPPROBE-DEPT';
insert into public.contacts (name, email, department_id)
select 'ZZ-RPPROBE PM B (not a member)', 'zz.rpprobe.pmb@example.invalid', d.id
  from public.departments d where d.code = 'ZZ-RPPROBE-DEPT';

insert into public.projects (
  code, name, client_id, project_manager_id, planned_start_date, planned_finish_date, status
)
select 'ZZ-RPPROBE-PRJ', 'ZZ-RPPROBE Project',
  (select id from public.clients where code = 'ZZ-RPPROBE-CLIENT'),
  (select id from public.contacts where name = 'ZZ-RPPROBE PM A'),
  current_date, current_date + 30, 'active';

insert into public.project_contacts (project_id, contact_id, role)
select p.id, c.id, 'project_manager'
  from public.projects p, public.contacts c
 where p.code = 'ZZ-RPPROBE-PRJ' and c.name = 'ZZ-RPPROBE PM A';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-a000-0000000000a1","role":"authenticated"}';

\echo '--- attempting replace_project_responsibility to a NON-MEMBER replacement ---'
select public.replace_project_responsibility(
  p_project             := (select id from public.projects where code = 'ZZ-RPPROBE-PRJ'),
  p_unit_kind           := 'fixed_responsibility',
  p_from_contact        := (select id from public.contacts where name = 'ZZ-RPPROBE PM A'),
  p_to_contact          := (select id from public.contacts where name = 'ZZ-RPPROBE PM B (not a member)'),
  p_responsibility_role := 'project_manager',
  p_reason              := 'ZZ-RPPROBE hypothesis check'
);

rollback;

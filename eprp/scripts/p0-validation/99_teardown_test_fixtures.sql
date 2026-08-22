-- EPRP P0 validation — remove the disposable test fixtures.
--
-- Deletes ONLY rows whose code or name carries the 'ZZ-P0TEST' prefix. It
-- cannot touch real data: every statement is filtered on that prefix, and the
-- final guard refuses to report success if anything survives.
--
-- The auth account itself is NOT deleted here. Remove it by hand in
-- Authentication > Users, the same way it was created.
--
-- HOW TO RUN
--   psql "<pooler connection string>" -f 99_teardown_test_fixtures.sql

\set ON_ERROR_STOP on

begin;

-- Registers first: master_milestones and master_deliverables have NO delete
-- policy by design, but this runs as the owner, and the validation script
-- rolls its own writes back, so normally there is nothing here to remove.
delete from public.milestone_updates
 where milestone_id in (
   select m.id from public.master_milestones m
     join public.projects p on p.id = m.project_id
    where p.code = 'ZZ-P0TEST-PRJ');

delete from public.master_milestones
 where project_id in (select id from public.projects where code = 'ZZ-P0TEST-PRJ');

delete from public.project_contacts
 where project_id in (select id from public.projects where code = 'ZZ-P0TEST-PRJ');

delete from public.project_departments
 where project_id in (select id from public.projects where code = 'ZZ-P0TEST-PRJ');

delete from public.projects where code = 'ZZ-P0TEST-PRJ';

delete from public.profiles
 where contact_id in (select id from public.contacts where name like 'ZZ-P0TEST%');

delete from public.contacts where name like 'ZZ-P0TEST%';
delete from public.departments where code = 'ZZ-P0TEST-DEPT';
delete from public.clients where code = 'ZZ-P0TEST-CLIENT';

do $$
declare leftovers integer;
begin
  select
      (select count(*) from public.projects    where code = 'ZZ-P0TEST-PRJ')
    + (select count(*) from public.contacts    where name like 'ZZ-P0TEST%')
    + (select count(*) from public.departments where code = 'ZZ-P0TEST-DEPT')
    + (select count(*) from public.clients     where code = 'ZZ-P0TEST-CLIENT')
    into leftovers;

  if leftovers > 0 then
    raise exception 'Teardown incomplete: % fixture row(s) survive.', leftovers;
  end if;
  raise notice 'Teardown complete. Remember to delete the auth user by hand.';
end;
$$;

commit;

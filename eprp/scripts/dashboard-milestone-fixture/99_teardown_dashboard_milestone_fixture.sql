-- Removes everything created by setup_dashboard_milestone_fixture.sql.
-- Deletes in child-to-parent order; every row is identified by the
-- 'ZZ-DASH-MS' prefix, never by touching unrelated data.
--
-- HOW TO RUN (local Supabase stack only)
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < 99_teardown_dashboard_milestone_fixture.sql

\set ON_ERROR_STOP on

begin;

delete from public.weekly_plan_items
 where title like 'ZZ-DASH-MS%'
   and weekly_report_id in (
     select id from public.weekly_reports where report_number like 'ZZ-DASH-MS-%'
   );

delete from public.monthly_plan_items
 where title like 'ZZ-DASH-MS%'
   and monthly_report_id in (
     select id from public.monthly_reports where report_number like 'ZZ-DASH-MS-%'
   );

delete from public.weekly_reports where report_number like 'ZZ-DASH-MS-%';
delete from public.monthly_reports where report_number like 'ZZ-DASH-MS-%';

-- project_contacts is intentionally NOT deleted explicitly here: the fixed-
-- responsibility membership guard (guard_project_contact_membership_removal)
-- refuses to remove a person's last membership row while the project's own
-- project_manager_id still points at them — which it does, right up until
-- the project row itself is gone. The guard's own carve-out is "the parent
-- project no longer exists", so deleting the project first and letting
-- `on delete cascade` remove project_contacts is the supported order, not a
-- workaround.
delete from public.projects where code like 'ZZ-DASH-MS-%';
delete from public.contacts where name = 'ZZ-DASH-MS Manager';
delete from public.clients where code = 'ZZ-DASH-MS-CLIENT';

commit;

do $$
begin
  raise notice 'Dashboard milestone fixture removed.';
end;
$$;

-- Dashboard Milestone modal — LOCAL-ONLY disposable UI fixture.
--
-- PURPOSE
--   The local database has zero dated milestones, so the Dashboard's
--   Milestone Progress / Milestones Upcoming panels and the Milestone modal
--   (list -> detail, grouped by project, weekly- and monthly-sourced) have
--   nothing to render. This script inserts just enough real, queryable rows
--   to exercise that UI by hand. Every row carries the 'ZZ-DASH-MS' prefix so
--   it is identifiable at a glance and removable by
--   99_teardown_dashboard_milestone_fixture.sql.
--
--   This is UI test data only — it does not validate RLS/permissions (see
--   scripts/p0-validation for that). It reads and writes nothing outside its
--   own ZZ-DASH-MS rows, touches no migration, and never runs against a
--   hosted/Remote project.
--
-- HOW TO RUN (local Supabase stack only)
--   docker exec -i supabase_db_eprp psql -U postgres -d postgres \
--     -f - < setup_dashboard_milestone_fixture.sql
--
-- WHAT IT CREATES
--   Client        ZZ-DASH-MS-CLIENT     "ZZ-DASH-MS Client"
--   Contact       ZZ-DASH-MS Manager    (project_manager_id stand-in only)
--   Project 1     ZZ-DASH-MS-01         "ZZ-DASH-MS Fixture Project One"
--   Project 2     ZZ-DASH-MS-02         "ZZ-DASH-MS Fixture Project Two"
--   1 weekly_report + 1 monthly_report on Project One
--   1 weekly_report on Project Two
--   6 milestone plan items total — 4 on Project One (3 weekly-sourced, 1
--   monthly-sourced), 2 on Project Two (weekly-sourced) — covering 4 of the
--   statuses the schema actually allows: not_started, in_progress, delayed,
--   completed.
--
-- WHAT IT DELIBERATELY DOES NOT SET
--   No percent-complete / progress value on any plan item: neither
--   weekly_plan_items nor monthly_plan_items has such a column in this
--   schema, so the Dashboard's `percentComplete` is always undefined by
--   construction. Faking one here would misrepresent what the model stores.

\set ON_ERROR_STOP on

begin;
-- The Project Manager responsibility requires same-project project_contacts
-- membership, checked by a deferrable constraint trigger. Deferred to commit
-- so the project row and its membership row can be inserted in either order
-- (same pattern as scripts/p0-validation/01_setup_test_fixtures.sql).
set constraints trg_fixed_project_responsibility_membership deferred;

do $$
begin
  if exists (select 1 from public.clients where code = 'ZZ-DASH-MS-CLIENT') then
    raise exception 'Fixture already exists. Run 99_teardown_dashboard_milestone_fixture.sql first.';
  end if;
end;
$$;

-- Master data ----------------------------------------------------------------

insert into public.clients (name, code)
values ('ZZ-DASH-MS Client', 'ZZ-DASH-MS-CLIENT');

insert into public.contacts (name, email)
values ('ZZ-DASH-MS Manager', 'zz-dash-ms.manager@example.invalid');

-- Projects ---------------------------------------------------------------

insert into public.projects (
  code, name, client_id, project_manager_id,
  planned_start_date, planned_finish_date, status
)
select
  'ZZ-DASH-MS-01', 'ZZ-DASH-MS Fixture Project One',
  (select id from public.clients where code = 'ZZ-DASH-MS-CLIENT'),
  (select id from public.contacts where name = 'ZZ-DASH-MS Manager'),
  current_date - 30, current_date + 180, 'active';

insert into public.projects (
  code, name, client_id, project_manager_id,
  planned_start_date, planned_finish_date, status
)
select
  'ZZ-DASH-MS-02', 'ZZ-DASH-MS Fixture Project Two',
  (select id from public.clients where code = 'ZZ-DASH-MS-CLIENT'),
  (select id from public.contacts where name = 'ZZ-DASH-MS Manager'),
  current_date - 30, current_date + 180, 'active';

-- Same-project membership for the manager, required by the fixed-responsibility
-- guard above (checked at commit, since the constraint trigger is deferred).
insert into public.project_contacts (project_id, contact_id, role)
select p.id, c.id, 'project_manager'
  from public.projects p, public.contacts c
 where p.code in ('ZZ-DASH-MS-01', 'ZZ-DASH-MS-02')
   and c.name = 'ZZ-DASH-MS Manager';

-- Reports (host records milestone plan items must attach to) -----------------

insert into public.weekly_reports (
  report_number, project_id, week_number, period_start, period_end,
  planned_progress, actual_progress
)
select 'ZZ-DASH-MS-01-W1', p.id, extract(week from current_date)::int,
       current_date, current_date + 6, 35, 28
  from public.projects p where p.code = 'ZZ-DASH-MS-01';

insert into public.monthly_reports (
  report_number, project_id, reporting_month, planned_progress, actual_progress
)
select 'ZZ-DASH-MS-01-M1', p.id, date_trunc('month', current_date)::date, 40, 32
  from public.projects p where p.code = 'ZZ-DASH-MS-01';

insert into public.weekly_reports (
  report_number, project_id, week_number, period_start, period_end,
  planned_progress, actual_progress
)
select 'ZZ-DASH-MS-02-W1', p.id, extract(week from current_date)::int,
       current_date, current_date + 6, 20, 15
  from public.projects p where p.code = 'ZZ-DASH-MS-02';

-- Milestones — Project One, weekly-sourced (3, three different statuses) ----

insert into public.weekly_plan_items (weekly_report_id, kind, title, end_date, status)
select wr.id, 'milestone', 'ZZ-DASH-MS Foundation Complete', current_date + 8, 'not_started'
  from public.weekly_reports wr where wr.report_number = 'ZZ-DASH-MS-01-W1';

insert into public.weekly_plan_items (weekly_report_id, kind, title, end_date, status)
select wr.id, 'milestone', 'ZZ-DASH-MS Structural Steel Erection', current_date + 20, 'in_progress'
  from public.weekly_reports wr where wr.report_number = 'ZZ-DASH-MS-01-W1';

insert into public.weekly_plan_items (weekly_report_id, kind, title, end_date, status)
select wr.id, 'milestone', 'ZZ-DASH-MS Piping Tie-In', current_date + 3, 'delayed'
  from public.weekly_reports wr where wr.report_number = 'ZZ-DASH-MS-01-W1';

-- Milestone — Project One, monthly-sourced (1) --------------------------------

insert into public.monthly_plan_items (monthly_report_id, title, target_date, status)
select mr.id, 'ZZ-DASH-MS Commissioning Readiness Review', current_date + 45, 'completed'
  from public.monthly_reports mr where mr.report_number = 'ZZ-DASH-MS-01-M1';

-- Milestones — Project Two, weekly-sourced (2) --------------------------------

insert into public.weekly_plan_items (weekly_report_id, kind, title, end_date, status)
select wr.id, 'milestone', 'ZZ-DASH-MS Equipment Delivery', current_date + 12, 'not_started'
  from public.weekly_reports wr where wr.report_number = 'ZZ-DASH-MS-02-W1';

insert into public.weekly_plan_items (weekly_report_id, kind, title, end_date, status)
select wr.id, 'milestone', 'ZZ-DASH-MS Electrical Termination', current_date + 25, 'in_progress'
  from public.weekly_reports wr where wr.report_number = 'ZZ-DASH-MS-02-W1';

commit;

do $$
declare
  n_projects integer;
  n_milestones integer;
begin
  select count(*) into n_projects from public.projects where code like 'ZZ-DASH-MS-%';
  select count(*) into n_milestones
    from (
      select id from public.weekly_plan_items where kind = 'milestone'
        and title like 'ZZ-DASH-MS%'
      union all
      select id from public.monthly_plan_items where title like 'ZZ-DASH-MS%'
    ) m;
  raise notice 'Dashboard milestone fixture ready: % projects, % milestones.', n_projects, n_milestones;
end;
$$;

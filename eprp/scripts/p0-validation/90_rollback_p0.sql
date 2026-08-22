-- EPRP P0 — EMERGENCY ROLLBACK.
--
-- ############################################################################
-- ##  THIS RESTORES KNOWN-VULNERABLE STATE.                                  ##
-- ##                                                                         ##
-- ##  Sections 2 and 3 reinstate the privilege-escalation path that P0.1 and ##
-- ##  P0.2 exist to close: any authenticated account able to rewrite         ##
-- ##  `projects` and `project_contacts`, and therefore able to grant itself  ##
-- ##  authority. This is an OUTAGE MEASURE, not a casual undo. Run the       ##
-- ##  smallest section that fixes the problem, not the whole file.           ##
-- ############################################################################
--
-- ORDER MATTERS — reverse of deployment.
--   Sections below run 06 -> 05 -> 04 -> 03 -> 02 -> 01, because 04 and 06
--   depend on report_status_is_approved(), which 03 creates.
--
-- MOST LIKELY SCENARIO, AND THE ONLY SECTION YOU PROBABLY NEED
--   Section 1 alone. If the migrations were applied before every user's app
--   build was updated, report status changes will fail with
--   "A weekly report status may only be changed through
--   set_weekly_report_status()". Section 1 removes that guard and restores the
--   previous behaviour without touching any access rule.
--
-- After any rollback, delete the corresponding row(s) from
-- supabase_migrations.schema_migrations so the CLI history matches reality.
-- The statement for that is at the end.

\set ON_ERROR_STOP on

/* ======================= 1. Undo P0.4 and P0.3 ============================ */
--   Lifecycle enforcement and Monthly compilation basis.
--   Removing these restores the PREVIOUS behaviour exactly: status becomes
--   directly writable again and Monthly compiles from any Weekly. No access
--   rule changes. This is the safe, targeted rollback.

begin;

drop trigger if exists trg_guard_monthly_comment_source on public.monthly_comments;
drop function if exists public.guard_monthly_comment_source();

drop trigger if exists trg_guard_weekly_status_change on public.weekly_reports;
drop trigger if exists trg_guard_monthly_status_change on public.monthly_reports;
drop function if exists public.guard_weekly_status_change();
drop function if exists public.guard_monthly_status_change();
drop function if exists public.set_weekly_report_status(uuid, text);
drop function if exists public.set_monthly_report_status(uuid, text);
drop function if exists public.weekly_transition_blockers(uuid, text);
drop function if exists public.report_transition_allowed(text, text, text);

commit;

/* ==================== 2. Undo P0.2 addendum (Executive) =================== */
--   Restores the PREVIOUS Executive read rules, including the leak this
--   closed: executive_reports readable by every authenticated account at any
--   status, drafts included.

begin;

drop policy if exists executive_reports_select on public.executive_reports;
create policy executive_reports_select on public.executive_reports
  for select to authenticated
  using (true);

drop policy if exists executive_notes_select on public.executive_notes;
create policy executive_notes_select on public.executive_notes
  for select to authenticated
  using (
    project_id is null
    or public.weekly_can_access_project(project_id)
  );

commit;

/* ========================== 3. Undo P0.2 (reads) ========================== */
--   Restores every SELECT policy to the assignment-scoped predicate it had
--   before. Platform-wide visibility is lost; nothing becomes less safe.

begin;

-- Tier A tables: back to project-scoped reads.
drop policy if exists project_departments_select on public.project_departments;
create policy project_departments_select on public.project_departments
  for select to authenticated using (public.weekly_can_access_project(project_id));

drop policy if exists project_sites_select on public.project_sites;
create policy project_sites_select on public.project_sites
  for select to authenticated using (public.weekly_can_access_project(project_id));

drop policy if exists project_positions_select on public.project_positions;
create policy project_positions_select on public.project_positions
  for select to authenticated using (public.weekly_can_access_project(project_id));

drop policy if exists project_documents_select on public.project_documents;
create policy project_documents_select on public.project_documents
  for select to authenticated using (public.weekly_can_access_project(project_id));

drop policy if exists project_events_select on public.project_events;
create policy project_events_select on public.project_events
  for select to authenticated using (public.weekly_can_access_project(project_id));

drop policy if exists project_event_attendees_select on public.project_event_attendees;
create policy project_event_attendees_select on public.project_event_attendees
  for select to authenticated
  using (public.weekly_can_access_project(public.project_event_project(event_id)));

drop policy if exists master_milestones_select on public.master_milestones;
create policy master_milestones_select on public.master_milestones
  for select to authenticated using (public.weekly_can_access_project(project_id));

drop policy if exists master_deliverables_select on public.master_deliverables;
create policy master_deliverables_select on public.master_deliverables
  for select to authenticated using (public.weekly_can_access_project(project_id));

drop policy if exists project_reference_documents_select on storage.objects;
create policy project_reference_documents_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-reference-documents'
    and public.weekly_can_access_project(public.project_id_from_storage_path(name))
  );

-- Tier B tables: drop the approved clause, keep the original predicate.
drop policy if exists weekly_reports_select on public.weekly_reports;
create policy weekly_reports_select on public.weekly_reports
  for select to authenticated using (public.weekly_can_access_project(project_id));

drop policy if exists weekly_submissions_select on public.weekly_submissions;
create policy weekly_submissions_select on public.weekly_submissions
  for select to authenticated
  using (public.weekly_can_access_scope(
    public.weekly_report_project(weekly_report_id), department_id, discipline_id));

drop policy if exists weekly_activities_select on public.weekly_activities;
create policy weekly_activities_select on public.weekly_activities
  for select to authenticated
  using (public.weekly_can_access_scope(
    public.weekly_report_project(weekly_report_id), department_id, discipline_id));

drop policy if exists weekly_entries_select on public.weekly_entries;
create policy weekly_entries_select on public.weekly_entries
  for select to authenticated
  using (
    case when department_id is null
      then public.weekly_can_access_project(public.weekly_report_project(weekly_report_id))
      else public.weekly_can_access_scope(
             public.weekly_report_project(weekly_report_id), department_id, discipline_id)
    end
  );

drop policy if exists weekly_plan_items_select on public.weekly_plan_items;
create policy weekly_plan_items_select on public.weekly_plan_items
  for select to authenticated
  using (public.weekly_can_access_project(public.weekly_report_project(weekly_report_id)));

drop policy if exists monthly_reports_select on public.monthly_reports;
create policy monthly_reports_select on public.monthly_reports
  for select to authenticated using (public.weekly_can_access_project(project_id));

drop policy if exists monthly_comments_select on public.monthly_comments;
create policy monthly_comments_select on public.monthly_comments
  for select to authenticated
  using (public.weekly_can_access_project(public.monthly_report_project(monthly_report_id)));

drop policy if exists monthly_department_summaries_select on public.monthly_department_summaries;
create policy monthly_department_summaries_select on public.monthly_department_summaries
  for select to authenticated
  using (public.weekly_can_access_project(public.monthly_report_project(monthly_report_id)));

drop policy if exists monthly_plan_items_select on public.monthly_plan_items;
create policy monthly_plan_items_select on public.monthly_plan_items
  for select to authenticated
  using (public.weekly_can_access_project(public.monthly_report_project(monthly_report_id)));

drop policy if exists milestone_updates_select on public.milestone_updates;
create policy milestone_updates_select on public.milestone_updates
  for select to authenticated
  using (public.weekly_can_access_project(public.milestone_project(milestone_id)));

drop policy if exists deliverable_updates_select on public.deliverable_updates;
create policy deliverable_updates_select on public.deliverable_updates
  for select to authenticated
  using (public.weekly_can_access_project(public.deliverable_project(deliverable_id)));

-- These three exist only for P0.2; nothing else references them once the
-- policies above are restored.
drop function if exists public.weekly_report_is_approved(uuid);
drop function if exists public.monthly_report_is_approved(uuid);
-- report_status_is_approved is dropped in section 4, after 06/04 are gone.

commit;

/* ================ 4. Undo P0.1 — REINSTATES THE ESCALATION ================ */
--   Read the banner at the top of this file before running this section.

begin;

drop policy if exists projects_select on public.projects;
drop policy if exists projects_insert on public.projects;
drop policy if exists projects_update on public.projects;

create policy projects_authenticated_all on public.projects
  for all to authenticated using (true) with check (true);

drop policy if exists project_contacts_select on public.project_contacts;
drop policy if exists project_contacts_insert on public.project_contacts;
drop policy if exists project_contacts_update on public.project_contacts;
drop policy if exists project_contacts_delete on public.project_contacts;

create policy project_contacts_authenticated_all on public.project_contacts
  for all to authenticated using (true) with check (true);

drop function if exists public.can_manage_project_setup(uuid);
drop function if exists public.can_create_project();
drop function if exists public.report_status_is_approved(text);

commit;

/* ========================== 5. Undo P0.6 ================================== */
--   Restores the narrower manage rule: the project's two singular columns
--   only. Anyone assigned Project Control through project_contacts loses
--   manage rights again.

begin;

create or replace function public.weekly_can_manage_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.is_system_admin()
    or (
      public.current_contact_id() is not null
      and exists (
        select 1 from public.projects pr
         where pr.id = p_project
           and (pr.project_control_manager_id = public.current_contact_id()
             or pr.reporting_coordinator_id = public.current_contact_id())
      )
    );
$fn$;

commit;

/* ===================== 6. Realign the migration history =================== */
--   Run ONLY for the versions actually rolled back, or the CLI will try to
--   re-apply migrations that are still in place.
--
-- delete from supabase_migrations.schema_migrations
--  where version in ('20260820000006','20260820000005','20260820000004',
--                    '20260820000003','20260820000002','20260820000001');

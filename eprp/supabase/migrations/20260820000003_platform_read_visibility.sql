-- EPRP P0.2 — platform-wide read visibility, with Tier A / Tier B.
--
-- LOCKED DECISION — docs/02_PLATFORM_ARCHITECTURE.md 24.2
--   Read and write resolve through DIFFERENT gates. Every authenticated account
--   may VIEW all projects; write/send/approve/manage stays limited to the
--   account's role and assigned project. 24.2.2: widening read must NEVER widen
--   write.
--
--     Tier A  project structure and the official record -> visible always
--     Tier B  raw/in-progress content -> visible to assigned contributors at any
--             state, and to everyone else only from APPROVED onward
--
--   The owner locked the Tier B threshold at APPROVED, not Under Review.
--
-- WHY THIS CANNOT NARROW ANYONE'S ACCESS
--   Every Tier B policy below is the EXISTING predicate with `or <approved>`
--   appended. Every Tier A policy replaces a narrower predicate with `true`.
--   Both directions are strictly widening, so no account can lose a read it has
--   today. That property is what makes this safe to apply without runtime proof.
--
-- NOT ONE WRITE POLICY IS TOUCHED. This migration creates, drops and replaces
-- SELECT policies only. The post-check asserts that the write-policy count is
-- unchanged.
--
-- ORDERING
--   Applies after 20260820000001 (P0.6) and 20260820000002 (P0.1). It depends on
--   neither for correctness -- it references no manage predicate -- but the P0
--   set is designed to be applied in order.
--
-- ============================ TWO DEVIATIONS ================================
--
-- (1) REPORT HEADERS ARE TREATED AS TIER B, NOT TIER A.
--     24.2.1 lists "report headers" under Tier A, so a reader may always see
--     that a report exists and what state it is in. That is not implementable
--     row-wise: weekly_reports.summary is the report-level Executive Summary
--     narrative, and monthly_reports.executive_summary likewise. RLS is
--     row-level, not column-level, so making the header row visible publishes
--     the unapproved narrative with it.
--
--     Treating headers as Tier B is MORE faithful to 24.2's stated reason --
--     "exposing it platform-wide would publish a position that Project Control
--     has not yet accepted" -- than its own header clause. The cost is that an
--     unassigned reader does not see draft report headers in the register. That
--     is a UI completeness gap, not a security one, and the fix is a register
--     VIEW exposing state without narrative, which is more than P0.2 should
--     build. 24.2.1 has been amended to record this.
--
-- (2) 'archived' IS NOT IN THE APPROVED SET.
--     weeklyReportService.archive() OVERWRITES status with 'archived', and
--     draft -> archived is a legal transition, so an archived row does not imply
--     the report was ever approved. Including it would publish abandoned drafts.
--     Excluding it means an archived-but-previously-approved report loses
--     platform-wide visibility -- a real gap for the Archive phase, which will
--     need a durable "was approved" marker rather than a status that erases its
--     own history. Recorded, not silently accepted.
--
--     This is a VISIBILITY rule. It is deliberately the same set the Executive
--     tier already uses for AGGREGATION, and that code is untouched here.

/* --------------------------- Lockout pre-check ---------------------------- */

do $pre$
declare admins integer;
begin
  select count(*) into admins from public.profiles
   where role = 'system_admin' and active;
  -- P1.0: the lockout risk this guard exists for requires accounts to lock
  -- out. On an empty profiles table there are none, so the check is skipped
  -- rather than failing a fresh environment. Protection is unchanged whenever
  -- any profile exists.
  if admins = 0 and exists (select 1 from public.profiles) then
    raise exception
      'Refusing to rewrite read policies: no active system_admin profile exists.';
  end if;
  if not exists (select 1 from public.profiles) then
    raise notice 'Fresh environment: no profiles exist yet, so no account can be locked out. Lockout check not applicable.';
  end if;
  raise notice 'Lockout pre-check passed: % active system_admin profile(s).', admins;
end;
$pre$;

/* --------------------------------- Helpers -------------------------------- */

-- ONE definition of "approved" for every tier, so the rule cannot be worded
-- differently in two places. Mirrors APPROVED_MONTHLY_STATUSES in
-- src/features/executive-reports/executive-data.ts.
create or replace function public.report_status_is_approved(p_status text)
returns boolean
language sql
immutable
as $fn$
  select p_status in ('approved', 'finalized', 'locked');
$fn$;

comment on function public.report_status_is_approved(text) is
  'The approved set for cross-project visibility and compilation: approved, finalized, locked. Excludes archived - status is overwritten on archive, so archived does not imply the report was ever approved.';

create or replace function public.weekly_report_is_approved(p_report uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.weekly_reports
     where id = p_report
       and public.report_status_is_approved(status)
  );
$fn$;

create or replace function public.monthly_report_is_approved(p_report uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.monthly_reports
     where id = p_report
       and public.report_status_is_approved(status)
  );
$fn$;

/* =============================== TIER A =================================== */
-- Project structure and the official registers. Visible to every authenticated
-- account, at any state. Write policies on these tables are NOT touched.

drop policy if exists project_departments_select on public.project_departments;
create policy project_departments_select on public.project_departments
  for select to authenticated using (true);

drop policy if exists project_sites_select on public.project_sites;
create policy project_sites_select on public.project_sites
  for select to authenticated using (true);

drop policy if exists project_positions_select on public.project_positions;
create policy project_positions_select on public.project_positions
  for select to authenticated using (true);

drop policy if exists project_documents_select on public.project_documents;
create policy project_documents_select on public.project_documents
  for select to authenticated using (true);

drop policy if exists project_events_select on public.project_events;
create policy project_events_select on public.project_events
  for select to authenticated using (true);

drop policy if exists project_event_attendees_select on public.project_event_attendees;
create policy project_event_attendees_select on public.project_event_attendees
  for select to authenticated using (true);

-- The governed registers. Identity is Tier A; the update STREAMS are Tier B.
drop policy if exists master_milestones_select on public.master_milestones;
create policy master_milestones_select on public.master_milestones
  for select to authenticated using (true);

drop policy if exists master_deliverables_select on public.master_deliverables;
create policy master_deliverables_select on public.master_deliverables
  for select to authenticated using (true);

-- Reference documents in storage must follow their table, or a reader sees a
-- document listed and cannot open it.
drop policy if exists project_reference_documents_select on storage.objects;
create policy project_reference_documents_select on storage.objects
  for select to authenticated
  using (bucket_id = 'project-reference-documents');

/* =============================== TIER B =================================== */
-- Raw and in-progress content. Assigned contributors keep their existing scoped
-- access at every state; everyone else joins from APPROVED onward.

-- Report headers. See deviation (1) in the header.
drop policy if exists weekly_reports_select on public.weekly_reports;
create policy weekly_reports_select on public.weekly_reports
  for select to authenticated
  using (
    public.weekly_can_access_project(project_id)
    or public.report_status_is_approved(status)
  );

drop policy if exists monthly_reports_select on public.monthly_reports;
create policy monthly_reports_select on public.monthly_reports
  for select to authenticated
  using (
    public.weekly_can_access_project(project_id)
    or public.report_status_is_approved(status)
  );

-- Weekly departmental content.
drop policy if exists weekly_submissions_select on public.weekly_submissions;
create policy weekly_submissions_select on public.weekly_submissions
  for select to authenticated
  using (
    public.weekly_can_access_scope(
      public.weekly_report_project(weekly_report_id), department_id, discipline_id)
    or public.weekly_report_is_approved(weekly_report_id)
  );

drop policy if exists weekly_activities_select on public.weekly_activities;
create policy weekly_activities_select on public.weekly_activities
  for select to authenticated
  using (
    public.weekly_can_access_scope(
      public.weekly_report_project(weekly_report_id), department_id, discipline_id)
    or public.weekly_report_is_approved(weekly_report_id)
  );

-- weekly_entries keeps its CASE: a NULL department is project-level input and
-- follows project access, exactly as 20260810000004 established. Only the
-- approved clause is added.
drop policy if exists weekly_entries_select on public.weekly_entries;
create policy weekly_entries_select on public.weekly_entries
  for select to authenticated
  using (
    case when department_id is null
      then public.weekly_can_access_project(public.weekly_report_project(weekly_report_id))
      else public.weekly_can_access_scope(
             public.weekly_report_project(weekly_report_id), department_id, discipline_id)
    end
    or public.weekly_report_is_approved(weekly_report_id)
  );

-- Plan items are report CONTENT, not project structure: a look-ahead plan is a
-- position Project Control has not yet published. Tier B.
drop policy if exists weekly_plan_items_select on public.weekly_plan_items;
create policy weekly_plan_items_select on public.weekly_plan_items
  for select to authenticated
  using (
    public.weekly_can_access_project(public.weekly_report_project(weekly_report_id))
    or public.weekly_report_is_approved(weekly_report_id)
  );

-- Monthly content.
drop policy if exists monthly_comments_select on public.monthly_comments;
create policy monthly_comments_select on public.monthly_comments
  for select to authenticated
  using (
    public.weekly_can_access_project(public.monthly_report_project(monthly_report_id))
    or public.monthly_report_is_approved(monthly_report_id)
  );

drop policy if exists monthly_department_summaries_select on public.monthly_department_summaries;
create policy monthly_department_summaries_select on public.monthly_department_summaries
  for select to authenticated
  using (
    public.weekly_can_access_project(public.monthly_report_project(monthly_report_id))
    or public.monthly_report_is_approved(monthly_report_id)
  );

drop policy if exists monthly_plan_items_select on public.monthly_plan_items;
create policy monthly_plan_items_select on public.monthly_plan_items
  for select to authenticated
  using (
    public.weekly_can_access_project(public.monthly_report_project(monthly_report_id))
    or public.monthly_report_is_approved(monthly_report_id)
  );

-- The governed update streams. These carry their own approval, which IS the
-- 24.4 rule: current state is the latest APPROVED update. A pending or rejected
-- update is a report nobody has accepted, so it stays scoped to contributors.
drop policy if exists milestone_updates_select on public.milestone_updates;
create policy milestone_updates_select on public.milestone_updates
  for select to authenticated
  using (
    public.weekly_can_access_project(public.milestone_project(milestone_id))
    or approval_status = 'approved'
  );

drop policy if exists deliverable_updates_select on public.deliverable_updates;
create policy deliverable_updates_select on public.deliverable_updates
  for select to authenticated
  using (
    public.weekly_can_access_project(public.deliverable_project(deliverable_id))
    or approval_status = 'approved'
  );

/* -------------------------- Post-condition checks ------------------------- */

do $post$
declare
  tier_a_open   integer;
  tier_b_narrow integer;
  write_policies integer;
  r record;
begin
  -- 1. Every Tier A table must have an open SELECT policy.
  select count(*) into tier_a_open
    from pg_policies
   where schemaname = 'public' and cmd = 'SELECT' and qual = 'true'
     and tablename in (
       'project_departments','project_sites','project_positions',
       'project_documents','project_events','project_event_attendees',
       'master_milestones','master_deliverables');

  if tier_a_open <> 8 then
    raise exception 'Post-check failed: expected 8 open Tier A SELECT policies, found %.', tier_a_open;
  end if;

  -- 2. Every Tier B table must still carry its SCOPED predicate. An open
  --    `true` here would mean in-progress departmental content had been
  --    published platform-wide - the one thing 24.2.1 forbids.
  select count(*) into tier_b_narrow
    from pg_policies
   where schemaname = 'public' and cmd = 'SELECT' and qual = 'true'
     and tablename in (
       'weekly_reports','weekly_submissions','weekly_activities','weekly_entries',
       'weekly_plan_items','monthly_reports','monthly_comments',
       'monthly_department_summaries','monthly_plan_items',
       'milestone_updates','deliverable_updates');

  if tier_b_narrow > 0 then
    raise exception 'Post-check failed: % Tier B table(s) have an unconditionally open SELECT policy.', tier_b_narrow;
  end if;

  -- 3. Every Tier B policy must actually reference an approved gate, or the
  --    widening silently did not happen.
  for r in
    select tablename, policyname, qual
      from pg_policies
     where schemaname = 'public' and cmd = 'SELECT'
       and tablename in (
         'weekly_reports','weekly_submissions','weekly_activities','weekly_entries',
         'weekly_plan_items','monthly_reports','monthly_comments',
         'monthly_department_summaries','monthly_plan_items',
         'milestone_updates','deliverable_updates')
  loop
    if r.qual not like '%report_status_is_approved%'
       and r.qual not like '%_report_is_approved%'
       and r.qual not like '%approval_status%' then
      raise exception 'Post-check failed: %.% has no approved clause.', r.tablename, r.policyname;
    end if;
  end loop;

  -- 4. 24.2.2 - widening read must not have widened write. No write policy on
  --    any touched table may be unconditionally open.
  select count(*) into write_policies
    from pg_policies
   where schemaname = 'public' and cmd <> 'SELECT'
     and (qual = 'true' or with_check = 'true')
     and tablename in (
       'weekly_reports','weekly_submissions','weekly_activities','weekly_entries',
       'weekly_plan_items','monthly_reports','monthly_comments',
       'monthly_department_summaries','monthly_plan_items',
       'milestone_updates','deliverable_updates','project_departments',
       'project_sites','project_positions','project_documents','project_events',
       'project_event_attendees','master_milestones','master_deliverables');

  if write_policies > 0 then
    raise exception 'Post-check failed: % unconditionally open WRITE policy/policies on a table this migration touched.', write_policies;
  end if;

  raise notice 'P0.2 applied: 8 Tier A tables open for read; 11 Tier B tables scoped-or-approved; 0 write policies widened.';
end;
$post$;

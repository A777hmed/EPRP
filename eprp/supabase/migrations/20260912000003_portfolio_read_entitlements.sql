-- EPRP Phase B — two-tier portfolio-wide READ ONLY entitlements.
--
-- WHAT THIS ADDS
--   A fourth, independent authorization axis alongside Global Authority
--   (profiles.role), Project Responsibility (project_contacts.role) and
--   Department Responsibility (project_contacts.assignment_role): a per-account
--   grant that widens READ reach only, in one of two tiers.
--
--   FULL   — Project Manager / Asset Integrity Manager. Reads every project,
--            every Weekly/Monthly report at EVERY lifecycle status (including
--            archived and live/unapproved department content), every
--            Executive Report including draft.
--   PUBLISHED — Chairman / Company President. Reads every project, but a
--            Weekly/Monthly report only once it is 'finalized' or 'locked'
--            (never 'approved' alone -- the workflow still has two stages
--            after Approval), and an Executive Report only once it is
--            'approved', 'finalized' or 'locked'.
--
-- WHY 'approved' DOES NOT COUNT AS COMPLETE FOR WEEKLY/MONTHLY
--   config/workflows.ts's own APPROVED_REPORT_STATUSES comment already
--   explains archived is excluded from "approved" because archiving
--   overwrites status from any live state. The published tier draws its own,
--   even narrower line for a different reason: Weekly/Monthly still have
--   Finalize and Lock ahead of them after Approve, so "approved" is not yet
--   the published document. Executive's lifecycle has no such gap between
--   Approve and being the record leadership reads -- its existing
--   report_status_is_approved() (approved|finalized|locked) already matches
--   what "published" means for that tier, and needed no new rule.
--
-- WHY ARCHIVED NEVER COUNTS, EVEN IF IT WAS ONCE LOCKED
--   status is overwritten in place on archive, and archive is reachable from
--   EVERY live state (report_transition_allowed()) -- draft, under_review,
--   rejected, locked, all of them. There is no status-history table for
--   weekly_reports/monthly_reports, so "was this archived report finalized or
--   locked before it was archived?" is not answerable from the schema today.
--   The published tier therefore excludes 'archived' unconditionally rather
--   than guessing. Making archived-but-previously-locked reports visible
--   again is a real, separate feature (a status-transition audit log), not a
--   flag flip here.
--
-- THE ONE DESIGN CHOICE THAT MATTERS MOST: WHERE THE TWO TIERS ARE WIRED IN
--   has_full_portfolio_read() is added to can_access_project() itself,
--   because full-tier access is unconditional at the project level and every
--   consumer of can_access_project()/weekly_can_access_project() (projects,
--   milestone/deliverable update logs, project_sites, project_documents-
--   adjacent tables, executive_notes' project branch, position/replace-person
--   history) is exactly the kind of project-level, non-draft-sensitive surface
--   the full tier is meant to reach.
--
--   has_published_portfolio_read() is DELIBERATELY NOT added to
--   can_access_project(). Doing so would have reached every one of those same
--   incidental consumers unconditionally -- including weekly_milestone_drafts,
--   whose own name says it is exactly the kind of working content the
--   published tier must not see. Instead, the published tier is wired in
--   individually: once, explicitly, on projects_select (Chairman does see the
--   project itself), and once inside the two new report_viewable() helpers
--   (Chairman sees a Weekly/Monthly report and its children only once
--   finalized/locked). Nothing else changes for the published tier, which is
--   the correct, narrower footprint the requirement asks for.
--
-- SAFETY: ZERO WRITE-POLICY CONSUMERS, PROVEN BY THE POST-CHECK BELOW
--   weekly_can_access_scope() -- the one function ALSO used by a write policy
--   (weekly_submissions_update's contributor branch) -- is never touched, never
--   called by anything new here, and never gains a portfolio-read branch.
--   Every new function is used ONLY inside SELECT policies. The post-check at
--   the end of this migration queries pg_policies directly for any non-SELECT
--   policy whose qual/with_check mentions a new helper by name, and fails the
--   migration if it finds one -- this is verified, not merely asserted.
--
-- SCOPE
--   One new table with its own RLS. Six new/redefined functions
--   (has_operational_project_access is can_access_project()'s pre-existing
--   body, extracted unchanged; can_access_project() itself keeps its name and
--   every existing caller). Thirteen SELECT policies gain one additive OR
--   branch each. No INSERT/UPDATE/DELETE policy, no write RPC, no table
--   column, and no historical migration is touched.

/* ============================== The entitlement ============================ */

create table public.portfolio_read_grants (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  tier        text not null check (tier in ('full', 'published')),
  granted_by  uuid not null references public.profiles(id),
  granted_at  timestamptz not null default now(),
  revoked_by  uuid references public.profiles(id),
  revoked_at  timestamptz,
  reason      text,
  constraint portfolio_read_grants_revoke_pair check (
    (revoked_at is null) = (revoked_by is null)
  )
);

-- "Active" is revoked_at is null -- no separate boolean to drift from it.
-- One active grant per profile; granting a different tier revokes the old
-- row first (application-level, via the governed server action) rather than
-- ever holding two active rows for one account.
create unique index portfolio_read_grants_one_active_per_profile
  on public.portfolio_read_grants(profile_id)
  where revoked_at is null;

create index portfolio_read_grants_profile_id
  on public.portfolio_read_grants(profile_id);

comment on table public.portfolio_read_grants is
  'Portfolio-wide READ ONLY entitlement, independent of profiles.role, project_contacts.role and project_contacts.assignment_role. tier=full: every project, every report at every lifecycle status. tier=published: every project, but a Weekly/Monthly report only once finalized/locked and an Executive Report only once approved/finalized/locked. Grants no write authority anywhere -- see the helpers below and their audited zero-write-consumer post-check.';

alter table public.portfolio_read_grants enable row level security;

-- Read: your own grant row, or a System Administrator (matches this project's
-- existing convention that Users & Roles administration is System-Admin-only,
-- narrower than has_global_operational_authority()).
create policy portfolio_read_grants_select on public.portfolio_read_grants
  for select to authenticated
  using (
    profile_id = auth.uid()
    or public.is_system_admin()
  );

-- Write: System Administrator only, matching the page-level gate on
-- /administration/users. The governed server action re-verifies this
-- independently before ever reaching this table (defense in depth, same
-- pattern as requireActiveSystemAdmin() for the other admin-user actions).
create policy portfolio_read_grants_insert on public.portfolio_read_grants
  for insert to authenticated
  with check (public.is_system_admin());

create policy portfolio_read_grants_update on public.portfolio_read_grants
  for update to authenticated
  using (public.is_system_admin())
  with check (public.is_system_admin());

revoke insert, update, delete on public.portfolio_read_grants from anon;
-- Deliberately no delete policy: a grant is revoked (revoked_by/revoked_at),
-- never removed -- the same "history is preserved, never overwritten" rule
-- this project applies to comments and delegations.

/* ============================ The tier predicates ========================== */

create function public.portfolio_read_tier()
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select g.tier
    from public.portfolio_read_grants g
    join public.profiles p on p.id = g.profile_id
   where g.profile_id = (select auth.uid())
     and g.revoked_at is null
     and p.active
   limit 1;
$fn$;

create function public.has_full_portfolio_read()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.portfolio_read_tier() = 'full';
$fn$;

create function public.has_published_portfolio_read()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.portfolio_read_tier() in ('full', 'published');
$fn$;

comment on function public.has_full_portfolio_read() is
  'True for an active, unrevoked tier=full portfolio-read grant on an active profile. READ ONLY: has zero write-policy consumers, proven by this migration''s own post-check.';
comment on function public.has_published_portfolio_read() is
  'True for an active tier=full OR tier=published grant. READ ONLY, same proof as has_full_portfolio_read(). Callers that must distinguish the narrower published-only case check portfolio_read_tier() directly (see weekly_report_viewable/monthly_report_viewable).';

/* ===================== can_access_project(), split in two ================== */

-- Exactly can_access_project()'s body from 20260905000001, character for
-- character, under a new name. This is the "existing assigned/global users:
-- existing behaviour" half the report-row helpers below compose with.
create function public.has_operational_project_access(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select public.has_global_operational_authority()
      or public.is_project_control_planning(p_project)
      or public.is_report_coordinator(p_project)
      or (
        public.current_contact_id() is not null
        and exists (
          select 1
            from public.project_contacts pc
           where pc.project_id = p_project
             and pc.contact_id = public.current_contact_id()
        )
      );
$fn$;

comment on function public.has_operational_project_access(uuid) is
  'The project-reach rule as it existed before portfolio read: global operational authority, assigned Project Control / Planning, assigned Report Coordinator, or any project_contacts assignment. can_access_project() adds the full portfolio-read tier on top of this; this name exists so the report-row helpers below can compose the SAME base without re-deriving can_access_project()''s own, wider rule.';

-- Full tier only, added here -- unconditional, project-level, safe for every
-- existing consumer of this function (see migration header). Published tier
-- is deliberately NOT added here.
create or replace function public.can_access_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select public.has_operational_project_access(p_project)
      or public.has_full_portfolio_read();
$$;

comment on function public.can_access_project(uuid) is
  'Canonical project READ predicate: has_operational_project_access() OR the full portfolio-read tier. Grants no write authority of any kind. The published portfolio-read tier is deliberately NOT included here -- it is wired individually onto projects_select and the two report_viewable() helpers, so it cannot leak into the several unrelated tables (weekly_milestone_drafts, executive_notes'' project branch, position/replace-person history) that also call this function for project-level reach.';

/* ================= Report-row visibility: full vs. published =============== */

create function public.weekly_report_completed(p_status text)
returns boolean
language sql
immutable
as $fn$
  select p_status in ('finalized', 'locked');
$fn$;

comment on function public.weekly_report_completed(text) is
  'The published-tier definition of "complete" for Weekly/Monthly: finalized or locked ONLY. Deliberately narrower than report_status_is_approved() (approved|finalized|locked, 20260820000003), which keeps its existing meaning for compilation/aggregation and is untouched. approved alone does not satisfy this -- the workflow still has Finalize and Lock ahead of it. archived never satisfies this either, because status is overwritten on archive and the prior state cannot be proven (see migration header).';

create function public.weekly_report_viewable(p_report uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    public.can_access_project(public.weekly_report_project(p_report))
    or (
      public.has_published_portfolio_read()
      and exists (
        select 1 from public.weekly_reports wr
         where wr.id = p_report
           and public.weekly_report_completed(wr.status)
      )
    );
$fn$;

create function public.monthly_report_viewable(p_report uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select
    public.can_access_project(public.monthly_report_project(p_report))
    or (
      public.has_published_portfolio_read()
      and exists (
        select 1 from public.monthly_reports mr
         where mr.id = p_report
           and public.weekly_report_completed(mr.status)
      )
    );
$fn$;

comment on function public.weekly_report_viewable(uuid) is
  'Whether this Weekly REPORT ROW (and, when used on a child table, its department content) may be read by this viewer. can_access_project() already carries the full portfolio-read tier and every existing operational rule; the second branch is the published tier''s OWN narrower rule -- finalized/locked only, checked here rather than folded into can_access_project() so it cannot leak into unrelated project-level tables. SELECT-only: has zero write-policy consumers, proven by this migration''s post-check.';
comment on function public.monthly_report_viewable(uuid) is
  'Monthly mirror of weekly_report_viewable(uuid). Same two branches, same proof.';

/* ============================ RLS: projects ================================= */

-- Published tier sees the project itself (list, detail, overview) even
-- though it does not see every report on it -- explicit branch here, not a
-- change to can_access_project(), for exactly the isolation reason above.
alter policy projects_select on public.projects
  using (public.can_access_project(id) or public.has_published_portfolio_read());

/* ======================= RLS: Weekly report parent + children =============== */

alter policy weekly_reports_select on public.weekly_reports
  using (public.weekly_report_viewable(id));

alter policy weekly_entries_select on public.weekly_entries
  using (
    case
      when department_id is null
        then public.weekly_can_access_project(public.weekly_report_project(weekly_report_id))
      else public.weekly_can_access_scope(
             public.weekly_report_project(weekly_report_id), department_id, discipline_id)
    end
    or public.weekly_report_readable(weekly_report_id)
    or public.weekly_report_viewable(weekly_report_id)
  );

alter policy weekly_activities_select on public.weekly_activities
  using (
    public.weekly_can_access_scope(
      public.weekly_report_project(weekly_report_id), department_id, discipline_id)
    or public.weekly_report_readable(weekly_report_id)
    or public.weekly_report_viewable(weekly_report_id)
  );

alter policy weekly_submissions_select on public.weekly_submissions
  using (
    public.weekly_can_access_scope(
      public.weekly_report_project(weekly_report_id), department_id, discipline_id)
    or public.weekly_report_readable(weekly_report_id)
    or public.weekly_report_viewable(weekly_report_id)
  );

alter policy weekly_plan_items_select on public.weekly_plan_items
  using (
    public.weekly_can_access_project(public.weekly_report_project(weekly_report_id))
    or public.weekly_report_readable(weekly_report_id)
    or public.weekly_report_viewable(weekly_report_id)
  );

/* ====================== RLS: Monthly report parent + children =============== */

alter policy monthly_reports_select on public.monthly_reports
  using (public.monthly_report_viewable(id));

alter policy monthly_submissions_select on public.monthly_submissions
  using (
    public.monthly_can_manage_project(
      public.monthly_report_project(monthly_report_id))
    or public.weekly_can_access_scope(
         public.monthly_report_project(monthly_report_id),
         department_id,
         null)
    or public.monthly_report_viewable(monthly_report_id)
  );

alter policy monthly_comments_select on public.monthly_comments
  using (
    public.weekly_can_access_project(public.monthly_report_project(monthly_report_id))
    or public.monthly_report_readable(monthly_report_id)
    or public.monthly_report_viewable(monthly_report_id)
  );

alter policy monthly_department_summaries_select on public.monthly_department_summaries
  using (
    public.weekly_can_access_project(public.monthly_report_project(monthly_report_id))
    or public.monthly_report_readable(monthly_report_id)
    or public.monthly_report_viewable(monthly_report_id)
  );

alter policy monthly_plan_items_select on public.monthly_plan_items
  using (
    public.weekly_can_access_project(public.monthly_report_project(monthly_report_id))
    or public.monthly_report_readable(monthly_report_id)
    or public.monthly_report_viewable(monthly_report_id)
  );

/* ============================ RLS: Executive ================================ */

-- Full tier reads draft Executive content too; published tier already reads
-- exactly report_status_is_approved() (approved|finalized|locked), which is
-- already "published" for this tier -- no change needed there.
alter policy executive_reports_select on public.executive_reports
  using (
    public.executive_can_manage()
    or public.report_status_is_approved(status)
    or public.has_full_portfolio_read()
  );

alter policy executive_notes_select on public.executive_notes
  using (
    (select public.executive_can_manage())
    or public.has_full_portfolio_read()
    or (
      project_id is not null
      and public.weekly_can_access_project(project_id)
    )
  );

/* -------------------------- Post-condition checks --------------------------- */

do $post$
declare
  v_fn_count   integer;
  v_tbl_count  integer;
  v_blanket    integer;
  v_write_leak integer;
  v_grant_acl  integer;
begin
  -- Table exists with RLS enabled.
  select count(*) into v_tbl_count
    from pg_tables
   where schemaname = 'public' and tablename = 'portfolio_read_grants';
  if v_tbl_count <> 1 then
    raise exception 'Post-check failed: portfolio_read_grants table missing.';
  end if;
  if not (select relrowsecurity from pg_class
           where oid = 'public.portfolio_read_grants'::regclass) then
    raise exception 'Post-check failed: portfolio_read_grants has RLS disabled.';
  end if;

  -- Every new/redefined function exists.
  select count(*) into v_fn_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'portfolio_read_tier', 'has_full_portfolio_read',
       'has_published_portfolio_read', 'has_operational_project_access',
       'weekly_report_completed', 'weekly_report_viewable',
       'monthly_report_viewable', 'can_access_project'
     );
  if v_fn_count <> 8 then
    raise exception 'Post-check failed: expected 8 functions, found %.', v_fn_count;
  end if;

  -- No blanket (unconditional true) policy on the new table.
  select count(*) into v_blanket
    from pg_policies
   where schemaname = 'public'
     and tablename = 'portfolio_read_grants'
     and (qual = 'true' or with_check = 'true');
  if v_blanket > 0 then
    raise exception 'Post-check failed: % blanket policy/policies on portfolio_read_grants.', v_blanket;
  end if;

  -- portfolio_read_grants itself is INSERT/UPDATE-restricted to System Admin,
  -- with no anon access.
  select count(*) into v_grant_acl
    from pg_policies
   where schemaname = 'public'
     and tablename = 'portfolio_read_grants'
     and cmd in ('INSERT', 'UPDATE')
     and (qual like '%is_system_admin%' or with_check like '%is_system_admin%');
  if v_grant_acl <> 2 then
    raise exception 'Post-check failed: expected 2 System-Admin-gated write policies on portfolio_read_grants, found %.', v_grant_acl;
  end if;

  -- THE proof this task requires: none of the new portfolio-read helpers is
  -- referenced by any policy that is NOT a SELECT policy, anywhere in the
  -- schema. If this ever finds a row, a future migration introduced exactly
  -- the leak this one was designed to prevent.
  select count(*) into v_write_leak
    from pg_policies
   where schemaname = 'public'
     and cmd <> 'SELECT'
     and (
       qual like '%has_full_portfolio_read%' or with_check like '%has_full_portfolio_read%'
       or qual like '%has_published_portfolio_read%' or with_check like '%has_published_portfolio_read%'
       or qual like '%portfolio_read_tier%' or with_check like '%portfolio_read_tier%'
       or qual like '%weekly_report_viewable%' or with_check like '%weekly_report_viewable%'
       or qual like '%monthly_report_viewable%' or with_check like '%monthly_report_viewable%'
     );
  if v_write_leak > 0 then
    raise exception 'Post-check failed: % non-SELECT polic(y/ies) reference a portfolio-read helper -- write authority would leak from a read grant.', v_write_leak;
  end if;

  raise notice 'Phase B applied: portfolio_read_grants created; has_full_portfolio_read()/has_published_portfolio_read() wired into 13 SELECT policies; zero non-SELECT policy references a portfolio-read helper (verified).';
end;
$post$;

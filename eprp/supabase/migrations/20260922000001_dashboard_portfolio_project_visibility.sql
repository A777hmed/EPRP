-- Access & Visibility Reconciliation hotfix — Dashboard portfolio-wide
-- READ MODEL (section A), final design.
--
-- CONFIRMED REPRODUCTION
--   Nour Adel — platform role Viewer, Reporting Coordinator on PSAIM-001
--   only. The Dashboard showed ZERO projects; the Projects register showed
--   only two archived projects. A System Administrator, in the same
--   session, saw all six active demo projects.
--
-- ROOT CAUSE
--   20260912000003_portfolio_read_entitlements.sql (Phase B) narrowed
--   `projects_select` from platform-wide read to
--   `can_access_project(id) OR has_published_portfolio_read()`, and the
--   identical shape gates `weekly_reports_select` / `monthly_reports_select`
--   / `master_milestones_select` / `milestone_updates_select` /
--   `planning_snapshots_select` / `planning_activities_select`. An account
--   with no operational assignment and no `portfolio_read_grants` row sees
--   ZERO rows from any of them — not only the project list, but every KPI
--   figure derived from it.
--
-- REVISION HISTORY (never applied; safe to revise in place)
--   Draft 1: `select p.*` / `setof public.projects` — flagged for exposing
--   every future column automatically, and for no active-project floor at
--   the SQL layer. Corrected to an explicit column list plus
--   `p.status <> 'archived'`.
--   Draft 2: unbounded `dashboard_weekly_report_summaries()` /
--   `dashboard_monthly_report_summaries()` — flagged because "used only by
--   the Dashboard today" is application-code intent, not a database
--   boundary: the functions themselves handed every historical report row,
--   including every Draft's figures, to any authenticated caller forever.
--   THIS DRAFT bounds each to the 12 most recent reports per project (never
--   wrong for "current position" — position 0 of "newest 12" is always the
--   true latest row — and comfortably covers the 8-period trend chart), and
--   adds two SEPARATE, unbounded, narrowly-predicated overdue-only
--   functions so an old stuck report is never silently excluded by that
--   window. Per the approved design, Draft-status figures are also now
--   excluded from platform-wide OFFICIAL performance KPIs — enforced in
--   TypeScript (`positionsFor()`, `isApprovedReportStatus()`), not SQL,
--   because "which of these rows is the governed one" is exactly the
--   existing, tested business rule this hotfix must not re-derive a second
--   way; the bound here is about ROW VOLUME, not status.
--   THIS DRAFT also adds Master Milestone and Planning Snapshot rollup
--   functions, completing section A's original requirement (schedule
--   health, milestone summaries) rather than leaving them deferred.
--
-- WHY NEW FUNCTIONS AND NOT projects_select / weekly_reports_select /
-- monthly_reports_select / master_milestones_select / milestone_updates_
-- select / planning_snapshots_select / planning_activities_select CHANGES
--   Every one of those policies remains the row-level boundary for its
--   EXISTING callers — Project Setup, the Weekly/Monthly Reporting
--   registers and workspaces, Executive drill-downs, Master Planning, the
--   Progress Curve and Activity Depth drill-downs. Widening any of them
--   would re-open all of those surfaces at once, several of which Phase B
--   narrowed deliberately and which carry genuinely sensitive content
--   (department submissions, comments, narrative, per-activity schedule
--   detail). The eight functions below are SEPARATE, additive, READ-ONLY,
--   EXPLICIT-COLUMN, bounded-where-sensible paths used ONLY by the
--   Dashboard's own data loader (`src/services/dashboard-read-model.ts`)
--   — every other surface keeps exactly the access its existing policy
--   already grants, unchanged, verified by this migration's own
--   post-checks.
--
-- WHAT EACH FUNCTION RETURNS, AND WHY EVERY EXCLUDED COLUMN IS EXCLUDED
--
--   dashboard_projects() — id, code, name, short_name, status,
--   current_phase_id, forecast_finish_date, updated_at. Every
--   responsibility-holder contact id, every client-contact field, every
--   branding/report-template field and `description` are absent — none
--   read by the Dashboard (verified by a full grep of
--   `src/features/dashboard/`), none belong on a portfolio-wide surface.
--   Scoped to `status <> 'archived'` — verified against the complete
--   `ProjectLifecycleStatus` enum (draft, planning, active, on_hold,
--   delayed, completed, cancelled, archived) and against
--   `dashboardProjectScope()`'s own rule: this is the exact same
--   predicate, not an invented narrower or wider one.
--
--   dashboard_weekly_report_summaries() / dashboard_weekly_overdue_
--   reports() — id, project_id, report_number, status, period_end,
--   planned_progress, actual_progress, prepared_by_contact_id.
--   `prepared_by_contact_id` is a bare `contacts.id` reference (resolved
--   to a name via the separate, already broadly-read `contacts`
--   master-data table — the same "Prepared By" every Weekly/Monthly
--   register column already shows), read by the Dashboard's Overdue
--   Reports summary. Excludes `summary` (Executive Summary narrative —
--   exactly the "raw Weekly narrative" this correction must not expose),
--   `signatories`, `reviewed_by_contact_id`, `approved_by_contact_id`,
--   `man_hours_to_date`, `hse_status`, `quality_status`,
--   `overall_progress_status`, `discipline_ids`, `planning_snapshot_id` —
--   none read by the Dashboard. The _summaries function is bounded to the
--   latest 12 rows per project (`row_number() over (partition by
--   project_id order by period_end desc, id desc) <= 12`); the
--   _overdue_reports function is unbounded but predicated to
--   `status not in ('approved','finalized','locked','archived') and
--   period_end < current_date` — the identical `DELIVERED`/date rule
--   `dashboard-data.ts`'s `totalsFor()`/`overdueReports()` already apply,
--   so a row this function returns was already going to be counted as
--   overdue by the exact same logic, never a wider set.
--
--   dashboard_monthly_report_summaries() / dashboard_monthly_overdue_
--   reports() — the Monthly mirror, keyed on `reporting_month` instead of
--   `period_end`; "month end" computed as
--   `(date_trunc('month', reporting_month) + interval '1 month' -
--   interval '1 day')::date`, matching `dashboard-data.ts`'s own
--   `Date.UTC(y, m, 0)` month-end arithmetic exactly. Excludes
--   `executive_summary` (narrative) and every other column on the same
--   basis as the Weekly pair.
--
--   Neither Weekly nor Monthly function touches `weekly_submissions`,
--   `weekly_entries`, `weekly_comments`, `monthly_comments`,
--   `monthly_submissions`, or any other department-level/narrative table.
--   Report STATUS is not filtered in the two _summaries functions (a Draft
--   row is included) — `positionsFor()` (TypeScript, unchanged logic,
--   `isApprovedReportStatus()`) is what decides which of these rows may
--   supply an OFFICIAL platform-wide figure; narrowing the SQL to
--   approved-only would make the bounded window blind to a project's most
--   recent activity entirely, breaking the "always includes true latest at
--   position 0" guarantee the bound relies on.
--
--   dashboard_master_milestones() — id, project_id, department_id, code,
--   name, priority, source, active, created_at, updated_at,
--   milestone_type, baseline_date, planned_date,
--   client_approval_required, is_advance_payment. The last two are
--   simple boolean config flags (not values or narrative) required to
--   satisfy `MasterMilestone`'s own type — neither is sensitive, neither
--   is read by `governedMilestoneRow()`/`milestoneState()`. Excludes
--   `description`, `notes` (narrative), `system_id`, `discipline_id`,
--   `owner_contact_id`, `source_document_id`, `category`,
--   `weight_percent`, `planned_progress_percent`,
--   `predecessor_milestone_id`, and every commercial/payment VALUE field
--   (`payment_percent`, `payment_amount`, `payment_due_date`) — none read
--   by `governedMilestoneRow()` or by `milestoneState()`'s status/
--   progress/date derivation; financial figures in particular have no
--   place on a portfolio-wide surface the Dashboard never renders them
--   from.
--
--   dashboard_milestone_updates() — id, milestone_id, source, status,
--   progress_percent, forecast_date, actual_date, approval_status,
--   is_regression, submitted_at, as_of_date — filtered to
--   `approval_status = 'approved'` ONLY. Pending (submitted-but-not-yet-
--   accepted) rows are excluded: `governedMilestoneRow()` never reads
--   `MilestoneState.pending`/`approvalQueue()`'s output, so there is no
--   reason to expose an unaccepted claim platform-wide. Excludes
--   `narrative`, `decision_note`, `regression_reason` (free text),
--   `weekly_report_id`, `monthly_report_id`, `department_id`,
--   `discipline_id`, `submitted_by_contact_id`, `approved_by_contact_id`,
--   `approved_at` (provenance the Master Planning UI shows, not anything
--   `milestoneStates()`'s derivation itself reads), and every 13.2c
--   commercial/client-approval field (`payment_status`,
--   `invoice_reference`, `invoiced_date`, `received_date`,
--   `recovered_amount`, `client_approval_status`, `client_approval_date`)
--   and reconciliation-adoption metadata (`adopted_from_update_id`,
--   `reconciliation_reason`) — `milestoneState()` only folds these into
--   OUTPUT fields the Dashboard never renders.
--
--   THE ALGORITHM ITSELF IS NOT REIMPLEMENTED IN SQL. Both milestone
--   functions return governed FACT ROWS; `milestoneStates()`
--   (`src/features/projects/milestone-state.ts`, completely unmodified) is
--   what folds them into current state, exactly as it already does for an
--   assigned viewer — the cut-off grouping, reconciliation-outranks-
--   observations rule, and newest-resolved-cut-off selection (R5, amended
--   13.2d) are genuinely stateful and were assessed as too high-risk to
--   port into a second implementation blind, with no way to verify parity
--   against real data in this environment.
--
--   dashboard_planning_rollups() — ONE row per project: the LATEST
--   PUBLISHED Planning Snapshot's already-aggregated rollup (project_id,
--   snapshot_id, snapshot_version, data_date, planned_progress,
--   actual_progress, variance, planned_value, earned_value, spi,
--   coverage_percent). NO `planning_snapshot_activities` row — no name,
--   code, date, or per-activity weight/percent — ever leaves the database
--   through this function; only the ten aggregate numbers per project.
--   Mirrors `computeRollupFromActivities()` / `rollupFromOpeningPosition()`
--   (`src/lib/planning-rollup.ts`) exactly: a weighted average of
--   `percent_complete_planned` / `percent_complete_physical` (an activity
--   contributes to an average only when it reports a positive
--   `weight_percent` AND that specific figure; `coverage_percent` is the
--   weighted share reporting BOTH), `sum(planned_value)`/`sum(earned_value)`
--   (SQL `sum()` already returns NULL over an all-NULL/empty set, matching
--   `sumReported()`'s "null unless something reports it" rule with no
--   extra CASE needed), `spi = earned_value / planned_value` only when
--   `planned_value > 0`, `variance = actual - planned` only when both are
--   present. A snapshot promoted from an Opening Position
--   (`source_opening_position_id is not null`) reads
--   `planned_progress_percent` / `actual_progress_percent` directly from
--   `planning_opening_positions` instead of aggregating activities —
--   mirroring `rollupFromOpeningPosition()` — because that snapshot
--   deliberately carries no activities of its own ("do not create fake
--   history"). All figures stay `numeric`, never rounded or cast to
--   `integer`, so no precision is lost before the existing TypeScript
--   display layer's own rounding.
--
-- SCHEMA VERIFIED, READ-ONLY, AGAINST A REAL LOCAL POSTGRES INSTANCE
--   Every column name and type referenced below (weekly_reports,
--   monthly_reports, projects, master_milestones, milestone_updates,
--   planning_snapshots, planning_snapshot_activities, planning_opening_
--   positions) and the exact current SELECT policy predicate on all seven
--   underlying tables were confirmed with `\d` and a `pg_policies` query
--   against a local `supabase start` instance (127.0.0.1, never remote) in
--   this session — not assumed from migration files alone. This migration
--   itself was NOT applied there or anywhere; see the session's completion
--   report for exactly what "verified" does and does not mean here, and
--   the commands to actually apply and exercise it.
--
-- A FINDING FROM THAT VERIFICATION, REPORTED RATHER THAN SILENTLY ACTED ON
--   `master_milestones_select` is `using (true)` — platform-wide, EVERY
--   column, already, for every authenticated account — and
--   `milestone_updates_select` already admits an APPROVED row platform-wide
--   too (`weekly_can_access_project(...) OR approval_status = 'approved'`).
--   Both were assumed, before this check, to be assignment-gated the same
--   way `weekly_reports`/`monthly_reports`/`projects` are; they are not.
--   `20260820000003_platform_read_visibility.sql` (the same "Tier A" pass
--   that set `projects_select` to `using (true)`) widened
--   `master_milestones_select` the same way; Phase B's later narrowing
--   (`20260912000003`) re-tightened `projects`/`weekly_reports`/
--   `monthly_reports` but did not touch `master_milestones`/
--   `milestone_updates`, leaving them on the older, wider rule. This means
--   `dashboard_master_milestones()`/`dashboard_milestone_updates()` below
--   are NOT closing a row-level authorization gap the way the other six
--   functions are — that gap does not exist for these two tables today.
--   They still narrow COLUMNS (no `description`/`notes`/financial fields
--   leave the database through them), which the existing `master_
--   milestones_select`/`milestone_updates_select` policies do not do at
--   all: an ordinary PostgREST `.from("master_milestones").select("*")` or
--   `.from("milestone_updates").select("*").eq("approval_status",
--   "approved")` already returns every column, including `notes` and
--   every commercial field, to any authenticated account today,
--   independent of anything in this migration. That is a PRE-EXISTING
--   condition, not introduced or widened here, and this migration does not
--   change `master_milestones_select`/`milestone_updates_select` — "keep
--   operational project RLS ... unchanged" — but it should not be
--   silently carried forward as if it were news to nobody; it is recorded
--   here and in the session's completion report as a finding for the
--   platform owner to decide on separately.
--
-- DELIBERATELY STILL OUT OF SCOPE
--   The historical Progress Curve (`use-planning-progress-curve.ts`,
--   per-snapshot-version history) and the drill-down's Activity Depth /
--   Coverage Detail (`project-workspace.tsx`, `planning-activity.ts`,
--   individual `planning_snapshot_activities` rows) are UNCHANGED — still
--   assignment-gated via `planningRollupService`/`planningService`
--   directly, consistent with "Dashboard visibility must not grant...
--   unauthorized operational drill-down." Only the Dashboard's own
--   CURRENT-position figure is platform-wide.
--
-- SCOPE
--   Eight new functions. Zero policy changes anywhere. Zero new tables.
--   Zero write surface — every function is SELECT-only and each return
--   type is an explicit column list with no path to write. Forward-only;
--   no prior migration is edited.

/* ================================ Projects ================================= */

create function public.dashboard_projects()
returns table (
  id                    uuid,
  code                  text,
  name                  text,
  short_name            text,
  status                text,
  current_phase_id      uuid,
  forecast_finish_date  date,
  updated_at            timestamptz
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.id, p.code, p.name, p.short_name, p.status,
         p.current_phase_id, p.forecast_finish_date, p.updated_at
    from public.projects p
   where (select auth.uid()) is not null
     and p.status <> 'archived'
   order by p.updated_at desc;
$fn$;

comment on function public.dashboard_projects() is
  'Access & Visibility hotfix, section A. Dashboard-only, READ-ONLY, platform-wide, ACTIVE-project list. Explicit column list only -- a future column added to projects is NOT exposed until this list is deliberately revised. See migration header for full rationale.';

/* ---------------------------- weekly_reports -------------------------------- */

create function public.dashboard_weekly_report_summaries()
returns table (
  id                       uuid,
  project_id               uuid,
  report_number            text,
  status                   text,
  period_end               date,
  planned_progress         integer,
  actual_progress          integer,
  prepared_by_contact_id   uuid
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with ranked as (
    select wr.id, wr.project_id, wr.report_number, wr.status, wr.period_end,
           wr.planned_progress, wr.actual_progress, wr.prepared_by_contact_id,
           row_number() over (
             partition by wr.project_id
             order by wr.period_end desc, wr.id desc
           ) as rn
      from public.weekly_reports wr
      join public.projects p on p.id = wr.project_id
     where p.status <> 'archived'
  )
  select id, project_id, report_number, status, period_end,
         planned_progress, actual_progress, prepared_by_contact_id
    from ranked
   where rn <= 12
     and (select auth.uid()) is not null;
$fn$;

comment on function public.dashboard_weekly_report_summaries() is
  'Access & Visibility hotfix, section A. Dashboard-only, READ-ONLY, platform-wide, bounded to the latest 12 Weekly reports PER PROJECT on non-archived projects. Explicit column list; excludes narrative (summary), signatories and every contact id except prepared_by_contact_id. Status is NOT filtered -- TypeScript (isApprovedReportStatus) decides which rows are OFFICIAL. weekly_reports_select is unchanged. See migration header.';

create function public.dashboard_weekly_overdue_reports()
returns table (
  id                       uuid,
  project_id               uuid,
  report_number            text,
  status                   text,
  period_end               date,
  planned_progress         integer,
  actual_progress          integer,
  prepared_by_contact_id   uuid
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select wr.id, wr.project_id, wr.report_number, wr.status, wr.period_end,
         wr.planned_progress, wr.actual_progress, wr.prepared_by_contact_id
    from public.weekly_reports wr
    join public.projects p on p.id = wr.project_id
   where (select auth.uid()) is not null
     and p.status <> 'archived'
     and wr.status not in ('approved', 'finalized', 'locked', 'archived')
     and wr.period_end < current_date;
$fn$;

comment on function public.dashboard_weekly_overdue_reports() is
  'Access & Visibility hotfix, section A. Dashboard-only, READ-ONLY, platform-wide, UNBOUNDED Weekly reports not yet delivered and past their period end -- the same DELIVERED/date predicate dashboard-data.ts already applies, so this can only ever return rows that predicate would already count. Exists so the 12-per-project window on dashboard_weekly_report_summaries() never silently excludes an old stuck report from the overdue count/list. Same column exclusions as that function.';

/* ---------------------------- monthly_reports -------------------------------- */

create function public.dashboard_monthly_report_summaries()
returns table (
  id                       uuid,
  project_id               uuid,
  report_number            text,
  status                   text,
  reporting_month          date,
  planned_progress         numeric,
  actual_progress          numeric,
  prepared_by_contact_id   uuid
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with ranked as (
    select mr.id, mr.project_id, mr.report_number, mr.status, mr.reporting_month,
           mr.planned_progress, mr.actual_progress, mr.prepared_by_contact_id,
           row_number() over (
             partition by mr.project_id
             order by mr.reporting_month desc, mr.id desc
           ) as rn
      from public.monthly_reports mr
      join public.projects p on p.id = mr.project_id
     where p.status <> 'archived'
  )
  select id, project_id, report_number, status, reporting_month,
         planned_progress, actual_progress, prepared_by_contact_id
    from ranked
   where rn <= 12
     and (select auth.uid()) is not null;
$fn$;

comment on function public.dashboard_monthly_report_summaries() is
  'Access & Visibility hotfix, section A. Monthly mirror of dashboard_weekly_report_summaries() -- latest 12 per project, non-archived projects, excludes executive_summary (narrative) and every contact id except prepared_by_contact_id. monthly_reports_select is unchanged.';

create function public.dashboard_monthly_overdue_reports()
returns table (
  id                       uuid,
  project_id               uuid,
  report_number            text,
  status                   text,
  reporting_month          date,
  planned_progress         numeric,
  actual_progress          numeric,
  prepared_by_contact_id   uuid
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select mr.id, mr.project_id, mr.report_number, mr.status, mr.reporting_month,
         mr.planned_progress, mr.actual_progress, mr.prepared_by_contact_id
    from public.monthly_reports mr
    join public.projects p on p.id = mr.project_id
   where (select auth.uid()) is not null
     and p.status <> 'archived'
     and mr.status not in ('approved', 'finalized', 'locked', 'archived')
     and (date_trunc('month', mr.reporting_month) + interval '1 month' - interval '1 day')::date
         < current_date;
$fn$;

comment on function public.dashboard_monthly_overdue_reports() is
  'Access & Visibility hotfix, section A. Monthly mirror of dashboard_weekly_overdue_reports() -- unbounded, not-yet-delivered, month already ended. Month-end computed as (date_trunc(month, reporting_month) + 1 month - 1 day), matching dashboard-data.ts''s own Date.UTC(y, m, 0) arithmetic exactly.';

/* ============================ Master Milestones ============================ */

create function public.dashboard_master_milestones()
returns table (
  id                          uuid,
  project_id                  uuid,
  department_id               uuid,
  code                        text,
  name                        text,
  priority                    text,
  source                      text,
  active                      boolean,
  created_at                  timestamptz,
  updated_at                  timestamptz,
  milestone_type              text,
  baseline_date                date,
  planned_date                date,
  client_approval_required    boolean,
  is_advance_payment          boolean
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select mm.id, mm.project_id, mm.department_id, mm.code, mm.name, mm.priority,
         mm.source, mm.active, mm.created_at, mm.updated_at, mm.milestone_type,
         mm.baseline_date, mm.planned_date, mm.client_approval_required,
         mm.is_advance_payment
    from public.master_milestones mm
    join public.projects p on p.id = mm.project_id
   where (select auth.uid()) is not null
     and p.status <> 'archived';
$fn$;

comment on function public.dashboard_master_milestones() is
  'Access & Visibility hotfix, section A. Dashboard-only, READ-ONLY, platform-wide Master Milestone identity rows on non-archived projects. Excludes description/notes (narrative) and every commercial/payment field. Feeds the EXISTING, UNMODIFIED milestoneStates() -- this migration does not reimplement that derivation. master_milestones_select is unchanged.';

create function public.dashboard_milestone_updates()
returns table (
  id                 uuid,
  milestone_id       uuid,
  source             text,
  status             text,
  progress_percent   integer,
  forecast_date      date,
  actual_date        date,
  approval_status    text,
  is_regression      boolean,
  submitted_at       timestamptz,
  as_of_date         date
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select mu.id, mu.milestone_id, mu.source, mu.status, mu.progress_percent,
         mu.forecast_date, mu.actual_date, mu.approval_status, mu.is_regression,
         mu.submitted_at, mu.as_of_date
    from public.milestone_updates mu
    join public.master_milestones mm on mm.id = mu.milestone_id
    join public.projects p on p.id = mm.project_id
   where (select auth.uid()) is not null
     and p.status <> 'archived'
     and mu.approval_status = 'approved';
$fn$;

comment on function public.dashboard_milestone_updates() is
  'Access & Visibility hotfix, section A. Dashboard-only, READ-ONLY, platform-wide, APPROVED-ONLY Master Milestone update rows on non-archived projects -- pending (not-yet-accepted) rows are deliberately excluded. Excludes narrative/decision_note/regression_reason (free text) and every commercial/client-approval/provenance field. Feeds the EXISTING, UNMODIFIED milestoneStates() alongside dashboard_master_milestones(). milestone_updates_select is unchanged.';

/* ================================ Planning ================================= */

create function public.dashboard_planning_rollups()
returns table (
  project_id          uuid,
  snapshot_id         uuid,
  snapshot_version    integer,
  data_date           date,
  planned_progress    numeric,
  actual_progress     numeric,
  variance            numeric,
  planned_value       numeric,
  earned_value        numeric,
  spi                 numeric,
  coverage_percent    numeric
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with latest_snapshot as (
    select distinct on (ps.project_id)
           ps.id, ps.project_id, ps.version, ps.data_date, ps.source_opening_position_id
      from public.planning_snapshots ps
      join public.projects p on p.id = ps.project_id
     where p.status <> 'archived'
     order by ps.project_id, ps.version desc
  ),
  activity_rollup as (
    select
      ls.project_id,
      ls.id as snapshot_id,
      ls.version as snapshot_version,
      ls.data_date,
      case
        when sum(a.weight_percent) filter (
               where a.weight_percent > 0 and a.percent_complete_planned is not null
             ) > 0
        then sum(a.weight_percent * a.percent_complete_planned) filter (
               where a.weight_percent > 0 and a.percent_complete_planned is not null
             )
             / sum(a.weight_percent) filter (
               where a.weight_percent > 0 and a.percent_complete_planned is not null
             )
        else null
      end as planned_progress,
      case
        when sum(a.weight_percent) filter (
               where a.weight_percent > 0 and a.percent_complete_physical is not null
             ) > 0
        then sum(a.weight_percent * a.percent_complete_physical) filter (
               where a.weight_percent > 0 and a.percent_complete_physical is not null
             )
             / sum(a.weight_percent) filter (
               where a.weight_percent > 0 and a.percent_complete_physical is not null
             )
        else null
      end as actual_progress,
      sum(a.planned_value) as planned_value,
      sum(a.earned_value) as earned_value,
      case
        when sum(a.weight_percent) filter (where a.weight_percent > 0) > 0
        then (
          sum(a.weight_percent) filter (
            where a.weight_percent > 0
              and a.percent_complete_planned is not null
              and a.percent_complete_physical is not null
          )
          / sum(a.weight_percent) filter (where a.weight_percent > 0)
        ) * 100
        else 0
      end as coverage_percent
      from latest_snapshot ls
      left join public.planning_snapshot_activities a on a.snapshot_id = ls.id
     where ls.source_opening_position_id is null
     group by ls.project_id, ls.id, ls.version, ls.data_date
  ),
  opening_rollup as (
    select
      ls.project_id,
      ls.id as snapshot_id,
      ls.version as snapshot_version,
      ls.data_date,
      op.planned_progress_percent as planned_progress,
      op.actual_progress_percent as actual_progress,
      null::numeric as planned_value,
      null::numeric as earned_value,
      case
        when op.planned_progress_percent is not null and op.actual_progress_percent is not null
        then 100
        else 0
      end as coverage_percent
      from latest_snapshot ls
      join public.planning_opening_positions op on op.id = ls.source_opening_position_id
     where ls.source_opening_position_id is not null
  ),
  combined as (
    select * from activity_rollup
    union all
    select * from opening_rollup
  )
  select
    c.project_id, c.snapshot_id, c.snapshot_version, c.data_date,
    c.planned_progress, c.actual_progress,
    case
      when c.planned_progress is not null and c.actual_progress is not null
      then c.actual_progress - c.planned_progress
      else null
    end as variance,
    c.planned_value, c.earned_value,
    case
      when c.planned_value is not null and c.earned_value is not null and c.planned_value > 0
      then c.earned_value / c.planned_value
      else null
    end as spi,
    c.coverage_percent
    from combined c
   where (select auth.uid()) is not null;
$fn$;

comment on function public.dashboard_planning_rollups() is
  'Access & Visibility hotfix, section A. Dashboard-only, READ-ONLY, platform-wide, ONE ROW PER non-archived project: the LATEST PUBLISHED Planning Snapshot''s rollup, computed server-side. Mirrors computeRollupFromActivities()/rollupFromOpeningPosition() (src/lib/planning-rollup.ts) exactly -- weighted average, EV/PV, SPI, coverage, variance, same null semantics, numeric (unrounded) throughout. NO planning_snapshot_activities row (name, code, dates, per-activity figures) ever leaves the database through this function. planning_snapshots_select/planning_activities_select are unchanged; the historical Progress Curve and Activity Depth/Coverage Detail drill-downs remain separately, unchanged, assignment-gated.';

/* ------------------------------- grants ------------------------------------- */

revoke execute on function public.dashboard_projects() from public, anon;
revoke execute on function public.dashboard_weekly_report_summaries() from public, anon;
revoke execute on function public.dashboard_weekly_overdue_reports() from public, anon;
revoke execute on function public.dashboard_monthly_report_summaries() from public, anon;
revoke execute on function public.dashboard_monthly_overdue_reports() from public, anon;
revoke execute on function public.dashboard_master_milestones() from public, anon;
revoke execute on function public.dashboard_milestone_updates() from public, anon;
revoke execute on function public.dashboard_planning_rollups() from public, anon;

grant execute on function public.dashboard_projects() to authenticated, service_role;
grant execute on function public.dashboard_weekly_report_summaries() to authenticated, service_role;
grant execute on function public.dashboard_weekly_overdue_reports() to authenticated, service_role;
grant execute on function public.dashboard_monthly_report_summaries() to authenticated, service_role;
grant execute on function public.dashboard_monthly_overdue_reports() to authenticated, service_role;
grant execute on function public.dashboard_master_milestones() to authenticated, service_role;
grant execute on function public.dashboard_milestone_updates() to authenticated, service_role;
grant execute on function public.dashboard_planning_rollups() to authenticated, service_role;

/* ----------------------------- postconditions ----------------------------- */

do $post$
declare
  v_fn_count       integer;
  v_projects_qual  text;
  v_weekly_qual    text;
  v_monthly_qual   text;
  v_milestones_qual text;
  v_updates_qual    text;
  v_snapshots_qual  text;
  v_anon_leak      integer;
  v_fn_name        text;
begin
  -- All eight functions exist.
  select count(*) into v_fn_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'dashboard_projects',
       'dashboard_weekly_report_summaries',
       'dashboard_weekly_overdue_reports',
       'dashboard_monthly_report_summaries',
       'dashboard_monthly_overdue_reports',
       'dashboard_master_milestones',
       'dashboard_milestone_updates',
       'dashboard_planning_rollups'
     );
  if v_fn_count <> 8 then
    raise exception 'Post-check failed: expected 8 dashboard read-model functions, found %.', v_fn_count;
  end if;

  -- Each returns an EXPLICIT column list, never a passthrough of a base
  -- table's own row type (`returns setof <table>` / `select t.*`).
  -- pg_get_function_result() renders a passthrough as literally
  -- "SETOF <table>"; an explicit `returns table (...)` renders as
  -- "TABLE(col type, ...)" instead.
  for v_fn_name in
    select unnest(array[
      'dashboard_projects',
      'dashboard_weekly_report_summaries',
      'dashboard_weekly_overdue_reports',
      'dashboard_monthly_report_summaries',
      'dashboard_monthly_overdue_reports',
      'dashboard_master_milestones',
      'dashboard_milestone_updates',
      'dashboard_planning_rollups'
    ])
  loop
    if pg_get_function_result(
         (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = v_fn_name)
       ) ilike 'setof %' then
      raise exception 'Post-check failed: % returns a SETOF passthrough -- it must return an explicit column list.', v_fn_name;
    end if;
  end loop;

  -- dashboard_projects() exposes exactly 8 columns.
  if (
    select array_length(proargnames, 1)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'dashboard_projects'
  ) <> 8 then
    raise exception 'Post-check failed: dashboard_projects() does not expose exactly 8 columns.';
  end if;

  -- dashboard_milestone_updates() must filter to approved rows only --
  -- literally present in its SQL text, not merely asserted in a comment.
  if (
    select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'dashboard_milestone_updates'
  ) not ilike '%approval_status = ''approved''%' then
    raise exception 'Post-check failed: dashboard_milestone_updates() does not filter to approval_status = ''approved''.';
  end if;

  -- Every underlying SELECT policy this migration depends on remains
  -- exactly as its own prior migration left it.
  select qual into v_projects_qual
    from pg_policies
   where schemaname = 'public' and tablename = 'projects' and policyname = 'projects_select';
  if v_projects_qual is null or v_projects_qual not like '%can_access_project%' then
    raise exception 'Post-check failed: projects_select was modified -- it must remain exactly as 20260912000003 left it.';
  end if;

  select qual into v_weekly_qual
    from pg_policies
   where schemaname = 'public' and tablename = 'weekly_reports' and policyname = 'weekly_reports_select';
  if v_weekly_qual is null or v_weekly_qual not like '%can_access_project%' then
    raise exception 'Post-check failed: weekly_reports_select was modified -- it must remain exactly as 20260916000001 left it.';
  end if;

  select qual into v_monthly_qual
    from pg_policies
   where schemaname = 'public' and tablename = 'monthly_reports' and policyname = 'monthly_reports_select';
  if v_monthly_qual is null or v_monthly_qual not like '%can_access_project%' then
    raise exception 'Post-check failed: monthly_reports_select was modified -- it must remain unchanged.';
  end if;

  -- Verified 2026-09-22 against a local instance: master_milestones_select
  -- is `using (true)` (widened by 20260820000003, never re-narrowed by
  -- Phase B) -- NOT weekly_can_access_project(), which was this
  -- migration's original, incorrect assumption. Asserting the true value
  -- so this post-check catches a real future change instead of always
  -- failing on a correct, unchanged policy.
  select qual into v_milestones_qual
    from pg_policies
   where schemaname = 'public' and tablename = 'master_milestones' and policyname = 'master_milestones_select';
  if v_milestones_qual is distinct from 'true' then
    raise exception 'Post-check failed: master_milestones_select changed from the verified `using (true)` -- re-check this migration''s header claim about it before proceeding.';
  end if;

  -- Verified the same way: milestone_updates_select already admits an
  -- approved row platform-wide via its own OR branch, independent of
  -- project access.
  select qual into v_updates_qual
    from pg_policies
   where schemaname = 'public' and tablename = 'milestone_updates' and policyname = 'milestone_updates_select';
  if v_updates_qual is null or v_updates_qual not like '%approval_status = ''approved''%' then
    raise exception 'Post-check failed: milestone_updates_select no longer has its approved-row OR branch -- re-check this migration''s header claim about it before proceeding.';
  end if;

  select qual into v_snapshots_qual
    from pg_policies
   where schemaname = 'public' and tablename = 'planning_snapshots' and policyname = 'planning_snapshots_select';
  if v_snapshots_qual is null or v_snapshots_qual not like '%can_access_project%' then
    raise exception 'Post-check failed: planning_snapshots_select was modified -- it must remain unchanged.';
  end if;

  -- No function is executable by anon/public.
  select count(*) into v_anon_leak
    from information_schema.routine_privileges
   where routine_schema = 'public'
     and routine_name in (
       'dashboard_projects',
       'dashboard_weekly_report_summaries',
       'dashboard_weekly_overdue_reports',
       'dashboard_monthly_report_summaries',
       'dashboard_monthly_overdue_reports',
       'dashboard_master_milestones',
       'dashboard_milestone_updates',
       'dashboard_planning_rollups'
     )
     and grantee in ('anon', 'public');
  if v_anon_leak > 0 then
    raise exception 'Post-check failed: % dashboard read-model function grant(s) reach anon/public.', v_anon_leak;
  end if;

  raise notice 'Dashboard portfolio-wide READ MODEL applied: 8 functions created -- explicit column lists, active-projects-only, bounded-per-project where sensible, approved-only for milestone updates, authenticated-only, SELECT-only. Every underlying *_select policy this migration reads from is unchanged.';
end;
$post$;

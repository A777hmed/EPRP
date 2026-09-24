import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { projectService } from "./project-service";
import { weeklyReportService } from "./weekly-report-service";
import { monthlyReportService } from "./monthly-report-service";
import { milestoneService } from "./milestone-service";
import { planningRollupService, type PlanningSnapshotRollup } from "./planning-rollup-service";
import type {
  MasterMilestone,
  MilestoneUpdate,
  ProjectLifecycleStatus,
  ReportStatus,
} from "@/types";

/**
 * The Dashboard's own portfolio-wide READ MODEL — narrow, explicit,
 * bounded fetches used ONLY by `useDashboardData()` (`features/dashboard/
 * dashboard-data.ts`), regardless of the caller's own project assignment.
 *
 * See `20260922000001_dashboard_portfolio_project_visibility.sql` for the
 * full design rationale, every excluded column and why, and the
 * post-checks that prove each function is an explicit column list rather
 * than a table passthrough.
 *
 * LEAST PRIVILEGE, PER DATA SOURCE:
 *
 *   - Projects: every non-archived project, full identity/lifecycle
 *     columns only (no narrative, no responsibility-holder contact ids
 *     beyond what's read).
 *   - Weekly/Monthly: the latest 12 reports PER PROJECT (current position +
 *     trend chart), any status — plus a SEPARATE, unbounded overdue-only
 *     fetch, so an old stuck report is never silently excluded by the
 *     12-report window. Numeric/status/date/ownership columns only; never
 *     `summary`/`executive_summary` (narrative) or `signatories`.
 *   - Master Milestones: governed (`approval_status = 'approved'`) update
 *     rows only, non-narrative columns only, fed into the EXISTING,
 *     UNCHANGED `milestoneStates()` derivation (`features/projects/
 *     milestone-state.ts`) — this module does not re-implement that
 *     algorithm, only supplies its input narrowly.
 *   - Planning: one row per project — the latest PUBLISHED snapshot's
 *     already-aggregated rollup figures, computed server-side. No
 *     `planning_snapshot_activities` row ever leaves the database through
 *     this path.
 *
 * MOCK FALLBACK: the mock services have no RLS to bypass — they already
 * return every record to every caller — so the mock branch of each
 * function below reuses the existing, unchanged mock-backed services
 * directly rather than re-implementing narrowing that mock mode has no
 * need for.
 */

function client(): SupabaseClient {
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

/* ================================ Projects ================================= */

export interface DashboardProjectSummary {
  id: string;
  code: string;
  name: string;
  shortName?: string;
  status: ProjectLifecycleStatus;
  currentPhaseId?: string;
  forecastFinishDate?: string;
  updatedAt: string;
}

interface DashboardProjectSummaryRow {
  id: string;
  code: string;
  name: string;
  short_name: string | null;
  status: string;
  current_phase_id: string | null;
  forecast_finish_date: string | null;
  updated_at: string;
}

function rowToProjectSummary(row: DashboardProjectSummaryRow): DashboardProjectSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    shortName: row.short_name ?? undefined,
    status: row.status as ProjectLifecycleStatus,
    currentPhaseId: row.current_phase_id ?? undefined,
    forecastFinishDate: row.forecast_finish_date ?? undefined,
    updatedAt: row.updated_at,
  };
}

/**
 * Every ACTIVE (non-archived) project, platform-wide, read-only — the
 * Dashboard's own project list. Archived exclusion is enforced by
 * `dashboard_projects()` itself (`p.status <> 'archived'`), matching
 * `dashboardProjectScope()`'s own rule exactly (verified against every
 * `ProjectLifecycleStatus` value — anything other than literally
 * `"archived"` is in scope), not only re-applied client-side.
 */
export async function fetchDashboardProjects(): Promise<DashboardProjectSummary[]> {
  if (!isSupabaseConfigured()) {
    return projectService.getProjects();
  }
  const { data, error } = await client().rpc("dashboard_projects");
  if (error) throw new Error(error.message);
  return ((data ?? []) as DashboardProjectSummaryRow[]).map(rowToProjectSummary);
}

/* ============================ Weekly / Monthly ============================= */

/** Exactly the columns the two `dashboard_*_report_summaries()` /
 *  `dashboard_*_overdue_reports()` functions return. No narrative
 *  (`summary`/`executive_summary`), no signatories, no reviewed/approved-by
 *  contact ids — `preparedByContactId` alone is included, for the Overdue
 *  Reports summary's "owner" column. */
export interface DashboardWeeklyReportSummary {
  id: string;
  projectId: string;
  reportNumber: string;
  status: ReportStatus;
  periodEnd: string;
  plannedProgress: number;
  actualProgress: number;
  preparedByContactId?: string;
}

interface DashboardWeeklySummaryRow {
  id: string;
  project_id: string;
  report_number: string;
  status: string;
  period_end: string;
  planned_progress: number;
  actual_progress: number;
  prepared_by_contact_id: string | null;
}

function rowToWeeklySummary(row: DashboardWeeklySummaryRow): DashboardWeeklyReportSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    reportNumber: row.report_number,
    status: row.status as ReportStatus,
    periodEnd: row.period_end,
    plannedProgress: row.planned_progress,
    actualProgress: row.actual_progress,
    preparedByContactId: row.prepared_by_contact_id ?? undefined,
  };
}

/**
 * The latest 12 Weekly reports PER PROJECT, on every active project,
 * platform-wide, read-only — bounded so this is "the recent window a
 * current-position + trend-chart read genuinely needs", not an unbounded
 * historical export. 12 always includes the true latest report at position
 * 0 (so the current-position KPI is never wrong because of the bound) and
 * comfortably covers `varianceTrend()`'s own 8-period window. Status is
 * NOT filtered here — `positionsFor()` decides which of these count as an
 * OFFICIAL (approved+) position; this fetch only bounds volume.
 */
export async function fetchDashboardWeeklyReportSummaries(): Promise<DashboardWeeklyReportSummary[]> {
  if (!isSupabaseConfigured()) {
    return weeklyReportService.list();
  }
  const { data, error } = await client().rpc("dashboard_weekly_report_summaries");
  if (error) throw new Error(error.message);
  return ((data ?? []) as DashboardWeeklySummaryRow[]).map(rowToWeeklySummary);
}

/**
 * EVERY Weekly report not yet delivered (`approved|finalized|locked|
 * archived`) whose period has passed — unbounded by project, because the
 * whole reason this is a separate function is so an old stuck report is
 * never silently excluded by the 12-report window above. The predicate
 * itself keeps this narrow: only reports that are genuinely overdue,
 * platform-wide, ever leave the database through this path.
 */
export async function fetchDashboardWeeklyOverdueReports(): Promise<DashboardWeeklyReportSummary[]> {
  if (!isSupabaseConfigured()) {
    return weeklyReportService.list();
  }
  const { data, error } = await client().rpc("dashboard_weekly_overdue_reports");
  if (error) throw new Error(error.message);
  return ((data ?? []) as DashboardWeeklySummaryRow[]).map(rowToWeeklySummary);
}

/** Exactly the columns the two Monthly functions return. Same exclusions
 *  as the Weekly summary above, keyed on `executive_summary`. */
export interface DashboardMonthlyReportSummary {
  id: string;
  projectId: string;
  reportNumber: string;
  status: ReportStatus;
  reportingMonth: string;
  plannedProgress: number;
  actualProgress: number;
  preparedByContactId?: string;
}

interface DashboardMonthlySummaryRow {
  id: string;
  project_id: string;
  report_number: string;
  status: string;
  reporting_month: string;
  planned_progress: number;
  actual_progress: number;
  prepared_by_contact_id: string | null;
}

function rowToMonthlySummary(row: DashboardMonthlySummaryRow): DashboardMonthlyReportSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    reportNumber: row.report_number,
    status: row.status as ReportStatus,
    reportingMonth: row.reporting_month,
    plannedProgress: Number(row.planned_progress),
    actualProgress: Number(row.actual_progress),
    preparedByContactId: row.prepared_by_contact_id ?? undefined,
  };
}

/** The latest 12 Monthly reports per project — same reasoning as the
 *  Weekly window above. */
export async function fetchDashboardMonthlyReportSummaries(): Promise<DashboardMonthlyReportSummary[]> {
  if (!isSupabaseConfigured()) {
    return monthlyReportService.list();
  }
  const { data, error } = await client().rpc("dashboard_monthly_report_summaries");
  if (error) throw new Error(error.message);
  return ((data ?? []) as DashboardMonthlySummaryRow[]).map(rowToMonthlySummary);
}

/** Every Monthly report not yet delivered whose period has passed —
 *  unbounded, same reasoning as the Weekly overdue fetch above. */
export async function fetchDashboardMonthlyOverdueReports(): Promise<DashboardMonthlyReportSummary[]> {
  if (!isSupabaseConfigured()) {
    return monthlyReportService.list();
  }
  const { data, error } = await client().rpc("dashboard_monthly_overdue_reports");
  if (error) throw new Error(error.message);
  return ((data ?? []) as DashboardMonthlySummaryRow[]).map(rowToMonthlySummary);
}

/* ============================ Master Milestones ============================ */

interface DashboardMasterMilestoneRow {
  id: string;
  project_id: string;
  department_id: string | null;
  code: string;
  name: string;
  priority: string;
  source: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  milestone_type: string;
  baseline_date: string | null;
  planned_date: string | null;
  client_approval_required: boolean;
  is_advance_payment: boolean;
}

/**
 * Populates ONLY the `MasterMilestone` fields `dashboard_master_milestones()`
 * returns. Every other field the full domain type declares (description,
 * systemId, disciplineId, ownerContactId, sourceDocumentId, category,
 * weightPercent, plannedProgressPercent, predecessorMilestoneId, and every
 * payment VALUE field) is deliberately absent from the RPC and so is
 * `undefined` here — none of them are read by `governedMilestoneRow()` or
 * by `milestoneState()`'s status/progress/date derivation, only by the
 * Master Planning register UI, which this module does not feed. The
 * REQUIRED (non-optional) fields on `MasterMilestone` this doesn't
 * otherwise need — priority, source, active, createdAt, updatedAt, type,
 * clientApprovalRequired, isAdvancePayment — are still fetched for real
 * (the last two are plain config booleans, not values or narrative), at
 * zero additional privacy cost, because they must be present for this to
 * type-check as a genuine `MasterMilestone` and feed `milestoneStates()`
 * unmodified.
 */
function rowToMasterMilestone(row: DashboardMasterMilestoneRow): MasterMilestone {
  return {
    id: row.id,
    projectId: row.project_id,
    code: row.code,
    name: row.name,
    departmentId: row.department_id ?? undefined,
    baselineDate: row.baseline_date ?? undefined,
    priority: row.priority as MasterMilestone["priority"],
    source: row.source as MasterMilestone["source"],
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    type: row.milestone_type as MasterMilestone["type"],
    plannedDate: row.planned_date ?? undefined,
    clientApprovalRequired: row.client_approval_required,
    isAdvancePayment: row.is_advance_payment,
  };
}

/** Every ACTIVE project's Master Milestone identity rows, platform-wide,
 *  read-only. No `description`/`notes` (narrative) or financial columns —
 *  see `rowToMasterMilestone()`. */
export async function fetchDashboardMasterMilestones(): Promise<MasterMilestone[]> {
  if (!isSupabaseConfigured()) {
    const projects = await projectService.getProjects();
    const { milestones } = await milestoneService.listRegister(projects.map((p) => p.id));
    return milestones;
  }
  const { data, error } = await client().rpc("dashboard_master_milestones");
  if (error) throw new Error(error.message);
  return ((data ?? []) as DashboardMasterMilestoneRow[]).map(rowToMasterMilestone);
}

interface DashboardMilestoneUpdateRow {
  id: string;
  milestone_id: string;
  source: string;
  status: string;
  progress_percent: number | null;
  forecast_date: string | null;
  actual_date: string | null;
  approval_status: string;
  is_regression: boolean;
  submitted_at: string;
  as_of_date: string | null;
}

/**
 * Populates ONLY the `MilestoneUpdate` fields `dashboard_milestone_updates()`
 * returns. `narrative`, `decisionNote`, `regressionReason` (free text) and
 * every 13.2c commercial/client-approval field (paymentStatus,
 * invoiceReference, invoicedDate, receivedDate, recoveredAmount,
 * clientApprovalStatus, clientApprovalDate) and reconciliation-adoption
 * metadata (adoptedFromUpdateId, reconciliationReason) are deliberately
 * absent and so `undefined` here — none of them are read by
 * `governedMilestoneRow()`, and `milestoneState()` only folds them into
 * OUTPUT fields the Dashboard never renders (payment/recovery/client
 * status). `weeklyReportId`/`monthlyReportId`/`departmentId`/
 * `disciplineId`/`submittedByContactId`/`approvedByContactId`/`approvedAt`
 * are the same — provenance the Master Planning UI shows, not anything
 * `milestoneStates()`'s derivation itself reads.
 */
function rowToMilestoneUpdate(row: DashboardMilestoneUpdateRow): MilestoneUpdate {
  return {
    id: row.id,
    milestoneId: row.milestone_id,
    source: row.source as MilestoneUpdate["source"],
    status: row.status as MilestoneUpdate["status"],
    progressPercent: row.progress_percent ?? undefined,
    forecastDate: row.forecast_date ?? undefined,
    actualDate: row.actual_date ?? undefined,
    approvalStatus: row.approval_status as MilestoneUpdate["approvalStatus"],
    isRegression: row.is_regression,
    submittedAt: row.submitted_at,
    asOfDate: row.as_of_date ?? undefined,
  };
}

/**
 * Every ACTIVE project's GOVERNED (`approval_status = 'approved'`) Master
 * Milestone update rows, platform-wide, read-only — feeds the existing,
 * unmodified `milestoneStates()` (`features/projects/milestone-state.ts`)
 * to derive the exact same current-state/cut-off-reconciliation result
 * that function already produces for an assigned viewer. Pending
 * (submitted-but-not-yet-accepted) rows are deliberately excluded: they
 * are not yet official, and `governedMilestoneRow()` — the Dashboard's own
 * consumer of `milestoneStates()`'s output — never reads
 * `MilestoneState.pending`/`approvalQueue()` in the first place.
 */
export async function fetchDashboardMilestoneUpdates(): Promise<MilestoneUpdate[]> {
  if (!isSupabaseConfigured()) {
    const projects = await projectService.getProjects();
    const { updates } = await milestoneService.listRegister(projects.map((p) => p.id));
    return updates.filter((update) => update.approvalStatus === "approved");
  }
  const { data, error } = await client().rpc("dashboard_milestone_updates");
  if (error) throw new Error(error.message);
  return ((data ?? []) as DashboardMilestoneUpdateRow[]).map(rowToMilestoneUpdate);
}

/* ================================ Planning ================================= */

interface DashboardPlanningRollupRow {
  project_id: string;
  snapshot_id: string;
  snapshot_version: number;
  data_date: string | null;
  planned_progress: number | null;
  actual_progress: number | null;
  variance: number | null;
  planned_value: number | null;
  earned_value: number | null;
  spi: number | null;
  coverage_percent: number;
}

function rowToPlanningRollup(row: DashboardPlanningRollupRow): PlanningSnapshotRollup {
  return {
    source: "planning",
    snapshotId: row.snapshot_id,
    snapshotVersion: row.snapshot_version,
    dataDate: row.data_date ?? undefined,
    plannedProgress: row.planned_progress,
    actualProgress: row.actual_progress,
    variance: row.variance,
    plannedValue: row.planned_value,
    earnedValue: row.earned_value,
    spi: row.spi,
    coveragePercent: row.coverage_percent,
  };
}

/**
 * Every ACTIVE project's LATEST PUBLISHED Planning Snapshot rollup —
 * Planned/Actual/Variance/SPI/EV/PV/Coverage, computed SERVER-SIDE by
 * `dashboard_planning_rollups()` from `planning_snapshot_activities` (or,
 * for a snapshot promoted from an Opening Position, from
 * `planning_opening_positions` directly) — mirroring
 * `computeRollupFromActivities()` / `rollupFromOpeningPosition()`
 * (`src/lib/planning-rollup.ts`) exactly. No `planning_snapshot_activities`
 * row (name, code, dates, per-activity weight/percent) ever leaves the
 * database through this path — only the eight aggregate numbers per
 * project.
 *
 * Returned as a Map so `deriveDashboardPlanningFigures()` — unchanged — can
 * be called exactly as it already is with a per-project lookup.
 */
export async function fetchDashboardPlanningRollups(): Promise<Map<string, PlanningSnapshotRollup | null>> {
  if (!isSupabaseConfigured()) {
    const projects = await projectService.getProjects();
    const entries = await Promise.all(
      projects.map(async (project) => {
        try {
          const latest = await planningRollupService.getLatestPublishedSnapshot(project.id);
          const rollup = latest ? await planningRollupService.computeSnapshotRollup(latest.id) : null;
          return [project.id, rollup] as const;
        } catch {
          return [project.id, null] as const;
        }
      })
    );
    return new Map(entries);
  }
  const { data, error } = await client().rpc("dashboard_planning_rollups");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as DashboardPlanningRollupRow[];
  return new Map(rows.map((row) => [row.project_id, rowToPlanningRollup(row)]));
}

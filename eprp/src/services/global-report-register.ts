import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { projectService } from "./project-service";
import { weeklyReportService } from "./weekly-report-service";
import { monthlyReportService } from "./monthly-report-service";
import type {
  KpiRating,
  ProgressStatus,
  Project,
  ProjectLifecycleStatus,
  ReportStatus,
  SignatorySnapshot,
} from "@/types";

/**
 * The GLOBAL Weekly/Monthly report REGISTER's own read model — Access &
 * Visibility Reconciliation hotfix, section B: `/weekly-reports` and
 * `/monthly-reports` are documented, in their own components, as
 * "consolidated register across every project the viewer can see" — this
 * module is what actually makes that platform-wide, read-only, regardless
 * of the caller's own project assignment.
 *
 * See `20260922000002_global_report_register_visibility.sql` for the full
 * rationale, every excluded column and why, and what is deliberately NOT
 * covered (department-level content — submissions, entries, comments).
 *
 * MOCK FALLBACK: as with the Dashboard read model, the mock services have
 * no RLS to bypass and already return every record to every caller, so the
 * mock branch below reuses them directly.
 */

function client(): SupabaseClient {
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

/* ============================ Project directory ============================= */

/** Wider than `DashboardProjectSummary` (adds client/portfolio-group/
 *  manager/type) and NOT archived-filtered — the registers are historical
 *  surfaces, unlike the Dashboard's current-management scope. A separate
 *  type from the Dashboard's own, deliberately: this module and
 *  `dashboard-read-model.ts` must be able to change independently. */
export interface GlobalRegisterProject {
  id: string;
  code: string;
  name: string;
  shortName?: string;
  status: ProjectLifecycleStatus;
  clientId?: string;
  portfolioGroupId?: string;
  projectManagerId?: string;
  projectTypeId?: string;
  currentPhaseId?: string;
  forecastFinishDate?: string;
  updatedAt: string;
}

export interface GlobalRegisterProjectRow {
  id: string;
  code: string;
  name: string;
  short_name: string | null;
  status: string;
  client_id: string | null;
  portfolio_group_id: string | null;
  project_manager_id: string | null;
  project_type_id: string | null;
  current_phase_id: string | null;
  forecast_finish_date: string | null;
  updated_at: string;
}

export function rowToRegisterProject(row: GlobalRegisterProjectRow): GlobalRegisterProject {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    shortName: row.short_name ?? undefined,
    status: row.status as ProjectLifecycleStatus,
    clientId: row.client_id ?? undefined,
    portfolioGroupId: row.portfolio_group_id ?? undefined,
    projectManagerId: row.project_manager_id ?? undefined,
    projectTypeId: row.project_type_id ?? undefined,
    currentPhaseId: row.current_phase_id ?? undefined,
    forecastFinishDate: row.forecast_finish_date ?? undefined,
    updatedAt: row.updated_at,
  };
}

/** Full mock `Project` → the narrower register shape — mock has no RLS to
 *  bypass, so this is a structural narrowing only, not a privacy filter. */
function projectToRegisterProject(project: Project): GlobalRegisterProject {
  return {
    id: project.id,
    code: project.code,
    name: project.name,
    shortName: project.shortName,
    status: project.status,
    clientId: project.clientId,
    portfolioGroupId: project.portfolioGroupId,
    projectManagerId: project.projectManagerId,
    projectTypeId: project.projectTypeId,
    currentPhaseId: project.currentPhaseId,
    forecastFinishDate: project.forecastFinishDate,
    updatedAt: project.updatedAt,
  };
}

/**
 * Every project, every status (including archived — a historical
 * register), platform-wide, read-only.
 */
export async function fetchGlobalRegisterProjects(): Promise<GlobalRegisterProject[]> {
  if (!isSupabaseConfigured()) {
    const projects = await projectService.getProjects();
    return projects.map(projectToRegisterProject);
  }
  const { data, error } = await client().rpc("global_report_register_projects");
  if (error) throw new Error(error.message);
  return ((data ?? []) as GlobalRegisterProjectRow[]).map(rowToRegisterProject);
}

/* ============================ Weekly register =============================== */

/** Exactly the columns `global_weekly_report_register()` returns — register
 *  METADATA only. No narrative (`summary`), no signatories, no contact id
 *  except `preparedByContactId`. Content for one specific report comes from
 *  `fetchGlobalWeeklyReportDetail()`, gated to approved+. */
export interface GlobalWeeklyRegisterRow {
  id: string;
  projectId: string;
  reportNumber: string;
  status: ReportStatus;
  weekNumber: number;
  periodStart: string;
  periodEnd: string;
  plannedProgress: number;
  actualProgress: number;
  preparedByContactId?: string;
  planningSnapshotId?: string;
  updatedAt: string;
}

export interface GlobalWeeklyRegisterRowShape {
  id: string;
  project_id: string;
  report_number: string;
  status: string;
  week_number: number;
  period_start: string;
  period_end: string;
  planned_progress: number;
  actual_progress: number;
  prepared_by_contact_id: string | null;
  planning_snapshot_id: string | null;
  updated_at: string;
}

export function rowToWeeklyRegisterRow(row: GlobalWeeklyRegisterRowShape): GlobalWeeklyRegisterRow {
  return {
    id: row.id,
    projectId: row.project_id,
    reportNumber: row.report_number,
    status: row.status as ReportStatus,
    weekNumber: row.week_number,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    plannedProgress: row.planned_progress,
    actualProgress: row.actual_progress,
    preparedByContactId: row.prepared_by_contact_id ?? undefined,
    planningSnapshotId: row.planning_snapshot_id ?? undefined,
    updatedAt: row.updated_at,
  };
}

/** Every Weekly report, every project, every status (metadata only),
 *  platform-wide, read-only, unbounded (the register shows full history —
 *  never the Dashboard's 12-per-project window). */
export async function fetchGlobalWeeklyReportRegister(): Promise<GlobalWeeklyRegisterRow[]> {
  if (!isSupabaseConfigured()) {
    const reports = await weeklyReportService.list();
    return reports.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      reportNumber: r.reportNumber,
      status: r.status,
      weekNumber: r.weekNumber,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      plannedProgress: r.plannedProgress,
      actualProgress: r.actualProgress,
      preparedByContactId: r.preparedByContactId,
      planningSnapshotId: r.planningSnapshotId,
      updatedAt: r.updatedAt,
    }));
  }
  const { data, error } = await client().rpc("global_weekly_report_register");
  if (error) throw new Error(error.message);
  return ((data ?? []) as GlobalWeeklyRegisterRowShape[]).map(rowToWeeklyRegisterRow);
}

/* ============================ Monthly register ================================ */

export interface GlobalMonthlyRegisterRow {
  id: string;
  projectId: string;
  reportNumber: string;
  status: ReportStatus;
  reportingMonth: string;
  plannedProgress: number;
  actualProgress: number;
  preparedByContactId?: string;
  planningSnapshotId?: string;
  updatedAt: string;
}

export interface GlobalMonthlyRegisterRowShape {
  id: string;
  project_id: string;
  report_number: string;
  status: string;
  reporting_month: string;
  planned_progress: number;
  actual_progress: number;
  prepared_by_contact_id: string | null;
  planning_snapshot_id: string | null;
  updated_at: string;
}

export function rowToMonthlyRegisterRow(row: GlobalMonthlyRegisterRowShape): GlobalMonthlyRegisterRow {
  return {
    id: row.id,
    projectId: row.project_id,
    reportNumber: row.report_number,
    status: row.status as ReportStatus,
    reportingMonth: row.reporting_month,
    plannedProgress: Number(row.planned_progress),
    actualProgress: Number(row.actual_progress),
    preparedByContactId: row.prepared_by_contact_id ?? undefined,
    planningSnapshotId: row.planning_snapshot_id ?? undefined,
    updatedAt: row.updated_at,
  };
}

export async function fetchGlobalMonthlyReportRegister(): Promise<GlobalMonthlyRegisterRow[]> {
  if (!isSupabaseConfigured()) {
    const reports = await monthlyReportService.list();
    return reports.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      reportNumber: r.reportNumber,
      status: r.status,
      reportingMonth: r.reportingMonth,
      plannedProgress: r.plannedProgress,
      actualProgress: r.actualProgress,
      preparedByContactId: r.preparedByContactId,
      planningSnapshotId: r.planningSnapshotId,
      updatedAt: r.updatedAt,
    }));
  }
  const { data, error } = await client().rpc("global_monthly_report_register");
  if (error) throw new Error(error.message);
  return ((data ?? []) as GlobalMonthlyRegisterRowShape[]).map(rowToMonthlyRegisterRow);
}

/* ======================= Report-level approved+ detail ======================= */

/** Exactly the columns `global_weekly_report_detail()` returns — the
 *  report's own header/KPI/narrative content, readable once it is
 *  approved+ (or the caller already has ordinary project access).
 *  Department-level content is NOT included — see the migration header. */
export interface GlobalWeeklyReportDetail {
  id: string;
  projectId: string;
  reportNumber: string;
  status: ReportStatus;
  weekNumber: number;
  periodStart: string;
  periodEnd: string;
  plannedProgress: number;
  actualProgress: number;
  manHoursToDate?: number;
  hseStatus?: KpiRating;
  qualityStatus?: KpiRating;
  overallProgressStatus?: ProgressStatus;
  summary?: string;
  signatories?: SignatorySnapshot;
  disciplineIds: string[];
  preparedByContactId?: string;
  reviewedByContactId?: string;
  approvedByContactId?: string;
  planningSnapshotId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GlobalWeeklyReportDetailRow {
  id: string;
  project_id: string;
  report_number: string;
  status: string;
  week_number: number;
  period_start: string;
  period_end: string;
  planned_progress: number;
  actual_progress: number;
  man_hours_to_date: number | null;
  hse_status: string | null;
  quality_status: string | null;
  overall_progress_status: string | null;
  summary: string | null;
  signatories: SignatorySnapshot | null;
  discipline_ids: string[];
  prepared_by_contact_id: string | null;
  reviewed_by_contact_id: string | null;
  approved_by_contact_id: string | null;
  planning_snapshot_id: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToWeeklyDetail(row: GlobalWeeklyReportDetailRow): GlobalWeeklyReportDetail {
  return {
    id: row.id,
    projectId: row.project_id,
    reportNumber: row.report_number,
    status: row.status as ReportStatus,
    weekNumber: row.week_number,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    plannedProgress: row.planned_progress,
    actualProgress: row.actual_progress,
    manHoursToDate: row.man_hours_to_date ?? undefined,
    hseStatus: (row.hse_status as KpiRating) ?? undefined,
    qualityStatus: (row.quality_status as KpiRating) ?? undefined,
    overallProgressStatus: (row.overall_progress_status as ProgressStatus) ?? undefined,
    summary: row.summary ?? undefined,
    signatories: row.signatories ?? undefined,
    disciplineIds: row.discipline_ids ?? [],
    preparedByContactId: row.prepared_by_contact_id ?? undefined,
    reviewedByContactId: row.reviewed_by_contact_id ?? undefined,
    approvedByContactId: row.approved_by_contact_id ?? undefined,
    planningSnapshotId: row.planning_snapshot_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * One Weekly report's header/KPI/narrative content — `null` when neither
 * the caller has ordinary project access nor the report is approved+
 * (mirrors `global_weekly_report_detail()`'s own gate exactly; a refusal
 * here is not distinguishable from "does not exist", by design — same as
 * ordinary RLS).
 */
export async function fetchGlobalWeeklyReportDetail(
  reportId: string
): Promise<GlobalWeeklyReportDetail | null> {
  if (!isSupabaseConfigured()) {
    const report = await weeklyReportService.getById(reportId);
    if (!report) return null;
    return {
      id: report.id,
      projectId: report.projectId,
      reportNumber: report.reportNumber,
      status: report.status,
      weekNumber: report.weekNumber,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      plannedProgress: report.plannedProgress,
      actualProgress: report.actualProgress,
      manHoursToDate: report.manHoursToDate,
      hseStatus: report.hseStatus,
      qualityStatus: report.qualityStatus,
      overallProgressStatus: report.overallProgressStatus,
      summary: report.summary,
      disciplineIds: report.disciplineIds,
      preparedByContactId: report.preparedByContactId,
      reviewedByContactId: report.reviewedByContactId,
      approvedByContactId: report.approvedByContactId,
      planningSnapshotId: report.planningSnapshotId,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    };
  }
  const { data, error } = await client().rpc("global_weekly_report_detail", {
    p_report_id: reportId,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as GlobalWeeklyReportDetailRow[];
  return rows[0] ? rowToWeeklyDetail(rows[0]) : null;
}

export interface GlobalMonthlyReportDetail {
  id: string;
  projectId: string;
  reportNumber: string;
  status: ReportStatus;
  reportingMonth: string;
  plannedProgress: number;
  actualProgress: number;
  hseStatus?: KpiRating;
  qualityStatus?: KpiRating;
  overallProgressStatus?: ProgressStatus;
  executiveSummary?: string;
  preparedByContactId?: string;
  reviewedByContactId?: string;
  approvedByContactId?: string;
  planningSnapshotId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GlobalMonthlyReportDetailRow {
  id: string;
  project_id: string;
  report_number: string;
  status: string;
  reporting_month: string;
  planned_progress: number;
  actual_progress: number;
  hse_status: string | null;
  quality_status: string | null;
  overall_progress_status: string | null;
  executive_summary: string | null;
  prepared_by_contact_id: string | null;
  reviewed_by_contact_id: string | null;
  approved_by_contact_id: string | null;
  planning_snapshot_id: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToMonthlyDetail(row: GlobalMonthlyReportDetailRow): GlobalMonthlyReportDetail {
  return {
    id: row.id,
    projectId: row.project_id,
    reportNumber: row.report_number,
    status: row.status as ReportStatus,
    reportingMonth: row.reporting_month,
    plannedProgress: Number(row.planned_progress),
    actualProgress: Number(row.actual_progress),
    hseStatus: (row.hse_status as KpiRating) ?? undefined,
    qualityStatus: (row.quality_status as KpiRating) ?? undefined,
    overallProgressStatus: (row.overall_progress_status as ProgressStatus) ?? undefined,
    executiveSummary: row.executive_summary ?? undefined,
    preparedByContactId: row.prepared_by_contact_id ?? undefined,
    reviewedByContactId: row.reviewed_by_contact_id ?? undefined,
    approvedByContactId: row.approved_by_contact_id ?? undefined,
    planningSnapshotId: row.planning_snapshot_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function fetchGlobalMonthlyReportDetail(
  reportId: string
): Promise<GlobalMonthlyReportDetail | null> {
  if (!isSupabaseConfigured()) {
    const report = await monthlyReportService.getById(reportId);
    if (!report) return null;
    return {
      id: report.id,
      projectId: report.projectId,
      reportNumber: report.reportNumber,
      status: report.status,
      reportingMonth: report.reportingMonth,
      plannedProgress: report.plannedProgress,
      actualProgress: report.actualProgress,
      hseStatus: report.hseStatus,
      qualityStatus: report.qualityStatus,
      overallProgressStatus: report.overallProgressStatus,
      executiveSummary: report.executiveSummary,
      preparedByContactId: report.preparedByContactId,
      reviewedByContactId: report.reviewedByContactId,
      approvedByContactId: report.approvedByContactId,
      planningSnapshotId: report.planningSnapshotId,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    };
  }
  const { data, error } = await client().rpc("global_monthly_report_detail", {
    p_report_id: reportId,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as GlobalMonthlyReportDetailRow[];
  return rows[0] ? rowToMonthlyDetail(rows[0]) : null;
}

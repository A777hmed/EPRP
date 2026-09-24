/**
 * Dashboard position/totals/overdue/trend derivation — pure, no React, no
 * `useMasterData()` — split out of `dashboard-data.ts` for the same reason
 * `dashboard-project-scope.ts` / `portfolio-progress.ts` / `progress-
 * curve.ts` / `planning-integration.ts` already are: a Node test can import
 * this file directly (its only `@/` imports are themselves import-light —
 * a type from `@/types`, `isApprovedReportStatus` from `@/config/
 * workflows`, `isoDate`/`todayIso` from `@/features/calendar/calendar-
 * types`), whereas `dashboard-data.ts` itself pulls in `useMasterData()`
 * and the master-data feature's React/TypeScript surface, which Node's
 * strip-only TypeScript support cannot parse (parameter-property
 * constructors). `dashboard-data.ts` re-exports every name below so no
 * existing import site needs to change.
 */

import { isoDate, todayIso } from "@/features/calendar/calendar-types";
import { isApprovedReportStatus } from "@/config/workflows";
import { deriveDashboardPlanningFigures } from "./planning-integration";
import type {
  DashboardMonthlyReportSummary,
  DashboardProjectSummary,
  DashboardWeeklyReportSummary,
} from "@/services/dashboard-read-model";
import type { PlanningSnapshotRollup } from "@/services/planning-rollup-service";
import type { ReportStatus } from "@/types";

const DELIVERED = new Set(["approved", "finalized", "locked", "archived"]);

export type TimePeriod = "this_week" | "this_month" | "quarter" | "all";

export const TIME_PERIOD_LABEL: Record<TimePeriod, string> = {
  this_week: "This Week",
  this_month: "This Month",
  quarter: "This Quarter",
  all: "All Time",
};

/** The window a period filter selects. `all` is unbounded. */
export function periodWindow(period: TimePeriod, today = new Date()): { from?: string; to?: string } {
  // Local-time formatting, never toISOString — see `isoDate` in calendar-types.
  const iso = isoDate;
  if (period === "all") return {};
  if (period === "this_week") {
    const start = new Date(today);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { from: iso(start), to: iso(end) };
  }
  if (period === "this_month") {
    return {
      from: iso(new Date(today.getFullYear(), today.getMonth(), 1)),
      to: iso(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    };
  }
  const quarter = Math.floor(today.getMonth() / 3);
  return {
    from: iso(new Date(today.getFullYear(), quarter * 3, 1)),
    to: iso(new Date(today.getFullYear(), quarter * 3 + 3, 0)),
  };
}

/**
 * Access & Visibility hotfix — a project's GOVERNED figure and its
 * REPORTING activity are two different facts.
 *
 * Before this, `positionsFor()` used the latest Weekly/Monthly report
 * regardless of status, so a still-editable Draft's numbers fed the
 * portfolio KPI exactly like an approved one. Per the approved Dashboard
 * design: platform-wide OFFICIAL performance figures (Planned/Actual/
 * Variance, schedule health, reporting coverage) come ONLY from a report
 * that has reached `approved`/`finalized`/`locked` (`isApprovedReportStatus`
 * — the existing, unchanged predicate). A project with a report still in
 * progress is never shown as `not_reported` (that would misrepresent
 * unapproved data as absent data) and never shown with that report's own
 * unapproved figures (that would treat a draft as governed) — it is
 * `pending_approval`, with the figures held back and the in-progress
 * status named instead. This basis applies identically to every
 * authenticated viewer, not only an unassigned one.
 */
export type ProjectReportingStatus = "not_reported" | "pending_approval" | "reported";

export interface ProjectPosition {
  project: DashboardProjectSummary;
  planned?: number;
  actual?: number;
  variance?: number;
  /**
   * Which record the figures came from, so a caption can state it.
   * "planning" means every figure in this position (planned, actual,
   * variance, spi) came from the SAME governed rollup — never a blend of a
   * Planning planned figure with a manual actual figure, or vice versa.
   */
  basis: "planning" | "weekly" | "monthly" | "none";
  /** See {@link ProjectReportingStatus}. A Published Planning Snapshot is
   *  always `"reported"` — it is governed by construction (see
   *  `planning-rollup-service.ts`'s header), unlike a Weekly/Monthly row. */
  reportingStatus: ProjectReportingStatus;
  /** The latest in-progress report's own lifecycle status — present only
   *  when `reportingStatus === "pending_approval"`, so the UI can name the
   *  stage ("draft", "under_review", …) instead of a bare "pending". */
  pendingReportStatus?: ReportStatus;
  reportedOn?: string;
  health: "on_track" | "at_risk" | "behind" | "critical" | "not_reported";

  /* ------------------------- Planning Integration 3D --------------------- */
  /** EV/PV. `null` only when Planning-backed and value data is unavailable
      (or Planned Value <= 0) — never a fabricated ratio. Absent (not even
      `null`) when `basis !== "planning"`. */
  spi?: number | null;
  /** Sum of reported planned_value / earned_value behind `spi` — carried
      through so a KPI detail surface can show EV/PV, or explain why SPI
      reads N/A, without recomputing anything. Same availability rule as
      `spi`: absent when `basis !== "planning"`. */
  plannedValue?: number | null;
  earnedValue?: number | null;
  /** Share of the schedule's weight the rollup actually speaks for. */
  coveragePercent?: number;
  /** The latest published snapshot's version, when `basis === "planning"`. */
  snapshotVersion?: number;
  /** The latest published snapshot's Data Date, when `basis === "planning"`. */
  dataDate?: string;
  /** The latest published snapshot's id, when `basis === "planning"` — lets a
      drill-down (Activity Depth, Coverage Detail) read that EXACT snapshot's
      activities rather than re-resolving "latest" a second time. */
  snapshotId?: string;
}

/** Matches `recommendScheduleStatus`: −3 points is the platform's own band. */
export function healthOf(variance: number | undefined): ProjectPosition["health"] {
  if (variance === undefined) return "not_reported";
  if (variance >= -3) return "on_track";
  if (variance >= -10) return "at_risk";
  if (variance >= -20) return "behind";
  return "critical";
}

export const HEALTH_META: Record<
  ProjectPosition["health"],
  { label: string; tone: "success" | "warning" | "danger" | "info" | "default"; color: string }
> = {
  on_track: { label: "On Track", tone: "success", color: "#12805c" },
  at_risk: { label: "At Risk", tone: "warning", color: "#b8730b" },
  behind: { label: "Behind Schedule", tone: "danger", color: "#c2410c" },
  critical: { label: "Critical", tone: "danger", color: "#b0343c" },
  not_reported: { label: "Not Reported", tone: "default", color: "#94a3b8" },
};

/** Short per-project caption for a position's basis — one place, so a new
    basis (like Planning, 3D) cannot be silently mislabeled somewhere that
    still only knew about "weekly"/"monthly". */
export const BASIS_LABEL: Record<Exclude<ProjectPosition["basis"], "none">, string> = {
  planning: "Planning Snapshot",
  weekly: "Latest Weekly",
  monthly: "Monthly",
};

/**
 * The ONE label for "why does this project have no governed position" —
 * every render site uses this instead of its own `basis === "none" ?
 * "Not Reported" : …` ternary, so "a report exists but isn't approved yet"
 * can never be silently rendered as "Not Reported" in one place while this
 * module's own data correctly distinguishes them (Access & Visibility
 * hotfix — "never misrepresent inaccessible or unapproved data as Not
 * Reported").
 */
export function positionStatusLabel(position: ProjectPosition): string {
  if (position.basis !== "none") return BASIS_LABEL[position.basis];
  return position.reportingStatus === "pending_approval" ? "Pending Approval" : "Not Reported";
}

/**
 * Each project's CURRENT position.
 *
 * Planning Integration 3D, "current position rule": when the project's
 * LATEST published Planning Snapshot has a usable rollup (both a Planned
 * and an Actual figure), that governs — Planned, Actual, Variance and SPI
 * all come from that ONE rollup, never mixed with a manual figure, and this
 * reading is NOT scoped by the period filter, because the Dashboard's
 * Planning position is "where the project stands today", not "what was
 * reported in this window". A Published Snapshot is always governed
 * (`reportingStatus: "reported"`) — there is no Draft concept for it.
 *
 * An unusable latest snapshot (or none at all) falls back to Weekly, then
 * Monthly — but, per the approved Dashboard design (Access & Visibility
 * hotfix), only a report that has reached `approved`/`finalized`/`locked`
 * (`isApprovedReportStatus`) may supply the OFFICIAL figure. This applies
 * identically to every viewer, not only an unassigned one: a still-editable
 * Draft's numbers are never platform-wide "official performance", whoever
 * is looking.
 *
 * A project with NO approved+ report but a report genuinely in progress is
 * `pending_approval` — figures withheld (never a draft's unapproved
 * numbers, never a fabricated absence), with the in-progress report's own
 * status carried so the UI can name it. Only a project with no report at
 * all, of any status, is `not_reported`.
 */
export function positionsFor(
  projects: DashboardProjectSummary[],
  weeklies: DashboardWeeklyReportSummary[],
  monthlies: DashboardMonthlyReportSummary[],
  period: TimePeriod,
  planningRollups?: Map<string, PlanningSnapshotRollup | null>
): ProjectPosition[] {
  const { from, to } = periodWindow(period);
  const inWindow = (date: string) => (!from || date >= from) && (!to || date <= to);
  const newestFirst = (a: string, b: string) => b.localeCompare(a);

  return projects.map((project) => {
    const figures = deriveDashboardPlanningFigures(planningRollups?.get(project.id));
    if (figures.planningBacked) {
      return {
        project,
        planned: figures.plannedProgress!,
        actual: figures.actualProgress!,
        variance: figures.variance ?? undefined,
        basis: "planning",
        reportingStatus: "reported",
        reportedOn: figures.dataDate,
        health: healthOf(figures.variance ?? undefined),
        spi: figures.spi,
        plannedValue: figures.plannedValue,
        earnedValue: figures.earnedValue,
        coveragePercent: figures.coveragePercent,
        snapshotVersion: figures.snapshotVersion,
        dataDate: figures.dataDate,
        snapshotId: figures.snapshotId,
      };
    }

    const projectWeeklies = weeklies.filter((report) => report.projectId === project.id);
    const projectMonthlies = monthlies.filter((report) => report.projectId === project.id);

    const officialWeekly = projectWeeklies
      .filter((report) => inWindow(report.periodEnd) && isApprovedReportStatus(report.status))
      .sort((a, b) => newestFirst(a.periodEnd, b.periodEnd))[0];

    if (officialWeekly) {
      const variance = officialWeekly.actualProgress - officialWeekly.plannedProgress;
      return {
        project,
        planned: officialWeekly.plannedProgress,
        actual: officialWeekly.actualProgress,
        variance,
        basis: "weekly",
        reportingStatus: "reported",
        reportedOn: officialWeekly.periodEnd,
        health: healthOf(variance),
      };
    }

    const officialMonthly = projectMonthlies
      .filter((report) => isApprovedReportStatus(report.status))
      .sort((a, b) => newestFirst(a.reportingMonth ?? "", b.reportingMonth ?? ""))[0];

    if (
      officialMonthly &&
      officialMonthly.plannedProgress !== undefined &&
      officialMonthly.actualProgress !== undefined
    ) {
      const variance = officialMonthly.actualProgress - officialMonthly.plannedProgress;
      return {
        project,
        planned: officialMonthly.plannedProgress,
        actual: officialMonthly.actualProgress,
        variance,
        basis: "monthly",
        reportingStatus: "reported",
        reportedOn: officialMonthly.reportingMonth,
        health: healthOf(variance),
      };
    }

    /*
     * No OFFICIAL position. Is a report genuinely in progress (any status,
     * not period-scoped — a draft outside the selected period is still a
     * real, in-progress report, not nothing), so this reads
     * `pending_approval` rather than misrepresenting it as `not_reported`?
     */
    const latestWeeklyAny = [...projectWeeklies].sort((a, b) =>
      newestFirst(a.periodEnd, b.periodEnd)
    )[0];
    const latestMonthlyAny = [...projectMonthlies].sort((a, b) =>
      newestFirst(a.reportingMonth ?? "", b.reportingMonth ?? "")
    )[0];
    const latestAny = !latestWeeklyAny
      ? latestMonthlyAny
      : !latestMonthlyAny
        ? latestWeeklyAny
        : latestWeeklyAny.periodEnd >= (latestMonthlyAny.reportingMonth ?? "")
          ? latestWeeklyAny
          : latestMonthlyAny;

    if (latestAny) {
      return {
        project,
        basis: "none",
        reportingStatus: "pending_approval",
        pendingReportStatus: latestAny.status,
        health: "not_reported",
      };
    }

    return { project, basis: "none", reportingStatus: "not_reported", health: "not_reported" };
  });
}

export interface PortfolioTotals {
  totalProjects: number;
  reportedProjects: number;
  planned?: number;
  actual?: number;
  variance?: number;
  onTrack: number;
  atRisk: number;
  behind: number;
  critical: number;
  /** `reportingStatus === "not_reported"` — genuinely no report at all.
   *  Distinct from `pendingApproval` below; never conflates the two, per
   *  "never misrepresent inaccessible or unapproved data as Not Reported". */
  notReported: number;
  /** `reportingStatus === "pending_approval"` — a report exists and is in
   *  progress, but has not reached an approved position yet. */
  pendingApproval: number;
  overdueReports: number;
}

/**
 * Portfolio audit (Planning Integration 3D).
 *
 * "Portfolio Progress" is an UNWEIGHTED arithmetic mean of each reported
 * project's own current-position Actual/Planned (`positionsFor` — Planning
 * when usable, Weekly/Monthly fallback otherwise), over reported projects
 * only ("absence is never zero" — a project with no basis is excluded from
 * the mean rather than folded in as 0%). It is NOT a weighted portfolio
 * rollup: a small pilot and a multi-year mega-project count identically.
 *
 * No governed project-weight model exists on this platform today (no
 * contract value, budget, physical-scope-share, or man-hour-share field is
 * recorded per project), so this function does not invent one — the
 * unweighted mean is kept for continuity with the Dashboard's existing KPI
 * strip, `PORTFOLIO_BASIS_NOTE` states its basis explicitly wherever it is
 * shown, and `ProjectPosition[]` (via `ProgressByProjectPanel`) still
 * surfaces every project's own accurate governed or fallback position
 * regardless of how the portfolio figure is rolled up.
 *
 * A future GOVERNED weighted rollup would need, at minimum: (1) a per-
 * project weight field the platform actually records and Project Control
 * maintains (e.g. contract value or approved physical-scope share) —
 * fabricating one from whatever happens to be on hand would be exactly the
 * "invented weighting" this slice was told not to add; (2) a documented
 * rule for a project with no weight recorded (excluded, or a defined
 * default); (3) the same rule applied consistently to Planning-backed and
 * fallback positions alike, so the portfolio figure cannot quietly change
 * meaning project-by-project.
 */
export const PORTFOLIO_BASIS_NOTE =
  "Unweighted mean across reported projects — no governed project-weight model exists yet.";

export function totalsFor(
  positions: ProjectPosition[],
  /** UNBOUNDED overdue-eligible Weekly reports (`fetchDashboardWeeklyOverdueReports()`)
   *  — never the 12-per-project `weeklies` window, so an old stuck report
   *  can never be undercounted here just because it fell outside it. */
  overdueWeeklies: DashboardWeeklyReportSummary[],
  overdueMonthlies: DashboardMonthlyReportSummary[],
  today = todayIso()
): PortfolioTotals {
  const reported = positions.filter((p) => p.planned !== undefined && p.actual !== undefined);
  const mean = (values: number[]) =>
    values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : undefined;

  const planned = mean(reported.map((p) => p.planned as number));
  const actual = mean(reported.map((p) => p.actual as number));

  const visible = new Set(positions.map((p) => p.project.id));
  const overdueWeekly = overdueWeeklies.filter(
    (r) => visible.has(r.projectId) && !DELIVERED.has(r.status) && r.periodEnd < today
  ).length;
  const overdueMonthly = overdueMonthlies.filter((r) => {
    if (!visible.has(r.projectId) || DELIVERED.has(r.status)) return false;
    const month = r.reportingMonth ?? "";
    if (!month) return false;
    const [y, m] = month.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) < today;
  }).length;

  return {
    totalProjects: positions.length,
    reportedProjects: reported.length,
    planned,
    actual,
    variance: planned !== undefined && actual !== undefined ? actual - planned : undefined,
    onTrack: positions.filter((p) => p.health === "on_track").length,
    atRisk: positions.filter((p) => p.health === "at_risk").length,
    behind: positions.filter((p) => p.health === "behind").length,
    critical: positions.filter((p) => p.health === "critical").length,
    notReported: positions.filter((p) => p.reportingStatus === "not_reported").length,
    pendingApproval: positions.filter((p) => p.reportingStatus === "pending_approval").length,
    overdueReports: overdueWeekly + overdueMonthly,
  };
}

/**
 * The individual overdue Weekly/Monthly reports behind `PortfolioTotals.
 * overdueReports` — same `DELIVERED`/period-end predicate, kept in this one
 * place so the Overdue Reports summary modal can never disagree with the KPI
 * count it expands on. `daysOverdue` is real date arithmetic against a
 * stored period-end date, never an invented or assumed due date.
 */
export interface OverdueReport {
  projectId: string;
  reportType: "weekly" | "monthly";
  reportNumber: string;
  /** The report's own period-end (Weekly) or reporting month (Monthly), as stored. */
  period: string;
  status: string;
  preparedByContactId?: string;
  daysOverdue: number;
}

export function overdueReports(
  positions: ProjectPosition[],
  /** UNBOUNDED — see `totalsFor()`'s matching parameter. */
  overdueWeeklies: DashboardWeeklyReportSummary[],
  overdueMonthlies: DashboardMonthlyReportSummary[],
  today = todayIso()
): OverdueReport[] {
  const visible = new Set(positions.map((p) => p.project.id));
  const daysBetween = (isoStart: string) =>
    Math.max(0, Math.round((Date.parse(today) - Date.parse(isoStart)) / 86_400_000));

  const weeklyRows: OverdueReport[] = overdueWeeklies
    .filter((r) => visible.has(r.projectId) && !DELIVERED.has(r.status) && r.periodEnd < today)
    .map((r) => ({
      projectId: r.projectId,
      reportType: "weekly",
      reportNumber: r.reportNumber,
      period: r.periodEnd,
      status: r.status,
      preparedByContactId: r.preparedByContactId,
      daysOverdue: daysBetween(r.periodEnd),
    }));

  const monthlyRows: OverdueReport[] = overdueMonthlies
    .filter((r) => {
      if (!visible.has(r.projectId) || DELIVERED.has(r.status)) return false;
      const month = r.reportingMonth ?? "";
      if (!month) return false;
      const [y, m] = month.split("-").map(Number);
      const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      return end < today;
    })
    .map((r) => {
      const [y, m] = r.reportingMonth.split("-").map(Number);
      const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      return {
        projectId: r.projectId,
        reportType: "monthly" as const,
        reportNumber: r.reportNumber,
        period: r.reportingMonth,
        status: r.status,
        preparedByContactId: r.preparedByContactId,
        daysOverdue: daysBetween(end),
      };
    });

  return [...weeklyRows, ...monthlyRows].sort((a, b) => b.daysOverdue - a.daysOverdue);
}

/* ---------------------------------- Series --------------------------------- */

export interface TrendPoint {
  label: string;
  planned?: number;
  actual?: number;
  variance?: number;
}

/**
 * Schedule variance over the last reporting weeks.
 *
 * Built from actual Weekly reports; a week with no report is skipped rather
 * than plotted as a zero, which would draw a recovery that never happened.
 */
export function varianceTrend(
  weeklies: DashboardWeeklyReportSummary[],
  projectIds: Set<string>,
  limit = 8
): TrendPoint[] {
  const scoped = weeklies.filter((report) => projectIds.has(report.projectId));
  const byWeek = new Map<string, DashboardWeeklyReportSummary[]>();
  for (const report of scoped) {
    const list = byWeek.get(report.periodEnd) ?? [];
    list.push(report);
    byWeek.set(report.periodEnd, list);
  }

  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-limit)
    .map(([periodEnd, reports]) => {
      const planned = reports.reduce((s, r) => s + r.plannedProgress, 0) / reports.length;
      const actual = reports.reduce((s, r) => s + r.actualProgress, 0) / reports.length;
      return {
        label: new Date(`${periodEnd}T00:00:00`).toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
        }),
        planned: round(planned),
        actual: round(actual),
        variance: round(actual - planned),
      };
    });
}

export function round(value: number): number {
  return Math.round(value * 10) / 10;
}

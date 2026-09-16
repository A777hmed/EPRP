"use client";

/**
 * Dashboard data — real records only.
 *
 * The Dashboard previously rendered entirely from `@/data/mock`: every KPI,
 * every chart and every panel was invented. This module replaces that with the
 * platform's own data and derives nothing it cannot source.
 *
 * BASIS. The Dashboard is the OPERATIONAL control centre, so it reads the
 * project's CURRENT position: Planning Integration 3D made a project's own
 * latest published Planning Snapshot the PRIMARY source when its rollup is
 * usable (both Planned and Actual present) — governed, and independent of
 * any Weekly/Monthly report's own pinned snapshot. Absent a usable
 * snapshot, this falls back to the latest Weekly report per project — Weekly
 * is the operational entry tier (`03_REPORTING_ARCHITECTURE.md` Law 1) —
 * then Monthly. That is deliberately a different question from the
 * Executive Report, which compiles APPROVED MONTHLY data only. The two are
 * not in conflict and must not be conflated: this view says "where things
 * stand now", the Executive Report says "what was formally reported".
 * Every figure here carries that basis in its caption so a reader cannot
 * mistake one for the other.
 *
 * ABSENCE IS NEVER ZERO. A project with no report contributes to no average and
 * is counted as Not Reported, rather than being folded in as 0% and dragging
 * the portfolio down (§7.3).
 */

import * as React from "react";

import { useCurrentIdentity } from "@/features/auth/use-current-identity";
import { isoDate, todayIso } from "@/features/calendar/calendar-types";
import { useMasterData } from "@/features/master-data";
import { projectService } from "@/services/project-service";
import { weeklyReportService } from "@/services/weekly-report-service";
import { monthlyReportService } from "@/services/monthly-report-service";
import { milestoneService } from "@/services/milestone-service";
import { planningRollupService, type PlanningSnapshotRollup } from "@/services/planning-rollup-service";
import { milestoneStates as deriveMilestoneStates, type MilestoneState } from "@/features/projects/milestone-state";
import { deriveDashboardPlanningFigures } from "./planning-integration";
import type {
  Client,
  Contact,
  Department,
  MonthlyReport,
  Project,
  WeeklyReport,
} from "@/types";

export type TimePeriod = "this_week" | "this_month" | "quarter" | "all";

export const TIME_PERIOD_LABEL: Record<TimePeriod, string> = {
  this_week: "This Week",
  this_month: "This Month",
  quarter: "This Quarter",
  all: "All Time",
};

export interface DashboardFilters {
  projectId: string;
  departmentId: string;
  period: TimePeriod;
}

export const EMPTY_DASHBOARD_FILTERS: DashboardFilters = {
  projectId: "",
  departmentId: "",
  period: "this_month",
};

/* ------------------------------- Milestones -------------------------------- */

export interface DashboardMilestone {
  id: string;
  projectId: string;
  projectName: string;
  departmentId?: string;
  title: string;
  dueDate: string;
  status: string;
  /** Present only where the source records one; never invented. */
  percentComplete?: number;
  /**
   * Planning Integration 3D: sourced from the governed `master_milestones`
   * register (via `milestoneService.listRegister` + `milestoneStates`), the
   * SAME derivation Master Planning, Weekly, Monthly and Executive read —
   * never `weekly_plan_items`/`monthly_plan_items`. Those report-scoped plan
   * tables are a department's own next-week/next-month notes, not the
   * project's milestone register, and are deliberately not read here so the
   * Dashboard cannot present a second, competing milestone source.
   */
  source: { kind: "master"; milestoneId: string; href: string };
}

/** The 4 statuses `MilestoneStatus` (the governed register) actually allows.
    Kept separate from the Milestone Modal's own identical categorization —
    duplicated intentionally so panel-preview work here can never change
    modal behavior. */
export type MilestoneStatusBucket = "not_started" | "in_progress" | "delayed" | "completed";

export function milestoneStatusBucket(status: string): MilestoneStatusBucket {
  if (status === "completed" || status === "done") return "completed";
  if (status === "delayed" || status === "at_risk") return "delayed";
  if (status === "in_progress") return "in_progress";
  return "not_started";
}

const ATTENTION_ORDER: Record<MilestoneStatusBucket, number> = {
  delayed: 0,
  in_progress: 1,
  not_started: 2,
  completed: 3,
};

/**
 * Worst-status-first, then nearest due date — how the Dashboard's compact,
 * fixed-size milestone previews decide what to surface first when there is
 * more in scope than the card can show. The Milestone Modal keeps its own
 * separate plain date order; nothing here changes it.
 */
export function compareMilestonesByAttention(a: DashboardMilestone, b: DashboardMilestone): number {
  const diff =
    ATTENTION_ORDER[milestoneStatusBucket(a.status)] - ATTENTION_ORDER[milestoneStatusBucket(b.status)];
  return diff !== 0 ? diff : a.dueDate.localeCompare(b.dueDate);
}

export function sortMilestonesByAttention(milestones: DashboardMilestone[]): DashboardMilestone[] {
  return [...milestones].sort(compareMilestonesByAttention);
}

/* --------------------------------- Loading --------------------------------- */

export interface DashboardData {
  loading: boolean;
  error?: string;
  projects: Project[];
  departments: Department[];
  contacts: Contact[];
  clients: Client[];
  weeklies: WeeklyReport[];
  monthlies: MonthlyReport[];
  milestones: DashboardMilestone[];
  /**
   * Each visible project's LATEST published Planning Snapshot rollup — 3D's
   * current-position source. `null` means the project has no published
   * snapshot yet (or its rollup fetch failed); absent from the map only
   * before the fetch has completed. Never a Weekly/Monthly report's pinned
   * snapshot — the Dashboard always asks Planning for "latest", not a
   * historical pin (see `features/dashboard/planning-integration.ts`).
   */
  planningRollups: Map<string, PlanningSnapshotRollup | null>;
  reload: () => Promise<void>;
}

export function useDashboardData(): DashboardData {
  const { records: departmentRecords } = useMasterData("department");
  const { records: contactRecords } = useMasterData("contact");
  const { records: clientRecords } = useMasterData("client");
  const identity = useCurrentIdentity();

  const [projects, setProjects] = React.useState<Project[]>([]);
  const [weeklies, setWeeklies] = React.useState<WeeklyReport[]>([]);
  const [monthlies, setMonthlies] = React.useState<MonthlyReport[]>([]);
  const [milestones, setMilestones] = React.useState<DashboardMilestone[]>([]);
  const [planningRollups, setPlanningRollups] = React.useState<
    Map<string, PlanningSnapshotRollup | null>
  >(new Map());
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string>();

  /* Same shape as `use-executive-portfolio`: the fetch lives inside the effect
     with a cancel guard, and reload is a token bump. */
  const [reloadToken, setReloadToken] = React.useState(0);
  const reload = React.useCallback(async () => {
    setReloadToken((token) => token + 1);
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    const run = async () => {
      /*
       * Scope is part of the question, not a filter applied afterwards. Loading
       * before the identity settles would compute a portfolio for "nobody" and
       * paint an empty dashboard that then re-populated — so hold the loading
       * state until it is known. The effect re-runs when it resolves.
       */
      if (!identity.resolved) return;
      setLoading(true);
      setError(undefined);
      try {
        const [allProjects, weeklyList, monthlyList] = await Promise.all([
          projectService.getProjects(),
          weeklyReportService.list(),
          monthlyReportService.list(),
        ]);
        if (cancelled) return;

        /*
         * ONE PROJECT UNIVERSE, DECIDED IN ONE PLACE.
         *
         * This used to re-filter the list in React, because `projects_select`
         * was `USING (true)` and handed every project to every reader — so the
         * Dashboard showed one project while the Projects register showed five,
         * and a Department User was told "0 of 5 reporting coverage" about four
         * projects that were not theirs.
         *
         * `projects_select` is now `can_access_project(id)`, so the query
         * itself returns exactly the reader's projects. Filtering again here
         * would be a second implementation of the rule that could drift from
         * the first — the defect this whole pass exists to remove. The
         * Dashboard, the Projects register, every project picker and every
         * report loader now get their universe from the same place.
         *
         * "Absence is never zero" (§7.3) is unaffected: a project with no
         * report still contributes to no average and counts as Not Reported.
         */
        const projectList = allProjects;

        setProjects(projectList);
        setWeeklies(weeklyList);
        setMonthlies(monthlyList);

        /*
         * Milestones and Planning rollups both need the project id list, so
         * they run in a second wave rather than the first. Each project's
         * own fetch is isolated (`.catch(() => null)` / per-project
         * settlement) so one project's Planning read failing, or the
         * milestone register being briefly unavailable, cannot blank the
         * whole Dashboard.
         */
        const [milestoneList, rollupEntries] = await Promise.all([
          loadGovernedMilestones(projectList),
          Promise.all(
            projectList.map(async (project) => {
              try {
                const latest = await planningRollupService.getLatestPublishedSnapshot(project.id);
                const rollup = latest
                  ? await planningRollupService.computeSnapshotRollup(latest.id)
                  : null;
                return [project.id, rollup] as const;
              } catch {
                return [project.id, null] as const;
              }
            })
          ),
        ]);
        if (cancelled) return;

        setMilestones(milestoneList);
        setPlanningRollups(new Map(rollupEntries));
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load dashboard data.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [reloadToken, identity]);

  return {
    loading,
    error,
    projects,
    departments: departmentRecords as Department[],
    contacts: contactRecords as Contact[],
    clients: clientRecords as Client[],
    weeklies,
    monthlies,
    milestones,
    planningRollups,
    reload,
  };
}

/**
 * One governed milestone's row, or `null` when it has no determinable due
 * date or that date is not upcoming — the pure decision `loadGovernedMilestones`
 * applies per milestone, split out so it is directly unit-testable without a
 * live `milestoneService` call.
 *
 * "Due date" prefers the milestone's current APPROVED forecast (the latest
 * re-plan Project Control has accepted) and falls back to the milestone's
 * own `plannedDate` (the agreed date) only when nothing has been forecast
 * yet — never invented, and never a mix of the two for the same row.
 */
export function governedMilestoneRow(
  state: MilestoneState,
  today: string,
  projectName: string
): DashboardMilestone | null {
  const dueDate = state.forecastDate ?? state.milestone.plannedDate;
  if (!dueDate || dueDate < today) return null;
  return {
    id: state.milestone.id,
    projectId: state.milestone.projectId,
    projectName,
    departmentId: state.milestone.departmentId,
    title: state.milestone.name,
    dueDate,
    status: state.status,
    percentComplete: state.progressPercent,
    source: {
      kind: "master",
      milestoneId: state.milestone.id,
      href: `/projects/${state.milestone.projectId}/milestones`,
    },
  };
}

/**
 * Upcoming milestones from the governed `master_milestones` register
 * (Planning Integration 3D).
 *
 * Reads `milestoneService.listRegister` + `milestoneStates` — the SAME
 * register and derivation Master Planning, Weekly, Monthly and Executive
 * read. Previously this read `weekly_plan_items`/`monthly_plan_items`
 * directly: a department's own next-week/next-month notes, not the
 * project's milestone register, so the Dashboard was presenting a second,
 * uncoordinated milestone source that could name a date the governed
 * register never agreed to. That source is retired outright, not kept as a
 * fallback — a project's real milestones now come from exactly one place.
 */
async function loadGovernedMilestones(projects: Project[]): Promise<DashboardMilestone[]> {
  const today = todayIso();
  const nameOf = (id: string) => projects.find((project) => project.id === id)?.name ?? "Project";

  const { milestones, updates } = await milestoneService.listRegister(projects.map((p) => p.id));
  const states = deriveMilestoneStates(milestones, updates);

  const out: DashboardMilestone[] = [];
  for (const state of states) {
    const row = governedMilestoneRow(state, today, nameOf(state.milestone.projectId));
    if (row) out.push(row);
  }

  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/* -------------------------------- Derivation ------------------------------- */

const DELIVERED = new Set(["approved", "finalized", "locked", "archived"]);

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

export interface ProjectPosition {
  project: Project;
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
  reportedOn?: string;
  health: "on_track" | "at_risk" | "behind" | "critical" | "not_reported";

  /* ------------------------- Planning Integration 3D --------------------- */
  /** EV/PV. `null` only when Planning-backed and value data is unavailable
      (or Planned Value <= 0) — never a fabricated ratio. Absent (not even
      `null`) when `basis !== "planning"`. */
  spi?: number | null;
  /** Share of the schedule's weight the rollup actually speaks for. */
  coveragePercent?: number;
  /** The latest published snapshot's version, when `basis === "planning"`. */
  snapshotVersion?: number;
  /** The latest published snapshot's Data Date, when `basis === "planning"`. */
  dataDate?: string;
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
 * Each project's CURRENT position.
 *
 * Planning Integration 3D, "current position rule": when the project's
 * LATEST published Planning Snapshot has a usable rollup (both a Planned
 * and an Actual figure), that governs — Planned, Actual, Variance and SPI
 * all come from that ONE rollup, never mixed with a manual figure, and this
 * reading is NOT scoped by the period filter, because the Dashboard's
 * Planning position is "where the project stands today", not "what was
 * reported in this window". An unusable latest snapshot (or none at all)
 * falls back to the existing Weekly/Monthly behaviour untouched: Weekly
 * first (the operational tier, period-scoped), Monthly as fallback for a
 * project that reports only monthly. A project with none of the three is
 * `not_reported` and is left out of every average.
 */
export function positionsFor(
  projects: Project[],
  weeklies: WeeklyReport[],
  monthlies: MonthlyReport[],
  period: TimePeriod,
  planningRollups?: Map<string, PlanningSnapshotRollup | null>
): ProjectPosition[] {
  const { from, to } = periodWindow(period);
  const inWindow = (date: string) => (!from || date >= from) && (!to || date <= to);

  return projects.map((project) => {
    const figures = deriveDashboardPlanningFigures(planningRollups?.get(project.id));
    if (figures.planningBacked) {
      return {
        project,
        planned: figures.plannedProgress!,
        actual: figures.actualProgress!,
        variance: figures.variance ?? undefined,
        basis: "planning",
        reportedOn: figures.dataDate,
        health: healthOf(figures.variance ?? undefined),
        spi: figures.spi,
        coveragePercent: figures.coveragePercent,
        snapshotVersion: figures.snapshotVersion,
        dataDate: figures.dataDate,
      };
    }

    const weekly = weeklies
      .filter((report) => report.projectId === project.id && inWindow(report.periodEnd))
      .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];

    const monthly = monthlies
      .filter((report) => report.projectId === project.id)
      .sort((a, b) => (b.reportingMonth ?? "").localeCompare(a.reportingMonth ?? ""))[0];

    if (weekly) {
      const variance = weekly.actualProgress - weekly.plannedProgress;
      return {
        project,
        planned: weekly.plannedProgress,
        actual: weekly.actualProgress,
        variance,
        basis: "weekly",
        reportedOn: weekly.periodEnd,
        health: healthOf(variance),
      };
    }

    if (monthly && monthly.plannedProgress !== undefined && monthly.actualProgress !== undefined) {
      const variance = monthly.actualProgress - monthly.plannedProgress;
      return {
        project,
        planned: monthly.plannedProgress,
        actual: monthly.actualProgress,
        variance,
        basis: "monthly",
        reportedOn: monthly.reportingMonth,
        health: healthOf(variance),
      };
    }

    return { project, basis: "none", health: "not_reported" };
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
  notReported: number;
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
  weeklies: WeeklyReport[],
  monthlies: MonthlyReport[],
  today = todayIso()
): PortfolioTotals {
  const reported = positions.filter((p) => p.planned !== undefined && p.actual !== undefined);
  const mean = (values: number[]) =>
    values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : undefined;

  const planned = mean(reported.map((p) => p.planned as number));
  const actual = mean(reported.map((p) => p.actual as number));

  const visible = new Set(positions.map((p) => p.project.id));
  const overdueWeekly = weeklies.filter(
    (r) => visible.has(r.projectId) && !DELIVERED.has(r.status) && r.periodEnd < today
  ).length;
  const overdueMonthly = monthlies.filter((r) => {
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
    notReported: positions.filter((p) => p.health === "not_reported").length,
    overdueReports: overdueWeekly + overdueMonthly,
  };
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
  weeklies: WeeklyReport[],
  projectIds: Set<string>,
  limit = 8
): TrendPoint[] {
  const scoped = weeklies.filter((report) => projectIds.has(report.projectId));
  const byWeek = new Map<string, WeeklyReport[]>();
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

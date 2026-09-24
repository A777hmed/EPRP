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
import { todayIso } from "@/features/calendar/calendar-types";
import { useMasterData } from "@/features/master-data";
import {
  fetchDashboardMasterMilestones,
  fetchDashboardMilestoneUpdates,
  fetchDashboardMonthlyOverdueReports,
  fetchDashboardMonthlyReportSummaries,
  fetchDashboardPlanningRollups,
  fetchDashboardProjects,
  fetchDashboardWeeklyOverdueReports,
  fetchDashboardWeeklyReportSummaries,
  type DashboardMonthlyReportSummary,
  type DashboardProjectSummary,
  type DashboardWeeklyReportSummary,
} from "@/services/dashboard-read-model";
import type { PlanningSnapshotRollup } from "@/services/planning-rollup-service";
import { milestoneStates as deriveMilestoneStates, type MilestoneState } from "@/features/projects/milestone-state";
import { dashboardProjectScope } from "./dashboard-project-scope";
import type { Client, Contact, Department, MasterMilestone, MilestoneUpdate } from "@/types";
import type { TimePeriod } from "./dashboard-positions";

export {
  BASIS_LABEL,
  HEALTH_META,
  PORTFOLIO_BASIS_NOTE,
  TIME_PERIOD_LABEL,
  healthOf,
  overdueReports,
  periodWindow,
  positionStatusLabel,
  positionsFor,
  round,
  totalsFor,
  varianceTrend,
  type OverdueReport,
  type PortfolioTotals,
  type ProjectPosition,
  type ProjectReportingStatus,
  type TimePeriod,
  type TrendPoint,
} from "./dashboard-positions";

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
  projects: DashboardProjectSummary[];
  departments: Department[];
  contacts: Contact[];
  clients: Client[];
  weeklies: DashboardWeeklyReportSummary[];
  monthlies: DashboardMonthlyReportSummary[];
  /**
   * EVERY not-yet-delivered, period-passed Weekly/Monthly report,
   * unbounded — the separate fetch that exists so an old stuck report is
   * never silently excluded by `weeklies`/`monthlies`' own 12-per-project
   * window. Feeds `totalsFor()`'s overdue count and `overdueReports()`'s
   * list; never used for current position or the trend chart.
   */
  overdueWeeklies: DashboardWeeklyReportSummary[];
  overdueMonthlies: DashboardMonthlyReportSummary[];
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

  const [projects, setProjects] = React.useState<DashboardProjectSummary[]>([]);
  const [weeklies, setWeeklies] = React.useState<DashboardWeeklyReportSummary[]>([]);
  const [monthlies, setMonthlies] = React.useState<DashboardMonthlyReportSummary[]>([]);
  const [overdueWeeklies, setOverdueWeeklies] = React.useState<DashboardWeeklyReportSummary[]>([]);
  const [overdueMonthlies, setOverdueMonthlies] = React.useState<DashboardMonthlyReportSummary[]>([]);
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
        /*
         * Access & Visibility hotfix — the Dashboard's own read model
         * (`@/services/dashboard-read-model`), NOT `projectService.
         * getProjects()` / `weeklyReportService.list()` / `monthlyReportService.
         * list()` / `milestoneService.listRegister()` / `planningRollupService`
         * directly. Every authenticated user sees the current active
         * portfolio's governed KPIs (Planned/Actual/Variance, schedule health,
         * milestones, reporting coverage), read-only, regardless of assigned
         * projects — via narrow, explicit-column, bounded-where-sensible,
         * platform-wide functions. The plain reads these mirror stay
         * assignment/portfolio-grant-gated for every other caller (Project
         * Setup, the Reporting registers and workspaces, Executive
         * drill-downs, Master Planning). See `dashboard-read-model.ts` and
         * its migration for the full rationale, every excluded column and
         * why, and what remains deliberately out of scope (the historical
         * Progress Curve and Activity Depth/Coverage Detail drill-downs,
         * still assignment-gated via `planningRollupService`/
         * `planningService` directly, unchanged).
         */
        const [
          allProjects,
          allWeeklies,
          allMonthlies,
          allOverdueWeeklies,
          allOverdueMonthlies,
          allMilestones,
          allMilestoneUpdates,
          allRollups,
        ] = await Promise.all([
          fetchDashboardProjects(),
          fetchDashboardWeeklyReportSummaries(),
          fetchDashboardMonthlyReportSummaries(),
          fetchDashboardWeeklyOverdueReports(),
          fetchDashboardMonthlyOverdueReports(),
          fetchDashboardMasterMilestones(),
          fetchDashboardMilestoneUpdates(),
          fetchDashboardPlanningRollups(),
        ]);
        if (cancelled) return;

        /*
         * ONE CURRENT-MANAGEMENT PROJECT UNIVERSE, DECIDED IN ONE PLACE.
         *
         * This used to re-filter the list in React, because `projects_select`
         * was `USING (true)` and handed every project to every reader — so the
         * Dashboard showed one project while the Projects register showed five,
         * and a Department User was told "0 of 5 reporting coverage" about four
         * projects that were not theirs.
         *
         * `projects_select` decides which projects the reader may access; it
         * deliberately includes archived records so the Projects register and
         * historical reports retain them. The Dashboard answers a narrower
         * current-management question, so its one additional lifecycle rule is
         * applied here before ANY project collection or calculation is built.
         *
         * "Absence is never zero" (§7.3) is unaffected: a project with no
         * report still contributes to no average and counts as Not Reported.
         */
        const projectList = dashboardProjectScope(allProjects);
        const projectIds = new Set(projectList.map((project) => project.id));
        const weeklyList = allWeeklies.filter((report) => projectIds.has(report.projectId));
        const monthlyList = allMonthlies.filter((report) => projectIds.has(report.projectId));
        const overdueWeeklyList = allOverdueWeeklies.filter((report) => projectIds.has(report.projectId));
        const overdueMonthlyList = allOverdueMonthlies.filter((report) => projectIds.has(report.projectId));
        const milestoneRows = allMilestones.filter((milestone) => projectIds.has(milestone.projectId));

        setProjects(projectList);
        setWeeklies(weeklyList);
        setMonthlies(monthlyList);
        setOverdueWeeklies(overdueWeeklyList);
        setOverdueMonthlies(overdueMonthlyList);
        setMilestones(loadGovernedMilestones(projectList, milestoneRows, allMilestoneUpdates));
        setPlanningRollups(
          new Map(projectList.map((project) => [project.id, allRollups.get(project.id) ?? null]))
        );
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
    overdueWeeklies,
    overdueMonthlies,
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
 * Fed by `fetchDashboardMasterMilestones()` / `fetchDashboardMilestoneUpdates()`
 * (`@/services/dashboard-read-model` — Access & Visibility hotfix,
 * platform-wide, approved-updates-only) and `milestoneStates()` — the SAME
 * derivation Master Planning, Weekly, Monthly and Executive read. Pure and
 * synchronous now: the fetch happens once, in the main `Promise.all` wave
 * above, rather than this function issuing its own request — the same
 * reason `positionsFor()`/`totalsFor()` take already-loaded arrays instead
 * of fetching. Previously this read `weekly_plan_items`/`monthly_plan_items`
 * directly: a department's own next-week/next-month notes, not the
 * project's milestone register, so the Dashboard was presenting a second,
 * uncoordinated milestone source that could name a date the governed
 * register never agreed to. That source is retired outright, not kept as a
 * fallback — a project's real milestones now come from exactly one place.
 */
function loadGovernedMilestones(
  projects: DashboardProjectSummary[],
  milestones: MasterMilestone[],
  updates: MilestoneUpdate[]
): DashboardMilestone[] {
  const today = todayIso();
  const nameOf = (id: string) => projects.find((project) => project.id === id)?.name ?? "Project";

  const states = deriveMilestoneStates(milestones, updates);

  const out: DashboardMilestone[] = [];
  for (const state of states) {
    const row = governedMilestoneRow(state, today, nameOf(state.milestone.projectId));
    if (row) out.push(row);
  }

  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

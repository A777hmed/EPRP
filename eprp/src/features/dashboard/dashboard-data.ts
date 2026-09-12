"use client";

/**
 * Dashboard data — real records only.
 *
 * The Dashboard previously rendered entirely from `@/data/mock`: every KPI,
 * every chart and every panel was invented. This module replaces that with the
 * platform's own data and derives nothing it cannot source.
 *
 * BASIS. The Dashboard is the OPERATIONAL control centre, so it reads the
 * latest Weekly report per project — Weekly is the only entry tier and the
 * operational source of truth (`03_REPORTING_ARCHITECTURE.md` Law 1). That is
 * deliberately a different question from the Executive Report, which compiles
 * APPROVED MONTHLY data only. The two are not in conflict and must not be
 * conflated: this view says "where things stand now", the Executive Report says
 * "what was formally reported". Every figure here carries that basis in its
 * caption so a reader cannot mistake one for the other.
 *
 * ABSENCE IS NEVER ZERO. A project with no report contributes to no average and
 * is counted as Not Reported, rather than being folded in as 0% and dragging
 * the portfolio down (§7.3).
 */

import * as React from "react";

import { useCurrentIdentity } from "@/features/auth/use-current-identity";
import { isoDate, todayIso } from "@/features/calendar/calendar-types";
import { useMasterData } from "@/features/master-data";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { projectService } from "@/services/project-service";
import { weeklyReportService } from "@/services/weekly-report-service";
import { monthlyReportService } from "@/services/monthly-report-service";
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
  /** The Weekly or Monthly report this plan item was raised against — every
      milestone's only source record besides the project's own register. */
  source: { kind: "weekly" | "monthly"; reportId: string; href: string };
}

/** The 4 statuses the schema actually allows across both plan-item tables.
    Anything else (a legacy value, or monthly's extra 'pending') falls into
    Not Started rather than being invented a bucket of its own. Kept separate
    from the Milestone Modal's own identical categorization — duplicated
    intentionally so panel-preview work here can never change modal
    behavior. */
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

interface PlanRow {
  id: string;
  title: string;
  status: string | null;
  department_id: string | null;
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
         * `loadUpcomingMilestones` used to be awaited AFTER this block, as a
         * second sequential stage. Its two queries do not depend on the
         * project list at all — they read `weekly_plan_items` /
         * `monthly_plan_items` directly, and the list is used only to put a
         * NAME on each row afterwards. So it belongs in the same wave, and
         * the naming pass moves below where the list is known.
         */
        const [allProjects, weeklyList, monthlyList, upcoming] =
          await Promise.all([
            projectService.getProjects(),
            weeklyReportService.list(),
            monthlyReportService.list(),
            loadUpcomingMilestones(),
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

        // Names resolved now that the project list is known — the rows
        // themselves were already fetched in the wave above.
        const nameOf = (id: string) =>
          projectList.find((project) => project.id === id)?.name ?? "Project";
        setMilestones(
          upcoming.map((milestone) => ({
            ...milestone,
            projectName: nameOf(milestone.projectId),
          }))
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
    milestones,
    reload,
  };
}

/**
 * Upcoming milestones from the Weekly and Monthly plans.
 *
 * Queried directly rather than through the report services, which expose plan
 * items one report at a time — rendering the panel would otherwise cost a round
 * trip per report. RLS still applies, so a reader sees only their own projects.
 */
async function loadUpcomingMilestones(): Promise<DashboardMilestone[]> {
  const client = getSupabaseBrowserClient();
  const today = todayIso();
  /* `projectName` is filled in by the caller once the project list is known —
     this function no longer waits for it, so both can be fetched at once.
     The placeholder below is always replaced before the rows are rendered. */
  const nameOf = () => "Project";

  const [weekly, monthly] = await Promise.all([
    client
      .from("weekly_plan_items")
      .select("id, title, end_date, status, department_id, weekly_reports!inner(id, project_id)")
      .eq("kind", "milestone")
      .gte("end_date", today)
      .order("end_date", { ascending: true })
      .limit(40),
    client
      .from("monthly_plan_items")
      .select("id, title, target_date, status, department_id, monthly_reports!inner(id, project_id)")
      .not("target_date", "is", null)
      .gte("target_date", today)
      .order("target_date", { ascending: true })
      .limit(40),
  ]);

  const out: DashboardMilestone[] = [];

  type WeeklyRow = PlanRow & { end_date: string; weekly_reports: { id: string; project_id: string } | null };
  type MonthlyRow = PlanRow & { target_date: string; monthly_reports: { id: string; project_id: string } | null };

  for (const row of (weekly.data ?? []) as unknown as WeeklyRow[]) {
    if (!row.weekly_reports) continue;
    out.push({
      id: `w-${row.id}`,
      projectId: row.weekly_reports.project_id,
      projectName: nameOf(),
      departmentId: row.department_id ?? undefined,
      title: row.title,
      dueDate: row.end_date,
      status: row.status ?? "not_started",
      source: {
        kind: "weekly",
        reportId: row.weekly_reports.id,
        href: `/weekly-reports/${row.weekly_reports.id}`,
      },
    });
  }

  for (const row of (monthly.data ?? []) as unknown as MonthlyRow[]) {
    if (!row.monthly_reports || !row.target_date) continue;
    out.push({
      id: `m-${row.id}`,
      projectId: row.monthly_reports.project_id,
      projectName: nameOf(),
      departmentId: row.department_id ?? undefined,
      title: row.title,
      dueDate: row.target_date,
      status: row.status ?? "not_started",
      source: {
        kind: "monthly",
        reportId: row.monthly_reports.id,
        href: `/monthly-reports/${row.monthly_reports.id}`,
      },
    });
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
  /** Which record the figures came from, so a caption can state it. */
  basis: "weekly" | "monthly" | "none";
  reportedOn?: string;
  health: "on_track" | "at_risk" | "behind" | "critical" | "not_reported";
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

/**
 * Each project's current position, from its latest report inside the window.
 *
 * Weekly first (the operational tier), Monthly as fallback for a project that
 * reports only monthly. A project with neither is `not_reported` and is left
 * out of every average.
 */
export function positionsFor(
  projects: Project[],
  weeklies: WeeklyReport[],
  monthlies: MonthlyReport[],
  period: TimePeriod
): ProjectPosition[] {
  const { from, to } = periodWindow(period);
  const inWindow = (date: string) => (!from || date >= from) && (!to || date <= to);

  return projects.map((project) => {
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

/** Unweighted means over REPORTED projects only — absence is never zero. */
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

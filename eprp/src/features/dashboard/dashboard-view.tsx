"use client";

/**
 * The EPR Control Center.
 *
 * ONE connected workspace: the Project / Department / Period controls in the
 * header drive every KPI, chart, list and the calendar beneath them. Selecting
 * a project narrows the whole page; All Projects restores the portfolio view.
 * Nothing is fetched per-panel, so the page cannot show a KPI from one scope
 * beside a chart from another.
 *
 * THE COMPOSITION IS THREE PROPORTIONAL ROWS, not a uniform card grid:
 *
 *   header    title and scope controls, on the canvas rather than in a card
 *   KPI row   five blocks, each carrying a different mark
 *   main      44 / 28 / 28  — progress comparison, distribution, polar comparison
 *   lower     25 / 42 / 33  — milestone bars + variance, schedule, queues
 *
 * The lower row is top-aligned on purpose: the calendar takes its natural
 * height instead of stretching to whichever column happens to be tallest.
 */

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  CalendarPlus,
  CircleCheck,
  ClipboardList,
  FileBarChart,
  FilePlus2,
  Flag,
  RefreshCw,
  Upload,
} from "lucide-react";

import { EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarPreview } from "@/features/calendar";
import { todayIso } from "@/features/calendar/calendar-types";
import { useMasterData } from "@/features/master-data";
import type { ProjectPhase } from "@/types";
import {
  HealthPanel,
  KpiStrip,
  MilestonePanel,
  ProgressByProjectPanel,
  StatusPanel,
  useReducedMotion,
  type HealthAxis,
} from "./dashboard-analytics";
import { MilestoneModal } from "./milestone-modal";
import { ProjectProgressComparisonPanel } from "./components/progress-comparison-panel";
import { ExpandedProgressCurveModal } from "./components/progress-curve-modal";
import { SummaryDetailModal, type SummaryModalKind } from "./components/summary-modals";
import { ProjectWorkspace, type ProjectWorkspaceSelection, type WorkspaceTab } from "./components/project-workspace";
import { usePlanningProgressCurve, usePortfolioProgressCurve } from "./use-planning-progress-curve";
import {
  BASIS_LABEL,
  EMPTY_DASHBOARD_FILTERS,
  HEALTH_META,
  PORTFOLIO_BASIS_NOTE,
  TIME_PERIOD_LABEL,
  positionsFor,
  round,
  totalsFor,
  useDashboardData,
  type DashboardFilters,
  type DashboardMilestone,
  type ProjectPosition,
  type TimePeriod,
} from "./dashboard-data";

const PERIODS: TimePeriod[] = ["this_week", "this_month", "quarter", "all"];

export function DashboardView({ canManage }: { canManage: boolean }) {
  const data = useDashboardData();
  const [filters, setFilters] = React.useState<DashboardFilters>(EMPTY_DASHBOARD_FILTERS);
  const { records: projectPhaseRecords } = useMasterData("projectPhase");
  const projectPhases = projectPhaseRecords as ProjectPhase[];

  /* Scope first, then derive. Every panel below reads from these. */
  const scopedProjects = React.useMemo(
    () =>
      filters.projectId
        ? data.projects.filter((project) => project.id === filters.projectId)
        : data.projects,
    [data.projects, filters.projectId]
  );

  const positions = React.useMemo(
    () => positionsFor(scopedProjects, data.weeklies, data.monthlies, filters.period, data.planningRollups),
    [scopedProjects, data.weeklies, data.monthlies, filters.period, data.planningRollups]
  );

  const totals = React.useMemo(
    () => totalsFor(positions, data.overdueWeeklies, data.overdueMonthlies),
    [positions, data.overdueWeeklies, data.overdueMonthlies]
  );

  const scopedIds = React.useMemo(
    () => new Set(scopedProjects.map((project) => project.id)),
    [scopedProjects]
  );
  const dashboardProjectIds = React.useMemo(
    () => data.projects.map((project) => project.id),
    [data.projects]
  );

  const reduced = useReducedMotion();

  /*
   * Dashboard UX Part 1 (item 5/6): the Expanded Progress Analysis modal
   * shares ONE selection with the Comparison panel's "Expand" action, over
   * EVERY visible project — not only the Planning-backed ones. The default
   * selection still prefers a Planning-backed project (a real curve beats
   * an honest-but-empty one on first open); `planningCandidates` exists
   * only to pick that default.
   */
  const planningCandidates = React.useMemo(
    () => positions.filter((position) => position.basis === "planning"),
    [positions]
  );
  const [manualCurveProjectId, setManualCurveProjectId] = React.useState<string | null>(null);
  const curveProjectId =
    manualCurveProjectId && positions.some((p) => p.project.id === manualCurveProjectId)
      ? manualCurveProjectId
      : (planningCandidates[0]?.project.id ?? positions[0]?.project.id ?? "");
  const planningCurve = usePlanningProgressCurve(curveProjectId);
  const activeProjectIds = React.useMemo(() => positions.map((position) => position.project.id), [positions]);
  const portfolioTrend = usePortfolioProgressCurve(activeProjectIds);
  const [expandCurveOpen, setExpandCurveOpen] = React.useState(false);

  /* `milestones` (capped) still feeds the Milestones health axis below;
     `scopedMilestones` (uncapped) feeds the Milestone panels and modal, each
     of which does its own capping so their "+N more" counts stay accurate
     against everything in scope. */
  const scopedMilestones = React.useMemo(
    () =>
      data.milestones
        .filter((milestone) => scopedIds.has(milestone.projectId))
        .filter((milestone) => !filters.departmentId || milestone.departmentId === filters.departmentId),
    [data.milestones, scopedIds, filters.departmentId]
  );
  const milestones = React.useMemo(() => scopedMilestones.slice(0, 8), [scopedMilestones]);

  /* Derived ONCE and read by both the KPI caption and Reporting Exceptions, so
     the two can never disagree. */
  const overdue = React.useMemo(() => {
    const today = todayIso();
    /*
     * Access & Visibility hotfix — sourced from `data.overdueWeeklies`/
     * `data.overdueMonthlies` (the UNBOUNDED overdue-eligible fetch), not
     * `data.weeklies`/`data.monthlies` (the 12-per-project current-
     * position/trend window). An old stuck report outside that window must
     * still be counted here — the same reason `totalsFor()` above takes
     * the same two arrays.
     */
    return {
      weekly: data.overdueWeeklies.filter(
        (report) =>
          scopedIds.has(report.projectId) && report.periodEnd < today && !isDelivered(report.status)
      ).length,
      monthly: data.overdueMonthlies.filter(
        (report) =>
          scopedIds.has(report.projectId) &&
          !isDelivered(report.status) &&
          monthEnd(report.reportingMonth) < today
      ).length,
    };
  }, [data.overdueWeeklies, data.overdueMonthlies, scopedIds]);

  /*
   * Radar axes — every one a REAL ratio, none invented.
   *
   * An axis is included only when its input exists, so the polygon never dips
   * toward zero merely because a dataset is absent. Budget, Quality, Resource
   * and Risk axes are deliberately absent: the platform records none of them.
   *
   * Targets: Progress Attainment takes the plan's own figure; the compliance
   * ratios take 100%, which is their definitional goal (every project
   * reporting, nothing overdue, nothing late) rather than an assumed number.
   */
  const healthAxes = React.useMemo<HealthAxis[]>(() => {
    const axes: HealthAxis[] = [];
    const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

    if (totals.totalProjects) {
      axes.push({
        axis: "Schedule",
        current: pct(totals.onTrack, totals.totalProjects),
        target: 100,
        detail: `${totals.onTrack} of ${totals.totalProjects} projects on track`,
      });
      axes.push({
        axis: "Reporting",
        current: pct(totals.reportedProjects, totals.totalProjects),
        target: 100,
        detail: `${totals.reportedProjects} of ${totals.totalProjects} projects have a basis`,
      });
    }

    if (totals.actual !== undefined) {
      axes.push({
        axis: "Progress",
        current: Math.round(totals.actual),
        target: totals.planned === undefined ? 100 : Math.round(totals.planned),
        detail: `Actual ${round(totals.actual)}% against plan`,
      });
    }

    /*
     * `scopedReports` is the recent-window count (`data.weeklies`/
     * `data.monthlies`, 12 per project); `late` is the UNBOUNDED overdue
     * count (`overdue`, above). The two can only disagree in the edge case
     * of a project with more than 12 reports' worth of history sitting
     * overdue, so the denominator is widened to `late` when that happens —
     * never a >100%/negative "compliance" reading from a mismatched pair.
     */
    const late = overdue.weekly + overdue.monthly;
    const scopedReports = Math.max(
      late,
      data.weeklies.filter((r) => scopedIds.has(r.projectId)).length +
        data.monthlies.filter((r) => scopedIds.has(r.projectId)).length
    );
    if (scopedReports > 0) {
      axes.push({
        axis: "Compliance",
        current: pct(scopedReports - late, scopedReports),
        target: 100,
        detail: `${scopedReports - late} of ${scopedReports} reports not overdue`,
      });
    }

    if (milestones.length > 0) {
      const today = todayIso();
      const onTime = milestones.filter((m) => m.dueDate >= today).length;
      axes.push({
        axis: "Milestones",
        current: pct(onTime, milestones.length),
        target: 100,
        detail: `${onTime} of ${milestones.length} milestones still ahead of date`,
      });
    }

    return axes;
  }, [totals, data.weeklies, data.monthlies, scopedIds, overdue, milestones]);

  /*
   * Milestones stay on the Dashboard: "View All" and any row both open the
   * same in-page modal rather than navigating away. `undefined` selection
   * shows the list; a milestone id jumps straight to its detail.
   */
  const [milestoneModalOpen, setMilestoneModalOpen] = React.useState(false);
  const [milestoneModalSelection, setMilestoneModalSelection] = React.useState<string | undefined>();

  const openMilestoneList = () => {
    setMilestoneModalSelection(undefined);
    setMilestoneModalOpen(true);
  };
  const openMilestoneDetail = (milestoneId: string) => {
    setMilestoneModalSelection(milestoneId);
    setMilestoneModalOpen(true);
  };

  /*
   * Top summary-card quick detail (§A) — a compact CENTER modal, selection-
   * driven exactly like the Milestone modal above. Never the wide Project
   * Workspace: these five answer "what is behind this one portfolio
   * number", not "let me explore this project".
   */
  const [summaryModalKind, setSummaryModalKind] = React.useState<SummaryModalKind | null>(null);

  /*
   * The Project Workspace (§C/§D) — one selection drives one wide right-side
   * drawer with its own internal tabs. `open`/`close` never re-fetch
   * anything: the workspace reads the SAME `positions`/`scopedMilestones`/
   * `weeklies`/`monthlies` already computed for the rest of the page.
   */
  const [workspaceSelection, setWorkspaceSelection] = React.useState<ProjectWorkspaceSelection | null>(null);
  const openWorkspace = (projectId: string, tab?: WorkspaceTab) => setWorkspaceSelection({ projectId, tab });
  const openManagementWorkspace = (projectId: string) => openWorkspace(projectId, "management");

  if (data.loading) return <DashboardSkeleton />;
  if (data.error) {
    return <EmptyState title="Dashboard unavailable" description={data.error} icon={AlertTriangle} />;
  }

  return (
    <div className="dash-stage">
      {/* ------------------------------ Header ------------------------------- */}
      <header className="dash-top">
        <div className="dash-top-title">
          <h1>Dashboard</h1>
          <p>
            {filters.projectId
              ? "Single project view — every panel below is scoped to this project."
              : "Portfolio view across every project you have access to."}
          </p>
        </div>

        <div className="dash-top-controls">
          <select
            aria-label="Project"
            value={filters.projectId}
            onChange={(event) =>
              setFilters({ ...filters, projectId: event.target.value, departmentId: "" })
            }
          >
            <option value="">All Projects</option>
            {data.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Department"
            value={filters.departmentId}
            onChange={(event) => setFilters({ ...filters, departmentId: event.target.value })}
          >
            <option value="">All Departments</option>
            {data.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Time period"
            value={filters.period}
            onChange={(event) => setFilters({ ...filters, period: event.target.value as TimePeriod })}
          >
            {PERIODS.map((period) => (
              <option key={period} value={period}>
                {TIME_PERIOD_LABEL[period]}
              </option>
            ))}
          </select>

          <div className="dash-date">
            <span>{formatToday()}</span>
            <CalendarDays aria-hidden />
          </div>
          <button
            type="button"
            className="dash-refresh"
            aria-label="Refresh dashboard data"
            title="Refresh dashboard data"
            onClick={() => void data.reload()}
          >
            <RefreshCw aria-hidden />
          </button>
        </div>
      </header>

      {/* A utility strip, not a card — these leave the page rather than report
          on it, and they respect the write authority the routes enforce. */}
      <nav className="dash-shortcuts" aria-label="Quick actions">
        {canManage && <Shortcut href="/weekly-reports/new" icon={<FilePlus2 aria-hidden />} label="New Weekly" />}
        {canManage && <Shortcut href="/monthly-reports/new" icon={<FileBarChart aria-hidden />} label="New Monthly" />}
        {canManage && <Shortcut href="/calendar" icon={<CalendarPlus aria-hidden />} label="Event" />}
        <Shortcut href="/documents" icon={<Upload aria-hidden />} label="Documents" />
        <Shortcut href="/projects" icon={<ClipboardList aria-hidden />} label="Projects" />
        <Shortcut href="/executive-reports" icon={<ArrowUpRight aria-hidden />} label="Executive" />
      </nav>

      <KpiStrip totals={totals} onSelectCard={setSummaryModalKind} />

      <section className="dash-row dash-row-main">
        <ProjectProgressComparisonPanel positions={positions} onExpand={() => setExpandCurveOpen(true)} />
        <StatusPanel totals={totals} />
        <HealthPanel axes={healthAxes} />
      </section>

      <section className="dash-row dash-row-lower">
        <div className="dash-stack">
          <MilestonePanel
            milestones={scopedMilestones}
            singleProject={!!filters.projectId}
            onViewAll={openMilestoneList}
            onSelectMilestone={openMilestoneDetail}
          />
          <ProgressByProjectPanel positions={positions} onSelectProject={(projectId) => openWorkspace(projectId)} />
        </div>

        <CalendarPreview
          projectId={filters.projectId}
          departmentId={filters.departmentId}
          projectIds={dashboardProjectIds}
          canManage={canManage}
        />

        <div className="dash-stack">
          <ReportingExceptions
            weekly={overdue.weekly}
            monthly={overdue.monthly}
            notReported={totals.notReported}
          />
          <MilestonesUpcoming
            milestones={scopedMilestones}
            onViewAll={openMilestoneList}
            onSelectMilestone={openMilestoneDetail}
          />
          <ManagementAttention positions={positions} onSelectProject={openManagementWorkspace} />
        </div>
      </section>

      <MilestoneModal
        open={milestoneModalOpen}
        onOpenChange={setMilestoneModalOpen}
        milestones={scopedMilestones}
        groupByProject={!filters.projectId}
        scopeLabel={filters.projectId ? (scopedProjects[0]?.name ?? "Project") : "All Projects"}
        initialMilestoneId={milestoneModalSelection}
        departments={data.departments}
      />

      <SummaryDetailModal
        selection={summaryModalKind}
        onOpenChange={(open) => {
          if (!open) setSummaryModalKind(null);
        }}
        totals={totals}
        positions={positions}
        overdueWeeklies={data.overdueWeeklies}
        overdueMonthlies={data.overdueMonthlies}
        contacts={data.contacts}
        portfolioBasisNote={PORTFOLIO_BASIS_NOTE}
      />

      <ExpandedProgressCurveModal
        open={expandCurveOpen}
        onOpenChange={setExpandCurveOpen}
        candidates={positions}
        selectedProjectId={curveProjectId}
        onSelectProject={setManualCurveProjectId}
        curve={planningCurve}
        portfolioTrend={portfolioTrend}
        reduced={reduced}
      />

      <ProjectWorkspace
        selection={workspaceSelection}
        onOpenChange={(open) => {
          if (!open) setWorkspaceSelection(null);
        }}
        positions={positions}
        milestones={scopedMilestones}
        projectPhases={projectPhases}
        weeklies={data.weeklies}
        monthlies={data.monthlies}
        departments={data.departments}
        contacts={data.contacts}
      />
    </div>
  );
}

/* ------------------------------ Text panels -------------------------------- */

/**
 * These three stay TEXT LISTS, in three separate panels.
 *
 * They answer "what needs a person's attention", which is a reading task, not a
 * comparison task — charting them would bury three short, actionable sentences
 * inside three more canvases. They stay separate because they are three
 * different queues with three different destinations.
 */

function ReportingExceptions({
  weekly,
  monthly,
  notReported,
}: {
  weekly: number;
  monthly: number;
  notReported: number;
}) {
  const rows = [
    {
      href: "/weekly-reports",
      flagged: `${weekly} Weekly ${plural(weekly, "report")} overdue`,
      clear: "Weekly reporting is current",
      note: "Past period end, not approved",
      count: weekly,
    },
    {
      href: "/monthly-reports",
      flagged: `${monthly} Monthly ${plural(monthly, "report")} overdue`,
      clear: "Monthly reporting is current",
      note: "Past month end, not approved",
      count: monthly,
    },
    {
      href: "/projects",
      flagged: `${notReported} ${plural(notReported, "project")} not reporting`,
      clear: "Every project has a reporting basis",
      note: "No Weekly or Monthly in the period",
      count: notReported,
    },
  ];

  /*
   * No panel-level "View All": the three rows below point at three different
   * registers (Weekly, Monthly, Projects), so a single link here would only
   * ever cover one of them — that was the misleading `/weekly-reports`
   * default this replaces. Each row keeps its own correct destination.
   */
  return (
    <QueuePanel title="Reporting Exceptions">
      <ul className="dash-items">
        {rows.map((row) => (
          <li key={row.href}>
            <Link href={row.href}>
              {row.count ? (
                <AlertTriangle className="dash-item-icon is-danger" aria-hidden />
              ) : (
                <CircleCheck className="dash-item-icon is-success" aria-hidden />
              )}
              <span>
                <b>{row.count ? row.flagged : row.clear}</b>
                <small>{row.note}</small>
              </span>
              <em className={row.count ? "is-danger" : "is-success"}>{row.count ? "Overdue" : "Clear"}</em>
            </Link>
          </li>
        ))}
      </ul>
    </QueuePanel>
  );
}

function MilestonesUpcoming({
  milestones,
  onViewAll,
  onSelectMilestone,
}: {
  milestones: DashboardMilestone[];
  onViewAll: () => void;
  onSelectMilestone: (milestoneId: string) => void;
}) {
  const rows = milestones.slice(0, 3);
  const hidden = milestones.length - rows.length;
  return (
    <QueuePanel title="Milestones Upcoming" onAction={onViewAll}>
      {rows.length ? (
        <>
          <ul className="dash-items">
            {rows.map((milestone) => (
              <li key={milestone.id}>
                {/* Opens the same modal "View All" uses, not a page navigation
                    — a milestone stays a Dashboard reading, not a detour. */}
                <button type="button" onClick={() => onSelectMilestone(milestone.id)}>
                  <Flag className={`dash-item-icon ${dueTone(milestone.dueDate)}`} aria-hidden />
                  <span>
                    <b title={milestone.title}>{milestone.title}</b>
                    <small>{milestone.projectName}</small>
                  </span>
                  <em className={dueTone(milestone.dueDate)}>{relativeDate(milestone.dueDate)}</em>
                </button>
              </li>
            ))}
          </ul>
          {hidden > 0 && (
            <button type="button" className="dash-more-footer" onClick={onViewAll}>
              + {hidden} more upcoming
            </button>
          )}
        </>
      ) : (
        <p className="dash-note">No dated milestone is recorded ahead of today for this scope.</p>
      )}
    </QueuePanel>
  );
}

function ManagementAttention({
  positions,
  onSelectProject,
}: {
  positions: ProjectPosition[];
  /** Opens the Project Workspace straight to its Management tab (Top-Level
      5A1 correction, §D) — replaces the previous full-page navigation to
      `/projects/[id]`, so checking a flagged project no longer leaves the
      Dashboard. */
  onSelectProject: (projectId: string) => void;
}) {
  const flagged = positions
    .filter((position) => position.health !== "on_track")
    .sort((a, b) => (a.variance ?? 0) - (b.variance ?? 0))
    .slice(0, 3);

  return (
    <QueuePanel title="Management Attention" href="/projects">
      {flagged.length ? (
        <ul className="dash-items">
          {flagged.map((position) => {
            const tone = HEALTH_META[position.health].tone;
            return (
              <li key={position.project.id}>
                <button
                  type="button"
                  onClick={() => onSelectProject(position.project.id)}
                  aria-label={`Open ${position.project.name} in the Project Workspace`}
                >
                  <AlertTriangle className={`dash-item-icon is-${tone}`} aria-hidden />
                  <span>
                    <b>{position.project.name}</b>
                    <small>
                      {position.basis === "none"
                        ? position.reportingStatus === "pending_approval"
                          ? "Reported, awaiting approval"
                          : "No report in the selected period"
                        : `${BASIS_LABEL[position.basis]}${
                            position.reportedOn ? ` · ${position.reportedOn}` : ""
                          }`}
                    </small>
                  </span>
                  <em className={`is-${tone}`}>
                    {position.variance === undefined
                      ? HEALTH_META[position.health].label
                      : `${position.variance > 0 ? "+" : ""}${round(position.variance)}%`}
                  </em>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="dash-note is-clear">Every project in view is reporting and on track.</p>
      )}
    </QueuePanel>
  );
}

function QueuePanel({
  title,
  href,
  onAction,
  children,
}: {
  title: string;
  href?: string;
  /** Alternative to `href` for a "View All" that opens a drawer in-page. */
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="dash-panel dash-queue">
      <header>
        <div>
          <b>{title}</b>
        </div>
        {href ? (
          <Link href={href} className="dash-link">
            View All
          </Link>
        ) : (
          onAction && (
            <button type="button" className="dash-link" onClick={onAction}>
              View All
            </button>
          )
        )}
      </header>
      <div className="dash-panel-body">{children}</div>
    </section>
  );
}

/* -------------------------------- Fragments -------------------------------- */

function Shortcut({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Button asChild variant="ghost" className="dash-shortcut">
      <Link href={href}>
        {icon}
        {label}
      </Link>
    </Button>
  );
}

/** Mirrors the real composition, so the page does not reflow on first paint. */
function DashboardSkeleton() {
  return (
    <div className="dash-stage" aria-label="Loading dashboard" aria-busy="true">
      <div className="dash-top">
        <div className="dash-top-title">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="mt-2 h-3 w-72 max-w-full" />
        </div>
        <Skeleton className="h-8 w-[560px] max-w-full" />
      </div>
      <Skeleton className="h-6 w-[400px] max-w-full rounded-md" />
      <div className="dash-kpis">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-[112px] rounded-xl" />
        ))}
      </div>
      <div className="dash-row dash-row-main">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-[286px] rounded-xl" />
        ))}
      </div>
      <div className="dash-row dash-row-lower">
        <Skeleton className="h-[248px] rounded-xl" />
        <Skeleton className="h-[404px] rounded-xl" />
        <Skeleton className="h-[404px] rounded-xl" />
      </div>
    </div>
  );
}

/* --------------------------------- Helpers --------------------------------- */

function isDelivered(status: string): boolean {
  return ["approved", "finalized", "locked", "archived"].includes(status);
}

function monthEnd(month: string | undefined): string {
  if (!month) return "9999-12-31";
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

function formatToday(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

function relativeDate(date: string): string {
  const days = daysFromToday(date);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1) return `In ${days} days`;
  return `${Math.abs(days)} ${plural(Math.abs(days), "day")} late`;
}

function dueTone(date: string): string {
  const days = daysFromToday(date);
  if (days < 0) return "is-danger";
  if (days <= 3) return "is-warning";
  return "is-info";
}

function daysFromToday(date: string): number {
  const target = new Date(`${date}T00:00:00`);
  const today = new Date(`${todayIso()}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

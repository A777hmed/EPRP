"use client";

/**
 * The EPR Control Center.
 *
 * ONE connected workspace: the Project / Department / Period filters at the top
 * drive every KPI, chart, milestone, alert and the calendar panel beneath them.
 * Selecting a project narrows the whole page; All Projects restores the
 * portfolio view. Nothing here is fetched per-panel, so the page cannot show a
 * KPI from one scope beside a chart from another.
 *
 * Every figure is real. Where the data does not support a visualisation the
 * card says so rather than drawing an empty axis — a chart with nothing in it
 * reads as "zero", which is a different and wrong statement.
 */

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarPlus,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FileBarChart,
  FilePlus2,
  FolderKanban,
  Gauge,
  TrendingDown,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/shared";
import { CalendarPreview } from "@/features/calendar";
import { todayIso } from "@/features/calendar/calendar-types";
import { DashboardAnalytics } from "./dashboard-analytics";
import {
  EMPTY_DASHBOARD_FILTERS,
  TIME_PERIOD_LABEL,
  positionsFor,
  round,
  totalsFor,
  useDashboardData,
  varianceTrend,
  type DashboardFilters,
  type TimePeriod,
} from "./dashboard-data";

const PERIODS: TimePeriod[] = ["this_week", "this_month", "quarter", "all"];

export function DashboardView({ canManage }: { canManage: boolean }) {
  const data = useDashboardData();
  const [filters, setFilters] = React.useState<DashboardFilters>(EMPTY_DASHBOARD_FILTERS);

  /* Scope first, then derive. Every panel below reads from these. */
  const scopedProjects = React.useMemo(
    () =>
      filters.projectId
        ? data.projects.filter((project) => project.id === filters.projectId)
        : data.projects,
    [data.projects, filters.projectId]
  );

  const positions = React.useMemo(
    () => positionsFor(scopedProjects, data.weeklies, data.monthlies, filters.period),
    [scopedProjects, data.weeklies, data.monthlies, filters.period]
  );

  const totals = React.useMemo(
    () => totalsFor(positions, data.weeklies, data.monthlies),
    [positions, data.weeklies, data.monthlies]
  );

  const scopedIds = React.useMemo(
    () => new Set(scopedProjects.map((project) => project.id)),
    [scopedProjects]
  );

  const trend = React.useMemo(
    () => varianceTrend(data.weeklies, scopedIds),
    [data.weeklies, scopedIds]
  );

  const milestones = React.useMemo(
    () =>
      data.milestones
        .filter((m) => scopedIds.has(m.projectId))
        .filter((m) => !filters.departmentId || m.departmentId === filters.departmentId)
        .slice(0, 6),
    [data.milestones, scopedIds, filters.departmentId]
  );


  if (data.loading) return <LoadingState label="Loading control centre…" />;
  if (data.error) {
    return <EmptyState title="Dashboard unavailable" description={data.error} icon={AlertTriangle} />;
  }

  return (
    <div className="dash-stage">
      {/* ------------------------------ Filters ------------------------------ */}
      <header className="dash-hero">
        <div className="dash-hero-title">
          <p>EPR — Enterprise Progress Reporting</p>
          <h1>Control Center</h1>
          <span>
            {filters.projectId
              ? "Single project view — every panel below is scoped to this project."
              : "Portfolio view across every project you have access to."}
          </span>
        </div>

        <div className="dash-hero-filters">
          <label>
            <span>Project</span>
            <select
              value={filters.projectId}
              onChange={(e) => setFilters({ ...filters, projectId: e.target.value, departmentId: "" })}
            >
              <option value="">All Projects</option>
              {data.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Department</span>
            <select
              value={filters.departmentId}
              onChange={(e) => setFilters({ ...filters, departmentId: e.target.value })}
            >
              <option value="">All Departments</option>
              {data.departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Time Period</span>
            <select
              value={filters.period}
              onChange={(e) => setFilters({ ...filters, period: e.target.value as TimePeriod })}
            >
              {PERIODS.map((period) => (
                <option key={period} value={period}>
                  {TIME_PERIOD_LABEL[period]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {/* -------------------------------- KPIs ------------------------------- */}
      <section className="dash-kpis" aria-label="Key performance indicators">
        <Kpi
          icon={<FolderKanban aria-hidden />}
          tone="info"
          label="Projects in View"
          value={String(totals.totalProjects)}
          caption={`${totals.reportedProjects} reporting · ${totals.notReported} not reported`}
        />
        <Kpi
          icon={<Gauge aria-hidden />}
          tone="default"
          label="Planned Progress"
          value={totals.planned === undefined ? "—" : `${round(totals.planned)}%`}
          caption={totals.planned === undefined ? "No reported data" : "Mean of reporting projects"}
        />
        <Kpi
          icon={<CheckCircle2 aria-hidden />}
          tone="success"
          label="Actual Progress"
          value={totals.actual === undefined ? "—" : `${round(totals.actual)}%`}
          caption={totals.actual === undefined ? "No reported data" : "Latest Weekly per project"}
        />
        <Kpi
          icon={<TrendingDown aria-hidden />}
          tone={totals.variance !== undefined && totals.variance < -3 ? "danger" : "success"}
          label="Schedule Variance"
          value={totals.variance === undefined ? "—" : `${totals.variance > 0 ? "+" : ""}${round(totals.variance)}%`}
          caption={totals.variance === undefined ? "No reported data" : "Actual less planned"}
        />
        <Kpi
          icon={<CheckCircle2 aria-hidden />}
          tone="success"
          label="On Track"
          value={String(totals.onTrack)}
          caption={
            totals.totalProjects
              ? `${Math.round((totals.onTrack / totals.totalProjects) * 100)}% of projects in view`
              : "No projects in view"
          }
        />
        <Kpi
          icon={<AlertTriangle aria-hidden />}
          tone={totals.overdueReports ? "danger" : "success"}
          label="Overdue Reports"
          value={String(totals.overdueReports)}
          caption={totals.overdueReports ? "Past period end, not approved" : "Nothing overdue"}
        />
      </section>

      {/* ------------------------------ Analytics ---------------------------- */}
      {/* Analytics and operational cards share ONE 12-column grid, so a row
          can never be left half-empty by a wrapper boundary. */}
      <div className="dash-analytics">
        <DashboardAnalytics positions={positions} totals={totals} trend={trend} />
        <section className="dash-card" style={{ "--span": 5 } as React.CSSProperties}>
          <header>
            <b>Upcoming milestones</b>
            <small>From Weekly and Monthly plans</small>
            <Link href="/weekly-reports">View all</Link>
          </header>
          <div className="dash-card-body">
            {milestones.length ? (
              <ul className="dash-milestones">
                {milestones.map((milestone) => (
                  <li key={milestone.id}>
                    <span className="dash-ms-date">
                      <b>{milestone.dueDate.slice(8)}</b>
                      <small>{monthAbbr(milestone.dueDate)}</small>
                    </span>
                    <span className="dash-ms-body">
                      <Link href={milestone.href}>{milestone.title}</Link>
                      <small>{milestone.projectName}</small>
                    </span>
                    <span className={`dash-ms-status is-${milestoneTone(milestone.status)}`}>
                      {milestone.status.replace(/_/g, " ")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dash-empty">
                No dated milestones are recorded ahead of today for this scope.
              </p>
            )}
          </div>
        </section>

        <section className="dash-card" style={{ "--span": 3 } as React.CSSProperties}>
          <header>
            <b>Reporting exceptions</b>
            <small>Past period end, not approved</small>
          </header>
          <div className="dash-card-body">
            <ul className="dash-alerts">
              <AlertRow
                label="Weekly overdue"
                count={data.weeklies.filter((r) => scopedIds.has(r.projectId) && r.periodEnd < todayIso() && !isDelivered(r.status)).length}
                href="/weekly-reports"
              />
              <AlertRow
                label="Monthly overdue"
                count={data.monthlies.filter((r) => scopedIds.has(r.projectId) && !isDelivered(r.status) && monthEnd(r.reportingMonth) < todayIso()).length}
                href="/monthly-reports"
              />
              <AlertRow label="Not reporting" count={totals.notReported} href="/projects" />
            </ul>
          </div>
        </section>

        <section className="dash-card" style={{ "--span": 12 } as React.CSSProperties}>
          <header>
            <b>Quick actions</b>
            <small>Respecting your permissions</small>
          </header>
          <div className="dash-card-body">
            <div className="dash-actions">
              {canManage && <QuickAction href="/weekly-reports/new" icon={<FilePlus2 aria-hidden />} label="New Weekly" />}
              {canManage && <QuickAction href="/monthly-reports/new" icon={<FileBarChart aria-hidden />} label="New Monthly" />}
              {canManage && <QuickAction href="/calendar" icon={<CalendarPlus aria-hidden />} label="Meeting / Event" />}
              <QuickAction href="/documents" icon={<Upload aria-hidden />} label="Documents" />
              <QuickAction href="/projects" icon={<ClipboardList aria-hidden />} label="All Projects" />
              <QuickAction href="/executive-reports" icon={<ArrowUpRight aria-hidden />} label="Executive" />
            </div>
          </div>
        </section>
      </div>

      {/* ------------------------------- Calendar ---------------------------- */}
      <CalendarPreview
        projectId={filters.projectId}
        departmentId={filters.departmentId}
        canManage={canManage}
      />
    </div>
  );
}

/* -------------------------------- Fragments -------------------------------- */

function monthAbbr(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: "short" });
}

function milestoneTone(status: string): string {
  if (status === "completed") return "success";
  if (status === "delayed") return "danger";
  if (status === "in_progress") return "info";
  return "default";
}

function isDelivered(status: string): boolean {
  return ["approved", "finalized", "locked", "archived"].includes(status);
}

function monthEnd(month: string | undefined): string {
  if (!month) return "9999-12-31";
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * A KPI reads top-down — label, figure, caption — with the icon demoted to a
 * watermark behind the figure.
 *
 * The previous layout put a filled icon TILE beside the number, which made all
 * six cards resolve to the same silhouette regardless of what they said. Now
 * the figure is the largest thing in the card and the only element that varies
 * in colour, and cards carrying a warning or danger state pick up a faint wash
 * — so the strip is differentiated BY THE DATA rather than by decoration.
 */
function Kpi({
  icon,
  label,
  value,
  caption,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  caption: string;
  tone: "default" | "success" | "warning" | "danger" | "info";
}) {
  return (
    <article className={`dash-kpi is-${tone}`}>
      <span className="dash-kpi-label">{label}</span>
      <b className="dash-kpi-value">{value}</b>
      <small>{caption}</small>
      <span className="dash-kpi-mark" aria-hidden>
        {icon}
      </span>
    </article>
  );
}

/**
 * Exceptions are ranked by whether they need action, not listed flat.
 *
 * A row with a count carries the alert treatment and a chevron; a row at zero
 * recedes to a cleared state. Previously every row looked identical apart from
 * the number, so "3 overdue" and "0 overdue" had the same visual weight.
 */
function AlertRow({ label, count, href }: { label: string; count: number; href: string }) {
  return (
    <li className={count ? "is-active" : "is-clear"}>
      <Link href={href}>
        <span>{label}</span>
        <b>{count}</b>
        {count > 0 && <ChevronRight className="dash-alert-go" aria-hidden />}
      </Link>
    </li>
  );
}

function QuickAction({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Button asChild variant="outline" className="dash-action">
      <Link href={href}>
        {icon}
        {label}
      </Link>
    </Button>
  );
}

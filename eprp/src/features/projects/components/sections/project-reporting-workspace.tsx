"use client";

import * as React from "react";
import Link from "next/link";
import {
  CalendarDays,
  CalendarRange,
  Eye,
  FileBarChart,
  PenLine,
  Plus,
} from "lucide-react";

import { EmptyState, LoadingState, StatusBadge } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { REPORT_STATUS_META } from "@/lib/constants";
import { formatDate } from "@/lib/formatters";
import { getMonthLabel } from "@/lib/reporting";
import { monthlyReportService } from "@/services/monthly-report-service";
import type { MonthlyReport, Project, WeeklyReport } from "@/types";
import {
  MONTHLY_BASIS_META,
  selectOfficialMonthly,
} from "@/features/executive-reports/executive-data";
import { WeeklyStatusBadge } from "@/features/weekly-reports/components/weekly-status-badge";
// [reporting-perf] TEMPORARY diagnostic import — remove with src/lib/perf-temp.ts
import { timed } from "@/lib/perf-temp";
import { useProjectAuthority } from "../../use-project-authority";
import { ProjectSectionLayout } from "./project-section-layout";
import { ReportContextHeader } from "./project-reporting-shell";

type ReportingTab = "weekly" | "monthly" | "executive";

const REPORTING_TABS: ReportingTab[] = ["weekly", "monthly", "executive"];

function isReportingTab(value: string | null): value is ReportingTab {
  return REPORTING_TABS.includes(value as ReportingTab);
}

const REPORTING_TAB_EVENT = "reporting-tab-change";

function useReportingTab(): [ReportingTab, (tab: ReportingTab) => void] {
  const subscribe = React.useCallback((onChange: () => void) => {
    window.addEventListener("popstate", onChange);
    window.addEventListener(REPORTING_TAB_EVENT, onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
      window.removeEventListener(REPORTING_TAB_EVENT, onChange);
    };
  }, []);

  const tab = React.useSyncExternalStore<ReportingTab>(
    subscribe,
    (): ReportingTab => {
      const requested = new URLSearchParams(window.location.search).get("tab");
      return isReportingTab(requested) ? requested : "weekly";
    },
    (): ReportingTab => "weekly"
  );

  const selectTab = React.useCallback((next: ReportingTab) => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
    window.dispatchEvent(new Event(REPORTING_TAB_EVENT));
  }, []);

  return [tab, selectTab];
}

function RowActions({
  reportHref,
  workspaceHref,
}: {
  reportHref: string;
  workspaceHref: string;
}) {
  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      <Button variant="outline" size="sm" asChild>
        <Link href={reportHref} prefetch={false}>
          <Eye aria-hidden="true" />
          View
        </Link>
      </Button>
      <Button variant="outline" size="sm" asChild>
        <Link href={workspaceHref} prefetch={false}>
          <PenLine aria-hidden="true" />
          Workspace
        </Link>
      </Button>
    </div>
  );
}

/**
 * "+ New …", project-scoped.
 *
 * Rendered only for an account that holds `can_manage_reporting_workflow()`
 * on THIS project — the same `canManageReporting` the rest of the reporting
 * surfaces use. An ordinary Team Member contributes department input to a
 * report they do not raise, so they never see it.
 */
function CreateReportButton({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Button size="sm" asChild>
      <Link href={href} prefetch={false}>
        <Plus aria-hidden="true" />
        {label}
      </Link>
    </Button>
  );
}

function WeeklyTab({
  projectId,
  reports,
  canManageReporting,
}: {
  projectId: string;
  reports: WeeklyReport[];
  canManageReporting: boolean;
}) {
  const ordered = React.useMemo(
    () => [...reports].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd)),
    [reports]
  );

  const createHref = `/projects/${projectId}/reports/weekly/new`;

  if (ordered.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No Weekly Reports"
        description={
          canManageReporting
            ? "Raise the first Weekly Report for this project to start collecting department input."
            : "Weekly Reports raised for this project will appear here. They are raised by Project Control or the Report Coordinator."
        }
        className="py-10"
        action={
          canManageReporting ? (
            <CreateReportButton href={createHref} label="New Weekly Report" />
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {canManageReporting && (
        <div className="flex justify-end">
          <CreateReportButton href={createHref} label="New Weekly Report" />
        </div>
      )}
      <ul className="divide-y rounded-lg border">
      {ordered.map((report) => (
        <li
          key={report.id}
          className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/projects/${projectId}/reports/weekly/${report.id}`}
                className="font-mono text-sm font-semibold hover:underline"
                prefetch={false}
              >
                {report.reportNumber}
              </Link>
              <WeeklyStatusBadge status={report.status} />
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              Week {String(report.weekNumber).padStart(2, "0")} ·{" "}
              {formatDate(report.periodStart)} – {formatDate(report.periodEnd)}
            </p>
          </div>
          <RowActions
            reportHref={`/projects/${projectId}/reports/weekly/${report.id}`}
            workspaceHref={`/projects/${projectId}/reports/weekly/${report.id}/workspace`}
          />
        </li>
      ))}
      </ul>
    </div>
  );
}

function MonthlyTab({
  projectId,
  reports,
  loading,
  canManageReporting,
}: {
  projectId: string;
  reports: MonthlyReport[];
  loading: boolean;
  canManageReporting: boolean;
}) {
  if (loading) return <LoadingState label="Loading Monthly Reports…" />;

  const createHref = `/projects/${projectId}/reports/monthly/new`;

  if (reports.length === 0) {
    return (
      <EmptyState
        icon={CalendarRange}
        title="No Monthly Reports"
        description={
          canManageReporting
            ? "Create the first Monthly reporting period for this project. It compiles the Weekly items already selected for Monthly reporting."
            : "Monthly Reports created for this project will appear here. They are created by Project Control or the Report Coordinator."
        }
        className="py-10"
        action={
          canManageReporting ? (
            <CreateReportButton href={createHref} label="New Monthly Report" />
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {canManageReporting && (
        <div className="flex justify-end">
          <CreateReportButton href={createHref} label="New Monthly Report" />
        </div>
      )}
      <ul className="divide-y rounded-lg border">
      {reports.map((report) => {
        const status = REPORT_STATUS_META[report.status];
        return (
          <li
            key={report.id}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/projects/${projectId}/reports/monthly/${report.id}`}
                  className="font-mono text-sm font-semibold hover:underline"
                  prefetch={false}
                >
                  {report.reportNumber}
                </Link>
                <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
              </div>
              <p className="text-xs text-muted-foreground">
                {getMonthLabel(report.reportingMonth)}
              </p>
            </div>
            <RowActions
              reportHref={`/projects/${projectId}/reports/monthly/${report.id}`}
              workspaceHref={`/projects/${projectId}/reports/monthly/${report.id}/workspace`}
            />
          </li>
        );
      })}
      </ul>
    </div>
  );
}

/*
 * Project Executive is DERIVED, not authored.
 *
 * The periods below are not Executive records — they are the distinct months
 * of this project's Monthly reports, and `selectOfficialMonthly` picks which
 * Monthly is the official basis for each. There is no Executive create
 * endpoint at project level and deliberately no "New Executive Report"
 * action: a project Executive view exists precisely when a Monthly reporting
 * period exists, and the way to produce one is to create the Monthly.
 *
 * So the empty state names that prerequisite and, for an account authorized
 * to satisfy it, offers the project-scoped Monthly create — the real
 * preceding action rather than a fabricated Executive one. Portfolio
 * Executive remains a separate global concept and is untouched here.
 */
function ExecutiveTab({
  projectId,
  reports,
  loading,
  canManageReporting,
}: {
  projectId: string;
  reports: MonthlyReport[];
  loading: boolean;
  canManageReporting: boolean;
}) {
  if (loading) return <LoadingState label="Loading Executive periods…" />;

  const months = [...new Set(reports.map((report) => report.reportingMonth.slice(0, 7)))].sort(
    (a, b) => b.localeCompare(a)
  );

  if (months.length === 0) {
    return (
      <EmptyState
        icon={FileBarChart}
        title="No Executive reporting periods"
        description={
          canManageReporting
            ? "A project Executive view is derived from this project's Monthly reporting. Create a Monthly reporting period and its Executive view appears here."
            : "A project Executive view becomes available when this project has a Monthly reporting period."
        }
        className="py-10"
        action={
          canManageReporting ? (
            <CreateReportButton
              href={`/projects/${projectId}/reports/monthly/new`}
              label="Create Monthly Report"
            />
          ) : undefined
        }
      />
    );
  }

  return (
    <ul className="divide-y rounded-lg border">
      {months.map((month) => {
        const selection = selectOfficialMonthly(reports, month);
        const basis = MONTHLY_BASIS_META[selection.basis];
        return (
          <li
            key={month}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">
                  {getMonthLabel(`${month}-01`)}
                </span>
                <StatusBadge tone={basis.tone}>{basis.label}</StatusBadge>
              </div>
              <p className="text-xs text-muted-foreground">{basis.note}</p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link
                href={`/projects/${projectId}/reports/executive?month=${month}`}
                prefetch={false}
              >
                <Eye aria-hidden="true" />
                Open Executive view
              </Link>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

export interface ProjectReportingWorkspaceProps {
  project: Project;
  weeklyReports: WeeklyReport[];
}

export function ProjectReportingWorkspace({
  project,
  weeklyReports,
}: ProjectReportingWorkspaceProps) {
  const [tab, selectTab] = useReportingTab();
  /* `can_manage_reporting_workflow()` on THIS project — the existing helper,
     which admits the two global authorities, the assigned Project Control /
     Planning, and the assigned Report Coordinator, and nobody else. */
  const { canManageReporting } = useProjectAuthority(project);
  const [monthlyReports, setMonthlyReports] = React.useState<MonthlyReport[]>([]);
  const [monthlyLoading, setMonthlyLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;

    /* [reporting-perf] TEMPORARY — see src/lib/perf-temp.ts.
       NOTE for the investigation: this runs on mount regardless of which tab
       is active, because the Executive tab derives its periods from the SAME
       Monthly list. It is one query, already project-scoped. */
    void timed("reportingWorkspace.monthlyList", () =>
      monthlyReportService.list(project.id)
    )
      .then((reports) => {
        if (!cancelled) setMonthlyReports(reports);
      })
      .catch(() => {
        if (!cancelled) setMonthlyReports([]);
      })
      .finally(() => {
        if (!cancelled) setMonthlyLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [project.id]);

  return (
    <>
      {/*
       * Header only here — this page already has its own working
       * Weekly/Monthly/Executive switcher (the Tabs below, driven by
       * `useReportingTab`), so `ReportTypeTabs` is deliberately not
       * duplicated on this one screen. See project-reporting-shell.tsx.
       */}
      <ReportContextHeader
        projectCode={project.code}
        projectName={project.shortName ?? project.name}
      />
      <ProjectSectionLayout
        title="Reporting workspace"
        description="Open this project's Weekly, Monthly, and Executive reporting periods."
      >
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (isReportingTab(value)) selectTab(value);
        }}
      >
        <TabsList className="grid h-auto w-full grid-cols-3">
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="executive">Executive</TabsTrigger>
        </TabsList>

        <TabsContent value="weekly" className="mt-4">
          <WeeklyTab
            projectId={project.id}
            reports={weeklyReports}
            canManageReporting={canManageReporting}
          />
        </TabsContent>
        <TabsContent value="monthly" className="mt-4">
          <MonthlyTab
            projectId={project.id}
            reports={monthlyReports}
            loading={monthlyLoading}
            canManageReporting={canManageReporting}
          />
        </TabsContent>
        <TabsContent value="executive" className="mt-4">
          <ExecutiveTab
            projectId={project.id}
            reports={monthlyReports}
            loading={monthlyLoading}
            canManageReporting={canManageReporting}
          />
        </TabsContent>
      </Tabs>
      </ProjectSectionLayout>
    </>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import {
  CalendarDays,
  CalendarRange,
  Eye,
  FileBarChart,
  PenLine,
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
import { ProjectSectionLayout } from "./project-section-layout";

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

function WeeklyTab({
  projectId,
  reports,
}: {
  projectId: string;
  reports: WeeklyReport[];
}) {
  const ordered = React.useMemo(
    () => [...reports].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd)),
    [reports]
  );

  if (ordered.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No Weekly Reports"
        description="Weekly Reports raised for this project will appear here."
        className="py-10"
      />
    );
  }

  return (
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
  );
}

function MonthlyTab({
  projectId,
  reports,
  loading,
}: {
  projectId: string;
  reports: MonthlyReport[];
  loading: boolean;
}) {
  if (loading) return <LoadingState label="Loading Monthly Reports…" />;

  if (reports.length === 0) {
    return (
      <EmptyState
        icon={CalendarRange}
        title="No Monthly Reports"
        description="Monthly Reports created for this project will appear here."
        className="py-10"
      />
    );
  }

  return (
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
  );
}

function ExecutiveTab({
  projectId,
  reports,
  loading,
}: {
  projectId: string;
  reports: MonthlyReport[];
  loading: boolean;
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
        description="A project Executive view becomes available when this project has a Monthly reporting period."
        className="py-10"
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
  const [monthlyReports, setMonthlyReports] = React.useState<MonthlyReport[]>([]);
  const [monthlyLoading, setMonthlyLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;

    monthlyReportService
      .list(project.id)
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
          <WeeklyTab projectId={project.id} reports={weeklyReports} />
        </TabsContent>
        <TabsContent value="monthly" className="mt-4">
          <MonthlyTab
            projectId={project.id}
            reports={monthlyReports}
            loading={monthlyLoading}
          />
        </TabsContent>
        <TabsContent value="executive" className="mt-4">
          <ExecutiveTab
            projectId={project.id}
            reports={monthlyReports}
            loading={monthlyLoading}
          />
        </TabsContent>
      </Tabs>
    </ProjectSectionLayout>
  );
}

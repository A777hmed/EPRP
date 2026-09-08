"use client";

/**
 * Monthly Report screens: the read-only document (detail) and the print stage
 * (preview). Authoring lives in the Workspace — see `monthly-workspace.tsx`.
 */

import * as React from "react";
import { compilationMessage, monthlyStatusMeta } from "./monthly-data";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Eye, FilePlus2, PenLine, Plus, Printer, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/shared";
import { formatDate } from "@/lib/formatters";
import { getMonthLabel } from "@/lib/reporting";
import { monthlyReportService } from "@/services/monthly-report-service";
import { siteConfig } from "@/config/site";
import type { MonthlyReport, Project } from "@/types";
import {
  ProjectReportingShell,
  ReportContextHeader,
  ReportTypeTabs,
} from "@/features/projects/components/sections/project-reporting-shell";
import { MonthlyReportDocument, type MonthlyReportBundle } from "./monthly-report-document";
import { useMonthlyBundle } from "./use-monthly-bundle";

export { MonthlyReportsView, MonthlyNewView } from "./monthly-list-view";

/**
 * Where a Monthly view's own View/Workspace/Preview actions navigate, and
 * where its Weekly cross-references go. Defaults to the global
 * `/monthly-reports`/`/weekly-reports` routes; a project-scoped alias page
 * overrides `detail`/`workspace`/`weeklyDetail`/`weeklyList` so those stay
 * under `/projects/[projectId]/...` instead of dropping the project
 * sidebar. `preview` has no project-scoped alias yet, so it intentionally
 * always falls back to the global route rather than linking to a page that
 * doesn't exist. `/monthly-reports/new` is an unrelated destination (create,
 * not reference) and is left as-is.
 */
export interface MonthlyReportLinks {
  detail: (reportId: string) => string;
  workspace: (reportId: string) => string;
  preview: (reportId: string) => string;
  /** A referenced source Weekly report — project-scoped when available. */
  weeklyDetail: (weeklyReportId: string) => string;
  /** "← Weekly Reports": the project's own Weekly tab when scoped, the global list otherwise. */
  weeklyList: string;
  /** "← Back to Reporting": the project's Monthly tab when scoped, the global register otherwise. */
  list: string;
}

export const GLOBAL_MONTHLY_LINKS: MonthlyReportLinks = {
  detail: (reportId) => `/monthly-reports/${reportId}`,
  workspace: (reportId) => `/monthly-reports/${reportId}/workspace`,
  preview: (reportId) => `/monthly-reports/${reportId}/preview`,
  weeklyDetail: (weeklyReportId) => `/weekly-reports/${weeklyReportId}`,
  weeklyList: "/weekly-reports",
  list: "/monthly-reports",
};

/**
 * Preview has no project-scoped alias yet, so it intentionally still falls
 * back to the global route rather than linking to a page that doesn't exist.
 */
export function buildProjectMonthlyLinks(projectId: string): MonthlyReportLinks {
  return {
    detail: (reportId) => `/projects/${projectId}/reports/monthly/${reportId}`,
    workspace: (reportId) =>
      `/projects/${projectId}/reports/monthly/${reportId}/workspace`,
    preview: (reportId) => `/monthly-reports/${reportId}/preview`,
    weeklyDetail: (weeklyReportId) =>
      `/projects/${projectId}/reports/weekly/${weeklyReportId}`,
    weeklyList: `/projects/${projectId}/reporting?tab=weekly`,
    list: `/projects/${projectId}/reporting?tab=monthly`,
  };
}

/* --------------------------------- Chrome ---------------------------------- */

function MonthlyTopBar({
  report,
  project,
  siblings,
  links,
}: {
  report: MonthlyReport;
  project: Project | null;
  siblings: MonthlyReport[];
  links: MonthlyReportLinks;
}) {
  const tabs = [report, ...siblings].sort((a, b) => b.reportingMonth.localeCompare(a.reportingMonth)).slice(0, 4);

  return (
    <div className="monthly-app-chrome print:hidden">
      <div className="monthly-app-bar">
        <Image src={siteConfig.logo.full} alt="EPROM" width={111} height={30} unoptimized />
        <strong>Monthly Progress Report</strong>
        <span className="monthly-app-divider" />
        <span className="monthly-project-selector">{project?.name ?? project?.shortName ?? project?.code ?? "Project"}</span>
        <Link href={links.weeklyList} className="monthly-chrome-button">
          ← Weekly Reports
        </Link>
        <Link href={links.workspace(report.id)} className="monthly-chrome-button">
          <PenLine /> Workspace
        </Link>
        <Link href={links.preview(report.id)} className="monthly-chrome-button">
          <Printer /> Print / Export PDF
        </Link>
      </div>
      <div className="monthly-month-tabs">
        <span>Monthly</span>
        {tabs.map((item) => (
          <Link
            key={item.id}
            className={item.id === report.id ? "active" : ""}
            href={links.detail(item.id)}
            prefetch={false}
          >
            {getMonthLabel(item.reportingMonth)}
          </Link>
        ))}
        <Link href="/monthly-reports/new" aria-label="Create Monthly Report">
          <Plus />
        </Link>
      </div>
    </div>
  );
}

/**
 * The Weekly import control.
 *
 * The operation is idempotent at the database level — `monthly_comments`
 * carries a unique constraint on `source_weekly_entry_id` and the write is an
 * upsert that ignores duplicates — so running it repeatedly adds only what is
 * genuinely new and never touches the Weekly source.
 */
export function WeeklyImportStrip({ reportId, importedCount, onDone }: { reportId: string; importedCount: number; onDone: () => Promise<void> }) {
  const [syncing, setSyncing] = React.useState(false);
  const [lastSync, setLastSync] = React.useState<string | null>(null);

  const run = async () => {
    setSyncing(true);
    try {
      const result = await monthlyReportService.compileFromWeeklies(reportId);
      await onDone();
      setLastSync(new Date().toLocaleTimeString());
      toast.success(compilationMessage(result));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update from Weekly Reports.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="monthly-sync-strip print:hidden">
      <div>
        <b>Update from Weekly Reports</b>
        <span>Imports newly selected Monthly items from eligible Weekly Reports without duplicating previously imported records.</span>
        <small>
          {importedCount} imported item{importedCount === 1 ? "" : "s"}
          {lastSync ? ` · last updated ${lastSync}` : ""}
        </small>
      </div>
      <Button variant="outline" onClick={run} disabled={syncing}>
        <RefreshCw className={syncing ? "animate-spin" : ""} />
        {syncing ? "Updating…" : "Update from Weekly Reports"}
      </Button>
    </div>
  );
}

/* ------------------------------- Report view ------------------------------- */

export function MonthlyReportView({
  reportId,
  mode = "detail",
  projectId,
}: {
  reportId: string;
  mode?: "detail" | "preview";
  /**
   * When set, this view's own actions stay under
   * `/projects/[projectId]/...`. A plain string, not a links object: this
   * prop crosses a Server → Client Component boundary (the project-scoped
   * page is a Server Component), and functions cannot be serialized across
   * that boundary.
   */
  projectId?: string;
}) {
  const links = projectId
    ? buildProjectMonthlyLinks(projectId)
    : GLOBAL_MONTHLY_LINKS;
  const { bundle, siblings, reload } = useMonthlyBundle(reportId);

  if (bundle === undefined) return <LoadingState label="Loading Monthly Report…" />;
  if (bundle === null) {
    return <EmptyState title="Monthly Report not found" description="This report is unavailable or you do not have access to it." icon={FilePlus2} />;
  }

  if (mode === "preview") return <MonthlyPreviewStage bundle={bundle} links={links} />;

  const importedCount = bundle.comments.filter((comment) => comment.sourceKind === "weekly").length;

  return (
    <ProjectReportingShell
      header={
        <ReportContextHeader
          projectCode={bundle.project?.code}
          projectName={
            bundle.project?.shortName ?? bundle.project?.name ?? "Project"
          }
          period={getMonthLabel(bundle.report.reportingMonth)}
          status={{
            label: monthlyStatusMeta(bundle.report.status).label,
            tone: monthlyStatusMeta(bundle.report.status).tone,
          }}
          updatedAt={formatDate(bundle.report.updatedAt)}
        />
      }
      tabs={
        projectId ? (
          <ReportTypeTabs projectId={projectId} active="monthly" />
        ) : undefined
      }
    >
    <div className="monthly-screen-stage">
      <MonthlyTopBar report={bundle.report} project={bundle.project} siblings={siblings} links={links} />
      <WeeklyImportStrip reportId={bundle.report.id} importedCount={importedCount} onDone={reload} />
      <div className="monthly-stage-actions print:hidden">
        {/*
         * Project context only — a global Monthly Report has no project
         * Reporting tab to return to.
         */}
        {projectId && (
          <Button asChild variant="outline">
            <Link href={links.list}>
              <ArrowLeft />
              Back to Reporting
            </Link>
          </Button>
        )}
        <Button asChild>
          <Link href={links.workspace(bundle.report.id)}>
            <PenLine />
            Open Workspace
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={links.preview(bundle.report.id)}>
            <Eye />
            Print Preview
          </Link>
        </Button>
      </div>
      <MonthlyReportDocument {...bundle} />
    </div>
    </ProjectReportingShell>
  );
}

function MonthlyPreviewStage({
  bundle,
  links,
}: {
  bundle: MonthlyReportBundle;
  links: MonthlyReportLinks;
}) {
  return (
    <div className="monthly-preview-stage">
      <div className="monthly-preview-tools print:hidden">
        <Link href={links.detail(bundle.report.id)}>← Back to report</Link>
        <Button onClick={() => window.print()}>
          <Printer />
          Print / Export PDF
        </Button>
      </div>
      <MonthlyReportDocument {...bundle} />
    </div>
  );
}

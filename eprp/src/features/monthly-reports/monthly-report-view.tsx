"use client";

/**
 * Monthly Report screens: the read-only document (detail) and the print stage
 * (preview). Authoring lives in the Workspace — see `monthly-workspace.tsx`.
 */

import * as React from "react";
import { compilationMessage, monthlyStatusMeta } from "./monthly-data";
import Link from "next/link";
import { ArrowLeft, CalendarDays, Eye, FilePlus2, PenLine, Plus, Printer, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/shared";
import { formatDate } from "@/lib/formatters";
import { getMonthLabel } from "@/lib/reporting";
import { monthlyReportService } from "@/services/monthly-report-service";
import {
  fetchGlobalMonthlyReportDetail,
  fetchGlobalRegisterProjects,
  type GlobalMonthlyReportDetail,
  type GlobalRegisterProject,
} from "@/services/global-report-register";
import type { MonthlyReport } from "@/types";
import { useCurrentIdentity } from "@/features/auth/use-current-identity";
import {
  ProjectReportingShell,
  ReportContextHeader,
  ReportPeriodSwitcher,
  ReportTypeTabs,
} from "@/features/projects/components/sections/project-reporting-shell";
import { MonthlyReportDocument, type MonthlyReportBundle } from "./monthly-report-document";
import { MonthlyReportCrossProjectView } from "./monthly-report-cross-project-view";
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

/**
 * Move between this project's Monthly reporting periods.
 *
 * WHAT THIS REPLACED, AND WHY NOTHING WAS LOST. The Monthly detail screen used
 * to open with a second in-page application bar carrying the EPROM logo, the
 * title "Monthly Progress Report", the project name, and three links. Every one
 * of those was already on the screen: the logo and title in the platform sidebar
 * and the report document itself, the project name and status in
 * `ReportContextHeader`, and Workspace / Print Preview in the action row below.
 * Four layers of chrome answered the same question.
 *
 * The month tabs were the exception — the one thing that bar offered which
 * nothing else did — so they are kept here, on the shared
 * `ReportPeriodSwitcher`. "Weekly Reports" was the other, and it moved into the
 * action row beside the destinations it belongs with.
 */
function MonthlyPeriodBar({
  report,
  siblings,
  links,
}: {
  report: MonthlyReport;
  siblings: MonthlyReport[];
  links: MonthlyReportLinks;
}) {
  const tabs = [report, ...siblings].sort((a, b) => b.reportingMonth.localeCompare(a.reportingMonth)).slice(0, 4);

  return (
    <ReportPeriodSwitcher
      label="Monthly"
      items={tabs.map((item) => ({
        id: item.id,
        label: getMonthLabel(item.reportingMonth),
        href: links.detail(item.id),
        active: item.id === report.id,
      }))}
      action={
        <Button asChild variant="outline" size="sm">
          <Link href="/monthly-reports/new" aria-label="Create Monthly Report">
            <Plus data-icon="inline-start" aria-hidden="true" />
            New
          </Link>
        </Button>
      }
    />
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
  /*
   * Resolved before the cross-project effect fires: admin / global-authority
   * viewers always have `can_access_project` in RLS and should never be
   * redirected to the read-only cross-project summary.  Until identity
   * resolves (`.resolved = false`) the cross-project effect is held so it
   * does not start a fetch that identity would then invalidate.
   */
  const identity = useCurrentIdentity();

  /*
   * Read-only cross-project fallback (Access & Visibility hotfix, R6).
   * Only attempted once `useMonthlyBundle()` has confirmed ordinary
   * (assignment-gated) access came back empty — never for the editing
   * workspace, which has its own separate call to `useMonthlyBundle()` and
   * never reaches this component. `undefined` = not attempted / loading,
   * `null` = attempted and genuinely unavailable, an object = approved+ and
   * readable. See `MonthlyReportCrossProjectView` for why this deliberately
   * does not try to render the full department-level document.
   */
  const [crossProjectDetail, setCrossProjectDetail] = React.useState<
    GlobalMonthlyReportDetail | null | undefined
  >(undefined);
  const [crossProjectProject, setCrossProjectProject] =
    React.useState<GlobalRegisterProject | null>(null);

  React.useEffect(() => {
    if (bundle !== null) return;
    // Wait for identity to settle so admin bypass is applied before fetching.
    if (!identity.resolved) return;
    // Admin / global-authority viewers have unrestricted RLS access; the
    // cross-project path (which tells them "you are not assigned") is wrong
    // for them regardless of why the bundle came back empty.
    if (identity.isGlobalAuthority) return;
    let cancelled = false;
    (async () => {
      setCrossProjectDetail(undefined);
      try {
        const fallback = await fetchGlobalMonthlyReportDetail(reportId);
        if (cancelled) return;
        setCrossProjectDetail(fallback);
        if (fallback) {
          const directory = await fetchGlobalRegisterProjects();
          if (cancelled) return;
          setCrossProjectProject(
            directory.find((p) => p.id === fallback.projectId) ?? null
          );
        }
      } catch {
        if (!cancelled) setCrossProjectDetail(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bundle, reportId, identity.resolved, identity.isGlobalAuthority]);

  if (bundle === undefined) return <LoadingState label="Loading Monthly Report…" />;
  if (bundle === null) {
    // Admin / global-authority viewers: never show the cross-project banner
    // ("you are not assigned") — they have RLS access to all projects.  If
    // the bundle is still missing after identity resolves, that means the
    // report genuinely cannot be loaded (deleted, network error, etc.).
    if (identity.isGlobalAuthority) {
      return (
        <EmptyState
          title="Monthly Report not found"
          description="This report could not be loaded. It may have been deleted or a network error occurred."
          icon={FilePlus2}
        />
      );
    }
    if (crossProjectDetail === undefined) {
      return <LoadingState label="Loading Monthly Report…" />;
    }
    if (crossProjectDetail) {
      if (mode === "preview") {
        return (
          <EmptyState
            title="Print preview is not available for this report"
            description="This report is approved and viewable in read-only summary mode, but the full print/PDF layout needs department-level content that is only available inside its own project. Open the summary view instead."
            icon={FilePlus2}
            action={
              <Button variant="outline" asChild>
                <Link href={links.detail(reportId)}>Open Read-Only Summary</Link>
              </Button>
            }
          />
        );
      }
      return (
        <MonthlyReportCrossProjectView
          detail={crossProjectDetail}
          project={crossProjectProject}
          links={links}
        />
      );
    }
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
      <MonthlyPeriodBar report={bundle.report} siblings={siblings} links={links} />
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
        {/* Carried over from the removed in-page app bar. */}
        <Button asChild variant="outline">
          <Link href={links.weeklyList}>
            <CalendarDays />
            Weekly Reports
          </Link>
        </Button>
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

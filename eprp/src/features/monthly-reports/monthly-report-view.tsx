"use client";

/**
 * Monthly Report screens: the read-only document (detail) and the print stage
 * (preview). Authoring lives in the Workspace — see `monthly-workspace.tsx`.
 */

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { Eye, FilePlus2, PenLine, Plus, Printer, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/shared";
import { getMonthLabel } from "@/lib/reporting";
import { monthlyReportService } from "@/services/monthly-report-service";
import { siteConfig } from "@/config/site";
import type { MonthlyReport, Project } from "@/types";
import { MonthlyReportDocument, type MonthlyReportBundle } from "./monthly-report-document";
import { useMonthlyBundle } from "./use-monthly-bundle";

export { MonthlyReportsView, MonthlyNewView } from "./monthly-list-view";

/* --------------------------------- Chrome ---------------------------------- */

function MonthlyTopBar({ report, project, siblings }: { report: MonthlyReport; project: Project | null; siblings: MonthlyReport[] }) {
  const tabs = [report, ...siblings].sort((a, b) => b.reportingMonth.localeCompare(a.reportingMonth)).slice(0, 4);

  return (
    <div className="monthly-app-chrome print:hidden">
      <div className="monthly-app-bar">
        <Image src={siteConfig.logo.full} alt="EPROM" width={111} height={30} unoptimized />
        <strong>Monthly Progress Report</strong>
        <span className="monthly-app-divider" />
        <span className="monthly-project-selector">{project?.name ?? project?.shortName ?? project?.code ?? "Project"}</span>
        <Link href="/weekly-reports" className="monthly-chrome-button">
          ← Weekly Reports
        </Link>
        <Link href={`/monthly-reports/${report.id}/workspace`} className="monthly-chrome-button">
          <PenLine /> Workspace
        </Link>
        <Link href={`/monthly-reports/${report.id}/preview`} className="monthly-chrome-button">
          <Printer /> Print / Export PDF
        </Link>
      </div>
      <div className="monthly-month-tabs">
        <span>Monthly</span>
        {tabs.map((item) => (
          <Link key={item.id} className={item.id === report.id ? "active" : ""} href={`/monthly-reports/${item.id}`}>
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
      await monthlyReportService.compileFromWeeklies(reportId);
      await onDone();
      setLastSync(new Date().toLocaleTimeString());
      toast.success("Monthly items updated from Weekly Reports.");
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

export function MonthlyReportView({ reportId, mode = "detail" }: { reportId: string; mode?: "detail" | "preview" }) {
  const { bundle, siblings, reload } = useMonthlyBundle(reportId);

  if (bundle === undefined) return <LoadingState label="Loading Monthly Report…" />;
  if (bundle === null) {
    return <EmptyState title="Monthly Report not found" description="This report is unavailable or you do not have access to it." icon={FilePlus2} />;
  }

  if (mode === "preview") return <MonthlyPreviewStage bundle={bundle} />;

  const importedCount = bundle.comments.filter((comment) => comment.sourceKind === "weekly").length;

  return (
    <div className="monthly-screen-stage">
      <MonthlyTopBar report={bundle.report} project={bundle.project} siblings={siblings} />
      <WeeklyImportStrip reportId={bundle.report.id} importedCount={importedCount} onDone={reload} />
      <div className="monthly-stage-actions print:hidden">
        <Button asChild>
          <Link href={`/monthly-reports/${bundle.report.id}/workspace`}>
            <PenLine />
            Open Workspace
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={`/monthly-reports/${bundle.report.id}/preview`}>
            <Eye />
            Print Preview
          </Link>
        </Button>
      </div>
      <MonthlyReportDocument {...bundle} />
    </div>
  );
}

function MonthlyPreviewStage({ bundle }: { bundle: MonthlyReportBundle }) {
  return (
    <div className="monthly-preview-stage">
      <div className="monthly-preview-tools print:hidden">
        <Link href={`/monthly-reports/${bundle.report.id}`}>← Back to report</Link>
        <Button onClick={() => window.print()}>
          <Printer />
          Print / Export PDF
        </Button>
      </div>
      <MonthlyReportDocument {...bundle} />
    </div>
  );
}

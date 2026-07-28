"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, FileX, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyState,
  LoadingState,
  StatusBadge,
} from "@/components/shared";
import { siteConfig } from "@/config/site";
import { REPORT_STATUS_META } from "@/lib/constants";
import { formatDate } from "@/lib/formatters";
import { scheduleVariance } from "@/lib/reporting";
import { getContactById, getDepartmentById } from "@/features/master-data";
import { projectService } from "@/services/project-service";
import { weeklyReportService } from "@/services/weekly-report-service";
import { ActivitiesTable } from "./activities-table";
import type {
  Project,
  WeeklyActivity,
  WeeklyReport,
  WeeklySubmission,
} from "@/types";
import { SubmissionStatusBadge } from "./weekly-status-badge";

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

export interface WeeklyReportPreviewProps {
  reportId: string;
}

/** /weekly-reports/[reportId]/preview — print-ready summary. */
export function WeeklyReportPreview({ reportId }: WeeklyReportPreviewProps) {
  const [report, setReport] = React.useState<WeeklyReport | null | undefined>();
  const [submissions, setSubmissions] = React.useState<WeeklySubmission[]>([]);
  const [activities, setActivities] = React.useState<WeeklyActivity[]>([]);
  const [project, setProject] = React.useState<Project | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    weeklyReportService.getById(reportId).then(async (r) => {
      if (cancelled) return;
      setReport(r);
      if (r) {
        const [subs, proj, acts] = await Promise.all([
          weeklyReportService.listSubmissions(r.id),
          projectService.getProjectById(r.projectId),
          weeklyReportService.listActivities(r.id),
        ]);
        if (cancelled) return;
        setSubmissions(subs);
        setProject(proj);
        setActivities(acts);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  if (report === undefined) {
    return <LoadingState variant="page" label="Loading preview…" />;
  }

  if (report === null) {
    return (
      <EmptyState
        icon={FileX}
        title="Weekly report not found"
        description={`No weekly report exists with id “${reportId}”.`}
        action={
          <Button variant="outline" asChild>
            <Link href="/weekly-reports">Back to Weekly Reports</Link>
          </Button>
        }
      />
    );
  }

  const variance = scheduleVariance(report.plannedProgress, report.actualProgress);

  return (
    <div className="space-y-4">
      {/* Toolbar — hidden when printing */}
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/weekly-reports/${report.id}`}>
            <ArrowLeft data-icon="inline-start" aria-hidden="true" />
            Back to report
          </Link>
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer data-icon="inline-start" aria-hidden="true" />
          Print
        </Button>
      </div>

      {/* A4-style document */}
      <article className="mx-auto max-w-3xl space-y-6 rounded-xl bg-card p-6 ring-1 ring-foreground/10 sm:p-10 print:ring-0">
        <header className="flex items-start justify-between gap-4 border-b pb-4">
          <div>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {siteConfig.company}
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">
              Weekly Progress Report
            </h1>
            <p className="font-mono text-xs text-muted-foreground">
              {report.reportNumber}
            </p>
          </div>
          <StatusBadge tone={REPORT_STATUS_META[report.status].tone}>
            {REPORT_STATUS_META[report.status].label}
          </StatusBadge>
        </header>

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Cell label="Project" value={project?.name ?? "—"} />
          <Cell label="Project Code" value={project?.code ?? "—"} />
          <Cell label="Reporting Week" value={`Week ${report.weekNumber}`} />
          <Cell
            label="Period"
            value={`${formatDate(report.periodStart)} – ${formatDate(report.periodEnd)}`}
          />
          <Cell
            label="Prepared By"
            value={getContactById(report.preparedByContactId)?.name ?? "—"}
          />
          <Cell
            label="Reviewed By"
            value={getContactById(report.reviewedByContactId)?.name ?? "—"}
          />
        </dl>

        <section>
          <h2 className="mb-2 text-sm font-semibold">Progress Summary</h2>
          <dl className="grid grid-cols-3 gap-4 rounded-lg border p-4">
            <Cell label="Planned" value={`${report.plannedProgress}%`} />
            <Cell label="Actual" value={`${report.actualProgress}%`} />
            <Cell
              label="Schedule Variance"
              value={`${variance > 0 ? "+" : ""}${variance}%`}
            />
          </dl>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">Executive Summary</h2>
          <div className="rounded-lg border p-4">
            {report.summary ? (
              <p className="whitespace-pre-wrap text-sm text-pretty">
                {report.summary}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No executive summary recorded for this week.
              </p>
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">
            Major Activities Completed
          </h2>
          <ActivitiesTable activities={activities} />
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">
            Department Submissions
          </h2>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead className="text-right">Δ</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {submissions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                      No submissions.
                    </TableCell>
                  </TableRow>
                ) : (
                  submissions.map((sub) => (
                    <TableRow key={sub.id}>
                      <TableCell className="font-medium">
                        {getDepartmentById(sub.departmentId)?.name ??
                          sub.departmentId}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-pretty">
                        {sub.summary ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {typeof sub.progressDelta === "number"
                          ? `+${sub.progressDelta}%`
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <SubmissionStatusBadge status={sub.status} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </section>

        <footer className="border-t pt-4 text-xs text-muted-foreground">
          Generated by {siteConfig.fullName} · Not for external distribution.
        </footer>
      </article>
    </div>
  );
}

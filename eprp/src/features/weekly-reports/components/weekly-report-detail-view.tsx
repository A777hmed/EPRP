"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowRight,
  Copy,
  Eye,
  FileX,
  PenLine,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  ConfirmDialog,
  EmptyState,
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/shared";
import {
  KPI_RATING_META,
  PROGRESS_STATUS_META,
  REPORT_STATUS_META,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import { formatDate, formatNumber } from "@/lib/formatters";
import { calculateSpi, scheduleVariance } from "@/lib/reporting";
import { weeklyWorkflow, type WorkflowStatus } from "@/config/workflows";
import { getContactById } from "@/features/master-data";
import { projectService } from "@/services/project-service";
import { weeklyReportService } from "@/services/weekly-report-service";
import type { Project, ReportStatus, WeeklyReport, WeeklySubmission } from "@/types";
import {
  countReceived,
  isEditableReport,
  spiTone,
  varianceTone,
} from "@/features/weekly-reports/utils";
import { SubmissionStatusList } from "./submission-status-list";
import { WeeklyStatusBadge } from "./weekly-status-badge";

const toneClass = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
} as const;

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold tracking-tight tabular-nums", tone)}>
        {value}
      </p>
    </div>
  );
}

function ContactRow({ label, contactId }: { label: string; contactId?: string }) {
  const contact = getContactById(contactId);
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-dashed pb-1.5 last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{contact?.name ?? "—"}</dd>
    </div>
  );
}

/** Horizontal workflow stepper for the weekly main path. */
function WorkflowStepper({ status }: { status: ReportStatus }) {
  const path = weeklyWorkflow.mainPath;
  const currentIndex = path.indexOf(status as WorkflowStatus);
  return (
    <ol className="flex flex-wrap items-center gap-1.5">
      {path.map((step, i) => {
        const meta = REPORT_STATUS_META[step as ReportStatus];
        const state =
          currentIndex === -1
            ? "future"
            : i < currentIndex
              ? "done"
              : i === currentIndex
                ? "current"
                : "future";
        return (
          <li key={step} className="flex items-center gap-1.5">
            <span
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                state === "current" && "border-primary bg-primary text-primary-foreground",
                state === "done" && "border-success/25 bg-success/10 text-success",
                state === "future" && "border-border bg-muted text-muted-foreground"
              )}
            >
              {meta.label}
            </span>
            {i < path.length - 1 && (
              <ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export interface WeeklyReportDetailViewProps {
  reportId: string;
}

/** /weekly-reports/[reportId] — report overview + submission status. */
export function WeeklyReportDetailView({ reportId }: WeeklyReportDetailViewProps) {
  const router = useRouter();
  const [report, setReport] = React.useState<WeeklyReport | null | undefined>();
  const [submissions, setSubmissions] = React.useState<WeeklySubmission[]>([]);
  const [project, setProject] = React.useState<Project | null>(null);
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const [pendingStatus, setPendingStatus] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    weeklyReportService.getById(reportId).then(async (r) => {
      if (cancelled) return;
      setReport(r);
      if (r) {
        const [subs, proj] = await Promise.all([
          weeklyReportService.listSubmissions(r.id),
          projectService.getProjectById(r.projectId),
        ]);
        if (cancelled) return;
        setSubmissions(subs);
        setProject(proj);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [reportId, reloadKey]);

  if (report === undefined) {
    return <LoadingState variant="page" label="Loading weekly report…" />;
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
  const spi = calculateSpi(report.plannedProgress, report.actualProgress);
  const received = countReceived(submissions);
  const allowedTransitions = (
    weeklyWorkflow.transitions[report.status as WorkflowStatus] ?? []
  ).filter((t) => t !== "archived");

  const changeStatus = async (to: string) => {
    setPendingStatus(to);
    try {
      await weeklyReportService.changeStatus(report.id, to as ReportStatus);
      toast.success(`Moved to ${REPORT_STATUS_META[to as ReportStatus].label}`);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change status");
    } finally {
      setPendingStatus(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Weekly Reports"
        title={report.reportNumber}
        description={`${project?.shortName ?? project?.name ?? "Project"} · Week ${report.weekNumber} (${formatDate(report.periodStart)} – ${formatDate(report.periodEnd)})`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/weekly-reports/${report.id}/preview`}>
                <Eye data-icon="inline-start" aria-hidden="true" />
                Preview
              </Link>
            </Button>
            {isEditableReport(report) && (
              <Button variant="outline" asChild>
                <Link href={`/weekly-reports/${report.id}/edit`}>
                  <PenLine data-icon="inline-start" aria-hidden="true" />
                  Edit
                </Link>
              </Button>
            )}
            <Button
              variant="outline"
              onClick={async () => {
                const copy = await weeklyReportService.duplicate(report.id);
                toast.success("Weekly report duplicated");
                router.push(`/weekly-reports/${copy.id}`);
              }}
            >
              <Copy data-icon="inline-start" aria-hidden="true" />
              Duplicate
            </Button>
            {report.status !== "archived" && (
              <Button variant="destructive" onClick={() => setArchiveOpen(true)}>
                <Archive data-icon="inline-start" aria-hidden="true" />
                Archive
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <WeeklyStatusBadge status={report.status} />
          <span className="text-xs text-muted-foreground">
            Source: {report.source.replace("_", " ")}
          </span>
        </div>
      </PageHeader>

      {/* Workflow + transitions */}
      <SectionCard
        title="Workflow"
        description="Weekly report lifecycle."
        action={
          allowedTransitions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {allowedTransitions.map((to) => (
                <Button
                  key={to}
                  size="sm"
                  variant={
                    to === "rejected" || to === "returned"
                      ? "outline"
                      : "default"
                  }
                  disabled={pendingStatus !== null}
                  onClick={() => changeStatus(to)}
                >
                  Move to {REPORT_STATUS_META[to as ReportStatus].label}
                </Button>
              ))}
            </div>
          ) : undefined
        }
      >
        <WorkflowStepper status={report.status} />
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <SectionCard
            title="Progress & KPIs"
            description="Variance and SPI are derived from planned vs. actual progress."
          >
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <Metric label="Planned" value={`${report.plannedProgress}%`} />
              <Metric label="Actual" value={`${report.actualProgress}%`} />
              <Metric
                label="Variance"
                value={`${variance > 0 ? "+" : ""}${variance}%`}
                tone={toneClass[varianceTone(variance)]}
              />
              <Metric
                label="SPI"
                value={spi.toFixed(2)}
                tone={toneClass[spiTone(spi)]}
              />
              <Metric
                label="Man-hours"
                value={
                  typeof report.manHoursToDate === "number"
                    ? formatNumber(report.manHoursToDate)
                    : "—"
                }
              />
              <Metric
                label="Submissions"
                value={`${received}/${submissions.length}`}
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">HSE</span>
                {report.hseStatus ? (
                  <StatusBadge tone={KPI_RATING_META[report.hseStatus].tone}>
                    {KPI_RATING_META[report.hseStatus].label}
                  </StatusBadge>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Quality</span>
                {report.qualityStatus ? (
                  <StatusBadge tone={KPI_RATING_META[report.qualityStatus].tone}>
                    {KPI_RATING_META[report.qualityStatus].label}
                  </StatusBadge>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Overall</span>
                {report.overallProgressStatus ? (
                  <StatusBadge
                    tone={
                      PROGRESS_STATUS_META[report.overallProgressStatus].tone
                    }
                  >
                    {PROGRESS_STATUS_META[report.overallProgressStatus].label}
                  </StatusBadge>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Submission Status by Department"
            description="Department input for this reporting week."
          >
            <SubmissionStatusList submissions={submissions} />
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title="Report Information">
            <dl className="space-y-2">
              <ContactRow label="Prepared by" contactId={report.preparedByContactId} />
              <ContactRow label="Reviewed by" contactId={report.reviewedByContactId} />
              <ContactRow label="Approved by" contactId={report.approvedByContactId} />
            </dl>
            <Separator className="my-3" />
            <p className="text-xs text-muted-foreground tabular-nums">
              Created {formatDate(report.createdAt)} · Updated{" "}
              {formatDate(report.updatedAt)}
            </p>
          </SectionCard>

          {project && (
            <SectionCard title="Project" description="Linked project master data.">
              <p className="text-sm font-medium">
                <Link href={`/projects/${project.id}`} className="hover:underline">
                  {project.name}
                </Link>
              </p>
              <p className="font-mono text-xs text-muted-foreground">
                {project.code}
              </p>
              <div className="mt-2">
                <StatusBadge tone="info">
                  {project.departments.length} departments
                </StatusBadge>
              </div>
            </SectionCard>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={`Archive ${report.reportNumber}?`}
        description="Archived reports are hidden from the active list but remain in project history."
        confirmLabel="Archive report"
        destructive
        onConfirm={async () => {
          await weeklyReportService.archive(report.id);
          toast.success("Weekly report archived");
          setArchiveOpen(false);
          router.push("/weekly-reports");
        }}
      />
    </div>
  );
}

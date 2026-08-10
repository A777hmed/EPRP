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
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  ConfirmDialog,
  EmptyState,
  LoadingState,
  SectionCard,
  StatusBadge,
} from "@/components/shared";
import {
  KPI_RATING_META,
  REPORT_STATUS_META,
  SCHEDULE_RECOMMENDATION_META,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import { formatDate, formatNumber } from "@/lib/formatters";
import {
  calculateSpi,
  recommendScheduleStatus,
  scheduleVariance,
} from "@/lib/reporting";
import { weeklyWorkflow, type WorkflowStatus } from "@/config/workflows";
import { getContactById, getProjectTypeById } from "@/features/master-data";
import { projectService } from "@/services/project-service";
import { weeklyReportService } from "@/services/weekly-report-service";
import type {
  Project,
  ReportStatus,
  WeeklyActivity,
  WeeklyEntry,
  WeeklyReport,
  WeeklySubmission,
} from "@/types";
import {
  belongsToScopeProject,
  resolveWeeklyScope,
  weeklyEditability,
  type WeeklyEditability,
  type WeeklyScope,
} from "../scope";
import { buildWeeklyWorkspace } from "../workspace";
import { countReceived, isEditableReport, spiTone } from "../utils";
import { ActivitiesTable } from "./activities-table";
import { WeeklyDepartmentsPanel } from "./weekly-departments-panel";
import { WeeklyProgressSummary } from "./weekly-progress-summary";
import { WeeklyWorkspaceHeader } from "./weekly-workspace-header";

const toneClass = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
} as const;

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
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
  /**
   * The viewer's scope, resolved on the server against the auth cookie.
   *
   * Null means it could not be resolved — either the platform is running on
   * mock data (`demoMode`) or the report could not be read as this user. The
   * component never derives authority for itself in the authenticated case;
   * doing so would be a second, weaker copy of the rule that row-level
   * security already enforces.
   */
  viewerScope: WeeklyScope | null;
  editability: WeeklyEditability | null;
  /**
   * The lifecycle status the server saw. Editability is re-derived from the
   * committed rule when the loaded report has moved on since — the answer must
   * follow the report, not the render that fetched it.
   */
  serverReportStatus: ReportStatus | null;
  demoMode: boolean;
  viewerName?: string;
  viewerRoleLabel?: string;
}

/** /weekly-reports/[reportId] — the Weekly workspace for one project. */
export function WeeklyReportDetailView({
  reportId,
  viewerScope,
  editability: serverEditability,
  serverReportStatus,
  demoMode,
  viewerName,
  viewerRoleLabel,
}: WeeklyReportDetailViewProps) {
  const router = useRouter();
  const [report, setReport] = React.useState<WeeklyReport | null | undefined>();
  const [submissions, setSubmissions] = React.useState<WeeklySubmission[]>([]);
  const [activities, setActivities] = React.useState<WeeklyActivity[]>([]);
  const [entries, setEntries] = React.useState<WeeklyEntry[]>([]);
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
        const [subs, proj, acts, rows] = await Promise.all([
          weeklyReportService.listSubmissions(r.id),
          projectService.getProjectById(r.projectId),
          weeklyReportService.listActivities(r.id),
          weeklyReportService.listEntries(r.id),
        ]);
        if (cancelled) return;
        setSubmissions(subs);
        setProject(proj);
        setActivities(acts);
        setEntries(rows);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [reportId, reloadKey]);

  /*
   * Mock data has no login, so nothing can identify a viewer. Rather than
   * inventing a client-side rule for that case, the same resolver is called
   * with administrator standing and the situation is stated on screen — the
   * demo is open by definition, and there is no real data to protect.
   */
  const scope = React.useMemo<WeeklyScope | null>(() => {
    if (viewerScope) return viewerScope;
    if (!demoMode || !project) return null;
    return resolveWeeklyScope(project, "", {
      isAdmin: true,
      projectType: getProjectTypeById(project.projectTypeId),
    });
  }, [viewerScope, demoMode, project]);

  const editability = React.useMemo<WeeklyEditability>(() => {
    if (!scope) {
      return {
        canEdit: false,
        reason:
          "Your access to this report could not be resolved, so it is read-only.",
      };
    }
    if (!report) return { canEdit: false };
    if (serverEditability && serverReportStatus === report.status) {
      return serverEditability;
    }
    return weeklyEditability(scope, report.status);
  }, [scope, report, serverEditability, serverReportStatus]);

  /*
   * A scope is only ever valid for the project it was resolved against, so a
   * report whose project does not match it renders nothing rather than
   * borrowing another project's authority.
   */
  const workspace = React.useMemo(() => {
    if (!report || !project || !scope) return null;
    if (!belongsToScopeProject(scope, project.id)) return null;
    return buildWeeklyWorkspace(project, report, submissions, scope, entries);
  }, [report, project, scope, submissions, entries]);

  /**
   * Fold a saved row back in by id, so the department's completion state and
   * the form's own baseline both move to what the database returned — and the
   * next save updates that row instead of creating a second one.
   */
  const handleSaved = React.useCallback((saved: WeeklySubmission) => {
    setSubmissions((current) => {
      const index = current.findIndex((s) => s.id === saved.id);
      if (index === -1) return [...current, saved];
      const next = [...current];
      next[index] = saved;
      return next;
    });
  }, []);

  /** Same fold for narrative rows: by id, so a save never appends a twin. */
  const handleEntrySaved = React.useCallback((saved: WeeklyEntry) => {
    setEntries((current) => {
      const index = current.findIndex((e) => e.id === saved.id);
      if (index === -1) return [...current, saved];
      const next = [...current];
      next[index] = saved;
      return next;
    });
  }, []);

  const handleEntryDeleted = React.useCallback((entryId: string) => {
    setEntries((current) => current.filter((e) => e.id !== entryId));
  }, []);

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
      <WeeklyWorkspaceHeader
        report={report}
        project={project}
        viewerName={viewerName}
        viewerRoleLabel={viewerRoleLabel}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/weekly-reports/${report.id}/preview`}>
                <Eye data-icon="inline-start" aria-hidden="true" />
                Preview
              </Link>
            </Button>
            {isEditableReport(report) && editability.canEdit && (
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
      />

      {/* Why this report is read-only, said once and up front. */}
      {!editability.canEdit && editability.reason && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/10 px-4 py-3 text-sm text-warning"
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {editability.reason}
        </p>
      )}

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
                    to === "rejected" || to === "returned" ? "outline" : "default"
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
          {workspace && <WeeklyProgressSummary summary={workspace.summary} />}

          {workspace ? (
            <WeeklyDepartmentsPanel
              reportId={report.id}
              workspace={workspace}
              canEdit={editability.canEdit}
              onSaved={handleSaved}
              onEntrySaved={handleEntrySaved}
              onEntryDeleted={handleEntryDeleted}
            />
          ) : (
            <SectionCard
              title="Departments"
              description="Department input for this reporting week."
            >
              <p className="text-sm text-muted-foreground">
                {project
                  ? "Department input cannot be shown until your access to this project is resolved."
                  : "Loading the project this report belongs to…"}
              </p>
            </SectionCard>
          )}

          <SectionCard
            title="Major Activities Completed"
            description="Significant activities delivered in this reporting week."
          >
            <ActivitiesTable activities={activities} />
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard
            title="Key Indicators"
            description="Derived from planned against actual progress."
            contentClassName="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <Metric label="SPI" value={spi.toFixed(2)} tone={toneClass[spiTone(spi)]} />
              <Metric
                label="Man-hours"
                value={
                  typeof report.manHoursToDate === "number"
                    ? formatNumber(report.manHoursToDate)
                    : "—"
                }
              />
              <Metric label="Submissions" value={`${received}/${submissions.length}`} />
              <div>
                <p className="text-xs text-muted-foreground">Recommendation</p>
                <div className="mt-1">
                  <StatusBadge
                    tone={
                      SCHEDULE_RECOMMENDATION_META[recommendScheduleStatus(variance)]
                        .tone
                    }
                  >
                    {
                      SCHEDULE_RECOMMENDATION_META[recommendScheduleStatus(variance)]
                        .label
                    }
                  </StatusBadge>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-3">
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
            </div>
          </SectionCard>

          <SectionCard title="Report Information">
            <dl className="space-y-2">
              <ContactRow label="Prepared by" contactId={report.preparedByContactId} />
              <ContactRow label="Reviewed by" contactId={report.reviewedByContactId} />
              <ContactRow label="Approved by" contactId={report.approvedByContactId} />
            </dl>
            <Separator className="my-3" />
            <p className="text-xs tabular-nums text-muted-foreground">
              Created {formatDate(report.createdAt)} · Updated{" "}
              {formatDate(report.updatedAt)} · Source{" "}
              {report.source.replace("_", " ")}
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

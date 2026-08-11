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
import {
  ConfirmDialog,
  EmptyState,
  LoadingState,
  SectionCard,
} from "@/components/shared";
import { REPORT_STATUS_META } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { weeklyWorkflow, type WorkflowStatus } from "@/config/workflows";
import { getProjectTypeById } from "@/features/master-data";
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
import { countReceived, isEditableReport } from "../utils";
import { ActivitiesTable } from "./activities-table";
import { useWeeklyNameLookup } from "./weekly-department-section";
import { WeeklyDepartmentsPanel } from "./weekly-departments-panel";
import { WeeklyLookahead } from "./weekly-lookahead";
import { WeeklyProgressSummary } from "./weekly-progress-summary";
import { WeeklyProjectEntries } from "./weekly-project-entries";
import { WeeklyReportInformation } from "./weekly-report-information";
import { WeeklyWorkspaceHeader } from "./weekly-workspace-header";

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

  /*
   * Master-data names for the project-level sections. Resolved here, beside
   * the panel's own lookup, because both subscribe to the same lazily
   * hydrated stores and a name resolved twice is still one subscription set.
   * Called before the early returns below — it is a hook.
   */
  const names = useWeeklyNameLookup();

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

      {/*
        The report reads top to bottom the way a printed one does: what the
        week achieved, then who reported it, then what it needs. The old
        two-thirds/one-third split put the KPI card beside the departments and
        the sign-off in a sidebar, which is a dashboard shape — and it is not
        the shape the Print sprint has to walk.
      */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
        <WorkflowStepper status={report.status} />
        <div className="flex flex-wrap items-center gap-3">
          {/*
            The Monthly roll-up, counted from `include_in_monthly` on the rows
            this viewer can reach. Monthly compilation is not built; this only
            says how much has been flagged for it.
          */}
          {workspace && workspace.markedForMonthly > 0 && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {workspace.markedForMonthly} item
              {workspace.markedForMonthly === 1 ? "" : "s"} marked for Monthly
            </span>
          )}
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
      </div>

      {workspace && (
        <WeeklyProgressSummary
          summary={workspace.summary}
          manHoursToDate={report.manHoursToDate}
          hseStatus={report.hseStatus}
          qualityStatus={report.qualityStatus}
          submissionsReceived={received}
          submissionsTotal={submissions.length}
        />
      )}

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
        action={
          activities.length > 0 ? (
            <span className="text-xs tabular-nums text-muted-foreground">
              {activities.length} recorded
            </span>
          ) : undefined
        }
      >
        <ActivitiesTable
          activities={activities}
          emptyMessage="No major activities recorded for this week. They are added on the report edit form."
        />
      </SectionCard>

      {workspace && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <WeeklyProjectEntries
              variant="critical"
              title="Critical Issues / Risks"
              description="Open risks and issues raised on this report."
              entries={workspace.criticalItems}
              names={names}
              emptyMessage="No open risks or issues on this report."
            />
            <WeeklyProjectEntries
              variant="decision"
              title="Required Decisions / Management Support"
              description="Items escalated for a decision at project level."
              entries={workspace.decisionItems}
              names={names}
              emptyMessage="Nothing is currently escalated for a decision."
            />
          </div>

          <WeeklyLookahead
            lines={workspace.lookahead}
            names={names}
            scopeItemLabel={workspace.scopeItemLabel}
          />
        </>
      )}

      <WeeklyReportInformation report={report} />

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

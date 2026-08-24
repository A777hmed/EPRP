"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowLeft,
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
import { getProjectTypeById, useMasterData } from "@/features/master-data";
import { projectService } from "@/services/project-service";
import { weeklyReportService } from "@/services/weekly-report-service";
import type {
  Contact,
  Department,
  Project,
  ReportSignatory,
  ReportStatus,
  WeeklyActivity,
  WeeklyEntry,
  WeeklyPlanItem,
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
import { WeeklySignoffPanel, useContactTitle } from "./weekly-signoff-panel";
import { WeeklyDepartmentsPanel } from "./weekly-departments-panel";
import { resolveDepartmentRecipients } from "../weekly-recipients";
import {
  WeeklyDistributionPanel,
  distributionStateOf,
  type DistributionRow,
} from "./weekly-distribution-panel";
import { WeeklyLookahead } from "./weekly-lookahead";
import { WeeklyProgressSummary } from "./weekly-progress-summary";
import { WeeklyProjectEntries } from "./weekly-project-entries";
import { WeeklyReportInformation } from "./weekly-report-information";
import { WeeklyWorkspaceHeader } from "./weekly-workspace-header";
import {
  MonthlyReportTray,
  PreviousWeekSnapshot,
  WeeklyAlerts,
  type PreviousWeeklyData,
} from "./weekly-insights";
import { WeeklyProjectControlPlan } from "./weekly-project-control-plan";

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
  backHref?: string;
  mode?: "detail" | "workspace";
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
  backHref,
  mode = "detail",
}: WeeklyReportDetailViewProps) {
  const router = useRouter();
  const [report, setReport] = React.useState<WeeklyReport | null | undefined>();
  const [submissions, setSubmissions] = React.useState<WeeklySubmission[]>([]);
  const [activities, setActivities] = React.useState<WeeklyActivity[]>([]);
  const [entries, setEntries] = React.useState<WeeklyEntry[]>([]);
  const [planItems, setPlanItems] = React.useState<WeeklyPlanItem[]>([]);
  const [previousRaw, setPreviousRaw] = React.useState<{
    report: WeeklyReport;
    submissions: WeeklySubmission[];
    entries: WeeklyEntry[];
    planItems: WeeklyPlanItem[];
  } | null>(null);
  const [project, setProject] = React.useState<Project | null>(null);
  const [projectLoadState, setProjectLoadState] = React.useState<
    "loading" | "ready" | "error"
  >("loading");
  const [reportLoadError, setReportLoadError] = React.useState<string | null>(
    null
  );
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
  /*
   * The clock for 'overdue', read once when the view mounts.
   *
   * A lazy state initialiser, not a call in the render body: reading the clock
   * on every render would let a row flip to Overdue mid-interaction. It settles
   * on reload, which is when the rest of this view refreshes anyway.
   */
  const [nowMs] = React.useState(() => Date.now());
  const { records: contactRecords } = useMasterData("contact");
  const { records: departmentRecords } = useMasterData("department");
  const contacts = contactRecords as Contact[];

  /*
   * Prepared By seed — the project's Reporting Coordinator.
   *
   * Read from PROJECT RESPONSIBILITY, never from the signed-in account: who is
   * looking at a report says nothing about who prepared it, and defaulting to
   * the logged-in System Administrator is exactly the behaviour this replaces.
   * Empty when the project has no coordinator recorded, which prints a blank
   * signature line rather than inventing a name.
   */
  const titleOf = useContactTitle();
  const defaultPrepared = React.useMemo<ReportSignatory[]>(() => {
    const coordinatorId = project?.reportingCoordinatorId;
    if (!coordinatorId) return [];
    const contact = contacts.find((entry) => entry.id === coordinatorId);
    if (!contact) return [];
    return [
      {
        id: contact.id,
        contactId: contact.id,
        name: contact.name,
        title: titleOf(contact),
      },
    ];
  }, [project?.reportingCoordinatorId, contacts, titleOf]);

  React.useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setReport(undefined);
      setReportLoadError(null);
      setProject(null);
      setProjectLoadState("loading");
      setSubmissions([]);
      setActivities([]);
      setEntries([]);
      setPlanItems([]);
      setPreviousRaw(null);

      try {
        const r = await weeklyReportService.getById(reportId);
        if (cancelled) return;
        setReport(r);
        if (!r) {
          setProjectLoadState("ready");
          return;
        }

        /*
         * Resolve every source independently. Project identity and department
         * scope are critical; optional planning/history data must never keep
         * them in a permanent loading state if one additive table is missing
         * or temporarily unavailable.
         */
        const [subs, proj, acts, rows, plans, reports] =
          await Promise.allSettled([
            weeklyReportService.listSubmissions(r.id),
            projectService.getProjectById(r.projectId),
            weeklyReportService.listActivities(r.id),
            weeklyReportService.listEntries(r.id),
            weeklyReportService.listPlanItems(r.id),
            weeklyReportService.list(),
          ]);
        if (cancelled) return;

        setSubmissions(subs.status === "fulfilled" ? subs.value : []);
        setActivities(acts.status === "fulfilled" ? acts.value : []);
        setEntries(rows.status === "fulfilled" ? rows.value : []);
        setPlanItems(plans.status === "fulfilled" ? plans.value : []);

        if (proj.status === "fulfilled") {
          setProject(proj.value);
          setProjectLoadState("ready");
        } else {
          setProject(null);
          setProjectLoadState("error");
        }

        const availableReports =
          reports.status === "fulfilled" ? reports.value : [];
        const previous = availableReports
          .filter(
            (candidate) =>
              candidate.projectId === r.projectId &&
              candidate.id !== r.id &&
              candidate.periodEnd < r.periodStart
          )
          .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
        if (!previous) return;

        const [previousSubmissions, previousEntries, previousPlans] =
          await Promise.allSettled([
            weeklyReportService.listSubmissions(previous.id),
            weeklyReportService.listEntries(previous.id),
            weeklyReportService.listPlanItems(previous.id),
          ]);
        if (cancelled) return;
        setPreviousRaw({
          report: previous,
          submissions:
            previousSubmissions.status === "fulfilled"
              ? previousSubmissions.value
              : [],
          entries:
            previousEntries.status === "fulfilled"
              ? previousEntries.value
              : [],
          planItems:
            previousPlans.status === "fulfilled" ? previousPlans.value : [],
        });
      } catch (error) {
        if (cancelled) return;
        setReport(null);
        setProjectLoadState("error");
        setReportLoadError(
          error instanceof Error
            ? error.message
            : "The Weekly report could not be loaded."
        );
      }
    };

    void load();
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
    return resolveWeeklyScope(
      project,
      project.projectControlManagerId ??
        project.reportingCoordinatorId ??
        project.projectManagerId,
      {
      isAdmin: false,
      projectType: getProjectTypeById(project.projectTypeId),
      }
    );
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

  const previous = React.useMemo<PreviousWeeklyData | null>(() => {
    if (!previousRaw || !project || !scope) return null;
    if (!belongsToScopeProject(scope, previousRaw.report.projectId)) return null;
    return {
      report: previousRaw.report,
      entries: previousRaw.entries,
      planItems: previousRaw.planItems,
      workspace: buildWeeklyWorkspace(
        project,
        previousRaw.report,
        previousRaw.submissions,
        scope,
        previousRaw.entries
      ),
    };
  }, [previousRaw, project, scope]);

  const effectiveScope = React.useMemo(() => {
    if (!scope || !workspace) return "Access unresolved";
    if (scope.capability === "all_projects" || scope.capability === "project") {
      return "Full project workspace";
    }
    return workspace.departments
      .map((department) => {
        const departmentName = names.department(department.departmentId)?.name ?? "Department";
        if (department.seesWholeDepartment) return departmentName;
        const itemNames = department.scopeItems
          .filter((item) => !item.detached)
          .map((item) => names.scopeItem(item.scopeItemId)?.name ?? workspace.scopeItemLabel);
        return `${departmentName} > ${itemNames.join(", ") || "assigned scope"}`;
      })
      .join(" · ");
  }, [scope, workspace, names]);

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
        title={reportLoadError ? "Weekly report could not be loaded" : "Weekly report not found"}
        description={
          reportLoadError ?? `No weekly report exists with id “${reportId}”.`
        }
        action={
          <Button variant="outline" asChild>
            <Link href="/weekly-reports">Back to Weekly Reports</Link>
          </Button>
        }
      />
    );
  }

  const received = countReceived(submissions);

  /*
   * Distribution rows: one per in-scope department, from data that already
   * exists. The department-level submission (no scope item) carries the
   * distribution timing, because that is the row seeded for the department when
   * the Weekly was created. Manager and contributors resolve from project
   * assignments where recorded and say so plainly where they are not.
   */
  /*
   * Distribution rows: one per department in the WEEKLY SCOPE.
   *
   * Recipients come from the project ROSTER (Project.team, scoped to the
   * department) plus the department master-data lead — not from past
   * submissions. Phase 1 read submissions, which reports history rather than
   * assignment and is empty for a Weekly nobody has filled in yet.
   */
  const distributionRows: DistributionRow[] = workspace
    ? workspace.departments.map((section) => {
        const recipients = resolveDepartmentRecipients(
          project,
          section.departmentId,
          departmentRecords as Department[],
          contacts
        );
        const submission =
          section.submissions.find((entry) => !entry.disciplineId) ?? section.submissions[0];

        return {
          departmentId: section.departmentId,
          departmentName: recipients.departmentName,
          recipients,
          submission,
          state: distributionStateOf(submission, nowMs),
          lastActivity:
            submission?.reviewedAt ?? submission?.submittedAt ?? submission?.sentAt,
        } satisfies DistributionRow;
      })
    : [];

  const handleReloadSubmissions = async () => {
    const next = await weeklyReportService.listSubmissions(report.id);
    setSubmissions(next);
  };
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
        viewerName={viewerName ?? names.person(scope?.contactId)?.name}
        viewerRoleLabel={viewerRoleLabel ?? (demoMode ? "Project Control (demo)" : undefined)}
        mode={mode}
        effectiveScope={effectiveScope}
        canEdit={mode === "workspace" && editability.canEdit}
        editBlockedReason={editability.reason}
        actions={
          <>
            {mode === "workspace" && (
              <Button variant="outline" asChild>
                <Link href={backHref ?? `/weekly-reports/${report.id}`}>
                  <ArrowLeft data-icon="inline-start" aria-hidden="true" />
                  Back to report
                </Link>
              </Button>
            )}
            {mode === "detail" && (
              <Button variant="outline" asChild>
                <Link href={`/weekly-reports/${report.id}/workspace`}>
                  <ArrowRight data-icon="inline-start" aria-hidden="true" />
                  Open Workspace
                </Link>
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link href={`/weekly-reports/${report.id}/preview`}>
                <Eye data-icon="inline-start" aria-hidden="true" />
                Preview
              </Link>
            </Button>
            {mode === "detail" && isEditableReport(report) && editability.canEdit && (
              <Button variant="outline" asChild>
                <Link href={`/weekly-reports/${report.id}/edit`}>
                  <PenLine data-icon="inline-start" aria-hidden="true" />
                  Edit
                </Link>
              </Button>
            )}
            {mode === "detail" && <Button
              variant="outline"
              onClick={async () => {
                const copy = await weeklyReportService.duplicate(report.id);
                toast.success("Weekly report duplicated");
                router.push(`/weekly-reports/${copy.id}`);
              }}
            >
              <Copy data-icon="inline-start" aria-hidden="true" />
              Duplicate
            </Button>}
            {mode === "detail" && report.status !== "archived" && (
              <Button variant="destructive" onClick={() => setArchiveOpen(true)}>
                <Archive data-icon="inline-start" aria-hidden="true" />
                Archive
              </Button>
            )}
          </>
        }
      />

      {/* Why this report is read-only, said once and up front. */}
      {mode === "workspace" && !editability.canEdit && editability.reason && (
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
          {scope?.canConsolidate && allowedTransitions.map((to) => (
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

      {mode === "detail" && workspace && (
        <WeeklyAlerts
          report={report}
          workspace={workspace}
          planItems={planItems}
          previous={previous}
          names={names}
        />
      )}

      {mode === "detail" && workspace && (
        <WeeklyProgressSummary
          summary={workspace.summary}
          manHoursToDate={report.manHoursToDate}
          hseStatus={report.hseStatus}
          qualityStatus={report.qualityStatus}
          submissionsReceived={received}
          submissionsTotal={submissions.length}
        />
      )}

      {mode === "detail" && (
        <PreviousWeekSnapshot previous={previous} names={names} />
      )}

      {/*
        Distribution & Follow-up.

        Shown only to viewers who may consolidate the project Weekly — Admin,
        Project Control and Reporting Coordinator. `canConsolidate` is the
        platform's existing predicate for exactly that authority, so department
        contributors never see these controls and no new role list is invented.
      */}
      {workspace && scope?.canConsolidate && report && (
        <WeeklyDistributionPanel
          reportId={report.id}
          reportNumber={report.reportNumber}
          projectId={report.projectId}
          /* Every department assigned to the project — the scope candidates.
             Sourced from the project, so a department from another project can
             never appear. */
          projectDepartments={(project?.departments ?? []).map((assignment) => ({
            id: assignment.departmentId,
            name:
              (departmentRecords as Department[]).find(
                (record) => record.id === assignment.departmentId
              )?.name ?? "Department",
          }))}
          canEditScope={editability.canEdit}
          rows={distributionRows}
          onChanged={handleReloadSubmissions}
        />
      )}

      {workspace ? (
        <WeeklyDepartmentsPanel
          reportId={report.id}
          workspace={workspace}
          canEdit={mode === "workspace" && editability.canEdit}
          viewerContactId={scope?.contactId}
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
            {projectLoadState === "loading"
              ? "Loading the project this report belongs to…"
              : projectLoadState === "error"
                ? "The project for this report could not be loaded."
                : project
                  ? "Department input cannot be shown until your access to this project is resolved."
                  : "The project for this report is not available."}
          </p>
        </SectionCard>
      )}

      {mode === "detail" && <SectionCard
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
      </SectionCard>}

      {workspace && scope && (
        <WeeklyProjectControlPlan
          key={report.id}
          reportId={report.id}
          reportStatus={report.status}
          project={project}
          names={names}
          terms={scope.terms}
          periodStart={report.periodStart}
          periodEnd={report.periodEnd}
          items={planItems}
          editable={
            mode === "workspace" &&
            editability.canEdit &&
            Boolean(scope?.canConsolidate)
          }
          onChange={setPlanItems}
        />
      )}

      {mode === "detail" && workspace && (
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

      {workspace && (
        <MonthlyReportTray
          workspace={workspace}
          names={names}
          weekNumber={report.weekNumber}
        />
      )}

      {/*
        Sign-off is authored in the WORKSPACE only and printed once, at the end
        of the PDF. It is deliberately not repeated in the read-only detail view
        or mid-document.
      */}
      {mode === "workspace" && (
        <WeeklySignoffPanel
          reportId={report.id}
          contacts={contacts}
          defaultPrepared={defaultPrepared}
          saved={report.signatories}
          editable={editability.canEdit}
          onSaved={(signatories) =>
            setReport((current) => (current ? { ...current, signatories } : current))
          }
        />
      )}

      {mode === "detail" && <WeeklyReportInformation report={report} />}

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={`Archive ${report.reportNumber}?`}
        description="Archived reports are hidden from the active list but remain in project history."
        confirmLabel="Archive report"
        destructive
        onConfirm={async () => {
          /*
           * Navigation happens ONLY after the archive actually succeeded.
           *
           * This had no catch, so a refused archive left the rejection
           * unhandled — nothing was shown and the user had to infer the
           * outcome. Navigating away on failure would be worse still: it would
           * imply the report had been archived when it had not.
           */
          try {
            await weeklyReportService.archive(report.id);
            toast.success("Weekly report archived");
            setArchiveOpen(false);
            router.push("/weekly-reports");
          } catch (error) {
            // Stay on the report. Its status is unchanged and still displayed.
            toast.error(
              error instanceof Error
                ? error.message
                : "Could not archive this weekly report."
            );
          }
        }}
      />
    </div>
  );
}

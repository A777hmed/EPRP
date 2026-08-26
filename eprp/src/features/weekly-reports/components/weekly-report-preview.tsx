"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, FileX, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, StatusBadge } from "@/components/shared";
import {
  ACTIVITY_STATUS_META,
  ENTRY_STATUS_META,
  PRIORITY_META,
  PROGRESS_STATUS_META,
  REPORT_STATUS_META,
  SCHEDULE_RECOMMENDATION_META,
  SUBMISSION_STATUS_META,
} from "@/lib/constants";
import { formatDate } from "@/lib/formatters";
import { getContactById, getProjectTypeById } from "@/features/master-data";
import { projectService } from "@/services/project-service";
import { weeklyReportService } from "@/services/weekly-report-service";
import type {
  Project,
  ReportSignatory,
  WeeklyActivity,
  WeeklyEntry,
  WeeklyPlanItem,
  WeeklyReport,
  WeeklySubmission,
} from "@/types";
import { belongsToScopeProject, resolveWeeklyScope, type WeeklyScope } from "../scope";
import {
  buildWeeklyWorkspace,
  type DepartmentSection,
  type ScopeItemRow,
} from "../workspace";
import { useHierarchyTerms } from "../use-hierarchy-terms";
import { useWeeklyNameLookup } from "./weekly-department-section";
import { reachableWeeklyUpdates } from "./weekly-insights";
import { WeeklyWorkspaceHeader } from "./weekly-workspace-header";
import { weeklyCommentLabel } from "../weekly-update";

/**
 * One sign-off role, as it should print.
 *
 * Precedence: the saved snapshot verbatim, then the legacy contact column for
 * reports written before the snapshot existed, then "Not recorded" — never a
 * guessed name and never the signed-in account. Job titles print beside the
 * name because that is what the paper block shows.
 */
function SignoffCell({
  label,
  people,
  legacyName,
}: {
  label: string;
  people: ReportSignatory[] | undefined;
  legacyName: string | undefined;
}) {
  /*
   * Each signatory is its own block, never joined into one string.
   * Concatenating them ("A — Eng; B — Mgr") reads as a sentence rather than a
   * signature list, and on paper it has to sit above a signature line per
   * person — which a single run of text cannot provide.
   */
  const rendered = people?.length
    ? people.map((person) => (
        <span key={person.id} className="block">
          <span className="font-medium">{person.name}</span>
          {person.title && (
            <span className="block text-xs text-muted-foreground">{person.title}</span>
          )}
        </span>
      ))
    : null;

  return (
    <div className="grid gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="grid gap-1.5 text-sm">
        {rendered ?? <span>{legacyName ?? "Not recorded"}</span>}
      </dd>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-pretty">{value}</dd>
    </div>
  );
}

function Section({
  title,
  children,
  breakable = false,
}: {
  title: string;
  children: React.ReactNode;
  breakable?: boolean;
}) {
  return (
    <section className={breakable ? undefined : "break-inside-avoid"}>
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** A short labelled fact on one line. Used where a table column would not fit. */
function Meta({ items }: { items: (string | undefined | false)[] }) {
  const shown = items.filter(Boolean) as string[];
  if (shown.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground text-pretty">
      {shown.join(" · ")}
    </p>
  );
}

/**
 * One scope item, stacked rather than tabled.
 *
 * The preview used to render department input as an eight-column table, which
 * needed 1208px inside a 686px page and therefore scrolled sideways — unusable
 * on screen and meaningless on paper. Each row is now a block that wraps, so
 * the same content fits any width and will fit an A4 column when Print lands.
 */
function ScopeItemBlock({
  row,
  itemLabel,
  systemLabel,
  responsibleLabel,
  ownerName,
}: {
  row: ScopeItemRow;
  itemLabel: string;
  systemLabel?: string;
  responsibleLabel?: string;
  ownerName: (id?: string) => string | undefined;
}) {
  const submission = row.submission;
  const status = submission?.status ?? "pending";
  const narratives = [
    {
      label: "Weekly Update / Current Progress",
      value: submission?.summary,
    },
    { label: "Key Achievement", value: submission?.keyAchievement },
    { label: "Delay / Constraint", value: submission?.delayConstraint },
    { label: "Next Week Plan", value: submission?.nextWeekPlan },
  ].filter(({ value }) => Boolean(value));

  return (
    <article className="weekly-scope-item break-inside-avoid rounded-lg border bg-background p-3">
      <dl className="weekly-scope-header grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border">
        <div className="min-w-0 bg-card p-2">
          <dt className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
            Name
          </dt>
          <dd className="weekly-print-wrap text-sm font-semibold">{itemLabel}</dd>
        </div>
        <div className="min-w-0 bg-card p-2">
          <dt className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
            System
          </dt>
          <dd className="weekly-print-wrap text-sm font-medium">
            {systemLabel ?? "Not assigned"}
          </dd>
        </div>
        <div className="min-w-0 bg-card p-2">
          <dt className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
            Progress
          </dt>
          <dd className="text-sm font-semibold tabular-nums">
            {typeof submission?.progressPercent === "number"
              ? `${submission.progressPercent}%`
              : "—"}
          </dd>
        </div>
        <div className="min-w-0 bg-card p-2">
          <dt className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
            Status
          </dt>
          <dd className="min-w-0 pt-0.5">
            <span className="inline-flex max-w-full">
              <StatusBadge tone={SUBMISSION_STATUS_META[status].tone}>
                {row.reported
                  ? SUBMISSION_STATUS_META[status].label
                  : "Not reported"}
              </StatusBadge>
            </span>
          </dd>
        </div>
        <div className="weekly-scope-responsible col-span-2 min-w-0 bg-card p-2 sm:col-span-4">
          <dt className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
            Responsible Person
          </dt>
          <dd className="weekly-print-wrap text-sm font-medium">
            {responsibleLabel ?? "Not assigned"}
          </dd>
        </div>
      </dl>

      {row.detached && (
        <p className="mt-2 text-xs text-muted-foreground">
          No longer in project scope
        </p>
      )}

      {narratives.length > 0 && (
        <dl className="weekly-narratives mt-3 space-y-2">
          {narratives.map(({ label, value }) => (
            <div
              key={label}
              className="weekly-narrative-block border-l-[3px] border-l-[#0b3f7c] bg-muted/30 px-3 py-2"
            >
              <dt className="text-[0.6875rem] font-semibold tracking-wide text-[#0b3f7c] uppercase">
                {label}
              </dt>
              <dd className="weekly-print-wrap mt-0.5 text-sm whitespace-pre-wrap">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {row.entries.length > 0 && (
        <div className="mt-3">
          <h5 className="mb-1.5 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">
            Weekly Comments / Updates
          </h5>
          <table className="weekly-updates-table w-full table-fixed border-collapse text-left text-xs">
            <colgroup>
              <col className="w-[15%]" />
              <col className="w-[43%]" />
              <col className="w-[18%]" />
              <col className="w-[10%]" />
              <col className="w-[14%]" />
            </colgroup>
            <thead>
              <tr className="border-y bg-muted/60 text-muted-foreground">
                <th className="px-2 py-1.5 font-semibold">Type</th>
                <th className="px-2 py-1.5 font-semibold">Update</th>
                <th className="px-2 py-1.5 font-semibold">Author</th>
                <th className="px-2 py-1.5 font-semibold">Priority</th>
                <th className="px-2 py-1.5 font-semibold">Monthly</th>
              </tr>
            </thead>
            <tbody>
              {row.entries.map((entry) => (
                <tr key={entry.id} className="border-b align-top last:border-0">
                  <td className="weekly-print-wrap px-2 py-2 font-medium">
                    {weeklyCommentLabel(entry)}
                  </td>
                  <td className="weekly-print-wrap px-2 py-2 whitespace-pre-wrap">
                    {entry.description}
                  </td>
                  <td className="weekly-print-wrap px-2 py-2">
                    {ownerName(entry.createdByContactId) ??
                      "Legacy / not recorded"}
                  </td>
                  <td className="weekly-print-wrap px-2 py-2">
                    {PRIORITY_META[entry.priority].label}
                  </td>
                  <td className="weekly-print-wrap px-2 py-2">
                    {entry.includeInMonthly ? (
                      <span className="font-semibold text-[#0b3f7c]">
                        ★ Monthly
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

export interface WeeklyReportPreviewProps {
  reportId: string;
  /** Resolved on the server, exactly as the workspace route does. */
  viewerScope: WeeklyScope | null;
  demoMode: boolean;
}

/**
 * /weekly-reports/[reportId]/preview — the report as a document.
 *
 * Reads the SAME canonical data the workspace does: one
 * `buildWeeklyWorkspace()` call gives the progress summary, the departments
 * with their scope items, the project-level lists and the lookahead, already
 * filtered to the viewer's scope. Nothing is fetched or derived a second way,
 * so the preview cannot show a different report from the workspace, and the
 * Print sprint has one shape to render rather than two to reconcile.
 */
export function WeeklyReportPreview({
  reportId,
  viewerScope,
  demoMode,
}: WeeklyReportPreviewProps) {
  const [report, setReport] = React.useState<WeeklyReport | null | undefined>();
  const [submissions, setSubmissions] = React.useState<WeeklySubmission[]>([]);
  const [activities, setActivities] = React.useState<WeeklyActivity[]>([]);
  const [entries, setEntries] = React.useState<WeeklyEntry[]>([]);
  const [planItems, setPlanItems] = React.useState<WeeklyPlanItem[]>([]);
  const [project, setProject] = React.useState<Project | null>(null);
  const [projectLoadState, setProjectLoadState] = React.useState<
    "loading" | "ready" | "error"
  >("loading");
  const [reportLoadError, setReportLoadError] = React.useState<string | null>(
    null
  );
  const names = useWeeklyNameLookup();
  const terms = useHierarchyTerms(project);

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

      try {
        const r = await weeklyReportService.getById(reportId);
        if (cancelled) return;
        setReport(r);
        if (!r) {
          setProjectLoadState("ready");
          return;
        }

        // Preview must keep its project/scope even if an optional section
        // fails; it reads the same canonical services as the workspace.
        const [subs, proj, acts, rows, plans] = await Promise.allSettled([
          weeklyReportService.listSubmissions(r.id),
          projectService.getProjectById(r.projectId),
          weeklyReportService.listActivities(r.id),
          weeklyReportService.listEntries(r.id),
          weeklyReportService.listPlanItems(r.id),
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
      } catch (error) {
        if (cancelled) return;
        setReport(null);
        setProjectLoadState("error");
        setReportLoadError(
          error instanceof Error
            ? error.message
            : "The Weekly preview could not be loaded."
        );
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  // Mock data carries no login; the situation is stated rather than guessed at.
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

  const workspace = React.useMemo(() => {
    if (!report || !project || !scope) return null;
    if (!belongsToScopeProject(scope, project.id)) return null;
    return buildWeeklyWorkspace(project, report, submissions, scope, entries);
  }, [report, project, scope, submissions, entries]);

  if (report === undefined) {
    return <LoadingState variant="page" label="Loading preview…" />;
  }

  if (report === null) {
    return (
      <EmptyState
        icon={FileX}
        title={reportLoadError ? "Weekly preview could not be loaded" : "Weekly report not found"}
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

  const summary = workspace?.summary;
  const reading = summary
    ? SCHEDULE_RECOMMENDATION_META[summary.reading]
    : undefined;
  const stated = summary?.overallStatus
    ? PROGRESS_STATUS_META[summary.overallStatus]
    : undefined;

  const personName = (id?: string) => names.person(id)?.name;

  const departmentBlock = (section: DepartmentSection) => {
    const department = names.department(section.departmentId);
    const manager = personName(section.managerContactId);
    const rows = [...section.scopeItems].sort(
      (a, b) =>
        Number(a.detached) - Number(b.detached) ||
        (names.scopeItem(a.scopeItemId)?.name ?? "").localeCompare(
          names.scopeItem(b.scopeItemId)?.name ?? ""
        )
    );

    return (
      <section
        key={section.departmentId}
        className="weekly-department-block space-y-3"
      >
        <header className="weekly-department-heading flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border-l-4 border-l-[#0b3f7c] bg-[#0b3f7c]/5 px-3 py-2">
          <h3 className="text-sm font-semibold">
            {department?.name ?? "Unknown department"}
            {department?.code && (
              <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                {department.code}
              </span>
            )}
          </h3>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {section.scopeItemsReported}/{section.scopeItemsExpected} reported
          </span>
          <StatusBadge tone="neutral">{section.stateLabel}</StatusBadge>
          {manager && (
            <p className="basis-full text-xs text-muted-foreground">
              Manager: {manager}
            </p>
          )}
        </header>

        {section.overallUpdate?.summary && (
          <div className="weekly-narrative-block rounded-md border bg-muted/20 px-3 py-2">
            <p className="text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">
              Department Overall Update
            </p>
            <p className="weekly-print-wrap mt-0.5 text-sm whitespace-pre-wrap">
              {section.overallUpdate.summary}
            </p>
          </div>
        )}

        {rows.length === 0 ? (
          <p className="mt-1.5 text-sm text-muted-foreground">
            No {terms.pluralLower} are assigned to this department.
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <ScopeItemBlock
                key={row.scopeItemId}
                row={row}
                itemLabel={
                  names.scopeItem(row.scopeItemId)?.name ?? "Unnamed item"
                }
                systemLabel={names.system(row.systemId)?.name}
                responsibleLabel={
                  row.responsible.length > 0
                    ? row.responsible
                        .map((entry) => personName(entry.contactId) ?? "Unknown")
                        .join(", ")
                    : undefined
                }
                ownerName={personName}
              />
            ))}
          </div>
        )}
      </section>
    );
  };

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
      <article className="weekly-print-document mx-auto max-w-[210mm] space-y-6 rounded-xl bg-card p-6 ring-1 ring-foreground/10 sm:p-10 print:ring-0">
        <WeeklyWorkspaceHeader
          report={report}
          project={project}
          mode="preview"
          qrHref={`/weekly-reports/${report.id}`}
        />
        <dl className="hidden">
          <Cell label="Project" value={project?.name ?? "—"} />
          <Cell label="Project Code" value={project?.code ?? "—"} />
          <Cell label="Reporting Week" value={`Week ${report.weekNumber}`} />
          <Cell
            label="Period"
            value={`${formatDate(report.periodStart)} – ${formatDate(report.periodEnd)}`}
          />
          <Cell
            label="Prepared By"
            value={
              getContactById(report.preparedByContactId)?.name ?? "Not recorded"
            }
          />
          <Cell
            label="Reviewed By"
            value={
              getContactById(report.reviewedByContactId)?.name ?? "Not recorded"
            }
          />
        </dl>

        <Section title="Progress Summary">
          <dl className="grid grid-cols-2 gap-4 rounded-lg border p-4 sm:grid-cols-4">
            <Cell label="Planned" value={`${report.plannedProgress}%`} />
            <Cell label="Actual" value={`${report.actualProgress}%`} />
            <Cell
              label="Schedule Variance"
              value={
                summary
                  ? `${summary.variance > 0 ? "+" : ""}${summary.variance}%`
                  : "—"
              }
            />
            <Cell label="SPI" value={summary ? summary.spi.toFixed(2) : "—"} />
          </dl>
          {summary && (
            <p className="mt-2 text-xs text-muted-foreground">
              Weekly Progress Status:{" "}
              <span className="font-medium text-foreground">
                {(stated ?? reading)?.label}
              </span>
              {!summary.statusAgrees && stated && reading && (
                <>
                  {" "}
                  — a variance of {summary.variance > 0 ? "+" : ""}
                  {summary.variance} points reads {reading.label} against the
                  reporting thresholds.
                </>
              )}
            </p>
          )}
        </Section>

        <Section title="Executive Summary">
          <div className="rounded-lg border p-4">
            {report.summary ? (
              <p className="text-sm whitespace-pre-wrap text-pretty">
                {report.summary}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No executive summary recorded for this week.
              </p>
            )}
          </div>
        </Section>

        <Section title="Major Activities Completed">
          {activities.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No major activities recorded for this week.
            </p>
          ) : (
            <ol className="space-y-2">
              {[...activities]
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((activity, index) => (
                  <li
                    key={activity.id}
                    className="break-inside-avoid border-b border-dashed pb-2 last:border-0"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {index + 1}.
                      </span>
                      <span className="text-sm font-medium">
                        {activity.title}
                      </span>
                      <span className="ml-auto flex items-center gap-2">
                        {typeof activity.progressPercent === "number" && (
                          <span className="text-xs tabular-nums">
                            {activity.progressPercent}%
                          </span>
                        )}
                        <StatusBadge
                          tone={ACTIVITY_STATUS_META[activity.status].tone}
                        >
                          {ACTIVITY_STATUS_META[activity.status].label}
                        </StatusBadge>
                      </span>
                    </div>
                    <Meta
                      items={[
                        names.department(activity.departmentId)?.name,
                        names.scopeItem(activity.disciplineId)?.name,
                        personName(activity.ownerContactId),
                        activity.remarks,
                      ]}
                    />
                  </li>
                ))}
            </ol>
          )}
        </Section>

        <Section title={`Department Updates — ${terms.plural}`} breakable>
          {!workspace ? (
            <p className="text-sm text-muted-foreground">
              {projectLoadState === "loading"
                ? "Loading the project this report belongs to…"
                : projectLoadState === "error"
                  ? "The project for this report could not be loaded."
                  : "Department input cannot be shown until your access to this project is resolved."}
            </p>
          ) : workspace.departments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No departments in this report are within your access.
            </p>
          ) : (
            <div className="space-y-6">
              {workspace.departments.map(departmentBlock)}
            </div>
          )}
        </Section>

        {workspace && workspace.criticalItems.length > 0 && (
          <Section title="Critical Issues / Risks">
            <ul className="space-y-1.5">
              {workspace.criticalItems.map((entry) => (
                <li key={entry.id} className="break-inside-avoid text-pretty">
                  <span className="text-sm">{entry.description}</span>
                  <Meta
                    items={[
                      PRIORITY_META[entry.priority].label,
                      ENTRY_STATUS_META[entry.status].label,
                      names.department(entry.departmentId)?.name,
                      personName(entry.ownerContactId),
                    ]}
                  />
                </li>
              ))}
            </ul>
          </Section>
        )}

        {workspace && workspace.decisionItems.length > 0 && (
          <Section title="Required Decisions / Management Support">
            <ul className="space-y-1.5">
              {workspace.decisionItems.map((entry) => (
                <li key={entry.id} className="break-inside-avoid text-pretty">
                  <span className="text-sm">{entry.description}</span>
                  <Meta
                    items={[
                      PRIORITY_META[entry.priority].label,
                      names.department(entry.departmentId)?.name,
                      personName(entry.ownerContactId),
                      entry.dueDate && `due ${formatDate(entry.dueDate)}`,
                    ]}
                  />
                </li>
              ))}
            </ul>
          </Section>
        )}

        {workspace && workspace.actionItems.length > 0 && (
          <Section title="Key Actions">
            <ul className="space-y-1.5">
              {workspace.actionItems.map((entry) => (
                <li key={entry.id} className="break-inside-avoid text-pretty">
                  <span className="text-sm">{entry.description}</span>
                  <Meta
                    items={[
                      PRIORITY_META[entry.priority].label,
                      ENTRY_STATUS_META[entry.status].label,
                      names.department(entry.departmentId)?.name,
                      personName(entry.ownerContactId),
                      entry.dueDate && `due ${formatDate(entry.dueDate)}`,
                    ]}
                  />
                </li>
              ))}
            </ul>
          </Section>
        )}

        {workspace && workspace.commentItems.length > 0 && (
          <Section title="Key Comments">
            <ul className="space-y-1.5">
              {workspace.commentItems.map((entry) => (
                <li key={entry.id} className="break-inside-avoid text-pretty">
                  <span className="text-sm">{entry.description}</span>
                  <Meta
                    items={[
                      PRIORITY_META[entry.priority].label,
                      names.department(entry.departmentId)?.name,
                      personName(entry.ownerContactId),
                    ]}
                  />
                </li>
              ))}
            </ul>
          </Section>
        )}

        {planItems.length > 0 && (
          <Section
            title="PROJECT CONTROL — LOOK-AHEAD & NEXT WEEK PLAN"
            breakable
          >
            <table className="weekly-project-control-table w-full table-fixed border-collapse text-left text-xs">
              <colgroup>
                <col className="w-[42%]" />
                <col className="w-[23%]" />
                <col className="w-[20%]" />
                <col className="w-[15%]" />
              </colgroup>
              <thead>
                <tr className="border-y bg-muted/60 text-muted-foreground">
                  <th className="px-2 py-1.5 font-semibold">
                    Activity / Milestone
                  </th>
                  <th className="px-2 py-1.5 font-semibold">Date / Period</th>
                  <th className="px-2 py-1.5 font-semibold">Owner</th>
                  <th className="px-2 py-1.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...planItems]
                  .sort(
                    (a, b) =>
                      a.kind.localeCompare(b.kind) ||
                      a.sortOrder - b.sortOrder ||
                      a.endDate.localeCompare(b.endDate)
                  )
                  .map((item) => (
                    <tr
                      key={item.id}
                      className="break-inside-avoid border-b align-top last:border-0"
                    >
                      <td className="weekly-print-wrap px-2 py-2">
                        <span className="block text-[0.625rem] font-semibold tracking-wide text-[#0b3f7c] uppercase">
                          {item.kind === "milestone"
                            ? "Look-Ahead Milestone"
                            : "Next Week Project Task"}
                        </span>
                        <span className="font-medium">{item.title}</span>
                      </td>
                      <td className="weekly-print-wrap px-2 py-2">
                        {item.startDate && item.startDate !== item.endDate
                          ? `${formatDate(item.startDate)} – ${formatDate(item.endDate)}`
                          : formatDate(item.endDate)}
                      </td>
                      <td className="weekly-print-wrap px-2 py-2">
                        {personName(item.ownerContactId) ??
                          names.department(item.departmentId)?.name ??
                          "Project Control"}
                      </td>
                      <td className="weekly-print-wrap px-2 py-2 capitalize">
                        {item.status.replaceAll("_", " ")}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Section>
        )}

        {workspace && reachableWeeklyUpdates(workspace).some((entry) => entry.includeInMonthly) && (
          <Section title="Monthly-Flagged Important Items">
            <ul className="space-y-2">
              {reachableWeeklyUpdates(workspace).filter((entry) => entry.includeInMonthly).map((entry) => (
                <li key={entry.id} className="break-inside-avoid border-b border-dashed pb-2 text-sm last:border-0">
                  <span className="font-medium">{weeklyCommentLabel(entry)}: </span>{entry.description}
                  <Meta items={[names.department(entry.departmentId)?.name, names.system(entry.systemId)?.name, names.scopeItem(entry.disciplineId)?.name, personName(entry.createdByContactId)]} />
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Report Information">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {/*
              Sign-off prints from the SNAPSHOT saved in the workspace, falling
              back to the legacy contact-id columns for reports saved before the
              snapshot column existed. The snapshot is authoritative because it
              is what the author signed — re-resolving a Contact would let a
              later edit rewrite an issued report.
            */}
            <SignoffCell
              label="Prepared By"
              people={report.signatories?.prepared}
              legacyName={getContactById(report.preparedByContactId)?.name}
            />
            <SignoffCell
              label="Reviewed By"
              people={report.signatories?.reviewed}
              legacyName={getContactById(report.reviewedByContactId)?.name}
            />
            <SignoffCell
              label="Approved By"
              people={report.signatories?.approved}
              legacyName={getContactById(report.approvedByContactId)?.name}
            />
            <Cell label="Created" value={formatDate(report.createdAt)} />
            <Cell label="Last Updated" value={formatDate(report.updatedAt)} />
            <Cell
              label="Report Lifecycle Status"
              value={REPORT_STATUS_META[report.status].label}
            />
          </dl>
        </Section>

      </article>
    </div>
  );
}

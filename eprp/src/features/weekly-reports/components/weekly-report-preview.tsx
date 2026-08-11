"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, FileX, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, StatusBadge } from "@/components/shared";
import { siteConfig } from "@/config/site";
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
  WeeklyActivity,
  WeeklyEntry,
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
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="break-inside-avoid">
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

  return (
    <div className="break-inside-avoid border-b border-dashed py-2.5 last:border-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-medium">{itemLabel}</span>
        {systemLabel && (
          <span className="text-xs text-muted-foreground">· {systemLabel}</span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {typeof submission?.progressPercent === "number" && (
            <span className="text-xs font-medium tabular-nums">
              {submission.progressPercent}%
            </span>
          )}
          <StatusBadge tone={SUBMISSION_STATUS_META[status].tone}>
            {row.reported
              ? SUBMISSION_STATUS_META[status].label
              : "Not reported"}
          </StatusBadge>
        </span>
      </div>

      <Meta
        items={[
          responsibleLabel ?? "No responsible person assigned",
          row.detached && "No longer in project scope",
        ]}
      />

      {submission?.summary && (
        <p className="mt-1 text-sm whitespace-pre-wrap text-pretty">
          {submission.summary}
        </p>
      )}

      <dl className="mt-1 grid gap-x-6 gap-y-1 sm:grid-cols-3">
        {(
          [
            ["Key Achievement", submission?.keyAchievement],
            ["Delay / Constraint", submission?.delayConstraint],
            ["Next Week Plan", submission?.nextWeekPlan],
          ] as const
        )
          .filter(([, value]) => Boolean(value))
          .map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-sm whitespace-pre-wrap text-pretty">
                {value}
              </dd>
            </div>
          ))}
      </dl>

      {row.entries.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {row.entries.map((entry) => (
            <li key={entry.id} className="text-sm text-pretty">
              <span className="text-xs text-muted-foreground">Action · </span>
              {entry.description}
              <Meta
                items={[
                  PRIORITY_META[entry.priority].label,
                  ENTRY_STATUS_META[entry.status].label,
                  ownerName(entry.ownerContactId),
                  entry.dueDate && `due ${formatDate(entry.dueDate)}`,
                  entry.includeInMonthly && "In Monthly",
                ]}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
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
  const [project, setProject] = React.useState<Project | null>(null);
  const names = useWeeklyNameLookup();
  const terms = useHierarchyTerms(project);

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
  }, [reportId]);

  // Mock data carries no login; the situation is stated rather than guessed at.
  const scope = React.useMemo<WeeklyScope | null>(() => {
    if (viewerScope) return viewerScope;
    if (!demoMode || !project) return null;
    return resolveWeeklyScope(project, "", {
      isAdmin: true,
      projectType: getProjectTypeById(project.projectTypeId),
    });
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
      <div key={section.departmentId} className="break-inside-avoid">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-1">
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
        </div>
        <Meta items={[manager ? `Manager: ${manager}` : "No manager assigned"]} />

        {section.overallUpdate?.summary && (
          <div className="mt-1.5">
            <p className="text-xs text-muted-foreground">
              Department Overall Update
            </p>
            <p className="text-sm whitespace-pre-wrap text-pretty">
              {section.overallUpdate.summary}
            </p>
          </div>
        )}

        {rows.length === 0 ? (
          <p className="mt-1.5 text-sm text-muted-foreground">
            No {terms.pluralLower} are assigned to this department.
          </p>
        ) : (
          <div className="mt-1">
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
      </div>
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
      <article className="mx-auto max-w-3xl space-y-6 rounded-xl bg-card p-6 ring-1 ring-foreground/10 sm:p-10 print:ring-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
          <div className="min-w-0">
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

        {/* Singular reads as a compound noun — "Department and Discipline
            Updates", not "Department and Disciplines Updates". */}
        <Section title={`Department and ${terms.singular} Updates`}>
          {!workspace ? (
            <p className="text-sm text-muted-foreground">
              Department input cannot be shown until your access to this project
              is resolved.
            </p>
          ) : workspace.departments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No departments in this report are within your access.
            </p>
          ) : (
            <div className="space-y-4">
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

        {workspace && workspace.lookahead.length > 0 && (
          <Section title="Next Week Lookahead">
            <ul className="space-y-1">
              {workspace.lookahead.map((line, index) => (
                <li
                  key={`${line.departmentId}-${line.scopeItemId ?? "overall"}-${index}`}
                  className="text-sm text-pretty"
                >
                  <span className="text-xs text-muted-foreground">
                    {names.department(line.departmentId)?.name ?? "Department"}
                    {line.scopeItemId
                      ? ` · ${names.scopeItem(line.scopeItemId)?.name ?? "Item"}`
                      : " · Department-wide"}
                    {" — "}
                  </span>
                  {line.plan}
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Report Information">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Cell
              label="Approved By"
              value={
                getContactById(report.approvedByContactId)?.name ??
                "Not recorded"
              }
            />
            <Cell label="Created" value={formatDate(report.createdAt)} />
            <Cell label="Last Updated" value={formatDate(report.updatedAt)} />
            <Cell
              label="Report Lifecycle Status"
              value={REPORT_STATUS_META[report.status].label}
            />
          </dl>
        </Section>

        <footer className="border-t pt-4 text-xs text-muted-foreground">
          Generated by {siteConfig.fullName} · Not for external distribution.
        </footer>
      </article>
    </div>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import {
  CalendarDays,
  CalendarRange,
  FolderX,
  Gauge,
  PenLine,
  Repeat,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  EmptyState,
  LoadingState,
  PageHeader,
  type StatCardProps,
} from "@/components/shared";
import { formatDate } from "@/lib/formatters";
import { getContactById, useMasterData } from "@/features/master-data";
import { ReplacePersonDialog } from "../replace-person-dialog";
import type { FixedResponsibilityField } from "../../responsibilities";
import { WeeklyStatusBadge } from "@/features/weekly-reports/components/weekly-status-badge";
import { mockProjectActivity } from "@/data/mock/project-activity.mock";
import { projectService } from "@/services/project-service";
import { weeklyReportService } from "@/services/weekly-report-service";
import type { JobTitle, Project, WeeklyReport } from "@/types";
import {
  getProjectSection,
  localizeProjectSection,
  projectSectionHref,
  type ProjectSectionId,
} from "@/config/project-sections";
import { projectWorkflowHref } from "@/config/project-workflow";
import { formatVariance, projectSpi, projectVariance } from "../../utils";
import { ProgressComparison } from "../progress-comparison";
import { ProjectDetailsView } from "../project-details-view";
import { OrganizationChartSection } from "./organization-chart-section";
// [reporting-perf] TEMPORARY diagnostic import — remove with src/lib/perf-temp.ts
import { startTimer, timed } from "@/lib/perf-temp";
import { useHierarchyTerms } from "../../use-hierarchy-terms";
import {
  useProjectAuthority,
  type ProjectAuthority,
} from "../../use-project-authority";
import { ProjectScopeSection } from "./project-scope-section";
import { ProjectSectionLayout } from "./project-section-layout";
import { ProjectDocumentsPanel } from "../project-documents-panel";
import { MilestonesPanel } from "../milestones/milestones-panel";
import { DeliverablesPanel } from "../deliverables/deliverables-panel";
import { ProjectReportingWorkspace } from "./project-reporting-workspace";

export interface ProjectSectionViewProps {
  projectId: string;
  section: ProjectSectionId;
}

/**
 * `/projects/[projectId]/[section]` — renders one section of a project in the
 * main content area, with the project id preserved in the route.
 *
 * Overview keeps the existing full detail view untouched; every other section
 * is a focused page built on the shared dashboard-style layout.
 */
export function ProjectSectionView({
  projectId,
  section,
}: ProjectSectionViewProps) {
  const [project, setProject] = React.useState<Project | null | undefined>();
  const [weeklyReports, setWeeklyReports] = React.useState<WeeklyReport[]>([]);
  // Called before the early returns below — hooks cannot run conditionally.
  // Handles null/undefined by falling back to the default wording.
  const terms = useHierarchyTerms(project);
  // Same reason: resolved unconditionally, and returns an all-false authority
  // until both the project and the identity have settled, so no mutation
  // control can flash before the answer is known.
  const authority = useProjectAuthority(project);

  /*
   * Overview delegates to `ProjectDetailsView`, which loads the project and
   * the weekly reports for itself. Loading them here as well meant every
   * Overview open resolved the same project twice and the same weekly report
   * list twice — and neither copy was ever read, because this component
   * returns before it touches them.
   */
  const owningOverview = section === "overview";
  // Only two sections read `weeklyReports`; see `SectionBody` below. Everywhere
  // else the list — plus its submissions, entries and activities — was fetched
  // and discarded, four PostgREST requests per open on screens such as
  // Departments and Systems that never show a report.
  const needsWeeklyReports =
    section === "reporting" || section === "weekly-reports";

  // Re-fetches this same project — the one existing load path — so a mutation
  // made from within a section (Replace Person, so far) can bring the loaded
  // `project` current without a full page reload. Not used by the effect
  // below on purpose: the effect owns first load and the reporting/section
  // switch; this is only for "something changed the project, refresh it".
  const reloadProject = React.useCallback(() => {
    return projectService.getProjectById(projectId).then(setProject);
  }, [projectId]);

  React.useEffect(() => {
    if (owningOverview) return;
    // [reporting-perf] TEMPORARY — see src/lib/perf-temp.ts. Remove with it.
    const doneAll = startTimer("sectionView.effect.total");
    void timed("sectionView.getProjectById", () =>
      projectService.getProjectById(projectId)
    ).then(setProject);
    if (!needsWeeklyReports) {
      doneAll();
      return;
    }
    /* Was `list()` — the whole portfolio, plus every report's submissions,
       entries and activities — discarded down to one project in JavaScript.
       The filter belongs in the query. */
    void timed("sectionView.weeklyList", () =>
      weeklyReportService.list(projectId)
    )
      .then(setWeeklyReports)
      .finally(doneAll);
  }, [projectId, owningOverview, needsWeeklyReports]);

  // Overview is the existing project page; reuse it wholesale rather than
  // maintaining a second version of the same screen.
  if (owningOverview) {
    return <ProjectDetailsView projectId={projectId} />;
  }

  if (project === undefined) {
    return <LoadingState variant="page" label="Loading project…" />;
  }

  if (project === null) {
    return (
      <EmptyState
        icon={FolderX}
        title="Project not found"
        description={`No project exists with id “${projectId}”.`}
        action={
          <Button variant="outline" asChild>
            <Link href="/projects">Back to Projects</Link>
          </Button>
        }
      />
    );
  }

  const definition = localizeProjectSection(getProjectSection(section), terms);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${project.code} · ${project.shortName ?? project.name}`}
        title={definition.label}
        description={definition.description}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={projectSectionHref(project.id, "overview")}>
                Project Overview
              </Link>
            </Button>
            {/* Edit Project is `can_manage_project_setup()`, which the database
                defines as `can_manage_project_operations()`. It was offered to
                every reader, so a Department User was invited into a form whose
                every save RLS refused. */}
            {authority.canManageOperations && (
              <Button variant="outline" asChild>
                <Link href={`/projects/${project.id}/edit`}>
                  <PenLine data-icon="inline-start" aria-hidden="true" />
                  Edit Project
                </Link>
              </Button>
            )}
          </>
        }
      />

      <SectionBody
        project={project}
        section={section}
        weeklyReports={weeklyReports}
        authority={authority}
        reloadProject={reloadProject}
      />
    </div>
  );
}

function SectionBody({
  project,
  section,
  weeklyReports,
  authority,
  reloadProject,
}: {
  project: Project;
  section: ProjectSectionId;
  weeklyReports: WeeklyReport[];
  authority: ProjectAuthority;
  reloadProject: () => Promise<void>;
}) {
  const terms = useHierarchyTerms(project);
  const definition = localizeProjectSection(getProjectSection(section), terms);

  switch (section) {
    case "setup":
      return <SetupSection project={project} authority={authority} />;
    case "team":
      return (
        <TeamSection
          project={project}
          authority={authority}
          onReplaced={reloadProject}
        />
      );
    case "organization-chart":
      return <OrganizationChartSection project={project} />;
    case "departments":
    case "systems":
    case "disciplines":
    case "contacts":
      return (
        <ProjectScopeSection
          project={project}
          kind={section}
          sectionId={section}
          description={definition.description}
          onReplaced={reloadProject}
        />
      );
    case "kpis":
      return <KpiSection project={project} authority={authority} />;
    case "milestones":
      // The panel gates its own Add / Edit / Archive and approval queue
      // through `useMilestoneAuthority`, which mirrors the same policy.
      return <MilestonesSection project={project} />;
    case "deliverables":
      return <DeliverablesSection project={project} />;
    case "reporting":
      return (
        <ProjectReportingWorkspace
          project={project}
          weeklyReports={weeklyReports}
        />
      );
    case "weekly-reports":
      return (
        <WeeklyReportsSection
          project={project}
          reports={weeklyReports}
          authority={authority}
        />
      );
    case "monthly-reports":
      return (
        <MonthlyReportsSection project={project} authority={authority} />
      );
    case "documents":
      return <DocumentsSection project={project} />;
    case "attachments":
      return <RecordsPlaceholder section={section} />;
    case "history":
      return <HistorySection />;
    default:
      return null;
  }
}

/* ------------------------------- Sections -------------------------------- */

function SetupSection({
  project,
  authority,
}: {
  project: Project;
  authority: ProjectAuthority;
}) {
  const terms = useHierarchyTerms(project);
  return (
    <ProjectSectionLayout
      title="Guided setup"
      description="Work through the six steps to scope this project."
      quickActions={
        authority.canManageOperations ? (
          <Button asChild>
            <Link href={projectWorkflowHref(project.id, "info")}>
              Open setup wizard
            </Link>
          </Button>
        ) : undefined
      }
    >
      <p className="text-sm text-muted-foreground">
        The wizard walks through Project Info, Departments, Systems,{" "}
        {terms.plural}, Contacts, and Review — each step saving before it
        advances and unlocking the next one.
      </p>
      {authority.resolved && !authority.canManageOperations && (
        <p className="mt-3 text-sm text-muted-foreground">
          Project Setup is managed by Project Control for this project. You can
          review the resulting scope from the sections in the project sidebar.
        </p>
      )}
    </ProjectSectionLayout>
  );
}

function TeamSection({
  project,
  authority,
  onReplaced,
}: {
  project: Project;
  authority: ProjectAuthority;
  onReplaced: () => void | Promise<void>;
}) {
  /*
   * getContactById() below reads a synchronous cache that only hydrates once
   * something subscribes via useMasterData() — subscribe() is what lazily
   * triggers the load, and useSyncExternalStore is what re-renders this
   * component once it resolves. Nothing else on this page subscribes, so
   * landing here directly (no prior page warmed the same contact cache) left
   * every responsibility reading "Not assigned" — including a genuinely
   * assigned one — which also hid the Replace action below, since it renders
   * only when `contact` resolves. Pre-existing gap in getContactById/
   * getByIdSync, not introduced here; this is the smallest fix that makes
   * this section correct on a cold load without touching that cache itself.
   */
  useMasterData("contact");
  // Same lazy-load gap as `contact` above — nothing else on this page
  // subscribes to job titles either, and the additional-positions list below
  // resolves `jobTitleId` through this cache.
  const { records: jobTitleRecords } = useMasterData("jobTitle");
  const jobTitles = jobTitleRecords as JobTitle[];

  const responsibilities: {
    label: string;
    field: FixedResponsibilityField;
    id: string | undefined;
  }[] = [
    { label: "Project Manager", field: "projectManagerId", id: project.projectManagerId },
    { label: "Project Control", field: "projectControlManagerId", id: project.projectControlManagerId },
    { label: "Client Representative", field: "clientRepresentativeId", id: project.clientRepresentativeId },
    { label: "Reporting Coordinator", field: "reportingCoordinatorId", id: project.reportingCoordinatorId },
    { label: "Sponsor", field: "projectSponsorId", id: project.projectSponsorId },
  ];
  const filled = responsibilities.filter((role) => Boolean(role.id)).length;
  const team = project.team ?? [];

  const stats: StatCardProps[] = [
    {
      label: "Responsibilities set",
      value: `${filled} of ${responsibilities.length}`,
      icon: Users,
    },
    { label: "Team members linked", value: String(team.length) },
    {
      label: "Departments in scope",
      value: String(project.departments.length),
    },
  ];

  return (
    <ProjectSectionLayout
      stats={stats}
      title="Responsibilities"
      description="The five accountable roles on this project."
      quickActions={
        <>
          {/* Read-only visibility of WHO is accountable is deliberately kept
              for everyone; only the edit route is withheld. */}
          {authority.canManageOperations && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/projects/${project.id}/edit`}>Edit roles</Link>
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <Link href={projectSectionHref(project.id, "contacts")}>
              View contacts
            </Link>
          </Button>
        </>
      }
    >
      <dl className="space-y-2">
        {responsibilities.map((role) => {
          const contact = getContactById(role.id);
          return (
            <div
              key={role.label}
              className="flex items-baseline justify-between gap-2 border-b border-dashed pb-1.5 last:border-0"
            >
              <dt className="text-xs text-muted-foreground">{role.label}</dt>
              <dd className="flex items-center justify-end gap-1.5 text-right text-sm font-medium">
                {contact ? (
                  <>
                    <Link
                      href={`/contacts/${contact.id}`}
                      className="underline underline-offset-2"
                    >
                      {contact.name}
                    </Link>
                    {/* Same authority as "Edit roles" above — the UI must
                        never offer what can_manage_project_responsibilities()
                        would refuse. */}
                    {authority.canManageOperations && (
                      <ReplacePersonDialog
                        project={project}
                        unit={{
                          kind: "fixed_responsibility",
                          responsibilityField: role.field,
                        }}
                        responsibilityLabel={role.label}
                        currentContactId={contact.id}
                        onReplaced={onReplaced}
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6 text-muted-foreground hover:text-foreground"
                            aria-label={`Replace ${role.label}`}
                            title="Replace Person"
                          >
                            <Repeat className="size-3.5" aria-hidden="true" />
                          </Button>
                        }
                      />
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">Not assigned</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      {(project.positions ?? []).length > 0 && (
        <>
          <Separator className="my-4" />
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Additional positions
          </p>
          <dl className="space-y-2">
            {(project.positions ?? []).map((position) => {
              const contact = getContactById(position.contactId);
              const label =
                jobTitles.find((title) => title.id === position.jobTitleId)
                  ?.name ?? "Position not set";
              return (
                <div
                  key={position.id ?? `${position.jobTitleId}-${position.sortOrder}`}
                  className="flex items-baseline justify-between gap-2 border-b border-dashed pb-1.5 last:border-0"
                >
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="flex items-center justify-end gap-1.5 text-right text-sm font-medium">
                    {contact ? (
                      <>
                        <Link
                          href={`/contacts/${contact.id}`}
                          className="underline underline-offset-2"
                        >
                          {contact.name}
                        </Link>
                        {/* Replace requires a persisted position id — a row
                            can only reach this project via the setup wizard's
                            save, so this is always true in practice, but the
                            type keeps it optional. */}
                        {authority.canManageOperations && position.id && (
                          <ReplacePersonDialog
                            project={project}
                            unit={{
                              kind: "project_position",
                              positionId: position.id,
                            }}
                            responsibilityLabel={label}
                            currentContactId={contact.id}
                            onReplaced={onReplaced}
                            trigger={
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6 text-muted-foreground hover:text-foreground"
                                aria-label={`Replace ${label}`}
                                title="Replace Person"
                              >
                                <Repeat className="size-3.5" aria-hidden="true" />
                              </Button>
                            }
                          />
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">Not assigned</span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </>
      )}
    </ProjectSectionLayout>
  );
}

function KpiSection({
  project,
  authority,
}: {
  project: Project;
  authority: ProjectAuthority;
}) {
  const variance = projectVariance(project);
  const stats: StatCardProps[] = [
    { label: "Planned progress", value: `${project.plannedProgress}%` },
    { label: "Actual progress", value: `${project.actualProgress}%` },
    { label: "Schedule variance", value: formatVariance(variance) },
    { label: "SPI", value: projectSpi(project).toFixed(2), icon: Gauge },
  ];

  return (
    <ProjectSectionLayout
      stats={stats}
      title="Progress"
      description="Planned versus actual completion for this project."
      quickActions={
        <>
          {authority.canManageOperations && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/projects/${project.id}/edit`}>Update progress</Link>
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <Link href={projectSectionHref(project.id, "weekly-reports")}>
              Weekly reports
            </Link>
          </Button>
        </>
      }
    >
      <ProgressComparison
        planned={project.plannedProgress}
        actual={project.actualProgress}
        size="md"
      />
      <Separator className="my-3" />
      <p className="text-xs text-muted-foreground tabular-nums">
        Forecast finish:{" "}
        {project.forecastFinishDate
          ? formatDate(project.forecastFinishDate)
          : "—"}{" "}
        · Planned finish: {formatDate(project.plannedFinishDate)}
      </p>
    </ProjectSectionLayout>
  );
}

function WeeklyReportsSection({
  project,
  reports,
  authority,
}: {
  project: Project;
  reports: WeeklyReport[];
  authority: ProjectAuthority;
}) {
  const stats: StatCardProps[] = [
    { label: "Reports raised", value: String(reports.length), icon: CalendarDays },
    {
      label: "Weekly reporting",
      value: project.reporting.weeklyEnabled ? "Enabled" : "Disabled",
    },
    {
      label: "Reporting day",
      value:
        project.reporting.weeklyReportingDay.charAt(0).toUpperCase() +
        project.reporting.weeklyReportingDay.slice(1),
    },
  ];

  return (
    <ProjectSectionLayout
      stats={stats}
      title="Weekly reports"
      description="Reports raised for this project, newest first."
      action={
        // Raising a report is `can_manage_reporting_workflow()`. A Department
        // User contributes to a report they do not raise.
        // Project-scoped create: this section is already inside the project.
        authority.canManageReporting ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/projects/${project.id}/reports/weekly/new`}>
              New report
            </Link>
          </Button>
        ) : undefined
      }
      quickActions={
        <>
          {authority.canManageReporting && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/projects/${project.id}/reports/weekly/new`}>
                New weekly report
              </Link>
            </Button>
          )}
          {/* "This project's Weekly reporting", not the portfolio register —
              the label said "All weekly reports" while sitting inside one
              project, and the route it used left the project entirely. */}
          <Button variant="outline" size="sm" asChild>
            <Link href={`/projects/${project.id}/reporting?tab=weekly`}>
              Reporting workspace
            </Link>
          </Button>
        </>
      }
    >
      {reports.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No weekly reports yet"
          description="Reports raised for this project will be listed here."
          className="py-8"
        />
      ) : (
        <ul className="space-y-2">
          {reports.map((report) => (
            <li key={report.id}>
              <Link
                // This project's own report — keep project context.
                href={`/projects/${project.id}/reports/weekly/${report.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 transition-colors hover:bg-muted/50"
              >
                <span className="min-w-0">
                  <span className="block font-mono text-sm">
                    {report.reportNumber}
                  </span>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    Week {String(report.weekNumber).padStart(2, "0")} ·{" "}
                    {formatDate(report.periodStart)} –{" "}
                    {formatDate(report.periodEnd)}
                  </span>
                </span>
                <WeeklyStatusBadge status={report.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ProjectSectionLayout>
  );
}

function MonthlyReportsSection({
  project,
  authority,
}: {
  project: Project;
  authority: ProjectAuthority;
}) {
  const stats: StatCardProps[] = [
    {
      label: "Monthly reporting",
      value: project.reporting.monthlyEnabled ? "Enabled" : "Disabled",
      icon: CalendarRange,
    },
    {
      label: "Cut-off day",
      value: `Day ${project.reporting.monthlyCutoffDay}`,
    },
  ];

  return (
    <ProjectSectionLayout
      stats={stats}
      title="Monthly reports"
      description="Compiled from the approved weekly reports."
      quickActions={
        <>
          {authority.canManageReporting && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/projects/${project.id}/reports/monthly/new`}>
                New monthly report
              </Link>
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <Link href={`/projects/${project.id}/reporting?tab=monthly`}>
              Reporting workspace
            </Link>
          </Button>
        </>
      }
    >
      <EmptyState
        icon={CalendarRange}
        title="No monthly reports yet"
        description="Monthly reports appear here once the monthly module ships."
        className="py-8"
      />
    </ProjectSectionLayout>
  );
}

function RecordsPlaceholder({ section }: { section: ProjectSectionId }) {
  // Documents / attachments only — never the hierarchy section, so no
  // project-specific wording is needed here.
  const definition = getProjectSection(section);
  return (
    <ProjectSectionLayout
      title={definition.label}
      description={definition.description}
    >
      <EmptyState
        icon={definition.icon}
        title={`No ${definition.label.toLowerCase()} yet`}
        description={`${definition.label} for this project will be listed here once file storage ships.`}
        className="py-8"
      />
    </ProjectSectionLayout>
  );
}

function MilestonesSection({ project }: { project: Project }) {
  return (
    <ProjectSectionLayout
      title="Master Milestones"
      description="The one register a milestone exists in. Weekly and Monthly report against these — they never create their own."
    >
      <MilestonesPanel project={project} />
    </ProjectSectionLayout>
  );
}

function DeliverablesSection({ project }: { project: Project }) {
  return (
    <ProjectSectionLayout
      title="Master Deliverables"
      description="Submittable items and their client review position. Each links to the milestone it serves — the milestone register stays the only place a milestone is defined."
    >
      <DeliverablesPanel project={project} />
    </ProjectSectionLayout>
  );
}

function DocumentsSection({ project }: { project: Project }) {
  return (
    <ProjectSectionLayout
      title="Project Reference Documents"
      description="Official scope, planning, contract and other controlled Project references."
    >
      <ProjectDocumentsPanel projectId={project.id} />
    </ProjectSectionLayout>
  );
}

function HistorySection() {
  return (
    <ProjectSectionLayout
      title="History"
      description="Mock data until the audit trail ships."
    >
      <ol className="space-y-3">
        {mockProjectActivity.map((entry) => (
          <li key={entry.id} className="flex gap-2.5 text-sm">
            <span
              aria-hidden="true"
              className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
            />
            <div>
              <p className="text-pretty">{entry.text}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {entry.actor} · {formatDate(entry.at)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </ProjectSectionLayout>
  );
}

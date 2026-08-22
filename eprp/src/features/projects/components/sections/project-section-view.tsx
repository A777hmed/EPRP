"use client";

import * as React from "react";
import Link from "next/link";
import {
  CalendarDays,
  CalendarRange,
  FolderX,
  Gauge,
  PenLine,
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
import { getContactById } from "@/features/master-data";
import { WeeklyStatusBadge } from "@/features/weekly-reports/components/weekly-status-badge";
import { mockProjectActivity } from "@/data/mock/project-activity.mock";
import { projectService } from "@/services/project-service";
import { weeklyReportService } from "@/services/weekly-report-service";
import type { Project, WeeklyReport } from "@/types";
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
import { useHierarchyTerms } from "../../use-hierarchy-terms";
import { ProjectScopeSection } from "./project-scope-section";
import { ProjectSectionLayout } from "./project-section-layout";
import { ProjectDocumentsPanel } from "../project-documents-panel";
import { MilestonesPanel } from "../milestones/milestones-panel";
import { DeliverablesPanel } from "../deliverables/deliverables-panel";

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

  React.useEffect(() => {
    projectService.getProjectById(projectId).then(setProject);
    weeklyReportService
      .list()
      .then((reports) =>
        setWeeklyReports(
          reports.filter((report) => report.projectId === projectId)
        )
      );
  }, [projectId]);

  // Overview is the existing project page; reuse it wholesale rather than
  // maintaining a second version of the same screen.
  if (section === "overview") {
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
            <Button variant="outline" asChild>
              <Link href={`/projects/${project.id}/edit`}>
                <PenLine data-icon="inline-start" aria-hidden="true" />
                Edit Project
              </Link>
            </Button>
          </>
        }
      />

      <SectionBody
        project={project}
        section={section}
        weeklyReports={weeklyReports}
      />
    </div>
  );
}

function SectionBody({
  project,
  section,
  weeklyReports,
}: {
  project: Project;
  section: ProjectSectionId;
  weeklyReports: WeeklyReport[];
}) {
  const terms = useHierarchyTerms(project);
  const definition = localizeProjectSection(getProjectSection(section), terms);

  switch (section) {
    case "setup":
      return <SetupSection project={project} />;
    case "team":
      return <TeamSection project={project} />;
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
        />
      );
    case "kpis":
      return <KpiSection project={project} />;
    case "milestones":
      return <MilestonesSection project={project} />;
    case "deliverables":
      return <DeliverablesSection project={project} />;
    case "weekly-reports":
      return (
        <WeeklyReportsSection project={project} reports={weeklyReports} />
      );
    case "monthly-reports":
      return <MonthlyReportsSection project={project} />;
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

function SetupSection({ project }: { project: Project }) {
  const terms = useHierarchyTerms(project);
  return (
    <ProjectSectionLayout
      title="Guided setup"
      description="Work through the six steps to scope this project."
      quickActions={
        <Button asChild>
          <Link href={projectWorkflowHref(project.id, "info")}>
            Open setup wizard
          </Link>
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        The wizard walks through Project Info, Departments, Systems,{" "}
        {terms.plural}, Contacts, and Review — each step saving before it
        advances and unlocking the next one.
      </p>
    </ProjectSectionLayout>
  );
}

function TeamSection({ project }: { project: Project }) {
  const responsibilities = [
    { label: "Project Manager", id: project.projectManagerId },
    { label: "Project Control", id: project.projectControlManagerId },
    { label: "Client Representative", id: project.clientRepresentativeId },
    { label: "Reporting Coordinator", id: project.reportingCoordinatorId },
    { label: "Sponsor", id: project.projectSponsorId },
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
          <Button variant="outline" size="sm" asChild>
            <Link href={`/projects/${project.id}/edit`}>Edit roles</Link>
          </Button>
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
              <dd className="text-right text-sm font-medium">
                {contact ? (
                  <Link
                    href={`/contacts/${contact.id}`}
                    className="underline underline-offset-2"
                  >
                    {contact.name}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Not assigned</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </ProjectSectionLayout>
  );
}

function KpiSection({ project }: { project: Project }) {
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
          <Button variant="outline" size="sm" asChild>
            <Link href={`/projects/${project.id}/edit`}>Update progress</Link>
          </Button>
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
}: {
  project: Project;
  reports: WeeklyReport[];
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
        <Button variant="outline" size="sm" asChild>
          <Link href="/weekly-reports/new">New report</Link>
        </Button>
      }
      quickActions={
        <>
          <Button variant="outline" size="sm" asChild>
            <Link href="/weekly-reports/new">New weekly report</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/weekly-reports">All weekly reports</Link>
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
                href={`/weekly-reports/${report.id}`}
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

function MonthlyReportsSection({ project }: { project: Project }) {
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
          <Button variant="outline" size="sm" asChild>
            <Link href="/monthly-reports/new">New monthly report</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/monthly-reports">All monthly reports</Link>
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

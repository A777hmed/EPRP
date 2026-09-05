"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  CalendarDays,
  CalendarRange,
  FolderX,
  Paperclip,
  PenLine,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  EmptyState,
  LoadingState,
  SectionCard,
  StatusBadge,
} from "@/components/shared";
import { formatDate } from "@/lib/formatters";
import {
  getContactById,
  getDepartmentById,
  getProjectPhaseById,
  getProjectTypeById,
  useMasterData,
} from "@/features/master-data";
import { WeeklyStatusBadge } from "@/features/weekly-reports/components/weekly-status-badge";
import { mockProjectActivity } from "@/data/mock/project-activity.mock";
import { projectService } from "@/services/project-service";
import { weeklyReportService } from "@/services/weekly-report-service";
import type { Client, Discipline, Project, System, WeeklyReport } from "@/types";
import { formatVariance, projectSpi, projectVariance } from "../utils";
import { ProgressComparison } from "./progress-comparison";
import { ProjectSummaryHeader } from "./project-summary-header";
import { useHierarchyTerms } from "../use-hierarchy-terms";
import { useProjectAuthority } from "../use-project-authority";
import { ProjectWorkflowNav } from "./project-workflow-nav";
import {
  localizeProjectSections,
  projectSections,
  ProjectSectionNav,
} from "./project-section-nav";
import { ConfirmArchiveDialog } from "./confirm-archive-dialog";
import { departmentManager } from "../assignment-rules";
import { ProjectDocumentsPanel } from "./project-documents-panel";

function ContactRow({ label, contactId }: { label: string; contactId?: string }) {
  const contact = getContactById(contactId);
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-dashed pb-1.5 last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-right">
        {contact ? (
          <>
            {contact.name}
            {contact.email && (
              <span className="block text-xs font-normal text-muted-foreground">
                {contact.email}
              </span>
            )}
          </>
        ) : (
          "—"
        )}
      </dd>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-dashed pb-1.5 last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

/**
 * Scroll target for the side navigation. The scroll margin clears the sticky
 * chrome above it — the top bar plus, below `lg`, the horizontal section nav.
 * It must stay in step with `SCROLL_MARGIN_PX` in `project-section-nav`,
 * which is what decides the active section.
 */
function Section({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-32 lg:scroll-mt-28">
      {children}
    </section>
  );
}

export interface ProjectDetailsViewProps {
  projectId: string;
}

/** /projects/[projectId] — full project overview. */
export function ProjectDetailsView({ projectId }: ProjectDetailsViewProps) {
  const router = useRouter();
  const [project, setProject] = React.useState<Project | null | undefined>();
  const [weeklyReports, setWeeklyReports] = React.useState<WeeklyReport[]>([]);
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const { records: disciplineRecords } = useMasterData("discipline");
  const { records: systemRecords } = useMasterData("system");
  const { records: clientRecords } = useMasterData("client");
  const masterSystems = systemRecords as System[];
  const terms = useHierarchyTerms(project);
  /* Unconditional — hooks cannot sit behind the early returns below. Returns
     an all-false authority until both the project and the identity settle, so
     no mutation action can flash before the answer is known. */
  const authority = useProjectAuthority(project ?? null);

  React.useEffect(() => {
    projectService.getProjectById(projectId).then(setProject);
    // Project-scoped in the query rather than fetching the portfolio and
    // discarding it — see the same change in `project-section-view.tsx`.
    weeklyReportService.list(projectId).then(setWeeklyReports);
  }, [projectId]);

  if (project === undefined) {
    return <LoadingState variant="page" label="Loading project…" />;
  }

  if (project === null) {
    return (
      <EmptyState
        icon={FolderX}
        title="Project not found"
        description={`No project exists with id “${projectId}”. It may have been removed.`}
        action={
          <Button variant="outline" asChild>
            <Link href="/projects">Back to Projects</Link>
          </Button>
        }
      />
    );
  }

  const handleArchive = async () => {
    await projectService.archiveProject(project.id);
    setArchiveOpen(false);
    router.push("/projects");
  };

  const client = (clientRecords as Client[]).find(
    (record) => record.id === project.clientId
  );
  const projectType = getProjectTypeById(project.projectTypeId);
  const phase = getProjectPhaseById(project.currentPhaseId);
  const variance = projectVariance(project);

  const departmentIds = new Set(
    project.departments.map((assignment) => assignment.departmentId)
  );
  const disciplines = (disciplineRecords as Discipline[]).filter(
    (discipline) =>
      discipline.active &&
      discipline.departmentId &&
      departmentIds.has(discipline.departmentId)
  );
  const systems = project.departments.flatMap((assignment) =>
    assignment.systems.map((system) => ({
      ...system,
      departmentId: assignment.departmentId,
    }))
  );
  const location =
    [project.location.site, project.location.city, project.location.country]
      .filter(Boolean)
      .join(", ") || "—";
  const projectSites =
    project.sites && project.sites.length > 0
      ? project.sites
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      : [];

  return (
    <div className="space-y-6">
      <ProjectSummaryHeader
        project={project}
        actions={
          <>
            {/*
              Edit Project is `projects_update` -> `can_manage_project_setup()`
              -> `can_manage_project_operations()`. The /edit ROUTE was closed
              in an earlier wave but this entry point was not, so a Viewer was
              still invited into a form they would be refused.
            */}
            {authority.canManageOperations && (
              <Button variant="outline" asChild>
                <Link href={`/projects/${project.id}/edit`}>
                  <PenLine data-icon="inline-start" aria-hidden="true" />
                  Edit Project
                </Link>
              </Button>
            )}
            {/*
              Navigation, not creation — these open this project's own
              Reporting workspace on the matching tab, where existing reports
              are listed and the (authorized) create action lives. Reading
              reporting is not an operations right, so they stay available to
              everyone; the labels are plural to say "the reports", not "raise
              a report", and a Viewer arriving there still gets no create
              action. The project sidebar stays mounted throughout.
            */}
            <Button variant="outline" asChild>
              <Link href={`/projects/${project.id}/reporting?tab=weekly`}>
                <CalendarDays data-icon="inline-start" aria-hidden="true" />
                Weekly Reports
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/projects/${project.id}/reporting?tab=monthly`}>
                <CalendarRange data-icon="inline-start" aria-hidden="true" />
                Monthly Reports
              </Link>
            </Button>
            {/*
              Archive is destructive project administration, and the whole
              dialog — not merely its confirm button — is withheld: rendering
              the trigger let a Viewer open the confirmation modal and reach a
              Confirm control that only RLS then refused. Same predicate as
              Edit, because archiving is an update to the project row.
            */}
            {authority.canManageOperations && (
              <ConfirmArchiveDialog
                open={archiveOpen}
                onOpenChange={setArchiveOpen}
                projectName={project.name}
                onConfirm={handleArchive}
                trigger={
                  <Button
                    variant="destructive"
                    disabled={project.status === "archived"}
                  >
                    <Archive data-icon="inline-start" aria-hidden="true" />
                    Archive
                  </Button>
                }
              />
            )}
          </>
        }
      />

      <ProjectWorkflowNav project={project} />

      <div className="gap-6 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)]">
        <ProjectSectionNav
          sections={localizeProjectSections(projectSections, terms)}
        />

        <div className="mt-4 space-y-6 lg:mt-0">
          <Section id="overview">
            <SectionCard title="Overview">
              <p className="text-sm text-muted-foreground text-pretty">
                {project.description ?? "No description provided."}
              </p>
              {(project.contractNumber || project.purchaseOrderNumber) && (
                <>
                  <Separator className="my-3" />
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {project.contractNumber &&
                      `Contract: ${project.contractNumber}`}
                    {project.contractNumber &&
                      project.purchaseOrderNumber &&
                      " · "}
                    {project.purchaseOrderNumber &&
                      `PO: ${project.purchaseOrderNumber}`}
                  </p>
                </>
              )}
            </SectionCard>
          </Section>

          <Section id="project-information">
            <div className="grid gap-4 xl:grid-cols-2">
              <SectionCard title="Project Information">
                <dl className="space-y-2">
                  <ConfigRow
                    label="Project code"
                    value={<span className="font-mono">{project.code}</span>}
                  />
                  <ConfigRow label="Client" value={client?.name ?? "—"} />
                  <ConfigRow
                    label="Project type"
                    value={projectType?.name ?? "—"}
                  />
                  <ConfigRow label="Current phase" value={phase?.name ?? "—"} />
                  <ConfigRow
                    label="Planned start"
                    value={formatDate(project.plannedStartDate)}
                  />
                  <ConfigRow
                    label="Planned finish"
                    value={formatDate(project.plannedFinishDate)}
                  />
                  <ConfigRow label="Primary location" value={location} />
                  {projectSites.length > 1 && (
                    <ConfigRow
                      label="Project sites"
                      value={projectSites
                        .map((site) =>
                          [site.name, site.city, site.country]
                            .filter(Boolean)
                            .join(", ")
                        )
                        .join(" · ")}
                    />
                  )}
                </dl>
              </SectionCard>

              <SectionCard title="Reporting Configuration">
                <dl className="space-y-2">
                  <ConfigRow
                    label="Weekly reports"
                    value={
                      <StatusBadge
                        tone={
                          project.reporting.weeklyEnabled ? "success" : "neutral"
                        }
                      >
                        {project.reporting.weeklyEnabled
                          ? "Enabled"
                          : "Disabled"}
                      </StatusBadge>
                    }
                  />
                  <ConfigRow
                    label="Monthly reports"
                    value={
                      <StatusBadge
                        tone={
                          project.reporting.monthlyEnabled
                            ? "success"
                            : "neutral"
                        }
                      >
                        {project.reporting.monthlyEnabled
                          ? "Enabled"
                          : "Disabled"}
                      </StatusBadge>
                    }
                  />
                  <ConfigRow
                    label="Executive reports"
                    value={
                      <StatusBadge
                        tone={
                          project.reporting.executiveEnabled
                            ? "success"
                            : "neutral"
                        }
                      >
                        {project.reporting.executiveEnabled
                          ? "Enabled"
                          : "Disabled"}
                      </StatusBadge>
                    }
                  />
                  <ConfigRow
                    label="Weekly day"
                    value={
                      project.reporting.weeklyReportingDay
                        .charAt(0)
                        .toUpperCase() +
                      project.reporting.weeklyReportingDay.slice(1)
                    }
                  />
                  <ConfigRow
                    label="Monthly cut-off"
                    value={`Day ${project.reporting.monthlyCutoffDay}`}
                  />
                  <ConfigRow
                    label="Currency"
                    value={project.reporting.currency}
                  />
                  <ConfigRow
                    label="Working week"
                    value={project.reporting.workingWeek}
                  />
                  <ConfigRow
                    label="Time zone"
                    value={project.reporting.timeZone}
                  />
                </dl>
              </SectionCard>
            </div>
          </Section>

          <Section id="team">
            <SectionCard
              title="Team & Responsibilities"
              description="People accountable for this project."
            >
              <dl className="space-y-2">
                <ContactRow
                  label="Project Manager"
                  contactId={project.projectManagerId}
                />
                <ContactRow
                  label="Project Control"
                  contactId={project.projectControlManagerId}
                />
                <ContactRow
                  label="Client Representative"
                  contactId={project.clientRepresentativeId}
                />
                <ContactRow
                  label="Reporting Coordinator"
                  contactId={project.reportingCoordinatorId}
                />
                <ContactRow
                  label="Sponsor"
                  contactId={project.projectSponsorId}
                />
              </dl>
              {(project.clientContact.name || project.clientContact.email) && (
                <>
                  <Separator className="my-3" />
                  <p className="text-xs text-muted-foreground">
                    Client contact: {project.clientContact.name}
                    {project.clientContact.email &&
                      ` · ${project.clientContact.email}`}
                    {project.clientContact.phone &&
                      ` · ${project.clientContact.phone}`}
                  </p>
                </>
              )}
            </SectionCard>
          </Section>

          <Section id="departments">
            <SectionCard
              title="Departments"
              description="Departments participating in this project."
            >
              {project.departments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No departments assigned yet.
                </p>
              ) : (
                <ul className="space-y-3">
                  {project.departments.map((assignment) => {
                    const dept = getDepartmentById(assignment.departmentId);
                    const manager = departmentManager(
                      project,
                      assignment.departmentId
                    );
                    const managerName = getContactById(manager?.contactId)?.name;
                    const effectiveDescription =
                      assignment.projectDescription?.trim() ||
                      dept?.description?.trim();
                    return (
                      <li
                        key={assignment.departmentId}
                        className="rounded-lg border p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium">
                            {dept?.name ?? assignment.departmentId}
                            {manager && (
                              <span className="ml-2 text-xs font-normal text-muted-foreground">
                                Manager: {managerName ?? manager.contactId}
                              </span>
                            )}
                          </p>
                          <StatusBadge
                            tone={
                              assignment.reportingRequired ? "info" : "neutral"
                            }
                          >
                            {assignment.reportingRequired
                              ? "Weekly input required"
                              : "Reporting optional"}
                          </StatusBadge>
                        </div>
                        {effectiveDescription && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {effectiveDescription}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </SectionCard>
          </Section>

          <Section id="disciplines">
            <SectionCard
              title={terms.plural}
              description={`${terms.plural} in scope, derived from the assigned departments.`}
            >
              {disciplines.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No disciplines are linked to this project’s departments.
                </p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {disciplines.map((discipline) => (
                    <li
                      key={discipline.id}
                      className="rounded-md bg-muted px-2 py-0.5 text-xs"
                    >
                      {discipline.name}
                      <span className="ml-1 font-mono text-muted-foreground">
                        {discipline.code}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </Section>

          <Section id="systems">
            <SectionCard
              title="Systems"
              description="Systems assigned to this project through its departments."
            >
              {systems.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No systems assigned yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {project.departments
                    .filter((assignment) => assignment.systems.length > 0)
                    .map((assignment) => (
                      <li key={assignment.departmentId}>
                        <p className="text-xs text-muted-foreground">
                          {getDepartmentById(assignment.departmentId)?.name ??
                            assignment.departmentId}
                        </p>
                        <ul className="mt-1 space-y-1.5">
                          {assignment.systems.map((system) => {
                            const masterDescription = masterSystems.find(
                              (record) => record.id === system.id
                            )?.description;
                            const effectiveDescription =
                              system.projectDescription?.trim() ||
                              masterDescription?.trim();
                            return (
                              <li
                                key={system.id}
                                className="rounded-md bg-muted px-2 py-1.5 text-xs"
                              >
                                {system.name}
                                {system.code && (
                                  <span className="ml-1 font-mono text-muted-foreground">
                                    {system.code}
                                  </span>
                                )}
                                {effectiveDescription && (
                                  <p className="mt-1 text-muted-foreground">
                                    {effectiveDescription}
                                  </p>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </li>
                    ))}
                </ul>
              )}
            </SectionCard>
          </Section>

          <Section id="kpis">
            <SectionCard
              title="KPIs"
              description="Baseline progress and schedule performance."
            >
              <ProgressComparison
                planned={project.plannedProgress}
                actual={project.actualProgress}
                size="md"
              />
              <Separator className="my-3" />
              <dl className="space-y-2">
                <ConfigRow
                  label="Schedule variance"
                  value={
                    <span className="tabular-nums">
                      {formatVariance(variance)}
                    </span>
                  }
                />
                <ConfigRow
                  label="SPI"
                  value={
                    <span className="tabular-nums">
                      {projectSpi(project).toFixed(2)}
                    </span>
                  }
                />
                <ConfigRow
                  label="Forecast finish"
                  value={
                    project.forecastFinishDate
                      ? formatDate(project.forecastFinishDate)
                      : "—"
                  }
                />
              </dl>
            </SectionCard>
          </Section>

          <Section id="weekly-reports">
            <SectionCard
              title="Weekly Reports"
              description="Weekly progress reports raised for this project."
              action={
                // Sends the reader to this project's Weekly tab rather than
                // to a global create form. The create action itself lives
                // there and is gated by `canManageReporting`, so this stays a
                // plain navigation and never advertises an authority the
                // reader may not hold.
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/projects/${project.id}/reporting?tab=weekly`}>
                    View all
                  </Link>
                </Button>
              }
            >
              {weeklyReports.length === 0 ? (
                <EmptyState
                  icon={CalendarDays}
                  title="No weekly reports yet"
                  description="Weekly reports raised for this project will be listed here."
                  className="py-8"
                />
              ) : (
                <ul className="space-y-2">
                  {weeklyReports.map((report) => (
                    <li key={report.id}>
                      <Link
                        // Project-scoped alias: this report belongs to the
                        // project being viewed, so opening it must not leave
                        // project context.
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
            </SectionCard>
          </Section>

          <Section id="monthly-reports">
            <SectionCard
              title="Monthly Reports"
              description="Monthly reports compiled from the approved weekly reports."
            >
              <EmptyState
                icon={CalendarRange}
                title="No monthly reports yet"
                description="Monthly reports will appear here once the monthly reporting module ships."
                className="py-8"
              />
            </SectionCard>
          </Section>

          <Section id="documents">
            <SectionCard
              title="Project Reference Documents"
              description="Official scope, planning, contract and other controlled Project references."
            >
              <ProjectDocumentsPanel projectId={project.id} />
            </SectionCard>
          </Section>

          <Section id="attachments">
            <SectionCard
              title="Attachments"
              description="Files attached to this project and its reports."
            >
              <EmptyState
                icon={Paperclip}
                title="No attachments yet"
                description="Files attached to this project will be listed here."
                className="py-8"
              />
            </SectionCard>
          </Section>

          <Section id="history">
            <SectionCard
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
            </SectionCard>
          </Section>
        </div>
      </div>
    </div>
  );
}

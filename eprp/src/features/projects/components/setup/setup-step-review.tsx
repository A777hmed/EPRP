"use client";

import Link from "next/link";
import { AlertTriangle, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { EmptyState, SectionCard, StatusBadge } from "@/components/shared";
import {
  allMissing,
  getLocalizedProjectWorkflowStep,
  projectWorkflowHref,
  type ProjectStepStatus,
} from "@/config/project-workflow";
import { useMasterData } from "@/features/master-data";
import { ASSIGNMENT_ROLE_META } from "@/lib/constants";
import {
  activeDelegations,
  compareTeamDisplayOrder,
  departmentAssignments,
  departmentManager,
} from "../../assignment-rules";
import { misplacedScopeLinks, scopeLinkKey } from "../../scope-integrity";
import { formatDate } from "@/lib/formatters";
import type { HierarchyTerms } from "@/config/project-terminology";
import type { Client, Contact, Discipline, Project, System } from "@/types";

export interface SetupStepReviewProps {
  /** Hierarchy wording — display only. */
  terms: HierarchyTerms;
  project: Project;
  statuses: ProjectStepStatus[];
  percent: number;
  contacts: Contact[];
  disciplines: Discipline[];
  departmentName: (id: string) => string;
}

function Summary({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

/**
 * Step 6 — the confirmation gate. Shows overall completion, everything still
 * missing (each linking back to the step that fixes it), and a summary of
 * what was scoped.
 */
export function SetupStepReview({
  project,
  statuses,
  percent,
  contacts,
  disciplines,
  departmentName,
  terms,
}: SetupStepReviewProps) {
  const missing = allMissing(statuses);
  const today = new Date().toISOString().slice(0, 10);
  const links = project.disciplines ?? [];
  const team = project.team ?? [];
  const systemCount = project.departments.reduce(
    (sum, assignment) => sum + assignment.systems.length,
    0
  );
  const uniqueDisciplines = new Set(links.map((link) => link.disciplineId));
  const uniqueTeam = new Set(team.map((member) => member.contactId));
  const { records: clientRecords } = useMasterData("client");
  const client = (clientRecords as Client[]).find(
    (record) => record.id === project.clientId
  );
  const clientLabel = client?.shortName
    ? `${client.shortName} — ${client.name}`
    : (client?.name ?? "—");
  const contactName = (id: string) =>
    contacts.find((contact) => contact.id === id)?.name ?? id;

  // Judged against the full record set, archived included — the `disciplines`
  // prop carries active records only and would report archived-but-correct
  // links as orphans.
  const { records: allDisciplineRecords } = useMasterData("discipline");
  const { records: allSystemRecords } = useMasterData("system");
  const misplaced = misplacedScopeLinks(
    project,
    allDisciplineRecords as Discipline[]
  );
  const nameOfDiscipline = (id: string) =>
    (allDisciplineRecords as Discipline[]).find((record) => record.id === id)
      ?.name ?? id;
  const nameOfSystem = (id?: string) =>
    id
      ? ((allSystemRecords as System[]).find((system) => system.id === id)
          ?.name ?? id)
      : "No system";

  return (
    <div className="space-y-4">
      <SectionCard
        title="Setup completion"
        description={`${percent}% of the required data is in place.`}
        action={
          <StatusBadge tone={missing.length === 0 ? "success" : "warning"}>
            {missing.length === 0 ? "Ready" : `${missing.length} outstanding`}
          </StatusBadge>
        }
      >
        <Progress value={percent} className="mb-4 h-2" />

        {missing.length === 0 ? (
          <div className="flex items-center gap-2 text-sm">
            <Check className="size-4 text-success" aria-hidden="true" />
            Every requirement is met. This project is ready to report on.
          </div>
        ) : (
          <ul className="space-y-2">
            {missing.map((item) => (
              <li
                key={`${item.step}-${item.label}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5"
              >
                <span className="flex items-center gap-2 text-sm">
                  <AlertTriangle
                    className="size-4 shrink-0 text-warning"
                    aria-hidden="true"
                  />
                  {item.label}
                </span>
                <Button variant="outline" size="sm" asChild>
                  <Link href={projectWorkflowHref(project.id, item.step)}>
                    Fix in {getLocalizedProjectWorkflowStep(item.step, terms).label}
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {misplaced.length > 0 && (
        <SectionCard
          title={`${terms.plural} filed under the wrong System`}
          description={`${misplaced.length} project link(s) contradict the Department and System that own the record. Correct them before finishing setup — nothing is moved automatically.`}
          action={
            <Button variant="outline" size="sm" asChild>
              <Link href={projectWorkflowHref(project.id, "disciplines")}>
                Fix in{" "}
                {getLocalizedProjectWorkflowStep("disciplines", terms).label}
              </Link>
            </Button>
          }
        >
          <ul className="space-y-2">
            {misplaced.map((entry) => (
              <li
                key={scopeLinkKey(entry.disciplineId, entry.linkSystemId)}
                className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-2.5 text-xs"
              >
                <AlertTriangle
                  className="mt-0.5 size-3.5 shrink-0 text-warning"
                  aria-hidden="true"
                />
                <span>
                  <span className="font-medium">
                    {nameOfDiscipline(entry.disciplineId)}
                  </span>{" "}
                  {entry.problem === "unknown-record" ? (
                    <>has no master record and can only be removed.</>
                  ) : (
                    <>
                      is filed under {nameOfSystem(entry.linkSystemId)} ·{" "}
                      {departmentName(entry.linkDepartmentId ?? "")}, but is
                      owned by {nameOfSystem(entry.ownerSystemId)} ·{" "}
                      {departmentName(entry.ownerDepartmentId ?? "")}.
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <SectionCard title="Summary" description={project.name}>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Summary label="Project code" value={project.code} />
          <Summary label="Client" value={clientLabel} />
          <Summary
            label="Project manager"
            value={
              contacts.find((contact) => contact.id === project.projectManagerId)
                ?.name ?? "—"
            }
          />
          <Summary
            label="Planned finish"
            value={formatDate(project.plannedFinishDate)}
          />
          <Summary label="Departments" value={project.departments.length} />
          <Summary label="Systems" value={systemCount} />
          <Summary label={terms.plural} value={uniqueDisciplines.size} />
          <Summary label="Team members" value={uniqueTeam.size} />
        </dl>
      </SectionCard>

      <SectionCard
        title="Scope breakdown"
        description="How the project is structured after setup."
      >
        {project.departments.length === 0 ? (
          <EmptyState
            title="Nothing scoped yet"
            description="Work through the earlier steps to build the project scope."
            className="py-8"
          />
        ) : (
          <ul className="space-y-3">
            {project.departments.map((assignment) => {
              const manager = departmentManager(
                project,
                assignment.departmentId
              );
              const deptLinks = links.filter(
                (link) => link.departmentId === assignment.departmentId
              );
              const deptTeam = team.filter(
                (member) => member.departmentId === assignment.departmentId
              );
              return (
                <li
                  key={assignment.departmentId}
                  className="rounded-lg border p-3"
                >
                  <p className="text-sm font-medium">
                    {departmentName(assignment.departmentId)}
                    {manager && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        Manager: {contacts.find((c) => c.id === manager.contactId)?.name ?? manager.contactId}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {assignment.systems.length} system
                    {assignment.systems.length === 1 ? "" : "s"} ·{" "}
                    {new Set(deptLinks.map((l) => l.disciplineId)).size}{" "}
                    {new Set(deptLinks.map((l) => l.disciplineId)).size === 1
                      ? terms.singularLower
                      : terms.pluralLower}{" "}
                    · {new Set(deptTeam.map((m) => m.contactId)).size} member
                    {new Set(deptTeam.map((m) => m.contactId)).size === 1
                      ? ""
                      : "s"}
                  </p>
                  {assignment.systems.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {assignment.systems.map((system) => {
                        const systemLinks = deptLinks.filter(
                          (link) => link.systemId === system.id
                        );
                        const disciplineIds = [
                          ...new Set(
                            systemLinks.map((link) => link.disciplineId)
                          ),
                        ];
                        return (
                          <li key={system.id} className="rounded-md bg-muted/50 p-2.5">
                            <p className="text-xs font-medium">
                              <span className="text-muted-foreground">System:</span>{" "}
                              {system.name}
                              {system.code ? ` (${system.code})` : ""}
                            </p>
                            {disciplineIds.length > 0 ? (
                              <ul className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                <li className="text-[11px] text-muted-foreground">
                                  {terms.plural}:
                                </li>
                                {disciplineIds.map((id) => (
                                  <li
                                    key={id}
                                    className="rounded-md border bg-background px-2 py-0.5 text-xs"
                                  >
                                    {disciplines.find((d) => d.id === id)?.name ?? id}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                No {terms.pluralLower} linked to this System.
                              </p>
                            )}
                          </li>
                        );
                      })}
                      {deptLinks.some(
                        (link) =>
                          !link.systemId ||
                          !assignment.systems.some(
                            (system) => system.id === link.systemId
                          )
                      ) && (
                        <li className="rounded-md border border-warning/40 bg-warning/5 p-2.5 text-xs">
                          <span className="font-medium">Legacy unassigned {terms.pluralLower}:</span>{" "}
                          {[
                            ...new Set(
                              deptLinks
                                .filter(
                                  (link) =>
                                    !link.systemId ||
                                    !assignment.systems.some(
                                      (system) => system.id === link.systemId
                                    )
                                )
                                .map((link) => link.disciplineId)
                            ),
                          ]
                            .map(
                              (id) =>
                                disciplines.find((discipline) => discipline.id === id)
                                  ?.name ?? id
                            )
                            .join(", ")}
                        </li>
                      )}
                    </ul>
                  )}
                  {deptTeam.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {departmentAssignments(
                        project,
                        assignment.departmentId
                      )
                        .sort((left, right) =>
                          compareTeamDisplayOrder(left, right, contactName)
                        )
                        .map((entry) => {
                        const contact = contacts.find(
                          (candidate) => candidate.id === entry.contactId
                        );
                        const isCrossDepartment =
                          Boolean(contact?.departmentId) &&
                          contact?.departmentId !== assignment.departmentId;
                        const reportsTo = entry.reportsToContactId
                          ? (contacts.find(
                              (c) => c.id === entry.reportsToContactId
                            )?.name ?? entry.reportsToContactId)
                          : undefined;
                        return (
                          <li
                            key={entry.contactId}
                            className="flex flex-wrap items-center gap-1.5 text-xs"
                          >
                            <span className="rounded-md bg-muted px-2 py-0.5">
                              {contact?.name ?? entry.contactId}
                            </span>
                            {isCrossDepartment && contact?.departmentId && (
                              <span className="text-muted-foreground">
                                Cross-department · Home: {departmentName(contact.departmentId)}
                              </span>
                            )}
                            {entry.functionalTitle && (
                              <span className="text-muted-foreground">
                                {entry.functionalTitle}
                              </span>
                            )}
                            <StatusBadge
                              tone={
                                entry.assignmentRole === "department_manager"
                                  ? "info"
                                  : "neutral"
                              }
                            >
                              {ASSIGNMENT_ROLE_META[entry.assignmentRole].label}
                            </StatusBadge>
                            {reportsTo && (
                              <span className="text-muted-foreground">
                                → {reportsTo}
                              </span>
                            )}
                          </li>
                        );
                        })}
                    </ul>
                  )}
                  {activeDelegations(
                    project,
                    assignment.departmentId,
                    today
                  ).map((delegation, index) => (
                    <p
                      key={delegation.id ?? index}
                      className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
                    >
                      <StatusBadge tone="success">
                        Acting / Delegated Manager
                      </StatusBadge>
                      {contacts.find(
                        (c) => c.id === delegation.delegateContactId
                      )?.name ?? delegation.delegateContactId}
                      <span>· until {delegation.endDate}</span>
                    </p>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

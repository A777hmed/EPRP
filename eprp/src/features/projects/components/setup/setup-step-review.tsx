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
import { getClientById, getContactById } from "@/features/master-data";
import { ASSIGNMENT_ROLE_META } from "@/lib/constants";
import {
  activeDelegations,
  departmentAssignments,
} from "../../assignment-rules";
import { formatDate } from "@/lib/formatters";
import type { HierarchyTerms } from "@/config/project-terminology";
import type { Contact, Discipline, Project } from "@/types";

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

      <SectionCard title="Summary" description={project.name}>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Summary label="Project code" value={project.code} />
          <Summary
            label="Client"
            value={getClientById(project.clientId)?.name ?? "—"}
          />
          <Summary
            label="Project manager"
            value={getContactById(project.projectManagerId)?.name ?? "—"}
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
                    {assignment.leadName && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        Lead: {assignment.leadName}
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
                  {deptLinks.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {[
                        ...new Set(deptLinks.map((link) => link.disciplineId)),
                      ].map((id) => (
                        <li
                          key={id}
                          className="rounded-md bg-muted px-2 py-0.5 text-xs"
                        >
                          {disciplines.find((d) => d.id === id)?.name ?? id}
                        </li>
                      ))}
                    </ul>
                  )}
                  {deptTeam.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {departmentAssignments(
                        project,
                        assignment.departmentId
                      ).map((entry) => {
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
                              {contacts.find((c) => c.id === entry.contactId)
                                ?.name ?? entry.contactId}
                            </span>
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

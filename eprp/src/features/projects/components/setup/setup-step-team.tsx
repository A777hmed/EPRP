"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, SectionCard, StatusBadge } from "@/components/shared";
import { ASSIGNMENT_ROLE_META } from "@/lib/constants";
import { projectWorkflowHref } from "@/config/project-workflow";
import { cn } from "@/lib/utils";
import type { HierarchyTerms } from "@/config/project-terminology";
import type { AssignmentRole, Contact, Discipline, Project } from "@/types";
import {
  compareTeamDisplayOrder,
  departmentAssignments,
  projectTeamPeople,
  type DepartmentAssignmentEntry,
} from "../../assignment-rules";

export interface SetupStepTeamProps {
  /** Hierarchy wording — display only. */
  terms: HierarchyTerms;
  project: Project;
  contacts: Contact[];
  disciplines: Discipline[];
  departmentName: (id: string) => string;
}

/* --------------------------------- KPIs ---------------------------------- */

function Kpi({
  value,
  label,
  tone = "default",
}: {
  value: number;
  label: string;
  tone?: "default" | "accent";
}) {
  return (
    <div className="rounded-xl border bg-background p-3 shadow-sm">
      <p
        className={cn(
          "text-xl font-semibold tabular-nums",
          tone === "accent" && "text-chart-4"
        )}
      >
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/** Small chip, matching the scope cards elsewhere in setup. */
function Chip({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "accent";
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-baseline gap-1 truncate rounded-md px-1.5 py-0.5 text-xs",
        tone === "accent" ? "bg-chart-4/15 text-chart-4" : "bg-muted"
      )}
    >
      {children}
    </span>
  );
}

const ROLE_ACCENT: Record<AssignmentRole, string> = {
  department_manager: "bg-chart-1/15 text-chart-1",
  team_member_lead: "bg-chart-3/15 text-chart-3",
  team_member: "bg-muted text-muted-foreground",
};

/**
 * One participant, within one department.
 *
 * `entry` is already collapsed to a single person by `departmentAssignments`,
 * so someone covering five scope items renders once here, with five chips —
 * never five cards.
 */
function ParticipantCard({
  entry,
  contacts,
  disciplineName,
  departmentName,
  contactName,
  terms,
}: {
  entry: DepartmentAssignmentEntry;
  contacts: Contact[];
  disciplineName: (id: string) => string;
  departmentName: (id: string) => string;
  contactName: (id: string) => string;
  terms: HierarchyTerms;
}) {
  const contact = contacts.find(
    (candidate) => candidate.id === entry.contactId
  );
  const homeDepartmentId = contact?.departmentId;
  /*
   * Cross-department is a comparison between the person's ONE Home Department
   * and the department this assignment sits in. It is a badge, never a second
   * Person record — the contact is read here, never written.
   */
  const crossDepartment =
    Boolean(homeDepartmentId) && homeDepartmentId !== entry.departmentId;

  const scopeItems = entry.rows
    .map((row) => row.disciplineId)
    .filter((id): id is string => Boolean(id));
  const uniqueScopeItems = [...new Set(scopeItems)];

  return (
    <li className="flex min-w-0 flex-col rounded-xl border bg-background p-3 shadow-sm">
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full",
            ROLE_ACCENT[entry.assignmentRole]
          )}
          aria-hidden="true"
        >
          <UserRound className="size-4.5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="min-w-0 truncate text-sm font-semibold">
              {contactName(entry.contactId)}
            </p>
            <StatusBadge
              tone={
                entry.assignmentRole === "department_manager"
                  ? "info"
                  : "neutral"
              }
            >
              {ASSIGNMENT_ROLE_META[entry.assignmentRole].label}
            </StatusBadge>
            {crossDepartment && (
              <StatusBadge tone="warning">Cross-department</StatusBadge>
            )}
          </div>

          {/* Functional Responsibility Title wins over the master record's job
              title when one was set for this project. */}
          <p className="truncate text-xs text-muted-foreground">
            {entry.functionalTitle ?? contact?.position ?? "No job title"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {contact?.organization?.trim() || "No organization"}
            {" · Home: "}
            {homeDepartmentId ? departmentName(homeDepartmentId) : "Not set"}
          </p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Chip>
          <span className="font-medium tabular-nums">
            {uniqueScopeItems.length}
          </span>
          <span className="text-muted-foreground">
            {uniqueScopeItems.length === 1 ? terms.singular : terms.plural}
          </span>
        </Chip>
        {entry.reportsToContactId ? (
          <Chip>
            <span className="truncate text-muted-foreground">
              Reports to {contactName(entry.reportsToContactId)}
            </span>
          </Chip>
        ) : (
          entry.assignmentRole !== "department_manager" && (
            <Chip tone="accent">
              <span className="truncate">No Reports To</span>
            </Chip>
          )
        )}
      </div>

      {uniqueScopeItems.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {uniqueScopeItems.map((id) => (
            <li
              key={id}
              className="max-w-full truncate rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground"
            >
              {disciplineName(id)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Step 6 — Project Team Summary.
 *
 * Read-only. Every number and every row is derived from the same helpers the
 * Contacts step writes through (`departmentAssignments`,
 * `compareTeamDisplayOrder`, `projectTeamPeople`), so this cannot disagree
 * with the assignments themselves — there is no second derivation here and
 * nothing on this screen is editable. Corrections go back to Contacts.
 */
export function SetupStepTeam({
  terms,
  project,
  contacts,
  disciplines,
  departmentName,
}: SetupStepTeamProps) {
  const contactName = React.useCallback(
    (id: string) =>
      contacts.find((candidate) => candidate.id === id)?.name ?? id,
    [contacts]
  );
  const disciplineName = React.useCallback(
    (id: string) =>
      disciplines.find((candidate) => candidate.id === id)?.name ?? id,
    [disciplines]
  );

  /* Departments that actually have participants, in project order. */
  const groups = project.departments
    .map((assignment) => ({
      departmentId: assignment.departmentId,
      entries: [
        ...departmentAssignments(project, assignment.departmentId),
      ].sort((left, right) =>
        compareTeamDisplayOrder(left, right, contactName)
      ),
    }))
    .filter((group) => group.entries.length > 0);

  /*
   * KPIs.
   *
   * Participants are counted with `projectTeamPeople`, which collapses the
   * team to unique PEOPLE — the same person on three studies in two
   * departments is one participant. Role counts are taken per department
   * entry, since one person genuinely can be a Manager in their own
   * department and a Team Member in another.
   */
  const people = projectTeamPeople(project);
  const allEntries = groups.flatMap((group) => group.entries);
  const countRole = (role: AssignmentRole) =>
    allEntries.filter((entry) => entry.assignmentRole === role).length;

  const crossDepartmentCount = people.filter((person) => {
    const home = contacts.find(
      (candidate) => candidate.id === person.contactId
    )?.departmentId;
    return Boolean(home) && !person.departmentIds.includes(home!);
  }).length;

  const backToContacts = (
    <Button variant="outline" size="sm" asChild>
      <Link href={projectWorkflowHref(project.id, "contacts")}>
        <ArrowLeft data-icon="inline-start" aria-hidden="true" />
        Correct on Contacts
      </Link>
    </Button>
  );

  return (
    <div className="space-y-4">
      <SectionCard
        title="Project team at a glance"
        description="Every participant counted once, however many scope items they cover."
        action={backToContacts}
      >
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi value={people.length} label="Total Participants" />
          <Kpi value={groups.length} label="Departments" />
          <Kpi
            value={countRole("department_manager")}
            label={`${ASSIGNMENT_ROLE_META.department_manager.label}s`}
          />
          <Kpi
            value={countRole("team_member_lead")}
            label={`${ASSIGNMENT_ROLE_META.team_member_lead.label}s`}
          />
          <Kpi
            value={countRole("team_member")}
            label={`${ASSIGNMENT_ROLE_META.team_member.label}s`}
          />
          <Kpi
            value={crossDepartmentCount}
            label="Cross-Department"
            tone="accent"
          />
        </div>
      </SectionCard>

      {groups.length === 0 ? (
        <SectionCard title="Participants">
          <EmptyState
            title="No one assigned yet"
            description="Assign the project team on the Contacts step, then return here."
            className="py-8"
            action={backToContacts}
          />
        </SectionCard>
      ) : (
        groups.map((group) => {
          const managerCount = group.entries.filter(
            (entry) => entry.assignmentRole === "department_manager"
          ).length;
          return (
            <SectionCard
              key={group.departmentId}
              title={departmentName(group.departmentId)}
              description={`${group.entries.length} participant${
                group.entries.length === 1 ? "" : "s"
              }, ordered by ${ASSIGNMENT_ROLE_META.department_manager.label}, ${ASSIGNMENT_ROLE_META.team_member_lead.label}s, then ${ASSIGNMENT_ROLE_META.team_member.label}s.`}
              action={
                managerCount === 1 ? undefined : (
                  <StatusBadge tone="warning">
                    {managerCount === 0
                      ? "No Department Manager"
                      : `${managerCount} Department Managers`}
                  </StatusBadge>
                )
              }
            >
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.entries.map((entry) => (
                  <ParticipantCard
                    key={entry.contactId}
                    entry={entry}
                    contacts={contacts}
                    contactName={contactName}
                    disciplineName={disciplineName}
                    departmentName={departmentName}
                    terms={terms}
                  />
                ))}
              </ul>
            </SectionCard>
          );
        })
      )}
    </div>
  );
}

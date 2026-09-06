"use client";

import * as React from "react";
import Link from "next/link";
import { useWatch, type Control } from "react-hook-form";
import {
  Building2,
  ExternalLink,
  Layers,
  PenLine,
  UserPlus,
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, StatusBadge } from "@/components/shared";
import { useMasterData } from "@/features/master-data";
import { cn } from "@/lib/utils";
import { useHierarchyTerms } from "../use-hierarchy-terms";
import type { Contact, Department, Project, System } from "@/types";
import {
  PROJECT_EDIT_SECTIONS,
  projectEditReturn,
  projectScopeReturn,
  withProjectContext,
  type ProjectLinkContext,
} from "../project-link-context";
import type { ProjectFormValues } from "../schemas/project-form";
import {
  compareTeamDisplayOrder,
  departmentManager,
  projectTeamPeople,
} from "../assignment-rules";

/**
 * One scope group inside the form section. A plain block rather than a
 * nested SectionCard, so the section keeps a single card frame.
 */
function ScopeGroup({
  id,
  title,
  description,
  count,
  children,
}: {
  id: string;
  title: string;
  description: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <StatusBadge tone={count > 0 ? "info" : "neutral"}>
          {count} linked
        </StatusBadge>
      </div>
      {children}
    </section>
  );
}

/**
 * Small count chip, e.g. "4 Programs & Studies".
 *
 * Every number shown is derived from links the project already stores; nothing
 * here is a new stored field.
 */
function CountChip({ value, label }: { value: number; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs">
      <span className="font-medium tabular-nums">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

/**
 * One linked record as a compact card.
 *
 * Same elevated surface as the Project Responsibility cards — darker face than
 * the section, soft border, small shadow, role-themed edge — so the two
 * sections read as one design rather than two. Open / Edit stay as icon
 * buttons for the same reason.
 */
function LinkedCard({
  icon,
  accent,
  name,
  code,
  meta,
  chips,
  badge,
  openHref,
  editHref,
  extraAction,
}: {
  icon: React.ReactNode;
  /** Pair of full Tailwind class strings — written out so they are generated. */
  accent: { stripe: string; tint: string; icon: string };
  name: string;
  code?: string;
  meta?: React.ReactNode;
  chips?: React.ReactNode;
  badge?: React.ReactNode;
  openHref: string;
  editHref: string;
  extraAction?: React.ReactNode;
}) {
  return (
    <li className="relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-background p-3 pl-4 shadow-sm">
      <span
        className={cn("absolute inset-y-0 left-0 w-1", accent.stripe)}
        aria-hidden="true"
      />

      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full",
            accent.tint,
            accent.icon
          )}
          aria-hidden="true"
        >
          {icon}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="min-w-0 truncate text-sm font-semibold">{name}</p>
            {badge}
          </div>
          {code && (
            <p className="truncate font-mono text-xs text-muted-foreground">
              {code}
            </p>
          )}
          {meta && (
            <p className="truncate text-xs text-muted-foreground">{meta}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {extraAction}
          <Button variant="outline" size="icon" className="size-7" asChild>
            <Link href={openHref} aria-label={`Open ${name}`}>
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </Link>
          </Button>
          <Button variant="outline" size="icon" className="size-7" asChild>
            <Link href={editHref} aria-label={`Edit ${name}`}>
              <PenLine className="size-3.5" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>

      {chips && <div className="mt-2 flex flex-wrap gap-1.5">{chips}</div>}
    </li>
  );
}

/**
 * A record the project references but master data no longer holds. Shown so
 * the gap is visible rather than silently dropped, with no dead-end actions.
 */
function UnlinkedCard({
  name,
  meta,
}: {
  name: string;
  meta?: React.ReactNode;
}) {
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-xl border border-dashed p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{name}</p>
        {meta && <p className="truncate text-xs text-muted-foreground">{meta}</p>}
      </div>
      <div className="flex items-center justify-between gap-2">
        <StatusBadge tone="warning">Not in master data</StatusBadge>
        <Button variant="outline" size="sm" asChild>
          <Link href="/systems">Find in Systems</Link>
        </Button>
      </div>
    </li>
  );
}

/**
 * Accents for the scope groups, from the theme's own chart palette so they
 * follow light and dark. Full class strings — Tailwind reads them statically.
 */
const SCOPE_ACCENTS = {
  department: {
    stripe: "bg-chart-1",
    tint: "bg-chart-1/15",
    icon: "text-chart-1",
  },
  system: {
    stripe: "bg-chart-3",
    tint: "bg-chart-3/15",
    icon: "text-chart-3",
  },
  contact: {
    stripe: "bg-chart-2",
    tint: "bg-chart-2/15",
    icon: "text-chart-2",
  },
};

export interface ProjectScopeSummaryProps {
  /** Absent while the project is still being created. */
  projectId?: string;
  control: Control<ProjectFormValues>;
  /** Loaded project — supplies the team links the form does not manage. */
  project?: Project | null;
  /**
   * The trail of the route hosting this form, when it is not Project Edit.
   *
   * The Project Setup wizard already builds one for its own step; passing it
   * through is what lets Open / Edit return to that step instead of dropping
   * the user on the generic edit page. Omitted on Project Edit, which is the
   * fallback anyway.
   */
  linkContext?: ProjectLinkContext;
}

/**
 * The linked scope of a project: its departments, their systems, and the
 * people on it.
 *
 * Read-only summaries with Open / Edit actions rather than inline editors —
 * each record is shared master data, so it is edited on its own page and the
 * link back carries the project context. Master data is subscribed to, so a
 * record renamed on another page refreshes here without a reload.
 */
export function ProjectScopeSummary({
  projectId,
  control,
  project,
  linkContext,
}: ProjectScopeSummaryProps) {
  const departmentValues = useWatch({ control, name: "departments" }) ?? [];
  // Display wording only — "Programs & Studies" on PSM/PSAIM, else
  // "Disciplines". Never branch behaviour on it.
  const terms = useHierarchyTerms(project);
  const { records: departmentRecords } = useMasterData("department");
  const { records: systemRecords } = useMasterData("system");
  const { records: contactRecords } = useMasterData("contact");

  const departments = departmentRecords as Department[];
  const systems = systemRecords as System[];
  const contacts = contactRecords as Contact[];

  const departmentName = (id: string | undefined) =>
    departments.find((department) => department.id === id)?.name ?? "—";

  // The form loads asynchronously, so the browser's own hash scroll fires
  // before these sections exist. Re-run it once they are on the page.
  React.useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const isScopeAnchor = Object.values(PROJECT_EDIT_SECTIONS).some(
      (anchor) => anchor === hash
    );
    if (!isScopeAnchor) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(hash)?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!projectId) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        Departments, systems, and contacts can be linked once the project has
        been saved.
      </div>
    );
  }

  /*
   * The breadcrumb handed to every record opened from Linked Scope.
   *
   * The return path is anchored to the route the user is actually on — the
   * host's own trail when there is one, Project Edit otherwise — and the
   * originating step rides along, so "Return to Project" comes back to the
   * same Setup step with its workflow nav intact rather than to a bare edit
   * form. Same mechanism the wizard's own steps already use; nothing parallel.
   */
  const context = (
    section: keyof typeof PROJECT_EDIT_SECTIONS,
    sourceType: "department" | "system" | "contact",
    parentId: string
  ): ProjectLinkContext => ({
    projectId,
    sourceType,
    parentId,
    currentStep: linkContext?.currentStep,
    returnTo: linkContext?.returnTo
      ? projectScopeReturn(linkContext.returnTo, section)
      : projectEditReturn(projectId, section),
  });

  const team = project?.team ?? [];
  /*
   * People, not assignment rows.
   *
   * `project.team` holds one row per (person, scope item), so mapping it
   * directly listed the same person once per Program & Study they cover and
   * reported the row count as a headcount. Group first; the assignments are
   * summarised on each person's own row.
   */
  const orderedTeam = (project ? projectTeamPeople(project) : []).sort(
    (left, right) =>
      compareTeamDisplayOrder(
        left,
        right,
        (id) => contacts.find((contact) => contact.id === id)?.name ?? id
      )
  );
  /*
   * Counts shown on the scope cards. All derived from links the project
   * already stores — `project.disciplines` and `project.team` — so nothing
   * new is persisted and nothing can drift from the source of truth.
   *
   * People are counted as PEOPLE: `project.team` holds one row per
   * (person, scope item), so a unique set is what answers "how many are on
   * this department", not the row count.
   */
  const scopeLinks = project?.disciplines ?? [];
  const disciplineCountFor = (match: {
    departmentId?: string;
    systemId?: string;
  }) =>
    new Set(
      scopeLinks
        .filter(
          (link) =>
            (match.departmentId === undefined ||
              link.departmentId === match.departmentId) &&
            (match.systemId === undefined || link.systemId === match.systemId)
        )
        .map((link) => link.disciplineId)
    ).size;

  const peopleCountFor = (match: {
    departmentId?: string;
    systemId?: string;
  }) =>
    new Set(
      team
        .filter(
          (member) =>
            (match.departmentId === undefined ||
              member.departmentId === match.departmentId) &&
            (match.systemId === undefined || member.systemId === match.systemId)
        )
        .map((member) => member.contactId)
    ).size;

  // Every system assigned on the project, carrying its department.
  const projectSystems = departmentValues.flatMap((assignment) =>
    (assignment.systems ?? []).map((system) => ({
      id: system.id,
      name: system.name,
      code: system.code,
      departmentId: assignment.departmentId,
    }))
  );

  return (
    <div className="space-y-4">
      {/* ------------------------------ Departments ----------------------- */}
      <ScopeGroup
        id={PROJECT_EDIT_SECTIONS.departments}
        title="Departments"
        description="Departments assigned to this project."
        count={departmentValues.length}
      >
        {departmentValues.length === 0 ? (
          <EmptyState
            title="No departments linked"
            description="Departments are assigned in the project setup wizard."
            className="py-6"
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {departmentValues.map((assignment) => {
              const id = assignment.departmentId;
              const ctx = context("departments", "department", id);
              const record = departments.find(
                (candidate) => candidate.id === id
              );
              const manager = project
                ? departmentManager(project, id)
                : undefined;
              const managerName = contacts.find(
                (contact) => contact.id === manager?.contactId
              )?.name;
              return (
                <LinkedCard
                  key={id}
                  icon={<Building2 className="size-4.5" />}
                  accent={SCOPE_ACCENTS.department}
                  name={departmentName(id)}
                  code={record?.code}
                  meta={
                    manager
                      ? `Manager: ${managerName ?? "Unknown contact"}`
                      : "Manager assigned on Contacts step"
                  }
                  chips={
                    <>
                      <CountChip
                        value={(assignment.systems ?? []).length}
                        label="Systems"
                      />
                      <CountChip
                        value={disciplineCountFor({ departmentId: id })}
                        label={terms.plural}
                      />
                      <CountChip
                        value={peopleCountFor({ departmentId: id })}
                        label="Contacts"
                      />
                    </>
                  }
                  badge={
                    <StatusBadge
                      tone={assignment.reportingRequired ? "info" : "neutral"}
                    >
                      {assignment.reportingRequired
                        ? "Weekly input"
                        : "Optional"}
                    </StatusBadge>
                  }
                  openHref={withProjectContext(`/departments/${id}`, ctx)}
                  editHref={withProjectContext(`/departments/${id}/edit`, ctx)}
                />
              );
            })}
          </ul>
        )}
      </ScopeGroup>

      {/* -------------------------------- Systems ------------------------- */}
      <ScopeGroup
        id={PROJECT_EDIT_SECTIONS.systems}
        title="Systems"
        description="Systems in scope, with the department that owns them."
        count={projectSystems.length}
      >
        {projectSystems.length === 0 ? (
          <EmptyState
            title="No systems linked"
            description="Systems are assigned to departments in the project setup wizard."
            className="py-6"
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projectSystems.map((system) => {
              const ctx = context("systems", "system", system.id);
              const record = systems.find(
                (candidate) => candidate.id === system.id
              );
              // Assignments store a name/code snapshot, so a project can still
              // reference a system that no longer exists in master data.
              // Offering Open / Edit there would dead-end, so the card is
              // flagged and points at the Systems list instead.
              if (!record) {
                return (
                  <UnlinkedCard
                    key={`${system.departmentId}-${system.id}`}
                    name={system.name}
                    meta={departmentName(system.departmentId)}
                  />
                );
              }
              return (
                <LinkedCard
                  key={`${system.departmentId}-${system.id}`}
                  icon={<Layers className="size-4.5" />}
                  accent={SCOPE_ACCENTS.system}
                  name={record.name}
                  code={record.code ?? system.code}
                  meta={departmentName(system.departmentId)}
                  chips={
                    <>
                      <CountChip
                        value={disciplineCountFor({ systemId: system.id })}
                        label={terms.plural}
                      />
                      <CountChip
                        value={peopleCountFor({ systemId: system.id })}
                        label="Contacts"
                      />
                    </>
                  }
                  openHref={withProjectContext(`/systems/${system.id}`, ctx)}
                  editHref={withProjectContext(
                    `/systems/${system.id}/edit`,
                    ctx
                  )}
                />
              );
            })}
          </ul>
        )}
      </ScopeGroup>

      {/* ------------------------------- Contacts ------------------------- */}
      <ScopeGroup
        id={PROJECT_EDIT_SECTIONS.contacts}
        title="Contacts"
        description="People linked to this project through its departments."
        count={orderedTeam.length}
      >
        {team.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title="No contacts linked"
            description="Add contacts from a department or system page, or in the setup wizard."
            className="py-6"
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {orderedTeam.map((person) => {
              const ctx = context("contacts", "contact", person.contactId);
              const contact = contacts.find(
                (candidate) => candidate.id === person.contactId
              );
              const departmentLabels = person.departmentIds
                .map((id) => departmentName(id))
                .join(", ");
              const scopeCount = person.rows.filter(
                (row) => row.disciplineId
              ).length;
              return (
                <LinkedCard
                  key={person.contactId}
                  icon={<UserRound className="size-4.5" />}
                  accent={SCOPE_ACCENTS.contact}
                  name={contact?.name ?? "Unknown contact"}
                  meta={
                    <>
                      {contact?.position ?? "No job title"}
                      {" · "}
                      {departmentLabels || departmentName(undefined)}
                    </>
                  }
                  chips={
                    <>
                      {/* One Person, however many scope items they cover. */}
                      <CountChip
                        value={scopeCount}
                        label={
                          scopeCount === 1
                            ? terms.singular
                            : terms.plural
                        }
                      />
                      <CountChip
                        value={person.departmentIds.length}
                        label={
                          person.departmentIds.length === 1
                            ? "Department"
                            : "Departments"
                        }
                      />
                    </>
                  }
                  openHref={withProjectContext(
                    `/contacts/${person.contactId}`,
                    ctx
                  )}
                  editHref={withProjectContext(
                    `/contacts/${person.contactId}/edit`,
                    ctx
                  )}
                />
              );
            })}
          </ul>
        )}
      </ScopeGroup>
    </div>
  );
}

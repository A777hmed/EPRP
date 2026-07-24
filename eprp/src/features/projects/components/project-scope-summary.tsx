"use client";

import * as React from "react";
import Link from "next/link";
import { useWatch, type Control } from "react-hook-form";
import { ExternalLink, PenLine, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, StatusBadge } from "@/components/shared";
import { useMasterData } from "@/features/master-data";
import type { Contact, Department, Project, System } from "@/types";
import {
  PROJECT_EDIT_SECTIONS,
  projectEditReturn,
  withProjectContext,
} from "../project-link-context";
import type { ProjectFormValues } from "../schemas/project-form";

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

/** One linked record with Open / Edit actions. */
function LinkedRow({
  name,
  meta,
  openHref,
  editHref,
  badge,
  extraAction,
}: {
  name: string;
  meta?: React.ReactNode;
  openHref: string;
  editHref: string;
  badge?: React.ReactNode;
  extraAction?: React.ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {name}
          {badge && <span className="ml-2">{badge}</span>}
        </p>
        {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {extraAction}
        <Button variant="outline" size="sm" asChild>
          <Link href={openHref}>
            <ExternalLink data-icon="inline-start" aria-hidden="true" />
            Open
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href={editHref}>
            <PenLine data-icon="inline-start" aria-hidden="true" />
            Edit
          </Link>
        </Button>
      </div>
    </li>
  );
}

/**
 * A record the project references but master data no longer holds. Shown so
 * the gap is visible rather than silently dropped, with no dead-end actions.
 */
function UnlinkedRow({
  name,
  meta,
}: {
  name: string;
  meta?: React.ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {name}
          <span className="ml-2">
            <StatusBadge tone="warning">Not in master data</StatusBadge>
          </span>
        </p>
        {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
      </div>
      <Button variant="outline" size="sm" asChild>
        <Link href="/systems">Find in Systems</Link>
      </Button>
    </li>
  );
}

export interface ProjectScopeSummaryProps {
  /** Absent while the project is still being created. */
  projectId?: string;
  control: Control<ProjectFormValues>;
  /** Loaded project — supplies the team links the form does not manage. */
  project?: Project | null;
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
}: ProjectScopeSummaryProps) {
  const departmentValues = useWatch({ control, name: "departments" }) ?? [];
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

  const context = (
    section: keyof typeof PROJECT_EDIT_SECTIONS,
    sourceType: "department" | "system" | "contact",
    parentId: string
  ) => ({
    projectId,
    sourceType,
    parentId,
    returnTo: projectEditReturn(projectId, section),
  });

  const team = project?.team ?? [];
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
          <ul className="space-y-2">
            {departmentValues.map((assignment) => {
              const id = assignment.departmentId;
              const ctx = context("departments", "department", id);
              return (
                <LinkedRow
                  key={id}
                  name={departmentName(id)}
                  meta={
                    assignment.leadName
                      ? `Lead: ${assignment.leadName}`
                      : "No lead set"
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
          <ul className="space-y-2">
            {projectSystems.map((system) => {
              const ctx = context("systems", "system", system.id);
              const record = systems.find(
                (candidate) => candidate.id === system.id
              );
              const meta = (
                <>
                  {departmentName(system.departmentId)}
                  {system.code && (
                    <span className="ml-1 font-mono">{system.code}</span>
                  )}
                </>
              );
              // Assignments store a name/code snapshot, so a project can
              // still reference a system that no longer exists in master
              // data. Offering Open / Edit there would dead-end, so the row
              // is flagged and points at the Systems list instead.
              if (!record) {
                return (
                  <UnlinkedRow
                    key={`${system.departmentId}-${system.id}`}
                    name={system.name}
                    meta={meta}
                  />
                );
              }
              return (
                <LinkedRow
                  key={`${system.departmentId}-${system.id}`}
                  name={record.name}
                  meta={meta}
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
        count={team.length}
      >
        {team.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title="No contacts linked"
            description="Add contacts from a department or system page, or in the setup wizard."
            className="py-6"
          />
        ) : (
          <ul className="space-y-2">
            {team.map((member) => {
              const ctx = context("contacts", "contact", member.contactId);
              const contact = contacts.find(
                (candidate) => candidate.id === member.contactId
              );
              return (
                <LinkedRow
                  key={`${member.departmentId}-${member.contactId}`}
                  name={contact?.name ?? member.contactId}
                  meta={
                    <>
                      {departmentName(member.departmentId)}
                      {contact?.position && ` · ${contact.position}`}
                      {contact?.email && ` · ${contact.email}`}
                    </>
                  }
                  openHref={withProjectContext(
                    `/contacts/${member.contactId}`,
                    ctx
                  )}
                  editHref={withProjectContext(
                    `/contacts/${member.contactId}/edit`,
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

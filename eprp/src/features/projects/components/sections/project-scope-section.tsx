"use client";

import * as React from "react";
import Link from "next/link";
import { Building2, Contact, ExternalLink, Layers, PenLine, Plus, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyState,
  FilterBar,
  SearchInput,
  StatusBadge,
  type StatCardProps,
} from "@/components/shared";
import { useMasterData } from "@/features/master-data";
import type {
  Contact as ContactRecord,
  Department,
  Discipline,
  Project,
  System,
} from "@/types";
import {
  projectSectionHref,
  type ProjectSectionId,
} from "@/config/project-sections";
import { projectWorkflowHref } from "@/config/project-workflow";
import { ASSIGNMENT_ROLE_META } from "@/lib/constants";
import { withProjectContext } from "../../project-link-context";
import { useHierarchyTerms } from "../../use-hierarchy-terms";
import { ProjectSectionLayout } from "./project-section-layout";
import {
  compareTeamDisplayOrder,
  departmentManager,
} from "../../assignment-rules";

type ScopeKind = "departments" | "systems" | "disciplines" | "contacts";

/** One row in the section table, normalised across the four kinds. */
interface ScopeRow {
  id: string;
  name: string;
  code?: string;
  departmentId?: string;
  systemId?: string;
  meta?: string;
  badge?: React.ReactNode;
  /** False when the project references a record master data no longer has. */
  resolved: boolean;
}

const KIND_META: Record<
  ScopeKind,
  {
    singular: string;
    /** Stored rather than derived: "Program & Study" does not pluralise with "s". */
    plural: string;
    basePath: string;
    icon: typeof Building2;
    setupStep: "departments" | "systems" | "disciplines" | "contacts";
  }
> = {
  departments: {
    singular: "Department",
    plural: "Departments",
    basePath: "/departments",
    icon: Building2,
    setupStep: "departments",
  },
  systems: {
    singular: "System",
    plural: "Systems",
    basePath: "/systems",
    icon: Layers,
    setupStep: "systems",
  },
  disciplines: {
    singular: "Discipline",
    plural: "Disciplines",
    basePath: "/disciplines",
    icon: Wrench,
    setupStep: "disciplines",
  },
  contacts: {
    singular: "Contact",
    plural: "Contacts",
    basePath: "/contacts",
    icon: Contact,
    setupStep: "contacts",
  },
};

export interface ProjectScopeSectionProps {
  project: Project;
  kind: ScopeKind;
  sectionId: ProjectSectionId;
  description: string;
}

/**
 * A project-scoped list of departments, systems, disciplines, or contacts.
 *
 * Everything shown is already linked to this project — these pages read the
 * project's own scope rather than global master data, and the parent selects
 * walk the Project → Department → System → Discipline chain downward.
 */
export function ProjectScopeSection({
  project,
  kind,
  sectionId,
  description,
}: ProjectScopeSectionProps) {
  const { records: departmentRecords } = useMasterData("department");
  const { records: systemRecords } = useMasterData("system");
  const { records: disciplineRecords } = useMasterData("discipline");
  const { records: contactRecords } = useMasterData("contact");

  const departments = departmentRecords as Department[];
  const systems = systemRecords as System[];
  const disciplines = disciplineRecords as Discipline[];
  const contacts = contactRecords as ContactRecord[];

  const [query, setQuery] = React.useState("");
  const [departmentId, setDepartmentId] = React.useState("");
  const [systemId, setSystemId] = React.useState("");
  const [disciplineId, setDisciplineId] = React.useState("");

  const terms = useHierarchyTerms(project);
  // Display only — basePath, setupStep, icon and kind are untouched.
  const base = KIND_META[kind];
  const meta =
    kind === "disciplines"
      ? { ...base, singular: terms.singular, plural: terms.plural }
      : base;
  const pluralLower = meta.plural.toLowerCase();
  const singularLower = meta.singular.toLowerCase();
  const nameOf = (list: { id: string; name: string }[], id?: string) =>
    list.find((record) => record.id === id)?.name ?? "—";

  // Departments and systems that belong to this project, for the selects.
  const projectDepartments = project.departments
    .map((assignment) =>
      departments.find((record) => record.id === assignment.departmentId)
    )
    .filter((record): record is Department => Boolean(record));

  const projectSystems = React.useMemo(
    () =>
      project.departments.flatMap((assignment) =>
        assignment.systems.map((system) => ({
          ...system,
          departmentId: assignment.departmentId,
        }))
      ),
    [project.departments]
  );

  const projectDisciplines = React.useMemo(() => {
    const seen = new Map<string, { id: string; name: string; departmentId?: string }>();
    for (const link of project.disciplines ?? []) {
      if (seen.has(link.disciplineId)) continue;
      seen.set(link.disciplineId, {
        id: link.disciplineId,
        name: nameOf(disciplines, link.disciplineId),
        departmentId: link.departmentId,
      });
    }
    return [...seen.values()];
  }, [project.disciplines, disciplines]);

  /* ------------------------------- Rows ---------------------------------- */

  const rows: ScopeRow[] = React.useMemo(() => {
    switch (kind) {
      case "departments":
        return project.departments.map((assignment) => {
          const record = departments.find(
            (candidate) => candidate.id === assignment.departmentId
          );
          const manager = departmentManager(project, assignment.departmentId);
          const managerName = contacts.find(
            (contact) => contact.id === manager?.contactId
          )?.name;
          return {
            id: assignment.departmentId,
            name: record?.name ?? assignment.departmentId,
            code: record?.code,
            departmentId: assignment.departmentId,
            meta: manager
              ? `Manager: ${managerName ?? manager.contactId}`
              : "Manager assigned on Contacts step",
            badge: (
              <StatusBadge
                tone={assignment.reportingRequired ? "info" : "neutral"}
              >
                {assignment.reportingRequired ? "Weekly input" : "Optional"}
              </StatusBadge>
            ),
            resolved: Boolean(record),
          };
        });

      case "systems":
        return projectSystems.map((system) => ({
          id: system.id,
          name: system.name,
          code: system.code,
          departmentId: system.departmentId,
          systemId: system.id,
          meta: nameOf(departments, system.departmentId),
          resolved: systems.some((record) => record.id === system.id),
        }));

      case "disciplines":
        return (project.disciplines ?? []).map((link) => ({
          id: `${link.disciplineId}-${link.systemId ?? "none"}`,
          name: nameOf(disciplines, link.disciplineId),
          code: disciplines.find((d) => d.id === link.disciplineId)?.code,
          departmentId: link.departmentId,
          systemId: link.systemId,
          meta: [
            nameOf(departments, link.departmentId),
            link.systemId
              ? projectSystems.find((s) => s.id === link.systemId)?.name
              : undefined,
          ]
            .filter(Boolean)
            .join(" · "),
          resolved: disciplines.some(
            (record) => record.id === link.disciplineId
          ),
        }));

      case "contacts":
        return [...(project.team ?? [])]
          .sort((left, right) =>
            compareTeamDisplayOrder(
              left,
              right,
              (id) => contacts.find((contact) => contact.id === id)?.name ?? id
            )
          )
          .map((member) => {
          const record = contacts.find(
            (candidate) => candidate.id === member.contactId
          );
          return {
            id: `${member.contactId}-${member.disciplineId ?? member.systemId ?? "none"}`,
            name: record?.name ?? member.contactId,
            departmentId: member.departmentId,
            systemId: member.systemId,
            meta: [
              nameOf(departments, member.departmentId),
              // Project-specific responsibility structure, shown alongside the
              // person's own (global) job title rather than replacing it.
              member.functionalTitle,
              member.assignmentRole
                ? ASSIGNMENT_ROLE_META[member.assignmentRole].label
                : undefined,
              member.reportsToContactId
                ? `→ ${
                    contacts.find((c) => c.id === member.reportsToContactId)
                      ?.name ?? member.reportsToContactId
                  }`
                : undefined,
              record?.position,
              record?.email,
            ]
              .filter(Boolean)
              .join(" · "),
            resolved: Boolean(record),
          };
          });
    }
  }, [kind, project, projectSystems, departments, systems, disciplines, contacts]);

  /* ----------------------------- Filtering -------------------------------- */

  const teamDisciplineOf = (rowId: string) =>
    (project.team ?? []).find(
      (member) => rowId.startsWith(`${member.contactId}-`)
    )?.disciplineId;

  const visible = rows.filter((row) => {
    if (departmentId && row.departmentId !== departmentId) return false;
    if (systemId && row.systemId !== systemId) return false;
    if (
      disciplineId &&
      kind === "contacts" &&
      teamDisciplineOf(row.id) !== disciplineId
    ) {
      return false;
    }
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      row.name.toLowerCase().includes(q) ||
      (row.code ?? "").toLowerCase().includes(q) ||
      (row.meta ?? "").toLowerCase().includes(q)
    );
  });

  const activeFilters =
    (query ? 1 : 0) +
    (departmentId ? 1 : 0) +
    (systemId ? 1 : 0) +
    (disciplineId ? 1 : 0);

  const resetFilters = () => {
    setQuery("");
    setDepartmentId("");
    setSystemId("");
    setDisciplineId("");
  };

  /* ------------------------------- Stats ---------------------------------- */

  const unresolved = rows.filter((row) => !row.resolved).length;
  const stats: StatCardProps[] = [
    { label: `${meta.plural} linked`, value: String(rows.length), icon: meta.icon },
    { label: "Shown", value: String(visible.length) },
    {
      label: "Departments in scope",
      value: String(project.departments.length),
      icon: Building2,
    },
    ...(unresolved > 0
      ? [
          {
            label: "Missing master data",
            value: String(unresolved),
            helper: "Referenced but not found",
          } satisfies StatCardProps,
        ]
      : []),
  ];

  /* ------------------------------ Actions --------------------------------- */

  const context = {
    projectId: project.id,
    sourceType: "project" as const,
    parentId: project.id,
    currentStep: meta.setupStep,
    returnTo: projectSectionHref(project.id, sectionId),
  };

  // Adding narrows to whichever parent the user has filtered to, so the new
  // record lands in the right place.
  const addContext =
    kind === "systems" && departmentId
      ? { ...context, sourceType: "department" as const, parentId: departmentId }
      : kind === "disciplines" && systemId
        ? { ...context, sourceType: "system" as const, parentId: systemId }
        : kind === "contacts" && disciplineId
          ? {
              ...context,
              sourceType: "discipline" as const,
              parentId: disciplineId,
            }
          : kind === "contacts" && departmentId
            ? {
                ...context,
                sourceType: "department" as const,
                parentId: departmentId,
              }
            : context;

  return (
    <ProjectSectionLayout
      stats={stats}
      title={`${meta.plural} on this project`}
      description={description}
      action={
        <Button variant="outline" size="sm" asChild>
          <Link href={withProjectContext(`${meta.basePath}/new`, addContext)}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add {meta.singular}
          </Link>
        </Button>
      }
      filters={
        <FilterBar activeCount={activeFilters} onReset={resetFilters}>
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder={`Search ${pluralLower}…`}
            aria-label={`Search ${pluralLower}`}
            className="sm:w-64"
          />

          {kind !== "departments" && (
            <Select
              value={departmentId || "all"}
              onValueChange={(value) => {
                setDepartmentId(value === "all" ? "" : value);
                // A narrower selection cannot outlive its parent.
                setSystemId("");
                setDisciplineId("");
              }}
            >
              <SelectTrigger className="w-full sm:w-52" aria-label="Department">
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {projectDepartments.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {kind === "disciplines" && (
            <Select
              value={systemId || "all"}
              onValueChange={(value) => setSystemId(value === "all" ? "" : value)}
            >
              <SelectTrigger className="w-full sm:w-52" aria-label="System">
                <SelectValue placeholder="All systems" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All systems</SelectItem>
                {projectSystems
                  .filter(
                    (system) =>
                      !departmentId || system.departmentId === departmentId
                  )
                  .map((system) => (
                    <SelectItem key={system.id} value={system.id}>
                      {system.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}

          {kind === "contacts" && (
            <Select
              value={disciplineId || "all"}
              onValueChange={(value) =>
                setDisciplineId(value === "all" ? "" : value)
              }
            >
              <SelectTrigger
                className="w-full sm:w-52"
                aria-label={terms.singular}
              >
                <SelectValue placeholder={`All ${terms.pluralLower}`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All {terms.pluralLower}</SelectItem>
                {projectDisciplines
                  .filter(
                    (discipline) =>
                      !departmentId || discipline.departmentId === departmentId
                  )
                  .map((discipline) => (
                    <SelectItem key={discipline.id} value={discipline.id}>
                      {discipline.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </FilterBar>
      }
      quickActions={
        <>
          <Button variant="outline" size="sm" asChild>
            <Link href={withProjectContext(`${meta.basePath}/new`, addContext)}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              Add {meta.singular}
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={projectWorkflowHref(project.id, meta.setupStep)}>
              Manage in setup
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={meta.basePath}>All {pluralLower}</Link>
          </Button>
        </>
      }
    >
      {visible.length === 0 ? (
        <EmptyState
          icon={meta.icon}
          title={
            rows.length === 0
              ? `No ${pluralLower} linked`
              : "Nothing matches those filters"
          }
          description={
            rows.length === 0
              ? `Add a ${singularLower} or link one in the setup wizard.`
              : "Clear the filters to see everything in scope."
          }
          className="py-8"
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => {
                const recordId = row.id.split("-")[0];
                // Composite keys keep duplicates apart; the record id for a
                // link row is the part before the scope suffix.
                const targetId =
                  kind === "disciplines" || kind === "contacts"
                    ? row.id.slice(0, row.id.lastIndexOf("-"))
                    : row.id;
                void recordId;
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <span className="font-medium">{row.name}</span>
                      {row.code && (
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {row.code}
                        </span>
                      )}
                      {row.badge && <span className="ml-2">{row.badge}</span>}
                      {!row.resolved && (
                        <span className="ml-2">
                          <StatusBadge tone="warning">
                            Not in master data
                          </StatusBadge>
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.meta}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.resolved ? (
                        <span className="inline-flex gap-1.5">
                          <Button variant="outline" size="sm" asChild>
                            <Link
                              href={withProjectContext(
                                `${meta.basePath}/${targetId}`,
                                context
                              )}
                            >
                              <ExternalLink
                                data-icon="inline-start"
                                aria-hidden="true"
                              />
                              Open
                            </Link>
                          </Button>
                          <Button variant="outline" size="sm" asChild>
                            <Link
                              href={withProjectContext(
                                `${meta.basePath}/${targetId}/edit`,
                                context
                              )}
                            >
                              <PenLine
                                data-icon="inline-start"
                                aria-hidden="true"
                              />
                              Edit
                            </Link>
                          </Button>
                        </span>
                      ) : (
                        <Button variant="outline" size="sm" asChild>
                          <Link href={meta.basePath}>Find</Link>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </ProjectSectionLayout>
  );
}

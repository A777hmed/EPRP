import type { Project } from "@/types";
import { scopedAssignments } from "@/features/projects/assignment-rules";
import type { ScopeItemResponsibility } from "./workspace";

/**
 * The project's OWN scope, as Project Setup recorded it.
 *
 * Every Weekly selector must offer this and nothing else. The master-data
 * tables are global — the platform holds twelve disciplines and four systems
 * across every project — so a picker backed by master data offers records the
 * selected project never brought in. That is not a cosmetic problem: it lets
 * someone file this week's work against a discipline that is not in scope,
 * producing a submission row no department owns.
 *
 * Two links carry the whole tree and both already exist:
 *
 *   project.departments[].systems   Department -> System
 *   project.disciplines[]           Department + System -> scope item
 *
 * Pure and framework-free, so the selectors, the cascade rules and the
 * assertions all read the same answer.
 */

/** One scope item as the project holds it. */
export interface ProjectScopeItem {
  scopeItemId: string;
  departmentId: string;
  /** The System it sits under, when the project's link records one. */
  systemId?: string;
}

export interface ProjectScopeSystem {
  systemId: string;
  name: string;
  code?: string;
  scopeItemIds: string[];
}

export interface ProjectScopeDepartment {
  departmentId: string;
  systems: ProjectScopeSystem[];
  /**
   * Scope items the project put in this department without naming a System.
   * Kept as their own group rather than hidden — an unfiled item is still in
   * scope and still owes input.
   */
  unfiledScopeItemIds: string[];
}

export interface ProjectScopeTree {
  departments: ProjectScopeDepartment[];
  /** Every scope item id in the project, deduplicated. */
  allScopeItemIds: string[];
}

/**
 * Build the Department -> System -> scope item tree for one project.
 *
 * A scope item linked to a System the project did not assign to that
 * department is treated as unfiled rather than dropped: the link is real data
 * and hiding it would make an in-scope item impossible to report on.
 */
export function buildProjectScopeTree(project: Project): ProjectScopeTree {
  const links = project.disciplines ?? [];
  const departments: ProjectScopeDepartment[] = [];
  const allScopeItemIds = new Set<string>();

  for (const assignment of project.departments ?? []) {
    const departmentId = assignment.departmentId;
    if (!departmentId) continue;

    const mine = links.filter(
      (link) => link.departmentId === departmentId && Boolean(link.disciplineId)
    );

    const systems: ProjectScopeSystem[] = (assignment.systems ?? []).map(
      (system) => ({
        systemId: system.id,
        name: system.name,
        code: system.code,
        scopeItemIds: dedupe(
          mine
            .filter((link) => link.systemId === system.id)
            .map((link) => link.disciplineId)
        ),
      })
    );

    const filed = new Set(systems.flatMap((system) => system.scopeItemIds));
    const unfiledScopeItemIds = dedupe(
      mine.map((link) => link.disciplineId).filter((id) => !filed.has(id))
    );

    for (const id of [...filed, ...unfiledScopeItemIds]) allScopeItemIds.add(id);

    departments.push({ departmentId, systems, unfiledScopeItemIds });
  }

  return { departments, allScopeItemIds: [...allScopeItemIds] };
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

/* ------------------------------- Cascading -------------------------------- */

/** The departments this project assigned. Nothing else may be chosen. */
export function projectDepartmentIds(project: Project | null): string[] {
  return (project?.departments ?? [])
    .map((assignment) => assignment.departmentId)
    .filter((id): id is string => Boolean(id));
}

/** The Systems under one of the project's departments. */
export function projectSystems(
  project: Project | null,
  departmentId: string | undefined
): ProjectScopeSystem[] {
  if (!project || !departmentId) return [];
  const tree = buildProjectScopeTree(project);
  return (
    tree.departments.find((d) => d.departmentId === departmentId)?.systems ?? []
  );
}

/**
 * The scope items reachable under a department and, when given, a System.
 *
 * Passing no System returns everything in the department — including items
 * the project filed under no System — because "Department chosen, System not
 * yet" must not look like "nothing available".
 */
export function projectScopeItemIds(
  project: Project | null,
  departmentId: string | undefined,
  systemId?: string
): string[] {
  if (!project || !departmentId) return [];
  const tree = buildProjectScopeTree(project);
  const department = tree.departments.find(
    (d) => d.departmentId === departmentId
  );
  if (!department) return [];

  if (systemId) {
    return (
      department.systems.find((system) => system.systemId === systemId)
        ?.scopeItemIds ?? []
    );
  }
  return dedupe([
    ...department.systems.flatMap((system) => system.scopeItemIds),
    ...department.unfiledScopeItemIds,
  ]);
}

/**
 * Re-validate a (department, system, scope item) triple against the project.
 *
 * Returns the triple with anything the project does not support cleared, so a
 * parent change cannot leave an orphaned child behind. Callers apply the
 * result rather than deciding for themselves — one rule, used by every
 * selector, means an impossible combination is not merely discouraged on
 * screen but unreachable in the value that gets saved.
 */
export function reconcileScopeSelection(
  project: Project | null,
  selection: {
    departmentId?: string;
    systemId?: string;
    disciplineId?: string;
  }
): { departmentId: string; systemId: string; disciplineId: string } {
  const empty = { departmentId: "", systemId: "", disciplineId: "" };
  if (!project) return empty;

  const departmentId = projectDepartmentIds(project).includes(
    selection.departmentId ?? ""
  )
    ? (selection.departmentId as string)
    : "";
  if (!departmentId) return empty;

  const systemId = projectSystems(project, departmentId).some(
    (system) => system.systemId === selection.systemId
  )
    ? (selection.systemId as string)
    : "";

  const disciplineId = projectScopeItemIds(
    project,
    departmentId,
    systemId || undefined
  ).includes(selection.disciplineId ?? "")
    ? (selection.disciplineId as string)
    : "";

  return { departmentId, systemId, disciplineId };
}

/* ------------------------------- Responsibility --------------------------- */

/**
 * Who may own a Weekly item, given how far the scope has been narrowed.
 *
 * Business rule, narrowest first:
 *
 *   scope item chosen  -> the people assigned to that scope item
 *   department only    -> the project's people in that department
 *   neither            -> the project's own people, i.e. rows carrying no
 *                         department, which is how Project Setup records
 *                         someone brought onto the project rather than into
 *                         one of its departments
 *
 * The global contacts directory is never an answer. Ownership on a Weekly row
 * means accountability on this project, and offering every contact invited
 * rows owned by people with no assignment to the work.
 *
 * One entry per person, carrying the most senior Assignment Role they hold —
 * somebody holding five scope items is one candidate, not five.
 */
export function eligibleOwners(
  project: Project | null,
  selection: {
    departmentId?: string;
    systemId?: string;
    disciplineId?: string;
  }
): ScopeItemResponsibility[] {
  if (!project) return [];

  if (selection.departmentId) {
    const assignments = scopedAssignments(project, selection.departmentId);
    const narrowed = selection.disciplineId
      ? assignments.filter(
          (entry) => entry.disciplineId === selection.disciplineId
        )
      : assignments;
    const systemNarrowed = selection.systemId
      ? narrowed.filter((entry) => entry.systemId === selection.systemId)
      : narrowed;
    return collapseByPerson(
      systemNarrowed.map((entry) => ({
        contactId: entry.contactId,
        assignmentRole: entry.assignmentRole,
        functionalTitle: entry.functionalTitle,
      }))
    );
  }

  // Project-level: the team rows Project Setup recorded against no department.
  return collapseByPerson(
    (project.team ?? [])
      .filter((member) => !member.departmentId)
      .map((member) => ({
        contactId: member.contactId,
        assignmentRole: member.assignmentRole ?? "team_member",
        functionalTitle: member.functionalTitle,
      }))
  );
}

const ROLE_RANK = {
  department_manager: 3,
  team_member_lead: 2,
  team_member: 1,
} as const;

function collapseByPerson(
  entries: ScopeItemResponsibility[]
): ScopeItemResponsibility[] {
  const byPerson = new Map<string, ScopeItemResponsibility>();
  for (const entry of entries) {
    const held = byPerson.get(entry.contactId);
    if (held && ROLE_RANK[held.assignmentRole] >= ROLE_RANK[entry.assignmentRole]) {
      continue;
    }
    byPerson.set(entry.contactId, entry);
  }
  return [...byPerson.values()];
}

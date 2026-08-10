import type { HierarchyTerms } from "@/config/project-terminology";
import { hierarchyTermsFor } from "@/config/project-terminology";
import type { Project, ProjectType } from "@/types";
import {
  assignedScopeItems,
  departmentAssignments,
} from "@/features/projects/assignment-rules";

/**
 * Weekly scope resolution.
 *
 * Answers one question — "what of this project's Weekly may this person see
 * and edit?" — from data that already exists. Every input comes from the Core
 * scoped-assignment model (`project.departments`, `project.team` via
 * `assignment-rules`) and the project-type resolver. Nothing here re-derives
 * responsibility, and nothing here stores it.
 *
 * The resolution path is:
 *
 *   contact -> project -> department -> assigned scope item(s) -> role -> scope
 *
 * where a "scope item" is a Program & Study on PSM/PSAIM projects and a
 * Discipline on every other project type. That distinction is a LABEL only —
 * `terms` carries it for display — and never branches the access logic, so a
 * change of project type can never widen or narrow what someone may see.
 *
 * This module is pure and side-effect free: it makes decisions, it does not
 * enforce them. Enforcement belongs to the callers and, ultimately, to
 * database policy (see the security note in the sprint report).
 */

/** What a person may reach, widest first. */
export type WeeklyCapability =
  /** Every project. Admin. */
  | "all_projects"
  /** Every department in this one project. Project Control / Reporting Coordinator. */
  | "project"
  /** Every scope item within specific departments. Department Manager. */
  | "department"
  /** Only the scope items assigned to them. Scoped team member. */
  | "scope_items"
  /** Nothing — not on this project. */
  | "none";

/** Every scope item in a department, as opposed to an explicit list. */
export const ALL_ITEMS = "all" as const;
export type ScopeItemAccess = string[] | typeof ALL_ITEMS;

export interface WeeklyScope {
  projectId: string;
  contactId: string;
  capability: WeeklyCapability;
  /** Departments this person may work in, always a subset of the project's. */
  departmentIds: string[];
  /** Per department: the scope items they may reach. */
  itemsByDepartment: Record<string, ScopeItemAccess>;
  /** Display wording for the scope-item level. Never used for access. */
  terms: HierarchyTerms;
  /** May roll the departments up into the project Weekly. */
  canConsolidate: boolean;
}

export interface ResolveOptions {
  /** Platform administrator — sees every project. */
  isAdmin?: boolean;
  /** The project's type record, for terminology only. */
  projectType?: ProjectType | null;
}

/**
 * The departments a project's Weekly covers.
 *
 * Business rule 1: only departments actually assigned to the project. The
 * project's own department list is the single source — a department that
 * exists in master data but was never brought into the project has no place
 * in its Weekly, however many stray links point at it.
 */
export function weeklyDepartments(project: Project): string[] {
  return (project.departments ?? [])
    .map((assignment) => assignment.departmentId)
    .filter((id): id is string => Boolean(id));
}

/**
 * Whether a person is the Department Manager of a department.
 *
 * Delegates to the Core, so the "one manager PERSON per project+department,
 * however many scope items they personally hold" rule is the same rule here
 * as in Project Setup rather than a second implementation of it.
 */
export function isDepartmentManager(
  project: Project,
  departmentId: string,
  contactId: string
): boolean {
  return departmentAssignments(project, departmentId).some(
    (entry) =>
      entry.contactId === contactId &&
      entry.assignmentRole === "department_manager"
  );
}

/** Project-wide consolidation roles, read from the project's own fields. */
function isProjectController(project: Project, contactId: string): boolean {
  return (
    project.projectControlManagerId === contactId ||
    project.reportingCoordinatorId === contactId
  );
}

/**
 * Resolve one person's Weekly scope on one project.
 *
 * Capability is decided widest-first and does not accumulate: a Department
 * Manager who also holds individual scope items still gets their whole
 * department, because the wider grant already contains the narrower one.
 */
export function resolveWeeklyScope(
  project: Project,
  contactId: string,
  options: ResolveOptions = {}
): WeeklyScope {
  const terms = hierarchyTermsFor(options.projectType);
  const departments = weeklyDepartments(project);

  const base = {
    projectId: project.id,
    contactId,
    terms,
  };

  const everything = (capability: WeeklyCapability): WeeklyScope => ({
    ...base,
    capability,
    departmentIds: departments,
    itemsByDepartment: Object.fromEntries(
      departments.map((id) => [id, ALL_ITEMS as ScopeItemAccess])
    ),
    canConsolidate: true,
  });

  if (options.isAdmin) return everything("all_projects");
  if (isProjectController(project, contactId)) return everything("project");

  // Department Manager: whole departments, but only the ones they manage.
  const managed = departments.filter((departmentId) =>
    isDepartmentManager(project, departmentId, contactId)
  );

  // Scoped member: only their own items, in departments they are assigned to.
  const owned: Record<string, string[]> = {};
  for (const departmentId of departments) {
    if (managed.includes(departmentId)) continue;
    const items = assignedScopeItems(project, departmentId, contactId).map(
      (assignment) => assignment.disciplineId
    );
    // De-duplicated: the same item held twice under different Assignment
    // Roles is one thing to work on, not two.
    const unique = [...new Set(items)];
    if (unique.length > 0) owned[departmentId] = unique;
  }

  const reachable = [...managed, ...Object.keys(owned)];
  if (reachable.length === 0) {
    return {
      ...base,
      capability: "none",
      departmentIds: [],
      itemsByDepartment: {},
      canConsolidate: false,
    };
  }

  return {
    ...base,
    capability: managed.length > 0 ? "department" : "scope_items",
    departmentIds: reachable,
    itemsByDepartment: {
      ...Object.fromEntries(
        managed.map((id) => [id, ALL_ITEMS as ScopeItemAccess])
      ),
      ...owned,
    },
    canConsolidate: false,
  };
}

/* ------------------------------ Access checks ------------------------------ */

/** Business rule 2: a department user works only inside their department. */
export function canAccessDepartment(
  scope: WeeklyScope,
  departmentId: string
): boolean {
  if (scope.capability === "all_projects") return true;
  return scope.departmentIds.includes(departmentId);
}

/** The scope items a person may reach in a department; empty when none. */
export function visibleScopeItems(
  scope: WeeklyScope,
  departmentId: string
): ScopeItemAccess {
  if (!canAccessDepartment(scope, departmentId)) return [];
  return scope.itemsByDepartment[departmentId] ?? [];
}

/**
 * Business rule 3: a scoped member reaches only their own items; a manager or
 * controller reaches every item in the departments they cover.
 *
 * A row with no scope item is department-level Weekly input, so it follows
 * department access rather than item access.
 */
export function canAccessScopeItem(
  scope: WeeklyScope,
  departmentId: string,
  scopeItemId: string | null | undefined
): boolean {
  const items = visibleScopeItems(scope, departmentId);
  if (items === ALL_ITEMS) return true;
  if (!scopeItemId) return false;
  return items.includes(scopeItemId);
}

/**
 * Cross-project leakage guard.
 *
 * A scope is only ever valid for the project it was resolved against —
 * except for an administrator, who is explicitly project-agnostic.
 */
export function belongsToScopeProject(
  scope: WeeklyScope,
  projectId: string
): boolean {
  return scope.capability === "all_projects" || scope.projectId === projectId;
}

/* -------------------------------- Filtering -------------------------------- */

/** The shape any Weekly row shares for scoping purposes. */
export interface WeeklyScopedRow {
  departmentId?: string | null;
  disciplineId?: string | null;
}

/**
 * Keep only the rows a person may work on.
 *
 * Used for submissions and activities alike — both carry a department and an
 * optional scope item, so one filter serves both rather than two that can
 * drift apart.
 */
export function filterWeeklyRows<T extends WeeklyScopedRow>(
  scope: WeeklyScope,
  rows: T[]
): T[] {
  return rows.filter((row) => {
    if (!row.departmentId) return scope.canConsolidate;
    if (!canAccessDepartment(scope, row.departmentId)) return false;
    const items = visibleScopeItems(scope, row.departmentId);
    if (items === ALL_ITEMS) return true;
    // A department-level row inside a reachable department is visible to a
    // scoped member: it is the department's shared input, not someone else's.
    if (!row.disciplineId) return true;
    return items.includes(row.disciplineId);
  });
}

/**
 * Departments whose Weekly input a person is expected to complete.
 *
 * Distinct from what they may READ: a controller sees every department but
 * owes input on none, while a scoped member owes input on the departments
 * they hold items in.
 */
export function departmentsAwaitingInput(scope: WeeklyScope): string[] {
  if (scope.capability === "all_projects" || scope.capability === "project") {
    return [];
  }
  return scope.departmentIds;
}

/**
 * The verdict on editing, and why. Named so the server page and the client
 * workspace pass the same shape around instead of restating it.
 */
export interface WeeklyEditability {
  canEdit: boolean;
  /** Present whenever `canEdit` is false, so the UI never hides the reason. */
  reason?: string;
}

/**
 * Whether the viewer may edit Weekly content at all.
 *
 * Read-only is the default: a lifecycle state past collection, or a scope
 * that reaches nothing, both mean the UI must render disabled controls with
 * a visible reason rather than inputs that fail on save.
 */
export function weeklyEditability(
  scope: WeeklyScope,
  reportStatus: string
): WeeklyEditability {
  if (scope.capability === "none") {
    return {
      canEdit: false,
      reason:
        "You have no assignments on this project, so this report is read-only for you.",
    };
  }
  if (reportStatus === "locked" || reportStatus === "finalized") {
    return {
      canEdit: false,
      reason:
        "This report is locked. Changes require a new revision — locked reports stay immutable.",
    };
  }
  if (reportStatus === "approved") {
    return {
      canEdit: scope.capability === "all_projects",
      reason:
        scope.capability === "all_projects"
          ? undefined
          : "This report is approved. Only an administrator can still change it.",
    };
  }
  return { canEdit: true };
}

import type {
  Contact,
  Discipline,
  Project,
  ProjectDisciplineLink,
  ProjectTeamMember,
  System,
} from "@/types";
import {
  DEFAULT_HIERARCHY_TERMS,
  type HierarchyTerms,
} from "./project-terminology";

/**
 * The guided project setup wizard.
 *
 * Project Info → Departments → Systems → Disciplines → Contacts → Review.
 * Each step depends on the one before it: you cannot scope systems before
 * departments exist, or disciplines before systems. Nothing here is a stored
 * status — every step's state is derived from the saved project, so it stays
 * correct however the data was edited afterwards.
 */

export type ProjectWorkflowStepId =
  | "info"
  | "departments"
  | "systems"
  | "disciplines"
  | "contacts"
  | "review";

export interface ProjectWorkflowStep {
  id: ProjectWorkflowStepId;
  label: string;
  description: string;
}

export const projectWorkflowSteps: ProjectWorkflowStep[] = [
  {
    id: "info",
    label: "Project Info",
    description:
      "Identity, client, schedule, and the manager accountable for delivery.",
  },
  {
    id: "departments",
    label: "Departments",
    description:
      "The departments contributing to this project and their reporting duties.",
  },
  {
    id: "systems",
    label: "Systems",
    description:
      "Plant and facility systems in scope, assigned to their owning department.",
  },
  {
    id: "disciplines",
    label: "Disciplines",
    description:
      "Engineering disciplines, linked to the systems and departments they cover.",
  },
  {
    id: "contacts",
    label: "Contacts",
    description:
      "The project team, scoped to the department and discipline they work in.",
  },
  {
    id: "review",
    label: "Review",
    description: "Confirm everything is in place before finishing setup.",
  },
];

const stepIds = projectWorkflowSteps.map((step) => step.id);

export function isProjectWorkflowStep(
  value: string
): value is ProjectWorkflowStepId {
  return (stepIds as string[]).includes(value);
}

export function getProjectWorkflowStep(
  id: ProjectWorkflowStepId
): ProjectWorkflowStep {
  const step = projectWorkflowSteps.find((candidate) => candidate.id === id);
  if (!step) throw new Error(`Unknown project workflow step: ${id}`);
  return step;
}

/**
 * The same step, relabelled for the project's hierarchy terminology.
 *
 * Only the `disciplines` step has alternate wording; every other step is
 * returned untouched. The step **id, order, gating, and completion rules are
 * unchanged** — this is display text only, so `projectWorkflowSteps` stays the
 * single source of sequence.
 */
export function localizeProjectWorkflowStep(
  step: ProjectWorkflowStep,
  terms: HierarchyTerms
): ProjectWorkflowStep {
  // Default terminology returns the step exactly as configured, so a
  // non-PSM project keeps its original wording verbatim — including phrasing
  // that is not derived from the terms ("Engineering disciplines, …").
  if (terms.plural === DEFAULT_HIERARCHY_TERMS.plural) return step;

  if (step.id === "disciplines") {
    return {
      ...step,
      label: terms.plural,
      description: `${terms.plural}, linked to the systems and departments they cover.`,
    };
  }
  // Contacts keeps its own label but its description names the hierarchy level.
  if (step.id === "contacts") {
    return {
      ...step,
      description: `The project team, scoped to the department and ${terms.singularLower} they work in.`,
    };
  }
  return step;
}

/** Convenience: look the step up and relabel it in one call. */
export function getLocalizedProjectWorkflowStep(
  id: ProjectWorkflowStepId,
  terms: HierarchyTerms
): ProjectWorkflowStep {
  return localizeProjectWorkflowStep(getProjectWorkflowStep(id), terms);
}

/** Wizard step URL. Step 1 has no project yet when creating from scratch. */
export function projectWorkflowHref(
  projectId: string | undefined,
  step: ProjectWorkflowStepId
): string {
  if (!projectId) return "/projects/new";
  return `/projects/${projectId}/setup/${step}`;
}

export function projectStepIndex(id: ProjectWorkflowStepId): number {
  return stepIds.indexOf(id);
}

export function nextStepId(
  id: ProjectWorkflowStepId
): ProjectWorkflowStepId | undefined {
  return stepIds[projectStepIndex(id) + 1];
}

/* ------------------------------ Completion ------------------------------- */

/** One requirement a step is measured against. */
export interface WorkflowCheck {
  label: string;
  passed: boolean;
  /** Shown when the check fails, to say what to do about it. */
  hint?: string;
}

export interface ProjectStepStatus {
  id: ProjectWorkflowStepId;
  checks: WorkflowCheck[];
  passedCount: number;
  total: number;
  /** 0–100, for the progress indicator. */
  percent: number;
  complete: boolean;
  /**
   * False when an earlier step is still incomplete. The first incomplete
   * step stays unlocked so there is always somewhere to continue.
   */
  unlocked: boolean;
  /** The step that must be finished first, when locked. */
  blockedBy?: ProjectWorkflowStepId;
  /** Labels of the failed checks — the "missing required data" list. */
  missing: string[];
}

/** Master data the workflow is evaluated against. */
export interface WorkflowMasterData {
  systems: System[];
  disciplines: Discipline[];
  contacts: Contact[];
}

function check(label: string, passed: boolean, hint?: string): WorkflowCheck {
  return { label, passed, hint };
}

function infoChecks(project: Project): WorkflowCheck[] {
  return [
    check("Project code", Boolean(project.code)),
    check("Project name", Boolean(project.name)),
    check("Client selected", Boolean(project.clientId)),
    check("Project type selected", Boolean(project.projectTypeId)),
    check("Current phase selected", Boolean(project.currentPhaseId)),
    check("Planned start date", Boolean(project.plannedStartDate)),
    check("Planned finish date", Boolean(project.plannedFinishDate)),
    check("Project manager assigned", Boolean(project.projectManagerId)),
  ];
}

function departmentChecks(project: Project): WorkflowCheck[] {
  const assignments = project.departments;
  return [
    check(
      "At least one department assigned",
      assignments.length > 0,
      "Pick the departments contributing to this project."
    ),
    check(
      "Every department has a lead",
      assignments.length > 0 &&
        assignments.every((assignment) => Boolean(assignment.leadName)),
      "Name the lead for each department."
    ),
    check(
      "At least one department submits weekly input",
      assignments.some((assignment) => assignment.reportingRequired),
      "Mark at least one department as required for weekly reporting."
    ),
  ];
}

function systemChecks(
  project: Project,
  departmentName: (id: string) => string
): WorkflowCheck[] {
  if (project.departments.length === 0) {
    return [check("Assign departments first", false)];
  }
  return project.departments.map((assignment) =>
    check(
      `${departmentName(assignment.departmentId)} has a system`,
      assignment.systems.length > 0,
      `Add at least one system to ${departmentName(assignment.departmentId)}.`
    )
  );
}

/**
 * Disciplines are counted from the project's own links, not from master data:
 * the wizard records which discipline covers which system, and that link is
 * what later reporting breaks progress down by.
 */
function disciplineChecks(
  project: Project,
  departmentName: (id: string) => string,
  terms: HierarchyTerms
): WorkflowCheck[] {
  const links = project.disciplines ?? [];
  if (project.departments.length === 0) {
    return [check("Assign departments first", false)];
  }
  return project.departments.map((assignment) =>
    check(
      `${departmentName(assignment.departmentId)} has a ${terms.singularLower}`,
      links.some((link) => link.departmentId === assignment.departmentId),
      `Link a ${terms.singularLower} to ${departmentName(assignment.departmentId)}.`
    )
  );
}

function contactChecks(
  project: Project,
  departmentName: (id: string) => string
): WorkflowCheck[] {
  const team = project.team ?? [];
  const base = [
    check(
      "Reporting coordinator assigned",
      Boolean(project.reportingCoordinatorId),
      "Set the reporting coordinator on the Project Info step."
    ),
  ];
  if (project.departments.length === 0) {
    return [...base, check("Assign departments first", false)];
  }
  return [
    ...base,
    ...project.departments.map((assignment) =>
      check(
        `${departmentName(assignment.departmentId)} has a contact`,
        team.some(
          (member) => member.departmentId === assignment.departmentId
        ),
        `Add a team contact for ${departmentName(assignment.departmentId)}.`
      )
    ),
  ];
}

/**
 * Review passes only when every other step does — it is the confirmation
 * gate, so it mirrors their outcome rather than adding new requirements.
 */
function reviewChecks(earlier: ProjectStepStatus[]): WorkflowCheck[] {
  return earlier.map((status) =>
    check(
      `${getProjectWorkflowStep(status.id).label} complete`,
      status.complete,
      `${status.missing.length} item(s) outstanding.`
    )
  );
}

/**
 * Evaluate every step against the current project and master data.
 *
 * Returned in workflow order. A step is unlocked when all earlier steps are
 * complete, which is what enforces the dependency chain.
 */
export function evaluateProjectWorkflow(
  project: Project,
  data: WorkflowMasterData,
  departmentName: (id: string) => string = (id) => id,
  /** Display wording only — never changes which checks run or their outcome. */
  terms: HierarchyTerms = DEFAULT_HIERARCHY_TERMS
): ProjectStepStatus[] {
  void data; // Reserved: all checks now read project-scoped links.

  const build = (
    id: ProjectWorkflowStepId,
    checks: WorkflowCheck[],
    previousComplete: boolean,
    blocker: ProjectWorkflowStepId | undefined
  ): ProjectStepStatus => {
    const passedCount = checks.filter((item) => item.passed).length;
    const total = checks.length;
    return {
      id,
      checks,
      passedCount,
      total,
      percent: total === 0 ? 0 : Math.round((passedCount / total) * 100),
      complete: total > 0 && passedCount === total,
      unlocked: previousComplete,
      blockedBy: previousComplete ? undefined : blocker,
      missing: checks.filter((item) => !item.passed).map((item) => item.label),
    };
  };

  const ordered: ProjectStepStatus[] = [];
  let previousComplete = true;
  let firstBlocker: ProjectWorkflowStepId | undefined;

  const checksFor = (id: ProjectWorkflowStepId): WorkflowCheck[] => {
    switch (id) {
      case "info":
        return infoChecks(project);
      case "departments":
        return departmentChecks(project);
      case "systems":
        return systemChecks(project, departmentName);
      case "disciplines":
        return disciplineChecks(project, departmentName, terms);
      case "contacts":
        return contactChecks(project, departmentName);
      case "review":
        return reviewChecks(ordered);
    }
  };

  for (const step of projectWorkflowSteps) {
    const status = build(
      step.id,
      checksFor(step.id),
      previousComplete,
      firstBlocker
    );
    ordered.push(status);
    if (previousComplete && !status.complete) firstBlocker = step.id;
    previousComplete = previousComplete && status.complete;
  }

  return ordered;
}

/** Overall setup completion across every step except Review. */
export function projectWorkflowPercent(statuses: ProjectStepStatus[]): number {
  const scored = statuses.filter((status) => status.id !== "review");
  const total = scored.reduce((sum, status) => sum + status.total, 0);
  if (total === 0) return 0;
  const passed = scored.reduce((sum, status) => sum + status.passedCount, 0);
  return Math.round((passed / total) * 100);
}

/** The step the user should work on next — the first incomplete one. */
export function nextIncompleteStep(
  statuses: ProjectStepStatus[]
): ProjectStepStatus | undefined {
  return statuses.find((status) => !status.complete);
}

/** Every outstanding requirement across the wizard, for the review step. */
export function allMissing(
  statuses: ProjectStepStatus[]
): { step: ProjectWorkflowStepId; label: string }[] {
  return statuses
    .filter((status) => status.id !== "review")
    .flatMap((status) =>
      status.missing.map((label) => ({ step: status.id, label }))
    );
}

/* -------------------------------- Filtering ------------------------------- */

/** The selections that narrow each step's data, carried across the wizard. */
export interface WorkflowScopeSelection {
  departmentId: string;
  systemId: string;
  disciplineId: string;
}

/**
 * Which department the disciplines list narrows to.
 *
 * A selected system resolves to its owning department; otherwise the
 * explicitly chosen department, then "no filter".
 */
export function disciplineScopeDepartmentId(
  scope: WorkflowScopeSelection,
  systems: System[]
): string {
  const selected = systems.find((system) => system.id === scope.systemId);
  return selected?.departmentId ?? scope.departmentId;
}

/** Same resolution one level down: a discipline stands in for its department. */
export function contactScopeDepartmentId(
  scope: WorkflowScopeSelection,
  disciplines: Discipline[]
): string {
  const selected = disciplines.find(
    (discipline) => discipline.id === scope.disciplineId
  );
  return selected?.departmentId ?? scope.departmentId;
}

/**
 * Master records limited to the project's departments, then to the resolved
 * scope department. Records with no department never appear — they are not
 * part of any project's scope.
 */
export function scopedToProject<T extends { departmentId?: string }>(
  records: T[],
  projectDepartmentIds: Set<string>,
  departmentId: string
): T[] {
  return records.filter(
    (record) =>
      Boolean(record.departmentId) &&
      projectDepartmentIds.has(record.departmentId as string) &&
      (!departmentId || record.departmentId === departmentId)
  );
}

/** Group records by their department id, preserving input order. */
export function groupByDepartment<T extends { departmentId?: string }>(
  records: T[]
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const record of records) {
    const key = record.departmentId ?? "";
    grouped.set(key, [...(grouped.get(key) ?? []), record]);
  }
  return grouped;
}

/** Discipline links narrowed by the current scope selection. */
export function scopedDisciplineLinks(
  links: ProjectDisciplineLink[],
  scope: WorkflowScopeSelection
): ProjectDisciplineLink[] {
  return links.filter(
    (link) =>
      (!scope.departmentId || link.departmentId === scope.departmentId) &&
      (!scope.systemId || link.systemId === scope.systemId)
  );
}

/** Team members narrowed by the current scope selection. */
export function scopedTeam(
  team: ProjectTeamMember[],
  scope: WorkflowScopeSelection
): ProjectTeamMember[] {
  return team.filter(
    (member) =>
      (!scope.departmentId || member.departmentId === scope.departmentId) &&
      (!scope.disciplineId || member.disciplineId === scope.disciplineId)
  );
}

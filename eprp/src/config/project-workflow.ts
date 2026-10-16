import type {
  Contact,
  Discipline,
  Project,
  ProjectDisciplineLink,
  ProjectTeamMember,
  StructureFamily,
  System,
} from "@/types";
import {
  DEFAULT_HIERARCHY_TERMS,
  type HierarchyTerms,
} from "./project-terminology";
import { isClassificationComplete } from "@/features/projects/classification";
import { FIXED_RESPONSIBILITIES } from "@/features/projects/responsibilities";
import { subcontractorNeedsCompletion } from "@/features/projects/project-parties";
import { structureCompleteness } from "@/features/projects/structure/structure-rules";
import {
  activeUnitsInOrder,
  requiresResponsible,
  responsibilityGaps,
} from "@/features/projects/structure/structure-responsibilities";
import type { ProjectStructure } from "@/types/project-structure";

/**
 * The guided project setup wizard.
 *
 * Which steps a project has depends on its Project Type (Phase 2C.1b) —
 * see {@link resolveSetupSteps}:
 *
 *   Legacy (unclassified): Project Info → Departments → Systems → Disciplines
 *     → Contacts → Project Team Summary → Review   (unchanged)
 *   PSM:   Project Type & Information → Departments → Systems → Programs &
 *     Studies → Contacts → Project Team & Responsibilities → Review
 *   Other: Project Type & Information → Project Structure → Contacts →
 *     Project Team & Responsibilities → Review
 *
 * An Other project's whole configurable structure (1–4 levels and their
 * units) is ONE step, however many levels it has (Phase 2C.1c). It never
 * falls back to Departments → Systems → Disciplines.
 *
 * Each step depends on the one before it. Nothing here is a stored status —
 * every step's state is derived from the project, so it stays correct however
 * the data was edited afterwards.
 */

export type ProjectWorkflowStepId =
  | "info"
  /** Other projects only — the project's own levels and units (2C.1c). */
  | "structure"
  | "departments"
  | "systems"
  | "disciplines"
  | "contacts"
  | "team"
  | "review";

/**
 * Where a step sits in the setup, so later capabilities have a defined slot
 * rather than forcing another shell redesign: Project Parties and
 * Organization Chart join the "people" group (before and after Project Team
 * & Responsibilities); an Other project's configurable structure is the
 * single "structure" step.
 */
export type SetupStepGroup = "identity" | "structure" | "people" | "confirm";

export interface ProjectWorkflowStep {
  id: ProjectWorkflowStepId;
  label: string;
  description: string;
  group?: SetupStepGroup;
  /**
   * False for a step that is shown but cannot be worked on yet because its
   * capability does not exist. No current step is unavailable; the mechanism
   * stays for later setup capabilities.
   */
  available?: boolean;
}

/**
 * Which setup a project follows. `unclassified` is a new, unsaved project
 * whose Project Type has not been chosen yet.
 */
export type SetupFlow = "legacy" | "psm" | "other" | "unclassified";

export interface SetupContext {
  structureFamily?: StructureFamily | "";
  /** Whether the project exists yet (has an id). */
  saved: boolean;
}

export function setupFlowFor(context: SetupContext): SetupFlow {
  if (context.structureFamily === "psm") return "psm";
  if (context.structureFamily === "other") return "other";
  return context.saved ? "legacy" : "unclassified";
}

/** Shown for a step whose capability arrives in a later setup phase. */
export const NEXT_PHASE_MESSAGE = "Available in a later setup phase.";

/** "Available after first save" — the lock reason for steps of an unsaved project. */
export const NEEDS_SAVED_PROJECT_MESSAGE = "Available after first save";

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
      "The people working on this project, their project party, role and reporting relationship.",
  },
  {
    id: "team",
    label: "Project Team Summary",
    description:
      "Every participant on the project, once, grouped by department.",
  },
  {
    id: "review",
    label: "Review",
    description: "Confirm everything is in place before finishing setup.",
  },
];

const stepIds = projectWorkflowSteps.map((step) => step.id);

/* --------------------------- Step resolver (2C.1b) ------------------------- */

const LEGACY_GROUP: Record<ProjectWorkflowStepId, SetupStepGroup> = {
  info: "identity",
  structure: "structure",
  departments: "structure",
  systems: "structure",
  disciplines: "structure",
  contacts: "people",
  team: "people",
  review: "confirm",
};

const legacyStep = (id: ProjectWorkflowStepId): ProjectWorkflowStep => ({
  ...(projectWorkflowSteps.find((step) => step.id === id) as ProjectWorkflowStep),
  group: LEGACY_GROUP[id],
});

/** Step 1 for every classified (or classifying) project. */
const TYPE_AND_INFO_STEP: ProjectWorkflowStep = {
  id: "info",
  label: "Project Type & Information",
  description:
    "Project Type, identity, client, schedule, and the manager accountable for delivery.",
  group: "identity",
};

const RESPONSIBILITIES_STEP: ProjectWorkflowStep = {
  id: "team",
  label: "Project Team & Responsibilities",
  description: "Every participant on the project and the responsibilities they hold.",
  group: "people",
};

const PROGRAMS_AND_STUDIES_STEP: ProjectWorkflowStep = {
  id: "disciplines",
  label: "Programs & Studies",
  description: "Programs & Studies, linked to the systems and departments they cover.",
  group: "structure",
};

/** Other projects: the project's own configurable structure, as one step. */
const STRUCTURE_STEP: ProjectWorkflowStep = {
  id: "structure",
  label: "Project Structure",
  description:
    "The project's own structure levels and units, and which units owe Weekly and Monthly operational input.",
  group: "structure",
};

/**
 * The setup steps for a project, in order.
 *
 * - Legacy (saved, unclassified): exactly today's seven steps.
 * - PSM: Departments → Systems → Programs & Studies, the fixed PSM structure.
 * - Other: one "Project Structure" step instead of any PSM structure steps —
 *   an Other project never falls back to Departments → Systems → Disciplines.
 * - A new project with no type chosen yet: step 1 only; the rest appear once
 *   PSM or Other is chosen.
 */
export function resolveSetupSteps(context: SetupContext): ProjectWorkflowStep[] {
  switch (setupFlowFor(context)) {
    case "legacy":
      return projectWorkflowSteps.map((step) => legacyStep(step.id));
    case "psm":
      return [
        TYPE_AND_INFO_STEP,
        legacyStep("departments"),
        legacyStep("systems"),
        PROGRAMS_AND_STUDIES_STEP,
        legacyStep("contacts"),
        RESPONSIBILITIES_STEP,
        legacyStep("review"),
      ];
    case "other":
      return [
        TYPE_AND_INFO_STEP,
        STRUCTURE_STEP,
        legacyStep("contacts"),
        RESPONSIBILITIES_STEP,
        legacyStep("review"),
      ];
    case "unclassified":
      return [TYPE_AND_INFO_STEP];
  }
}

/** The step definition within a resolved list, if the project has that step. */
export function findSetupStep(
  steps: ProjectWorkflowStep[],
  id: ProjectWorkflowStepId
): ProjectWorkflowStep | undefined {
  return steps.find((step) => step.id === id);
}

/** A step's label within a resolved list, falling back to its default label. */
export function setupStepLabel(
  steps: ProjectWorkflowStep[],
  id: ProjectWorkflowStepId
): string {
  return findSetupStep(steps, id)?.label ?? getProjectWorkflowStep(id).label;
}

/**
 * Where the first successful save lands. Create continues to the next step of
 * the chosen flow; Save Draft keeps editing step 1. Used with
 * `router.replace`, so Back never returns to an empty /projects/new.
 */
export function firstSaveHref(
  projectId: string,
  structureFamily: StructureFamily | "" | undefined,
  intent: "create" | "draft"
): string {
  if (intent === "draft") return projectWorkflowHref(projectId, "info");
  const steps = resolveSetupSteps({ structureFamily, saved: true });
  return projectWorkflowHref(projectId, nextStepId("info", steps) ?? "info");
}

export interface NewProjectNavItem {
  id: ProjectWorkflowStepId;
  label: string;
  /** Only step 1 has one, and it is /projects/new — never a project URL. */
  href?: string;
  active: boolean;
  /** Why the item is disabled, when it is. */
  disabledReason?: string;
}

/**
 * The new-project setup sidebar: the chosen Project Type's steps, with step 1
 * live at /projects/new and every later step visible but disabled. No item
 * links to a saved-project route — there is no project id yet.
 */
export function newProjectSetupNavItems(
  structureFamily: StructureFamily | "" | undefined
): NewProjectNavItem[] {
  return resolveSetupSteps({ structureFamily, saved: false }).map((step, index) =>
    index === 0
      ? { id: step.id, label: step.label, href: "/projects/new", active: true }
      : {
          id: step.id,
          label: step.label,
          active: false,
          disabledReason: NEEDS_SAVED_PROJECT_MESSAGE,
        }
  );
}

/** Every step id any flow can route to — for URL validation. */
const ALL_STEP_IDS: ProjectWorkflowStepId[] = [...stepIds, "structure"];

export function isProjectWorkflowStep(
  value: string
): value is ProjectWorkflowStepId {
  return (ALL_STEP_IDS as string[]).includes(value);
}

/** The default definition of a step (legacy wording; the Other step for "structure"). */
export function getProjectWorkflowStep(
  id: ProjectWorkflowStepId
): ProjectWorkflowStep {
  if (id === "structure") return STRUCTURE_STEP;
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

/** Position within a step list (the legacy list unless one is given). */
export function projectStepIndex(
  id: ProjectWorkflowStepId,
  steps: ProjectWorkflowStep[] = projectWorkflowSteps
): number {
  return steps.findIndex((step) => step.id === id);
}

/** The step after `id` within a step list (the legacy list unless one is given). */
export function nextStepId(
  id: ProjectWorkflowStepId,
  steps: ProjectWorkflowStep[] = projectWorkflowSteps
): ProjectWorkflowStepId | undefined {
  const index = projectStepIndex(id, steps);
  return index < 0 ? undefined : steps[index + 1]?.id;
}

/** The step before `id` within a step list. */
export function previousStepId(
  id: ProjectWorkflowStepId,
  steps: ProjectWorkflowStep[] = projectWorkflowSteps
): ProjectWorkflowStepId | undefined {
  const index = projectStepIndex(id, steps);
  return index <= 0 ? undefined : steps[index - 1]?.id;
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
  /**
   * False for a step whose capability does not exist yet. Shown, never
   * worked on.
   */
  available: boolean;
  /**
   * Why the step cannot be opened, when it cannot:
   * - `earlier-step`: an earlier step is incomplete (see `blockedBy`);
   * - `unsaved`: the project has not been saved yet;
   * - `next-phase`: the capability arrives in a later setup phase.
   */
  lockReason?: "earlier-step" | "unsaved" | "next-phase";
}

/**
 * An Other project's structure as the workflow sees it: the loaded
 * structure, or null while it loads or after a failed load (with the
 * plain-language error). Never a guessed or fallback structure.
 */
export interface StructureWorkflowInput {
  structure: Pick<ProjectStructure, "levels" | "nodes" | "assignments"> | null;
  error?: string | null;
}

/** Data the workflow is evaluated against. */
export interface WorkflowMasterData {
  systems: System[];
  disciplines: Discipline[];
  contacts: Contact[];
  /** Other projects only. Absent means "not loaded yet". */
  structure?: StructureWorkflowInput;
}

function check(label: string, passed: boolean, hint?: string): WorkflowCheck {
  return { label, passed, hint };
}

/** What the Project Info checks read — a saved project or live form values. */
export type InfoCheckInput = Pick<
  Project,
  | "code"
  | "name"
  | "clientId"
  | "structureFamily"
  | "projectTypeId"
  | "currentPhaseId"
  | "plannedStartDate"
  | "plannedFinishDate"
  | "projectManagerId"
> & Partial<Pick<Project, "parties">>;

function infoChecks(project: InfoCheckInput): WorkflowCheck[] {
  // Zero subcontractors adds no check: Project Information stays Complete.
  // A saved subcontractor missing Scope / Package or Engagement Status (e.g.
  // one created before 2C.3B) needs completion. PSM and Other are identical.
  const subcontractors = (project.parties ?? []).filter((party) => party.kind === "subcontractor");
  const incomplete = subcontractors.filter(subcontractorNeedsCompletion).length;
  return [
    check("Project code", Boolean(project.code)),
    check("Project name", Boolean(project.name)),
    check("Client selected", Boolean(project.clientId)),
    // PSM: the family alone; Other: family + category; legacy: a type chosen.
    check("Project type selected", isClassificationComplete(project)),
    check("Project lifecycle phase selected", Boolean(project.currentPhaseId)),
    check("Planned start date", Boolean(project.plannedStartDate)),
    check("Planned finish date", Boolean(project.plannedFinishDate)),
    check("Project manager assigned", Boolean(project.projectManagerId)),
    ...(subcontractors.length > 0 ? [check(
      "Subcontractor details complete",
      incomplete === 0,
      incomplete > 0
        ? `${incomplete} subcontractor${incomplete === 1 ? " needs" : "s need"} Scope / Package and Engagement Status.`
        : undefined
    )] : []),
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
  departmentName: (id: string) => string,
  flow: SetupFlow
): WorkflowCheck[] {
  const team = project.team ?? [];
  const base = [
    check(
      "Reporting coordinator assigned",
      Boolean(project.reportingCoordinatorId),
      "Set the reporting coordinator on the Project Info step."
    ),
  ];
  // An Other project has no departments: never the PSM/legacy department
  // checks. Contacts are not tied to structure units (future work), so the
  // existing project-level responsibility holder is all that is judged.
  if (flow === "other") return base;
  if (project.departments.length === 0) {
    return [...base, check("Assign departments first", false)];
  }
  return [
    ...base,
    ...project.departments.flatMap((assignment) => [
      check(
        `${departmentName(assignment.departmentId)} has a contact`,
        team.some(
          (member) => member.departmentId === assignment.departmentId
        ),
        `Add a team contact for ${departmentName(assignment.departmentId)}.`
      ),
      check(
        `${departmentName(assignment.departmentId)} has a Department Manager`,
        team.some(
          (member) =>
            member.departmentId === assignment.departmentId &&
            member.assignmentRole === "department_manager"
        ),
        `Assign a Department Manager for ${departmentName(assignment.departmentId)}.`
      ),
    ]),
  ];
}

/**
 * An Other project's Project Structure step (Phase 2C.1c). Judged from the
 * shared completeness facts (structureCompleteness) — never re-derived here:
 *
 * - at least one level, at least one active top-level unit, and an active
 *   unit on every configured level;
 * - when the project's Weekly reporting is enabled, at least one active unit
 *   owes Weekly input; the same for Monthly. The enable switches are the
 *   project's own `reporting` settings (projects.weekly_enabled /
 *   monthly_enabled) — the same ones that gate Weekly report creation.
 *
 * Archived units never count. Nothing loaded yet (or a failed load) is an
 * incomplete step with one plain-language check, never an error screen and
 * never a pass — so the steps after it stay locked.
 */
export function structureStepChecks(
  project: Pick<Project, "reporting">,
  input: StructureWorkflowInput | undefined
): WorkflowCheck[] {
  if (!input?.structure) {
    return [
      check(
        "Project structure loaded",
        false,
        input?.error ?? "Loading the project structure…"
      ),
    ];
  }
  const { levels } = input.structure;
  const facts = structureCompleteness(input.structure);
  const levelName = (n: number) =>
    levels.find((level) => level.levelNumber === n)?.pluralLabel ?? `Level ${n}`;
  const checks = [
    check(
      "At least one structure level defined",
      facts.levelCount > 0,
      "Define the project's structure levels."
    ),
    check(
      "At least one active top-level unit",
      facts.activeRootCount > 0,
      "Add a unit at the first level."
    ),
    check(
      "Every structure level has an active unit",
      facts.levelCount > 0 && facts.emptyLevels.length === 0,
      facts.emptyLevels.length > 0
        ? `Add an active unit to: ${facts.emptyLevels.map(levelName).join(", ")}.`
        : "Define the project's structure levels."
    ),
  ];
  if (project.reporting?.weeklyEnabled) {
    checks.push(
      check(
        "At least one unit owes Weekly input",
        facts.weeklyUnitCount > 0,
        "Weekly reporting is enabled: mark the units that owe Weekly input."
      )
    );
  }
  if (project.reporting?.monthlyEnabled) {
    checks.push(
      check(
        "At least one unit owes Monthly input",
        facts.monthlyUnitCount > 0,
        "Monthly reporting is enabled: mark the units that owe Monthly input."
      )
    );
  }
  return checks;
}

/**
 * Structure Responsibilities (Phase 2C.3D) for an Other project's Project
 * Team & Responsibilities step — never Project Structure, which decides only
 * WHICH units owe input. A unit that owes a report the project uses needs
 * that report's Responsible: a missing one BLOCKS. Units that owe nothing,
 * report types the project does not use, a missing Backup and a missing Unit
 * Lead (a warning shown in the workspace) add no check.
 */
export function structureResponsibilityChecks(
  project: Pick<Project, "reporting">,
  input: StructureWorkflowInput | undefined
): WorkflowCheck[] {
  const structure = input?.structure;
  if (!structure) {
    return [check("Structure responsibilities loaded", false, input?.error ?? "Loading the project structure…")];
  }
  const kinds = (["weekly", "monthly"] as const).filter((kind) =>
    activeUnitsInOrder(structure).some((node) => requiresResponsible(project.reporting, node, kind)));
  if (kinds.length === 0) return [];
  if (!structure.assignments) {
    return [check(
      "Structure responsibilities available",
      false,
      "Structure responsibilities are not available on this database yet. Contact your administrator."
    )];
  }
  const gaps = responsibilityGaps(project.reporting, structure);
  return kinds.map((kind) => {
    const label = kind === "weekly" ? "Weekly" : "Monthly";
    const missing = gaps[kind];
    return check(
      `${label} Responsible assigned for every ${label} input unit`,
      missing.length === 0,
      `Assign a ${label} Responsible for: ${missing.map((node) => node.name).join(", ")}.`
    );
  });
}

/**
 * Review passes only when every other step does — it is the confirmation
 * gate, so it mirrors their outcome rather than adding new requirements.
 */
/**
 * Project Team Summary is read-only: it reports what the Contacts step
 * produced rather than asking for anything new.
 *
 * Its check therefore mirrors the Contacts condition instead of inventing a
 * requirement. Introducing a new gate here would block Review on a step where
 * the user has nothing to fix — every correction is made back on Contacts.
 */
function teamChecks(project: Project, flow: SetupFlow, structure?: StructureWorkflowInput): WorkflowCheck[] {
  // An Other project has no department-scoped team. Its project-level
  // holders are the fixed responsibilities Project Information demands; its
  // unit-level accountability is the Structure Responsibilities (2C.3D).
  if (flow === "other") {
    return [
      ...FIXED_RESPONSIBILITIES.filter((meta) => meta.required).map((meta) =>
        check(
          `${meta.label} assigned`,
          Boolean(project[meta.field]),
          `Set the ${meta.label} on Project Type & Information.`
        )
      ),
      ...structureResponsibilityChecks(project, structure),
    ];
  }
  const team = project.team ?? [];
  return [
    check(
      "Project team assembled",
      team.length > 0,
      "Assign the team on the Contacts step."
    ),
  ];
}

function reviewChecks(
  earlier: ProjectStepStatus[],
  steps: ProjectWorkflowStep[]
): WorkflowCheck[] {
  return earlier.map((status) =>
    check(
      `${setupStepLabel(steps, status.id)} complete`,
      status.complete,
      status.available
        ? `${status.missing.length} item(s) outstanding.`
        : NEXT_PHASE_MESSAGE
    )
  );
}

/**
 * Evaluate every step against the current project and master data.
 *
 * Returned in workflow order. A step is unlocked when all earlier steps are
 * complete, which is what enforces the dependency chain.
 */
function buildStatus(
  id: ProjectWorkflowStepId,
  checks: WorkflowCheck[],
  previousComplete: boolean,
  blocker: ProjectWorkflowStepId | undefined,
  available: boolean
): ProjectStepStatus {
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
    available,
    lockReason: !available
      ? "next-phase"
      : previousComplete
        ? undefined
        : "earlier-step",
  };
}

/**
 * Evaluate every step against the current project and master data.
 *
 * Returned in workflow order. A step is unlocked when all earlier steps are
 * complete, which is what enforces the dependency chain. The steps are the
 * project's own resolved setup (see {@link resolveSetupSteps}); a legacy
 * project resolves to exactly the original seven.
 */
export function evaluateProjectWorkflow(
  project: Project,
  data: WorkflowMasterData,
  departmentName: (id: string) => string = (id) => id,
  /** Display wording only — never changes which checks run or their outcome. */
  terms: HierarchyTerms = DEFAULT_HIERARCHY_TERMS,
  steps: ProjectWorkflowStep[] = resolveSetupSteps({
    structureFamily: project.structureFamily,
    saved: true,
  })
): ProjectStepStatus[] {
  // Master records are reserved: every check reads project-scoped links. Only
  // an Other project's structure is read from `data`.
  const flow = setupFlowFor({ structureFamily: project.structureFamily, saved: true });

  const ordered: ProjectStepStatus[] = [];
  let previousComplete = true;
  let firstBlocker: ProjectWorkflowStepId | undefined;

  const checksFor = (id: ProjectWorkflowStepId): WorkflowCheck[] => {
    switch (id) {
      case "info":
        return infoChecks(project);
      case "structure":
        return structureStepChecks(project, data.structure);
      case "departments":
        return departmentChecks(project);
      case "systems":
        return systemChecks(project, departmentName);
      case "disciplines":
        return disciplineChecks(project, departmentName, terms);
      case "contacts":
        return contactChecks(project, departmentName, flow);
      case "team":
        return teamChecks(project, flow, data.structure);
      case "review":
        return reviewChecks(ordered, steps);
    }
  };

  for (const step of steps) {
    const status = buildStatus(
      step.id,
      checksFor(step.id),
      previousComplete,
      firstBlocker,
      step.available !== false
    );
    ordered.push(status);
    if (previousComplete && !status.complete) firstBlocker = step.id;
    previousComplete = previousComplete && status.complete;
  }

  return ordered;
}

/**
 * The workflow of a new, unsaved project, from its live form values.
 *
 * Step 1 is evaluated from what has been entered so far; every later step is
 * shown but locked as `unsaved`, with no checks or counts — nothing about it
 * can exist before the project does.
 */
export function evaluateDraftWorkflow(
  draft: InfoCheckInput,
  steps: ProjectWorkflowStep[]
): ProjectStepStatus[] {
  return steps.map((step, index) => {
    if (index === 0) {
      return buildStatus(step.id, infoChecks(draft), true, undefined, true);
    }
    return {
      id: step.id,
      checks: [],
      passedCount: 0,
      total: 0,
      percent: 0,
      complete: false,
      unlocked: false,
      missing: [],
      available: step.available !== false,
      lockReason: "unsaved",
    };
  });
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

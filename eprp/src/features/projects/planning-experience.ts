/**
 * Phase 13.9A — Planning Experience Foundation (`docs/02` §26.20.1, §26.23).
 *
 * Pure presentation rules for the guided planning experience: the wording of
 * the onboarding question, the Planning Workspace sections, the readiness
 * checklist and the setup state. Nothing here reads or writes storage, and
 * nothing here calculates a planning figure — every input is data that
 * already exists (the onboarding mode, whether a plan, an Opening Position or
 * a Published Planning Snapshot exists).
 *
 * Type-only imports, so the module stays standalone-testable.
 */

import type { PlanningOnboardingMode } from "@/types";

/* ------------------------- "How will this project be planned?" ----------- */

export interface OnboardingChoice {
  /** The EXISTING canonical value written to `project_planning_settings.onboarding_mode`. */
  value: PlanningOnboardingMode;
  label: string;
  description: string;
}

/** Business-language options over the one canonical onboarding field. */
export const ONBOARDING_CHOICES: readonly OnboardingChoice[] = [
  {
    value: "new_project",
    label: "Start planning in EPRP",
    description:
      "The project is starting now. Build or import its plan, then publish the first Planning Snapshot.",
  },
  {
    value: "existing_active_project",
    label: "Project is already running",
    description:
      "Work has already started. Declare where the project stands today as an Opening Position — no invented history.",
  },
  {
    value: "no_formal_schedule",
    label: "No formal schedule",
    description:
      "Progress is reported without a formal plan. It is shown as “Reported — not planning governed”, and SPI is not applicable.",
  },
];

/** The technical name of each value, for the "Show advanced" view. */
export const ONBOARDING_TECHNICAL_LABEL: Record<PlanningOnboardingMode, string> = {
  new_project: "New Project",
  existing_active_project: "Existing Active Project",
  no_formal_schedule: "No Formal Schedule",
};

export function onboardingChoice(mode: PlanningOnboardingMode): OnboardingChoice {
  return ONBOARDING_CHOICES.find((choice) => choice.value === mode) ?? ONBOARDING_CHOICES[0];
}

/* ------------------------------ Workspace sections ----------------------- */

export type PlanningWorkspaceView = "summary" | "master-plan" | "imports" | "baselines";

export const PLANNING_WORKSPACE_VIEWS: readonly { id: PlanningWorkspaceView; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "master-plan", label: "Master Plan" },
  { id: "imports", label: "Imports & Review" },
  { id: "baselines", label: "Baselines & Snapshots" },
];

/** Earlier tab ids that may still sit in a bookmark, mapped to their new home. */
const LEGACY_VIEW_ALIAS: Record<string, PlanningWorkspaceView> = {
  overview: "summary",
  "planning-data": "imports",
};

/** The section a `?view=` value opens; anything unknown opens Summary. */
export function resolvePlanningView(value: string | null | undefined): PlanningWorkspaceView {
  if (!value) return "summary";
  const known = PLANNING_WORKSPACE_VIEWS.find((view) => view.id === value);
  if (known) return known.id;
  return LEGACY_VIEW_ALIAS[value] ?? "summary";
}

/** Deep link to one Planning Workspace section. */
export function planningViewHref(projectId: string, view: PlanningWorkspaceView): string {
  return view === "summary"
    ? `/projects/${projectId}/planning`
    : `/projects/${projectId}/planning?view=${view}`;
}

/* ------------------- "Do you already have an external schedule?" -------- */

export type ExternalScheduleAnswer = "p6" | "excel" | "not-yet" | "build-in-eprp";

export const EXTERNAL_SCHEDULE_CHOICES: readonly { value: ExternalScheduleAnswer; label: string }[] = [
  { value: "p6", label: "Primavera P6" },
  { value: "excel", label: "Excel schedule" },
  { value: "not-yet", label: "Not yet" },
  { value: "build-in-eprp", label: "Build in EPRP" },
];

export interface ScheduleGuidance {
  view: PlanningWorkspaceView;
  action: string;
  explanation: string;
}

/**
 * Guidance only — owner decision 2026-10-15: the answer is NEVER persisted
 * (not to `default_import_source`, not anywhere). It only picks the next step
 * shown to the user.
 */
export function externalScheduleGuidance(answer: ExternalScheduleAnswer): ScheduleGuidance {
  switch (answer) {
    case "p6":
      return {
        view: "imports",
        action: "Open Imports & Review",
        explanation: "Import the P6 Excel export. Every row is reviewed before anything changes.",
      };
    case "excel":
      return {
        view: "imports",
        action: "Open Imports & Review",
        explanation: "Import the schedule spreadsheet. Every row is reviewed before anything changes.",
      };
    case "not-yet":
      return {
        view: "baselines",
        action: "Declare the Opening Position",
        explanation:
          "Start from where the project stands today. A schedule can be imported later without rewriting that position.",
      };
    case "build-in-eprp":
      return {
        view: "master-plan",
        action: "Open Master Plan",
        explanation: "Build the project breakdown and its work directly in EPRP.",
      };
  }
}

/* --------------------------------- Readiness ----------------------------- */

export interface ReadinessFacts {
  onboardingMode: PlanningOnboardingMode;
  /** A `project_planning_settings` row exists — the choice has been saved. */
  onboardingSaved: boolean;
  /** Any Master Plan work item, planning activity or import batch exists. */
  hasPlanData: boolean;
  /** A draft (not yet promoted) Opening Position exists. */
  hasOpeningDraft: boolean;
  /** A Published Planning Snapshot exists. */
  hasPublishedSnapshot: boolean;
}

export type ReadinessStepState = "done" | "next" | "pending";

export interface ReadinessStep {
  id: "onboarding" | "plan" | "opening" | "publish";
  title: string;
  description: string;
  state: ReadinessStepState;
  /** Where the work is done. `"setup"` is Project Setup → Planning Entry. */
  target: PlanningWorkspaceView | "setup";
  /** Shown, but never blocks the steps after it. */
  optional?: boolean;
}

interface StepDraft extends Omit<ReadinessStep, "state"> {
  done: boolean;
}

/**
 * The guided checklist on Planning Workspace → Summary, derived only from what
 * already exists. Steps whose model belongs to a later slice (weights, earning
 * methods, baselines, manpower, look-ahead) are deliberately absent.
 */
export function planningReadinessSteps(facts: ReadinessFacts): ReadinessStep[] {
  const onboarding: StepDraft = {
    id: "onboarding",
    title: "Decide how the project will be planned",
    description: `${onboardingChoice(facts.onboardingMode).label} — chosen in Project Setup.`,
    target: "setup",
    done: facts.onboardingSaved,
  };

  let drafts: StepDraft[];
  switch (facts.onboardingMode) {
    case "new_project":
      drafts = [
        onboarding,
        {
          id: "plan",
          title: "Build or import the plan",
          description:
            "Add the project breakdown in Master Plan, or import a schedule in Imports & Review.",
          target: facts.hasPlanData ? "master-plan" : "imports",
          done: facts.hasPlanData || facts.hasPublishedSnapshot,
        },
        {
          id: "publish",
          title: "Publish the first Planning Snapshot",
          description:
            "The Published Planning Snapshot is what Project Progress, Weekly and Monthly read.",
          target: "baselines",
          done: facts.hasPublishedSnapshot,
        },
      ];
      break;
    case "existing_active_project":
      drafts = [
        onboarding,
        {
          id: "opening",
          title: "Declare the Opening Position",
          description:
            "Record where the project stands today, as of a Data Date, instead of inventing history.",
          target: "baselines",
          done: facts.hasOpeningDraft || facts.hasPublishedSnapshot,
        },
        {
          id: "publish",
          title: "Promote it as Snapshot V1",
          description: "Once promoted, the Opening Position governs the project's reported position.",
          target: "baselines",
          done: facts.hasPublishedSnapshot,
        },
        {
          id: "plan",
          title: "Bring in the current schedule",
          description: "When a schedule is available, build it in Master Plan or import it.",
          target: facts.hasPlanData ? "master-plan" : "imports",
          done: facts.hasPlanData,
          optional: true,
        },
      ];
      break;
    case "no_formal_schedule":
      drafts = [onboarding];
      break;
  }

  let nextAssigned = false;
  return drafts.map(({ done, ...step }) => {
    if (done) return { ...step, state: "done" };
    if (!nextAssigned && !step.optional) {
      nextAssigned = true;
      return { ...step, state: "next" };
    }
    return { ...step, state: "pending" };
  });
}

/** The single primary next action, or `undefined` when every required step is done. */
export function nextReadinessStep(steps: readonly ReadinessStep[]): ReadinessStep | undefined {
  return steps.find((step) => step.state === "next");
}

/* ------------------------------ Planning governance ---------------------- */

export type PlanningGovernance = "governed" | "awaiting-snapshot" | "not-governed";

/**
 * `docs/02` §26.14: a project is planning-governed once a snapshot exists,
 * whatever its mode; without one, "no formal schedule" is not governed and
 * every other mode is waiting for its first snapshot.
 */
export function planningGovernanceOf(
  onboardingMode: PlanningOnboardingMode,
  hasPublishedSnapshot: boolean
): PlanningGovernance {
  if (hasPublishedSnapshot) return "governed";
  return onboardingMode === "no_formal_schedule" ? "not-governed" : "awaiting-snapshot";
}

/**
 * Whether the legacy, manually-set `overallStatus` badge ("On Track",
 * "Behind", …) may be shown beside a project's identity.
 *
 * Never for a planning-governed project (with or without its first
 * snapshot): its performance reading belongs to the Published Planning
 * Snapshot, and no reliable snapshot-derived Schedule Condition exists yet
 * (13.14). Showing the manual value there contradicts the governed state.
 * Only a not-governed ("no formal schedule") project keeps it, and nothing is
 * shown while the planning state is still unknown. UI suppression only —
 * `overallStatus` itself is neither changed nor retired here.
 */
export function showLegacyPerformanceBadge(governance: PlanningGovernance | undefined): boolean {
  return governance === "not-governed";
}

/**
 * Planning Entry only: what the project WILL be once an unsaved onboarding
 * choice is saved. Presentational — nothing is persisted early, and the saved
 * Planning Status is unchanged. A published snapshot keeps governing
 * whatever the choice (`docs/02` §26.14).
 */
export function pendingPlanningOutcome(
  pendingMode: PlanningOnboardingMode,
  hasPublishedSnapshot: boolean
): string {
  switch (planningGovernanceOf(pendingMode, hasPublishedSnapshot)) {
    case "not-governed":
      return "Reported — not planning governed";
    case "governed":
      return "Still governed by its Published Planning Snapshot";
    case "awaiting-snapshot":
      return pendingMode === "existing_active_project"
        ? "Already running — awaiting its Opening Position as Snapshot V1"
        : "Planned in EPRP — awaiting its first Published Planning Snapshot";
  }
}

/* --------------------------------- Setup state --------------------------- */

export type SetupState = "draft" | "ready" | "controlled";

export const SETUP_STATE_LABEL: Record<SetupState, string> = {
  draft: "Setup: Draft",
  ready: "Setup: Ready for Planning",
  controlled: "Setup: Controlled",
};

/**
 * Presentational only in 13.9A (`docs/02` §26.23.6). Controlled is shown when
 * a governance anchor that exists today — a Published Planning Snapshot — is
 * present. A no-formal-schedule project reaches Controlled only through the
 * 13.9B finalisation record, which does not exist yet. Nothing is locked here.
 */
export function setupStateOf(facts: {
  setupComplete: boolean;
  hasPublishedSnapshot: boolean;
}): SetupState {
  if (facts.hasPublishedSnapshot) return "controlled";
  return facts.setupComplete ? "ready" : "draft";
}

/* ------------------------------- Snapshot figures ------------------------ */

export interface SnapshotFigureInput {
  plannedProgress: number | null;
  actualProgress: number | null;
  variance: number | null;
  spi: number | null;
  isOpeningSnapshot: boolean;
}

export interface SnapshotFigures {
  planned: string;
  earned: string;
  variance: string;
  spi: string;
}

function percent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : `${Math.round(value * 10) / 10}%`;
}

/**
 * Display text for figures the snapshot ALREADY carries — nothing is computed.
 * Absence is "—", never 0. An Opening Position snapshot has declared figures
 * and SPI "N/A" (`docs/02` §26.14).
 */
export function snapshotFigures(input: SnapshotFigureInput): SnapshotFigures {
  const variance =
    input.variance === null || !Number.isFinite(input.variance)
      ? "—"
      : `${input.variance > 0 ? "+" : ""}${Math.round(input.variance * 10) / 10} pts`;
  const spi =
    input.isOpeningSnapshot || input.spi === null || !Number.isFinite(input.spi)
      ? "N/A"
      : input.spi.toFixed(2);
  return {
    planned: percent(input.plannedProgress),
    earned: percent(input.actualProgress),
    variance,
    spi,
  };
}

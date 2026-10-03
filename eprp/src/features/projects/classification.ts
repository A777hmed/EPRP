import type { Project, ProjectType, StructureFamily } from "@/types";

/**
 * Project classification (Phase 2C.1): the first Project Setup choice —
 * PSM Project or Other Project — and the Project Category an Other project
 * carries.
 *
 * Project Category is the existing `project_types` master (`projectTypeId`);
 * only the user-facing wording changed. A category row with `allowsCustomName`
 * asks for a project-specific name in `projectCategoryDetail`, which is never
 * turned into a master row.
 *
 * Pure: no runtime imports, so the rules can be exercised directly in tests
 * and shared by the form schema, the payload mapping and the UI.
 */

export const STRUCTURE_FAMILY_META: Record<
  StructureFamily,
  { label: string; description: string }
> = {
  psm: {
    label: "PSM Project",
    description: "Departments → Systems → Programs & Studies",
  },
  other: {
    label: "Other Project",
    description: "Classified by a Project Category that describes the work.",
  },
};

/** The form keeps "" for "not chosen", like every other optional select. */
export type StructureFamilyValue = StructureFamily | "";

export interface ClassificationValues {
  structureFamily?: StructureFamilyValue;
  projectTypeId?: string;
  projectCategoryDetail?: string;
}

/**
 * The single display for a project's category: the custom name alone when
 * one is given ("Tank Inspection" — never "Other — Tank Inspection"),
 * otherwise the category's own name.
 */
export function projectCategoryLabel(
  project: { projectCategoryDetail?: string } | null | undefined,
  category: Pick<ProjectType, "name"> | null | undefined
): string | undefined {
  const detail = project?.projectCategoryDetail?.trim();
  if (detail) return detail;
  return category?.name || undefined;
}

/** "PSM Project", "Other Project · Inspection", or "Not classified". */
export function classificationSummary(
  family: StructureFamilyValue | undefined,
  categoryLabel: string | undefined
): string {
  if (!family) return "Not classified";
  const label = STRUCTURE_FAMILY_META[family].label;
  return family === "other" && categoryLabel ? `${label} · ${categoryLabel}` : label;
}

/**
 * What changes when the PSM / Other choice changes. Category and custom name
 * only mean something for the family they were chosen under, so a real change
 * clears both; choosing the same family again changes nothing.
 */
export function structureFamilyChangePatch(
  current: ClassificationValues,
  next: StructureFamily
): Required<ClassificationValues> | null {
  if (current.structureFamily === next) return null;
  return { structureFamily: next, projectTypeId: "", projectCategoryDetail: "" };
}

/** A category that does not accept a custom name must not keep one. */
export function categoryChangeKeepsDetail(
  category: Pick<ProjectType, "allowsCustomName"> | null | undefined
): boolean {
  return Boolean(category?.allowsCustomName);
}

export interface ClassificationIssue {
  path: "structureFamily" | "projectTypeId" | "projectCategoryDetail";
  message: string;
}

export interface ClassificationRuleOptions {
  /** Ids of the categories whose `allowsCustomName` is set. */
  customNameCategoryIds?: readonly string[];
  /** A new project must choose PSM / Other before it can be saved at all. */
  requireStructureFamily?: boolean;
  /** Final submission (not Save Draft): adds the legacy "type required" rule. */
  final?: boolean;
}

/**
 * Classification rules for the project form. Mirrors the database rules that
 * apply to drafts and final saves alike (Other needs a category; a custom name
 * exactly when the category accepts one), plus the legacy final-save rule for
 * projects that are not classified yet.
 */
export function classificationIssues(
  values: ClassificationValues,
  options: ClassificationRuleOptions = {}
): ClassificationIssue[] {
  const issues: ClassificationIssue[] = [];
  const family = values.structureFamily || undefined;
  const categoryId = values.projectTypeId || undefined;
  const detail = values.projectCategoryDetail?.trim() || undefined;

  if (!family) {
    if (options.requireStructureFamily) {
      issues.push({ path: "structureFamily", message: "Choose PSM Project or Other Project" });
    }
    // Legacy, unclassified project: keep the existing final-save rule.
    if (options.final && !categoryId) {
      issues.push({ path: "projectTypeId", message: "Select a project category" });
    }
    return issues;
  }

  if (family === "other") {
    if (!categoryId) {
      issues.push({ path: "projectTypeId", message: "Select a project category" });
      return issues;
    }
    const allowsCustom = (options.customNameCategoryIds ?? []).includes(categoryId);
    if (allowsCustom && !detail) {
      issues.push({ path: "projectCategoryDetail", message: "Specify the category" });
    }
  }
  return issues;
}

/**
 * Classification fields a save sends.
 *
 * - `create`: the chosen family, category and custom name.
 * - `update`: category and custom name only. The family is locked once the
 *   project exists, so an ordinary save never carries it; a legacy project is
 *   classified through {@link classifyPayload} instead.
 *
 * A PSM project has no Project Category: it always sends both category
 * fields as cleared, so no stale value can be saved or resurrected. The
 * custom name only travels with an Other project. Blank values become
 * `undefined`, which the service writes as NULL (an explicit clear).
 */
export function classificationSaveFields(
  values: ClassificationValues,
  mode: "create" | "update"
): Pick<Project, "projectTypeId" | "projectCategoryDetail" | "structureFamily"> {
  const family = values.structureFamily || undefined;
  const fields: Pick<Project, "projectTypeId" | "projectCategoryDetail" | "structureFamily"> = {
    projectTypeId: family === "psm" ? undefined : values.projectTypeId || undefined,
    projectCategoryDetail:
      family === "other" ? values.projectCategoryDetail?.trim() || undefined : undefined,
  };
  if (mode === "create") fields.structureFamily = family;
  return fields;
}

/**
 * The one-time classification of a legacy (NULL family) project.
 *
 * A PSM project has no Project Category, so PSM explicitly clears both
 * category fields (present keys with `undefined` are written as NULL). Other
 * sends the chosen category and custom name. Nothing changes on the project
 * until the user performs this action.
 */
export function classifyPayload(
  family: StructureFamily,
  values: ClassificationValues
): Pick<Project, "structureFamily" | "projectTypeId" | "projectCategoryDetail"> {
  if (family === "psm") {
    return { structureFamily: "psm", projectTypeId: undefined, projectCategoryDetail: undefined };
  }
  return {
    structureFamily: "other",
    projectTypeId: values.projectTypeId || undefined,
    projectCategoryDetail: values.projectCategoryDetail?.trim() || undefined,
  };
}

/**
 * Whether the Project Info "Project type selected" check passes.
 *
 * PSM: the family alone. Other: family and category. Legacy (no family): the
 * check it always was — a project type chosen.
 */
export function isClassificationComplete(
  project: Pick<Project, "structureFamily" | "projectTypeId">
): boolean {
  if (project.structureFamily === "psm") return true;
  return Boolean(project.projectTypeId);
}

/* ------------------- System Admin "Correct Project Type" ------------------ */

/**
 * Whether to offer "Correct Project Type". System Admin only, and only for a
 * classified (locked) project that is still live — a legacy project is
 * classified through its own one-time action, and an archived project is
 * read-only for everyone. Presentation only: the database refuses everyone
 * else regardless.
 */
export function canCorrectProjectType(
  identity: { resolved: boolean; isAdmin: boolean },
  project: Pick<Project, "structureFamily" | "status"> | null | undefined
): boolean {
  if (!identity.resolved || !identity.isAdmin || !project) return false;
  return Boolean(project.structureFamily) && project.status !== "archived";
}

export interface CorrectionIssue {
  path: ClassificationIssue["path"] | "reason";
  message: string;
}

/**
 * Validation for the correction dialog: a complete, valid target that differs
 * from the current family, and a non-blank reason.
 */
export function correctionIssues(
  currentFamily: StructureFamily | undefined,
  target: ClassificationValues,
  reason: string,
  options: Pick<ClassificationRuleOptions, "customNameCategoryIds"> = {}
): CorrectionIssue[] {
  const issues: CorrectionIssue[] = [
    ...classificationIssues(target, { ...options, requireStructureFamily: true }),
  ];
  if (target.structureFamily && target.structureFamily === currentFamily) {
    issues.push({ path: "structureFamily", message: "Choose a different Project Type" });
  }
  if (!reason.trim()) {
    issues.push({ path: "reason", message: "Enter a reason for the correction" });
  }
  return issues;
}

/**
 * One side of a recorded classification, for history and confirmation text:
 * "PSM Project", "Other Project · Inspection", "Other Project · Tank Inspection".
 * PSM never shows a category; Other uses the canonical category label.
 */
export function classificationLabel(
  family: StructureFamily | undefined,
  categoryName: string | undefined,
  categoryDetail: string | undefined
): string {
  if (family !== "other") return classificationSummary(family ?? "", undefined);
  return classificationSummary(
    "other",
    projectCategoryLabel(
      { projectCategoryDetail: categoryDetail },
      categoryName ? { name: categoryName } : undefined
    )
  );
}

/** The form's classification values for a saved project — "" for none. */
export function classificationFormValues(
  project: Pick<Project, "structureFamily" | "projectTypeId" | "projectCategoryDetail">
): Required<ClassificationValues> {
  return {
    structureFamily: project.structureFamily ?? "",
    projectTypeId: project.projectTypeId ?? "",
    projectCategoryDetail: project.projectCategoryDetail ?? "",
  };
}

/** The fields of a recorded correction that the history label reads. */
export interface CorrectionHistorySides {
  oldFamily: StructureFamily;
  newFamily: StructureFamily;
  oldProjectTypeId?: string;
  newProjectTypeId?: string;
  oldProjectTypeName?: string;
  newProjectTypeName?: string;
  oldCategoryDetail?: string;
  newCategoryDetail?: string;
}

/**
 * One side of a recorded correction in readable form — never a raw id. Uses
 * the category name snapshotted at correction time, falling back to the
 * current master record, and the canonical label rule (custom name alone; PSM
 * shows no category).
 */
export function correctionHistoryLabel(
  entry: CorrectionHistorySides,
  side: "old" | "new",
  categoryName: (id: string | undefined) => string | undefined
): string {
  const family = side === "old" ? entry.oldFamily : entry.newFamily;
  const typeId = side === "old" ? entry.oldProjectTypeId : entry.newProjectTypeId;
  const snapshot = side === "old" ? entry.oldProjectTypeName : entry.newProjectTypeName;
  const detail = side === "old" ? entry.oldCategoryDetail : entry.newCategoryDetail;
  return classificationLabel(family, snapshot ?? categoryName(typeId), detail);
}

/* ------------------- First save locks the Project Type (2C.1b) ------------ */

/** Which first save was asked for: Create & Continue, or Save Draft. */
export type FirstSaveIntent = "submit" | "draft";

export interface FirstSaveGateState {
  /** A first save waiting for the user to confirm locking the type. */
  pending?: FirstSaveIntent;
}

export type FirstSaveGateEvent =
  | { type: "request"; intent: FirstSaveIntent; isNewProject: boolean }
  | { type: "change-type" }
  | { type: "confirm" }
  | { type: "dismiss" };

export type FirstSaveGateEffect =
  | { kind: "save"; intent: FirstSaveIntent }
  | { kind: "classify" }
  | { kind: "none" };

/**
 * The confirmation before the save that locks the Project Type.
 *
 * Only a project's FIRST save asks — afterwards the type is already locked,
 * so later saves go straight through. "Change Project Type" returns to the
 * PSM / Other choice without saving; "Save and Lock" performs the pending
 * save. The database lock is unaffected: this only makes it visible first.
 */
export function firstSaveGate(
  state: FirstSaveGateState,
  event: FirstSaveGateEvent
): { state: FirstSaveGateState; effect: FirstSaveGateEffect } {
  switch (event.type) {
    case "request":
      return event.isNewProject
        ? { state: { pending: event.intent }, effect: { kind: "none" } }
        : { state: {}, effect: { kind: "save", intent: event.intent } };
    case "change-type":
      return { state: {}, effect: { kind: "classify" } };
    case "confirm":
      return state.pending
        ? { state: {}, effect: { kind: "save", intent: state.pending } }
        : { state: {}, effect: { kind: "none" } };
    case "dismiss":
      return { state: {}, effect: { kind: "none" } };
  }
}

/** Wording of the first-save confirmation for the chosen family. */
export function typeLockConfirmationCopy(family: StructureFamily): {
  title: string;
  body: string;
  detail: string;
  changeLabel: string;
  confirmLabel: string;
} {
  return {
    title: "Save and lock Project Type?",
    body: `This project will be saved as ${family === "psm" ? "a PSM Project" : "an Other Project"}.`,
    detail:
      "Project Type cannot be changed after the first save. Only a System Admin can correct it later with an audited correction.",
    changeLabel: "Change Project Type",
    confirmLabel: "Save and Lock",
  };
}

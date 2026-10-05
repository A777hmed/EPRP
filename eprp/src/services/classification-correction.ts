import type { StructureFamily } from "@/types";

/**
 * System Admin "Correct Project Type" (Phase 2C.1) — shared types, the RPC
 * argument mapping and the error mapping, in their own module.
 *
 * Like `replace-person.ts`, this MUST NOT import from `./project-service` or
 * `./supabase-project-service`: both service modules depend on it at runtime,
 * and putting these in either would turn their one-way edge into a cycle.
 */

export interface CorrectProjectTypeInput {
  projectId: string;
  /** The project version the dialog was opened on; a newer one is refused. */
  expectedUpdatedAt: string;
  structureFamily: StructureFamily;
  /** Required for Other; ignored (sent as NULL) for PSM. */
  projectTypeId?: string;
  /** Only for an Other category that requires a custom name. */
  projectCategoryDetail?: string;
  /** Mandatory, non-blank. */
  reason: string;
}

/** One immutable correction, as recorded by the database. */
export interface ClassificationCorrection {
  id: string;
  projectId: string;
  oldFamily: StructureFamily;
  newFamily: StructureFamily;
  oldProjectTypeId?: string;
  newProjectTypeId?: string;
  /** Category names as they were at the time of the correction. */
  oldProjectTypeName?: string;
  newProjectTypeName?: string;
  oldCategoryDetail?: string;
  newCategoryDetail?: string;
  reason: string;
  correctedBy?: string;
  /** The corrector's name as it was at the time of the correction. */
  correctedByName?: string;
  correctedAt: string;
}

export interface ClassificationCorrectionRow {
  id: string;
  project_id: string;
  old_family: string;
  new_family: string;
  old_project_type_id: string | null;
  new_project_type_id: string | null;
  old_project_type_name: string | null;
  new_project_type_name: string | null;
  old_category_detail: string | null;
  new_category_detail: string | null;
  reason: string;
  corrected_by: string | null;
  corrected_by_name: string | null;
  corrected_at: string;
}

export function rowToClassificationCorrection(
  row: ClassificationCorrectionRow
): ClassificationCorrection {
  return {
    id: row.id,
    projectId: row.project_id,
    oldFamily: row.old_family as StructureFamily,
    newFamily: row.new_family as StructureFamily,
    oldProjectTypeId: row.old_project_type_id ?? undefined,
    newProjectTypeId: row.new_project_type_id ?? undefined,
    oldProjectTypeName: row.old_project_type_name ?? undefined,
    newProjectTypeName: row.new_project_type_name ?? undefined,
    oldCategoryDetail: row.old_category_detail ?? undefined,
    newCategoryDetail: row.new_category_detail ?? undefined,
    reason: row.reason,
    correctedBy: row.corrected_by ?? undefined,
    correctedByName: row.corrected_by_name ?? undefined,
    correctedAt: row.corrected_at,
  };
}

/**
 * Arguments for `correct_project_structure_family()`. A PSM target always
 * sends the Project Category and custom name as NULL — a PSM project has no
 * category — whatever the dialog still holds.
 */
export function correctionRpcArgs(input: CorrectProjectTypeInput) {
  const isPsm = input.structureFamily === "psm";
  return {
    p_project: input.projectId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_new_family: input.structureFamily,
    p_project_type_id: isPsm ? null : input.projectTypeId || null,
    p_project_category_detail: isPsm ? null : input.projectCategoryDetail?.trim() || null,
    p_reason: input.reason.trim(),
  };
}

export type ProjectTypeCorrectionErrorReason =
  | "not_authorized"
  | "reason_required"
  | "invalid_target"
  | "category_required"
  | "category_invalid"
  | "category_psm_family"
  | "detail_required"
  | "detail_not_allowed"
  | "not_found"
  | "stale"
  | "not_classified"
  | "same_type"
  | "structure_exists"
  | "failed";

/**
 * Fixed, user-facing wording per refusal. The database message is never shown:
 * only its [TAG] selects one of these.
 */
export const PROJECT_TYPE_CORRECTION_MESSAGES: Record<ProjectTypeCorrectionErrorReason, string> = {
  not_authorized: "Only a System Admin can correct a Project Type.",
  reason_required: "Enter a reason for the correction.",
  invalid_target: "That correction is not valid. A PSM project has no Project Category.",
  category_required: "Choose a Project Category for an Other project.",
  category_invalid: "Choose an active Project Category.",
  category_psm_family: "An Other project cannot use a PSM / PSAIM Project Category.",
  detail_required: "Specify the category name for this Project Category.",
  detail_not_allowed: "This Project Category does not take a custom name.",
  not_found: "This project no longer exists.",
  stale: "The project changed since this page loaded. Reload, then correct it again.",
  not_classified: "This project is not classified yet. Classify it from Project Setup instead.",
  same_type: "The project already has this Project Type.",
  structure_exists:
    "Archive this project's structure units before changing it to a PSM Project.",
  failed: "The Project Type could not be corrected. No changes were made.",
};

const TAG_REASON: Record<string, ProjectTypeCorrectionErrorReason> = {
  NOT_AUTHORIZED: "not_authorized",
  REASON_REQUIRED: "reason_required",
  INVALID_TARGET: "invalid_target",
  CATEGORY_REQUIRED: "category_required",
  CATEGORY_INVALID: "category_invalid",
  CATEGORY_PSM_FAMILY: "category_psm_family",
  DETAIL_REQUIRED: "detail_required",
  DETAIL_NOT_ALLOWED: "detail_not_allowed",
  NOT_FOUND: "not_found",
  STALE: "stale",
  NOT_CLASSIFIED: "not_classified",
  SAME_TYPE: "same_type",
  STRUCTURE_EXISTS: "structure_exists",
};

export class ProjectTypeCorrectionError extends Error {
  readonly reason: ProjectTypeCorrectionErrorReason;
  constructor(reason: ProjectTypeCorrectionErrorReason) {
    super(PROJECT_TYPE_CORRECTION_MESSAGES[reason]);
    this.name = "ProjectTypeCorrectionError";
    this.reason = reason;
  }
}

/** Database error → safe, semantic error. Unknown failures get the generic one. */
export function mapProjectTypeCorrectionError(
  error: { message?: string; code?: string } | null | undefined
): ProjectTypeCorrectionError {
  const tag = /^\[(\w+)]/.exec(error?.message ?? "")?.[1];
  if (tag && TAG_REASON[tag]) return new ProjectTypeCorrectionError(TAG_REASON[tag]);
  if (error?.code === "42501") return new ProjectTypeCorrectionError("not_authorized");
  // PT409: the database's business-stale refusal (HTTP 409), raised only with
  // [STALE]. 40001 is NOT treated as stale: a genuine serialization failure
  // means "retry", not "the project changed".
  if (error?.code === "PT409") return new ProjectTypeCorrectionError("stale");
  return new ProjectTypeCorrectionError("failed");
}

/** The classification fields a correction reads and writes. */
export interface CorrectableProject {
  id: string;
  updatedAt: string;
  structureFamily?: StructureFamily;
  projectTypeId?: string;
  projectCategoryDetail?: string;
}

/**
 * The correction rules the database applies, for a backend without one (the
 * in-memory mock). Returns the corrected classification and the history entry
 * to record, or throws the same refusals. Authority is the database's alone.
 *
 * `activeStructureUnits` is the project's count of active Project Structure
 * units (2C.1c): like the database's [STRUCTURE_EXISTS] guard, Other -> PSM
 * is refused while any exist. Archived units alone do not block it.
 */
export function applyProjectTypeCorrection(
  existing: CorrectableProject,
  input: CorrectProjectTypeInput,
  correctedAt: string,
  activeStructureUnits = 0
): {
  classification: Pick<CorrectableProject, "structureFamily" | "projectTypeId" | "projectCategoryDetail">;
  entry: Omit<ClassificationCorrection, "id">;
} {
  const reason = input.reason.trim();
  if (!reason) throw new ProjectTypeCorrectionError("reason_required");
  const args = correctionRpcArgs(input);
  if (input.structureFamily === "other" && !args.p_project_type_id) {
    throw new ProjectTypeCorrectionError("category_required");
  }
  if (existing.updatedAt !== input.expectedUpdatedAt) {
    throw new ProjectTypeCorrectionError("stale");
  }
  if (!existing.structureFamily) throw new ProjectTypeCorrectionError("not_classified");
  if (existing.structureFamily === input.structureFamily) {
    throw new ProjectTypeCorrectionError("same_type");
  }
  // Same order as the database: after the version, classification and
  // same-type checks, before anything is recorded.
  if (existing.structureFamily === "other" && input.structureFamily === "psm" && activeStructureUnits > 0) {
    throw new ProjectTypeCorrectionError("structure_exists");
  }
  const classification = {
    structureFamily: input.structureFamily,
    projectTypeId: args.p_project_type_id ?? undefined,
    projectCategoryDetail: args.p_project_category_detail ?? undefined,
  };
  return {
    classification,
    entry: {
      projectId: existing.id,
      oldFamily: existing.structureFamily,
      newFamily: input.structureFamily,
      oldProjectTypeId: existing.projectTypeId,
      newProjectTypeId: classification.projectTypeId,
      oldCategoryDetail: existing.projectCategoryDetail,
      newCategoryDetail: classification.projectCategoryDetail,
      reason,
      correctedAt,
    },
  };
}

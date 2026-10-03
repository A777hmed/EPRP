import {
  isPsmProjectType,
  isReservedPsmCode,
  isReservedPsmName,
} from "@/config/project-terminology";
import type { ProjectType } from "@/types";
import {
  categoryChangeKeepsDetail,
  type ClassificationValues,
} from "./classification";

/**
 * The Project Category picker of an Other project (Phase 2C.1b).
 *
 * Project Categories are the existing `project_types` master. This module
 * holds the picker's rules — who may add or manage categories, which rows an
 * Other project may choose, and what selecting one changes — so they can be
 * tested without the UI.
 */

export const ADD_PROJECT_CATEGORY_LABEL = "Add New Project Category";
export const MANAGE_PROJECT_CATEGORIES_LABEL = "Manage Project Categories";

/**
 * Whether to offer "+ Add New Project Category" and "Manage Project
 * Categories". This is the EXISTING master-data write rule, not a new
 * permission: `project_types` writes are `has_global_operational_authority()`
 * — System Admin or Project Control Admin — which `isGlobalAuthority` mirrors.
 * Everyone else can only search and select; no action is shown that the
 * database would refuse.
 */
export function canManageProjectCategories(identity: {
  resolved: boolean;
  isGlobalAuthority: boolean;
}): boolean {
  return identity.resolved && identity.isGlobalAuthority;
}

/**
 * Whether an Other project may choose this category: never a PSM / PSAIM-
 * family row. The same rule the database enforces
 * (`is_psm_family_project_type`), applied here so such a row is not offered.
 */
export function isOtherProjectCategory(
  category: Pick<ProjectType, "code" | "name">
): boolean {
  return !isPsmProjectType(category as ProjectType);
}

/**
 * Choosing a category: only the classification fields change. A category that
 * does not accept a custom name drops any previously typed one.
 */
export function selectProjectCategory(
  value: ClassificationValues,
  categoryId: string,
  category: Pick<ProjectType, "allowsCustomName"> | null | undefined
): ClassificationValues {
  return {
    ...value,
    projectTypeId: categoryId,
    projectCategoryDetail: categoryChangeKeepsDetail(category)
      ? value.projectCategoryDetail
      : "",
  };
}

/**
 * What happens after a category is created from the picker: selected when an
 * Other project may use it; otherwise left unselected with the reason — a
 * PSM / PSAIM-family category is created but can never be chosen here.
 */
export function createdCategoryOutcome(
  value: ClassificationValues,
  created: Pick<ProjectType, "id" | "code" | "name" | "allowsCustomName">
): { value: ClassificationValues; selected: boolean; message?: string } {
  if (!isOtherProjectCategory(created)) {
    return {
      value,
      selected: false,
      message: `“${created.name}” is a PSM / PSAIM category, so it cannot be used for an Other project.`,
    };
  }
  return { value: selectProjectCategory(value, created.id, created), selected: true };
}

export const PSM_FAMILY_CATEGORY_REFUSAL =
  "This category is reserved for the PSM/PSAIM project family and cannot be created for an Other Project.";

/**
 * The pre-create check for "+ Add New Project Category" opened from an Other
 * project: a proposed category that qualifies as PSM / PSAIM-family is refused
 * BEFORE anything is created.
 *
 * Code and name are judged INDEPENDENTLY — either one being reserved refuses
 * the save, so a non-PSM code cannot carry a reserved name through:
 *   - code: `PSM`, `PSM-01`, `PSAIM`, `PSAIM-TEST` (anchored, word boundary);
 *   - name: the PSM / PSAIM token as a whole word, or "process safety".
 * One message, under the field that triggered it; the code when both do.
 */
export function otherProjectCategoryCreateGuard(
  input: Record<string, unknown>
): { field: "code" | "name"; message: string } | undefined {
  const code = typeof input.code === "string" ? input.code : undefined;
  const name = typeof input.name === "string" ? input.name : undefined;
  if (isReservedPsmCode(code)) return { field: "code", message: PSM_FAMILY_CATEGORY_REFUSAL };
  if (isReservedPsmName(name)) return { field: "name", message: PSM_FAMILY_CATEGORY_REFUSAL };
  return undefined;
}

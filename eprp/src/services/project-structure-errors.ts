import type { ServiceError } from "./service-errors";

/**
 * Other Project structure (Phase 2C.1c) — refusals as plain language.
 *
 * Pure, and in its own module so both structure services (Supabase and the
 * in-memory mock) share one dictionary without importing each other.
 *
 * The database message is never shown. A [TAG] raised by the structure
 * triggers or the level RPC, or a known constraint name, selects one of the
 * fixed messages below; anything unrecognised gets the generic one.
 */

export type ProjectStructureErrorReason =
  | "not_authorized"
  | "not_found"
  | "not_other"
  | "project_archived"
  | "stale"
  | "invalid_levels"
  | "level_limit"
  | "level_gap"
  | "duplicate_label"
  | "level_in_use"
  | "level_immutable"
  | "level_undefined"
  | "parent_level"
  | "parent_archived"
  | "parent_invalid"
  | "active_children"
  | "has_children"
  | "reporting_overlap"
  | "archived_reporting"
  | "duplicate_name"
  | "duplicate_code"
  | "invalid_node"
  | "failed";

export const PROJECT_STRUCTURE_MESSAGES: Record<ProjectStructureErrorReason, string> = {
  not_authorized:
    "You cannot change this project's structure, or your sign-in has expired. Sign in again and retry — nothing was saved.",
  not_found: "This project or structure unit is no longer available. Reload the page.",
  not_other: "Only an Other project has a configurable Project Structure.",
  project_archived: "This project is archived, so its structure is read-only.",
  stale: "The project changed since this page loaded. Reload before saving.",
  invalid_levels: "Every level needs a singular and a plural name of at most 60 characters.",
  level_limit: "A project structure can have at most four levels.",
  level_gap: "Structure levels must run from level 1 without gaps.",
  duplicate_label: "Each level needs its own name.",
  level_in_use:
    "Levels that already have units can only be renamed. Add new levels below the deepest one, or remove only a deepest level that has no units.",
  level_immutable: "A level or unit keeps its level. Create a new one instead.",
  level_undefined: "That level is not defined for this project.",
  parent_level: "A unit's parent must be on the level directly above it.",
  parent_archived: "Restore the parent unit first.",
  parent_invalid: "Choose a parent unit from this project.",
  active_children: "Archive this unit's child units first.",
  has_children: "A unit that has child units cannot be deleted. Archive it instead.",
  reporting_overlap:
    "A unit and the units above or below it cannot all owe the same report. Choose one level on this branch.",
  archived_reporting: "An archived unit cannot owe Weekly or Monthly input.",
  duplicate_name: "Another active unit under the same parent already has this name.",
  duplicate_code: "Another active unit in this project already uses this code.",
  invalid_node:
    "Check the unit: a name of at most 140 characters is required, a code may have at most 40 characters.",
  failed: "The project structure could not be saved. No changes were made.",
};

const TAG_REASON: Record<string, ProjectStructureErrorReason> = {
  NOT_AUTHORIZED: "not_authorized",
  NOT_FOUND: "not_found",
  NOT_OTHER: "not_other",
  PROJECT_ARCHIVED: "project_archived",
  STALE: "stale",
  INVALID_LEVELS: "invalid_levels",
  LEVEL_LIMIT: "level_limit",
  LEVEL_GAP: "level_gap",
  DUPLICATE_LABEL: "duplicate_label",
  LEVEL_IN_USE: "level_in_use",
  LEVEL_IMMUTABLE: "level_immutable",
  PARENT_LEVEL: "parent_level",
  PARENT_ARCHIVED: "parent_archived",
  ACTIVE_CHILDREN: "active_children",
  REPORTING_OVERLAP: "reporting_overlap",
};

/** Constraint name → reason, for violations that carry no [TAG]. */
const CONSTRAINT_REASON: Record<string, ProjectStructureErrorReason> = {
  project_structure_nodes_active_sibling_name_unique: "duplicate_name",
  project_structure_nodes_active_code_unique: "duplicate_code",
  project_structure_nodes_root_rule: "parent_level",
  project_structure_nodes_archived_not_reporting: "archived_reporting",
  project_structure_nodes_name_valid: "invalid_node",
  project_structure_nodes_code_valid: "invalid_node",
  project_structure_nodes_description_valid: "invalid_node",
  project_structure_levels_singular_key_unique: "duplicate_label",
  project_structure_levels_plural_key_unique: "duplicate_label",
  project_structure_levels_project_number_unique: "invalid_levels",
  project_structure_levels_number_range: "level_limit",
  project_structure_levels_singular_label_valid: "invalid_levels",
  project_structure_levels_plural_label_valid: "invalid_levels",
};

export class ProjectStructureError extends Error {
  readonly reason: ProjectStructureErrorReason;
  constructor(reason: ProjectStructureErrorReason) {
    super(PROJECT_STRUCTURE_MESSAGES[reason]);
    this.name = "ProjectStructureError";
    this.reason = reason;
  }
}

const KNOWN_CONSTRAINTS = Object.keys(CONSTRAINT_REASON).sort((a, b) => b.length - a.length);

/** Database error → safe, semantic error. Unknown failures get the generic one. */
export function mapProjectStructureError(
  error: ServiceError | null | undefined
): ProjectStructureError {
  const message = error?.message ?? "";
  const tag = /\[([A-Z_]+)]/.exec(message)?.[1];
  if (tag && TAG_REASON[tag]) return new ProjectStructureError(TAG_REASON[tag]);

  const text = `${message} ${error?.details ?? ""}`;
  // A foreign key names the same constraint whether a parent / level is
  // missing (insert) or still referenced (delete); the wording differs.
  if (text.includes("project_structure_nodes_parent_fk")) {
    return new ProjectStructureError(/update or delete on/i.test(text) ? "has_children" : "parent_invalid");
  }
  if (text.includes("project_structure_nodes_level_fk")) {
    return new ProjectStructureError(/update or delete on/i.test(text) ? "level_in_use" : "level_undefined");
  }
  const constraint = KNOWN_CONSTRAINTS.find((name) => text.includes(name));
  if (constraint) return new ProjectStructureError(CONSTRAINT_REASON[constraint]);

  if (error?.code === "42501" || /row-level security/i.test(message)) {
    return new ProjectStructureError("not_authorized");
  }
  // PT409: the database's business-stale refusal (HTTP 409), raised only with
  // [STALE] — the tag above normally decides. 40001 is NOT treated as stale: a
  // genuine serialization failure means "retry", not "the project changed".
  if (error?.code === "PT409") return new ProjectStructureError("stale");
  if (error?.code === "PGRST116" || error?.code === "P0002") return new ProjectStructureError("not_found");
  return new ProjectStructureError("failed");
}

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
  // Structure responsibilities (Phase 2C.3D).
  | "unit_has_active_people"
  | "weekly_responsibility_exists"
  | "monthly_responsibility_exists"
  | "unit_has_people_history"
  | "lead_not_unit_member"
  | "responsible_not_unit_member"
  | "backup_without_responsible"
  | "same_person"
  | "membership_incomplete"
  | "member_not_active"
  | "unit_archived"
  | "unit_not_reporting"
  | "unit_member_is_lead"
  | "unit_member_has_responsibility"
  | "assignment_history"
  | "invalid_people"
  | "responsibilities_unavailable"
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
  unit_has_active_people:
    "Remove this unit's Lead, members and Weekly / Monthly responsibilities before archiving it.",
  weekly_responsibility_exists:
    "Remove this unit's Weekly Responsible and Backup before turning off Weekly input.",
  monthly_responsibility_exists:
    "Remove this unit's Monthly Responsible and Backup before turning off Monthly input.",
  unit_has_people_history: "This unit has people history, so it cannot be deleted. Archive it instead.",
  lead_not_unit_member: "The Unit Lead must be a member of this unit.",
  responsible_not_unit_member: "Weekly and Monthly Responsibles and Backups must be members of this unit.",
  backup_without_responsible: "Assign the Responsible before the Backup.",
  same_person: "The Responsible and the Backup must be different people.",
  membership_incomplete:
    "This person's project membership needs a Party and a Project Role before they can be Unit Lead, Responsible or Backup. Complete it on the Contacts step.",
  member_not_active: "Only active members of this project can be assigned to a unit. Reload the page.",
  unit_archived: "This unit is archived, so its people are read-only.",
  unit_not_reporting: "This unit does not provide that report's input, so it has no Responsible for it.",
  unit_member_is_lead: "Remove this person as Unit Lead before removing them from the unit.",
  unit_member_has_responsibility:
    "Reassign this person's Weekly / Monthly responsibility before removing them from the unit.",
  assignment_history: "Unit assignments are kept as history and cannot be changed or deleted.",
  invalid_people: "Each person can be listed once in a unit.",
  responsibilities_unavailable:
    "Structure responsibilities are not available on this database yet. Contact your administrator.",
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
  UNIT_HAS_ACTIVE_PEOPLE: "unit_has_active_people",
  WEEKLY_RESPONSIBILITY_EXISTS: "weekly_responsibility_exists",
  MONTHLY_RESPONSIBILITY_EXISTS: "monthly_responsibility_exists",
  UNIT_HAS_PEOPLE_HISTORY: "unit_has_people_history",
  LEAD_NOT_UNIT_MEMBER: "lead_not_unit_member",
  RESPONSIBLE_NOT_UNIT_MEMBER: "responsible_not_unit_member",
  BACKUP_WITHOUT_RESPONSIBLE: "backup_without_responsible",
  SAME_PERSON: "same_person",
  MEMBERSHIP_INCOMPLETE: "membership_incomplete",
  MEMBER_NOT_ACTIVE: "member_not_active",
  UNIT_NOT_FOUND: "not_found",
  UNIT_ARCHIVED: "unit_archived",
  UNIT_NOT_REPORTING: "unit_not_reporting",
  UNIT_MEMBER_IS_LEAD: "unit_member_is_lead",
  UNIT_MEMBER_HAS_RESPONSIBILITY: "unit_member_has_responsibility",
  ASSIGNMENT_ENDED: "assignment_history",
  ASSIGNMENT_IMMUTABLE: "assignment_history",
  ASSIGNMENT_HISTORY_PRESERVED: "assignment_history",
  ASSIGNMENT_MUST_START_ACTIVE: "assignment_history",
  INVALID_INPUT: "invalid_people",
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
  // Backstops behind the writer's own checks: a concurrent change got there first.
  project_structure_unit_members_one_lead: "stale",
  project_structure_unit_members_one_active: "stale",
  project_structure_report_responsibilities_one_active: "stale",
  project_structure_report_responsibilities_distinct_people: "same_person",
  project_structure_unit_members_node_same_project: "unit_has_people_history",
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

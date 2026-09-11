import type { Project } from "@/types";
import type { FixedResponsibilityField } from "./responsibilities";
import { departmentManager } from "./assignment-rules";

/**
 * Governance guard for Project Setup's raw editors.
 *
 * A responsibility that already has a holder is a live operational
 * assignment — reassigning it needs a reason, a history record, and
 * concurrency protection, none of which a raw setup save provides (see
 * `replace_project_responsibility()` and `src/services/replace-person.ts`).
 * These predicates are the one place that decides "is this slot empty (fine
 * to assign here) or occupied (must go through Replace Person in Team &
 * Responsibilities)" so no editor re-derives its own version of the rule.
 *
 * Every check takes the LAST SAVED project, never the in-progress setup
 * draft — a person just picked in this same editing session, before Save, is
 * not yet "occupied" and must stay editable until the page is saved or left.
 * Callers thread this as a `savedProject` prop, separate from the live
 * `project`/`draft` the editors already mutate.
 */

/** Whether a fixed responsibility already has a holder in the saved project. */
export function isFixedResponsibilityOccupied(
  savedProject: Pick<Project, FixedResponsibilityField>,
  field: FixedResponsibilityField
): boolean {
  return Boolean(savedProject[field]);
}

/**
 * Whether a `project_positions` row is occupied. A persisted row always has
 * a holder — `contact_id` is `NOT NULL` in the schema — so "has an id" and
 * "is occupied" are the same fact. A row with no id yet is still being
 * created and stays freely editable.
 */
export function isProjectPositionOccupied(
  positionId: string | undefined
): boolean {
  return Boolean(positionId);
}

/** The contact id holding Department Manager in `departmentId`, per the last
 * saved project — `undefined` when the role is vacant there. */
export function savedDepartmentManagerId(
  savedProject: Project,
  departmentId: string
): string | undefined {
  return departmentManager(savedProject, departmentId)?.contactId;
}

/**
 * Whether `contactId` is the department's saved Department Manager — if so,
 * their own role/removal controls lock: only Replace Person may move the
 * role off them.
 */
export function isDepartmentManagerHolderLocked(
  savedProject: Project,
  departmentId: string,
  contactId: string
): boolean {
  return savedDepartmentManagerId(savedProject, departmentId) === contactId;
}

/**
 * Whether ANYONE may be promoted into Department Manager for `departmentId`
 * directly from a raw editor — false once the role is already held, by
 * anyone, in the saved project.
 */
export function canPromoteToDepartmentManager(
  savedProject: Project,
  departmentId: string
): boolean {
  return savedDepartmentManagerId(savedProject, departmentId) === undefined;
}

/** Shared helper copy — one wording for every locked control. */
export const REPLACE_PERSON_HELP_TEXT =
  "Already assigned — use Replace Person in Team & Responsibilities to change who holds this.";

export const REPLACE_PERSON_MANAGER_HELP_TEXT =
  "This department already has a Department Manager — use Replace Person in Team & Responsibilities to reassign it.";

export const REPLACE_PERSON_POSITION_HELP_TEXT =
  "Already assigned — use Replace Person in Team & Responsibilities to change who holds this position.";

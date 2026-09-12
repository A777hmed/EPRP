import type { AssignmentRole } from "@/types";
import type { FixedResponsibilityField } from "@/features/projects/responsibilities";

/**
 * Replace Person — shared types and error class, in their own module.
 *
 * MUST NOT import from `./project-service` or `./supabase-project-service`.
 * Those two modules have a genuine runtime dependency on EACH OTHER already
 * (`project-service.ts` picks `supabaseProjectService` at module load;
 * `supabase-project-service.ts` needs `ReplacePersonError` at runtime to
 * `instanceof`/`throw` it in `mapReplacePersonError`). Putting these
 * definitions in either of those two files makes the other one import a
 * runtime VALUE from it, which turns the existing one-way edge into a cycle —
 * that is exactly what caused
 * "ReferenceError: Cannot access 'supabaseProjectService' before
 * initialization" the first time `supabase-project-service.ts` happened to be
 * the module a page's import graph reached first. This file has no edge to
 * either service module, so both can depend on it without ever depending on
 * each other for this.
 */

/**
 * Replace Person — the three shapes Team & Responsibilities can hold a person
 * in, per the Pass A architecture inspection. Exactly one of the
 * shape-specific fields below is meaningful for a given `kind`; the others are
 * omitted, mirroring the CHECK constraint on `project_responsibility_history`.
 */
export type ReplacePersonUnitKind =
  | "fixed_responsibility"
  | "department_assignment"
  | "project_position";

export interface ReplacePersonUnit {
  kind: ReplacePersonUnitKind;
  /** `fixed_responsibility` only — e.g. "projectManagerId". */
  responsibilityField?: FixedResponsibilityField;
  /** `department_assignment` only. */
  departmentId?: string;
  assignmentRole?: AssignmentRole;
  /** `project_position` only — a `project_positions.id`. */
  positionId?: string;
}

export interface ReplacePersonInput {
  projectId: string;
  unit: ReplacePersonUnit;
  /** The person currently holding the unit — validated against live data. */
  fromContactId: string;
  /** The person taking it over. */
  toContactId: string;
  /**
   * Required — a Replace Person event is a governed responsibility change,
   * not a data edit. Plain text, no taxonomy, for this MVP. A blank or
   * whitespace-only value is refused with `reason_required`, at both the mock
   * and the database boundary, regardless of what the caller passes here.
   */
  reason: string;
}

/**
 * What actually happened, for the Review Impact / confirmation UI to describe
 * rather than assume. Never larger than what the database can actually
 * report.
 */
export interface ReplacePersonResult {
  historyId: string;
  unitKind: ReplacePersonUnitKind;
  /** How many underlying rows were retargeted (>1 only for a multi-scope-item department assignment). */
  rowsUpdated: number;
  /** Other people in the same department whose Reports To was repointed (Department Manager replacement only). */
  reportsRepointed: number;
  /** Active delegations in the department where the outgoing person is the delegate. Left unchanged. */
  delegationsAsDelegate: number;
  /**
   * Active delegations in the affected department, counted only when a
   * Department Manager was replaced — surfaced for separate review, never
   * transferred. Deliberately NOT named "granted by the outgoing manager":
   * `project_delegations` has no delegator column, so which manager actually
   * granted a given delegation is not a fact this schema can prove.
   */
  delegationsRequiringReview: number;
}

/**
 * A semantic reason a Replace Person call was refused, so the UI can react
 * without parsing a message string. `message` is always human-safe — it is
 * either authored here or forwarded from a raised database message that was
 * itself written to be shown to a user; neither ever carries a raw
 * UUID/SQLSTATE/stack detail.
 */
export type ReplacePersonErrorReason =
  | "unauthorized"
  | "not_found"
  | "same_person"
  | "invalid_replacement"
  | "reason_required"
  | "not_project_member"
  | "last_membership_referenced"
  | "stale_assignment"
  | "duplicate_assignment"
  | "manager_conflict";

export class ReplacePersonError extends Error {
  constructor(
    public readonly reason: ReplacePersonErrorReason,
    message: string
  ) {
    super(message);
    this.name = "ReplacePersonError";
  }
}

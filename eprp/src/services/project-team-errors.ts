import type { ServiceError } from "./service-errors";

/**
 * Project team membership (Phase 2C.3C) — refusals as plain language.
 *
 * Pure, shared by the Supabase and in-memory services. The database message
 * is never shown: a [TAG] raised by the membership functions / triggers, or a
 * known constraint name, selects one fixed message; anything else is generic.
 */

export type ProjectTeamErrorReason =
  | "not_authorized"
  | "project_archived"
  | "stale"
  | "already_member"
  | "person_required"
  | "party_required"
  | "project_role_required"
  | "party_invalid"
  | "reports_to_invalid"
  | "reports_to_cycle"
  | "self_report"
  | "inactive_person"
  | "has_active_reports"
  | "has_project_responsibility"
  | "has_psm_assignments"
  | "has_unit_responsibility"
  | "has_unit_assignments"
  | "member_ended"
  | "not_found"
  | "unavailable"
  | "failed";

export const PROJECT_TEAM_MESSAGES: Record<ProjectTeamErrorReason, string> = {
  not_authorized:
    "You cannot manage this project's team, or your sign-in has expired. Sign in again and retry — nothing was saved.",
  project_archived: "This project is archived, so its team is read-only.",
  stale: "The project changed since this page loaded. Reload before saving.",
  already_member: "This person is already on the project team.",
  person_required: "Choose a person to add to the project team.",
  party_required: "Choose the party this person represents.",
  project_role_required: "Enter a project role of up to 80 characters.",
  party_invalid: "Choose a party of this project.",
  reports_to_invalid: "Reports To must be an active member of this project.",
  reports_to_cycle: "That Reports To would create a reporting loop. Choose someone else.",
  self_report: "A member cannot report to themselves.",
  inactive_person: "Only an active person can join a project team.",
  has_active_reports:
    "Other members report to this person. Change their Reports To before ending this membership.",
  has_project_responsibility:
    "This person holds a project responsibility (for example Project Manager) or a project position. Reassign it before ending this membership.",
  has_psm_assignments:
    "This person still holds department assignments (Department Manager, Team Member Lead or Team Member). Remove or replace them on the Contacts step before ending this membership.",
  has_unit_responsibility:
    "This person is a Unit Lead or holds a Weekly / Monthly responsibility. Reassign it on Project Team & Responsibilities before ending this membership.",
  has_unit_assignments:
    "This person still belongs to structure units. Remove them from those units on Project Team & Responsibilities before ending this membership.",
  member_ended: "This membership has ended and is kept as history.",
  not_found: "This member is no longer active on this project. Reload the page.",
  unavailable: "Project team membership is not available yet. Contact your administrator.",
  failed: "The project team could not be saved. No changes were made.",
};

const TAG_REASON: Record<string, ProjectTeamErrorReason> = {
  NOT_AUTHORIZED: "not_authorized",
  PROJECT_ARCHIVED: "project_archived",
  STALE: "stale",
  ALREADY_MEMBER: "already_member",
  PARTY_REQUIRED: "party_required",
  PROJECT_ROLE_REQUIRED: "project_role_required",
  REPORTS_TO_INACTIVE: "reports_to_invalid",
  REPORTS_TO_CYCLE: "reports_to_cycle",
  SELF_REPORT: "self_report",
  INACTIVE_PERSON: "inactive_person",
  HAS_ACTIVE_REPORTS: "has_active_reports",
  // PSM linkage (2C.3D Wave 2): ending never removes or reassigns responsibility.
  MEMBER_HAS_PROJECT_RESPONSIBILITY: "has_project_responsibility",
  MEMBER_HAS_PSM_ASSIGNMENTS: "has_psm_assignments",
  // Structure responsibilities (2C.3D): ending never cascades to unit rows.
  MEMBER_HAS_UNIT_RESPONSIBILITY: "has_unit_responsibility",
  MEMBER_HAS_UNIT_ASSIGNMENTS: "has_unit_assignments",
  MEMBER_ENDED: "member_ended",
  NOT_FOUND: "not_found",
  INVALID_INPUT: "failed",
};

const CONSTRAINT_REASON: Record<string, ProjectTeamErrorReason> = {
  project_members_one_active: "already_member",
  project_members_party_same_project: "party_invalid",
  project_members_reports_to_same_project: "reports_to_invalid",
  project_members_no_self_report: "self_report",
  project_members_project_role_shape: "project_role_required",
  project_members_active_requires_party_and_role: "party_required",
};

export class ProjectTeamError extends Error {
  readonly reason: ProjectTeamErrorReason;
  constructor(reason: ProjectTeamErrorReason) {
    super(PROJECT_TEAM_MESSAGES[reason]);
    this.name = "ProjectTeamError";
    this.reason = reason;
  }
}

const KNOWN_CONSTRAINTS = Object.keys(CONSTRAINT_REASON).sort((a, b) => b.length - a.length);

/** Database error → safe, semantic error. Unknown failures get the generic one. */
export function mapProjectTeamError(error: ServiceError | null | undefined): ProjectTeamError {
  const message = error?.message ?? "";
  const tag = /\[([A-Z_]+)]/.exec(message)?.[1];
  if (tag && TAG_REASON[tag]) return new ProjectTeamError(TAG_REASON[tag]);
  const text = `${message} ${error?.details ?? ""}`;
  const constraint = KNOWN_CONSTRAINTS.find((name) => text.includes(name));
  if (constraint) return new ProjectTeamError(CONSTRAINT_REASON[constraint]);
  if (error?.code === "PGRST202" || error?.code === "42883") return new ProjectTeamError("unavailable");
  if (error?.code === "42501" || /row-level security/i.test(message)) return new ProjectTeamError("not_authorized");
  // PT409 is the database's business-stale refusal; 40001 is NOT treated as stale.
  if (error?.code === "PT409") return new ProjectTeamError("stale");
  return new ProjectTeamError("failed");
}

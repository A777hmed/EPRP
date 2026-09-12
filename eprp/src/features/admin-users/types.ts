import type { UserRole } from "@/types";

/**
 * One project assignment/responsibility a linked person holds, resolved from
 * data that already exists (the five fixed responsibility columns on
 * `projects`, `project_contacts.assignment_role`, and `project_positions`).
 * No new table, column, or role model.
 */
export interface UserAssignmentEntry {
  projectId: string;
  projectName: string;
  responsibility: string;
  departmentName: string | null;
}

/**
 * One row of the Users & Roles table: a login account (`profiles`) joined
 * with its optional linked person (`contacts`) and that person's derived
 * project assignments.
 */
export interface UserRow {
  profileId: string;
  loginEmail: string;
  /** The profile's own account name (`profiles.full_name`) — DB-guaranteed
   * non-blank. Used as the Name-column fallback when no Person is linked;
   * never confused with `personName`, the linked Contact's real name. */
  fullName: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
  contactId: string | null;
  personName: string | null;
  jobTitle: string | null;
  /** The linked Contact's directory email — never the Login Email. */
  workEmail: string | null;
  assignments: UserAssignmentEntry[];
}

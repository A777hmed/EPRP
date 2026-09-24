import type { UserRole } from "@/types";

export interface AdminStatus {
  role: UserRole;
  active: boolean;
}

/** Whether a profile currently counts toward "at least one active System Administrator". */
export function isActiveAdmin(profile: AdminStatus): boolean {
  return profile.role === "system_admin" && profile.active;
}

/**
 * Whether replacing `current`'s role/active with `next` would leave the
 * platform with zero active System Administrators, given every other known
 * row in `allRows`.
 *
 * Client-side safety check only — it does not touch RLS, add a database
 * constraint, or change the platform role model. It exists so this UI cannot
 * walk an operator into locking everyone out of admin-only screens by
 * accident; it is not the enforcement boundary.
 */
export function wouldOrphanActiveAdmins(
  current: AdminStatus & { profileId: string },
  allRows: readonly (AdminStatus & { profileId: string })[],
  next: AdminStatus
): boolean {
  const currentlyCounts = isActiveAdmin(current);
  const stillCounts = isActiveAdmin(next);
  if (!currentlyCounts || stillCounts) return false;

  return !allRows.some(
    (row) => row.profileId !== current.profileId && isActiveAdmin(row)
  );
}

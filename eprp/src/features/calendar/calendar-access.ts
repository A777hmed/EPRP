import "server-only";

import { cache } from "react";

import { getCurrentUserIdentity } from "@/features/auth/profile";
import { hasPermission } from "@/config/permissions";

/**
 * Who may CREATE or EDIT calendar events, resolved on the server.
 *
 * Derived from the existing permission matrix rather than a new role list:
 * scheduling a meeting is a reporting-coordination act, so it follows the same
 * authority that creates a Weekly report. A future permission change moves this
 * gate with it instead of leaving a second hardcoded list to drift.
 *
 * This is presentation authority only. The boundary is row-level security on
 * `project_events`, which independently applies `weekly_can_manage_project` to
 * every write — a reader who reached this page by other means still cannot
 * insert a row for a project they do not manage.
 *
 * Reading is not gated here at all: RLS returns only events on projects the
 * account already has scope for, so an empty calendar is the correct outcome
 * for somebody with no project assignments.
 */
export const getCalendarViewerContext = cache(async (): Promise<{ canManage: boolean }> => {
  const identity = await getCurrentUserIdentity();
  if (!identity?.role) return { canManage: false };
  return { canManage: hasPermission(identity.role, "create_weekly") };
});

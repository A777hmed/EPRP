import "server-only";

import { cache } from "react";

import { getCurrentUserIdentity } from "@/features/auth/profile";
import { hasPermission } from "@/config/permissions";

/**
 * Who may CREATE or EDIT calendar events, resolved on the server.
 *
 * Derived from the existing permission matrix rather than a new role list, so a
 * future permission change moves this gate with it instead of leaving a second
 * hardcoded list to drift.
 *
 * This previously read `create_weekly` on the theory that scheduling is a
 * reporting-coordination act. It is not: `public.can_manage_calendar()` admits
 * only `has_global_operational_authority()` — System Admin and Project Control
 * Admin. Reading the Weekly permission handed the Add/Edit/Delete controls to
 * Project Managers, Department Leads and Department Users, every one of whom
 * the database then refused. `manage_calendar` mirrors the policy exactly.
 *
 * Project Control / Planning, Report Coordinator, Department User and Viewer
 * are all read-only here by design.
 *
 * This is presentation authority only. The boundary is row-level security on
 * `project_events`, which applies the same rule independently — a reader who
 * reached this page by other means still cannot insert a row.
 *
 * Reading is not gated here at all: RLS returns only events on projects the
 * account already has scope for, so an empty calendar is the correct outcome
 * for somebody with no project assignments.
 */
export const getCalendarViewerContext = cache(async (): Promise<{ canManage: boolean }> => {
  const identity = await getCurrentUserIdentity();
  if (!identity?.role) return { canManage: false };
  return { canManage: hasPermission(identity.role, "manage_calendar") };
});

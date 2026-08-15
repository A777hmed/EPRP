import "server-only";

import { cache } from "react";

import { getCurrentUserIdentity } from "@/features/auth/profile";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { hasPermission, type Permission } from "@/config/permissions";
import type { UserRole } from "@/types";

/**
 * Who may open the Executive portfolio, resolved on the server.
 *
 * The gate is DERIVED from the existing permission matrix rather than invented:
 * a role may open this module when it holds any Executive-report permission,
 * which today means System Administrator, Project Control Admin and Executive.
 * Department Lead, Department User, Reviewer, Approver, Project Manager and
 * Viewer hold none of them and are refused — the approved brief requires that
 * ordinary department users never reach this module.
 *
 * Deriving the list means a future permission change moves this gate with it,
 * instead of leaving a second hardcoded role list to drift out of step.
 *
 * This is presentation authority. Row-level security remains the boundary for
 * the Weekly and Monthly rows underneath, and portfolio-level RLS on `projects`
 * is still outstanding — see `executive-scope.ts`.
 */
const EXECUTIVE_PERMISSIONS: Permission[] = [
  "create_executive_report",
  "edit_executive_report",
  "finalize_executive_report",
];

export function canViewExecutivePortfolio(role: UserRole | undefined): boolean {
  if (!role) return false;
  return EXECUTIVE_PERMISSIONS.some((permission) => hasPermission(role, permission));
}

export interface ExecutiveViewerContext {
  /** May this account open the module at all? */
  allowed: boolean;
  /** True when the platform runs without a backend, so no identity exists. */
  demoMode: boolean;
  role?: UserRole;
  roleLabel?: string;
  viewerName?: string;
  /** The contact this login is linked to — the join scope resolution needs. */
  contactId: string | null;
  isAdmin: boolean;
  /** Present whenever `allowed` is false, so the UI never hides the reason. */
  deniedReason?: string;
}

const DENIED: ExecutiveViewerContext = {
  allowed: false,
  demoMode: false,
  contactId: null,
  isAdmin: false,
  deniedReason:
    "You are not signed in, or your account has no profile record. The Executive portfolio is limited to Project Control and Executive accounts.",
};

/**
 * `cache()`d so the page and its metadata share one profile read.
 */
export const getExecutiveViewerContext = cache(async (): Promise<ExecutiveViewerContext> => {
  if (!isSupabaseConfigured()) {
    return {
      ...DENIED,
      demoMode: true,
      deniedReason:
        "The platform is running without a database connection, so no identity can be resolved and no portfolio data exists to report.",
    };
  }

  const identity = await getCurrentUserIdentity();
  if (!identity) return DENIED;

  const allowed = canViewExecutivePortfolio(identity.role);

  return {
    allowed,
    demoMode: false,
    role: identity.role,
    roleLabel: identity.roleLabel,
    viewerName: identity.fullName,
    contactId: identity.contactId,
    isAdmin: identity.role === "system_admin",
    deniedReason: allowed
      ? undefined
      : `The Executive portfolio is limited to Project Control and Executive accounts. Your account is ${
          identity.roleLabel ?? "not assigned a role"
        }.`,
  };
});

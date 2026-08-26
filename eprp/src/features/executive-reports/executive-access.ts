import "server-only";

import { cache } from "react";

import { getCurrentUserIdentity } from "@/features/auth/profile";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { hasPermission, type Permission } from "@/config/permissions";
import type { UserRole } from "@/types";

/**
 * VIEW authority. Any authenticated account with a profile may open the module.
 *
 * This previously required an Executive WRITE permission to READ, which denied
 * the module to Viewer, Department User, Project Control / Planning and the
 * Report Coordinator — including people the model expects to read it and, in
 * the coordinator's case, to prepare it. Reading is scoped by
 * `visibleProjects()` and by RLS underneath; it is not a role question.
 */
export function canViewExecutivePortfolio(role: UserRole | undefined): boolean {
  return Boolean(role);
}

/**
 * PORTFOLIO / REGISTER management — Edit, Archive and Delete of the stored
 * Executive record.
 *
 * Mirrors `public.executive_can_manage()`, which admits only
 * `has_global_operational_authority()`. Portfolio-level persistence carries no
 * project_id, so it cannot be delegated per project; project-scoped
 * coordination goes through notes instead — see
 * {@link canPrepareProjectExecutive}.
 */
const PORTFOLIO_PERMISSIONS: Permission[] = [
  "create_executive_report",
  "edit_executive_report",
  "finalize_executive_report",
];

export function canManageExecutivePortfolio(role: UserRole | undefined): boolean {
  if (!role) return false;
  if (role !== "system_admin" && role !== "project_control_admin") return false;
  return PORTFOLIO_PERMISSIONS.some((permission) => hasPermission(role, permission));
}

export interface ExecutiveViewerContext {
  /** May this account open the module at all? VIEW only. */
  allowed: boolean;
  /**
   * May this account Edit, Archive or Delete the stored portfolio record?
   * Global authorities only — see {@link canManageExecutivePortfolio}.
   */
  canManagePortfolio: boolean;
  /** True when the platform runs without a backend, so no identity exists. */
  demoMode: boolean;
  role?: UserRole;
  roleLabel?: string;
  viewerName?: string;
  /** The contact this login is linked to — the join scope resolution needs. */
  contactId: string | null;
  /**
   * PROJECT-AGNOSTIC authority — "sees every project", not "is a platform
   * administrator". `visibleProjects()` and the register's scope note are its
   * only consumers, and both ask the scope question.
   *
   * Now both global operational authorities, mirroring
   * `has_global_operational_authority()`. It previously read `system_admin`
   * alone, which scoped a Project Control Admin down to their own assignments
   * even though the model and every RLS policy treat them as portfolio-wide.
   */
  isAdmin: boolean;
  /** Present whenever `allowed` is false, so the UI never hides the reason. */
  deniedReason?: string;
}

const DENIED: ExecutiveViewerContext = {
  allowed: false,
  canManagePortfolio: false,
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
    canManagePortfolio: canManageExecutivePortfolio(identity.role),
    demoMode: false,
    role: identity.role,
    roleLabel: identity.roleLabel,
    viewerName: identity.fullName,
    contactId: identity.contactId,
    isAdmin:
      identity.role === "system_admin" || identity.role === "project_control_admin",
    deniedReason: allowed
      ? undefined
      : "Your account has no profile record, so no project scope can be resolved.",
  };
});

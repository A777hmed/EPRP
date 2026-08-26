import type { UserRole } from "@/types";

/**
 * Role-based permission matrix (Phase 4C).
 *
 * Pure TypeScript configuration. Phase A1 adds the role foundation; login,
 * route protection and per-role RLS follow in A2 and later. Services and UI
 * consult {@link hasPermission} once a session exists.
 *
 * The nine roles here must stay in step with `UserRole` in
 * `src/types/admin.ts` and the `profiles_role_valid` CHECK in
 * `supabase/migrations/20260729000001_profiles.sql`.
 */

export type Permission =
  | "view_project"
  | "create_project"
  | "edit_project"
  | "create_weekly"
  | "edit_weekly"
  | "approve_weekly"
  | "finalize_weekly"
  | "create_monthly"
  | "edit_monthly"
  | "approve_monthly"
  | "create_executive_report"
  | "edit_executive_report"
  | "finalize_executive_report"
  | "import_template"
  | "export_report"
  | "manage_users"
  | "manage_master_data"
  /**
   * Create, edit and delete calendar events.
   *
   * Platform-wide by design, mirroring `public.can_manage_calendar()`, which
   * admits only `has_global_operational_authority()`. It is deliberately NOT
   * derived from `create_weekly`: scheduling is not a reporting act, and
   * treating it as one handed Calendar management to Project Managers,
   * Department Leads and Department Users, all of whom the database refuses.
   */
  | "manage_calendar";

export const ALL_PERMISSIONS: Permission[] = [
  "view_project",
  "create_project",
  "edit_project",
  "create_weekly",
  "edit_weekly",
  "approve_weekly",
  "finalize_weekly",
  "create_monthly",
  "edit_monthly",
  "approve_monthly",
  "create_executive_report",
  "edit_executive_report",
  "finalize_executive_report",
  "import_template",
  "export_report",
  "manage_users",
  "manage_master_data",
  "manage_calendar",
];

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  system_admin: ALL_PERMISSIONS,
  project_control_admin: [
    "view_project",
    "create_project",
    "edit_project",
    "create_weekly",
    "edit_weekly",
    "approve_weekly",
    "finalize_weekly",
    "create_monthly",
    "edit_monthly",
    "approve_monthly",
    "create_executive_report",
    "edit_executive_report",
    "finalize_executive_report",
    "import_template",
    "export_report",
    "manage_master_data",
    "manage_calendar",
  ],
  project_manager: [
    "view_project",
    "edit_project",
    "create_weekly",
    "edit_weekly",
    "approve_weekly",
    "create_monthly",
    "edit_monthly",
    "export_report",
  ],
  // docs/03_WORKFLOW.md §6 groups Department Lead and User as one access
  // level: their own project/department updates only.
  department_lead: ["view_project", "create_weekly", "edit_weekly"],
  department_user: ["view_project", "create_weekly", "edit_weekly"],
  reviewer: ["view_project", "approve_weekly", "approve_monthly"],
  // §6: "Approve, reject, finalize".
  approver: [
    "view_project",
    "approve_weekly",
    "approve_monthly",
    "finalize_weekly",
  ],
  executive: [
    "view_project",
    "create_executive_report",
    "edit_executive_report",
    "finalize_executive_report",
    "export_report",
  ],
  viewer: ["view_project"],
};

export const ROLE_LABELS: Record<UserRole, string> = {
  system_admin: "System Administrator",
  project_control_admin: "Project Control Admin",
  project_manager: "Project Manager",
  department_lead: "Department Lead",
  department_user: "Department User",
  reviewer: "Reviewer",
  approver: "Approver",
  executive: "Executive",
  viewer: "Viewer",
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

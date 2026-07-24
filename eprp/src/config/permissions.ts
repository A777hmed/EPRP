import type { UserRole } from "@/types";

/**
 * Role-based permission matrix (Phase 4C).
 *
 * Pure TypeScript configuration — authentication and route protection are
 * implemented in a later phase. Services and UI will consult
 * {@link hasPermission} once a session exists.
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
  | "manage_master_data";

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
  department_user: ["view_project", "create_weekly", "edit_weekly"],
  reviewer: ["view_project", "approve_weekly", "approve_monthly"],
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
  department_user: "Department User",
  reviewer: "Reviewer",
  executive: "Executive",
  viewer: "Viewer",
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

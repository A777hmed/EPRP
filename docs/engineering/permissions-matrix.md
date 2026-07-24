# Permissions Matrix

Defined in [`eprp/src/config/permissions.ts`](../../eprp/src/config/permissions.ts). Configuration only — authentication and enforcement arrive in a later phase.

> **As-built reference.** This records the roles in the code today. The
> intended business roles are in [`../03_WORKFLOW.md`](../03_WORKFLOW.md) §6 and
> do not yet match one-for-one — reconcile them in Phase 7.

Roles: `system_admin`, `project_control_admin`, `project_manager`, `department_user`, `reviewer`, `executive`, `viewer`.

| Permission | system_admin | project_control_admin | project_manager | department_user | reviewer | executive | viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| view_project | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| create_project | ✅ | ✅ | — | — | — | — | — |
| edit_project | ✅ | ✅ | ✅ | — | — | — | — |
| create_weekly | ✅ | ✅ | ✅ | ✅ | — | — | — |
| edit_weekly | ✅ | ✅ | ✅ | ✅ | — | — | — |
| approve_weekly | ✅ | ✅ | ✅ | — | ✅ | — | — |
| finalize_weekly | ✅ | ✅ | — | — | — | — | — |
| create_monthly | ✅ | ✅ | ✅ | — | — | — | — |
| edit_monthly | ✅ | ✅ | ✅ | — | — | — | — |
| approve_monthly | ✅ | ✅ | — | — | ✅ | — | — |
| create_executive_report | ✅ | ✅ | — | — | — | ✅ | — |
| edit_executive_report | ✅ | ✅ | — | — | — | ✅ | — |
| finalize_executive_report | ✅ | ✅ | — | — | — | ✅ | — |
| import_template | ✅ | ✅ | — | — | — | — | — |
| export_report | ✅ | ✅ | ✅ | — | — | ✅ | — |
| manage_users | ✅ | — | — | — | — | — | — |
| manage_master_data | ✅ | ✅ | — | — | — | — | — |

Use `hasPermission(role, permission)`; `ROLE_LABELS` provides display names.

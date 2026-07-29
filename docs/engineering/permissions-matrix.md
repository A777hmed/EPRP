# Permissions Matrix

Defined in [`eprp/src/config/permissions.ts`](../../eprp/src/config/permissions.ts).
Configuration only — login arrives in Phase A2 and per-role RLS later still.

> **As-built reference.** Phase A1 settled the role list at **nine** roles,
> which is now the single source shared by three places that must stay in
> step:
>
> - `UserRole` in [`eprp/src/types/admin.ts`](../../eprp/src/types/admin.ts)
> - `ROLE_PERMISSIONS` / `ROLE_LABELS` in `eprp/src/config/permissions.ts`
> - the `profiles_role_valid` CHECK in
>   [`20260729000001_profiles.sql`](../../eprp/supabase/migrations/20260729000001_profiles.sql)

Roles: `system_admin`, `project_control_admin`, `project_manager`,
`department_lead`, `department_user`, `reviewer`, `approver`, `executive`,
`viewer`.

| Permission | system_admin | project_control_admin | project_manager | department_lead | department_user | reviewer | approver | executive | viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| view_project | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| create_project | ✅ | ✅ | — | — | — | — | — | — | — |
| edit_project | ✅ | ✅ | ✅ | — | — | — | — | — | — |
| create_weekly | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| edit_weekly | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| approve_weekly | ✅ | ✅ | ✅ | — | — | ✅ | ✅ | — | — |
| finalize_weekly | ✅ | ✅ | — | — | — | — | ✅ | — | — |
| create_monthly | ✅ | ✅ | ✅ | — | — | — | — | — | — |
| edit_monthly | ✅ | ✅ | ✅ | — | — | — | — | — | — |
| approve_monthly | ✅ | ✅ | — | — | — | ✅ | ✅ | — | — |
| create_executive_report | ✅ | ✅ | — | — | — | — | — | ✅ | — |
| edit_executive_report | ✅ | ✅ | — | — | — | — | — | ✅ | — |
| finalize_executive_report | ✅ | ✅ | — | — | — | — | — | ✅ | — |
| import_template | ✅ | ✅ | — | — | — | — | — | — | — |
| export_report | ✅ | ✅ | ✅ | — | — | — | — | ✅ | — |
| manage_users | ✅ | — | — | — | — | — | — | — | — |
| manage_master_data | ✅ | ✅ | — | — | — | — | — | — | — |

Use `hasPermission(role, permission)`; `ROLE_LABELS` provides display names.

## Notes on the two roles added in A1

- **`department_lead`** carries the same permissions as `department_user`.
  [`../03_WORKFLOW.md`](../03_WORKFLOW.md) §6 treats "Department Lead/User" as
  one access level — assigned project/department updates only. If a lead
  should later approve on behalf of their department, that is a deliberate
  change, not an oversight.
- **`approver`** gets approve + finalize, per §6 ("Approve, reject, finalize").

## Known discrepancy — not resolved by A1

§6 describes **Reviewer** as "review, comment, return, **recommend** approval",
while `reviewer` here holds `approve_weekly` and `approve_monthly` outright.
That predates A1 and was left untouched rather than silently rewritten.
Reconcile it when the review workflow is built (W3B / Phase 7).

## Enforcement status

Nothing in this matrix is enforced yet. `hasPermission` is called by **no**
component, and every table's RLS policy is still the temporary
`for all to authenticated`. A1 adds only the role foundation and the
`profiles` table; real per-role policies come after login exists.

# EPROM Master Issues, Development Handoff, and Change Log

Last updated: 2026-08-17  
Canonical project: `C:\Users\ahmed Morsy\Desktop\EPROM Progress Report`  
Application: `eprp/`

## Purpose and mandatory workflow

This is the permanent, single development handoff and change log for the EPROM Progress Report platform. Do not create a parallel handoff file.

Before every future modification:

1. Read this file and the applicable `AGENTS.md` files.
2. Confirm the current item, scope, existing implementation, and outstanding verification.
3. Preserve existing project data, working UI, and unrelated working-tree changes.

After every modification:

1. Update the applicable issue entry with the exact files and database objects changed.
2. Record the verification performed and any verification still outstanding.
3. Append a dated entry to the chronological Change Log.

Prohibited unless the user explicitly authorizes otherwise:

- Database reset or destructive reseed.
- Disabling RLS globally.
- Deleting or rewriting existing project data to work around a defect.
- Reverting or overwriting unrelated working changes.
- Starting a second handoff or change-log file.

## Status definitions

| Status | Meaning |
| --- | --- |
| Open | Confirmed requirement or defect with no implementation yet. |
| In Progress | Implementation has started, but one or more required Project-side behaviors are still incomplete or blocked. |
| Backend/Foundation only | Database, schema, type, service, or future-consumer foundation exists, but there is no complete usable current UI for that capability. |
| Fixed but runtime-unverified | The implementation is connected to a current rendered UI path and static checks pass, but authenticated runtime/save/reload behavior has not been confirmed. |
| Verified | The implementation is present and the applicable runtime/database behavior has actually been confirmed. |

## Current implementation summary

| ID | Item | Status |
| --- | --- | --- |
| EPRP-2026-08-17-01 | `project_departments` RLS blocks Project Setup save and navigation | Verified |
| EPRP-2026-08-17-02 | Separate Department Manager and Team Members in Contacts setup | Fixed but runtime-unverified |
| EPRP-2026-08-17-03 | `localhost:3000` page failure after production build | Verified |
| EPRP-OPEN-01 | Programs & Studies dropdown must be scoped by Department and System | Fixed but runtime-unverified |
| EPRP-OPEN-02 | PSM/PSAIM terminology must use Program & Study instead of Discipline where applicable | Fixed but runtime-unverified |
| EPRP-2026-08-17-04 | Project-specific Department/System scope descriptions | Fixed but runtime-unverified |
| EPRP-2026-08-17-05 | Department Manager project context and selector clarity | Fixed but runtime-unverified |
| EPRP-2026-08-17-06 | Reusable searchable selector UX in Project master-data flows | Fixed but runtime-unverified |
| EPRP-2026-08-17-07 | Preserve Contacts draft and selected Program & Study through Add Contact | Fixed but runtime-unverified |
| EPRP-2026-08-17-08 | Add Person can inherit the wrong Department context | Fixed but runtime-unverified |
| EPRP-2026-08-17-09 | Explicit cross-Department Project scope assignments | Fixed but runtime-unverified |
| EPRP-2026-08-17-10 | Weekly delegation date validation in Project Contacts | Fixed but runtime-unverified |
| EPRP-2026-08-17-11 | Deterministic Project Team display order | Fixed but runtime-unverified |
| EPRP-2026-08-17-12 | Client Short Name/Acronym and Project Review Client resolution | Fixed but runtime-unverified |
| EPRP-2026-08-17-13 | Multiple Project Sites/Locations with one Primary Site | Fixed but runtime-unverified |
| EPRP-2026-08-17-14 | Official Project Reference Documents and embedded PDF viewer | Fixed but runtime-unverified |
| EPRP-2026-08-17-15 | Client Representative contact auto-resolution | Fixed but runtime-unverified |
| EPRP-2026-08-17-16 | Project Setup Review hierarchy and cross-Department clarity | Fixed but runtime-unverified |
| EPRP-2026-08-17-17 | Project Branding labels and QR destination clarity | Fixed but runtime-unverified |
| EPRP-2026-08-17-18 | Final Project Setup regression and existing-data confirmation | In Progress |

## Current Handoff State — actual implementation versus runtime evidence

This section is the controlling handoff snapshot. It distinguishes source-code presence from demonstrated UI behavior; build success alone is not treated as runtime verification.

### Truly working and runtime-confirmed

- `project_departments` RLS no longer blocks the previously failing save/navigation path: migration `eprp/supabase/migrations/20260817000001_project_departments_rls.sql` was applied with RLS still enabled, and the user subsequently reached Contacts. This verifies the reported blocker, but role-by-role INSERT/UPDATE/DELETE coverage is still recommended.
- The local application route recovered after restarting the stale production process. The exact Project Setup routes respond and redirect unauthenticated access to Sign In instead of returning 404 or a page-load crash.
- No other P1–P16 item has authenticated browser save/reload evidence in this session. Those items must not be described as Verified.

### Connected to current UI but runtime-unverified

| Capability | Accurate state | Current UI/source connection | Remaining proof |
| --- | --- | --- | --- |
| QRA / FERA System grouping | Fixed but runtime-unverified | `eprp/src/features/projects/components/setup/setup-step-disciplines.tsx` filters by both `departmentId` and exact `systemId`. | Confirm hosted QRA/FERA master rows use Process Safety Studies, appear there, and do not appear under another System. |
| Department Manager and Team Members separation | Fixed but runtime-unverified | `eprp/src/features/projects/components/setup/setup-step-contacts.tsx` renders separate single-manager and multi-member selectors. | Authenticated selection, replacement, save, reload, and cross-Department exclusion checks. |
| Department Manager first | Fixed but runtime-unverified | `eprp/src/features/projects/assignment-rules.ts`, `setup-step-review.tsx`, `project-info-workspace.tsx`, `department-team-assignments.tsx`, and `project-scope-summary.tsx` use the shared presentation order. | Authenticated visual confirmation with real Project assignments. |
| Client Short Name / Acronym | Fixed but runtime-unverified | The Client master form is driven by `eprp/src/features/master-data/services.ts`; `setup-step-review.tsx` and Project Details resolve the selected Client and apply the short-name fallback. | Create/edit/save/reload a Client and reopen Review. |
| Multiple Project Sites | Fixed but runtime-unverified | `eprp/src/features/projects/components/project-form.tsx` exposes Primary Site, repeatable Additional Sites, remove, and Make primary; `project-setup-view.tsx` and `project-form-view.tsx` render that form; `project-details-view.tsx` displays saved Sites. | Authenticated Site add/change-primary/remove/save/reload plus allowed/denied RLS checks. |
| Official Project Documents | Fixed but runtime-unverified | `eprp/src/features/projects/components/project-documents-panel.tsx` is mounted in `project-details-view.tsx` and the dedicated `sections/project-section-view.tsx` Documents route. | Authenticated upload, metadata, revision retention, signed URL, reload, and RLS checks. |
| Scope/PDF viewer | Fixed but runtime-unverified for supported files | The same document panel opens PDFs and images in an in-platform modal iframe and offers Open Original File. | Upload and open an actual Scope PDF. Office files intentionally use Open Original File and are not embedded. |
| Project-specific Department/System descriptions | Fixed but runtime-unverified | `setup-step-departments.tsx` and `setup-step-systems.tsx` expose Project scope description fields; Project Details applies the master-description fallback. | Save/reload and confirm another Project sharing the same master record is unaffected. |

### Backend/Foundation only or still missing in current UI

| Capability | Accurate state | Existing foundation | Missing UI/behavior |
| --- | --- | --- | --- |
| Site-level reporting attribution | Backend/Foundation only | `public.project_sites`, stable Site IDs, Primary-Site constraint, service/type mapping, and Project UI exist. | Weekly, Monthly, Executive, Dashboard, and report outputs do not yet select or attribute records to a Site. Do not revert `project_sites`; future work must build on its IDs. |
| Project-document references from reports | Backend/Foundation only | `public.project_documents`, private Storage bucket, revision metadata, and Project Documents UI exist. | Weekly/Monthly/Executive records do not yet link to authoritative Project document IDs. |
| Primavera integration | Open | A `baseline_schedule` document category can store an exported approved schedule file. | There is no Primavera synchronization, import, parsing, activity mapping, or live schedule viewer anywhere under `eprp/src`. Do not describe document upload as Primavera integration. |
| Dedicated semantic Scope viewer | Open | Scope PDFs can use the generic embedded PDF viewer. | There is no parsed, section-aware, searchable contractual Scope workspace beyond the generic file viewer. |
| Real QR destination | Open | Project configuration retains the QR preference flag. | No controlled published report/revision/archive URL is generated by Project Setup. |
| Full Project Setup regression | In Progress | Static checks, route generation, migration alignment, and source inspection are complete. | Authenticated end-to-end save/reload, 100%, Finish Setup, role-based RLS checks, and current `PSM-00-02` data confirmation. |

### Database objects and migrations already created — do not revert

- `eprp/supabase/migrations/20260817000001_project_departments_rls.sql` — project-scoped SELECT/INSERT/UPDATE/DELETE policies on `public.project_departments`; RLS remains enabled.
- `eprp/supabase/migrations/20260817000002_project_scope_descriptions.sql` — additive `public.project_departments.project_description` used by Department/System project-scope UI and fallback mapping.
- `eprp/supabase/migrations/20260817000003_project_sites.sql` — `public.project_sites`, Primary-Site uniqueness/indexes, updated-at trigger, project-scoped RLS, and non-destructive legacy-location backfill.
- `eprp/supabase/migrations/20260817000004_project_reference_documents.sql` — `public.project_documents`, private `project-reference-documents` Storage bucket, uploader/path helpers, triggers, indexes, and project-scoped metadata/storage policies.

All four migrations were previously reported as applied and aligned with the linked hosted database. This documentation-only audit did not query, modify, reapply, or roll back the database.

### Preservation requirements for future work

- Do not revert the exact-System Program & Study predicate, the separate manager/member controls, the shared manager-first comparator, the Client resolver, the multi-Site form/service mapping, or either Project Documents UI mount.
- Do not remove legacy `projects.site/city/country`; they remain the Primary-Site compatibility path for existing consumers until downstream Site adoption is explicitly implemented.
- Do not delete superseded `project_documents` rows or Storage objects as part of uploading a newer revision.
- Do not replace the project-scoped RLS helpers with authenticated-wide policies and do not disable RLS.
- Do not treat migration presence, static source inspection, lint, type-check, or build success as proof of authenticated UI persistence.

## EPRP-2026-08-17-01 — Project Department RLS

**Status: Verified**

### Problem

Saving Project Setup while moving from Programs & Studies to Contacts failed with:

`new row violates row-level security policy for table "project_departments"`

The failed save prevented navigation to the Contacts step.

### Root cause

`replaceDepartments()` in `eprp/src/services/supabase-project-service.ts` replaces the project's department links by:

1. Deleting the existing `project_departments` rows for the project.
2. Inserting the current department assignment set again.

The table still depended on the temporary Phase 5C authenticated-wide policy, while the rest of the application had moved to project-scoped authorization helpers. The INSERT was rejected by the effective hosted-database RLS state. Because replacement is delete-then-insert, an INSERT rejection also creates a data-preservation risk if the two operations do not complete together.

### Implementation

Migration created and applied:

`eprp/supabase/migrations/20260817000001_project_departments_rls.sql`

Database object affected:

- Table: `public.project_departments`
- RLS explicitly remains enabled.
- Removed policy: `project_departments_authenticated_all`
- Added policy: `project_departments_select`
  - Role: `authenticated`
  - Predicate: `public.weekly_can_access_project(project_id)`
- Added policy: `project_departments_insert`
  - Role: `authenticated`
  - Check: `public.weekly_can_manage_project(project_id)`
- Added policy: `project_departments_update`
  - Role: `authenticated`
  - USING and WITH CHECK: `public.weekly_can_manage_project(project_id)`
- Added policy: `project_departments_delete`
  - Role: `authenticated`
  - Predicate: `public.weekly_can_manage_project(project_id)`

Existing helpers reused without modification:

- `public.weekly_can_access_project(uuid)`
- `public.weekly_can_manage_project(uuid)`

Effective write scope is limited to the existing project-management roles resolved by `weekly_can_manage_project`: active System Administrator, Project Control Manager, or Reporting Coordinator for that project. The change does not grant write access to ordinary project or department members.

### Files modified

- `eprp/supabase/migrations/20260817000001_project_departments_rls.sql` — created.

The existing `replaceDepartments()` implementation was inspected but not modified in this session.

### Data safety

- No table, column, constraint, or project row was created, updated, or deleted by the migration.
- No database reset or seed was run.
- RLS was not disabled.
- The migration contains policy DDL only.

### Verification completed

- Production TypeScript check passed.
- Production Next.js build passed.
- Migration `20260817000001` was applied to the linked hosted Supabase project.
- A subsequent remote migration listing showed local and remote version `20260817000001` aligned.
- After deployment, the user reached the Project Setup Contacts page, confirming that the prior save/navigation blocker no longer prevented the workflow.

### Verification still recommended

- Capture an authenticated save/reload check that compares the project's department and system assignments before and after save.
- Confirm INSERT, UPDATE, and DELETE behavior with each intended project-management role and confirm denial for an ordinary project member.
- Consider a future, separately authorized improvement to make department replacement atomic or upsert-first so a failed insert cannot follow a successful delete. This was not implemented in this session.

## EPRP-2026-08-17-02 — Separate Department Manager and Team Members

**Status: Fixed but runtime-unverified**

### Requirement

The Contacts setup step previously had one Program & Study selector and one combined Team Members multiselect. The user required separate controls for:

- One Department Manager for the selected Program & Study's Department.
- Multiple Team Members for the selected Program & Study.

### Implementation

The Assign Project Team panel now has three separate controls:

1. Program & Study.
2. Department Manager — single-select, filtered to contacts belonging to the active Department.
3. Team Members — multi-select, filtered to contacts belonging to the active Department and excluding the selected Department Manager.

Behavior implemented:

- Selecting a Department Manager uses the existing assignment rules rather than introducing a parallel role model.
- If the selected manager is not already assigned to the Department, an assignment row is added for the active Program & Study before applying the manager role.
- The existing `setAssignment()` rule keeps one Department Manager per Department.
- Replacing the manager demotes the previous manager to `team_member`; it does not delete that person.
- Existing reporting lines are repaired by the established assignment rules when a manager changes.
- The Team Members multiselect excludes the active manager.
- Updating Team Members preserves any manager row already attached to the active Program & Study.
- Existing functional title, assignment role, and reporting-line data are retained for people who remain selected.

### Files modified

- `eprp/src/features/projects/components/setup/setup-step-contacts.tsx`

Existing code reused without modification:

- `departmentManager()` in `eprp/src/features/projects/assignment-rules.ts`
- `setAssignment()` in `eprp/src/features/projects/assignment-rules.ts`
- Existing `project.team` persistence path and database schema

### Database objects modified

None. This is a UI and draft-assignment behavior change only.

### Data safety

- No migration was created for this item.
- No existing project or contact data was changed by the implementation step.
- The manager-change behavior demotes and preserves the previous manager rather than deleting the person or assignment history represented in the current draft.

### Verification completed

- ESLint passed for `setup-step-contacts.tsx` with zero warnings.
- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed and generated all application routes, including `/projects/[projectId]/setup/[step]`.

### Verification still required

- Authenticated browser verification of the rendered three-control layout.
- Select a Department Manager and multiple Team Members, save, reload, and confirm persistence.
- Replace the manager and verify the previous manager remains as a Team Member.
- Change Team Members for one Program & Study and confirm the Department Manager is preserved.
- Switch between Programs & Studies under the same Department and confirm the Department Manager remains consistent.
- Confirm contacts from other Departments do not appear in either selector.

## EPRP-2026-08-17-03 — Local Production Server Recovery

**Status: Verified**

### Problem

After the Contacts UI production build, the already-running `next start` process on `localhost:3000` showed the browser error `This page couldn't load`.

### Root cause

The production build replaced `.next` output while an older `next start` process was still serving the prior build. The running process and build output became inconsistent.

### Action completed

- Identified the exact Node process serving the EPROM application on port 3000.
- Stopped only that stale EPROM `next start` process.
- Started one updated `npm.cmd run start` process from `eprp/` on port 3000.
- Did not delete `.next`, project files, or project data.

### Files and database objects modified

None. This was an operational restart only.

### Verification completed

- Next.js 16.2.10 reported ready on `http://localhost:3000`.
- An unauthenticated request to the exact Contacts route returned the expected `307` redirect to `/login?next=...`, confirming that the route and authentication middleware were responding rather than crashing.

### Verification limitation

The automated browser session did not have the user's authenticated application session. Final rendered-page verification must be performed in the user's signed-in browser.

## EPRP-OPEN-01 — System-specific Programs & Studies filtering

**Status: Fixed but runtime-unverified**

### Requirement

Programs & Studies must be filtered by both Department and System. Selecting `Process Safety Studies` must show its own studies, including QRA and FERA, and must not show records belonging to `Process Safety System` or SOP. The same dependent-filter rule applies to Asset Integrity Systems and Studies.

Expected hierarchy:

`Department -> System -> Program & Study`

### Root cause

The Project Setup selector already iterated per selected System, and both the master Program & Study record and the saved project link carried `departmentId` and `systemId`. However, the option filter in `setup-step-disciplines.tsx` compared only the record's `departmentId` with the active System's Department. Consequently, every Program & Study under the same Department could appear even when it belonged to another System.

No master-data query, schema, or persistence defect was found for this item. The missing predicate was confined to the setup selector.

### Implementation

The Program & Study selector now requires both relationships to match:

- `record.departmentId === activeDepartmentId`
- `record.systemId === systemId`

The empty-state text was also corrected to say that no records belong to the selected System, instead of referring only to the System's Department.

This preserves the existing hierarchy and stored links:

`Department -> System -> Program & Study`

### Files modified

- `eprp/src/features/projects/components/setup/setup-step-disciplines.tsx`

### Database objects modified

None. No migration, policy, table, column, master-data row, or project link was changed for this item.

### Data safety

- Existing Project Setup links were not rewritten or deleted.
- QRA, FERA, and other master-data records were not edited.
- No database reset, seed, or data export was performed.
- Unrelated working-tree changes were preserved.

### Verification completed

- Inspected the `Discipline` model and confirmed it already exposes both `departmentId` and `systemId`.
- Inspected Project Setup link creation and confirmed saved links already retain both System and Department context.
- `npm.cmd run typecheck` passed.
- Full `npx.cmd eslint src --max-warnings=0` passed with zero warnings.
- A production build passed using the isolated output directory `.next-p1-verify`; all application routes were generated successfully.
- `git diff --check` passed and confirmed the functional P1 change is confined to `setup-step-disciplines.tsx`.

### Verification still required

Authenticated runtime verification could not be completed because the browser available to Codex redirected the exact Project Setup route to Sign In and no connected external browser session was available. Do not change this item to `Verified` until the following checks pass in a signed-in project:

- Under Process Safety, select `Process Safety Studies` and confirm QRA and FERA appear when their master records use that exact System.
- Confirm records belonging to `Process Safety System` or SOP do not appear in the `Process Safety Studies` selector.
- Under Asset Integrity, confirm each System exposes only the Programs & Studies assigned to that exact System.
- Save, move to Contacts, reload, and confirm the existing selected links persist unchanged.

## EPRP-OPEN-02 — Contextual Program & Study terminology

**Status: Fixed but runtime-unverified**

### Requirement

For PSM/PSAIM project types, applicable labels such as `New Discipline` and `Discipline Details` should render as `New Program & Study` and `Program & Study Details`. Other project types that genuinely use Disciplines must retain Discipline terminology.

### Root cause

The Project Setup wizard already resolved hierarchy wording from the selected Project Type through `hierarchyTermsFor()` and `useHierarchyTerms()`. PSM/PSAIM steps therefore displayed `Programs & Studies` correctly. However, the reusable master-data selector, Add/Manage dialog, dedicated create/edit page, detail view, and archive/delete messages still read the global `MASTER_KIND_CONFIG.discipline` labels directly. When those surfaces were opened from a PSM/PSAIM project, the project context was preserved in the URL but was not used for display terminology.

The underlying entity, route, and database model were already correct and did not require renaming.

### Implementation

- Reused the existing Project Type resolver; no duplicate PSM/PSAIM detection logic was added.
- Added an optional display-only `HierarchyTerms` override to the reusable multi-select, master-data dialog, and lifecycle-action messages.
- Passed the current project's resolved terms from Project Setup into the Program & Study selector and its inline Add/Manage surfaces.
- Resolved terms from the existing `projectId` context on dedicated create/edit and detail pages.
- Kept global Administration behavior unchanged when no project context is present.
- Kept `discipline`, `/disciplines`, `discipline_id`, master records, services, and relationships unchanged.

Contextual PSM/PSAIM wording now covers:

- `Program & Study` / `Programs & Studies`
- `New Program & Study`
- `Add Program & Study`
- `Manage Programs & Studies`
- `Program & Study details`
- `Search programs & studies...`
- create/update/archive/restore/delete confirmations and notifications

Projects whose type does not resolve to PSM/PSAIM continue to use `Discipline` / `Disciplines`.

### Files modified

- `eprp/src/features/projects/use-hierarchy-terms.ts`
- `eprp/src/features/projects/components/setup/setup-step-disciplines.tsx`
- `eprp/src/features/master-data/components/managed-multi-select.tsx`
- `eprp/src/features/master-data/components/master-data-dialog.tsx`
- `eprp/src/features/master-data/components/use-master-data-actions.tsx`
- `eprp/src/features/master-data/components/master-data-page-form.tsx`
- `eprp/src/features/master-data/components/discipline-detail-view.tsx`

### Database objects modified

None. No migration, schema, policy, master-data row, project record, or relationship was changed.

### Data safety and scope

- This is a display-terminology change only.
- No URLs or route folder names were renamed.
- No global Discipline labels were changed for Administration or non-PSM/PSAIM projects.
- No Weekly, Monthly, Executive Reporting, Dashboard, or unrelated module was modified for this item.
- Existing project and master-data records were not written, deleted, or transformed.

### Verification completed

- Confirmed the existing resolver matches structured Project Type codes beginning with `PSM` or `PSAIM`, with the existing name fallback only when a code is absent.
- Confirmed Project Setup already passes `projectId` through `ProjectLinkContext` to dedicated master-data routes.
- Confirmed the inline Program & Study selector receives the already-resolved terms from the current project workflow.
- `npm.cmd run typecheck` passed.
- Full `npx.cmd eslint src --max-warnings=0` passed with zero warnings.
- Production build passed using the existing isolated `.next-verify` output directory; all application routes were generated.
- `git diff --check` passed.

### Verification still required

Authenticated runtime verification could not be completed because the browser available to Codex has no signed-in EPROM session and no external authenticated browser is connected. Do not change this item to `Verified` until all of the following are confirmed:

- From a PSM or PSAIM Project Setup, the selector search, Add New, Manage dialog, create/edit page, detail view, and lifecycle messages use Program & Study terminology.
- From a non-PSM/PSAIM project that uses Disciplines, the same surfaces retain Discipline terminology.
- Opening global `/disciplines` Administration without project context still uses Discipline terminology.
- Saving or editing an existing record from either context preserves the same record, URL, relationships, and return-to-project behavior.

## EPRP-2026-08-17-04 — Project-specific Department/System scope descriptions

**Status: Fixed but runtime-unverified**

### Requirement

Shared Department and System master descriptions must remain generic and reusable across projects. Project Setup needs an optional project-owned scope/description for each linked Department and System, without duplicating or editing the master record. Existing links with no override must fall back to the master description.

### Root cause

`DepartmentAssignment` previously stored only the project lead, reporting flag, and assigned System snapshots. `SystemAssignment` stored only id/name/code. The database likewise had no Department-link description column, and the System JSON snapshot had no project description property. Therefore the only editable description was the shared master record, whose change correctly applied everywhere but could not represent project-specific scope.

### Implementation

- Added nullable `public.project_departments.project_description` for the Department-link override.
- Extended each existing System assignment JSON object with optional `projectDescription`; no new System table or duplicate master record was introduced.
- Added optional `projectDescription` to `DepartmentAssignment` and `SystemAssignment`.
- Added complete read/write and Project Form schema round-trip so Project Setup, Project Info editing, and Supabase persistence preserve both values.
- Added `Project scope description (optional)` fields to the Department and System setup cards.
- Empty fields explicitly use the shared master description as their placeholder/fallback.
- System reselection now preserves an existing System assignment and its project description instead of rebuilding and losing it.
- Project Details displays the project override when present and otherwise displays the current master description.

### Files modified

- `eprp/supabase/migrations/20260817000002_project_scope_descriptions.sql` — created and applied.
- `eprp/src/types/project.ts`
- `eprp/src/lib/supabase/database.types.ts`
- `eprp/src/services/supabase-project-service.ts`
- `eprp/src/features/projects/schemas/project-form.ts`
- `eprp/src/features/projects/components/setup/setup-step-departments.tsx`
- `eprp/src/features/projects/components/setup/setup-step-systems.tsx`
- `eprp/src/features/projects/components/setup/project-setup-view.tsx`
- `eprp/src/features/projects/components/setup/project-info-workspace.tsx`
- `eprp/src/features/projects/components/project-details-view.tsx`
- `docs/15_DEVELOPMENT_ROADMAP.md` — phase/status note only.

### Database objects modified

- Table: `public.project_departments`
- Added nullable column: `project_description text`
- Added column comment describing ownership and fallback behavior.

No RLS policy, function, trigger, constraint, existing value, or master-data table was changed. System-level project descriptions remain inside the pre-existing `project_departments.systems` JSONB assignment payload.

### Data safety

- Migration is additive and idempotent: `ADD COLUMN IF NOT EXISTS` only.
- Existing Department links receive `NULL`; no existing row was rewritten or deleted.
- Existing System JSON arrays remain valid and unchanged.
- A blank override falls back to master data; it does not copy or overwrite the master description.
- No database reset, reseed, or project recreation was performed.

### Verification completed

- Targeted ESLint passed for all P3 files.
- `npm.cmd run typecheck` passed.
- Full `npx.cmd eslint src --max-warnings=0` passed with zero warnings.
- Production build passed using `.next-verify`; all application routes were generated.
- `git diff --check` passed.
- Before deployment, the remote migration list showed `20260817000002` as the only pending migration.
- `supabase db push` applied only `20260817000002_project_scope_descriptions.sql`; no seed or role change ran.
- A second remote migration listing confirmed local and remote `20260817000002` aligned.

### Verification still required

Authenticated browser save/reload verification is still required because the browser available to Codex has no signed-in EPROM session. Do not change this item to `Verified` until these checks pass:

- Enter different Department/System project descriptions in two projects sharing the same master records and confirm each persists independently.
- Confirm the shared Department/System master descriptions remain unchanged.
- Clear an override, save/reload, and confirm Project Details falls back to the master description.
- Add/remove/reselect a System and confirm an existing retained System override is not silently lost.
- Confirm existing project `PSM-00-02` remains intact.

## EPRP-2026-08-17-05 — Department Manager project context and selector clarity

**Status: Fixed but runtime-unverified**

### Requirement

Department Manager/Lead assignment in Project Setup must be project-specific, searchable, and must not change the shared Department master record. Changing a manager must preserve the remaining project team.

### Root cause and current-model finding

The structured manager model was already project-specific: `project_contacts` rows carry `department_id` and `assignment_role = 'department_manager'`, and `setAssignment()` enforces one manager per Department inside one Project. No database correction was required.

The confusion came from UI drift:

- The Departments step still exposed legacy free-text `Department lead` stored on `project_departments.lead_name`.
- Project summaries displayed that legacy text instead of the structured project manager.
- The separate Department Manager selector implemented earlier used a non-searchable Select.
- The global Department master still labelled `lead_contact_id` simply as Department Lead, without distinguishing it as the master/default value.

### Implementation

- Replaced the non-searchable manager Select with the existing searchable `ManagedPersonSelect`.
- Kept manager choices filtered to contacts whose home Department matches the active project Department.
- Kept the selector required/non-clearable so the UI cannot create a blank manager state through its clear button.
- Reused `setAssignment()` and `departmentManager()`; changing managers retains the previous person and existing team rows under the established assignment rules.
- Removed the editable legacy lead textbox from the active Departments setup step and replaced it with guidance that the manager is selected in Contacts and applies only to this Project.
- Updated Project Review, Project Details, Project Edit scope summary, and project-scoped Department list to display the structured manager from `project.team`.
- Relabelled the shared Department master field and displays as `Default Department Lead (master)` to clarify ownership.
- Preserved the existing `leadName` field and stored values for backward compatibility; no data was deleted or migrated.
- Added a reusable `clearable` option to `ManagedSelect`, defaulting to the prior behavior for all existing callers.

### Files modified

- `eprp/src/features/master-data/components/managed-select.tsx`
- `eprp/src/features/projects/components/setup/setup-step-contacts.tsx`
- `eprp/src/features/projects/components/setup/setup-step-departments.tsx`
- `eprp/src/features/projects/components/setup/setup-step-review.tsx`
- `eprp/src/features/projects/components/project-details-view.tsx`
- `eprp/src/features/projects/components/project-scope-summary.tsx`
- `eprp/src/features/projects/components/sections/project-scope-section.tsx`
- `eprp/src/features/master-data/services.ts`
- `eprp/src/features/master-data/components/master-data-views.tsx`
- `eprp/src/features/master-data/components/department-detail-view.tsx`
- `eprp/src/types/project.ts`
- `docs/15_DEVELOPMENT_ROADMAP.md` — phase note only.

Existing rule code reused without modification:

- `eprp/src/features/projects/assignment-rules.ts`

### Database objects modified

None. No migration or policy change was required.

### Data safety

- No `project_contacts`, `project_departments`, Department master, Contact, or Project row was changed during implementation.
- Legacy `lead_name` values remain readable and persist through the existing round-trip; they are not deleted or overwritten.
- The structured manager/team assignments remain the only source used by the active Project manager UI and project summaries.

### Verification completed

- Confirmed `departmentManager()` resolves only within the supplied Project and Department.
- Confirmed `setAssignment()` remains the manager-change path and the earlier manager/team preservation code was not replaced.
- Targeted ESLint passed for all P4 files.
- `npm.cmd run typecheck` passed after adding the required Review import.
- Full `npx.cmd eslint src --max-warnings=0` passed with zero warnings.
- Production build passed using `.next-verify`; all application routes were generated.
- `git diff --check` passed.

### Verification still required

Authenticated runtime verification remains unavailable in Codex. Do not mark `Verified` until:

- Search and select different Department Managers in two projects using the same Department and confirm each persists independently.
- Confirm changing one Project's manager does not change `departments.lead_contact_id` or the other Project.
- Confirm the prior manager remains in the team according to the existing demotion rule and other team assignments remain intact.
- Confirm manager search lists only contacts from the active Department and Add Contact remains available.
- Confirm Project Review and Project Details show the structured manager consistently after save/reload.

## EPRP-2026-08-17-06 — Reusable searchable selector UX

**Status: Fixed but runtime-unverified**

### Requirement

Relevant Project and master-data selectors should support searchable typeahead, progressively narrower results, existing records first, Add New, and Manage actions. Managed Job Title and Role semantics must not be redesigned.

### Root cause and current-state finding

Project Info selectors for Client, Project Type, Phase, and People, plus Project Setup selectors for Departments, Systems, and Programs & Studies, already used `ManagedSelect`/`ManagedMultiSelect` and met the requested pattern. The remaining inconsistency was `ReferenceSelect` inside `MasterDataForm`: Managed Job Title, Department, and dependent System references still used a native Select without search, Add New, or Manage.

### Implementation

- Replaced only the internal `ReferenceSelect` renderer with the existing `ManagedSelect` component.
- Managed Job Title, Department, System, and other reference fields now use the same searchable Add/Manage pattern as Project Info.
- Preserved optional versus required clearing behavior.
- Preserved archived current values for historical records.
- Preserved dependent Department -> System filtering.
- Preserved the existing effect that clears a System when its Department changes and the old System is no longer valid.
- Kept Add New auto-selection guarded by the active filter, so creating a record outside the selected Department cannot bypass the hierarchy.
- Did not change any Job Title, free-text position, Role, permission, assignment, or database semantics.

### Files modified

- `eprp/src/features/master-data/components/master-data-form.tsx`

Existing reusable behavior used without redesign:

- `eprp/src/features/master-data/components/managed-select.tsx`
- `eprp/src/features/master-data/components/master-data-dialog.tsx`

### Database objects modified

None. No migration or data change was required.

### Verification completed

- Confirmed Project Info Client, Project Type, Phase, and People already used managed searchable selectors.
- Confirmed Project Setup Department, System, Program & Study, and team selectors already used managed searchable selectors.
- Confirmed filtered Add New only auto-selects the created record when it satisfies the current relationship filter.
- Targeted ESLint passed.
- `npm.cmd run typecheck` passed.
- Full `npx.cmd eslint src --max-warnings=0` passed with zero warnings.
- Production build passed using `.next-verify`; all routes were generated.
- `git diff --check` passed.

### Verification still required

Authenticated browser verification remains pending. Confirm typeahead, Add New, Manage, archive visibility, and dependent Department/System clearing in Contact, System, and Program & Study forms before marking this item `Verified`.

## EPRP-2026-08-17-07 — Preserve Contacts state through Add Contact

**Status: Fixed but runtime-unverified**

### Problem

`Add Contact` in the Contacts setup step was a direct link to `/contacts/new`. Department Manager and Team Members edits existed only in the current React draft until the setup step was saved, so following that link could discard unsaved assignments. Returning from the Contact form also reopened the first Program & Study rather than the one the user had been editing.

### Root cause

The Contacts component had no pre-navigation save contract and the return URL carried only the setup route. It did not identify the active Program & Study. The same reusable Contacts component is also rendered inside Project Info Workspace, so both callers required an explicit, safe save result before navigation.

### Implementation

- Replaced the direct Add Contact link with a guarded button.
- If the current Project Setup draft is dirty, the existing setup `save()` runs before navigation. If it is clean, navigation proceeds without an unnecessary write.
- Project Info Workspace uses its existing team-only save path when team/delegation changes are dirty.
- Navigation proceeds only after the save callback returns success. Validation, unloaded-team protection, or a persistence error keeps the user on the current page and leaves the draft visible.
- Added the active Program & Study ID to the existing local `returnTo` URL as `disciplineId` and restored that selection only when it is still linked to the Project; otherwise the existing first-item fallback remains.
- Reused the existing Contact create route, project-link context, project persistence service, validation, and post-create project-linking behavior. No parallel browser/session draft store was introduced.
- The button is disabled and displays `Saving…` while the pre-navigation save is running, preventing duplicate navigation.

### Files modified

- `eprp/src/app/(app)/projects/[projectId]/setup/[step]/page.tsx`
- `eprp/src/features/projects/components/setup/project-setup-view.tsx`
- `eprp/src/features/projects/components/setup/setup-step-contacts.tsx`
- `eprp/src/features/projects/components/setup/project-info-workspace.tsx`
- `docs/15_DEVELOPMENT_ROADMAP.md` — phase/status note only.

### Database objects modified

None. No migration, table, policy, function, trigger, or stored row was changed during implementation.

### Data safety

- Existing Project, Department, Program & Study, Contact, team, and delegation records were not changed by the implementation step.
- The implementation calls the established save paths; it does not replace, clear, or locally duplicate project data.
- Failed validation or persistence blocks navigation instead of discarding the current draft.
- No database reset, reseed, RLS change, or unrelated module change was performed.

### Verification completed

- Confirmed both callers of `SetupStepContacts` provide the pre-navigation save contract.
- Confirmed the setup route accepts only the optional `disciplineId` return parameter and validates it against currently linked Programs & Studies before using it.
- Targeted ESLint passed for all four modified application files.
- `npm.cmd run typecheck` passed.
- Full `npm.cmd run lint` passed with zero warnings.
- Production build passed using the isolated `.next-verify` output directory; all application routes were generated.
- `git diff --check` passed; only existing LF-to-CRLF conversion notices were reported.

### Verification still required

Authenticated browser verification remains pending because the browser available to Codex has no signed-in EPROM session. Do not mark this item `Verified` until:

- Change Department Manager and Team Members, select Add Contact, create a Contact, and confirm the assignments present before navigation remain saved after returning.
- Confirm the same Program & Study is restored after return.
- Cancel or return without creating a Contact and confirm the saved assignments and selected Program & Study remain intact.
- Trigger an assignment validation error and confirm Add Contact does not navigate away or lose the visible draft.
- Repeat from the Project Info Workspace Contacts editor and confirm its team-only save behaves the same way.

## EPRP-2026-08-17-08 — Add Person Department context

**Status: Fixed but runtime-unverified**

### Problem

Opening Add Person from one Project Contacts Department could return a new Person associated with a different Department, including Process Safety when the intended context was Asset Integrity. The originating Department was not carried explicitly to the Contact form.

### Root cause

The project-link URL carried the active Program & Study as `parentId`, but not its Department. `MasterDataPageForm` and the post-save project linker then re-derived the Department synchronously with `getDisciplineById(parentId)`. The Supabase master-data cache hydrates lazily, so a fresh route load can attempt that lookup before the Program & Study cache is ready. This made the Department prefill and scope link dependent on transient client cache state rather than the explicit Project Contacts context.

The Contact form's controlled Department selector already preserves an explicit user choice, and the Supabase mapper already writes `departmentId` to `contacts.department_id`; those paths were not replaced.

### Implementation

- Extended the existing `ProjectLinkContext` with an optional explicit `departmentId` URL value.
- Project Contacts now sends the active Project Department together with the active Program & Study when opening Add Person.
- New Person forms prefer that explicit Department as an initial preset and retain the previous parent-lookup fallback for older links and other existing entry points.
- The preset is applied only when the create form initializes. A Department explicitly selected by the user afterward remains the submitted and stored Contact Department.
- Post-save Project scope linking uses the explicit originating Department when present, keeping the new assignment attached to the scope the user left while leaving the Person's home Department equal to the value saved on the Person record. This separation is required for the cross-Department assignment model in P8.
- Existing edit forms ignore presets and continue loading the stored Person record.

### Files modified

- `eprp/src/features/projects/project-link-context.ts`
- `eprp/src/features/projects/components/setup/setup-step-contacts.tsx`
- `eprp/src/features/master-data/components/master-data-page-form.tsx`
- `eprp/src/features/projects/link-record-to-project.ts`
- `docs/15_DEVELOPMENT_ROADMAP.md` — phase/status note only.

### Database objects modified

None. No migration, table, column, policy, function, trigger, or stored record was changed during implementation.

### Data safety

- No existing Contact, Project, Department, team assignment, or Program & Study row was updated or deleted.
- The URL addition is backward compatible; links without `departmentId` retain the existing parent-resolution fallback.
- The Contact's organizational Department and its project scope assignment remain separate facts; neither is silently rewritten to match the other.
- No database reset, reseed, RLS change, or unrelated module change was performed.

### Verification completed

- Confirmed Contact create state reads presets only during form initialization and subsequent selector changes update the controlled form value.
- Confirmed the existing model-to-row mapping writes the submitted `departmentId` to `contacts.department_id` without a hardcoded default.
- Confirmed Contact edit mode loads the stored record and does not apply the create preset.
- Targeted ESLint passed for all four modified application files.
- `npm.cmd run typecheck` passed.
- Full `npm.cmd run lint` passed with zero warnings.
- Production build passed using the isolated `.next-verify` output directory; all application routes were generated.
- `git diff --check` passed; only existing LF-to-CRLF conversion notices were reported.

### Verification still required

Authenticated runtime/database verification remains pending. Do not mark this item `Verified` until:

- From Asset Integrity Project Contacts, open Add Person and confirm Asset Integrity is prefilled.
- Explicitly change the Person Department to Process Safety, save/return, and confirm `contacts.department_id` stores Process Safety rather than restoring the prefill.
- Repeat from Process Safety, explicitly select Asset Integrity, and confirm the Person record remains under Asset Integrity after reload.
- Confirm return lands on the originating Project Contacts Program & Study and the scope assignment remains attached there.
- Confirm an older Add Person URL without `departmentId` still resolves through its parent where the cache is available and does not corrupt data when it is not.

## EPRP-2026-08-17-09 — Cross-Department Project scope assignments

**Status: Fixed but runtime-unverified**

### Requirement

One Directory Person has one home/default organizational Department but may be assigned explicitly to Programs & Studies owned by another Department on the same Project. The Person must not be duplicated or moved, and reporting lines and Department Manager behavior must remain scoped to the Project assignment Department.

### Root cause and current-model finding

The existing data model already supports this requirement:

- `contacts.department_id` stores the Person's organizational/home Department.
- `project_contacts.department_id`, `system_id`, and `discipline_id` store each Project scope assignment independently.
- Constraint `public.project_contacts_unique_scope` includes project, Person, row kind, assignment Department, System, Program & Study, and Assignment Role, allowing the same Person to hold multiple distinct scope assignments while rejecting only an exact duplicate.
- Assignment and reporting-line rules operate on the Project assignment's `departmentId`, not the Contact's home Department.

The blocker was confined to the Contacts UI: the Team Members selector filtered options to Contacts whose home Department matched the selected Program & Study Department. The schema and validation did not require that equality.

### Implementation

- Removed the home-Department equality filter from Team Members only.
- Kept the active Department Manager selector restricted to Contacts whose home Department matches that Department.
- Kept the selected Department Manager excluded from the Team Members options for that Department.
- Added reusable option metadata support to `ManagedMultiSelect`; the Team Members picker now shows and searches each Person's home Department.
- Marks an option as `Cross-department` when its home Department differs from the selected Project scope Department.
- Added explanatory text that selecting such a Person creates only a Project scope assignment and does not move or duplicate the Person.
- Project Team rows now display the Person's home Department and identify cross-Department assignments while remaining grouped under the assigned Program & Study/Department.
- Reused the existing `setForDiscipline`, assignment rules, persistence service, and database constraint without modification.

### Files modified

- `eprp/src/features/master-data/components/managed-multi-select.tsx`
- `eprp/src/features/projects/components/setup/setup-step-contacts.tsx`
- `docs/15_DEVELOPMENT_ROADMAP.md` — phase/status note only.

### Database objects modified

None in this phase. Existing objects inspected and reused:

- `public.contacts.department_id`
- `public.project_contacts.department_id`
- `public.project_contacts.system_id`
- `public.project_contacts.discipline_id`
- `public.project_contacts.assignment_role`
- Constraint `public.project_contacts_unique_scope`, established by `eprp/supabase/migrations/20260810000001_scoped_assignment_uniqueness.sql`

### Data safety

- No Contact, home Department, Project assignment, reporting line, or manager row was changed during implementation.
- Selecting one Person for multiple scope items reuses the same `contact_id`; the UI does not create a duplicate Contact.
- Cross-Department assignment is a visible user selection and is labelled in both the picker and Project Team summary.
- Department Manager eligibility remains unchanged and Department reporting lines continue to use the assignment Department.
- No migration, reset, reseed, RLS change, or unrelated module change was performed.

### Verification completed

- Inspected the current schema migrations and confirmed the scoped uniqueness key permits one Person across distinct Department/System/Program & Study assignments.
- Inspected assignment validation and confirmed it groups and validates by the Project assignment's Department without comparing it to `contacts.department_id`.
- Confirmed Team Members rows continue to write the active Program & Study's Department and scope IDs while the Contact record is untouched.
- Targeted ESLint passed for both modified application files.
- `npm.cmd run typecheck` passed.
- Full `npm.cmd run lint` passed with zero warnings.
- Production build passed using the isolated `.next-verify` output directory; all application routes were generated.
- `git diff --check` passed; only existing LF-to-CRLF conversion notices were reported.

### Verification still required

Authenticated runtime/database verification remains pending. Do not mark this item `Verified` until:

- Select an Asset Integrity Person for Process Safety / SIL and LOPA, save, reload, and confirm one Contact record and two scope assignment rows.
- Confirm the Person's `contacts.department_id` remains Asset Integrity.
- Confirm the Project Team summary displays Asset Integrity as the home Department while grouping the assignments under Process Safety.
- Confirm the Person's reporting line is validated within the Process Safety Project assignment Department.
- Remove one of the two scope assignments and confirm the other assignment and the Person record remain intact.
- Confirm the Department Manager selector still excludes people whose home Department differs from the active Department.

## EPRP-2026-08-17-10 — Weekly delegation date validation

**Status: Fixed but runtime-unverified**

### Problem

Project Contacts allowed a new Weekly delegation to start before the current date. Although End Date already exposed a browser `min` equal to Start Date and the project save validator rejected an end before the start, changing Start Date beyond the current End Date left an invalid hidden state and the user saw only a general save failure rather than local feedback.

Existing historical delegations must remain viewable and must not be rewritten merely because their saved Start Date is in the past.

### Root cause

Delegation validation did not distinguish a new draft row from a persisted row, despite `ProjectDelegation.id` already providing that distinction. The date inputs and `validateDelegations()` also implemented related rules separately: the inputs constrained only End Date, while validation messages were not rendered inside the delegation card.

### Implementation

- Added one reusable `delegationDateIssues()` rule used by both project save validation and the delegation card.
- A new delegation (no persisted `id`) cannot start before today's ISO date.
- A persisted historical delegation retains its past Start Date and is not rejected for that fact alone.
- End Date remains user-selected with no fixed duration and keeps its dynamic `min` equal to Start Date.
- If Start Date moves beyond the current End Date, End Date is cleared so the user must make an explicit valid choice.
- Both date inputs receive `aria-invalid` and the exact validation messages render inside the affected delegation card before save.
- The existing rule still rejects End Date before Start Date and an active delegation whose entire period has expired; revoking a historical delegation preserves it as history.

### Files modified

- `eprp/src/features/projects/assignment-rules.ts`
- `eprp/src/features/projects/components/setup/department-team-assignments.tsx`
- `docs/15_DEVELOPMENT_ROADMAP.md` — phase/status note only.

### Database objects modified

None. No migration, table, column, constraint, policy, function, trigger, or stored delegation was changed during implementation.

### Data safety

- Existing historical delegation rows remain loaded and displayed with their original dates.
- The implementation does not auto-update stored historical dates or impose a fixed duration.
- Clearing End Date occurs only in the unsaved UI draft when the user explicitly moves Start Date beyond it.
- No database reset, reseed, RLS change, or reporting-module change was performed.

### Verification completed

- Confirmed persisted delegations are mapped with `id` and new UI delegations have no `id` until saved/reloaded.
- Confirmed the same shared date-rule function drives both pre-save validation and local card feedback.
- Targeted ESLint passed for both modified application files.
- `npm.cmd run typecheck` passed.
- Full `npm.cmd run lint` passed with zero warnings.
- Production build passed using the isolated `.next-verify` output directory; all application routes were generated.
- `git diff --check` passed; only existing LF-to-CRLF conversion notices were reported.

### Verification still required

Authenticated runtime/database verification remains pending. Do not mark this item `Verified` until:

- Add a new delegation and confirm dates before today cannot be selected or saved.
- Move Start Date beyond End Date and confirm End Date clears and the local required-date message appears.
- Select a new End Date equal to or later than Start Date and confirm the error clears and save/reload persists both dates.
- Open an existing historical/revoked delegation and confirm its past Start Date remains visible and unchanged after unrelated Project Contacts edits.
- Confirm an active expired delegation still requires extension or revocation before save.

## EPRP-2026-08-17-11 — Project Team display order

**Status: Fixed but runtime-unverified**

### Problem

Project Review and other Project Team summaries rendered people in the underlying `project.team` insertion/database order. A Department Manager could therefore appear after Team Members, making the responsibility structure unclear even though the stored roles were correct.

### Root cause

`departmentAssignments()` intentionally preserves assignment data order and several summary components mapped raw `project.team` rows directly. No shared presentation comparator existed. Some Project Info content grouped Manager/Lead/Member, but names inside each role still followed row order.

### Implementation

- Added one presentation-only `compareTeamDisplayOrder()` helper.
- Deterministic role order is:
  1. Department Manager
  2. Team Member Lead
  3. Team Member
- Within the same role, names sort case-insensitively with numeric handling; `contactId` is the stable final tie-breaker.
- Applied the shared order to:
  - Project Setup Review.
  - Project Setup Contacts Project Team list.
  - Project Contacts role editor.
  - Project Info Workspace responsibility summary.
  - Project Edit scope summary.
  - Project-scoped Contacts table.
- Every caller sorts a copied/derived array. No stored assignment array, database row, role, reporting line, or display-order field is mutated.

### Files modified

- `eprp/src/features/projects/assignment-rules.ts`
- `eprp/src/features/projects/components/setup/setup-step-review.tsx`
- `eprp/src/features/projects/components/setup/setup-step-contacts.tsx`
- `eprp/src/features/projects/components/setup/department-team-assignments.tsx`
- `eprp/src/features/projects/components/setup/project-info-workspace.tsx`
- `eprp/src/features/projects/components/project-scope-summary.tsx`
- `eprp/src/features/projects/components/sections/project-scope-section.tsx`
- `docs/15_DEVELOPMENT_ROADMAP.md` — phase/status note only.

### Database objects modified

None. No migration, table, column, constraint, policy, function, trigger, or stored row was changed.

### Data safety

- The comparator is read-only and presentation-only.
- Assignment roles and reporting lines remain unchanged.
- Existing row order remains unchanged in `project.team` and `public.project_contacts`.
- No database reset, reseed, RLS change, or unrelated module change was performed.

### Verification completed

- Confirmed all listed renderers use the same shared comparator rather than independent role-order logic.
- Confirmed role precedence uses existing `AssignmentRole` values and defaults legacy rows without `assignmentRole` to Team Member for display.
- Targeted ESLint passed for all seven modified application files.
- `npm.cmd run typecheck` passed.
- Full `npm.cmd run lint` passed with zero warnings.
- Production build passed using the isolated `.next-verify` output directory; all application routes were generated.
- `git diff --check` passed; only existing LF-to-CRLF conversion notices were reported.

### Verification still required

Authenticated visual verification remains pending. Do not mark this item `Verified` until:

- In Asset Integrity, confirm Mohamed Khatab appears first when assigned as Department Manager.
- Confirm Team Member Leads follow the manager and Team Members follow the leads.
- Confirm two people with the same role display alphabetically and remain stable after save/reload.
- Confirm Project Review, Project Contacts, Project Info Workspace, Project Edit summary, and Project Contacts section agree.
- Confirm roles/reporting lines in the database are unchanged before and after viewing these screens.

## EPRP-2026-08-17-12 — Client Short Name and Review resolution

**Status: Fixed but runtime-unverified**

### Requirement and current-model finding

Client master data needs an optional Short Name/Acronym while retaining the full legal/display name. Project Review must resolve the selected Client instead of displaying `—`.

The optional field was already implemented end to end before this phase:

- `public.clients.short_name` has existed as nullable text since the baseline schema.
- `Client.shortName`, `ClientRow.short_name`, Supabase row validation/mapping, mock data, master-data form configuration, and compact report fallbacks already support it.
- Existing Clients require no migration or data update.

### Root cause

Project Review used synchronous `getClientById(project.clientId)`. The Supabase master-data cache hydrates lazily, and Review did not subscribe to Client data. On a fresh/deep navigation, the lookup could run against an empty cache and remain rendered as `—` even though `project.clientId` was correctly saved.

Project Details used the same unsusbcribed synchronous pattern, so the same safe hydration repair was applied there.

### Implementation

- Relabelled the existing optional form field to `Client Short Name / Acronym`; storage and semantics are unchanged.
- Project Review now subscribes to the Client master-data store and resolves the selected `project.clientId` reactively.
- Review displays `Short Name — Full Name` when an acronym exists and falls back to Full Name when it does not.
- Project Details now subscribes to the same Client store before resolving the Client; its existing compact/full-name behavior remains intact.
- No full Client name is overwritten, copied, or inferred from the acronym.

### Files modified

- `eprp/src/features/master-data/services.ts`
- `eprp/src/features/projects/components/setup/setup-step-review.tsx`
- `eprp/src/features/projects/components/project-details-view.tsx`
- `docs/15_DEVELOPMENT_ROADMAP.md` — phase/status note only.

### Database objects modified

None in this phase. Existing object inspected and reused:

- `public.clients.short_name` nullable text, created by `eprp/supabase/migrations/20260719000001_schema.sql`.

No migration was created or applied.

### Data safety

- Existing Client and Project rows were not updated.
- Full names and existing short names remain unchanged.
- Clients with `NULL`/blank short names continue to display their full name.
- No reset, reseed, RLS change, or reporting-module change was performed.

### Verification completed

- Confirmed the field already round-trips through the generic camelCase/snake_case Supabase mapper.
- Confirmed the Client form treats `shortName` as optional.
- Confirmed Project Review now reacts to Client store hydration instead of using a one-time synchronous lookup.
- Targeted ESLint passed for all three modified application files.
- `npm.cmd run typecheck` passed.
- Full `npm.cmd run lint` passed with zero warnings.
- Production build passed using the isolated `.next-verify` output directory; all application routes were generated.
- `git diff --check` passed; only existing LF-to-CRLF conversion notices were reported.

### Verification still required

Authenticated runtime/database verification remains pending. Do not mark this item `Verified` until:

- Set a Client Short Name such as WEPCO, save/reload the Client, and confirm the full name remains unchanged.
- Open Project Review from a fresh/deep navigation and confirm it displays `WEPCO — Full Name` rather than `—`.
- Clear the Short Name, save/reload, and confirm Review falls back to the full Client name.
- Confirm Project Details and existing compact Project cards/tables display a valid Client after master-data hydration.
- Confirm the Project's stored `client_id` remains unchanged.

## EPRP-2026-08-17-13 — Multiple Project Sites/Locations

**Status: Fixed but runtime-unverified**

### Requirement

A Project must support multiple named Sites/Locations and one Primary/default Site, while preserving existing one-location projects and avoiding an immediate redesign of Weekly, Monthly, Executive, Dashboard, or other reporting modules.

### Root cause

The Project model and `public.projects` table stored only one location through the scalar `site`, `city`, and `country` columns. Project Info rendered the same three scalar fields, so there was no independently addressable Site entity, no stable Site ID, no additional-site collection, and no Primary-Site rule.

### Implementation

- Added the project-owned `public.project_sites` table with stable UUIDs, Site name/country/city, `is_primary`, and `sort_order`.
- Added a partial unique index that permits at most one Primary Site per Project.
- Kept the legacy `public.projects.site/city/country` columns unchanged. Project Info still writes the selected Primary Site to those columns so existing consumers continue to receive the same location shape.
- Backfilled one Primary `project_sites` row from each existing Project whose legacy `site` is nonblank. The migration inserts new child rows only; it does not update or delete any existing Project row.
- Extended the Project domain/service mapping with optional `sites`. Reads degrade to the legacy location if the additive table is unavailable or has no rows.
- Added Primary Site fields, repeatable Additional Sites, removal, and `Make primary` behavior to Project Info.
- Site writes preserve existing Site IDs where possible, create new IDs only for new rows, clear/promote the Primary flag safely around the unique index, and remove only Site rows explicitly removed from the submitted Project form.
- Project Details now labels the backward-compatible location as `Primary location` and displays all named Sites when more than one exists.

### Files modified

- `eprp/supabase/migrations/20260817000003_project_sites.sql` — created and applied.
- `eprp/src/types/project.ts`
- `eprp/src/lib/supabase/database.types.ts`
- `eprp/src/services/supabase-project-service.ts`
- `eprp/src/features/projects/schemas/project-form.ts`
- `eprp/src/features/projects/form-meta.ts`
- `eprp/src/features/projects/components/project-form.tsx`
- `eprp/src/features/projects/components/project-details-view.tsx`

### Database objects modified

- Added table: `public.project_sites`
- Added trigger: `public.project_sites.set_updated_at` using existing `public.set_updated_at()`
- Added indexes:
  - `project_sites_one_primary_per_project` — partial unique index on `project_id where is_primary`
  - `project_sites_project_sort` — read-order index on Project, sort order, and name
- RLS remains enabled.
- Added policies:
  - `project_sites_select` using `public.weekly_can_access_project(project_id)`
  - `project_sites_insert`, `project_sites_update`, and `project_sites_delete` using `public.weekly_can_manage_project(project_id)`

No existing policy or authorization helper was widened or replaced.

### Verification completed

- Targeted ESLint passed for all P12 files.
- `npm.cmd run typecheck` passed.
- Full `npm.cmd run lint` passed with zero warnings.
- Isolated production build passed with `NEXT_DIST_DIR=.next-verify`; all application routes were generated.
- `git diff --check` passed; only existing LF-to-CRLF notices were reported.
- Supabase dry run confirmed `20260817000003_project_sites.sql` was the only pending migration.
- The migration was applied to the linked hosted Supabase project.
- A subsequent migration listing confirmed local and remote version `20260817000003` are aligned.

### Verification still required / downstream Open work

Do not mark this item `Verified` until an authenticated Project Info runtime test confirms:

- an existing one-location Project opens with the legacy location represented as its Primary Site;
- adding two Sites, saving, reloading, and changing the Primary Site persists correctly;
- removing one additional Site leaves the Project and its other Sites intact;
- a user with Project manage permission can write Site rows and an ordinary read-only Project member cannot;
- the legacy `projects.site/city/country` values continue to match the selected Primary Site after save;
- existing Project Setup completion and Project Details remain intact.

Site-level attribution inside Weekly, Monthly, Executive, Dashboard, and report output remains **Open downstream work**. Those modules were deliberately not changed in this Project-only phase; they may adopt `project_sites.id` later without replacing or reparsing free-text locations.

## EPRP-2026-08-17-14 — Official Project Reference Documents

**Status: Fixed but runtime-unverified**

### Requirement

Project Info must hold multiple authoritative Project references such as the official Scope of Work, baseline schedule, contract/PO, approved proposal, organization chart, kick-off MOM, and other official documents. Each uploaded revision must remain traceable; superseded revisions must not be deleted. Supported files, especially PDFs, should open inside the platform with an option to open the original.

### Root cause

The Project `Documents` section and route rendered placeholders only. `attachmentService` was also an explicit not-implemented stub and no migration contained an attachment/document table or Storage bucket. Reusing that unfinished generic service would have mixed controlled Project references with future report/comment attachments and provided no revision metadata.

### Implementation

- Added a dedicated Project-owned metadata entity and private Storage bucket instead of changing the generic attachment placeholder.
- Added metadata for Title, Document Type, Document/Reference No., Revision, Issue Date, Status, Uploaded By snapshot, Notes, original file name/type/size, and storage path.
- Added the required document categories and revision statuses (`current`, `superseded`, `draft`, `approved`, `cancelled`).
- Every upload creates a new immutable file path and metadata row; changing a revision's status updates metadata only. No upload or status change deletes an older revision.
- Added an Upload Document dialog in both the Project Overview Documents section and the dedicated Project `Reference Documents` route.
- Added a secure in-platform viewer using a one-hour signed URL. PDFs and images render in the modal; other supported Office formats provide `Open Original File` without fabricating an online converter or Google Drive integration.
- Kept `/documents`, the generic `attachmentService`, report attachments, and all Weekly/Monthly/Executive modules unchanged.

### Files modified

- `eprp/supabase/migrations/20260817000004_project_reference_documents.sql` — created and applied.
- `eprp/src/types/project.ts`
- `eprp/src/lib/supabase/database.types.ts`
- `eprp/src/services/project-document-service.ts` — created.
- `eprp/src/features/projects/components/project-documents-panel.tsx` — created.
- `eprp/src/features/projects/components/project-details-view.tsx`
- `eprp/src/features/projects/components/sections/project-section-view.tsx`
- `eprp/src/config/project-sections.ts`

### Database objects modified

- Added table: `public.project_documents`
- Added private Storage bucket: `project-reference-documents`
  - File-size limit: 25 MB
  - Allowed types: PDF, Word, Excel, PowerPoint, PNG, and JPEG
- Added indexes:
  - `project_documents_project_date`
  - `project_documents_project_type`
- Added trigger/function:
  - `project_documents_authorship`
  - `public.set_project_document_authorship()`
  - existing `public.set_updated_at()` trigger on the new table
- Added path parser: `public.project_id_from_storage_path(text)`
- RLS remains enabled on `public.project_documents`.
- Added Project-scoped metadata policies:
  - `project_documents_select` uses `public.weekly_can_access_project(project_id)`
  - `project_documents_insert/update/delete` use `public.weekly_can_manage_project(project_id)`
- Added private `storage.objects` policies for the bucket:
  - `project_reference_documents_select`
  - `project_reference_documents_insert`
  - `project_reference_documents_update`
  - `project_reference_documents_delete`
  - each resolves the Project UUID from the first storage-path segment and applies the same existing Project access/manage helpers.

No existing RLS policy, helper, Project row, report row, or attachment row was changed.

### Verification completed

- Targeted ESLint passed for all P13 application files.
- `npm.cmd run typecheck` passed.
- Full `npm.cmd run lint` passed with zero warnings.
- Isolated production build passed with `NEXT_DIST_DIR=.next-verify`; all routes were generated.
- `git diff --check` passed; only existing LF-to-CRLF notices were reported.
- Supabase dry run confirmed `20260817000004_project_reference_documents.sql` was the only pending migration.
- The migration applied successfully to the linked hosted Supabase project.
- A subsequent migration listing confirmed local and remote version `20260817000004` are aligned.

### Verification still required / limitations

Do not mark this item `Verified` until an authenticated runtime test confirms:

- an authorized Project manager can upload a PDF and all metadata persists after reload;
- the PDF opens inside the modal and `Open Original File` resolves through a signed URL;
- uploading Rev.01 and marking Rev.00 `Superseded` retains both rows and both files;
- Uploaded By is populated from the authenticated profile;
- a read-only scoped Project member can view but cannot upload or change status;
- an account without Project access cannot list metadata or read bucket objects;
- the 25 MB and allowed MIME restrictions behave as configured.

The viewer does not attempt to render Word/Excel/PowerPoint inside an iframe; those files use `Open Original File`. Global document search, report references, report attachments, and Google Drive integration remain downstream work and were deliberately not implemented in this Project-only phase.

## EPRP-2026-08-17-15 — Client Representative contact auto-resolution

**Status: Fixed but runtime-unverified**

### Requirement

When the selected Client Representative Contact already has a name, email, and phone, Project Contact & Location should avoid duplicate typing while keeping project-level fields editable and preserving explicit overrides.

### Root cause

The Project form stored `clientRepresentativeId` and the Project's `clientContact.name/email/phone` snapshot fields independently. The Contact model already exposed name, email, and phone, but selecting a representative only changed the ID and did not map any of those values into the Project fields.

### Implementation

- Extended the reusable Project-form Person field with a selection callback; existing Person selectors remain unchanged unless they use the callback.
- When Client Representative changes, the form resolves the selected Contact from the existing reactive master-data store.
- Name, email, and phone are copied only when the corresponding Project field is blank or still equals the previous representative's value.
- A manually edited Project contact value is therefore preserved when the representative changes.
- Clearing Client Representative does not clear Project contact values.
- Added an explicit `Fill empty contact fields from Client Representative` action for existing Projects whose representative was already selected before this behavior existed.
- The fields remain normal editable Project fields and continue to persist through the existing `projects.client_contact_*` columns.

### Files modified

- `eprp/src/features/projects/components/project-form.tsx`

### Database objects modified

None. No migration, schema, policy, Contact row, or Project row was changed during implementation.

### Verification completed

- `npm.cmd run typecheck` passed.
- Targeted ESLint passed for `project-form.tsx`.
- Full `npm.cmd run lint` passed with zero warnings.
- Isolated production build passed with `NEXT_DIST_DIR=.next-verify`; all routes were generated.
- `git diff --check` passed; only existing LF-to-CRLF notices were reported.

### Verification still required

Do not mark this item `Verified` until an authenticated runtime check confirms:

- selecting a representative fills blank name/email/phone fields;
- fields absent on the Contact remain blank and editable;
- editing an auto-filled value creates an override that is not replaced by a later representative change;
- values still equal to the previous representative update to the newly selected representative;
- clearing the representative leaves Project contact values intact;
- save/reload preserves the final Project values and does not update the Contact master record.

## EPRP-2026-08-17-16 — Project Setup Review clarity

**Status: Fixed but runtime-unverified**

### Requirement

The final Project Setup Review must resolve the selected Client, show Department Manager first, present a clear Department → System → Program & Study hierarchy, report accurate counts, and avoid implying that a cross-Department assignment changes a Person's home Department.

### Root cause and existing fixes confirmed

- P11 already replaced the stale one-time Client lookup with the reactive Client store and added short-name/full-name fallback.
- P10 already added the shared deterministic team comparator that places Department Manager, Team Member Lead, then Team Member.
- Review counts already used the stored Department/System collections and de-duplicated Program & Study and Person IDs; no count mutation was needed.
- The remaining defect was presentation: Programs & Studies were rendered as one flat Department-level badge list, hiding which System owned each item. Cross-Department assignments were shown in the correct Project scope but without a home-Department label, which could be misread as an organizational transfer.

### Implementation

- Replaced the flat Program & Study badge list with a nested Department → System → Programs & Studies structure.
- Each System displays only links whose stored `systemId` matches that System.
- Legacy links with no valid System relationship remain visible in a warning row instead of being silently omitted or reassigned.
- Kept the shared manager/lead/member comparator and all stored roles unchanged.
- Added `Cross-department · Home: <Department>` for a scoped assignment whose Contact master `departmentId` differs from the Project assignment Department.
- Project Manager resolution now uses the same loaded Contact collection passed to Review, avoiding a separate synchronous cache lookup.
- Existing Summary counts remain read-only derivations: Department array length, assigned System count, unique linked Program & Study IDs, and unique Project Person IDs.

### Files modified

- `eprp/src/features/projects/components/setup/setup-step-review.tsx`

### Database objects modified

None. No assignment, Contact, Project, scope link, schema, migration, or RLS policy was changed.

### Verification completed

- `npm.cmd run typecheck` passed.
- Targeted ESLint passed for `setup-step-review.tsx`.
- Full `npm.cmd run lint` passed with zero warnings.
- Isolated production build passed with `NEXT_DIST_DIR=.next-verify`; all routes were generated.
- `git diff --check` passed; only existing LF-to-CRLF notices were reported.

### Verification still required

Do not mark this item `Verified` until an authenticated Review-page check confirms:

- Client displays short/full-name fallback correctly;
- each Program & Study appears beneath its actual System and never another System;
- Department Manager appears before Team Member Leads and Team Members;
- displayed counts match the saved Project links and distinct people;
- a cross-Department Person displays under the selected Project scope with the correct Home Department and the Contact master Department remains unchanged;
- any legacy link without a valid System is visible in the warning row rather than lost.

## EPRP-2026-08-17-17 — Project Branding / QR reference check

**Status: Fixed but runtime-unverified**

### Requirement

Project configuration must distinguish EPROM/company identity from Client identity, retain Prepared / Reviewed / Approved signature wording, and must not imply that enabling QR automatically creates a real published report/archive destination.

### Root cause and findings

- The data model already stores separate `projectLogoRef` and `clientLogoRef` values; no schema separation was required.
- The form labelled `projectLogoRef` as `Project Logo`, which was ambiguous about whether it represented EPROM/company or the Client.
- The QR switch description said it added a scan-to-access QR code, but Project Setup stores only a boolean. The actual target is constructed by report output routes; no published revision/archive destination is configured in Project Setup.
- Signature behavior was already Prepared / Reviewed / Approved and required no data change.

### Implementation

- Relabelled `projectLogoRef` as `EPROM / Company Logo` in the Project form and validation/error metadata.
- Kept `Client Logo` separate and unchanged.
- Clarified the Branding section description to state the two identities separately.
- Relabelled the QR preference as conditional on a published report URL and explicitly stated that Project Setup does not create the destination.
- Standardized the signature description to `Prepared / Reviewed / Approved`.
- Added type comments documenting the two logo meanings without renaming stored fields.

### Files modified

- `eprp/src/types/project.ts`
- `eprp/src/features/projects/form-meta.ts`
- `eprp/src/features/projects/components/project-form.tsx`

### Database objects modified

None. No schema, migration, branding value, Project row, report output, or RLS policy changed.

### Verification completed

- `npm.cmd run typecheck` passed.
- Targeted ESLint passed for the three P16 files.
- Full `npm.cmd run lint` passed with zero warnings.
- Isolated production build passed with `NEXT_DIST_DIR=.next-verify`; all routes were generated.
- `git diff --check` passed; only existing LF-to-CRLF notices were reported.

### Verification still required / downstream Open work

Authenticated visual confirmation of the revised labels and save/reload of the existing independent logo/QR/signature settings remains pending.

A real QR target tied to a published report/archive/share destination and specific revision remains **Open downstream reporting/deployment work**. P16 did not change Weekly/PDF/Monthly/Executive rendering and did not invent a destination. The QR flag must not be treated as proof that a controlled published URL exists.

## EPRP-2026-08-17-18 — P17 final Project Setup regression

**Status: In Progress**

### Required regression

Confirm the complete authenticated flow:

`Project Info → Departments → Systems → Programs & Studies → Contacts → Review`

including Project Setup save/reload, RLS, Contacts separation, Project `PSM-00-02`, 100% completion, and Finish Setup.

### Verification completed

- Final `npm.cmd run typecheck` passed.
- Final full `npm.cmd run lint` passed with zero warnings.
- Final isolated production build passed with `NEXT_DIST_DIR=.next-verify`; all six Project Setup route patterns were generated.
- Unauthenticated requests to the exact existing Project UUID returned `307` to the correct `/login?next=...` destination for `info`, `departments`, `systems`, `disciplines`, `contacts`, and `review`; none returned 404 or a page-load failure.
- The in-app browser loaded the Sign In page successfully for the requested Project Setup route.
- Supabase migration listing confirmed all versions are aligned through:
  - `20260817000001_project_departments_rls.sql`
  - `20260817000002_project_scope_descriptions.sql`
  - `20260817000003_project_sites.sql`
  - `20260817000004_project_reference_documents.sql`
- Static migration inspection found zero active `DISABLE ROW LEVEL SECURITY` statements.
- Static policy inspection confirmed Project Department, Site, and Document writes continue to use `public.weekly_can_manage_project(project_id)`.
- Static implementation inspection confirmed:
  - Program & Study filtering requires both Department and exact System;
  - Department Manager and Team Members remain separate selectors;
  - the active manager is excluded from Team Members;
  - manager changes reuse the one-manager/demotion rules;
  - Add Contact first calls the Project save callback and carries the active Program & Study and Department context;
  - Review uses the shared manager/lead/member order comparator.
- No Project, Contact, assignment, report, document, or Site row was created, changed, or deleted during P17 checks.

### Why P17 is not Verified

The only browser connected to Codex has no authenticated EPROM session and stops at Sign In. No connected external Chrome/Edge extension session is available. Credentials were not requested, read, or entered.

Therefore the following required checks remain outstanding:

- save/reload through every setup step;
- QRA/FERA and Asset Integrity system-specific selector behavior against hosted data;
- Department Manager/Team Member persistence and manager replacement behavior;
- Add Person return-state preservation and correct Department persistence;
- cross-Department Person assignment without duplicate Contact rows;
- delegation date UI behavior;
- Client, hierarchy, ordering, count, branding, multi-Site, and document-upload runtime behavior;
- Project Setup reaches 100% and Finish Setup succeeds;
- role-by-role allowed/denied RLS writes;
- current hosted row/data confirmation that `PSM-00-02` remains intact.

Do not change this item to `Verified` until those authenticated checks are performed. The static/build/migration evidence confirms the implementation is present and the routes respond, but it does not prove persistence behavior or current hosted Project contents.

### Files and database objects modified

None for P17 verification itself, other than this documentation update. No migration was created or applied in P17.

## Project-only pass phase matrix

| Phase | Issue ID | Result | Runtime verified? | Main files changed | DB change? | Remaining work |
| --- | --- | --- | --- | --- | --- | --- |
| P1 | EPRP-OPEN-01 | Fixed but runtime-unverified | No | `setup-step-disciplines.tsx` | No | Authenticated Process Safety and Asset Integrity selector checks, including hosted QRA/FERA ownership |
| P2 | EPRP-OPEN-02 | Fixed but runtime-unverified | No | Project terminology and master-data display components | No | Authenticated PSM/PSAIM vs non-PSM wording checks |
| P3 | EPRP-2026-08-17-04 | Fixed but runtime-unverified | No — UI is wired; migration applied | Project types/schema/service plus Department/System setup and Project Details UI | Yes — `20260817000002` | Authenticated save/fallback and cross-Project isolation |
| P4 | EPRP-2026-08-17-05 | Fixed but runtime-unverified | No | Department/Contacts setup and Project summaries | No | Authenticated cross-Project manager persistence |
| P5 | EPRP-2026-08-17-06 | Fixed but runtime-unverified | No | Reusable managed selectors and master-data form | No | Authenticated selector interaction |
| P6 | EPRP-2026-08-17-07 | Fixed but runtime-unverified | No | Contacts/setup/workspace save-and-return flow | No | Authenticated Add Contact round trip |
| P7 | EPRP-2026-08-17-08 | Fixed but runtime-unverified | No | Project link context, Contact form/linking | No | Authenticated Department override/save check |
| P8 | EPRP-2026-08-17-09 | Fixed but runtime-unverified | No | Contacts selector/summary and assignment UI | No | Hosted multi-scope save/reload and row-count check |
| P9 | EPRP-2026-08-17-10 | Fixed but runtime-unverified | No | Delegation rules/editor | No | Authenticated date-input/save check |
| P10 | EPRP-2026-08-17-11 | Fixed but runtime-unverified | No | Shared assignment ordering and Project summaries | No | Authenticated manager-first cross-screen order check |
| P11 | EPRP-2026-08-17-12 | Fixed but runtime-unverified | No | Client master service/form, Review, Project Details | No | Authenticated Client short-name save/reload and Review resolution |
| P12 | EPRP-2026-08-17-13 | Fixed but runtime-unverified | No — Project UI is wired; migration applied | Project site types/service/form/setup/details | Yes — `20260817000003` | Authenticated Site CRUD/RLS; reporting attribution remains foundation-only |
| P13 | EPRP-2026-08-17-14 | Fixed but runtime-unverified | No — Project UI/viewer is wired; migration applied | Project documents service/panel/overview/dedicated route/types | Yes — `20260817000004` | Authenticated upload/view/revision/RLS; Primavera and semantic Scope viewer remain Open |
| P14 | EPRP-2026-08-17-15 | Fixed but runtime-unverified | No | `project-form.tsx` | No | Authenticated auto-fill/override/save check |
| P15 | EPRP-2026-08-17-16 | Fixed but runtime-unverified | No | `setup-step-review.tsx` | No | Authenticated hierarchy/count/home-Department check |
| P16 | EPRP-2026-08-17-17 | Fixed but runtime-unverified | No | Project branding types/meta/form | No | Authenticated label/save check; real QR destination remains Open |
| P17 | EPRP-2026-08-17-18 | In Progress | Partial, unauthenticated only | Documentation only | No | Full authenticated Project Setup and `PSM-00-02` confirmation |

## Working-tree preservation note

The inspection found unrelated, pre-existing working-tree changes in Weekly Reporting files, `eprp/src/app/globals.css`, generated Supabase types, and the 2026-08-16 Weekly migrations. They were not created, modified, reverted, staged, or attributed to this documentation task. Future work must preserve them unless their owner explicitly brings them into scope.

## Chronological Change Log

### 2026-08-17 — Project Department RLS diagnosis

- Inspected Project Setup persistence and identified the delete-then-insert flow in `replaceDepartments()`.
- Confirmed the failure occurred on INSERT into `public.project_departments` and blocked navigation to Contacts.

### 2026-08-17 — Project Department RLS implementation

- Created `eprp/supabase/migrations/20260817000001_project_departments_rls.sql`.
- Kept RLS enabled.
- Replaced the temporary authenticated-wide policy with project-scoped SELECT, INSERT, UPDATE, and DELETE policies.
- Reused existing project access/manage helper functions; no schema or data changes were made.

### 2026-08-17 — Project Department RLS deployment and verification

- Confirmed migration `20260817000001` was the only pending migration.
- Applied it to the linked hosted Supabase project using `supabase db push`.
- Confirmed the remote migration version matched the local version.
- User subsequently reached the Contacts step, demonstrating that the previous RLS navigation blocker was removed.

### 2026-08-17 — Contacts role-selector separation

- Updated `setup-step-contacts.tsx` to render separate Department Manager and Team Members selectors beside Program & Study.
- Reused existing assignment rules to enforce one manager, demote rather than delete the previous manager, repair reporting lines, and preserve manager rows during Team Member edits.
- Confirmed file-level ESLint, project type-check, and production build passed.
- Authenticated browser interaction and persistence checks remain outstanding.

### 2026-08-17 — Local server recovery

- Diagnosed the failed page as a stale `next start` process after the production build replaced `.next` output.
- Restarted only the EPROM production server on port 3000.
- Confirmed the Contacts route responded through the expected authentication redirect.

### 2026-08-17 — Permanent handoff consolidation

- Consolidated all implementation work performed in this Codex session into this canonical file.
- Recorded exact files, database policies, verification evidence, outstanding runtime checks, and open carry-forward requirements.
- No application code, database data, or unrelated working-tree changes were modified during consolidation.

### 2026-08-17 — P1 system-specific Programs & Studies filtering

- Confirmed the Project Setup selector filtered Program & Study options by Department only, despite both the master record and project link already carrying `systemId`.
- Updated `eprp/src/features/projects/components/setup/setup-step-disciplines.tsx` to require exact Department and System matches.
- Changed the empty-state wording to describe the selected System accurately.
- Created no migration and made no project-data or master-data changes.
- TypeScript, full-source ESLint, production build, and diff checks passed.
- Authenticated runtime behavior remains pending because the available Codex browser had no signed-in EPROM session; status is `Fixed but runtime-unverified`.

### 2026-08-17 — P2 contextual Program & Study terminology

- Confirmed the Project wizard already used Project Type-aware hierarchy terms, while shared master-data surfaces still read the global Discipline label directly.
- Added display-only terminology overrides to the Project selector, Add/Manage dialog, dedicated form/detail pages, and lifecycle messages.
- Reused the existing Project Type resolver and project-link context; did not rename the entity, URLs, services, types, or database columns.
- Preserved global Administration and non-PSM/PSAIM Discipline wording.
- Created no migration and changed no project or master data.
- TypeScript, full-source ESLint, production build, and diff checks passed.
- Authenticated PSM/PSAIM and non-PSM runtime comparison remains pending; status is `Fixed but runtime-unverified`.

### 2026-08-17 — P3 project-specific Department/System descriptions

- Confirmed the existing project-link model had no Department/System project-description round-trip, forcing users toward the shared master description.
- Created and applied additive migration `20260817000002_project_scope_descriptions.sql`, adding only nullable `public.project_departments.project_description`.
- Extended the existing System assignment JSON with an optional project description and preserved it during System reselection.
- Added Project Setup fields, schema/service round-trip, and Project Details fallback to master descriptions.
- Confirmed all 47 local migrations align with the linked remote database after deployment.
- TypeScript, targeted and full-source ESLint, production build, and diff checks passed.
- Authenticated save/reload and cross-project isolation checks remain pending; status is `Fixed but runtime-unverified`.

### 2026-08-17 — P4 Department Manager project context

- Confirmed the database and assignment rules already store Department Manager per Project/Department in `project_contacts`; no migration was needed.
- Replaced the manager's plain Select with searchable `ManagedPersonSelect`, scoped to the active Department and non-clearable.
- Removed the editable legacy free-text lead from the active Departments setup UI while preserving its stored data.
- Updated Project summaries to display the structured manager and clarified the global master field as `Default Department Lead (master)`.
- Reused the existing one-manager and manager-change preservation rules without modification.
- TypeScript, targeted and full-source ESLint, production build, and diff checks passed.
- Authenticated cross-project manager save/reload remains pending; status is `Fixed but runtime-unverified`.

### 2026-08-17 — P5 reusable selector UX

- Confirmed the Project-facing Client, Phase, Department, System, Program & Study, and People selectors already followed the searchable managed-data pattern.
- Replaced the remaining native master-form ReferenceSelect with the existing ManagedSelect.
- Added searchable Add/Manage UX to Managed Job Title, Department, and dependent System fields without changing their meaning.
- Preserved Department/System dependent filtering and invalid-selection clearing.
- Created no migration and changed no data.
- TypeScript, targeted and full-source ESLint, production build, and diff checks passed.
- Authenticated interaction checks remain pending; status is `Fixed but runtime-unverified`.

### 2026-08-17 — P6 Contacts state preservation through Add Contact

- Confirmed the direct Add Contact link could abandon unsaved Project team changes and did not preserve the active Program & Study on return.
- Added a shared pre-navigation save contract to the Contacts editor and connected it to the existing Project Setup and Project Info Workspace save paths.
- Added a validated `disciplineId` return parameter so the same linked Program & Study is restored after the Contact form.
- Kept the user on the Contacts page when validation, hydration protection, or persistence prevents a successful save.
- Created no migration and changed no stored project data during implementation.
- TypeScript, targeted and full-source ESLint, isolated production build, and diff checks passed.
- Authenticated create/cancel/return and persistence checks remain pending; status is `Fixed but runtime-unverified`.

### 2026-08-17 — P7 explicit Add Person Department context

- Confirmed Add Person carried only a Program & Study parent and re-derived its Department from a lazily hydrated synchronous cache.
- Added an explicit Department to the existing project-link context and sent it from Project Contacts.
- Used that value only as the create-form prefill and originating project scope; an explicit user choice remains the Contact Department written to the database.
- Preserved backward-compatible parent lookup for older entry links and preserved Contact edit behavior.
- Created no migration and changed no stored data during implementation.
- TypeScript, targeted and full-source ESLint, isolated production build, and diff checks passed.
- Authenticated prefill/override/save/return database checks remain pending; status is `Fixed but runtime-unverified`.

### 2026-08-17 — P8 cross-Department Project scope assignment

- Confirmed `contacts.department_id` and `project_contacts.department_id` are separate facts and the existing scoped uniqueness constraint permits one Person across multiple assignments.
- Confirmed assignment/reporting validation already uses the Project assignment Department and does not move the Person's home Department.
- Removed the home-Department filter from Team Members only; Department Manager eligibility remains Department-specific.
- Added searchable home-Department metadata and explicit cross-Department labels in the selector and Project Team summary.
- Reused the existing assignment model and created no migration or stored-data change.
- TypeScript, targeted and full-source ESLint, isolated production build, and diff checks passed.
- Authenticated multi-scope save/reload and row-count verification remain pending; status is `Fixed but runtime-unverified`.

### 2026-08-17 — P9 Weekly delegation date validation

- Confirmed new and persisted delegations can be distinguished by the existing optional `id`.
- Added a shared date validator used by both the save guard and the delegation card.
- Required new delegations to start today or later while preserving historical dates on persisted rows.
- Kept End Date user-controlled, set its dynamic minimum from Start Date, and clear it when Start moves beyond it.
- Added immediate card-level validation feedback and accessible invalid state.
- Created no migration and changed no stored delegation data during implementation.
- TypeScript, targeted and full-source ESLint, isolated production build, and diff checks passed.
- Authenticated date-input and save/reload verification remains pending; status is `Fixed but runtime-unverified`.

### 2026-08-17 — P10 deterministic Project Team display order

- Confirmed Project Review and several team summaries rendered insertion/database order rather than responsibility order.
- Added one shared presentation comparator: Department Manager, Team Member Lead, Team Member, then alphabetical name and stable Contact ID.
- Applied it consistently across Project Review, Contacts, Project Info, Project Edit summary, and project-scoped Contacts display.
- Sorted only copied/derived arrays; no role, reporting line, stored row, or database object changed.
- TypeScript, targeted and full-source ESLint, isolated production build, and diff checks passed.
- Authenticated cross-screen visual and persistence checks remain pending; status is `Fixed but runtime-unverified`.

### 2026-08-17 — P11 Client Short Name and Review resolution

- Confirmed Client Short Name was already a nullable, fully mapped field from the baseline schema; no migration was required.
- Clarified the form label as `Client Short Name / Acronym` without changing storage semantics.
- Replaced the Project Review and Project Details one-time synchronous Client lookup with a reactive Client-store subscription.
- Review now shows `Short Name — Full Name` with full-name fallback.
- Changed no Client or Project data during implementation.
- TypeScript, targeted and full-source ESLint, isolated production build, and diff checks passed.
- Authenticated short-name save/reload and fresh Review navigation remain pending; status is `Fixed but runtime-unverified`.

### 2026-08-17 — P12 multiple Project Sites/Locations

- Confirmed Project location was limited to scalar `projects.site/city/country` values and had no multi-Site entity or Primary-Site constraint.
- Created and applied additive migration `20260817000003_project_sites.sql` with project-scoped RLS, one-Primary uniqueness, stable Site IDs, and a legacy-location backfill that does not modify existing Project rows.
- Kept the existing location fields as the Primary-Site compatibility path for current consumers.
- Added Project Info controls for additional Sites, removal, and changing the Primary Site; extended type, validation, mapping, persistence, and Project Details presentation.
- Confirmed targeted and full ESLint, TypeScript, isolated production build, diff check, migration dry run, deployment, and local/remote migration alignment.
- Authenticated Site CRUD/reload and role-denial checks remain pending; status is `Fixed but runtime-unverified`; only downstream Site attribution is `Backend/Foundation only`.
- Site-level reporting attribution remains Open and no reporting module was changed.

### 2026-08-17 — P13 official Project Reference Documents

- Confirmed Project Documents and the generic attachment service were placeholders with no database or Storage persistence.
- Created and applied additive migration `20260817000004_project_reference_documents.sql` for revision-aware metadata, a private 25 MB Storage bucket, uploader snapshots, and Project-scoped metadata/object RLS.
- Added Project Overview and dedicated Reference Documents UI for multi-file uploads, categories, metadata, revision statuses, retained superseded rows, secure signed URLs, an embedded PDF/image viewer, and Open Original File.
- Left the generic attachment service, global Documents placeholder, and all reporting modules unchanged.
- Targeted/full ESLint, TypeScript, isolated production build, diff check, migration dry run, migration deployment, and local/remote alignment passed.
- Authenticated upload/view/status/reload and role-denial checks remain pending; Project Documents and the generic PDF/image viewer are `Fixed but runtime-unverified`. Primavera integration and a dedicated semantic Scope viewer remain `Open`.

### 2026-08-17 — P14 Client Representative contact auto-resolution

- Confirmed Client Representative and Project contact snapshot fields persisted independently with no UI mapping.
- Added Contact-store resolution on Client Representative selection and copied name/email/phone only into blank or previously derived fields.
- Preserved explicit Project-level overrides and retained values when the representative is cleared.
- Added a manual fill-empty action for existing Projects with a preselected representative.
- Created no migration and changed no stored Contact or Project data during implementation.
- TypeScript, targeted/full ESLint, isolated production build, and diff checks passed.
- Authenticated selection/save/reload and override-preservation checks remain pending; status is `Fixed but runtime-unverified`.

### 2026-08-17 — P15 Project Setup Review clarity

- Confirmed the Client resolver and responsibility ordering were already corrected in P11 and P10, and the existing Summary counters were de-duplicated derivations.
- Replaced the flat Department-level Program & Study list with explicit Department → System → Programs & Studies nesting.
- Preserved and visibly flagged legacy links lacking a valid System relationship.
- Added Home Department context for explicit cross-Department Project assignments without changing Contact or assignment data.
- Created no migration and changed no stored data.
- TypeScript, targeted/full ESLint, isolated production build, and diff checks passed.
- Authenticated hierarchy/count/order/home-Department checks remain pending; status is `Fixed but runtime-unverified`.

### 2026-08-17 — P16 Project Branding and QR reference check

- Confirmed EPROM/company and Client logos were already stored separately, but the Project-side company label was ambiguous.
- Relabelled the company field `EPROM / Company Logo`, retained `Client Logo`, and clarified the section description.
- Clarified that the QR field is a preference only and requires a real published report/revision destination supplied outside Project Setup.
- Confirmed and retained Prepared / Reviewed / Approved signature wording.
- Created no migration and changed no stored configuration or report output.
- TypeScript, targeted/full ESLint, isolated production build, and diff checks passed.
- Authenticated visual/save checks remain pending; the real QR publication destination remains downstream Open work.

### 2026-08-17 — P17 final Project Setup regression attempt

- Re-ran final TypeScript, full ESLint, isolated production build, migration alignment, route-response, RLS-source, and key Project Setup implementation checks.
- Confirmed all six setup routes respond through the expected auth redirect and do not return 404.
- Confirmed migrations align through `20260817000004` and no active migration disables RLS.
- The connected in-app browser has no authenticated EPROM session and no external browser extension session is connected, so persistence, 100% completion, Finish Setup, role-denial, and `PSM-00-02` hosted-data checks remain pending.
- Created no migration and changed no application or database data during P17.
- Status remains `In Progress`; it is deliberately not marked `Verified`.

### 2026-08-17 — Documentation-only implementation-state audit

- Re-read the current Project Setup, Project form/details, Client master-data, assignment-ordering, Project Documents, service, type, and migration files without modifying application code or the database.
- Replaced the ambiguous `Fixed` classification with the explicit `Fixed but runtime-unverified` category for UI-connected implementations that still lack authenticated save/reload evidence.
- Confirmed Multiple Project Sites is not schema-only: its controls are mounted in the Project form used by Project Setup/Edit and its values are presented in Project Details. Runtime Site CRUD/RLS remains unverified; downstream report attribution is `Backend/Foundation only`.
- Confirmed Client Short Name/Acronym is exposed by the current Client master-data form configuration and resolved in Project Review/Details, but authenticated persistence remains unverified.
- Confirmed QRA/FERA grouping has the exact Department-plus-System source predicate, but the hosted records and rendered options remain runtime-unverified.
- Confirmed Department Manager-first ordering is wired into current Review and Project-team summaries through the shared comparator, but real-data visual confirmation remains unverified.
- Confirmed Official Project Documents and the generic PDF/image modal viewer are mounted in the current Project UI. They remain runtime-unverified; Primavera integration and a dedicated semantic Scope viewer do not exist and are `Open`.
- Recorded all four applied Project migrations and the features that must not be reverted.
- Made no code, schema, policy, migration, Storage, or project-data change during this audit.

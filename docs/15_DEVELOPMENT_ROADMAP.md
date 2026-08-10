# Development Roadmap

## How to use this roadmap

Complete one phase at a time. After each phase, review the browser result, run validation, and record what changed. Do not let Claude Code start the next phase automatically.

This file is the single source of truth for **where the project actually is**. Update the status table below at the end of every phase.

---

## Status at a glance

Last verified: **2026-08-10** (lint, type-check, and production build all green;
the Weekly workspace exercised in the browser against the live Supabase project
— department and scope-item rows read back, and one scope-item update saved,
reloaded, and restored).

| # | Phase | Status |
|---|---|---|
| 0 | Documentation and audit | ✅ Complete |
| 1 | Existing foundation | ✅ Complete |
| 2 | Project master data | ✅ Complete |
| 2A | Organization Chart *(added — see note)* | ✅ Complete |
| 2B | Configurable hierarchy and scoped assignments *(added — see note)* | ✅ Complete |
| 3 | Data foundation | ✅ Complete — all 32 migrations applied |
| 4 | Weekly Workspace UI | ⚠️ Partial (~80%) — workspace rendered down to the scope-item level |
| 5 | Weekly data and department submission | ⚠️ Partial — department ownership now enforced in the UI |
| 6 | Comments and collaboration | ⚠️ Partial |
| 7 | Workflow, permissions, notifications | ❌ Config only, nothing enforced |
| 8 | Excel exchange | ❌ Not started |
| 9 | Monthly Reports | ❌ **Not started** |
| 10 | Executive reporting | ❌ **Not started** |
| 11 | A4/PDF output | ❌ Not started |
| 12 | Hardening and future integrations | ❌ Not started |

**Current phase: 4 (Weekly Workspace), in progress. Next increment: Look Ahead
and milestones — the remaining Phase 4 sections are listed in order under
Phase 4 below.**

The two standing facts that used to gate every estimate below are **no longer true** and are recorded here so the change is visible rather than silently edited away:

- **The database is provisioned and current.** All 32 migrations are applied to the remote Supabase project via the CLI. The application runs on real data; the in-memory mock service is now only the fallback for an unconfigured environment. *(Was: "no database has ever been provisioned … all 13 migrations are unexecuted SQL.")*
- **Version control history exists** — 17 commits, with `4fe5dae` as the pre-release stabilization checkpoint. A verified restore path also exists: `EPR_Full_Backup_2026-08-09.dump` and `EPR_Schema_Backup_2026-08-09.sql`, the former checked with `pg_restore -l`. *(Was: "`.git` exists but is empty. There is no way to revert a bad change.")*

Docker is still not installed, so `supabase db dump` is unavailable locally; backups are taken outside the CLI.

### A note on phase numbering

Earlier sessions used ad-hoc labels — `5A`, `5B`, `5C`, `6A.1`–`6A.4`, `OC-1`–`OC-6` — that do **not** correspond to the phases here. That mismatch caused real confusion (an "OC-2" request meant one thing to the requester and another in the code). Those labels are retired. Use the numbers in this file only.

Phase 2A did not exist in the original plan. The Organization Chart was built across six sessions and is substantial and working, so it is recorded here rather than left undocumented.

Phase 2B is recorded on the same basis. It covers work that was not in the
original plan but is now load-bearing for Weekly:

- **Hierarchy terminology is project-type driven, not global.** PSM/PSAIM
  projects say "Programs & Studies"; every other project type says
  "Disciplines". Resolved at render time by `hierarchyTermsFor()` in
  `src/config/project-terminology.ts`. Global Administration keeps the entity
  name and must not bend to one project type.
- **Business names are database records, not code.** Departments, Systems and
  the level below are admin-managed through the existing master-data screens.
  No department, system, program or study name is hardcoded.
- **Moving a record is atomic.** `public.move_discipline_system()` applies the
  whole edit — name, code, description, Department, System — and synchronizes
  every `project_disciplines` link and every scoped `project_contacts` row in
  one transaction. It validates the target against each affected project and
  refuses the entire move, naming the conflicts, rather than half-applying.
- **A person may hold many scoped assignments,** each with its own Assignment
  Role. `assignedScopeItems()` resolves user → project → department → scope
  item(s) → role, which is the lookup Phase 4 needs to scope Weekly per user.

---

## Phase 0 — Documentation and audit ✅

- Read this pack and inspect the existing application.
- Confirm current routes, components, database state, and unfinished work.
- Resolve contradictions before implementation.

**Done when:** the team can name the current phase and the next phase without guessing.

**Outcome:** audit completed 2026-07-25. Documentation consolidated to the repository root; the duplicate set under `eprp/docs/` was merged into `docs/engineering/`.

---

## Phase 1 — Existing foundation ✅

Preserve or complete the existing project foundation, design system, sidebar, layout, and routes.

**Done when:** the app builds and existing pages remain stable.

**Delivered:** Next.js 16 App Router + React 19 + TypeScript strict + Tailwind v4 + shadcn/ui. EPROM-branded shell (navy sidebar with logo, top bar, breadcrumbs, mobile sheet, icon-rail collapse). 13 shared components with a `/design-system` reference page. Executive Dashboard with 6 KPI tiles, 5 Recharts charts, insight cards, and HSE/quality stats.

**Known gap:** the dashboard imports `data/mock` directly instead of going through the service layer, so it will not pick up real data when the database connects. Fix during Phase 3.

---

## Phase 2 — Project master data ✅

Projects, clients, project types, phases, departments, systems, disciplines, contacts, responsibilities, and safe archive/delete behavior. Dropdowns must be admin-managed, not hardcoded.

**Done when:** a project can be created/edited with linked master data and validation.

**Delivered:**

- Full CRUD for Clients, Project Types, Phases, Departments, Systems, Disciplines, and Contacts, each with list/detail/new/edit routes.
- Every dropdown is admin-managed; none are hardcoded.
- Safe archive/deactivate with reference checks.
- 6-step project creation wizard, guided setup flow, and a 13-section project workspace.
- Responsibility fields store contact IDs, not names.
- Zod validation with Save Draft versus Final Submission rules.

---

## Phase 2A — Organization Chart ✅ *(added to plan retrospectively)*

Project-scoped reporting structure, listed under "Main modules" in `01_PROJECT_VISION.md` but absent from the original phase list.

**Delivered:**

- Relational hierarchy (`parentPositionId` + `sortOrder`); no canvas coordinates are stored, and layout is always derived.
- Pan/zoom canvas with minimap, collapse/expand, and drag-and-drop re-parenting with circular-hierarchy rejection.
- Position editor with 14 fields, vacancy as a first-class state, and assignment history.
- Five starting templates (EPC, EPCM, Construction, Turnaround, Blank) with preview and overwrite confirmation.
- Four-step Excel import (Upload → Mapping → Validation → Preview) using `xlsx`, with duplicate/missing-parent/cycle detection.
- Chart management: rename, description, type, effective date, status, archive.
- Six-state review lifecycle (Draft → In Progress → Under Review → Approved → Locked, plus Archived) with read-only locking and Create New Revision.

**Known gap:** the mock service enforces locking with nine explicit guards, but the Supabase service relies solely on a database trigger that has never run. Verify during Phase 3.

---

## Phase 3 — Data foundation ⚠️ PARTIAL — **current phase**

Connect the existing application to the chosen database/storage architecture. Add migrations, typed data access, seed data, authorization foundation, and loading/error handling.

**Done when:** master data persists after reload and access is protected.

**Written but not executed:**

- 13 migrations covering 17 tables, with composite foreign keys, partial unique indexes, check constraints, and a chart-locking trigger.
- Row Level Security enabled on all 17 tables.
- Typed row definitions and browser/server Supabase clients.
- Three gated services (`project`, `weekly-report`, `organization-chart`) at full method parity with their mock counterparts, switching on `isSupabaseConfigured()`.
- `.env.example` with public keys separated from the server-only service-role key.

**Not done — this is what blocks the phase:**

- No Supabase project or local Postgres exists. `supabase db push` has never succeeded.
- Therefore no migration, RLS policy, constraint, or trigger has been verified. Migration `…0003` rewrites existing status data and drops an index; if it fails partway, recovery is manual.
- RLS policies are `using (true) with check (true)` — the intended temporary Admin CRUD, but they grant every authenticated user full access to all 17 tables. **These must not reach production.**
- No seed data script has been run.
- The dashboard still bypasses the service layer.

**To finish:** provision a database (Docker + `supabase start`, or link a hosted project) → `supabase db push` → populate `.env.local` → re-verify Projects, Weekly, and Organization Chart against real persistence → point the dashboard at services.

---

## Phase 4 — Weekly Workspace UI ⚠️ PARTIAL (~80%)

Implement the Weekly design as a project workspace: header, workflow, KPIs, summary, activities, department updates, risks/issues, Next Week Plan, Look Ahead, comments, attachments, approval, and history.

**Done when:** the complete Weekly experience is usable with typed data and matches the approved references.

**Delivered:** report header with project linkage, workflow status display, progress and KPI section with auto-calculated variance and SPI, department updates with discipline auto-linking, narrative entries (key comments, risks, issues, actions) with priority/status/owner/due date and an `includeInMonthly` flag, submission status by department, and detail plus preview views.

**Added in the Weekly workspace pass:** the detail route now renders the real
workspace — a professional document header (project, code, client, week,
period, lifecycle status, prepared by, last updated), a Project Progress
summary (planned / actual / variance / health / Executive Summary), and a
Project → Departments panel where every department assigned to the project
appears as a collapsible section with its derived completion state, a
missing-input flag, and an editable or read-only **General Department Update**.
Viewer scope is resolved on the server and passed down as props, so the client
never re-derives authority.

**Added in the scope-item pass:** each department now opens onto the level
below it — the **Programs & Studies** (PSM/PSAIM) or **Disciplines** (every
other project type) the project put in that department, named from the project
type by `hierarchyTermsFor()`. The list is the project's own scope, not the
submissions, so an item nobody has filled in still appears and reads "Not
reported"; each row carries its System, its status and progress, and expands
to the same update form the department level uses. The viewer's scope filters
the expected items exactly as it filters the submitted ones, so a scoped member
never learns what else exists. An item whose scope has since left the project
keeps its row, read-only, rather than dropping the history.

One save path serves both levels: `saveDepartmentUpdate` writes the single row
identified by (report, department, scope item) — the same triple the
`weekly_submissions` unique index enforces — matching on that key rather than
on a client-held id, so a repeated save updates in place instead of inserting a
second row, and a stale id cannot steer a write onto another department's or
another item's input. No migration was needed: the table, its unique index, and
the scoped RLS policies already cover the scope-item level.

**Still missing, from `archive/reporting-architecture-v1.md` §3:**

- Look Ahead (next week, 2 weeks, 4 weeks, month, quarter)
- Documents and attachments
- Approval actions
- History / audit trail

---

## Phase 5 — Weekly data and department submission ⚠️ PARTIAL

Create Weekly records, department submissions, project-scoped filtering, department ownership, save draft, submit, return, and resubmit.

**Done when:** each department can submit only its authorized section and Project Control can track all submissions.

**Delivered:** weekly records with department submissions, project-scoped
filtering, submission status tracking, and save-draft behaviour.

Department *ownership* now reaches the screen: the workspace resolves the
signed-in viewer's scope on the server and renders only the departments that
scope covers — every department for Project Control and administrators, the
managed department for a Department Manager, the assigned scope for a member,
and nothing for someone with no assignment on the project. Departments outside
the viewer's access are acknowledged by count and never by content.

Saving is scoped to match: `saveDepartmentUpdate` writes one department's
NULL-scope row in place, so a repeated save cannot duplicate it and one
department's save cannot touch another's. The whole-report replace-all save
remains only on the report edit form, where replacing everything is what the
user asked for.

**The Weekly scoping is now a security boundary, not just a rendering rule.**
`20260810000002_weekly_rls.sql` replaced the blanket `using (true)` policies on
the four Weekly tables with the same predicates the resolver applies, and
`20260810000004_weekly_entry_scope_rls.sql` closed the last gap: the
`weekly_entries` policies were passing a literal NULL as the scope item, so a
scoped member could read and write another member's Program & Study /
Discipline entries in the same department. They now pass `discipline_id` —
policy change only, no schema change, since the column has existed since
`20260719000007`. Verified at database level as the `authenticated` role: 19
assertions across scoped member, multi-scope member, Department Manager,
Project Control, System Administrator and an unassigned user, including
cross-department, cross-project and direct-write attempts.

**Missing:** return-with-reason and resubmit. The blanket `using (true)`
policies still stand on the **non-Weekly** tables — see Phase 12.

---

## Phase 6 — Comments and collaboration ⚠️ PARTIAL

Add unlimited local threads, free-text comments, replies, mentions, attachments, resolve/reopen, Executive flag, Include in Monthly, and the persistent Comment Register with history and carry-forward.

**Done when:** a comment can persist from Weekly to later reports without overwriting its original history.

**Delivered:** flat narrative entries with category, priority, status, owner, due date, and an `includeInMonthly` flag.

**Missing:** threads, replies, mentions, attachments, resolve/reopen, the Executive flag, and the entire **Comment Register** — the persistent cross-report master record with history and carry-forward described in `archive/reporting-architecture-v1.md` §6. Phase 9 depends on this: Monthly compilation needs carried-forward comments.

---

## Phase 7 — Workflow, permissions, notifications ❌ CONFIG ONLY

Implement lifecycle transitions, role-based access/RLS, secure links, email notifications, reminders, return reasons, and audit history.

**Done when:** the system enforces who can see, edit, review, approve, finalize, and lock each report.

**Exists:** `config/workflows.ts` (transition rules) and `config/permissions.ts` (**9 roles** × 18 permissions), both documented in `engineering/`. Phase **A1** added the `profiles` table, the nine-role foundation, and `current_user_role()` for future policies.

**Authentication sub-phases:** A1 profiles + roles ✅ · A2 login, session, middleware, logout ❌ · A3 real identity in the shell ❌ · A4 admin user management ❌ (deferred).

**Nothing is enforced yet.** `hasPermission()` is called by zero components, and every table still carries the temporary `for all to authenticated` policy — which is why the anon key cannot write. One specification gap remains for this phase: `04_WORKFLOW_ENGINE.md` §6 describes Reviewer as *recommending* approval, while `reviewer` currently holds `approve_weekly` / `approve_monthly` outright.

---

## Phase 8 — Excel exchange ❌ NOT STARTED

Generate a protected workbook per project/department/period, prefill authorized data and open comments, validate uploads, preview changes, detect duplicates, and import only approved rows.

**Done when:** Excel is a safe exception path, not a second uncontrolled database.

**Note:** `xlsx` is installed and a four-step import wizard exists, but it imports **organization charts only**. The department workbook exchange is untouched; `import-service.ts` is five stubs and `/weekly-reports/import` is a placeholder. The org-chart wizard is a reusable pattern for this phase.

---

## Phase 9 — Monthly Reports ❌ NOT STARTED

Compile finalized Weeklies, selected/carry-forward comments, progress trends, achievements, risks, issues, HSE, quality, actions, and Look Ahead. Allow unlimited new Monthly comments and Monthly-specific editing.

**Done when:** a Monthly Draft can be generated, reviewed, approved, finalized, locked, and traced back to its Weeklies.

**Current state:** all six routes are placeholders, `features/monthly-reports/` is empty, `monthly-report-service.ts` is seven stubs, and **no `monthly_reports` table exists in any migration**.

**Do not start before Phases 3, 4, and 6 are complete.** Monthly compiles from approved Weeklies and carried-forward comments; building it on an incomplete Weekly (no Executive Summary, no Major Activities, no Look Ahead) and a missing Comment Register would mean compiling from sources that do not yet hold the data.

---

## Phase 10 — Executive reporting ❌ NOT STARTED

Build project and portfolio Executive Reports, executive comments, KPIs, health status, trends, risks, actions, decisions, and the company-president view across all projects.

**Done when:** leadership can understand portfolio health without opening raw department submissions.

**Current state:** all five routes are placeholders, `features/executive-reports/` is empty, `executive-report-service.ts` is five stubs, and no `executive_reports` table exists. The Executive Dashboard at `/dashboard` is a mock-data view, not this report.

Depends on Phase 9 and on the Executive comment flag from Phase 6.

---

## Phase 11 — A4/PDF output ❌ NOT STARTED

Create print views and PDF export for Weekly, Monthly, Project Executive, and Portfolio Executive reports. Include logos, compact charts, selected comments, decisions, sign-offs, and page metadata.

**Done when:** the one-page Executive output is readable and print-safe.

**Current state:** `export-service.ts` is two stubs; there are no print views or print CSS. Requirements are detailed in `12_REPORT_GENERATION.md` §7.

---

## Phase 12 — Hardening and future integrations ❌ NOT STARTED

Add DOCX output, branding management, signatures, QR codes, advanced audit/revision tools, Primavera/Power BI integrations, performance improvements, and final user documentation.

**Done when:** production readiness is assessed and future integrations are explicitly scoped.

**Carry into this phase:**

- Replace the temporary `using (true)` RLS policies with real per-role rules on
  the **non-Weekly** tables. The four Weekly tables are done — see Phase 5.
- `xlsx@0.18.5` carries a high-severity advisory with no registry fix available; `next@16.2.10` has one fixed in 16.2.11. Eight advisories total (5 high, 3 moderate).
- There is no test runner. Assertions written for the tree helpers, chart templates, locking rules, and the Excel importer (87 in total, all passing) live in a scratch directory outside the repository and are lost between sessions. They should be moved into `eprp/src` under a real runner.

---

## Standard phase prompt

Use this short instruction before a phase:

```text
Read CLAUDE.md and all documents under docs/.
Inspect the existing implementation before changing it.
Implement only [PHASE NAME].
Preserve existing validated UI and behavior; do not modify unrelated modules.
Run lint, type-check, and production build.
Report changed files, completed requirements, deferred items, and remaining issues.
Stop after this phase.
```

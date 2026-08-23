# Development Roadmap

## How to use this roadmap

Complete one phase at a time. After each phase, review the browser result, run validation, and record what changed. Do not let Claude Code start the next phase automatically.

This file is the single source of truth for **where the project actually is**. Update the status table below at the end of every phase.

**What the project must become** is governed by
[`02_PLATFORM_ARCHITECTURE.md` §24](02_PLATFORM_ARCHITECTURE.md#24-locked-decisions--p0-architecture-review-2026-08-20)
— the decisions locked at the P0 architecture review of 2026-08-20. Read §24
before planning any phase from here on. This roadmap records delivery status;
it does not restate architecture, and where the two appear to differ, §24
governs.

---

## Status at a glance

Last verified: **2026-08-11** (lint, type-check, and production build all green;
98 assertions over the pure Weekly derivation, terminology, scope and lifecycle
modules all passing; the Weekly workspace, Edit form and Preview exercised in
the browser against the live Supabase project — a scope-item update and a
Required Action with a scoped owner saved by one press, reloaded, and restored,
and a lifecycle transition correctly refused).

| # | Phase | Status |
|---|---|---|
| 0 | Documentation and audit | ✅ Complete |
| 1 | Existing foundation | ✅ Complete |
| 2 | Project master data | ✅ Complete |
| 2A | Organization Chart *(added — see note)* | ✅ Complete |
| 2B | Configurable hierarchy and scoped assignments *(added — see note)* | ✅ Complete |
| 3 | Data foundation | ✅ Complete — all 47 migrations applied |
| 4 | Weekly Workspace UI | ⚠️ Partial (~95%) — final Weekly UX, multiple authored updates, insights, plans and print delivered; attachments/history outstanding |
| 5 | Weekly data and department submission | ⚠️ Partial — department ownership now enforced in the UI |
| 6 | Comments and collaboration | ⚠️ Partial |
| 7 | Workflow, permissions, notifications | ❌ Config only, nothing enforced |
| 8 | Excel exchange | ❌ Not started |
| 9 | Monthly Reports | ⚠️ Partial — schema, RLS, service and full Monthly UX (register, create, document, workspace, analytics, A4 print) delivered; see note |
| 10 | Executive reporting | ✅ Delivered — live derived Portfolio Executive view, drill-down, A4 landscape output, persisted `executive_reports` record, in-report Edit Mode and snapshot-based signatories |
| 10a | Control Center + Calendar | ⚠️ Partial — Dashboard rebuilt on real data (mock removed), regrouped sidebar with notched active indicator, and a project-scoped Calendar (`project_events`) with Day/Week/Month/Agenda and full CRUD. Attachments on events are NOT implemented: the platform has no attachment storage at all (`attachment-service.ts` is `notImplemented`, no table, no bucket) |
| 11 | A4/PDF output | ⚠️ Partial — dedicated Weekly A4 preview/print delivered; other report types remain untouched |
| 12 | Hardening and future integrations | ❌ Not started |
| 13 | Master Planning & Control *(added — see note)* | ⚠️ In progress — **13.1 & 13.2 CLOSED**, **13.3 implemented** (verified in UI), **13.2c + 13.2d implemented** (verified on the local rehearsal database); 13.4–13.7 not started |

**Current phase: P0 — architecture-review blockers.** Scope, ordering and the
locked decisions behind it are in
[`02_PLATFORM_ARCHITECTURE.md` §24](02_PLATFORM_ARCHITECTURE.md#24-locked-decisions--p0-architecture-review-2026-08-20).
Phase 4's remaining items (attachments, history) and Phase 11 resume after P0.

### P0 status

**Runtime-validated 2026-08-20 against an isolated local database. 39/39 checks
pass. Still NOT deployed to the hosted project.**

| # | Item | Implementation | Static / build | Runtime validation | Deployed |
|---|---|---|:-:|:-:|:-:|
| P0.5 | Migration replay correction | ✅ Complete | ✅ PASS | ✅ **Replay executed — 61/61 migrations** | n/a |
| P0.6 | One canonical consolidator rule | ✅ Complete | ✅ PASS | ✅ **9/9 PASS** | ✅ **WAVE 1 — deployed 2026-08-21** |
| P0.1 | Close escalation on `projects` / `project_contacts` | ✅ Complete | ✅ PASS | ✅ **9/9 PASS** | ✅ **WAVE 1 — deployed 2026-08-21** |
| P0.2 | Platform-wide read policy (Tier A / Tier B) | ✅ Complete | ✅ PASS | ✅ **7/7 PASS** | ✅ **WAVE 1 — deployed 2026-08-21** |
| P0.3 | Server-side Weekly/Monthly lifecycle enforcement | ✅ Complete | ✅ PASS | ✅ **8/8 PASS** | ✅ **WAVE 2 — deployed 2026-08-21** |
| P0.4 | Monthly compiles approved Weekly data only | ✅ Complete | ✅ PASS | ✅ **6/6 PASS** | ✅ **WAVE 2 — deployed 2026-08-21** |
| — | Corrective: archive from every live state (`20260822000001`) | ✅ Complete | ✅ PASS | ✅ **17/17 states** | ✅ **deployed 2026-08-22** |

**The environment (P1.0).** An isolated local Supabase stack under Docker —
containerised Postgres 17.6, matching the hosted project's 17.6.1.147. Rebuilt
from empty with `supabase db reset` (local only; never `--linked`,
`--project-ref` or `--db-url`). Two local-only identities are created by
`scripts/p0-validation/00_local_test_identity.sql`, including the **second,
non-admin** identity the negative permission paths are proved with. The hosted
database was not connected to at any point.

**Reproduce the whole thing** from `eprp/`:

1. `npx supabase start`
2. `npx supabase db reset`
3. `00_local_test_identity.sql` → `01_setup_test_fixtures.sql` → `02`…`06`
4. `99_teardown_test_fixtures.sql` when finished

**Three defects were found by runtime validation that static analysis had
missed** — recorded because they are the argument for never accepting
"statically verified" as finished:

1. **`weekly_transition_blockers()` crashed** on the reviewer and
   no-submissions branches. `text[] || 'literal'` resolves the untyped literal
   as an array and raises *malformed array literal*; only the `format()` branch
   was typed enough to work. Fixed with `array_append`.
2. **The migration set never grants table privileges.** The hosted platform
   grants DML on `public` to `anon`/`authenticated`; nothing in the repository
   does. A database built from migrations alone is unusable — every query fails
   with *permission denied* before any policy is consulted. Applied locally by
   the bootstrap script; **a portability gap that still has no home in the
   migration set.**
3. **Ten migrations could not replay onto an empty database** — one unconditional
   data-cleanup guard and nine lockout pre-checks. All are now
   fresh-environment aware: each refuses only when the thing it protects
   actually exists.

**DRESS REHEARSAL against the restored production schema, 2026-08-21.** The
six migrations were applied to a local database restored from a production
schema dump (no data), with an active system_admin seeded so the lockout
pre-checks took production's branch rather than the empty-database branch. Two
full cycles: 6/6 migrations applied, 39/39 validation checks passed, rollback
returned the database to exactly the pristine restore (96 policies, 34
functions), and the whole cycle reproduced identically.

**The rehearsal caught a defect that would have FAILED the deployment.**
`20260820000005` revoked EXECUTE on its two controlled writers from PUBLIC only.
This project carries `alter default privileges ... grant execute on functions to
anon`, so each new function ALSO received a DIRECT anon grant, which a PUBLIC
revoke does not remove. The migration's own post-check refused to complete —
correctly. It passed on a plain local stack, which lacks that default privilege,
and failed the moment it met production's actual privilege configuration. Fixed
by revoking from `anon` explicitly. This is the exact mirror of the defect
`20260729000002` recorded, and half of that lesson had been applied.

**PRE-FLIGHT PASSED against production, 2026-08-21 — 7/7 gates.** Observed:
0 P0 migrations applied · 1 active system administrator · full DML grants on all
8 probed tables, which settles §3.10 for P0 · **0 accounts gain manage rights
from P0.6** · 96 policies / 17 unconditionally open, reconciled as 14 known P1
residue + 2 closed by P0.1 + 1 by P0.2 · no portfolio Executive notes, so the one
non-additive change in P0 affects nothing. Production untouched throughout —
read-only SELECTs run by the owner in the SQL Editor.

**Owner decision, 2026-08-21.** Pre-flight found 4 Monthly comments compiled from
a never-approved Weekly, which P0.2 would publish platform-wide. Accepted **as
test data**, not a P0 blocker, and the dataset is retained because it is what
makes functional and runtime validation possible. This creates a **mandatory
Pre-Handover Data Reset** — recorded as
[`02_PLATFORM_ARCHITECTURE.md` §25](02_PLATFORM_ARCHITECTURE.md#25-pre-handover-data-reset--mandatory-delivery-gate),
tracked as §22 row 2g. It is a delivery gate, not optional cleanup, and it must
**NOT** be performed now.

**The two P0 defects are now proven fixed, not merely believed fixed.** §3.8
(`acceptedCount` compared against a status that does not exist, so no Weekly
could ever be approved) is settled by checks **G6** and **G8**, which prove a
legitimate transition now succeeds — not merely that illegitimate ones fail.

The two standing facts that used to gate every estimate below are **no longer true** and are recorded here so the change is visible rather than silently edited away:

- **The database is provisioned and current.** All 47 migrations are applied to the remote Supabase project via the CLI. The application runs on real data; the in-memory mock service is now only the fallback for an unconfigured environment. *(Was: "no database has ever been provisioned … all 13 migrations are unexecuted SQL.")*
- **Version control history exists** — 17 commits, with `4fe5dae` as the pre-release stabilization checkpoint. A verified restore path also exists: `EPR_Full_Backup_2026-08-09.dump` and `EPR_Schema_Backup_2026-08-09.sql`, the former checked with `pg_restore -l`. *(Was: "`.git` exists but is empty. There is no way to revert a bad change.")*

Docker is still not installed, so `supabase db dump` is unavailable locally; backups are taken outside the CLI.

### A note on Phase 9 (Monthly Reports)

Phase 9 was recorded as "Not started" long after it had in fact been built. As
built it comprises four tables (`monthly_reports`, `monthly_comments`,
`monthly_department_summaries`, `monthly_plan_items`) with RLS and an authorship
trigger, a full CRUD service, and the Monthly register, create, document,
workspace, analytics and A4 print UI.

It is **Partial**, not Complete, for three reasons — all recorded in
`KNOWN_LIMITATIONS.md` §3.6–3.7:

1. ~~Migration `20260812000001` calls `weekly_can_access_scope()` with four
   arguments where only a three-argument function exists.~~ **Corrected by P0.5
   on 2026-08-20**; the migration set is replayable again by static analysis,
   though the replay itself has not been executed (no Docker, no `psql`).
2. HSE event counts and a next-month planned-% target have no column; the UI
   renders "Not recorded" rather than a placeholder value.
3. No Google Drive upload or admin-PIN approval exists, despite appearing in the
   Monthly design reference. Nothing in the platform implements either.

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
- **Department Managers are project-scoped assignments.** The active Project
  UI resolves them from `project_contacts` and `assignment_role`, not from the
  Department master's default lead. The searchable selector remains scoped to
  the active Department and manager changes preserve the project team.
- **Department and System descriptions can be project-specific.** Migration
  `20260817000002` adds a nullable description to each project/Department link;
  System overrides stay in the existing assignment JSON. Blank overrides fall
  back to the shared master description, so no master record is duplicated or
  renamed for one project.

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
- Project and master-data relationship selectors use one searchable managed
  pattern with Add/Manage actions, including Managed Job Title and dependent
  Department/System references; their underlying semantics are unchanged.
- Safe archive/deactivate with reference checks.
- 6-step project creation wizard, guided setup flow, and a 13-section project workspace.
- Responsibility fields store contact IDs, not names.
- Zod validation with Save Draft versus Final Submission rules.
- Contacts Add New saves dirty team assignments before leaving and returns to
  the same Program & Study; failed validation or persistence keeps the draft in
  place. Authenticated browser verification is still pending.
- Add Person now receives its originating Project Department explicitly instead
  of depending on a lazy Program & Study cache lookup. It is a prefill only:
  the user's final Department selection remains authoritative.
- One Directory Person can be selected explicitly as a Team Member for scope in
  another Department without changing or duplicating the Person. The picker and
  Project Team summary show the home Department; manager eligibility stays
  Department-specific. Runtime persistence verification is still pending.
- New Weekly delegations cannot start in the past; End Date follows Start Date
  and clears when Start moves beyond it. Persisted historical delegations remain
  readable and receive the same inline validation used by the save guard.
- Project Team summaries share one presentation-only order: Department Manager,
  Team Member Lead, Team Member, then alphabetical name. Stored assignments and
  reporting lines are unchanged.
- Client master data already carries an optional Short Name/Acronym. Project
  Review and Project Details now resolve Clients reactively and fall back to the
  full name; no schema or existing Client data changed.

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

**Weekly finalization pass (2026-08-11):** the route contract is explicit
(`/{id}` operational detail, `/{id}/workspace` editing, `/{id}/preview`
print-ready document); one shared EPROM/client/QR report identity header serves
all three views; each assigned scope item supports multiple separately
persisted Weekly Updates with immutable original authorship; Project Control
look-ahead and next-week baselines are separate from department input; previous
week continuity, derived alerts, and the Monthly tray are read from canonical
Weekly data without copying into another report path. Browser verification
covered all five Weekly routes, update/save, scoped owner candidates, previous
week present/missing cases, plan save, print controls, and horizontal overflow.

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

**Added in the final content and layout pass:** the workspace now reads as a
progress report rather than a dashboard — one linear document from the week's
progress, through the departments, to what the project needs.

- **One reading of the schedule variance.** Three threshold sets used to answer
  the same question on one screen, so a report could say On Track, print
  "Variance reads at risk" beside it, and show a Recommendation of On Schedule.
  `progressSummary()` now interprets the variance once, by the documented §5
  thresholds, and the arithmetic is remarked on only when it genuinely
  disagrees with the recorded verdict — naming the figure when it does. The
  duplicate "Key Indicators" card is gone; SPI, HSE, Quality, man-hours and the
  submission count live beside the figures they qualify, and are omitted rather
  than shown as "—" when the report does not record them.
- **Department Overall Update**, renamed from "General Department Update",
  collapsed by default and marked Optional. It was open by default and took
  most of a screen, pushing the scope items — the actual weekly content — below
  the fold. It has never gated completion and now says so.
- **Compact department headers**: name and code, manager (from the project's own
  scoped assignments, never the master-data default lead), reported out of
  expected, outstanding count, missing-input flag, completion state.
- **One save per scope item.** The weekly update and the Required Action /
  Support rows are still two writes to two tables, unchanged, but one press
  performs both and each part is skipped when it is not dirty. Entry ids are
  folded back one row at a time, so a retry after a mid-way failure updates the
  rows that already landed instead of inserting twins of them.
- **Project-level Critical Issues / Risks and Required Decisions / Management
  Support**, derived from the existing `weekly_entries` rows — risks and issues
  for the first, `escalation` category for the second. No new table, no new
  form. A scope item's Required Action rows are `action` + `general` and match
  neither, so nothing is reported twice.
- **Next Week Lookahead**, gathered from the `nextWeekPlan` already recorded on
  each department and scope item. Nothing is copied into a second field.
- **Report Information / Approval** as a compact strip: prepared, reviewed and
  approved by, created, last updated, source, lifecycle state. An unrecorded
  name reads "Not recorded" and is never filled in with the signed-in user.
- **`Include in Monthly`** keeps `weekly_entries.include_in_monthly` and now
  rolls up per scope item and per report. Monthly compilation is still Phase 9.
- **No horizontal overflow.** `SidebarInset` lacked `min-w-0`, so as a flex
  child its automatic minimum was its content's min-content width and one long
  unbreakable row pushed the whole document past the viewport. Shell-level fix,
  one property, applies to every route.

**Added in the Edit / Preview consistency pass:**

- **One editor for department input.** The report edit form carried a second
  "Department Updates" editor over the same `weekly_submissions` rows the
  workspace edits, and it saved through `saveSubmissions`, which DELETES every
  submission row on the report and re-inserts the form's set. A Save Draft
  therefore rewrote or deleted work done in the workspace and reissued every
  row id. The editor and that call are gone; the form now points at the
  workspace. **No stored data was removed** — the columns and rows are
  untouched and every existing value still renders.
- **`saveDepartmentUpdate` no longer nulls `health_status`.** It sent
  `health_status: null` on every save, so a workspace save silently cleared a
  verdict recorded through the old form — a write wiping a column its own form
  never showed. The key is now omitted unless the caller supplies one.
- **Project-type terminology reaches the Edit form and the Preview.** Both
  resolve `hierarchyTermsFor()` through the new `useHierarchyTerms` hook, which
  subscribes to the master-data store rather than reading it synchronously —
  the same lazy-hydration trap that made the old preview render raw UUIDs. A
  PSM/PSAIM project now says Programs & Studies in the scope selector, the
  activity and entry pickers, and every preview heading. `ManagedSelect` and
  `ManagedMultiSelect` gained `searchPlaceholder` / `optionsHeading` overrides
  so one string can be renamed per screen without renaming the kind.
- **Owner selection is scoped to the project.** The Required Action / Support
  owner offered every contact in master data; it now offers only the people the
  project assigned to that department, scope item first, via
  `DepartmentSection.eligiblePeople`. A scoped member sees only the people on
  their own items. Someone stored but since unassigned stays selectable and is
  marked, rather than being silently dropped.
- **The Preview consumes the canonical Weekly data.** It calls
  `buildWeeklyWorkspace()` with a server-resolved scope, exactly as the
  workspace route does, so it cannot show a different report. Its
  eight-column department table — 1208px inside a 686px page, with a permanent
  horizontal scrollbar — is replaced by stacked blocks that wrap at any width.
- **The three statuses are named for what they are about**: Report Lifecycle
  Status, Project Overall Status, Weekly Progress Status. No new status model.

Two "Discipline" strings remain reachable from a PSM Edit form, deliberately:
"Add new discipline" and "Manage disciplines…" inside the picker. Both open
Global Administration, where the record IS a Discipline; relabelling the
doorway would announce one thing and open another, and the standing rule is
that Global Administration keeps the entity name.

**Still missing, from `archive/reporting-architecture-v1.md` §3:**

- Documents and attachments. **Confirmed unsupported**: no attachments table
  exists in any of the 32 migrations, and `attachmentIds` is hard-coded `[]` in
  both the mock and the Supabase service. Building one was explicitly out of
  scope for the content pass; it needs a table, storage and a migration.
- Approval actions beyond the lifecycle transitions
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

## Phase 10 — Executive reporting ⚠️ PARTIAL

Build project and portfolio Executive Reports, executive comments, KPIs, health status, trends, risks, actions, decisions, and the company-president view across all projects.

**Done when:** leadership can understand portfolio health without opening raw department submissions.

**Delivered (increment 1 — live derived portfolio view, no schema change):**

- `/executive-reports` — the Project Portfolio Executive Report: control bar with
  period and five filters, auto-drafted Executive Summary, a ten-tile KPI strip,
  the Project Status Overview table, Management Attention, six analytics panels,
  an upcoming-milestone timeline and per-project snapshot cards.
- `/executive-reports/preview` — the same document as an A4 print stage.
- `/executive-reports/projects/[projectId]` — read-only drill-down with six tabs
  (Overview, Weekly Updates, Monthly Reports, Risks & Issues, Actions,
  Milestones).
- The five `[reportId]` placeholder routes are **untouched and reserved** for the
  persisted Executive Report.

**The data policy, as built:**

- **Monthly is the official baseline.** A project's position is the latest
  Monthly for the selected month whose status is `approved`, `finalized` or
  `locked`. `archived` is deliberately excluded from that set — it is withdrawn
  from active use (§10.2) — so an archived Monthly appears as a fallback
  position, never as an official one.
- **Draft never aggregates.** A project with no approved Monthly still appears,
  marked *Draft / Not Approved* beside its actual lifecycle status, and is
  excluded from every portfolio figure. With no approved Monthly anywhere the
  KPI tiles read "No approved basis" and the page states so plainly rather than
  computing a total.
- **Absence is never zero.** No Monthly at all reads *No Monthly Report*, and
  every aggregate declares its basis and its exclusions.
- **Freshness is deduplicated exactly**, on `monthly_comments.source_weekly_entry_id`
  — the unique FK onto `weekly_entries.id`. Nothing already compiled into the
  Monthly is repeated as Weekly movement.

**One status reading.** `readHealth()` delegates to Monthly's own
`monthEndStatus()` rather than calling `recommendScheduleStatus()`. The two
carry different bands: at −2.0% variance the Weekly rule reads *On Schedule*
while the Monthly rule reads *Delayed*, so running the Weekly rule at portfolio
altitude made the Executive view contradict the report it compiles — a defect
under Law 6 and conformance rule 21. Caught in browser verification against
live data, not in review.

**Not built, and why:**

| Missing | Reason |
|---|---|
| Persisted Executive record — number, revision, approval, lock, snapshot | No `executive_reports` table; this increment was scoped to zero schema change |
| QR code on the output | `03` §19.1 requires a QR to resolve to a specific report **and revision**; nothing here is snapshotted, so there is no revision to point at |
| Documents tab | No attachment table exists in any migration |
| Central milestone register | None exists; the timeline is sourced from Monthly plan items and Weekly plan milestones, and says so |
| Business Unit / Portfolio Owner filters | No such columns on `projects` |
| Weighted portfolio roll-up | No project value, budget or man-hour weight exists, so the mean is unweighted and declares itself as such |

### Executive Notes — migration written, NOT applied

`20260812000003_executive_notes.sql` adds the only table the Executive tier
writes to. It is additive: no existing table, policy, function or row is
changed, and neither Weekly nor Monthly can see it, so Monthly compilation and
the Weekly→Monthly dedupe are untouched.

**It has not been pushed, deliberately.** `supabase db push --dry-run` reports
three pending migrations, not one:

```text
• 20260812000001_monthly_reports.sql      ← already live
• 20260812000002_monthly_rls_repair.sql   ← already live
• 20260812000003_executive_notes.sql      ← new
```

The two Monthly migrations exist in the live database — the application reads
and writes `monthly_reports` daily — but are absent from the remote migration
history. A push would therefore replay `create table public.monthly_reports`
against an existing table, and `…0001` is the migration already recorded above
as unreplayable (its four-argument `weekly_can_access_scope()` call). It would
fail partway and it would touch Monthly.

**The safe sequence, for a human to run deliberately:**

```bash
supabase migration repair --status applied 20260812000001 20260812000002
supabase db push
```

The repair only inserts rows into `supabase_migrations.schema_migrations`; it
executes no DDL and changes no Monthly data. It should still be run by someone
who confirms the premise first — that both migrations are genuinely applied.

Until then the Executive Notes UI renders a "migration pending" panel instead of
failing: `executiveNoteService` treats PostgREST `42P01` / `PGRST205` as a state,
not an error, so the rest of the Executive Report is unaffected.

**Outstanding for production:** portfolio-level RLS. The four Weekly and four
Monthly tables carry real scoped policies, but `projects` still carries the
temporary `for all to authenticated using (true)` policy from Phase 3.
`executive-scope.ts` mirrors `weekly_can_access_project()` in TypeScript and
filters before aggregating (§7.2), but at portfolio altitude that is a rendering
filter, **not a database boundary**. Hardening it is a prerequisite for
production use of this module and is carried in Phase 12.

Increment 2 (the persisted Executive Report) still depends on the Executive
comment flag from Phase 6.

---

## Phase 11 — A4/PDF output ⚠️ PARTIAL

Create print views and PDF export for Weekly, Monthly, Project Executive, and Portfolio Executive reports. Include logos, compact charts, selected comments, decisions, sign-offs, and page metadata.

**Done when:** the one-page Executive output is readable and print-safe.

**Current state:** Weekly now has a dedicated `/weekly-reports/[reportId]/preview`
A4 document with EPROM/client identity, QR, controlled wrapping/page breaks,
repeated table headers, and print CSS that removes the application shell and
all controls. `export-service.ts` remains two stubs and no Monthly or Executive
print work was started. Requirements are detailed in `12_REPORT_GENERATION.md`
§7.

**Ready to start for Weekly.** The Weekly workspace is now the canonical source
and needs no print-only duplicate of its data. `buildWeeklyWorkspace()` returns
everything both outputs need, already scoped to the viewer:

- **A. Department-level report** — one `DepartmentSection`: its overall update,
  its scope items with their submissions, responsibility, actions, and its
  completion counters.
- **B. Consolidated Project Weekly Report** — the whole `WeeklyWorkspace`:
  `summary` (one status reading), every `DepartmentSection`, `criticalItems`,
  `decisionItems`, `lookahead`, plus the report's own activities and the
  Report Information fields.

The renderer is the only thing missing. Do not add a second data path for it.

---

## Phase 12 — Hardening and future integrations ❌ NOT STARTED

Add DOCX output, branding management, signatures, QR codes, advanced audit/revision tools, Primavera/Power BI integrations, performance improvements, and final user documentation.

**Done when:** production readiness is assessed and future integrations are explicitly scoped.

**Carry into this phase:**

- Replace the temporary `using (true)` RLS policies with real per-role rules on
  the **non-Weekly** tables. The four Weekly tables are done — see Phase 5.
- `xlsx@0.18.5` carries a high-severity advisory with no registry fix available; `next@16.2.10` has one fixed in 16.2.11. Eight advisories total (5 high, 3 moderate).
- **There is still no test runner, and this is now the largest gap in the
  validation story.** Assertions exist for the tree helpers, chart templates,
  locking rules and the Excel importer (87), and for the Weekly derivation,
  scope and lifecycle modules (81, added in the final Weekly pass and covering
  the one-status-reading rule, the optional Department Overall Update, the
  project-level entry split, the scoped-member boundary and the transition
  guards). All pass. All of them live in a scratch directory outside the
  repository and are lost between sessions — the Weekly set runs by mirroring
  the pure modules and rewriting the `@/` alias, because nothing in `eprp/` can
  execute a `.ts` file. They should be moved into `eprp/src` under a real
  runner; adding one is a tooling decision that needs approval.
- **Row-level security is verified only at the derivation level between
  database sessions.** The 19 database-level assertions run as the
  `authenticated` role (Phase 5) have not been re-run since; the Weekly set
  above asserts that the resolver and the workspace apply the same predicates,
  which is the rendering half of the same rule, not the boundary itself.
- **The database holds exactly one project, and it is PSM.** The non-PSM
  terminology branch therefore cannot be exercised in the browser against real
  data; it is covered by assertions over `hierarchyTermsFor` /
  `isPsmProjectType` (including `AIM-01`, which must NOT match) and by the
  New Weekly Report form before a project is chosen, which correctly falls back
  to "Discipline". A second, non-PSM project would let this be verified for
  real.
- **Project Sites foundation (Project pass P12) is implemented.** Additive
  migration `20260817000003_project_sites.sql` provides stable project-owned
  Site IDs and one Primary Site while retaining `projects.site/city/country`
  as the compatibility path. Project Info can manage multiple Sites. Adding
  Site attribution to Weekly/Monthly/Executive remains downstream work and was
  intentionally not started in the Project-only pass.
- **Project Reference Documents foundation (Project pass P13) is implemented.**
  Migration `20260817000004_project_reference_documents.sql` adds revision-aware
  metadata and a private Project-scoped Storage bucket. The Project can upload,
  retain and view official references, including embedded PDF viewing. Global
  document search, generic/report attachments and report linkage remain future
  integrations; no reporting module was changed in this pass.
- **Client Representative contact auto-resolution (Project pass P14) is implemented.**
  Selecting a representative fills blank Project contact snapshot fields from
  the Contact record while preserving explicit Project overrides. This required
  no database change.
- **Project Setup Review clarity (Project pass P15) is implemented.** Review
  now renders Department → System → Program & Study explicitly, retains the
  shared manager-first ordering, and labels cross-Department assignments with
  the Person's Home Department. Counts remain derived from saved Project links.
- **Project Branding labels (Project pass P16) are corrected.** Project Setup
  now distinguishes `EPROM / Company Logo` from `Client Logo` and states that
  QR requires a real published report/revision URL. Building that destination
  remains reporting/deployment work; no report renderer was changed.
- **Final Project regression (P17) is partially complete.** Static checks,
  isolated production build, setup-route auth responses, migration alignment,
  and the absence of active RLS-disable statements are confirmed. The full
  save/reload/Finish Setup pass and `PSM-00-02` hosted-data confirmation remain
  pending because no authenticated browser session is connected.

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

---

## Phase 13 — Master Planning & Control ⚠️ IN PROGRESS

Master Milestones and Master Deliverables as the single governed source of
truth for project milestones, with Weekly and Monthly as reporting channels
over them rather than places where milestones are invented.

The full architecture, the ten frozen rules (R1–R10) and the locked decision
register (D1–D8) are held in the Phase 13 architecture review. This section
records only the phase numbering and delivery status.

**A note on the "P13" label.** Migration `20260817000004_project_reference_documents.sql`
is headed "EPRP P13 — official Project Reference Documents". That label predates
this heading and refers to the shipped Project Reference Documents work, **not**
to this phase. Sub-phase 13.1 below extends that same table; the two are related
but are not the same increment. Use the numbering in this file.

### Sub-phases

| # | Sub-phase | Status |
|---|---|---|
| 13.1 | Reference Input metadata | ✅ **CLOSED** — verified in the live UI 2026-08-19 |
| 13.2 | Master Milestones | ✅ **CLOSED** — verified in the live UI 2026-08-19 |
| 13.3 | Master Deliverables | ✅ **Implemented** — verified in the live UI 2026-08-20; one deferred test (M5) |
| 13.2c | Master Milestone completion | ✅ **Implemented** — verified on the local rehearsal database 2026-08-22 (29/29 shape, 42/42 runtime, 32/32 derivation); one defect found and fixed. Not yet driven through the UI |
| 13.2d | Milestone progress reconciliation | ✅ **Implemented** — verified on the local rehearsal database 2026-08-22 (40/40 runtime, 40/40 derivation). R5 amended; reconciliation is Project Control only (excludes Reporting Coordinator); conflict tolerance fixed at 0 points. Not yet driven through the UI |
| 13.4 | Reporting Integration | ❌ Not started — read contract exists (`milestoneService.listRegister`); Weekly/Monthly MUST write `as_of_date` (see 13.2d) |
| 13.5 | Schedule Import (Primavera) | 🔒 Gated — needs written sign-off |
| 13.6 | Schedule Views | 🔒 Gated |
| 13.7 | Executive & Dashboard | ❌ Not started |

**Acceptance gate:** 13.5 and 13.6 do not start until 13.1–13.4 are implemented,
tested and accepted. 13.1–13.4 must be fully usable without Primavera.

### 13.1 — Reference Input metadata ✅

Additive metadata on the existing `project_documents` table so controlled
reference inputs carry a revision chain, a provenance source and an effective
date, and so schedule revisions can be filed as their own document type.

**Delivered:**

- `superseded_by_document_id` — nullable self-reference, `on delete set null`,
  with a CHECK that a linked document is necessarily at status `superseded`.
- `source` — nullable, one of `client_issued | internal | contractor | other`.
- `effective_date` — nullable, distinct from `issue_date`.
- `document_type` widened by `schedule_update`.
- `projectDocumentService.supersede()` — writes the status and the chain link in
  one statement, so the two cannot drift, and refuses cross-project, self- and
  cycle links.
- Reference Inputs UI grouped into Scope of Work, Baseline Schedule, Schedule
  Updates and Supporting Documents, with the revision chain shown on each card.
- In-app PDF preview (PDF.js canvas), because the Electron desktop shell has no
  native PDF viewer. Actions are View Document | Download.
- Metadata Edit, and a two-stage delete: Soft Delete to a Deleted Documents
  section with a mandatory reason, Restore, and System-Administrator-only
  Permanent Delete that removes the row and the stored object. `deleted_at` is
  the discriminator; `status` is preserved so Restore returns the document to
  what it was.

**Not in 13.1:** no new table, no RLS change, no storage-bucket change, no
parsing of any uploaded file, and nothing from 13.2 or later.

**Done when:** a reference document can record its source and effective date, a
schedule update can be filed as such, and one document can supersede another with
the chain visible on both. ✅

### 13.1 closure record — verified in the live UI, 2026-08-19

All checks run against the real Supabase project, signed in as System
Administrator, in the Electron desktop shell.

| Area | Evidence |
|---|---|
| PDF viewer | 28-page PDF rendered to 28 canvases; page 1 confirmed by pixel histogram in an earlier pass |
| Prev / Next | 1/28 → 2/28 → 3/28 → 2/28 |
| Page X / Y | Follows scrolling (1 → 4 → 1); reads 28/28 at the end |
| Button gating | Previous disabled on page 1; Next disabled on page 28 |
| Zoom + / − | 100% → 125% with canvas width 1086 → 1357 px (exactly 1.25x); 125% → 100% |
| Fit Width | Present; disabled at the 100% fit baseline, enabled once zoomed |
| Download | Present in the viewer toolbar; signs a URL carrying the original file name |
| Edit | Title and reference number persisted; uploaded file unchanged |
| Soft delete | Reason mandatory (confirm disabled while empty); moved to Trash; left the active list |
| Trash card | Deleted badge beside the PRESERVED original status, plus deleted-by, date and reason |
| Restore | Returned to the active list at its original status with no delete residue |
| Permanent delete | Title/message/buttons as specified, no typed confirmation; No changed nothing; Yes removed row and storage object |
| Chain repair | A -> B -> C deleting B repaired to A -> C; A -> B deleting B returned A to Current (earlier pass) |

**Known limitations carried out of 13.1** — none block closure, all recorded so
they are not rediscovered as surprises:

1. **Zoom re-rasterises every page.** On a heavy 28-page scanned PDF a zoom step
   takes roughly a minute, and the toolbar is disabled throughout. Correct but
   slow; a future pass could render only visible pages.
2. **Controlled-reference blocking has never refused anything.** The code path
   exists, but no referencing table is live yet — `master_deliverables.document_id`
   arrives in 13.3, and milestones, reports and retained history do not exist.
   Each check belongs in `assessPermanentDelete` as its table lands.
3. **Negative permission cases unverified.** A Project Control Manager being
   refused permanent delete, and a Reporting Coordinator being refused
   delete/restore, are enforced by the RLS policy and the `deleted_at` trigger
   but were never observed — testing them needs a second account.
4. **Unexplained document loss.** Two documents present at the start of the
   13.1 delete work (`WEPCO SOW`, `fdgfd`) are no longer in the project. No
   document audit trail exists, so authorship could not be established. Worth
   considering a purge audit log.

---

### 13.2 — Master Milestones ✅

The authoritative milestone register, and the governed stream of updates
reported against it.

**The structural decision (D3).** Two tables, because identity and state are two
different authorities:

| Table | Holds | Written by |
|---|---|---|
| `master_milestones` | What a milestone **is** — code, name, scope, baseline, owner, priority | Project Control only |
| `milestone_updates` | What is **true of it now** — status, progress, forecast, actual, narrative | Any scoped contributor |

Putting `status` on the master row as well would give two writable stores of one
fact with no rule for which wins. It is absent by design, and the shape probe
asserts it stays absent. Symmetrically, `milestone_updates` has no `name`,
`title` or `code` column and a NOT NULL FK to its milestone — an update cannot
invent a milestone, which is R1/R4 made structural rather than asserted.

**Frozen rules, and where each is enforced**

| Rule | Enforced by |
|---|---|
| R1 — one register a milestone exists in | `milestone_updates` has no title of its own |
| R2 — identity originates manual \| scope | `master_milestones_source_valid` CHECK |
| R3 — only Project Control writes identity | `master_milestones_insert/update` → `weekly_can_manage_project` |
| R4 — reports submit updates, never identities | separate table, separate policy |
| R5 — current state = latest **approved** update | `milestone-state.ts`, one derivation for every tier |
| R6 — Project Control approves | `milestone_updates_update` → `weekly_can_manage_project`; `projects.milestone_update_approval` carries the per-project auto-approval setting |
| R7 — a regression needs a reason | flagged at submission; `milestone_updates_regression_reason` CHECK refuses an approved regression with no reason |

**Delivered**

- Migration `20260819000003_master_milestones.sql` — both tables, the
  `milestone_project()` security-definer helper, the `guard_milestone_update()`
  trigger (reported content immutable; a decision is final and stamps its
  approver), RLS on both tables, and `projects.milestone_update_approval`.
  **No DELETE policy on either table** — milestones archive, updates never
  disappear.
- `src/features/projects/milestone-state.ts` — the single derivation. Also
  `isRegression()`, `approvalQueue()` and `summarise()`.
- `src/services/milestone-service.ts` — identity CRUD, archive, `submitUpdate`
  (always lands pending), `decide`. Constraint names are translated to user
  wording in one place, so a rule is never worded differently than it is enforced.
- `src/features/projects/use-milestone-authority.ts` — presentation authority,
  delegating to the existing `resolveWeeklyScope()` rather than restating the rule.
- UI at `/projects/[projectId]/milestones` — register, approval queue, identity
  form, update dialog, history stream.

**Absence is never zero.** A milestone with nothing approved reports an em dash,
not 0%, and is counted in its own "Not yet reported" bucket rather than folded
into Not Started.

#### 13.2 verification — live UI and live database, 2026-08-19

Driven through the authenticated UI on project `PSM-00-02`, against the live
Supabase instance.

| # | Check | Result |
|---|---|---|
| 1 | Create milestone `M-01` through RLS | ✅ persisted |
| 2 | Unreported milestone shows `—`, not 0% | ✅ |
| 3 | Submit update (In Progress, 40%, forecast 15 Oct) | ✅ landed pending |
| 4 | **Pending update changes nothing** — row still Not Started / `—` | ✅ **R5** |
| 5 | Register marks "1 awaiting approval"; queue count 1 | ✅ |
| 6 | Approve → row becomes In Progress / 40% / 15 Oct | ✅ |
| 7 | Slip derived from baseline: `+15d` | ✅ |
| 8 | Approver stamped by the trigger, not by the client | ✅ |
| 9 | Submit 25% against approved 40% → regression warning before submit | ✅ **R7** |
| 10 | Queue flags **Regression**; Approve disabled until a reason is written | ✅ **R7** |
| 11 | Approve with reason → current figure becomes 25% (newest approved wins) | ✅ **R5** |
| 12 | History shows both entries, newest marked **Current**, with reason and decision stamps | ✅ |
| 13 | Anonymous shape probe: 12/12 — tables RLS-protected, all 37 columns resolve, no `status` on the register, no `title` on the stream, `milestone_update_approval` present | ✅ |

Lint, `tsc --noEmit` and `next build` all green.

**Known limitations carried out of 13.2**

1. **The guard trigger and the regression CHECK were not independently
   exercised.** Both are in the applied migration, and the UI behaves as though
   they hold, but no test drove a write that they alone would refuse — editing a
   reported figure, re-deciding a decided update, or approving a flagged
   regression with no reason. An anonymous probe cannot prove them: RLS refuses
   the write (42501) before either can run. Proving them needs a second
   authenticated account or a service-role path, neither of which exists yet.
2. **Auto-approval is stored but not acted on.** `projects.milestone_update_approval`
   accepts `auto_on_report_finalized`, and nothing yet reads it — the report
   finalization hook belongs to 13.4, and there is no UI to set it.
3. **`source` is always `planning`.** The `weekly` and `monthly` values are valid
   and their report columns exist, but no report submits an update until 13.4.
4. **Negative permission cases unverified.** A scoped contributor being refused
   approval, and a non-member being refused submission, are enforced by RLS but
   were never observed — same second-account gap as 13.1's limitation 3.
5. **Verification data is archived, not deleted.** Milestone `M-01` "Issue HAZOP
   report for Unit 300" on `PSM-00-02`, with its two approved updates, was
   created by this testing and was **archived on closure** so it cannot reach
   the Dashboard, Upcoming Milestones, KPIs, reports or the default register. It
   sits behind the Archived toggle with its history intact. It cannot be deleted
   — the tables have no DELETE policy by design.

**13.2 CLOSED 2026-08-19.** The four items above stay deferred and are verified
when their dependent phases land: items 1 and 4 need a second authenticated
account, item 2 needs 13.4's report-finalization hook, item 3 needs 13.4.

---

### 13.3 — Master Deliverables ✅

The authoritative register of submittable items, and the governed stream of
what has been reported about each one's journey through client review.

**The same split as 13.2 (D2, D3).**

| Table | Holds | Written by |
|---|---|---|
| `master_deliverables` | What a deliverable **is** — code, title, scope, owner, the milestone it serves, planned submission, evidence file | Project Control only |
| `deliverable_updates` | What is **true of it now** — client review position, actual submission, submitted revision | Any scoped contributor |

**The decision this phase exists to encode (D6): two approvals that must never
be conflated.**

- `client_review_status` is **reported data** — a fact about what the client did.
- `approval_status` is **governance** — Project Control accepting that the
  report of that fact is accurate.

A row may legitimately read `client_review_status = 'approved'` while
`approval_status = 'pending'`: someone has reported that the client approved the
deliverable, and Project Control has not yet confirmed the report. The column
names are deliberately asymmetric, the UI labels them "Client:" and "Report:",
and **no screen renders them in one control or one status chip**. The shape
probe asserts that no merged `status` column exists.

Kept as its own table rather than merged into `milestone_updates` behind a
discriminator: a client review cycle is not a progress percentage.

**The milestone link is a reference, never a copy.** `master_deliverables.milestone_id`
points into the milestone register and nothing else — no milestone code, name or
date is denormalized onto the deliverable, which the probe also asserts. The
register stays the single authoritative milestone source, as required.
`ON DELETE SET NULL` because a deliverable outlives the plan it was drawn
against; an archived milestone keeps its link and renders as "(archived)".

**Delivered**

- Migration `20260819000004_master_deliverables.sql` — both tables, the
  `deliverable_project()` security-definer helper, the `guard_deliverable_update()`
  trigger, RLS on both tables. **No DELETE policy on either.**
- Migration `20260819000005_move_discipline_system_master_sync.sql` — **M5**.
- `src/features/projects/deliverable-state.ts` — the single derivation, plus
  `deliverableApprovalQueue()`, `forMilestone()` and `summariseDeliverables()`.
- `src/services/deliverable-service.ts`, and UI at
  `/projects/[projectId]/deliverables`.

#### M5 — a live defect closed, not a new feature

`move_discipline_system()` synchronises every `project_disciplines` link when a
Program & Study moves. `master_milestones` and `master_deliverables` carry the
same three scope columns and the function had never heard of them, so **a legal
Discipline move left every milestone on it holding a stale department and
system** — silently, with nothing to detect it. That hole opened with 13.2 and is
closed here, in the same transaction as the move, with post-move verification
that rolls the whole move back if either register is left stale. Synchronising
from the client afterwards would have reopened the partial-save problem
migration `20260809000004` exists to close.

#### 13.3 verification — live UI and live database, 2026-08-20

Driven through the authenticated UI on project `PSM-00-02`.

| # | Check | Result |
|---|---|---|
| 1 | Create deliverable `D-01` through RLS, linked to milestone `M-01` | ✅ persisted |
| 2 | Milestone column resolves the reference from the milestone register | ✅ |
| 3 | Planned revision shown when nothing has been reported | ✅ |
| 4 | Review date and client reference disabled while Not Submitted (mirrors the CHECK) | ✅ |
| 5 | Submit "Client Approved" → **register still reads Not Submitted, Accepted = 0** | ✅ **D6 + R5** |
| 6 | Row shows a separate "1 awaiting approval" marker, apart from the Client status column | ✅ **D6** |
| 7 | Queue labels the reported position "Reported:" and the buttons "Approve/Reject **Report**" | ✅ **D6** |
| 8 | Approve report → Client Approved, Rev B, submitted 12 Oct, slip `+7d` from planned 05 Oct | ✅ |
| 9 | Submit "Client Rejected", then **reject the report** → register unchanged, Returned = 0 | ✅ **R5** |
| 10 | History shows "Client: Client Rejected / Report: Rejected" beside "Client: Client Approved / Report: Approved · Current" | ✅ **D6** |
| 11 | Archiving the linked milestone keeps the reference, labelled "M-01 (archived)" | ✅ |
| 12 | Anonymous shape probe: 18/18 — RLS holding, all 37 columns resolve, no client status on the register, no merged `status`, no denormalized milestone fields | ✅ |

Lint, `tsc --noEmit` and `next build` all green.

**Known limitations carried out of 13.3**

1. **M5's register sync has not been exercised at runtime.** The migration is
   applied and its post-move checks would refuse a stale result, but proving the
   sync requires actually moving a Program & Study between Systems in **shared
   master data** — which affects every project linked to it, not just the test
   project. Not done unilaterally. The test is: file a milestone and a
   deliverable under one Discipline, move that Discipline to another System in
   the same Department, confirm both registers followed, move it back.
2. **The guard trigger and the review-date CHECK were not independently
   exercised** — same gap as 13.2's limitation 1, and the same cause: an
   anonymous probe is refused by RLS (42501) before either can run.
3. **`source` is always `planning`.** Weekly and Monthly do not submit
   deliverable updates until 13.4.3.
4. **Verification data is archived.** Deliverable `D-01` "HAZOP Report — Unit
   300" on `PSM-00-02`, with one approved and one rejected update, was created by
   this testing and archived on completion, together with the `M-01` restore that
   the milestone-link test required (re-archived immediately after). Neither can
   be deleted — the tables have no DELETE policy by design.


---

### 13.2c — Master Milestone completion ✅ implemented, runtime-verified locally

13.2 built the register and the identity/state split. 13.2c completes the
**model**, so the register can actually govern what a project commits to rather
than only what it is called.

**What already existed** — the two-table split, RLS on both tables, the
append-only guard, the approval queue, archive/restore, the milestone→
deliverable reference, `milestone-state.ts` as the single derivation, and a
working register UI. None of it was rebuilt.

**What was missing** — everything below.

#### The completed model

The split is unchanged and decides where each field lives.

| Lives on `master_milestones` (identity + plan) | Lives on `milestone_updates` (reported state) |
|---|---|
| `milestone_type` — technical / contractual / commercial | `status`, `progress_percent` |
| `category` — free text, project-chosen | `forecast_date`, `actual_date` |
| `planned_date`, `baseline_date` | `payment_status` |
| `weight_percent`, `planned_progress_percent` | `invoice_reference`, `invoiced_date`, `received_date` |
| `predecessor_milestone_id` | `recovered_amount` |
| `client_approval_required` | `client_approval_status`, `client_approval_date` |
| `payment_percent`, `payment_amount`, `payment_due_date` | |
| `is_advance_payment`, `notes` | |

Derived, never stored: **variance** (against plan *and* against baseline, kept
apart), **recovery %**, and **outstanding advance** — all in
`milestone-state.ts`.

**Milestone types are a class, not a name.** Three values, closed, because they
drive behaviour: they decide which fields apply and which progress measure the
row belongs to. The freely configurable label is `category`. No milestone
*title* is hardcoded anywhere.

**Planned and baseline are both kept.** Baseline is the frozen contractual
reference; planned is what was last agreed. A re-planned milestone can be on
plan and behind baseline at the same time, and the register shows both numbers
rather than blending them.

#### Advance / Down Payment — the accounting rule

> An Advance / Down Payment does **not** increase physical progress.

If the contract is 100% and a 10% advance is received, the project is 10% paid,
not 110% built. Enforced in three places, in descending order of authority:

1. **A CHECK constraint** — `master_milestones_commercial_no_physical_weight`
   refuses a commercial milestone any `weight_percent` at all. This is the
   guarantee; it holds for the UI, a future import, and a hand-written fix
   alike.
2. **`registerProgress()`** returns `physicalPercent` and `commercialPercent`
   as two separate figures. Physical excludes commercial milestones entirely —
   excluded, not down-weighted. Physical is weighted by `weight_percent`;
   commercial by `payment_percent`.
3. **The UI** presents the two measures as peer cards, never summed, and the
   payment chip on a row never merges into the Status column.

Payment lifecycle: `planned → due → invoiced → received → partially_recovered →
fully_recovered`. Recovery is reported as an **amount**; recovery % and the
outstanding advance are derived against the agreed `payment_amount`, so neither
has a second writable store.

#### Milestone ↔ Deliverable

Already correct and left alone: the foreign key lives on
`master_deliverables.milestone_id`, which makes it **one milestone → many
deliverables** — the relationship the requirement asks for. It is a reference;
no milestone field is copied onto a deliverable. What was missing was
visibility, so the register now shows the linked deliverables per milestone and
lists them (with the client's own review position, labelled `Client:`) in the
milestone detail dialog, read through `forMilestone()` in
`deliverable-state.ts`.

#### The reporting integration contract

```text
Master Milestones / Master Deliverables   ← the governed register
              ↓  milestoneService.listRegister(projectIds)
          Weekly → Monthly → Executive → Dashboard
```

`milestoneService.listRegister(projectIds)` is the contract. It returns
identity and stream separately across many projects in two round trips, so
every tier derives current state through `milestoneStates()` and none can
invent its own rule. Archived milestones are excluded. RLS still applies.

**No report screen was switched in this task**, per scope. The exact
integration points for 13.4 / 13.7 are:

| # | File | What it does today | What must replace it |
|---|---|---|---|
| 1 | `src/features/dashboard/dashboard-data.ts` → `loadUpcomingMilestones()` | Queries `weekly_plan_items` (`kind='milestone'`) and `monthly_plan_items` directly | `listRegister()` + `milestoneStates()`; `dueDate` becomes forecast → planned → baseline; `href` points at the project register |
| 2 | `src/features/executive-reports/executive-data.ts` → `buildMilestones()` | Builds `MilestoneRow[]` from Monthly and Weekly plan items, tagged `monthly_plan` / `weekly_plan` | A `master_register` source; `dedupeMilestones()` becomes unnecessary because register rows have identity and cannot double-count |
| 3 | same file → `nextDueMilestone()` | Picks the row for the portfolio table | Unchanged logic, register-sourced rows |
| 4 | same file → movement feed (`milestone_changed`) | Reads `plan.kind === 'milestone' && status === 'delayed'` | An approved `milestone_updates` transition |
| 5 | `projects.milestone_update_approval` | Stored, never read | 13.4's report-finalization hook (carried from 13.2 limitation 2) |

Deliberately **not** switched now: the registers are empty on live projects, so
flipping the Dashboard and Executive today would blank two working screens. The
switch belongs with 13.4, alongside a migration path for existing plan items.

#### Delivered

- Migration `20260822000003_master_milestone_completion.sql` — 12 identity
  columns, 7 reported columns, 11 CHECK constraints, 2 indexes, the
  `guard_milestone_identity()` trigger (same-project + acyclic predecessors),
  and `guard_milestone_update()` widened over the new reported columns.
  **Additive only.** No RLS change; no DELETE policy introduced.
- `scripts/p0-validation/87_verify_13_2c.sql` — read-only shape verifier.
- `scripts/p0-validation/88_runtime_13_2c.sql` — behavioural verifier; writes
  through RLS as a real identity, then rolls back. Local databases only.
- `registerProgress()` and the extended `MilestoneState` in
  `milestone-state.ts`.
- `milestoneService.listRegister()` — the 13.4 read contract.
- Register UI: type filter, planned column with plan-variance, progress vs
  planned progress, dependency and weight on the row, commercial section in the
  form and update dialogs, payment/client-approval facts in the approval queue
  and history, related deliverables.

#### Runtime verification — local rehearsal database, 2026-08-22

Migration `20260822000003` was applied by a **full `supabase db reset`**, so all
64 migrations were replayed from scratch onto an empty database. Nothing was run
against production.

| Suite | Result |
|---|---|
| `87_verify_13_2c.sql` — shape, read-only | **29 / 29 PASS** |
| `88_runtime_13_2c.sql` — behaviour, writes through RLS then rolls back | **42 / 42 PASS** |
| Derivation harness — the real compiled `milestone-state.ts` / `project-terminology.ts` against rows read out of the database | **32 / 32 PASS** |
| `86_verify_p1a.sql` — P1-A regression | **39 / 39 PASS** |
| `85_verify_p0_closeout.sql` — pre-P1-A baseline | 65 PASS / 3 expected drift, see below |
| lint · `tsc --noEmit` · `next build` | green |

What was exercised, by requirement:

1. **Create / edit** — a technical milestone written through RLS as an
   authenticated Project Control identity; type, weight and planned progress
   round-trip; a re-plan moves `planned_date` and leaves `baseline_date` alone.
2. **Report / approve** — a submitted update is *not* current (R5); approving it
   makes it current and stamps `approved_at`.
3. **Variance** — planned 2026-10-15, baseline 2026-09-15, forecast 2026-11-05,
   approved 40% against a planned 60% yields `varianceDays = +21`,
   `slipDays = +51`, `progressVariance = −20`. The two date variances are
   different numbers and stay separate. An unreported milestone derives
   `undefined`, never `0`.
4. **Archive / restore** — history survives archiving; the deliverable link
   survives it too.
5. **Isolation** — enforced on WRITE, as architecture §24.2 requires: the same
   identity manages its own project and is refused insert, edit and approve on
   another. Identity READ is Tier A and deliberately platform-wide; unapproved
   (Tier B) updates on another project stay hidden.
6. **Terminology** — the real resolver, over the real `project_types` rows: a
   `PSAIM-` code yields Programs & Studies, all eight seeded non-PSM codes yield
   Disciplines, and `AIM-01` is correctly *not* mistaken for PSAIM.
7. **Advance / down payment** — a 10% / 100 000 advance walked through
   `planned → due → invoiced → received → partially_recovered → fully_recovered`,
   each step its own approved update. Recovery % and outstanding advance derive
   correctly. **Physical progress reads 40% and commercial reads 100% — the
   naive blend would have said 50%.** The database refuses a physical weight on
   a commercial milestone, refuses payment fields on a technical one, and
   refuses an invented payment status or a negative recovery.
8. **Dependency** — a same-project predecessor is accepted; self-reference, a
   two-node loop and a cross-project predecessor are each refused by
   `guard_milestone_identity()`.
9. **Deliverables** — one milestone serving two deliverables, link intact
   through archiving, nothing denormalized.
10. **13.2 / 13.3 regression** — editing a reported figure, editing a reported
    *payment* fact, re-deciding a decided update, approving a flagged regression
    with no reason, a duplicate code, and a client decision date with no
    decision are all refused. D6 holds: a row reads client-approved while our
    report is still pending.

**This closes 13.2 limitation 1 and 13.3 limitation 2** — the guard trigger and
the CHECK constraints have now been driven directly and observed to refuse.
13.2 limitation 4 (negative permission cases) is closed for the milestone
register by the isolation section above.

#### One real defect found and fixed

`milestone_updates_client_approval_date_needs_decision` did not do what its name
says. Written as:

```sql
client_approval_date is null or client_approval_status in ('approved','rejected')
```

`client_approval_status` is nullable, and `null in (…)` evaluates to **NULL** —
which a CHECK constraint accepts, because only FALSE rejects. So a client
decision *date* with no client decision was silently allowed: exactly the row
the constraint exists to refuse. It failed correctly for `'pending'`, which is
what made it look right.

Fixed in the same (unreleased) migration with `coalesce(client_approval_status, '')`,
proved by re-reset and re-run. No other constraint in this migration has the
same shape — the rest either guard a NOT NULL column or carry an explicit
`is null` branch.

#### Known limitations carried out of 13.2c

1. **Tie-broken `submitted_at` makes "current" order-dependent.** `milestoneState()`
   sorts the stream by `submittedAt` alone, and `milestoneService.listUpdates()`
   orders by `submitted_at desc` with no secondary key. Two approved updates
   sharing a timestamp therefore leave "current state" decided by whatever order
   the database returned rows in. This is **not reachable through the UI** —
   `submitted_at` defaults to `now()`, which is transaction start time, so one
   update per transaction always differs. It becomes reachable the moment
   something writes several updates in one transaction, which is precisely what
   13.4's report-finalization hook and 13.5's schedule import will do. Found
   while building the fixture (six lifecycle steps in one transaction produced
   six identical timestamps and the derivation picked the first). **Pre-existing
   from 13.2, not introduced here, and deliberately not fixed in this task** —
   the fix is a secondary sort key on `id` in both the service and the
   derivation, and it belongs with 13.4.
2. **No UI-driven pass.** Every check above went through SQL and through the
   compiled derivation modules. The React components that render these figures
   were type-checked and built but never clicked.
3. **Auto-approval is still stored but unread** (13.2 limitation 2) and
   **`source` is still always `planning`** (13.2 limitation 3). Both wait on 13.4.
4. **`85_verify_p0_closeout.sql` reports 3 drifted rows**, all expected and none
   caused by this work. It encodes the *pre-P1-A* baseline and its own header
   says it starts failing once P1-A lands. Its migration counter expects 7
   `2026082*` migrations and there are now 9 (P1-A took it to 8 before this
   task). Its policy counts (101 total / 14 write-open) are superseded by
   `86_verify_p1a.sql`, which asserts 107 / 11 and passes — 107 being an
   expectation written before this migration existed, which is independent
   confirmation that **13.2c adds no policy**.

---

### 13.2d — Milestone progress reconciliation ✅ implemented, runtime-verified locally

**Weekly and Monthly are observations. They propose a figure; they do not own
it.** The governed official progress is resolved through Master Milestone
governance, and a disagreement between two sources is surfaced for Project
Control rather than settled by whichever row was written last.

#### The defect this closes

Before 13.2d, two approved updates reporting 50% and 60% resolved to "the latest
approved one". Proven on the rehearsal database: Weekly 50% then Monthly 60%
gave an official 60; **reversing only the entry order of the same two facts gave
50.** The authoritative number depended on data-entry order, and nothing
anywhere flagged it.

#### R5, amended

| | |
|---|---|
| was | current = latest approved |
| now | current = latest **resolved** governed value for the latest **resolved** cut-off |

Owner-approved as part of Master Milestones governance. Rows that state no
cut-off are exempt and keep the old behaviour, which is what makes the change
invisible to every row written before 13.2d.

#### Schema — additive, no parallel table

Three columns on `milestone_updates`: `as_of_date`, `adopted_from_update_id`,
`reconciliation_reason`; plus `reconciliation` as a fourth `source` value.

A reconciliation is the same shape as an update — a value, for a milestone, with
provenance and governance — so it is a row in the existing table and inherits
the append-only guarantee automatically. Adopting Weekly, adopting Monthly and
entering a fresh figure are **one act with three inputs**.

Deliberately NOT stored, because they are derivable and a second store could go
stale: conflict state (derived in `milestone-state.ts`), and "reconciled by /
at" — on a reconciliation row `submitted_by_contact_id` and `submitted_at` ARE
the reconciler and the moment.

#### Provenance, as required

| Required | Where |
|---|---|
| source type | `source` — weekly / monthly / planning / reconciliation |
| source report / record | `weekly_report_id` / `monthly_report_id` |
| reported value | `progress_percent`, immutable |
| as-of date | `as_of_date` |
| reconciliation status | derived: `agreed` / `reconciled` / `in_conflict` / `unreported` |
| reconciled / official value | the reconciliation row's `progress_percent` |
| reconciled by / at | that row's `submitted_by_contact_id` / `submitted_at` |
| reason | `reconciliation_reason`, mandatory by CHECK |

#### Conflict derivation

Per cut-off, in `resolveCutoffs()`:

1. a reconciliation exists → **reconciled**, its figure is official (newest wins)
2. else all approved sources agree → **agreed**, that figure is official
3. else → **in_conflict**, and there is **no official figure at all**

Comparison is exact — **0 percentage points of tolerance**, as specified. A
configurable per-project tolerance is a **documented future enhancement** and was
deliberately not invented here. Rows reporting no figure take no part: a Weekly
that updates only a forecast date is not disagreeing about progress.

Across cut-offs, current state uses the latest **resolved** one; an unresolved
later cut-off never becomes official but is always flagged.

#### Authority — Project Control only

| | |
|---|---|
| **ALLOWED** | `system_admin`, `project_control_admin` (portfolio-wide, architecture 8.1), the project's assigned **Project Control Manager** |
| **REFUSED** | **Reporting Coordinator**, department manager, team member lead, team member, every other contributor |

`can_reconcile_milestone()` deliberately does **NOT** delegate to
`can_manage_project_setup()`. That predicate resolves through
`is_project_consolidator()`, which treats the Reporting Coordinator as
equivalent to the Project Control Manager — correct for setup and for accepting
a report, wrong here. A Reporting Coordinator coordinates Weekly and Monthly
reporting and surfaces a conflict; deciding the governed official figure is not
theirs.

So the Project-Control-Manager half is restated rather than inherited. That is
the one place in this schema where the consolidator pair is split, and
`89_runtime_reconciliation.sql` asserts the function body mentions no
coordinator predicate at all — a future "tidy-up" back to the shared predicate
would silently restore the over-grant.

`useMilestoneAuthority.canReconcile` mirrors it clause for clause, and is
deliberately not `canManage` for the same reason.

*(Corrected after first implementation, which did delegate and so over-granted
to the Reporting Coordinator. Narrowing only — no other predicate or policy
touched, P1 not reopened.)*

The `milestone_updates_insert` policy was **replaced, not supplemented** (a
second permissive policy would OR-widen insert rights). The contributor branch is
character-for-character the existing predicate, so nobody loses the ability to
submit. `86_verify_p1a.sql` still passes 39/39, confirming the policy counts are
unchanged.

#### Reporting contract for 13.4

Weekly / Monthly integration **must** write: `source`, the source report id,
`progress_percent`, and **`as_of_date`**. Without a cut-off a figure is exempt
from conflict detection and silently bypasses this governance.

Dashboard / Executive **must** consume the governed official progress and the
conflict flag — never a raw latest report value. Both arrive free through
`milestoneStates()`, which is the only derivation.

#### Verification — local rehearsal database, 2026-08-22

Applied by full `supabase db reset` (65 migrations from scratch).

| Suite | Result |
|---|---|
| `89_runtime_reconciliation.sql` — cases A–G at the database layer | **40 / 40 PASS** |
| Reconciliation derivation harness — real compiled `milestone-state.ts` | **40 / 40 PASS** |
| `87_verify_13_2c.sql` | **29 / 29 PASS** |
| `88_runtime_13_2c.sql` | **42 / 42 PASS** |
| 13.2c derivation harness | **32 / 32 PASS** |
| `86_verify_p1a.sql` | **39 / 39 PASS** |
| lint · `tsc --noEmit` · `next build` | green |

A: different cut-offs → both valid, no conflict. B: same cut-off → in_conflict,
no official figure, outcome identical whichever source arrived first. C/D/E:
adopt Weekly / adopt Monthly / enter 55% → official follows, originals preserved
untouched. F: the Reporting Coordinator is refused reconciliation on its own project while
keeping every other Project Control capability; the assigned Project Control
Manager, project_control_admin and system_admin are each allowed and the PCM
writes one; the contributor submission path is unaffected. G: identical `submitted_at` values
resolve deterministically.

Also refused: a reconciliation with no reason, no cut-off, or left pending; a
Weekly row carrying a reconciliation reason; adopting a row from another
milestone or another cut-off; editing a reconciliation after the fact.

#### Deterministic ordering

`newestFirst()` now sorts by `submittedAt` then `id`, and both service reads add
`.order("id")`. This closes the tie-break limitation carried out of 13.2c **for
milestone state**. `deliverable-state.ts` has the same pattern and was left
alone — out of scope, and no equivalent governance rule depends on it yet.

#### Known limitations carried out of 13.2d

1. **No UI-driven pass.** The reconcile dialog, conflict banner and as-of-date
   field were type-checked and built but never clicked.
2. **Conflict tolerance is fixed at 0 points.** A rounding difference of one
   point will raise a conflict. Configurable tolerance is the documented next
   enhancement if that proves noisy in practice.
3. **Only `planning` updates carry a cut-off in the UI today.** The as-of-date
   field exists on the update dialog; Weekly and Monthly do not submit at all
   until 13.4.

# Stabilization Sprint 1 — Report

**Scope:** fix existing issues only. No new features, no UI redesign, no new pages, no schema changes.
**Gates:** `npm run lint` · `npm run typecheck` · `npm run build` — **all green.**

---

## 1. Issues found

### Tooling — the three commands this sprint was told to run were themselves broken

| # | Issue | Severity | Evidence |
|---|---|---|---|
| 1 | **`npm run lint` linted the build output.** `eslint.config.mjs` ignored `.next/**` but not `.next-verify/**` — the scratch directory `next.config.ts` itself instructs you to use, and which `.gitignore` already excludes via `/.next-*/`. | High | Bare run reported **17,079 problems (705 errors)**, every one from `.next-verify/build/**` |
| 2 | **`npm run lint` had no target and no warning gate** — bare `eslint`, so it never matched the documented `eslint src --max-warnings=0`. | Medium | Script definition |
| 3 | **`npm run typecheck` did not exist.** | Medium | `package.json` had only `dev`, `build`, `start`, `lint` |

Because of #1 and #2, `npm run lint` had been failing on generated files while `src/` was actually clean — the gate was reporting noise, not signal.

### CRUD integrity

| # | Issue | Severity | Detail |
|---|---|---|---|
| 4 | **Duplicate names were accepted in Supabase mode but rejected in mock mode.** The mock service checks name/code case-insensitively in application code; the Supabase service relied solely on a database unique violation. | **High** | Only `departments` and `job_titles` constrain `name`. `clients`, `project_types`, `project_phases`, `contacts`, `systems`, `disciplines` do **not** — so duplicates saved silently. `departments.name` is unique but **case-sensitive**, so "Piping" and "piping" both inserted. |
| 5 | **`canDelete` for Systems had no reference checks at all** (`references: []`). | **High** | Deleting a system that a project actually used was permitted. Because `project_disciplines.system_id` and `project_contacts.system_id` are `on delete set null`, the delete succeeded and **silently blanked the project links** rather than being refused. |
| 6 | **`canDelete` for Disciplines was missing its project-level references.** | High | Only `weekly_submissions.discipline_id` was checked; `project_disciplines` and `project_contacts` were not. |
| 7 | **`canDelete` for Departments was missing its project-level references.** | Medium | `project_disciplines.department_id` and `project_contacts.department_id` were not checked — both `on delete set null`. |

Root cause of #5–#7: the reference lists were written before the project setup-links migration added those columns, and were never updated. A stale code comment ("Project system assignments are denormalized copies, so master systems are not directly referenced yet") documented the old state and hid the gap.

### Validation

| # | Issue | Severity | Detail |
|---|---|---|---|
| 8 | **Phone fields had no validation.** Required, email and number were validated; `tel` fell through entirely. | Medium | "n/a", "call reception", or an email address saved as a contact phone number |

---

## 2. Issues fixed

All eight. Files changed:

| File | Change |
|---|---|
| `eprp/eslint.config.mjs` | Ignore `.next-*/**` so verification builds are not linted |
| `eprp/package.json` | `lint` → `eslint src --max-warnings=0`; added `typecheck` → `tsc --noEmit` |
| `eprp/src/features/master-data/supabase-service.ts` | Added `assertNoDuplicate`, applied on create and update |
| `eprp/src/features/master-data/services.ts` | Added the missing reference checks for systems, disciplines and departments |
| `eprp/src/features/master-data/components/master-data-form.tsx` | Added phone validation |

*(The diff also shows earlier uncommitted work in `master-data-list-view.tsx`, `master-data-views.tsx`, `index.ts` and `types.ts` from previous sprints — not part of this sprint.)*

### Verification

**24 assertions, all passing**, covering the two new validation paths:

- Phone accepts `+20 100 123 4567`, `(02) 2735-1234`, `202.555.0147`, `+44 20 7946 0958`; rejects `n/a`, `call reception`, an email address, and out-of-range digit counts; empty stays valid because the field is optional.
- Duplicates rejected exactly, case-insensitively, and whitespace-padded; a record editing itself does **not** collide with its own name; a partial update touching neither field skips the check.

**Route sweep — 52 routes, zero broken.** All returned 200 with correct titles. Three negative controls (`/definitely-not-real`, `setup/bogus`, `bogus-section`) correctly returned 404, which proves the sweep can actually detect a missing route.

Covered: dashboard · projects · project detail/edit · all 6 setup steps · all 14 project sections · departments · systems · disciplines · contacts · weekly · monthly · executive · comments · analytics · documents · administration · job titles · settings, including all `/new` and `/import` variants.

**Workflow.** `Project Info → Departments` advance confirmed in code (`router.push` on both the create and update paths), and `Save & Continue` advances through Departments → Systems → Programs & Studies → Contacts → Review, gated on step completion by design.

---

## 3. Remaining issues

Reported honestly — these were found but **not** fixed.

| # | Issue | Why not fixed |
|---|---|---|
| R1 | **The duplicate check is read-then-write.** Two simultaneous inserts could still both pass. The unique-violation mapping remains as a backstop. | The durable fix is a case-insensitive unique index — a migration, which this sprint excluded |
| R2 | **New drift introduced in the opposite direction.** The *mock* service still returns no references for systems and disciplines (`usedBy: () => []`), so mock mode now permits a delete that Supabase mode refuses. | Fixing it requires wiring mock project data into the mock master-data service — more than a stabilization tweak, and risky to land late in the sprint |
| R3 | **`project_departments.systems` is a jsonb array with no foreign key.** Deleting a system still leaves a dangling id there; no reference check can see it. | Requires normalizing the column — a schema change |
| R4 | **UI-level CRUD QA was not exhaustive.** Create / Edit / Save / Delete / Search / Filter were audited by code inspection and unit assertions, not by driving every form in the browser. | Doing so means creating and deleting real records in the live database. I did not judge that safe to do unprompted |
| R5 | **Buttons were verified structurally, not by clicking every one.** Edit / Back / Next exist and are wired; I did not click each instance across all pages. | Same reason as R4 |

**Not re-audited this sprint** (fixed and verified in the previous stabilization pass, unchanged since): login and the DNS-blip session loss, the proxy redirect loop, and the assignment integrity rules.

---

## 4. Recommendations for Sprint 2

Ordered by value.

1. **Add case-insensitive unique indexes** on `name` for clients, project types, phases, contacts, systems and disciplines — and convert `departments.name` to case-insensitive. This closes R1 at the database, where it belongs, and makes the application check a fast-fail rather than the only defence.
2. **Normalize `project_departments.systems`** from a jsonb array into a real linking table with foreign keys. This closes R3 and removes the last place where project scope can hold a dangling reference.
3. **Close the mock/Supabase drift permanently (R2).** Two hand-maintained implementations at method parity have now produced defects in both directions. Either give them a shared contract test that runs both through identical cases, or retire the mock service if it is no longer used.
4. **Stand up a test runner.** All verification in this sprint and the last was ad-hoc compiled scripts. Recommendations 1–3 all touch data integrity and are risky without one.
5. **Then do a real UI QA pass** (R4, R5) against a disposable project, so create/edit/delete can be exercised for real without touching production records.
6. **Audit the remaining `canDelete` reference lists** the same way I audited these three. The defect class was "reference list written once, never updated when a migration added a column" — clients, project types, phases and contacts should be checked against the current schema for the same gap.

---

## 5. Gate results

```text
npm run lint       exit 0
npm run typecheck  exit 0
npm run build      exit 0   ✓ Compiled successfully · 36/36 static pages
```

No schema, migration, RLS, seed or project data was changed. Nothing was committed.

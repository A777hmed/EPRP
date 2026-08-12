# Known Limitations — Sprint 2

What was **not** verified, and why. The sprint's end condition is **not met**; this document is the honest accounting of the gap.

---

## 1. Hard blockers

### 1.1 I cannot sign in

Entering credentials is outside what I will do. I worked entirely inside the session that was already open, and did not log out — doing so would have ended the sprint with no way back in.

**Consequently NOT VERIFIED:** logout/login, session expiry, token refresh, the login form's own behaviour, and every role-permission difference (one session, one role).

### 1.2 The row Actions dropdown could not be opened

Three real clicks plus a MutationObserver confirmed the menu never mounts and `aria-expanded` never changes — **but it fails identically on `/departments`, a page that is otherwise fully working.** That points at the headless browser tooling, not the product.

I initially reported this as a product defect and **withdrew that claim**. It is `NOT VERIFIED`, not "broken".

**Consequently NOT VERIFIED:** View / Edit / Archive / Restore / Delete via the row menu, on every master-data list.

### 1.3 No writes were performed

Exercising Create / Edit / Save / Delete means writing and deleting real records in the live database, which holds the real PSM-001 project. I did not do that unprompted.

**Consequently NOT VERIFIED:** every CRUD round-trip, cross-page synchronisation after a write, stale-cache behaviour, orphan records, and duplicate-record creation in practice.

---

## 2. Not exercised this sprint

| Area | Status |
|---|---|
| Search boxes | Present (`Search systems…`); behaviour not tested |
| Status filters | Present; behaviour not tested |
| Pagination | Not tested |
| Browser back / forward / refresh mid-workflow | Not tested |
| Toasts, modals, drawers, dropdowns, date pickers | Not tested |
| Loading, empty and error states | Not tested |
| Responsive layout, keyboard navigation | Not tested |
| Import / Export | Services are unimplemented stubs — nothing to exercise |
| Notifications | Top bar has zero click handlers — nothing to exercise |
| Database synchronisation probe | Attempted; the anon key could not be extracted from the page |

---

## 3. Known product limitations carried forward

### 3.1 Exact-match duplicate blocking cannot catch misspellings

Sprint 1 blocks identical names (case- and whitespace-insensitive). The live database contains **"Mohamed Khattab"** and **"Mohamed Khatab"** — one person, two spellings. No exact-match guard can catch that.

Needs near-duplicate detection at entry (`UX_REVIEW.md` §3).

### 3.2 The duplicate check is read-then-write

Two simultaneous inserts could both pass. The database unique-violation mapping remains the backstop. The durable fix is a case-insensitive unique index — a migration.

### 3.3 `project_departments.systems` has no foreign key

It is a jsonb array. Deleting a system can still leave a dangling id there, and no reference check can see it. Needs normalization — a schema change.

**Now load-bearing.** `move_discipline_system()` reads this array to decide
whether a project has the target System in scope. A dangling or missing id
there makes a legitimate move look out-of-scope and get refused. The refusal
is the safe direction — it blocks rather than corrupts — but it means a
stale jsonb entry now produces a confusing "System is not assigned to this
project" error. Normalizing this table is the fix.

### 3.4 Mock/Supabase drift, now in the opposite direction

Sprint 1 added reference checks to the Supabase service; the mock service still returns none for systems and disciplines. Mock mode now permits a delete Supabase refuses.

**Widened by the atomic-move work.** The synchronization that keeps
`project_disciplines` and `project_contacts` consistent when a Program/Study
moves lives in a Postgres function, so the mock path does not have it: in mock
mode the master record moves and the project links keep the old System. The
scoped-assignment duplicate rule is likewise enforced in the domain layer for
both paths but by a database constraint only for Supabase.

This is dev-only — `isSupabaseConfigured()` is true in every real deployment —
but it means mock mode is no longer a faithful rehearsal of production
behaviour and should not be used to validate hierarchy changes.

### 3.5 Junk and near-duplicate master data in production

Departments `sfdg / dfg`; systems `adgfd / fdg`, `sfgh / sfgh`; near-duplicates "Asset Integrity" / "Asset Integrity System" and "Process Safety" / "Process Safety Studies". **The platform provides no admin path to merge or clean these** — an administrator must edit the database directly.

**Largely resolved.** The misclassified records were archived
(`20260806000006`), the duplicate project links and the `SIL` / `SIL study`
pair were consolidated (`20260809000002`), and Administration now has working
Archive / Restore / Delete on all master-data kinds plus an atomic
Department/System move. An admin no longer needs database access for ordinary
cleanup.

Two gaps remain: there is still **no merge** operation — consolidating two
records into one requires a migration, as `20260809000002` did — and
`Asset Integrity Study` and `Inspection` are still unmapped to a System
(`refs=0`), deliberately kept pending a decision.

### 3.6 Migration `20260812000001_monthly_reports.sql` is not replayable

**The live database is unaffected — this only bites a fresh environment.**

Lines 145, 151 and 156 of `eprp/supabase/migrations/20260812000001_monthly_reports.sql`
call `public.weekly_can_access_scope()` with **four** uuid arguments
(project, department, system, discipline). That function only ever exists with
**three** — defined at `20260810000002_weekly_rls.sql:126`, redefined at
`20260810000003_identity_and_admin_limits.sql:213`, and commented as
`(uuid, uuid, uuid)` at `20260810000002:183`. No four-argument overload exists
anywhere in the migration set.

The evidence says this already failed once, statement-by-statement: everything
through line 142 exists in the live database (which is why `monthly_reports_*`
and `monthly_comments_select` are absent from the repair migration), line 143
raised `function … does not exist`, and lines 147–159 never ran.
`20260812000002_monthly_rls_repair.sql` recreates exactly lines 143–159 with the
correct three-argument signature — matching its own header, "the partial
20260812000001 run".

**Consequence:** `supabase db reset`, or standing up any new environment from
migrations, **will fail** on this file. The Monthly RLS policies are correct in
the live database; they are not reproducible from the repository.

**Fix (deliberately not applied):** change the three calls in
`20260812000001` to the three-argument form. Already-applied migrations are not
re-run, so this is safe for the live database, but it rewrites migration
history and was left as an explicit decision rather than a silent edit.

### 3.7 The Monthly data model has no field for several reported values

Three values the Monthly report layout asks for have no column anywhere:

| Value | Nearest thing that exists |
|---|---|
| HSE event counts — LTI, recordable, first aid, near miss | `hse_status` only, a rating enum (`excellent`…`critical`) on `weekly_reports` and `monthly_reports` |
| Next-month "Planned % target" | Nothing |
| Numeric progress per Programme/Study or Discipline | `weekly_submissions.progress_percent`, which the Monthly scope table now reads |

The Monthly UI renders a compact "Not recorded" for the first two rather than a
placeholder number. Storing them needs an additive migration
(`monthly_reports.hse_lti` etc.), which was deferred by decision.

### 3.8 No test runner

All verification across both sprints was ad-hoc. This is the single biggest obstacle to the sprint's end condition: without automated tests, "no regressions" can only ever be asserted over the narrow slice manually exercised.

---

## 4. Brief items not addressed

| Item | Status |
|---|---|
| **#3 Old dates allowed** (delegate, assignment, approval dates) | **Not addressed.** No date validation was added or verified this sprint |
| **#5 Save & Continue** | Code-verified only — `router.push` is present on every path. **Not clicked through** |
| **#6 Synchronisation / one source of truth** | Not verified — requires writes |
| **#7 Back / Forward / Refresh** | Not verified |
| **#9 Orphan records** | Not verified |
| **#11 Stale cache** | Not verified |

---

## 5. Honest verdict

**The sprint's end condition is not met.**

What was achieved: one confirmed, reproduced, fixed and retested defect (BUG-01 — three of five master-data lists were unreachable from their own list page); a clean 52-route sweep with working negative controls; confirmation that Sprint 1's six fixes still hold; and a product and architecture audit grounded in observed behaviour.

What was not: the great majority of the CRUD, synchronisation, state, and interaction matrix, for the three blocking reasons in §1.

**Recommended next step:** stand up a test runner and a disposable test project. Together they remove blockers §1.3 and §3.6 and make a genuine full-CRUD sprint possible without risking real data.

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

### 3.4 Mock/Supabase drift, now in the opposite direction

Sprint 1 added reference checks to the Supabase service; the mock service still returns none for systems and disciplines. Mock mode now permits a delete Supabase refuses.

### 3.5 Junk and near-duplicate master data in production

Departments `sfdg / dfg`; systems `adgfd / fdg`, `sfgh / sfgh`; near-duplicates "Asset Integrity" / "Asset Integrity System" and "Process Safety" / "Process Safety Studies". **The platform provides no admin path to merge or clean these** — an administrator must edit the database directly.

### 3.6 No test runner

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

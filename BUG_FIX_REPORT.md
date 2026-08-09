# Bug Fix Report — Sprint 2

Every entry follows: **reproduce → root cause → fix → retest**.

---

## BUG-01 — Master-data rows were not navigable (FIXED)

**Severity:** High · **Class:** UI dead end / hidden broken route · Brief items **#4, #12, #13**

### Reproduce
Open `/systems`. Six rows render. Click a system name — nothing happens; it is not a link. Identical on `/disciplines` (14 rows) and `/contacts` (16 rows). `/departments` works.

Measured in the DOM:
```text
SYSTEMS row      anchors: []                     ← plain <span>
DEPARTMENTS row  anchors: ["/departments/<id>"]  ← <Link>
```

### Root cause
`src/features/master-data/components/master-data-views.tsx`. The name column rendered a `<Link>` for departments (line 44) and job titles (line 125) but a plain `<span>` for systems (73), disciplines (99) and contacts (161).

The detail and edit routes **existed and worked** the whole time — nothing linked to them. Three of five master-data lists were unreachable from their own list page.

### Fix
Name column now renders a `<Link>` to the record's detail page for systems, disciplines and contacts.

### Retest — PASS
Systems **6/6**, Disciplines **14/14**, Contacts **16/16** rows now carry a working name link. End-to-end: list → `/systems/<id>` (200) → `/systems/<id>/edit` (200).

---

## Sprint 1 fixes — regression status

Carried forward and re-verified this sprint. Full detail in `STABILIZATION_SPRINT_1_REPORT.md`.

| # | Fix | Status |
|---|---|---|
| S1-1 | `npm run lint` no longer lints build output (was 17,079 problems from `.next-verify/**`) | **Holding** — exit 0 |
| S1-2 | `npm run lint` targets `src` with `--max-warnings=0` | **Holding** |
| S1-3 | `npm run typecheck` added | **Holding** — exit 0 |
| S1-4 | Duplicate names rejected in Supabase mode (were accepted; only `departments`/`job_titles` constrain `name`, and case-sensitively) | **Holding** — code intact, 24 assertions pass |
| S1-5 | `canDelete` reference checks for Systems (had **none**), Disciplines, Departments | **Holding** — code intact |
| S1-6 | Phone validation added | **Holding** |

---

## Brief bugs — disposition

| # | Reported | Disposition |
|---|---|---|
| 1 | Duplicate names appear twice | **PARTIAL.** Identical duplicates blocked in Sprint 1. Live data contains *near*-duplicates and a misspelled person ("Mohamed Khattab" / "Mohamed Khatab") that no exact-match guard can catch — see `KNOWN_LIMITATIONS.md` |
| 2 | Delete inconsistency — records remain elsewhere | **PARTIAL.** Sprint 1 fixed `canDelete` for systems/disciplines/departments. The `project_departments.systems` jsonb column still has no foreign key and can hold a dangling id — needs a schema change |
| 3 | Old dates allowed (delegate, assignment, approval) | **NOT ADDRESSED.** Not reached this sprint |
| 4 | 404 on Edit Department; verify all Edit pages | **DID NOT REPRODUCE** as stated. Edit routes return 200 and render populated forms. BUG-01 is the likely true cause — the records could not be reached from their list |
| 5 | Save & Continue must always advance | **PASS (code-verified, not clicked).** `Project Info → Departments` pushes on both create and update paths; `saveAndContinue` advances each step. **Not exercised by clicking** |
| 6 | Synchronisation / one source of truth | **NOT VERIFIED** — requires a write |
| 7 | Back / Forward / Refresh must not corrupt workflow | **NOT VERIFIED** |
| 8 | Relationship integrity | **PARTIAL** — Sprint 1 reference checks; not re-exercised through the UI |
| 9 | No orphan records | **NOT VERIFIED** |
| 10 | No duplicated records | **PARTIAL** — see #1 |
| 11 | No stale cached data | **NOT VERIFIED** |
| 12 | No hidden broken routes | **FIXED** — BUG-01; 52-route sweep clean |
| 13 | No UI dead ends | **FIXED for master data** — BUG-01. Others not swept |

---

## Corrections I made to my own findings

Recorded because a QA report is only useful if its claims are trustworthy.

1. **Withdrew "the Actions menu is broken."** I initially reported the row Actions dropdown as non-functional after three real clicks and a MutationObserver showed it never mounts. I then tested `/departments` — a page that otherwise works completely — and it failed identically. That points at my headless interaction tooling, not the product. Re-marked **NOT VERIFIED**.

2. **Withdrew "Systems is a complete dead end."** That claim depended on the Actions menu also being broken. With the menu unverified, the accurate statement is narrower: the *name* was not a link, which is confirmed and now fixed.

3. **Discarded an invalid route sweep.** My first sweep ran unauthenticated, assuming a real route 307s and a missing one 404s. The proxy redirects before route resolution, so everything 307'd including the bogus controls — the result proved nothing. Re-ran authenticated.

---

## Gates

```text
npm run lint       exit 0
npm run typecheck  exit 0
next build         exit 0   ✓ Compiled successfully
```

**Files changed this sprint:** `src/features/master-data/components/master-data-views.tsx` only.

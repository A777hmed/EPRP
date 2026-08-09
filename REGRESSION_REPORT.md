# Regression Report — Sprint 2

Run after the BUG-01 fix (`master-data-views.tsx`).

---

## 1. Gates

```text
npm run lint       exit 0
npm run typecheck  exit 0
next build         exit 0   ✓ Compiled successfully in 10.2s
```

Built into an isolated dist directory (`NEXT_DIST_DIR=.next-verify`) because the dev server was running — a plain build replaces the routes it is serving and is the documented cause of a past 404 incident.

---

## 2. Route regression — 52 routes, zero broken

Re-verified in the authenticated session after the change.

| Group | Routes | Result |
|---|---|---|
| Core | dashboard, projects, projects/new, project detail, project edit | **PASS** |
| Setup workflow | all 6 steps (info → review) | **PASS** |
| Project sections | all 14 | **PASS** |
| Master data | departments, systems, disciplines, contacts + `/new` | **PASS** |
| Reporting | weekly, monthly, executive + `/new`, `/import` | **PASS** |
| System | comments, analytics, documents, administration, job titles, settings | **PASS** |
| **Negative controls** | `/definitely-not-real`, `setup/bogus`, `bogus-section` | **All correctly 404** |

The negative controls matter: they prove the sweep can actually detect a missing route rather than reporting success unconditionally.

---

## 3. Targeted regression on the changed component

`master-data-views.tsx` renders all five master-data lists. All five re-checked:

| List | Rows | Name links | Result |
|---|---|---|---|
| Departments | 5 | 5 / 5 | **PASS** — unchanged, still linked |
| Systems | 6 | 6 / 6 | **PASS** — fixed |
| Disciplines | 14 | 14 / 14 | **PASS** — fixed |
| Contacts | 16 | 16 / 16 | **PASS** — fixed |
| Job Titles | — | — | **PASS** — untouched code path |

**No list lost its links**, and row counts are unchanged — the fix added navigation without altering data rendering.

End-to-end chase: Systems list → `/systems/<id>` (200, "System Details") → `/systems/<id>/edit` (200, "Edit System").

---

## 4. Sprint 1 fixes — still holding

| Fix | Check | Result |
|---|---|---|
| ESLint ignores `.next-*/**` | `npm run lint` | **PASS** — exit 0 (was 17,079 problems) |
| `lint` targets `src --max-warnings=0` | script definition | **PASS** |
| `typecheck` script | `npm run typecheck` | **PASS** — exit 0 |
| Duplicate-name guard (Supabase) | code intact; 24 assertions | **PASS** |
| `canDelete` reference checks | code intact | **PASS** |
| Phone validation | code intact; assertions | **PASS** |

---

## 5. Data integrity

**No records were created, modified or deleted during this sprint.** All testing was read-only navigation plus one presentational code change. Row counts before and after are identical (Departments 5, Systems 6, Disciplines 14, Contacts 16).

---

## 6. Not regression-tested

| Area | Reason |
|---|---|
| CRUD round-trips | No writes performed |
| Cross-page synchronisation | Requires a write |
| Session / auth flows | Cannot sign in |
| Row Actions dropdown | Could not be opened — see `UI_QA_REPORT.md` §5 |
| Search, filters, pagination | Not exercised |
| Back / forward / refresh | Not exercised |

---

## 7. Verdict

**No regressions introduced.** The change is presentational, confined to one file, and every list it affects was re-verified along with the routes and the Sprint 1 fixes.

Regression *coverage* is narrow because most of the interaction matrix is `NOT VERIFIED` — see `KNOWN_LIMITATIONS.md`.

# UI QA Report — Sprint 2

**Method:** driven through the browser as a user, not read from code. Code was opened only *after* a defect was reproduced in the UI, to find its root cause.

**Verdict marks:** `PASS` verified in the UI · `FAIL` reproduced defect · `NOT VERIFIED` could not be exercised with the tooling available.

---

## 1. Environment constraint that shaped this sprint

**I cannot sign in.** Entering credentials is outside what I will do, so I worked entirely inside the session that was already open.

Consequences, stated up front:

| Requested step | Status |
|---|---|
| "Logout/Login if needed" | **NOT VERIFIED** — logging out would have ended the sprint with no way back in |
| Session expiry / token refresh behaviour | **NOT VERIFIED** |
| Role permission differences between users | **NOT VERIFIED** — one session, one role |

---

## 2. Confirmed defect — master-data rows were not navigable

**Reproduced in the UI. Fixed. Retested.**

### Reproduction

1. Open `/systems`. Six rows render.
2. Attempt to open any system. **The name is not a link.** Nothing in the row navigates.
3. Same on `/disciplines` (14 rows) and `/contacts` (16 rows).
4. `/departments` and `/administration/job-titles` behave correctly — the name *is* a link.

Measured directly in the DOM:

```text
SYSTEMS row      anchors: []                          ← plain <span>
DEPARTMENTS row  anchors: ["/departments/<id>"]       ← <Link>
```

### Root cause

`src/features/master-data/components/master-data-views.tsx` — the name column was rendered as a `<Link>` for departments (line 44) and job titles (line 125), but as a plain `<span>` for systems (73), disciplines (99) and contacts (161).

The detail and edit **routes existed and worked all along** — `/systems/<id>` and `/systems/<id>/edit` both return 200. Nothing linked to them. This is the "hidden broken route" and "UI dead end" class in the brief, and the most likely source of the reported *"404 appears — especially Edit Department"*: the user could not reach these records from their list at all.

### Fix

Name column now renders a `<Link>` to the detail page for systems, disciplines and contacts, matching departments and job titles.

### Retest — PASS

| List | Rows | Rows with a working name link |
|---|---|---|
| Systems | 6 | **6 / 6** |
| Disciplines | 14 | **14 / 14** |
| Contacts | 16 | **16 / 16** |

End-to-end chase from the list: `/systems/<id>` → **200 System Details** → `/systems/<id>/edit` → **200 Edit System**.

---

## 3. Route sweep — PASS

52 routes exercised in the authenticated session. **Zero broken.** Three negative controls (`/definitely-not-real`, `setup/bogus`, `bogus-section`) correctly returned 404, which proves the sweep can detect a missing route.

Covered: dashboard · projects · project detail/edit · all 6 setup steps · all 14 project sections · departments · systems · disciplines · contacts · weekly · monthly · executive · comments · analytics · documents · administration · job titles · settings, including every `/new` and `/import` variant.

### A false result I corrected

My first sweep ran unauthenticated on the assumption that a real route would redirect (307) and a missing one would 404. **That assumption was wrong** — the proxy redirects *before* route resolution, so everything returned 307 including the bogus controls. The result was meaningless. I re-ran authenticated, where the controls correctly 404.

---

## 4. Edit pages — PASS for the paths tested

| Page | Result |
|---|---|
| `/departments/<id>/edit` | **PASS** — form renders populated ("Asset Integrity", "AIM-001", description) |
| `/systems/<id>/edit` | **PASS** — 200, correct title |
| Project `/edit`, all 6 setup steps | **PASS** — 200, correct titles |

**The reported "Edit Department 404" did not reproduce** on any path I could reach. Given §2, my assessment is that the reported symptom was reaching an Edit page for a record that could not be opened from its list, rather than the Department edit route itself being broken.

---

## 5. NOT VERIFIED

Recorded honestly rather than assumed.

| Area | Why |
|---|---|
| **Row Actions dropdown** (View / Edit / Archive / Restore / Delete) | Could not be opened. Three real clicks plus a MutationObserver showed the menu never mounts and `aria-expanded` never changes — **but it fails identically on `/departments`, which is otherwise fully working.** That points at my headless interaction tooling, not the product. I withdrew an earlier claim that it was broken. |
| **Create / Edit / Save / Delete round-trips per page** | Requires writing and deleting real records in the live database. Not done unprompted. |
| **Search, filters, pagination** | Controls are present (`Search systems…`, `Filter by status`); behaviour not exercised. |
| **Browser back / forward / refresh across workflows** | Not exercised. |
| **Import / Export** | Services are unimplemented stubs; nothing to exercise. |
| **Responsive, keyboard nav, toasts, modals, drawers, date pickers** | Not exercised. |
| **Cross-page synchronisation after a write** | Requires a write. Not done. |
| **Database synchronisation** | Read-only probe attempted; the anon key could not be extracted from the page. |

---

## 6. Data-quality observations (live database)

Not application defects, but they are almost certainly what the *"duplicate names"* report refers to:

| Observation | Records |
|---|---|
| **Near-duplicate master data** | Departments "Asset Integrity" / "Asset Integrity System"; "Process Safety" / "Process Safety Studies". Systems "Asset Integrity Studies" / "Asset Integrity Management System" |
| **Misspelled duplicate person** | Department leads recorded as **"Mohamed Khattab"** and **"Mohamed Khatab"** — two spellings of one name |
| **Junk test records** | Department `sfdg / dfg`; systems `adgfd / fdg` and `sfgh / sfgh` |

**Important:** the duplicate-name guard added in Sprint 1 blocks *identical* names (case- and whitespace-insensitive). It does **not** and cannot block "Khattab" vs "Khatab" — those are different strings. See `KNOWN_LIMITATIONS.md`.

---

## 7. Gates

```text
npm run lint       exit 0
npm run typecheck  exit 0
next build         exit 0   ✓ Compiled successfully
```

---

## 8. Sprint end condition — NOT met

The brief's end condition requires no unresolved UI bugs and full CRUD/sync verification. **That is not achieved.** One confirmed defect was found, fixed and retested; the majority of the CRUD, synchronisation, and interaction matrix is `NOT VERIFIED`. See `KNOWN_LIMITATIONS.md` for what remains and why.

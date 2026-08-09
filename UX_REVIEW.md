# UX Review — Sprint 2

Audit of the **product**, from driving it. Ordered by user impact.

---

## 1. Three of five master-data lists were unreachable

**Severity: critical (fixed this sprint).** Systems, Disciplines and Contacts rendered the record name as inert text. A user looking at 14 disciplines had no way to open one. Departments and Job Titles linked correctly, so the platform taught the user "names are clickable" and then broke that rule on three screens.

**Fixed.** All five lists now behave identically.

**The lesson matters more than the fix:** this was a per-screen column config, hand-written five times. Four of the five differ in ways nobody intended. See `ARCHITECTURE_REVIEW.md` §2.

---

## 2. The list row has no obvious primary action

Each row exposes only a name link and an "Actions for X" overflow button. The most common intent — *open this record* — is a bare text link with no affordance beyond hover underline, and everything else is hidden behind an unlabelled overflow.

**Recommendation:** make the whole row activate the record (keyboard-focusable), and surface **Edit** inline rather than only inside the overflow. Reserve the overflow for archive/restore/delete.

---

## 3. Live data shows the platform is not defending its own quality

Visible in the current database:

- Departments `sfdg / dfg`; systems `adgfd / fdg`, `sfgh / sfgh` — junk test records sitting in production master data
- `Asset Integrity` **and** `Asset Integrity System`; `Process Safety` **and** `Process Safety Studies`
- The same person recorded as **"Mohamed Khattab"** and **"Mohamed Khatab"**

A user cannot tell which "Process Safety" to pick. That is a product failure, not a data-entry failure.

**Recommendations:**
1. **Warn on near-duplicates at entry** — when a new name is close to an existing one, show it and ask "did you mean this?" before saving. Exact-match blocking (added Sprint 1) cannot catch "Khattab" vs "Khatab".
2. **Give master data an admin cleanup path** — merge duplicates, reassign references, archive junk. Today an administrator has no way to fix this without touching the database.
3. **Make the code column carry weight.** `AIM-001` vs `AIM-002` disambiguates where names do not, but code is a secondary muted column.

---

## 4. Terminology is inconsistent with the platform's own rule

The sidebar says **Disciplines**. The documented behaviour is that this level is named by Project Type — **Programs & Studies** on PSM/PSAIM projects. Inside a PSM project the label resolves correctly; the global master-data screen does not.

**Recommendation:** the global list should either use a neutral heading or show both terms, so a PSM user is not asked to translate.

---

## 5. Navigation hierarchy is ambiguous for the same entity

Departments, Systems, Disciplines and Contacts each appear twice — once globally under *Master Data*, once inside a project. They look nearly identical but mean different things: the global list is the organizational record, the project list is that project's scope.

There is no visual signal telling the user which one they are on.

**Recommendation:** give project-scoped screens a persistent project context banner, and label the global ones explicitly (e.g. "All Departments — organization-wide").

---

## 6. Quick Actions are prominent but non-functional

The sidebar shows *Generate PDF · Generate DOCX · Email Report · Share Report* on every page. None is implemented. The top bar's Search, Messages and Notifications likewise render with no behaviour (confirmed: `top-bar.tsx` has zero click handlers).

Persistent dead controls train users to distrust the interface.

**Recommendation:** hide unimplemented actions, or render them disabled with "Coming in a later phase". Do not show a live-looking button that does nothing.

---

## 7. Information density is uneven

`/departments` shows 4 columns for 5 records; the project setup workspace carries summary cards, an inline editor and a per-department responsibilities panel on one screen. The dashboard is dense with fabricated figures while the master-data screens are sparse.

**Recommendation:** settle a standard list density and a standard detail layout, and hold every screen to it.

---

## 8. Positive findings

Worth preserving:

- **The shared component layer is genuinely good** — `SectionCard`, `EmptyState`, `StatusBadge`, `KpiCard` are used consistently and give the product a coherent feel.
- **Reduced-motion is honoured throughout** — rare, and correct.
- **The setup wizard's derived completion** (never a stored status) is the right design and survives editing by any route.
- **Accessible names are present** on icon-only controls (`Actions for Asset Integrity`), which is what made this audit possible at all.

---

## 9. Not assessed

Responsive layout, keyboard navigation, toasts, modals, drawers, date pickers, pagination and empty/loading/error states were **not exercised** — see `KNOWN_LIMITATIONS.md`.

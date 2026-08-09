# Architecture Review — Sprint 2

Findings reached from defects observed in the UI, then traced to their cause.

---

## 1. The defect class this sprint exposed: config written once per screen, then diverging

BUG-01 was not a coding mistake. It was **five hand-written column configurations** where four differ in ways nobody decided:

| List | Name is a link? |
|---|---|
| Departments | ✅ |
| Job Titles | ✅ |
| Systems | ❌ |
| Disciplines | ❌ |
| Contacts | ❌ |

The list *engine* (`master-data-list-view.tsx`, `master-data-table.tsx`) is properly generic — one table, one toolbar, one actions menu, driven by config. The **config is the duplication**, and it is where the divergence happened.

Sprint 1 found the identical pattern in the delete-reference lists: Systems had `references: []` while Departments had five entries, because the list was written before a migration added the columns and never revisited.

**Recommendation.** Derive per-kind behaviour from one declarative registry instead of five hand-written column arrays. `MASTER_KIND_CONFIG` already exists and already knows every kind's route segment, singular and plural. A name column that reads the segment from that registry cannot diverge — the bug becomes unrepresentable.

---

## 2. Duplicated business logic — the mock/Supabase pair

Two full implementations of every service are maintained at method parity by hand:

| Domain | Mock | Supabase | Total |
|---|---|---|---|
| Project | 164 | 712 | 876 |
| Weekly report | 536 | 551 | 1,087 |
| Organization chart | 710 | 633 | 1,343 |
| Master data | 623 | 258 | 881 |
| | | | **~4,200 lines** |

**This pair has now produced defects in both directions:**

- Sprint 1: duplicate-name checking existed in mock, absent in Supabase → duplicates saved in production.
- Sprint 1's own fix: reference checks added to Supabase, still absent in mock → mock now permits a delete Supabase refuses.

Two implementations of the same rules will keep drifting. **Recommendation:** either give them one shared contract test that runs both through identical cases, or retire the mock service. It exists for a phase that has passed — the platform runs on Supabase.

---

## 3. Duplicated state — three caches with no invalidation contract

Master data is cached in the service (`cache`, `snapshot`), subscribed to by `useMasterData`, and separately fetched per page. Writes call `notify()` to invalidate. Nothing enforces that a new write path calls it.

**Recommendation:** the platform has no query/cache layer — every fetch is hand-rolled `useEffect` + service call. A single data-access layer with cache invalidation as a property of the mutation, not a manual call, would remove this whole class.

---

## 4. Dead code still exported

- `services/index.ts` re-exports six stub services and is **imported by nothing**.
- Two different `departmentService` exports exist — one that throws `NotImplementedError`, one real. A wrong import fails at runtime, not compile time.

**Recommendation:** delete the barrel and the orphaned stub. It is a live footgun for a few minutes' work.

---

## 5. Validation is split across three layers with no single source

| Layer | Holds |
|---|---|
| `lib/validation.ts` | Report/project Zod schemas |
| `master-data-form.tsx` | Required, email, phone, number — built ad hoc from field config |
| Service layer | Duplicate name/code |
| Database | Some unique constraints, inconsistently |

Phone validation was missing entirely until Sprint 1 because nothing owned "what is a valid field".

**Recommendation:** define validation once per field *type* in a shared module, and have both the form and the service consume it.

---

## 6. Separation of concerns — mostly good

Genuinely sound and worth preserving: `app/` (routes) → `features/` (domain) → `services/` (data) → `lib/`/`config/`/`types/`. Feature modules are cohesive, UI is separated from data access, and `config/` holds real configuration rather than constants scattered through components.

The weak points are the two above — config duplicated per screen, and services duplicated per backend.

---

## 7. Folder organisation

One inconsistency: eight feature folders are empty `.gitkeep` placeholders (`administration`, `analytics`, `departments`, `executive-reports`, `exports`, `imports`, `monthly-reports`, `settings`) while their pages are `PlaceholderPage` stubs. They imply structure that does not exist.

**Recommendation:** remove empty folders; create them when the feature is built.

---

## 8. Testing

There is **no test runner**. Every verification in Sprints 1 and 2 was ad-hoc: compiled scripts for pure logic, browser probes for behaviour.

This is the highest-leverage architectural gap. Recommendations 1–3 all touch data integrity and are unsafe to land without tests. **A test runner should precede the next refactor**, not follow it.

---

## 9. Priority

1. **Test runner** — everything else is risky without it.
2. **Derive master-data columns from the registry** (§1) — removes the class BUG-01 belongs to.
3. **Resolve the mock/Supabase drift** (§2) — has caused defects twice.
4. **Delete the dead barrel and duplicate `departmentService`** (§4) — minutes of work.
5. **Unify validation** (§5).
6. **Introduce a data-access layer with automatic invalidation** (§3) — largest, do last.

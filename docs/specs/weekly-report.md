# Weekly Report — Implementation Specification

Status: **approved specification** · Created: 2026-07-26
Owner: Project Control / System Administrator

This document records the approved rules for the Weekly Report. It resolves
the open questions raised in
[`references/weekly-report/README.md`](../../references/weekly-report/README.md)
and governs roadmap **Phases 4–6** in
[`15_DEVELOPMENT_ROADMAP.md`](../15_DEVELOPMENT_ROADMAP.md).

Where this specification and an engineering doc or the current code disagree,
**this specification wins** (see `CLAUDE.md`). The **Gap analysis** at the end
records the known differences against the as-built implementation so they are
reconciled deliberately, not discovered mid-build.

---

## 1. Platform scope

- EPRP is an **internal EPROM multi-project engineering reporting platform**.
- The **Weekly Report is the operational source of truth**.
- **Monthly Reports compile from finalized Weekly Reports.** Monthly work is
  out of scope here (see §9), but every Weekly rule below must keep that
  compilation possible — nothing in Weekly may overwrite the history Monthly
  will later read.
- **Not in this phase:** SaaS features, public registration, payments, or
  Google Drive integration. This confirms the exclusions in
  `01_PROJECT_VISION.md` §9 and `CLAUDE.md`.

## 2. Canonical interactive Weekly Workspace sections

The interactive workspace has exactly these **13 sections, in this order**.
This resolves the numbering mismatch between the two visual references (13 vs
6 sections) in favour of the interactive workspace; the printable report is an
output view, not the model.

1. Report Header
2. Project Information
3. Weekly Workflow
4. KPI Summary
5. Executive Summary
6. Major Activities Completed
7. Department and Discipline Updates
8. Risks and Issues
9. Next Week Plan and Gantt
10. Look Ahead and Milestones
11. Comments and Collaboration
12. Supporting Documents and Attachments
13. Approval and Sign-off

Notes:

- Section 2 displays linked project master data by `projectId` — it never
  duplicates it into the report (`CLAUDE.md` rule).
- Section 10 Look Ahead horizons: next week, 2 weeks, 4 weeks, month, quarter
  (`archive/reporting-architecture-v1.md` §3).
- Sections 6, 8, 9, 10 are repeatable lists with add / edit / delete and
  validation.

## 3. Workflow

```text
Draft → Collecting → Under Review → Approved → Finalized → Locked
```

- Semantics per `04_WORKFLOW_ENGINE.md` §1: department tasks open in `Collecting`;
  a reviewer may **return** a report or submission (reason required);
  `Finalized` creates the snapshot Monthly compiles from; `Locked` is
  read-only and corrections require a **new revision** linked to the locked
  original.
- Department submissions use: `Pending | Draft | Submitted | Returned |
  Accepted` (`04_WORKFLOW_ENGINE.md` §2).

## 4. Projects, departments, and disciplines

**Master data**

- Projects and departments have **no fixed quantity**.
- Both are **editable master data, never hardcoded lists** (`CLAUDE.md` rule;
  already the pattern since master data shipped).
- The **System Administrator** can create, edit, activate, archive, and manage
  all projects and departments.
- **Authorized Project Control users** can manage reporting setup and assigned
  departments **within their authorized projects**.
- A project or department linked to any report is **never permanently
  deleted** — it is archived (safe-archive rule in `CLAUDE.md`).
- **Archived items remain visible in historical reports** but are not
  selectable for new reports by default.

**Ownership**

- **A department owns its submission.** Rows in a Weekly Report belong to
  exactly one department, and (once role enforcement lands) only that
  department's users and Project Control may edit them.
- **A department can submit multiple discipline updates.** One submission per
  department per week, containing any number of discipline-level update rows.
- **Discipline is a structured field inside department-owned records** — a
  master-data reference on the row, not the owner of the row. This resolves
  reference open question 3: the printable form's discipline-first layout is a
  presentation grouping of department-owned data, not a data-model change.

## 5. KPI and Overall Project Status

**KPI set (workspace section 4):**

| KPI | Source |
|---|---|
| Planned Progress (cumulative %) | entered / carried forward |
| Actual Progress (cumulative %) | entered / carried forward |
| Schedule Variance | **derived**: actual − planned (never stored) |
| SPI | **derived**: actual ÷ planned (never stored) |
| HSE | status rating + LTI / Recordable / First Aid / Near Miss counters |
| Open Risks | count from section 8 |
| Open Issues | count from section 8 |
| Open Actions | count of open action items |
| Man-hours | planned vs actual to date |

- **CPI is optional and displays "N/A" until financial data exists.** It must
  not silently show a fabricated value. (Resolves reference open question 5.)
- Schedule Variance and SPI stay derived from planned/actual so they can never
  drift — this is already how the schema works and it is now the rule.

**Recommended overall status** — computed from Schedule Variance (SV):

| Condition | Recommended status |
|---|---|
| SV ≥ −3% | On Schedule |
| −7% ≤ SV < −3% | Delayed |
| SV < −7% | Critical |

- The recommendation **is not final**. It is a default, shown as such.
- **Only the System Administrator and authorized Project Control users may
  manually override** the overall status. **Department users cannot** change
  it.
- A manual override **requires a reason**, and must later be recorded in the
  history/audit trail with **user and date**. Until login exists the reason is
  captured and stored with the report; attribution is completed when
  authentication lands (§7, §9).

**Calendar and carry-forward**

- The work week is **Sunday through Thursday**. Week numbering and period
  start/end, and the Next Week Plan Gantt (section 9), follow this.
- **KPI and HSE values may carry forward** from the prior Weekly Report where
  applicable (cumulative progress, man-hours, HSE counters). Carried values
  are prefilled and editable, never re-entered from scratch.

## 6. Comments

This section supersedes the current single-table `weekly_entries` flags where
they fall short (see Gap analysis).

- **Unlimited free-text local comment threads**; multiple comments **and
  replies** per entity.
- A comment may be linked to: an activity, department update, risk, issue,
  plan item, look-ahead item, document, attachment, approval, **or the report
  generally**.
- Every comment supports: **status, priority, owner, due date, attachments,
  history, resolve/reopen, Executive flag, Carry Forward flag, Include in
  Monthly flag.**
- Comment status lifecycle per `04_WORKFLOW_ENGINE.md` §5
  (`New → Open → Under Review → Action Required → In Progress → Resolved →
  Closed`, plus supporting states).
- **Original comment text is immutable** — later reports and updates link to
  it; they never overwrite it (`CLAUDE.md` rule).
- **Selected Weekly comments appear in the Monthly draft without overwriting
  Weekly history** — the flags exist so Monthly compilation (later phase) can
  read them; Weekly must write them correctly now.

## 7. Attachments and approvals

- **Documents and attachments are part of the Weekly Report** (section 12),
  and comment rows may carry their own attachments (§6). Metadata and linkage
  are in scope; the physical **Supabase Storage upload pipeline is deferred**
  (§9) — until then attachments are records with names/metadata, clearly
  marked as pending upload.
- Approval roles (section 13): **Prepared By, Reviewed By, Approved By.**
  The three columns already exist on `weekly_reports`.
- **No Admin PIN gate.** The PIN control shown in the printable reference is
  rejected (resolves reference open question 2).
- Authorization becomes **role-based after Login and permissions are
  implemented** (`04_WORKFLOW_ENGINE.md` §6: UI checks are not enough; server-side
  authorization/RLS must enforce access). Until then the workspace records
  who is named in each role without enforcing identity.

## 8. Visual-reference mapping

| Reference | Role |
|---|---|
| `references/weekly-report/images/Generated image 1 (2).png` | Interactive workspace — the canonical 13 sections |
| `Screenshot 2026-07-22 165813.png` + its consecutive screenshots (`165827`, `165840`, `165851`, `165914`) | Official EPROM printable/PDF Weekly Project Progress Report (one continuous document, Doc No. EPR-QF-PR-07) |

- **Preserve EPROM branding and the existing application shell** — sidebar,
  routing, typography, spacing, responsive behaviour (`CLAUDE.md`). The
  "PSAIM Project Management Platform" sidebar in the mockup is mockup
  dressing and must not be built.
- **Do not copy static screenshots or HTML directly.** References describe
  intent; implementation uses the existing design system and shared
  components.
- The printable report is a later **output** of the same data (PDF phase,
  deferred) — it is not a second data-entry surface.

## 9. Deferred features

Explicitly **out of scope** for the Weekly implementation phases. None of
these may be started automatically:

- Google Drive archive and QR integration (rejected for this phase — resolves
  reference open question 1)
- Login and full role enforcement (including RLS replacement of the temporary
  permissive policies)
- Email notifications
- Department Excel exchange (protected workbook per project/department/period)
- Supabase Storage upload implementation
- PDF generation (printable EPR-QF-PR-07 output)
- Monthly Report implementation
- Executive/President report

---

## Gap analysis — specification vs as-built

Recorded so implementation reconciles knowingly. "As-built" reflects the code
and migrations at the time of writing; the migrations below are **applied to
the live database**, so schema changes require **new** migrations, never edits
to applied ones.

| # | Area | As-built today | This spec requires |
|---|---|---|---|
| 1 | Report status values | **The approved six-state main workflow already exists.** `weeklyWorkflow.mainPath` in `config/workflows.ts` is exactly `draft → collecting → under_review → approved → finalized → locked`, and `canTransition` is enforced in both the mock and Supabase `changeStatus`. The additional `ReportStatus` values (`submitted`, `returned`, `rejected`, `archived`) are the **supporting states** `04_WORKFLOW_ENGINE.md` §2–3 requires — not a competing lifecycle | **No replacement needed.** The only outstanding item is that `weekly_reports.status` has no database `CHECK` constraint; adding one is optional hardening for a later phase, via a new migration |
| 2 | Workspace sections | Sections 1–4, 7 (department-level), 8 partially (entries), submission status list | All 13 sections; missing: Executive Summary, Major Activities, Next Week Plan Gantt, Look Ahead, threaded Comments, Attachments, Approval UI |
| 3 | Comments | Single `weekly_entries` table: flat rows, `include_in_monthly` only; no replies, no owner history, no attachments, no Executive/Carry-Forward flags, no resolve/reopen trail | Threaded comments per §6 with all flags and history. Needs new tables; `weekly_entries` stays for risks/issues/actions |
| 4 | Overall status values | `overall_progress_status` CHECK allows `ahead/on_track/at_risk/behind/critical`; no derivation, no override tracking | Recommended-status derivation per §5, manual override restricted by role, reason captured, audit later. Vocabulary mapping to be decided in the implementing phase (new migration) |
| 5 | Submissions | One `weekly_submissions` row per department **and** discipline | §4: department owns one submission; disciplines are rows within it. Restructure or reinterpret existing rows in a new migration |
| 6 | CPI | Not in model (SPI derived only) | Optional display-only "N/A" — no schema change until financial data exists |
| 7 | Man-hours | `man_hours_to_date` (actual only) | Planned vs actual man-hours (§5) — needs a planned column in a new migration |
| 8 | Open Actions KPI | Entries include `action_item` type | Count surfaced as a KPI tile — UI only |
| 9 | Week convention | `week_number` + period dates stored; no enforced day convention | Sun–Thu work week enforced in date pickers and Gantt |
| 10 | Audit trail | None (History section renders mock data) | Required for status overrides and approvals; arrives with Login/permissions (§9) but the reason field must be captured from day one |

## Acceptance criteria

The Weekly implementation matching this spec is done when:

1. All 13 sections exist in the workspace, in order, using the existing design
   system, and lint / type-check / production build are green.
2. A Weekly Report moves Draft → Collecting → Under Review → Approved →
   Finalized → Locked, with return-with-reason, against the live database.
3. A department submits one submission containing multiple discipline update
   rows; another department cannot edit it (enforced in UI now, by roles/RLS
   after login).
4. KPI tiles show the §5 set; SV and SPI are derived; CPI shows "N/A";
   the recommended status matches the SV thresholds and an authorized user
   can override it with a reason that is stored.
5. Comments support threads, replies, links to every §6 entity, all flags,
   and resolve/reopen — with original text immutable.
6. Archived projects/departments stay visible in historical reports and are
   excluded from new-report pickers by default.
7. A locked report is read-only and "Create New Revision" produces a linked
   successor.
8. Nothing in §9 has been started.

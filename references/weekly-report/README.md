# Weekly Report — Design References

Visual references for the Weekly Report. **Reference material only** — nothing
here has been implemented, and nothing here overrides
[`/docs`](../../docs). Where a reference and the specification disagree, the
specification wins and the difference should be raised, not silently built.

Related reading, in order: [`docs/02_REPORTING_ARCHITECTURE.md`](../../docs/02_REPORTING_ARCHITECTURE.md)
§3 (Weekly Workspace), [`docs/03_WORKFLOW.md`](../../docs/03_WORKFLOW.md) §1–3,
and [`docs/05_DEVELOPMENT_ROADMAP.md`](../../docs/05_DEVELOPMENT_ROADMAP.md)
Phase 4.

## Two different artifacts

These references describe **two separate things**. Keep them apart — they use
different section numbering and are not two views of one screen.

| | Artifact | Reference |
|---|---|---|
| **A** | Interactive Weekly Report **workspace** in the platform | `Generated image 1 (2).png` |
| **B** | Official EPROM **printable / PDF** Weekly Project Progress Report | the five `Screenshot 2026-07-22 *.png` files |

Artifact **B** is one continuous document captured in five overlapping
scrolls, in this order: `165813 → 165827 → 165840 → 165851 → 165914`.
`165851` and `165914` overlap by three comment rows.

## Files

| File | Covers |
|---|---|
| `Generated image 1 (2).png` | **Main visual reference for the interactive Weekly Report workspace.** |
| `Screenshot 2026-07-22 165813.png` | **Official EPROM printable/PDF report** — header and section 1. |
| `Screenshot 2026-07-22 165827.png` | KPI cards, planned vs actual, cumulative trend, weekly task Gantt. |
| `Screenshot 2026-07-22 165840.png` | Discipline Updates and Look-Ahead Milestones. |
| `Screenshot 2026-07-22 165851.png` | Next Week Plan Gantt, Comments, Attachments. |
| `Screenshot 2026-07-22 165914.png` | Comments, Include in Monthly, Monthly Report Tray, approvals, signatures. |

### A — Interactive workspace (`Generated image 1 (2).png`)

Full-page mockup with a left sidebar and **13 numbered sections**:

1. Report header — Record ID, Week No., Reporting Period, Prepared By, Status
2. Project Information
3. Weekly Report Workflow — Draft → Collecting → Under Review → Approved →
   Finalized → Locked
4. Progress Summary — Planned, Actual, Schedule Variance, SPI, CPI, HSE
   Status, Open Risks, Open Issues
5. Executive Summary — rich-text editor
6. Major Activities Completed
7. Department / Discipline Updates
8. Risks & Issues
9. Next Week Plan
10. Look Ahead — next week / 2 weeks / 4 weeks / month / quarter
11. Comments / Collaboration — with `Executive` and `Include in Monthly` flags
12. Supporting Documents and Attachments
13. Approval / Sign-off

The six workflow states match `docs/03_WORKFLOW.md` §1 exactly.

> The mockup's sidebar is branded "PSAIM Project Management Platform". That is
> mockup dressing, not a branding change — the platform's existing EPROM
> sidebar, navigation and design system are preserved per `CLAUDE.md`.

### B — Printable EPROM report (five screenshots)

Doc No. **EPR-QF-PR-07 · Rev 00**, footer "One Team. One Goal. Operational
Excellence." · `www.eprom.com.eg` · **Page 1 of 1**. Six numbered sections:

1. **Report Information** — fields marked `AUTO` vs `EDITABLE`
2. **Key Performance Indicators** — planned vs actual %, Schedule Variance
   gauge, man-hours, HSE counters; cumulative planned-vs-actual trend;
   tasks-completed donut; 6-week task Gantt
3. **Discipline Update** — one free-text row plus status per discipline
4. **Look-Ahead Milestones (next 2 weeks)** — milestone, target date, owner
5. **Next Week Plan — Gantt** — per-day bars across the Sun–Thu work week
6. **Comments & Attachments** — categorised rows; ★ marks *include in Monthly*

Then: **Monthly Report Tray** (lists ★ items, "Copy monthly summary"),
**Admin Upload** (PIN + "Approve & Upload to Google Drive", state trail
Draft saved → Approved → Uploaded), and **Prepared / Reviewed / Approved by**
signature blocks.

## Behaviour visible in the references

Worth capturing before implementation, but **not yet agreed**:

- **Status auto-derives from Schedule Variance** — `≥ -3%` On Schedule,
  `≥ -7%` Delayed, below → Critical.
- **Carry-forward** — planned/actual %, man-hour variance and HSE counters
  carry forward from the previous week automatically.
- **Cumulative trend builds as each week is saved.**
- **CPI** appears in the workspace; `docs` and the current model define SPI only.
- **Work week is Sun–Thu.**

## Open questions to resolve before building

1. **Google Drive archive** — the printable report shows a QR code to a Drive
   folder and an "Approve & Upload to Google Drive" action. Integrations are
   deferred in `docs/01_PROJECT_VISION.md` §9, and `CLAUDE.md` forbids SaaS
   features. Needs an explicit decision.
2. **Admin PIN** — a PIN gate for approval conflicts with the role-based
   access and server-side authorization described in `docs/03_WORKFLOW.md` §6.
3. **Discipline-based updates** — the printable form is organised by
   *discipline*; the implemented `weekly_submissions` model is organised by
   *department* with an optional discipline. Reconcile before building.
4. **Section numbering differs** between artifacts A (13) and B (6). Neither
   matches the other; pick one canonical order for the data model.
5. **CPI** — add to the model, or drop from the design.

## `source/`

Currently empty. Intended for the editable originals behind these images —
HTML, Figma exports, or the original PDF/DOCX of `EPR-QF-PR-07` — so the
references can be regenerated rather than re-screenshotted.

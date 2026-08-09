# EPRP Documentation

## What this is

This folder is the canonical documentation for the EPROM Progress Report platform. It lives at the repository root, next to `CLAUDE.md`; the application is in `eprp/`. There is no other documentation location.

The product is an internal Enterprise Project Control Platform for multiple projects. It collects updates from project departments, turns approved Weekly Reports into Monthly Reports, and produces a professional Executive Summary covering all projects.

## How to use it

### For Claude Work

Ask Claude Work to review these documents and identify contradictions, missing requirements, and risks. It should review and recommend; it should not change application code unless explicitly asked.

### For Claude Code

Give Claude Code one implementation phase at a time and begin with:

```text
Read CLAUDE.md and all documents under docs/ before changing code.
Implement only the requested phase. Preserve existing working features.
```

Check the status table in `15_DEVELOPMENT_ROADMAP.md` first — several phases are
partially complete, and finishing them matters more than starting new ones.

### For the project owner

You do not need to understand every technical detail. Confirm the business behavior, review the result in the browser, and approve each phase before moving on.

## The canonical sequence

One numbered sequence. One authoritative document per topic. No duplicate prefixes.

| # | Document | Authority | Status |
|---|---|---|---|
| 00 | `00_README.md` | This map | ✅ Written |
| 01 | `01_PROJECT_VISION.md` | **What the platform is** — complete product scope | ✅ Written |
| 02 | `02_PLATFORM_ARCHITECTURE.md` | **Who owns what** — tiers, ownership, hierarchy, isolation, permission architecture | ✅ Written |
| 03 | `03_REPORTING_ARCHITECTURE.md` | **How reporting works** — the Weekly → Monthly → Executive engine | ✅ Written |
| 04 | `04_WORKFLOW_ENGINE.md` | Report states, submission, review, approval, revisions | ✅ Written |
| 05 | `05_PERMISSION_MODEL.md` | Roles, scope, responsibility, delegation | ✅ Written |
| 06 | `06_DATABASE_SCHEMA.md` | The concrete schema | ⬜ Not yet written |
| 07 | `07_UI_UX_GUIDELINES.md` | Interface standards and patterns | ⬜ Not yet written |
| 08 | `08_DASHBOARD_ARCHITECTURE.md` | Company, Portfolio, Project, Department, Personal and Chairman dashboards | ✅ Written |
| 09 | `09_NOTIFICATION_ENGINE.md` | Notification Center — events and delivery | ⬜ Not yet written |
| 10 | `10_MEETING_AND_CALENDAR.md` | Meeting Center and Calendar | ⬜ Not yet written |
| 11 | `11_STORAGE_AND_DOCUMENTS.md` | Report Center, Knowledge Center, Drive Archive | ⬜ Not yet written |
| 12 | `12_REPORT_GENERATION.md` | Executive Report composition and A4 output | ✅ Written |
| 13 | `13_ANALYTICS_AND_KPI.md` | Analytics, KPIs, Risk and Criticality matrices | ⬜ Not yet written |
| 14 | `14_AI_AND_AUTOMATION.md` | AI-ready architecture and automation | ⬜ Not yet written |
| 15 | `15_DEVELOPMENT_ROADMAP.md` | **Current status, implementation order, acceptance checks** | ✅ Written |

### Where unwritten topics are covered today

Nothing is missing — the eight unwritten documents will expand material that already
exists in the canonical set. Until they are written, these sections govern:

| Planned document | Currently authoritative |
|---|---|
| `06_DATABASE_SCHEMA.md` | `02_PLATFORM_ARCHITECTURE.md` §20 (entity ownership) |
| `07_UI_UX_GUIDELINES.md` | `01_PROJECT_VISION.md` §14 |
| `09_NOTIFICATION_ENGINE.md` | `02_PLATFORM_ARCHITECTURE.md` §18 · `03_REPORTING_ARCHITECTURE.md` §22 |
| `10_MEETING_AND_CALENDAR.md` | `02_PLATFORM_ARCHITECTURE.md` §17 · `03_REPORTING_ARCHITECTURE.md` §23 |
| `11_STORAGE_AND_DOCUMENTS.md` | `02_PLATFORM_ARCHITECTURE.md` §15–§16 · `03_REPORTING_ARCHITECTURE.md` §15, §19 |
| `13_ANALYTICS_AND_KPI.md` | `02_PLATFORM_ARCHITECTURE.md` §14 · `03_REPORTING_ARCHITECTURE.md` §20 |
| `14_AI_AND_AUTOMATION.md` | `01_PROJECT_VISION.md` §15 |

## Supporting material

Not part of the numbered sequence, and never authoritative over it.

| Location | Purpose |
|---|---|
| `specs/weekly-report.md` | Weekly Report content specification — detail beneath `03_REPORTING_ARCHITECTURE.md` §4 |
| `engineering/` | **As-built** references describing what exists in code today |
| `archive/` | Superseded documents, retained for reference only |

| File | Purpose |
|---|---|
| `engineering/architecture.md` | Folder layout, conventions, current route map |
| `engineering/report-workflows.md` | The status lifecycle as configured in code |
| `engineering/permissions-matrix.md` | The role/permission matrix as configured in code |
| `engineering/phase-4c-audit.md` | Historical audit from 2026-07-17, superseded |
| `archive/reporting-architecture-v1.md` | Superseded by `03_REPORTING_ARCHITECTURE.md` |

### Specification versus as-built

The numbered sequence is the **specification**: what the product must do.
`engineering/` describes what exists in code today.

Where the two disagree, the specification wins. Two such gaps are open today:
the code has a 10-state report lifecycle against the canonical states in
`03_REPORTING_ARCHITECTURE.md` §8.1 and `04_WORKFLOW_ENGINE.md`, and its role
names differ from `05_PERMISSION_MODEL.md` §8. Both are roadmap work.

Each architecture document ends with an **Open reconciliations** table listing
its own known gaps. Those tables, not this file, are the working record.

## Important product decisions

- The platform is the primary source of truth.
- Department users normally enter data in the platform through a restricted task or secure link.
- Department-specific Excel is supported for offline/external exchange and is imported after validation.
- A Weekly Report is the main operational input.
- A Monthly Report combines finalized Weeklies and can also contain new Monthly comments.
- The Executive Report uses approved, selected, high-value information rather than every raw comment.

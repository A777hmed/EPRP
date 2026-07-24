# EPRP Documentation

## What this is

This folder is the canonical documentation for the EPROM Progress Report platform. It lives at the repository root, next to `CLAUDE.md`; the application is in `eprp/`. There is no other documentation location.

The product is an internal engineering progress platform for multiple projects. It collects updates from project departments, turns approved Weekly Reports into Monthly Reports, and produces a professional Executive Report covering all projects.

## How to use it

### For Claude Work

Ask Claude Work to review these documents and identify contradictions, missing requirements, and risks. It should review and recommend; it should not change application code unless explicitly asked.

### For Claude Code

Give Claude Code one implementation phase at a time and begin with:

```text
Read CLAUDE.md and all documents under docs/ before changing code.
Implement only the requested phase. Preserve existing working features.
```

Check the status table in `05_DEVELOPMENT_ROADMAP.md` first — several phases are
partially complete, and finishing them matters more than starting new ones.

### For the project owner

You do not need to understand every technical detail. Confirm the business behavior, review the result in the browser, and approve each phase before moving on.

## Document map

| File | Purpose |
|---|---|
| `01_PROJECT_VISION.md` | What the platform is and who it serves |
| `02_REPORTING_ARCHITECTURE.md` | How Weekly, Monthly, comments, Excel, and Executive Reports connect |
| `03_WORKFLOW.md` | Report states, department submission, review, approval, and revisions |
| `04_EXECUTIVE_REPORT.md` | The professional company-president report and portfolio dashboard |
| `05_DEVELOPMENT_ROADMAP.md` | **Current status, implementation order, and acceptance checks** |

### Specification versus as-built

Files `01`–`05` are the **specification**: what the product must do.

`engineering/` holds **as-built** references describing what exists in code today:

| File | Purpose |
|---|---|
| `engineering/architecture.md` | Folder layout, conventions, current route map |
| `engineering/report-workflows.md` | The status lifecycle as configured in code |
| `engineering/permissions-matrix.md` | The role/permission matrix as configured in code |
| `engineering/phase-4c-audit.md` | Historical audit from 2026-07-17, superseded |

Where the two disagree, the specification wins. Two such gaps are open today:
the code has a 10-state report lifecycle against the 6 states in `03_WORKFLOW.md`,
and its role names differ from §6 of the same file. Both are Phase 7 work.

## Important product decisions

- The platform is the primary source of truth.
- Department users normally enter data in the platform through a restricted task or secure link.
- Department-specific Excel is supported for offline/external exchange and is imported after validation.
- A Weekly Report is the main operational input.
- A Monthly Report combines finalized Weeklies and can also contain new Monthly comments.
- The Executive Report uses approved, selected, high-value information rather than every raw comment.


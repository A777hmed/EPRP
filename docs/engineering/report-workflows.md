# Report Workflows

Defined in [`eprp/src/config/workflows.ts`](../../eprp/src/config/workflows.ts). Pure configuration — services enforce these transitions once the database phase lands.

> **As-built reference.** This records the 10-state lifecycle in the code
> today. The intended business lifecycle is in
> [`../03_WORKFLOW.md`](../03_WORKFLOW.md) and is shorter (6 states for
> Weekly) — reconcile them in Phase 7.

## Shared status vocabulary

`draft, collecting, submitted, under_review, approved, finalized, locked, returned, rejected, archived` (see `ReportStatus` in `src/types/core.ts`). Monthly reports add two stages: `auto_compiled`, `department_review`.

## Weekly

```
draft → collecting → under_review → approved → finalized → locked
                          │  ▲
                 returned ◄┘  └─ (returned → collecting)
```

- Editable in: `draft`, `collecting`, `returned`
- `under_review` can also `reject`; rejected/locked reports can be `archived`

## Monthly

```
draft → auto_compiled → department_review → under_review → approved → finalized → locked
```

- `auto_compiled`: system builds the draft from approved weekly reports (`monthlyReportService.compileFromWeeklies`)
- Returns go back to `department_review`
- Editable in: `draft`, `auto_compiled`, `department_review`, `returned`

## Executive

```
draft → under_review → approved → finalized → locked
```

- Returns go back to `draft`; editable in `draft`, `returned`

## API

- `canTransition(type, from, to)` — validate a status change
- `isEditableStatus(type, status)` — gate edit UI and services
- `reportWorkflows[type].mainPath` — render status timelines

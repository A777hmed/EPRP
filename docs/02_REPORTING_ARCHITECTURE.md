# Reporting Architecture

## 1. Core rule

Weekly Reports are the operational source of truth. Monthly Reports compile approved Weekly data. Executive Reports compile approved project and Monthly information for leadership.

## 2. Reporting chain

```text
Project setup
   ↓
Weekly department updates
   ↓
Weekly review and finalization
   ↓
Monthly compilation + new Monthly comments
   ↓
Project Executive Report
   ↓
Portfolio / company-president report
```

## 3. Weekly Workspace

The Weekly Report is an editable project workspace, not a disconnected document. It should preserve the existing Weekly design and contain:

- Report header and project information.
- Workflow lifecycle.
- KPI and progress summary.
- Executive Summary.
- Major Activities Completed.
- Department/Discipline Updates.
- Risks and Issues.
- Next Week Plan.
- Look Ahead (next week, 2 weeks, 4 weeks, month, or quarter).
- Collaboration and local comments.
- Documents and attachments.
- Approval and history.

Each repeatable list supports add, edit, delete, validation, and later database persistence.

## 4. Department data ownership

When a Weekly enters `Collecting`, the system creates a submission task for every department assigned to the project. A department user sees only the project/department data authorized for them. Project Control sees all submissions and their status.

Department updates may include:

- Progress and current status.
- Completed activities and achievements.
- Delays, constraints, risks, and issues.
- Next Week Plan and Look Ahead.
- Free-text comments and attachments.
- Decisions or support required.

## 5. Platform and Excel paths

### Default: platform submission

The user receives an in-app task and optional email with a secure link. The link opens the correct project and department context.

### Exception: department-specific Excel

The system can generate one protected workbook for a specific `Project + Department + Reporting Period`. It contains only authorized information, prefilled project metadata, open/carried-forward comments, and editable department rows. Project Control uploads the completed file, validates it, reviews a preview, and confirms the import.

Excel is never allowed to silently overwrite approved data.

## 6. Comment architecture

There are two related concepts:

### Local comment thread

An unlimited discussion attached to an activity, department update, risk, issue, plan, look-ahead item, document, attachment, approval, or general report.

### Comment Register

A master record for an important item that persists across Weekly and Monthly Reports. It has status, owner, priority, due date, latest update, history, `includeInMonthly`, `executive`, and `carryForward` flags.

The original text remains unchanged. Later reports add a linked update instead of overwriting history.

## 7. Monthly compilation

For a selected project and month, the system collects finalized Weeklies in that period and creates a Monthly Draft containing:

- Progress trend and planned-vs-actual information.
- Major achievements and completed activities.
- Open risks, issues, actions, HSE, and quality data.
- Comments marked `Include in Monthly`.
- Open carried-forward comments.
- Next Month Plan and relevant Look Ahead items.

The Monthly Report also supports unlimited new comments written directly in Monthly. Monthly edits must not rewrite the original Weekly snapshot.

## 8. Executive compilation

Only approved/finalized information and comments marked for Executive use should appear in the Executive Report. Project Control can edit the narrative draft before finalization.

## 9. Data relationships

At a minimum, the data model needs relationships for:

```text
Project
 ├── Departments / Systems / Disciplines / Contacts
 ├── Weekly Reports
 │    ├── Department submissions
 │    ├── Activities
 │    ├── Risks / Issues / Actions
 │    ├── Comments and links
 │    └── Attachments
 ├── Monthly Reports
 └── Executive Reports
```

All report records must retain `projectId`, creator, timestamps, status, and revision/history information.


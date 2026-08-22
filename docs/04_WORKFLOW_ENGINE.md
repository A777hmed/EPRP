# Workflow Engine

> Report states, department submission, review, approval, and revisions. This is
> the operating detail beneath [`03_REPORTING_ARCHITECTURE.md`](03_REPORTING_ARCHITECTURE.md)
> §8–§12, which is authoritative on the canonical lifecycle.

> **Locked decisions.** Who may perform each transition below, and who may read
> a report in each state, are governed by
> [`02_PLATFORM_ARCHITECTURE.md` §24](02_PLATFORM_ARCHITECTURE.md#24-locked-decisions--p0-architecture-review-2026-08-20).
> The rules are not restated here — §24 governs. In particular: transitions are
> enforced at the data boundary (§24.5), a department's raw submission content
> becomes readable platform-wide only from **Approved** onward (§24.2.1), and
> submission authority (Department Manager or active Delegate) is never the
> same authority as approval (project consolidator) (§24.3).

## 1. Weekly lifecycle

```text
Draft → Collecting → Under Review → Approved → Finalized → Locked
```

### Draft

Project Control creates the report, selects project/week/dates, and prepares the required sections.

### Collecting

Department tasks are open. Each department saves a draft or submits its update.

### Under Review

Project Control and the assigned reviewer inspect submissions, comments, risks, and data quality.

### Approved

The authorized approver accepts the report content.

### Finalized

The system creates the final report snapshot and makes it available for management output.

### Locked

The report is read-only. A correction creates a new revision while preserving the locked version.

## 2. Submission statuses

Each department submission uses:

```text
Pending | Draft | Submitted | Returned | Accepted
```

Project Control must be able to see missing, late, submitted, returned, and accepted departments.

## 3. Return and correction

When a reviewer returns a submission, a reason is required. The department can edit and resubmit. The history retains the return reason and previous submission event.

## 4. Monthly lifecycle

```text
Draft → Collecting → Under Review → Approved → Finalized → Locked
```

The Monthly Draft is generated from finalized Weekly Reports. Project Control can add new Monthly comments and edit the Monthly narrative without changing source Weeklies.

## 5. Comment status lifecycle

```text
New → Open → Under Review → Action Required → In Progress → Resolved → Closed
```

Possible supporting states include `Pending`, `Waiting for Response`, `On Hold`, `Cancelled`, and `Reopened`.

## 6. Permissions summary

| Role | Main access |
|---|---|
| Admin | All projects, master data, users, configuration |
| Project Control | Create, collect, review, compile, finalize reports |
| Department Lead/User | Assigned project/department updates only |
| Reviewer | Review, comment, return, recommend approval |
| Approver | Approve, reject, finalize |
| Executive | Read-only approved executive views |
| External Contributor | Assigned secure submission or imported workbook |

UI checks are not enough; server-side authorization/RLS must enforce access.

## 7. Email and secure links

Email is primarily a notification channel. A message should contain project, period, department, deadline, and a secure link to the assigned task. A secure link must not grant access to other projects or departments.

## 8. Locking and revisions

Approved or locked reports cannot be edited in place. Use `Create New Revision`, link it to the prior report, and preserve the original snapshot and audit trail.


# Permission Model — Collaboration and Approvals

> Role definitions, scope, responsibility, and delegation. This is the operating
> detail beneath [`02_PLATFORM_ARCHITECTURE.md`](02_PLATFORM_ARCHITECTURE.md)
> §8–§9, which is authoritative on the permission architecture.

Status: **approved operating model** · Created: 2026-08-01
Owner: Project Control / System Administrator

This document records the approved rules for **who does what** across Weekly,
Monthly, and Executive reporting: department supervision, delegation,
coordinator assignment, approval authority, comment governance, and the
notification events that follow from them.

It governs roadmap **Phases 6, 7, 9, and 10** in
[`15_DEVELOPMENT_ROADMAP.md`](15_DEVELOPMENT_ROADMAP.md). It sits alongside
[`specs/weekly-report.md`](specs/weekly-report.md), which defines the
Weekly Report's *content*; this document defines its *people and permissions*.

Where this document and an engineering reference or the current code disagree,
**this document wins** (see `CLAUDE.md`). It also **supersedes parts of
[`04_WORKFLOW_ENGINE.md`](04_WORKFLOW_ENGINE.md) §6** — the differences are listed in
§7 *Reconciliation* rather than applied silently, so each one is changed
deliberately.

Nothing here is implemented. This is a specification.

---

## 1. Weekly reporting

### 1.1 Department Engineer

The Department Engineer is the person who enters the work.

- Enters their department's updates, activities, risks, issues, and actions
  for the reporting week.
- Adds **unlimited comments** on any item they can see within their scope.
- Saves a Draft as often as needed; a Draft may be incomplete.
- Submits the department's input to the Department Lead.
- Sees **only** the projects and departments assigned to them. A Department
  Engineer in one department can never read or edit another department's
  submission.

### 1.2 Department Lead

The Department Lead supervises one department on one project.

- Everything a Department Engineer can do, within the same department scope.
- **Supervises their department's engineers**: may add, edit, soft-delete,
  restore, and review comments authored by anyone in that department.
- **Approves the department's Weekly submission.** This approval is what
  releases the submission to Project Control. Until it happens, Project
  Control sees the department as outstanding, not as submitted.
- May **return** the submission to the engineer with a required reason. The
  return reason and the previous submission event are both preserved.
- May **delegate** their responsibility temporarily (§1.3).

A department's submission cannot skip the Lead. If a department has no active
Lead and no active delegate, its submission is blocked and Project Control is
notified — the platform must not silently promote an engineer.

### 1.3 Temporary delegation

A Department Lead may hand their responsibility to another authorized person
for a bounded period — leave, travel, secondment, or vacancy cover.

Every delegation records:

| Field | Rule |
|---|---|
| Delegated **from** | The Lead giving up the responsibility |
| Delegated **to** | Must already be an authorized platform user |
| **Project scope** | One or more projects; never "all projects" implicitly |
| **Department scope** | One or more departments within those projects |
| **Start date** | Required |
| **End date** | Required — an open-ended delegation is not allowed |
| **Reason** | Required free text |
| **Audit history** | Who created, changed, revoked, or expired it, and when |

Rules:

- A delegation grants the delegate the Lead's authority **only** inside the
  stated project/department scope and **only** between the start and end dates.
- Outside that window the delegate reverts to their own role automatically. No
  manual clean-up step, and no permission may outlive its end date.
- The original Lead keeps their own authority unless the delegation is marked
  exclusive. Both may act; every action records the **acting user**, and where
  authority came from a delegation, the delegation id is recorded with it.
- Delegations are never deleted. Revoking one sets an end and preserves the
  record.
- Only a System Administrator or Project Control Admin may create a delegation
  that crosses departments; a Lead may only delegate what they themselves hold.

### 1.4 Reporting Coordinator

- **One or more** Reporting Coordinators collect Weekly submissions for the
  projects assigned to them.
- A Coordinator may cover several projects; a project may have several
  Coordinators. This is a many-to-many assignment.
- The Coordinator chases outstanding departments, checks completeness, and
  hands the assembled Weekly to Project Control. The Coordinator does **not**
  finalize or lock.
- **Project Control Admin assigns each Reporting Coordinator to one or more
  projects.** A Coordinator has no authority on a project they are not
  assigned to.

> The current data model has a single `reportingCoordinatorId` contact field on
> the project. That field is the *named* coordinator for the printed report; it
> is not an access assignment and does not replace this.

### 1.5 Project Control Admin

- Creates the reporting cycle and opens `Collecting`.
- Assigns Reporting Coordinators to projects.
- **Reviews, returns, finalizes, and locks** the Weekly Report.
- Sees every department's submission status: missing, late, draft, submitted,
  returned, approved.
- A returned Weekly requires a reason, exactly as a returned submission does.

### 1.6 Project Manager

- **Normally an observer during Weekly reporting.** The Project Manager reads
  the Weekly, its departments, and its comments, and may comment.
- The Project Manager does **not** approve the Weekly Report in the normal
  flow. Their approval authority is at Monthly and final-report level (§2).
- A project may have **more than one Project Manager** (§3.5). Observer access
  applies to each of them.

---

## 2. Monthly and final reporting

- **Monthly Reports compile approved/finalized Weekly information.** A Weekly
  that is not at least Approved never reaches a Monthly compilation.
- **Project Control prepares the Monthly draft** — compiles from the period's
  Weeklies, writes the Monthly narrative, and adds Monthly-only comments.
  Monthly editing never rewrites the Weekly snapshot it came from.
- **The Project Manager approves the Monthly Report and the final project
  report.** This is the Project Manager's primary approval authority.
- **The approved Monthly Report feeds the executive/chairman portfolio
  report.** Only approved and finalized information reaches it.
- **Executive/chairman access is read-only by default.** An executive reads
  portfolio and project Executive Reports. Any authoring or finalizing of
  executive content is a Project Control responsibility unless a System
  Administrator explicitly grants otherwise.

---

## 3. Administration and flexibility

### 3.1 Job titles are master data

- The System Administrator can **add, edit, deactivate, and archive** job
  titles.
- Job titles are **flexible and organisation-specific**. Examples:
  Project Manager, Asset Integrity Manager, PSM Manager, Project Controls
  Engineer. The list is illustrative, never hardcoded.
- Archive/deactivate follows the existing safe master-data rule: a job title
  already referenced by a person or a report stays visible in history and is
  removed from new pickers rather than deleted.

### 3.2 Job titles are not permissions

**A job title describes what a person is called. A platform role describes what
they may do.** The two are deliberately separate:

- Two people with the job title "Project Controls Engineer" may hold different
  platform roles.
- A person's job title may change without any change to their access.
- No permission check may ever read a job title.

### 3.3 What the System Administrator controls

- Platform roles and permission templates.
- Workflow configuration (which transitions exist and who may perform them).
- Project assignments — which users belong to which projects.
- Department assignments — which users belong to which departments, and in
  what capacity.
- Delegation rules — who may delegate, to whom, and within what limits.
- Job titles (§3.1).

### 3.4 Departments differ from one another

Departments are not uniform. The model must allow, per project and department:

- Different users and different numbers of users.
- A different Lead, or a shared Lead across two departments.
- Different reporting responsibilities — some departments submit weekly,
  others do not.
- Different approval requirements — a department may require Lead approval, or
  be configured to submit directly where the organisation has agreed to that.

Nothing in the platform may assume every department behaves the same way.

### 3.5 A project may have multiple responsibility holders

A project may have **more than one Project Manager**, and the same is true for
other responsibilities. Responsibility is therefore a **list**, not a column:

- Multiple Project Managers on one project.
- Multiple Reporting Coordinators (§1.4).
- Multiple reviewers or approvers where the organisation requires it.
- The same person holding a responsibility on several projects.

---

## 4. Comments and notifications

### 4.1 Comment scope

**Unlimited comments** are allowed on each of:

- a project
- a department
- a Weekly section
- an activity
- a risk
- an issue
- an action
- a report (Weekly, Monthly, or Executive)

### 4.2 Comment history is preserved

- Original comment text is **immutable**. An edit stores a new version and
  keeps the previous one; it never overwrites.
- The full history of a comment is readable by anyone who can read the comment.

### 4.3 Soft delete and restore

- Deleting a comment **soft-deletes** it: the row remains, marked deleted, with
  who deleted it and when.
- A soft-deleted comment can be **restored**.
- **Comments are never permanently deleted in normal use.** Hard deletion is
  reserved for a System Administrator acting on a legal or data-protection
  request, and is itself audited.

### 4.4 Comment activity is attributed

Every comment records who **created**, **edited**, **deleted**, **restored**,
**reviewed**, and **approved** it, with a timestamp for each event. Where the
actor was acting under a delegation (§1.3), the delegation is recorded too.

### 4.5 Notification events (future)

Notifications are **not** part of this document's implementation scope — they
are Phase 7 work and nothing may be sent until then. When built, they must
cover at least:

| Event | Typical recipients |
|---|---|
| Comment added, edited, or replied to | Item owner, department Lead, mentioned users |
| Comment soft-deleted or restored | Department Lead, comment author |
| Department submission submitted | Department Lead, Reporting Coordinator |
| Submission or report **returned** (with reason) | Author, Department Lead |
| Department submission **approved** by the Lead | Reporting Coordinator, Project Control |
| Weekly finalized or locked | Project Manager, Reporting Coordinator |
| Monthly approved | Project Control, Executive readers |
| **Delegation** created, starting, ending, or revoked | Delegator, delegate, Project Control |
| **Overdue** reporting | Department Engineer, Department Lead, Reporting Coordinator |

---

## 5. Required future data concepts

These are the concepts the model needs. **No table, column, or migration is
being specified or created here** — schema design belongs to the implementing
phase.

| # | Concept | Purpose |
|---|---|---|
| 1 | **Project user assignments** | Which users belong to which projects, and in what capacity. Replaces "everyone sees every project". |
| 2 | **Department user assignments** | Which users belong to which departments within a project, and whether they are Engineer or Lead. |
| 3 | **Project responsibilities** | Multi-holder responsibilities per project (Project Manager, Reporting Coordinator, reviewer, approver) — §3.5. |
| 4 | **Temporary delegations** | From, to, project scope, department scope, start, end, reason, audit history — §1.3. |
| 5 | **Flexible job titles** | Admin-managed master data with add / edit / deactivate / archive, separate from roles — §3.1–3.2. |
| 6 | **Comment activity history** | Immutable original text, version history, soft-delete/restore state, and created / edited / deleted / restored / reviewed / approved attribution — §4. |
| 7 | **Notification events** | The event log the notification channel reads from, covering §4.5. |

All seven must carry `projectId` where project-scoped, and must preserve
history rather than overwrite it — both existing `CLAUDE.md` rules.

---

## 6. Weekly workflow diagram

```text
  DEPARTMENT ENGINEER            DEPARTMENT LEAD            REPORTING COORD.        PROJECT CONTROL ADMIN
  ───────────────────            ───────────────            ────────────────        ─────────────────────
                                                                                    opens the cycle
                                                                                          │
                                                                                    ┌─────▼──────┐
                                                                                    │ Collecting │
                                                                                    └─────┬──────┘
  enters updates,                                                                         │
  activities, risks,   ◄─────────────────────────────────────────────────────────────────┘
  issues, comments
        │
        ▼
   ┌─────────┐   submit    ┌───────────┐
   │  Draft  │ ──────────► │ Submitted │
   └─────────┘             └─────┬─────┘
        ▲                        │
        │   return (reason)      ▼
        └──────────────── [ Lead reviews ]
                                 │
                    ┌────────────┴────────────┐
                    │                         │
              return (reason)          APPROVE submission
                    │                         │
                    └──► back to engineer     ▼
                                        ┌──────────┐   collected by   ┌──────────────┐
                                        │ Approved │ ───────────────► │  Weekly is   │
                                        │  by Lead │                  │  assembled   │
                                        └──────────┘                  └──────┬───────┘
                                                                             │
                                    ( Lead may delegate this authority ──────┤
                                      temporarily — §1.3 )                   ▼
                                                                    [ Project Control ]
                                                                             │
                                                        ┌────────────────────┼───────────────┐
                                                        │                    │               │
                                                   return (reason)      Under Review    ─► Approved
                                                        │                                    │
                                                        └──► back to department              ▼
                                                                                        Finalized
                                                                                             │
                                                                                             ▼
                                                                                          Locked
                                                                                   (read-only; a
                                                                                    correction needs
                                                                                    a new revision)

  PROJECT MANAGER: observer throughout — reads and comments, does not approve.
```

The report-level lifecycle is unchanged from
[`04_WORKFLOW_ENGINE.md`](04_WORKFLOW_ENGINE.md) §1:

```text
Draft → Collecting → Under Review → Approved → Finalized → Locked
```

What this document adds is the **department-level approval gate** that must
close before a submission reaches Project Control.

## 7. Monthly and Executive workflow diagram

```text
   Approved / Finalized Weekly Reports
   (only these — an unapproved Weekly never compiles)
                    │
                    ▼
        ┌───────────────────────┐
        │  PROJECT CONTROL      │  compiles the period's Weeklies,
        │  prepares Monthly     │  writes the narrative, adds
        │  draft                │  Monthly-only comments
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐      return (reason)
        │  PROJECT MANAGER      │ ──────────────────────► back to Project Control
        │  approves Monthly     │
        └───────────┬───────────┘
                    │ approved
                    ▼
        ┌───────────────────────┐
        │  Monthly Finalized    │  snapshot preserved
        │  → Locked             │
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │  PROJECT MANAGER      │
        │  approves the final   │
        │  project report       │
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │  Executive / Chairman │  portfolio report, compiled by
        │  portfolio report     │  Project Control from approved
        └───────────┬───────────┘  Monthly information only
                    │
                    ▼
            EXECUTIVE / CHAIRMAN
            read-only by default
```

## 8. Role summary table

Platform roles, not job titles (§3.2). "Scope" is the limit of what the role
can reach; "—" means the role has no authority for that action.

| Role | Scope | Weekly | Monthly | Comments | Administration |
|---|---|---|---|---|---|
| **Department Engineer** | Assigned project + department | Enter updates, activities, risks, issues; save Draft; submit to Lead | — | Create unlimited; edit own | — |
| **Department Lead** | Assigned project + department | Everything an Engineer can do, plus **approve** or return the department submission | — | Add, edit, soft-delete, restore, review any comment in the department | Delegate own authority (§1.3) |
| **Delegate** | Exactly the delegation's project + department scope, between its start and end dates | The delegating Lead's authority, no more | — | The delegating Lead's authority | — |
| **Reporting Coordinator** | Projects assigned by Project Control Admin | Collect submissions, chase outstanding departments, assemble the Weekly | — | Create; review | — |
| **Project Control Admin** | All projects | Create the cycle, review, **return, finalize, lock** | **Prepare the Monthly draft**; compile the Executive report | Full, within policy | Assign Coordinators to projects |
| **Project Manager** | Assigned projects | **Observer** — read and comment only | **Approve** the Monthly Report and the final project report | Create; review | — |
| **Executive / Chairman** | Portfolio | Read approved output | Read approved output | Read | — |
| **System Administrator** | Platform | Full | Full | Full, including audited hard delete (§4.3) | Roles, permission templates, workflow config, project and department assignments, delegation rules, job titles |

### Reconciliation — what this changes in existing documents

Recorded so each change is made deliberately, per `CLAUDE.md`. **None of these
is fixed by this document**; each is work for the phase that implements it.

| # | Existing statement | This document requires |
|---|---|---|
| 1 | [`04_WORKFLOW_ENGINE.md`](04_WORKFLOW_ENGINE.md) §6 and [`engineering/permissions-matrix.md`](engineering/permissions-matrix.md) treat "Department Lead/User" as **one** access level with no approval authority | Department Lead is a **distinct** level that approves the department submission (§1.2). The permissions matrix note that `department_lead` "carries the same permissions as `department_user`" is superseded |
| 2 | `config/permissions.ts` grants `project_manager` **`approve_weekly`** and withholds `approve_monthly` | Exactly inverted: the Project Manager is a Weekly **observer** (§1.6) and the **Monthly approver** (§2) |
| 3 | `config/permissions.ts` grants `executive` **`create/edit/finalize_executive_report`** | Executive access is **read-only by default** (§2). Authoring belongs to Project Control |
| 4 | `reportingCoordinatorId` is a single contact column on the project | Coordinator is a **many-to-many assignment** controlled by Project Control Admin (§1.4). The existing column remains the *named* coordinator for report output |
| 5 | `projectManagerId` is a single contact column | A project may have **multiple** Project Managers (§3.5) |
| 6 | Job title exists only as free text on contacts and org-chart positions | Job titles become **admin-managed master data** with add / edit / deactivate / archive (§3.1) |
| 7 | `weekly_entries` rows are flat, with no soft delete, no version history, and no reviewed/approved attribution | Comments need immutable original text, version history, soft delete + restore, and full attribution (§4) |
| 8 | Open discrepancy already recorded in `permissions-matrix.md`: `reviewer` holds `approve_weekly` / `approve_monthly` while §6 says "recommend" | Still open. This document does not resolve it; the approval chain here runs Lead → Coordinator → Project Control → (Monthly) Project Manager, so the generic `reviewer` / `approver` roles must be re-scoped or retired when Phase 7 is built |

---

## 9. Phased implementation order

Roadmap phase numbers from [`15_DEVELOPMENT_ROADMAP.md`](15_DEVELOPMENT_ROADMAP.md).
**No parallel numbering scheme** (`CLAUDE.md`). Each step is a separate
approval; none starts automatically.

| Order | Roadmap phase | Step | Depends on |
|---|---|---|---|
| 1 | **7** | Identity and assignment foundation — project user assignments, department user assignments, and flexible job titles as master data | Login (A2 ✅) |
| 2 | **7** | Project responsibilities — multi-holder Project Manager, Reporting Coordinator, and Coordinator-to-project assignment | Step 1 |
| 3 | **7** | Role enforcement — replace the temporary `for all to authenticated` RLS with per-role, per-assignment policies; `hasPermission()` actually called; reconcile items 1–3, 8 of §8 | Steps 1–2 |
| 4 | **7** | Department submission approval gate — Lead approve / return with reason, submission blocked without an active Lead or delegate | Step 3 |
| 5 | **7** | Temporary delegation — scope, dates, reason, automatic expiry, audit history, acting-user recording | Step 4 |
| 6 | **6** | Comment governance — unlimited comments on all §4.1 targets, immutable original text, version history, soft delete and restore, full attribution | Step 3 |
| 7 | **7** | Notification events — the event log first, then delivery for the §4.5 table | Steps 4–6 |
| 8 | **9** | Monthly approval — Project Control prepares, Project Manager approves the Monthly and the final project report | Steps 3–4, and Phase 9 existing prerequisites |
| 9 | **10** | Executive read-only enforcement and portfolio compilation from approved Monthly information | Step 8 |

Steps 1–3 are prerequisites for everything else in this document. Building the
approval gate (step 4) before role enforcement (step 3) would produce an
approval that any user could perform.

## 10. Acceptance criteria

This operating model is implemented when all of the following hold against the
live database, with lint, type-check, and production build green:

1. A user sees only the projects and departments assigned to them; a
   Department Engineer in one department cannot read or edit another
   department's submission, enforced **server-side**, not only in the UI.
2. A department submission cannot reach Project Control without the Department
   Lead's approval; a department with no active Lead and no active delegate is
   blocked and reported as such.
3. A Lead can return a submission with a required reason, and both the reason
   and the previous submission event survive in history.
4. A Lead can create a delegation with project scope, department scope, start
   date, end date, and reason; the delegate gains exactly that authority, loses
   it automatically at the end date, and every action taken under it records
   the acting user and the delegation.
5. Project Control Admin assigns a Reporting Coordinator to several projects,
   and one project carries several Coordinators; a Coordinator has no
   authority on an unassigned project.
6. The Project Manager cannot approve a Weekly Report, can read and comment on
   it, and **can** approve the Monthly Report and the final project report.
7. An executive account can read approved Executive output and can perform no
   create, edit, or finalize action anywhere.
8. A System Administrator can add, edit, deactivate, and archive a job title; a
   referenced job title stays visible in history and disappears from new
   pickers; no permission check reads a job title.
9. A project carries two Project Managers simultaneously and both hold observer
   access.
10. Comments can be added to every §4.1 target with no count limit; an edit
    preserves the previous version; a soft-deleted comment is restorable; and
    every comment shows who created, edited, deleted, restored, reviewed, or
    approved it.
11. No comment is permanently deleted by any normal-use path.
12. Every event in the §4.5 table is recorded in the notification event log.
13. Nothing in §11 has been started.

## 11. Explicitly deferred to later phases

None of these may be started automatically:

- **Notification delivery** — email, in-app toast, digest, or any other
  channel. The event log (§4.5) is in scope for step 7; *sending* is not, and
  no notification may be sent until an explicit phase authorises it.
- **Escalation and reminder schedules** — automatic chasing of overdue
  departments beyond recording the overdue event.
- **External Contributor access** via secure link, and the department Excel
  exchange (Phase 8).
- **Approval signatures, QR codes, and printed sign-off blocks** (Phases 11–12).
- **Comment mentions (`@user`), attachments on comments, and threaded replies**
  beyond what [`archive/reporting-architecture-v1.md`](archive/reporting-architecture-v1.md)
  §6 already specifies — these belong to the Comment Register work in Phase 6
  and are tracked there, not here.
- **The Comment Register itself** — the cross-report persistent master record
  with carry-forward. This document governs comment *governance*
  (history, soft delete, attribution); the Register remains Phase 6 scope.
- **Delegation of Project Control Admin or System Administrator authority.**
  Only Department Lead delegation is approved (§1.3).
- **Per-department approval-requirement configuration** (§3.4) beyond recording
  that departments may differ — the configuration UI is a later phase.
- **Retiring or re-scoping the generic `reviewer` and `approver` roles**
  (§8 reconciliation item 8) — decided when Phase 7 step 3 is built.

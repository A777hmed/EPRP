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

This is a specification of the **target** model; unless a section says
otherwise, nothing here is implemented. Sections that describe implemented,
as-built rules are explicitly marked **Implemented** — currently §3.6
(Phase 2C.1 project classification authority) and §3.7 (Phase 2C.3E Project
Setup authority and archived projects). §3.8 (Master Planning & Control
authority, approved 2026-10-14) is **specification**, enforced slice by slice in
roadmap Phase 13.

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

### 3.6 Project classification authority (Phase 2C.1)

**Implemented** (unlike the rest of this document) and enforced in the
database. It uses the existing authority predicates only; no role boundary
above is widened.

| Action | Who | Enforced by |
|---|---|---|
| Create a project and choose its **Project Type** (PSM / Other) | Whoever may create a project today: System Administrator or Project Control Admin | `can_create_project()` (existing) |
| Choose or change an Other project's **Project Category** and its project-specific name | Project setup managers: System Administrator, Project Control Admin, or the project's assigned Project Control Manager | `can_manage_project_setup()` (existing), plus the classification trigger |
| Classify a **legacy** project once | Project setup managers, through the one-time Classify action | The same; the type then locks |
| **Add or manage Project Categories** (the shared list) | System Administrator or Project Control Admin | `has_global_operational_authority()` — the existing master-data write rule. Other users only search and select |
| **Change the Project Type after it is locked** | **System Administrator only** | `correct_project_structure_family()`; every other path is refused by the lock trigger |
| Read the correction history | Project setup managers | Row-level policy `can_manage_project_operations()` |

Rules:

1. **First save locks the Project Type.** The first Create or Save Draft of a
   new project asks for explicit confirmation ("Save and lock Project Type?").
   Ordinary saves never carry the Project Type, and the database rejects any
   change to it that is not a System Administrator correction.
2. **A correction requires a reason** and is checked against the project's
   current version, so a stale screen cannot overwrite a newer save.
3. **Every correction is audited in the same transaction** as the change:
   old and new type, old and new category (with names captured at the time),
   old and new project-specific name, the reason, and who made it and when.
   Audit rows are append-only; nobody can edit them — including a System
   Administrator — and no user can write them directly.
4. **PSM/PSAIM categories are reserved.** An Other project can never use one,
   and adding a category whose code or name is reserved for PSM/PSAIM from an
   Other project is refused before anything is created.

### 3.7 Project Setup authority and archived projects (Phase 2C.3E)

**Implemented** and enforced in the database
(`20261012180000_setup_authority_and_archived_read_only.sql`). It states the
authority sources that exist today; no role boundary above is widened.

**Authority comes only from these explicit sources.**

| Source | Grants | Read by |
|---|---|---|
| System Administrator / Project Control Admin (platform role) | Project Setup and operations on every project | `has_global_operational_authority()` |
| The project's named **Project Control Manager** (Project Control / Planning) | Project Setup, operations and the reporting workflow on **that project only**; view-only elsewhere | `is_project_control_planning()` |
| The project's named **Reporting Coordinator** | The reporting workflow on that project only; **no** Project Setup authority | `is_report_coordinator()` |
| PSM **Department Manager** (`role = team_member`, `assignment_role = department_manager`) | Department approve / return on that project and department | `is_weekly_department_manager()` |
| PSM Team Member Lead / Team Member | Department-user scope on that project and department | `is_department_user()` |

**Authority-free (descriptive only):**
- project membership, Party, Project Role and Reports To;
- functional title and project positions;
- delegation rows (not yet wired to authority);
- Other-project Unit Lead, Unit Member, Weekly / Monthly Responsible and Backup.

No authorization helper or policy reads them. The migration post-check, the
runtime script and a source test each prove this. The six malformed legacy MDP
rows (`role = project_manager` with a department and
`assignment_role = department_manager`) grant no Department Manager authority.

Rules:

1. **Authority follows the named holder.** When a transaction commits, the
   Project Control and Reporting Coordinator authority rows must name the
   project's current holder of that role.
   - Changing or removing the holder changes authority in the same transaction.
   - A direct write that would leave authority with anyone else is refused.
2. **Project Control stays inside its project.** It cannot write another
   project's setup or grant a platform role (only a System Administrator
   writes accounts and roles).
3. **A held responsibility moves only to an active Project Team member.**
   - Replacing the holder of a fixed responsibility, and receiving a project
     position, need an active member of the same project. This applies to
     Replace Person, Project Information and any direct write.
   - Active membership is **sufficient**: no other assignment or role on the
     project is required first. Non-members, ended members and members of
     another project are refused.
   - Membership itself still grants nothing; a filled responsibility carries
     only that responsibility's own authority.
   - On an existing project, the Replace Person and Project Information
     pickers offer active members only, and Project Information never
     creates a Person; a new person joins the Project Team first.
   - Not replacements, and unchanged: a new project's first holders, filling
     a vacant responsibility, clearing one.
4. **Archived projects are read-only.** Every Project Setup write is refused
   for every role, whatever the route. This covers:
   - Project Information, Departments, Systems, Programs & Studies;
   - Contacts and department assignments, delegations, positions, sites and
     parties;
   - the Project Team, the Other structure and its responsibilities;
   - Replace Person and the System Administrator's Project Type correction.

   Setup managers still see every step, read-only, with a clear notice.
   Archiving itself is allowed; there is no un-archive path.
5. **Users never see the database's wording.** Refusals are shown as plain
   sentences.

> **Amendment, effective with roadmap slice 13.18 (approved 2026-10-14).** On
> Other projects the **Weekly Responsible and Weekly Backup** of a unit gain a
> **reporting-write scope on their own unit's Weekly section only** (§3.8 rule
> 2). Until 13.18 is implemented they stay in the authority-free list above.

### 3.8 Master Planning & Control authority (specified 2026-10-14 — not implemented)

**Specification, not yet enforced.** Architecture:
[`02_PLATFORM_ARCHITECTURE.md`](02_PLATFORM_ARCHITECTURE.md) §26. Each row is
enforced at the data boundary by the roadmap slice that builds it (Phase 13,
13.9–13.20). **No new platform role is created**: every grant below uses an
authority source already listed in §3.7.

*13.11 (implemented locally 2026-10-20, awaiting owner closeout).* Three rows
are enforced, all with the existing `can_manage_project_operations()`
predicate, which is unchanged:
- **Edit the Working Plan:** the existing table RLS, plus integrity triggers.
- **Explicit weight normalisation:** `record_planning_weight_decision()`.
- **Planning setup — Guided or Advanced:** `save_planning_configuration()`.

Both functions check authority and the archive themselves and are callable
by signed-in accounts only. The Reporting Coordinator, department or unit
roles and members are refused. Every write on an archived project is refused
for every role. Planning Setup Templates are not built: the owner deferred
them on 2026-10-21, and their delivering slice is open decision B25 (`02`
§26.19). The "Manage Planning Setup Templates" row below is not enforced yet.

"Project Control" below means: System Administrator, Project Control Admin, or
the project's assigned **Project Control Manager** (Project Control / Planning)
— the same set that manages project operations today.

| Action | Allowed | Refused |
|---|---|---|
| Edit the Working Plan — planning nodes, activities, local weights, earning methods, reporting-unit mapping, planned manpower | Project Control | Reporting Coordinator, every department or unit role, members, and anyone named responsible on a milestone, activity or task |
| Import: upload, validate, map; accept or reject a **Schedule Version** and its differences; explicit weight normalisation; re-match; resolve a protected removal; accept a back-dated version as a **Historical Correction** (mandatory reason, recorded actor and time) (`02` §26.22) | Project Control | As above |
| **Publish** a Planning Snapshot | Project Control. From 13.12 the publish runs server-side: the engine calculates, and a server-only trusted writer re-checks the requesting user's authority before persisting (`02` §26.25 D-A). No client role inserts a snapshot or its rows directly | As above |
| **Prepare / request** a re-baseline | The project's assigned Project Control / Planning; Project Control Admin; System Administrator | Everyone else |
| **Approve / reject** a re-baseline | **Another** Project Control Admin or System Administrator — never the person who prepared / requested it (B3, closed 2026-10-22; database-enforced, no override) | The requester, whatever their role; the assigned Project Control / Planning (by that assignment alone); Reporting Coordinator; everyone else |
| Approve the **original** baseline BL0 | Prepared / requested by the assigned Project Control / Planning; approved only by **another** Project Control Admin or System Administrator (B8, closed 2026-10-22) | The requester, whatever their role; everyone else |
| Record / promote an **Opening Position** | Project Control, in Planning Workspace → Baselines & Snapshots only | Everyone else. Project Setup offers no entry for it (from **13.9A**; previously scheduled for 13.14) |
| Governed milestones — identity, updates, decisions, reconciliation, linking to a true milestone | As built (13.2–13.2d): Project Control; reconciliation excludes the Reporting Coordinator | As built |
| Manage Resource Categories (global master data) | System Administrator, Project Control Admin | Everyone else |
| Assign a project's portfolio weight | Project Control Admin, System Administrator | Everyone else, including the project's own Project Control |
| Re-pin a draft Weekly or Monthly to a newer snapshot (before approval) | The reporting workflow managers (Project Control and the assigned Reporting Coordinator) | Department and unit roles |
| Confirm / explain planning facts in a Weekly section | That section's writers — PSM: the department roles of §3.7; Other projects: the unit's Weekly Responsible / Backup (from 13.18) — and the reporting workflow managers | Writers of other sections |
| Record actual manpower in a Weekly | **Open** (`02` §26.19 B5) | — |
| Planning setup — Guided or Advanced mode (`02` §26.20) | Project Control. Both modes edit the same Planning Configuration | Everyone else |
| Manage Planning Setup Templates (recommended defaults) | System Administrator, Project Control Admin | Everyone else |
| **Add** a Weekly / Monthly section comment, and **edit their own** (`02` §26.21) | PSM: the department's team members for their department's section (as built, §1.1). Other projects: the unit's active members for their unit's section — **pending B9** | Anyone outside that section |
| **Review and summarise** a section's comments | PSM: the Department Manager for their department. Other projects: the unit's Weekly Responsible / Backup (from 13.18); Monthly per B2 | Anyone outside that section |
| Any write above on an **archived** project | **Nobody** | Every role, every route |

**Rules.**

1. **Planning authority never comes from responsibility labels.** Being the
   responsible person for a milestone, activity, unit or (future) task, a unit
   lead or member, a project member, a party or a title grants **no** planning,
   publishing or approval authority.
2. **Other-project reporting-write scope** (from 13.18): a unit's Weekly
   Responsible and Weekly Backup may enter and update only **their own unit's**
   Weekly section — narrative, and confirmations and explanations of the
   planning facts mapped to that unit — while the report accepts section input.
   It grants no project, planning, publishing, approval, return, setup or
   other-unit authority. Monthly Responsible / Backup are not covered (open,
   `02` §26.19 B2).
3. **Archived projects are read-only** for the Working Plan, imports, baselines,
   publishing, governed milestones and manpower, at the data boundary
   (roadmap 13.9). **Implemented 2026-10-15 (13.9, local development database
   only):** `guard_archived_project_planning()` refuses every INSERT / UPDATE /
   DELETE on the 16 Planning, Milestone and Deliverable tables of an archived
   project — for every role, including System Administrator and Project Control
   Admin, and including the SECURITY DEFINER publish path — with
   `[PROJECT_ARCHIVED]` / 42501. `can_manage_project_operations()` is unchanged;
   the trigger is the boundary. Reads are unaffected. Manpower tables do not
   exist yet; they will carry the same guard when 13.13 adds them.
4. **Reading** follows the existing visibility model (`02` §24.2): published
   snapshots are official record; the Working Plan, raw imports and decisions
   are shown only in the Planning workspace.
5. **Reporting-comment scope is not planning authority** (`02` §26.21).
   - Adding, editing one's own, reviewing or summarising section comments grants
     no Planning, Project Setup, publishing, approval or return authority, and
     nothing outside the commenter's own section.
   - A comment never changes a planning fact or a Published Planning Snapshot.
   - Comment history, soft delete and attribution follow §4.

### 3.9 Project Setup control and amendment authority (approved 2026-10-15 — Steps 1–4 enforced locally 2026-10-16 – 2026-10-17)

**Enforced locally (13.9B Steps 1–4, local development database only;
browser UAT pending).**
- Steps 1–2 enforce these rows at the data boundary: amendment, approval,
  withdrawal, Controlled fields, onboarding mode, first publish, Finalise and
  Reported Progress. They also enforce the System-Administrator-only legacy
  classification bootstrap (`02` §26.24.2).
- Step 3 (2026-10-17) adds the matching screens. They offer only what these
  rows allow; the database stays authoritative.
- Step 4 (2026-10-17) enforces the structure / scope row:
  - `request_project_structure_amendment()` requires Project Setup authority
    on that project (`can_manage_project_setup`). Assigned Project Control
    acts on its assigned projects only; a plain viewer is refused.
  - The decision reuses `decide_project_setup_amendment()`: another PCA or
    SA, never the requester.
  - `guard_structure_setup_controlled` refuses every governed direct
    structure write once Controlled, whatever the role.
  - On an archived project, requests, decisions, withdrawals and direct
    writes are all refused.

Architecture:
[`02_PLATFORM_ARCHITECTURE.md`](02_PLATFORM_ARCHITECTURE.md) §26.23.6–§26.23.8.
- **13.9A:** changes no authority. It only moves and relabels existing actions.
- **Enforcement:** roadmap slice **13.9B — Project Setup Governance** (`02`
  §26.19 B11, closed 2026-10-15), at the data boundary (RLS / service) and in
  the UI.
- **No new platform role is created.**

"Setup managers" means the existing Project Setup authority of §3.7: System
Administrator, Project Control Admin, or the project's assigned Project Control
Manager.

| Action | Allowed | Refused |
|---|---|---|
| Edit setup before the project is **Controlled** (Draft / Ready for Planning) | Setup managers, exactly as §3.6–§3.7 today | As today |
| **Free / logged** edits once Controlled: Lifecycle Status, Lifecycle Phase, Portfolio / Reporting Group, Team, Responsibilities, Contacts, Location, Branding, Description | Setup managers. Team and responsibility changes keep every §3.7 rule | As today |
| **Lightweight amendment**, with mandatory reason: Project Name / Short Name and other justified non-planning metadata | Setup managers | Everyone else |
| **Request** a governed amendment: Project Code, Client / Owner, Project Classification, Planning Onboarding Mode, structure-family or governed scope, reporting frequency / cut-off, contractual and other interpretation-changing configuration | Setup managers | Everyone else |
| **Approve / reject** a governed amendment | **A Project Control Admin or System Administrator other than the requester** (`02` §26.19 B12, closed) | **The requester, whatever their role.** Also refused: the assigned Project Control Manager by that assignment alone, and everyone else. No break-glass or self-approval exception exists |
| **Withdraw** a pending governed amendment | The requester, or a Project Control Admin / System Administrator | Everyone else |
| Change a **locked Project Type** | **System Administrator only**, through the existing correction (§3.6), with its own audit, shown in Project History. Single actor, no second approver, not duplicated as an amendment (`02` §26.19 B16, closed 2026-10-16) | Everyone else, unchanged |
| Structure / scope change once Controlled (`02` §26.24.2a, B17 closed) | Add / remove / archive / re-parent / reporting scope / unit and level **renames**: **governed amendment** (request by setup managers, approval by another PCA / SA). Display order and non-semantic descriptions / notes: free / logged | As for the matching amendment class |
| Edit Setup **Forecast Finish** once Controlled | **Governed amendment** until 13.14 (B22, closed). From 13.14, **nobody** on a planning-governed project — it is Planning-owned and read-only in Setup | As for a governed amendment |
| Edit Setup **Planned Start / Planned Finish** after an approved BL0 | **Nobody.** Dates change only through Planning re-plan or re-baseline (§3.8) | Every role |
| **Finalise Project Setup** for a no-formal-schedule project (`02` §26.23.6) | System Administrator, Project Control Admin, or the project's **assigned Project Control / Planning**, after explicit confirmation | The Reporting Coordinator, department users, and project members on the strength of membership alone |
| **Add a Reported Progress entry** ("Update Reported Progress") for a **Finalised** no-formal-schedule project (`02` §26.14, §26.24.5; from 13.9B) | **Only** the System Administrator, a Project Control Admin, or the project's assigned Project Control / Planning (`can_manage_project_operations`; `02` §26.19 B21, closed). Entries are append-only, and a correction is a new entry. A back-dated entry needs a reason (B20) | The **Reporting Coordinator**, department users and ordinary members. **Nobody** on a planning-governed project or before Finalise (B19). Weekly and Monthly may reference an entry but never write it |
| **Correct or withdraw** a Reported Progress entry (a superseding entry with a reason) | The same set as adding an entry | Everyone else |
| Read setup amendments, finalisations, Reported Progress and the setup field-change log | Whoever can read the project: `can_access_project()`, the existing visibility model (`02` §24.2) | — |
| Any action above on **another** project | Global authority only (System Administrator, Project Control Admin). The assigned Project Control / Planning acts **only** on projects where they hold that assignment (`is_project_control_planning(project)`) | Project membership, Party, title or responsibility labels never confer it |
| Any write above on an **archived** project | **Nobody** | Every role, every route (§3.7 rule 4, 13.9). A request pending at archive is not decided, withdrawn or altered; it shows as "Frozen — project archived" and leaves the approval queue (`02` §26.19 B24, closed) |

**Rules.**
1. **Amendments, Setup Finalisation records and Reported Progress entries are
   append-only.** Nobody edits or deletes them, including a System
   Administrator.
2. **Responsibility labels never grant amendment or approval authority.**
   §3.8 rule 1 applies unchanged.
3. **Specified in full 2026-10-16** (`02` §26.24, `06` §10A.11).
   - **Writes:** every write is a hardened server function, with no direct
     table grants.
   - **Requests:** the requesting authority is the existing Project Setup
     predicate.
   - **Decisions:** the deciding authority is
     `has_global_operational_authority()` plus "not the requester".
   - **Reported Progress:** recording authority is the existing project
     operations predicate, `can_manage_project_operations()` (global
     operational authority or assigned Project Control / Planning), which
     does not include the Reporting Coordinator (B21).
   - **No new platform role or predicate is introduced.**
4. **The Reporting Coordinator, department users and project members hold no
   13.9B authority.** They can read where they can read the project.

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

Planning, publishing, re-baseline and manpower authority is not in this table;
it is §3.8.

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

The §3.8 Master Planning & Control authorities are delivered by roadmap
**Phase 13** (13.9–13.20), in the order recorded there, not by this table.

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

# EPRP Platform Architecture

## 1. Purpose and authority

This document defines the **data architecture** of the EPROM Progress Report platform: what entities exist, who owns them, how they relate, and the rules that govern them.

It is the permanent source of truth for the data model. Every implementation phase must conform to it. Where an implementation and this document disagree, this document governs and the difference is reconciled deliberately rather than absorbed.

**Scope boundaries.** This is architecture, not schema. It contains no SQL, no migrations, no table or column definitions, no data types, and no implementation detail. It defines *what must be true*; the implementing phase decides *how*.

It sits beneath [`01_PROJECT_VISION.md`](01_PROJECT_VISION.md), which defines the product. Where the vision names a capability, this document defines the data required to make it real.

> **Scope within the set.** This document covers the platform's structural and data architecture: tiers, ownership, hierarchy, isolation, and the architecture of the permission model. Role definitions and the operating detail of approvals live in [`05_PERMISSION_MODEL.md`](05_PERMISSION_MODEL.md); the concrete schema will live in `06_DATABASE_SCHEMA.md` when written.

> **Locked decisions.** [§24](#24-locked-decisions--p0-architecture-review-2026-08-20) records the decisions locked at the P0 architecture review of 2026-08-20 and is the source of truth for the phases that follow it. Three of them amend text earlier in this document — §5 rule 4, §9.2 step 2, and §8.1/§8.3 — and each amendment is named there. **Where §24 and an earlier section disagree, §24 governs.**

---

## 2. Architectural principles

Nine rules govern every decision in this document. Everything that follows is an application of them.

| # | Principle | Consequence |
|---|---|---|
| 1 | **Every entity has exactly one owner.** | Ownership determines lifecycle, visibility, and permission scope. Shared ownership is never permitted. |
| 2 | **Master data is referenced by projects, never owned by them.** | A department exists once for the organization. A project holds an *assignment* of it, not a copy. |
| 3 | **Every project-scoped entity carries its project.** | The project is the root of all operational data and the basis of isolation. |
| 4 | **No entity references an entity owned by a different project.** | This is what makes isolation structural rather than procedural. |
| 5 | **Approved data is immutable.** | Change produces a new revision. The previous state remains readable exactly as approved. |
| 6 | **History is preserved, never overwritten.** | Nothing consequential is destroyed. Removal is a state, not an erasure. |
| 7 | **Derived values are never authoritative.** | Anything computable from underlying data is computed. Stored copies are caches, and the derivation is the truth. |
| 8 | **Structure is configured, not hardcoded.** | Hierarchy shape, naming, measures, and workflow参 are data, not product decisions. |
| 9 | **Audit is owned by the platform, not by its subject.** | An entity can never delete the record of what was done to it. |

---

## 3. Platform hierarchy

The platform is organized in five ownership tiers. Each tier may reference the tier above it; **no tier may be owned by the tier below it.**

```text
TIER 0 — PLATFORM
   Configuration that exists before any project.
   Roles · permission definitions · workflow definitions ·
   hierarchy profiles · audit
        │  referenced by
        ▼
TIER 1 — ORGANIZATION  (master data — shared, reusable, never project-owned)
   Clients · Departments · Systems · Work Levels · Directory People ·
   Job Titles · Project Types · Project Phases · KPI Definitions ·
   Risk & Criticality Scales · Knowledge
        │  referenced by
        ▼
TIER 2 — PROJECT  (the isolation boundary)
   Project · assignments of Tier 1 into this project ·
   Organization Chart · project responsibilities · project configuration
        │  owns
        ▼
TIER 3 — REPORTING
   Weekly Reports · Monthly Reports · Executive Summary Reports ·
   submissions · content · revisions
        │  owns
        ▼
TIER 4 — RECORDS
   Documents · Meetings · Notifications · Archive artifacts
```

**The load-bearing rule is the Tier 1 / Tier 2 boundary.** Master data is organizational and reusable; projects *assign* it. Duplicating master data into a project would destroy cross-project comparison, analytics, and the Contact Center, and is the single most consequential mistake this architecture exists to prevent.

---

## 4. Dynamic project hierarchy

### 4.1 The structural hierarchy

Every project resolves to the same four-level structure:

```text
Project
  └── Department        (which part of the organization contributes)
        └── System      (which scope area the work covers)
              └── Work Level   (the unit progress is measured at)
```

The **relationship** is invariant. The **naming and applicability** of each level are configuration.

### 4.2 Project Type drives the hierarchy

The **Project Type** is a Tier 1 entity that carries a *hierarchy profile*. The profile determines, for every project of that type:

- how many levels the hierarchy has;
- what each level is called, singular and plural;
- whether each level is required or optional;
- at which level progress is measured and rolled up.

Two projects of different types are legitimately different shapes produced by the same platform. Neither is a workaround for the other.

### 4.3 The Work Level and its names

The level beneath System carries a different name per project type:

| Project Type family | Work Level is called |
|---|---|
| General engineering | **Discipline** |
| Process Safety / Asset Integrity Management | **Program & Study** |
| Area-based scopes | **Area** |
| Future types | Defined by their hierarchy profile |

**These are one structural level under several names, not several entities.** There is exactly one Work Level concept in the model. Creating separate entities for Disciplines, Programs & Studies, and Areas would fragment progress roll-up, analytics, and reporting across incompatible structures, and is explicitly prohibited.

Three rules follow:

1. **Naming is data.** A new project type introduces a new name by configuration, never by product change.
2. **Naming never branches behaviour.** Terminology may change what a user reads; it may never change what the platform does, what is stored, or how anything is calculated.
3. **The stored identity is stable.** A project's Work Level records remain valid and comparable regardless of what they are displayed as.

### 4.4 Assignment, not ownership

A project does not contain departments, systems, or work levels. It contains **assignments** of them.

```text
Department  (Tier 1, organization)
     ▲
     │ referenced by
Department Assignment  (Tier 2, owned by Project)
     │ carries: this project's obligation, lead, reporting requirement
     ▼
System Assignment  (owned by Project, within a Department Assignment)
     ▼
Work Level Assignment  (owned by Project, within a System Assignment)
```

The assignment carries everything project-specific: what this project expects of this department, who leads it here, whether it reports weekly, what scope it covers. The underlying master record carries only what is true organization-wide.

This is what allows one department to contribute to twenty projects with a different obligation on each, while remaining one department for the purposes of analytics and the Contact Center.

---

## 5. Project isolation

Isolation is structural. It is a property of how entities are related, not a filter applied at read time.

**The rules:**

1. Every Tier 2, 3, and 4 entity resolves to exactly one project, directly or through its owner.
2. No project-scoped entity may reference a project-scoped entity belonging to a different project.
3. Cross-project relationships exist **only** through Tier 1 master data. Two projects may both assign the same department; that is the whole of their connection.
4. **Write** access is granted per project. Assignment to one project confers no authority on another. *(Amended by [§24.2](#242-visibility-model-d-2--amends-5-rule-4-and-92-step-2): **read** access is platform-wide, subject to the Tier A / Tier B split. Isolation of authority is unchanged — only the read gate was separated from it.)*
5. Aggregation across projects — portfolio views, analytics, the Chairman Dashboard — reads *approved outputs* across projects. It never dissolves the boundary between them.
6. Archiving or removing a project affects nothing outside it, and never removes the Tier 1 master data it referenced or the Tier 0 audit record of it.

**Consequence:** the correctness of isolation does not depend on any query being written correctly. A relationship that would violate isolation must be impossible to express, not merely discouraged.

---

## 6. Database ownership model

### 6.1 What ownership means

Ownership answers four questions for every entity:

| Question | Determined by |
|---|---|
| What is its lifecycle bound to? | Its owner. When the owner ends, the entity ends. |
| Who can see it? | Its owner's access scope. |
| Where does permission come from? | Its owner's project and department. |
| Can it be deleted? | Its owner's tier and immutability state. |

**Every entity has exactly one owner.** Where an entity appears to have two — a report referenced by both a project and a person — one is the owner and the other is a reference.

### 6.2 The ownership classes

| Class | Owner | Lifecycle | Deletable |
|---|---|---|---|
| **Platform-owned** | The platform | Permanent | No |
| **Organization-owned** | The organization | Independent of any project | Archived, never deleted while referenced |
| **Project-owned** | One project | Ends with the project | Archived within the project |
| **Report-owned** | One report | Ends with the report | Immutable once approved |
| **Account-owned** | One account | Ends with the account | Deactivated, never deleted |
| **Immutable record** | The platform | Permanent, append-only | Never |

### 6.3 Reference integrity and the archive rule

Master data that is referenced may never be deleted. It is **archived** — withdrawn from selection for new work, while every existing reference to it stays valid and readable.

This applies to every Tier 1 entity without exception. A department archived today must not break a weekly report that referenced it two years ago. History must remain interpretable, which means the records it points at must survive.

---

## 7. Contact Center relationships

The most common and most damaging modelling error in a platform of this kind is merging identity concepts that must stay separate. EPRP keeps three.

### 7.1 The three identities

```text
ACCOUNT                     DIRECTORY PERSON              PROJECT ASSIGNMENT
(who can sign in)           (who exists)                  (what they do here)
─────────────────           ────────────────              ──────────────────
Tier 0/1                    Tier 1                        Tier 2
Carries: role, active       Carries: name, contact,       Carries: project,
state, credentials link     job title, department,        department, assignment
                            organization                  role, reporting line
        │                            │                              │
        └────── optional link ───────┘                              │
                     │                                              │
                     └──────────── grants access ───────────────────┘
```

**Account** — an authentication identity. Only accounts can *act*. Every action, approval, and audit entry attributes to an account.

**Directory Person** — the Contact Center record: a person the organization works with. Includes people who will never sign in — client representatives, external contributors, contacts held for reference. Used for report attribution, the organization chart, and contact information.

**Project Assignment** — what a person does on one specific project.

### 7.2 The binding rules

1. A Directory Person **may** be linked to an Account. Most are not.
2. An Account **may** be linked to a Directory Person. It is not required to hold one.
3. **Access-bearing assignments reference the Account.** Permission belongs to something that can sign in.
4. **Responsibility and attribution reference the Directory Person.** A project's client representative is a person, not an account.
5. The two are never merged and never inferred from one another. Sharing a name or an email address establishes nothing.

### 7.3 Why the separation is mandatory

- People leave. The account is deactivated; the historical attribution must remain readable.
- External contributors participate without ever holding an account.
- One person may appear in many projects with different responsibilities simultaneously — that variability belongs to the assignment, not to the person.
- Merging directory and account makes every contact a security principal, which is both a security exposure and an administrative burden.

### 7.4 Job titles

Job titles are Tier 1 master data, administered centrally. A job title is **descriptive only**. It carries no permission, grants no authority, and is never consulted when resolving access. This is an architectural constraint, not a convention: the permission model (§9) has no input from job title.

---

## 8. RBAC role hierarchy

### 8.1 The canonical roles

Roles are Tier 0. They are defined by the platform and assigned to accounts.

| Level | Role | Scope | Nature |
|---|---|---|---|
| 1 | **System Administrator** | Platform | Administers the platform itself: accounts, roles, configuration, master data, assignments |
| 2 | **Project Control Admin** | All projects | Owns the reporting cycle end to end; the only authoring role for Executive output |
| 3 | **Project Manager** | Assigned projects | Accountable for the project; approves at the Monthly level |
| 4 | **Reporting Coordinator** | Assigned projects | Assembles and chases the reporting cycle on assigned projects |
| 5 | **Department Lead** | Assigned project + department | Approves their department's contribution |
| 6 | **Department Engineer** | Assigned project + department | Enters their department's contribution |
| 7 | **Executive / Chairman** | Portfolio | Reads approved output across all projects |
| 8 | **Viewer** | Assigned projects | Reads within assigned scope |

**Delegate is not a role.** It is a temporary, time-bounded grant of another account's authority (§9.4). Modelling it as a role would make it permanent and unscoped.

> **Amended by [§24.3](#243-consolidator-authority-d-3--amends-81-and-83).**
> **Reporting Coordinator is a project assignment, not a platform role**, and
> the same is true of Project Control Manager. Level 4 above is superseded on
> that point. Both are held *on named projects*, many-to-many in both
> directions, and together they form the single **project consolidator** rule
> that governs the reporting cycle. Everything else in this table stands.

### 8.2 The hierarchy is not a ladder

Roles are **not** strictly nested. A higher level does not automatically include everything below it.

The Project Manager is accountable for the project but is a Weekly *observer* — the Weekly approval belongs to the Department Lead and Project Control. The Executive / Chairman sits at the top of the reporting audience and holds no authoring authority at all. Modelling roles as a simple hierarchy of increasing power would produce exactly the wrong answers at both ends.

Authority is therefore defined per action, per scope — never inherited by rank.

### 8.3 Role assignment

An account holds **one platform role**, which establishes its nature. Its reach is established separately by project and department assignment (§9). A Department Engineer on three projects is one role and three assignments.

---

## 9. Permission model

### 9.1 The three axes

Every access decision resolves three axes simultaneously:

```text
        ROLE                PROJECT               DEPARTMENT
   what may be done    ×  where it may     ×   on which part
                          be done               of the project
```

An access decision is valid only when all three permit it. A Department Lead's approval authority means nothing on a project they are not assigned to, and nothing on another department of a project they are.

### 9.2 Resolution order

Every **write, send, approve or manage** decision resolves in this fixed order. **Any step failing denies access; no later step can restore it.**

```text
1. Is the account active?                          no → deny
2. Is the account assigned to this project?        no → deny
3. Is the account assigned to this department?     no → deny   (department-scoped entities)
4. Does the role permit this action?               no → deny
5. Does the entity's state permit this action?     no → deny   (approved / locked / archived)
6. → allow
```

**Read resolves separately.** Steps 2 and 3 do not gate reading — see
[§24.2](#242-visibility-model-d-2--amends-5-rule-4-and-92-step-2), which
amends this section. An active account may read Tier A data on any project, and
Tier B data once the parent report is Approved, Finalized or Locked. Steps 1
and 5 still apply to reads; steps 2, 3 and 4 apply in full to everything else.

Step 5 is not an afterthought. Immutability outranks permission: **no role, including System Administrator, may modify approved data in place.** The correct action is a new revision.

### 9.3 Enforcement principle

Permission is enforced at the data boundary, not only in the interface. The interface reflects permission; it does not constitute it. A request that bypasses the interface must reach the same decision.

Interface-level checks exist for clarity and guidance. They are never the boundary.

### 9.4 Delegation

Delegation is a first-class entity, owned by the project.

It carries: the delegating account, the receiving account, the project, the department, the specific responsibilities delegated, a start date, an end date, a reason, and its revocation state.

Four constraints:

1. **Delegation cannot exceed the delegator's own authority.** It transfers a subset, never an expansion.
2. **Delegation is time-bounded and expires by itself.** Expiry is derived from dates, never from a flag that could be left set.
3. **The delegator retains their authority.** Delegation adds a holder; it does not move one.
4. **Delegated actions attribute to the delegate, and record the delegation that authorized them.** The audit shows both who acted and why they were permitted to.

---

## 10. Organization Chart structure

### 10.1 Ownership and shape

An Organization Chart is **project-owned**. A project may hold several over its life; one is current.

The chart is a tree of **Positions**. A position is a place in the project's structure of authority — not a person.

```text
Organization Chart  (project-owned, versioned, lifecycle: draft → active → locked)
   └── Position  (self-referencing tree; one parent, many children)
         ├── describes: title, scope, department, work level
         ├── may reference: one Directory Person (the holder)
         └── holds: assignment history
```

### 10.2 The position/person separation

A position exists whether or not it is filled. A person may hold a position, vacate it, and be replaced, while the position — and everything reported under it — persists.

Position holders reference the **Directory Person**, not the account: a position may legitimately be held by someone who never signs in.

### 10.3 Chart versus permission

**The organization chart does not grant permission.** It describes structure; §9 governs access. A chart that granted authority would create a second, undocumented permission system that drifts from the first.

The chart and the assignment model must remain consistent, but consistency is a reporting concern, not an enforcement mechanism.

### 10.4 History

Position assignment history is preserved permanently. The platform must be able to reconstruct the structure in force at any past date — which is what allows a past report to be read against the authority structure that produced it.

---

## 11. Workflow hierarchy

Three distinct workflows operate at different levels. They are separate mechanisms and must not be conflated.

### 11.1 Setup workflow — derived

Governs whether a project is adequately configured. It is **derived entirely from the project's own data** and never stored as a status.

This is deliberate: a stored setup status becomes wrong the moment data changes by any other route. Derivation is always correct.

### 11.2 Submission workflow — department to report

Governs one department's contribution to one reporting period.

```text
not started → in progress → submitted → accepted
                    ▲                        │
                    └──────── returned ──────┘
```

Owned by the submission. Scoped to (project, department, period). The department's own Lead approves the submission before it leaves the department.

### 11.3 Approval workflow — report lifecycle

Governs a report as a whole.

```text
draft → collecting → under review → approved → published → locked
             ▲             │
             └── returned ─┘
```

Owned by the report. Applies identically to Weekly, Monthly, and Executive Summary Reports.

### 11.4 How they nest

```text
Setup workflow      must be satisfied before a project reports
      ▼
Submission workflow every contributing department, per period
      ▼
Approval workflow   the report advances only when its submissions allow
```

**Rules governing all three:**

- Every transition is performed by a named account holding authority for that stage, on that scope.
- Every transition is recorded permanently, with actor, timestamp, and — for returns — reason.
- Only defined transitions are possible. There is no free movement between states.
- **Reaching `approved` makes the report's content immutable.** Later change requires a new revision.

---

## 12. Weekly → Monthly → Executive data flow

### 12.1 The compilation rule

**Each tier compiles from the approved output of the tier below. Data is never re-entered upward.**

```text
Department entry
      │  submitted and accepted per department
      ▼
WEEKLY REPORT ─────────────── the operational source of truth
      │  approved weeks only
      ▼
MONTHLY REPORT ────────────── consolidated position for the period
      │  approved months only
      ▼
EXECUTIVE SUMMARY REPORT ──── selective leadership view
      │
      ▼
Portfolio and Chairman Dashboards (read approved output only)
```

### 12.2 Reference while drafting, snapshot at approval

This is the central mechanism of the flow, and it resolves the tension between live compilation and immutability.

**While drafting**, a Monthly Report holds *references* to the approved Weekly Reports it compiles. It reflects them live. Its own added content — month-specific commentary, consolidated assessment — is owned by the Monthly Report itself.

**At approval**, the report takes an immutable **snapshot** of everything it compiled. The snapshot becomes the approved content and never changes again.

This yields three necessary properties at once:

| Property | Delivered by |
|---|---|
| A draft always reflects current approved data | Reference while drafting |
| An approved report never changes retroactively | Snapshot at approval |
| Any figure can be traced to its origin | References retained alongside the snapshot |

Without the snapshot, correcting a Weekly through a revision would silently rewrite an already-approved Monthly — and every report ever issued would become unreliable.

### 12.3 Flow constraints

1. Only **approved** input is eligible for compilation. Draft data never rises.
2. Compilation is **additive**: a higher tier adds interpretation, selection, and commentary; it never contradicts the tier below.
3. A tier may **exclude** — the Executive Summary is deliberately selective — but exclusion is recorded, not silent.
4. **Revisions do not propagate automatically.** A revised Weekly does not alter an approved Monthly. It flags the Monthly as having revised source, and a person decides whether to issue a Monthly revision.
5. **Every figure remains traceable to the department, period, and account that produced it**, at every tier.

---

## 13. Report ownership

### 13.1 Ownership

| Entity | Owner |
|---|---|
| Report (Weekly / Monthly / Executive Summary) | Exactly one **project** |
| Department submission | The **report** |
| Report content — activities, entries, risks, issues, commentary | The **report** |
| Revision | The **report** |
| Approval and transition records | The **report**, permanently |
| Generated output document | The **report revision** that produced it |

A report never owns master data. It *references* departments, systems, work levels, and people, and those references remain valid permanently (§6.3).

### 13.2 Identity and revision

Every report carries a stable identity — project, type, and period — that never changes. A report is uniquely identified within its project by type and period; a project cannot hold two Weekly Reports for the same week.

Revisions are sequential and additive. Issuing a revision preserves the previous one in full, with the reason for change recorded. The current revision is the operative one; earlier revisions remain readable exactly as approved.

### 13.3 Immutability

On reaching `approved`, report content becomes immutable. Nothing — no role, no administrative action, no correction — modifies it in place. Correction is a new revision. This is the guarantee the entire platform's credibility rests on.

---

## 14. KPI ownership

### 14.1 The three-level split

Measurement is split across three tiers, and collapsing them is a modelling error.

| Level | Entity | Owner | Why |
|---|---|---|---|
| **Definition** | What the measure is, how it is calculated, its unit | **Organization** (per project type) | Comparison across projects requires one definition |
| **Target** | The threshold this project is held to | **Project** | Projects have different commitments |
| **Value** | What was measured for a period | **Report** | A measurement belongs to the period that produced it |

A KPI definition is shared so that "schedule performance" means the same thing on every project of a type. Targets vary by project. Values are historical facts owned by their reporting period and never retrospectively altered.

### 14.2 Risk and Criticality

Both follow the same three-level pattern.

**Risk** — the *scale* (likelihood, impact, the resulting severity grid) is organization-owned, so risk is comparable across the portfolio. A *risk instance* is project-owned and persists across periods. A risk *assessment* is a point-in-time judgement owned by the period, so movement over time is visible.

**Criticality** — the *scale* is organization-owned. A criticality *rating* attaches to the work itself — a system or work level within a project — and is project-owned.

Criticality and health are deliberately independent readings: criticality expresses how much the work matters, health how it is performing. Priority is the combination.

### 14.3 Project Health — derived

**Project Health is never stored as an authoritative value.** It is derived from the project's configured measures, current period data, risk exposure, and reporting completeness.

Three consequences:

1. Health cannot be edited, overridden, or negotiated.
2. Health is **explainable** — the contributing factors are always recoverable, because the derivation is the definition.
3. Health degrades honestly. Missing submissions produce *unknown*, not *healthy*. Absence of data must never read as absence of problems.

A materialized copy may exist for performance. It is a cache. The derivation remains the truth.

---

## 15. Document ownership

### 15.1 Every document has exactly one owner

| Document class | Owner | Example |
|---|---|---|
| **Generated output** | The report revision that produced it | An approved Weekly issued as PDF |
| **Project document** | The project, or a specific project entity | Evidence attached to a department's submission |
| **Organizational knowledge** | The organization | A standard, procedure, template, or lesson learned |

### 15.2 Report Center

The Report Center is the retrieval surface over all generated output. It owns nothing: every document in it is owned by the report revision that produced it, and carries that revision's period, approval, and identity.

An issued document is immutable, exactly as the revision that produced it is immutable.

### 15.3 Knowledge Center

The Knowledge Center holds **organization-owned** material — Tier 1, not Tier 2. Its purpose is that knowledge outlasts the project that produced it, which is only possible if it is not owned by that project.

Knowledge may be *associated* with project types, departments, or work levels so it surfaces where relevant. Association is a reference, never ownership.

Where knowledge originates in a project — a lesson learned — it is **promoted**: a project-owned record becomes an organization-owned knowledge record, retaining attribution to its origin. Promotion is deliberate and attributed.

### 15.4 Supporting material

Attachments are owned by the entity they evidence, not by a general document store. Context is never separated from content.

---

## 16. Google Drive ownership

### 16.1 The ownership rule

**The platform owns the record. Drive holds copies.**

Every artifact in the Drive Archive is owned by the platform record that published it. Drive is a distribution and archive channel, never a source of truth and never a system of record.

### 16.2 One-way relationship

```text
PLATFORM  ──── publishes ────►  DRIVE ARCHIVE
(authoritative)                 (copy)

                ✗ no reverse authority
```

1. Publication flows one way. Content is never read back from Drive as authoritative.
2. A change in Drive — edit, move, deletion — has **no effect** on the platform record.
3. Deleting a platform record does not require the Drive copy to be destroyed; the archive may legitimately outlive it.
4. The platform records what it published, where, and when. That publication record is platform-owned and audited.
5. **The platform remains fully functional if Drive is unavailable.** The integration is a channel, never a dependency.

### 16.3 What may be published

Only **approved, immutable** output. Draft content is never published to the archive, because a copy of a draft is indistinguishable from a copy of a final document once it leaves the platform.

---

## 17. Meeting ownership

### 17.1 Ownership

A meeting is owned by a **project**. A meeting spanning several projects is organization-owned and references each project it concerns; it is never co-owned.

```text
Meeting  (project-owned)
   ├── Attendees      → reference Directory People
   ├── Agenda items   → may reference project entities
   ├── Decisions      → owned by the meeting, permanent
   ├── Actions        → owned by the meeting, assigned to a Directory Person
   └── Minutes        → owned by the meeting
```

### 17.2 Decisions and actions

A **decision** is a permanent record owned by the meeting that took it. It is never edited after the meeting is closed; it is superseded by a later decision, and both remain readable.

An **action** is owned by the meeting but becomes a **tracked commitment**: it carries an owner, a due date, and a state, and it appears in the responsible person's own view and in the project's reporting. An action that does not surface outside the minutes has no operational value.

### 17.3 Calendar

The Calendar owns nothing. It is a **derived view** over dated obligations already owned elsewhere — reporting deadlines, submission cut-offs, approval dates, delegation periods, meetings, milestones.

Creating calendar entities that duplicate those dates would immediately produce two disagreeing answers to when something is due.

---

## 18. Notification ownership

### 18.1 Event and delivery are separate

This separation is mandatory. One occurrence produces one event and many deliveries.

```text
NOTIFICATION EVENT                    NOTIFICATION DELIVERY
(what happened)                       (who was told, and did they see it)
──────────────────                    ─────────────────────────────────
Owned by the entity that raised it    Owned by the recipient account
Immutable                             Carries read / acted state
One per occurrence                    Many per event
```

### 18.2 Rules

1. An **event** is immutable and permanent. It records what happened, on what entity, caused by which account, and when.
2. A **delivery** is owned by its recipient. Its read state is personal and never shared.
3. **Delivery is scoped by permission.** An event generates deliveries only to accounts entitled to know — notification never becomes a side channel that leaks across a project or department boundary.
4. Every delivery **resolves to the entity it concerns**, so a notification always leads to the work.
5. Notification records are part of accountability, not a convenience layer: what was raised, to whom, when, and whether it was acted upon.

### 18.3 Relationship to audit

Notification and audit are **separate records serving different purposes**. Audit records what was done; notification records who was informed. Neither is derivable from the other, and neither substitutes for the other.

---

## 19. Audit Trail ownership

### 19.1 Owned by the platform

**Audit records are owned by the platform — never by the entity they describe.**

This is the most important ownership rule in this document. If audit were owned by a project, deleting or archiving that project could erase the record of what was done to it, and the audit trail would be worthless precisely when it is most needed.

Audit therefore lives at Tier 0, outside every project boundary, and survives the deletion of its subject.

### 19.2 Properties

| Property | Requirement |
|---|---|
| **Append-only** | Records are written once. There is no update and no delete. |
| **Immutable** | No role, including System Administrator, may alter an audit record. |
| **Attributed** | Every record names the acting account. Where a delegation authorized it, the delegation is named too. |
| **Timestamped** | Every record carries when it occurred. |
| **Complete** | Every consequential action is recorded, without exception. |
| **Independent** | Survives the archival or deletion of its subject. |

### 19.3 What is audited

Data changes; every workflow transition including returns and their reasons; approvals and publications; permission and role changes; project and department assignment changes; delegation grants, use, and expiry; configuration changes including hierarchy, KPI, and workflow definitions; document publication and archive distribution; and access to restricted information.

### 19.4 Audit versus revision history

Two distinct mechanisms, frequently and damagingly confused:

| | Audit Trail | Revision History |
|---|---|---|
| **Question** | Who did what, and when? | What did this look like before? |
| **Owner** | Platform (Tier 0) | The entity itself |
| **Scope** | Every consequential action | Approved content |
| **Form** | An immutable log of events | Complete, readable prior versions |

Both are required. Audit alone cannot reproduce a superseded report; revision history alone cannot show who changed a permission.

### 19.5 Soft deletion

Removal is a **state**, not an erasure. A removed record is withdrawn from normal use, remains recoverable, and retains its full history. Genuine destruction of data is an administrative exception — itself audited, and never available as an ordinary operation.

---

## 20. Entity ownership summary

The authoritative reference. Every entity in the platform appears here.

| Entity | Tier | Owner | Immutable | Notes |
|---|---|---|---|---|
| Role definition | 0 | Platform | — | Assigned to accounts |
| Permission definition | 0 | Platform | — | Never inferred from job title |
| Workflow definition | 0 | Platform | — | Configuration |
| Hierarchy profile | 0 | Platform | — | Carried by Project Type |
| Audit record | 0 | Platform | **Yes** | Append-only; outlives its subject |
| Account | 0/1 | Platform | — | Deactivated, never deleted |
| Client | 1 | Organization | — | Archive when referenced |
| Department | 1 | Organization | — | Archive when referenced |
| System | 1 | Organization | — | Archive when referenced |
| Work Level (Discipline / Program & Study / Area) | 1 | Organization | — | One concept, configurable name |
| Directory Person | 1 | Organization | — | Contact Center; may lack an account |
| Job Title | 1 | Organization | — | Descriptive only |
| Project Type | 1 | Organization | — | Carries the hierarchy profile |
| Project Phase | 1 | Organization | — | — |
| KPI definition | 1 | Organization | — | Per project type |
| Risk / Criticality scale | 1 | Organization | — | Portfolio comparability |
| Knowledge record | 1 | Organization | — | Outlives its originating project |
| **Project** | **2** | **Organization** | — | **The isolation boundary** |
| Department / System / Work Level assignment | 2 | Project | — | References Tier 1; never a copy |
| Project responsibility | 2 | Project | — | May have several holders |
| Project user assignment | 2 | Project | — | References an Account |
| Delegation | 2 | Project | — | Time-bounded; expiry derived |
| Organization Chart | 2 | Project | On lock | Versioned |
| Position | 2 | Organization Chart | — | Exists unfilled; holds history |
| KPI target | 2 | Project | — | Per project |
| Risk instance | 2 | Project | — | Persists across periods |
| Criticality rating | 2 | Project | — | Attaches to the work |
| Meeting | 2 | Project | On close | Decisions permanent |
| Meeting decision / action | 3 | Meeting | Decisions: **yes** | Actions are tracked commitments |
| Weekly / Monthly / Executive Report | 3 | Project | **On approval** | Unique by project + type + period |
| Department submission | 3 | Report | On acceptance | Scoped to a department |
| Report content | 3 | Report | **On approval** | — |
| KPI value | 3 | Report | **On approval** | A historical fact |
| Report revision | 3 | Report | **Yes** | Sequential; prior versions retained |
| Generated document | 4 | Report revision | **Yes** | — |
| Project document / attachment | 4 | The entity it evidences | — | Context stays with content |
| Drive archive artifact | 4 | The publishing platform record | **Yes** | Copy, never the master |
| Notification event | 4 | The raising entity | **Yes** | One per occurrence |
| Notification delivery | 4 | Recipient account | — | Personal read state |
| Project Health | — | **Derived** | — | Never authoritative when stored |
| Setup completeness | — | **Derived** | — | Never stored as status |
| Calendar | — | **Derived** | — | Owns nothing |

---

## 21. Conformance rules

An implementation conforms to this architecture when all of the following hold. These are the acceptance criteria for any phase touching data.

1. Every entity has exactly one owner, and that owner matches §20.
2. No project-scoped entity references a project-scoped entity of a different project.
3. Master data is referenced by projects, never duplicated into them.
4. Every project-scoped entity resolves to its project without ambiguity.
5. Referenced master data can be archived but never deleted.
6. Approved content cannot be modified in place by any role.
7. Every workflow transition is recorded with actor, timestamp, and — for returns — reason.
8. Access resolves role, project, and department together, in the order given in §9.2.
9. Permission is enforced at the data boundary, not only in the interface.
10. Job title, organization chart position, and functional title grant no authority.
11. Delegation cannot exceed the delegator's authority and expires by derivation from its dates.
12. Higher report tiers compile only from approved lower-tier output.
13. Approved reports hold an immutable snapshot of what they compiled.
14. Revisions preserve prior versions in full, with a recorded reason.
15. Audit is append-only, platform-owned, and survives its subject.
16. Derived values are computed, never authoritative when stored.
17. Hierarchy naming is configuration and never branches behaviour.
18. Notification delivery respects the same permission boundaries as direct access.
19. Removal is a recoverable state, not an erasure.
20. The platform functions fully with every external integration unavailable.

---

## 22. Open reconciliations

Recorded so each is resolved deliberately rather than absorbed silently, per `CLAUDE.md`. **None is resolved by this document** — each is work for the phase that implements it.

| # | Current state | This architecture requires |
|---|---|---|
| 1 | Access control grants every authenticated user full **write** reach across projects, project assignments and master data — an escalation path, not only an audit gap | Read per §24.2; write per §9 resolution, enforced at the data boundary. **P0.1 and P0.2** |
| 2 | The permission matrix exists as configuration but is consulted in only three places | Permissions enforced per §9.3 and §24.5. **P0.3**; the remainder is P1 |
| 2a | Project Control / Reporting Coordinator authority is implemented three times, and the three disagree | One canonical consolidator rule shared by database and application, per §24.3. **P0.6** |
| 2b | Monthly compiles from Weekly reports at any state, including drafts | Approved / Finalized / Locked Weekly data only, per §12.3 rule 1 and §24.4. **P0.4** |
| 2c | Milestone and deliverable data is read by the Dashboard and Executive tiers from report plan items rather than from the governed registers | One register per fact, per §24.4. **Phase 13.4** — not P0 |
| ~~2e~~ | ~~Executive narrative has two different visibility rules~~ | **Resolved** by the §24.2.3 lock and migration `20260820000004`. `executive_reports` now opens from Approved onward via the shared definition; `executive_notes`, having no lifecycle, is scoped to Executive authors and project members. Write authority unchanged. Runtime validation deferred with the rest of P0 |
| 2f | Approved Executive reports are readable platform-wide at the data boundary, but every `/executive-reports` route is still gated to three roles by `canViewExecutivePortfolio()` | The UI gate should match §24.2.3, so a View-Only reader can open approved Executive output. **P1 UI work** — deliberately outside P0 |
| 2h | Monthly Reports KPI card still counts a report under "Approved / Finalized" after it has been archived — persists through a hard refresh, so it is a derivation defect, not a cache artefact. Both listed reports correctly show Archived | The KPI must exclude archived reports, or state that it includes them. **Deferred by owner 2026-08-22 to the final Monthly UI/UX cleanup.** Display-only: no data, policy or lifecycle rule is wrong |
| 2g | The platform currently holds **test transactional data**, including 4 Monthly comments compiled from a never-approved Weekly. Deploying P0.2 makes the approved Monthly platform-wide readable, publishing those rows | **MANDATORY PRE-HANDOVER DATA RESET** — see §25. Owner decision 2026-08-21: accepted for the current test dataset, which is retained because it is useful for functional and runtime validation. **Not a P0 blocker.** The reset is a delivery gate, not optional cleanup |
| 2d | `can_manage_project_setup()` admits the `project_control_admin` platform role (§8.1 level 2, all-projects scope); the twelve tables gated on `weekly_can_manage_project()` — `project_departments` among them — do not. A Project Control Admin not named on a project can edit its record and assignments but **not** its department scope, so project setup would partially fail for such an account | One manage rule across all project-scoped tables. **P1** — pre-dates P0.1, fails CLOSED (denies, never escalates), and must be fixed before a non-admin Project Control account is onboarded |
| 3 | The stored role set (`reviewer`, `approver`, `department_user`, `viewer`, `executive`) differs from both this document and `05_PERMISSION_MODEL.md` §8 | The eight canonical roles of §8.1. Legacy roles are re-scoped or retired, with existing accounts mapped explicitly |
| 4 | Some project structure is stored in a form that does not enforce referential integrity | Structural references per §4.4 and §5 |
| 5 | Report content exists in more than one competing shape | One owned content model per §13.1 |
| 6 | Assignment identity spans several records per person, kept consistent by application logic | One logical assignment per person, project, and department (§7.2) |
| 7 | No snapshot mechanism exists at approval | Reference-while-drafting, snapshot-at-approval per §12.2 |
| 8 | No audit trail exists | Platform-owned, append-only audit per §19 |
| 9 | No general revision history exists | Revision history per §13.2 and §19.4 |
| 10 | Meetings, notifications, knowledge, and the Drive archive have no data model | §16, §17, §18, §15.3 |
| 11 | ~~The `02_` prefix is shared~~ | **Resolved** by the documentation normalization pass. The set now holds one canonical sequence; the superseded document is retained in `archive/` |

---

## 23. Document map

| Document | Defines |
|---|---|
| [`01_PROJECT_VISION.md`](01_PROJECT_VISION.md) | **What the platform is** — complete product scope |
| **This document** | **The data architecture** — entities, ownership, relationships, rules |
| [`archive/reporting-architecture-v1.md`](archive/reporting-architecture-v1.md) | How reporting behaves |
| [`04_WORKFLOW_ENGINE.md`](04_WORKFLOW_ENGINE.md) | Report states, submission, review, approval |
| [`12_REPORT_GENERATION.md`](12_REPORT_GENERATION.md) | The leadership report and portfolio view |
| [`15_DEVELOPMENT_ROADMAP.md`](15_DEVELOPMENT_ROADMAP.md) | **Current status and delivery order** |
| [`specs/weekly-report.md`](specs/weekly-report.md) | Weekly Report specification |
| [`05_PERMISSION_MODEL.md`](05_PERMISSION_MODEL.md) | Roles, responsibility, delegation |

This document is the authority on **data ownership and structure**. `01_PROJECT_VISION.md` is the authority on **product scope**. Where any other document or implementation implies a different ownership or relationship, this document governs.

---

## 24. Locked decisions — P0 architecture review, 2026-08-20

Decisions taken by the project owner at the close of the P0 architecture review
and **locked**. This section is the source of truth for the phases that follow.

Three of them **amend** clauses earlier in this document. Each amendment is
named below rather than applied silently, per `CLAUDE.md`. Where §24 and an
earlier section disagree, **§24 governs** and the earlier text is read as
superseded on that point only.

### 24.1 The canonical end-to-end chain (D-1)

```text
Create Project → complete Setup → Activate → Weekly → Monthly
              → Project Executive → Portfolio Executive → Dashboard / Archive
                            ▲
              Master Milestones / Master Deliverables
              (governed registers; Weekly and Monthly report AGAINST them)
```

Fixed properties of the chain:

1. Every project is an **independent workspace and dataset**. §5 isolation is
   unchanged.
2. **Project Executive is per project.** Portfolio Executive consolidates
   approved Project Executive data across projects. This supersedes the
   as-built decision recorded in the Executive portfolio route
   ("one portfolio report per period — never one report per project").
3. Weekly and Monthly **update the same project data** and integrate with the
   Master Milestone and Master Deliverable registers. They do not maintain
   parallel copies.
4. Dashboard serves a **Portfolio view and a selected-Project view from the
   same approved source data**.
5. Old reports remain reachable in **Archive**. Nothing consequential is
   deleted.

### 24.2 Visibility model (D-2) — **amends §5 rule 4 and §9.2 step 2**

Read and write are governed by **different** gates. This is the change; the
earlier text collapsed them into one.

| | Gate |
|---|---|
| **View** | Every authenticated account may view all projects and platform data, subject to 24.2.1 below. Project assignment is **not** required to read. |
| **Write / send / approve / manage** | Limited to the account's role **and** its assigned project **and**, for department-scoped entities, its assigned department. §9.2 resolves unchanged for these actions. |

**24.2.1 Two visibility tiers.** Cross-project visibility does **not** extend to
work in progress.

- **Tier A — visible to every authenticated account, at any state.** Project
  structure and the official record: project identity and setup, departments,
  systems, work-level items, contacts, sites, positions, reference documents,
  calendar events, and the Master Milestone and Master Deliverable
  **registers**.
- **Tier B — raw and in-progress report content.** Report **headers**,
  department submissions, activities, narrative entries, plan items, monthly
  comments and department summaries, and the update streams reported against
  milestones and deliverables. Visible to an unassigned reader **only once the
  parent report is Approved, Finalized or Locked.** Assigned contributors keep
  their existing scoped access at every state, unchanged.

**The Tier B threshold is Approved onward, not Under Review.** A report under
review is still in progress; exposing it platform-wide would publish a position
that Project Control has not yet accepted. This aligns Tier B with §12.3 rule 1
and with the approved-status set the Executive tier already applies.

> **Amended 2026-08-20 during P0.2 — report headers moved from Tier A to
> Tier B.** This section originally placed headers in Tier A so a reader could
> always see that a report exists and what state it is in. That is not
> implementable at row grain: `weekly_reports.summary` *is* the report-level
> Executive Summary narrative, and `monthly_reports.executive_summary` likewise,
> so publishing the header row publishes the unapproved narrative with it. Row
> Level Security is row-level, not column-level.
>
> Moving headers to Tier B is more faithful to the reason stated above than the
> original clause was. The cost is that an unassigned reader does not see draft
> report headers in the register at all. That is a UI completeness gap, not a
> security one; closing it needs a register **view** exposing state without
> narrative, which is P1 work.

> **`archived` is deliberately outside the approved set.** `archive()`
> overwrites `status` with `archived`, and `draft → archived` is a legal
> transition, so an archived row does not imply the report was ever approved.
> Including it would publish abandoned drafts. The consequence — an
> archived-but-previously-approved report loses platform-wide visibility — is a
> real gap for the Archive phase, which needs a durable "was approved" marker
> rather than a status field that erases its own history.

**24.2.2 Visibility never confers authority.** A view-only reader gains no
edit, send, approve or manage right anywhere, on any tier, in any state.
Widening read must never widen write.

**24.2.3 Executive content follows the same publication principle.** *(Locked
2026-08-20.)* The Executive tier is not exempt from Tier B:

- Draft and in-progress Executive content stays **scoped to its authorized
  project and reporting users**.
- Approved, finalized or locked Executive content becomes **platform-wide
  read-only**.
- Draft Executive narrative is **never** exposed platform-wide.
- Write and manage authority is unchanged and stays project-scoped; a portfolio
  record, having no project, keeps its existing author-role gate.

Two consequences worth stating, because they run in opposite directions:

- `executive_reports` was readable by **every** authenticated account at any
  state, drafts included — `executive_summary` is the leadership narrative
  itself. It now opens only from Approved onward, using the same shared
  definition of "approved" as every other tier.
- `executive_notes` has **no status column and no link to a report**, so it has
  no approval state to gate on. Under this principle such content is
  in-progress for its whole life, so portfolio notes — previously readable by
  every authenticated account — are now scoped to Executive authors. If notes
  should ever be publishable, the fix is to give them a lifecycle, not to widen
  a policy over content that has none.

### 24.3 Consolidator authority (D-3) — **amends §8.1 and §8.3**

**Project Control and Reporting Coordinator are project assignments, not
platform roles.** §8.1 lists Reporting Coordinator among the canonical platform
roles; on this point §8.1 is superseded. A person holds them *on named
projects*, several people may hold them on one project, and one person may hold
them on several.

**One canonical rule, used by every layer.** An account is a **project
consolidator** on a project when it holds either of the project's own
consolidation responsibilities, **or** a project assignment carrying the
Project Control Manager or Reporting Coordinator responsibility. The database
and the application must resolve this from **one shared definition**; two
implementations of it is a defect, not a design.

Consequences:

1. The consolidator rule governs who manages the reporting cycle, and who
   approves and finalizes official project reporting data.
2. **Department Manager, or an active Delegate, submits department data.**
   Submission authority and approval authority are never the same authority.
3. **No self-assignment.** No account may grant itself, or any other account, a
   consolidation or department-manager assignment on a project it does not
   already manage. Assignment is a managed act (§9.4 constraint 1 applied to
   assignment as well as delegation).

### 24.3.1 Authority scope tiering (D-3a) — confirmed 2026-08-22, P1-A

Four distinct authorities, deliberately not collapsed into one. This settles the
question raised by the P1-A verification matrix and is **owner-confirmed**.

| Authority | Kind | Scope |
|---|---|---|
| `system_admin` | platform role | Platform-wide, **all projects** |
| `project_control_admin` | platform role | **Portfolio-wide Project Control authority across ALL projects** |
| Project Control | project assignment | Only the projects it is explicitly assigned to |
| Reporting Coordinator | project assignment | Only the projects it is explicitly assigned to |
| Department Manager / Team Member | project assignment | Their project and department scope |

Consequences:

1. `project_control_admin` writing **another** project's setup data is
   **intentional and correct**, not a defect. `can_manage_project_setup()`
   implements exactly this and must **not** be narrowed on those grounds.
2. `system_admin` retains global authority.
3. Reporting Coordinator manages the **reporting workflow**. It does not
   automatically carry full Project Setup or baseline authority; conflating the
   two would silently widen a project-scoped role.
4. Project-scoped `project_control` and `reporting_coordinator` authority is
   **not implemented by P1-A** and is not in its scope. Any future work on it is
   a separate, explicitly authorised wave.

### 24.4 Governed sources of truth (D-4)

Restated here because P0 found live violations of §12.3 and principle 7:

| Fact | Single owner |
|---|---|
| Milestone identity, and its current state | The Master Milestone register and its update stream. **No report tier holds a competing milestone list.** |
| Deliverable identity, and its client-review position | The Master Deliverable register and its update stream |
| Departmental weekly input | The Weekly tier |
| Consolidated monthly position | The Monthly tier, compiled from **Approved, Finalized or Locked Weekly data only**, plus Monthly-owned additions |
| Project and portfolio executive position | Compiled from approved data of the tier below |
| Reported progress | The reporting tiers. A stored progress figure on the project record is a cache, never authoritative (principle 7) |

**24.4.1 One definition of "approved".** Three rules depend on it —
compilation (§12.3 rule 1), visibility (§24.2.1) and aggregation — and they must
never disagree. The set is **`approved`, `finalized`, `locked`**, and it is
defined once per layer:

| Layer | Definition |
|---|---|
| Application | `APPROVED_REPORT_STATUSES` in `src/config/workflows.ts` |
| Database | `public.report_status_is_approved(text)` |

Everything else aliases those two. `APPROVED_MONTHLY_STATUSES` in the Executive
tier and `SIGNED_OFF_STATUSES` in the Weekly tier are **aliases, not second
lists** — before P0.4 they were independent copies, so a later change to what
counts as approved would have moved some rules and silently left others behind.

**`archived` is excluded**, for the reason given in §24.2.1: `archive()`
overwrites `status`, and `draft → archived` is legal, so archived does not imply
ever-approved. Compiling it would raise abandoned drafts into the official
record.

**Previously compiled content is never deleted to satisfy this rule.** A Monthly
row whose source Weekly is not *currently* approved — because it never was, or
because it has since been returned or archived — is history: the Monthly said
what it said at the time, and principle 6 and §24.1 rule 5 both forbid
overwriting that. Such rows are counted and reported, never removed. What to do
about any of them — leave, annotate, or issue a Monthly revision — is an owner
decision.

### 24.5 Enforcement (D-5) — restates §9.3 as a P0 requirement

Report lifecycle transitions and every write authority above are enforced **at
the data boundary**. Guards that exist only in client-side code are
pre-flight guidance, not enforcement, and do not satisfy §9.3.

### 24.6 Frozen scope

**Phase 13.1, 13.2 and 13.3 architecture is frozen.** The Reference Input
metadata model, the Master Milestone identity/state split, and the Master
Deliverable identity/state split with its two distinct approvals are not
reopened except to fix a confirmed P0 defect.

### 24.7 P0 scope, and what it deliberately excludes

P0 addresses only blockers to the chain in 24.1 and to the model in 24.2–24.3.

| # | P0 item | Closes |
|---|---|---|
| P0.5 | Migration replay defect | Reproducibility of the schema |
| P0.6 | One canonical consolidator rule across SQL and application | 24.3 |
| P0.1 | Close privilege escalation on project and project-assignment records | 24.3 item 3 |
| P0.2 | Read policy for platform-wide visibility, with Tier A / Tier B | 24.2 |
| P0.3 | Server-side Weekly and Monthly lifecycle enforcement | 24.5 |
| P0.4 | Monthly compiles only Approved / Finalized / Locked Weekly data | 24.4, §12.3 rule 1 |

**Not in P0, and not to be started before it is accepted:** Reporting
Integration (13.4), Project Executive, the Activate workflow, delegation
authority wiring, notifications, Archive UI, attachments, the remaining
open-policy tables, and any UI redesign.

---

## 25. Pre-Handover Data Reset — MANDATORY DELIVERY GATE

*Locked by the project owner, 2026-08-21, during P0 pre-flight.*

The platform is carrying **test transactional data**. It is retained deliberately
— it is what makes functional and runtime validation possible — and it is
**not** to be cleaned up now.

**It must be removed before final handover.** This is a delivery gate, not
housekeeping: the platform cannot be handed over holding invented projects,
reports and comments that a reader would take for real business records.

### 25.1 What triggered this

P0 pre-flight found 4 Monthly comments compiled from a Weekly at status
`collecting` — the P0.4 defect visible in live data. P0.4 preserves such rows by
design (§24.4: previously compiled content is never deleted), and P0.2 makes an
approved Monthly platform-wide readable. Those two locked decisions together
would publish content derived from a never-approved Weekly.

The owner accepted that consequence **because the data is test data**. That
acceptance is valid only for as long as it *is* test data, which is precisely
why the reset is recorded as mandatory rather than left implicit.

### 25.2 What the reset must remove

Transactional and reporting records — the things a user created while exercising
the platform:

- Weekly reports, submissions, activities, entries, plan items
- Monthly reports, comments, department summaries, plan items
- Executive reports and executive notes
- Milestone and deliverable **update streams**
- Projects and their scoped links, where those projects are test projects
- Project events and attendees
- Uploaded reference documents, and the corresponding objects in storage

### 25.3 What the reset must PRESERVE

- The **schema** in full — tables, columns, constraints, indexes
- **Every RLS policy, function and trigger.** The reset must not become an
  opportunity to relax the security model, and the policy count should be
  verified identical before and after
- **Required configuration and master data** — the boundary here is an owner
  decision at the time, not a rule this document can fix in advance.
  Departments, systems, disciplines, project types, phases, job titles and
  clients may be genuine organisational master data or may be test values, and
  only the owner can say which
- **At least one active System Administrator.** The `profiles` guard enforces a
  floor of one, and several migrations refuse to run without one

### 25.3a Known inconsistent rows to resolve at reset

`M-2026-09` carries `status = archived` with `active = true` and
`archived_at = NULL` — the three fields disagree. It predates the controlled
writer, which sets all three together, so nothing can produce this state now.

Owner decision 2026-08-22: **not repaired**, because it is test data and the
reset removes it. Recorded so it is not later mistaken for a defect in the
current lifecycle code, and so that whoever performs the reset knows to check
for others like it rather than assuming the three fields always agree.

### 25.4 Two technical constraints that will surprise whoever does this

1. **`master_milestones` and `master_deliverables` have no DELETE policy, and
   the update streams are append-only — by design (13.2 / 13.3).** They cannot
   be cleared through the application or as `authenticated` at all. The reset
   needs owner-level or service-role access, and doing it must be a deliberate,
   recorded act rather than a script someone runs casually.
2. **Uploaded files are not in any database backup.** `storage.objects` holds
   metadata; the files live in Supabase Storage. Clearing rows without clearing
   the bucket leaves orphaned files, and clearing the bucket is a separate
   operation.

### 25.5 Done when

A restored copy of the delivered database contains no invented project, report
or comment; carries the same policy, function and trigger counts as before the
reset; retains the agreed master data; and admits its administrator.

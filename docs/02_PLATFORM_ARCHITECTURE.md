# EPRP Platform Architecture

## 1. Purpose and authority

This document defines the **data architecture** of the EPROM Progress Report platform: what entities exist, who owns them, how they relate, and the rules that govern them.

It is the permanent source of truth for the data model. Every implementation phase must conform to it. Where an implementation and this document disagree, this document governs and the difference is reconciled deliberately rather than absorbed.

**Scope boundaries.** This is architecture, not schema. It contains no SQL, no migrations, no table or column definitions, no data types, and no implementation detail. It defines *what must be true*; the implementing phase decides *how*.

It sits beneath [`01_PROJECT_VISION.md`](01_PROJECT_VISION.md), which defines the product. Where the vision names a capability, this document defines the data required to make it real.

> **Scope within the set.** This document covers the platform's structural and data architecture: tiers, ownership, hierarchy, isolation, and the architecture of the permission model. Role definitions and the operating detail of approvals live in [`05_PERMISSION_MODEL.md`](05_PERMISSION_MODEL.md); the concrete schema will live in `06_DATABASE_SCHEMA.md` when written.

> **Locked decisions.** [§24](#24-locked-decisions--p0-architecture-review-2026-08-20) records the decisions locked at the P0 architecture review of 2026-08-20 and is the source of truth for the phases that follow it. Three of them amend text earlier in this document — §5 rule 4, §9.2 step 2, and §8.1/§8.3 — and each amendment is named there. **Where §24 and an earlier section disagree, §24 governs.**

> **Master Planning & Control.** [§26](#26-master-planning--control--approved-architecture-2026-10-14) records the Master Planning & Control architecture approved on 2026-10-14 — planning hierarchy, weights, the performance engine (PV, EV, SPI), baselines, snapshots, manpower, import, and how every consumer reads them. **On planning, performance, milestone-date and manpower matters, §26 governs over every earlier section, including §24.** The statements it changes are listed in §26.18.

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

> **Terminology since Phase 2C.1 — read with §4.5.** In the product, **Project
> Type** now means only the set-once **PSM Project / Other Project** choice,
> stored on the project as `projects.structure_family`. The admin-managed list
> this section calls "Project Type" is shown to users as **Project Category**
> (Engineering, Construction, Inspection, RBI, RCM, Asset Integrity,
> Consultancy, Manpower Supply…). Its table and column keep their legacy names,
> `project_types` and `projects.project_type_id`, and are **not** renamed. In
> code and SQL, `project_types` / `project_type_id` therefore mean **Project
> Category**, never PSM vs Other.

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

### 4.5 Project Type and Project Category (Phase 2C.1)

Project Setup is the **project-definition layer**: it fixes what kind of project this is before any structure, people or planning is attached. Since Phase 2C.1 it separates two choices that §4.2 treats as one:

| Concept | Values | Where it lives | What it decides |
|---|---|---|---|
| **Project Type** | **PSM Project** · **Other Project** | A set-once classification on the project itself | Which setup flow, and therefore which structure, the project uses |
| **Project Category** | Admin-managed list (Engineering, Construction, Inspection, RBI, RCM, Asset Integrity, Consultancy, Manpower Supply…) | The existing master data, still physically named `project_types` / `project_type_id`, **relabelled** "Project Category" in the UI | A descriptive classification for an Other project; carries no structure |

Rules:

1. **Project Type is chosen first** on a new project and **locks on first save**. After that it changes only through an audited System Administrator correction (`05_PERMISSION_MODEL.md` §3.6).
2. **A PSM Project has no Project Category.** Its structure is the fixed PSM hierarchy: Department → System → Program & Study.
3. **An Other Project must have a Project Category,** never a PSM/PSAIM one. A category may allow a project-specific name ("Other → specify"); the name is stored on the project, not added to the shared list.
4. **Legacy projects** created before Phase 2C.1 have no Project Type. They keep their original setup path and terminology until they are classified once.

The setup flow follows the Project Type:

| Project Type | Setup steps |
|---|---|
| PSM | Project Type & Information → Departments → Systems → Programs & Studies → Contacts → Project Team & Responsibilities → Review |
| Other | Project Type & Information → **Project Structure** → Contacts → Project Team & Responsibilities → Review |
| Legacy (unclassified) | Project Info → Departments → Systems → Disciplines → Contacts → Project Team Summary → Review — unchanged |

**An Other Project never falls back to Departments → Systems → Disciplines.** Its configurable structure was delivered in Phase 2C.1c: "Project Structure" is a working step with 1–4 project-specific levels and units, and flags for which units owe Weekly / Monthly input (`20261003000001_project_structure_foundation.sql`; see `15_DEVELOPMENT_ROADMAP.md`). The hierarchy-profile model of §4.2 remains the longer-term target. Since 2C.3C, the Contacts step holds the same Project Team (membership by Project Party) for PSM, Other and legacy projects (`06_DATABASE_SCHEMA.md` §8.8).

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

### 10.5 People Organization Chart (Phase 2C.3F, as built)

The project's Organization Chart page opens on the **People Organization Chart**: the active Project Team arranged by project-level Reports To (`06_DATABASE_SCHEMA.md` §8.8), the canonical people reporting hierarchy. It is derived, read-only and identical for PSM, Other and legacy projects. It never draws on the PSM department hierarchy, the Other Project Structure, responsibility assignments or the parties, and like every chart it grants no permission (§10.3). The positions model in §10.1–§10.4 is kept unchanged as the page's "Position Chart" tab — a separate hierarchy that does not define who reports to whom.

---

## 11. Workflow hierarchy

Three distinct workflows operate at different levels. They are separate mechanisms and must not be conflated.

### 11.1 Setup workflow — derived

Governs whether a project is adequately configured. It is **derived entirely from the project's own data** and never stored as a status.

This is deliberate: a stored setup status becomes wrong the moment data changes by any other route. Derivation is always correct.

Which steps a project has is itself derived from its Project Type (§4.5). A new, unsaved project shows only step 1 as workable; every later step is visible but locked until the first save.

> **Amended 2026-10-15 (§26.23.6).** The setup state **Draft → Ready for
> Planning → Controlled** stays derived. Draft and Ready for Planning are
> derived from the setup checks above. Controlled is derived from an
> **immutable governance anchor**: an approved BL0, the first Published
> Planning Snapshot (including a promoted Opening Position), or, for a
> no-formal-schedule project, an append-only Setup Finalisation record. No
> mutable status column is introduced, so the rule above still holds.

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
WEEKLY REPORT ─────────────── the operational source of truth for reporting entry
      │                        (performance facts: Published Planning Snapshot, §26)
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

> **Amended by §26 (2026-10-14).** Weekly remains the operational source of
> truth for **reporting** entry — narrative, department input, confirmations,
> explanations, actions, decisions and actual manpower. **Project performance**
> (planned and earned progress, variance, SPI, schedule dates, milestone
> schedule state) is owned by the **Published Planning Snapshot**: each Weekly
> and Monthly pins the snapshot for its period and explains it, and never
> re-enters it (§26.2 F6, §26.11). Performance figures are traceable to the
> snapshot (project, version, Data Date) rather than to a department entry.

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

> **Milestone source (§26, 2026-10-14).** Calendar milestones are read from the
> latest Published Planning Snapshot (true milestones and linked governed
> milestones) and, for unlinked governed milestones, from the Master Milestone
> register — never from Weekly or Monthly plan items (§26.13).

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
| Resource Category *(§26.9)* | 1 | Organization | — | Admin-managed; archive when referenced |
| Working Plan — planning node, activity, planned manpower *(§26)* | 2 | Project | — | Changed only by governed acts; archived, never deleted once published |
| Raw planning import *(§26.10)* | 2 | Project | **Yes** | Insert-only; never edited |
| Planning baseline BL0 / BLn *(§26.6)* | 2 | Project | **On approval** | BL0 immutable for ever; re-baseline creates a new one |
| Published Planning Snapshot *(§26.8)* | 2 | Project | **Yes** | The only source of project performance |
| Governed milestone (Master Milestone) | 2 | Project | — | Identity and governance; update stream append-only |
| Actual manpower *(§26.9)* | 3 | Weekly Report | **On approval** | Official when the Weekly is approved |
| PV / EV / SV / SPI, schedule condition | — | **Derived**, frozen in the snapshot | — | Never entered; never recomputed by a consumer |

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
21. Planning, project performance, milestone schedule data and manpower conform to §26.19.

---

## 22. Open reconciliations

Recorded so each is resolved deliberately rather than absorbed silently, per `CLAUDE.md`. **None is resolved by this document** — each is work for the phase that implements it.

| # | Current state | This architecture requires |
|---|---|---|
| 1 | Access control grants every authenticated user full **write** reach across projects, project assignments and master data — an escalation path, not only an audit gap | Read per §24.2; write per §9 resolution, enforced at the data boundary. **P0.1 and P0.2** |
| 2 | The permission matrix exists as configuration but is consulted in only three places | Permissions enforced per §9.3 and §24.5. **P0.3**; the remainder is P1 |
| 2a | Project Control / Reporting Coordinator authority is implemented three times, and the three disagree | One canonical consolidator rule shared by database and application, per §24.3. **P0.6** |
| 2b | Monthly compiles from Weekly reports at any state, including drafts | Approved / Finalized / Locked Weekly data only, per §12.3 rule 1 and §24.4. **P0.4** |
| 2c | Milestone and deliverable data is read by the Dashboard and Executive tiers from report plan items rather than from the governed registers | One register per fact, per §24.4. **Phase 13.4** — not P0. *Update 2026-10-14:* the Dashboard now reads the register; **Executive and Calendar still read plan items.** Closed by 13.14 (Calendar) and 13.20 (Executive) under §26.13 |
| 2i | Five competing progress sources exist (project record, Weekly header, Monthly header, Planning Snapshot roll-up, milestone-register physical %), and SPI has two definitions (EV ÷ PV, and typed Actual % ÷ Planned %) | One performance source — the Published Planning Snapshot — and one SPI, per §26.2 F4 and §26.7. **Phase 13.14** (consumers), **13.17** (Weekly), **13.19** (Monthly) |
| 2j | Planning roll-up is flat: activity weights are treated as project-absolute, planning-node weights are ignored, imported activities are not attached to the WBS, and planned % is copied from the import rather than calculated from baseline dates | Hierarchical local weights and the time-phased engine of §26.4. **Phase 13.10–13.12** |
| 2k | Archived projects are not read-only for Master Milestones, Master Deliverables or any planning table at the data boundary (the operations predicate is not archive-aware) | §26.3 H10. **Phase 13.9** — *closed locally 2026-10-15* by `20261014090000_planning_control_archived_read_only.sql` (guard trigger on all 16 tables; local development database only, not deployed) |
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

> **Amended by §26 (2026-10-14).** *Milestone identity, and its current state*:
> identity and governance remain the Master Milestone register; the schedule
> state of a milestone **linked** to a true milestone activity comes from the
> Published Planning Snapshot (§26.6 rule 5 — pending owner confirmation B1).
> *Reported progress* is replaced by **Project performance — the Published
> Planning Snapshot** (§26.2 F4). Typed report progress survives only for
> projects that are not planning-governed, labelled as such (§26.14).

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

> **Proposed amendment (§26.6 rule 5, 2026-10-14) — pending explicit owner
> confirmation (§26.19 B1).** The identity/state split is kept. The only change
> proposed is *where the schedule state of a linked milestone comes from*: a
> governed milestone linked one-to-one to a true milestone activity reads its
> BL0, BLn, forecast and actual dates from the Published Planning Snapshot.
> Unlinked governed milestones, payment facts and client decisions are
> unchanged. Until confirmed, this freeze stands as written and slice 13.15
> does not start.

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
3. **Archived projects refuse row-by-row clean-up (2C.3E and 13.9).** The
   archived guards refuse every INSERT / UPDATE / DELETE of an archived
   project's setup, Planning, Milestone and Deliverable rows — for the owner
   too. Deleting the whole project row still cascades, but `milestone_updates`
   and `weekly_reports` RESTRICT a project delete. Clearing them first is
   itself refused while the project is archived. The reset must therefore
   either delete such projects in an order the guards allow, or disable the
   guard triggers deliberately as owner for the duration of the reset — a
   recorded act, never a routine script.

### 25.5 Done when

A restored copy of the delivered database contains no invented project, report
or comment; carries the same policy, function and trigger counts as before the
reset; retains the agreed master data; and admits its administrator.

---

## 26. Master Planning & Control — approved architecture (2026-10-14)

**Status: SPECIFICATION — approved by the project owner on 2026-10-14. Not
implemented.** This section is the single implementation contract for project
planning, project performance (progress, PV, EV, variance, SPI, S-curves),
milestone schedule data, manpower, and schedule import. The delivery slices that
implement it are roadmap Phase 13, sub-phases **13.8–13.21**, plus the
pre-engine sub-slices **13.9A** (UI / IA) and **13.9B** (Project Setup
Governance) (§26.23)
([`15_DEVELOPMENT_ROADMAP.md`](15_DEVELOPMENT_ROADMAP.md) Phase 13).

**Authority.** On planning, performance, milestone-date and manpower matters,
**§26 governs** over every earlier section of this document, including §24.
Each earlier statement it changes is named in §26.18 rather than amended
silently. The logical entities are in
[`06_DATABASE_SCHEMA.md`](06_DATABASE_SCHEMA.md) §10A; the permissions are in
[`05_PERMISSION_MODEL.md`](05_PERMISSION_MODEL.md) §3.8; the reporting behaviour
is in [`03_REPORTING_ARCHITECTURE.md`](03_REPORTING_ARCHITECTURE.md) §4.7, §5.5
and §21.4.

**It is not a greenfield design.** It hardens and extends the Phase 13 planning
foundation already in the repository (planning work items, activities, raw
import, confirmations, baselines, published snapshots with a Data Date, Opening
Positions, Weekly/Monthly snapshot pinning) and the governed Master Milestone
register (13.2–13.2d). What is kept, hardened and deprecated is listed in
`06` §10A.9.

### 26.1 Glossary

| Term | Meaning |
|---|---|
| **Working Plan** | The project's governed, editable plan: planning nodes, activities, local weights, dates and progress, as Project Control has entered or accepted them. Never read by any report, dashboard or calendar. |
| **Published Planning Snapshot** ("snapshot") | An immutable, data-dated capture of the Working Plan **and the performance figures calculated from it**. The only source of project performance for every consumer. |
| **Data Date** | The cut-off a snapshot reports as of. Actuals are on or before it; forecasts for incomplete work are on or after it. Never the publish timestamp. |
| **Planning node** | One element of the planning hierarchy above activities: a WBS element, Control Account or Work Package. A node contains other nodes and/or activities. |
| **Planning level** | A depth in the planning hierarchy, with a project-configured label (e.g. "Control Account", "Unit", "Work Package"). |
| **Control Account** | A planning node flagged as the level at which performance is reported and explained (e.g. RBI). |
| **Work Package** | A planning node that holds activities. |
| **Activity** | A leaf of the planning hierarchy that carries work: dates, earning method, progress. |
| **True milestone** | A zero-duration leaf activity marking an event (e.g. *RBI Final Report Approved*, *Mechanical Completion*, *Client Approval Obtained*). Never a parent. A package that contains work (RBI, VDU, CDU) is a node, **never** a milestone. |
| **Governed milestone** | A Master Milestone register entry (13.2): the governance record (code, type, criticality, responsible person, client approval, payment terms, deliverables) for a key, contractual or commercial milestone. |
| **Local weight** | The share, in percent, of its parent that a node or activity carries. The only weight a user enters. |
| **Effective project contribution** ("effective weight") | The share of the whole project a node or activity carries: the product of the local weights on its path. Always calculated, never entered. |
| **Earning method** | How an activity earns progress: Percent Complete, 0/100, 50/50 or Milestone (§26.4). |
| **Planned Value (PV)** | The weighted planned progress at a date, measured against the current approved baseline (BLn). Expressed in percent of the project (or of a node). |
| **Earned Value (EV)** | The weighted progress actually earned at the Data Date, by earning method. Same unit as PV. |
| **Variance (SV)** | EV − PV, in percentage points. |
| **SPI** | EV ÷ PV. The only SPI EPRP shows. |
| **Original baseline (BL0)** | The first formally approved baseline. Immutable for ever; never overwritten by a schedule update; kept for contractual / original variance. |
| **Current approved baseline (BLn)** | The latest approved baseline (BL0 until the first approved re-baseline; then BL1, BL2, …). PV and SPI are measured against it. Created only by a Re-baseline, never by an import. |
| **Baseline Revision** | One approved baseline in the series BL0, BL1, BL2, … The only sense in which a *baseline* is "revised". |
| **Schedule Version** | One preserved import of the project's schedule (Primavera P6 or Excel), with its own reference, Data Date, status and history (§26.22). A project has many over its life; none is ever overwritten. A Schedule Version **never** changes BL0 or BLn. |
| **Schedule Update** | A Schedule Version issued for routine progress at a new Data Date (e.g. "Update 05"). A kind of Schedule Version, not a separate concept. |
| **Schedule Version reference** | The source's own label for a version — e.g. "Rev 00", "Rev 01", "Update 06". A label only: a source "Rev" is a Schedule Version, **not** a Baseline Revision. |
| **Latest accepted Schedule Version** | The most recent **operational** Schedule Version Project Control accepted. The reference every new operational version is compared against. A Historical Correction never becomes it. |
| **Historical Correction** | A back-dated Schedule Version accepted only through the explicit correction workflow: mandatory reason, actor and time, reference to the corrected version or period. It never becomes the current operational version, never alters a snapshot or an approved report, and reaches the Working Plan only through a new current-dated version (§26.22.2). |
| **Removed from current schedule** | The governed state of an activity or node that disappeared from an accepted Schedule Version: archived from the Working Plan, never deleted, still valid in every snapshot and report that captured it (§26.22). |
| **Forecast** | The expected dates of incomplete work at the Data Date — the current schedule, from the latest accepted Schedule Version plus logged Project Control edits. |
| **Actual** | Actual start/finish dates and earned progress, on or before the Data Date. |
| **Re-baseline** | The governed act that creates BLn+1: prepared by Project Control / Planning, approved by Project Control Admin or System Administrator (§26.6). It may be *prepared from* a Schedule Version, but **importing a schedule never re-baselines**. |
| **Normalisation** | An explicit, logged decision that makes a parent's child weights total 100% (proportional rescale, or equal split when none are entered). Never automatic. |
| **Reporting unit** | A section of the Weekly/Monthly report: Department → System → Program & Study on PSM projects; a configured Project Structure unit on Other Projects. |
| **Planning fact** | A statement derived from the pinned snapshot for a reporting period (planned, started, completed, late, milestone due, look-ahead, planned manpower, progress). Read-only in reports. |
| **Confirmation / explanation** | What people add to a planning fact in a report: confirmation, variance explanation, constraint, recovery action, decision needed. |
| **Look-ahead** | Work forecast to start, finish or be in progress in the N weeks after the period (default 2, per project). |
| **Schedule condition** | One derived reading of schedule health (On Track / At Risk / Behind / Unknown) from SPI, key-milestone slip and forecast finish (§26.7). |
| **Planning-governed** | A project whose performance comes from a Published Planning Snapshot. Otherwise "**Reported — not planning governed**" (§26.14). |
| **Resource category** | Admin-managed master data classifying manpower: discipline, craft or engineering team. |
| **Portfolio weight basis** | The single quantity used to weight projects in a portfolio aggregate: budgeted man-hours, or a Project-Control-Admin-assigned project weight (§26.15). |
| **Guided Setup / Advanced mode** | Two ways to edit the **same** Planning Configuration: plain business questions, or the canonical fields directly (§26.20). |
| **Report comment** | Narrative in a Weekly or Monthly section — explanation, constraint, recovery action, note or input. Never a planning fact (§26.21). |

**"Revision" is always qualified** in EPRP wording, because three different
things carry the word: a **Baseline Revision** (BL1, BL2, …), a **Report
Revision** (`03` §12), and a source schedule's own "Rev" label, which in EPRP
is only a **Schedule Version reference**. The bare word "Revision" is not used
on its own in the user interface.

### 26.2 Canonical data flow

```text
 Primavera P6 Excel export / EPRP Excel template            Project Control entry
              │                                                      │
              ▼                                                      │
 RAW IMPORT (immutable) → STAGING → VALIDATION → MAPPING → DIFF       │
              │                                                      │
              ▼  Project Control acceptance (logged)                 ▼
 ┌────────────────────────────── WORKING PLAN ─────────────────────────────┐
 │ planning nodes · activities (tasks, true milestones) · local weights    │
 │ baselines BL0 / BLn · forecast · actuals · planned manpower             │
 │ governed milestones (Master Milestone register) linked to milestones    │
 └─────────────────────────────────────────────────────────────────────────┘
              │  publish (Project Control) — validation must pass
              ▼
 PUBLISHED PLANNING SNAPSHOT (immutable, data-dated, engine-versioned)
   frozen WBS roll-up · activities · milestone states · curves · planned manpower
              │
   ┌──────────┼───────────┬───────────┬───────────┬────────────┬──────────┐
   ▼          ▼           ▼           ▼           ▼            ▼          ▼
 Project   Project     Calendar    Weekly      Monthly     Executive  Dashboard /
 Setup     Progress                (pins)      (pins)      (via         Portfolio
 (read-only)                                               Monthly)
```

**Rules.**

| # | Rule |
|---|---|
| F1 | **No consumer reads the Working Plan or the raw import.** Every performance figure, schedule date and milestone schedule state shown outside the Planning workspace comes from a Published Planning Snapshot. |
| F2 | **The Working Plan changes only through governed acts** — Project Control entry, or accepted import differences — and every change is logged with actor, time and (for changes to imported values) reason. |
| F3 | **No consumer recomputes performance.** The snapshot freezes the calculated results; consumers read them. A dashboard figure always equals the snapshot figure it cites. |
| F4 | **No manually entered project progress is authoritative.** Planned %, Actual %, Variance and SPI are never typed into Project Setup, the project record, or a report for a planning-governed project. The only exception is §26.14. |
| F5 | **No competing milestone list.** Milestone schedule data comes from the snapshot (and, for unlinked governed milestones, from the register); report plan items are never read as milestones. |
| F6 | **Reporting tiers keep their role.** Weekly remains the only tier for operational *reporting* entry — narrative, confirmations, explanations, constraints, actions, decisions, actual manpower. It **pins and explains** planning facts; it does not re-enter them. Monthly compiles approved Weekly plus the month-end snapshot. |
| F7 | **Published history is never rewritten.** A snapshot, a baseline and an approved report are immutable; corrections are a new snapshot, a re-baseline, or a report revision. |

### 26.3 Planning hierarchy

```text
Project (100%)
 └─ Planning node  (level 1 — e.g. Control Account "RBI")
     └─ Planning node  (level 2 — e.g. Unit "VDU")
         └─ … further configured levels …
             └─ Work Package
                 ├─ Activity        (task: duration, earning method, progress)
                 └─ ◆ True milestone (zero duration, leaf)
```

| # | Rule |
|---|---|
| H1 | **Depth and level labels are configured per project** (up to 8 levels), never hardcoded and never tied to the PSM organization structure. Same configuration pattern as the Other-project structure levels (Phase 2C.1c). |
| H2 | A node may be flagged **Control Account**: the level where performance is reported, explained and charted. A project may have Control Accounts at different depths. |
| H3 | **Activities attach to exactly one planning node** once the project has a planning hierarchy. A node's direct children — nodes and activities together — share that node's 100%. |
| H4 | **A true milestone is a leaf.** Start = finish, zero duration, never a parent, no children. A node that contains work is never a milestone. |
| H5 | **Planning node classification is not a level.** The existing classification (Study, Engineering, Inspection, Procurement, Construction, …) describes the work; it does not define depth and does not carry weight. "Milestone" is not a node classification. |
| H6 | **Planning and Project Structure are separate trees that may be mapped.** A node may map to one reporting unit (PSM: Department, optionally System and Program & Study; Other: one Project Structure unit). Children inherit the mapping unless they override it. Unmapped work reports in a project-level section. The mapping drives report sections and filtering; it never changes the planning hierarchy or its weights. |
| H7 | **Same-project and acyclic** — a node, activity, link or mapping may only reference records of its own project; the hierarchy can never loop. |
| H8 | **Archive, never delete.** A node or activity that has ever been published is archived; it stays in every snapshot that captured it. |
| H9 | **Stable identity.** Imported nodes match on the external WBS code, imported activities on the external Activity ID — never on titles (§26.10). EPRP-created items carry their own stable code. |
| H10 | **Archived projects are read-only** for the whole Working Plan, publishing, import, baselines and governed milestones, for every role and every route. |

**PSM and Other Projects** use the same hierarchy model. Only the reporting-unit
mapping (H6) differs, because their Project Structures differ.

### 26.4 Weights and the performance calculation

**What users enter.** A **local weight** for each node and activity, in percent
of its parent. EPRP calculates every other weight and figure.

```text
Effective weight      EW(x) = Π ( local_weight(a) / 100 )  over x and every ancestor a below the Project
                      (so EW(Project) = 100%, and the EWs of all leaves sum to 100%)

Activity PV%(t)       planned % complete at date t against BLn, by the PV distribution of its earning method
Activity EV%          % earned at the Data Date, by its earning method

Node PV% / EV%        Σ child_local_weight × child_PV% (or EV%)  /  100
Project PV% / EV%     Σ over leaf activities of  EW(activity) × activity PV% (or EV%)
                      — identical to rolling up level by level

SV                    EV% − PV%                     (percentage points; node or project)
SPI                   EV% ÷ PV%                     (node or project; "N/A" when PV% = 0)
```

**Earning methods (initial set)**

| Method | Applies to | EV at the Data Date | PV distribution against BLn |
|---|---|---|---|
| **Percent Complete** | Tasks | The confirmed physical % complete | **Linear over the project's working days** between BLn start and BLn finish |
| **0/100** | Tasks | 0 until actual finish, then 100 | 0 until BLn finish, then 100 |
| **50/50** | Tasks | 50 at actual start, 100 at actual finish | 50 at BLn start, 100 at BLn finish |
| **Milestone** | True milestones | 0 until the actual date, then 100 | 0 until the BLn date, then 100 |

Weighted steps and front/back-loaded distributions are later extensions. PV
for the discrete methods follows the same points as their EV, so a correctly
progressing 0/100 or 50/50 activity never shows a false variance. Working days
come from the project's configured working week; a project holiday calendar is
a later extension.

**Weight rules**

| # | Rule |
|---|---|
| W1 | **Project = 100%.** Each parent's direct children (nodes and activities together) must total **100% ±0.01** before a snapshot can be published. |
| W2 | **Partial or missing weights block publishing.** Publishing names every parent whose children do not total 100% or have a missing weight. |
| W3 | **Normalisation is explicit and logged.** Project Control may choose, per parent: *proportional rescale* of the entered weights to 100%, or *equal split* when no child weight is entered. The decision, its actor and the resulting weights are recorded and frozen in the snapshot. EPRP never normalises silently. |
| W4 | **Effective weights are never entered**, never stored as user data, and always shown beside the local weight. |
| W5 | **True milestones carry 0% local weight** by default. A milestone may carry weight only when its parent work package deliberately earns through milestones; that weight then comes out of the parent's 100% like any other child. |
| W6 | **Commercial / payment milestones never contribute to physical progress.** They are not part of the weighted planning tree. Commercial progress (payment share received) remains the separate measure of 13.2c and is never added to physical progress. |
| W7 | **Imported weights are proposals.** A schedule may supply weights; the mapping must declare whether they are local or absolute (absolute weights are converted to local). They enter the Working Plan only through accepted differences (§26.10). Weights are EPRP-governed data. |

**Progress completeness rules**

| # | Rule |
|---|---|
| C1 | **Not started is a real 0.** An activity with no actual start earns 0 under every method; that is a fact, not missing data. |
| C2 | **Started but unmeasured blocks publishing.** A Percent Complete activity with an actual start and no confirmed % complete is named by publish validation. |
| C3 | **Every v2 snapshot therefore covers 100% of the weighted plan.** Coverage is still recorded with every snapshot, and legacy snapshots (§26.8) keep their declared coverage. |
| C4 | **Absence is never zero** for a node or project with no published snapshot: it reads "No published plan", never 0%. |

**Project types.** One engine and one SPI definition for every project.
Projects differ only in which earning methods their activities use (e.g. PSM
study packages: Percent Complete with milestone-earned report steps;
construction: Percent Complete or 0/100).

### 26.5 Worked example — Project → RBI → VDU / CDU / Utilities

Data Date **31 Oct 2026**. The project has three Control Accounts: **RBI 10%**,
HAZOP 50%, SIL 40% (local weights under the Project). HAZOP and SIL are shown
rolled up; RBI is shown to activity level.

**Effective weights — calculated by EPRP, never typed**

| Element | Local weight | Effective project contribution |
|---|---|---|
| RBI | 10% of Project | **10%** |
| ├ VDU | 40% of RBI | 10% × 40% = **4.0%** |
| ├ CDU | 35% of RBI | 10% × 35% = **3.5%** |
| └ Utilities | 25% of RBI | 10% × 25% = **2.5%** |

**Activity level** (PV against BLn; EV by method)

| Activity | Method | Local | Effective | PV% | EV% | PV contribution (pts) | EV contribution (pts) |
|---|---|---|---|---|---|---|---|
| VDU-A10 Data collection | Percent Complete | 30 | 1.2% | 100 | 100 | 1.200 | 1.200 |
| VDU-A20 Damage mechanisms & corrosion loops | Percent Complete | 40 | 1.6% | 80 *(16 of 20 BLn working days elapsed)* | 60 | 1.280 | 0.960 |
| VDU-A30 Draft RBI report | Percent Complete | 30 | 1.2% | 20 *(4 of 20)* | 0 *(not started)* | 0.240 | 0.000 |
| ◆ VDU-M10 *VDU RBI Final Report Approved* | Milestone | 0 | 0% | — | — | 0 | 0 |
| CDU-A10 Data collection | 50/50 | 40 | 1.4% | 100 | 100 *(started and finished)* | 1.400 | 1.400 |
| CDU-A20 Corrosion assessment | Percent Complete | 60 | 2.1% | 20 | 15 | 0.420 | 0.315 |
| UTL-A10 Site walkdown | 0/100 | 20 | 0.5% | 100 *(BLn finish passed)* | 100 *(finished)* | 0.500 | 0.500 |
| UTL-A20 Data collection | Percent Complete | 80 | 2.0% | 0 *(BLn start not reached)* | 5 *(started early)* | 0.000 | 0.100 |

**Roll-up**

| Node | Local | PV% | EV% | SV (pts) | SPI | Contribution to Project PV / EV (pts) |
|---|---|---|---|---|---|---|
| VDU | 40 | 0.3×100 + 0.4×80 + 0.3×20 = **68.0** | 0.3×100 + 0.4×60 + 0.3×0 = **54.0** | −14.0 | **0.79** | 2.720 / 2.160 |
| CDU | 35 | 0.4×100 + 0.6×20 = **52.0** | 0.4×100 + 0.6×15 = **49.0** | −3.0 | **0.94** | 1.820 / 1.715 |
| Utilities | 25 | 0.2×100 + 0.8×0 = **20.0** | 0.2×100 + 0.8×5 = **24.0** | +4.0 | **1.20** | 0.500 / 0.600 |
| **RBI** | 10 | 0.40×68 + 0.35×52 + 0.25×20 = **50.40** | 0.40×54 + 0.35×49 + 0.25×24 = **44.75** | −5.65 | **0.89** | **5.040 / 4.475** |
| HAZOP | 50 | 70.0 | 66.0 | −4.0 | 0.94 | 35.000 / 33.000 |
| SIL | 40 | 30.0 | 30.0 | 0.0 | 1.00 | 12.000 / 12.000 |
| **Project** | 100 | **52.04** | **49.475** | **−2.565** | **0.95** | — |

**Two calculation paths, one answer.** Level by level: RBI contributes
10% × 50.40 = 5.04 points of PV. By effective weights: VDU 4.0% × 68 + CDU
3.5% × 52 + Utilities 2.5% × 20 = 2.72 + 1.82 + 0.50 = 5.04. The engine must
produce the same figure both ways (an engine test, not a convention).

**Reading it.** RBI is behind (SPI 0.89, −5.65 pts). The cause is VDU-A20/A30;
Utilities is ahead. The project overall reads SPI 0.95, −2.57 pts.

**The milestone is reported separately.** VDU-M10 carries no weight, so it does
not move SPI. With BL0 date 1 Dec, BLn date 15 Dec and forecast 29 Dec it reads
**+14 days against the current baseline and +28 days against the original** —
two numbers, never blended — and its schedule condition contributes to the
project's schedule condition (§26.7).

**When data is incomplete.**
- *Utilities' weight left blank:* RBI's children total 75%. Publishing is
  blocked ("RBI: child weights total 75%"). Project Control enters the weight,
  or explicitly normalises (proportional rescale → VDU 53.333, CDU 46.667), and
  the choice is logged and frozen.
- *VDU-A20 started with no confirmed %:* publishing is blocked (C2). It is
  never counted as 0 and never silently dropped.

### 26.6 Baseline, current, forecast, actual and Data Date

| Concept | Meaning | Changes only by |
|---|---|---|
| **Original baseline (BL0)** | First approved baseline — dates, local weights and planned manpower of every activity at approval, and the baseline curve | Never. Immutable for ever |
| **Current baseline (BLn)** | Latest approved baseline. **PV and SPI are measured against BLn** | An approved re-baseline (creates BLn+1; BLn is retained) |
| **Forecast** | Expected start/finish of incomplete work at the Data Date — the current schedule | An accepted **Schedule Version** (§26.22) or a logged Project Control edit. **Never changes BL0 or BLn** |
| **Actual** | Actual start/finish and earned progress, on or before the Data Date | Same |
| **Data Date** | The cut-off of a snapshot | Fixed per snapshot; required to publish |

**Rules.**

1. **Variance is shown against both baselines and never blended.** Performance
   (PV, SV, SPI) is against BLn; slip of dates and milestones is shown against
   BLn **and** against BL0.
2. **Re-baseline governance.** The assigned Project Control / Planning holder
   may *request and prepare* a re-baseline, with a reason. **Only a Project
   Control Admin or System Administrator approves it.** On approval the new BLn
   is frozen with its own baseline curve; nothing already published changes.
   Whether the approver may be the same person as the preparer is open
   (§26.19, B3).
3. **Data Date integrity.** Actual dates after the Data Date, or a forecast
   before it for incomplete work, fail publish validation.
4. **Reconstruction.** "What did the plan and progress look like on date X?" is
   answered by the latest published snapshot whose Data Date ≤ X: its frozen
   activities, roll-up, milestone states, curves and planned manpower, plus the
   baselines it references. Nothing has to be recalculated, and nothing
   recalculated may replace it.
5. **Governed milestone dates.** A governed milestone **linked** to a true
   milestone activity reads BL0, BLn, forecast and actual from the snapshot. An
   **unlinked** governed milestone (no planning hierarchy yet, or a commercial
   milestone) keeps its register dates and update stream (13.2–13.2d). Payment
   and client-decision facts always remain in the milestone update stream. This
   rule amends §24.6 and is **pending explicit owner confirmation** (§26.19, B1).

### 26.7 S-curves, SPI and schedule condition

| Curve | Calculated from | Written | Changes |
|---|---|---|---|
| **Baseline curve** (BL0, and each BLn) | Baseline dates × effective weights, PV distributed by method over a weekly grid to completion | When the baseline is approved | Never |
| **Current / forecast curve** | Actual progress to the Data Date, then forecast dates for remaining work | With each published snapshot | Never (a later snapshot adds a new curve). **A Schedule Update moves the forecast curve; only an approved Re-baseline creates a new baseline curve** (§26.22) |
| **Earned (actual) curve** | Project and Control Account EV% at each published snapshot's Data Date | One point per snapshot | Never |

**Rules.**

1. **Points exist only where data exists.** Earned points sit at real Data
   Dates only; gaps are never interpolated and never plotted as 0. The weekly
   grid follows the project's reporting day.
2. **Published history is never rewritten.** Every snapshot records the engine
   version that produced its figures; a later engine change does not alter an
   existing snapshot.
3. **SPI is EV ÷ PV from the weighted model, and nothing else.** EPRP never
   shows an SPI computed from typed Actual % ÷ Planned %, from elapsed time or
   dates alone, or as an average of other SPIs. With PV = 0, SPI is "N/A".
4. **SPI is read with schedule condition.** SPI converges to 1.00 as work
   completes, even on a late project. The **schedule condition** is therefore
   one derived reading combining SPI, the slip of key milestones against BLn,
   and the forecast project (or Control Account) finish against BLn:

   | Condition | Proposed default rule (thresholds to be confirmed, §26.19 B4) |
   |---|---|
   | **On Track** | SPI ≥ 0.95, no key milestone forecast later than BLn, forecast finish ≤ BLn finish |
   | **At Risk** | 0.90 ≤ SPI < 0.95, or a key milestone forecast up to 14 days later than BLn |
   | **Behind** | SPI < 0.90, or a key milestone forecast more than 14 days late, or forecast finish later than BLn finish |
   | **Unknown** | No published snapshot, or PV = 0 with no key milestone due |

   One function defines it for every surface. It replaces the separate Weekly
   and Monthly status bands, which currently disagree.

### 26.8 Published Planning Snapshot — the contract

At its Data Date a v2 snapshot provides:

| Provides | Notes |
|---|---|
| Identity and provenance | Project, snapshot version, Data Date, BL0 and BLn references, **source Schedule Version** (or Opening Position, or manual), the logged Project Control edits applied after that Schedule Version, publisher and time, engine version, coverage — enough to answer "where did these numbers come from?" (§26.22) |
| **Frozen WBS roll-up** | Per node: local and effective weight, PV%, EV%, SV, SPI, schedule condition |
| **Frozen activities** | Dates (BL0, BLn, forecast, actual), earning method, local and effective weight, PV% and EV% at the Data Date, reporting-unit mapping, external ID |
| **Frozen milestone states** | Every true milestone and every governed milestone: code, name, type, criticality, key flag, BL0/BLn/forecast/actual dates, slip against each baseline, schedule condition — so a report reproduces milestone status exactly as published |
| **Curves** | The BLn and BL0 baseline curves it references, its current/forecast curve, and its earned point |
| **Planned manpower** | The time-phased planned histogram (§26.9) |
| **Derived on read, from the frozen rows and a period** | Activities planned, started, completed, late or overdue in a period; milestones due, achieved or upcoming; the look-ahead. Deterministic, so nothing more is stored |

**Invariants.**

1. **Immutable.** Written once by the governed publish act and never updated or
   deleted.
2. **Validated.** Publishing requires a Data Date, complete weights (W1–W3),
   complete progress (C2), Data Date integrity (§26.6 rule 3), and an approved
   BL0 — except an Opening Position snapshot, which declares a position and
   carries no baseline. BL0 is established by Project Control and approved
   under the same rule as a re-baseline, pending confirmation (§26.19 B8).
3. **Resolution.** *Current position* = the latest published snapshot.
   *Position for a period ending P* = the latest published snapshot with
   Data Date ≤ P (ties broken by version). Several snapshots may share a Data
   Date; the highest version is the one in force.
4. **Authority.** Publishing is Project Control (§26.19 and `05` §3.8).
5. **Legacy snapshots.** Snapshots published before 13.12 keep their existing
   flat roll-up and figures, are labelled "legacy calculation", and are never
   re-derived. **Opening Position** snapshots stay as built: a declared planned
   and actual % for a project onboarded mid-execution, with SPI "N/A".

### 26.9 Manpower and resources

Manpower is part of planning and **separate from SPI**. Resource variance and
schedule performance are different measures and are never combined.

| Element | Rule |
|---|---|
| **Resource category** | Admin-managed master data (discipline, craft or engineering team). Never hardcoded. Archived, never deleted, when referenced. |
| **Party** | EPROM, Client/Owner or a subcontractor — the project's own Project Parties (Phase 2C.3A/B). |
| **Planned manpower** | Time-phased by week: planned headcount and planned man-hours per resource category × party, optionally per planning node or activity. Entered by Project Control or imported; part of the Working Plan; frozen in each snapshot and with each baseline. |
| **Actual manpower** | Actual headcount and man-hours per week × resource category × party, recorded in the Weekly report and **official when that Weekly is approved**. The approved Weekly is the owner; the snapshot never copies it. |
| **Outputs** | Weekly and monthly planned-vs-actual histograms, headcount and man-hour variance, cumulative planned vs actual man-hours. |
| **Weighting** | Budgeted man-hours may later become an explicit weight basis for a parent (§26.4 W3); not in the initial set. They are the preferred portfolio weight basis (§26.15). |

The existing single "man-hours to date" figure on the Weekly report is
superseded by the actual-manpower record. Who records actual manpower in a
Weekly is open (§26.19, B5).

### 26.10 Primavera / Excel import

```text
Raw Import → Staging → Validation → Mapping → Diff → Project Control Acceptance → Working Plan → Published Snapshot
```

| Stage | Rule |
|---|---|
| **Raw Import** | The uploaded file and every parsed row are kept exactly as received, insert-only, for ever. **Every import creates a new Schedule Version**; no earlier version is overwritten (§26.22). |
| **Staging** | Parsed, typed rows bound to their batch. The Data Date is captured (detected or entered) before acceptance. |
| **Validation** | Required fields, date order, Data Date integrity, duplicate IDs, unknown WBS parents, hierarchy loops, milestone shape (zero duration), weight semantics. Errors block; warnings are shown. |
| **Mapping** | Columns to fields; WBS codes to planning nodes; activity IDs to activities; resource IDs to resource categories; milestone activities to governed milestones; weight semantics (local or absolute). |
| **Diff** | Against the **latest accepted Schedule Version** (§26.22): added, removed (missing from source), changed (dates, durations, %, weights, WBS moves, relationships, resources / manpower, activity status, earning method), and every change touching a governed milestone. Any item Project Control has edited in EPRP since that version is flagged as a conflict for explicit resolution. |
| **Acceptance** | Project Control accepts the batch with explicit row exceptions; each accepted or rejected difference is logged with actor, time and reason. |
| **Publish** | A separate act. Acceptance alone publishes nothing. |

**Rules.**

1. **Initial formats:** the EPRP Excel template and the Primavera P6 Excel
   export. **Native P6 XER is a later, separately signed-off slice (13.21).**
2. **Stable matching only.** Activities match on the external Activity ID, WBS
   on the external WBS code, resources on resource ID. **Never on titles.** A
   renamed ID is treated as removed + added unless Project Control records an
   explicit, logged re-match.
3. **Field ownership.** *Schedule-owned* — dates, durations, % complete,
   relationships — change only through accepted differences. *EPRP-owned* —
   local weights (unless accepted from the import, W7), reporting-unit mapping,
   responsible people, governed-milestone attributes, earning method once set
   in EPRP — are never changed by an import.
4. **Nothing silently overwrites governed data.** Every change to the Working
   Plan arrives as a visible, accepted difference.
5. **Removed from source** is flagged, never deleted. Accepting the removal
   archives the item. An item linked to a governed milestone cannot be removed
   until Project Control resolves the link.
6. **Re-import** of a later schedule update repeats the full pipeline against
   the current Working Plan. A row is "reviewed" only when its difference in
   *this* batch has been decided — never because the activity already exists.
7. **Milestone linking.** A true milestone activity links one-to-one to a
   governed milestone. An unmatched imported milestone offers "create governed
   milestone" or "link to existing"; neither happens automatically.
8. **Relationships** (predecessors) are stored when the source provides them,
   for display and look-ahead context. EPRP does not schedule (no CPM engine).
9. **Excel is the exception path, not a second database** (Phase 8 principle):
   platform entry by Project Control remains a first-class way to build and
   update the Working Plan.

### 26.11 Automatic Weekly and Monthly derivation

**Weekly.** A Weekly report **pins** a snapshot: the latest published snapshot
with Data Date ≤ the period end.

| Rule | |
|---|---|
| **Re-pin until approval** | While the report is not yet approved, a reporting-workflow manager may re-pin to a newer eligible snapshot (an explicit, recorded act; the report shows when one exists). **Approval freezes the pin** with the rest of the report. |
| **Declared staleness** | If the pinned Data Date is earlier than the period end, the report says so. EPRP never fabricates figures to fill the gap. |
| **Look-ahead** | Default 2 weeks after the period end, configurable per project. |

| Planning fact (for period start → end, pinned snapshot) | Definition |
|---|---|
| Planned this period | BLn or forecast window overlaps the period and the activity was not finished before the period start |
| Started / completed this period | Actual start / actual finish inside the period |
| Late | Not finished and BLn finish earlier than the Data Date, or forecast finish later than BLn finish |
| Overdue start | BLn start earlier than the Data Date and no actual start |
| Milestones due | True or governed milestone with BLn or forecast date inside the period |
| Milestones achieved | Actual date inside the period |
| Upcoming milestones | Forecast date inside the look-ahead window |
| Look-ahead | Forecast start, finish or in-progress inside the look-ahead window |
| Progress | Snapshot PV, EV, SV, SPI and schedule condition — project and each reporting unit (via H6) |
| Manpower | Planned (snapshot) vs actual (recorded in this Weekly, §26.9) |

**People confirm and explain; they do not re-type.** Planning facts are
read-only rows. Contributors attach confirmations, variance explanations,
constraints, recovery actions and decisions to them, using the existing Weekly
narrative entries (risks, issues, actions, decisions, comments), which gain
optional references to the activity, node or milestone they explain. Monthly
carry-forward of those entries keeps working unchanged. The collaborative
comment layer that carries these explanations is specified in §26.21.

For a **planning-governed** project the following are no longer entered by
hand: Planned % / Actual %, typed SPI, free-text "major activities" that
duplicate planned activities, free-text milestone rows, and next-week plan rows
that duplicate the look-ahead. Their existing rows remain readable history.
Weekly milestone observations for **unlinked** governed milestones (13.4 Wave 1)
continue unchanged.

**Monthly** uses:

- approved Weekly narrative and observations (as built, §5 of `03`);
- the **month-end snapshot** — the latest published snapshot with Data Date ≤
  the month end — pinned the same way as Weekly and frozen at approval;
- S-curves to the Data Date, SPI and schedule condition;
- **milestone movement**: month-start snapshot (latest with Data Date ≤ the
  previous month end) vs month-end snapshot — achieved, newly late, forecast
  moved, re-baselined;
- manpower for the month: planned from the snapshot, actual from the month's
  approved Weeklies;
- the next-month look-ahead from the month-end snapshot.

**Approval freezes** the pinned snapshot and the Monthly's own content; because
snapshots are immutable, the planning facts of an approved Monthly can never
drift.

### 26.12 One reporting engine for PSM and Other Projects

One Weekly engine and one Monthly engine. The **common core** for every project:
progress, milestones, activities, look-ahead, manpower, constraints, actions,
decisions and variance explanation.

**Dynamic sections** come from the project's reporting units:

| Project Type | Sections | Who writes a section |
|---|---|---|
| **PSM** | Department → System → Program & Study (as built) | Unchanged: the PSM department roles of `05` §3.7 |
| **Other Project** | Configured Project Structure units flagged for Weekly input (Phase 2C.1c / 2C.3D) | The unit's **Weekly Responsible and Weekly Backup** — **only their assigned unit's section**, while the report accepts section input |

**Other-project reporting-write scope** (approved 2026-10-14) is reporting
write only. It grants no Project, Planning, publishing, approval, return or
setup authority, and no access to any other unit's section. It amends the
"authority-free" status of the Weekly Responsible / Backup recorded for 2C.3D,
and takes effect only when slice 13.18 implements it. Until then that status is
unchanged.

**Planning facts are canonical whatever the project type.** Each section shows
the facts of the planning work mapped to it (H6); unmapped work appears in a
project-level section.

### 26.13 Consumer integration matrix

| Consumer | Reads | Shows | Never |
|---|---|---|---|
| **Project Setup — Planning Status** (compact; replaces the Governed Performance block, §26.23.4) | Latest snapshot | **Read-only**: snapshot version, Data Date, PV, EV, variance (SV), SPI, schedule condition, and a link to Project Progress. Onboarding Mode and the setup state sit beside it in Planning Entry | Any editable Planned / Actual / Variance / SPI field; large performance cards; any Opening Position action. *As built, the Governed Performance panel also records and promotes an Opening Position. That action moves to Planning Workspace → Baselines & Snapshots only, in **13.9A** (previously scheduled for 13.14)* |
| **Project Progress** (read-only analytical workspace, §26.23.8) | Latest snapshot (history: earlier snapshots) | Performance header; KPI row; S-curve; WBS / Control Account performance with local and effective weights and per-node PV/EV/SPI; exceptions and schedule health; manpower later, as a separate section | The project record's stored progress; percent-ratio SPI; a manual "update progress" route for a planning-governed project. *Only a no-formal-schedule project offers "Update Reported Progress", writing to the Reported Progress stream (§26.14, from 13.9B)* |
| **Calendar** | Latest snapshot; unlinked governed milestones from the register | True milestones and governed milestones as points (actual if achieved, else forecast, with BLn in detail); look-ahead work only as a separate entry type | Weekly or Monthly plan items read as milestones |
| **Weekly** | Its pinned snapshot | §26.11 planning facts per section | Typed progress or SPI for a planning-governed project |
| **Monthly** | Approved Weeklies + its pinned month-end snapshot | §26.11 Monthly content | The live milestone register; recomputed figures |
| **Executive — project** | The approved Monthly and its pinned snapshot | Position, schedule condition, key milestones, movement, manpower | Report plan items as milestones; title-and-date de-duplication |
| **Executive — portfolio** | Approved Project Executive / Monthly positions | §26.15 aggregation | Averaged SPI or progress |
| **Dashboard — project** | Latest snapshot | PV, EV, SV, SPI, schedule condition, next key milestone, overdue and due-soon milestones, items due this week, planned vs actual manpower, S-curve summary | A typed Weekly/Monthly figure presented as planning-governed |
| **Dashboard — portfolio** | Latest snapshot per project | §26.15 aggregation, or the distribution when not eligible | Unweighted means |

A Dashboard reading the latest snapshot does not "recompute" (F3): it presents
frozen figures. Its Weekly/Monthly *reporting-status* panels continue to read
the reports.

### 26.14 Projects without formal planning

A project with no published snapshot — including onboarding mode "no formal
schedule" — is **not planning-governed**:

- it may show reported Planned % / Actual % entered on its Weekly or Monthly
  report, always labelled **"Reported — not planning governed"** *(as built;
  from 13.9B the canonical value is the Reported Progress stream below, and
  from 13.17–13.19 reports reference an entry instead of owning a typed
  value — §26.24.5)*;
- **SPI is "N/A"** (never a ratio of typed percentages); variance may be shown
  with the same label;
- it is excluded from portfolio progress and SPI aggregates and listed as such
  (§26.15);
- once its first v2 snapshot is published, typed progress locks for every later
  report;
- **"Update Reported Progress"** (approved 2026-10-15, D7; storage closed by
  B14) is a lightweight action on Project Progress, offered **only** for
  onboarding mode "no formal schedule". It is visibly labelled "Reported — not
  planning governed", and SPI stays "N/A". A planning-governed project never
  updates progress manually from Project Progress.
- **Reported Progress stream** (B14, closed 2026-10-15). For a
  "no formal schedule" project, the canonical progress source is a dedicated,
  append-only **Reported Progress stream**. Each entry preserves:
  - the project;
  - the Data Date (as-of date);
  - reported planned progress, where applicable;
  - reported actual progress;
  - a narrative / comment;
  - the actor and timestamp;
  - the source / provenance.
- **Who does not own the value.**
  - The project record's `planned_progress` / `actual_progress` fields are
    **not** the canonical source.
  - Weekly and Monthly are **not** the canonical source either. They may
    reference or consume the latest applicable entry, but never own the value.
  - Entries are never edited or overwritten; a correction is a new entry.
  - The stream and its write workflow are delivered by **13.9B**. Until then,
    no surface offers the write action and no temporary store is introduced.

An **Opening Position** snapshot (a project onboarded mid-execution) is
planning-governed with declared figures and SPI "N/A". A **legacy** snapshot
(before 13.12) shows its existing figures, labelled "legacy calculation".

### 26.15 Portfolio aggregation

**Never average SPI or progress percentages directly.** Example: Project A
(20,000 budgeted man-hours, PV 55%, EV 50%, SPI 0.91) and Project B (2,000
man-hours, PV 60%, EV 90%, SPI 1.50). The mean SPI reads 1.20; the weighted
SPI is (10,000 + 1,800) ÷ (11,000 + 1,200) = **0.97**.

| Rule | |
|---|---|
| **Weight basis** | Budgeted man-hours (from the project's current baseline) where available; otherwise a Project-Control-Admin-assigned project weight. **One basis per aggregate**: man-hours when every eligible project has them, otherwise assigned weights when every eligible project has one. |
| **Formulas** | Portfolio EV% = Σ(basis × EV%) ÷ Σ basis · Portfolio PV% = Σ(basis × PV%) ÷ Σ basis · Portfolio SPI = Σ(basis × EV%) ÷ Σ(basis × PV%) |
| **Eligibility** | Every in-scope project is planning-governed with a non-legacy snapshot whose Data Date is within the staleness window of the portfolio date (proposed default 14 days, §26.19 B6), and carries the chosen basis. |
| **When not eligible** | No portfolio SPI and no portfolio progress figure. Show the distribution instead: projects by SPI band, median, the worst projects, and every excluded project with its reason. |
| **Coverage** | Every aggregate declares how many projects contributed, as of which Data Dates, and which were excluded and why (`03` §7.4). |

### 26.16 Future Tasks boundary

Tasks are designed **after** the Planning and Reporting foundation (after
13.20). They are not part of any slice in this section.

- A task may link to a planning node, an activity, a governed milestone, a
  Project Structure unit, a responsible project member, a deputy/backup, a
  delegation period and a participating team — all within the same project.
- **Tasks never become a project-progress source.** The activity remains the
  unit that earns progress.
- Task completion may only **propose** an activity's progress, which Project
  Control accepts into the Working Plan like any other governed change.
- Responsibility for a task grants no project, planning or approval authority
  unless a later approved permission change says so.
- Archived projects are read-only for tasks as for everything else.

### 26.17 Implementation slices

The delivery order, dependencies and done-when criteria are in
[`15_DEVELOPMENT_ROADMAP.md`](15_DEVELOPMENT_ROADMAP.md) Phase 13
(13.8–13.21). In dependency order: specification → archived/read-only guards →
pure Planning Engine core → Working Plan hardening → Snapshot v2, baselines and
curves → manpower foundation → core consumers → milestone governance/linkage →
import v2 → automatic Weekly (PSM) → Other-project reporting sections → Monthly
→ Executive and portfolio → native XER → Tasks design.

Guided Planning Setup (§26.20) belongs to the Planning Setup work of **13.11**,
extended by the slices whose configuration it asks about. Collaborative
Weekly/Monthly comments (§26.21) belong to **13.17** (PSM Weekly), **13.18**
(Other-project sections) and **13.19** (Monthly). Schedule Versions and their
history (§26.22) belong to **13.16** (Import v2), with snapshot provenance and
Baseline Revisions in **13.12**. None of these changes the slice order.

**13.9A — Planning Experience Foundation** (approved 2026-10-15) is a
pre-engine **UI / information-architecture** sub-slice between 13.9 and 13.10.
It applies the navigation, Planning Workspace, Project Setup and Project
Progress structure of §26.23. It computes nothing and changes no schema or data
ownership. Later slices fill the structure it creates (§26.23.9). **13.9B —
Project Setup Governance** (B11, closed 2026-10-15) follows it and delivers setup
control, setup amendments, the no-formal-schedule finalisation record and the
Reported Progress stream. It is separate from the Planning Engine. Sequence:
13.9A → 13.9B → 13.10. The existing slices are not renumbered.

### 26.18 Statements this section amends

| Where | Previously | Now |
|---|---|---|
| §12.1 | "WEEKLY REPORT — the operational source of truth" | Weekly remains the source of operational **reporting** entry; project **performance** and schedule facts come from the Published Planning Snapshot, which Weekly pins and explains (F6) |
| §14.1 | KPI values are owned by the report | Schedule performance values (PV, EV, SV, SPI) are owned by the snapshot; a report **cites** the snapshot it pinned |
| §17.3 | Calendar derives milestones (unspecified source) | Calendar milestone points come from the snapshot and the register (§26.13) |
| §24.4 — *Milestone identity, and its current state* | The Master Milestone register and its update stream | Identity and governance: the register. Schedule state of a **linked** milestone: the snapshot (§26.6 rule 5, pending B1) |
| §24.4 — *Reported progress* | The reporting tiers; the project record is a cache | **Project performance**: the Published Planning Snapshot. The project record is never authoritative; typed report progress applies only under §26.14 |
| §24.6 | 13.2 identity/state split frozen | Unchanged except for §26.6 rule 5, which is **pending explicit owner confirmation** before 13.15 starts |
| `03` Laws 1 and 6, §21 | Weekly is the single source; dashboards read approved reports | Amended in `03` §2 and §21.4 |
| `06` §10 | Lifecycle stage weight feeds project progress; milestone owned by the Project Lifecycle | Amended in `06` §10.9 |
| `06` §8.9 / `05` §3.7 | Weekly Responsible / Backup grant no report-writing right | Amended for Other projects from 13.18 (§26.12) |
| `08` §6.2, §13.3 rule 4 | Completion from weighted lifecycle stages | Completion = snapshot EV% (amended in `08`) |
| `specs/weekly-report.md` §5 | SPI = actual ÷ planned | Superseded by §26.7 rule 3 |
| §11.1 | Setup workflow is derived and never stored | Still derived. The Controlled state is derived from immutable governance anchors (§26.23.6) |
| §26.13 *(2026-10-14)* | Opening Position leaves Project Setup in 13.14; Setup keeps a Governed Performance block | It leaves in **13.9A**; Setup keeps only a compact read-only Planning Status (§26.23.4) |
| Project master data *(as built)* | `overallStatus` as a manual executive health verdict; Priority required in Setup | `overallStatus` is retired as a performance input in favour of Schedule Condition (§26.23.5). Priority is removed from the UI, both the Setup field and the header badge; its stored value is kept (§26.23.4). Lifecycle Status values follow B13 (§26.23.5) |

### 26.19 Open decisions and conformance

**Decisions still open** — each blocks only the slice named.

| # | Decision | Blocks |
|---|---|---|
| B1 | Confirm the §24.6 amendment: linked governed milestones take their dates from the snapshot (§26.6 rule 5) | 13.15 |
| B2 | Who approves an Other-project unit section before Project Control review (Unit Lead is authority-free today), and whether Monthly Responsible / Backup receive the same reporting-write scope as Weekly | 13.18 (Weekly), 13.19 (Monthly sections) |
| B3 | Whether the approver of a re-baseline may be the person who prepared it | 13.12 |
| B4 | Schedule-condition thresholds (§26.7 rule 4 proposed defaults) | 13.14 |
| B5 | Who records actual manpower in the Weekly: each section writer for their unit, or the reporting workflow (Reporting Coordinator / Project Control) project-wide | 13.13 (actual entry), 13.17 |
| B6 | Portfolio staleness window (proposed 14 days) and the "one basis per aggregate" rule | 13.20 |
| ~~B7~~ | **CLOSED 2026-10-20 (owner decision, at the start of 13.10).** PV for the discrete methods follows their earning points exactly as specified in §26.4 — 0/100: 0 until BLn finish, then 100; 50/50: 50 at BLn start, 100 at BLn finish; Milestone: 0 until the BLn date, then 100 — and only Percent Complete is linear over the project's working days. A correctly progressing discrete activity therefore never shows a false variance | — |
| B8 | Who approves the **original** baseline BL0: the re-baseline rule (Project Control Admin or System Administrator only), as specified in §26.8, or the project's assigned Project Control | 13.12 |
| B9 | Other projects: confirm that a unit's **active members** are the "engineers" who may author comments in that unit's section (§26.21). Unit membership is authority-free today (`06` §8.9) | 13.18 |
| ~~B10~~ | **CLOSED 2026-10-14 (owner decision).** Back-dated Schedule Versions are accepted only through the explicit **Historical Correction** workflow. Operational versions must be dated on or after the latest accepted operational version (§26.22.2). Also closed: **one Schedule Version Under Review per project** at a time | — |
| ~~B11~~ | **CLOSED 2026-10-15 (owner decision).** Setup-control enforcement gets its own slice, **13.9B — Project Setup Governance**, between 13.9A and 13.10. 13.12 is not overloaded (§26.23.9) | — |
| ~~B12~~ | **CLOSED 2026-10-15 (owner decision).** A requester may **never** approve their own governed setup amendment. Approval needs a **different** eligible Project Control Admin or System Administrator. There is no break-glass or self-approval exception; if operational evidence later shows one is needed, it is specified as a separate governance decision. Lightweight amendments, which need no approval, are unaffected | — |
| ~~B13~~ | **CLOSED 2026-10-15 (owner decision).** Canonical Project Lifecycle Status values: **Draft · Active · On Hold · Completed · Cancelled · Archived**. The legacy `planning` and `delayed` stay readable on existing records and later stop being offered as new choices (§26.23.5). Nothing is migrated in 13.9A | — |
| ~~B15~~ | **CLOSED 2026-10-16 (owner decision).** The database does **not** reproduce the full "Ready for Planning" evaluation. The application checks readiness and gates the action. The database enforces the authoritative invariants of each first-anchor action (authority, not archived, onboarding-mode preconditions, uniqueness) and the **explicit first-anchor confirmation** (§26.24.1) | — |
| ~~B16~~ | **CLOSED 2026-10-16 (owner decision).** The existing Project Type correction path is kept: **System Administrator only**, single actor, **no second approver**. It is not duplicated in `project_setup_amendments`; Project History shows its own audit row (§26.24.2) | — |
| ~~B17~~ | **CLOSED 2026-10-16 (owner decision).** Once Setup is Controlled, a meaningful project structure / scope change — add, remove, archive / reactivate, re-parent, or a change of reporting scope — on Departments, Systems, Programs & Studies or the Other-project structure is a **governed amendment**. Harmless display / order changes are not governed unless they alter historical meaning (§26.24.2a) | — |
| ~~B18~~ | **CLOSED 2026-10-16 (owner decision).** After the first Published Planning Snapshot, `new_project` ↔ `existing_active_project` and planning-governed → `no_formal_schedule` are **prohibited**. Before the first snapshot, an applicable transition on a Controlled project is a **governed amendment**. `no_formal_schedule` → planning-governed is allowed **only** through a governed amendment. Historical snapshots and Reported Progress history are never rewritten (§26.24.6) | — |
| ~~B19~~ | **CLOSED 2026-10-16 (owner decision).** Finalise Project Setup is **required** before the first Reported Progress entry of a `no_formal_schedule` project | — |
| ~~B20~~ | **CLOSED 2026-10-16 (owner decision).** A future Reported Progress Data Date is **prohibited**. Back-dated entries are allowed; an entry dated earlier than the project's latest existing Reported Progress Data Date needs a **mandatory reason**. A back-dated entry never overwrites a later entry and never rewrites a frozen or approved historical report; correcting a historical report stays a separate report-revision concern (§26.24.5) | — |
| ~~B21~~ | **CLOSED 2026-10-16 (owner decision).** Reported Progress is recorded, corrected and withdrawn **only** by the System Administrator, a Project Control Admin, or the project's assigned Project Control / Planning. **Not** the Reporting Coordinator, department users or ordinary members | — |
| ~~B22~~ | **CLOSED 2026-10-16 (owner decision).** The proposed classes are accepted with one change: **Forecast Finish is governed**, not lightweight, once Controlled — until Planning becomes its canonical owner, when it becomes Planning-owned and read-only in Project Setup, derived from the governed Planning / Published Planning Snapshot (13.14). Actual Start / Actual Finish stay **lightweight**. Unchanged: Project Type = the existing System-Administrator-only correction; Priority, `overallStatus` and the typed progress pair = retired; Planned Start / Finish = superseded by an approved BL0 from 13.12 (§26.24.2) | — |
| ~~B23~~ | **CLOSED 2026-10-16 (owner decision).** Finalise Project Setup is **not reversible**. The finalisation record stays historical truth. A later move from `no_formal_schedule` to planning-governed is a new governed transition (B18); it never deletes or reverses the finalisation, and Setup stays Controlled | — |
| ~~B24~~ | **CLOSED 2026-10-16 (owner decision).** If a project is archived while an amendment request is pending, the request row stays **immutable** as history (its stored status is not changed); no approve, reject or withdraw action is possible; it is excluded from active approval queues; the UI shows the derived state **"Frozen — project archived"**; Project History shows it normally (§26.24.8) | — |
| ~~B14~~ | **CLOSED 2026-10-15 (owner decision).** "No formal schedule" progress lives in a dedicated append-only **Reported Progress stream** (§26.14), delivered by 13.9B. It is neither the project-record progress fields nor Weekly. 13.9A shows only the read-only "Reported — not planning governed" state | — |

**Conformance — an implementation conforms to §26 when:**

1. No surface outside the Planning workspace reads the Working Plan or raw import.
2. Every performance figure resolves to a snapshot (project, version, Data Date).
3. Effective weights are calculated; only local weights are entered.
4. Publishing is refused on incomplete weights, unmeasured started work, missing Data Date or Data Date violations; normalisation is explicit and logged.
5. SPI is only EV ÷ PV from the weighted model; "N/A" where PV = 0 or the project is not planning-governed.
6. Snapshots, baselines and curves are immutable and carry their engine version.
7. Import never changes EPRP-owned fields and never matches on titles; every Working Plan change from an import is an accepted, logged difference.
8. No consumer treats report plan items as milestones.
9. Manpower never enters SPI.
10. Portfolio figures are weighted and eligibility-checked, or replaced by the distribution.
11. Archived projects refuse every planning, milestone, import and publish write at the data boundary.
12. Tasks, when built, never feed project progress.
13. Guided and Advanced Planning Setup write one Planning Configuration; neither asks for, nor accepts, a calculated value (§26.20).
14. No report comment changes a planning fact or a Published Planning Snapshot (§26.21).
15. Every import is a preserved Schedule Version, compared against the latest accepted version and accepted or rejected by Project Control, one under review at a time. No Schedule Version changes BL0 or BLn, overwrites an earlier version, or rewrites a published snapshot. A back-dated version is accepted only as a Historical Correction, which never becomes current and never alters a snapshot or an approved report (§26.22).
16. Items removed from the schedule are archived, never deleted, and protected items cannot be removed without explicit resolution (§26.22.5).
17. Each planning concern has one home (§26.23.1): no second milestone register, no performance view inside the Planning Workspace, and no Opening Position action outside Baselines & Snapshots.
18. Once a project is Controlled, its governed setup configuration changes only through an append-only setup amendment. Approved reports, snapshots and baselines keep the values they recorded (§26.23.6–§26.23.7).

### 26.20 Guided Planning Setup — UX / product principle (approved 2026-10-14)

**Principle.** A user must be able to configure a project's planning without
first learning planning terminology. EPRP offers a **Guided Setup** that asks
plain business questions, and an **Advanced mode** that exposes the same
canonical configuration directly for Planning Engineers. **The pattern starts
in 13.9A** (approved 2026-10-15, §26.20.1), using only configuration that exists
today. The configuration questions are delivered with the Planning Setup work
of **13.11**, and later slices add their own questions to the same guided flow
(§26.17, roadmap 13.11).

**Guided questions and the configuration each answer sets**

| Question (plain language) | Answers | Canonical Planning Configuration it sets (`06` §10A.1) |
|---|---|---|
| Do you already have a project schedule? | Build in EPRP · Primavera P6 · Excel · No formal schedule | Schedule source (manual entry · P6 Excel export — native XER later, 13.21 · EPRP Excel template) and onboarding mode; "No formal schedule" makes the project **not planning-governed** (§26.14) until a plan is published |
| How is the project broken down? | A recommended breakdown, or the user's own levels | Planning levels and their labels; which level is the Control Account level (§26.3 H1–H2) |
| Are weights managed in EPRP or imported from the schedule? | EPRP · Imported | Weight source (§26.4 W7) |
| Is there an approved baseline? | Yes · Not yet | Whether a BL0 is prepared now for approval (§26.6; approver per B8) |
| Did the project start before joining EPRP? | Yes · No | Onboarding mode "existing active project" → an Opening Position recorded in the Planning workspace (§26.8 invariant 5) |
| How is progress earned? | Percent complete · Complete/not complete (0/100) · Half at start, half at finish (50/50) · By milestones | The project's **default** earning method, overridable per node and activity (§26.4) |
| Is manpower / resource planning required? | Yes · No | Manpower planning enabled (§26.9) |
| Planned headcount, man-hours, or both? | Headcount · Man-hours · Both | Manpower measures planned (§26.9) |
| What is the Weekly look-ahead period? | Weeks (default 2) | Look-ahead weeks (§26.11) |
| Which project / reporting structure should drive report sections? | PSM: Department → System → Program & Study · Other: the configured Project Structure units | Reporting-unit source and the default planning-node mapping (§26.3 H6, §26.12) |

**Rules.**

1. **Calculated values are never questions and never inputs.** PV, EV, SV,
   SPI, effective project contribution, schedule condition and S-curve values
   are always calculated by EPRP (§26.4, §26.7). No guided or advanced screen
   asks for them or accepts them.
2. **One configuration, two ways in.** Guided and Advanced modes read and write
   the **same** Planning Configuration. They are not separate systems: switching
   mode loses nothing, and the guided flow pre-fills its answers from the current
   configuration. Answers are not kept as a second store; the configuration is
   the record. The onboarding-mode field shown in Project Setup is the same
   value, not a copy.
3. **Recommended setups are defaults, not logic.** A project-type or
   project-category template may pre-fill answers (for example a typical
   breakdown and earning method). Templates are configuration data, admin-managed,
   **copied** into the project and never linked (`06` §3 rule 6). Every
   pre-filled value stays editable, and no template value is hardcoded or
   branches platform behaviour (principle 8).
4. **Changing an answer later follows the governed rules.** For example,
   switching the weight source or the schedule source after data exists is an
   explicit, logged Project Control act (§26.2 F2). It never silently rewrites
   or deletes Working Plan data, baselines or snapshots.
5. **Authority and archive.** Planning setup is Project Control
   (`05` §3.8). Archived projects are read-only (§26.3 H10).
6. **Business language, short and progressive.**
   - Questions use business language, never database or planning-engine
     terms.
   - Groups are short and revealed progressively. Each answer may say why it
     matters.
   - A recommended default is shown only where it is justified.
   - **"Skip for now"** is offered only when the configuration is genuinely
     optional.
7. **The guided pattern has a limited footprint.** It does not turn the
   application into a wizard. Guided questions live in:
   - Project Setup → **Planning Entry**;
   - Planning Workspace → **Summary**;
   - later, the Weekly / Monthly confirmation workflows.

   **Master Plan, Imports & Review and Baselines & Snapshots** remain
   professional workspaces. They are the Advanced path.

#### 26.20.1 Guided experience in 13.9A (approved 2026-10-15)

13.9A introduces the guided pattern **without a second configuration system**.
A question is interactive and persisted in 13.9A **only if its canonical model
already exists today**. Every other question waits for the slice that owns its
model. No temporary or competing store is created, and no migration or schema
is added.

**Project Setup → Planning Entry.** The existing onboarding choice is presented
as one question, *"How will this project be planned?"*. Each option carries a
plain-language description.

| Option shown | Canonical value written (existing `project_planning_settings.onboarding_mode`) |
|---|---|
| **Start planning in EPRP** | `new_project` |
| **Project is already running** | `existing_active_project` |
| **No formal schedule** | `no_formal_schedule` |

- **Advanced path.** A "Show advanced" disclosure exposes the same field
  directly. It is not a copy.
- **Follow-up for "Project is already running":** *"Do you already have an
  external schedule?"* — Primavera P6 · Excel schedule · Not yet · Build in
  EPRP.
  - In 13.9A the answer is **guidance only**: it chooses the next step shown
    and the deep link (Imports & Review, Baselines & Snapshots for the Opening
    Position, or Master Plan). It is **not persisted**.
  - The as-built optional column `project_planning_settings.default_import_source`
    (`eprp_excel` · `p6` · `msproject` · `manual`) is deliberately **not**
    written. "Excel schedule" does not map 1:1 to the EPRP Excel template,
    "Not yet" has no value, and schedule-source configuration belongs to
    13.16. **Owner decision 2026-10-15: not persisted in 13.9A, by any route.**
    Mapping: P6 → Imports & Review; Excel → Imports & Review; Not yet → the
    readiness next step (the Opening Position in Baselines & Snapshots); Build
    in EPRP → Master Plan.
  - The follow-up may be skipped.
- **After Controlled,** changing the onboarding choice follows §26.23.6 (from
  13.9B).

**Planning Workspace → Summary.** A guided readiness checklist explains the
next steps instead of opening on a blank workspace.
- Each step's state is **derived from data that exists today**: onboarding
  mode chosen; Working Plan items or an import present; an Opening Position
  declared or promoted; a snapshot published.
- Each step deep-links to the professional section that does the work.
- Nothing in the checklist stores an answer.
- Questions whose model belongs to a later slice are **not shown as
  interactive questions** and leave no placeholder. They appear when their
  slice ships.

| Long-term question area | Interactive / persisted from |
|---|---|
| Planning onboarding ("How will this project be planned?") | **13.9A** (existing field) |
| External schedule source | Guidance only in 13.9A; configuration **13.16** (or earlier only by owner decision) |
| WBS / project breakdown, weights, progress measurement (earning method) | **13.11** |
| Baseline availability / BL0 preparation | **13.12** |
| Resource / manpower planning | **13.13** |
| Weekly look-ahead, report-section structure | **13.17 / 13.18** |

**Recommended Setup.** This is a future pattern; 13.9A introduces no
templates.
- Examples: a PSM Project recommended configuration, an Other Project
  recommended configuration, and later RBI, engineering and study templates.
- Templates provide **editable defaults only**, under rule 3. They are
  managed as Planning Setup Templates (`05` §3.8) from 13.11.
- No behaviour may branch solely on which template was used.

### 26.21 Weekly and Monthly collaborative comments (approved 2026-10-14)

**Principle.** Weekly and Monthly carry a controlled **comment / narrative
layer** where authorized departments and engineers explain, confirm and enrich
their section of the report. **Comments are not planning facts.** They never
modify PV, EV, SPI, milestone schedule state, manpower planning facts or any
Published Planning Snapshot (§26.2 F1–F6). This is the "confirm and explain"
mechanism of §26.11.

**Comment types (initial set).** General Comment · Progress Explanation ·
Constraint · Recovery Action · Technical Note · Client / Department Input. The
set is managed configuration, not a hardcoded list. A Constraint or Recovery
Action that must be tracked to closure may be linked to, or promoted into, the
tracked Issue / Action / Comment Register records (`06` §11.4, §12.3); the
comment itself stays narrative.

**Every comment preserves:** author · timestamp · project · report and its
period · reporting section / unit · comment type · optional reference to the
planning activity, node or milestone it explains · its edit history,
soft-delete and attribution, per the existing comment governance (`05` §4).

**Scope by project type** (the approved PSM vs Other model, §26.12):

| Project Type | A comment is scoped to |
|---|---|
| **PSM** | The Department → System → Program & Study reporting section it belongs to |
| **Other Project** | The configured Project Structure reporting unit |

**Permissions** (detail in `05` §3.8):

- **Engineers** add comments in their permitted section and edit their own,
  while the report accepts section input. PSM: the department's team members
  (as built). Other projects: the unit's active members — **pending owner
  confirmation, B9**.
- **Department / reporting-responsible users** review and summarise the
  comments of their assigned section. PSM: the Department Manager. Other
  projects: the unit's Weekly Responsible / Backup (13.18); Monthly Responsible
  / Backup per B2.
- This is **reporting-comment scope only**. It grants no Planning, Project
  Setup, publishing, approval or return authority, and nothing outside the
  author's own section.

**Weekly.** Planning facts are system-derived from the pinned snapshot; people
confirm and explain them with comments. An approved Weekly's comments are
immutable with the rest of the report.

**Monthly.**
- Approved Weekly comments and section narrative are **carried forward where
  relevant**, by reference to their source Weekly — compiled content, not
  retyped and not edited at the Monthly tier (`03` §5.4).
- The Monthly adds its own **Monthly-specific comments and section summaries**.
- Nobody retypes Weekly narrative to produce a Monthly.

### 26.22 Schedule Versions and revision history (approved 2026-10-14)

**Principle.** A project's schedule changes throughout its life. EPRP never
treats a project as having one fixed imported schedule. Every Primavera P6 or
Excel import is preserved as its own **Schedule Version**, compared with the
one before it, and accepted or rejected by Project Control. A Schedule Version
**never** changes the original baseline (BL0) or the current approved baseline
(BLn). The approved flow is unchanged:

```text
Raw Import → Staging / Validation → Diff → Project Control Acceptance → Working Plan → Published Planning Snapshot → Consumers
```

#### 26.22.1 Three things that must never be confused

| | **Original baseline (BL0)** | **Current approved baseline (BLn)** | **Schedule Version / Schedule Update** |
|---|---|---|---|
| What it is | The first formally approved baseline | A formally approved Baseline Revision (BL1, BL2, …) | A normal P6 / Excel update or revision during execution (e.g. "Rev 00", "Rev 01", "Update 05", "Update 06") |
| How it is created | Approval of the first baseline (§26.6; approver per B8) | **Only** the governed Re-baseline: prepared by Project Control / Planning, approved by Project Control Admin or System Administrator | Every import creates one |
| What it may change | — | Dates and weights against which PV and SPI are measured, from its approval onward | Forecast / current start and finish, remaining duration, progress / % complete, relationships, resources / manpower, activity status, WBS placement, added and removed activities |
| What it never changes | — (immutable) | BL0; any published snapshot | **BL0 and BLn** — even when the source file carries baseline columns |
| Curve | Original baseline curve | A new baseline curve per approved Baseline Revision | Moves the current / forecast curve only |

- **A source file's baseline columns are not a baseline.** If a Schedule
  Version carries baseline dates that differ from EPRP's BLn, the diff flags
  the difference for information. It may prompt Project Control to *prepare* a
  Re-baseline from that version, which then needs approval. Nothing changes
  automatically.
- **The first baseline.** BL0 may be prepared from the first accepted Schedule
  Version (Guided Setup: "Is there an approved baseline?", §26.20) and becomes
  BL0 only on approval.

#### 26.22.2 The Schedule Version and its lifecycle

Every import creates a preserved **Schedule Version**. It logically records:

- project · EPRP version number (sequential per project) · Schedule Version
  reference (the source's own label);
- source type (P6 Excel export · EPRP Excel template; native XER from 13.21) ·
  the original file and its raw import batch;
- import time · imported by · **Data Date**;
- **kind** (operational · Historical Correction) · status · decided by / at ·
  reason when rejected; for a Historical Correction, the mandatory reason and
  the historical version or period it corrects;
- the **previous accepted Schedule Version** it was compared against;
- the **baseline in force** (BL0 / BLn) when it was reviewed and when it was
  accepted;
- the change count per diff category, and the Planning Decisions recorded on
  its rows.

```text
Uploaded ──► Validated ──► Under Review ──► Accepted
   │                            │
   └────────► Rejected ◄────────┘   (validation failure, or rejection in review — always with a reason)
```

| Rule | |
|---|---|
| **Never overwritten** | A Schedule Version, its file and its raw rows are kept for ever, whatever its status. A rejected version stays readable with its reason. |
| **One under review at a time** *(owner-approved policy, 2026-10-14)* | A project has at most **one** Schedule Version Under Review — operational or Historical Correction. A newer upload waits until that review closes, then is compared against whatever is then the latest accepted operational version. *Rationale:* every version must be diffed against a **stable** latest accepted version; parallel reviews would create ambiguous diff bases and conflicting acceptance paths. |
| **History stays readable** | Example: Rev 00 — Accepted · Rev 01 — Accepted · Rev 02 — Accepted · Rev 03 — Under Review. Every entry can be opened with its diff, decisions and related snapshots. |
| **Accepted is not published** | Acceptance changes the Working Plan; publishing a snapshot is a separate act (§26.8). |
| **Data Date order** *(B10, closed 2026-10-14)* | A normal (**operational**) Schedule Version must have a Data Date **equal to or later than** the latest accepted operational Schedule Version. A back-dated import is **not rejected outright**: it can be accepted **only** through the Historical Correction workflow below. |

**Historical Correction** (B10, owner decision 2026-10-14). A back-dated
Schedule Version may be accepted only as an explicit **Historical Correction**:

1. **It requires** a mandatory reason, the recorded actor and time, and a
   reference to the historical Schedule Version or period it corrects. Its
   diff is against that historical version.
2. **It never becomes the current operational Schedule Version**, and it is
   never the basis of a later diff.
3. **It never rewrites or replaces** any immutable Published Planning Snapshot.
4. **It never silently changes** an approved Weekly, Monthly or Executive
   report.
5. **If the correction must affect the current Working Plan**, the corrected
   information is carried forward in a **new current-dated operational
   Schedule Version**, which goes through the normal diff and acceptance.
6. **A correction or reissue of a past report** uses the governed **Report
   Revision** workflow (`03` §12), never snapshot mutation. The original
   snapshot and report remain readable unchanged.
7. It counts toward the one-under-review rule, and like every Schedule Version
   it is preserved for ever.

#### 26.22.3 Diff and acceptance

```text
New Schedule Version → Raw Import → Validation → Diff against the latest accepted Schedule Version
   → Project Control review → Accept (with recorded row exceptions) / Reject → Working Plan → Published Planning Snapshot
```

**The review shows, by category:**
- added activities and removed activities;
- changed dates and changed durations;
- changed progress and changed activity status;
- WBS moves;
- changed relationships;
- changed resources / manpower;
- changed milestone dates.

It also shows conflicts with Project Control edits made in EPRP since the
latest accepted version (§26.10), and baseline-column differences (26.22.1).
A Historical Correction is instead diffed against the historical version it
corrects (§26.22.2).

**Nothing is applied silently.** Every accepted or rejected difference is a
logged Planning Decision (actor, time, reason where required). Field ownership
(§26.10 rule 3) is unchanged: EPRP-owned fields are never changed by any
Schedule Version.

#### 26.22.4 Matching

- Activities match on the **external Activity ID**; WBS on the **external WBS
  code / path**; resources on resource ID. **Never primarily on title or name.**
- If an external ID changes, EPRP **does not guess**: the item is treated as
  removed + added. Project Control may record an explicit **re-match**, which
  is kept in history with actor, time and reason.
- An external ID that reappears in a later version after being removed is
  offered as a **restoration** of the archived item, so its history continues.
  It is never a silent duplicate.

#### 26.22.5 Removed activities and nodes

When an item in the latest accepted Schedule Version is absent from the new
one:

- accepting the removal sets it to **Removed from current schedule**. It is
  archived from the Working Plan and **never physically deleted**;
- every snapshot, report, comment reference and history entry that captured it
  stays valid and keeps resolving to it;
- if it is **protected**, acceptance is blocked until Project Control resolves
  it explicitly — for example by unlinking with a reason, or re-matching.
  Protected means linked to a governed milestone, a governed deliverable, or
  (when Tasks exist) an open task.

#### 26.22.6 Milestones across versions

A true milestone activity links one-to-one to a governed milestone (§26.10
rule 7). A Schedule Version may **propose**:
- the milestone's current schedule date — its forecast, the source's "current
  planned" date;
- its actual date and status.

It never proposes a change to the BL0 or BLn date. Proposals pass through the
diff and acceptance above and never silently overwrite governed milestone
history (subject to B1). Milestone reporting always shows:

| BL0 date | BLn date | Current forecast | Actual | Variance vs BL0 | Variance vs BLn |
|---|---|---|---|---|---|

#### 26.22.7 Snapshot provenance

Every Published Planning Snapshot records enough to answer **"where did these
numbers come from?"**:
- its source Schedule Version (or Opening Position, or manual publish) and the
  logged Project Control edits applied after that version;
- its Data Date (for an import-based publish, the version's Data Date);
- its BL0 and BLn;
- the engine version;
- the publisher and publication time.

A snapshot is immutable (§26.8). **A later Schedule Version never rewrites an
earlier snapshot.**

#### 26.22.8 Historical stability of reports

Weekly, Monthly and Executive reports pin a snapshot and freeze the pin at
approval (§26.11). Example:

- The September Monthly is pinned to the 30-Sep snapshot, whose source is
  Schedule Version Rev 02.
- In October, Rev 03 is imported, accepted and published.
- **The September Monthly does not change.**

The current Dashboard and the Planning workspace read the **latest** published
snapshot. Approved historical reports stay on the snapshot they were pinned to.

#### 26.22.9 S-curves and performance history

Version history supports, together:
- the original baseline curve (BL0);
- the current approved baseline curve (BLn);
- the current forecast curve;
- the earned / actual curve;
- every historical published snapshot point.

Each published snapshot keeps its own forecast curve, so forecast drift across
Schedule Versions can be compared later. **A Schedule Update moves the
forecast curve; only an approved Re-baseline creates a new baseline curve.**

#### 26.22.10 UX principle — Schedule History

Planning users will later have a **Schedule History / Versions** view listing,
per Schedule Version:
- reference and Data Date;
- imported by, source and status;
- change count, and whether it was accepted or rejected;
- the related snapshot and the baseline active at the time.

Selecting a version will later show its structured diff. The full UI is
**not** designed here (`07` §10.11 records the principle).

#### 26.22.11 Where it is delivered

| Slice | Delivers |
|---|---|
| **13.12** | Snapshot provenance fields above; BL0 / BLn as Baseline Revisions with their own curves; the rule that no import re-baselines |
| **13.15** | Milestone proposals from Schedule Versions for linked milestones (subject to B1) |
| **13.16** | Schedule Versions and their lifecycle, preserved history, one-under-review rule, diff against the latest accepted version, acceptance, matching and re-match, removed-item handling, restoration, the **Historical Correction** workflow, the Schedule History list |
| **13.21** | The same versioning for native P6 XER |

Nothing here changes the slice order. *(2026-10-15: 13.9 is closed; the next
slice is 13.9A, then 13.10 — see §26.23.9.)*

### 26.23 Planning Experience and project information architecture (approved 2026-10-15)

**Status: DESIGN GATE — approved by the project owner on 2026-10-15
(decisions D1–D9). Not implemented.** This section fixes where each planning
concern lives in the project experience, and how Project Setup becomes
controlled once planning governs the project.
- **UI / IA foundation:** roadmap slice **13.9A**.
- **Control enforcement and analytics:** the later slices named in §26.23.9.
- **Presentation rules:** `07` §10.12.
- **Authority:** `05` §3.9.

#### 26.23.1 Principles

1. **One home per concern.**
   - Configuration → **Project Setup**.
   - Plan editing, imports, baselines and publishing → **Planning Workspace**.
   - Performance analytics → **Project Progress**.
   - The governed milestone register → **Milestones**.

   No second milestone register and no duplicate performance view exist anywhere.
2. **Performance is read, never typed,** for a planning-governed project (§26.7
   rule 3, §26.14).
3. **Lifecycle is not performance.** Project Lifecycle Status is
   administrative. Schedule Condition is derived (§26.7 rule 4).
4. **Control is a configuration freeze, not paralysis.** Team,
   responsibilities and lifecycle transitions are never locked.

#### 26.23.2 Project sidebar (D5, D6)

```text
Overview                      the one canonical project home
SETUP                Project Setup · Team & Responsibilities · Organization Chart
PLANNING & CONTROL   Planning Workspace · Project Progress · Milestones · Deliverables
                     (Resources — appears only when 13.13 ships)
REPORTING            Reporting
PROJECT STRUCTURE    Departments · Systems · Programs & Studies
RECORDS              Documents · Attachments · History
```

Rules:
1. **Overview is the single project home.** The long scrolling project-details
   page (as built at `/projects/[id]`) is retired in favour of Overview, which
   deep-links into the dedicated modules. That retirement is not yet scheduled
   (§26.23.9).
2. **Planning Workspace is a first-class item.** As built it has no sidebar
   entry.
3. **Programs & Studies** is the hierarchy level beneath System. It is always
   shown under the project's own configured label (`07` §3.6). Items that do
   not apply to the project's Project Type stay hidden, as today.
4. **The "Master / Reference Data" group is not renamed wholesale.** Its
   project-structure items move to PROJECT STRUCTURE.
5. **Contacts is not a permanently duplicated reference-data entry.**
   - Direction: project-person and contact management converges with Team &
     Responsibilities / Project People, subject to a later implementation
     assessment.
   - Until then the contacts capability stays reachable, from the Project
     Setup Contacts step and a link from Team & Responsibilities, and its
     route keeps working.
   - It leaves the sidebar only once that reachability exists.
6. **No placeholder items.** A future module, such as Resources, appears when
   it ships and never as a disabled stub.
7. **One structure on every surface.** The expanded column, the collapsed
   icon rail, the laptop overlay and the mobile sheet all render this same
   structure.

#### 26.23.3 Planning Workspace

| Section | Holds |
|---|---|
| **Summary** | The guided readiness path (§26.20), the current Published Snapshot, the Working Plan's unpublished change count and one primary next action |
| **Master Plan** | Hierarchy, local weights, earning methods and activities (hardened in 13.11) |
| **Imports & Review** *(renamed from "Planning Data")* | Upload, validation and review. Schedule Versions and their history are added from 13.16 |
| **Baselines & Snapshots** | The **only** place for Opening Position record / promote; BL0 / BLn (13.12); publishing; snapshot history |
| **Resources** | From 13.13 only |

Rules:
1. **Removed:** the inner **Milestones** tab, because the Milestones module is
   the one governed register. Also removed: **Performance & Variance**,
   because Project Progress owns performance analytics.
2. **Navigation:** enterprise underline tab navigation, pinned under a
   workspace header, replacing the lightweight pill group. Each section is
   URL-addressable, so other modules can deep-link to it.
3. **Workspace header strip:** Working Plan state · unpublished change count ·
   Current Published Snapshot · Data Date · BL0 / BLn · archived state. A value
   the current data cannot supply is omitted, never estimated.
4. **Guided and Advanced** (§26.20) is a view switch inside the workspace. It
   is distinct from the controlled **Planning Onboarding Mode**, which lives in
   Project Setup.

#### 26.23.4 Project Setup (D3)

The overloaded "Status & Progress" section is removed. Target structure:

| # | Section | Holds |
|---|---|---|
| 1 | **Basic Information & Classification** | Identity, Client / Owner, Project Type and Category, **Portfolio / Reporting Group** |
| 2 | **Contract & Reference Dates** | Contract and planned reference dates. After an approved BL0, Planned Start / Finish are shown as superseded (§26.23.6) |
| 3 | **Project Responsibility** | As today |
| 4 | **Project Lifecycle** | **Only** Project Lifecycle Status and Project Lifecycle Phase (relabelled from "Current Phase") |
| 5 | **Planning Entry** | Planning Onboarding Mode · setup readiness · setup state (Draft / Ready for Planning / Controlled) · Open Planning Workspace · compact read-only **Planning Status** |
| 6 | **Reporting Configuration** | As today |
| 7 | **Contact & Location** | As today |
| 8 | **Scope & Structure** | Formerly "Linked Scope" |
| 9 | **Branding & Report Settings** | As today |

Rules:
1. **Project Priority is removed from the UI** (confirmed 2026-10-15). It is
   gone from Project Setup and from the project summary / header Priority
   badge.
   - Its stored value is kept for compatibility and history. Historical values
     are neither deleted nor migrated.
   - No portfolio use is invented to justify the field.
   - Phase 13.20 may deliberately reintroduce a project-priority model if there
     is a real business requirement.
2. **No large Governed Performance cards in Setup.**
   - The compact **Planning Status** shows only: snapshot version, Data Date,
     PV, EV, variance, SPI, Schedule Condition, and a link to Project Progress.
     It is always read-only.
   - A project that is not planning-governed shows "Reported — not planning
     governed", with SPI "N/A".
3. **No Opening Position action in Setup** (§26.23.3).
4. **Regrouping changes no data ownership.** Every field keeps its source.

#### 26.23.5 Lifecycle Status versus Schedule Condition (D4)

| Concept | Nature | Values |
|---|---|---|
| **Project Lifecycle Status** | Administrative, maintained by setup managers | Canonical (B13, closed): **Draft · Active · On Hold · Completed · Cancelled · Archived**. Legacy `planning` and `delayed` remain readable on existing records only |
| **Schedule Condition** | Derived from the Published Planning Snapshot (§26.7 rule 4) | On Track · At Risk · Behind · Unknown |

Rules:
1. **`overallStatus` is retired as a manual performance input.**
   - As built, no form edits it.
   - It still drives badges on the project card, table and header, a "behind"
     filter, and the Forecast Finish validation rule.
2. **Target state for badges and filters:**
   - Performance badges and filters read Schedule Condition for a
     planning-governed project.
   - A not-governed project shows "Reported — not planning governed" (§26.14).
   - Lifecycle badges and filters read Project Lifecycle Status.
   - The retirement belongs to 13.14 and is not implemented before it.
3. **Legacy lifecycle values (B13).**
   - **`planning`** is not a lifecycle condition. Planning readiness and
     activation belong to the separate setup state (§26.23.6).
   - **`delayed`** is not a lifecycle state. Delay belongs to the calculated
     Schedule Condition.
   - **Compatibility requirement:** both stay **readable**, and are displayed
     as stored, labelled "legacy", on existing records.
   - **Retirement requirement:** they later stop being offered as new choices,
     together with the `overallStatus` retirement (13.14).
   - **Not in 13.9A:** no existing record is migrated. Whether and how stored
     legacy values are converted is decided when the retirement slice is
     specified.
4. **Two different Drafts.** The setup state "Draft" and the Lifecycle Status
   "Draft" are different concepts. The UI always qualifies the setup state, as
   "Setup: Draft".

#### 26.23.6 Setup lifecycle and control (D1, D2)

```text
Draft ──(every required setup check passes)──▶ Ready for Planning ──(first governance anchor)──▶ Controlled
                                                                                  Archived overrides every state (13.9)
```

| State | Holds when |
|---|---|
| **Draft** | One or more required setup checks fail (§11.1) |
| **Ready for Planning** | Every required setup check passes |
| **Controlled** | A governance anchor exists |

**Governance anchor:**
- **Planning-governed** onboarding modes ("new project", "existing active
  project"): the **first** of an approved Original Baseline BL0 or the first
  Published Planning Snapshot. A promoted Opening Position is Snapshot V1.
- **"No formal schedule":** an explicit **Finalise Project Setup** action,
  available once Ready for Planning.
  - **Who may finalise:** a System Administrator, a Project Control Admin, or
    the project's assigned Project Control / Planning.
  - **Who may not:** the Reporting Coordinator, department users, or a project
    member on the strength of membership alone (`05` §3.9).
  - **What finalisation does:**
    - asks for explicit confirmation;
    - creates an append-only finalisation / governance record (actor, time,
      project);
    - moves the setup state to Controlled.
  - **What it never does:** fabricate a Planning Snapshot, an SPI or a
    planning-governed state. The project stays "Reported — not planning
    governed".

Rules:
1. **Controlled is derived from immutable facts** (§11.1 amendment). It never
   returns to Draft or Ready for Planning.
2. **Explicit confirmation before the anchor.** The action that will create
   the first anchor states, before it runs, that core Project Setup
   configuration becomes controlled afterward. That action is approving BL0,
   publishing the first snapshot, promoting an Opening Position or finalising
   setup. Because the states run in sequence, the first anchor requires Ready
   for Planning. *(B15, closed 2026-10-16: the application checks readiness;
   the database enforces the action's authoritative invariants and the
   explicit confirmation, not the full readiness evaluation.)*
3. **Onboarding Mode changes after Controlled** (B18, closed 2026-10-16; full
   matrix in §26.24.6):
   - Moving from "no formal schedule" to a governed mode is a governed
     amendment. The project becomes planning-governed at its first snapshot.
   - Moving from a governed mode to "no formal schedule", and between the two
     governed modes, is refused once a snapshot exists (§26.14).
4. **Before Controlled, setup editing works as today.**

**Field classes once Controlled:**

| Class | Fields | How a change is made |
|---|---|---|
| **Free / logged** | Project Lifecycle Status · Project Lifecycle Phase · Portfolio / Reporting Group · Team · Responsibilities · Contacts · Location · Branding · Description | Direct edit, recorded in Project History. `05` §3.7 responsibility rules unchanged |
| **Lightweight amendment** | Project Name / Short Name · other non-planning-impacting metadata where justified | Amendment with a **mandatory reason**; applied immediately; no approval |
| **Governed amendment** | Project Code · Client / Owner · Project Type / Classification · Planning Onboarding Mode · structure-family or governed scope changes (Project Structure units and the Other-project structure) · reporting frequency / cut-off · contractual dates and other configuration whose change alters historical project interpretation | Amendment request with reason; applied only on **Project Control Admin or System Administrator approval** (`05` §3.9) |
| **Superseded** *(after an approved BL0)* | Project Setup Planned Start / Planned Finish | Not an operational edit field. Shown as reference values marked "Superseded by BL0", beside the BL0 dates. Schedule dates change only through Planning re-plan (a Schedule Version, §26.22) or re-baseline (§26.6) |

**Project Type.** The System-Administrator-only structure-family correction
(`05` §3.6, as built) remains the only route to change a locked Project Type,
because it is stricter than a governed amendment. *(Refined 2026-10-16,
§26.24.2.)* It keeps its own audit table. Project History shows it beside the
setup amendments, rather than duplicating it as an amendment row. No second
System Administrator is needed once Controlled (B16, closed 2026-10-16).

*(Refined 2026-10-16, §26.24.1.)* An approved BL0 becomes an anchor only from
13.12. `planning_baselines` has no approval today. In 13.9B the anchors are
the first Published Snapshot and the Setup Finalisation, and the "Superseded
by BL0" dates take effect only once 13.12 delivers BL0 approval.

#### 26.23.7 Setup amendment record (D8)

A dedicated, structured, append-only **Project Setup Amendment** record
(`project_setup_amendments`) holds:
- project and field;
- previous value and proposed / new value;
- mandatory reason;
- class (lightweight or governed);
- **impact warning**, generated by the system and stored exactly as shown;
- requested by and requested at;
- status: Applied · Pending · Approved · Rejected · Withdrawn · Stale;
- approver, decided at and decision note, where approval is required.

Rules:
1. **Rows are never edited or deleted.** A decision is recorded once.
2. **Approval applies the change in the same transaction.** If the field's
   current value no longer equals the recorded previous value, the request
   becomes **Stale** and nothing is applied.
3. **Amendments never rewrite history.** Approved reports, snapshots and
   baselines keep the values they recorded.
4. **Impact warnings state the consequence before the request.** Examples:

   | Change | Warning |
   |---|---|
   | Project Code | "Approved reports keep the old code." |
   | Reporting cut-off | "Applies from the next unopened period; existing periods are unchanged." |
   | Onboarding Mode | "Changes whether the project is planning-governed." |
   | Removing a structure unit | "Planning nodes and report sections mapped to this unit must be re-mapped first." |
5. **Records are exposed through Project History.** Pending governed requests
   also appear in the approvers' queue.
6. **Archived projects accept no amendment** (13.9).

7. **Self-approval is refused** (B12). A governed amendment is approved by a
   Project Control Admin or System Administrator **other than its requester**.
   There is no break-glass exception.

Its logical entity, with the Setup Finalisation record and the Reported
Progress stream, is specified in `06` §10A when **13.9B** is specified. Until
then `06` carries only a marked future note.

#### 26.23.8 Project Progress (D7)

A **read-only analytical workspace** for planning-governed projects, in this
order:

1. **Performance header:** Data Date · snapshot version · BL0 · BLn · Schedule
   Condition.
2. **KPI row:** PV · EV · Schedule Variance · SPI.
3. **Main S-curve:**
   - series: BL0 · BLn · Forecast / Current Plan · Earned / Actual;
   - a Data Date marker;
   - earned points only at real Data Dates (§26.7 rule 1).
4. **WBS / Control Account performance:** local and effective weight · PV ·
   EV · SPI · variance · contribution.
   - Selecting a node filters and redraws the analytical context: header, KPIs,
     S-curve and exceptions.
   - It never opens a separate, duplicate page.
5. **Exceptions / schedule health:**
   - late activities;
   - overdue activities;
   - key milestone exposure, linking to Milestones;
   - forecast finish against BL0 and against BLn.
6. **Resources / Manpower:** later, as a separate analytical section (13.13).
   Manpower variance never enters SPI.

| Project | Shows |
|---|---|
| Governed, v2 snapshot | Everything above |
| Governed, no snapshot yet | "Awaiting first Published Planning Snapshot", with a link to the Planning Workspace; no figures |
| Opening Position snapshot | Declared figures, labelled; SPI "N/A" (§26.14) |
| Legacy (pre-13.12) snapshot | Its existing figures, labelled "legacy calculation" (§26.14) |
| No formal schedule | "Reported — not planning governed"; SPI "N/A". From **13.9B**: the latest Reported Progress stream entry (Data Date, reported planned / actual %, narrative, provenance) and **Update Reported Progress** for authorised users (§26.14). **Before 13.9B:** the labelled state only, with no figures from the project record presented as reported progress and no write action |
| Archived | Read-only; no update action |

Rules:
1. **No "Update progress" for a planning-governed project.** Planners get an
   "Open Planning Workspace" link instead.
2. **Earlier snapshots** can be selected and viewed read-only.

#### 26.23.9 Delivery

| Slice | Delivers |
|---|---|
| **13.9A** Planning Experience Foundation | The UI / IA foundation: sidebar, Workspace shell and sections, Project Setup regrouping, compact Planning Status shell, Opening Position moved, Project Progress shell and states, manual update removed for governed projects. Roadmap Phase 13 |
| **13.11** | Master Plan hardening and Guided / Advanced setup inside the Workspace |
| **13.9B** Project Setup Governance *(B11, closed)* | The setup state with Controlled enforcement and first-anchor transition rules and confirmation; field classes; `project_setup_amendments` with lightweight amendments and governed approval (no self-approval, B12); the Finalise Project Setup record for no-formal-schedule projects; the Reported Progress stream and its write workflow (B14); History integration; RLS, service and UI authority. Superseded Planned Start / Finish is enforced once an approved BL0 exists; BL0 approval itself arrives in 13.12. Separate from the Planning Engine |
| **13.12** | BL0 / BLn (the BL0 anchor then feeds the 13.9B rules: "Superseded by BL0" dates and the Controlled-without-snapshot mode transitions of §26.24.6); BL0 / BLn in the header strip and Progress header |
| **13.13** | The Resources section and the manpower analytics section |
| **13.14** | Progress analytics content (KPIs, S-curve, WBS performance, exceptions), Planning Status figures and Schedule Condition, and retirement of `overallStatus` as an input; legacy lifecycle values `planning` / `delayed` stop being offered (B13, readable on existing records); Forecast Finish becomes Planning-owned and read-only in Project Setup for planning-governed projects (B22) |
| **13.16** | Imports & Review over Schedule Versions and their history |
| **13.20** | Any deliberate reintroduction of a project-priority model |
| *Unscheduled* | Retiring the long project-details page in favour of Overview; the Contacts / Project People convergence assessment |

### 26.24 Project Setup Governance — 13.9B specification (2026-10-16)

**Status: SPECIFICATION — design review complete; owner decisions B15–B24
closed 2026-10-16. Step 1 (governance core: registry, Controlled
derivation, amendments, setup guard, onboarding transitions, publish
confirmation / no-formal guard, field-change log) implemented on the local
development database only, 2026-10-16. Step 2 (Setup Finalisation, Reported
Progress stream, legacy classification bootstrap) implemented locally
2026-10-17. Step 3 (services, Setup governance UI, Reported Progress UI, History, Contacts / Sites / Parties history) implemented locally 2026-10-17. Step 4 not started; not closed.** This refines
§26.23.6–§26.23.7 into an implementable design. Approved inputs: D1–D9 and
B11–B24 (§26.19). No owner decision remains open for 13.9B.
- Logical data model: `06` §10A.11.
- Authority: `05` §3.9.
- UI: `07` §10.12.

It is a **configuration governance layer**. It contains no Planning Engine
logic and changes no snapshot, baseline or report.

#### 26.24.1 Setup lifecycle derivation

| State | Holds when | Decided by |
|---|---|---|
| **Draft** | Not Controlled, and a required setup check fails | Application, from the existing setup checks |
| **Ready for Planning** | Not Controlled, and every required setup check passes | Application |
| **Controlled** | `project_setup_controlled_since(project)` is not null | **Database**, from immutable anchors (`06` §10A.11.2) |

**Anchors:**
- in 13.9B: the first Published Planning Snapshot, including a promoted
  Opening Position, and the Setup Finalisation of a no-formal-schedule
  project;
- from 13.12: also the first approved BL0. `planning_baselines` has no
  approval today, so a captured baseline is **not** an anchor.

Controlled is never a stored or editable status, never reverts, and needs no
backfill. Projects that already have a snapshot are Controlled at rollout.

**Confirmation before the first anchor.** The action that would create the
first anchor needs an explicit acknowledgement.
- **Publish Snapshot** and **Promote Opening Position:** enforced in the
  database by a new `p_confirm_setup_control` argument to
  `publish_planning_snapshot()`. It is required whenever the project is not
  yet Controlled, so a non-UI caller cannot skip it. 13.12 must keep this
  argument when it reworks publish.
- **Finalise Project Setup:** the confirmation is part of the action itself.

**Readiness versus invariants (B15, closed).** The database does **not**
re-evaluate "Ready for Planning"; the application checks it and offers the
first-anchor action only when it passes. The database enforces, for every
caller, the invariants that make the anchor authoritative:
- the explicit confirmation (above);
- authority (§26.24.5 and `05` §3.9) and the archived guard (§26.24.8);
- the onboarding-mode precondition: Finalise needs a stored
  `no_formal_schedule`; Publish and Promote are **refused while the stored
  mode is `no_formal_schedule`**, so a project cannot become
  planning-governed except through the mode transition of §26.24.6;
- uniqueness: one finalisation per project.

#### 26.24.2 Field-governance matrix (definitive, by stored field)

After Controlled:

| Class | Fields (`projects` column / relation) | Change path |
|---|---|---|
| **Free / logged** | `status` (Lifecycle Status) · `current_phase_id` · `portfolio_group_id` · `description` · responsibilities (`project_manager_id`, `project_control_manager_id`, `client_representative_id`, `reporting_coordinator_id`, `project_sponsor_id`) · Team and positions · contacts (`client_contact_*`, project contacts) · location (`site`, `country`, `city`, sites) · branding (`project_logo_ref`, `client_logo_ref`, `report_header_title`, `report_footer_text`, `report_reference_prefix`, `default_language`, `include_qr_code`, `include_signature_section`) · subcontractor parties (B22) · harmless structure display attributes (§26.24.2a) | Direct edit as today (2C.3E responsibility rules unchanged). Logged in `project_setup_field_changes` |
| **Lightweight amendment** | `name` · `short_name` · `contract_number` · `purchase_order_number` · `actual_start_date` · `actual_finish_date` (B22) | Amendment with a mandatory reason; applied at once; no approval |
| **Governed amendment** | `code` · `client_id` · `project_type_id` + `project_category_detail` (Other-project classification) · Planning Onboarding Mode (subject to the §26.24.6 matrix) · reporting frequency (`weekly_enabled`, `monthly_enabled`, `executive_enabled`, `weekly_reporting_day`) · reporting cut-off and period definition (`monthly_cutoff_day`, `working_week`, `time_zone`) · `currency` (B22) · `milestone_update_approval` (B22) · `contract_start_date` · **`forecast_finish_date`** (B22, until Planning owns it — see below) · `planned_start_date` / `planned_finish_date` (until an approved BL0) · structure scope: Departments, Systems, Programs & Studies, and the Other-project structure (B17, §26.24.2a) | Request with reason and impact warning; applied only on approval by a **different** eligible Project Control Admin or System Administrator |
| **System-Administrator-only correction** *(existing, unchanged)* | `structure_family` (Project Type) | The existing `correct_project_structure_family()`, with its own audit (2C.1). Single actor; **no second approver** (B16, closed). Not duplicated in `project_setup_amendments`; Project History shows its own audit row |
| **Superseded** *(from 13.12)* | `planned_start_date` / `planned_finish_date` once an approved BL0 exists | Not editable. Shown as "Superseded by approved Planning Baseline BL0". Dates change through Planning re-plan / re-baseline only |
| **Planning-owned** *(from 13.14, planning-governed projects)* | `forecast_finish_date` | Read-only in Project Setup; derived from the governed Planning / Published Planning Snapshot. Until 13.14 it is **governed** (row above). A `no_formal_schedule` project has no Planning owner, so it stays governed |
| **Retired / hidden** | `priority` · `overall_status` · `planned_progress` · `actual_progress` | No change after Controlled. An unchanged value passes, because the form re-sends hidden columns |

Before Controlled every field behaves exactly as today. Existing stricter
rules stay stricter: the Project Type correction remains System
Administrator only, and the responsibility rules of `05` §3.7 apply.

**Legacy classification bootstrap (owner closure 2026-10-17; as built in
13.9B Step 2).** A **Controlled** project whose Project Type is still NULL
(never classified) is classified **once**, by the **System Administrator**,
through the existing Project Type correction
(`correct_project_structure_family()`). That one atomic correction may set
or clear the Project Category / custom category needed for a valid initial
classification. It is recorded once in the existing classification history
(`project_classification_corrections.correction_kind = 'legacy_bootstrap'`,
old family NULL, at most one per project) and **never** as a
`project_setup_amendment`. Once the project has a Project Type the exception
is over: later family changes are the ordinary System Administrator
correction and later Category changes are governed amendments. A project
that is **not** Controlled still classifies through Project Setup exactly as
before (2C.1). *(Step 1 briefly let any setup manager classify a Controlled
legacy project through Project Setup; Step 2 withdrew that.)* The local
preflight found all eight snapshot-anchored projects in this state.

#### 26.24.2a Structure-scope changes after Controlled (B17, closed 2026-10-16)

The rule is "**meaningful** structure / scope change → governed; harmless
display / order change → not governed, unless it alters historical meaning".
Because the database cannot judge meaning, each stored attribute is classed
deterministically. **Renames are governed** (owner decision 2026-10-16): a
rename can alter how historical reports read even when the underlying id is
stable, so every unit or level rename is governed rather than inferred.

| Relation (as built) | Governed amendment | Free / logged |
|---|---|---|
| **Departments** (`project_departments`) | Add or remove a department · `reporting_required` · its `systems` scope | `project_description` · `lead_name` (non-semantic notes) |
| **Systems and Programs & Studies** (`project_disciplines`: discipline ↔ department ↔ system) | Add, remove or move (re-parent) a discipline / system link | — |
| **Other-project structure units** (`project_structure_nodes`) | Add a unit · archive / reactivate (remove) · change `parent_id` (re-parent) · `weekly_reporting_required` / `monthly_reporting_required` (reporting scope) · **rename** (`name`, `code`) | `sort_order` · `description` |
| **Other-project levels** (`project_structure_levels`, via `configure_project_structure_levels()`) | Add or remove a level · **rename** (`singular_label` / `plural_label`) | — |
| Unit responsibilities and members (2C.3 / structure responsibilities) | — | Free, as today, under their own history (not duplicated in the field-change log) |

There is no lightweight structure class.

*As built (13.9B Step 4, 2026-10-17; migration 20261019090000 — reconciled
from the earlier "whole relation, through the editor write paths" wording,
per the owner's Step 4 instruction for a structured target / action
payload):*

- A governed structure amendment is **one action on one target**, in the
  same `project_setup_amendments` model as a field amendment (no second
  approval system). `field_key` is the relation key (`structure_units`,
  `structure_levels`, `structure_departments`, `structure_disciplines`);
  `target_key` names the target (`unit:<id>`, `add:<parent>:<level>:<name>`,
  `levels`, `department:<id>`, `discipline:<id>`); `proposed_value` is
  `{action, …payload, labels}`; `previous_value` is the server's read of
  **that target's** state. Actions:
  - units: `add` · `rename` · `move` · `archive` · `restore` ·
    `set_reporting_scope`;
  - levels: `rename_level` · `add_level` · `remove_level`;
  - departments: `add_department` · `remove_department` ·
    `set_department_scope` (systems and reporting);
  - Programs & Studies: `add_discipline` · `move_discipline` ·
    `remove_discipline` (never merged with Disciplines).
- **One pending request per project, key and target**: unrelated targets can
  be pending together; a second request on the same target is refused.
- The request is validated against the live structure up front, with the
  same rules the structure triggers enforce. Examples: parent on the level
  above, no active children before archive, no people before archive,
  unique active names and codes, no reporting overlap, at most four levels,
  only the deepest empty level removed, systems belonging to the department,
  no removal of a department or system still used by a Program & Study.
- **Approval** (a different PCA / SA, B12) re-reads the target's state:
  - if it changed, the request is recorded **stale** and nothing is applied;
  - if the target is unchanged but the change is no longer valid (a sibling
    took the name, a child was added), it is stale with the reason;
  - otherwise the change is applied **in the decision transaction** by an
    internal targeted write.

  That write is internal and not callable by any client. Every existing
  structure trigger still applies to it: archived, 2C.1c, 13.6 people,
  overlap and level checks. The full-set editor RPCs are not reused because
  they replace a whole relation and check the caller's page version, which a
  single approved change does not carry.
- **Database guard** `guard_structure_setup_controlled` on the four tables
  compares old and new. Once Controlled:
  - a governed change is accepted only in the transaction that approved the
    amendment for exactly that key and target;
  - unchanged saves pass;
  - order, descriptions, department lead and project description stay free;
  - before Controlled nothing changes.

  The Programs & Studies save now writes differences only, so an unchanged
  save is a no-op.
- Every applied or free structure change is recorded once, with its before
  and after, in `project_setup_relation_changes` (`06` §10A.11.8).
- Archive-not-delete and the existing referenced-record rules are unchanged.
  Once Controlled, a unit is removed by archiving it; a delete is refused.

#### 26.24.3 Amendments

**Server functions** (no direct table writes):
- **Request:**
  - The server reads the current value as `previous_value`, refusing with
    PT409 if the caller's base value is no longer current.
  - It takes the class and impact warning from the registry.
  - A lightweight request is applied in the same transaction (`applied`). A
    governed one is stored as `pending`.
- **Decide (approve / reject):**
  - Locks the amendment and the project.
  - Requires `pending`, and an eligible decider other than the requester.
  - Approve re-checks the authoritative value: if it changed, the request is
    recorded `stale` and nothing is applied. Otherwise the value is applied
    through the guarded path and the request is recorded `approved`.
  - Reject requires a comment.
- **Withdraw:** the requester, or a Project Control Admin / System
  Administrator, moves a `pending` request to `withdrawn`.

**History** shows every request and its single decision. Nothing is
overwritten or deleted.

#### 26.24.4 Self-approval and concurrency (database-enforced)

| Situation | Deterministic outcome |
|---|---|
| Requester approves own request | Refused (42501), every role, including System Administrator. No break-glass |
| Two requests for the same field | The second is refused: one `pending` per (project, field), by unique index |
| Value changes while a request is pending | Approval records `stale`, applies nothing, and tells the decider |
| Concurrent / duplicate approval | Row lock; the second decision finds the request no longer `pending` and is refused (PT409) |
| Direct edit of a governed field after Controlled | Refused (`[SETUP_CONTROLLED]`). The UI offers "Amend" |
| Project becomes Controlled while a setup form is open | The save is refused for any changed governed field, with "Setup is now controlled — use Amend". Free fields still save |
| Duplicate Finalise | The second is refused: one finalisation per project (unique) |
| Second Reported Progress entry for the same Data Date | Refused; the user corrects the existing entry instead |
| Back-dated Reported Progress entry without a reason | Refused (B20) |
| Two corrections of the same entry | The second is refused: the unique successor keeps the chain linear |
| Project archived while a request is pending | The stored row is not changed (B24). Approve, reject and withdraw are refused for every role; the UI shows the derived state "Frozen — project archived" (§26.24.8) |

Every setup-governance write serialises on the existing Project Setup
advisory lock used by `save_project_setup_patch()`.

#### 26.24.5 Finalise Project Setup and Reported Progress

**Finalise Project Setup** (no-formal-schedule only):
- **Allowed for:** System Administrator, Project Control Admin, or the
  project's assigned Project Control / Planning.
- **Requires:**
  - the project is not archived and not already Controlled;
  - the stored onboarding mode is `no_formal_schedule`;
  - the confirmation.
- **Records** an append-only finalisation.
- **Never** creates a snapshot, a figure or planning governance.
- **Not reversible** (B23, closed). There is no un-finalise path. The
  finalisation record stays historical truth. Later setup changes go through
  amendments; a later move to a planning-governed mode is a new governed
  transition (§26.24.6) that neither deletes nor reverses the finalisation,
  and Setup stays Controlled.

**Reported Progress** (B19–B21, closed 2026-10-16):
- **The canonical stream** for a not-planning-governed project (`06`
  §10A.11.5).
- **Who writes** (B21): only the System Administrator, a Project Control
  Admin, or the project's assigned Project Control / Planning —
  `can_manage_project_operations(project)`. Never the Reporting Coordinator,
  department users or ordinary members; never a Weekly or Monthly path.
- **When it is writable:** the stored onboarding mode is
  `no_formal_schedule`, the project is **Finalised** (B19), no Published
  Planning Snapshot exists, and the project is not archived. After a governed
  transition to a planning-governed mode, the stream is frozen history,
  labelled "before planning governance".
- **Data Date** (B20):
  - never later than today in the project's time zone;
  - back-dating is allowed. A `report` whose Data Date is earlier than the
    project's latest **valid** Reported Progress Data Date (the greatest Data
    Date whose chain head is not a withdrawal — owner wording 2026-10-17)
    needs a **mandatory reason**, and is stored as back-dated (set by the
    server, never by the caller);
  - a correction or withdrawal keeps the Data Date of the entry it
    supersedes and always carries its own reason;
  - one original `report` per Data Date; a second is refused (correct the
    existing entry instead).
- **Chain rules (as built, Step 2).** `report → correction* → [withdrawal]`
  per Data Date.
  - Only the **current head** (an entry nothing supersedes) can be corrected
    or withdrawn; acting on a superseded entry is refused, so two users
    working from the same screen cannot both succeed.
  - One successor per entry (unique), within the same project and Data Date
    (composite foreign key). Chains cannot fork, cross projects or cycle
    (rows are insert-only and a successor references an earlier row).
  - **A withdrawal is final** (design decision): it cannot be corrected or
    withdrawn again. That Data Date then has no valid position; because the
    original report is unique per date, it cannot be reported again.
- **Latest valid position:** the head of a chain (no successor) with the
  greatest Data Date whose kind is not `withdrawal`. A back-dated entry never
  becomes "latest" unless its date is the latest, and never overwrites or
  supersedes a later entry.
- **History is never rewritten.** A new, back-dated or corrected entry never
  changes a frozen or approved Weekly / Monthly / Executive report that
  referenced an earlier entry. Correcting a historical report is a separate
  **report-revision** concern (`03` §12), never a side effect of the stream.
- **Project Progress shows:**
  - the latest valid entry: Data Date, reported actual %, reported planned %
    where given, narrative and provenance;
  - its correction history, with back-dated entries marked;
  - always "Reported — not planning governed" and SPI "N/A".
- **Never shown:** PV, EV, planning SPI or an S-curve.
- **Update Reported Progress** adds a `report`, or a `correction` /
  `withdrawal` that supersedes the head of a chain with a reason. It is
  offered only to the B21 set, only when the stream is writable.
- **Weekly and Monthly** may later reference an entry by id, pinned at
  approval (13.17–13.19); they never copy, write or own it.

#### 26.24.6 Planning Onboarding Mode transitions after Controlled

B18, closed 2026-10-16. The stored mode lives in
`project_planning_settings.onboarding_mode`.

| From → To | Not Controlled | Controlled, **no** Published Snapshot | A Published Snapshot exists | Effect on history |
|---|---|---|---|---|
| `no_formal_schedule` → `new_project` / `existing_active_project` | Free, as today | **Governed amendment** | **Governed amendment** *(only reachable for legacy data: from 13.9B a snapshot cannot be published while the mode is `no_formal_schedule`, §26.24.1)* | Reported Progress becomes frozen history, labelled "before planning governance". The finalisation record stays (B23). The project is "awaiting first Published Planning Snapshot" until one is published |
| `new_project` / `existing_active_project` → `no_formal_schedule` | Free, as today | **Governed amendment** *(e.g. a Finalised project already moved to a planned mode, before its first snapshot; from 13.12 also a project Controlled by an approved BL0 — the BL0 stays as history)* | **Prohibited** — the snapshot is a planning fact (§26.14) | Snapshots stay official history |
| `new_project` ↔ `existing_active_project` | Free, as today | **Governed amendment** *(same cases)* | **Prohibited** — the first snapshot already embodies how planning began | No snapshot or Opening Position is altered |

Notes:
- **Corrected 2026-10-16 (13.9B Step 1).** Controlled without a snapshot
  arises from a Setup Finalisation (Step 2) — including a Finalised project
  that has since moved to a planned mode but not yet published — and, from
  13.12, from an approved BL0. All three cells in that column are therefore
  live once Step 2 ships. In Step 1 the only anchor is a snapshot, so that
  column cannot occur yet; `project_onboarding_transition_rule()` already
  implements it and Step 2's runtime suite proves it.
- A prohibited transition is refused by the database, and the UI does not
  offer it. A governed transition is applied only by an approved amendment
  in the same transaction (`06` §10A.11.6).
- **Nothing historical is rewritten:** no snapshot, Opening Position,
  baseline, finalisation or Reported Progress entry changes on any
  transition.

#### 26.24.7 History and audit integration

- **Structured records are the source:**
  - amendments (requests and decisions);
  - finalisations;
  - Reported Progress entries and corrections;
  - free-field changes (`project_setup_field_changes`);
  - the existing classification corrections and responsibility history.
- **Project History** (still mock today) gains a real **Setup & governance**
  feed that reads those tables. It shows actor, time, reason and before /
  after for each event.
- **No second audit system.** The field-change log exists only because
  nothing generic exists yet, and the platform Audit Trail (§19) will absorb
  it.

#### 26.24.8 Archived projects

- Every new table and action follows the 13.9 / 2C.3E guards. Archived
  projects refuse every:
  - amendment request, decision or withdrawal;
  - Finalise;
  - Reported Progress entry or correction.

  This applies for every role, at the data boundary.
- History stays readable.
- **Pending amendment requests on an archived project** (B24, closed
  2026-10-16):
  - the stored request row is **not changed** — it keeps status `pending` as
    immutable history; no "withdrawn" or "stale" is recorded because of the
    archive;
  - approve, reject and withdraw are refused for every role (the archived
    guard);
  - it is excluded from every active approval queue;
  - the UI shows the **derived** state **"Frozen — project archived"**,
    computed from `status = pending` plus the project's archived state —
    never stored;
  - Project History lists it normally with its request details.
  - If an archived project is ever restored, the row was never altered, so
    the request is decidable again and the stale check (§26.24.4) still
    protects it.
- **Defence in depth:**
  - **Database:** the guard triggers.
  - **Services:** archived refusals are mapped to plain sentences.
  - **UI:** no Amend, Approve, Finalise or Update Reported Progress controls,
    and the existing "Archived · read-only" notice.

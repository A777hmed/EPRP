# EPRP Logical Data Model

## 1. Purpose and authority

This document is the **canonical logical data model** for the EPROM Progress Report platform. It defines the business entities the platform holds, who owns each one, how they relate, how they change state, and what history they preserve.

It is the permanent source of truth for *what data exists and what it means*. Every implementation phase must conform to it.

**Scope boundaries.** This is a logical model, not a physical schema. It contains **no SQL, no DDL, no migrations, no table or column definitions, no data types, no APIs, and no implementation detail**. Attributes are described in business terms. How any of it is stored is decided by the implementing phase.

### 1.1 Final product decisions incorporated

This revision applies six final product decisions. Several **supersede** positions previously recorded in `01`–`05`; the changes required upstream are listed in §26.

| # | Decision | Effect |
|---|---|---|
| 1 | **Read visibility is universal.** Every authenticated user may open every platform page read-only. Permission governs **actions only**. | Replaces project-scoped read gating |
| 2 | **Projects own their structure outright.** Global master data is limited to seven kinds. | Replaces the master-record-plus-instance model |
| 3 | **Four report levels.** Chairman Report is an **independent** report, not a renamed Executive Summary. | Adds a fourth report type |
| 4 | **Comment Register is a dedicated entity.** | Replaces flag-only propagation |
| 5 | **Portfolio Summary is an independent entity.** | New compiled entity |
| 6 | **Report Template, Branding, Dashboard Widget, Report Layout** are logical entities. | New entities |

Its place in the canonical sequence:

| Document | Authority |
|---|---|
| [`01_PROJECT_VISION.md`](01_PROJECT_VISION.md) | What the platform is — product scope |
| [`02_PLATFORM_ARCHITECTURE.md`](02_PLATFORM_ARCHITECTURE.md) | Ownership tiers, isolation, permission architecture |
| [`03_REPORTING_ARCHITECTURE.md`](03_REPORTING_ARCHITECTURE.md) | The reporting engine |
| [`04_WORKFLOW_ENGINE.md`](04_WORKFLOW_ENGINE.md) | Report states and transitions |
| [`05_PERMISSION_MODEL.md`](05_PERMISSION_MODEL.md) | Roles, responsibility, delegation |
| **This document** | **The entities themselves** — attributes, relationships, lifecycle, history |

---

## 2. How to read this model

### 2.1 Notation

```text
A  1 —— *  B     one A relates to many B
A  * —— *  B     many-to-many, always through a named relationship entity
A  1 —— 0..1 B   optional one-to-one
(owner)          the entity whose lifecycle governs this one
```

### 2.2 Every entity declares five things

| Declared | Meaning |
|---|---|
| **Owner** | Whose lifecycle governs it. Exactly one, always. |
| **Identity** | What makes an instance unique. Always a stable identifier, never a name. |
| **Attributes** | Business facts the entity carries, in business language. |
| **Relationships** | What it points at, and what points at it. |
| **Lifecycle & history** | How it changes state, and what is preserved when it does. |

### 2.3 Terms used throughout

| Term | Meaning here |
|---|---|
| **Global master data** | One of the seven organization-level kinds in §5 |
| **Project-owned** | Belongs to exactly one project; no other project can reach it |
| **Template** | A reusable definition that is **copied**, never linked live |
| **Snapshot** | Immutable content captured at approval |
| **Revision** | A new, separately approved version of an issued report |
| **Soft delete** | Withdrawn from use, recoverable, history retained |
| **Derived** | Computed on demand; never authoritative when stored |

---

## 3. Modelling rules

Non-negotiable. Every entity below obeys them.

| # | Rule |
|---|---|
| 1 | **Every entity has exactly one owner.** |
| 2 | **Every record is identified and linked by a stable identifier — never by name.** |
| 3 | **Records are never merged because their names match.** |
| 4 | **A project owns its own structure outright.** Only the seven global master data kinds in §5 are shared across projects. |
| 5 | **No project-owned record references a project-owned record of a different project.** |
| 6 | **Templates are copied, never linked.** Editing a copy never affects its source or any other project. |
| 7 | **Approved content is immutable.** Change produces a revision. |
| 8 | **History is preserved, never overwritten.** Removal is a state, not an erasure. |
| 9 | **Derived values are computed, never authoritative when stored.** |
| 10 | **Referenced records are archived, never deleted.** |
| 11 | **Labels and terminology are configuration and never branch behaviour.** |
| 12 | **Job titles and functional titles carry no permission.** |
| 13 | **Reading is universal; permission governs actions only.** |
| 14 | **Audit is platform-owned and outlives its subject.** |

---

## 4. Entity group map

Seventeen groups. Every entity belongs to exactly one.

```text
TIER 0 — PLATFORM
  Q. Audit and history        P. Account and user profile

TIER 1 — ORGANIZATION  (global master data — seven kinds only, §5)
  A. Client · Project Type · Job Title · KPI Definition ·
     Risk & Criticality Matrices · Lifecycle Template · Knowledge Base
     (plus organization-level Report Templates and default Branding, §16)

TIER 2 — PROJECT  (the project owns all of this outright)
  B. Project core and structure     C. Dynamic hierarchy
  D. Contacts and assignments       E. Organization Chart
  F. Project Lifecycle              G. Comment Register
  N. Calendar, meetings, activities

TIER 3 — REPORTING  (four levels)
  H. Weekly     I. Monthly     J. Executive Summary · Chairman Report
  K. Portfolio Summary  (independent, organization-scoped)

TIER 4 — RECORDS
  L. Report presentation, templates, branding, output, archive
  M. Dashboards and widgets        O. Notifications and messages
```

---

## 5. Group A — Global master data

Tier 1. **Exactly seven kinds are shared across projects.** Everything else a project uses, the project owns.

| Entity | Purpose | Key attributes |
|---|---|---|
| **Client** | The organization a project is delivered for | Name · code · short name · contact details · country · city · logo · active |
| **Project Type** | Classification driving hierarchy, terminology and templates | Name · code · description · hierarchy profile (§7) · default lifecycle template · default report templates · active |
| **Job Title** | Descriptive title, administered centrally | Name · code · description · active |
| **KPI Definition** | What a measure is and how it aggregates | Name · unit · calculation basis · **aggregation rule** · applicable project types · active |
| **Risk Matrix** | Likelihood and impact bands and the resulting severity grid | Band definitions · severity mapping · active |
| **Criticality Matrix** | Importance bands for work items | Band definitions · active |
| **Lifecycle Template** | Reusable set of lifecycle stages | Name · project type · stage definitions · active |
| **Knowledge Base Record** | Organizational knowledge outliving projects | Title · content reference · classification · associated project types · active |

**Why these seven and no others.** They are precisely the definitions that must mean the same thing everywhere for portfolio comparison to be valid: a KPI must compute identically on every project, a risk severity must mean the same on every project, and a project type must classify consistently. Anything project-specific is owned by the project.

**Lifecycle:** created by an authorized administrator, edited, and **archived** when withdrawn from new selection. Existing references stay valid and readable. **Never deleted while referenced** (rule 10).

---

## 6. Group B — Project core and project-owned structure

### 6.1 Project

The isolation boundary. Everything operational belongs to exactly one.

- **Owner:** Organization
- **Identity:** Stable identifier. A project code is a human-readable label, unique by policy, never the link.
- **Attributes:** Code · name · short name · description · project type · client · contract and purchase-order references · planned/actual/forecast dates · current phase · status · priority · reporting configuration (reporting day, working week, monthly cut-off, time zone, currency) · active · archived
- **Relationships:** references Client and Project Type; **owns** everything in Groups B–G and N
- **Lifecycle:** Planning → Active → On Hold → Completed → Archived. Archiving withdraws the project; nothing inside it is destroyed.

### 6.2 The project owns its structure

Each project holds its **own** departments, systems, hierarchy items, contacts, organization chart, lifecycle and dashboard configuration. These are not references to shared records.

```text
Project
  └── Project Department        ← owned outright by this project
        └── Project System      ← owned outright by this project
              └── Project Work Item   (Programs & Studies / Disciplines, §7)
```

| Consequence | Detail |
|---|---|
| The same name may appear in many projects | Each is a separate record. "Process Safety" in Project A and Project B are two records. |
| Records are never merged by name | Linking is always by identifier (rule 2, 3). Identical names are never treated as the same thing. |
| Editing one project's structure affects no other | There is no shared record to affect. |
| A project may be seeded from a template | Seeding **copies**; the copy is independent (rule 6). |

### 6.3 Project structure entities

| Entity | Owner | Identity | Key attributes |
|---|---|---|---|
| **Project Department** | Project | Project + identifier | Name · code · description · reporting required · obligation description · department lead · display order · active |
| **Project System** | Project | Project + identifier | Name · code · owning Project Department · description · scope notes · criticality rating · display order · active |
| **Project Work Item** | Project | Project + identifier | Name · code · owning Project Department and Project System · description · planned weight · criticality rating · display order · active |
| **Project Responsibility** | Project | Project + kind + holder | Kind (Project Manager, Reporting Coordinator, Project Control, Client Representative, Sponsor…) · holder (Project Contact) · start · end · active. **Several holders per kind permitted.** |
| **Project Configuration** | Project | Project | Hierarchy label overrides (§7) · KPI selections and targets · reporting cycle settings · **dashboard configuration** (§17) · **branding** (§16) · lifecycle source |

**Lifecycle & history:** added, edited, reordered, **archived** — never hard-deleted while referenced by reporting history. Every change audited (§21).

---

## 7. Group C — Dynamic hierarchy

### 7.1 One structural level, several names

There is exactly **one** entity for the level beneath a System: the **Project Work Item**. Its backend concept remains **Discipline** and that is preserved unchanged.

Only the **label** varies:

| Project type family | Displayed label |
|---|---|
| Process Safety / Asset Integrity Management | **Programs & Studies** |
| General engineering | **Disciplines** |
| Any other configured type | Whatever its hierarchy profile declares |

**Separate entities for Disciplines, Programs & Studies and Areas are prohibited.** Doing so would fragment progress roll-up, KPI aggregation and analytics across incompatible structures.

### 7.2 Hierarchy Profile

- **Owner:** Project Type (global master data)
- **Attributes:** For each level — singular label, plural label, required or optional, whether progress is measured at it; plus level count and roll-up level.
- **Rules:**
  1. Labels are **editable by an authorized administrator without changing the underlying entity**.
  2. A project may **override** the inherited label in its Project Configuration; overriding changes display only.
  3. **Terminology never branches behaviour** (rule 11).
  4. The label in force at approval is **captured in every report snapshot**, so a historical report re-renders in the vocabulary it was issued under.

### 7.3 Training and other additions

**Training is not a special entity.** It is added as an ordinary Project System or ordinary Project Work Item through the same path as any other, and behaves identically thereafter. The same applies to any future category.

---

## 8. Group D — Contacts and assignments

### 8.1 Two identities, not three

Under decision 2 there is **no global person directory**. Identity resolves as:

```text
ACCOUNT                             PROJECT CONTACT
who can sign in                     a person on one project
Tier 0 — platform                   Tier 2 — owned by the project
     └────── optional link ──────────────┘
```

**Account** — the authentication identity. **Only accounts can act**; every action and audit record attributes to one. Platform-owned, deactivated but never deleted.

**Project Contact** — a person as they exist on one project. Project-owned.

### 8.2 Project Contact

- **Owner:** Project
- **Identity:** Project + identifier
- **Attributes:** Full name · display name · job title (reference to global Job Title) · organization/employer · email · phone · internal or external · **linked Account (optional)** · avatar reference · active
- **Lifecycle:** created, edited, **deactivated** — never deleted, so historical attribution survives.

A Project Contact **may exist with no account at all** — client representatives, external contributors and reference contacts are normal.

### 8.3 The Contact Center

The Contact Center is a **cross-project directory surface**, not an entity. It reads Project Contacts across all projects — which every authenticated user may do under decision 1 — and groups them by linked Account where one exists.

> **Consequence.** Without a global person record, the same human appearing on two projects is **two independent Project Contacts**. They are linked only when both carry the same Account. For a person who never signs in — most client representatives and external contributors — cross-project identity is not resolvable by the platform. This is a direct consequence of decision 2 and is recorded in §23.

### 8.4 Project Assignment

- **Owner:** Project
- **Identity:** Project + Project Contact + Project Department. **One logical assignment per contact per department per project**, regardless of how many systems or work items it covers.
- **Attributes:**

| Attribute | Required | Notes |
|---|---|---|
| Project | Yes | The owning project |
| Department | Yes | The Project Department this assignment sits in |
| System | Optional | Narrows the assignment within the department |
| Discipline / Program & Study | Optional | Narrows further; displayed under the project's own label |
| **Assignment Role** | Yes | Department Manager · Team Member Lead · Team Member |
| **Functional Responsibility Title** | Optional | Free text. **Grants no permission.** |
| **Reports To** | Conditional | See §8.5 |
| **Active Delegation** | Derived | Present when a delegation covering this contact and scope is in force today |
| **Status** | Yes | Active · Inactive · Ended |

### 8.5 Assignment integrity rules

| Assignment Role | Reports To |
|---|---|
| **Department Manager** | **Must be empty.** A manager reports to nobody within the department. |
| **Team Member Lead** | **Required**, and must reference the **Department Manager** of the same project and department. |
| **Team Member** | **Required**, and must reference a **Team Member Lead or the Department Manager** of the same project and department. |

1. **Exactly one Department Manager** per project department. Promoting a second demotes the incumbent.
2. **Reports To never crosses a department or project boundary.**
3. **No self-reference**; the rules make reporting cycles structurally impossible.
4. A staffed department **without a Department Manager is invalid**, reported once at department level rather than against every person.
5. **An invalid assignment cannot be saved.**
6. Removing or demoting a lead **reassigns their reports** rather than orphaning them.

### 8.6 Delegation

- **Owner:** Project
- **Attributes:** Delegated from (Account) · delegated to (Account) · project scope · department scope · delegated responsibilities · start date · **end date (required)** · reason (required) · exclusive or shared · revocation state
- **Rules:**
  1. **Cannot exceed the delegator's own authority.**
  2. **Expiry is derived from the dates**, never a flag. Open-ended delegation is not permitted.
  3. The delegator **keeps their authority** unless the delegation is exclusive.
  4. **Never deleted.** Revoking sets an end date and preserves the record.
  5. Every action taken under a delegation records **both the acting account and the delegation** (§21).

### 8.7 Titles grant nothing

**Job Title and Functional Responsibility Title are descriptive only** (rule 12). Neither is consulted when resolving action permission. A title containing "Lead" or "Manager" confers no authority.

---

## 9. Group E — Organization Chart

| Entity | Owner | Purpose |
|---|---|---|
| **Organization Chart** | Project | A versioned model of the project's structure of authority |
| **Position** | Organization Chart | A place in the structure — **not a person** |
| **Position Assignment History** | Position | Who held the position, and when |

**Organization Chart** — name · description · version · status (Draft → Active → Locked) · source (blank, template, imported) · active. A project may hold several over its life; one is current.

**Position** — title · code · role description · notes · owning Project Department · owning Project Work Item (optional) · **holder (Project Contact, optional)** · parent position · display order · active. Positions form a tree: one parent, many children, no self-parenting.

**Rules:**

1. **A position exists whether or not it is filled.** Vacancy is normal.
2. Holders reference a **Project Contact** — a position may be held by someone who never signs in.
3. **The chart grants no permission.** It describes structure; §17.2 governs action authority.
4. Assignment history is **permanent**, so the structure in force at any past date is reconstructable.
5. A chart attached to a report is **snapshotted at approval**, not linked live.

---

## 10. Group F — Project Lifecycle

An editable model of how a project progresses. **Not a fixed timeline and not a hardcoded set of stages.**

### 10.1 Project Lifecycle

- **Owner:** Project
- **Attributes:** Name · description · source (blank, or copied from a Lifecycle Template) · version · status · active
- **Rule:** A lifecycle copied from a template is a **full independent copy** (rule 6).

### 10.2 Lifecycle Stage

- **Owner:** Project Lifecycle
- **Attributes:**

| Attribute | Notes |
|---|---|
| Name | Editable and renameable at any time |
| Description | Free text |
| Owner | A Project Contact accountable for the stage |
| Start date · Due date | Planned; actual dates recorded separately |
| Status | Not Started · In Progress · Completed · On Hold · Cancelled |
| Weight | Contribution to overall project progress |
| Colour · Icon | Presentation only |
| Display order | Reorderable |
| Archived | Withdrawn from use, recoverable |

- **Permitted operations:** add · rename · reorder · edit · **archive** · **restore**, by an authorized Admin or Project Control user.
- **Rule:** Stages are **archived, never hard-deleted**, because reports and activities reference them.

### 10.3 Lifecycle Template

- **Owner:** Organization (global master data), associated with a Project Type
- **Rule:** Applying a template **copies** it. There is no live link.

### 10.4 Stage Dependency

- **Owner:** Project Lifecycle
- **Attributes:** Predecessor stage · successor stage · dependency kind
- **Rule:** Dependencies must remain acyclic.

### 10.5 Milestone

- **Owner:** Project Lifecycle (optionally attached to a Stage)
- **Attributes:** Name · description · target date · actual date · status · owner · criticality · visible to client
- **Rule:** A milestone is a **point**, a stage is a **span**. Neither substitutes for the other.

### 10.6 Lifecycle Link

- **Owner:** Project Lifecycle
- **Attributes:** Stage or Milestone · linked entity kind · linked entity identifier
- **Linkable to:** Activity · Meeting · Comment Register entry · Document · Weekly Report · Monthly Report · Risk · Issue · Action

### 10.7 What the lifecycle feeds

| Consumer | Uses |
|---|---|
| Dashboards | Stage progress · overdue stages · upcoming milestones · weighted project progress |
| Calendar | Stage start/due dates and milestone target dates |
| Notifications | Stage due · stage overdue · milestone approaching · milestone missed |
| Weekly Report | Current stage context, milestones in the period |
| Monthly Report | Stage movement across the month |
| Executive Summary | Stage position and milestone status per project |
| Chairman Report | Portfolio milestone and stage overview |

**These consumers read the lifecycle. None holds its own copy of a stage or milestone.**

### 10.8 Client Approval is not mandatory

**No stage is required by the platform.** Client Approval, gate reviews and similar checkpoints are **optional stages added when the project actually has them.** A project with no such stage is fully valid.

---

## 11. Group G — Comment Register

A dedicated entity. A register entry is the **persistent master record of an important item** that survives across reporting periods and report levels.

### 11.1 Comment Register Entry

- **Owner:** Project
- **Identity:** Project + identifier
- **Attributes:**

| Attribute | Notes |
|---|---|
| **Title / subject** | Short identifying text |
| **Original text** | **Immutable** — never overwritten |
| **Priority** | Ranking for attention |
| **Category** | Classification (e.g. technical, commercial, schedule, HSE, quality) |
| **Owner** | The Project Contact accountable for resolving it |
| **Due Date** | When resolution is expected |
| **Status** | New → Open → Under Review → Action Required → In Progress → Resolved → Closed, plus Pending · Waiting for Response · On Hold · Cancelled · Reopened |
| **Include in Monthly** | Eligible for compilation into the Monthly Report |
| **Include in Executive** | Eligible for selection into the Executive Summary |
| **Include in Chairman** | Eligible for selection into the Chairman Report |
| **Archive** | Withdrawn from active registers, retained and readable |
| **History** | Every version, state change and attribution |
| Scope | Project · department · system · work item · lifecycle stage, as applicable |
| Origin | The report, meeting or item where it was first raised |

### 11.2 Comment Register Update

- **Owner:** Comment Register Entry
- **Attributes:** Update text · author · period · reporting level it was added at · status at time of update · timestamp
- **Rule:** A later report **adds an update**; it never edits the original text.

### 11.3 Rules

1. **The original text is immutable.** An edit stores a new version and keeps the previous one.
2. **Deletion is soft and reversible.** Hard deletion is reserved for a System Administrator acting on a legal request, and is itself audited.
3. Every create, edit, delete, restore, review and approve event is **attributed**, with the delegation recorded where one applied.
4. **Inclusion flags are eligibility, not selection.** A flagged entry becomes *available* to the higher report; the higher report's Selection Record (§14.4) decides what is actually carried.
5. A register entry **belongs to one project**. Cross-project visibility is a reading concern (decision 1), not shared ownership.

### 11.4 Relationship to ordinary comments

Discussion attached to a specific item — an activity, a risk, a report section — remains an ordinary **Comment**, owned by the item it is attached to. A comment may be **promoted** to a Comment Register entry when it needs to persist and be tracked; promotion records the origin.

---

## 12. Group H — Weekly reporting

Weekly is the operational source of truth. **It is the only tier that accepts original operational entry.**

### 12.1 Weekly Report

- **Owner:** Project
- **Identity:** Project + report type + period. At most one Weekly Report per project per period.
- **Attributes:** Report number · period start and end · week number · status · revision · overall progress (planned and actual) · narrative summary · prepared/reviewed/approved by · source (platform or imported) · snapshot (on approval) · active · archived
- **Lifecycle:** Draft → Collecting → Under Review → Approved → Finalized → Locked, with Returned and Archived

### 12.2 Department Submission

- **Owner:** Weekly Report
- **Identity:** Weekly Report + Project Department
- **Attributes:** Status (Pending · Draft · Submitted · Returned · Accepted) · progress contribution · summary · submitted by · submitted at · accepted by · accepted at · **return reason** · late indicator
- **Rules:** Scoped to exactly one department. **Cannot skip its Department Lead.** A return **requires a reason**, retained permanently.

### 12.3 Weekly content entities

All owned by the Weekly Report.

| Entity | Purpose | Key attributes |
|---|---|---|
| **Activity** | Work performed in the period | Title · department · system · work item · lifecycle stage · owner · status · progress percent · planned/actual dates · remarks · display order |
| **KPI Value** | A measured value for the period | KPI definition · value · target in force · department or work item scope |
| **Risk** | A threat to the project | Title · description · likelihood · impact · derived severity · owner · response · status · criticality · first raised period |
| **Issue** | A realized problem | Title · description · priority · owner · status · due date · resolution |
| **Action** | A required task | Title · owner · due date · priority · status · origin (meeting, review, comment) |
| **Look-Ahead Item** | Planned work beyond the period | Title · horizon (next week, 2 weeks, 4 weeks, month, quarter) · owner · department |
| **Comment** | Discussion attached to an item | See §11.4 |
| **Attachment** | Evidence | See §16.5 |

**Risks, Issues and Actions persist across periods.** A risk raised in one week and still open the next is the **same record** with a new period assessment — never copied forward. This is what makes movement over time visible.

### 12.4 Weekly rules

1. **No operational figure may be introduced above this tier.** Late information enters through a Weekly revision.
2. Periods are **contiguous and non-overlapping**; a missing period is visibly missing.
3. Approval **freezes content and takes a snapshot**.
4. Locking is **irreversible**; correction is a new revision.

---

## 13. Group I — Monthly reporting

### 13.1 Monthly Report

- **Owner:** Project
- **Identity:** Project + report type + month
- **Attributes:** Report number · period · status · revision · compiled coverage · narrative · prepared/reviewed/approved by · snapshot (on approval) · archived
- **Lifecycle:** identical to Weekly

### 13.2 Compiled content versus Monthly-authored content

**Separately identifiable and never interchangeable.**

| | Compiled content | Monthly-authored content |
|---|---|---|
| **Source** | Approved Weekly Reports in the month | Written at the Monthly tier |
| **Editable at Monthly tier** | **No** | **Yes, while the status is editable** |
| **Correction path** | Revise the source Weekly | Edit directly |

The Monthly Report **remains fully editable while its status is editable** (Draft, Collecting, Returned) — narrative, added comments, manual additions and presentation. What cannot change at this tier is the compiled Weekly material.

**Monthly editing never alters the source Weekly snapshot.**

### 13.3 Monthly content entities

| Entity | Owner | Purpose |
|---|---|---|
| **Compiled Item** | Monthly Report | A reference to approved Weekly content included here, with its snapshot value |
| **Manual Addition** | Monthly Report | Content added at the Monthly tier with no Weekly source |
| **Monthly Comment** | Monthly Report | A comment written directly in Monthly; may promote to the Comment Register |
| **KPI Trend Point** | Monthly Report | An aggregated KPI value for the month, per the definition's aggregation rule |
| **Chart Definition** | Monthly Report | Which trend or comparison is presented, and over what range |
| **Coverage Record** | Monthly Report | Which Weekly Reports were compiled, and which expected periods are missing |

### 13.4 Monthly rules

1. **Only approved Weekly Reports are eligible.**
2. **Coverage is declared, never averaged away.** A three-of-four-week month says so.
3. Compiled figures **never contradict their sources**. Divergence is a defect.
4. Approval snapshots the compilation; later Weekly revisions **flag** the Monthly rather than altering it.

---

## 14. Group J — Executive Summary and Chairman Report

**Four report levels exist: Weekly, Monthly, Executive Summary, Chairman Report.** The Chairman Report is an **independent report**, not a rendering or rename of the Executive Summary. Each has its own identity, numbering, lifecycle, revisions and outputs.

### 14.1 Executive Summary Report

- **Owner:** Project (project-level) or Organization (portfolio-level)
- **Identity:** Scope + period
- **Input:** **Approved Monthly Reports only**
- **Attributes:** Report number · period · status · revision · narrative (**editable while in draft**) · selection record · prepared/reviewed/approved by · snapshot · archived
- **Content:** Portfolio KPIs · project health · major achievements · major delays · critical risks · decisions required · important comments · drill-down references

### 14.2 Chairman Report

- **Owner:** Organization
- **Identity:** Period
- **Input:** Approved Monthly Reports, approved Executive Summaries, and the Portfolio Summary (§15)
- **Attributes:** Report number · period · status · revision · narrative · selection record · prepared/reviewed/approved by · snapshot · archived
- **Composition:**

| Part | Content | Optional |
|---|---|---|
| Executive Brief | Condensed leadership narrative | No |
| Portfolio dashboard | Portfolio KPIs, health distribution, coverage | No |
| Project-by-project summaries | One per project in scope | No |
| Important comments | Comment Register entries flagged **Include in Chairman** across **all** projects | No |
| Management decisions | Decisions required, with owner and due date | No |
| Organization Chart pages | Snapshotted charts | **Yes** |
| Appendices | Supporting material | **Yes** |

### 14.3 Shared executive content entities

Owned by whichever report holds them.

| Entity | Purpose |
|---|---|
| **Project Health Reading** | Derived health of one project at the reporting date, with contributing factors |
| **Major Achievement** | A selected achievement, referencing its source |
| **Major Delay** | A selected delay or constraint, referencing its source |
| **Critical Risk Entry** | A selected risk, referencing the project Risk record |
| **Decision Required** | Decision text · project · requested by · owner · due date · priority · status · supporting reference |
| **Selected Comment** | A Comment Register entry chosen for inclusion, referencing the original |
| **Report Section** | An ordered part of the report, per the Report Layout (§16.3) |
| **Drill-Down Reference** | A resolvable pointer from any figure to its source project, period and report |

### 14.4 Selection Record

- **Owner:** The report
- **Attributes:** What was available · what was selected · what was excluded · who selected · when
- **Rule:** **Selection is recorded, not silent.** Exclusion is a documented editorial act.

### 14.5 Rules

1. **Only approved information** reaches either report.
2. **Narrative is editable until approval**, then immutable.
3. **Authored narrative is distinguished from compiled figures.** Narrative may interpret figures; it may never contradict them.
4. **Every figure carries a drill-down reference.**
5. Executive and Chairman authority is **read and approve**; authoring belongs to Project Control.

### 14.6 Project Health

- **Owner:** Derived. **Never authoritative when stored.**
- **Inputs:** Configured KPI values against targets · schedule position · lifecycle stage progress · risk exposure · criticality · reporting completeness
- **Rules:** cannot be edited or overridden · **explainable**, with contributing factors always recoverable · **degrades honestly** — incomplete reporting yields *Unknown*, never *Healthy*. A stored copy is a cache; the derivation is the truth.

---

## 15. Group K — Portfolio Summary

An **independent entity**, not a view and not a section of another report.

- **Owner:** Organization
- **Identity:** Period + scope
- **Input:** Approved Monthly Reports across all projects in scope
- **Attributes:**

| Attribute | Notes |
|---|---|
| Period · scope | Which projects are included |
| Status · revision | Its own lifecycle, mirroring the report lifecycle |
| **Portfolio KPI Value** | Aggregated measure across projects, per the global KPI Definition's aggregation rule |
| **Health Distribution** | Count of projects by health state, including *Unknown* |
| **Exception List** | Projects at risk, delayed, or not reporting |
| **Coverage Record** | Which projects and periods contributed, and which are missing or excluded |
| **Aggregation Basis** | How many projects and periods contributed to each figure |
| Snapshot | Taken on approval |

**Consumers — the Portfolio Summary feeds all three:**

```text
                    PORTFOLIO SUMMARY
                   (compiled, approved)
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
Portfolio Dashboard   Executive Summary   Chairman Report
```

**Rules:**

1. **Compiled from approved Monthly data only.**
2. **Coverage and aggregation basis are always declared.** A portfolio figure without its basis is not interpretable.
3. **Missing input is reported, not defaulted.** Absence is never zero.
4. Its consumers **read it**; none recomputes the same figures independently.
5. Comparison across projects is valid **only through global master data** — KPI Definitions, Risk and Criticality Matrices, Project Types. Project-owned departments and systems are not comparable across projects (§23).

---

## 16. Group L — Report presentation, templates, branding and output

### 16.1 One data model, two presentations

**The interactive workspace and the printable report read the same data.** There is no second data-entry model and no duplicated content.

```text
            Report content (entered once)
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
Interactive workspace        Preview · Print · PDF · DOCX · Excel
(edit while editable)        (render; never a separate entry path)
```

### 16.2 Report Template

- **Owner:** Organization (associated with a Project Type), with project-owned copies
- **Purpose:** A reusable definition of a report's structure, so reports of the same kind are consistent.
- **Attributes:** Name · report level (Weekly · Monthly · Executive Summary · Chairman) · applicable project types · section definitions · default layout · default branding · version · active
- **Rule:** Applying a template **copies** it into the project (rule 6). Editing the copy never affects the template or another project.

### 16.3 Report Layout

- **Owner:** Report Template (or the project's copy)
- **Purpose:** How a report's sections are ordered and presented in each output form.
- **Attributes:** Ordered section list · section visibility · page breaks · orientation and page size · header and footer composition · signature block placement · chart placement · A4 print rules · format-specific overrides (PDF, DOCX, Excel)
- **Rule:** Layout governs **presentation only**. It never changes content, figures, or what is included.

### 16.4 Branding

- **Owner:** Organization (default) with a **project-owned override**
- **Attributes:** EPROM logo · client logo · report header title · report footer text · reference prefix · document language · confidentiality label · colour palette · include QR code · include signature block
- **Rules:**
  1. Project branding **overrides** organization defaults; defaults apply where a project specifies nothing. **There is never an unbranded output.**
  2. Branding in force is **captured in the snapshot**, so a historical report re-renders as issued.
  3. Branding is **uniform across formats** and never alters content.

### 16.5 Attachments and documents

| Entity | Owner | Purpose |
|---|---|---|
| **Attachment** | The entity it evidences | Supporting file held with its context |
| **Generated Document** | The report revision | An issued output |
| **Archive Publication** | The publishing platform record | Where an approved output was published, and when |
| **Knowledge Base Record** | Organization | Knowledge outliving its originating project |

**Rules:** the attachment set is **frozen at approval** · **only approved, immutable output is published** to the archive, one-way, with the platform record always the master · a Knowledge Base Record **promoted** from a project retains attribution to its origin but becomes organization-owned.

### 16.6 Report Output

- **Owner:** The report revision that produced it
- **Attributes:** Format (PDF · DOCX · Excel) · generated from (live data or snapshot) · **draft watermark applied** · layout used · branding used · generated by · generated at · archive reference · QR reference
- **Rules:**
  1. An **approved** report generates from its **snapshot only**; re-export is stable.
  2. A **draft** generates from live data and is **visibly and unremovably watermarked**.
  3. Output from an approved revision is **immutable**.
  4. Every generation is audited.

### 16.7 Presentation attributes carried by every report

Weekly, Monthly, Executive Summary and Chairman Report each carry: EPROM logo · client logo · document number · reporting period · revision · prepared/reviewed/approved by · header and footer · page numbers · **QR code** resolving to the specific revision · **draft watermark** when not from an approved snapshot · **locked issued snapshot** · **archive reference**.

### 16.8 Report identity and revision

**Report Revision** — owner: the report. Attributes: revision number (sequential) · **reason (required)** · content snapshot · approval record · superseded flag · issued outputs. Exactly one revision is **current**. Prior revisions remain readable as approved. A revision **never automatically alters** an approved downstream report — it flags it for human decision.

**Report Number** — composed from project reference prefix · report level · period · revision. Assigned at creation and never changed · unique within its scope by level and period · **never reused** · base number stable across revisions · captured in the snapshot and printed on every output.

---

## 17. Group M — Dashboards, widgets and visibility

### 17.1 Read visibility is universal

**Every authenticated user may open every platform page in read-only mode.** Page visibility is not a permission. There is no project-scoped or department-scoped read gate.

### 17.2 Permission governs actions only

| Action | Meaning |
|---|---|
| **Create** | Add new records within the relevant scope |
| **Edit** | Change existing content while its status permits |
| **Delete** | Soft-delete or archive a record |
| **Review** | Review and return with a reason |
| **Approve** | Approve at the stage held |
| **Admin** | Administer configuration, master data and assignments |

**A user without an action permission sees the same page in read-only mode** — not a different page, not an error, and not a redirect. Read-only is a rendering state of one page, never a separate view model.

Action permission continues to resolve through **role, project and department together**. Only the *read* gate is removed.

> **Consequence.** Every authenticated user can read every project's data, including all departments' submissions and all Comment Register entries. This is a deliberate decision (§1.1, decision 1) and requires amendments to `02` §5 and §9.2, `03` §7.2, and `05` §1.1 — see §26.

### 17.3 Dashboards are derived

Every dashboard is **derived**. It reads approved reporting output and the Portfolio Summary; it never recomputes from operational records. **A dashboard that disagrees with a report is defective.**

### 17.4 Dashboard Widget

- **Owner:** Platform (the catalogue of widget kinds)
- **Attributes:** Widget kind · title · description · data source (which approved entity it reads) · supported visualizations · required inputs · default size · applicable dashboards
- **Rule:** A widget **declares its data source**. A widget that computes its own figures independently of the reporting engine is not permitted.

### 17.5 Dashboard Configuration

- **Owner:** Project (project dashboards) or Organization (portfolio and chairman dashboards); a per-user arrangement is owned by the Account
- **Attributes:** Dashboard kind · ordered widget placements · widget-level settings (period range, scope filter, thresholds) · layout · default or personal
- **Rules:**
  1. Configuration governs **presentation only**. It never changes what the underlying figures are.
  2. A personal arrangement never alters the project or organization default.
  3. Configuration is project-owned, so two projects may present entirely differently.

### 17.6 Data required by each dashboard

All derived; none stored as authoritative.

| Dashboard | Reads |
|---|---|
| **Portfolio Dashboard** | **Portfolio Summary** (§15) · health distribution · exception list · reporting compliance |
| **Project Dashboard** | Project progress planned vs actual · KPI values against targets · lifecycle stage progress · open risks and issues · outstanding submissions · pending approvals · upcoming milestones and meetings |
| **Department Dashboard** | Department submission status and history · department activities and progress · department risks and issues · outstanding obligations · assigned contacts |
| **Executive Dashboard** | Approved Monthly position per project · health · major achievements and delays · critical risks · decisions required |
| **Chairman Dashboard** | Portfolio Summary · health distribution · exceptions · decisions required · Comment Register entries flagged Include in Chairman |
| **Monthly activity schedule** | Activities, lifecycle stages, milestones, meetings and report due dates for the selected month |
| **Report compliance** | Expected versus received submissions and reports, per project and period |
| **Delayed reports and approvals** | Reports past due by status; approvals pending beyond threshold |
| **Upcoming milestones and meetings** | Forward window from lifecycle and calendar |

**Rules:** every figure resolves to its source report · coverage is always visible · the project Dashboard Workspace may show the in-progress cycle **only when visibly labelled as unapproved**, and it never feeds a portfolio figure.

---

## 18. Group N — Calendar, meetings and activities

### 18.1 Calendar is derived

The Calendar **owns nothing**. It is a view over dated obligations owned elsewhere. Duplicating dates into calendar records would produce two disagreeing answers to when something is due.

| Source | Contributes |
|---|---|
| Project Lifecycle | Stage start and due dates · milestone target dates |
| Reporting cycle | Cycle open, submission cut-off, review, approval, publication dates |
| Meetings | Scheduled date and time |
| Approvals | Pending approval due dates |
| Delegations | Start and end dates |
| Activities | Planned start and finish |

**The home dashboard shows the scheduled activities for the selected month**, assembled from these sources.

### 18.2 Meeting

- **Owner:** Project. A meeting spanning several projects is organization-owned and **references** each project; never co-owned.
- **Attributes:** Title · purpose · scheduled date and time · location or link · status · organizer · linked lifecycle stage or milestone · minutes

| Related entity | Owner | Notes |
|---|---|---|
| **Meeting Attendee** | Meeting | References a **Project Contact**; records invited / attended / apologies |
| **Agenda Item** | Meeting | May reference project entities |
| **Meeting Decision** | Meeting | **Permanent.** Superseded by a later decision; both remain readable |
| **Meeting Action** | Meeting | Owner · due date · status. Becomes a **tracked commitment** visible in the owner's view and in project reporting |
| **Reminder** | The dated entity | Offset before the date · recipients · delivery state |

**Rule:** Meeting Actions and Weekly Actions are the **same concept**; a meeting-originated action records its origin rather than creating a parallel model.

### 18.3 Activity

- **Owner:** Project, referenced by the Weekly Report of the period it is reported in
- **Attributes:** Title · description · department · system · work item · lifecycle stage · owner · planned and actual dates · status · progress percent · remarks

---

## 19. Group O — Notifications and messages

### 19.1 Event and delivery are separate

One occurrence produces **one event and many deliveries**.

| Entity | Owner | Attributes |
|---|---|---|
| **Notification Event** | The entity that raised it | Event kind · subject entity · project · department · triggered by (Account) · triggered at · **immutable** |
| **Notification Delivery** | The recipient Account | Event · recipient · **read/unread state** · read at · acted state · **linked destination** · delivery channel |
| **Message** | The sending Account | Direct message or announcement — subject · body · sender · recipients or audience scope · project and department scope · sent at |

### 19.2 Event kinds

| Kind | Examples |
|---|---|
| **System** | Account, configuration or platform events |
| **Workflow** | Submitted · returned with reason · approved · finalized · locked · revision issued |
| **Overdue reminder** | Submission overdue · report overdue · approval pending beyond threshold |
| **Lifecycle warning** | Stage due · stage overdue · milestone approaching · milestone missed |
| **Approval** | Awaiting your approval · approved · rejected |
| **Meeting reminder** | Meeting upcoming · agenda published · minutes issued |
| **Direct message / announcement** | From an Admin or Project Control user |

### 19.3 Rules

1. **Delivery is targeted by responsibility**, not by read permission — people are notified about their own work. With universal read visibility (§17.1), notification remains the mechanism that says *what needs you*.
2. Every delivery **resolves to the entity it concerns**.
3. Events are **immutable and permanent**; read state is **personal**.
4. **Notification is not audit.** Audit records what was done; notification records who was told.
5. **Notification never advances a workflow.** It informs; a person acts.
6. Announcements carry an **audience scope** and resolve to deliveries at send time.

---

## 20. Group P — Account and user profile

| Entity | Owner | Purpose |
|---|---|---|
| **Account** | Platform | Authentication identity and platform role |
| **User Profile** | Account | How a user appears and is reached |
| **Avatar** | User Profile | The user's picture |

**Account** — platform role · active state · linked Project Contacts (optional, many) · last sign-in. **Only accounts can act.**

**User Profile** — display name · job title (reference to global Job Title) · organization · **availability status** (Available · Busy · Away · On Leave · Delegated) · contact preferences · locale.

**Avatar** — kind (**generated illustrated/cartoon** or **uploaded image**) · generation parameters where generated · image reference where uploaded · updated at.

**Rules:**

1. A profile is **presentation only**. Nothing in it grants authority — including job title (rule 12).
2. Availability status is **informational**. It never changes permission and never blocks a workflow; covering someone's authority requires a **Delegation** (§8.6).
3. An account is **deactivated, never deleted**, so historical attribution survives.

---

## 21. Group Q — Audit and history

### 21.1 Audit Record

- **Owner:** **Platform** — never the entity it describes
- **Attributes:** Acting account · **delegation reference where one authorized the action** · action kind · subject entity · project and department scope · before and after state where applicable · **reason where required** · timestamp
- **Properties:** **append-only** · **immutable, including to a System Administrator** · **attributed** · **complete** · **survives the archival or deletion of its subject**

### 21.2 What every entity preserves

| Preserved | Meaning |
|---|---|
| **Creator** | The account that created the record |
| **Timestamps** | Created and last changed |
| **Status** | Current state within its lifecycle |
| **Revisions** | For reports — sequential, each with its reason |
| **Previous versions** | For Comment Register entries and approved content |
| **Acting user** | On every state change |
| **Delegation reference** | Where authority came from a delegation |
| **Return reason** | On every return, required |
| **Approval history** | Who approved what, and when |
| **Archive status** | Withdrawn from use, recoverable |

### 21.3 Audit versus revision history

| | Audit Record | Revision History |
|---|---|---|
| **Answers** | Who did what, and when? | What did this look like before? |
| **Owner** | Platform | The entity itself |
| **Scope** | Every consequential action | Approved content |
| **Form** | Immutable event log | Complete prior versions |

Both are required. Neither is derivable from the other.

### 21.4 Soft deletion

Removal is a **state, not an erasure**. A removed record is withdrawn from normal use, remains recoverable, and retains its full history. Genuine destruction is an administrative exception — itself audited.

---

## 22. Relationship map

```text
GLOBAL MASTER DATA (seven kinds)
  Client · Project Type · Job Title · KPI Definition ·
  Risk Matrix · Criticality Matrix · Lifecycle Template · Knowledge Base
        │ referenced (never owned by a project)
        ▼
Project ──┬── Project Department ──┬── Project System ── Project Work Item
          │         │                        (Programs & Studies / Disciplines)
          │         └── Project Assignment ── Project Contact ──0..1── Account
          │                    │                                        └── Profile ── Avatar
          │                    └── Delegation
          │
          ├── Organization Chart ── Position ── Assignment History
          │
          ├── Project Lifecycle ──┬── Lifecycle Stage ──┬── Dependency
          │        ▲              │                     └── Lifecycle Link
          │  Lifecycle Template   └── Milestone                 │
          │                                                     │
          ├── COMMENT REGISTER ── Register Update ──────────────┤
          │        (Include in Monthly / Executive / Chairman)   │
          │                                                     │
          ├── Meeting ── Attendee / Agenda / Decision / Action ──┤
          ├── Activity ─────────────────────────────────────────┤
          ├── Dashboard Configuration ── Widget Placement ── Dashboard Widget
          ├── Branding (project override)                       │
          │                                                     │
          ├── WEEKLY REPORT ──┬── Department Submission          │
          │      │            ├── Activity · KPI Value           │
          │      │            ├── Risk · Issue · Action          │
          │      │            ├── Look-Ahead · Comment           │
          │      │            └── Attachment                     │
          │      │ approved only                                 │
          ├── MONTHLY REPORT ─┬── Compiled Item · Coverage       │
          │      │            ├── Manual Addition · Comment      │
          │      │            └── KPI Trend · Chart              │
          │      │ approved only                                 │
          │      ▼                                               │
          │  PORTFOLIO SUMMARY  (organization-owned, independent)│
          │      │                                               │
          │      ├──────────────► Portfolio Dashboard            │
          │      ├──────────────► EXECUTIVE SUMMARY ─────────────┤
          │      └──────────────► CHAIRMAN REPORT ───────────────┘
          │                            (independent report)
          │
          └── every report ──< Report Revision ──< Report Output ──< Archive Publication
                                    ▲
                         Report Template ── Report Layout ── Branding

PLATFORM (outside every project boundary)
  Audit Record · Notification Event ──< Notification Delivery · Message · Account
```

**Derived, owning nothing:** Calendar · every Dashboard · Project Health · Contact Center surface · Active Delegation indicator.

---

## 23. Consequences of the final decisions

Recorded so they are accepted knowingly rather than discovered later.

### 23.1 From universal read visibility (decision 1)

| Consequence | Detail |
|---|---|
| **All project data is readable by every authenticated user** | Including every department's submissions, all Comment Register entries, and all reports across all projects |
| **Portfolio aggregation no longer needs access filtering** | `03` §7.2's "filter before aggregate" rule becomes unnecessary for read and should be amended |
| **Confidentiality becomes an organizational control** | Sensitive material must be kept out of the platform or handled by a future explicitly-restricted classification, since the model no longer restricts reading |
| **Notification remains the attention mechanism** | With everything readable, notification is what tells a person which work is theirs |

### 23.2 From project-owned structure (decision 2)

| Consequence | Detail |
|---|---|
| **Departments, systems and work items are not comparable across projects** | Two projects' "Process Safety" departments are unrelated records. Cross-project analytics by department is not possible without a later grouping concept |
| **Portfolio comparison runs on global master data only** | KPI Definitions, Risk and Criticality Matrices, and Project Types remain shared — these are what make the Portfolio Summary valid |
| **Cross-project person identity resolves only through Accounts** | A person without an account appearing on two projects is two unlinked Project Contacts (§8.3) |
| **Project setup requires seeding** | With nothing shared, each project defines its structure from scratch unless seeded from a template — see §25, Decision 1 |
| **Master-data maintenance moves into the project** | Renaming a department is a per-project act; there is no single place to rename it everywhere |

### 23.3 From four report levels (decision 3)

The Chairman Report has its **own numbering series, lifecycle, revisions, snapshots and outputs**. It is not generated from the Executive Summary and does not share its identity. `03` §18's Executive Package is a **generation format**, not a fifth report level.

---

## 24. Specification versus as-built

This document is **specification**. `docs/engineering/` describes what exists in code today. Where they disagree, this document wins.

| Area | As-built today | This model requires |
|---|---|---|
| Master data | Departments, systems, disciplines and contacts are **global** and shared | **Project-owned** (§6.2) — a structural change |
| Read access | Every authenticated user has full reach | Universal read is now **correct by design**; action permission is not enforced |
| Action permission | Not enforced anywhere | §17.2 resolved through role, project and department |
| Hierarchy | One Discipline entity with PSM label resolution — **consistent with §7** | Label carried by a configurable Hierarchy Profile |
| Contacts | Global directory exists | §8.2 project-owned Project Contact |
| Assignments and delegation | Specified; **not applied** | §8.4–§8.6 |
| Organization Chart | Charts, positions and history exist | §9 |
| **Project Lifecycle** | **Does not exist** | §10 in full |
| **Comment Register** | **Does not exist** as an entity | §11 |
| Weekly | Reports, submissions, activities and entries exist; approval and locking not enforced | §12 |
| **Monthly** | **Does not exist** | §13 |
| **Executive Summary** | **Does not exist** | §14.1 |
| **Chairman Report** | **Does not exist** | §14.2 |
| **Portfolio Summary** | **Does not exist** | §15 |
| **Report Template / Layout / Branding entities** | Branding fields exist on the project only | §16.2–§16.4 |
| Snapshots and revisions | **Do not exist** | §16.6, §16.8 |
| Report output | **No generation in any format** | §16 |
| Dashboards | Read **mock data** and calculate independently | §17.3 — read approved output and the Portfolio Summary |
| **Dashboard Widget / Configuration** | **Do not exist** | §17.4–§17.5 |
| Calendar / Meetings | **Do not exist** | §18 |
| Notifications | **Do not exist** | §19 |
| User profile / avatar | Profile exists; **no avatar** | §20 |
| Audit trail | **Does not exist** | §21 |

---

## 25. Open decisions

Decisions 1–6 from §1.1 are settled. These remain.

| # | Decision | Positions | Why it matters |
|---|---|---|---|
| **1** | **Project structure seeding** | (a) Project Type carries a structure template copied at creation. (b) Every project is built from scratch. (c) Copy structure from an existing project. | With nothing shared (§6.2), setting up each project manually is significant repeated effort. The Lifecycle Template pattern already exists and would extend naturally. |
| **2** | **Cross-project grouping** | (a) Accept that departments and systems are not comparable across projects. (b) Add an optional organization-level grouping key that project structures may reference for analytics only. | Determines whether "which department is strained across the portfolio" is answerable. |
| **3** | **Executive Summary scope** | §14.1 allows both project-level and portfolio-level Executive Summaries. | Confirm whether a portfolio-level Executive Summary is a separate record or is fully replaced by the Portfolio Summary plus Chairman Report. |
| **4** | **Sensitive content** | Universal read (§17.1) means nothing in the platform is private. | Confirm no content requires restriction, or define an explicitly-restricted classification as a later addition. |
| **5** | **Report Template ownership** | Modelled as organization-owned with project copies, matching Lifecycle Template. | Confirm templates belong in the global set even though decision 2 listed seven kinds without them. |
| **6** | **Action vocabulary versus roles** | §17.2 defines six actions; `02` §8 defines eight roles; `05` §8 defines the operating role table. | Compatible — roles grant action sets — but the mapping must be written once, authoritatively, when `05` is next revised. |

---

## 26. Required amendments to documents 01–05

The final decisions supersede specific approved statements. **None of these is changed by this document**; each is listed so it is amended deliberately.

| Document | Section | Currently says | Must become |
|---|---|---|---|
| [`01_PROJECT_VISION.md`](01_PROJECT_VISION.md) | §4 *Contact Center* | A person is "created once and then drawn into any project that needs them, rather than re-entered per project" | Contacts are project-owned; the Contact Center is a cross-project directory surface (§8.3) |
| [`01_PROJECT_VISION.md`](01_PROJECT_VISION.md) | §4 *Dynamic Departments, Systems* | Departments and systems are "defined centrally, assigned per project" | Defined and owned per project (§6.2) |
| [`01_PROJECT_VISION.md`](01_PROJECT_VISION.md) | §5 *Access* | "Project establishes which projects they may reach. Assignment to one project grants nothing on another" | Applies to **actions only**; reading is universal (§17.1) |
| [`02_PLATFORM_ARCHITECTURE.md`](02_PLATFORM_ARCHITECTURE.md) | §2 rule 2, §3 Tier 1, §4.4 | "Master data is referenced by projects, never owned by them" | Only the seven global kinds are shared (§5) |
| [`02_PLATFORM_ARCHITECTURE.md`](02_PLATFORM_ARCHITECTURE.md) | §5 *Project isolation* | "Access is granted per project. Assignment to one project confers nothing on another" | Isolation governs **write and structure**, not read |
| [`02_PLATFORM_ARCHITECTURE.md`](02_PLATFORM_ARCHITECTURE.md) | §7 *Contact Center relationships* | Three identities including a global Person | Two identities: Account and Project Contact (§8.1) |
| [`02_PLATFORM_ARCHITECTURE.md`](02_PLATFORM_ARCHITECTURE.md) | §9.2 *Resolution order* | Steps 2 and 3 deny when not assigned to the project or department | Steps 2 and 3 gate **actions only**; read always allows |
| [`03_REPORTING_ARCHITECTURE.md`](03_REPORTING_ARCHITECTURE.md) | §7.2 | "A portfolio view is filtered by the reader's access before it is aggregated" | Unnecessary for read under universal visibility (§23.1) |
| [`03_REPORTING_ARCHITECTURE.md`](03_REPORTING_ARCHITECTURE.md) | §6, §18 | Executive Summary and Executive Package | Add the **Chairman Report** as an independent fourth level (§14.2) |
| [`03_REPORTING_ARCHITECTURE.md`](03_REPORTING_ARCHITECTURE.md) | §7 | Portfolio reporting described as reading approved output directly | Portfolio Summary is an independent compiled entity feeding it (§15) |
| [`05_PERMISSION_MODEL.md`](05_PERMISSION_MODEL.md) | §1.1 | A Department Engineer "sees only the projects and departments assigned to them" and "can never read … another department's submission" | Sees everything read-only; **cannot act** outside their scope (§17.2) |
| [`05_PERMISSION_MODEL.md`](05_PERMISSION_MODEL.md) | §8 role table | "Scope" column limits what a role can reach | Scope limits **actions**; reach is universal for reading |

---

## 27. Document map

| Document | Defines |
|---|---|
| [`01_PROJECT_VISION.md`](01_PROJECT_VISION.md) | What the platform is |
| [`02_PLATFORM_ARCHITECTURE.md`](02_PLATFORM_ARCHITECTURE.md) | Ownership, isolation, permission architecture |
| [`03_REPORTING_ARCHITECTURE.md`](03_REPORTING_ARCHITECTURE.md) | The reporting engine |
| [`04_WORKFLOW_ENGINE.md`](04_WORKFLOW_ENGINE.md) | Report states and transitions |
| [`05_PERMISSION_MODEL.md`](05_PERMISSION_MODEL.md) | Roles, responsibility, delegation |
| **This document** | **The entities** — attributes, relationships, lifecycle, history |
| [`15_DEVELOPMENT_ROADMAP.md`](15_DEVELOPMENT_ROADMAP.md) | **Current status and delivery order** |

This document is the authority on **what data exists and what it means**. It describes the complete model. It is the target, not a statement of what is built today; the roadmap is the authority on current status.

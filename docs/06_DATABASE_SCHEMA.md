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

Eighteen groups. Every entity belongs to exactly one.

```text
TIER 0 — PLATFORM
  Q. Audit and history        P. Account and user profile

TIER 1 — ORGANIZATION  (global master data — §5)
  A. Client · Project Type · Job Title · KPI Definition ·
     Risk & Criticality Matrices · Lifecycle Template · Knowledge Base ·
     Resource Category (added 2026-10-14, §10A.8)
     (plus organization-level Report Templates and default Branding, §16,
      and Planning Setup Templates, §10A.1)

TIER 2 — PROJECT  (the project owns all of this outright)
  B. Project core and structure     C. Dynamic hierarchy
  D. Contacts and assignments       E. Organization Chart
  F. Project Lifecycle              G. Comment Register
  N. Calendar, meetings, activities
  R. Master Planning & Control (§10A — planning hierarchy, baselines,
     snapshots, governed milestones, manpower)

TIER 3 — REPORTING  (four levels)
  H. Weekly     I. Monthly     J. Executive Summary · Chairman Report
  K. Portfolio Summary  (independent, organization-scoped)

TIER 4 — RECORDS
  L. Report presentation, templates, branding, output, archive
  M. Dashboards and widgets        O. Notifications and messages
```

---

## 5. Group A — Global master data

Tier 1. **Exactly seven kinds are shared across projects** — eight from 2026-10-14, with Resource Category (below the table). Everything else a project uses, the project owns.

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

**Terminology since Phase 2C.1.** The "Project Type" master in the table above is shown in the product as **Project Category**. Its storage keeps the legacy name (`project_types`, referenced by `projects.project_type_id`) and is not renamed. "Project Type" in the product now means only **PSM Project / Other Project**, a set-once attribute of the project (§6.1; stored as `projects.structure_family`). Read `project_types` / `project_type_id` as Project Category wherever they appear. See `02_PLATFORM_ARCHITECTURE.md` §4.2, §4.5.

**Why these seven and no others.** They are precisely the definitions that must mean the same thing everywhere for portfolio comparison to be valid: a KPI must compute identically on every project, a risk severity must mean the same on every project, and a project type must classify consistently. Anything project-specific is owned by the project.

**Eighth kind — Resource Category (approved 2026-10-14).** Manpower must be
comparable across projects and aggregated by discipline, craft or engineering
team, so Resource Category is admin-managed global master data
(`02_PLATFORM_ARCHITECTURE.md` §26.9, §10A.8 here). Same lifecycle as the
others: archived, never deleted while referenced.

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

**Classification (Phase 2C.1).** As built, "project type" is two attributes (see `02_PLATFORM_ARCHITECTURE.md` §4.5):

- **Project Type** — PSM or Other. Set once, at the first save; absent only on legacy projects created before Phase 2C.1. After it is set it changes only by an audited System Administrator correction (§21.5).
- **Project Category** — a reference to the shared Project Type master, shown as "Project Category". Required for an Other project, never a PSM/PSAIM category; absent for a PSM project.
- **Project-specific category name** — only for an Other project whose category allows one. It belongs to the project and is never added to the shared list.

The shared master gains one attribute: **allows a project-specific name**.

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

### 6.4 Project Parties (Phase 2C.3A, 2C.3B)

The companies party to a project. It is the same model for PSM and Other projects; their differences begin at Project Structure. Parties are **companies, not people**: personnel belong to Project Responsibility (§6.3, §8), which this entity does not touch.

- **Owner:** Project
- **Identity:** Stable identifier per party row. A subcontractor's company name is a business label, never the identity.
- **Kinds:** exactly one **EPROM** (service provider; fixed, read-only), exactly one **Owner** (resolved through the project's Client reference, so no Client master data is copied), and zero or more **Subcontractors** (optional, repeatable, ordered).
- **Subcontractor attributes (2C.3B):**

| Attribute | Rule |
|---|---|
| Registered Company Name | Required; up to 140 characters; unique within the project after trim, case-insensitive |
| Short Name / Acronym | Optional; up to 40 characters |
| Scope / Package | Required; up to 250 characters |
| Subcontract / Contract Reference | Optional; up to 100 characters |
| Engagement Status | Required; Planned · Active · Suspended · Completed. No default — chosen explicitly |

- **Completion:** zero subcontractors is valid and complete. A subcontractor saved before 2C.3B may lack Scope / Package and Engagement Status; it is preserved, never backfilled, and shown as **Needs completion** until it is completed and saved.
- **Lifecycle:** subcontractors are added, edited, reordered and removed through Project Information's normal save. EPROM and Owner rows are created by the server and cannot be edited or removed. **Since 2C.3C, a subcontractor with any current or ended team membership (§8.8) cannot be removed** — historical integrity wins. Retiring or archiving a party is not yet modelled.

**As built (storage).** Table `project_parties` (`kind` ∈ `eprom` · `owner` · `subcontractor`; `name`, `short_name`, `scope`, `contract_reference`, `engagement_status`, `sort_order`). EPROM and Owner rows keep every name and professional column null. Subcontractor rows are written only through `save_project_setup_relation` (relation `parties`), which enforces the rules above, refuses duplicate company names (SQLSTATE `23505`) and keeps existing row identifiers. The required-field CHECK `project_parties_subcontractor_professional_required` is `NOT VALID`, so legacy rows survive while every new or updated subcontractor must comply. There is deliberately no unique index on company name. Migrations: `20261006123219_project_parties_foundation.sql` (2C.3A) and `20261007120000_project_parties_professional_information.sql` (2C.3B).

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

### 8.1 One person, many project memberships

**Amended in Phase 2C.3C (owner decision, 2026-10-07).** People are **one global master**, and participation in a project is **project-scoped membership**. This supersedes this section's earlier "no global person directory" position. That position derived people from decision 2 (§1.1), but people were never one of the project-owned structure kinds, and the as-built `contacts` master has always been global.

```text
ACCOUNT                 PERSON                          PROJECT MEMBERSHIP
who can sign in         one record per human            this person on ONE project:
Tier 0 — platform       Tier 1 — global People master   party · project role · reports to
     └── optional link ──┘   └──────── referenced, never copied ────────┘
```

**Account** — the authentication identity. **Only accounts can act**; every action and audit record attributes to one. Platform-owned, deactivated but never deleted.

**Person** — the authoritative people record (`contacts`): name, position / job title, employer, email, phone, active. A person is **never duplicated** because they work on another project or for another party, and their identifier is stable.

**Project Membership** — a person on one project (§8.8). It references the Person; it never copies their details.

### 8.2 Person (global People master)

- **Owner:** Organization (global master data)
- **Identity:** Stable identifier
- **Attributes:** Full name · position (free text) · job title (reference to global Job Title, optional) · organization/employer (free text) · email · phone · home department · active
- **Write authority:** System Administrator and Project Control Admin only. Project Control / Planning may **assign existing people** to their own projects but cannot create or edit a Person.
- **Lifecycle:** created, edited, **deactivated** — never deleted, so historical attribution survives.

A Person **may exist with no account at all** — client representatives, external contributors and reference contacts are normal.

### 8.3 The Contact Center

The Contact Center is the directory surface over the People master. Because a person is one record, their participation across projects is resolvable through their memberships (§8.8), whether or not they have an account.

> **Superseded consequence.** Before 2C.3C this section said the same human on two projects was two unlinked Project Contacts. That no longer applies (§23.2).

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

### 8.8 Project Team Membership (Phase 2C.3C)

Who works on a project, which company they represent, their project role and their manager on the project. It is identical for PSM, Other and legacy projects.

- **Owner:** Project
- **Identity:** Stable identifier. **One active membership per person per project.** Leaving and rejoining creates a new row, and the ended row is kept.
- **Attributes:**

| Attribute | Rule |
|---|---|
| Person | Reference to the Person (§8.2); never copied |
| Project Party | Exactly one of this project's parties (§6.4): EPROM, Owner, or one Subcontractor. Must belong to the **same project**. Legacy backfilled rows may have none ("Needs party") |
| Project Role | Descriptive, project-scoped, 1–80 characters. **Not** the person's global Position / Job Title and never derived from it. Legacy backfilled rows may have none ("Needs project role") |
| Reports To | Another **active member of the same project**, from any party. No self-reporting and no cycles. Project-scoped: the person's global manager is never changed. Missing is a warning, not an error |
| Ended at | The single lifecycle field: empty = active, set = ended |

- **Rules:**
  1. A new or edited active membership **must** have a Party and a Project Role. Legacy rows created by the 2C.3C backfill may stay incomplete until edited, and may be **ended without completing** them.
  2. A membership is **created active**. Ending is a separate operation, refused while active members still report to the person.
  3. Ended memberships are **history**: never edited, never deleted.
  4. A Subcontractor party with any current or ended membership **cannot be removed**: "This subcontractor cannot be removed because project team history exists."
  5. **Membership grants no authority**, platform or project: no authorization check reads it, and it does not make a project visible. Authority stays with accounts, roles and the existing Project Responsibility assignments (§8.4–§8.7, `05_PERMISSION_MODEL.md`).
- **Leadership.** The five existing fixed roles stay authoritative where they are. They are *presented* as **Project Leadership & Governance** (Project Sponsor, Project Manager, Client Representative) and **Project Controls & Coordination** (Project Control Manager, Reporting Coordinator), and are not called "top management".
- **Department reporting line.** The PSM Project Assignment *Reports To* (§8.4–§8.5) is a separate, department-scoped relationship. The project-level Reports To above is the canonical people reporting hierarchy.
- **People Organization Chart (2C.3F, as built).** Derived, read-only, from the **active** memberships and their Reports To, for PSM, Other and legacy projects alike; no table or column was added. Ended memberships are not shown. A member whose Reports To is missing, names an ended or unknown member, names themselves, or forms a loop in corrupt legacy data is shown at the top level and flagged — no reporting line is invented. The chart grants nothing and has no editor: Reports To is changed only through the three membership functions above. The Phase 2A position chart (§9) is a separate model and does not define who reports to whom.

**As built.** Table `project_members` (migration `20261007150000_project_team_membership.sql`):
- Same-project Party and Reports To are enforced by composite foreign keys.
- One active membership per person is enforced by a partial unique index (`ended_at is null`).
- Self-reporting and cycles are refused by a trigger.
- The required-data rule is a `NOT VALID` CHECK added after the backfill.
- Writes go **only** through `add_project_member`, `update_project_member` and `end_project_member`, made hardened SECURITY DEFINER functions by `20261011090000_project_team_controlled_writes.sql`:
  - empty `search_path`, EXECUTE for authenticated only;
  - explicit authority: System Admin / Project Control Admin, or the project's assigned Project Control / Planning;
  - archived projects refused;
  - the project-version compare-and-swap.
- Authenticated callers hold SELECT only: there is no direct INSERT, UPDATE or DELETE, so the stale-version check cannot be bypassed.

### 8.9 Structure Responsibilities (Phase 2C.3D Wave 1, Other projects)

Connects the project team (§8.8) to an Other project's own structure units (Project Structure, Phase 2C.1c). Four concepts stay separate: **project membership** and **Reports To** (§8.8), **unit membership / leadership**, and **Weekly / Monthly reporting responsibility**. PSM projects keep their Project Assignment model (§8.4–§8.5) unchanged.

| Entity | Rule |
|---|---|
| **Unit Member** | An active project member works in a structure unit. Many-to-many: a member may be in several units, a unit has many members. One active row per person per unit |
| **Unit Lead** | At most one active Lead per unit, held as an extra row beside the person's Unit Member row, so a Lead is always also a member. Needs a **complete** membership (Party and Project Role). Missing = a **warning** |
| **Weekly / Monthly Responsible** | One active Responsible per unit per report, only on a unit flagged to provide that report's input (the unit flags stay the only place an Other project declares who owes input). Must be an active member **of that same unit** with a complete membership. Missing, when the project uses that report and the unit is flagged = a **Project Setup blocker** on Project Team & Responsibilities |
| **Weekly / Monthly Backup** | Optional standing alternate per report; needs an active Responsible for the same unit and report; a different person; same eligibility as the Responsible |

- **Authority-free:** none of these roles grants platform or project authority, or any report-writing right. Temporary dated **delegation** is a separate, later model (not `project_delegations`).
  - **Amended 2026-10-14 (`02_PLATFORM_ARCHITECTURE.md` §26.12), effective when roadmap slice 13.18 is implemented:** the **Weekly Responsible and Weekly Backup** may enter and update **only their own unit's Weekly reporting section**. Reporting write only — no project, planning, approval, return or setup authority, and nothing on any other unit. Unit Member, Unit Lead and the Monthly roles stay authority-free (Monthly scope is open decision B2). Until 13.18, the statement above stands unchanged.
- **Lifecycle:** rows are created active; `ended_at` is the only lifecycle field; ended rows are history (never edited or deleted). Replacing a person ends their row and creates a new one.
- **Explicit refusals, never cascades:** a project membership cannot end while the person has active unit rows; a unit member row cannot end while that person leads the unit or holds its responsibility; a unit cannot be archived while it has active people, or lose its Weekly / Monthly flag while that report's responsibility is active; a unit with any people history cannot be hard-deleted (archive it).
- **Incomplete legacy members** (Needs party / Needs project role) may be normal unit members, but cannot be Lead, Responsible or Backup until their membership is completed.

**As built.** Migration `20261012100000_structure_responsibilities.sql`:
- Tables `project_structure_unit_members` (`unit_role` member / lead) and `project_structure_report_responsibilities` (`report_kind` weekly / monthly, `responsibility` responsible / backup, held through the person's member row of the same unit). Same-project integrity by composite foreign keys; one-active rules by partial unique indexes; the Backup rule by a constraint trigger checked at commit.
- Guards: new triggers on the two tables, on `project_structure_nodes` and on `project_members` (no existing guard edited), each refusing with a tagged domain message.
- Writes go **only** through `save_structure_unit_responsibilities()`: one unit's complete desired people per call; a hardened SECURITY DEFINER function (empty `search_path`, EXECUTE for authenticated only) with explicit authority (System Admin / Project Control Admin, or Project Control / Planning assigned to the project), archived refusal, the setup lock and the project-version compare-and-swap. It applies only the differences and ends rows in dependency order. Authenticated callers hold SELECT only.
- No authorization helper and no other table's policy reads either table (migration post-check and source test). No backfill: both tables started empty.

### 8.10 PSM linkage to project membership (Phase 2C.3D Wave 2)

Links PSM / legacy department assignments (§8.4–§8.5) to the canonical project team (§8.8). `project_contacts` stays the authority-bearing PSM model; `project_members` stays authority-free.

- **New or edited assignments need an active member.** A new or edited department assignment (Department Manager, Team Member Lead or Team Member, with any department / system / Program & Study scope) must name a person with an **active membership of the same project** and an active Person record. Party and Project Role are not required for this: a legacy-incomplete member qualifies, and their Needs party / Needs project role state is shown.
- **Legacy tolerance.** Existing rows are not rewritten or invalidated. An unchanged row stays readable and re-saves as it is; changing it (person, role, scope, title or Reports To) requires the membership. No membership is fabricated and no backfill was made: the read-only preflight found every scoped row's person already an active member.
- **Ending a membership is refused, never cascaded,** while the person still holds a fixed project responsibility or a project position (any project family), or any department assignment on that project. Nothing is removed or reassigned on their behalf.
- **Unchanged:** the PSM hierarchy (Departments → Systems → Programs & Studies), the §8.5 rules, Weekly / Monthly department authority, Department Manager approve / return, fixed-role authority and `replace_project_responsibility()`, whose department branch now also needs the replacement to be an active member.
- **Data quality (unresolved).** Six legacy rows on the MDP demo projects carry `role = project_manager` together with a department and `assignment_role = department_manager`. They are left untouched and grant no Department Manager authority, because every authority predicate requires `role = team_member`. They remain a known data-quality issue.

**As built.** Migration `20261012150000_psm_membership_linkage.sql` adds two guard triggers. It changes no table, column, policy, authority predicate or existing function, and writes no row.
- `guard_psm_assignment_membership` (BEFORE INSERT OR UPDATE on `project_contacts`) refuses with `[PSM_MEMBER_REQUIRED]` or `[PSM_PERSON_INACTIVE]`. An UPDATE that changes no assignment field is not checked. It applies to every write path: the Contacts step (`save_project_setup_relation`), Project Information (`save_project_setup_patch`), Replace Person and direct writes.
- `guard_project_member_psm_responsibilities` (BEFORE UPDATE on `project_members`) refuses ending with `[MEMBER_HAS_PROJECT_RESPONSIBILITY]` or `[MEMBER_HAS_PSM_ASSIGNMENTS]`. On an archived project it defers to the existing write guard.
- Both are hardened SECURITY DEFINER functions (empty `search_path`, EXECUTE revoked from clients). A post-check re-proves that no authorization helper or other table's policy reads `project_members`, and that Department Manager authority still requires `role = team_member`.

### 8.11 Authority-bearing assignments and archived setup (Phase 2C.3E)

The permission rules are in `05_PERMISSION_MODEL.md` §3.7. In the data:

- **Authority-bearing rows.** Project Setup authority is read only from:
  - `profiles.role` (System Administrator / Project Control Admin);
  - the unscoped `project_contacts` rows with `role` `project_control_manager` or `reporting_coordinator`;
  - PSM `team_member` department assignments.

  The first two must equal `projects.project_control_manager_id` / `reporting_coordinator_id` when a transaction commits.
- **Descriptive rows** are read by no authorization helper or policy: `project_members`, `project_parties`, `project_positions`, `project_delegations`, `project_structure_unit_members`, `project_structure_report_responsibilities`, and the Reports To, functional title and Project Role columns.
- **Archived projects** (`status = archived`) keep every setup row and its history. No row of theirs can be inserted, changed or deleted, and the project row itself cannot change.

**As built.** Migration `20261012180000_setup_authority_and_archived_read_only.sql` adds guard triggers only. It changes no table, column, policy, authority predicate or existing function, and writes no row.
- `block_archived_project_setup` (BEFORE, row level):
  - on `projects` (UPDATE) and on the seven setup tables (`project_departments`, `project_disciplines`, `project_contacts`, `project_delegations`, `project_positions`, `project_sites`, `project_parties`; INSERT / UPDATE / DELETE);
  - refuses with `[PROJECT_ARCHIVED] This project is archived; its setup is read-only.`;
  - covers every path: the setup save RPCs, `replace_project_responsibility()`, `correct_project_structure_family()`, master-data cascades and direct writes;
  - the team, Other structure and structure responsibilities already refused on their own and are unchanged;
  - archiving an active project is allowed, and deleting a whole project still cascades.
- `guard_project_authority_rows` (constraint trigger, DEFERRABLE INITIALLY DEFERRED):
  - on `project_contacts` (INSERT / UPDATE) and on `projects` (UPDATE of the two holder columns);
  - refuses with `[AUTHORITY_HOLDER_MISMATCH]` any transaction that ends with an unscoped Project Control / Reporting Coordinator row naming anyone but the current holder.
- Follow-up migration `20261013090000_responsibility_holder_membership.sql`:
  - `guard_fixed_holder_replacement` (BEFORE UPDATE of the five fixed holder columns on `projects`) and `guard_position_holder_replacement` (BEFORE UPDATE OF `contact_id` on `project_positions`);
  - when a HELD responsibility moves to another person, the new holder must have an ACTIVE membership of the same project, or the write is refused with `[HOLDER_MEMBER_REQUIRED]`;
  - covers Replace Person, the setup saves and direct writes;
  - filling a vacant one, clearing one and a new project's first holders are unchanged;
  - `replace_project_responsibility()` itself is not redefined.
- Final alignment, migration `20261013120000_member_eligibility_for_responsibilities.sql`: an ACTIVE membership of the same project is **sufficient** eligibility; no pre-existing `project_contacts` row is required.
  - `replace_project_responsibility()`: only its two eligibility pre-checks (fixed responsibility, project position) change, from "has a project row" to "is an active member" (`[NOT_PROJECT_MEMBER]`). History, authority, compare-and-swap and every other check are unchanged.
  - `guard_fixed_project_responsibility_membership()`: a holder needs a project row (unchanged; a new project names its first holders this way) OR an active membership.
  - `guard_project_position_membership()`: a new position holder needs an active membership (was: a project row). An unchanged row is not re-checked.
  - Each check locks the membership row, so a membership cannot end underneath a new holder.
- All guard functions are hardened SECURITY DEFINER functions (empty `search_path`, EXECUTE revoked from clients). A post-check re-proves that the authority sources are unchanged and that no helper or policy reads descriptive data.
- **Consequences.**
  - A hard delete of a contact, department, system, discipline, portfolio group, phase or account still referenced by an archived project is refused, because its `set null` cascade would rewrite archived history. Archive or deactivate the record instead.
  - Moving a discipline that an archived project uses is refused the same way.
  - The one stale Reporting Coordinator row on the archived ZZ-P0TEST-PRJ fixture is left as it is.

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

**As built (2C.3F reconciliation).** The positions model above is the Phase 2A **position chart**. It is kept unchanged as the "Position Chart" tab of the project's Organization Chart page. The page opens on the **People Organization Chart**, which is derived from Project Team membership and its Reports To (§8.8) and stores nothing of its own. The two hierarchies are independent; who reports to whom is the People chart's. Whether the position chart is retired or reconciled is not decided.

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

### 10.9 Reconciliation with Master Planning & Control (2026-10-14)

`02_PLATFORM_ARCHITECTURE.md` §26 makes the **planning hierarchy** (§10A) the
only source of project progress and of milestone schedule data. This group is
amended accordingly:

| Was | Now |
|---|---|
| §10.2 — a Lifecycle Stage carries a **Weight** that contributes to overall project progress | Lifecycle Stages carry **no progress weight**. Physical progress comes only from the weighted planning hierarchy (§10A, `02` §26.4) |
| §10.5 — a Milestone is owned by the Project Lifecycle | A milestone is a **true milestone activity** in the planning hierarchy (§10A.3), governed where needed by a **Governed Milestone** (§10A.8). The lifecycle owns no milestone |
| §10.7 — Dashboards read "weighted project progress" and milestones from the lifecycle | Dashboards, Calendar, Weekly, Monthly and Executive read progress and milestones from the Published Planning Snapshot (`02` §26.13) |

The Project Lifecycle is **not built**. If it is built later, it is a
presentation of stages as spans that may reference planning nodes; it holds no
weight, no milestone identity and no progress of its own.

---

## 10A. Group R — Master Planning & Control

The logical entities behind `02_PLATFORM_ARCHITECTURE.md` §26 (approved
2026-10-14). Rules, formulas and the worked example live there; this group
defines the entities. **Specification.** Parts already exist from Phase 13 —
§10A.9 maps every entity to what is built and states what must change.

```text
Project ── Planning Configuration
   │
   ├── Planning Node ──< Planning Node …            (configurable depth, local weights)
   │        └──< Activity  (task | true milestone)  ──0..1── Governed Milestone (register)
   │                 └──< Activity Relationship (later)
   ├── Planning Baseline (BL0, BL1 …) ── captured plan · baseline curve
   ├── Schedule Version (import batch, one per import) ──< Import Row (raw) ──> Planning Decision (log)
   ├── Planned Manpower entry ── Resource Category (global) · Project Party
   └── Published Planning Snapshot
            ├──< Snapshot Node · Snapshot Activity · Snapshot Milestone
            ├──< Curve Point · Snapshot Planned Manpower
            └── pinned by Weekly / Monthly Reports

Weekly Report ──< Actual Manpower entry          (official on Weekly approval)
```

### 10A.1 Planning Configuration

- **Owner:** Project (one per project)
- **Attributes:** Onboarding mode (new project · existing active project · no formal schedule) · schedule source (EPRP entry · P6 Excel export · EPRP Excel template; native XER later) · planning level labels (levels 1–8) and Control Account level · weight source (EPRP · imported) · default earning method · manpower planning enabled and measures (headcount · man-hours · both) · look-ahead weeks (default 2) · reporting-unit source (PSM hierarchy or Other structure units) · planning enabled
- **Working days** come from the project's reporting configuration (working week); a holiday calendar is a later extension.
- **Lifecycle:** edited by Project Control; read-only when the project is archived.
- **Guided and Advanced setup (2026-10-14, `02` §26.20).** Both edit **this one entity**: Guided Setup turns plain business questions into these attributes; Advanced mode edits them directly. Guided answers are not stored separately. **No attribute here is a calculated value** — PV, EV, SPI, effective contribution and S-curves are never part of the configuration.
- **Planning Setup Template** (optional): an organization-level, admin-managed set of recommended defaults for a project type or category — like the Report Templates of §16. It is **copied** into this entity at setup, never linked; every copied value stays editable; it never branches behaviour.

### 10A.2 Planning Node

- **Owner:** Project
- **Identity:** Stable identifier. Code unique within the project. External WBS code, when imported, unique within the project and the only import match key.
- **Attributes:** Code · name · description · parent node · level · classification (Study, Engineering, Inspection, Procurement, Construction, … — *not* a level and never "milestone") · **local weight** · Control Account flag · reporting-unit mapping (PSM: Department, optionally System and Program & Study; Other: one Project Structure unit) · governed deliverable link · source (import or EPRP) · display order · archived
- **Derived, never stored as authoritative:** effective weight, PV, EV, SV, SPI, roll-up dates
- **Rules:** `02` §26.3 H1–H10 and §26.4 W1–W4. A node with published history is archived, never deleted.

### 10A.3 Activity

- **Owner:** Project, under exactly one Planning Node
- **Identity:** Stable identifier. External Activity ID, when imported, unique within the project and the only import match key.
- **Attributes:** Code · external ID · name · **kind** (task · true milestone) · **earning method** (Percent Complete · 0/100 · 50/50 · Milestone) · local weight · forecast start/finish · actual start/finish · original and remaining duration · confirmed % complete · responsible project member (optional; grants nothing) · reporting-unit override · source · origin import row · archived
- **Rules:** a true milestone has zero duration, uses the Milestone method, carries 0% weight by default (`02` §26.4 W5) and is always a leaf. Completeness rules C1–C2. Baseline dates live in the Planning Baseline (§10A.5), never edited on the activity.

### 10A.4 Activity Relationship *(later)*

- **Owner:** Activity (successor)
- **Attributes:** Predecessor · successor · type (FS, SS, FF, SF) · lag
- **Rule:** stored when the schedule provides it, for display and look-ahead context. EPRP does not schedule.

### 10A.5 Planning Baseline

- **Owner:** Project
- **Identity:** Project + baseline number (BL0, BL1, …)
- **Attributes:** Number · kind (original · re-baseline) · status (draft → requested → approved, or rejected) · reason · prepared by / at · approved by / at · the captured dates, local weights and planned manpower of every node and activity · its baseline curve
- **Rules:** BL0 is immutable for ever. Approval by Project Control Admin or System Administrator only (`05` §3.8). An approved baseline never changes. The **current approved baseline (BLn)** is the latest approved one and is derived, never flagged. Each approved baseline is a **Baseline Revision** (BL0, BL1, BL2, …). A Re-baseline may be *prepared from* a Schedule Version, but **no import creates or changes a baseline** (`02` §26.22.1).

### 10A.6 Schedule Version (import batch), Import Row and Planning Decision

- **Schedule Version** *(2026-10-14, `02` §26.22; the import batch)* — Owner: Project. Identity: project + EPRP version number (sequential). Every import creates one; **none is ever overwritten**. Attributes: Schedule Version reference (the source's own label, e.g. "Rev 01", "Update 05") · source format (EPRP Excel template · P6 Excel export; native XER from 13.21) · original file and raw rows · import time · imported by · **Data Date** · status (uploaded → validated → under review → accepted, or rejected with a reason) · decided by / at · **previous accepted Schedule Version** · **baseline in force** (BL0 / BLn) at review and at acceptance · change count per diff category · **kind** (operational · Historical Correction) and, for a correction, its mandatory reason and the historical version or period corrected. **A Schedule Version never changes BL0 or BLn.** At most one per project is under review at a time (owner-approved policy).
  - **Operational** versions must be dated on or after the latest accepted operational version.
  - A **back-dated** version is accepted only as a **Historical Correction** (decision B10, closed 2026-10-14). It never becomes the current operational version, never alters a Published Planning Snapshot or an approved report, and reaches the Working Plan only through a new current-dated operational version. Report reissue goes through Report Revision (`02` §26.22.2).
- **Import Row** — Owner: Import Batch. Every parsed row exactly as received. **Insert-only, never edited, never deleted.**
- **Planning Decision** — Owner: the Working Plan item it concerns. **Append-only.** Attributes: target (node, activity, weight, milestone link) · action (accept · reject · adjust · normalise · re-match · remove · restore) · field · previous value · new value · reason · actor · time · Schedule Version and row when import-sourced.
- **Rules:** `02` §26.10 and §26.22. Nothing changes the Working Plan without a Planning Decision or a direct Project Control edit that is itself logged.
  - The diff is always against the **latest accepted** Schedule Version.
  - Matching uses external Activity ID and WBS code only; a changed ID is removed + added unless explicitly re-matched.
  - An item absent from an accepted version becomes **Removed from current schedule** (archived, never deleted). A protected item — linked to a governed milestone, a governed deliverable, or, when Tasks exist, an open task — cannot be removed without explicit resolution.

### 10A.7 Published Planning Snapshot

- **Owner:** Project
- **Identity:** Project + version. Several versions may share a Data Date; the highest is in force.
- **Attributes:** Version · **Data Date** (required) · BL0 and BLn references · source (**Schedule Version**, Opening Position, manual) and the logged Project Control edits applied after that Schedule Version · published by / at · **engine version** · coverage · legacy flag (published before 13.12). Together these answer "where did these numbers come from?" (`02` §26.22.7); a later Schedule Version never rewrites a snapshot.
- **Frozen contents, each owned by the snapshot and immutable:**

| Entity | Holds |
|---|---|
| **Snapshot Node** | Per node: local and effective weight, PV%, EV%, SV, SPI, schedule condition, reporting-unit mapping |
| **Snapshot Activity** | Per activity: BL0, BLn, forecast and actual dates; earning method; local and effective weight; PV% and EV% at the Data Date; kind; external ID; mapping |
| **Snapshot Milestone** | Every true milestone and governed milestone: code, name, type, criticality, key flag, BL0/BLn/forecast/actual dates, slip against BLn and BL0, schedule condition |
| **Curve Point** | Curve kind (baseline · current/forecast · earned), scope (project or node), week date, cumulative PV% or EV% |
| **Snapshot Planned Manpower** | Week × resource category × party (× node): planned headcount and man-hours |

- **Lifecycle:** written once by the governed publish act; **never updated, never deleted.** Opening Position snapshots (existing projects onboarded mid-execution) remain as built.

### 10A.8 Governed Milestone and manpower

| Entity | Owner | Definition |
|---|---|---|
| **Governed Milestone** | Project | The Master Milestone register entry (13.2–13.2d): code, name, description, type (technical · contractual · commercial), category, **criticality**, **key-milestone flag**, responsible project member, client approval required, payment terms, deliverables. Linked **one-to-one** to a true milestone Activity when the project has a planning hierarchy. Its update stream holds payment facts, client decisions and — for unlinked milestones only — schedule state (`02` §26.6 rule 5, pending B1). Physical weight and planned-progress % are deprecated (physical progress belongs to the planning tree) |
| **Resource Category** | Organization (global master, §5) | Name · code · kind (discipline · craft · engineering team) · description · active |
| **Planned Manpower entry** | Project (Working Plan) | Week · resource category · party (Project Party) · optional node or activity · planned headcount · planned man-hours · source |
| **Actual Manpower entry** | Weekly Report | Week · resource category · party · reporting unit · actual headcount · actual man-hours · recorded by (decision B5). **Official when the Weekly is approved; immutable thereafter** |
| **Portfolio weight** | Project (attribute) | Assigned project weight for portfolio aggregation, set by Project Control Admin, with its reason (`02` §26.15) |

### 10A.9 As-built mapping — keep, harden, deprecate, add

| Logical entity | As built (Phase 13 planning foundation, 13.2–13.4) | Required change |
|---|---|---|
| Planning Configuration | `project_planning_settings` (onboarding mode, default source) | **Harden:** level labels and Control Account level, weight source, default earning method, manpower settings, look-ahead weeks, reporting-unit source; Guided and Advanced setup over it (§10A.1) |
| Planning Node | `planning_work_items` (parent, level, classification, weight, scope columns, deliverable link) | **Harden:** weight becomes *local*, sum validation, Control Account flag, Other-project unit mapping, external WBS key. **Deprecate** its milestone flag and the "milestone" classification |
| Activity | `planning_activities` (external ID, dates, %, weight, PV/EV values, milestone flag) | **Harden:** kind, earning method, attachment to a node required, local weight. Imported activities are currently written with no node |
| Planning Baseline | `planning_baselines` (named captures of work items) | **Harden:** BL0/BLn, request/approve, activities and manpower captured, baseline curve |
| Schedule Version / Import Row | `planning_import_batches` (status uploaded · validated · rejected · published; Data Date; uploaded / validated by) / `planning_import_rows` | **Keep** (raw, insert-only). **Harden into Schedule Versions** (13.16): version number and reference, under-review and accepted states (acceptance separate from publishing), previous accepted version, baseline in force, change counts; batch diff against the latest accepted version; WBS mapping; re-match and restoration |
| Planning Decision | `planning_confirmations` | **Keep / extend** actions (reject, normalise, re-match, remove) |
| Published Planning Snapshot | `planning_snapshots` (+ Data Date) · `planning_snapshot_activities` · `publish_planning_snapshot()` | **Harden:** engine version, BL references, run the engine at publish and freeze results. **Add:** Snapshot Node, Snapshot Milestone, Curve Point, Snapshot Planned Manpower |
| Opening Position | `planning_opening_positions` | **Keep** |
| Milestone link | `planning_milestone_links` (work item or activity) | **Harden:** one-to-one, activity targets only (true milestones), link UI |
| Governed Milestone | `master_milestones` · `milestone_updates` · `weekly_milestone_drafts` | **Keep** identity, governance, reconciliation, payments, Weekly observations. **Add:** key flag. **Deprecate:** physical weight, planned-progress %, register-based physical progress |
| Resource Category · Planned / Actual Manpower · Activity Relationship | — | **Add** (relationships later) |
| Portfolio weight | `portfolio_groups` exists (grouping only, not weighting) | **Add** the project weight attribute |

**Deprecated as authoritative inputs** (data kept readable as history; not
dropped): the project record's planned / actual progress and forecast finish;
typed Weekly and Monthly planned / actual progress and stored Monthly SPI for
planning-governed projects; the Weekly "man-hours to date" figure; free-text
Weekly milestone rows, next-week rows and major activities that duplicate
planning facts on planning-governed projects; Monthly plan items read as
milestones; a stored calendar event of type "milestone".

### 10A.10 Rules

1. **One performance source.** Every progress, PV, EV, SV and SPI figure outside the Planning workspace resolves to a Published Planning Snapshot (`02` §26.2).
2. **Local weights are entered; effective weights are derived.**
3. **Raw imports, Planning Decisions, approved baselines and snapshots are immutable.**
4. **Matching is by stable external identifier, never by name** (rule 2 of §3 applies with full force to imports).
5. **Archived projects are read-only** for every entity in this group.
6. **Manpower never enters SPI.**

### 10A.11 Future note — Project Setup Governance (13.9B) *(logical intent only; not specified)*

> **FUTURE — not a schema.** Approved on 2026-10-15 (`02` §26.23.6–§26.23.7,
> §26.14; closed decisions B11, B12, B14). The entities are specified here only
> when roadmap slice **13.9B** is specified. No physical table, column or
> constraint is defined yet. Three append-only records are intended:
> - a **Project Setup Amendment** (`project_setup_amendments`):
>   - field, previous / new value, reason, class, impact warning;
>   - requester and time, status, approver and decision;
>   - the approver is never the requester.
> - a **Setup Finalisation** record for no-formal-schedule projects: project,
>   actor, time. It never implies a Planning Snapshot.
> - a **Reported Progress** entry for no-formal-schedule projects:
>   - project and Data Date / as-of date;
>   - reported planned progress (where applicable) and reported actual
>     progress;
>   - narrative, actor, timestamp and source / provenance.
>
> This entry becomes the canonical progress source for those projects only.
> The project record's progress fields and Weekly / Monthly are not.
>
> **Project Priority** and the legacy Lifecycle Status values `planning` /
> `delayed` remain stored and readable. Nothing is deleted or migrated by this
> decision.

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

Weekly is the operational source of truth for **reporting entry**. **It is the only tier that accepts original operational entry.**

**Planning and performance facts are not owned by the Weekly** *(2026-10-14, `02_PLATFORM_ARCHITECTURE.md` §26)*. PV, EV, SPI, governed progress, schedule dates and milestone schedule state belong to the **Published Planning Snapshot** (§10A.7), the canonical source. A Weekly pins it and may explain, confirm and enrich those facts (§12.4 rule 5), but never owns their values.

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
5. **Planning facts (2026-10-14, `02` §26.11).** A Weekly Report **pins** a Published Planning Snapshot (§10A.7), re-pinnable until approval and frozen at approval. For a planning-governed project, overall progress (planned and actual), activities in the period, milestones and look-ahead are **derived from the pinned snapshot**, not entered; contributors attach confirmations and explanations to them through the existing Risk, Issue, Action and Comment entities, which gain optional references to the activity, node or milestone they explain. **Actual Manpower entries** (§10A.8) are Weekly content. The §12.1 "overall progress" attribute and the §12.3 Activity and Look-Ahead entities remain the entry path only for projects that are **not planning-governed** (`02` §26.14).
6. **Sections are reporting units** (`02` §26.12): a Department Submission on PSM projects; the equivalent unit submission on Other Projects is keyed to a Project Structure unit.

### 12.5 Collaborative section comments (2026-10-14)

Logical note for `02_PLATFORM_ARCHITECTURE.md` §26.21. A **section comment** is
an ordinary **Comment** (§11.4) attached to a reporting section of a Weekly
Report.

- **Owner:** the Weekly Report section it is written in (Department Submission on PSM; unit submission on Other Projects)
- **Attributes:** Comment type (General Comment · Progress Explanation · Constraint · Recovery Action · Technical Note · Client / Department Input — managed configuration) · text · author · timestamp · project · report and period · reporting section / unit · optional planning reference (activity · node · milestone) · reviewed by / at · include in Monthly
- **Section summary:** the reviewing user's summary of their section's comments, owned by the same section submission.
- **Rules:**
  1. **A comment is never a planning fact.** It never changes PV, EV, SPI, milestone schedule state, manpower planning facts or a Published Planning Snapshot.
  2. History, soft delete and attribution follow `05_PERMISSION_MODEL.md` §4. A comment is immutable once its report is approved.
  3. A planning reference is a pointer, never a copy, and it must stay within the comment's project.
  4. A comment that must be tracked to closure may be promoted to a Comment Register entry (§11.4), or linked to the tracked Issue or Action (§12.3).

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
5. **Month-end planning (2026-10-14, `02` §26.11).** A Monthly Report pins the month-end Published Planning Snapshot and freezes the pin at approval. Its progress, S-curve, SPI, schedule condition, **milestone movement** (month-start vs month-end snapshot) and next-month look-ahead come from snapshots, never from the live register or from typed figures; its actual manpower comes from the month's approved Weeklies. The "KPI Trend Point" for schedule performance cites snapshots rather than re-aggregating Weekly figures.
6. **Comments (2026-10-14, `02` §26.21).** Approved Weekly section comments and narrative are carried forward **by reference** as Compiled Items where relevant — never retyped, never edited here. The Monthly adds its own **Monthly Comments** and section summaries, scoped to the same PSM section or Other-project unit, under the rules of §12.5.

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
6. **Progress and SPI are never averaged (2026-10-14, `02` §26.15).** A Portfolio KPI Value for progress or SPI is weighted by one portfolio weight basis (budgeted man-hours, otherwise the assigned project weight), and is published only when every in-scope project is eligible; otherwise the Portfolio Summary carries the SPI-band distribution and the excluded projects instead.

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

**Planning sources (2026-10-14, `02` §26.13).** "Project progress planned vs actual", "lifecycle stage progress", upcoming milestones and the activity schedule read the **Published Planning Snapshot** (§10A.7), never typed report figures or report plan items. A snapshot figure resolves to its snapshot (project, version, Data Date) as a report figure resolves to its report.

The **Portfolio Dashboard's** current performance panels (progress, SPI, schedule
condition) read each project's **latest** Published Planning Snapshot and
aggregate them under `02` §26.15. The **Portfolio Summary** (§15) remains the
approved, period-closed compilation from approved Monthly Reports, and is what
the Executive Summary and Chairman Report read. The two differ only in *as of
when*: the latest published position vs the last approved month. Each states
its basis.

---

## 18. Group N — Calendar, meetings and activities

### 18.1 Calendar is derived

The Calendar **owns nothing**. It is a view over dated obligations owned elsewhere. Duplicating dates into calendar records would produce two disagreeing answers to when something is due.

| Source | Contributes |
|---|---|
| Published Planning Snapshot (§10A.7) — *amended 2026-10-14* | True milestones and linked governed milestones (actual if achieved, else forecast; BLn in detail) · planning activities' forecast start and finish · look-ahead work as its own entry type |
| Governed Milestone register (§10A.8) | Unlinked governed milestones only |
| Project Lifecycle | Stage start and due dates, if the lifecycle is ever built (§10.9). It owns no milestone |
| Reporting cycle | Cycle open, submission cut-off, review, approval, publication dates |
| Meetings | Scheduled date and time |
| Approvals | Pending approval due dates |
| Delegations | Start and end dates |
| Activities (§18.3 — projects not planning-governed only) | Planned start and finish |

**Never a calendar source:** Weekly or Monthly plan items read as milestones (`02` §26.2 F5).

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
- **Two activity concepts, kept apart (2026-10-14).** On a **planning-governed** project the scheduled, weighted, earning activity is the **Planning Activity** (§10A.3), and the Weekly reports it as a planning fact. This reported Activity remains for projects that are **not planning-governed**, and its progress percent never contributes to project progress on a planning-governed project.

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

### 21.5 Project Type correction history (Phase 2C.1)

An entity-specific audit record with the §21.1 properties.

- **Owner:** Platform — it survives later changes to the categories it names
- **Attributes:** Project · old and new Project Type · old and new Project Category, **with each category's name captured at the time** · old and new project-specific category name · **reason (required)** · acting account and its display name · timestamp · the transaction it was written in
- **Rules:** written **only** in the same transaction as the correction it records, so a correction cannot happen unrecorded and a record cannot exist without its correction · append-only, immutable to everyone including a System Administrator · readable by the project's setup managers (`05_PERMISSION_MODEL.md` §3.6)

---

## 22. Relationship map

```text
GLOBAL MASTER DATA (seven kinds + Resource Category from 2026-10-14)
  Client · Project Type · Job Title · KPI Definition ·
  Risk Matrix · Criticality Matrix · Lifecycle Template · Knowledge Base ·
  Resource Category
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
          ├── MASTER PLANNING & CONTROL (§10A) ── Planning Node ──< Activity ──0..1── Governed Milestone
          │        ├── Planning Baseline (BL0, BL1 …) · Schedule Version ──< Import Row · Planning Decision
          │        └── PUBLISHED PLANNING SNAPSHOT ──► pinned by Weekly / Monthly; read by every consumer
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
| ~~Cross-project person identity resolves only through Accounts~~ **Superseded in 2C.3C** | People are one global master (§8.1–§8.2); a person on several projects is one record with several project memberships (§8.8), whether or not they have an account |
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
| **Project classification** (Phase 2C.1) | Migration `20261001000001_project_setup_classification.sql`. `projects.structure_family` (`psm` · `other` · NULL for legacy), `projects.project_category_detail`, `project_types.allows_custom_name`. Trigger `enforce_project_classification` locks the family once set and validates the category. Table `project_classification_corrections` holds the history (§21.5). RPC `correct_project_structure_family()` is the System Administrator correction. Function `is_psm_family_project_type()` applies the PSM/PSAIM category rule. **Applied to the local development database only (runtime rehearsal `108_runtime_2c1_classification.sql`: 33 PASS / 0 FAIL). NOT applied to production.** | §6.1 classification; §21.5. Other-project structure (Phase 2C.1c) is modelled in `20261003000001_project_structure_foundation.sql` (`project_structure_levels`, `project_structure_nodes`), applied to the local development database (checked read-only, 2026-10-07) |
| **Project Parties** (Phases 2C.3A, 2C.3B) | Table `project_parties`. 2C.3A (`20261006123219_project_parties_foundation.sql`): EPROM, Owner and subcontractor company names. **Applied to the local development database and browser-UAT verified; not deployed remotely or to production.** 2C.3B (`20261007120000_project_parties_professional_information.sql`): subcontractor Short Name, Scope / Package, Contract Reference and Engagement Status. **Applied to the local development database and browser-UAT verified for PSM and Other Project; not deployed remotely or to production.** | §6.4 |
| **Project Team Membership** (Phase 2C.3C) | Table `project_members` (`20261007150000_project_team_membership.sql`) with backfill of the approved Preflight V2 dataset (46 memberships). Finalized by `20261011090000_project_team_controlled_writes.sql` (the three RPCs are the only write path). **Complete locally:** both migrations applied to the local development database; automated verification complete; browser UAT done on the Other Project path; a true PSM browser smoke test is pending, with PSM / shared behaviour covered by automated tests. **Not deployed remotely or to production.** See `15_DEVELOPMENT_ROADMAP.md` 2C.3C. | §8.8 |
| **Structure Responsibilities** (Phase 2C.3D Wave 1) | Tables `project_structure_unit_members` and `project_structure_report_responsibilities`, written only by `save_structure_unit_responsibilities()` (`20261012100000_structure_responsibilities.sql`). **Complete locally: applied to the local development database; automated verification complete; browser UAT done on ZZ-STRUCT-UI-01.** Not deployed remotely or to production | §8.9 |
| **Authority-bearing assignments and archived setup** (Phase 2C.3E) | Archived-setup guard and commit-time Project Control / Reporting Coordinator holder guard (`20261012180000_setup_authority_and_archived_read_only.sql`); replacement-holder membership guards (`20261013090000_responsibility_holder_membership.sql`); member-sufficient eligibility (`20261013120000_member_eligibility_for_responsibilities.sql`); no schema, policy or data change. **Complete (LOCAL ONLY): applied to the local development database; automated verification and browser UAT complete; committed and pushed at `5c086f7`.** Not deployed remotely or to production | §8.11 |
| **PSM linkage to project membership** (Phase 2C.3D Wave 2) | Two guard triggers (`20261012150000_psm_membership_linkage.sql`); no schema, policy or data change. **Complete locally (LOCAL ONLY): applied to the local development database; automated verification complete; browser smoke done on MDP-PSAIM-01 (legacy / PSAIM shared PSM Contacts path); true classified PSM browser UAT pending.** Not deployed remotely or to production. The six malformed MDP rows remain an unresolved data-quality issue | §8.10 |
| Contacts | Global People master (`contacts`) — **matches the amended §8.1–§8.2** | §8.2 Person (global) + §8.8 membership |
| Assignments and delegation | Specified; **not applied** | §8.4–§8.6 |
| Organization Chart | Charts, positions and history exist | §9 |
| **Project Lifecycle** | **Does not exist** | §10 in full |
| **Master Planning & Control** (Phase 13) | Planning foundation migrations `20260913000001`, `20260914000001`, `20260915000001` (planning settings, work items, activities, raw import, confirmations, baselines, snapshots with Data Date, snapshot activities, Opening Positions, milestone links); Master Milestones `20260819000003`, `20260822000003`, `20260822000004`; Weekly milestone drafts `20260824121615`. Roll-up is **flat** (activity weights treated as project-absolute; node weights unused); imported activities are not attached to a node; planned % is copied from the import; no BL0/BLn approval, curves, manpower or batch diff. **Archived read-only guard added by 13.9** (`20261014090000_planning_control_archived_read_only.sql`, `block_archived_project_planning` on all 16 Planning / Milestone / Deliverable tables; local development database only) | §10A in full — keep / harden / deprecate / add per §10A.9; delivery order in `15_DEVELOPMENT_ROADMAP.md` 13.8–13.21 |
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
| **7** | **Master Planning & Control open items** | B1–B9 open in `02_PLATFORM_ARCHITECTURE.md` §26.19 (B10 closed 2026-10-14; B11–B14 raised and closed 2026-10-15) | Each blocks only the roadmap slice named there; none blocks 13.9A or 13.9B |

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

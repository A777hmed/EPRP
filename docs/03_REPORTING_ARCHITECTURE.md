# EPRP Enterprise Reporting Engine

## 1. Purpose and authority

This document defines the **reporting architecture** of the EPROM Progress Report platform: how operational information becomes a Weekly Report, how Weekly Reports become Monthly Reports, how Monthly Reports become the Executive Summary, and how every one of them is governed, preserved, branded, exported, and distributed.

It is the permanent source of truth for the reporting engine. Every implementation phase must conform to it.

**Scope boundaries.** This is architecture, not implementation. It contains no SQL, no migrations, no schema definitions, no data types, and no code. It defines *what must be true*; the implementing phase decides *how*.

Its place in the set:

| Document | Authority |
|---|---|
| [`01_PROJECT_VISION.md`](01_PROJECT_VISION.md) | What the platform is — product scope |
| [`02_PLATFORM_ARCHITECTURE.md`](02_PLATFORM_ARCHITECTURE.md) | Who owns what — entities and relationships |
| **This document** | **How reporting works — the engine** |

Where this document and an implementation disagree, this document governs.

> **Supersession.** This document replaces the earlier reporting architecture, now retained at [`archive/reporting-architecture-v1.md`](archive/reporting-architecture-v1.md) for reference only. **This document is authoritative** on every point where the two differ.

---

## 2. The seven laws

Every rule in this document derives from these. They are not aspirations; they are constraints.

| # | Law | Consequence |
|---|---|---|
| 1 | **Weekly is the single source of operational reporting.** | Operational data is entered once, at the Weekly tier. No higher tier accepts original entry. |
| 2 | **Monthly compiles only from approved Weekly Reports.** | Draft, returned, or unapproved weekly data never rises. |
| 3 | **Executive Summary compiles only from approved Monthly Reports.** | Leadership sees nothing that has not been approved twice. |
| 4 | **A report is never rewritten after approval.** | Correction produces a new revision. The approved version remains readable exactly as approved. |
| 5 | **Snapshots preserve historical accuracy.** | An approved report reproduces its own period forever, regardless of later changes to anything it referenced. |
| 6 | **Dashboards read approved reports; they never recompute.** | There is one set of numbers. A dashboard cannot disagree with the report it draws from. |
| 7 | **Every report carries EPROM branding and exports professionally.** | Presentation quality is a functional requirement, not a finishing task. |

**Law 6 deserves emphasis.** A dashboard that recalculates from operational data becomes a second, competing source of truth that will eventually disagree with the reports issued to leadership. The disagreement will surface at the worst possible moment. Dashboards therefore consume approved reporting output — never the underlying operational records.

---

## 3. The reporting chain

### 3.1 The engines

```text
        DEPARTMENT ENTRY
               │  submitted · reviewed · accepted per department
               ▼
   ┌───────────────────────────┐
   │  WEEKLY REPORTING ENGINE  │  ← the only tier that accepts operational entry
   └───────────────────────────┘
               │  approved Weekly Reports only
               ▼
   ┌───────────────────────────┐
   │ MONTHLY COMPILATION ENGINE│  ← consolidates; adds month-level judgement
   └───────────────────────────┘
               │  approved Monthly Reports only
               ▼
   ┌───────────────────────────┐
   │  EXECUTIVE SUMMARY ENGINE │  ← selects; adds leadership narrative
   └───────────────────────────┘
               │
               ▼
   ┌───────────────────────────┐
   │   PORTFOLIO REPORTING     │  ← reads approved output across projects
   └───────────────────────────┘
               │
               ▼
     Dashboards · Executive Package · Archive
```

### 3.2 What each engine contributes

Each tier adds something the tier below cannot provide. None repeats the work of another.

| Engine | Input | Adds | Never does |
|---|---|---|---|
| **Weekly** | Department entry | The operational record of a period | Compile from anything above it |
| **Monthly** | Approved Weeklies | Consolidation, trend, month-level assessment | Re-collect operational data |
| **Executive Summary** | Approved Monthlies | Selection, exposure, decisions required | Introduce unapproved figures |
| **Portfolio** | Approved output, all projects | Comparison across projects | Dissolve project isolation |

### 3.3 Compilation is additive

A higher tier **adds interpretation and selection**; it never contradicts the tier beneath it. Where a higher tier excludes material — the Executive Summary is deliberately selective — the exclusion is recorded, not silent.

If a Monthly figure differs from the Weeklies it compiled, that is a defect, not a judgement call.

---

## 4. Weekly Reporting Engine

The Weekly Report is the operational source of truth. Everything the platform ever reports originates here.

### 4.1 The cycle

```text
Cycle opens          → the reporting period is established for a project
   ▼
Tasks distributed    → one submission task per contributing department
   ▼
Departments enter    → progress, activities, risks, issues, plan, look-ahead
   ▼
Department approves  → the Department Lead accepts their own contribution
   ▼
Report assembled     → submissions consolidated into one Weekly Report
   ▼
Reviewed             → checked; returned for correction where necessary
   ▼
Approved             → content becomes immutable
   ▼
Finalized            → output generated and distributed
   ▼
Locked               → read-only; change requires a revision
```

### 4.2 Period definition

The reporting period is derived from the project's own reporting configuration — its reporting day and working week — not from a platform-wide assumption. Projects on different cycles coexist without interfering.

Periods are **contiguous and non-overlapping** within a project. A project holds at most one Weekly Report per period, and every period is accounted for: a period with no report is visibly missing, never silently absent.

### 4.3 What the Weekly Report carries

The Weekly Report is a workspace, not a form. It holds:

- Report identity — project, period, number, revision, status
- Progress and KPI values for the period
- Executive summary narrative for the period
- Major activities completed
- Department and work-level updates
- Risks, issues, actions, and decisions
- Next-period plan and look-ahead
- Comments and discussion attached to specific items
- Attachments evidencing the above
- Approval record and history

### 4.4 Department submission

**Platform entry is the default.** Each contributing department receives a task scoped to exactly one project, one department, and one period. A department sees its own contribution and nothing of another department's internal working.

**Structured offline exchange is the exception.** A workbook may be generated for a specific project, department, and period, containing only that department's authorized scope. Completed workbooks are validated, previewed, and confirmed before import.

**Offline exchange never silently overwrites approved data.** An import that conflicts with approved content is rejected and reported, never merged.

### 4.5 Submission states

```text
Not started → In progress → Submitted → Accepted
                    ▲            │
                    └── Returned ┘
```

A return **requires a reason**, which is retained permanently alongside the submission it concerns. Returning work is a normal step in the cycle, not an exception.

Outstanding submissions are visible throughout the cycle, so chasing is a matter of looking rather than asking.

### 4.6 Weekly is terminal for entry

No operational figure may be introduced above the Weekly tier. If information is discovered after a Weekly is approved, it enters through a **Weekly revision** — not by editing a Monthly.

This is what makes every number in the platform traceable to a department, a period, and an account.

---

## 5. Monthly Compilation Engine

### 5.1 Eligible input

A Monthly Report compiles **only approved Weekly Reports** whose period falls within the month.

Draft, collecting, under-review, returned, and archived Weeklies are not eligible. There is no override, no administrative exception, and no manual inclusion of unapproved data.

### 5.2 Coverage must be declared

A Monthly Report states which Weekly Reports it compiled and which expected periods are missing.

**A gap is reported, never averaged away.** A month covering three of four weeks is a three-week month and says so. Silently normalising across missing periods produces a confident figure that is wrong, which is worse than an honest gap.

### 5.3 What compilation produces

Drawn from approved Weeklies:

- Progress trend and planned-versus-actual position across the month
- Aggregated KPI values, per the aggregation rules in §20
- Major achievements and completed activities
- Open risks, issues, and actions, with their movement during the month
- Items explicitly flagged for Monthly inclusion
- Carried-forward items still open

Added at the Monthly tier — owned by the Monthly Report itself:

- Month narrative and consolidated assessment
- Month-specific commentary where weekly detail does not tell the whole story
- Next-month plan and look-ahead
- Decisions required at project level

### 5.4 The separation of compiled and added content

Compiled content and Monthly-authored content are **distinct and separately identifiable**. Compiled content is never edited at the Monthly tier — correcting it means revising the Weekly it came from.

This separation is what keeps traceability intact. Without it, a Monthly figure could diverge from its sources with no way to detect it.

---

## 6. Executive Summary Engine

### 6.1 Eligible input

The Executive Summary compiles **only approved Monthly Reports**.

### 6.2 Selection, not aggregation

The Executive Summary is the only tier whose primary operation is **selection**. It carries what leadership must act on:

- Overall position and health per project
- Material exposures — the risks that matter, not all of them
- Decisions required, with owner and due date
- Significant change since the previous period
- Items explicitly flagged for executive attention

It deliberately excludes routine operational detail. **Exclusion is recorded**: the platform can always show what was available and what was selected, so selection is a documented editorial act rather than an invisible filter.

### 6.3 Authorship

The narrative is authored by Project Control. Leadership reads.

Authored narrative is clearly distinguished from compiled figures. Narrative may interpret the figures; it may not contradict them.

### 6.4 Scope

| Report | Covers |
|---|---|
| **Project Executive Summary** | One project, in depth |
| **Portfolio Executive Summary** | All authorized projects, compared |

Both draw on the same approved data and the same export conventions.

---

## 7. Portfolio Reporting

### 7.1 What it reads

Portfolio reporting reads **approved output across projects**. It never reaches into operational records, and it never recomputes.

### 7.2 Isolation holds

Aggregation across projects does not dissolve the boundary between them (`02_PLATFORM_ARCHITECTURE.md` §5). A portfolio view assembles approved outputs side by side; it does not create a shared operational space.

A reader sees only the projects they are entitled to see. **A portfolio view is filtered by the reader's access before it is aggregated, not after** — otherwise a total would leak the existence and magnitude of projects the reader cannot open.

### 7.3 Comparability

Cross-project comparison is valid only where definitions are shared. Portfolio measures therefore use organization-level KPI, risk, and criticality definitions (§20).

Where a measure is not defined for a project type, that project is **excluded and reported as excluded** — never defaulted to zero. A zero and an absence are different facts and must never be conflated.

### 7.4 Coverage transparency

Every portfolio figure declares its basis: how many projects contributed, for which period, and which are missing or excluded. A portfolio total without its coverage is not interpretable.

---

## 8. Report Lifecycle

### 8.1 The canonical states

One lifecycle governs Weekly, Monthly, and Executive Summary Reports alike.

```text
   Draft ──► Collecting ──► Under Review ──► Approved ──► Finalized ──► Locked
                  ▲              │                                        │
                  └── Returned ──┘                                        ▼
                                                                      Archived
```

| State | Meaning | Content editable |
|---|---|---|
| **Draft** | Being prepared | Yes |
| **Collecting** | Contributions being gathered | Yes, by contributors within scope |
| **Under Review** | Being checked | No — return to edit |
| **Returned** | Sent back with a reason | Yes, by the responsible party |
| **Approved** | Content accepted | **No — immutable** |
| **Finalized** | Output generated; distribution permitted | **No** |
| **Locked** | Read-only and closed | **No** |
| **Archived** | Withdrawn from active use | **No** — remains readable |

**Collecting applies fully to Weekly.** Monthly and Executive Summary pass through it only where contributions are gathered; otherwise they move directly from Draft to Under Review.

### 8.2 Transition rules

1. Only the transitions shown are possible. There is no free movement between states.
2. Every transition is performed by a **named account** holding authority for that stage on that scope.
3. Every transition is **recorded permanently** with actor, timestamp, and — for returns — reason.
4. **Approval is the immutability boundary.** Everything before it is editable; nothing after it is.
5. Backward movement is possible only through **Returned**, and only before approval.
6. **Nothing advances silently.** Every state has an owner, and the current owner and next required action are always visible.

---

## 9. Approval Workflow

### 9.1 The approval chain

Approval is layered. Each layer approves what it is accountable for and nothing more.

```text
Department contribution   →  approved by the Department Lead
        ▼
Weekly Report             →  reviewed and approved by Project Control
        ▼
Monthly Report            →  approved by the Project Manager
        ▼
Executive Summary         →  approved by Project Control
```

Authority resolves through role, project, and department together (`02_PLATFORM_ARCHITECTURE.md` §9). A Department Lead's approval authority applies to their own department, on their own project, and nowhere else.

### 9.2 What approval means

Approval is an accountable act by a named person, not a status change. It asserts that the content is correct and fit to rise to the next tier.

Consequently:

- Approval is always attributed and permanently recorded.
- Approval **cannot be delegated implicitly**. Where authority is delegated, the delegation is explicit, time-bounded, and recorded alongside the approval it authorized (`02_PLATFORM_ARCHITECTURE.md` §9.4).
- **Approval cannot be retroactive.** A report is approved at a moment, and that moment is part of the record.
- **No role, including System Administrator, may approve on another's behalf** without an explicit delegation.

### 9.3 Return

A return carries a required reason, identifies what must change, and returns the work to the responsible party. The returned work retains its history, including the previous submission and the reason it was returned.

Returns are expected. A cycle with no returns is not evidence of quality.

---

## 10. Locking Rules

### 10.1 The three closure stages

| Stage | Effect |
|---|---|
| **Approved** | Content becomes immutable. Output may be generated. |
| **Finalized** | Output is generated and archived; distribution permitted. |
| **Locked** | The report is closed. No transition remains except Archive. |

### 10.2 Rules

1. **Locking is irreversible.** A locked report is never unlocked. Change is only ever a new revision.
2. **Locking is absolute.** No role may edit locked content by any route, administrative or otherwise.
3. **Locking does not prevent revision.** It prevents *modification*. Issuing a revision is always available to an authorized account.
4. **Locking is per report, not per chain.** A locked Weekly does not lock its Monthly, and a Monthly in draft does not unlock its Weekly sources.
5. **A locked report's outputs are locked with it.** The documents it produced are immutable artifacts of that revision.
6. **Archiving is not locking.** An archived report is withdrawn from active use and remains fully readable.

### 10.3 What locking protects

Locking is what makes a report **citable**. A figure quoted from a locked report can be relied upon indefinitely, because nothing can change it — not a correction upstream, not a master-data rename, not an administrative action.

---

## 11. Snapshot Strategy

The snapshot is the mechanism that makes Law 5 real. It resolves the tension between live compilation and permanent accuracy.

### 11.1 Reference while drafting, snapshot at approval

**While drafting**, a report holds *references* to the approved content it compiles and reflects it live. A Monthly in draft always shows the current approved Weekly position.

**At approval**, the report takes an **immutable snapshot** of everything it compiled. The snapshot becomes the approved content and never changes again.

This yields three properties simultaneously:

| Property | Delivered by |
|---|---|
| A draft always reflects current approved data | Reference while drafting |
| An approved report never changes retroactively | Snapshot at approval |
| Any figure remains traceable to its origin | References retained beside the snapshot |

Without the snapshot, revising a Weekly would silently rewrite an already-approved Monthly, and every report ever issued would become unreliable.

### 11.2 A snapshot captures content *and* context

This is the part most often got wrong. A snapshot that stores only figures will re-render incorrectly years later, because the world around it has moved.

A snapshot therefore captures:

| Captured | Why |
|---|---|
| **Compiled content** | The figures and text as approved |
| **Source references** | Which reports and periods it drew from |
| **Display labels** | Department, system, and work-level names *as they read at approval* |
| **Hierarchy terminology** | Whether this project said Disciplines, Programs & Studies, or Areas |
| **KPI definitions and targets in force** | So a measure means then what it meant then |
| **Branding state** | Logos, titles, references, language as configured at approval |
| **Approval record** | Who prepared, reviewed, and approved, and when |
| **Coverage** | What contributed, and what was missing |

**Label capture is not cosmetic.** If a department is renamed, every historical report that re-renders with the new name silently misrepresents what was reported. The snapshot must reproduce the report as it was read at the time it was approved.

### 11.3 Snapshots are never regenerated

A snapshot is written once, at approval, and never rebuilt.

**Re-exporting an approved report reproduces equivalent content every time**, regardless of how much has changed since. Regenerating from live data would defeat the entire mechanism.

### 11.4 Snapshot scope by tier

| Tier | Snapshot contains |
|---|---|
| **Weekly** | The period's own content, plus the master-data labels and branding in force |
| **Monthly** | Compiled weekly content, its own added content, source references, coverage |
| **Executive Summary** | Selected monthly content, what was excluded, narrative, source references |

---

## 12. Revision Management

### 12.1 Revisions are sequential and additive

A revision supersedes its predecessor without destroying it. Every prior revision remains readable exactly as approved, with its own snapshot, outputs, and approval record intact.

A revision carries a **required reason** stating what changed and why.

### 12.2 The current revision

Exactly one revision of a report is **current** at any time. The current revision is the operative one — the one dashboards read, the one compiled upward, the one distributed. Earlier revisions remain retrievable and clearly marked as superseded.

### 12.3 Revisions do not propagate automatically

This is a deliberate constraint, and the most important rule in this section.

When a Weekly Report is revised after a Monthly has already compiled it:

1. The approved Monthly is **not** altered. Its snapshot stands.
2. The Monthly is **flagged as having a revised source**, identifying which source changed.
3. **A person decides** whether the change is material enough to warrant a Monthly revision.
4. If a Monthly revision is issued, the same flag propagates to any Executive Summary that compiled it.

Automatic propagation would silently rewrite approved history — precisely what Law 4 forbids. Ignoring the change entirely would leave downstream reports quietly wrong. Flagging for human decision is the only defensible behaviour.

### 12.4 What a revision is not

A revision is not a draft, an edit, or an undo. It is a new, separately approved, separately numbered version of a report that has already been issued. Issuing one is a governed act, not a correction convenience.

---

## 13. Report Numbering

### 13.1 Requirements

A report number is **deterministic, human-readable, unique, and permanent**. It identifies a specific report of a specific project for a specific period at a specific revision, and it appears on every output the report produces.

### 13.2 Composition

A number is composed from stable elements:

```text
[Project reference prefix] · [Report type] · [Period] · [Revision]
```

- **Project reference prefix** — configured per project; the organization's own identification scheme
- **Report type** — Weekly, Monthly, or Executive Summary
- **Period** — the reporting period the report covers
- **Revision** — the sequential revision indicator

### 13.3 Rules

1. **Assigned at creation** and never changed thereafter.
2. **Unique within a project** by type and period. A project cannot hold two Weekly Reports for the same week.
3. **Never reused.** A number belonging to an archived or superseded report is retired permanently.
4. **The base number is stable across revisions**; only the revision indicator advances. Revision 2 of a Weekly is recognisably the same report as revision 1.
5. **Captured in the snapshot** and printed on every output, so a document found on a desk can be resolved back to its record.
6. **Numbering is configuration, not code.** The prefix scheme is administered per project.

---

## 14. Branding

### 14.1 Every output is branded

Presentation quality is a functional requirement. A report leaving EPRP must be fit to place in front of the Chairman with no rework.

### 14.2 What branding covers

| Element | Scope |
|---|---|
| EPROM identity | Organization default |
| Project logo | Per project |
| Client logo | Per project |
| Report header title | Per project |
| Report footer text | Per project |
| Reference prefix | Per project (§13) |
| Document language | Per project |
| Confidentiality label | Per project |
| QR code inclusion | Per project (§19) |
| Signature block inclusion | Per project |

### 14.3 Rules

1. **Project branding overrides organization defaults**; organization defaults apply where a project specifies nothing. There is never an unbranded output.
2. **Branding is captured in the snapshot** (§11.2). Re-exporting a three-year-old report reproduces the branding it was issued under, not today's.
3. **Branding is uniform across formats.** PDF, Word, and Excel outputs of the same report present the same identity.
4. **Branding never alters content.** It is presentation only.
5. **Every output is self-describing** — project, client, report number, period, revision, status, and approval — so a document remains interpretable once separated from the platform.

---

## 15. Attachments

### 15.1 Ownership

An attachment is owned by the entity it evidences — a submission, an activity, a risk, a report — never by a general store. Context is never separated from content (`02_PLATFORM_ARCHITECTURE.md` §15.4).

### 15.2 Attachments and approval

At approval, the **set** of attachments is frozen: the snapshot records exactly which attachments were part of the approved report. Attachments cannot be added to or removed from an approved report; doing so requires a revision.

The attached files themselves are immutable artifacts. An attachment is never edited in place.

### 15.3 Reference versus inclusion

| Mode | Behaviour |
|---|---|
| **Referenced** | Listed in the report with its identity; retrieved from the platform |
| **Included** | Embedded into the generated output |

Inclusion is deliberate and configurable per report type. Large evidence sets are referenced; a distributable package embeds only what a reader needs in hand.

### 15.4 Access

An attachment inherits the access scope of the entity that owns it. A person who cannot see a department's submission cannot see its evidence, and a report's attachment list shows only what the reader is entitled to.

---

## 16. Organization Chart attachment

### 16.1 Reports may carry the structure in force

A report may attach the project's Organization Chart as it stood during its period. This is standard for Monthly Reports and the Executive Package, and available to Weekly Reports.

### 16.2 The chart is snapshotted, not linked

The report captures the **chart version in force at approval**, not a live reference. A chart that changes next quarter does not alter a report issued this quarter.

This matters for accountability: a report read years later must show who was responsible at the time, not who holds the position today.

### 16.3 The chart carries no authority in reporting

The Organization Chart is descriptive. It never determines who may approve, submit, or read — that is settled by the permission model alone (`02_PLATFORM_ARCHITECTURE.md` §10.3).

---

## 17. Output generation — PDF, Word, Excel

### 17.1 The three formats

| Format | Purpose | Character |
|---|---|---|
| **PDF** | Distribution, review, print, archive | Presentation-quality, A4, print-ready. **The primary output.** |
| **Word** | Documents that will be extended or incorporated | Structured and editable |
| **Excel** | Data for further analysis; structured offline exchange | Structured, machine-readable |

### 17.2 Generation source

| Report state | Generated from | Marking |
|---|---|---|
| **Draft / Collecting / Under Review / Returned** | Live data | **Visibly marked DRAFT** |
| **Approved / Finalized / Locked** | The snapshot (§11) | Final, carrying number, revision, and approval |

**Draft outputs must be unmistakably marked.** An unmarked draft that leaves the platform is indistinguishable from an approved document and will eventually be quoted as one. The marking is part of the document, not a covering note.

### 17.3 Rules

1. **Approved output derives from the snapshot only.** It is never regenerated from live data.
2. **Re-export is stable.** Exporting an approved report twice produces equivalent documents.
3. **Every format carries the same identity and figures.** Format changes presentation, never content.
4. **Generation respects the reader's access.** An export contains only what its requester is entitled to see.
5. **Generation is recorded** — what was produced, by whom, when, in which format (§24).
6. **PDF is the reference format.** Where formats could differ in fidelity, the PDF is authoritative.

### 17.4 The A4 discipline

Print output is designed for the page, not merely printable. Fixed A4 layout, navigation and interactive controls removed, charts legible in monochrome and never dependent on colour alone, ranked content truncated rather than overflowing, and page identification on every page.

---

## 18. Executive Package generation

### 18.1 What it is

The Executive Package is the assembled, distributable deliverable for leadership — a single document produced for a reporting period, from approved content only.

### 18.2 Composition

```text
Cover                → identity, period, confidentiality, revision
Contents
One-page A4 summary  → the executive view (12_REPORT_GENERATION.md §7)
Portfolio position   → cross-project KPIs and health distribution
Project cards        → one per project: status, progress, top risk, decision required
Decisions required   → consolidated, with owner and due date
Trends               → planned versus actual, movement across periods
Organization Chart   → optional, as in force (§16)
Appendices           → optional supporting material
Signature block      → prepared, reviewed, approved
```

### 18.3 Rules

1. **Approved content only.** No element derives from draft or unapproved data.
2. **Assembled from snapshots**, so the package reproduces exactly what was approved.
3. **Coverage is declared** — which projects and periods contributed, and which are missing or excluded (§7.4).
4. **Numbered and revisioned** as a report in its own right (§13).
5. **Scoped to its audience.** A package is generated for a defined readership and contains only what that readership may see.
6. **Immutable once issued**, and archived with its period (§19).

---

## 19. QR Code and the Google Drive Archive

### 19.1 The QR code

Every branded output may carry a QR code that resolves to the **authoritative platform record** of that exact report and revision.

Rules:

1. **The QR encodes a reference, never data and never credentials.** It identifies a record; it does not contain one.
2. **Resolution is subject to permission.** Scanning leads to the record; access is decided by the permission model as for any other request.
3. **It resolves to the specific revision** the document was produced from, not to "the latest version" — so a printed page always leads to its own source.
4. **Inclusion is configurable per project** (§14.2).

The QR code is what makes a printed page traceable. Without it, a document separated from the platform can be quoted but not verified.

### 19.2 The Google Drive Archive

Approved and finalized outputs are published to the Drive Archive, in the correct project location, so that people who do not work in the platform daily still receive authoritative output through a familiar channel.

Rules, restating `02_PLATFORM_ARCHITECTURE.md` §16:

1. **The platform owns the record; Drive holds copies.** A Drive document is never the master.
2. **Publication is one-way.** Nothing is read back from Drive as authoritative.
3. **Only approved, immutable output is published.** Drafts are never archived — a copy of a draft outside the platform is indistinguishable from a final document.
4. **Changes in Drive have no effect on the platform record.**
5. **The platform records what it published, where, and when**, and that record is audited.
6. **The platform functions fully when Drive is unavailable.** The archive is a channel, never a dependency.

---

## 20. KPI aggregation

### 20.1 The three levels

Measurement is split across three tiers, and collapsing them is a modelling error (`02_PLATFORM_ARCHITECTURE.md` §14).

| Level | Owner | Role in reporting |
|---|---|---|
| **Definition** — what a measure is and how it is calculated | Organization, per project type | Makes measures comparable across projects |
| **Target** — the threshold this project is held to | Project | Makes performance assessable |
| **Value** — what was measured for a period | Report | A permanent historical fact |

### 20.2 Aggregation is defined, not chosen

Each KPI definition declares **how it aggregates** across periods and across departments — whether it sums, averages, takes the latest value, or weights by some factor.

**Aggregation is never chosen at compilation time.** A measure that aggregates one way this month and another way next month produces a trend line that means nothing.

### 20.3 Aggregation rules

1. **Higher tiers aggregate approved values from the tier below.** They never re-derive from operational data.
2. **Aggregation declares its basis** — how many periods and departments contributed, and which are missing.
3. **Missing input is reported, not defaulted.** Absence is not zero (§7.3).
4. **Values are historical facts** owned by their period and never retrospectively altered. A corrected value arrives through a revision.
5. **Definitions in force are captured in the snapshot** (§11.2), so a measure means then what it meant then.

### 20.4 Project Health

Project Health is **derived, never stored as authoritative** (`02_PLATFORM_ARCHITECTURE.md` §14.3). In reporting terms:

- It is calculated from approved reported data, consistently, and cannot be edited or overridden.
- It is **explainable** — the contributing factors are always recoverable.
- It **degrades honestly**: incomplete reporting yields *unknown*, never *healthy*. Absence of data must never read as absence of problems.

---

## 21. Dashboard data sources

### 21.1 Dashboards consume reports

**Dashboards read approved reporting output. They do not recompute.** This is Law 6, and it is the rule that keeps one set of numbers in the organization.

### 21.2 The three layers

| Dashboard | Reads | Draft data |
|---|---|---|
| **Dashboard Workspace** (one project, working view) | Approved reports, plus the cycle in progress | Permitted — **must be visibly labelled as in-progress** |
| **Portfolio Dashboard** (management, cross-project) | Approved reports only | Not permitted |
| **Chairman Dashboard** (leadership) | Approved reports only | Not permitted |

The Workspace is the sole exception, and a narrow one: the team running a project needs to see the cycle in progress. That data is always marked as unapproved, and never contributes to a portfolio figure.

### 21.3 Rules

1. **Every figure resolves to its source report** — project, period, revision. A number that cannot be traced does not belong on a dashboard.
2. **Dashboards never introduce a calculation that a report does not perform.** Where a new measure is needed, it is defined as a KPI (§20) and reported.
3. **Coverage is always visible.** A dashboard states the period it reflects and what is missing.
4. **Dashboards respect access before aggregating** (§7.2).
5. **A dashboard can never disagree with a report.** If it does, the dashboard is defective.

---

## 22. Notifications

### 22.1 Reporting drives notification

The reporting cycle is the platform's principal source of notification events. Every state change produces an event, and events are delivered to the accounts responsible for what happens next.

| Event | Notified |
|---|---|
| Cycle opened | Contributing departments |
| Submission due / overdue | The responsible department, then its Lead |
| Submission received | Those assembling the report |
| Work returned | The responsible party, with the reason |
| Report awaiting review or approval | The account holding that authority |
| Report approved, finalized, published | Those with an interest in its output |
| Revision issued | Holders of downstream reports compiled from it (§12.3) |
| Coverage gap detected | Those accountable for the cycle |

### 22.2 Rules

1. **Delivery is scoped by permission.** Notification is never a side channel that leaks across a project or department boundary (`02_PLATFORM_ARCHITECTURE.md` §18.2).
2. **Every notification leads to the work** it concerns.
3. **Notification is not audit.** Audit records what was done; notification records who was told. Neither substitutes for the other.
4. **Notification never advances a workflow.** It informs; a person acts.

---

## 23. Calendar integration

### 23.1 A derived view

The reporting calendar **owns nothing**. It is a derived view over dated obligations already owned by the reporting cycle and the project's configuration.

It presents: cycle open dates, submission cut-offs, review and approval deadlines, publication dates, delegation periods, and reporting milestones — across every project a person is assigned to.

### 23.2 Rules

1. **Dates are derived from each project's own reporting configuration**, never from a platform-wide calendar.
2. **The calendar never becomes a second source of dates.** Duplicating deadlines into calendar entities would immediately produce two disagreeing answers to when something is due.
3. **The calendar is scoped to the reader**, showing only obligations within their assignments.
4. **The calendar does not enforce.** A passed date changes a report's visible status; it does not transition it.

---

## 24. Audit Trail

### 24.1 Reporting is fully audited

Every consequential reporting action is recorded permanently, in the platform-owned, append-only audit trail (`02_PLATFORM_ARCHITECTURE.md` §19).

### 24.2 What reporting contributes

- Report created, and by whom
- Every state transition, with actor, timestamp, and — for returns — reason
- Every submission, acceptance, and return
- Every approval, with the account and any delegation that authorized it
- Snapshot taken at approval
- Revision issued, with its reason
- Output generated, in which format, by whom
- Publication to the archive
- Access to restricted reporting content

### 24.3 Rules

1. **Append-only and immutable.** No role, including System Administrator, may alter an audit record.
2. **Platform-owned.** Audit survives the archival or deletion of the report it describes.
3. **Attributed.** Every record names the acting account, and the delegation where one applied.
4. **Complete.** There is no unaudited path to changing a report's state.

### 24.4 Audit versus revision history

| | Audit Trail | Revision History |
|---|---|---|
| **Answers** | Who did what, and when? | What did this report say before? |
| **Owner** | Platform | The report |
| **Form** | Immutable event log | Complete prior versions with snapshots |

Both are required. Audit alone cannot reproduce a superseded report; revision history alone cannot show who returned a submission and why.

---

## 25. Conformance rules

An implementation conforms to this architecture when all of the following hold. These are the acceptance criteria for any phase touching reporting.

1. Operational data is entered only at the Weekly tier.
2. Monthly Reports compile only approved Weekly Reports; Executive Summaries compile only approved Monthly Reports.
3. Compiled content is never edited at a higher tier.
4. Coverage gaps are declared, never averaged away or defaulted to zero.
5. Approved report content cannot be modified in place by any role, through any route.
6. Approval takes an immutable snapshot capturing content, source references, display labels, terminology, KPI definitions and targets, branding, approval record, and coverage.
7. Snapshots are written once and never regenerated; re-export of an approved report is stable.
8. Revisions are sequential, carry a required reason, and preserve prior revisions in full.
9. A revision never automatically alters an approved downstream report; it flags it for human decision.
10. Locking is irreversible and absolute, and does not prevent revision.
11. Every state transition is attributed, timestamped, and recorded, with a reason for returns.
12. Approval authority resolves role, project, and department together, and is never implicitly delegated.
13. Report numbers are assigned at creation, unique within a project by type and period, never reused, and stable across revisions.
14. Every output carries project branding, report number, period, revision, and status.
15. Draft outputs are visibly and unremovably marked as drafts.
16. Approved outputs are generated from the snapshot only.
17. The attachment set is frozen at approval.
18. The Organization Chart is snapshotted at approval and grants no reporting authority.
19. KPI aggregation follows the rule declared in the definition, and declares its basis.
20. Project Health is derived, explainable, and reports *unknown* on incomplete data.
21. Dashboards read approved reporting output and never recompute; every figure resolves to its source report.
22. Portfolio views filter by reader access before aggregating.
23. QR codes encode a reference to a specific revision, never data or credentials.
24. Only approved, immutable output is published to the archive, and publication is one-way.
25. The reporting engine functions fully with every external integration unavailable.

---

## 26. Open reconciliations

Recorded so each is resolved deliberately rather than absorbed silently, per `CLAUDE.md`. **None is resolved by this document** — each is work for the phase that implements it.

| # | Current state | This architecture requires |
|---|---|---|
| 1 | ~~An earlier reporting document described the same subject~~ | **Resolved** by the documentation normalization pass. Retained at [`archive/reporting-architecture-v1.md`](archive/reporting-architecture-v1.md) for reference only; this document governs |
| 2 | ~~The document set holds duplicate prefixes~~ | **Resolved** by the documentation normalization pass. One canonical sequence, all cross-references updated |
| 3 | [`02_PLATFORM_ARCHITECTURE.md`](02_PLATFORM_ARCHITECTURE.md) §11.3 names the post-approval state *published* | The canonical state is **Finalized** (§8.1), matching `04_WORKFLOW_ENGINE.md` and the implemented lifecycle. Align that section |
| 4 | The implemented report lifecycle carries more states than the canonical set | Reconcile to the eight states of §8.1, mapping existing records explicitly |
| 5 | No snapshot mechanism exists | Reference-while-drafting, snapshot-at-approval per §11 |
| 6 | No revision mechanism exists beyond the concept | Sequential revisions with reason and retained history per §12 |
| 7 | Report numbering exists only for Weekly Reports | The composition and rules of §13, applied to all three report types |
| 8 | Monthly and Executive engines are not implemented | §5 and §6 |
| 9 | Dashboards read mock data and perform their own calculation | Dashboards consume approved reporting output per §21 |
| 10 | No output generation exists in any format | §17 and §18 |
| 11 | No archive publication, QR resolution, or attachment storage exists | §15, §19 |
| 12 | Approval, locking, and immutability are not enforced | §9, §10, and conformance rules 5–12 |

---

## 27. Document map

| Document | Defines |
|---|---|
| [`01_PROJECT_VISION.md`](01_PROJECT_VISION.md) | **What the platform is** — complete product scope |
| [`02_PLATFORM_ARCHITECTURE.md`](02_PLATFORM_ARCHITECTURE.md) | **Who owns what** — entities, ownership, relationships |
| **This document** | **How reporting works** — the reporting engine |
| [`archive/reporting-architecture-v1.md`](archive/reporting-architecture-v1.md) | *Superseded by this document* |
| [`04_WORKFLOW_ENGINE.md`](04_WORKFLOW_ENGINE.md) | Report states, submission, review, approval — detail beneath §8 and §9 |
| [`12_REPORT_GENERATION.md`](12_REPORT_GENERATION.md) | The leadership report and portfolio view — detail beneath §6 and §18 |
| [`15_DEVELOPMENT_ROADMAP.md`](15_DEVELOPMENT_ROADMAP.md) | **Current status and delivery order** |
| [`specs/weekly-report.md`](specs/weekly-report.md) | Weekly Report content — detail beneath §4 |
| [`05_PERMISSION_MODEL.md`](05_PERMISSION_MODEL.md) | Roles, responsibility, delegation — detail beneath §9 |

This document is the authority on **the reporting engine**. `01_PROJECT_VISION.md` is the authority on product scope; `02_PLATFORM_ARCHITECTURE.md` is the authority on data ownership. Where any other document or implementation implies different reporting behaviour, this document governs.

It describes the complete engine. It is the target, not a statement of what is built today; the roadmap is the authority on current status.

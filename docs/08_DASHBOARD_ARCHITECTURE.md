# EPRP Dashboard Architecture

## 1. Purpose and authority

This document is the **canonical dashboard architecture** for the EPROM Progress Report platform. It defines which dashboards exist, what each one is for, what data each may read, how widgets and filters behave, and the rules every dashboard obeys.

It is the permanent source of truth for dashboard behaviour. Every implementation phase must conform to it.

**Scope boundaries.** This is architecture, not implementation. It contains **no code, no SQL, no React, no APIs, no migrations, and no markup**.

### 1.1 Boundary with the design system

| Document | Owns |
|---|---|
| **This document** | **Which dashboards exist, what they read, the widget contract, the filter model, and the rules** |
| [`07_UI_UX_GUIDELINES.md`](07_UI_UX_GUIDELINES.md) §9 | How a dashboard **looks and is operated** — layout, states, interaction |

Where the two touch, this document governs *what* and `07` governs *how it appears*. Neither restates the other.

### 1.2 Place in the canonical sequence

| Document | Authority |
|---|---|
| [`01_PROJECT_VISION.md`](01_PROJECT_VISION.md) | What the platform is |
| [`02_PLATFORM_ARCHITECTURE.md`](02_PLATFORM_ARCHITECTURE.md) | Ownership, isolation, permission architecture |
| [`03_REPORTING_ARCHITECTURE.md`](03_REPORTING_ARCHITECTURE.md) | The reporting engine — **the source dashboards read** |
| [`06_DATABASE_SCHEMA.md`](06_DATABASE_SCHEMA.md) | The entities and what they mean |
| [`07_UI_UX_GUIDELINES.md`](07_UI_UX_GUIDELINES.md) | Presentation and interaction |
| **This document** | **Dashboard architecture** |

---

## 2. Dashboard philosophy

### 2.1 A dashboard is a workspace, not a wall of charts

A dashboard exists so that a person can **see what matters and act on it in the same place**. Charts are one means to that end, never the purpose.

| A dashboard is | A dashboard is not |
|---|---|
| Where work is discovered and started | A read-only poster of figures |
| A route into the record behind every number | A terminus |
| Answering "what needs me, and what is wrong" | Answering "what does everything look like" |
| Actionable — every panel leads somewhere | Decorative |

A panel that shows a number but offers no way to reach the work behind it has failed its purpose.

### 2.2 Every dashboard reads approved platform data

Dashboards consume **approved reporting output** and the **Portfolio Summary** (`03` §21, `06` §15). They never read operational records directly, and they never recompute.

**One narrow exception:** the Project Dashboard may show the **reporting cycle in progress** for its own project, because the team running it needs to. That content is always visibly marked as unapproved and **never contributes to a Portfolio, Company, or Chairman figure**.

### 2.3 No duplicated business logic

This is the load-bearing rule of the entire document.

**A dashboard never implements a calculation the platform already performs.** Progress, health, variance, aggregation, severity, completion — each is defined once, in the reporting engine or the entity model, and a dashboard displays the result.

The consequence of breaking this rule is not a bug that gets fixed. It is a second, competing source of truth that will eventually disagree with a report issued to the Chairman, and the disagreement will surface at the worst possible moment.

**If a dashboard needs a figure the platform does not produce, the figure is defined as a KPI (`06` §5) and reported — it is not calculated in the dashboard.**

### 2.4 Traceability

Every figure on every dashboard resolves to its source — the project, the period, the report, the revision. A number that cannot be traced does not belong on a dashboard.

### 2.5 Honesty under incomplete data

| Situation | Presentation |
|---|---|
| Data not yet reported | **Not reported** — never zero |
| Health cannot be determined | **Unknown** — never green |
| Aggregate covers part of its scope | The coverage basis is stated alongside the figure |
| A project is excluded from a measure | Stated as excluded, never defaulted |

**Absence of data is never presented as absence of problems.**

### 2.6 One definition, many altitudes

The same concept means the same thing on every dashboard. Health, progress, overdue, at-risk and completion are defined once and rendered identically everywhere. Only the **altitude** changes — how much is aggregated and how much detail is shown.

---

## 3. Dashboard hierarchy

### 3.1 The six dashboards

```text
                     ┌─────────────────────┐
                     │  CHAIRMAN DASHBOARD │  leadership decision surface
                     │   approved only     │  (not a level in the chain)
                     └──────────▲──────────┘
                                │
   COMPANY  ──────►  PORTFOLIO  ──────►  PROJECT  ──────►  DEPARTMENT
   orientation       comparison          operation         contribution
        │
        └──────────►  PERSONAL   (cuts across all levels — "what needs me")
```

### 3.2 Each has a distinct question

Three dashboards sit near the top of the platform, and they are frequently confused. Their separation is by **question asked**, not by audience.

| Dashboard | Answers | Scope | Character |
|---|---|---|---|
| **Company** | *What is happening at EPROM?* | The organization | Orientation — breadth, activity, momentum |
| **Portfolio** | *Where should attention go?* | All projects, compared | Comparison — side-by-side, filterable |
| **Project** | *How is this project running?* | One project | Operation — the working surface |
| **Department** | *What does my department owe, and how is it doing?* | One department within one project | Contribution |
| **Personal** | *What needs me?* | The individual, across everything | Task-oriented |
| **Chairman** | *What must leadership decide?* | Portfolio, approved only | Decision — sparse and consequential |

**Company and Portfolio are not the same dashboard at different sizes.** Company is where a person orients; Portfolio is where project control allocates attention. If either collapses into the other, one of them should be removed rather than duplicated (§26, Decision 1).

### 3.3 Altitude rules

1. **Higher altitude reads lower-altitude approved output** — never the reverse, and never raw operational records.
2. **Higher altitude aggregates; it never re-derives.**
3. **Every altitude drills down** to the next level and ultimately to the source record.
4. **Only the Project Dashboard may show unapproved in-progress data** (§2.2), and only for its own project.

---

## 4. Company Dashboard

**Question: what is happening at EPROM?**

The organization's landing surface — the default destination for a user with no single project focus, and the place a portfolio-level user starts their day.

### 4.1 Content

| Panel | Content | Source |
|---|---|---|
| **Overall company status** | A single orientation statement: projects active, overall portfolio health distribution, reporting compliance for the current period | Portfolio Summary |
| **Active projects** | Every active project with code, name, client, health and current period. Counted by status | Approved reports |
| **Overall KPIs** | Company-level measures across the portfolio, each with its coverage basis | Portfolio Summary |
| **Recent activities** | What has happened lately across the platform — reports submitted, approved, finalized, revisions issued | Audit trail (`06` §21) |
| **Notifications** | The reader's own unread notifications, summarized (§15) | Notification deliveries |
| **Upcoming milestones** | Milestones approaching across all projects, ordered by date | Schedule (§12) |
| **Portfolio summary** | A condensed view of the Portfolio Dashboard, with a route into it | Portfolio Summary |

### 4.2 Rules

1. **Orientation, not analysis.** Where a panel invites comparison or investigation, it links to the Portfolio Dashboard rather than reproducing it.
2. **Recent activity is attributed** — who did what, and when — and every entry links to its subject.
3. **Company KPIs are portfolio KPIs**, from the same Portfolio Summary the Portfolio and Chairman dashboards read. There is no separate company calculation.
4. It shows **all projects**, consistent with universal read (§18).

---

## 5. Portfolio Dashboard

**Question: where should attention go?**

The project-control instrument. Its purpose is to make the projects that need intervention obvious.

### 5.1 Content

| Panel | Content |
|---|---|
| **Cross-project comparison** | Every project side by side on comparable measures — progress planned versus actual, health, current period, reporting status |
| **Health indicators** | Health per project and the portfolio health distribution, including *Unknown* (§2.5) |
| **Schedule status** | Schedule position per project — ahead, on plan, behind — with variance and direction |
| **Risk overview** | Open risks across the portfolio by severity, using the global Risk Matrix so severities are comparable (`06` §5) |
| **Executive indicators** | Decisions required, overdue approvals, projects not reporting, critical exposures |
| **Filters** | The full filter set (§11) |

### 5.2 What makes comparison valid

Cross-project comparison is only meaningful through **global master data** — KPI Definitions, Risk and Criticality Matrices, and Project Types (`06` §5). These are shared precisely so that a measure means the same thing on every project.

**Departments, systems and hierarchy items are project-owned and are not comparable across projects** (`06` §23.2). The Portfolio Dashboard therefore compares projects, never departments across projects. See §26, Decision 2.

### 5.3 Rules

1. **Exceptions surface; they never average into the middle.** A single failing project must be visible in a portfolio of forty.
2. **Coverage is declared** on every aggregate — how many projects contributed, for which period, and which are missing.
3. **A project not reporting is shown as not reporting**, never as healthy or as zero.
4. Every project cell **drills through** to that project's dashboard.

---

## 6. Project Dashboard

**Question: how is this project running?**

The working surface for the team and for project control. The most detailed dashboard in the platform, and the only one permitted to show unapproved in-progress data (§2.2).

### 6.1 Content

| Panel | Content | Notes |
|---|---|---|
| **Project summary** | Code, name, client, type, manager, phase, status, dates | Identity and orientation |
| **Progress** | Planned versus actual, variance with direction, completion (§6.2) | Derived, explainable |
| **Weekly status** | Current cycle state, submissions outstanding, late departments, pending review | May show in-progress data, **marked** |
| **Monthly status** | Current Monthly state, coverage, pending approval | |
| **Executive status** | Whether this project's data has reached the current Executive Summary, and its state | |
| **Dynamic timeline** | The project's own lifecycle stages and milestones (§13) | Driven by Project Type |
| **Milestones** | Upcoming, achieved and missed, with dates and owners | |
| **Departments** | Each contributing department with obligation, lead, and reporting status | Project-owned |
| **Systems** | Systems in scope with owning department and criticality | Project-owned |
| **Programs & Studies** | The hierarchy level beneath System, **under this project's own configured label** (`07` §3.6) | Project-owned |
| **Contacts** | People on the project, with assignment role and reporting line | Project-owned |
| **Documents** | Reports issued for this project, by level and period | Report Center |
| **Attachments** | Evidence attached to this project's records | Inherits owner visibility |
| **Risks** | Open risks by severity, with movement across periods | Persistent records |
| **Activities** | Activities in the current and upcoming periods | Schedule (§12) |
| **KPIs** | This project's configured measures against its own targets | Project targets, global definitions |
| **Audit history** | Recent consequential actions on this project, attributed and timestamped | Audit trail |

### 6.2 Project completion

A single completion figure derived from **weighted lifecycle stage progress and reported work progress**.

**Rules:** never entered by hand · **always explainable** — opening it shows each contributing stage, its weight and its contribution · states its basis and coverage · reports **Unknown** rather than a confident figure when inputs are missing.

### 6.3 Rules

1. **Unapproved data is always marked** and never leaves this dashboard for a higher altitude.
2. Terminology follows the project's own Hierarchy Profile throughout.
3. Every panel drills into its own module.
4. Panels for capabilities the project does not use are **absent, not empty** — a project with no Programs & Studies configured shows no such panel.

---

## 7. Department Dashboard

**Question: what does my department owe on this project, and how is it doing?**

### 7.1 Scope

A Department Dashboard is scoped to **one department within one project**. This follows directly from departments being project-owned (`06` §6.2): "this department across all projects" is not a resolvable view, because the department records in two projects are unrelated.

### 7.2 Content

| Panel | Content |
|---|---|
| **Obligation** | What this project expects of this department — reporting required, scope covered, cadence |
| **Submission status** | Current period state and the history of previous periods, including returns and their reasons |
| **Progress** | The department's contribution to project progress |
| **Activities** | Activities owned by this department in the current and upcoming periods |
| **Risks and issues** | Raised by or assigned to this department |
| **Team** | Assigned contacts with assignment role, functional title and reporting line |
| **Outstanding items** | What is late, what is awaiting the Department Lead, what has been returned |
| **KPIs** | Measures scoped to this department |

### 7.3 Rules

1. **Scoped to one department in one project.** Any cross-project department view is out of scope until §26, Decision 2 is resolved.
2. Under universal read (§18), a member of one department may **open** another department's dashboard; they simply cannot act on it.
3. Return reasons are shown in full — they are the department's primary corrective signal.

---

## 8. Personal Dashboard

**Question: what needs me?**

Cuts across every project and altitude. It is the platform's answer to universal read visibility: when everyone can see everything, the Personal Dashboard is what tells a person which work is theirs.

### 8.1 Content

| Panel | Content |
|---|---|
| **My Projects** | Projects I am assigned to, with health and my outstanding items on each |
| **My Tasks** | Submissions, actions and commitments assigned to me, with due dates and lateness |
| **My Calendar** | My activities, meetings and deadlines for the selected month, from the Schedule Dashboard filtered to me (§12) |
| **My Notifications** | Recent unread notifications, grouped (§15) |
| **Pending approvals** | Items awaiting my decision, oldest first |
| **Assigned reports** | Reports where I am preparer, reviewer or approver, with their state |
| **Recent activity** | My own recent actions, for continuity |

### 8.2 Rules

1. **Ordered by claim on the reader's time** — overdue first, then due today, then upcoming.
2. Every item is **one click from the work**.
3. **Nothing appears here that the reader cannot act on**, except informational notifications.
4. An empty Personal Dashboard says so explicitly and positively — it is a valid, good state.

---

## 9. Chairman Dashboard

**Question: what must leadership decide?**

Executive altitude only. Approved data exclusively. Deliberately sparse — fewer figures, larger, each consequential.

### 9.1 Content

| Panel | Content |
|---|---|
| **Executive Summary** | The current approved Executive Summary narrative and position |
| **Portfolio KPIs** | From the Portfolio Summary, with coverage basis |
| **Major achievements** | Selected, with drill-down to source |
| **Major risks** | Critical exposures across the portfolio |
| **Delayed projects** | Projects behind plan, with magnitude and direction |
| **Critical decisions** | Decisions required, with requester, owner, due date and priority |
| **Important comments from all projects** | Comment Register entries flagged **Include in Chairman** across every project (`06` §11) |
| **Charts** | Trend, distribution and comparison — restrained in number |
| **Portfolio health** | Distribution across the portfolio, including *Unknown* |
| **Printable Executive Report** | Direct generation of the Chairman Report and the one-page executive output (§17) |

### 9.2 Rules

1. **Approved data only.** No route exists to show unapproved content here.
2. **Exceptions foremost.** The dashboard opens on what is wrong and what needs deciding, not on what is fine.
3. **Every figure drills down** to its project, period and report — a number in front of the Chairman must always be explainable.
4. **Read and approve only.** Authoring executive content belongs to Project Control (`05` §2).
5. **Printable at any moment** without preparation (§17).

---

## 10. Dashboard widgets

### 10.1 The widget contract

A widget is a reusable panel with a declared data source. **Every widget obeys this contract without exception:**

| Rule | Detail |
|---|---|
| **Declares its source** | Which approved entity it reads. A widget that computes its own figures independently of the reporting engine is prohibited (§2.3) |
| **States its scope and period** | What it covers and when |
| **Declares coverage** | What contributed and what is missing |
| **Resolves to source** | Every figure drills through |
| **Respects active filters** | Without exception (§11) |
| **Defines every state** | Loaded, loading, empty, error — none may render blank |
| **Never contradicts** | Two widgets reading the same source always agree |

### 10.2 The widget catalogue

| Widget | Shows | Reads |
|---|---|---|
| **KPI Card** | One measure — value, unit, target, variance with direction, trend, coverage | Approved KPI values |
| **Progress** | Planned versus actual with a numeric value beside the bar | Approved report progress |
| **Chart** | Trend, distribution or comparison, with axis labels, units, period and an accessible tabular alternative | Approved reports, Portfolio Summary |
| **Calendar** | Dated obligations in month, week, day or agenda form | Schedule (§12) |
| **Schedule** | Upcoming, overdue, due today, this week, this month | Schedule (§12) |
| **Notifications** | Recent unread deliveries for the reader | Notification deliveries |
| **Recent Activity** | Attributed, timestamped recent actions | Audit trail |
| **Deadlines** | What is due and what is late, ordered by lateness | Schedule, reporting cycle |
| **Risks** | Open risks by severity, using the global Risk Matrix | Approved reports |
| **Health** | Health state with label and icon, and its contributing factors | Derived health (`06` §14.6) |
| **Documents** | Issued reports and project documents | Report Center, Document Center |
| **Messages** | Direct messages and announcements | Messages (§15) |
| **Quick Actions** | The contextual primary actions for this dashboard | Permission-resolved |

### 10.3 Widget configuration

Widgets are arranged through **Dashboard Configuration** (`06` §17.5) — project-owned for project dashboards, organization-owned for portfolio and chairman dashboards, and account-owned for a personal arrangement.

**Rules:** configuration governs **presentation only** and never changes the underlying figures · a personal arrangement never alters the project or organization default · two projects may present entirely differently · **Quick Actions renders only actions the reader may perform**, and disabled actions state why (§18).

---

## 11. Dashboard filtering

### 11.1 The filter set

| Filter | Applies to | Behaviour |
|---|---|---|
| **Project** | Company, Portfolio, Schedule, Personal | One, several, or all |
| **Client** | Company, Portfolio | Groups projects by client |
| **Project Type** | Company, Portfolio | Groups by classification; also determines terminology |
| **Department** | Project, Department, Schedule | Scoped to selected projects |
| **System** | Project, Schedule | Scoped to selected departments |
| **Programs & Studies** | Project, Schedule | The level beneath System, **under each project's own label** |
| **Status** | All | Report status, activity status, or risk status by context |
| **Priority** | Portfolio, Project, Chairman | Severity or priority ranking |
| **Date** | All | A period or range; defaults to the current reporting period |
| **Assigned user** | Project, Department, Personal, Schedule | The person accountable |

### 11.2 Rules

1. **Filters cascade.** Choosing a project narrows the departments offered; choosing a department narrows the systems; choosing a system narrows Programs & Studies. A filter never offers a value that would return nothing.
2. **Active filters are always visible**, with a one-action clear.
3. **A filtered-empty result says filters are active** and offers to clear them — it never looks like missing data (§2.5).
4. **Filters apply to every widget on the dashboard**, or the widget states that it is unfiltered.
5. **Filter state persists per user per dashboard** across sessions.
6. **Filter state is shareable** — a filtered dashboard can be handed to a colleague and will resolve identically, subject to their own permissions.
7. **Cross-project terminology.** Where several projects with different hierarchy labels are selected, the filter presents the neutral level name and shows each project's own term against its entries.
8. **Filtering never changes a figure's definition** — only which records contribute.

---

## 12. Schedule Dashboard

The unified planning workspace: **one calendar for everything the organization has committed to a date.**

Its interaction design is specified in [`07`](07_UI_UX_GUIDELINES.md) §10. Its architecture is here.

### 12.1 Position

| Property | Rule |
|---|---|
| **Owns nothing** | Every entry originates in a record elsewhere and links back to it (`06` §18.1) |
| **Single schedule surface** | No module builds a second calendar |
| **Derived** | It reflects dated obligations; it never becomes a second source of dates |

### 12.2 Views and content

**Views:** Month · Week · Day · Agenda. The Agenda view is a **full equivalent**, not a degraded fallback.

**Content:** project activities · lifecycle stages (as spans) · milestones (as points) · deadlines · Weekly, Monthly and Executive due dates · meetings · client meetings · approvals · delegation periods · reminders.

**Filters:** Project · Department · System · Programs & Studies, cascading per §11, plus entry type, owner and status.

**Widgets:** Upcoming · Today · This Week · This Month · Overdue.

### 12.3 What the schedule feeds

| Consumer | Uses |
|---|---|
| **Company Dashboard** | Upcoming milestones across the organization |
| **Portfolio Dashboard** | Overdue activities and milestone exposure across projects |
| **Project Dashboard** | Activities and milestones for the project |
| **Personal Dashboard** | The reader's own activities, meetings and deadlines |
| **Weekly** | Activities and milestones in the reporting period |
| **Monthly** | Activity and milestone movement across the month |
| **Executive Summary** | Milestone status and schedule exposure per project |

**These consumers read the schedule. None holds its own copy of a date.**

### 12.4 Import and integration readiness

| Capability | Status |
|---|---|
| **Excel schedule import** | Specified — validate, preview, confirm, report (`07` §10.7) |
| **Primavera synchronization** | **Future ready** |
| **Google Calendar** | **Future ready** |

Design rules that make later integration possible without rework are in §19.

---

## 13. Dynamic Timeline

### 13.1 No fixed lifecycle

**The platform defines no fixed set of project stages.** A project's timeline is its own Project Lifecycle (`06` §10), which is created blank or copied from a Project Type template and then edited freely.

### 13.2 What is configurable

| Element | Configurable |
|---|---|
| **Stages** | Add · rename · reorder · edit · archive · restore |
| Stage attributes | Description · owner · start date · due date · status · weight · colour · icon |
| **Milestones** | Add, edit, archive; target and actual dates; criticality; client visibility |
| **Approvals** | Modelled as stages or milestones where a project has them |
| **Client checkpoints** | Optional stages, added only where the project actually has them |
| **Dependencies** | Between stages, kept acyclic |

### 13.3 Rules

1. **Client Approval is never mandatory.** A project with no such stage is fully valid (`06` §10.8).
2. **A template is copied, never linked.** Editing a project's lifecycle never affects the template or another project.
3. **Stages are archived, never deleted**, because reports and activities reference them.
4. **Weighted stage progress feeds project completion** (§6.2), and the weighting is visible.
5. **A milestone is a point; a stage is a span.** They render distinctly and neither substitutes for the other.
6. **No dashboard assumes a stage exists.** A timeline renders whatever the project has configured, including nothing.

---

## 14. Dashboard animations

Motion **explains change**. Presentation rules are in `07` §4.9; the dashboard-specific requirements are here.

| Behaviour | Rule |
|---|---|
| **Animated counters** | A figure may count up to its value on first render. **Only once**, only when the final value is already known, and never while data is still loading — an animating placeholder implies a number that does not yet exist |
| **Smooth transitions** | Filter and period changes transition rather than snapping, so the reader keeps their place |
| **Skeleton loading** | Skeletons match the shape of incoming content so nothing shifts on arrival |
| **Live notification updates** | The unread count updates in place without a reload and without moving surrounding content |
| **Expand / collapse** | Panels expand from their own origin; state is remembered per user |
| **Card interactions** | Hover and focus raise elevation subtly; the whole card is the target where it links to one destination |
| **Motion without distraction** | Nothing loops, pulses or auto-advances. A dashboard left open is still |

**Rules:**

1. **Reduced motion is honoured by removal, not shortening.** Counters render their final value immediately; transitions become instant; skeletons stay but do not shimmer.
2. **Motion never delays comprehension.** The real value is readable before any animation completes.
3. **Nothing animates on every refresh.** Entrance animation plays once per session per panel.
4. **Motion never blocks input.**

---

## 15. Universal notification panel

### 15.1 Availability

The bell is present in the top bar on **every page of the platform**, dashboard or not, and behaves identically everywhere.

### 15.2 Content

| Type | Origin |
|---|---|
| **Admin messages** | A System Administrator |
| **Project Control messages** | Project Control, directed or broadcast |
| **Assignment notifications** | You have been assigned to a project, department, responsibility or action |
| **Approval requests** | An item awaits your decision |
| **Due reminders** | Submissions, reports, actions and milestones approaching or overdue |
| **System announcements** | Platform-level notices |

### 15.3 Behaviour

| Property | Rule |
|---|---|
| **Read / unread** | Per recipient and personal; the badge shows the exact unread count up to a threshold, then a bounded indicator |
| **Priority** | Notifications carry a priority; critical items sort first and are visually distinct by more than colour |
| **Deep links** | **Every notification resolves to the item it concerns** — one click to the work |
| **Grouping** | By recency, filterable by type and project |
| **History** | Nothing is dismissed into nothing; read notifications remain retrievable |

### 15.4 Rules

1. **Delivery is targeted by responsibility, not by read permission.** With universal read (§18), notification is what tells a person which work is theirs.
2. **Notification never advances a workflow.** It informs; a person acts.
3. **Notification is not audit.** Audit records what was done; notification records who was told (`06` §21.3).
4. Messages are **distinct from notifications** and reached separately, because "someone wrote to you" and "something needs you" are different demands.

---

## 16. Avatar and profile

Specified in full in [`07`](07_UI_UX_GUIDELINES.md) §8. The dashboard-relevant rules:

| Element | Rule |
|---|---|
| **Cartoon avatar** | Illustrated / cartoon style, never photographic; generated from an uploaded photo, chosen from a library, or generated from identity |
| **Presence indicator** | Online · Offline · Away / Busy / On Leave · Delegated. **Informational only** — never implies permission and never blocks an action |
| **Profile editing** | Avatar, display name, job title, organization, availability, theme, locale |
| **Role badge** | The platform role, shown as a label |
| **Department badge** | The department for the assignment in context |
| **Project badge** | The project for the assignment in context |

**Rules:**

1. **No badge grants authority.** Role, department and project badges are descriptive labels. Job title and functional title likewise (`06` §8.7). Permission is resolved by the permission model alone.
2. A badge always states **which context it refers to** — a person with different roles on different projects shows the badge for the project in view, never an arbitrary one.
3. The avatar appears wherever a person is referenced, consistently (`07` §8.3).

---

## 17. Dashboard output

### 17.1 The boundary

Dashboards are **where report generation is launched and monitored**. They are not where reports are compiled.

| Owned by the reporting engine (`03`) | Owned by the dashboard |
|---|---|
| Compiling Weekly, Monthly, Executive Summary, Chairman Report | Presenting their status and progress |
| Applying approval, snapshot, revision and locking rules | Offering the action that starts generation |
| Producing the issued document | Offering the export and confirming completion |

**A dashboard never assembles report content.** Launching generation from a dashboard produces exactly the same report as launching it from the Report Center, because the same engine runs (§2.3).

### 17.2 What can be generated from a dashboard

| From | Generates |
|---|---|
| Project Dashboard | Weekly · Monthly for that project |
| Portfolio / Company Dashboard | Executive Summary for the portfolio |
| Chairman Dashboard | **Chairman Report** and the printable one-page executive output |

Each action is subject to permission and to the report's own state rules — a Monthly cannot be generated where its Weekly inputs are not approved, and the dashboard states why rather than failing silently.

### 17.3 Exporting the dashboard itself

A dashboard may be exported as a point-in-time record.

| Format | Use |
|---|---|
| **PDF** | Presentation-quality, A4, print-ready — the reference format |
| **Word** | For incorporation into wider correspondence |
| **Excel** | The underlying figures for further analysis, where the dashboard is tabular |

**Rules:**

1. Every export carries **EPROM branding, the period, the coverage basis, and the generation timestamp**.
2. A dashboard export is **a snapshot of a view, not an issued report** — it is labelled as such and never carries a report number or approval block.
3. **Any unapproved content included is watermarked**, exactly as a draft report would be (`03` §17.2).
4. Export respects the requester's permissions and is recorded.

---

## 18. Read-only principles

### 18.1 Visibility is universal

**Every authenticated user may open every dashboard.** Page visibility is not a permission (`06` §17.1).

### 18.2 Permission governs actions only

| Action | Meaning |
|---|---|
| **Create** | Add records within scope |
| **Edit** | Change content while its status permits |
| **Delete** | Soft-delete or archive |
| **Review** | Review and return with a reason |
| **Approve** | Approve at the stage held |
| **Admin** | Administer configuration, master data and assignments |

### 18.3 Rules

1. A user without an action permission sees **the same dashboard**, fully rendered, with the same data.
2. Action controls remain **visible and disabled**, each explaining why and what would make it available.
3. **No dashboard is hidden**, and no dashboard renders an access-denied state.
4. **Notification, not visibility, directs attention** (§15.4).
5. **Dashboard Configuration is itself permission-gated** — a reader may arrange their personal view; changing a project or organization default requires Admin.

> **Consequence.** Every authenticated user can read every project's dashboards, including all departments and all Comment Register entries. This is deliberate (`06` §1.1, decision 1) and is recorded with its consequences in `06` §23.1.

---

## 19. Future integrations

None of these exist. They are recorded so that dashboards are designed now in a way that accommodates them without rework.

| Integration | Intent | Status |
|---|---|---|
| **Power BI** | Publish approved portfolio data for independent analysis | Future ready |
| **Primavera** | Align lifecycle stages, activities and milestones with the planning tool of record | Future ready |
| **SAP** | Reconcile commercial and resource data against project reporting | Future ready |
| **Microsoft Teams** | Deliver notifications and approvals into the collaboration channel | Future ready |
| **Outlook** | Deliver reminders, meeting invitations and deep links by mail | Future ready |
| **Google Calendar** | Publish meetings and deadlines to personal calendars | Future ready |
| **AI Assistant** | Draft summaries, surface similar risks, flag anomalies, answer questions across the record | Future ready |

### 19.1 Design rules that apply now

1. **Every figure and schedule entry declares its origin** — entered, imported, or synchronized — and displays it.
2. **Synchronized content is read-only in the platform** where the external system is the source of record, and says so rather than silently rejecting edits.
3. **Conflicts are surfaced, never auto-resolved.** Both values are shown and a person decides.
4. **The platform remains fully functional with every integration unavailable** (`01` §15). No dashboard capability depends on an external system.
5. **An integration never becomes a source of truth.** External systems exchange data; the platform's approved reporting remains authoritative.
6. **AI proposes; it never approves.** No AI element may perform or auto-confirm a workflow transition, and every AI output is labelled and traceable to the approved data it derived from (`01` §15).

---

## 20. Workspace Architecture

### 20.1 Two distinct meanings of "workspace"

The platform uses the word in two senses. They are different things and must never be conflated.

| Term | Meaning | Defined in |
|---|---|---|
| **Project Workspace** | The project a user is currently focused on — a *focus*, not an access boundary | [`07`](07_UI_UX_GUIDELINES.md) §6 |
| **Personal Workspace** | The individual's own operating surface — where they work from | **This section** |

### 20.2 Workspace versus Personal Dashboard

These two also overlap in content and must be separated by purpose, or they will drift into duplicates.

| | Personal Workspace (§20) | Personal Dashboard (§8) |
|---|---|---|
| **Answers** | *Where do I work, and where was I?* | *What needs me?* |
| **Layer** | Wayfinding and continuity | Obligation and accountability |
| **Ordered by** | Recency, frequency and the user's own choices | Claim on the reader's time — overdue first |
| **Owns its content** | **No** — it surfaces what other modules own | **No** — it surfaces obligations |

**The Workspace never computes anything.** Where a panel shows tasks or meetings, it surfaces records owned by the Personal Dashboard, the Schedule (§12) or the reporting engine. It holds shortcuts and history, never figures of its own (§2.3).

### 20.3 Content

| Panel | Content | Owned by |
|---|---|---|
| **Recent projects** | Projects the user has opened lately, most recent first | Workspace (usage history) |
| **Favorite projects** | Projects the user has marked as favourites, in their chosen order | Workspace (user preference) |
| **Pinned projects** | Projects deliberately kept at the top, above favourites | Workspace (user preference) |
| **Recent reports** | Reports the user has opened or worked on lately, with current status | Report Center |
| **Recent activity** | The user's own recent actions, for continuity | Audit trail |
| **Upcoming meetings** | The user's next meetings | Schedule (§12) |
| **Today's tasks** | What is due from the user today | Personal Dashboard (§8) |
| **Continue where you left off** | The last unfinished piece of work, with enough context to resume | Workspace (usage history) |

### 20.4 Favourites, pins and recency

| Concept | Nature | Behaviour |
|---|---|---|
| **Recent** | **Automatic** | Derived from the user's own navigation; bounded in length; never manually edited |
| **Favorite** | **Deliberate** | Marked by the user; unbounded; reorderable |
| **Pinned** | **Deliberate and prioritized** | A small set kept above everything else; ordered by the user |

**Rules:** the three are distinct and never merge — pinning does not remove something from recents, and favouriting does not pin it · they are **per user**, never shared or imposed · **they are preferences, not permissions** — favouriting a project grants nothing, and unfavouriting hides nothing that would otherwise be visible (§18) · a project a user has favourited that is later archived remains listed, marked archived, rather than vanishing silently.

### 20.5 Continue where you left off

Resumption is a **navigational convenience, never a state restoration**.

**Rules:**

1. It records **where** the user was — the report, period, section — not unsaved content.
2. **It never resurrects unsaved edits.** Draft content is the responsibility of the record, not of the workspace.
3. It respects current state: if the item has since been approved, locked, or archived, the workspace says so and opens it in its current state rather than an outdated one.
4. It never resumes into an action the user can no longer perform; it opens read-only and states why (§18).
5. It is **dismissible**, and the workspace is complete without it.

### 20.6 Rules

1. **The Workspace owns preferences and usage history only.** Every other panel surfaces content owned elsewhere.
2. **Nothing in the Workspace affects visibility or permission.**
3. **Usage history is personal** and never exposed to other users as an activity feed.
4. Every panel is **one click from the work**.
5. An empty Workspace — a new user with no history — presents an inviting first-run state, not a blank surface (`07` §25).

---

## 21. Dashboard Layout Builder

Users arrange their own dashboards. Arrangement is **presentation only** and never changes a figure.

### 21.1 Ownership of a layout

Layouts resolve through **Dashboard Configuration** (`06` §17.5), which exists at three levels:

| Level | Owner | Purpose |
|---|---|---|
| **Organization default** | Organization | The default arrangement for portfolio, company and chairman dashboards |
| **Project default** | Project | The default arrangement for that project's dashboards |
| **Personal layout** | Account | One user's own arrangement, layered over whichever default applies |

**Resolution order:** personal layout, else project default, else organization default. A user always sees a complete dashboard whether or not they have customized anything.

### 21.2 Capabilities

| Capability | Behaviour |
|---|---|
| **Drag and drop** | Reposition a widget within the dashboard grid |
| **Resize** | Change a widget's footprint within its permitted size range |
| **Pin / unpin** | Keep a widget in a fixed position regardless of later rearrangement |
| **Hide / show** | Remove a widget from view, or restore it from the available list |
| **Reset layout** | Discard the personal layout and return to the applicable default |
| **Saved per user** | Personal layouts persist per user per dashboard, across sessions and devices |

**Every capability has a keyboard-operable equivalent.** Drag and drop is never the only way to move or resize a widget (`07` §3.7).

### 21.3 Rules

1. **Layout is presentation only.** It never changes what a figure is, what it reads, or how it is calculated (§2.3).
2. **A personal layout never alters a default**, and never affects another user.
3. **Changing a project or organization default requires Admin** (§18.2); arranging a personal layout requires nothing beyond being signed in.
4. **Reset always returns to the applicable default**, never to an empty dashboard, and states which default it restored.
5. **Hiding a widget hides a view, not an obligation.** A hidden Deadlines widget does not stop reminders, and a hidden Approvals widget does not stop approval notifications (§15).
6. **Widget availability is still gated.** A widget whose data the reader cannot see, or which does not apply to this project's configuration, is not offered — hiding it is not the mechanism for that.
7. **A layout never removes mandatory content.** Where a dashboard has a panel required for interpretation — coverage, unapproved-data marking (§2.2) — that panel cannot be hidden.
8. **Layouts survive widget changes.** A widget withdrawn from the catalogue disappears from saved layouts without corrupting them; a new widget appears in the available list, not silently inserted into a customized layout.

---

## 22. Report Template Engine

### 22.1 Boundary

Sections §22–§24 specify **how report presentation is configured**. They complete the dashboard's output story (§17), and they relate to existing documents as follows:

| Document | Owns |
|---|---|
| [`06`](06_DATABASE_SCHEMA.md) §16.2–§16.4 | The **entities** — Report Template, Report Layout, Branding |
| [`03`](03_REPORTING_ARCHITECTURE.md) §14, §16–§17 | The **rules** — branding capture, numbering, output generation |
| **This document, §22–§24** | The **configuration architecture** — what an administrator can define, and the limits |
| [`12`](12_REPORT_GENERATION.md) | Executive Report composition and A4 output |

Whether §22–§24 eventually relocate to `12` is recorded in §26, Decision 6.

### 22.2 No hardcoded layouts

**No report layout is built into the product.** Every element of a report's presentation is configured by an authorized administrator and takes effect without a code change.

### 22.3 What an administrator configures

| Element | Configurable |
|---|---|
| **Cover page** | Presence, composition, imagery, title block, confidentiality label |
| **Header** | Content, arrangement, which identity elements appear |
| **Footer** | Content, arrangement, page numbering position |
| **Watermark** | Text, placement and opacity **for draft output** |
| **Logo** | Which brand logos appear, and where (§23) |
| **QR code** | Presence and placement |
| **Fonts** | Family, weight and size scale within the approved typographic system |
| **Colours** | Applied through semantic brand roles, never raw values (§23) |
| **Executive layout** | Section order and presentation for the Executive Summary |
| **Weekly layout** | Section order and presentation for the Weekly Report |
| **Monthly layout** | Section order and presentation for the Monthly Report |
| **Chairman layout** | Section order and presentation for the Chairman Report |
| **Signature blocks** | Which signatories appear, their order and their labels |
| **Approval tables** | Which approval stages are shown, and in what form |
| **Revision tables** | How revision history is presented on the document |

### 22.4 Template lifecycle

1. A template is **organization-owned**, associated with a Project Type, and **copied into a project** when applied (`06` §16.2).
2. **Editing a project's copy never affects the template or another project.**
3. Templates are **versioned**. A change produces a new version; earlier versions remain resolvable.
4. **The template in force at approval is captured in the report's snapshot** (`03` §11.2). Changing a template never alters an already-issued report.
5. Templates are **archived, never deleted**, because issued reports reference them.

### 22.5 The guardrail — what a template may never do

This is the most important rule in this section. Configuration governs presentation; it may never compromise integrity.

**A template can arrange, style and position. It can never:**

| Prohibited | Why |
|---|---|
| Omit the **report number, period, revision or status** | A document must remain identifiable once separated from the platform |
| Omit or weaken the **draft watermark** | An unmarked draft is indistinguishable from a final document and will be quoted as one (`03` §17.2) |
| Omit the **approval attribution** on an approved report | Approval is an accountable act and must be visible |
| Omit or misdirect the **QR code** where enabled | It must resolve to that exact revision, never to "the latest" |
| Alter, filter or reorder **content** | Layout orders sections; it never changes what a section says |
| Introduce content not present in the report | A template presents; it never authors |
| Produce output that is illegible in monochrome | Print must remain interpretable (`07` §29) |

**A configuration that would violate any of these is rejected at configuration time, with the reason stated — not silently ignored at generation time.**

---

## 23. Branding Engine

### 23.1 What "multiple brands" means here

The Branding Engine supports **multiple brand definitions** — EPROM corporate identity, client co-branding, and divisional or sub-brand variants — applied without a code change.

> **It does not make the platform multi-company.** EPRP remains internal to EPROM (`01` §16). Brands are presentation identities applied to reports and interface chrome; they are not tenants, and they do not partition data, permissions or ownership. See §26, Decision 7.

### 23.2 What a brand carries

| Element | Notes |
|---|---|
| **Logo** | Full lockup and compact mark, with the background each is valid on |
| **Company colours** | Expressed as **semantic roles**, never raw values (`07` §4.3) |
| **Header** | Default header composition for reports carrying this brand |
| **Footer** | Default footer composition |
| **Watermark** | The draft watermark treatment for this brand |
| **QR** | Whether the QR code is included, and its placement |
| **Report numbering style** | The composition and formatting of the report reference |
| **Cover page** | The default cover treatment |

### 23.3 Resolution

**Project brand overrides organization default; organization default applies where a project specifies nothing.** There is never an unbranded output (`03` §14.3).

Client logos appear **beside** the EPROM identity in reports; they are never combined into a single mark (`07` §4.2).

### 23.4 Rules

1. **Adding or changing a brand is configuration, never a code change.**
2. **The brand in force at approval is captured in the snapshot.** Re-exporting a three-year-old report reproduces the branding it was issued under, not today's.
3. **Branding never alters content.** It is presentation only.
4. **Branding is uniform across formats** — PDF, Word and Excel outputs of the same report present the same identity.
5. **Numbering style is part of the brand; a number is not.** A brand defines how references are composed; once a report number is assigned it is immutable and never reformatted retrospectively (`03` §13.3).
6. **Colour is applied through semantic roles**, so every brand resolves correctly in both light and dark themes (`07` §30).
7. **A brand cannot disable an integrity element.** The guardrails in §22.5 apply to brands exactly as they apply to templates.

---

## 24. Report Layout Builder

### 24.1 No fixed sequence

**The platform defines no fixed section order for any report.** An administrator defines the order, and it takes effect without a code change.

### 24.2 What a layout defines

| Element | Configurable |
|---|---|
| **Section order** | The sequence in which sections appear |
| **Section presence** | Whether an optional section is included |
| **Section grouping** | How sections are grouped under headings or onto pages |
| **Page rules** | Breaks, orientation per section, page size |
| **Format overrides** | Presentation differences for PDF, Word and Excel |
| **Density** | Compact or expanded presentation, within legibility limits |

### 24.3 Reusable layouts by Project Type

A layout is defined once and reused by every project of a Project Type, so reports of the same kind are consistent across similar projects.

**Rules:** a Project Type carries a **default layout per report level** · applying a layout to a project **copies** it; the copy is independent (`06` §16.3) · a project may deviate from its type's layout without affecting other projects · layouts are **versioned**, and the version in force at approval is captured in the snapshot.

### 24.4 Rules

1. **Order is presentation.** Reordering sections never changes what a section contains, what it compiled from, or any figure within it (§2.3).
2. **Mandatory sections cannot be removed.** Optional sections — the Chairman Report's Organization Chart pages and appendices, for instance — may be included or excluded; sections required for interpretation may not.
3. **Coverage and exclusion statements are mandatory.** A layout can never remove the declaration of what a report compiled and what was missing (`03` §5.2).
4. **A layout never merges or splits content** to fit a page. Ranked content truncates with a stated count; it is never silently dropped.
5. **The guardrails in §22.5 apply in full.**
6. **A layout change never alters an issued report**, because the layout in force is captured at approval.

---

## 25. Conformance rules

An implementation conforms to this architecture when all of the following hold.

1. Every dashboard reads approved reporting output or the Portfolio Summary.
2. No dashboard implements a calculation the platform already performs.
3. A figure a dashboard needs but the platform does not produce is defined as a KPI and reported, not calculated in the dashboard.
4. Every figure resolves to its source project, period, report and revision.
5. Only the Project Dashboard shows unapproved in-progress data, it is always marked, and it never contributes to a higher-altitude figure.
6. Missing data renders as *not reported*; undeterminable health renders as *Unknown*; neither renders as zero or green.
7. Every aggregate declares its coverage basis.
8. Higher altitudes aggregate lower-altitude approved output and never re-derive it.
9. Every widget declares its data source, scope, period and coverage.
10. No two widgets reading the same source can disagree.
11. Every widget defines its loaded, loading, empty and error states; none renders blank.
12. Filters cascade, never offer a value returning nothing, and apply to every widget or the widget declares itself unfiltered.
13. A filtered-empty result is distinguishable from missing data.
14. Filter state persists per user and is shareable, resolving subject to the recipient's permissions.
15. Hierarchy terminology comes from the project's Hierarchy Profile and never branches behaviour.
16. No dashboard assumes any lifecycle stage exists.
17. Project completion is derived, explainable, and reports *Unknown* on incomplete input.
18. Animated counters render only known final values, once, and are suppressed under reduced motion.
19. Every notification resolves to the item it concerns.
20. No badge, job title or functional title grants authority.
21. Report generation launched from a dashboard produces the identical report the reporting engine would produce elsewhere.
22. A dashboard export is labelled a view snapshot, never an issued report, and watermarks any unapproved content.
23. Every dashboard is openable by every authenticated user; permission gates actions only.
24. Disabled action controls remain visible and state why.
25. Every dashboard functions fully with every external integration unavailable.

**Workspace, layout and report configuration (§20–§24):**

26. The Personal Workspace owns preferences and usage history only; every other panel surfaces content owned elsewhere.
27. Favourites, pins and recents are per-user preferences and never affect visibility or permission.
28. "Continue where you left off" restores location only, never unsaved content, and opens an item in its current state.
29. A dashboard layout is presentation only; a personal layout never alters a default or another user.
30. Hiding a widget hides a view, never an obligation — reminders and notifications are unaffected.
31. Mandatory interpretive panels — coverage, unapproved-data marking — cannot be hidden by any layout.
32. No report layout is built into the product; cover, header, footer, watermark, logo, QR, fonts, colours, per-level layouts, signature blocks, approval tables and revision tables are all configured.
33. A template, brand or layout may arrange and style but may never omit the report number, period, revision, status, draft watermark, approval attribution or QR resolution, and never alters content (§22.5).
34. A configuration that would breach §22.5 is rejected at configuration time with the reason stated, never ignored at generation time.
35. Templates, brands and layouts are versioned, and the version in force at approval is captured in the report snapshot.
36. Changing a template, brand or layout never alters an already-issued report.
37. Brand colours are applied through semantic roles, so every brand resolves in both light and dark themes.
38. Report numbering style is part of a brand; an assigned report number is immutable and never reformatted retrospectively.
39. Applying a template or layout copies it; the copy is independent of its source and of every other project.

---

## 26. Open decisions

Recorded so each is settled deliberately. **None is resolved by this document.**

| # | Decision | Positions | Why it matters |
|---|---|---|---|
| **1** | **Company versus Portfolio Dashboard** | (a) Keep both, separated by question as in §3.2 — orientation versus comparison. (b) Merge into one portfolio-level dashboard with an orientation panel. | Three top-level surfaces (Company, Portfolio, Chairman) risk collapsing into each other. If the separation is not felt in use, one should be removed rather than maintained as a near-duplicate. |
| **2** | **Cross-project department view** | (a) Accept §7.1 — Department Dashboards are scoped to one department in one project. (b) Add an optional organization-level grouping key so "this department across the portfolio" becomes answerable. | Follows from project-owned departments (`06` §23.2). Determines whether "which department is strained across the portfolio" can ever be answered. Already recorded as `06` §25, Decision 2. |
| **3** | **Personal Dashboard as landing surface** | (a) Personal Dashboard is the default landing for all users. (b) Landing depends on role — Personal for contributors, Company for portfolio roles, Chairman for leadership. | Affects §4 and the workspace selection flow in `07` §6.2. |
| **4** | **Dashboard export as a governed artifact** | (a) A view snapshot only, as in §17.3. (b) A numbered, retained artifact in the Report Center. | If dashboards are exported and circulated, an ungoverned PDF may be quoted like a report. (a) relies on labelling; (b) makes it traceable. |
| **5** | **Real-time refresh cadence** | (a) On navigation and explicit refresh. (b) Live updates for notification counts and cycle status only. (c) Fully live dashboards. | Affects §14 live updates and perceived trust — a figure that changes while being read undermines confidence unless the change is explained. |
| **6** | **Home for the report configuration engines** | (a) Keep §22–§24 here, completing the dashboard output story. (b) Relocate to [`12_REPORT_GENERATION.md`](12_REPORT_GENERATION.md). (c) Give them their own document. | They are report-generation architecture living in a dashboard document. Keeping them here is defensible while `12` remains a narrow Executive Report specification; it stops being so once `12` is expanded. |
| **7** | **Scope of "multiple brands"** | (a) Brand definitions only — EPROM corporate, client co-branding, divisional variants, as specified in §23.1. (b) Brand as a tenancy boundary partitioning data and permissions. | (b) would contradict `01` §16, which states EPRP is not a multi-company product. This document adopts (a); confirm that is intended. |
| **8** | **Personal Workspace as landing surface** | (a) Personal Dashboard lands (§26, Decision 3). (b) Personal Workspace lands, with the Dashboard one click away. | §20 and §8 are adjacent surfaces. Which one a user meets first shapes whether the platform reads as task-driven or continuity-driven. |

---

## 27. Specification versus as-built

This document is **specification**. `docs/engineering/` describes what exists in code today. Where they disagree, this document wins.

| Area | As-built today | This document requires |
|---|---|---|
| Dashboard data source | Reads **static mock data** and calculates independently | §2.2, §2.3 — read approved output |
| **Company Dashboard** | **Does not exist** | §4 |
| Portfolio Dashboard | **Does not exist** as specified | §5 |
| Project Dashboard | Project sections exist; no dashboard | §6 |
| **Department Dashboard** | **Does not exist** | §7 |
| **Personal Dashboard** | **Does not exist** | §8 |
| Chairman Dashboard | **Does not exist** | §9 |
| Chart components | **Present** — chart primitives and KPI/stat cards | Extended to the widget contract in §10.1 |
| **Widget contract and configuration** | **Do not exist** | §10 |
| **Dashboard filtering** | Filter components exist; no dashboard filter model | §11 |
| **Schedule Dashboard** | **Does not exist** | §12 |
| **Dynamic timeline** | **Does not exist** | §13 |
| Animation conventions | **Present** — reduced motion honoured throughout | §14 |
| Notification panel | Bell present in the top bar, **not wired** | §15 |
| Avatar and badges | **Do not exist** | §16 |
| **Dashboard output and export** | **Do not exist** | §17 |
| Read-only presentation | Not applicable — no permission enforcement | §18 |
| **All external integrations** | **Do not exist** | §19 |
| **Personal Workspace** | **Does not exist** | §20 — recents, favourites, pins, resumption |
| **Dashboard Layout Builder** | **Does not exist** | §21 — arrange, resize, pin, hide, reset, per-user |
| **Report Template Engine** | **Does not exist**; report branding fields exist on the project only | §22 — fully configured, no hardcoded layouts |
| **Branding Engine** | **Does not exist** | §23 — multiple brand definitions without code change |
| **Report Layout Builder** | **Does not exist** | §24 — configurable section order, reusable by Project Type |

---

## 28. Document map

| Document | Defines |
|---|---|
| [`01_PROJECT_VISION.md`](01_PROJECT_VISION.md) | What the platform is |
| [`02_PLATFORM_ARCHITECTURE.md`](02_PLATFORM_ARCHITECTURE.md) | Ownership, isolation, permission architecture |
| [`03_REPORTING_ARCHITECTURE.md`](03_REPORTING_ARCHITECTURE.md) | The reporting engine |
| [`04_WORKFLOW_ENGINE.md`](04_WORKFLOW_ENGINE.md) | Report states and transitions |
| [`05_PERMISSION_MODEL.md`](05_PERMISSION_MODEL.md) | Roles, responsibility, delegation |
| [`06_DATABASE_SCHEMA.md`](06_DATABASE_SCHEMA.md) | The entities and what they mean |
| [`07_UI_UX_GUIDELINES.md`](07_UI_UX_GUIDELINES.md) | Presentation and interaction |
| **This document** | **Dashboard architecture** |
| [`12_REPORT_GENERATION.md`](12_REPORT_GENERATION.md) | Executive Report composition and A4 output |
| [`15_DEVELOPMENT_ROADMAP.md`](15_DEVELOPMENT_ROADMAP.md) | **Current status and delivery order** |

This document is the authority on **dashboard architecture**. `07_UI_UX_GUIDELINES.md` is the authority on how dashboards look and are operated; `03_REPORTING_ARCHITECTURE.md` is the authority on the data they read. It describes the complete architecture. It is the target, not a statement of what is built today; the roadmap is the authority on current status.

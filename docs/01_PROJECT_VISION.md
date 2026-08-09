# EPRP Project Vision

## 1. Product name

**EPROM Progress Report (EPRP)**

An internal Enterprise Project Control Platform for EPROM.

## 2. What EPRP is

EPRP is the single environment in which EPROM plans, controls, reviews, and reports every project it runs.

It holds the structure of each project, the people accountable for each part of it, the progress recorded against it, the decisions taken about it, and the reports issued from it — in one governed system with one version of the truth.

**EPRP is not a weekly reporting tool.** Weekly reporting is one workflow inside it. Treating the platform as a form for collecting weekly updates understates it and leads to the wrong design decisions. EPRP is the control layer for the entire project portfolio: configuration, structure, responsibility, execution, reporting, analysis, governance, and distribution.

### The platform at a glance

The complete product scope. Each entry is defined in the section named.

| Capability | Defined in |
|---|---|
| Dynamic Project Configuration | §4 |
| Project Type driven hierarchy | §4 |
| Programs & Studies (configurable per project type) | §4 |
| Dynamic Departments · Dynamic Systems · Dynamic Contacts | §4 |
| Contact Center | §4 |
| Organization Chart Module | §4 |
| Configurable KPIs | §4 |
| Role, project, and department permissions | §5 |
| Weekly Report · Monthly Report · Executive Summary Report | §6 |
| Approval Workflow | §6 |
| Dashboard Workspace · Portfolio Dashboard · Chairman Dashboard | §7 |
| Project Health | §7 |
| Analytics | §8 |
| Risk Matrix · Criticality Matrix | §8 |
| Notification Center | §9 |
| Meeting Center · Calendar | §10 |
| Report Center · Knowledge Center · Google Drive Archive | §11 |
| PDF / Word / Excel Export | §12 |
| Audit Trail · Revision History | §13 |
| Professional experience | §14 |
| Scalable and AI-ready architecture | §15 |

## 3. The problem it replaces

Project information today is scattered across email threads, personal spreadsheets, shared folders, and documents produced by hand. The consequences are consistent and expensive:

- The same figure is entered several times, in several formats, and the versions disagree.
- Ownership is unclear — it is not obvious who is responsible for a number, or who approved it.
- Submissions arrive late because nothing tracks what is outstanding.
- Terminology drifts between departments and between projects.
- Every new project type is forced into a structure built for the last one.
- Preparing a Monthly or Executive Report is a manual assembly job repeated every cycle.
- History is lost. When a figure changes, the reason and the previous value disappear.
- Knowledge leaves with the people who held it, because nothing captures it.

None of these are reporting problems. They are project control problems.

## 4. The organizing principle: the project

Everything in EPRP belongs to a project. The project is the unit of structure, permission, reporting, and history. There is no floating data.

The platform is multi-project by design. Projects run in parallel, differ in shape, and never interfere with one another.

### Dynamic Project Configuration

No project's structure is fixed by the platform. Each project is configured — not coded — and its configuration governs how it behaves from that point on: what it is made of, what it reports, how it is measured, and what its parts are called.

Configuration is an administrative act, performed by authorized administrators through the platform itself. Adding a client, a department, a system, a program, a project type, a job title, or a measure never requires a change to the product. A project set up today must be able to describe work the organization has not yet won.

This is what allows one platform to serve engineering projects, process-safety programmes, asset-integrity work, and whatever follows, without any of them being a special case.

### Project Type driven hierarchy

The **Project Type** is the decisive configuration choice. It determines the shape of the project's hierarchy — how many levels it has, what each level is called, and how progress rolls up through them.

Two projects of different types are legitimately different products of the same platform. One may run Departments → Systems → Disciplines; another Departments → Systems → Programs & Studies. Neither is a workaround for the other, and neither user is asked to translate their own vocabulary into someone else's.

### Programs & Studies

**Programs & Studies** is the level of work beneath a System on Process Safety and Asset Integrity Management projects. It is where progress is genuinely measured on that kind of work — the individual programmes and studies that constitute the scope.

On general engineering projects the equivalent level is called **Disciplines**.

This naming is a property of the Project Type and is configurable, not hardwired. The principle generalizes: **the platform speaks each project's own language.** A future project type may name this level something else again, and the platform must accommodate it by configuration alone. What is fixed is the structural relationship; the vocabulary is not.

### Dynamic Departments, Systems, and Contacts

The three structural pillars of a project are all dynamic.

**Departments** — the parts of the organization contributing to the project. Departments are defined centrally, assigned per project, and carry a specific obligation on each one. A department may contribute to many projects and owe something different to each. What a department owes is configured, not assumed.

**Systems** — the plant, facility, or scope areas the project covers. Systems are defined and assigned per project, owned by a department, and are the frame that progress is organized around. No system list is built into the product.

**Contacts** — the people on the project. A person's presence on a project, their responsibility within it, and their reporting line are all per-project facts. The same individual may hold different responsibilities on different projects at the same time, and the platform must represent that without contradiction.

### Contact Center

The **Contact Center** is the platform's people directory — the authoritative record of everyone EPROM works with across all projects: internal staff, department members, client representatives, and external contributors.

It answers questions that no single project can: who this person is, which projects they are on, what they are responsible for on each, who they report to, who reports to them, and how to reach them. It is where a person is created once and then drawn into any project that needs them, rather than re-entered per project.

It is also where responsibility is made legible. A job title recorded here describes what a person does; it never grants authority (§5).

### Organization Chart Module

Every project maintains its own **Organization Chart** — a visual, editable model of its structure of authority.

It shows how the project is actually run: who leads each department's contribution, who reports to whom, which parts of the scope each position covers, and where responsibility currently sits including any temporary delegation. It is built and maintained visually, kept in step with the project's real assignments, and preserved as it changes so that the structure in force at any past moment can be recovered.

The chart is a governance instrument, not a diagram. It is how the organization proves who was accountable for what, and when.

### Configurable KPIs

The measures a project is judged by are configured per project and per project type. A construction project, a process-safety programme, and a study campaign are not well measured by the same indicators, and forcing one set on all of them produces numbers nobody trusts.

Administrators define which measures apply, how they are calculated from reported data, what their targets and thresholds are, and how they are presented. Measures are consistent within a project type so comparison across projects remains valid, and they evolve as the organization's standards mature — without redefining history.

## 5. Access: role, project, and department

Authority in EPRP is defined on three axes at once.

**Role** establishes what a person is permitted to do — enter, review, approve, publish, or administer.

**Project** establishes which projects they may reach. Assignment to one project grants nothing on another.

**Department** establishes which part of a project they may act on. A department lead has authority over their own department's contribution and no visibility of another department's internal working.

The three combine. A person is not simply "an approver" — they are an approver of a specific department, on a specific project, for a specific stage. This is what makes the platform usable across many projects and many departments simultaneously without leakage, and what makes an approval mean something.

Two rules protect the model:

- **A job title is a label, not a permission.** Titles describe what someone does; they never grant authority. Authority is granted explicitly and can be audited.
- **Authority can be delegated, but only deliberately and only temporarily.** When someone is away, their authority may be passed to a named person for a defined period, within a defined scope, and it expires on its own.

## 6. The reporting chain

Information is entered once, at the level where it is known, and rises through review without being retyped.

```text
Department entry
      ↓  submission and department approval
Weekly Report
      ↓  compilation of approved weeks
Monthly Report
      ↓  consolidation across the portfolio
Executive Summary Report
      ↓
Chairman Dashboard
```

### Weekly Report

Each contributing department records its own progress, activities, risks, issues, and commitments for the week. The department reviews and submits its own contribution; the project assembles the submissions into a Weekly Report; project control reviews, returns for correction where necessary, and finalizes. Outstanding submissions are visible throughout, so chasing is a matter of looking rather than asking.

The Weekly Report is the operational source of truth. Everything above it is compiled from it.

Departments enter data in the platform by default. Structured offline exchange remains available for contributors who genuinely cannot, and is validated on the way in.

### Monthly Report

The Monthly Report is compiled from approved Weekly data rather than re-collected. Departments review the consolidated picture, month-specific commentary is added where the weekly detail does not tell the whole story, and the report is approved as the month's official position.

### Executive Summary Report

The Executive Summary Report is prepared from approved Monthly data. It is deliberately selective: it carries the decisions, exposures, and trends that leadership must act on, not every underlying entry. Authoring belongs to project control; leadership reads.

### Approval Workflow

One approval model governs every report, at every level.

Work moves through defined states — drafted, submitted, reviewed, approved, published, locked — and only along permitted transitions. Every transition is performed by a named person holding the authority for that stage, on that project, for that department. Work can be **returned** for correction with a reason attached, which is a normal and expected step rather than a failure.

Three rules hold everywhere:

- **A report is compiled from approved data beneath it, never re-entered.**
- **Approved data is not edited in place.** It is superseded by a new revision, and the earlier version remains readable (§13).
- **Nothing advances silently.** Every stage has an owner, and the platform makes the current owner and the next required action visible at all times.

The same model applies to the Weekly, the Monthly, and the Executive Summary, so a person who understands approval on one understands it everywhere.

## 7. Chairman Dashboard

Dashboards in EPRP are layered. Each layer serves a different altitude of decision, and all three draw on the same approved information — so the Chairman and the engineer are never looking at different truths.

### Dashboard Workspace

The **Dashboard Workspace** is the working view for a single project. It is where the project team and project control see their own project in full: current progress against plan, KPI performance, open risks and issues, outstanding submissions, pending approvals, recent activity, and what is due next.

It is a workspace rather than a display. From it, the people running the project reach the work that needs doing.

### Portfolio Dashboard

The **Portfolio Dashboard** is the management view across projects. It shows every project side by side on comparable measures, surfaces which are on track and which are not, and makes patterns visible that no single project reveals — a department under strain across several projects, a risk type recurring, a phase where slippage habitually begins.

It is the working instrument of project control and senior management: the view from which attention is allocated.

### Chairman Dashboard

The **Chairman Dashboard** is the portfolio view for the Chairman and senior leadership. It answers three questions immediately:

1. Where does the portfolio stand?
2. What is at risk, and how badly?
3. What requires a decision now?

It is a leadership instrument, not a data-entry surface. It presents approved information only, makes exceptions prominent rather than burying them in averages, and allows any figure to be traced down to the project and department it came from. Confidence comes from that traceability: a number on the Chairman's screen can always be explained.

### Project Health

**Project Health** is the single composite indicator that summarizes a project's condition, so that a portfolio of many projects can be read at a glance without flattening the detail behind it.

Health is derived from the project's own configured measures — progress against plan, schedule position, risk exposure, criticality, quality and safety standing, and the discipline of its reporting. It is calculated consistently, never entered by hand, and never negotiated.

Two properties make it trustworthy: it is **explainable** — health can always be opened to show which factors drove it — and it is **honest**, degrading visibly when reporting is incomplete rather than presenting a confident figure built on missing data. A green project with no submissions is reported as unknown, not as healthy.

## 8. Analytics

Analytics turns the accumulated record into insight. Because every project reports through the same structure, EPRP can compare across departments, systems, programs and studies, project types, and time.

It answers questions such as: which departments consistently deliver on plan; where schedule slippage begins rather than where it becomes visible; how this project compares with earlier projects of the same type; whether a risk profile is improving or worsening; where effort is concentrated relative to progress achieved.

Analytics is forward-looking. Reporting explains what happened; analytics indicates what is likely to happen next.

### Risk Matrix

The **Risk Matrix** is the platform's standard instrument for assessing and presenting risk. Every risk raised on any project is evaluated on the same scales of likelihood and impact, positioned on a common matrix, and assigned a resulting severity that determines the attention it receives and the level at which it must be escalated.

A shared scale is what makes risk comparable. Because all projects assess risk the same way, exposure can be aggregated across the portfolio and a genuinely severe risk on a small project is not lost behind a moderate one on a large project. Each risk carries its owner, its response, and its movement over time — so the register shows not just what is threatened, but whether it is being managed.

### Criticality Matrix

The **Criticality Matrix** ranks the importance of the work itself, independently of how it is currently performing. It establishes which systems, programmes, and studies matter most to the project's outcome — by consequence of failure, by dependency, by regulatory or safety weight.

Criticality and health are deliberately separate readings. Together they set priority: a delay on critical work demands a different response from an identical delay on peripheral work. Without criticality, every problem competes for attention on equal footing and the most important work is not reliably protected.

## 9. Notification Center

The **Notification Center** is where the platform tells people what needs their attention, instead of relying on someone remembering to ask.

It covers submissions due and overdue, items awaiting review or approval, work returned for correction, delegations starting and expiring, comments and mentions directed at a person, meetings and decisions requiring them, and reports published. Notifications are scoped to the recipient's actual responsibility — people are notified about their own work, not about everything — and each one leads directly to the action it concerns.

The Center is also the record: what was raised, to whom, when, and whether it was acted on. Notification is part of the platform's accountability, not a convenience layer on top of it.

The intent is to remove chasing from the process entirely.

## 10. Meeting Center and Calendar

Project control is a cycle of meetings as much as a cycle of reports, and the two belong together.

### Meeting Center

The **Meeting Center** is where project meetings are arranged, held against live project information, and turned into record. Attendees are drawn from the project's own contacts and organization chart. Agendas are built from what the project actually shows — outstanding submissions, open risks, decisions required — rather than assembled by hand.

What the meeting produces stays with the project: decisions taken, actions assigned with owners and dates, and minutes retained under the project's record. An action agreed in a meeting becomes a tracked commitment, visible in the responsible person's own view and in the project's reporting, not a line in someone's notebook.

### Calendar

The **Calendar** presents the project's timeline of obligation in one place: reporting deadlines, submission cut-offs, review and approval dates, delegation periods, meetings, and milestones. Each person sees what is expected of them and when, across every project they are assigned to.

Together, the Meeting Center and Calendar close the loop between what was reported, what was discussed, what was decided, and what happens next.

## 11. Report Center, Knowledge Center, and the Google Drive Archive

### Report Center

The **Report Center** is the library of everything the platform has issued. Every Weekly, Monthly, and Executive Summary Report is retained with its project, under its revision, with the approval that authorized it and the period it covers.

It is the place to answer "what did we report, and when" — to retrieve the exact document issued at a past date, to compare one period against another, and to establish what leadership had been told at the time a decision was taken. Reports are found by project, type, period, revision, or status, and each remains exactly as approved.

### Knowledge Center

The **Knowledge Center** is where the organization's accumulated project knowledge is kept and made usable: standards and procedures, templates and reference material, technical documentation, and the lessons learned that projects generate and normally lose.

Its purpose is that experience should outlast the project that produced it. Knowledge is organized so that a new project can start from what the organization already knows, and connected to the projects and project types it applies to, so it surfaces where it is relevant rather than sitting in a folder nobody opens.

Supporting material — evidence, correspondence, technical attachments — is held against the project element it belongs to, so context is never separated from content.

### Google Drive Archive

The **Google Drive Archive** connects the platform's libraries to the environment EPROM already works in. Published reports and project documents are made available in Drive automatically, in the correct project folder, so that people who do not work in the platform daily still receive authoritative output through a familiar channel — and so that a durable, independently accessible archive of issued documents exists outside the application.

The governing rule: **the platform is the source of truth; Drive is an archive and distribution channel.** A document in Drive is a copy of an approved record, never the master, and the platform remains fully functional if the archive is unavailable.

## 12. Export: PDF, Word, and Excel

Reports leave the platform in the format their audience needs, without reformatting by hand.

- **PDF** — the professional, print-ready, A4 form for distribution, review, and archive. This is the presentation-quality output the platform is judged on.
- **Word** — for documents that will be extended or incorporated into wider correspondence.
- **Excel** — for structured data that will be analyzed further, and for structured exchange with contributors working offline.

Exported output carries the project's own identity — client, branding, reference, period, revision, and approval — so a document is self-describing once it leaves the system.

## 13. Audit Trail and Revision History

EPRP is a system of record. Two guarantees make it one.

### Audit Trail

Every consequential action is attributed and timestamped: who entered a figure, who submitted, who approved, who returned work and why, who changed a configuration, who granted or removed a permission, who published a report, who accessed restricted information. The trail is a permanent record, not a rolling log, and it is not editable by anyone — including administrators.

### Revision History

Approved reports are immutable. When information must change after approval, a new revision is issued; the previous revision remains readable exactly as it was approved, with the reason for the change recorded. Comments and entries retain their original text alongside subsequent edits, and removal is reversible rather than destructive.

Configuration is versioned on the same principle: changing a project's structure or its measures does not silently rewrite the history reported under the previous arrangement.

The commitment is simple: **the platform can always show what was known, and what was said, at the time a decision was taken.** Without it, no report is defensible.

## 14. Professional experience

EPRP is used by engineers under deadline pressure and read by the Chairman. It must serve both.

- **Clear, not decorative.** Density where experts need it, summary where leadership needs it.
- **Consistent.** The same patterns, wording, and behavior everywhere, so competence with one module transfers to the next.
- **Guiding.** The platform makes the next required action obvious, and explains why something is blocked rather than merely refusing.
- **Honest.** Incomplete and approved information are visibly distinguished. Nothing is presented as more certain than it is.
- **Fast and dependable.** Reliability at the moment of use is a functional requirement.
- **Presentation-quality output.** A report leaving EPRP must be fit to place in front of the Chairman with no rework.

## 15. Scalable and future-ready

The platform is built to grow along four axes: more projects, more users, more history, and more capability.

- **Structure is configured, never hardcoded.** New clients, departments, systems, programs and studies, project types, measures, and job titles are added by administrators as the business changes.
- **The project boundary holds.** Adding projects does not degrade performance, dilute permissions, or complicate any single project's experience.
- **History accumulates without penalty.** Years of reporting become an asset for analytics, not a burden.
- **Modules are separable.** Reporting, dashboards, analytics, meetings, documents, and distribution evolve independently; a new capability is added without disturbing what already works.
- **Integration is a channel, not a dependency.** External systems — Drive today, others later — attach at defined boundaries. The platform remains fully functional if an integration is unavailable.

### AI-ready architecture

EPRP is designed so that artificial intelligence can be applied to it later without redesigning it — and equally, so that the platform is complete and valuable without any AI at all.

Readiness comes from the discipline the platform already imposes rather than from anything added for its own sake. Because information is structured, consistently classified across projects, attributed to people, timestamped, and preserved with its history, the organization accumulates exactly the kind of record that machine assistance requires. A platform of free-text documents cannot be made intelligent afterwards; a platform of governed, structured, historical data can.

The intended direction is assistance, not automation of judgement: drafting summaries from approved data for a person to review, surfacing risks that resemble ones that materialized before, flagging anomalies in reported figures, predicting where a schedule is likely to slip, and answering questions across the accumulated record.

Two constraints are permanent. **AI may propose; it may not approve** — every workflow stage in §6 remains owned by a named, accountable person. And **AI output must be traceable to the approved data it came from**, subject to the same standard of explanation as every other figure in the platform.

## 16. What EPRP is deliberately not

Stated so the boundary is not eroded by increments:

- Not a public or multi-company product. EPRP is internal to EPROM.
- Not a subscription service. There is no payment, billing, or public registration.
- Not a general document store. Documents are held because they belong to a project or to the organization's project knowledge.
- Not a replacement for detailed planning or scheduling tools. EPRP controls and reports progress; it does not maintain the schedule itself.
- Not a chat platform. Discussion is attached to project records, where it stays in context.
- Not an autonomous decision-maker. Accountability rests with people.

## 17. How this document is used

This document defines **the complete product scope of EPRP** — what the platform is, what it is made of, and why. It is the single source of truth for the platform as a product. Where any other document, plan, or implementation implies a different answer to *what EPRP is*, this document governs and the difference is reconciled deliberately.

It deliberately contains no implementation, technical, or data design detail. The remaining documents elaborate how individual parts behave:

- Reporting mechanics: [`archive/reporting-architecture-v1.md`](archive/reporting-architecture-v1.md)
- Report states, submission, review, and approval: [`04_WORKFLOW_ENGINE.md`](04_WORKFLOW_ENGINE.md)
- The leadership report and portfolio view: [`12_REPORT_GENERATION.md`](12_REPORT_GENERATION.md)
- Weekly Report specification: [`specs/weekly-report.md`](specs/weekly-report.md)
- Collaboration, roles, and delegation: [`05_PERMISSION_MODEL.md`](05_PERMISSION_MODEL.md)
- **Current build status and delivery order: [`15_DEVELOPMENT_ROADMAP.md`](15_DEVELOPMENT_ROADMAP.md)**

This document describes the complete product. It is the target, not a statement of what is built today; the roadmap is the authority on current status.

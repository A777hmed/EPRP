# EPRP UI/UX Guidelines — Enterprise Design System

## 1. Purpose and authority

This document is the **single UI/UX reference** for the EPROM Progress Report platform. Every current and future screen conforms to it.

It defines how the platform looks, how it behaves, how it responds, and how it communicates state. It is a **product specification**: it contains no implementation code, no React, no CSS, and no markup. Where it names a design token, that token is design vocabulary — the canonical values live in the application's own token definitions, not here.

Its place in the canonical sequence:

| Document | Authority |
|---|---|
| [`01_PROJECT_VISION.md`](01_PROJECT_VISION.md) | What the platform is |
| [`02_PLATFORM_ARCHITECTURE.md`](02_PLATFORM_ARCHITECTURE.md) | Ownership and permission architecture |
| [`03_REPORTING_ARCHITECTURE.md`](03_REPORTING_ARCHITECTURE.md) | The reporting engine |
| [`06_DATABASE_SCHEMA.md`](06_DATABASE_SCHEMA.md) | The entities and what they mean |
| **This document** | **How all of it is presented and operated** |

Where a screen and this document disagree, this document governs.

### 1.1 Topic index

| Topic | § | Topic | § |
|---|---|---|---|
| Design principles | 3 | Notification Center | 18 |
| Brand identity | 4 | Report Center | 19 |
| Login experience | 5 | Document Center | 20 |
| Workspace selection | 6 | Attachments | 21 |
| Global layout | 7 | Report Preview | 22 |
| **Personal Profile Avatar** | **8** | Export experience | 23 |
| Dashboard experience | 9 | Mobile and tablet | 24 |
| **Monthly Schedule Dashboard** | **10** | Empty states | 25 |
| Weekly UI | 11 | Loading states | 26 |
| Monthly UI | 12 | Error states | 27 |
| Executive Summary UI | 13 | Success states | 28 |
| Chairman Report UI | 14 | Printing | 29 |
| Organization Chart UI | 15 | Dark / light readiness | 30 |
| Contact Center UI | 16 | Future AI readiness | 31 |
| Calendar & Meeting Center | 17 | Component inventory | 32 |

---

## 2. Platform decisions this document implements

Every decision below is already approved. This document defines **how each one appears and behaves**.

| Decision | Realized in |
|---|---|
| Everyone can open pages in read-only mode | §3.2, §7.6 |
| Editing depends on permissions | §3.2, §7.6 |
| Monthly is generated from Weekly and remains editable | §12 |
| Executive Summary is generated from approved Monthly | §13 |
| Chairman Report is generated from approved Executive data | §14 |
| Organization Chart is printable as a standalone report | §15.4 |
| Dashboard shows all projects | §9.3 |
| Calendar displays meetings and project activities | §10, §17 |
| Timeline is dynamic based on Project Type | §9.6, §11.2 |
| Programs & Studies naming is configurable by Project Type | §3.6 |
| Notification Center supports Admin and Project Control messages | §18 |
| Login uses project workspaces | §5, §6 |
| User avatar is illustrated / cartoon style | §8 |
| Avatar generated from uploaded photo or selectable library | §8.2 |
| Avatar in TopBar, Notifications, Messages, Comments, Organization Chart | §8.3 |
| Online / offline indicator | §8.5 |
| Profile editing | §8.6 |
| Dedicated Monthly Schedule — Month / Week / Day views | §10.2 |
| All project activities in one calendar | §10.3 |
| Filter by Project, Department, System, Programs & Studies | §10.4 |
| Schedule widgets — due today, overdue, upcoming, this week, this month | §10.5 |
| Schedule feeds Portfolio, Weekly, Monthly, Executive Summary | §10.6 |
| Excel schedule import | §10.7 |
| Primavera and Google Calendar — future ready | §10.8 |
| Weekly and Monthly completable from platform or email deep link | §11.5 |
| Automatic reminders for overdue reports | §18.3 |
| Dashboard supports project completion calculator | §9.7 |
| Dashboard supports project health indicators | §9.8 |
| Dashboard supports schedule progress | §9.9 |
| Reports support PDF, Word and Excel | §23 |

---

## 3. Design principles

Seven principles. Where they conflict, the earlier one wins.

### 3.1 Enterprise first, decoration never

EPRP is used by engineers under deadline pressure and read by the Chairman. Every visual decision serves comprehension, not impression. Density where experts need it; summary where leadership needs it. Nothing is added because it looks impressive.

### 3.2 Read-only is the default state, not an error

**Every authenticated user may open every page.** A user without permission for an action sees **the same page**, fully rendered, in read-only mode.

This is the platform's defining interaction rule. It means:

| Required | Forbidden |
|---|---|
| The same page, same layout, same data | A different "viewer" page |
| A clear, calm read-only indicator | An "access denied" screen |
| Action controls **visible but disabled**, with the reason on hover and focus | Hiding controls so the user cannot tell an action exists |
| Read-only presented as normal | Read-only presented as a failure or a lockout |

A disabled control always explains itself: *why* it is unavailable, and *what would make it available*. "You need Edit permission on this project" is useful. A greyed button with no explanation is not.

### 3.3 Modern, premium, dynamic — earned through restraint

Premium comes from precision: consistent spacing, deliberate typography, generous whitespace, soft elevation, and motion that clarifies. It never comes from gradients, glow, or ornament.

**Dynamic** means the interface responds — content updates without a full reload, state changes are animated briefly, and the next action is always evident. It does not mean constant movement.

### 3.4 Minimal clicks

| Journey | Target |
|---|---|
| Sign in → working on the current Weekly | ≤ 3 clicks |
| Any dashboard → the record behind any figure | 1 click (drill-down) |
| Open a report → begin editing an editable section | ≤ 2 clicks |
| Anywhere → global search result | 1 keystroke to open search, then type |
| Switch project workspace | ≤ 2 clicks, no sign-out |
| Notification → the item it concerns | 1 click |

Destructive and irreversible actions are the deliberate exception: they always require confirmation (§28.3).

### 3.5 Consistency

The same pattern means the same thing everywhere. A status badge, a section card, an empty state, a return reason, a save affordance — each behaves identically in every module. Competence with one screen transfers to the next.

**No module invents its own pattern for a problem the design system has already solved.**

### 3.6 The platform speaks each project's language

Hierarchy terminology is configuration (`06` §7). The level beneath a System displays as **Programs & Studies**, **Disciplines**, or whatever the Project Type declares.

| Rule | Detail |
|---|---|
| Labels come from the project's Hierarchy Profile | Never hardcoded in a screen |
| Terminology changes wording only | It never changes layout, behaviour, or what is stored |
| Historical reports keep their own wording | A report re-renders in the vocabulary it was issued under |
| Plural, singular, and sentence-case forms all resolve | No screen builds a plural by appending "s" |

### 3.7 Accessibility is a requirement, not a setting

| Requirement | Standard |
|---|---|
| Contrast | WCAG 2.2 AA minimum for all text and meaningful non-text |
| Keyboard | Every action reachable and operable by keyboard; visible focus always |
| Focus order | Follows visual order; focus is trapped in modals and returned on close |
| Colour | **Never the sole carrier of meaning** — always paired with text, icon, or shape |
| Motion | Honours reduced-motion preference; motion is removed, not merely shortened |
| Labels | Every control has an accessible name; icon-only buttons always carry one |
| Live regions | Status changes, toasts and validation announce to assistive technology |
| Targets | Minimum 44×44 pt touch target on touch devices |
| Zoom | Usable to 200% without loss of content or function |

---

## 4. Brand identity

### 4.1 EPROM identity

The platform is internal to EPROM — Egyptian Projects Operation & Maintenance. Its identity is professional, engineering-led, and restrained.

### 4.2 Logo usage

| Asset | Use | Rules |
|---|---|---|
| **Full lockup** (mark + wordmark) | Login, report headers, printed output, expanded sidebar | Light backgrounds only. Preserve aspect ratio. |
| **Square mark** | Collapsed sidebar, favicon, compact contexts, avatars fallback | Never stretched or recoloured |

**Rules:** clear space of at least the mark's height on all sides · never recolour, rotate, outline, or add effects · never place on a busy background · never reconstruct the lockup from parts · client logos appear **beside** EPROM branding in reports, never combined into one mark.

### 4.3 Colour system

Colour is used **semantically**. A screen never selects a raw colour value; it selects a role.

| Role | Meaning | Typical use |
|---|---|---|
| **Primary** | EPROM brand action colour — deep blue | Primary buttons, active navigation, links, focus ring |
| **Sidebar** | Deep navy surface | The persistent sidebar only |
| **Background / Foreground** | Page surface and body text | Everywhere |
| **Card / Popover** | Raised surfaces | Cards, dialogs, menus |
| **Muted / Muted foreground** | De-emphasized surface and secondary text | Metadata, helper text, disabled states |
| **Border / Input / Ring** | Separation and focus | Dividers, field outlines, focus indication |
| **Success** | Approved, complete, on track | Status badges, confirmations |
| **Warning** | At risk, pending, attention needed | Status badges, migration and coverage warnings |
| **Info** | Neutral informational state | Scheduled, in review |
| **Destructive** | Error, rejected, overdue, delete | Errors, destructive actions |
| **Chart 1–5** | Categorical data series | Charts only |

**Rules:**

1. **Never use a raw colour value.** Only semantic roles.
2. **Colour never carries meaning alone** (§3.7). Every status colour is paired with a label and an icon.
3. **Chart colours are for series identity only** — never to signal status.
4. Status vocabulary is fixed platform-wide: Draft · Collecting · Under Review · Returned · Approved · Finalized · Locked · Archived, each with one colour role and one icon, everywhere.

### 4.4 Typography

| Level | Use | Character |
|---|---|---|
| Page title | One per page | Semibold, tight tracking, balanced wrapping |
| Section heading | Card and section titles | Semibold, smaller |
| Subsection | Grouping within a card | Medium weight |
| Body | Default reading text | Regular, comfortable line height |
| Secondary | Metadata, helper text, captions | Smaller, muted foreground |
| Numeric / code | Report numbers, codes, identifiers | Monospaced, tabular figures |

**Rules:** one type family for the interface, one monospaced family for identifiers · **tabular figures for all numeric columns** so digits align · sentence case for headings and labels — never all-caps for content · body text never smaller than 14 px equivalent · measure capped for readability in narrative blocks · titles use balanced wrapping, body uses pretty wrapping.

### 4.5 Icons

One icon family throughout, in a single stroke weight.

**Rules:** an icon **supports** a label, it does not replace one, except in a dense toolbar where the icon-only control still carries an accessible name and tooltip · one concept, one icon, forever · decorative icons are hidden from assistive technology · icons inherit text colour and never introduce a colour of their own · icon size scales with its adjacent text.

### 4.6 Cards, elevation and shadow

The **card** is the platform's primary container. Content lives in cards; pages are compositions of cards.

Three elevation levels only:

| Level | Use |
|---|---|
| **Soft** | Resting cards, list rows, panels |
| **Soft medium** | Hover on interactive cards, popovers, dropdowns |
| **Soft large** | Dialogs, sheets, and the command palette |

**Rules:** elevation communicates layering, never importance · a card carries a title, an optional description, and an optional action cluster in its header · no nested cards more than one level deep · borders and elevation are alternatives, not companions — a card uses one or the other.

### 4.7 Spacing and layout rhythm

A single spacing scale governs everything. Page padding steps up with viewport width; content is capped at a comfortable maximum width and centred.

**Rules:** all spacing comes from the scale — never an arbitrary value · vertical rhythm between sections is consistent across every module · related controls are grouped by proximity before they are grouped by border · dense tables use a tighter row rhythm than reading content, but the same scale.

### 4.8 Avatars

User avatars are **illustrated / cartoon style**, not photographs — one shape platform-wide, a fixed size set, and initials on a muted surface as the fallback.

**The full avatar specification is §8**: how an avatar is obtained, where it appears, presence indication, and profile editing.

### 4.9 Animation and motion

Motion **explains change**. It never decorates and never delays.

| Purpose | Duration | Behaviour |
|---|---|---|
| Hover, focus, small state change | ~100 ms | Immediate feedback |
| Panel, dropdown, popover open/close | ~200 ms | Fade with slight movement from origin |
| Dialog and sheet | ~200–300 ms | Fade and scale, or slide from edge |
| Page or section entrance | ~300–500 ms | Subtle fade and rise, once |
| Indeterminate progress | Continuous | Spinner or skeleton shimmer |

**Rules:**

1. **Reduced motion is honoured by removal**, not by shortening. When a user prefers reduced motion, entrance animations and spinners' rotation are suppressed; the interface still communicates state through text and shape.
2. **Nothing animates on every render.** Entrance animation plays once.
3. **Motion never blocks input.** A user can act during or immediately after any animation.
4. **No parallax, no auto-playing carousels, no attention-seeking loops** anywhere in the product interface. The login background (§5.2) is the single, deliberate exception.
5. Motion moves **from the element's origin** — a menu opens from its trigger, a sheet from its edge.

---

## 5. Login experience

### 5.1 Composition

A single centred column on a calm surface: EPROM full lockup · platform name and abbreviation · one line of context · the sign-in card · an internal-system notice · copyright.

The sign-in card contains: email · password with a show/hide toggle · **Remember me** · **Forgot password?** · the primary sign-in action.

### 5.2 Animated background

A **slow, low-contrast, non-repeating** ambient background behind the login surface. It must never compete with the form.

**Rules:** motion is slow enough to be unnoticeable when reading · contrast never drops below the accessibility threshold for the form above it · **fully suppressed under reduced-motion preference**, falling back to a static surface · it never delays the form becoming interactive · it is decorative and hidden from assistive technology.

### 5.3 Authentication behaviour

| Behaviour | Rule |
|---|---|
| Submission | The action shows a pending state and prevents double submission |
| Invalid credentials | One generic message. **Never reveals whether an account exists.** |
| Service unreachable | A **distinct** message — connectivity, not credentials. The two are never conflated. |
| Deep link | A sign-in prompted by a deep link returns the user to the original destination |
| Return destination | Only same-origin destinations are honoured |
| Errors | Announced to assistive technology and associated with the field where applicable |

### 5.4 Remember me

Extends the session on the current device only. It is presented plainly, defaults to off, and never implies the password is stored. It has no effect on permissions.

### 5.5 Forgot password

Opens a request screen taking an email address and returning **one acknowledgement regardless of whether an account exists**. The reset screen enforces the password rules with live, specific guidance, and confirms success before returning to sign-in.

### 5.6 Version display

The platform version is shown **discreetly** at the foot of the login page — small, muted, selectable text. It supports support and diagnostics and is the only place a version number appears prominently.

---

## 6. Workspace selection

### 6.1 What a workspace is

A **project workspace** is the project a user is currently focused on. It scopes navigation, dashboards and quick actions to one project.

> **A workspace is a focus, not a boundary.** Under the platform's read model (§3.2) every user may open every project. Selecting a workspace narrows *what the interface foregrounds*, never *what the user may see*.

### 6.2 After sign-in

| Situation | Behaviour |
|---|---|
| One relevant project | Enter it directly. No selector. |
| Several relevant projects | Show the **workspace selector** |
| A previous workspace is remembered | Enter it directly, with the selector one click away |
| No project assignment | Enter the Personal Dashboard (§9.2) |

The selector presents each project as a card: code · name · client · health indicator · current reporting period · outstanding items for this user. It is searchable and keyboard-navigable, and offers "all projects" as an explicit option leading to the Portfolio Dashboard.

### 6.3 Switching workspace

Switching is always available from the top bar, **never requires signing out**, and takes at most two clicks.

**Rules:** the current workspace is always visible in the top bar · switching preserves the equivalent page where one exists, otherwise lands on that project's dashboard · unsaved changes prompt before switching · the chosen workspace is remembered per user and device.

---

## 7. Global layout

```text
┌──────────┬──────────────────────────────────────────────────────┐
│          │  Breadcrumb    Workspace   Search  Bell  Msgs  Avatar│
│ SIDEBAR  ├──────────────────────────────────────────────────────┤
│          │  Page header · title · description · actions         │
│  nav     │                                                      │
│  groups  │  Content — composed of cards                         │
│          │                                                      │
└──────────┴──────────────────────────────────────────────────────┘
```

### 7.1 Sidebar

Persistent, dark navy, grouped navigation: Overview · Projects · Master Data · Reporting · Insights · System.

**Rules:** collapsible to icons, with the state remembered · the collapsed rail shows the square mark and icon-only items with tooltips · the active item and its group are always evident · a welcome card beneath the lockup shows the signed-in user · the project group expands to that project's sections when a workspace is active · it never scrolls away.

### 7.2 Top navigation

Holds breadcrumb · workspace switcher · global search · notification bell · messages · user menu. It is sticky and never obscures content.

### 7.3 Breadcrumb

Reflects the real hierarchy — Platform → Projects → Project → Section → Record. Every level except the current is a link; the current is plain text. Project names appear as names, never identifiers. It truncates from the middle on narrow viewports, never dropping the current page.

### 7.4 User profile

The avatar (§4.8) opens a menu with display name, job title, organization, availability status, profile and settings, theme preference (§30), and sign out. **Job title is descriptive and never implies permission.**

### 7.5 Notification bell, search and quick actions

| Element | Behaviour |
|---|---|
| **Notification bell** | Unread count as a badge; opens the Notification Center panel (§18). The count is exact up to a threshold, then "9+". |
| **Messages** | Separate from notifications: direct messages and announcements from Admin and Project Control |
| **Global search** | Opens with a keyboard shortcut from anywhere; searches projects, reports, contacts, documents, comment register entries and master data; grouped, keyboard-navigable results; recent items when empty |
| **Quick actions** | Contextual primary actions for the current page, in the page header — never a floating button |

### 7.6 Read-only presentation

When a user lacks permission for the actions on a page:

1. The page renders **completely**, with all data.
2. A calm, persistent **read-only indicator** appears in the page header — a badge, not a banner or alert.
3. Action controls remain **visible and disabled**, each explaining why on hover and focus.
4. Editable fields render as **values, not empty disabled inputs**.
5. Nothing suggests failure. Read-only is a normal mode of the page.

---

## 8. Personal Profile Avatar

### 8.1 Style and intent

User avatars are **illustrated / cartoon style** in a professional, modern register — the visual language used by contemporary enterprise platforms. They are never photographic portraits.

The intent is recognition without formality: a person becomes instantly identifiable across a dense interface without the platform turning into a photo directory. The style is consistent, restrained, and clearly of one family — never a mixture of illustration styles.

### 8.2 How an avatar is obtained

Three routes, in order of preference:

| Route | Behaviour |
|---|---|
| **Generated from an uploaded photo** | The user uploads a photograph; the platform derives an **illustrated avatar** from it. The photograph itself is never displayed as the avatar. |
| **Selected from the avatar library** | The user chooses from a curated library of illustrated avatars, with adjustable characteristics where offered |
| **Generated from identity** | Where the user has done neither, a deterministic illustrated avatar is generated from their identity, so it is stable and does not change between sessions |
| **Initials fallback** | Where illustration is unavailable, initials on a muted surface |

**Rules:** the avatar is stable — it never changes without the user's action · an uploaded photograph is input to generation, not the output · the library is curated for professional register, not novelty · the fallback never appears as a broken or empty state.

### 8.3 Where the avatar appears

The avatar is the platform's consistent representation of a person and appears wherever a person is referenced:

| Surface | Presentation |
|---|---|
| **Top bar** | The signed-in user; opens the user menu (§7.4) |
| **Sidebar welcome card** | The signed-in user, with display name and role label |
| **Notifications** | The person whose action raised the notification |
| **Messages** | Sender on every message and announcement |
| **Comments** | Author on every comment and Comment Register entry, and on every version in its history |
| **Organization Chart** | The holder of each position; a vacant position shows a distinct vacancy mark, never an avatar |
| **Contact Center** | Directory entries and contact detail |
| **Meetings** | Attendee lists, decisions and action owners |
| **Reports** | Prepared / Reviewed / Approved attribution where space allows |
| **Assignment and delegation** | The delegator and delegate on every delegation record |

**Rule:** the same person renders with the same avatar on every surface. A person is never represented by an avatar in one place and a plain name in another within the same view.

### 8.4 Sizes and shape

One shape platform-wide and a fixed size set — compact (dense lists, comment threads, chart nodes), default (top bar, directory rows, attendee lists), and large (profile, contact detail). Sizes come from the scale (§4.7); no surface invents an intermediate size.

Where many people appear together, avatars may present as an overlapping group with a stated overflow count rather than wrapping indefinitely.

### 8.5 Online / offline indicator

A small presence indicator may accompany the avatar.

| State | Meaning |
|---|---|
| **Online** | Currently active in the platform |
| **Offline** | Not currently active |
| **Away / Busy / On Leave** | Declared availability from the user's profile |
| **Delegated** | Authority currently delegated to someone else (`06` §8.6) |

**Rules:**

1. **Presence is informational and never implies permission.** An offline Department Manager retains every authority they hold.
2. Presence **never blocks an action** and never gates a workflow.
3. It is **never conveyed by colour alone** — shape, position and an accessible label carry the meaning too (§3.7).
4. It is suppressed in dense contexts where it would add noise rather than information, and **never printed** (§29).
5. A user may hide their presence; hidden presence renders as no indicator, not as offline.

### 8.6 Profile editing

The user edits their own profile from the user menu (§7.4). The profile screen presents:

- Avatar, with the three routes in §8.2 and a live preview before saving
- Display name
- Job title — **descriptive only, never a permission** (§3.2)
- Organization
- Contact details
- Availability status and presence visibility
- Theme preference (§30)
- Language and locale

**Rules:** avatar changes preview before they are committed, and are reversible · a user edits their own profile; editing another person's requires the relevant Admin action and follows the read-only rule (§3.2) for everyone else · changes propagate everywhere the avatar appears without requiring a reload · the profile never presents any field that grants authority.

### 8.7 Rules

1. **Accessible name always.** Every avatar carries the person's name as its accessible name; decorative duplicates beside a visible name are hidden from assistive technology.
2. **Never the only identifier.** In lists, records and attribution, the avatar accompanies the person's name — it never replaces it.
3. **Print.** Avatars are omitted from printed reports except where a layout explicitly includes them, such as Organization Chart pages (§15.4).
4. **Theme.** Avatars are legible on both light and dark surfaces (§30).

---

## 9. Dashboard experience

### 9.1 Common rules

**Dashboards read approved reporting output; they never recompute** (`03` §21). Consequently:

| Rule | Detail |
|---|---|
| Every figure is traceable | One click opens the source project, period and report |
| Coverage is always visible | Each panel states the period it reflects and what is missing |
| Absence is never zero | Missing data reads *Unknown* or *Not reported*, never 0 |
| Unapproved data is labelled | Only the project workspace may show an in-progress cycle, always marked |
| Widgets declare their source | A widget never computes figures independently of the reporting engine |

### 9.2 Personal Dashboard

The user's own landing surface — "what needs me".

Contains: outstanding submissions assigned to me · items awaiting my review or approval · work returned to me with reasons · my open actions and their due dates · my upcoming meetings and deadlines · **the scheduled activities for the selected month**, filtered to me from the Monthly Schedule (§10.6) · recent notifications · my projects.

### 9.3 Portfolio Dashboard

**Shows all projects**, consistent with universal read visibility.

Contains: project cards with health, progress and current period · portfolio KPI tiles with coverage basis · health distribution · exception list — at risk, delayed, not reporting · reporting compliance · overdue reports and approvals · upcoming milestones.

Filterable by client, project type, project manager, status and period; sortable by health, progress, or exposure.

### 9.4 Project Dashboard

The working view for one project: progress planned versus actual · KPI tiles against targets · **lifecycle stage progress** (§9.6) · open risks and issues by severity · outstanding submissions · pending approvals · upcoming milestones and meetings · recent activity.

### 9.5 Chairman Dashboard

Leadership altitude. Approved data only, exceptions prominent, decisions required foremost. Deliberately sparse: fewer, larger, more consequential figures. Every number drills down.

### 9.6 Dynamic timeline

The project timeline is **driven by the project's own Lifecycle** (`06` §10), which is itself shaped by Project Type. It is never a fixed set of stages.

**Rules:** stages render in their configured order, with their configured colour and icon · a stage shows name, owner, dates, status and weight · milestones render as points on the timeline, visually distinct from stages · dependencies are indicated · archived stages are hidden by default and revealable · **no stage is assumed to exist** — a project without a Client Approval stage shows none.

### 9.7 Project completion calculator

A single figure showing overall project completion, with its working exposed.

**Rules:** derived from **weighted lifecycle stage progress and reported work progress** · never entered by hand · **always explainable** — opening it shows each contributing stage, its weight and its contribution · states its basis and coverage · reports *Unknown* rather than a confident figure when inputs are missing.

### 9.8 Project health indicators

Health is derived, explainable and honest (`06` §14.6).

| Presentation rule | Detail |
|---|---|
| Never colour alone | Always a label and an icon with the colour |
| Always explainable | One click reveals the contributing factors and their weights |
| Never editable | No override control exists anywhere in the interface |
| Honest under gaps | Incomplete reporting displays **Unknown** — visually distinct from healthy, and never green |
| Consistent | The same states, colours, icons and wording on every dashboard |

### 9.9 Schedule progress

Planned versus actual, shown as a comparison rather than two unrelated numbers: planned progress · actual progress · variance with direction · schedule performance where available · trend across periods.

**Rules:** variance always shows direction and magnitude · ahead and behind are distinguished by icon and label as well as colour · the baseline in force is stated.

### 9.10 KPI cards, charts and progress

**KPI card** — label · value with unit · target · variance with direction · trend sparkline where meaningful · coverage note. Values use tabular figures so columns align.

**Charts** — clear axis labels and units always · legends adjacent to data · **never rely on colour alone**, using shape, pattern or direct labelling · a stated period and coverage · an accessible tabular alternative · restraint in series count, aggregating a long tail rather than rendering it.

**Progress** — one progress presentation platform-wide, always with a numeric value beside the bar, always stating what it measures.

---

## 10. Monthly Schedule Dashboard

A dedicated scheduling experience: **one calendar for everything the organization has committed to a date.**

### 10.1 Purpose and boundary

The Monthly Schedule Dashboard is the platform's primary schedule surface. It answers *what is happening, when, and what is late* — across every project at once.

**It owns nothing.** Every entry originates in a record elsewhere and links back to it (`06` §18.1). Duplicating dates into schedule records would immediately produce two disagreeing answers to when something is due.

Its relationship to the Meeting Center (§17): this section owns the **calendar experience** — views, filters, widgets, import and integration. The Meeting Center owns **meetings as records** — agenda, attendees, decisions, actions and minutes. Meetings render here; they are managed there.

### 10.2 Views

| View | Purpose |
|---|---|
| **Month** | The default. The full month at a glance, with density indicated where a day is crowded |
| **Week** | A working week, with time-positioned meetings and all-day items banded above |
| **Day** | A single day in detail, for busy days and for mobile |
| **Agenda** | A chronological list — the accessible and mobile-friendly equivalent of every view above |

**Rules:** today is always unmistakable · the selected period is stated in words, never inferred from position alone · navigation moves by period and returns to today in one action · **the agenda view is a full equivalent**, never a degraded fallback · the working week comes from each project's own reporting configuration, so a project on a Sunday–Thursday week renders correctly.

### 10.3 What the calendar shows

All project activities appear in one calendar, across every project the reader chooses to include.

| Entry type | Source |
|---|---|
| **Project activities** | Project activity records, with planned start and finish |
| **Lifecycle stages** | Stage start and due dates, rendered as spans (`06` §10) |
| **Milestones** | Milestone target dates, rendered as points, visually distinct from spans |
| **Deadlines** | Submission cut-offs and approval deadlines |
| **Weekly due dates** | Per project, from its reporting cycle |
| **Monthly due dates** | Per project |
| **Executive report dates** | Executive Summary and Chairman Report periods and due dates |
| **Meetings** | Internal project meetings (§17) |
| **Client meetings** | Distinguished from internal meetings by type and label |
| **Approvals** | Items awaiting a decision, with their due date |
| **Delegation periods** | Start and end, shown as spans |
| **Reminders** | Scheduled reminders ahead of a dated item |

**Rules:** every entry is typed by **icon and label**, never colour alone (§3.7) · a span and a point are visually distinct · clicking any entry opens the underlying record · an overdue entry is unmistakable in every view · entries the reader cannot act on still appear, in read-only form (§3.2).

### 10.4 Filters

Filtering is the primary interaction, because the unfiltered calendar spans the whole portfolio.

| Filter | Behaviour |
|---|---|
| **Project** | One, several, or all. "All projects" is the default for portfolio roles; the current workspace is the default otherwise (§6) |
| **Department** | Scoped to the selected projects |
| **System** | Scoped to the selected departments |
| **Programs & Studies** | The hierarchy level beneath System, **rendered under each project's own configured label** (§3.6) |
| **Entry type** | Activities, milestones, deadlines, meetings, client meetings, approvals |
| **Owner** | The person accountable |
| **Status** | Not started · in progress · complete · overdue |

**Rules:** filters **cascade** — choosing a department narrows the systems offered, and choosing a system narrows the Programs & Studies offered · active filters are always visible with a one-action clear · a filtered empty result says filters are active and offers to clear them (§25) · **the Programs & Studies filter is labelled per project**, and where several projects with different terminology are selected, the filter presents the neutral hierarchy-level name with each project's own term shown against its entries · filter selections persist per user across sessions.

### 10.5 Dashboard widgets

Five widgets summarize the schedule. Each states its scope and period, and each links through to the filtered calendar.

| Widget | Shows |
|---|---|
| **Activities due today** | Everything dated today, ordered by time then priority |
| **Overdue activities** | Everything past its date and not complete, **ordered by how late it is**, with the overdue duration stated |
| **Upcoming activities** | The next items ahead, beyond today |
| **Activities this week** | The current working week, with completed and outstanding distinguished |
| **Activities this month** | The selected month, summarized by type and by status |

**Rules:** every widget states **what is missing as well as what is present** — a widget with nothing due says so explicitly rather than rendering blank (§25) · counts are exact and never rounded · overdue is always presented as a count **and** a list, never a count alone · widgets respect the reader's active filters · a widget never computes a figure the calendar itself would compute differently.

### 10.6 What the schedule feeds

The schedule is an input to four other surfaces. **They read it; none holds its own copy of a date.**

| Consumer | Uses |
|---|---|
| **Portfolio Dashboard** (§9.3) | Upcoming milestones · overdue activities across projects · schedule-driven exception list |
| **Weekly** (§11) | Activities and milestones falling in the reporting period; look-ahead context |
| **Monthly** (§12) | Activity and milestone movement across the month; schedule position for the period |
| **Executive Summary** (§13) | Milestone status and schedule exposure per project |

The **Personal Dashboard** (§9.2) shows this schedule filtered to the individual: their own activities, meetings and deadlines for the selected month.

### 10.7 Schedule import

**Excel schedule import** brings an externally maintained schedule into the platform.

The experience follows the platform's import discipline: upload · **validate before anything changes** · preview the result with every row's outcome shown — new, updated, unchanged, rejected with a reason · confirm explicitly · report what was imported.

**Rules:** import is **never silent and never partial without saying so** · a row that cannot be matched is reported, never guessed · **an import never overwrites approved reporting content** · every import is recorded with who, when, and what changed · the file is retained so an import can be explained afterwards.

### 10.8 Future-ready integrations

Two integrations are **planned and not yet available**. The interface is designed so that enabling them requires no rework.

| Integration | Intent | Status |
|---|---|---|
| **Primavera synchronization** | Align lifecycle stages, activities and milestones with the planning tool of record | **Future ready** |
| **Google Calendar** | Publish meetings and deadlines to each person's own calendar | **Future ready** |

**Design rules that make this possible now:**

1. **Every schedule entry declares its origin** — entered in the platform, imported, or synchronized — and displays it. A user must always be able to tell where a date came from.
2. **Synchronized entries are read-only in the platform** where the external system is the source of record, and say so rather than silently rejecting edits.
3. **Conflicts are surfaced, never auto-resolved.** Where an external system and the platform disagree, both values are shown and a person decides.
4. **The platform remains fully functional with every integration unavailable** (`01` §15). No schedule capability depends on an external system.
5. Integration status is visible in the schedule's own settings, never assumed.

### 10.9 Read-only and permission

The schedule follows the platform rule (§3.2): **every authenticated user may open it and see everything.** Creating, editing, importing and synchronizing depend on permission; the controls remain visible and disabled with their reason.

---

## 11. Weekly UI

### 11.1 One workspace, one data model

The Weekly Report is an **editable workspace**, not a form and not a document viewer. The workspace and the printable report present **the same data** (`06` §16.1). There is no separate print-entry model.

### 11.2 Composition

A persistent **status ribbon** — report number, period, status, revision, and the next required action — sits above sectioned content: report header and project information · KPI and progress summary · executive summary narrative · major activities · department and hierarchy updates (under the project's own terminology, §3.6) · risks, issues and actions · next-period plan and look-ahead · comments · attachments · approval and history.

A **section navigator** shows completion per section and jumps to any of them.

### 11.3 Department submission

A **submission tracker** shows every contributing department with its state — not started, in progress, submitted, returned, accepted — plus who owns it and whether it is late. Outstanding work is visible at a glance so chasing is looking, not asking.

A department user sees their own submission foregrounded and may read the rest (§3.2).

### 11.4 Review, return and approval

| Action | Presentation |
|---|---|
| **Return** | Requires a reason before it can be submitted. The reason is shown permanently with the returned item. |
| **Approve** | Confirms explicitly, states what becomes immutable, and cannot be undone |
| **Validation** | Blocking issues are listed with a direct link to each; the primary action states how many remain |
| **Lock** | Warns clearly that it is irreversible and that change will require a new revision |

### 11.5 Completion from platform or email

Weekly and Monthly contributions may be completed two ways:

1. **In the platform** — the default. A task in the Personal Dashboard opens the correct scope directly.
2. **From an email request carrying a smart deep link** — the link opens the exact project, department and period, signing the user in if needed and returning them to that destination afterwards.

**Rules:** a deep link never grants access beyond the recipient's own permission · it opens a real platform screen, never a separate lightweight form · an expired or already-completed link explains its state and offers the current destination · the email states project, period, department and deadline.

### 11.6 Editing and status

Editable sections show edit affordances only where the status permits (Draft, Collecting, Returned). Once approved, sections render as immutable content with an explicit indicator, and the only forward action is **Create Revision**.

---

## 12. Monthly UI

### 12.1 Generated, then edited

The Monthly Report is **generated from approved Weekly information and remains editable while its status is editable**.

The interface makes the distinction unmistakable:

| Content | Presentation |
|---|---|
| **Compiled from Weekly** | Visually marked as compiled, showing its source period and report. **Not editable here** — the control offers "open the source Weekly" instead |
| **Monthly-authored** | Ordinary editable content — narrative, manual additions, Monthly comments |

**A user must never be able to mistake one for the other**, because editing the wrong one is either impossible or wrong.

### 12.2 Coverage

A coverage panel states which Weekly Reports were compiled and which expected periods are missing. **A gap is displayed, never averaged away.** A three-of-four-week month says so, prominently.

### 12.3 Composition

Status ribbon · coverage panel · progress trend and planned-versus-actual · aggregated KPI trends and charts · major achievements · open risks, issues and actions with movement across the month · comment register entries flagged for Monthly · Monthly narrative · next-month plan · approval and history.

### 12.4 Source revision awareness

When a compiled Weekly is later revised, the Monthly displays a clear, non-blocking notice identifying what changed and offering to open it. **The Monthly is never silently updated.** Issuing a Monthly revision is a deliberate act.

---

## 13. Executive Summary UI

### 13.1 Generated from approved Monthly

Compiled from **approved Monthly Reports only**. The interface offers no route to include unapproved data.

### 13.2 Selection is the primary interaction

The Executive Summary is curated, not aggregated. Its editor presents **available** items — achievements, delays, risks, decisions, flagged comment register entries — and the author selects.

**Rules:** available and selected are both visible · **exclusion is recorded**, and the interface shows what was left out · selection is reversible while in draft · every selected item retains a drill-down reference to its source.

### 13.3 Composition

Portfolio or project KPIs · project health · major achievements · major delays · critical risks · decisions required with owner and due date · important comments · editable narrative · drill-down references throughout.

The narrative is editable until approval and clearly distinguished from compiled figures. **Narrative may interpret figures; the interface must never allow it to appear to replace them.**

---

## 14. Chairman Report UI

### 14.1 An independent report

The Chairman Report is **its own report level** with its own number, lifecycle, revisions and outputs. It is generated from **approved Executive data** and the Portfolio Summary. It is not a rendering of the Executive Summary.

### 14.2 Composition

| Part | Optional |
|---|---|
| Executive Brief | No |
| Portfolio dashboard | No |
| Project-by-project summaries | No |
| Important comments from **all** projects | No |
| Management decisions | No |
| Organization Chart pages | **Yes** |
| Appendices | **Yes** |

Optional parts are included or excluded through an explicit composition control, and the resulting contents list reflects the choice.

### 14.3 Presentation

Leadership altitude throughout: fewer figures, larger, each consequential. Exceptions surface rather than averaging into the middle. Every figure drills down to its project and period. The document is assembled for distribution, so its preview is page-accurate from the first screen (§22).

---

## 15. Organization Chart UI

### 15.1 A visual editor

A canvas presenting the project's structure of authority as an interactive tree: pan, zoom, zoom-to-fit, and a minimap for large charts. Positions render as compact cards showing title, holder, department and scope.

### 15.2 Editing

Add, edit, move and remove positions directly on the canvas. Reassignment is explicit and recorded. **A vacant position is a normal state**, rendered distinctly rather than hidden.

Editing follows the platform rule (§3.2): everyone may open and explore the chart; only permitted users may change it.

### 15.3 Chart status

Draft, Active and Locked are always visible. A locked chart is fully explorable and not editable, with the reason stated.

### 15.4 Printable as a standalone report

The Organization Chart is **printable and exportable as a report in its own right**, independent of any other report.

**Rules:** it carries full branding — EPROM logo, client logo, project identity, period, revision and approval block (§4.2, §29) · large charts paginate deliberately, by branch or by department, with a contents page and consistent orientation, never by arbitrary cropping · a legend explains roles and vacancy · it may also be included as optional pages in the Chairman Report (§14.2), where the version in force at approval is snapshotted.

---

## 16. Contact Center UI

### 16.1 A cross-project directory

The Contact Center presents contacts across all projects, which every authenticated user may read.

**Rules:** contacts are **project-owned** (`06` §8.2), so the same person may legitimately appear once per project · records are **never merged because names match** — the interface must never suggest they are the same record · where two contacts share a linked account, the interface may show them as one person across projects; where no account exists, they are presented as separate entries without implying a relationship.

### 16.2 Directory view

Searchable and filterable by project, department, role, job title and organization. Each entry shows avatar, name, job title, organization, project and assignment role.

### 16.3 Contact detail

Identity and contact information · job title and organization · the projects and departments they are assigned to with assignment role and functional title · reporting line, both directions · active delegations with their dates · linked account where one exists.

**Job title and functional title are shown as descriptive attributes and never presented as permissions** (§3.2, `06` §8.7).

### 16.4 Assignment editing

Assignment role, functional title and reporting line are edited in place, subject to the integrity rules (`06` §8.5):

| Rule | Interface behaviour |
|---|---|
| Department Manager reports to nobody | The Reports To control is disabled with the reason shown |
| Team Member Lead reports to the Department Manager | Only the manager is offered |
| Team Member reports to a Lead or the Manager | Only valid targets are offered |
| A department needs a manager | Stated once at department level, not repeated per person |
| Invalid assignments cannot be saved | The save action is disabled and states exactly what must be fixed |

**The picker never offers a choice that validation would reject.**

---

## 17. Calendar and Meeting Center

### 17.1 Division of responsibility

The **calendar experience** — Month, Week and Day views, cross-project filters, schedule widgets, import and integration — is specified in **§10, the Monthly Schedule Dashboard**. It is the platform's single schedule surface, and it displays meetings and project activities together with every other dated obligation.

**This section owns meetings as records**: how they are scheduled, what they capture, and what they produce. Meetings *render* in §10; they are *managed* here.

No second calendar exists. A module that needs to show dates uses §10 rather than building its own view (§3.5).

### 17.2 Meeting Center

Scheduling draws attendees from the project's own contacts and organization chart. An agenda is built from live project information — outstanding submissions, open risks, decisions required — rather than typed from scratch.

A meeting records decisions and actions. **Actions become tracked commitments** appearing in the owner's Personal Dashboard and in project reporting, not merely lines in minutes. Minutes are retained with the project.

### 17.3 Client meetings

Client meetings are meetings with an external audience. They carry the same record structure — attendees, agenda, decisions, actions, minutes — and are **typed distinctly** so they are identifiable at a glance in the schedule (§10.3) and can be filtered separately.

Attendees may include contacts with no platform account (`06` §8.2). Material intended for a client is marked as such before the meeting, so what is shared is a deliberate choice rather than an oversight.

### 17.4 Monthly activity schedule

Specified in **§10**. The home dashboard shows the scheduled activities for the selected month, filtered to the reader (§9.2, §10.6).

---

## 18. Notification Center

### 18.1 Notifications and messages are separate

| | Notifications | Messages |
|---|---|---|
| Origin | Platform events | A person — Admin or Project Control |
| Entry point | Bell | Messages icon |
| Nature | "This needs you" | "You should know" |
| Read state | Per recipient | Per recipient |

### 18.2 The panel

Opens from the bell. Grouped by recency, filterable by type and project, with unread visually distinct. Every entry states what happened, on what, in which project, and when — and **links directly to the item**. Actions: mark read, mark all read, open, and view full history.

### 18.3 Notification types

| Type | Example |
|---|---|
| **Admin message** | Announcement from a System Administrator |
| **Project Control message** | Direct message or instruction from Project Control |
| **Weekly reminder** | Your submission is due, or now overdue |
| **Monthly reminder** | Monthly compilation or approval due |
| **Approval notification** | Awaiting your approval · approved · returned with reason |
| **Mention** | You were mentioned in a comment |
| **Due date alert** | Action, milestone or lifecycle stage approaching or overdue |
| **Workflow** | Submitted · returned · finalized · locked · revision issued |
| **Meeting reminder** | Meeting upcoming · minutes issued |

**Automatic reminders for overdue reports** escalate on a defined schedule: to the owner first, then their lead, then the coordinator. **Every reminder states what is overdue, by how long, and links to it.**

### 18.4 Rules

Notification is targeted by **responsibility**, not by read permission — with universal read (§3.2), notification is what tells a person which work is theirs · read state is personal · **notification never advances a workflow**; it informs and a person acts · nothing is dismissed silently — history remains available.

---

## 19. Report Center

The library of everything the platform has issued, across all four report levels.

Browsable and filterable by project, report level, period, status and revision. Each entry shows report number, project, period, status, revision, approval and available formats.

**Rules:** an issued report is presented exactly as approved · superseded revisions remain retrievable and are clearly marked · comparison between two periods is available where meaningful · the current revision is unambiguous · draft reports are visibly separated from issued ones.

---

## 20. Document Center

Project documents and organizational knowledge, distinct from issued reports.

| Area | Content |
|---|---|
| **Project documents** | Material belonging to a project or one of its records |
| **Knowledge Base** | Standards, procedures, templates and lessons learned that outlive projects |

**Rules:** documents are browsable by project, category and date · knowledge is browsable by classification and applicable project type · every document states its owner, origin and date · promotion of a project document into the Knowledge Base is explicit and attributed · archive publication status is shown where applicable.

---

## 21. Attachments

Attachments appear **with the record they evidence** — never in a general pile.

**Rules:** an inline list on the owning record showing name, type, size, uploader and date · preview in place where the type allows, download otherwise · drag-and-drop upload with an equivalent keyboard-accessible control · clear progress during upload and a clear error on failure · **the attachment set is frozen at approval**, and the interface says so rather than silently disabling the control · attachments inherit their owner's visibility.

---

## 22. Report Preview

### 22.1 Page-accurate from the first screen

Preview shows the report **as it will print** — A4 page boundaries, real pagination, real headers and footers, real page numbers. It is not a styled web view that resembles the output.

### 22.2 Always visible in preview

| Element | Rule |
|---|---|
| EPROM logo and client logo | Per branding configuration (§4.2) |
| Document number, period, revision, status | Always |
| Prepared / Reviewed / Approved | With names and dates |
| Header and footer | Per the report's layout |
| Page numbers | Every page, "page N of M" |
| **QR code** | Resolving to that exact report revision |
| **Draft watermark** | On every page whenever the source is not an approved snapshot |
| Confidentiality label | Where configured |

### 22.3 Draft versus issued

**A preview of unapproved content is watermarked on every page, unmistakably and unremovably.** An unmarked draft leaving the platform is indistinguishable from a final document and will eventually be quoted as one.

An approved report previews from its **snapshot**, so it renders identically every time regardless of later changes.

### 22.4 Controls

Page navigation, zoom, fit-to-width, and export. Preview never offers editing — it returns the user to the workspace for that.

---

## 23. Export experience

### 23.1 The three formats

| Format | Purpose | Character |
|---|---|---|
| **PDF** | Distribution, review, print, archive | Presentation-quality, A4, print-ready. **The reference format.** |
| **Word** | Documents to be extended or incorporated | Structured and editable |
| **Excel** | Data for further analysis; structured offline exchange | Structured and machine-readable |

Excel applies where a report carries tabular data worth analysing; it is offered only where meaningful.

### 23.2 Behaviour

Export is initiated from the report or its preview, states which format and which revision, shows clear progress for long generations, and confirms on completion with a direct way to open the result. Failure explains what happened and offers retry.

**Rules:** every format carries the same identity and figures — format changes presentation, never content · a draft exports **watermarked** · an approved report exports from its snapshot · export respects the requester's permissions · every generation is recorded · a filename is predictable and self-describing, carrying project, report level, period and revision.

---

## 24. Mobile and tablet behaviour

### 24.1 Intent by device

| Device | Primary use |
|---|---|
| **Desktop** | Full authoring, review, approval, dashboards, chart editing |
| **Tablet** | Review, approval, dashboards, reading reports; light editing |
| **Mobile** | Checking status, reading, approving, responding to notifications |

**Every page is reachable and readable on every device.** Capability is never removed by device — only the layout adapts.

### 24.2 Adaptation

| Element | Small viewport |
|---|---|
| Sidebar | Collapses to an overlay drawer |
| Top bar | Condenses; search becomes an icon |
| Breadcrumb | Truncates from the middle, keeps the current page |
| Dashboard | Single column; cards stack in priority order |
| Wide tables | Scroll horizontally **within their own container** — the page never scrolls sideways |
| Dense tables | May present as stacked cards where that aids comprehension |
| Dialogs | Become full-height sheets |
| Actions | Move into the page header or an overflow menu, never a floating button |
| Charts | Simplify; series may aggregate. The tabular alternative remains reachable |
| Org chart | Read and explore fully; editing is desktop and tablet |

**Rules:** touch targets at least 44×44 pt · no hover-only interaction — everything reachable by tap and keyboard · forms use appropriate input types · the page body never scrolls horizontally.

---

## 25. Empty states

Every list, table, panel and dashboard widget defines its empty state. **An empty region is never simply blank.**

An empty state carries: an icon · a short title saying what is absent · one line explaining why · and, where the user can act, one primary action.

| Situation | Message character |
|---|---|
| Nothing created yet | Inviting, with the primary creation action |
| Filters exclude everything | States that filters are active, offers to clear them |
| Nothing yet in this period | Explains the period and offers to change it |
| **Nothing because it is not reported** | **Explicitly *not reported*, never zero and never healthy** |
| Empty because a prerequisite is missing | Names the prerequisite and links to it |
| Empty and the user cannot act | Explains plainly; offers no action rather than a disabled one |

---

## 26. Loading states

| Situation | Presentation |
|---|---|
| Page or section first load | **Skeletons** matching the shape of the incoming content |
| Action in progress | The control shows a pending state and prevents repeat submission |
| Long generation (export, compilation) | Determinate progress with a description of the stage |
| Background refresh | Subtle indicator; **existing content stays visible and usable** |
| Slow beyond expectation | An explanatory message appears rather than an indefinite spinner |

**Rules:** skeletons preserve layout so nothing shifts when content arrives · the interface never blocks entirely when only part is loading · spinner rotation is suppressed under reduced motion, with the pending state still conveyed by text · loading is announced to assistive technology.

---

## 27. Error states

### 27.1 Principles

An error states **what happened**, **what it means**, and **what to do next**. It never exposes internal detail, and it never blames the user.

### 27.2 Types

| Type | Presentation |
|---|---|
| **Field validation** | Inline, next to the field, on blur or submit; the field is marked invalid and described |
| **Form-level** | Summary at the top listing each problem with a link to it; the primary action states how many remain |
| **Action failure** | Toast or inline message with a retry where retrying is safe |
| **Connectivity** | Distinguished clearly from a permission or credential problem, with retry |
| **Permission** | Explains which permission is needed and who grants it. **Never an empty page** |
| **Not found** | Explains what was not found and offers the nearest valid destination |
| **Blocked by state** | Explains the state and what would unblock it — for example that approved content requires a revision |
| **Section failure** | Contained to its own card; the rest of the page keeps working |

**Rules:** errors are announced to assistive technology · a destructive action never fails silently · **an error never leaves the user without a next step**.

---

## 28. Success states

### 28.1 Proportionate confirmation

| Action | Confirmation |
|---|---|
| Autosave or minor save | Quiet inline indicator |
| Explicit save | Brief toast, and the updated state visible in place |
| Submit, approve, finalize | Clear confirmation naming what changed and what happens next |
| Lock or issue a revision | Prominent confirmation stating the consequence |
| Export | Confirmation with a direct way to open the result |

### 28.2 Rules

Confirmation is **specific** — "Weekly Report W-32 approved", not "Saved" · it never obscures the content it refers to · it dismisses itself while remaining reachable in notifications where consequential · the interface state updates to reflect the change immediately, never requiring a manual refresh.

### 28.3 Confirmation before consequence

Irreversible actions — approve, lock, issue a revision, archive, remove an assignment — require explicit confirmation that names the action, states what becomes immutable or is lost, and provides a clearly labelled cancel. **The confirming action is never the default focus.**

---

## 29. Printing guidelines

### 29.1 Print is a first-class output

Every report is designed for the page, not merely printable.

### 29.2 Rules

| Rule | Detail |
|---|---|
| Page size | A4, with consistent margins |
| Orientation | Portrait by default; landscape where a chart or chart page requires it, declared in the layout |
| Chrome removed | Navigation, sidebar, search, editing controls and interactive-only elements do not print |
| Backgrounds | Print-safe; content never depends on a coloured background to be legible |
| Colour | Every chart and status remains interpretable in **monochrome** |
| Page breaks | Deliberate — a table row, card or section never splits awkwardly; headings stay with their content |
| Repeating headers | Long tables repeat their header row on each page |
| Running header and footer | Report identity, period, revision and confidentiality on every page |
| Page numbers | "Page N of M" on every page |
| Links | Meaningful as text — a printed link never reads as "click here" |
| Watermark | Draft content is watermarked on **every** page |
| Overcrowding | Ranked content truncates with a stated count rather than overflowing |

### 29.3 The one-page discipline

Where a report specifies a single-page summary, it fits one page: compact KPI tiles, two or three compact charts, a narrative of a few lines, top-ranked items only, and a signature block. **Content is ranked and truncated, never shrunk below legibility.**

---

## 30. Dark and light mode readiness

### 30.1 Current position

The platform's design tokens are **already defined for both light and dark**, including surfaces, text, borders, semantic status roles and chart series. A user-facing theme toggle is **not yet wired**.

This document treats dark mode as a **readiness requirement**: every screen must be authored so that enabling the toggle requires no rework.

### 30.2 Authoring rules

1. **Every colour comes from a semantic token.** A raw colour value anywhere is a defect that will surface as an unreadable dark-mode screen.
2. **Never assume a light background.** Elevation, borders and overlays resolve through tokens.
3. **Semantic status roles carry their own dark values** — success, warning, info and destructive are defined for both themes.
4. **Chart series use the chart roles**, which are defined for both themes.
5. **Imagery declares its background requirement.** The EPROM full lockup is for light surfaces; the appropriate variant or the square mark is used on dark.
6. **Contrast is verified in both themes**, not only in light.
7. Elevation reads differently in dark: shadow alone is weaker, so layering uses surface tokens together with elevation.

### 30.3 When the toggle is enabled

Preference offers Light, Dark and System · it is remembered per user · switching does not reload the page or lose state · the initial paint matches the resolved preference with no flash of the wrong theme · print output remains light regardless of the interface theme.

---

## 31. Future AI readiness

### 31.1 Position

The platform is complete and valuable without AI. This section defines how assistance appears **when** it is introduced, so screens are designed now in a way that will accommodate it.

### 31.2 Where assistance may appear

| Surface | Assistance |
|---|---|
| Narrative fields | A draft summary proposed from approved data, for a person to review and edit |
| Risks | Similar risks that materialized previously, surfaced for consideration |
| Reported figures | Anomaly indication where a value departs from its pattern |
| Search | Natural-language questions across the accumulated record |
| Schedule | Indication of where slippage is likely |

### 31.3 Non-negotiable interface rules

1. **AI output is always visibly labelled as AI-generated.** It never appears as though a person wrote it.
2. **AI proposes; it never approves.** No AI element may perform or auto-confirm a workflow transition. Every approval remains a named person's act.
3. **Every AI output is traceable** to the approved data it derived from, through the same drill-down as any other figure.
4. **AI output is editable and rejectable**, and rejecting is as easy as accepting.
5. **Uncertainty is shown, not hidden.** Confidence is expressed plainly where it is meaningful.
6. **No AI element blocks a workflow** or delays a person from acting.
7. **Assistance is dismissible**, and the interface remains complete without it.

---

## 32. Component inventory

The design system's building blocks. **No module invents an alternative for a problem already solved here** (§3.5).

| Category | Components |
|---|---|
| **Layout** | Sidebar · Top bar · Breadcrumb · Page header · Section card |
| **Data display** | Stat card · KPI card · Status badge · Progress bar · Table · Chart |
| **State** | Empty state · Loading state / skeleton · Error state |
| **Input** | Field with label and description · Text · Textarea · Select · Multi-select · Managed selector with inline create · Clearable value control · Checkbox · Switch · Date picker · Search input · Filter bar |
| **Overlay** | Dialog · Sheet · Popover · Dropdown menu · Tooltip · Command palette · Confirmation dialog |
| **Feedback** | Toast · Alert · Inline validation message |
| **Identity** | Avatar · Avatar group with overflow · Presence indicator · Logo lockup · Logo mark |
| **Schedule** | Calendar (Month / Week / Day / Agenda) · Schedule entry (span and point) · Schedule filter bar · Schedule widget · Import preview |

Every component honours the states in §25–§28, the accessibility requirements in §3.7, and the motion rules in §4.9.

---

## 33. Specification versus as-built

This document is **specification**. Where the current application differs, this document governs.

| Area | As-built today | This document requires |
|---|---|---|
| Design tokens, semantic colours, shadows, radii | **Present and consistent** | Preserved as defined here |
| Shared component layer | **Present** — cards, states, badges, KPI and stat cards, filters | Extended, not replaced |
| Motion conventions | **Present** — reduced-motion honoured throughout | §4.9 |
| Sidebar, top bar, breadcrumb | **Present** | §7 |
| Login page | **Present**, professional | Add animated background, Remember me, version display (§5) |
| **Workspace selection** | **Does not exist** | §6 |
| Dark mode | **Tokens defined; toggle not wired** | §30 readiness rules |
| **Personal Profile Avatar** | **Does not exist** | §8 in full — generation, library, placement, presence, profile editing |
| Read-only presentation | Not applicable — no permission enforcement | §3.2, §7.6 |
| Global search, notifications, messages | **Present in the top bar but not wired** | §7.5, §18 |
| Dashboards | **Mock data**, calculated independently | §9 — read approved output |
| Weekly UI | **Present, partial** | §11 |
| **Monthly, Executive, Chairman UI** | **Do not exist** | §12, §13, §14 |
| Organization Chart UI | **Present** — canvas, minimap, templates | Add standalone printable report (§15.4) |
| Contact Center UI | Master-data views present | §16 |
| **Monthly Schedule Dashboard** | **Does not exist** | §10 in full — views, filters, widgets, feeds |
| **Schedule import (Excel)** | **Does not exist** | §10.7 |
| **Primavera / Google Calendar sync** | **Does not exist** | §10.8 — future ready; design rules apply now |
| **Meeting Center** | **Does not exist** | §17 |
| **Report Center, Document Center** | **Placeholders** | §19, §20 |
| **Attachments** | **Do not exist** | §21 |
| **Report preview, export, printing** | **Do not exist** | §22, §23, §29 |
| **AI surfaces** | **Do not exist** | §31 |

---

## 34. Document map

| Document | Defines |
|---|---|
| [`01_PROJECT_VISION.md`](01_PROJECT_VISION.md) | What the platform is |
| [`02_PLATFORM_ARCHITECTURE.md`](02_PLATFORM_ARCHITECTURE.md) | Ownership and permission architecture |
| [`03_REPORTING_ARCHITECTURE.md`](03_REPORTING_ARCHITECTURE.md) | The reporting engine |
| [`04_WORKFLOW_ENGINE.md`](04_WORKFLOW_ENGINE.md) | Report states and transitions |
| [`05_PERMISSION_MODEL.md`](05_PERMISSION_MODEL.md) | Roles, responsibility, delegation |
| [`06_DATABASE_SCHEMA.md`](06_DATABASE_SCHEMA.md) | The entities and what they mean |
| **This document** | **How the platform is presented and operated** |
| [`12_REPORT_GENERATION.md`](12_REPORT_GENERATION.md) | Executive Report composition and A4 output |
| [`15_DEVELOPMENT_ROADMAP.md`](15_DEVELOPMENT_ROADMAP.md) | **Current status and delivery order** |

This document is the authority on **user-facing experience**. It describes the complete design system. It is the target, not a statement of what is built today; the roadmap is the authority on current status.

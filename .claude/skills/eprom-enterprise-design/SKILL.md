---
name: eprom-enterprise-design
description: EPROM enterprise UX and visual design constitution for navigation, project workflows, reports, dashboards, charts, tables, forms, responsive behavior, and visual quality.
---


# EPROM Enterprise Design Constitution



## 1. Purpose



EPROM Progress Report is an enterprise Project Control and Project Performance

Management platform.



The product must feel:



\- professional

\- deliberate

\- bespoke

\- calm

\- structured

\- efficient

\- trustworthy

\- human-designed



It must NOT feel like:



\- a generic admin template

\- an AI-generated dashboard

\- a consumer mobile application

\- a collection of unrelated component-library examples

\- an Apple/macOS clone



The design objective is:



> Apple-level design discipline + modern interaction quality + EPROM enterprise clarity.



Apply Apple principles as design discipline, NOT literal visual imitation.



\---



\# 2. Priority Order



When design goals conflict, use this priority:



1\. Information hierarchy

2\. Readability

3\. Workflow clarity

4\. Data accuracy and meaning

5\. Consistency

6\. Accessibility

7\. Efficient use of space

8\. Visual polish

9\. Motion and delight



Never sacrifice workflow clarity or data readability for visual effects.



\---



\# 3. Enterprise Density



EPROM contains:



\- project-control data

\- tables

\- forms

\- reporting workflows

\- technical information

\- approvals

\- comments

\- milestones

\- management summaries

\- charts



Therefore:



\- preserve useful information density

\- use whitespace deliberately, not excessively

\- avoid oversized cards for small amounts of information

\- avoid large empty decorative regions

\- do not hide important data behind interaction unless necessary

\- prefer compact, scannable structures



Apple-inspired simplicity means removing confusion, NOT removing useful data.



\---



\# 4. Platform Navigation Architecture



Preferred shell direction:



GLOBAL ICON RAIL

→ CONTEXTUAL DETAIL SIDEBAR

→ MAIN WORKSPACE



\## Global Rail



The global rail should contain only major platform destinations.



Potential categories include:



\- Dashboard

\- Projects

\- Reporting

\- Calendar

\- Analytics / Executive

\- Documents

\- Access

\- Notifications

\- Settings

\- Help



Do not hardcode unused or fake modules.



Use the application's existing icon library.



Do NOT add a new icon dependency solely for styling.



\## Contextual Sidebar



When a project is active, the sidebar must clearly represent the project context.



Recommended conceptual hierarchy:



Project Overview



Project Setup

\- Project Information

\- Departments

\- Systems

\- Disciplines OR Programs \& Studies

\- Contacts

\- Review



Team \& Responsibilities



Planning \& Control

\- Master Milestones

\- future planning/tracker items when implemented



Reporting

\- Weekly

\- Monthly

\- Executive



Documents / References



Do not mix global navigation and project workflow into one visually flat menu.



\## Important Project Structure Rule



For PSM / PSAIM-style projects:



Project

→ Departments

→ Systems

→ Programs \& Studies



For other project types:



Project

→ Departments

→ Systems

→ Disciplines



Programs \& Studies and Disciplines are distinct concepts.



Never globally rename one into the other.



\---



\# 5. Navigation Rules



Users must always understand:



\- which project is active

\- which module is active

\- where they are in the workflow

\- what the next logical action is



Use:



\- strong active state

\- clear group hierarchy

\- restrained nesting

\- breadcrumbs where useful

\- concise labels

\- predictable ordering



Avoid:



\- deep nested menus

\- multiple unrelated active states

\- duplicate navigation routes

\- vague labels

\- excessive separators

\- menu items that visually appear equal when they are not



Collapsed navigation must preserve orientation through:



\- icons

\- tooltips

\- active-state indication



\---



\# 6. 21st.dev Adaptation Rules



Use external component references as inspiration only.



Useful interaction concepts:



\- compact icon rail

\- contextual secondary sidebar

\- clear active-state transitions

\- collapsible navigation

\- grouped workflow navigation

\- searchable navigation where genuinely useful

\- subtle interaction feedback



Do NOT:



\- copy/paste demo navigation architecture

\- retain fake placeholder content

\- inherit arbitrary dependencies

\- add Carbon icons merely because a reference uses them

\- use fixed demo heights such as 800px

\- copy generic SaaS labels

\- let component-library aesthetics override EPROM's workflow



External references must be adapted into EPROM-native components.



\---



\# 7. Apple Design Principles — Approved Use



Use the installed apple-design skill as a quality reference.



Apply:



\- restraint

\- strong hierarchy

\- clear typography

\- spatial consistency

\- immediate feedback

\- predictable interaction

\- visual continuity

\- polished details

\- purposeful animation

\- reduced-motion support

\- responsive interaction

\- real-context testing



Do NOT imitate Apple product appearance literally.



Do NOT automatically introduce:



\- translucent glass everywhere

\- large blur surfaces

\- floating consumer-style sheets

\- excessive spring animations

\- rubber-band interactions

\- swipe-first navigation

\- decorative depth

\- oversized whitespace

\- macOS-like chrome



For EPROM:



> clarity before motion  

> data before decoration  

> workflow before novelty



\---



\# 8. Motion



Motion must communicate:



\- state change

\- focus

\- navigation

\- cause and effect



Motion must NOT be decorative noise.



Preferred:



\- subtle active-state transitions

\- short opacity transitions

\- small positional transitions

\- gentle expand/collapse behavior



Avoid:



\- bouncing

\- large spring overshoot

\- continuous decorative animation

\- motion inside dense tables

\- animation that delays task completion



Respect:



prefers-reduced-motion



Where motion is not necessary, do not animate.



\---



\# 9. Typography



Use the application's existing font system.



Do not add a new font library without explicit approval.



Maintain a consistent hierarchy:



\## Page

Page title

Page subtitle/context



\## Report

Report title

Section title

Subsection title



\## Data

KPI label

KPI value

Table header

Table value



\## Metadata

Field label

Field value

Helper text

Empty-state text



Rules:



\- avoid random font sizes

\- avoid inconsistent font weights

\- avoid excessive uppercase body text

\- use tabular numerals for aligned numeric data

\- use restrained letter spacing

\- maintain readable line height

\- clamp long project names where appropriate

\- preserve full meaning through tooltip/title when truncating



\---



\# 10. Color



EPROM branding remains primary.



Use color semantically.



Examples:



\- success / completed

\- warning / attention

\- delayed / negative

\- information

\- neutral / no-data



Do not use color as decoration.



Do not create new semantic colors without reason.



Never rely on color alone to communicate status.



Use label + icon/text where appropriate.



\---



\# 11. Cards and Containers



Cards are NOT the default solution for every section.



Use cards when they represent:



\- a distinct entity

\- a summary

\- a self-contained actionable unit



Prefer:



\- structured sections

\- tables

\- grouped rows

\- subtle separators



over endless nested cards.



Avoid:



\- excessive border radius

\- excessive shadows

\- card-inside-card layouts

\- dashboard-template appearance



EPROM should feel structured, not bubbly.



\---



\# 12. Forms



Forms must prioritize completion speed and clarity.



Use:



\- logical groups

\- visible required fields

\- clear validation

\- semantic helper text

\- predictable Save / Cancel placement

\- meaningful section completion state



Do not:



\- show raw validation/database errors

\- expose null/undefined

\- hide required context

\- make users search elsewhere for editable master data unnecessarily



Future managed fields should support:



\- searchable autocomplete

\- inline Add / Manage where approved



\---



\# 13. Tables



Tables are a primary EPROM interaction pattern.



Requirements:



\- readable columns

\- stable alignment

\- sensible widths

\- tabular numbers

\- compact status badges

\- semantic empty states

\- controlled wrapping

\- no overlapping text

\- no raw null / undefined



Never compress a table until content collides.



Use horizontal scrolling only when genuinely necessary.



Missing values should use semantic placeholders such as:



—



rather than repeating large text across multiple adjacent cells.



Example:



If a project has no Monthly report:



"No Monthly Report" should explain the state once.



Planned / Actual / Variance may display:



—



Do not repeat:



Not Reported | Not Reported | Not Reported



\---



\# 14. Status Badges



Badges must be compact.



Use visual hierarchy:



Primary operational status

> secondary reporting/basis metadata



Examples:



Schedule Health:

Delayed



Reporting Basis:

Draft / Not Approved



The reporting-basis badge should be visually lighter and smaller than a health/status badge.



Avoid large badges that dominate tables.



\---



\# 15. Reporting Visual System



Weekly, Monthly, Project Executive, and Portfolio Executive must look like one report family.



Common visual language:



\- report identity/header

\- reporting period

\- workflow/basis status

\- KPI strip

\- clean numbered sections

\- disciplined tables

\- management attention

\- milestone progress

\- forward plan

\- review/approval context



Do NOT let each report become a separate design system.



\---



\# 16. Weekly Report



Weekly is operational.



Visual priority:



1\. Reporting period/status

2\. Department updates

3\. Current activities / achievements

4\. Issues / blockers

5\. Governed Master Milestone progress

6\. Management Attention

7\. Next Week Plan

8\. Workflow / sign-off



Do not create a separate Upcoming Milestones section.



Governed Master Milestones and Next Week Plan are distinct concepts.



\---



\# 17. Monthly Report



Monthly is management-oriented consolidation.



Visual priority:



1\. Month and report status

2\. Planned / Actual / Variance

3\. Weekly consolidation

4\. Governed Master Milestone Progress

5\. Major issues / delays

6\. Management Attention

7\. Next Month Plan Items

8\. Executive Summary

9\. Approval



Never visually confuse:



Master Milestones



with:



Plan Items



\---



\# 18. Project Executive



Project Executive must be concise and board-ready.



Priority:



1\. Project identity / reporting basis

2\. Planned / Actual / Variance

3\. Management status

4\. Governed Master Milestones

5\. Critical issues / decisions / actions

6\. meaningful movement since Monthly baseline

7\. Executive Notes



Do not reproduce full Weekly or Monthly reports.



\---



\# 19. Portfolio Executive



Portfolio Executive must answer quickly:



\- Which projects are delayed?

\- Which projects are off plan?

\- Which projects lack reporting?

\- What requires management attention?

\- What is the governed milestone position?

\- Where should leadership drill down?



Keep comparison compact.



Missing-data states must not visually overpower real data.



\---



\# 20. Chart System



Use charts only when they improve management interpretation.



Preferred mapping:



Planned vs Actual

→ grouped comparison bars



Schedule Variance

→ diverging bars centered on zero



Trend

→ line / area chart



Status distribution

→ compact donut



Governed Master Milestone status

→ categorical distribution / compact donut



Management Attention

→ ranked list or table in most cases



Do NOT turn every metric into a chart.



Do NOT invent:



\- Budget

\- Risk Score

\- Quality Score

\- EVM

\- Health Score

\- SPI



unless controlled real data exists.



Do not derive synthetic milestone health scores.



Use official milestone states directly.



\---



\# 21. Chart Visual Rules



Charts should be:



\- compact

\- restrained

\- readable

\- consistent

\- management-focused



Use:



\- readable project labels

\- semantic status colors

\- clear zero baseline for variance

\- limited legends

\- useful tooltips

\- semantic empty states



Avoid:



\- 3D

\- decorative gradients

\- giant charts

\- unnecessary animation

\- excessive gridlines

\- too many colors

\- fake precision



Reuse the existing chart implementation unless a replacement is explicitly approved.



\---



\# 22. Dashboard



Dashboard should summarize controlled data, not create a second source of truth.



Do not invent metrics.



Dashboard should consume project/reporting/planning data.



Avoid redesigning into a decorative analytics wall.



\---



\# 23. Empty / Missing / Loading States



Never display:



null

undefined

NaN

raw errors

database messages

stack traces



Use semantic states:



Not recorded

No Monthly Report

No active Master Milestones

No actions requiring attention

—



Choose the shortest message that preserves meaning.



\---



\# 24. Error Handling



Errors shown to users must be:



\- clear

\- actionable

\- non-technical



Never expose database internals.



Preserve detailed technical errors only for logs/developer diagnostics.



\---



\# 25. Responsive Behavior



Desktop is the primary enterprise workspace.



Still support:



\- narrower laptop widths

\- controlled responsive tables

\- collapsible navigation

\- readable forms



Do not convert dense enterprise workflows into mobile-card chaos.



\---



\# 26. Print / Preview



Screen and print have related but distinct needs.



Do not sacrifice screen usability merely to make print easy.



Current shared report architecture must remain safe unless a later approved Print/Export wave separates them.



Print requirements include:



\- no clipping

\- no overlapping text

\- stable tables

\- predictable section breaks

\- readable typography

\- logos / signatories / metadata when implemented



\---



\# 27. Accessibility



Always preserve:



\- keyboard access

\- visible focus state

\- semantic labels

\- useful aria labels

\- adequate contrast

\- reduced motion

\- understandable status text



Do not create interactions that require hover alone.



\---



\# 28. Visual Acceptance Rule



A visual task is NOT complete merely because:



\- TypeScript passes

\- ESLint passes

\- build succeeds

\- Claude says "looks good"



Visual work requires:



IMPLEMENT

→ RUN LOCAL APP

→ SCREENSHOT / VISUAL INSPECTION

→ CORRECT IF NEEDED

→ USER REVIEW

→ COMMIT



If visible text overlaps, hierarchy is unclear, or density is poor:



the task is NOT complete.



\---



\# 29. Engineering Safety



Visual redesign must not silently modify:



\- database schema

\- RLS

\- authorization

\- reporting source logic

\- milestone governance

\- service APIs

\- workflow semantics



If a visual task appears to require one of these:



STOP and explain before changing it.



Do not add dependencies unless explicitly approved.



Do not:



\- push

\- deploy

\- touch hosted Supabase

\- reset local DB

\- delete demo data



during visual work unless explicitly instructed.



\---



\# 30. Implementation Discipline



For every design task:



1\. Understand the exact visible defect.

2\. Inspect only directly relevant files.

3\. Preserve approved architecture.

4\. Implement the smallest coherent change.

5\. Validate locally.

6\. Inspect actual rendered output.

7\. Correct one direct visual issue if needed.

8\. Stop for user review.

9\. Commit only after approval.



Do not perform broad redesigns from vague prompts.



\---



\# 31. EPROM Visual Identity



Final product should feel:



\- technically credible

\- enterprise-grade

\- modern

\- understated

\- consistent

\- confident



The experience should communicate:



"Designed specifically for EPROM project-control work."



Not:



"Built from a UI template."



Not:



"Copied from Apple."



Not:



"Generated by AI."



\---



\# 32. External Reference Policy



Apple Design:

Use for principles and craft.



21st.dev:

Use for interaction/layout inspiration.



EPROM:

Remains the product identity.



Whenever an external pattern conflicts with:



\- readability

\- engineering workflow

\- reporting density

\- printability

\- authorization clarity



EPROM requirements win.



\---



\# 33. Final Design Test



Before considering any EPROM visual surface complete, ask:



1\. Can the user tell where they are?

2\. Can the user tell what they can do?

3\. Is the primary information obvious?

4\. Is secondary information visually quieter?

5\. Is anything duplicated unnecessarily?

6\. Is anything visually colliding?

7\. Are missing-data states concise?

8\. Is the workflow obvious?

9\. Does the surface use controlled real data?

10\. Does it feel like one EPROM product?

11\. Is it still usable at normal laptop width?

12\. Does print/preview remain safe where relevant?

13\. Would removing a visual effect improve clarity?



If yes to #13, remove it.


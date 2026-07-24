> ⚠️ **Superseded — historical.** This was the original build brief. It is kept
> for reference and is **not** current guidance; parts of it conflict with what
> was actually built. The canonical documentation is [`CLAUDE.md`](CLAUDE.md)
> and [`docs/`](docs/) — start with
> [`docs/05_DEVELOPMENT_ROADMAP.md`](docs/05_DEVELOPMENT_ROADMAP.md) for current
> status. Do not implement from this file.

# Master Build Prompt — EPROM Engineering Progress Management Platform

> **How to use this file:** This is the master brief to hand to Claude Code. Paste the entire "PROMPT TO CLAUDE CODE" section (or point Claude Code at this file with `Read CLAUDE_CODE_PROMPT.md and build accordingly`). The sections above it are for you; the section below the divider is written *to* Claude Code. Setup instructions for connecting Claude Code are at the bottom.

---

## 0. Quick context (for you, Ahmed — not part of the prompt)

You are building an **enterprise, multi-project engineering progress management platform**. The core loop is: departments submit **Weekly Reports** → these roll up into auto-generated **Monthly Reports** → leadership sees **project and executive dashboards** → everything moves through a controlled **workflow** with **role-based permissions**, **threaded comments**, and **Excel/PDF** import-export. Backend and realtime are on **Supabase**; frontend is **React**; any server-side logic is **Node**.

Build it in **phases** so you always have something runnable. Don't try to generate everything at once.

---

# ══════════════════════════════════════
# PROMPT TO CLAUDE CODE (paste from here)
# ══════════════════════════════════════

You are my senior full-stack engineer. Build an **enterprise multi-project engineering progress management platform** called **EPROM**. Work in **phases**, committing runnable milestones. Before writing code, produce a short plan and a checklist, then proceed. Ask me only when a decision is genuinely blocking; otherwise pick sensible defaults and note them in `DECISIONS.md`.

## 1. Product vision

A single platform where multiple engineering **projects** each run a disciplined weekly/monthly progress cycle. Each project has **departments** (e.g., Civil, Mechanical, Electrical, Piping, Instrumentation, HSE, Planning, Procurement). Departments submit **Weekly Reports**; the system compiles a **Monthly Report** automatically from the weeks in that month. Managers and executives monitor progress through dashboards, KPIs, risks, and issues. All content flows through an approval **workflow** and supports **threaded comments** with a tracked **Comment Register**.

Design for real enterprise use: many concurrent users, audit trails, permissions, and data integrity matter more than flashy UI.

## 2. Tech stack (required)

- **Frontend:** React 18 + **Vite** + **TypeScript**. **Tailwind CSS** for styling. **React Router** for routing. **TanStack Query** (React Query) for server state. **Zustand** for light client state. **React Hook Form + Zod** for forms/validation. **Recharts** for charts.
- **Backend / Data:** **Supabase** (Postgres, Auth, Row-Level Security, Realtime, Storage, Edge Functions). Use the Supabase JS client. Put any heavy or privileged logic in **Supabase Edge Functions** (Deno) or a thin **Node/Express** service if a task can't be done safely client-side (e.g., PDF generation, bulk Excel import, email dispatch).
- **Realtime:** Supabase Realtime channels for live sync of report edits, comments, and workflow status.
- **Exports:** **ExcelJS** for Excel (per-department templates), **Puppeteer** or **@react-pdf/renderer** for PDF (run in a Node service or Edge Function).
- **Email:** **Resend** (or SMTP via Nodemailer) triggered from Edge Functions for notifications.
- **Auth:** Supabase Auth (email/password + magic link). Enforce access with **RLS policies**, not just UI gating.
- **Tooling:** ESLint + Prettier, Vitest + React Testing Library, Playwright for E2E on the critical flows. Environment via `.env` (never commit secrets). Provide a `docker-compose` only if it simplifies local Supabase.

Use the **Supabase CLI** for migrations. Keep all schema in versioned SQL migration files under `supabase/migrations`.

## 3. Data model (Postgres — implement as migrations)

Design these core tables (add fields as needed; use UUID PKs, `created_at`/`updated_at`, and soft-delete where sensible):

- **organizations** — top-level tenant.
- **users / profiles** — extends `auth.users`: full name, title, department_id, role.
- **roles & permissions** — roles: `super_admin`, `org_admin`, `project_manager`, `department_lead`, `contributor`, `reviewer`, `executive_viewer`. Model permissions as a matrix (see §6).
- **projects** — name, code, description, client, start/end dates, status, currency, overall % complete, PM owner.
- **departments** — belongs to project (or org-level template); name, discipline, lead user.
- **project_members** — join table: user ↔ project ↔ role (per-project role overrides).
- **reporting_periods** — week/month definitions per project (week number, start/end, month, year, status).
- **weekly_reports** — project_id, department_id, period_id, workflow_status, summary narrative, overall_progress, submitted_by, submitted_at.
- **monthly_reports** — project_id, department_id (or consolidated), month, year, workflow_status; generated_from an array of weekly_report ids; narrative.
- **kpis** — definition (name, unit, target, direction) + **kpi_values** (report_id, planned, actual, variance, period).
- **activities** — report_id, description, planned %, actual %, status, weight, start/finish, responsible.
- **risks** — report_id/project_id, title, description, likelihood, impact, severity (computed), mitigation, owner, status, due date.
- **issues** — similar to risks but for realized problems: title, description, priority, owner, status, resolution, opened/closed dates.
- **next_week_plan** — report_id, planned activities for the coming week.
- **look_ahead** — report_id/project_id, multi-week forward plan (e.g., 3–6 week look-ahead).
- **comments** — polymorphic: attaches to report / activity / risk / issue / kpi. Supports **unlimited threading** via `parent_comment_id`. Fields: author, body (rich text), created_at, edited_at, resolved flag.
- **comment_register** — a tracked ledger of comments elevated to "register" status: comment_id, register_no, raised_by, assigned_to, status (`open`, `in_progress`, `answered`, `closed`, `carried_over`), category, due_date, response, history (jsonb of status changes). Support **carrying selected weekly comments into the monthly report**.
- **documents / attachments** — Supabase Storage refs linked to any entity; filename, mime, size, uploaded_by, entity_type, entity_id.
- **workflow_transitions** — audit log of every status change: entity, from_status, to_status, actor, note, timestamp.
- **notifications** — user_id, type, payload, read, created_at.
- **audit_log** — generic append-only trail of significant actions.

Enforce **Row-Level Security** on every table so users see only projects/departments they belong to, per their role.

## 4. Feature requirements

Implement all of the following. Treat each as a vertical slice (DB → API/policies → UI → tests).

1. **Multi-project management** — create/manage many projects; switch active project via a project selector; per-project settings.
2. **Project setup & department management** — configure a project's departments, disciplines, leads, KPIs, and reporting calendar.
3. **Weekly Reports** — department leads fill in narrative, activities (planned vs actual %), KPIs, risks, issues, next-week plan, and look-ahead. Autosave drafts; realtime co-editing indicators.
4. **Monthly Reports (auto-generated from Weekly)** — compile the month's weekly reports into a monthly report: aggregate progress, roll up KPIs, consolidate risks/issues, and pull forward selected weekly comments. Allow editing/adding **new monthly comments** on top of the generated content.
5. **Project dashboard** — per-project: overall % complete, S-curve (planned vs actual), KPI tiles, open risks/issues, department status heatmap, workflow state.
6. **Executive dashboard** — cross-project portfolio view: health per project, aggregate KPIs, top risks, projects behind schedule, submission compliance.
7. **KPIs & progress tracking** — define KPIs with targets and direction; capture planned/actual per period; auto-compute variance and trend; visualize.
8. **Activities, Risks & Issues management** — full CRUD with filtering, severity/priority scoring, owners, and status lifecycles; register-style tables with export.
9. **Next Week Plan & Look Ahead** — structured forward planning carried into the next cycle.
10. **Local comments with unlimited threaded discussions** — comment on any entity; nested replies; @mentions; resolve/unresolve; realtime.
11. **Comment Register with status tracking & history** — elevate comments to a formal register with numbers, assignees, statuses, due dates, and a full change history.
12. **Carry selected weekly comments into Monthly Reports** — UI to select register items from the weeks and include them (with provenance) in the monthly report; plus adding brand-new monthly comments.
13. **Workflow** — states: **Draft → Collecting → Review → Approved → Finalized → Locked**. Guard transitions by role; log every transition; lock prevents further edits except by admins. Show a clear status pipeline UI.
14. **Department submission portal** — a focused view where each department submits its weekly input, sees deadlines, and tracks its own status.
15. **Role-based permissions** — enforce the role matrix in both RLS and UI (§6).
16. **Email notifications** — on: submission requested, submitted, review needed, approved, rejected/returned, comment mention, register item assigned, deadline approaching. Batch/digest option.
17. **Department-specific Excel import/export** — each department has an Excel template matching its fields; import validates and upserts; export produces the filled template.
18. **PDF and Excel export** — export a weekly or monthly report (and dashboards) to branded PDF and to Excel.
19. **Documents & attachments** — upload/manage files on reports and entities via Supabase Storage with access control.
20. **Realtime synchronization** — live updates for reports, comments, register, and workflow status across users.
21. **Responsive UI** — works on desktop and tablet; sensible mobile fallback for viewing/approving.

## 5. Workflow rules (be precise)

- **Draft** — department is editing; only that department's leads/contributors can edit.
- **Collecting** — PM has opened the reporting period; departments submit. Late/missing submissions flagged.
- **Review** — reviewers/PM review; can comment, return to Draft, or approve. No content edits by contributors.
- **Approved** — content accepted; can still be rolled into monthly.
- **Finalized** — consolidated and signed off; read-only for most roles.
- **Locked** — immutable; only `org_admin`/`super_admin` can unlock (logged).

Every transition writes to `workflow_transitions` with actor, timestamp, and optional note. Notifications fire on relevant transitions.

## 6. Role & permission matrix (enforce in RLS + UI)

| Capability | super_admin | org_admin | project_manager | department_lead | contributor | reviewer | executive_viewer |
|---|---|---|---|---|---|---|---|
| Manage org/users/roles | ✅ | ✅ | — | — | — | — | — |
| Create/config projects | ✅ | ✅ | ✅ (own) | — | — | — | — |
| Manage departments/KPIs | ✅ | ✅ | ✅ | own dept | — | — | — |
| Open/close reporting periods | ✅ | ✅ | ✅ | — | — | — | — |
| Edit weekly report content | ✅ | ✅ | ✅ | own dept | own dept | — | — |
| Submit weekly report | ✅ | ✅ | ✅ | ✅ | — | — | — |
| Review / approve / return | ✅ | ✅ | ✅ | — | — | ✅ | — |
| Generate/edit monthly report | ✅ | ✅ | ✅ | — | — | — | — |
| Finalize / lock / unlock | ✅ | ✅ | ✅ (finalize) | — | — | — | — |
| Comment & register | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | view only |
| View dashboards | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Export PDF/Excel | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

Refine as needed but keep RLS as the source of truth.

## 7. Build phases (deliver runnable milestones)

**Phase 0 — Scaffold:** Vite+React+TS app, Tailwind, routing, Supabase project + CLI + first migration, auth (login/signup/reset), protected routes, base layout (sidebar, project selector, top bar), CI lint/test. Seed script with demo org, 2 projects, departments, and users per role.

**Phase 1 — Projects & setup:** Projects CRUD, department management, KPI definitions, reporting calendar, project members & roles, RLS policies. Project dashboard shell.

**Phase 2 — Weekly Reports:** Weekly report editor (narrative, activities, KPIs, risks, issues, next-week plan, look-ahead), autosave, department submission portal, workflow Draft→Collecting→Review→Approved with transition logging.

**Phase 3 — Comments & register:** Threaded comments on all entities, @mentions, resolve; Comment Register with statuses, assignees, history; realtime.

**Phase 4 — Monthly Reports:** Auto-generation from weekly, KPI/risk/issue rollups, carry-over of selected weekly comments, new monthly comments, Finalize/Lock states.

**Phase 5 — Dashboards & KPIs:** Project dashboard (S-curve, tiles, heatmap) and executive/portfolio dashboard with charts and compliance tracking.

**Phase 6 — Import/export & docs:** Department-specific Excel import/export templates, PDF export of reports/dashboards, document/attachment management on Storage.

**Phase 7 — Notifications & polish:** Email notifications (Resend/SMTP via Edge Functions), in-app notifications, responsive passes, accessibility, E2E tests on submit→review→approve→monthly→lock.

At the end of each phase: run tests, update `README.md` and `DECISIONS.md`, and give me a short summary of what works and how to try it.

## 8. Engineering standards

- TypeScript strict mode; no `any` without justification.
- Generate Supabase types (`supabase gen types typescript`) and use them end-to-end.
- All DB access through a typed data layer; never scatter raw queries in components.
- RLS on every table; write policy tests. Treat client-side checks as UX only.
- Validate all inputs with Zod on both form and server boundaries.
- Meaningful commits per slice; keep PR-sized changes.
- Handle loading/empty/error states everywhere. Optimistic updates for comments and edits.
- Accessibility: semantic HTML, keyboard nav, ARIA on interactive components, WCAG AA contrast.
- No secrets in the repo; document required env vars in `.env.example`.
- Write a `README.md` with setup, migration, seeding, and run instructions.

## 9. Deliverables

1. A working monorepo (or single app + `supabase/` + optional `server/`).
2. Versioned SQL migrations + seed data.
3. Tests (unit + critical E2E) that pass.
4. `README.md`, `DECISIONS.md`, `.env.example`.
5. A short demo script: how to log in as each role and walk the full weekly→monthly→lock cycle.

**Start now with Phase 0.** First output your plan and the Phase 0 checklist, then scaffold. Keep me updated at each milestone.

# ══════════════════════════════════════
# END OF PROMPT TO CLAUDE CODE
# ══════════════════════════════════════

---

## How to connect this to Claude Code

Claude Code is a separate command-line tool (I'm running in Cowork mode and can't drive your terminal). Here's how to get this prompt into it:

1. **Install Claude Code** (if you haven't):
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
2. **Create/enter your project folder** and start Claude Code:
   ```bash
   mkdir eprom-platform && cd eprom-platform
   claude
   ```
   On first run it will guide you through signing in with your Anthropic account.
3. **Give it this file.** Copy `CLAUDE_CODE_PROMPT.md` into that folder, then in the Claude Code session type:
   ```
   Read CLAUDE_CODE_PROMPT.md and build the platform described in the "PROMPT TO CLAUDE CODE" section. Start with Phase 0.
   ```
   Or simply paste the whole "PROMPT TO CLAUDE CODE" block directly into the session.
4. **Set up Supabase first** so it has somewhere to build against: create a project at supabase.com, install the Supabase CLI (`npm install -g supabase`), and have your project URL + anon key ready. Claude Code will ask for or reference these.
5. **Work phase by phase.** After each phase, review, run the app, and tell Claude Code to proceed to the next phase. Don't accept all changes blindly on a project this size — review migrations and RLS policies especially.

Tip: keep `DECISIONS.md` and `README.md` in the repo so context persists across Claude Code sessions.

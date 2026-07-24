# Phase 4C — Architecture Audit

Date: 2026-07-17 · Scope: audit, cleanup, and workflow preparation ahead of Phase 5 (no visual changes to the validated dashboard).

> **Historical record — superseded.** This captures the state on 2026-07-17
> and is kept for the decisions and rationale it documents. It is *not* a
> current description of the system: much of what it lists as placeholder has
> since been built. For current status see
> [`../05_DEVELOPMENT_ROADMAP.md`](../05_DEVELOPMENT_ROADMAP.md). Note that
> "Phase 4C" here belongs to an older ad-hoc numbering, unrelated to Phase 4
> in the roadmap.

## Current routes

- Live: `/` (redirect) → `/dashboard` (Executive Dashboard), `/design-system`
- Placeholders (app shell + breadcrumb + professional coming-soon state): `/projects`, `/departments`, `/comments`, `/analytics`, `/documents`, `/administration`, `/settings`
- Report workspaces (placeholders): `/weekly-reports`, `/weekly-reports/new`, `/weekly-reports/[reportId]`, `/weekly-reports/[reportId]/edit`, `/weekly-reports/[reportId]/preview`, `/weekly-reports/import` — same tree for `/monthly-reports`; `/executive-reports` without `/import`
- Legacy `/reports/{weekly,monthly,executive}` redirect to the new top-level routes

## Existing features

- Executive Dashboard (Phase 4A/4B): 6 KPI tiles, 5 Recharts charts, 4 insight cards, HSE/Quality stats, right report panel (export placeholder, features list, timeframe selection)
- EPROM-branded app shell (Phase 3/3.1): navy sidebar with logo + EPR badge and Quick Actions, white top bar (breadcrumbs, search, messages, notifications, profile), mobile sheet, icon-rail collapse
- Design system (Phase 2): 13 shared components + `/design-system` reference page

## Existing reusable components

- Shared: `PageHeader`, `SectionCard`, `StatCard`, `KpiCard`, `StatusBadge`, `ProgressBar`, `EmptyState`, `LoadingState`, `ErrorState`, `SearchInput`, `FilterBar`, `ConfirmDialog`, `PlaceholderPage`
- Dashboard: `KpiTile`, `ProgressTrendChart`, `CumulativeCurveChart`, `DisciplineChart`, `ProjectProgressChart`, `RiskExposureChart`, `InsightCard`, `StatListCard`, `ReportPanel`
- Layout: `AppSidebar`, `TopBar`, `Breadcrumbs`

## Architecture issues found → resolution

| # | Issue | Resolution |
|---|---|---|
| 1 | Dashboard lived at `/` while the target route map needs `/dashboard` | **Fixed** — moved page to `/dashboard`, `/` redirects |
| 2 | Report routes nested under `/reports/*`, blocking the workspace trees | **Fixed** — top-level `/weekly-reports` etc. + redirects for old paths |
| 3 | Mock data hardcoded inside `features/dashboard/data.ts` mixed with view-model types and static UI config | **Fixed** — split into `data/mock/*.mock.ts` (7 files), `features/dashboard/types.ts`, `features/dashboard/config.ts` |
| 4 | `types/index.ts` monolith with legacy shapes (`Employee`, `ProgressReport`, `PortfolioKpi`) not aligned to the reporting domain | **Fixed** — split into `core/project/reports/admin`; legacy unused types removed; `ProjectPriority` kept as deprecated alias of `Priority` |
| 5 | `ReportStatus` covered only 4 states | **Fixed** — full 10-state lifecycle + `SUBMISSION_STATUS_META`, `REPORT_SOURCE_META` tone/label maps |
| 6 | No Departments route or nav item despite being a core master-data entity | **Fixed** — nav item + placeholder route |
| 7 | Stale empty `features/reports` directory | **Fixed** — removed; per-report-type feature dirs scaffolded |
| 8 | No workflow, permission, service, validation, or reporting-math layers | **Fixed** — `config/workflows.ts`, `config/permissions.ts`, `services/*`, `lib/validation.ts` (zod), `lib/reporting.ts` |

## Deferred issues (intentionally not fixed in 4C)

- Sonner `<Toaster>` not mounted — add when the first real mutation needs feedback
- Dark-mode toggle absent (next-themes installed; tokens ready) — ship with Settings phase
- Global search & notifications are placeholders — need data layer first
- Sidebar Quick Actions disabled until the export engine exists
- No automated tests — introduce with the first business logic (workflow enforcement is the natural first target)
- `components/dashboard|reports|forms` folders from the recommended structure intentionally not created — feature modules under `src/features/*` already fill that role; creating empty parallel trees would duplicate structure

## Dashboard widget backlog (Phase 4B review)

| Widget | Status | Notes / future data source |
|---|---|---|
| KPI tiles, 5 charts, insights, HSE/Quality, report panel | ✅ exists | `data/mock/*` today → `weekly/monthly-report-service` later |
| Calendar (reporting deadlines) | ⏳ missing | needs reporting-period table; `ui/calendar` already installed |
| Activity heatmap | ⏳ missing | needs audit-trail data (`AuditRecord`) |
| Upcoming activities | ⏳ missing | `WeeklySubmission.plannedNextWeek` aggregation |
| Latest reports list | ⏳ missing | `*ReportService.list()` ordered by `updatedAt` |
| Important comments feed | ⏳ missing | `WeeklyComment/MonthlyComment` where `important = true` |
| Project milestones widget | ⏳ missing | `projectService.listMilestones` |
| Report preview (A4 thumbnails) | ⏳ missing | export pipeline (`ExportRecord`) |

Database fields these widgets require are already modeled in `src/types` (reports, submissions, comments, milestones, audit records) — no schema gaps identified.

## Phase 5 readiness

- Domain types mirror the future schema; services define the exact contract the data layer must satisfy
- Workflow + permission configs are consumable by both UI and services
- Route trees for all three report types exist; forms drop into `/new` and `/[reportId]/edit`
- Validation schemas cover identities and master data; extend per-form in Phase 5
- **Ready for Phase 5A.**

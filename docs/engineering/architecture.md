# EPR Architecture

Internal EPROM platform (Next.js App Router). Single company, no SaaS, no public registration.

> **As-built engineering reference.** Written at Phase 4C and updated for the
> current route states below. The product specification lives in
> [`../01_PROJECT_VISION.md`](../01_PROJECT_VISION.md) and
> [`../archive/reporting-architecture-v1.md`](../archive/reporting-architecture-v1.md); where
> the two disagree, the specification wins. Paths below are relative to
> `eprp/`.

## Layout

```
src/
├── app/                    # Routes only — pages stay thin and compose features
│   ├── (app)/              # Product routes inside the app shell (sidebar + top bar)
│   └── design-system/      # Standalone component reference (outside the shell)
├── components/
│   ├── ui/                 # shadcn/ui primitives (generated)
│   ├── layout/             # App shell: AppSidebar, TopBar, Breadcrumbs
│   └── shared/             # Design system: PageHeader, SectionCard, StatusBadge, …
├── features/               # Feature modules — projects, master-data, organization,
│   │                       # weekly-reports, dashboard are implemented;
│   │                       # monthly-reports, executive-reports, exports, imports,
│   │                       # departments, analytics, administration, settings are empty
│   └── dashboard/          # components/ + types.ts (view models) + config.ts (static UI config)
├── config/                 # navigation, site/branding, workflows, permissions
├── data/mock/              # Typed *.mock.ts files — the only mock-data location
├── services/               # Typed service interfaces; stubs throw NotImplementedError
├── lib/                    # utils, formatters, constants (enum→label/tone maps),
│                           # reporting (date/KPI math), validation (zod schemas)
├── types/                  # Domain model: core unions, project, reports, admin
└── hooks/                  # Shared React hooks
```

## Conventions

- **Routes stay thin.** `src/app` files compose feature modules; business UI lives in `src/features/*`.
- **Semantic tokens only.** Colors come from CSS variables (`globals.css`) and the tone maps in `lib/constants.ts`. Brand palette: EPROM navy `--primary`, EPROM green (chart-2), status tones success/warning/destructive/info.
- **Types are the contract.** `src/types` mirrors the future database schema; services and mock data are typed against it so the data layer can swap in without UI changes.
- **Status changes go through workflows.** `config/workflows.ts` is the single source of truth for allowed report status transitions.
- **Permissions are config.** `config/permissions.ts` maps roles to permissions; no auth yet.
- **Mock data is isolated.** Components receive data via props; pages import from `@/data/mock`.

## Route map

| Route | Purpose | State |
|---|---|---|
| `/` | Redirects to `/dashboard` | live |
| `/dashboard` | Executive Dashboard | live (reads `data/mock` directly, not services) |
| `/projects` (+ `/new`, `/[projectId]`, `/[projectId]/[section]`, `/[projectId]/edit`, `/[projectId]/setup/[step]`) | Projects + 13-section workspace, 6-step wizard | live |
| `/departments`, `/systems`, `/disciplines`, `/contacts` (each + `/new`, `/[id]`, `/[id]/edit`) | Master-data CRUD | live |
| `/weekly-reports` (+ `/new`, `/[reportId]`, `/[reportId]/edit`, `/[reportId]/preview`) | Weekly reporting workspace | partial — see roadmap Phase 4 |
| `/weekly-reports/import` | Weekly Excel import | placeholder |
| `/monthly-reports` (whole tree) | Monthly reporting workspace | placeholder |
| `/executive-reports` (whole tree) | Executive reporting workspace | placeholder |
| `/comments` | Important comments | placeholder |
| `/analytics` | Analytics | placeholder |
| `/documents` | Documents | placeholder |
| `/administration` | Administration | placeholder |
| `/settings` | Settings | placeholder |
| `/design-system` | Component reference | live |

The Organization Chart is not a top-level route — it is the
`organization-chart` section of the project workspace
(`/projects/[projectId]/organization-chart`), backed by `features/organization`.

Legacy `/reports/*` paths redirect to the new top-level report routes (see `next.config.ts`).

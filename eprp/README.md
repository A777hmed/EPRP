# EPROM Progress Report (EPR)

Internal platform for **EPROM — Egyptian Projects Operation & Maintenance**: project progress tracking, milestones, periodic progress reports, and executive-level portfolio analytics.

**Branding**: official EPROM logo assets live in `public/brand/` (`eprom-logo.png` full lockup for light surfaces, `eprom-mark.png` compact drop mark). Brand palette — navy `#003380` (primary), green `#639E01` (accent/charts), sky `#0080D0` — is encoded as OKLCH tokens in `src/app/globals.css`. The sidebar uses the deep-navy brand surface with royal-blue active items, per the reference designs in the project root.

> **Internal application only** — no SaaS, no payments, no subscriptions, no public registration, single-company scope.

## Technology Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js](https://nextjs.org) (App Router) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 |
| Components | [shadcn/ui](https://ui.shadcn.com) (Radix primitives, CSS variables theming) |
| Icons | Lucide React |
| Charts | Recharts (via shadcn/ui `chart` primitives) |
| Dates | date-fns |
| Theming | next-themes (light / dark) |

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Type-check |

## Project Structure

```
src/
├── app/                  # App Router routes, layouts, and route groups only
├── components/
│   ├── ui/               # shadcn/ui primitives (generated — do not edit ad hoc)
│   ├── layout/           # App shell: sidebar, topbar, page chrome
│   └── shared/           # Cross-feature composites (stat cards, data tables, page headers)
├── features/             # Feature modules — screens are composed from these
│   ├── dashboard/        # Executive overview & portfolio KPIs
│   ├── projects/         # Project portfolio & progress tracking
│   ├── reports/          # Periodic progress reports & approval flow
│   ├── analytics/        # Trends, forecasts, performance analysis
│   └── settings/         # Platform configuration
├── hooks/                # Shared React hooks
├── lib/                  # Utilities: formatters, constants, cn()
├── config/               # Site metadata & navigation definitions
├── types/                # Domain models (Project, ProgressReport, Milestone, …)
└── data/                 # Mock/fixture data (until backend integration)
```

### Architecture Conventions

- **Routes stay thin.** Files in `src/app` compose feature modules; business UI lives in `src/features/*`.
- **Semantic tokens only.** Colors come from CSS variables / the token maps in `src/lib/constants.ts` — never raw hex in components.
- **One icon family.** Lucide icons exclusively, consistent stroke width; no emoji as icons.
- **Domain types are the contract.** All feature code consumes the models in `src/types` so a future API layer can drop in behind them.
- **Accessibility is non-negotiable.** WCAG AA contrast, visible focus states, keyboard navigation, `prefers-reduced-motion` respected.

## Design Language

Premium enterprise aesthetic in the spirit of Oracle Primavera, Microsoft Power BI, and Linear:

- Dense-but-calm layouts on a 4/8px spacing rhythm
- Neutral surface palette with semantic status colors (on-track / at-risk / delayed)
- Tabular figures for data columns, compact number formatting for KPIs
- Subtle 150–300ms micro-interactions; no decorative animation

## Roadmap

See **[`../docs/05_DEVELOPMENT_ROADMAP.md`](../docs/05_DEVELOPMENT_ROADMAP.md)** — the
single source of truth for phase status and what comes next.

This section previously carried its own phase list using an ad-hoc numbering
(`4C`, `5A`, `6A`) that did not match the roadmap. That numbering is retired;
keeping a second list here would only let the two drift apart again.

## Documentation

All documentation lives at the repository root, one level up:

- [`../CLAUDE.md`](../CLAUDE.md) — working rules, read first
- [`../docs/`](../docs/) — product specification (`00`–`05`)
- [`../docs/engineering/`](../docs/engineering/) — as-built architecture,
  workflow, and permission references
- [`AGENTS.md`](AGENTS.md) — Next.js version constraint for this app
- [`supabase/README.md`](supabase/README.md) — database setup

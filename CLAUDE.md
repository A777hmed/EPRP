# EPRP — Claude Working Rules

## Purpose

EPRP (EPROM Progress Report) is an internal, multi-project engineering progress reporting platform. It helps Project Control collect department updates, manage Weekly and Monthly Reports, and produce a professional Executive Report for company leadership.

## Repository layout

```text
.                            ← you are here; this file is the canonical CLAUDE.md
├── CLAUDE.md
├── docs/                    ← canonical documentation. The only docs location.
│   ├── 00_README.md … 05_DEVELOPMENT_ROADMAP.md
│   └── engineering/         ← as-built references (see note below)
└── eprp/                    ← the Next.js application
    ├── AGENTS.md            ← stack constraint, read before writing code
    ├── src/  supabase/  package.json
    └── …
```

All commands (`npm run lint`, `npx tsc --noEmit`, `npx next build`) run from
`eprp/`, not from the repository root.

## Read first

Before changing application code, read, in order:

1. `docs/00_README.md`
2. `docs/01_PROJECT_VISION.md`
3. `docs/02_REPORTING_ARCHITECTURE.md`
4. `docs/03_WORKFLOW.md`
5. `docs/04_EXECUTIVE_REPORT.md`
6. `docs/05_DEVELOPMENT_ROADMAP.md` — start here for current status and the next phase
7. `eprp/AGENTS.md` — the installed Next.js differs from training data; check
   `eprp/node_modules/next/dist/docs/` before using an unfamiliar API

`docs/engineering/` holds **as-built** references: current architecture, and
snapshots of the workflow/permission config in code. They describe what was
built, not what is required. Where an engineering doc and the numbered
specification disagree, **the specification wins** and the discrepancy should
be reconciled, not silently followed.

Also inspect the existing code, routes, components, database migrations, and reference files. The existing implementation is authoritative for what is already working.

## Non-negotiable rules

- Preserve the existing application design system, routing, sidebar, branding, typography, spacing, and responsive behavior.
- Implement one roadmap phase at a time. Do not start future phases automatically.
- Reuse existing components and types before creating new ones.
- Keep data linked to `projectId`; do not duplicate project master data in reports.
- Weekly data is the operational source of truth. Monthly Reports compile approved Weekly data; Executive Reports compile approved project/monthly data.
- Platform entry is the default. Excel is an exception for offline or external contributors.
- Keep original comments and snapshots immutable; add updates or links instead of overwriting history.
- Locked reports are read-only. Changes require a new revision.
- Do not hardcode master-data dropdowns such as clients, project types, departments, systems, disciplines, or contacts.
- Use safe archive/deactivate behavior when a master-data record is already referenced.
- Do not add payment, SaaS, public registration, or multi-company features.
- Ask before making a business assumption that changes the documented workflow or data ownership.
- Keep documentation in `docs/` only. Do not start a second documentation set
  elsewhere in the tree.
- Use the phase numbering in `docs/05_DEVELOPMENT_ROADMAP.md`. Do not invent a
  parallel scheme; earlier work used ad-hoc labels (`5A`, `6A.4`, `OC-6`) and
  the mismatch caused real confusion.

## Technical guidance

- Preserve the current stack. Do not migrate frameworks without approval.
- Prefer TypeScript, reusable feature components, schema validation, and server-side authorization where supported by the existing project.
- Keep UI, services, validation, and data access separate.
- Do not use `any` or suppress errors without a documented reason.
- Use mock data only when the current phase explicitly says so.
- Keep Excel/PDF/DOCX export and import isolated behind services.

## Required completion report

After every implementation phase:

From `eprp/`:

- Run lint — `npx eslint src --max-warnings=0`
- Run type-check — `npx tsc --noEmit`
- Run the production build — `npx next build`
- List changed files.
- List completed and deferred requirements.
- Mention errors, warnings, or assumptions.
- Update the status table in `docs/05_DEVELOPMENT_ROADMAP.md`.
- Stop at the requested phase.

A green lint/type-check/build proves the code compiles. It does **not** prove
anything ran against a database — say so plainly rather than implying broader
verification than was performed.


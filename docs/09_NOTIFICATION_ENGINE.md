# Notification Center

## Phase 7A — frontend implementation (2026-09-27)

Scope approved by the project owner: frontend UI and integration-ready contracts only. No SQL, migrations, database writes, email or push delivery.

- Header bell, responsive Radix Sheet panel and `/notifications` history share one session service.
- Project, category and read filters; date groups; pagination; read/unread; mark-all-read cutoff; accessible empty, loading and retry states.
- `/settings/notifications` exposes optional categories (including tasks and approvals) and project-follow preferences. Saves are explicitly tab-only and reset on reload.
- Default adapter is disconnected and empty. Explicit development preview supplies labelled sample records, exercises read state/preferences, and can simulate a recoverable connection error. Production cannot enable this preview.
- Destinations are derived from allowlisted entity types and valid IDs. Sample links show their destination without opening invented reports.

## Approved product rules

1. Tasks and approvals are optional notification categories.
2. Project Control owns reporting deadlines separately for each project.
3. Viewer + Full Portfolio Read may follow permitted projects and informational categories.
4. Following a project or receiving a notification never grants editing or workflow authority.
5. Notification events and personal deliveries remain separate concepts; notification is not audit.

## Integration contract and Phase 7B dependencies

`NotificationService` provides overview (count, permitted options, preferences), paginated list, read-state mutation, mark-all-read cutoff and preference save. The local adapter uses no storage or network. Its snapshot does not constitute authorization.

The backend must return only currently authorized records and options; enforce recipient ownership AND current source visibility for list/count/read mutations; suppress revoked access; and resolve active account/contact assignments. Full Portfolio Read grants read scope, not approval authority. Do not copy report narrative, return reasons or Executive summaries into an unconstrained payload.

Future work: additive event/delivery/preference schema, least-privilege grants and RLS, transactionally captured events, idempotent generation, per-project deadlines, approved escalation rules, operational retry diagnostics, retention policy, and authenticated PostgreSQL acceptance. Coordinate migration sequence and visibility helpers with the integration branch before preparing Phase 7B SQL. Existing calendar display dates are not authoritative reporting deadlines.

## Validation

From `eprp/`:

- Focused: `node --experimental-strip-types --test src/features/notifications/notifications.test.mjs`
- Full source suite: pass every `src/**/*.test.mjs` file to `node --experimental-strip-types --import ./src/features/notifications/test-runtime.mjs --test`.
- `npx tsc --noEmit`; `npx eslint src --max-warnings=0`; `npx next build --webpack`.

The test-only resolver handles existing TypeScript aliases and the ESM library entry used by Next.js. It does not mock application behavior. Browser acceptance uses the opt-in development adapter without a configured database. Backend authorization/delivery acceptance remains Phase 7B work.

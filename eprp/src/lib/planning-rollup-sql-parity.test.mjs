import assert from "node:assert/strict";
import test from "node:test";

import { computeRollupFromActivities } from "./planning-rollup.ts";

/*
 * SQL-versus-TypeScript parity for `public.dashboard_planning_rollups()`
 * (20260922000001_dashboard_portfolio_project_visibility.sql,
 * `activity_rollup` CTE).
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT. The three fixtures below were run,
 * this session, as read-only `SELECT ... FROM (VALUES ...) AS a(...)`
 * queries against a REAL local Postgres 17.6 instance (`supabase_db_eprp`,
 * 127.0.0.1:54322 — the same instance whose live schema this migration's
 * header records verifying) — the exact conditional-SUM/FILTER expressions
 * copied verbatim from the migration's `activity_rollup` CTE, with zero
 * table created, altered or written to. The results, recorded in the
 * assertions below, matched `computeRollupFromActivities()`'s own output
 * for the identical inputs exactly, to full precision. That is genuine
 * runtime evidence the AGGREGATE FORMULA is correct against real Postgres
 * arithmetic and NULL/FILTER semantics — not merely a claim from reading
 * the SQL. It does NOT prove `dashboard_planning_rollups()` the FUNCTION
 * behaves identically end-to-end (joins, the opening-position branch, RLS,
 * the UNION ALL) — the migration itself was never applied, per this
 * session's standing instruction not to apply migrations. See the
 * session's completion report for the exact commands to close that
 * remaining gap once migration application is authorized.
 *
 * This file pins the TypeScript side of that verified pair so a future
 * change to `computeRollupFromActivities()` is caught here — if this test
 * ever fails, the SQL migration's own parity claim needs re-verifying
 * against Postgres again, not just this test.
 */

test("fixture 1 — mixed weights, one activity missing Actual, one zero-weighted (excluded): matches the verified Postgres result exactly", () => {
  const activities = [
    { weightPercent: 40, percentCompletePlanned: 100, percentCompletePhysical: 80, plannedValue: 1000, earnedValue: 800 },
    { weightPercent: 60, percentCompletePlanned: 50, percentCompletePhysical: undefined, plannedValue: 2000, earnedValue: undefined },
    // Zero weight: must be excluded from every average AND from totalWeight/coverage.
    { weightPercent: 0, percentCompletePlanned: 100, percentCompletePhysical: 100 },
  ];
  const rollup = computeRollupFromActivities(activities);

  // Verified against Postgres this session:
  //   70.0000000000000000 | 80.0000000000000000 | 3000 | 800 | 40.00000000000000000000
  assert.equal(rollup.plannedProgress, 70);
  assert.equal(rollup.actualProgress, 80);
  assert.equal(rollup.variance, 10);
  assert.equal(rollup.plannedValue, 3000);
  assert.equal(rollup.earnedValue, 800);
  assert.equal(rollup.coveragePercent, 40);
  assert.ok(Math.abs(rollup.spi - 800 / 3000) < 1e-9);
});

test("fixture 2 — full coverage, no value data reported anywhere: plannedValue/earnedValue/spi are null, never 0", () => {
  const activities = [
    { weightPercent: 50, percentCompletePlanned: 20, percentCompletePhysical: 10 },
    { weightPercent: 50, percentCompletePlanned: 40, percentCompletePhysical: 30 },
  ];
  const rollup = computeRollupFromActivities(activities);

  // Verified against Postgres this session:
  //   30.0000000000000000 | 20.0000000000000000 | (null) | (null) | 100.00000000000000000000
  assert.equal(rollup.plannedProgress, 30);
  assert.equal(rollup.actualProgress, 20);
  assert.equal(rollup.variance, -10);
  assert.equal(rollup.plannedValue, null);
  assert.equal(rollup.earnedValue, null);
  assert.equal(rollup.spi, null);
  assert.equal(rollup.coveragePercent, 100);
});

test("fixture 3 — no activities at all: everything null, coverage 0 (never a divide-by-zero, never a fabricated figure)", () => {
  const rollup = computeRollupFromActivities([]);

  // Verified against Postgres this session (empty VALUES set, same query
  // shape as the LEFT JOIN a snapshot with zero rows produces):
  //   (null) | (null) | 0
  assert.equal(rollup.plannedProgress, null);
  assert.equal(rollup.actualProgress, null);
  assert.equal(rollup.variance, null);
  assert.equal(rollup.plannedValue, null);
  assert.equal(rollup.spi, null);
  assert.equal(rollup.coveragePercent, 0);
});

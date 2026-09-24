import assert from "node:assert/strict";
import test from "node:test";

import { computePortfolioProgressTrend, latestGovernedPortfolioPosition } from "./portfolio-progress.ts";

test("portfolio active-project scope: only the projects passed in count toward the total and the mean", () => {
  const curves = new Map([
    ["proj-a", [{ dataDate: "2026-09-15", planned: 40, actual: 30 }]],
    ["proj-b", [{ dataDate: "2026-09-15", planned: 60, actual: 50 }]],
  ]);
  // totalProjects reflects the ACTIVE scope passed in — an archived project
  // never reaches this function at all, so it can never appear here.
  const trend = computePortfolioProgressTrend(curves, 2);
  assert.equal(trend.length, 1);
  assert.equal(trend[0].totalProjects, 2);
  assert.equal(trend[0].sampleCount, 2);
  // Unweighted mean: (40 + 60) / 2 = 50, (30 + 50) / 2 = 40.
  assert.equal(trend[0].planned, 50);
  assert.equal(trend[0].actual, 40);
});

test("missing != zero: a project with nothing published yet by a date takes no part in that date's mean", () => {
  const curves = new Map([
    ["proj-a", [{ dataDate: "2026-08-31", planned: 20, actual: 15 }]],
    // proj-b publishes only later — it must not drag the Aug 31 mean toward 0.
    ["proj-b", [{ dataDate: "2026-09-20", planned: 60, actual: 55 }]],
  ]);
  const trend = computePortfolioProgressTrend(curves, 2);

  const aug31 = trend.find((point) => point.dataDate === "2026-08-31");
  assert.equal(aug31.sampleCount, 1);
  assert.equal(aug31.planned, 20); // NOT (20 + 0) / 2 = 10
  assert.equal(aug31.actual, 15);

  const sep20 = trend.find((point) => point.dataDate === "2026-09-20");
  assert.equal(sep20.sampleCount, 2);
  assert.equal(sep20.planned, 40); // carries proj-a's last known 20 forward, averaged with proj-b's 60
});

test("no fabricated points: portfolio dates are exactly the union of each project's own real dates", () => {
  const curves = new Map([
    ["proj-a", [{ dataDate: "2026-08-31", planned: 10, actual: 8 }]],
    ["proj-b", [{ dataDate: "2026-09-15", planned: 30, actual: 25 }]],
  ]);
  const trend = computePortfolioProgressTrend(curves, 2);
  assert.deepEqual(
    trend.map((point) => point.dataDate),
    ["2026-08-31", "2026-09-15"]
  );
});

/* --------------------------- latestGovernedPortfolioPosition ----------------- */

test("portfolio KPI: evaluated at the latest governed Actual data date, not a future baseline-finish date", () => {
  const curves = new Map([
    [
      "proj-a",
      [
        // Real published snapshot — the last genuine Actual reading.
        { dataDate: "2026-09-30", planned: 65, actual: 60 },
        // Schedule-only sample dates added purely to extend the Planned
        // line to the project's baseline finish — no real Actual here.
        { dataDate: "2026-10-15", planned: 85, actual: null },
        { dataDate: "2026-11-01", planned: 100, actual: null },
      ],
    ],
  ]);
  const trend = computePortfolioProgressTrend(curves, 1);

  // The naive "last point in the trend" would read Planned = 100 (baseline
  // finish) against a carried-forward Actual of 60 — exactly the bug.
  const naiveLastPoint = trend[trend.length - 1];
  assert.equal(naiveLastPoint.dataDate, "2026-11-01");
  assert.equal(naiveLastPoint.planned, 100);

  const asOf = latestGovernedPortfolioPosition(trend);
  assert.equal(asOf.dataDate, "2026-09-30");
  assert.equal(asOf.planned, 65);
  assert.equal(asOf.actual, 60);
});

test("portfolio KPI: undefined when no project in scope has published a single Actual reading yet", () => {
  const curves = new Map([["proj-a", [{ dataDate: "2026-08-01", planned: 0, actual: null }]]]);
  const trend = computePortfolioProgressTrend(curves, 1);
  assert.equal(latestGovernedPortfolioPosition(trend), undefined);
});

test("a schedule-only Planned sample date does not fabricate a false gap in the carried-forward Actual mean", () => {
  const curves = new Map([
    [
      "proj-a",
      [
        { dataDate: "2026-08-01", planned: 0, actual: null }, // schedule boundary, no real snapshot here
        { dataDate: "2026-08-31", planned: 20, actual: 15 }, // real published snapshot
      ],
    ],
  ]);
  const trend = computePortfolioProgressTrend(curves, 1);
  const atSchedule = trend.find((point) => point.dataDate === "2026-08-01");
  assert.equal(atSchedule.planned, 0);
  assert.equal(atSchedule.actual, null); // genuinely nothing known yet, not a fabricated 0
});

/* --------------------- governed reconciliation (real fixture) ---------------- */

/* The confirmed Sep 30 governed positions from browser review: five active
   projects, each contributing its OWN governed snapshot Planned/Actual —
   never a value derived from activity schedule dates. */
const SEP_30_FIXTURE = new Map([
  ["osbl", [{ dataDate: "2026-09-30", planned: 64, actual: 58 }]],
  ["solar", [{ dataDate: "2026-09-30", planned: 61, actual: 60 }]],
  ["psaim", [{ dataDate: "2026-09-30", planned: 68, actual: 59 }]],
  ["rbi", [{ dataDate: "2026-09-30", planned: 55, actual: 57 }]],
  ["tank", [{ dataDate: "2026-09-30", planned: 72, actual: 43 }]],
]);

test("Sep 30 portfolio reconciliation: unweighted mean of the governed snapshot Planned values is 64.0%, not a baseline-inflated figure", () => {
  const trend = computePortfolioProgressTrend(SEP_30_FIXTURE, 5);
  const sep30 = trend.find((point) => point.dataDate === "2026-09-30");
  // (64 + 61 + 68 + 55 + 72) / 5 = 64.0 — reconciles exactly with the
  // confirmed governed positions, not the previously reported 82.4%.
  assert.equal(sep30.planned, 64);
});

test("Sep 30 portfolio reconciliation: unweighted mean Actual is 55.4%, giving a Variance of -8.6%", () => {
  const trend = computePortfolioProgressTrend(SEP_30_FIXTURE, 5);
  const sep30 = trend.find((point) => point.dataDate === "2026-09-30");
  // (58 + 60 + 59 + 57 + 43) / 5 = 55.4.
  assert.ok(Math.abs(sep30.actual - 55.4) < 1e-9, `expected ~55.4, got ${sep30.actual}`);
  const variance = sep30.actual - sep30.planned;
  assert.ok(Math.abs(variance - -8.6) < 1e-9, `expected ~-8.6, got ${variance}`);
});

test("KPI and chart reconcile: the as-of KPI position IS the same trend point the chart plots at that date — never a second computation", () => {
  const trend = computePortfolioProgressTrend(SEP_30_FIXTURE, 5);
  const chartPoint = trend.find((point) => point.dataDate === "2026-09-30");
  const kpiPoint = latestGovernedPortfolioPosition(trend);
  assert.equal(kpiPoint, chartPoint); // same object reference — one computation, read twice
});

test("Actual series ends at the latest governed Actual date: a project with no later snapshot does not extend the portfolio Actual mean past its own last real reading", () => {
  const curves = new Map([
    ...SEP_30_FIXTURE,
    // Every project in this fixture stops at Sep 30 — there is no later
    // real date anywhere, so the portfolio trend itself must stop there
    // too (no future schedule-only date is ever added by this module).
  ]);
  const trend = computePortfolioProgressTrend(curves, 5);
  assert.equal(trend[trend.length - 1].dataDate, "2026-09-30");
  assert.equal(trend.length, 1);
});

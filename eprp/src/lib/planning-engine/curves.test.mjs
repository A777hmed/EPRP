import assert from "node:assert/strict";
import test from "node:test";

import { baselineCurve, calculatePlanPerformance, earnedCurve, figure, forecastCurve } from "./index.ts";
import { DATA_DATE, findInput, worked265 } from "./fixtures.mjs";

/* Phase 13.10 — S-curves (`docs/02` §26.7). */

const EPS = 1e-9;

function points(result) {
  assert.equal(result.status, "calculated", JSON.stringify(result));
  return result.points;
}

function nonDecreasing(series) {
  for (let i = 1; i < series.length; i++) assert.ok(series[i].value >= series[i - 1].value - EPS, `dip at ${series[i].date}`);
}

test("baseline curve (BLn): weekly on the reporting day, non-decreasing, from 0 to 100", () => {
  const curve = points(baselineCurve(worked265(), { baseline: "current", reportingDay: "thursday" }));
  assert.ok(curve.length > 10);
  assert.ok(curve.every((point) => new Date(`${point.date}T00:00:00Z`).getUTCDay() === 4));
  assert.equal(curve[0].value, 0, "the first grid point is on or before the earliest BLn start");
  assert.ok(Math.abs(curve.at(-1).value - 100) < EPS, "the grid reaches completion");
  nonDecreasing(curve);
});

test("baseline curve (BLn): at a grid date it equals the engine's PV at that Data Date", () => {
  const curve = points(baselineCurve(worked265(), { baseline: "current", reportingDay: "thursday" }));
  const point = curve.find((p) => p.date === "2026-10-29");
  // Same date → same PV, whichever way it is reached.
  const result = calculatePlanPerformance({ ...worked265(), dataDate: "2026-10-29" });
  assert.equal(result.status, "calculated");
  assert.ok(Math.abs(point.value - result.performance.project.pv) < EPS);
  // Thu 29 Oct is the last working day before the §26.5 Data Date: PV 52.04 either way.
  assert.ok(Math.abs(point.value - 52.04) < EPS);
});

test("baseline curve (BL0): not available until every activity carries BL0 dates — never borrowed from BLn", () => {
  const result = baselineCurve(worked265(), { baseline: "original", reportingDay: "thursday" });
  assert.equal(result.status, "not_available");
  assert.equal(result.reason, "baseline_missing");
  assert.ok(result.activityIds.includes("vdu-a10"));
  assert.ok(!result.activityIds.includes("vdu-m10"), "VDU-M10 has its BL0 date");
});

test("baseline curve: weight findings block it; progress findings (C2) do not", () => {
  const badWeights = worked265();
  findInput(badWeights, "utl").localWeight = null;
  assert.equal(baselineCurve(badWeights, { baseline: "current", reportingDay: "thursday" }).status, "blocked");

  const unmeasured = worked265();
  findInput(unmeasured, "vdu-a20").percentComplete = null;
  assert.equal(baselineCurve(unmeasured, { baseline: "current", reportingDay: "thursday" }).status, "calculated");
});

test("forecast curve: starts at the project's EV on the Data Date and reaches 100 at the forecast finish", () => {
  const curve = points(forecastCurve(worked265(), { reportingDay: "thursday" }));
  assert.equal(curve[0].date, DATA_DATE);
  assert.ok(Math.abs(curve[0].value - 49.475) < EPS);
  assert.ok(Math.abs(curve.at(-1).value - 100) < EPS);
  assert.ok(curve.at(-1).date >= "2026-12-29");
  nonDecreasing(curve);
});

test("forecast curve: an incomplete activity with no forecast makes the curve unavailable, never BLn-borrowed", () => {
  const plan = worked265();
  delete findInput(plan, "cdu-a20").forecast;
  const result = forecastCurve(plan, { reportingDay: "thursday" });
  assert.deepEqual(result, { status: "not_available", reason: "forecast_missing", activityIds: ["cdu-a20"] });
});

test("forecast curve: an unpublishable plan (C2) gives no forecast curve", () => {
  const plan = worked265();
  findInput(plan, "vdu-a20").percentComplete = null;
  assert.equal(forecastCurve(plan, { reportingDay: "thursday" }).status, "blocked");
});

test("earned curve: one point per Data Date, highest version wins a tie, gaps never plotted as 0", () => {
  const curve = earnedCurve([
    { dataDate: "2026-10-31", snapshotVersion: 3, ev: figure.value(49.475) },
    { dataDate: "2026-09-30", snapshotVersion: 1, ev: figure.value(20) },
    { dataDate: "2026-10-31", snapshotVersion: 2, ev: figure.value(48) },
    { dataDate: null, snapshotVersion: 4, ev: figure.value(60) },
    { dataDate: "2026-10-15", snapshotVersion: 5, ev: figure.notAvailable("no_value_data") },
  ]);
  assert.deepEqual(curve, [
    { date: "2026-09-30", value: 20, snapshotVersion: 1 },
    { date: "2026-10-31", value: 49.475, snapshotVersion: 3 },
  ]);
});

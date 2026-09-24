import assert from "node:assert/strict";
import test from "node:test";

import { buildProjectProgressCurve } from "./progress-curve.ts";
import { planningProgressCurve } from "./planning-integration.ts";

/* A minimal snapshot-derived Actual trend, the shape `planningProgressCurve`
   produces: sparse, real Data Dates only. */
const snapshotCurve = [
  { dataDate: "2026-08-31", snapshotId: "snap-1", snapshotVersion: 1, planned: 12, actual: 10 },
  { dataDate: "2026-09-15", snapshotId: "snap-2", snapshotVersion: 2, planned: 28, actual: 24 },
  { dataDate: "2026-09-30", snapshotId: "snap-3", snapshotVersion: 3, planned: 40, actual: 33 },
];

test("real snapshot actual series: every published snapshot's own Actual figure is plotted chronologically", () => {
  const curve = buildProjectProgressCurve(snapshotCurve);
  assert.deepEqual(
    curve.map((point) => [point.dataDate, point.actual]),
    [
      ["2026-08-31", 10],
      ["2026-09-15", 24],
      ["2026-09-30", 33],
    ]
  );
});

test("earliest valid snapshot retained: Aug 31 plots as the first real point, not dropped for a later start", () => {
  const curve = buildProjectProgressCurve(snapshotCurve);
  assert.equal(curve[0].dataDate, "2026-08-31");
  assert.equal(curve[0].actual, 10);
  assert.equal(curve[0].snapshotId, "snap-1");
});

test("no fabricated dates: the curve is exactly one point per real published snapshot, nothing added or dropped", () => {
  const curve = buildProjectProgressCurve(snapshotCurve);
  assert.equal(curve.length, snapshotCurve.length);
  assert.deepEqual(
    curve.map((point) => point.dataDate),
    snapshotCurve.map((point) => point.dataDate)
  );
});

test("no fabricated 0% start: the first plotted point is the project's real first snapshot figure, never an invented zero", () => {
  const curve = buildProjectProgressCurve(snapshotCurve);
  assert.equal(curve[0].planned, 12);
  assert.equal(curve[0].actual, 10);
});

/* ------------------------- governed reconciliation ---------------------- */

test("reconciliation: the curve's Planned value at a snapshot Data Date equals that snapshot's own governed Planned progress", () => {
  // Real per-activity rollups, the same shape `planningProgressCurve` folds
  // (see planning-integration.test coverage elsewhere) — here fed straight
  // in as governed rollups to isolate the reconciliation claim.
  const rollups = [
    { dataDate: "2026-09-30", snapshotId: "snap-osbl", snapshotVersion: 4, plannedProgress: 64, actualProgress: 58 },
  ];
  const governedCurve = planningProgressCurve(rollups);
  const curve = buildProjectProgressCurve(governedCurve);
  const sep30 = curve.find((point) => point.dataDate === "2026-09-30");

  // The number a KPI strip reads for this same snapshot IS `plannedProgress`
  // — the curve must show that exact figure, not a derived/interpolated one.
  assert.equal(sep30.planned, 64);
  assert.equal(sep30.actual, 58);
});

test("no interpolation: nothing is computed from activity start/finish dates or weights — only the governed snapshot figure is ever plotted", () => {
  // A curve point never carries anything beyond dataDate/planned/actual/
  // snapshotId/snapshotVersion — there is no path by which an activity
  // schedule could still be influencing this value.
  const curve = buildProjectProgressCurve(snapshotCurve);
  for (const point of curve) {
    assert.deepEqual(Object.keys(point).sort(), ["actual", "dataDate", "planned", "snapshotId", "snapshotVersion"]);
  }
});

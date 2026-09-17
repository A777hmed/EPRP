// Planning Integration 3D — Dashboard pure-logic verification. LOCAL ONLY.
//
// Proves `deriveDashboardPlanningFigures` and `planningProgressCurve`
// (src/features/dashboard/planning-integration.ts) directly, with no
// database and no test framework — same convention as
// `verify_weekly_planning_integration.ts` (3B) and
// `verify_monthly_planning_integration.ts` (3C). This is the one module
// `dashboard-data.ts` (`positionsFor` — the current-position rule) and
// `dashboard-analytics.tsx` (the Planned vs Actual Progress Curve panel)
// both call, so proving it here proves the decision every one of those
// call sites relies on.
//
// `positionsFor` and `governedMilestoneRow` in `dashboard-data.ts` are NOT
// exercised here: that module pulls in `@/features/auth/use-current-
// identity`, `@/services/*` and other `@/`-aliased application code that
// only resolves inside the Next.js build, so it cannot compile standalone
// the way this file's one dependency (a zero-import pure module) can.
// Their wiring is covered by `npx tsc --noEmit` (full project, confirms the
// branching type-checks), by direct code review, and by the mandated
// browser check, which exercises the real pipeline end to end — not by a
// second, duplicate run of this same logic.
//
// HOW TO RUN (from eprp/)
//   npx tsc scripts/p0-validation/verify_dashboard_planning_integration.ts \
//     --outDir .tmp-dashboard-check --module commonjs --target es2020 \
//     --moduleResolution node --esModuleInterop --skipLibCheck
//   node .tmp-dashboard-check/scripts/p0-validation/verify_dashboard_planning_integration.js
//   rm -rf .tmp-dashboard-check

import {
  deriveDashboardPlanningFigures,
  planningProgressCurve,
  type PlanningRollupLike,
} from "../../src/features/dashboard/planning-integration";

let pass = 0;
let fail = 0;

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (Object.is(actual, expected)) {
    pass += 1;
    console.log(`PASS — ${label}`);
  } else {
    fail += 1;
    console.log(`FAIL — ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

function rollup(overrides: Partial<PlanningRollupLike> = {}): PlanningRollupLike {
  return {
    snapshotId: "snap-1",
    snapshotVersion: 3,
    dataDate: "2026-09-01",
    plannedProgress: 68,
    actualProgress: 55,
    variance: -13,
    spi: 0.55,
    plannedValue: 6800,
    earnedValue: 3740,
    coveragePercent: 90,
    ...overrides,
  };
}

/* ---------------------------------------------------------------------
 * 1. No rollup / no published snapshot at all => unbacked, existing
 * Weekly/Monthly fallback path (proven by falling through in
 * `positionsFor` — the gate itself is what this asserts).
 * ------------------------------------------------------------------- */
{
  const figures = deriveDashboardPlanningFigures(null);
  assertEqual(figures.planningBacked, false, "no rollup: not planning-backed — falls back safely");
  assertEqual(figures.plannedProgress, null, "no rollup: plannedProgress is null, never 0");
  assertEqual(figures.actualProgress, null, "no rollup: actualProgress is null, never 0");
  assertEqual(figures.variance, null, "no rollup: variance is null");
  assertEqual(figures.spi, null, "no rollup: spi is null");

  const figuresUndefined = deriveDashboardPlanningFigures(undefined);
  assertEqual(figuresUndefined.planningBacked, false, "undefined rollup: not planning-backed (same as null)");
}

/* ---------------------------------------------------------------------
 * 2. The LATEST published snapshot's usable rollup drives every figure —
 * Planned, Actual, Variance and SPI ALL from the same rollup, never mixed
 * with a manual figure (3D "never mix" rule).
 * ------------------------------------------------------------------- */
{
  const figures = deriveDashboardPlanningFigures(rollup());
  assertEqual(figures.planningBacked, true, "usable latest snapshot: planning-backed");
  assertEqual(figures.plannedProgress, 68, "usable latest snapshot: plannedProgress from the rollup");
  assertEqual(figures.actualProgress, 55, "usable latest snapshot: actualProgress from the SAME rollup");
  assertEqual(figures.variance, -13, "usable latest snapshot: variance from the SAME rollup");
  assertEqual(figures.spi, 0.55, "usable latest snapshot: spi (EV/PV) from the SAME rollup");
  assertEqual(figures.plannedValue, 6800, "usable latest snapshot: plannedValue (PV) carried through for KPI detail");
  assertEqual(figures.earnedValue, 3740, "usable latest snapshot: earnedValue (EV) carried through for KPI detail");
  assertEqual(figures.snapshotVersion, 3, "usable latest snapshot: snapshot version provenance");
  assertEqual(figures.dataDate, "2026-09-01", "usable latest snapshot: Data Date provenance");
  assertEqual(figures.coveragePercent, 90, "usable latest snapshot: coverage provenance");
}

/* ---------------------------------------------------------------------
 * 3. The latest published snapshot exists but is UNUSABLE (missing
 * Planned or Actual) => not planning-backed, "unusable snapshot falls
 * back safely" — the Dashboard does NOT walk back to an older, usable
 * snapshot; it treats this exactly as "no usable Planning position" and
 * the caller (`positionsFor`) falls through to Weekly/Monthly.
 * ------------------------------------------------------------------- */
{
  const noPlanned = deriveDashboardPlanningFigures(rollup({ plannedProgress: null }));
  assertEqual(noPlanned.planningBacked, false, "latest snapshot missing plannedProgress: unusable, falls back safely");

  const noActual = deriveDashboardPlanningFigures(rollup({ actualProgress: null }));
  assertEqual(noActual.planningBacked, false, "latest snapshot missing actualProgress: unusable, falls back safely");

  const neither = deriveDashboardPlanningFigures(
    rollup({ plannedProgress: null, actualProgress: null, spi: null })
  );
  assertEqual(neither.planningBacked, false, "latest snapshot with no weighted data at all: unusable, falls back safely");
}

/* ---------------------------------------------------------------------
 * 4. SPI = EV/PV; unavailable (e.g. PV <= 0) => N/A, never a fabricated
 * ratio, even though Planned/Actual are still governed and usable.
 * ------------------------------------------------------------------- */
{
  const figures = deriveDashboardPlanningFigures(rollup({ spi: null }));
  assertEqual(figures.planningBacked, true, "spi unavailable: still planning-backed on planned/actual");
  assertEqual(figures.spi, null, "spi unavailable: spi is null (component renders N/A), never a fabricated ratio");
}

/* ---------------------------------------------------------------------
 * 5. planningProgressCurve — chronological Data Date order, published
 * snapshots only (structurally guaranteed by the caller sourcing rollups
 * from `listPublishedSnapshotRollups`), same-Data-Date collapses to the
 * LATEST version, and a snapshot with no usable rollup still contributes
 * a GAP point (null), never a fabricated 0 or an interpolated line.
 * ------------------------------------------------------------------- */
{
  const curve = planningProgressCurve([
    rollup({ snapshotId: "s3", snapshotVersion: 3, dataDate: "2026-09-15", plannedProgress: 80, actualProgress: 70 }),
    rollup({ snapshotId: "s1", snapshotVersion: 1, dataDate: "2026-08-01", plannedProgress: 40, actualProgress: 30 }),
    // Same Data Date as s1, but version 2: must WIN over s1's data on that date.
    rollup({ snapshotId: "s2", snapshotVersion: 2, dataDate: "2026-08-01", plannedProgress: 45, actualProgress: 35 }),
  ]);

  assertEqual(curve.length, 2, "same Data Date collapses two versions into one point");
  assertEqual(curve[0].dataDate, "2026-08-01", "chronological order: earliest Data Date first");
  assertEqual(curve[0].snapshotId, "s2", "same Data Date: the LATEST version (v2) wins over v1");
  assertEqual(curve[0].planned, 45, "same Data Date: figures come from the winning (v2) snapshot");
  assertEqual(curve[1].dataDate, "2026-09-15", "chronological order: later Data Date second");
  assertEqual(curve[1].snapshotId, "s3", "distinct Data Date: its own snapshot is plotted");

  const withGap = planningProgressCurve([
    rollup({ snapshotId: "g1", snapshotVersion: 1, dataDate: "2026-07-01", plannedProgress: 20, actualProgress: 15 }),
    rollup({ snapshotId: "g2", snapshotVersion: 1, dataDate: "2026-07-15", plannedProgress: null, actualProgress: null }),
  ]);
  assertEqual(withGap[1].planned, null, "an unusable snapshot on the curve is a GAP (null), never a fabricated 0");
  assertEqual(withGap[1].actual, null, "same for actual — never 0, never interpolated from neighbours");

  const draftExcluded = planningProgressCurve([
    rollup({ snapshotId: "d1", snapshotVersion: 1, dataDate: undefined }),
  ]);
  assertEqual(draftExcluded.length, 0, "a rollup with no Data Date (never true of a real published snapshot) is excluded, not plotted at an invented position");
}

console.log(`\n${pass} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);

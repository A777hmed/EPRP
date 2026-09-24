// Planning Integration 3C — Monthly pure-logic verification. LOCAL ONLY.
//
// Proves `deriveMonthlyPlanningFigures` and `monthlyDisplayFigures`
// (src/features/monthly-reports/planning-integration.ts) directly, with no
// database and no test framework — same convention as
// `verify_weekly_planning_integration.ts` (3B) and
// `verify_planning_rollup_math.ts`. This is the one module
// `monthly-report-service.ts` (create/update guard), `monthly-workspace.tsx`
// (OverviewPanel: locking the fields, showing provenance) and
// `monthly-report-document.tsx` (print/preview KPI summary) all call, so
// proving it here proves the decision every one of those call sites relies
// on.
//
// `deriveMonthlyPlanningFigures` is deliberately a SEPARATE function from
// Weekly's `deriveWeeklyPlanningFigures` — Monthly resolves its own
// snapshot independently per the 3C brief, never inheriting Weekly's pin on
// the same project — but the "is this rollup usable" gate is the identical
// one-line rule, so this file mirrors `verify_weekly_planning_integration.ts`
// section-for-section rather than inventing a different shape of proof.
//
// HOW TO RUN (from eprp/)
//   npx tsc scripts/p0-validation/verify_monthly_planning_integration.ts \
//     --outDir .tmp-monthly-check --module commonjs --target es2020 \
//     --moduleResolution node --esModuleInterop --skipLibCheck
//   node .tmp-monthly-check/scripts/p0-validation/verify_monthly_planning_integration.js
//   rm -rf .tmp-monthly-check

import {
  deriveMonthlyPlanningFigures,
  monthlyDisplayFigures,
  type PlanningRollupLike,
} from "../../src/features/monthly-reports/planning-integration";

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
    coveragePercent: 90,
    ...overrides,
  };
}

/* ---------------------------------------------------------------------
 * 1. No rollup at all (no pinned snapshot) => unbacked, everything null.
 * ------------------------------------------------------------------- */
{
  const figures = deriveMonthlyPlanningFigures(null);
  assertEqual(figures.planningBacked, false, "no rollup: not planning-backed");
  assertEqual(figures.plannedProgress, null, "no rollup: plannedProgress is null");
  assertEqual(figures.actualProgress, null, "no rollup: actualProgress is null");
  assertEqual(figures.variance, null, "no rollup: variance is null");
  assertEqual(figures.spi, null, "no rollup: spi is null");
  assertEqual(figures.snapshotVersion, undefined, "no rollup: no snapshot provenance");

  const figuresUndefined = deriveMonthlyPlanningFigures(undefined);
  assertEqual(figuresUndefined.planningBacked, false, "undefined rollup: not planning-backed (same as null)");
}

/* ---------------------------------------------------------------------
 * 2. A usable rollup (both figures present) => planning-backed, values
 * and provenance passed through untouched.
 * ------------------------------------------------------------------- */
{
  const figures = deriveMonthlyPlanningFigures(rollup());
  assertEqual(figures.planningBacked, true, "usable rollup: planning-backed");
  assertEqual(figures.plannedProgress, 68, "usable rollup: plannedProgress passed through");
  assertEqual(figures.actualProgress, 55, "usable rollup: actualProgress passed through");
  assertEqual(figures.variance, -13, "usable rollup: variance passed through");
  assertEqual(figures.spi, 0.55, "usable rollup: spi (EV/PV) passed through");
  assertEqual(figures.snapshotId, "snap-1", "usable rollup: snapshotId provenance passed through");
  assertEqual(figures.snapshotVersion, 3, "usable rollup: snapshotVersion provenance passed through");
  assertEqual(figures.dataDate, "2026-09-01", "usable rollup: dataDate provenance passed through");
  assertEqual(figures.coveragePercent, 90, "usable rollup: coveragePercent provenance passed through");
}

/* ---------------------------------------------------------------------
 * 3. An eligible snapshot whose rollup has NO usable weighted data
 * (plannedProgress or actualProgress null) => NOT planning-backed. This
 * is the exact condition `create()` uses to decide NOT to pin at all —
 * see section 6 below, which names that mapping directly.
 * ------------------------------------------------------------------- */
{
  const noPlanned = deriveMonthlyPlanningFigures(rollup({ plannedProgress: null }));
  assertEqual(noPlanned.planningBacked, false, "rollup missing plannedProgress: not planning-backed (falls back to manual)");

  const noActual = deriveMonthlyPlanningFigures(rollup({ actualProgress: null }));
  assertEqual(noActual.planningBacked, false, "rollup missing actualProgress: not planning-backed (falls back to manual)");

  const neither = deriveMonthlyPlanningFigures(
    rollup({ plannedProgress: null, actualProgress: null, spi: null })
  );
  assertEqual(neither.planningBacked, false, "empty rollup (unweighted schedule): not planning-backed");
}

/* ---------------------------------------------------------------------
 * 4. SPI unavailable (e.g. PV <= 0) on an otherwise-usable rollup: still
 * planning-backed, but spi is null — never substituted with a fabricated
 * ratio.
 * ------------------------------------------------------------------- */
{
  const figures = deriveMonthlyPlanningFigures(rollup({ spi: null }));
  assertEqual(figures.planningBacked, true, "spi unavailable: still planning-backed on planned/actual");
  assertEqual(figures.spi, null, "spi unavailable: spi is null, never a fabricated ratio");
  assertEqual(figures.plannedProgress, 68, "spi unavailable: plannedProgress is unaffected");
}

/* ---------------------------------------------------------------------
 * 5. Variance passed through as-is, never recomputed here.
 * ------------------------------------------------------------------- */
{
  const figures = deriveMonthlyPlanningFigures(rollup({ variance: null }));
  assertEqual(figures.variance, null, "variance passed through as null, never recomputed as actual-planned locally");
}

/**
 * `create()`'s own pinning decision, reproduced exactly:
 *   planning_snapshot_id = figures.planningBacked ? snapshot.id : null
 */
function decidePin(snapshotId: string, r: PlanningRollupLike | null): string | null {
  return deriveMonthlyPlanningFigures(r).planningBacked ? snapshotId : null;
}

/* ---------------------------------------------------------------------
 * 6. Eligible snapshot, usable rollup => the snapshot IS pinned.
 * ------------------------------------------------------------------- */
{
  const pinned = decidePin("snap-usable", rollup());
  assertEqual(pinned, "snap-usable", "eligible snapshot + usable rollup: planning_snapshot_id is pinned to it");
}

/* ---------------------------------------------------------------------
 * 7. Eligible snapshot, but the rollup is missing Planned or Actual
 * Progress => NO pin. planning_snapshot_id stays null; the report is
 * indistinguishable from one where no snapshot ever resolved.
 * ------------------------------------------------------------------- */
{
  assertEqual(
    decidePin("snap-no-planned", rollup({ plannedProgress: null })),
    null,
    "eligible snapshot, rollup missing Planned Progress: NOT pinned — planning_snapshot_id stays null"
  );
  assertEqual(
    decidePin("snap-no-actual", rollup({ actualProgress: null })),
    null,
    "eligible snapshot, rollup missing Actual Progress: NOT pinned — planning_snapshot_id stays null"
  );
  assertEqual(
    decidePin("snap-empty", rollup({ plannedProgress: null, actualProgress: null, spi: null })),
    null,
    "eligible snapshot, empty/unweighted rollup: NOT pinned — report keeps its normal manual/fallback basis"
  );
}

/* ---------------------------------------------------------------------
 * 8. monthlyDisplayFigures — the workspace overview and print/preview
 * rendering call this, never the report's own stored spi/scheduleVariance
 * directly, once a snapshot is pinned. Planning-backed reads EV/PV;
 * EV/PV unavailable reads N/A (rendered by the component), never the
 * Actual%/Planned% ratio the report's own `spi` field would otherwise
 * show under the same label; the fallback path is untouched.
 * ------------------------------------------------------------------- */
{
  const report = { plannedProgress: 40, actualProgress: 30, scheduleVariance: -10, spi: 0.75 };

  const backed = monthlyDisplayFigures(report, rollup({ spi: 0.42 }));
  assertEqual(backed.planningBacked, true, "display, planning-backed: planningBacked is true");
  assertEqual(backed.planned, 68, "display, planning-backed: planned comes from the rollup, not the report's own column");
  assertEqual(backed.actual, 55, "display, planning-backed: actual comes from the rollup, not the report's own column");
  assertEqual(backed.spi, 0.42, "display, planning-backed with value data: spi is the rollup's EV/PV figure");

  const backedNoValue = monthlyDisplayFigures(report, rollup({ spi: null }));
  assertEqual(backedNoValue.planningBacked, true, "display, planning-backed with no value data: still planning-backed on planned/actual");
  assertEqual(backedNoValue.spi, null, "display, planning-backed with no value data: spi is null (component renders N/A) — never Actual/Planned");

  const fallback = monthlyDisplayFigures(report, null);
  assertEqual(fallback.planningBacked, false, "display, no pinned snapshot: fallback path unaffected by any of the above");
  assertEqual(fallback.planned, 40, "display, fallback: planned is the report's own stored column");
  assertEqual(fallback.actual, 30, "display, fallback: actual is the report's own stored column");
  assertEqual(fallback.variance, -10, "display, fallback: variance is the report's own stored column, not recomputed");
  assertEqual(fallback.spi, 0.75, "display, fallback: spi is the report's own stored column (Actual/Planned ratio) — correct for the manual case");

  const unusableRollup = monthlyDisplayFigures(report, rollup({ plannedProgress: null, actualProgress: null, spi: null }));
  assertEqual(unusableRollup.planningBacked, false, "display, eligible but unusable rollup: falls back to the report's own manual figures, exactly as if no snapshot resolved");
  assertEqual(unusableRollup.planned, 40, "display, eligible but unusable rollup: planned is still the report's own column");
}

console.log(`\n${pass} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);

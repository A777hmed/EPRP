// Planning Integration 3B — Weekly pure-logic verification. LOCAL ONLY.
//
// Proves `deriveWeeklyPlanningFigures`
// (src/features/weekly-reports/planning-integration.ts) directly, with no
// database and no test framework — same convention as
// `verify_planning_rollup_math.ts`. This is the one function
// `supabase-weekly-report-service.ts` (create/update guard),
// `workspace.ts` (progressSummary, consumed identically by the main
// workspace view AND the preview/print rendering) and
// `weekly-report-header-form.tsx` (locking the fields) all call, so
// proving it here proves the decision every one of those call sites
// relies on.
//
// Final-corrections update (3B): `figures.planningBacked` is now the
// SAME boolean `supabase-weekly-report-service.ts`'s `create()` uses to
// decide whether to pin `planning_snapshot_id` at all — an eligible
// snapshot whose rollup is missing Planned or Actual Progress is no
// longer pinned "for provenance"; the report is left exactly as if no
// snapshot had resolved. Sections 6-7 below name that mapping explicitly.
//
// `progressSummary`/`buildWeeklyWorkspace` in workspace.ts are NOT
// exercised here: that module pulls in `@/features/projects/assignment-
// rules` and other `@/`-aliased application code that only resolves inside
// the Next.js build, so it cannot compile standalone the way this file's
// one dependency (a zero-import pure module) can. Their wiring is covered
// by `npx tsc --noEmit` (full project, confirms the branching type-checks)
// and by direct code review — not by a second, duplicate run of this same
// logic.
//
// HOW TO RUN (from eprp/)
//   npx tsc scripts/p0-validation/verify_weekly_planning_integration.ts \
//     --outDir .tmp-weekly-check --module commonjs --target es2020 \
//     --moduleResolution node --esModuleInterop --skipLibCheck
//   node .tmp-weekly-check/scripts/p0-validation/verify_weekly_planning_integration.js
//   rm -rf .tmp-weekly-check

import {
  deriveWeeklyPlanningFigures,
  type PlanningRollupLike,
} from "../../src/features/weekly-reports/planning-integration";

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
  const figures = deriveWeeklyPlanningFigures(null);
  assertEqual(figures.planningBacked, false, "no rollup: not planning-backed");
  assertEqual(figures.plannedProgress, null, "no rollup: plannedProgress is null");
  assertEqual(figures.actualProgress, null, "no rollup: actualProgress is null");
  assertEqual(figures.variance, null, "no rollup: variance is null");
  assertEqual(figures.spi, null, "no rollup: spi is null");
  assertEqual(figures.snapshotVersion, undefined, "no rollup: no snapshot provenance");

  const figuresUndefined = deriveWeeklyPlanningFigures(undefined);
  assertEqual(figuresUndefined.planningBacked, false, "undefined rollup: not planning-backed (same as null)");
}

/* ---------------------------------------------------------------------
 * 2. A usable rollup (both figures present) => planning-backed, values
 * and provenance passed through untouched — never re-derived or rounded
 * here (that is a display/storage concern for the caller).
 * ------------------------------------------------------------------- */
{
  const figures = deriveWeeklyPlanningFigures(rollup());
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
 * is the exact condition `create()` now uses to decide NOT to pin at
 * all — see section 6 below, which names that mapping directly.
 * ------------------------------------------------------------------- */
{
  const noPlanned = deriveWeeklyPlanningFigures(rollup({ plannedProgress: null }));
  assertEqual(noPlanned.planningBacked, false, "rollup missing plannedProgress: not planning-backed (falls back to manual)");

  const noActual = deriveWeeklyPlanningFigures(rollup({ actualProgress: null }));
  assertEqual(noActual.planningBacked, false, "rollup missing actualProgress: not planning-backed (falls back to manual)");

  const neither = deriveWeeklyPlanningFigures(
    rollup({ plannedProgress: null, actualProgress: null, spi: null })
  );
  assertEqual(neither.planningBacked, false, "empty rollup (unweighted schedule): not planning-backed");
}

/* ---------------------------------------------------------------------
 * 4. SPI unavailable (e.g. PV <= 0) on an otherwise-usable rollup: still
 * planning-backed (planned/actual are real weighted figures), but spi is
 * null — never substituted with a fabricated ratio.
 * ------------------------------------------------------------------- */
{
  const figures = deriveWeeklyPlanningFigures(rollup({ spi: null }));
  assertEqual(figures.planningBacked, true, "spi unavailable: still planning-backed on planned/actual");
  assertEqual(figures.spi, null, "spi unavailable: spi is null, never a fabricated ratio");
  assertEqual(figures.plannedProgress, 68, "spi unavailable: plannedProgress is unaffected");
}

/* ---------------------------------------------------------------------
 * 5. Variance null (e.g. plannedProgress or actualProgress individually
 * absent from the underlying rollup, even though this specific
 * combination cannot arise from computeRollupFromActivities today) must
 * never be silently recomputed here — this function passes rollup.variance
 * through as-is rather than re-deriving it from planned/actual, so a
 * future rollup shape change cannot introduce a second variance formula.
 * ------------------------------------------------------------------- */
{
  const figures = deriveWeeklyPlanningFigures(rollup({ variance: null }));
  assertEqual(figures.variance, null, "variance passed through as null, never recomputed as actual-planned locally");
}

/**
 * `create()`'s own pinning decision, reproduced exactly:
 *   planning_snapshot_id = figures.planningBacked ? snapshot.id : null
 * A resolved snapshot alone is never enough — only a USABLE rollup earns
 * the pin. Named here so a change to this one-line rule in the real
 * service is provably the same rule these tests already cover.
 */
function decidePin(snapshotId: string, r: PlanningRollupLike | null): string | null {
  return deriveWeeklyPlanningFigures(r).planningBacked ? snapshotId : null;
}

/* ---------------------------------------------------------------------
 * 6. Eligible snapshot, usable rollup (both Planned and Actual present)
 * => the snapshot IS pinned.
 * ------------------------------------------------------------------- */
{
  const pinned = decidePin("snap-usable", rollup());
  assertEqual(pinned, "snap-usable", "eligible snapshot + usable rollup: planning_snapshot_id is pinned to it");
}

/* ---------------------------------------------------------------------
 * 7. Eligible snapshot, but the rollup is missing Planned or Actual
 * Progress => NO pin. planning_snapshot_id stays null; the report is
 * indistinguishable from one where no snapshot ever resolved, and the
 * manual/fallback fields remain editable (enforced by the SAME
 * `planningBacked` flag in weekly-report-header-form.tsx).
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
 * 8. Preview SPI (weekly-report-preview.tsx renders `summary.spi` via
 * `progressSummary()`, exactly like the main workspace view — no second
 * SPI calculation exists anywhere). Planning-backed uses EV/PV; EV/PV
 * unavailable reads N/A (rendered by the component), never the
 * Actual%/Planned% ratio; the fallback path is untouched.
 * ------------------------------------------------------------------- */
{
  const backed = deriveWeeklyPlanningFigures(rollup({ spi: 0.42 }));
  assertEqual(backed.spi, 0.42, "preview, planning-backed with value data: spi is the rollup's EV/PV figure");

  const backedNoValue = deriveWeeklyPlanningFigures(rollup({ spi: null }));
  assertEqual(backedNoValue.planningBacked, true, "preview, planning-backed with no value data: still planning-backed on planned/actual");
  assertEqual(backedNoValue.spi, null, "preview, planning-backed with no value data: spi is null (component renders N/A) — never Actual/Planned");

  const fallback = deriveWeeklyPlanningFigures(null);
  assertEqual(fallback.planningBacked, false, "preview, no pinned snapshot: fallback path unaffected by any of the above");
}

console.log(`\n${pass} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);

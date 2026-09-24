// Planning Integration 3A — pure rollup math verification. LOCAL ONLY.
//
// Proves the weighted-rollup rules from `src/lib/planning-rollup.ts`
// directly, with no database and no test framework (none exists in this
// project yet — see package.json). A standalone script, compiled and run
// like any other local rehearsal step in this directory.
//
// HOW TO RUN (from eprp/)
//   npx tsc scripts/p0-validation/verify_planning_rollup_math.ts \
//     --outDir .tmp-rollup-check --module commonjs --target es2020 \
//     --moduleResolution node --esModuleInterop --skipLibCheck
//   node .tmp-rollup-check/scripts/p0-validation/verify_planning_rollup_math.js
//   rm -rf .tmp-rollup-check
//
// Deliberately imports `planning-rollup.ts` by relative path, not the `@/`
// alias — that alias only resolves inside the Next.js build, and this
// script needs to compile standalone without one.

import { computeRollupFromActivities, type RollupActivityInput } from "../../src/lib/planning-rollup";

let pass = 0;
let fail = 0;

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const ok = Object.is(actual, expected);
  if (ok) {
    pass += 1;
    console.log(`PASS — ${label}`);
  } else {
    fail += 1;
    console.log(`FAIL — ${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

function assertClose(actual: number | null, expected: number, label: string, epsilon = 1e-9): void {
  const ok = actual !== null && Math.abs(actual - expected) < epsilon;
  if (ok) {
    pass += 1;
    console.log(`PASS — ${label}`);
  } else {
    fail += 1;
    console.log(`FAIL — ${label} (expected ~${expected}, got ${actual})`);
  }
}

/* ---------------------------------------------------------------------
 * 1. Weighted rollup — not a simple average.
 *
 * A(weight 80, planned 100, physical 100) + B(weight 20, planned 0, physical 0)
 * Simple average would read 50/50. Weighted must read 80/20.
 * ------------------------------------------------------------------- */
{
  const activities: RollupActivityInput[] = [
    { weightPercent: 80, percentCompletePlanned: 100, percentCompletePhysical: 100 },
    { weightPercent: 20, percentCompletePlanned: 0, percentCompletePhysical: 0 },
  ];
  const rollup = computeRollupFromActivities(activities);
  assertClose(rollup.plannedProgress, 80, "weighted rollup: plannedProgress is weight-weighted (80), not a simple average (50)");
  assertClose(rollup.actualProgress, 80, "weighted rollup: actualProgress is weight-weighted (80), not a simple average (50)");
  assertClose(rollup.variance, 0, "weighted rollup: variance is 0 when planned and actual match");
  assertEqual(rollup.coveragePercent, 100, "weighted rollup: full coverage when every weighted activity reports both figures");
}

/* ---------------------------------------------------------------------
 * 2. Partial coverage — one activity unreported.
 *
 * A(weight 60, planned 80, physical 70) reports; B(weight 40) carries a
 * weight but no percentages at all. The average must reflect ONLY A —
 * never treat B's absence as 0% — and coverage must read 60%, the exact
 * share of the schedule's weight that actually has a figure behind it.
 * ------------------------------------------------------------------- */
{
  const activities: RollupActivityInput[] = [
    { weightPercent: 60, percentCompletePlanned: 80, percentCompletePhysical: 70 },
    { weightPercent: 40 },
  ];
  const rollup = computeRollupFromActivities(activities);
  assertClose(rollup.plannedProgress, 80, "partial coverage: plannedProgress reflects only the reporting activity (80), not diluted by the silent one");
  assertClose(rollup.actualProgress, 70, "partial coverage: actualProgress reflects only the reporting activity (70)");
  assertEqual(rollup.coveragePercent, 60, "partial coverage: coveragePercent is exactly the reporting weight's share of total weight (60%)");
}

/* ---------------------------------------------------------------------
 * 3. Absence is not zero — the fully-unreported activity's weight must
 * still count toward the total (denominator of coverage) but never
 * toward the numerator of either average, and never as a literal 0%.
 * ------------------------------------------------------------------- */
{
  const activities: RollupActivityInput[] = [
    { weightPercent: 50, percentCompletePlanned: 40, percentCompletePhysical: 40 },
    { weightPercent: 50 }, // no percentages at all
  ];
  const rollup = computeRollupFromActivities(activities);
  // If the unreported activity were wrongly treated as 0%, the weighted
  // average would read 20 (50*40 + 50*0)/100. The correct rule excludes
  // it from the average entirely, reading 40.
  assertClose(rollup.plannedProgress, 40, "absence is not zero: an unreported 50%-weight activity does not drag the average to 20");
  assertClose(rollup.actualProgress, 40, "absence is not zero: same rule holds for actualProgress");
  assertEqual(rollup.coveragePercent, 50, "absence is not zero: the unreported activity still counts in the coverage denominator (50%)");
}

/* ---------------------------------------------------------------------
 * 4. Zero-weight and unweighted activities take no part at all.
 * ------------------------------------------------------------------- */
{
  const activities: RollupActivityInput[] = [
    { weightPercent: 0, percentCompletePlanned: 999, percentCompletePhysical: 999 },
    { percentCompletePlanned: 50, percentCompletePhysical: 50 }, // no weight field
    { weightPercent: 30, percentCompletePlanned: 60, percentCompletePhysical: 60 },
  ];
  const rollup = computeRollupFromActivities(activities);
  assertClose(rollup.plannedProgress, 60, "zero/absent weight: activities with no positive weight never enter the rollup, however extreme their percentage");
  assertEqual(rollup.coveragePercent, 100, "zero/absent weight: total weight only counts the one genuinely weighted, fully-reported activity");
}

/* ---------------------------------------------------------------------
 * 5. Earned Value / Planned Value SPI — never Actual% / Planned%.
 * ------------------------------------------------------------------- */
{
  const activities: RollupActivityInput[] = [
    { weightPercent: 50, percentCompletePlanned: 20, percentCompletePhysical: 90, plannedValue: 100_000, earnedValue: 50_000 },
    { weightPercent: 50, percentCompletePlanned: 20, percentCompletePhysical: 90, plannedValue: 100_000, earnedValue: 50_000 },
  ];
  const rollup = computeRollupFromActivities(activities);
  // Planned/Actual % rollup is 20/90 — an SPI naively taken from those
  // (90/20 = 4.5) must NOT be what comes out. EV/PV = 100000/200000 = 0.5.
  assertClose(rollup.plannedValue, 200_000, "EV/PV SPI: plannedValue is the real sum (200,000)");
  assertClose(rollup.earnedValue, 100_000, "EV/PV SPI: earnedValue is the real sum (100,000)");
  assertClose(rollup.spi, 0.5, "EV/PV SPI: spi is EV/PV (0.5), not Actual%/Planned% (which would read 4.5)");
}

/* ---------------------------------------------------------------------
 * 6. PV <= 0 => SPI unavailable, even when EV is present.
 * ------------------------------------------------------------------- */
{
  const zeroPv: RollupActivityInput[] = [
    { weightPercent: 100, percentCompletePlanned: 50, percentCompletePhysical: 50, plannedValue: 0, earnedValue: 10_000 },
  ];
  assertEqual(computeRollupFromActivities(zeroPv).spi, null, "PV <= 0: spi is unavailable (null) when planned value is exactly 0");

  const negativePv: RollupActivityInput[] = [
    { weightPercent: 100, plannedValue: -5, earnedValue: 10 },
  ];
  assertEqual(computeRollupFromActivities(negativePv).spi, null, "PV <= 0: spi is unavailable (null) when the planned value sum is negative");
}

/* ---------------------------------------------------------------------
 * 7. No value data anywhere => plannedValue/earnedValue/spi are null,
 * never a fabricated 0.
 * ------------------------------------------------------------------- */
{
  const noValueData: RollupActivityInput[] = [
    { weightPercent: 100, percentCompletePlanned: 50, percentCompletePhysical: 60 },
  ];
  const rollup = computeRollupFromActivities(noValueData);
  assertEqual(rollup.plannedValue, null, "no value data: plannedValue is null, not 0, when nothing reports one");
  assertEqual(rollup.earnedValue, null, "no value data: earnedValue is null, not 0");
  assertEqual(rollup.spi, null, "no value data: spi is unavailable, not a fabricated ratio");
}

/* ---------------------------------------------------------------------
 * 8. Empty / fully-unweighted schedule => everything is null/0, never a
 * fabricated figure.
 * ------------------------------------------------------------------- */
{
  const empty = computeRollupFromActivities([]);
  assertEqual(empty.plannedProgress, null, "empty schedule: plannedProgress is null");
  assertEqual(empty.actualProgress, null, "empty schedule: actualProgress is null");
  assertEqual(empty.variance, null, "empty schedule: variance is null");
  assertEqual(empty.coveragePercent, 0, "empty schedule: coveragePercent is 0");
  assertEqual(empty.spi, null, "empty schedule: spi is unavailable");

  const noWeights = computeRollupFromActivities([
    { percentCompletePlanned: 50, percentCompletePhysical: 60 },
    { percentCompletePlanned: 10, percentCompletePhysical: 10 },
  ]);
  assertEqual(noWeights.plannedProgress, null, "no activity carries a weight: plannedProgress is null, never an unweighted mean");
  assertEqual(noWeights.coveragePercent, 0, "no activity carries a weight: coveragePercent is 0");
}

/* ---------------------------------------------------------------------
 * 9. Variance is null unless BOTH planned and actual are present.
 * ------------------------------------------------------------------- */
{
  const plannedOnly = computeRollupFromActivities([
    { weightPercent: 100, percentCompletePlanned: 40 },
  ]);
  assertEqual(plannedOnly.actualProgress, null, "planned-only activity: actualProgress is null");
  assertEqual(plannedOnly.variance, null, "planned-only activity: variance is null, never computed against a missing actual");
}

console.log(`\n${pass} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);

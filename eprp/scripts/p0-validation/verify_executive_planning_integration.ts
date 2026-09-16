// Planning Integration 3E — Executive Report pure-logic verification.
// LOCAL ONLY.
//
// Proves `selectOfficialMonthly` (existing, unchanged) and
// `executiveFiguresFor` (new, 3E) directly from
// `src/features/executive-reports/executive-data.ts`, against REAL
// `MonthlyReport` fixtures — not the standalone-compile technique
// `verify_weekly/monthly/dashboard_planning_integration.ts` use, because
// `executive-data.ts` has no React/hooks and its only other `@/` imports
// (`@/config/workflows`, `@/lib/constants`, `@/lib/reporting`,
// `@/features/monthly-reports/planning-integration`) are themselves
// dependency-light enough to resolve under `tsx`'s tsconfig-paths support.
// This is a stronger guarantee than the pure-module convention: it exercises
// the ACTUAL Executive selection/derivation code, not a hand-copied
// reproduction of its logic.
//
// `executiveFiguresFor` is a thin, deliberate wrapper: it delegates to
// Monthly's OWN `monthlyDisplayFigures` (3C, already proven 40/40 in
// `verify_monthly_planning_integration.ts`) rather than re-implementing the
// "is this rollup usable" gate a third time. Proving the wrapper here proves
// Executive gets EXACTLY what Monthly's own workspace/print view would show
// for the same report — the "avoid inconsistent numbers between Monthly and
// Executive" requirement — by construction, not by parallel maintenance.
//
// `aggregatePortfolio` (portfolio unweighted-mean audit) is NOT re-tested
// here: it is pre-existing, unchanged by 3E, and its `basisNote` output
// ("Unweighted mean of N approved Monthly Reports...") is already visible
// in both `executive-document.tsx` and `executive-workspace.tsx` — verified
// by code review and the browser check, not duplicated as a unit test.
//
// HOW TO RUN (from eprp/, requires tsx and the project's tsconfig paths)
//   npx tsx scripts/p0-validation/verify_executive_planning_integration.ts

import {
  selectOfficialMonthly,
  executiveFiguresFor,
  isApprovedMonthly,
} from "../../src/features/executive-reports/executive-data";
import type { PlanningRollupLike } from "../../src/features/monthly-reports/planning-integration";
import type { MonthlyReport } from "../../src/types";

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

let seq = 0;
function monthly(overrides: Partial<MonthlyReport> = {}): MonthlyReport {
  seq += 1;
  return {
    id: `m-${seq}`,
    reportNumber: `EPR-ZZTEST-M-2026-${String(seq).padStart(2, "0")}`,
    projectId: "proj-a",
    status: "draft",
    source: "platform",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    reportingMonth: "2026-09-01",
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    attachmentIds: [],
    plannedProgress: 60,
    actualProgress: 50,
    scheduleVariance: -10,
    spi: 0.83,
    ...overrides,
  };
}

function rollup(overrides: Partial<PlanningRollupLike> = {}): PlanningRollupLike {
  return {
    snapshotId: "snap-1",
    snapshotVersion: 2,
    dataDate: "2026-09-15",
    plannedProgress: 72,
    actualProgress: 61,
    variance: -11,
    spi: 0.68,
    coveragePercent: 95,
    ...overrides,
  };
}

/* =========================================================================
 * selectOfficialMonthly — "Executive uses approved Monthly only" /
 * "draft/unapproved Monthly never contributes"
 * ========================================================================= */

{
  const draftOnly = monthly({ id: "d1", status: "draft", updatedAt: "2026-09-05T00:00:00Z" });
  const selection = selectOfficialMonthly([draftOnly], "2026-09");
  assertEqual(selection.basis, "draft", "no approved Monthly in the month: basis is draft, not approved");
  assertEqual(selection.report?.id, "d1", "draft-only month: the draft is still surfaced (for visibility), not hidden");
}

{
  const approved = monthly({ id: "a1", status: "approved", updatedAt: "2026-09-10T00:00:00Z" });
  const laterDraft = monthly({ id: "d2", status: "draft", updatedAt: "2026-09-20T00:00:00Z" });
  const selection = selectOfficialMonthly([approved, laterDraft], "2026-09");
  assertEqual(selection.basis, "approved", "an approved Monthly exists: basis is approved even though a NEWER draft exists");
  assertEqual(selection.report?.id, "a1", "the approved report is selected, not the more-recently-updated draft");
}

{
  const selection = selectOfficialMonthly([], "2026-09");
  assertEqual(selection.basis, "none", "no Monthly Report at all in the month: basis is none");
  assertEqual(selection.report, undefined, "basis none: no report object, never invented");
}

{
  const outsideMonth = monthly({ id: "o1", status: "approved", reportingMonth: "2026-08-01" });
  const selection = selectOfficialMonthly([outsideMonth], "2026-09");
  assertEqual(selection.basis, "none", "a Monthly from a DIFFERENT month never contributes to this month's selection");
}

{
  // Two approved candidates in the same month: the more RECENTLY UPDATED one wins.
  const older = monthly({ id: "a-old", status: "finalized", updatedAt: "2026-09-05T00:00:00Z" });
  const newer = monthly({ id: "a-new", status: "approved", updatedAt: "2026-09-25T00:00:00Z" });
  const selection = selectOfficialMonthly([older, newer], "2026-09");
  assertEqual(selection.report?.id, "a-new", "two approved candidates: the most recently updated approved report wins");
}

for (const status of ["draft", "collecting", "under_review", "returned", "rejected", "archived"] as const) {
  const report = monthly({ id: `s-${status}`, status });
  assertEqual(isApprovedMonthly(report), false, `status "${status}" does not count as approved`);
}
for (const status of ["approved", "finalized", "locked"] as const) {
  const report = monthly({ id: `s-${status}`, status });
  assertEqual(isApprovedMonthly(report), true, `status "${status}" counts as approved`);
}

/* =========================================================================
 * executiveFiguresFor — Planning-backed propagation, fallback, SPI, N/A,
 * provenance, "never mix"
 * ========================================================================= */

{
  const figures = executiveFiguresFor(undefined, null);
  assertEqual(figures, undefined, "no Monthly at all: figures is undefined (absence is never zero)");
}

{
  // No pin at all — the existing fallback path, unaffected.
  const report = monthly({ plannedProgress: 60, actualProgress: 50, scheduleVariance: -10, spi: 0.83 });
  const figures = executiveFiguresFor(report, null);
  assertEqual(figures?.planningBacked, false, "no planning_snapshot_id: not planning-backed — existing fallback path");
  assertEqual(figures?.planned, 60, "fallback: planned is the Monthly's own stored column");
  assertEqual(figures?.actual, 50, "fallback: actual is the Monthly's own stored column");
  assertEqual(figures?.variance, -10, "fallback: variance is the Monthly's own stored column, not recomputed");
  assertEqual(figures?.spi, 0.83, "fallback: spi is the Monthly's own Actual/Planned ratio — correct for the manual case");
}

{
  // Pinned, but the rollup could not be read (fetch failure / not found) —
  // "unusable Planning snapshot falls back safely".
  const report = monthly({ planningSnapshotId: "snap-missing", plannedProgress: 60, actualProgress: 50, scheduleVariance: -10, spi: 0.83 });
  const figures = executiveFiguresFor(report, null);
  assertEqual(figures?.planningBacked, false, "pinned but rollup unavailable: falls back safely, never blocks the row");
  assertEqual(figures?.planned, 60, "unusable pin: planned is still the Monthly's own stored column");
}

{
  // Pinned, rollup resolves, but is missing Planned or Actual — eligible but unusable.
  const report = monthly({ planningSnapshotId: "snap-1" });
  const figures = executiveFiguresFor(report, rollup({ plannedProgress: null }));
  assertEqual(figures?.planningBacked, false, "pinned rollup missing Planned Progress: unusable, falls back to the Monthly's own columns");
}

{
  // The governed case: pinned AND usable — every figure from the SAME rollup.
  const report = monthly({ planningSnapshotId: "snap-1", plannedProgress: 999, actualProgress: 999, scheduleVariance: 999, spi: 999 });
  const figures = executiveFiguresFor(report, rollup());
  assertEqual(figures?.planningBacked, true, "pinned and usable: planning-backed");
  assertEqual(figures?.planned, 72, "planning-backed: planned comes from the rollup, NEVER the Monthly's own stored 999");
  assertEqual(figures?.actual, 61, "planning-backed: actual comes from the SAME rollup, never mixed with a manual figure");
  assertEqual(figures?.variance, -11, "planning-backed: variance comes from the SAME rollup basis as planned/actual");
  assertEqual(figures?.spi, 0.68, "planning-backed: spi (EV/PV) comes from the SAME rollup — never the Monthly's stored ratio (999)");
  assertEqual(figures?.snapshotVersion, 2, "provenance: snapshot version survives into Executive");
  assertEqual(figures?.dataDate, "2026-09-15", "provenance: Data Date survives into Executive");
  assertEqual(figures?.coveragePercent, 95, "provenance: coverage survives into Executive");
}

{
  // SPI unavailable (PV <= 0 or no value data) on an otherwise-usable rollup: N/A, never a fabricated ratio.
  const report = monthly({ planningSnapshotId: "snap-1" });
  const figures = executiveFiguresFor(report, rollup({ spi: null }));
  assertEqual(figures?.planningBacked, true, "spi unavailable: still planning-backed on planned/actual");
  assertEqual(figures?.spi, null, "spi unavailable: spi is null (Executive renders N/A) — never Actual/Planned recomputed");
  assertEqual(figures?.planned, 72, "spi unavailable: planned/actual are unaffected");
}

console.log(`\n${pass} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);

/**
 * The Project Progress Curve — Dashboard UX.
 *
 * INVESTIGATION (governed time-phased baseline reconciliation): a prior
 * version of this module time-phased the Planned line from each activity's
 * own `plannedStartDate`/`plannedFinishDate`/`weightPercent` via straight-
 * line interpolation, to give Planned a denser curve than the sparse real
 * snapshot dates. Browser review against real data caught this disagreeing
 * with the governed figures — a portfolio confirmed at Planned 64.0% /
 * Actual 55.4% as of Sep 30 rendered as Planned 82.4%.
 *
 * The schema has NO governed time-phased baseline to reconcile against:
 * `PlanningSnapshotActivity.percentCompletePlanned` is ONE point-in-time
 * figure per activity per snapshot, captured by the scheduling tool at
 * that snapshot's Data Date — not a stored planned-value-by-period series.
 * Nothing in Planning, Weekly, Monthly or the Dashboard computes one
 * either; `computeRollupFromActivities` (`lib/planning-rollup.ts`) already
 * folds those per-activity figures into the ONE governed Planned% a
 * snapshot reports, and that is the number every other surface — the KPI
 * strip, Weekly, Monthly — calls "Planned". A straight-line date interpolation
 * is a DIFFERENT computation from whatever the scheduling tool actually
 * used (resource loading, S-curve weighting, calendars, etc.), so it
 * produces a DIFFERENT number — not a denser view of the same one. That
 * makes it fabrication, however real the underlying dates and weights are,
 * and it is not used here again.
 *
 * So: Planned and Actual are BOTH plotted only at real, governed published
 * Planning Snapshot Data Dates — connecting real historical positions,
 * never interpolating or inventing one. This is exactly
 * `planningProgressCurve`'s own output; this module exists only to carry
 * that into the richer `ProjectProgressCurvePoint` shape the chart and
 * modal already expect.
 *
 * Pure, no storage, no Supabase, no `@/` imports — same standalone-
 * testable convention as `planning-integration.ts`.
 */

import type { ProgressCurvePoint } from "./planning-integration";

export interface ProjectProgressCurvePoint {
  dataDate: string;
  /** The snapshot's own governed Planned% — identical to what the KPI
      strip reads for this snapshot. `null` is a gap, never 0. */
  planned: number | null;
  /** The snapshot's own governed Actual%. `null` is a gap, never 0. */
  actual: number | null;
  snapshotId?: string;
  snapshotVersion?: number;
}

/**
 * The real, governed Planning Snapshot history — chronological, one point
 * per published Data Date, Planned and Actual both taken directly from
 * that snapshot's own rollup. No date is added beyond what
 * `planningProgressCurve` already produced, and no value here can ever
 * disagree with a KPI reading of the same snapshot, because both read the
 * identical rollup figure.
 */
export function buildProjectProgressCurve(snapshotCurve: readonly ProgressCurvePoint[]): ProjectProgressCurvePoint[] {
  return snapshotCurve.map((point) => ({
    dataDate: point.dataDate,
    planned: point.planned,
    actual: point.actual,
    snapshotId: point.snapshotId,
    snapshotVersion: point.snapshotVersion,
  }));
}

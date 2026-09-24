/**
 * Pure display helpers over one snapshot's `PlanningSnapshotActivity[]` —
 * Dashboard Data Depth (Activity Progress + Coverage Detail). Every figure
 * here is read directly off the governed rows; nothing is recomputed
 * differently than `computeRollupFromActivities` (`lib/planning-rollup.ts`)
 * already does — this module classifies the SAME rows for display, it does
 * not derive a second Coverage% or a second Planned/Actual.
 */

import type { PlanningSnapshotActivity } from "@/types";

export interface ActivityProgressRow {
  activity: PlanningSnapshotActivity;
  /** `null` unless BOTH a planned and a physical figure are reported —
      identical gate to the rollup's own `bothWeight`. */
  variance: number | null;
}

/**
 * Every activity paired with its own planned-vs-physical variance (or
 * `null` when it cannot be computed), sorted worst-behind first. An
 * activity with no computable variance sorts after every activity that has
 * one — never coerced to 0, which would misreport "no data" as "on plan".
 */
export function activityProgressRows(
  activities: readonly PlanningSnapshotActivity[]
): ActivityProgressRow[] {
  return activities
    .map((activity) => {
      const planned = activity.percentCompletePlanned;
      const physical = activity.percentCompletePhysical;
      const variance =
        typeof planned === "number" && typeof physical === "number" ? physical - planned : null;
      return { activity, variance };
    })
    .sort((a, b) => {
      if (a.variance === null && b.variance === null) return 0;
      if (a.variance === null) return 1;
      if (b.variance === null) return -1;
      return a.variance - b.variance;
    });
}

export interface CoverageBreakdown {
  /** Sum of `weightPercent` across every activity that carries one — the
      same denominator the rollup's own Coverage% divides by. 0 when no
      activity in the snapshot carries a weight at all. */
  totalWeight: number;
  includedWeight: number;
  includedCount: number;
  missingWeight: number;
  missingCount: number;
  /** Activities excluded from the rollup entirely (no positive weight) —
      reported separately since they count toward neither side of Coverage. */
  unweightedCount: number;
}

function isPositiveWeight(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isReported(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Classifies a snapshot's activities into "both Planned and Physical
 * reported" (included in Coverage) versus "weighted but missing one or both
 * figures" (missing progress data — NOT zero, simply not yet reported) —
 * the exact split `computeRollupFromActivities` folds into `coveragePercent`,
 * broken out here for the drill-down to show rather than just the ratio.
 */
export function coverageBreakdown(activities: readonly PlanningSnapshotActivity[]): CoverageBreakdown {
  let totalWeight = 0;
  let includedWeight = 0;
  let includedCount = 0;
  let missingCount = 0;
  let unweightedCount = 0;

  for (const activity of activities) {
    if (!isPositiveWeight(activity.weightPercent)) {
      unweightedCount += 1;
      continue;
    }
    totalWeight += activity.weightPercent;
    const bothReported = isReported(activity.percentCompletePlanned) && isReported(activity.percentCompletePhysical);
    if (bothReported) {
      includedWeight += activity.weightPercent;
      includedCount += 1;
    } else {
      missingCount += 1;
    }
  }

  return {
    totalWeight,
    includedWeight,
    includedCount,
    missingWeight: totalWeight - includedWeight,
    missingCount,
    unweightedCount,
  };
}

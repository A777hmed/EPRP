/**
 * Planning Snapshot rollup math (Planning Integration 3A).
 *
 * Pure functions, no storage, no Supabase — the same shape as
 * `features/projects/milestone-state.ts`: one place folds a snapshot's raw
 * activity rows into the headline figures, so Dashboard, Weekly, Monthly
 * and Executive cannot each derive "Planned/Actual/Variance/SPI" slightly
 * differently once they are wired to a Published Planning Snapshot.
 *
 * Weighted and coverage-aware throughout. An activity missing a weight or
 * a percentage takes no part in the corresponding average — it is never
 * counted as a 0. A schedule with no value data at all reports `null`
 * planned/earned value and an unavailable SPI, never a fabricated 0 or 1.
 */

/** The subset of a snapshot activity's fields the rollup actually reads. */
export interface RollupActivityInput {
  weightPercent?: number;
  percentCompletePlanned?: number;
  percentCompletePhysical?: number;
  plannedValue?: number;
  earnedValue?: number;
}

export interface SnapshotRollupMetrics {
  /** Weighted average of `percentCompletePlanned`, 0-100. `null` if nothing qualifies. */
  plannedProgress: number | null;
  /**
   * Weighted average of `percentCompletePhysical` — the source's own
   * weighted/earned-value-based figure, the correct pairing for a
   * weight-based rollup. Deliberately NOT `percentCompleteActual`, which
   * is duration-based and not weight-appropriate for this measure.
   */
  actualProgress: number | null;
  /** actualProgress - plannedProgress. `null` unless both are present. */
  variance: number | null;
  /** Sum of reported planned_value. `null` when no activity carries one. */
  plannedValue: number | null;
  /** Sum of reported earned_value. `null` when no activity carries one. */
  earnedValue: number | null;
  /**
   * Earned Value / Planned Value (Planning Integration 3A rule 6) — never
   * Actual% / Planned%. `null` when either value is unavailable or when
   * plannedValue <= 0.
   */
  spi: number | null;
  /**
   * Share (0-100) of the snapshot's total weighted schedule for which
   * BOTH plannedProgress and actualProgress had a reported figure behind
   * them. 0 when nothing in the snapshot carries a weight at all — the
   * same "how much of this number can you actually trust" signal
   * `registerProgress()` reports for the Master Milestone register.
   */
  coveragePercent: number;
}

function isPositiveWeight(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isReported(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Fold a snapshot's activities into its rollup.
 *
 * One pass: each weighted activity contributes to the planned average when
 * it reports `percentCompletePlanned`, to the actual average when it
 * reports `percentCompletePhysical`, and to `coveragePercent` only when it
 * reports both — an activity reporting just one figure is not "half
 * covered" toward a number that needs both to mean anything.
 */
export function computeRollupFromActivities(
  activities: readonly RollupActivityInput[]
): SnapshotRollupMetrics {
  let totalWeight = 0;
  let plannedWeight = 0;
  let plannedScore = 0;
  let actualWeight = 0;
  let actualScore = 0;
  let bothWeight = 0;

  for (const activity of activities) {
    if (!isPositiveWeight(activity.weightPercent)) continue;
    const weight = activity.weightPercent;
    totalWeight += weight;

    const plannedPercent = activity.percentCompletePlanned;
    const actualPercent = activity.percentCompletePhysical;
    const hasPlanned = isReported(plannedPercent);
    const hasActual = isReported(actualPercent);

    if (hasPlanned) {
      plannedWeight += weight;
      plannedScore += weight * plannedPercent;
    }
    if (hasActual) {
      actualWeight += weight;
      actualScore += weight * actualPercent;
    }
    if (hasPlanned && hasActual) bothWeight += weight;
  }

  const plannedProgress = plannedWeight > 0 ? plannedScore / plannedWeight : null;
  const actualProgress = actualWeight > 0 ? actualScore / actualWeight : null;
  const variance =
    plannedProgress !== null && actualProgress !== null
      ? actualProgress - plannedProgress
      : null;

  const plannedValue = sumReported(activities, "plannedValue");
  const earnedValue = sumReported(activities, "earnedValue");

  return {
    plannedProgress,
    actualProgress,
    variance,
    plannedValue,
    earnedValue,
    spi: computeSpi(plannedValue, earnedValue),
    coveragePercent: totalWeight > 0 ? (bothWeight / totalWeight) * 100 : 0,
  };
}

/**
 * Sum of a value field across activities that report one.
 *
 * An activity with no value contributes nothing to the sum — that is
 * correct for a sum, unlike averaging a missing percentage as 0. The field
 * as a whole is `null`, not 0, when NOT ONE activity reports it: a
 * schedule imported without cost/hour data has no planned or earned
 * value, and 0 would misstate that as "no value planned" rather than
 * "no value tracked".
 */
function sumReported(
  activities: readonly RollupActivityInput[],
  field: "plannedValue" | "earnedValue"
): number | null {
  let total = 0;
  let any = false;
  for (const activity of activities) {
    const value = activity[field];
    if (!isReported(value)) continue;
    any = true;
    total += value;
  }
  return any ? total : null;
}

function computeSpi(plannedValue: number | null, earnedValue: number | null): number | null {
  if (plannedValue === null || earnedValue === null) return null;
  if (plannedValue <= 0) return null;
  return earnedValue / plannedValue;
}

/** Opening Position input this module reads for a Snapshot promoted from
    one — see `rollupFromOpeningPosition`. */
export interface OpeningPositionRollupInput {
  plannedProgressPercent?: number;
  actualProgressPercent?: number;
}

/**
 * The rollup for a Snapshot promoted from an Opening Position.
 *
 * `computeRollupFromActivities` cannot see this snapshot's real figures: a
 * project onboarded mid-execution declares ONE starting position and that
 * promotes straight to Snapshot V1 with NO activities beneath it ("do not
 * create fake history" — see `PlanningOpeningPosition`) — so folding zero
 * activities always reads null/null, even though a real governed figure was
 * declared. This reads that figure directly instead.
 *
 * Same nullability discipline as the activity-based rollup: a missing
 * figure is `null`, never 0. `coveragePercent` is 100 only when BOTH
 * figures were actually declared — otherwise 0, the same "how much can you
 * trust this number" signal a single declared point can give.
 */
export function rollupFromOpeningPosition(opening: OpeningPositionRollupInput): SnapshotRollupMetrics {
  const plannedProgress = isReported(opening.plannedProgressPercent) ? opening.plannedProgressPercent : null;
  const actualProgress = isReported(opening.actualProgressPercent) ? opening.actualProgressPercent : null;
  return {
    plannedProgress,
    actualProgress,
    variance: plannedProgress !== null && actualProgress !== null ? actualProgress - plannedProgress : null,
    plannedValue: null,
    earnedValue: null,
    spi: null,
    coveragePercent: plannedProgress !== null && actualProgress !== null ? 100 : 0,
  };
}

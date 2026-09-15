/**
 * Weekly ↔ Planning integration (3B). Pure, no storage, no Supabase, no
 * `@/` imports — same standalone-testable convention as `lib/planning-
 * rollup.ts` and `lib/reporting.ts`. The one place that decides whether a
 * Weekly Report is Planning-backed and what figures that implies, reused
 * by the creation flow (what to write), the workspace summary (what to
 * display), and the edit form (whether the planned/actual fields are
 * locked). Nothing else re-derives this decision.
 *
 * A rollup counts as Planning-backed only when it actually has BOTH a
 * planned and an actual figure — never "Planning-backed with a 0%" for a
 * rollup that has neither. `create()` uses this SAME flag to decide
 * whether to pin `planning_snapshot_id` at all: an eligible snapshot whose
 * rollup fails this check is never pinned, so a genuinely pinned report is
 * always planning-backed. This function still checks both independently
 * (rather than assuming "pinned implies usable") so a caller handed a
 * rollup from any source gets the correct answer, not a hopeful one.
 */

/**
 * The subset of `PlanningSnapshotRollup` (services/planning-rollup-service)
 * this module actually reads. Declared locally, not imported, so this file
 * stays a zero-dependency pure module — any object structurally shaped like
 * this (the real rollup included) satisfies it.
 */
export interface PlanningRollupLike {
  plannedProgress: number | null;
  actualProgress: number | null;
  variance: number | null;
  spi: number | null;
  snapshotId: string;
  snapshotVersion: number;
  dataDate?: string;
  coveragePercent: number;
}

export interface WeeklyPlanningFigures {
  planningBacked: boolean;
  /** Weighted rollup figures, or `null` when unusable/absent — never 0 as a stand-in. */
  plannedProgress: number | null;
  actualProgress: number | null;
  variance: number | null;
  /** EV/PV. Never the Actual%/Planned% ratio — see `planning-rollup.ts`. */
  spi: number | null;
  snapshotId?: string;
  snapshotVersion?: number;
  dataDate?: string;
  coveragePercent?: number;
}

const UNBACKED: WeeklyPlanningFigures = {
  planningBacked: false,
  plannedProgress: null,
  actualProgress: null,
  variance: null,
  spi: null,
};

export function deriveWeeklyPlanningFigures(
  rollup: PlanningRollupLike | null | undefined
): WeeklyPlanningFigures {
  if (!rollup) return UNBACKED;

  const usable = rollup.plannedProgress !== null && rollup.actualProgress !== null;
  return {
    planningBacked: usable,
    plannedProgress: rollup.plannedProgress,
    actualProgress: rollup.actualProgress,
    variance: rollup.variance,
    spi: rollup.spi,
    snapshotId: rollup.snapshotId,
    snapshotVersion: rollup.snapshotVersion,
    dataDate: rollup.dataDate,
    coveragePercent: rollup.coveragePercent,
  };
}

/**
 * Monthly ↔ Planning integration (3C). Pure, no storage, no Supabase, no
 * `@/` imports — same standalone-testable convention as `lib/planning-
 * rollup.ts` and `weekly-reports/planning-integration.ts` (3B). The one
 * place that decides whether a Monthly Report is Planning-backed and what
 * figures that implies, reused by the creation flow (what to write), the
 * workspace overview (what to display and whether to lock the fields),
 * and the print/preview document. Nothing else re-derives this decision.
 *
 * Deliberately a SEPARATE module from Weekly's, not a shared one: per the
 * 3C brief, "Monthly resolves its own Planning Snapshot independently" —
 * it must never inherit the Weekly report's pin on the same project, and
 * giving each report kind its own tiny decision module keeps that
 * independence structural rather than a rule someone has to remember to
 * uphold. The actual rollup math (`computeRollupFromActivities`,
 * `planningRollupService`) is the one place that logic lives and IS fully
 * shared — nothing here duplicates it, only the "is this rollup usable"
 * gate one line below.
 *
 * A rollup counts as Planning-backed only when it actually has BOTH a
 * planned and an actual figure — never "Planning-backed with a 0%" for a
 * rollup that has neither. `create()` uses this SAME flag to decide
 * whether to pin `planning_snapshot_id` at all: an eligible snapshot whose
 * rollup fails this check is never pinned, so a genuinely pinned report is
 * always planning-backed.
 */

/**
 * The subset of `PlanningSnapshotRollup` (services/planning-rollup-service)
 * this module actually reads. Declared locally, not imported, so this file
 * stays a zero-dependency pure module — any object structurally shaped like
 * this (the real rollup included) satisfies it. Identical shape to
 * Weekly's `PlanningRollupLike` by construction — both mirror the same
 * rollup — but kept as its own declaration rather than a shared import, for
 * the same independence reason given above.
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

export interface MonthlyPlanningFigures {
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

const UNBACKED: MonthlyPlanningFigures = {
  planningBacked: false,
  plannedProgress: null,
  actualProgress: null,
  variance: null,
  spi: null,
};

export function deriveMonthlyPlanningFigures(
  rollup: PlanningRollupLike | null | undefined
): MonthlyPlanningFigures {
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

/**
 * The month's progress figures to DISPLAY, read the same way regardless of
 * caller (workspace overview panel, print/preview document): Planning-
 * backed reads planned/actual/variance/SPI from the governed rollup;
 * otherwise falls back to the report's own stored columns, with SPI/
 * variance computed by the caller's usual formula (passed in, not
 * re-derived here, so this module never invents a second SPI formula).
 */
export interface MonthlyDisplayFigures {
  planned: number;
  actual: number;
  variance: number | null;
  spi: number | null;
  planningBacked: boolean;
  snapshotVersion?: number;
  dataDate?: string;
  coveragePercent?: number;
}

export function monthlyDisplayFigures(
  report: { plannedProgress: number; actualProgress: number; scheduleVariance: number; spi: number },
  rollup: PlanningRollupLike | null | undefined
): MonthlyDisplayFigures {
  const figures = deriveMonthlyPlanningFigures(rollup);

  if (!figures.planningBacked) {
    return {
      planned: report.plannedProgress,
      actual: report.actualProgress,
      variance: report.scheduleVariance,
      spi: report.spi,
      planningBacked: false,
    };
  }

  return {
    planned: figures.plannedProgress!,
    actual: figures.actualProgress!,
    variance: figures.variance,
    spi: figures.spi,
    planningBacked: true,
    snapshotVersion: figures.snapshotVersion,
    dataDate: figures.dataDate,
    coveragePercent: figures.coveragePercent,
  };
}

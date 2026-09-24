/**
 * Dashboard ↔ Planning integration (3D). Pure, no storage, no Supabase, no
 * `@/` imports — same standalone-testable convention as `lib/planning-
 * rollup.ts`, `weekly-reports/planning-integration.ts` (3B) and
 * `monthly-reports/planning-integration.ts` (3C).
 *
 * The Dashboard asks a DIFFERENT question from Weekly/Monthly: those pin ONE
 * snapshot at creation time and never move it (historical integrity). The
 * Dashboard shows the CURRENT project position, so it always reads the
 * LATEST published snapshot — there is nothing to pin, and a newer publish
 * must change what the Dashboard shows on the next load. It never reads a
 * Weekly or Monthly report's pinned `planning_snapshot_id`; those pins can
 * be arbitrarily old and are answering "what did this report compile
 * against", not "where does the project stand today".
 *
 * The "is this rollup usable" gate is the identical one-line rule Weekly and
 * Monthly each carry in their own module — kept as its own declaration here
 * too, for the same reason they are separate from each other: each surface
 * decides its own Planning-backed question independently.
 */

/**
 * The subset of `PlanningSnapshotRollup` (services/planning-rollup-service)
 * this module actually reads. Declared locally, not imported, so this file
 * stays a zero-dependency pure module.
 */
export interface PlanningRollupLike {
  plannedProgress: number | null;
  actualProgress: number | null;
  variance: number | null;
  spi: number | null;
  /** Sum of reported planned_value / earned_value — the EV/PV a KPI detail
      surface needs to explain SPI, or to explain why it is N/A. */
  plannedValue: number | null;
  earnedValue: number | null;
  snapshotId: string;
  snapshotVersion: number;
  dataDate?: string;
  coveragePercent: number;
}

export interface DashboardPlanningFigures {
  planningBacked: boolean;
  /** Weighted rollup figures, or `null` when unusable/absent — never 0 as a stand-in. */
  plannedProgress: number | null;
  actualProgress: number | null;
  variance: number | null;
  /** EV/PV. Never the Actual%/Planned% ratio — see `planning-rollup.ts`. */
  spi: number | null;
  plannedValue: number | null;
  earnedValue: number | null;
  /** Carried through so a caller can drill into this EXACT snapshot's
      activities (Dashboard Data Depth) without re-resolving "latest" a
      second time — never used to imply a different snapshot than the one
      that produced the figures above. */
  snapshotId?: string;
  snapshotVersion?: number;
  dataDate?: string;
  coveragePercent?: number;
}

const UNBACKED: DashboardPlanningFigures = {
  planningBacked: false,
  plannedProgress: null,
  actualProgress: null,
  variance: null,
  spi: null,
  plannedValue: null,
  earnedValue: null,
};

/**
 * A project's LATEST published snapshot is usable for the Dashboard's
 * current-position figures only when its rollup has BOTH a planned and an
 * actual figure — identical gate to Weekly (3B) and Monthly (3C), applied
 * here to "latest" instead of "resolved for a period". An unusable latest
 * snapshot does NOT fall back to an older, usable one: the current position
 * is either governed by the actual latest snapshot, or it is the existing
 * Weekly/Monthly fallback — never a stale snapshot presented as current.
 */
export function deriveDashboardPlanningFigures(
  rollup: PlanningRollupLike | null | undefined
): DashboardPlanningFigures {
  if (!rollup) return UNBACKED;

  const usable = rollup.plannedProgress !== null && rollup.actualProgress !== null;
  return {
    planningBacked: usable,
    plannedProgress: rollup.plannedProgress,
    actualProgress: rollup.actualProgress,
    variance: rollup.variance,
    spi: rollup.spi,
    plannedValue: rollup.plannedValue,
    earnedValue: rollup.earnedValue,
    snapshotId: rollup.snapshotId,
    snapshotVersion: rollup.snapshotVersion,
    dataDate: rollup.dataDate,
    coveragePercent: rollup.coveragePercent,
  };
}

/**
 * One point on the "Planned vs Actual Progress Curve" — published Planning
 * Snapshot history, plotted by Data Date. Deliberately NOT called a
 * baseline S-curve: a baseline S-curve is a time-phased plan computed once
 * at baseline and held fixed, which this platform does not yet compute.
 * This is a sequence of as-of positions, each governed and immutable, but
 * the PLANNED figure itself can differ between snapshots (a re-plan), which
 * a true baseline never does.
 */
export interface ProgressCurvePoint {
  dataDate: string;
  snapshotId: string;
  snapshotVersion: number;
  /** `null` is a GAP — never plotted as 0, never interpolated. */
  planned: number | null;
  actual: number | null;
}

/**
 * Published-snapshot history for the curve: chronological by Data Date,
 * published snapshots only (the caller sources these from
 * `listPublishedSnapshotRollups`, which already reads only
 * `planning_snapshots` — draft/live Planning data structurally cannot reach
 * this function). When two or more snapshot versions share a Data Date
 * (a same-day republish), only the LATEST version for that date is plotted
 * — never both, and never an average of them.
 */
export function planningProgressCurve(
  rollups: readonly PlanningRollupLike[]
): ProgressCurvePoint[] {
  const latestByDate = new Map<string, PlanningRollupLike>();
  for (const rollup of rollups) {
    if (!rollup.dataDate) continue;
    const existing = latestByDate.get(rollup.dataDate);
    if (!existing || rollup.snapshotVersion > existing.snapshotVersion) {
      latestByDate.set(rollup.dataDate, rollup);
    }
  }

  return [...latestByDate.values()]
    .sort((a, b) => (a.dataDate as string).localeCompare(b.dataDate as string))
    .map((rollup) => ({
      dataDate: rollup.dataDate as string,
      snapshotId: rollup.snapshotId,
      snapshotVersion: rollup.snapshotVersion,
      planned: rollup.plannedProgress,
      actual: rollup.actualProgress,
    }));
}

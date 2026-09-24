/**
 * Portfolio Progress trend (Dashboard UX — Progress Analysis modal).
 *
 * Answers a DIFFERENT question from `planningProgressCurve` (one project's
 * own published-snapshot history): "across every active project, how has
 * the portfolio moved over time". There is no governed project-weight
 * model, so this is an UNWEIGHTED mean — never presented as a formal
 * S-Curve, which implies a time-phased baseline this platform does not
 * compute.
 *
 * Pure, no storage, no Supabase — same standalone-testable convention as
 * `planning-integration.ts`.
 */

/** The subset of a per-project curve point this module reads — shared
    structurally by `ProgressCurvePoint` and `ProjectProgressCurvePoint`
    (both: one point per real published Planning Snapshot Data Date), so
    one aggregator folds either without a cast. */
export interface AsOfCurvePoint {
  dataDate: string;
  planned: number | null;
  actual: number | null;
}

export interface PortfolioProgressPoint {
  dataDate: string;
  /** Unweighted mean of each project's latest position as of this date.
      `null` when not one project in scope has a reported figure yet — never 0. */
  planned: number | null;
  actual: number | null;
  /** Projects with a valid published position as of this date. */
  sampleCount: number;
  /** Active/non-archived projects considered — the coverage denominator. */
  totalProjects: number;
  /**
   * True only when at least one project published a REAL Actual reading
   * exactly on this date — never merely carried forward from an earlier
   * one. A date where every contributing project's Actual is only carried
   * forward from an earlier real snapshot (because that project publishes
   * on a slower cadence than whichever project's real date this is) is
   * never a "missing" reading either — but it is not the date the
   * portfolio's own current position is AS OF. Callers that want "the
   * portfolio's current KPI position" should pick the LATEST point with
   * this flag true, not simply the last point in the trend, so a stale
   * carried-forward Actual is never compared against a later date's
   * Planned.
   */
  hasFreshActual: boolean;
}

/**
 * Folds each project's own curve (already chronological, real published
 * Planning Snapshot Data Dates only — see `planningProgressCurve` /
 * `buildProjectProgressCurve`; never a date interpolated from an activity
 * schedule) into one portfolio trend.
 *
 * At every real date ANY project has a point on, each project contributes
 * its LATEST known Planned figure and its LATEST known Actual figure as of
 * that date, tracked independently — never a future one, never
 * interpolated toward it. Independent carry-forward matters because
 * projects publish on their own cadence: at a date only SOME projects
 * published on, the others still contribute whatever their own last real
 * snapshot reported, rather than dropping out and dragging the mean toward
 * a project with genuinely nothing published yet at all (which takes no
 * part in the average — missing is never zero).
 */
export function computePortfolioProgressTrend(
  curvesByProject: ReadonlyMap<string, readonly AsOfCurvePoint[]>,
  totalProjects: number
): PortfolioProgressPoint[] {
  const allDates = new Set<string>();
  for (const curve of curvesByProject.values()) {
    for (const point of curve) allDates.add(point.dataDate);
  }
  const sortedDates = [...allDates].sort((a, b) => a.localeCompare(b));

  return sortedDates.map((date) => {
    let plannedSum = 0;
    let plannedCount = 0;
    let actualSum = 0;
    let actualCount = 0;
    let sampleCount = 0;
    let freshActualCount = 0;

    for (const curve of curvesByProject.values()) {
      let plannedAsOf: number | null = null;
      let actualAsOf: number | null = null;
      let actualAsOfDate: string | null = null;
      let hasPositionAsOf = false;

      for (const point of curve) {
        if (point.dataDate > date) break;
        hasPositionAsOf = true;
        if (point.planned !== null) plannedAsOf = point.planned;
        if (point.actual !== null) {
          actualAsOf = point.actual;
          actualAsOfDate = point.dataDate;
        }
      }
      if (!hasPositionAsOf) continue;

      sampleCount += 1;
      if (plannedAsOf !== null) {
        plannedSum += plannedAsOf;
        plannedCount += 1;
      }
      if (actualAsOf !== null) {
        actualSum += actualAsOf;
        actualCount += 1;
        if (actualAsOfDate === date) freshActualCount += 1;
      }
    }

    return {
      dataDate: date,
      planned: plannedCount > 0 ? plannedSum / plannedCount : null,
      actual: actualCount > 0 ? actualSum / actualCount : null,
      sampleCount,
      totalProjects,
      hasFreshActual: freshActualCount > 0,
    };
  });
}

/**
 * The portfolio's CURRENT KPI position — Planned/Actual/Variance/Coverage
 * as of the LATEST date any active project actually published a real
 * Actual reading on, never a later portfolio-trend date where every
 * project's Actual is merely carried forward from an earlier snapshot.
 * This is the SAME point the chart plots at that date — one computation,
 * read by both the KPI strip and the curve, so the two can never disagree.
 *
 * `undefined` when no project in scope has published a single Actual
 * reading yet.
 */
export function latestGovernedPortfolioPosition(
  trend: readonly PortfolioProgressPoint[]
): PortfolioProgressPoint | undefined {
  for (let index = trend.length - 1; index >= 0; index -= 1) {
    if (trend[index].hasFreshActual) return trend[index];
  }
  return undefined;
}

import { dayNumber, fromDayNumber, weeklyGrid, WorkingCalendar } from "./calendar";
import { calculatePlanPerformance, effectiveWeights } from "./engine";
import { earnedPercentAt, plannedPercentAt } from "./earning";
import type {
  DateWindow,
  EngineActivityInput,
  EngineElementInput,
  EnginePlanInput,
  IsoDate,
  PlanningFigure,
  ValidationIssue,
  Weekday,
} from "./types";
import { blockingIssues, validatePlan } from "./validation";

/**
 * S-curves (`02` §26.7):
 *
 *   Baseline curve  baseline dates × effective weights, PV distributed by
 *                   method over a weekly grid to completion (BLn, or BL0).
 *   Forecast curve  actual progress to the Data Date, then the forecast dates
 *                   for the remaining work.
 *   Earned curve    one EV point per published snapshot, at its Data Date.
 *
 * Points exist only where data exists: earned points sit at real Data Dates,
 * gaps are never interpolated and never plotted as 0 (rule 1). The engine
 * calculates curves; 13.12 freezes them into snapshots and baselines.
 */

export interface CurvePoint {
  date: IsoDate;
  /** Percent of the project. */
  value: number;
}

export type CurveResult =
  | { status: "calculated"; points: CurvePoint[] }
  | { status: "blocked"; issues: ValidationIssue[] }
  /** The dates the curve needs are missing for these activities. */
  | { status: "not_available"; reason: "baseline_missing" | "forecast_missing"; activityIds: string[] };

/** Findings that make any weighted curve meaningless. */
const STRUCTURAL: ReadonlySet<ValidationIssue["code"]> = new Set([
  "W1_CHILD_TOTAL",
  "W2_MISSING_WEIGHT",
  "WEIGHT_INVALID",
  "EMPTY_NODE",
  "DUPLICATE_ID",
  "PLAN_INVALID",
]);

function activitiesOf(children: readonly EngineElementInput[]): EngineActivityInput[] {
  const result: EngineActivityInput[] = [];
  const walk = (list: readonly EngineElementInput[]) => {
    for (const child of list) {
      if (child.kind === "node") walk(child.children);
      else result.push(child);
    }
  };
  walk(children);
  return result;
}

function windowDays(window: DateWindow | null | undefined, method: EngineActivityInput["earningMethod"]) {
  const start = dayNumber(window?.start ?? null);
  const finish = dayNumber(window?.finish ?? null);
  if (method === "milestone") {
    const date = finish ?? start;
    return date === null ? null : { start: date, finish: date };
  }
  return start === null || finish === null || finish < start ? null : { start, finish };
}

export function baselineCurve(
  plan: EnginePlanInput,
  options: { baseline: "current" | "original"; reportingDay: Weekday }
): CurveResult {
  const structural = blockingIssues(validatePlan(plan)).filter((finding) => STRUCTURAL.has(finding.code));
  if (structural.length > 0) return { status: "blocked", issues: structural };

  const calendar = new WorkingCalendar(plan.workingWeek);
  const weights = effectiveWeights(plan);
  const activities = activitiesOf(plan.children);
  const windowOf = (activity: EngineActivityInput) =>
    options.baseline === "current" ? activity.baseline : (activity.originalBaseline ?? {});

  const missing = activities.filter((activity) => windowDays(windowOf(activity), activity.earningMethod) === null);
  if (missing.length > 0) {
    return { status: "not_available", reason: "baseline_missing", activityIds: missing.map((activity) => activity.id) };
  }
  if (activities.length === 0) return { status: "calculated", points: [] };

  const spans = activities.map((activity) => windowDays(windowOf(activity), activity.earningMethod)!);
  const from = Math.min(...spans.map((span) => span.start));
  const to = Math.max(...spans.map((span) => span.finish));

  // Start on the last reporting day BEFORE the earliest start, so the curve
  // opens at 0 instead of part-way up.
  const points = weeklyGrid(fromDayNumber(from - 7), fromDayNumber(to), options.reportingDay).map((date) => {
    const day = dayNumber(date) as number;
    let value = 0;
    for (const activity of activities) {
      const planned = plannedPercentAt(activity.earningMethod, windowOf(activity), day, calendar) as number;
      value += ((weights.get(activity.id) ?? 0) * planned) / 100;
    }
    return { date, value };
  });
  return { status: "calculated", points };
}

/** A milestone's forecast is one date (start = finish, H4); other work needs a forecast finish. */
function forecastFinishDay(activity: EngineActivityInput): number | null {
  const finish = dayNumber(activity.forecast?.finish ?? null);
  if (activity.earningMethod !== "milestone") return finish;
  return finish ?? dayNumber(activity.forecast?.start ?? null);
}

/** Forecast % complete of one activity at `at`, from its earned position `earned` at the Data Date. */
function forecastPercentAt(
  activity: EngineActivityInput,
  earned: number,
  dataDay: number,
  at: number,
  calendar: WorkingCalendar
): number | null {
  if (earned >= 100) return 100;
  const forecastStart = dayNumber(activity.forecast?.start ?? null);
  const forecastFinish = forecastFinishDay(activity);
  if (forecastFinish === null) return null;
  if (at >= forecastFinish) return 100;

  switch (activity.earningMethod) {
    case "milestone":
    case "zero_hundred":
      return earned;
    case "fifty_fifty":
      if (forecastStart === null && earned === 0) return null;
      return forecastStart !== null && at >= forecastStart ? Math.max(earned, 50) : earned;
    case "percent_complete": {
      const from = Math.max(dataDay, forecastStart ?? dataDay);
      if (at <= from) return earned;
      const total = calendar.workingDaysInclusive(from + 1, forecastFinish);
      if (total === 0) return earned;
      return earned + ((100 - earned) * calendar.workingDaysInclusive(from + 1, at)) / total;
    }
  }
}

/**
 * The current / forecast curve: the earned position at the Data Date, then the
 * remaining work along its forecast dates. Needs a fully calculable plan (the
 * first point IS the project's EV) and a forecast finish for every incomplete
 * activity — never borrowed from the baseline.
 */
export function forecastCurve(plan: EnginePlanInput, options: { reportingDay: Weekday }): CurveResult {
  const calculation = calculatePlanPerformance(plan);
  if (calculation.status === "blocked") return { status: "blocked", issues: calculation.issues };

  const calendar = new WorkingCalendar(plan.workingWeek);
  const weights = effectiveWeights(plan);
  const dataDay = dayNumber(plan.dataDate) as number;
  const activities = activitiesOf(plan.children).map((activity) => ({
    activity,
    earned: earnedPercentAt(activity, dataDay) as number,
  }));

  const missing = activities.filter(
    ({ activity, earned }) => forecastPercentAt(activity, earned, dataDay, dataDay + 1, calendar) === null
  );
  if (missing.length > 0) {
    return { status: "not_available", reason: "forecast_missing", activityIds: missing.map(({ activity }) => activity.id) };
  }

  let end = dataDay;
  for (const { activity, earned } of activities) {
    if (earned >= 100) continue;
    const finish = forecastFinishDay(activity);
    if (finish !== null) end = Math.max(end, finish);
  }

  const grid = weeklyGrid(plan.dataDate, fromDayNumber(end), options.reportingDay).filter((date) => date !== plan.dataDate);
  const points: CurvePoint[] = [{ date: plan.dataDate, value: calculation.performance.project.ev }];
  for (const date of grid) {
    const day = dayNumber(date) as number;
    let value = 0;
    for (const { activity, earned } of activities) {
      value += ((weights.get(activity.id) ?? 0) * (forecastPercentAt(activity, earned, dataDay, day, calendar) as number)) / 100;
    }
    points.push({ date, value });
  }
  return { status: "calculated", points };
}

export interface EarnedPointInput {
  dataDate: IsoDate | null | undefined;
  snapshotVersion: number;
  ev: PlanningFigure;
}

export interface EarnedPoint extends CurvePoint {
  snapshotVersion: number;
}

/**
 * The earned (actual) curve: one point per published snapshot at its real
 * Data Date. Several snapshots sharing a Data Date resolve to the highest
 * version (`02` §26.8 invariant 3). A snapshot with no Data Date or no EV
 * contributes no point — never a 0.
 */
export function earnedCurve(points: readonly EarnedPointInput[]): EarnedPoint[] {
  const byDate = new Map<IsoDate, EarnedPoint>();
  for (const point of points) {
    if (point.ev.state !== "value" || dayNumber(point.dataDate ?? null) === null) continue;
    const date = point.dataDate as IsoDate;
    const existing = byDate.get(date);
    if (!existing || point.snapshotVersion > existing.snapshotVersion) {
      byDate.set(date, { date, value: point.ev.value, snapshotVersion: point.snapshotVersion });
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

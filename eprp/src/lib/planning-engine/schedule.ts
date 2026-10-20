import { calendarDaysBetween, dayNumber, fromDayNumber } from "./calendar";
import {
  figure,
  type DateWindow,
  type EngineActivityInput,
  type EngineElementInput,
  type EnginePlanInput,
  type IsoDate,
  type PlanningFigure,
} from "./types";

/**
 * Milestone schedule state and schedule condition (`02` §26.5 "the milestone
 * is reported separately", §26.6 rule 1, §26.7 rule 4).
 *
 * A true milestone carries no weight by default (W5), so it never moves SPI.
 * Its slip is shown against BLn AND against BL0 — two numbers, never blended.
 * This is the snapshot-side derivation for milestone ACTIVITIES; the governed
 * Master Milestone register keeps its own state derivation
 * (`features/projects/milestone-state.ts`) for unlinked milestones until the
 * 13.15 link exists (`02` §26.6 rule 5, B1).
 */

export type MilestoneScheduleStatus =
  /** Actual date recorded on or before the Data Date. */
  | "achieved"
  /** Not achieved and its BLn date is already behind the Data Date. */
  | "overdue"
  /** Not achieved and not yet due against BLn. */
  | "upcoming"
  /** No BLn and no forecast date — nothing can be said about it. */
  | "unscheduled";

export interface MilestoneScheduleInput {
  originalBaselineDate?: IsoDate | null;
  baselineDate?: IsoDate | null;
  forecastDate?: IsoDate | null;
  actualDate?: IsoDate | null;
  dataDate: IsoDate;
}

export interface MilestoneSchedule {
  status: MilestoneScheduleStatus;
  /** The date the slip is measured from: the actual if achieved, else the forecast. */
  referenceDate: IsoDate | null;
  /** Calendar days later than BLn (negative = early). */
  slipVsCurrentBaseline: PlanningFigure;
  /** Calendar days later than BL0 (negative = early). */
  slipVsOriginalBaseline: PlanningFigure;
  /** BLn date is on or before the Data Date — it was due by now. */
  due: boolean;
}

function validDate(date: IsoDate | null | undefined): IsoDate | null {
  return dayNumber(date ?? null) === null ? null : (date as IsoDate);
}

function slip(baseline: IsoDate | null, reference: IsoDate | null): PlanningFigure {
  if (baseline === null) return figure.notAvailable("baseline_missing");
  if (reference === null) return figure.notAvailable("forecast_missing");
  return figure.value(calendarDaysBetween(baseline, reference) as number);
}

export function deriveMilestoneSchedule(input: MilestoneScheduleInput): MilestoneSchedule {
  const dataDay = dayNumber(input.dataDate);
  const actual = validDate(input.actualDate);
  const forecast = validDate(input.forecastDate);
  const baseline = validDate(input.baselineDate);
  const original = validDate(input.originalBaselineDate);

  const achieved = actual !== null && dataDay !== null && (dayNumber(actual) as number) <= dataDay;
  const reference = achieved ? actual : forecast;
  const due = baseline !== null && dataDay !== null && (dayNumber(baseline) as number) <= dataDay;

  let status: MilestoneScheduleStatus;
  if (achieved) status = "achieved";
  else if (baseline === null && forecast === null) status = "unscheduled";
  else if (baseline !== null && dataDay !== null && (dayNumber(baseline) as number) < dataDay) status = "overdue";
  else status = "upcoming";

  return {
    status,
    referenceDate: reference,
    slipVsCurrentBaseline: slip(baseline, reference),
    slipVsOriginalBaseline: slip(original, reference),
    due,
  };
}

function windowDate(window: DateWindow | null | undefined): IsoDate | null {
  return validDate(window?.finish ?? null) ?? validDate(window?.start ?? null);
}

export interface PlanMilestone {
  id: string;
  code: string | null;
  name: string;
  isKey: boolean;
  schedule: MilestoneSchedule;
}

/** Every true milestone activity in the plan, in tree order. */
export function planMilestones(plan: EnginePlanInput): PlanMilestone[] {
  const result: PlanMilestone[] = [];
  const walk = (children: readonly EngineElementInput[]) => {
    for (const child of children) {
      if (child.kind === "node") walk(child.children);
      else if (child.earningMethod === "milestone") {
        result.push({
          id: child.id,
          code: child.code ?? null,
          name: child.name,
          isKey: child.isKeyMilestone === true,
          schedule: deriveMilestoneSchedule({
            originalBaselineDate: windowDate(child.originalBaseline),
            baselineDate: windowDate(child.baseline),
            forecastDate: windowDate(child.forecast),
            actualDate: windowDate(child.actual),
            dataDate: plan.dataDate,
          }),
        });
      }
    }
  };
  walk(plan.children);
  return result;
}

/**
 * The BLn finish and forecast finish of a set of elements (the whole project,
 * or one Control Account's children). The forecast finish is `null` — not a
 * guess — when any incomplete activity has no forecast finish.
 */
export function finishDates(
  children: readonly EngineElementInput[],
  dataDate: IsoDate
): { baselineFinish: IsoDate | null; forecastFinish: IsoDate | null } {
  const dataDay = dayNumber(dataDate);
  let baselineFinish: number | null = null;
  let forecastFinish: number | null = null;
  let forecastKnown = true;

  const activities: EngineActivityInput[] = [];
  const walk = (list: readonly EngineElementInput[]) => {
    for (const child of list) {
      if (child.kind === "node") walk(child.children);
      else activities.push(child);
    }
  };
  walk(children);

  for (const activity of activities) {
    const bln = dayNumber(windowDate(activity.baseline));
    if (bln !== null) baselineFinish = baselineFinish === null ? bln : Math.max(baselineFinish, bln);

    const actualFinish = dayNumber(validDate(activity.actual?.finish ?? null));
    const done = actualFinish !== null && dataDay !== null && actualFinish <= dataDay;
    const finish = done ? actualFinish : dayNumber(windowDate(activity.forecast));
    if (finish === null) forecastKnown = false;
    else forecastFinish = forecastFinish === null ? finish : Math.max(forecastFinish, finish);
  }

  return {
    baselineFinish: baselineFinish === null ? null : fromDayNumber(baselineFinish),
    forecastFinish: forecastKnown && forecastFinish !== null ? fromDayNumber(forecastFinish) : null,
  };
}

/* ---------------------------- Schedule condition ------------------------- */

export type ScheduleCondition = "on_track" | "at_risk" | "behind" | "unknown";

export const SCHEDULE_CONDITION_LABEL: Record<ScheduleCondition, string> = {
  on_track: "On Track",
  at_risk: "At Risk",
  behind: "Behind",
  unknown: "Unknown",
};

export interface ScheduleConditionThresholds {
  /** SPI at or above this, with nothing else wrong, is On Track. */
  onTrackMinSpi: number;
  /** SPI below this is Behind; between the two is At Risk. */
  atRiskMinSpi: number;
  /** A key milestone forecast up to this many days late is At Risk; more is Behind. */
  keyMilestoneAtRiskDays: number;
}

/**
 * The PROPOSED defaults of `02` §26.7 rule 4. Decision **B4 is still open**:
 * these are not approved thresholds. The engine never reads them implicitly —
 * every caller passes thresholds in, and 13.14 (blocked by B4) supplies the
 * approved ones.
 */
export const PROPOSED_SCHEDULE_CONDITION_THRESHOLDS: Readonly<ScheduleConditionThresholds> = Object.freeze({
  onTrackMinSpi: 0.95,
  atRiskMinSpi: 0.9,
  keyMilestoneAtRiskDays: 14,
});

export interface ScheduleConditionInput {
  hasPublishedSnapshot: boolean;
  pv: number | null;
  spi: PlanningFigure;
  keyMilestones: readonly MilestoneSchedule[];
  baselineFinish: IsoDate | null;
  forecastFinish: IsoDate | null;
}

export interface ScheduleConditionResult {
  condition: ScheduleCondition;
  /** Plain-language reasons, worst first. */
  reasons: string[];
  /** Which of the three readings could be evaluated from the data. */
  evaluated: { spi: boolean; keyMilestones: boolean; forecastFinish: boolean };
}

/**
 * One function defines schedule condition for every surface (`02` §26.7
 * rule 4). It combines SPI, key-milestone slip against BLn and the forecast
 * finish against BLn finish. A reading the data cannot support is reported as
 * not evaluated — it never counts as passing or failing.
 */
export function scheduleCondition(
  input: ScheduleConditionInput,
  thresholds: ScheduleConditionThresholds
): ScheduleConditionResult {
  const slips = input.keyMilestones
    .map((milestone) => milestone.slipVsCurrentBaseline)
    .filter((value): value is { state: "value"; value: number } => value.state === "value")
    .map((value) => value.value);
  const finishSlip =
    input.baselineFinish !== null && input.forecastFinish !== null
      ? calendarDaysBetween(input.baselineFinish, input.forecastFinish)
      : null;
  const evaluated = {
    spi: input.spi.state === "value",
    keyMilestones: slips.length > 0,
    forecastFinish: finishSlip !== null,
  };

  const keyMilestoneDue = input.keyMilestones.some((milestone) => milestone.due);
  if (!input.hasPublishedSnapshot) {
    return { condition: "unknown", reasons: ["No published snapshot."], evaluated };
  }
  if ((input.pv === null || input.pv === 0) && !keyMilestoneDue) {
    return { condition: "unknown", reasons: ["No planned value yet and no key milestone due."], evaluated };
  }

  const behind: string[] = [];
  const atRisk: string[] = [];
  if (input.spi.state === "value") {
    const spi = input.spi.value;
    if (spi < thresholds.atRiskMinSpi) behind.push(`SPI ${spi.toFixed(2)} is below ${thresholds.atRiskMinSpi.toFixed(2)}.`);
    else if (spi < thresholds.onTrackMinSpi) atRisk.push(`SPI ${spi.toFixed(2)} is below ${thresholds.onTrackMinSpi.toFixed(2)}.`);
  }
  const worstSlip = slips.length > 0 ? Math.max(...slips) : null;
  if (worstSlip !== null && worstSlip > thresholds.keyMilestoneAtRiskDays) {
    behind.push(`A key milestone is forecast ${worstSlip} days later than BLn.`);
  } else if (worstSlip !== null && worstSlip > 0) {
    atRisk.push(`A key milestone is forecast ${worstSlip} days later than BLn.`);
  }
  if (finishSlip !== null && finishSlip > 0) {
    behind.push(`The forecast finish is ${finishSlip} days later than the BLn finish.`);
  }

  if (behind.length > 0) return { condition: "behind", reasons: [...behind, ...atRisk], evaluated };
  if (atRisk.length > 0) return { condition: "at_risk", reasons: atRisk, evaluated };
  return { condition: "on_track", reasons: [], evaluated };
}

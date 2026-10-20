import { dayNumber, type WorkingCalendar } from "./calendar";
import type { DateWindow, EarningMethod, EngineActivityInput } from "./types";

/**
 * PV distribution and EV by earning method (`02` §26.4). Owner decision B7
 * (closed 2026-10-20): the PV of a discrete method follows its earning
 * points, so a correctly progressing 0/100 or 50/50 activity never shows a
 * false variance; only Percent Complete is linear over working days.
 *
 * | Method           | EV at the Data Date                  | PV distribution against BLn                  |
 * |------------------|--------------------------------------|----------------------------------------------|
 * | Percent Complete | the confirmed physical % complete    | linear over working days, BLn start → finish |
 * | 0/100            | 0 until actual finish, then 100      | 0 until BLn finish, then 100                 |
 * | 50/50            | 50 at actual start, 100 at finish    | 50 at BLn start, 100 at BLn finish           |
 * | Milestone        | 0 until the actual date, then 100    | 0 until the BLn date, then 100               |
 *
 * C1: an activity with no actual start earns 0 under every method — a fact,
 * not missing data.
 */

/** The PV date of a milestone: its finish, else its start (start = finish, H4). */
function milestoneDate(window: DateWindow): number | null {
  return dayNumber(window.finish ?? null) ?? dayNumber(window.start ?? null);
}

/**
 * Planned % complete at day `at` for one activity under its earning method,
 * against `window` (BLn for PV; BL0 for the original baseline curve).
 * `null` only when the window cannot be read — validation blocks that case
 * before a performance figure is ever produced.
 */
export function plannedPercentAt(
  method: EarningMethod,
  window: DateWindow,
  at: number,
  calendar: WorkingCalendar
): number | null {
  if (method === "milestone") {
    const date = milestoneDate(window);
    if (date === null) return null;
    return at >= date ? 100 : 0;
  }

  const start = dayNumber(window.start ?? null);
  const finish = dayNumber(window.finish ?? null);
  if (start === null || finish === null || finish < start) return null;

  switch (method) {
    case "zero_hundred":
      return at >= finish ? 100 : 0;
    case "fifty_fifty":
      return at >= finish ? 100 : at >= start ? 50 : 0;
    case "percent_complete": {
      if (at >= finish) return 100;
      if (at < start) return 0;
      const total = calendar.workingDaysInclusive(start, finish);
      // A window with no working day at all earns as a step at its finish.
      if (total === 0) return 0;
      return (100 * calendar.workingDaysInclusive(start, at)) / total;
    }
  }
}

/** Whether an actual date is recorded on or before `at`. */
function reachedBy(date: string | null | undefined, at: number): boolean {
  const day = dayNumber(date ?? null);
  return day !== null && day <= at;
}

/**
 * Earned % complete at day `at` (the Data Date). `null` only for a started
 * Percent Complete activity with no confirmed % — C2, which blocks publishing
 * rather than being read as 0.
 */
export function earnedPercentAt(activity: EngineActivityInput, at: number): number | null {
  const actual = activity.actual ?? {};
  const finished = reachedBy(actual.finish, at);
  const started = finished || reachedBy(actual.start, at);

  switch (activity.earningMethod) {
    case "milestone":
      // A milestone's actual date is its finish (or its start, start = finish).
      return finished || started ? 100 : 0;
    case "zero_hundred":
      return finished ? 100 : 0;
    case "fifty_fifty":
      return finished ? 100 : started ? 50 : 0;
    case "percent_complete": {
      if (!started) return 0; // C1
      const confirmed = activity.percentComplete;
      if (typeof confirmed !== "number" || !Number.isFinite(confirmed)) return null; // C2
      return confirmed;
    }
  }
}

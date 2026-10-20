import type { IsoDate, Weekday } from "./types";

/**
 * Working-day calendar for the Planning Engine (`02` §26.4: "Working days
 * come from the project's configured working week; a project holiday calendar
 * is a later extension").
 *
 * Dates are calendar days in UTC arithmetic — a Data Date is a date, not an
 * instant, so no time zone can move it across midnight.
 */

const MS_PER_DAY = 86_400_000;

/** Index 0 = Sunday, matching `Date.prototype.getUTCDay()`. */
const WEEKDAYS: readonly Weekday[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since 1970-01-01 for a valid `yyyy-mm-dd`, else `null`. */
export function dayNumber(date: IsoDate | null | undefined): number | null {
  if (typeof date !== "string") return null;
  const match = ISO_DATE.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  // Reject 2026-02-31 and friends instead of letting Date roll them over.
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) {
    return null;
  }
  return Math.round(ms / MS_PER_DAY);
}

export function isIsoDate(date: unknown): date is IsoDate {
  return typeof date === "string" && dayNumber(date) !== null;
}

export function fromDayNumber(day: number): IsoDate {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to`; positive when `to` is later. */
export function calendarDaysBetween(from: IsoDate, to: IsoDate): number | null {
  const a = dayNumber(from);
  const b = dayNumber(to);
  return a === null || b === null ? null : b - a;
}

export function weekdayOf(day: number): Weekday {
  // 1970-01-01 was a Thursday (index 4).
  return WEEKDAYS[(((day + 4) % 7) + 7) % 7];
}

const ABBREVIATIONS: Record<string, Weekday> = {
  sun: "sunday",
  mon: "monday",
  tue: "tuesday",
  wed: "wednesday",
  thu: "thursday",
  fri: "friday",
  sat: "saturday",
};

/**
 * The project's stored Working Week label (`Project.reporting.workingWeek`,
 * e.g. "Sun – Thu") as weekdays, wrapping across the week end. `null` when the
 * label is not a recognisable "Day – Day" range — the engine never guesses a
 * working week.
 */
export function parseWorkingWeek(label: string | null | undefined): Weekday[] | null {
  if (typeof label !== "string") return null;
  const parts = label.split(/\s*[–—-]\s*/);
  if (parts.length !== 2) return null;
  const from = ABBREVIATIONS[parts[0].trim().slice(0, 3).toLowerCase()];
  const to = ABBREVIATIONS[parts[1].trim().slice(0, 3).toLowerCase()];
  if (!from || !to) return null;
  const start = WEEKDAYS.indexOf(from);
  const end = WEEKDAYS.indexOf(to);
  const days: Weekday[] = [];
  for (let i = start; ; i = (i + 1) % 7) {
    days.push(WEEKDAYS[i]);
    if (i === end) break;
  }
  return days;
}

/**
 * Working-day counting in O(1) per call: cumulative counts over whole weeks
 * plus a remainder, so curves over long schedules stay cheap.
 */
export class WorkingCalendar {
  private readonly working: readonly boolean[];
  private readonly perWeek: number;

  constructor(workingWeek: readonly Weekday[]) {
    // Indexed by offset from the epoch weekday (Thursday), not by weekday.
    this.working = Array.from({ length: 7 }, (_, offset) => workingWeek.includes(weekdayOf(offset)));
    this.perWeek = this.working.filter(Boolean).length;
  }

  get hasWorkingDays(): boolean {
    return this.perWeek > 0;
  }

  isWorkingDay(day: number): boolean {
    return this.working[((day % 7) + 7) % 7];
  }

  /** Working days in the half-open day range [0, day). Valid for negative days too. */
  private before(day: number): number {
    const weeks = Math.floor(day / 7);
    const remainder = day - weeks * 7;
    let count = weeks * this.perWeek;
    for (let i = 0; i < remainder; i++) if (this.working[i]) count++;
    return count;
  }

  /** Working days in [from, to], both inclusive. 0 when `to` is before `from`. */
  workingDaysInclusive(from: number, to: number): number {
    if (to < from) return 0;
    return this.before(to + 1) - this.before(from);
  }
}

/**
 * The weekly grid a curve is drawn on (`02` §26.7: "the weekly grid follows
 * the project's reporting day"): every `reportingDay` from the first one on
 * or after `from` to the first one on or after `to`, so the grid always
 * reaches completion.
 */
export function weeklyGrid(from: IsoDate, to: IsoDate, reportingDay: Weekday): IsoDate[] {
  const start = dayNumber(from);
  const end = dayNumber(to);
  if (start === null || end === null || end < start) return [];
  let day = start;
  while (weekdayOf(day) !== reportingDay) day++;
  const grid: IsoDate[] = [];
  for (; ; day += 7) {
    grid.push(fromDayNumber(day));
    if (day >= end) break;
  }
  return grid;
}

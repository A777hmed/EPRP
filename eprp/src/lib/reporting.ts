import {
  addDays,
  format,
  getISOWeek,
  getISOWeekYear,
  parseISO,
  startOfISOWeek,
} from "date-fns";

/**
 * Date and reporting calculations (Phase 4C). Pure functions — keep all
 * calculation logic here, outside UI components.
 *
 * The reporting work week runs **Sunday through Thursday**
 * (`docs/06_WEEKLY_REPORT_SPEC.md` §5). Week *numbering* still follows
 * ISO-8601, which counts Monday-start weeks — see `getReportingWeekRange`.
 */

/** ISO week number (1–53) for a date. */
export function getWeekNumber(date: Date | string): number {
  return getISOWeek(typeof date === "string" ? parseISO(date) : date);
}

/**
 * The Sunday–Thursday reporting week containing `date`.
 *
 * `anchor` is the Monday inside that week and is what week numbering must
 * use. ISO weeks run Monday–Sunday, so the Sunday that *starts* a reporting
 * week belongs to the *previous* ISO week — numbering from `start` would be
 * one week low. Example: the reporting week Sun 19 Jul – Thu 23 Jul 2026 is
 * week 30; `getISOWeek(19 Jul)` returns 29, `getISOWeek(20 Jul)` returns 30.
 *
 * Callers that persist a week number or report number must use `anchor`.
 */
export function getReportingWeekRange(date: Date | string): {
  start: Date;
  end: Date;
  anchor: Date;
} {
  const d = typeof date === "string" ? parseISO(date) : date;
  // Monday of the ISO week that contains the Sunday-start reporting week.
  // For a Sunday, that is the *next* day; for Mon–Sat it is this ISO Monday.
  const anchor = d.getDay() === 0 ? addDays(d, 1) : startOfISOWeek(d);
  const start = addDays(anchor, -1); // Sunday
  const end = addDays(anchor, 3); // Thursday
  return { start, end, anchor };
}

/** Month label used across reports, e.g. "July 2026". */
export function getMonthLabel(date: Date | string): string {
  return format(typeof date === "string" ? parseISO(date) : date, "MMMM yyyy");
}

export type ReportNumberType = "weekly" | "monthly" | "executive";

const reportTypeCodes: Record<ReportNumberType, string> = {
  weekly: "W",
  monthly: "M",
  executive: "E",
};

/**
 * Human-readable report number, e.g. `EPR-PRJ001-W-2026-31`.
 * Sequence is the ISO week for weeklies, month (1–12) for monthlies, and a
 * running sequence for executive reports.
 */
export function formatReportNumber(
  type: ReportNumberType,
  projectCode: string,
  year: number,
  sequence: number
): string {
  const seq = String(sequence).padStart(2, "0");
  return `EPR-${projectCode}-${reportTypeCodes[type]}-${year}-${seq}`;
}

/**
 * Schedule variance in percentage points (actual − planned).
 * Negative = behind schedule.
 */
export function scheduleVariance(planned: number, actual: number): number {
  return round1(actual - planned);
}

/**
 * Schedule Performance Index (earned / planned). Returns 0 when no
 * progress is planned yet rather than dividing by zero.
 */
export function calculateSpi(planned: number, actual: number): number {
  if (planned <= 0) return 0;
  return Math.round((actual / planned) * 100) / 100;
}

/**
 * The three overall-status values the business rule recognises
 * (`docs/06_WEEKLY_REPORT_SPEC.md` §5). Deliberately separate from the
 * stored `ProgressStatus` enum, which has five values and is not changed by
 * this phase — this one is a derived recommendation, never persisted.
 */
export type ScheduleRecommendation = "on_schedule" | "delayed" | "critical";

/**
 * Overall status recommended by the schedule variance, in percentage points.
 *
 *   SV ≥ −3            → On Schedule
 *   −7 ≤ SV < −3       → Delayed
 *   SV < −7            → Critical
 *
 * This is a **recommendation only**. Per spec §5 the final status may be
 * overridden — with a reason — but only by a System Administrator or an
 * authorized Project Control user. That override is deliberately NOT built
 * yet: real login and role enforcement do not exist, so there is no way to
 * tell those users apart from a department user. Until then the
 * recommendation is displayed read-only.
 */
export function recommendScheduleStatus(
  variance: number
): ScheduleRecommendation {
  if (variance >= -3) return "on_schedule";
  if (variance >= -7) return "delayed";
  return "critical";
}

/** Reporting week label, e.g. "Week 30 (19 – 23 Jul 2026)". */
export function formatReportingWeek(date: Date | string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  const { start, end, anchor } = getReportingWeekRange(d);
  // Number from the anchor, not the raw date: a Sunday belongs to the
  // reporting week it starts, not the ISO week it ends.
  const week = getISOWeek(anchor);
  const sameMonth = start.getMonth() === end.getMonth();
  const startLabel = format(start, sameMonth ? "dd" : "dd MMM");
  return `Week ${week} (${startLabel} – ${format(end, "dd MMM yyyy")})`;
}

/** Period label for arbitrary ranges, e.g. "05 May – 11 May 2025". */
export function formatReportingPeriod(
  periodStart: Date | string,
  periodEnd: Date | string
): string {
  const start =
    typeof periodStart === "string" ? parseISO(periodStart) : periodStart;
  const end = typeof periodEnd === "string" ? parseISO(periodEnd) : periodEnd;
  return `${format(start, "dd MMM")} – ${format(end, "dd MMM yyyy")}`;
}

/** ISO week-numbering year (differs from calendar year at year borders). */
export function getReportingYear(date: Date | string): number {
  return getISOWeekYear(typeof date === "string" ? parseISO(date) : date);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

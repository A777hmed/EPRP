import {
  endOfISOWeek,
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
 * Reporting weeks follow ISO-8601: Monday start, Sunday end.
 */

/** ISO week number (1–53) for a date. */
export function getWeekNumber(date: Date | string): number {
  return getISOWeek(typeof date === "string" ? parseISO(date) : date);
}

/** Start (Monday) and end (Sunday) of the reporting week containing `date`. */
export function getReportingWeekRange(date: Date | string): {
  start: Date;
  end: Date;
} {
  const d = typeof date === "string" ? parseISO(date) : date;
  return { start: startOfISOWeek(d), end: endOfISOWeek(d) };
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

/** Reporting week label, e.g. "Week 31 (27 Jul – 02 Aug 2026)". */
export function formatReportingWeek(date: Date | string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  const { start, end } = getReportingWeekRange(d);
  const week = getISOWeek(d);
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

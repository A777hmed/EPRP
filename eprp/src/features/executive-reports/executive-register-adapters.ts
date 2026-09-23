/**
 * Type-safe adapters that convert platform-wide register rows
 * (no RLS filter) to the MonthlyReport / WeeklyReport domain shapes needed
 * by `useExecutivePortfolio`.
 *
 * Kept in a standalone module with only relative imports so that the pure
 * arithmetic is exercise-able from a plain Node test without requiring a
 * bundler to resolve `@/` path aliases.
 *
 * Fields absent from register metadata (hseStatus, qualityStatus,
 * overallProgressStatus, executiveSummary) are `undefined`.  Callers such
 * as `readHealth` treat `undefined` as "genuinely not recorded" and fall
 * back to the variance-derived branch — the honest answer for a
 * register-only read.
 *
 * Exported adapter functions are re-exported from use-executive-portfolio.ts
 * (which owns the hook that calls them) so downstream code has a single
 * import target.
 */

import type {
  GlobalMonthlyRegisterRow,
  GlobalWeeklyRegisterRow,
} from "@/services/global-report-register";
import type { MonthlyReport, WeeklyReport } from "@/types";

/* Arithmetic inlined to keep this module importable with plain node (no
   bundler, no @/ alias resolution) — the test runner uses the two functions
   directly without a framework loader. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function sv(planned: number, actual: number): number {
  return round1(actual - planned);
}
function spi(planned: number, actual: number): number {
  if (planned <= 0) return 0;
  return Math.round((actual / planned) * 100) / 100;
}

export function globalMonthlyRowToReport(
  row: GlobalMonthlyRegisterRow
): MonthlyReport {
  return {
    id: row.id,
    reportNumber: row.reportNumber,
    projectId: row.projectId,
    status: row.status,
    source: "platform",
    periodStart: row.reportingMonth,
    periodEnd: row.reportingMonth,
    reportingMonth: row.reportingMonth,
    plannedProgress: row.plannedProgress,
    actualProgress: row.actualProgress,
    scheduleVariance: sv(row.plannedProgress, row.actualProgress),
    spi: spi(row.plannedProgress, row.actualProgress),
    planningSnapshotId: row.planningSnapshotId,
    preparedByContactId: row.preparedByContactId,
    attachmentIds: [],
    createdAt: row.updatedAt,
    updatedAt: row.updatedAt,
  };
}

export function globalWeeklyRowToReport(
  row: GlobalWeeklyRegisterRow
): WeeklyReport {
  return {
    id: row.id,
    reportNumber: row.reportNumber,
    projectId: row.projectId,
    status: row.status,
    source: "platform",
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    weekNumber: row.weekNumber,
    plannedProgress: row.plannedProgress,
    actualProgress: row.actualProgress,
    planningSnapshotId: row.planningSnapshotId,
    preparedByContactId: row.preparedByContactId,
    disciplineIds: [],
    submissionIds: [],
    entryIds: [],
    activityIds: [],
    attachmentIds: [],
    createdAt: row.updatedAt,
    updatedAt: row.updatedAt,
  };
}

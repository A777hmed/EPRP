import assert from "node:assert/strict";
import test from "node:test";

import {
  globalMonthlyRowToReport,
  globalWeeklyRowToReport,
} from "./executive-register-adapters.ts";

/*
 * Regression coverage for Access & Visibility Reconciliation Round 7,
 * Issue 1: `useExecutivePortfolio` base load now calls
 * `fetchGlobalMonthlyReportRegister()` / `fetchGlobalWeeklyReportRegister()`
 * instead of `monthlyReportService.list()` / `weeklyReportService.list()`.
 *
 * For Nour (published portfolio reader), `monthly_reports_select` RLS only
 * returns `finalized` / `locked` rows for non-assigned projects.  August/
 * September reports that are only `approved` are invisible through the
 * direct-table path, causing `availableMonths` to be empty → "No reporting
 * periods" in the Executive Portfolio detail.
 *
 * The global register RPC (`20260922000002`) bypasses that RLS and returns
 * ALL reports platform-wide.  The adapters here convert those register rows
 * to the `MonthlyReport` / `WeeklyReport` domain shapes.
 *
 * These tests exercise the REAL, imported adapter functions with the narrow
 * register-row shape, proving:
 *
 *   1. The adapters produce valid `MonthlyReport` / `WeeklyReport` shapes.
 *   2. `scheduleVariance` / `calculateSpi` are computed correctly.
 *   3. An `approved`-status register row gets `status: "approved"` after
 *      adaptation — the property that `isApprovedMonthly` checks when
 *      `selectOfficialMonthly` decides which report fills a given month.
 *   4. The `periodStart` string format the post-baseline weekly filter uses
 *      (`weekly.periodStart.slice(0, 7) > month`) works correctly with
 *      adapter output.
 *
 * Issue 2 (admin cross-project bypass) is a React component behavior change
 * and is verified at the browser level.
 */

/* ───────── Shared fixtures ────────── */

const AUGUST_MONTHLY_ROW = {
  id: "monthly-aug",
  reportNumber: "MPR-2026-008",
  projectId: "prj-nour",
  status: "approved",
  reportingMonth: "2026-08-01",
  plannedProgress: 60,
  actualProgress: 58,
  preparedByContactId: "contact-pc",
  planningSnapshotId: "snap-aug",
  updatedAt: "2026-09-01T08:00:00Z",
};

const SEPTEMBER_MONTHLY_ROW = {
  id: "monthly-sep",
  reportNumber: "MPR-2026-009",
  projectId: "prj-nour",
  status: "approved",
  reportingMonth: "2026-09-01",
  plannedProgress: 65,
  actualProgress: 62,
  preparedByContactId: "contact-pc",
  planningSnapshotId: "snap-sep",
  updatedAt: "2026-09-20T10:00:00Z",
};

const WEEKLY_ROW = {
  id: "weekly-37",
  reportNumber: "EPR-W-2026-037",
  projectId: "prj-nour",
  status: "approved",
  weekNumber: 37,
  periodStart: "2026-09-09",
  periodEnd: "2026-09-13",
  plannedProgress: 64,
  actualProgress: 62,
  preparedByContactId: "contact-pc",
  planningSnapshotId: "snap-sep",
  updatedAt: "2026-09-14T09:00:00Z",
};

/* ───────── Monthly adapter ────────── */

test("globalMonthlyRowToReport: identity fields are preserved", () => {
  const report = globalMonthlyRowToReport(AUGUST_MONTHLY_ROW);

  assert.equal(report.id, "monthly-aug");
  assert.equal(report.reportNumber, "MPR-2026-008");
  assert.equal(report.projectId, "prj-nour");
  assert.equal(report.status, "approved");
  assert.equal(report.reportingMonth, "2026-08-01");
  assert.equal(report.plannedProgress, 60);
  assert.equal(report.actualProgress, 58);
  assert.equal(report.planningSnapshotId, "snap-aug");
  assert.equal(report.updatedAt, "2026-09-01T08:00:00Z");
  assert.equal(report.createdAt, "2026-09-01T08:00:00Z");
  assert.deepEqual(report.attachmentIds, []);
});

test("globalMonthlyRowToReport: scheduleVariance and spi match the governed arithmetic", () => {
  const report = globalMonthlyRowToReport(AUGUST_MONTHLY_ROW);

  // scheduleVariance = round1(actual - planned); spi = actual / planned
  assert.equal(report.scheduleVariance, -2);      // round1(58 - 60) = -2.0
  assert.equal(report.spi, 0.97);                 // round2(58 / 60) = 0.97
});

test("globalMonthlyRowToReport: status 'approved' passes through — the key that isApprovedMonthly checks", () => {
  // isApprovedMonthly checks status ∈ {approved, finalized, locked}.
  // The RLS was hiding these rows for Nour; the global-register adapter
  // preserves the real status so selectOfficialMonthly correctly classes
  // them as 'approved' and adds the month to availableMonths.
  const report = globalMonthlyRowToReport(AUGUST_MONTHLY_ROW);
  assert.equal(report.status, "approved");
});

test("globalMonthlyRowToReport: register-metadata-only fields are absent (not fabricated)", () => {
  const report = globalMonthlyRowToReport(AUGUST_MONTHLY_ROW);
  assert.equal(report.overallProgressStatus, undefined);
  assert.equal(report.hseStatus, undefined);
  assert.equal(report.qualityStatus, undefined);
  assert.equal(report.executiveSummary, undefined);
});

test("globalMonthlyRowToReport: reportingMonth slice matches 'yyyy-MM' filter used by selectOfficialMonthly", () => {
  const aug = globalMonthlyRowToReport(AUGUST_MONTHLY_ROW);
  const sep = globalMonthlyRowToReport(SEPTEMBER_MONTHLY_ROW);

  // selectOfficialMonthly filters: report.reportingMonth.slice(0, 7) === month
  assert.equal(aug.reportingMonth.slice(0, 7), "2026-08");
  assert.equal(sep.reportingMonth.slice(0, 7), "2026-09");
  // Different months: not the same bucket
  assert.notEqual(aug.reportingMonth.slice(0, 7), sep.reportingMonth.slice(0, 7));
});

/* ───────── Weekly adapter ────────── */

test("globalWeeklyRowToReport: identity fields are preserved", () => {
  const report = globalWeeklyRowToReport(WEEKLY_ROW);

  assert.equal(report.id, "weekly-37");
  assert.equal(report.projectId, "prj-nour");
  assert.equal(report.periodStart, "2026-09-09");
  assert.equal(report.weekNumber, 37);
  assert.equal(report.status, "approved");
  assert.deepEqual(report.disciplineIds, []);
  assert.deepEqual(report.submissionIds, []);
  assert.deepEqual(report.entryIds, []);
  assert.deepEqual(report.activityIds, []);
  assert.deepEqual(report.attachmentIds, []);
});

test("globalWeeklyRowToReport: periodStart slice used by laterWeeklies filter works correctly", () => {
  const report = globalWeeklyRowToReport(WEEKLY_ROW);

  // The executive portfolio filters:
  //   weekly.periodStart.slice(0, 7) > month
  // A September week against an August baseline:
  const isPostAugust = report.periodStart.slice(0, 7) > "2026-08";
  assert.equal(isPostAugust, true, "week 37 (Sep) must qualify as post-August movement");

  // A September week is NOT post-September baseline:
  const isPostSeptember = report.periodStart.slice(0, 7) > "2026-09";
  assert.equal(isPostSeptember, false);
});

/* ────── Arithmetic sanity (inlined in executive-register-adapters.ts) ─────── */

test("adapter arithmetic: scheduleVariance is round1(actual - planned)", () => {
  // Matches the inlined sv() in executive-register-adapters.ts
  const onPlan = globalMonthlyRowToReport({ ...AUGUST_MONTHLY_ROW, plannedProgress: 60, actualProgress: 60 });
  assert.equal(onPlan.scheduleVariance, 0);

  const behind = globalMonthlyRowToReport({ ...AUGUST_MONTHLY_ROW, plannedProgress: 60, actualProgress: 55 });
  assert.equal(behind.scheduleVariance, -5);

  const ahead = globalMonthlyRowToReport({ ...AUGUST_MONTHLY_ROW, plannedProgress: 60, actualProgress: 65 });
  assert.equal(ahead.scheduleVariance, 5);
});

test("adapter arithmetic: spi avoids dividing by zero when planned is 0", () => {
  const zeroPlan = globalMonthlyRowToReport({ ...AUGUST_MONTHLY_ROW, plannedProgress: 0, actualProgress: 0 });
  assert.equal(zeroPlan.spi, 0);

  const activePlan = globalMonthlyRowToReport({ ...AUGUST_MONTHLY_ROW, plannedProgress: 60, actualProgress: 58 });
  assert.ok(activePlan.spi > 0);
});

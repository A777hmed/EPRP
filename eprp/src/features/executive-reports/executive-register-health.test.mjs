import assert from "node:assert/strict";
import test from "node:test";

import { isApprovedMonthly, readHealth } from "./executive-data.ts";
import { scheduleVariance } from "@/lib/reporting.ts";

/*
 * Regression coverage for the Access & Visibility Reconciliation hotfix,
 * Round 6, item 2 — the Executive register (`executive-register.tsx`) now
 * sources its projects/reports from `fetchGlobalRegisterProjects()` /
 * `fetchGlobalMonthlyReportRegister()` (platform-wide register METADATA,
 * `20260922000002_global_report_register_visibility.sql`) instead of the
 * assignment-gated `projectService.getProjects()` / `monthlyReportService
 * .list()`, closing the same "Nour sees zero" defect class the Weekly/
 * Monthly registers had in Round 5.
 *
 * `GlobalMonthlyRegisterRow` (the register projection) carries no
 * `overallProgressStatus` — that is report-level DETAIL, not register
 * metadata, by the migration's own stated boundary. `isApprovedMonthly()`
 * and `readHealth()` were narrowed from `MonthlyReport` to
 * `Pick<MonthlyReport, "status">` / `Pick<MonthlyReport, "scheduleVariance"
 * | "overallProgressStatus">` so the register can call them with an
 * adapter object built from `plannedProgress`/`actualProgress` alone
 * (`healthOfRegisterRow()` in `executive-register.tsx`) — these tests
 * exercise the REAL, imported, unmodified functions with exactly that
 * narrower shape, proving the register's health tally still produces a
 * real, honest reading (never a placeholder) from register-only data.
 */

test("isApprovedMonthly() accepts a bare {status} object — the register row's own shape", () => {
  assert.equal(isApprovedMonthly({ status: "draft" }), false);
  assert.equal(isApprovedMonthly({ status: "approved" }), true);
  assert.equal(isApprovedMonthly({ status: "finalized" }), true);
  assert.equal(isApprovedMonthly({ status: "locked" }), true);
});

test("readHealth() resolves a real reading from register-only data (scheduleVariance computed, overallProgressStatus genuinely absent)", () => {
  // Mirrors healthOfRegisterRow(): the register carries no recorded
  // judgement, only planned/actual, so overallProgressStatus is undefined
  // — never fabricated — and only the variance-derived branch can fire.
  const onPlan = readHealth({
    scheduleVariance: scheduleVariance(50, 52),
    overallProgressStatus: undefined,
  });
  assert.equal(onPlan.health, "on_track");
  assert.match(onPlan.basis, /schedule variance/i);
  assert.doesNotMatch(onPlan.basis, /Recorded on the Monthly Report/);

  const critical = readHealth({
    scheduleVariance: scheduleVariance(50, 30),
    overallProgressStatus: undefined,
  });
  assert.equal(critical.health, "critical");
});

test("readHealth() with no report at all still reports unknown, never a fabricated reading", () => {
  const reading = readHealth(undefined);
  assert.equal(reading.health, "unknown");
  assert.match(reading.basis, /No Monthly Report/);
});

test("scheduleVariance() matches the exact arithmetic the register uses to derive health from plannedProgress/actualProgress alone", () => {
  assert.equal(scheduleVariance(60, 55), -5);
  assert.equal(scheduleVariance(60, 60), 0);
  assert.equal(scheduleVariance(60, 65), 5);
});

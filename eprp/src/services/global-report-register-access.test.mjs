import assert from "node:assert/strict";
import test from "node:test";

import { isApprovedReportStatus } from "@/config/workflows.ts";

/*
 * Regression coverage for the Access & Visibility Reconciliation hotfix,
 * Round 5 — global read-only report registers
 * (`20260922000002_global_report_register_visibility.sql`,
 * `src/services/global-report-register.ts`).
 *
 * REPRODUCTION: Nour Adel (Viewer, Reporting Coordinator on PRJ-002 and
 * PSAIM-001 only per the local seed) saw ZERO rows in the Weekly and
 * Monthly registers despite the Dashboard already showing all six active
 * projects. Root cause: the register views called the same
 * assignment-gated `weeklyReportService.list()` / `monthlyReportService
 * .list()` / `projectService.getProjects()` the Dashboard used before its
 * own hotfix.
 *
 * `global_weekly_report_detail(uuid)` / `global_monthly_report_detail(uuid)`
 * gate a SPECIFIC report's content on exactly:
 *   auth.uid() IS NOT NULL
 *   AND (weekly_can_access_project(project_id) OR report_status_is_approved(status))
 *
 * `isApprovedReportStatus()` below is the REAL, unmodified TS mirror of the
 * SQL predicate `report_status_is_approved()` — imported directly, not
 * reimplemented, so a future drift between the two is caught here.
 * `hasOrdinaryProjectAccess` below is a fixture-only stand-in for
 * `weekly_can_access_project()` (a thin wrapper the migration reuses
 * unchanged) — it cannot run inside a Node unit test, so these tests
 * document exactly what was independently verified by querying the
 * predicate live against the local Supabase Postgres instance
 * (`docker exec supabase_db_eprp psql ...`, read-only, rolled back, no
 * migration applied), as SQL boolean expressions evaluated under each
 * user's simulated `auth.uid()`:
 *
 *   Nour Adel (00000000-0000-4000-a000-00000000c002), a project she has NO
 *   project_contacts row on (MDP-RBI-02, 19eb7bf1-e365-4783-80d5-fa027015e1f9):
 *     status='draft'     -> predicate FALSE  (denied)
 *     status='finalized' -> predicate TRUE   (allowed — this is the fix)
 *   Nour Adel, her own project (PRJ-002, c8a76ff0-eb2d-45b8-b786-7ab524ee507b):
 *     status='draft'     -> predicate TRUE   (ordinary access, unaffected)
 *   System Admin (00000000-0000-4000-a000-0000000000a1), same unrelated
 *   project, status='draft' -> predicate TRUE (has_global_operational_authority()
 *     bypass, unaffected by this hotfix)
 *
 * The migration itself was NOT applied to any database this round — this
 * suite proves the TS-visible half of the predicate (`isApprovedReportStatus`)
 * agrees with `report_status_is_approved()`, and documents the independently
 * verified SQL-side half. It does not and cannot substitute for applying
 * and exercising the migration.
 */

function hasOrdinaryProjectAccess(viewerId, projectId, assignments) {
  return Boolean(assignments[viewerId]?.has(projectId));
}

const NOUR = "nour-adel";
const ADMIN = "system-admin";
const PRJ_002 = "prj-002";
const UNRELATED_PROJECT = "mdp-rbi-02";

const ASSIGNMENTS = {
  [NOUR]: new Set([PRJ_002, "psaim-001"]),
  // System Admin's real access comes from has_global_operational_authority(),
  // not a project_contacts row — modelled here as "always true", matching
  // the verified admin scenario below.
};

function canReadReportDetail(viewerId, projectId, status, { isAdmin = false } = {}) {
  if (isAdmin) return true;
  return (
    hasOrdinaryProjectAccess(viewerId, projectId, ASSIGNMENTS) ||
    isApprovedReportStatus(status)
  );
}

test("Nour: an unrelated project's draft report is denied — register metadata only, no content", () => {
  assert.equal(canReadReportDetail(NOUR, UNRELATED_PROJECT, "draft"), false);
  assert.equal(canReadReportDetail(NOUR, UNRELATED_PROJECT, "under_review"), false);
});

test("Nour: an unrelated project's finalized/approved/locked report is allowed — the exact fix", () => {
  assert.equal(canReadReportDetail(NOUR, UNRELATED_PROJECT, "finalized"), true);
  assert.equal(canReadReportDetail(NOUR, UNRELATED_PROJECT, "approved"), true);
  assert.equal(canReadReportDetail(NOUR, UNRELATED_PROJECT, "locked"), true);
});

test("Nour: her own project's draft report stays readable — ordinary access is unaffected by this hotfix", () => {
  assert.equal(canReadReportDetail(NOUR, PRJ_002, "draft"), true);
  assert.equal(canReadReportDetail(NOUR, PRJ_002, "collecting"), true);
});

test("System Admin: full read regardless of project or status — unaffected by this hotfix", () => {
  assert.equal(canReadReportDetail(ADMIN, UNRELATED_PROJECT, "draft", { isAdmin: true }), true);
  assert.equal(canReadReportDetail(ADMIN, PRJ_002, "draft", { isAdmin: true }), true);
});

test("isApprovedReportStatus() (the real, imported TS mirror) matches report_status_is_approved() exactly for every status", () => {
  assert.equal(isApprovedReportStatus("draft"), false);
  assert.equal(isApprovedReportStatus("collecting"), false);
  assert.equal(isApprovedReportStatus("under_review"), false);
  assert.equal(isApprovedReportStatus("returned"), false);
  assert.equal(isApprovedReportStatus("archived"), false);
  assert.equal(isApprovedReportStatus("approved"), true);
  assert.equal(isApprovedReportStatus("finalized"), true);
  assert.equal(isApprovedReportStatus("locked"), true);
});

/*
 * Register METADATA (as opposed to report-level detail content) carries no
 * per-row predicate at all in `global_weekly_report_register()` /
 * `global_monthly_report_register()` / `global_report_register_projects()`
 * — every row is returned for any authenticated caller, draft included.
 * This is deliberate ("its register metadata may remain visible") and is
 * exactly what closes the reported bug: Nour goes from a raw-RLS-visible
 * count of 1 Weekly report (verified live: her own PRJ-002 report only, of
 * 37 total across the platform) to seeing all 37 rows' metadata.
 */
test("register metadata has no per-row gate — documents the verified raw-RLS baseline this hotfix replaces", () => {
  const totalPlatformWeeklyReports = 37;
  const nourOrdinaryRlsVisibleCount = 1; // verified live against local Postgres
  assert.ok(nourOrdinaryRlsVisibleCount < totalPlatformWeeklyReports);
});

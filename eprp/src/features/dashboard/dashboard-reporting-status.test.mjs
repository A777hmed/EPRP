import assert from "node:assert/strict";
import test from "node:test";

import {
  overdueReports,
  positionStatusLabel,
  positionsFor,
  totalsFor,
} from "./dashboard-positions.ts";

/*
 * Regression coverage for the Dashboard Read Model hotfix's approved
 * design decision 1: platform-wide OFFICIAL performance figures come ONLY
 * from an approved+/finalized/locked report; a report still in progress
 * never supplies figures and is never mislabeled "Not Reported" — it is
 * "pending_approval", figures withheld, its own status carried through.
 * Applies identically to every viewer (not gated by assignment).
 */

const PROJECT = {
  id: "prj-1",
  code: "PRJ-1",
  name: "Project One",
  status: "active",
  updatedAt: "2026-09-01T00:00:00Z",
};

function weekly(overrides) {
  return {
    id: "w-1",
    projectId: PROJECT.id,
    reportNumber: "EPR-W-1",
    status: "draft",
    periodEnd: "2026-09-05",
    plannedProgress: 50,
    actualProgress: 45,
    ...overrides,
  };
}

function monthly(overrides) {
  return {
    id: "m-1",
    projectId: PROJECT.id,
    reportNumber: "EPR-M-1",
    status: "draft",
    reportingMonth: "2026-09-01",
    plannedProgress: 55,
    actualProgress: 50,
    ...overrides,
  };
}

test("a Draft-only Weekly report never supplies platform-wide figures", () => {
  const [position] = positionsFor([PROJECT], [weekly({ status: "draft" })], [], "all");
  assert.equal(position.planned, undefined);
  assert.equal(position.actual, undefined);
  assert.equal(position.basis, "none");
  assert.equal(position.reportingStatus, "pending_approval");
  assert.equal(position.pendingReportStatus, "draft");
});

test("an approved Weekly report DOES supply the official figure", () => {
  const [position] = positionsFor([PROJECT], [weekly({ status: "approved" })], [], "all");
  assert.equal(position.planned, 50);
  assert.equal(position.actual, 45);
  assert.equal(position.basis, "weekly");
  assert.equal(position.reportingStatus, "reported");
});

for (const status of ["finalized", "locked"]) {
  test(`a ${status} Weekly report also counts as an official position`, () => {
    const [position] = positionsFor([PROJECT], [weekly({ status })], [], "all");
    assert.equal(position.reportingStatus, "reported");
    assert.equal(position.basis, "weekly");
  });
}

test("no report at all is genuinely not_reported, never pending_approval", () => {
  const [position] = positionsFor([PROJECT], [], [], "all");
  assert.equal(position.basis, "none");
  assert.equal(position.reportingStatus, "not_reported");
  assert.equal(position.pendingReportStatus, undefined);
});

test("an approved OLDER Weekly wins over a newer Draft — never a draft's numbers, never nothing", () => {
  const [position] = positionsFor(
    [PROJECT],
    [
      weekly({ id: "w-old", status: "approved", periodEnd: "2026-08-01", plannedProgress: 30, actualProgress: 28 }),
      weekly({ id: "w-new", status: "draft", periodEnd: "2026-09-05", plannedProgress: 90, actualProgress: 10 }),
    ],
    [],
    "all"
  );
  assert.equal(position.reportingStatus, "reported");
  assert.equal(position.planned, 30, "must use the approved report's figures, not the newer draft's");
  assert.equal(position.actual, 28);
});

test("Monthly supplies the official figure only when no approved Weekly exists", () => {
  const [position] = positionsFor(
    [PROJECT],
    [weekly({ status: "draft" })],
    [monthly({ status: "approved" })],
    "all"
  );
  assert.equal(position.basis, "monthly");
  assert.equal(position.reportingStatus, "reported");
  assert.equal(position.planned, 55);
});

test("with neither report approved, pending_approval names the MOST RECENT in-progress report across both tiers", () => {
  const [position] = positionsFor(
    [PROJECT],
    [weekly({ status: "draft", periodEnd: "2026-09-05" })],
    [monthly({ status: "under_review", reportingMonth: "2026-09-01" })],
    "all"
  );
  assert.equal(position.reportingStatus, "pending_approval");
  // 2026-09-05 (weekly) is more recent than 2026-09-01 (monthly).
  assert.equal(position.pendingReportStatus, "draft");
});

test("positionStatusLabel never says 'Not Reported' for a pending-approval position", () => {
  const [position] = positionsFor([PROJECT], [weekly({ status: "under_review" })], [], "all");
  assert.equal(position.reportingStatus, "pending_approval");
  assert.equal(positionStatusLabel(position), "Pending Approval");
});

test("positionStatusLabel says 'Not Reported' only for genuine absence", () => {
  const [position] = positionsFor([PROJECT], [], [], "all");
  assert.equal(positionStatusLabel(position), "Not Reported");
});

test("totalsFor distinguishes notReported from pendingApproval — never conflates the two counts", () => {
  const projects = [
    { ...PROJECT, id: "reported" },
    { ...PROJECT, id: "pending" },
    { ...PROJECT, id: "absent" },
  ];
  const weeklies = [
    weekly({ id: "w-a", projectId: "reported", status: "approved" }),
    weekly({ id: "w-b", projectId: "pending", status: "draft" }),
  ];
  const positions = positionsFor(projects, weeklies, [], "all");
  const totals = totalsFor(positions, [], []);

  assert.equal(totals.totalProjects, 3);
  assert.equal(totals.reportedProjects, 1);
  assert.equal(totals.notReported, 1, "only the project with zero reports");
  assert.equal(totals.pendingApproval, 1, "the draft project, counted separately");
});

test("totalsFor's reporting-coverage figures come only from official (approved+) positions", () => {
  const projects = [
    { ...PROJECT, id: "a" },
    { ...PROJECT, id: "b" },
  ];
  const weeklies = [
    weekly({ id: "w-a", projectId: "a", status: "approved", plannedProgress: 40, actualProgress: 40 }),
    // A draft reporting 99%/1% must NEVER pull the portfolio mean toward it.
    weekly({ id: "w-b", projectId: "b", status: "draft", plannedProgress: 99, actualProgress: 1 }),
  ];
  const positions = positionsFor(projects, weeklies, [], "all");
  const totals = totalsFor(positions, [], []);

  assert.equal(totals.reportedProjects, 1);
  assert.equal(totals.planned, 40);
  assert.equal(totals.actual, 40);
});

test("overdueReports/totalsFor read the UNBOUNDED overdue arrays, not the current-position ones", () => {
  const overdueWeeklies = [
    weekly({ id: "w-stuck", status: "collecting", periodEnd: "2026-01-01" }),
  ];
  const positions = positionsFor([PROJECT], [], [], "all");
  const today = "2026-09-22";

  const totals = totalsFor(positions, overdueWeeklies, [], today);
  assert.equal(totals.overdueReports, 1);

  const rows = overdueReports(positions, overdueWeeklies, [], today);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reportType, "weekly");
  assert.ok(rows[0].daysOverdue > 200, "period end was months ago");
});

import assert from "node:assert/strict";
import test from "node:test";

import { latestPeriodCount, summarizeReportRegister } from "./register-summary.ts";

const projects = new Map([
  ...Array.from({ length: 6 }, (_, index) => [
    `demo-${index + 1}`,
    { portfolioGroupId: "management-demo" },
  ]),
  ["legacy-prj-002", { portfolioGroupId: "legacy" }],
]);

const finalizedDemoReports = Array.from({ length: 36 }, (_, index) => ({
  id: `weekly-${index + 1}`,
  projectId: `demo-${(index % 6) + 1}`,
  status: "finalized",
  weekNumber: Math.floor(index / 6) + 1,
}));

const allWeeklyReports = [
  ...finalizedDemoReports,
  {
    id: "legacy-draft",
    projectId: "legacy-prj-002",
    status: "draft",
    weekNumber: 6,
  },
];

test("portfolio-group scope excludes the legacy Draft from Weekly summary metrics", () => {
  const visible = allWeeklyReports.filter(
    (report) => projects.get(report.projectId)?.portfolioGroupId === "management-demo"
  );
  const summary = summarizeReportRegister(visible, {
    inProgress: ["draft", "collecting", "submitted", "under_review", "returned"],
    approved: ["approved", "finalized", "locked", "archived"],
  });

  assert.deepEqual(
    {
      total: summary.total,
      inProgress: summary.statusCounts.inProgress,
      approved: summary.statusCounts.approved,
      latestWeek: latestPeriodCount(visible, (report) => report.weekNumber),
    },
    { total: 36, inProgress: 0, approved: 36, latestWeek: 6 }
  );
});

test("every narrowed register collection produces its own summary", () => {
  const visible = allWeeklyReports.filter(
    (report) => report.projectId === "demo-1" && report.weekNumber === 6
  );
  const summary = summarizeReportRegister(visible, {
    draft: ["draft"],
    approved: ["approved", "finalized", "locked", "archived"],
  });

  assert.equal(summary.total, 1);
  assert.equal(summary.statusCounts.draft, 0);
  assert.equal(summary.statusCounts.approved, 1);
  assert.equal(latestPeriodCount(visible, (report) => report.weekNumber), 1);
});

test("Monthly summary groups also count only their filtered collection", () => {
  const filteredMonthlies = [
    { status: "draft" },
    { status: "under_review" },
    { status: "approved" },
    { status: "finalized" },
  ].filter((report) => report.status !== "draft");
  const summary = summarizeReportRegister(filteredMonthlies, {
    draft: ["draft"],
    review: ["submitted", "under_review"],
    approved: ["approved", "finalized", "locked", "archived"],
  });

  assert.deepEqual(
    { total: summary.total, ...summary.statusCounts },
    { total: 3, draft: 0, review: 1, approved: 2 }
  );
});

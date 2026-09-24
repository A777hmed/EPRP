import assert from "node:assert/strict";
import test from "node:test";

import {
  approvedExecutivePerformance,
  executiveGovernanceCounts,
  executiveHealthCounts,
  monthlyForExecutiveHealth,
} from "./executive-governance.ts";

const demoRows = [
  { basis: "approved", health: "on_track", planned: 20, actual: 20 },
  { basis: "approved", health: "on_track", planned: 40, actual: 35 },
  { basis: "approved", health: "at_risk", planned: 60, actual: 50 },
  { basis: "approved", health: "critical", planned: 80, actual: 60 },
  { basis: "draft", health: "at_risk", planned: 100, actual: 100 },
  { basis: "none", health: "unknown" },
];

test("September governance counts reconcile to the six-project management scope", () => {
  const counts = executiveGovernanceCounts(demoRows);
  const health = executiveHealthCounts(demoRows, ["critical", "at_risk", "on_track", "unknown"]);

  assert.deepEqual({ ...counts, notReported: health.unknown }, {
    active: 6,
    submitted: 5,
    approved: 4,
    draft: 1,
    missing: 1,
    notReported: 1,
  });
  assert.equal(counts.submitted + counts.missing, counts.active);
  assert.equal(counts.approved + counts.draft, counts.submitted);
});

test("draft Monthly data is excluded from approved portfolio performance", () => {
  const performance = approvedExecutivePerformance(demoRows);

  assert.deepEqual(performance, { planned: 50, actual: 41.3, contributing: 4 });
});

test("missing performance is omitted while a reported zero remains a real value", () => {
  const performance = approvedExecutivePerformance([
    { basis: "approved", planned: 0, actual: 0 },
    { basis: "approved", planned: 60, actual: 30 },
    { basis: "approved", planned: undefined, actual: undefined },
    { basis: "draft", planned: 100, actual: 100 },
    { basis: "none", planned: 0, actual: 0 },
  ]);

  assert.deepEqual(performance, { planned: 30, actual: 15, contributing: 2 });
});

test("project-health distribution totals the active Executive scope", () => {
  const order = ["critical", "at_risk", "on_track", "unknown"];
  const counts = executiveHealthCounts(demoRows, order);

  assert.deepEqual(counts, { critical: 1, at_risk: 2, on_track: 2, unknown: 1 });
  assert.equal(Object.values(counts).reduce((sum, value) => sum + value, 0), 6);
  assert.equal(counts.unknown, 1, "only the project with no Monthly is Not Reported");
});

test("draft Monthly supplies project health but remains a separate governance basis", () => {
  const draft = { id: "monthly-draft", health: "at_risk" };

  assert.equal(monthlyForExecutiveHealth("draft", draft), draft);
  assert.equal(monthlyForExecutiveHealth("approved", draft), draft);
  assert.equal(monthlyForExecutiveHealth("none", draft), undefined);
});

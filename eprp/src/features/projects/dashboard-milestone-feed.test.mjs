import assert from "node:assert/strict";
import test from "node:test";

import { milestoneStates } from "./milestone-state.ts";

/*
 * Regression coverage for the Dashboard Read Model hotfix's Master
 * Milestone design decision: `dashboard_master_milestones()` /
 * `dashboard_milestone_updates()` return a NARROW column set (see the
 * migration's header for the exact list) and `dashboard_milestone_
 * updates()` is filtered to `approval_status = 'approved'` only — no
 * pending rows. These fixtures construct exactly the objects
 * `rowToMasterMilestone()` / `rowToMilestoneUpdate()`
 * (`src/services/dashboard-read-model.ts`) produce from that narrow
 * column set (every excluded field left `undefined`, matching what the
 * real RPC row would map to) and feed them into the EXISTING, UNMODIFIED
 * `milestoneStates()` to prove the derivation this hotfix reuses — rather
 * than reimplements — still produces the correct governed state from
 * that narrower input.
 */

const MILESTONE = {
  id: "m-1",
  projectId: "prj-1",
  code: "M-01",
  name: "Issue IFC Drawings",
  departmentId: "dept-eng",
  priority: "medium",
  source: "manual",
  active: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  type: "technical",
  baselineDate: "2026-06-01",
  plannedDate: "2026-06-01",
  clientApprovalRequired: false,
  isAdvancePayment: false,
  // Every field the dashboard RPC does NOT return is genuinely absent —
  // not zeroed, not defaulted — exactly as `rowToMasterMilestone()` leaves it.
};

function approvedUpdate(overrides) {
  return {
    id: "u-1",
    milestoneId: MILESTONE.id,
    source: "weekly",
    status: "in_progress",
    approvalStatus: "approved",
    isRegression: false,
    submittedAt: "2026-03-01T00:00:00Z",
    progressPercent: 40,
    forecastDate: "2026-06-10",
    ...overrides,
  };
}

test("a single approved update, narrow-column-fed, resolves to the correct current state", () => {
  const [state] = milestoneStates([MILESTONE], [approvedUpdate({})]);
  assert.equal(state.status, "in_progress");
  assert.equal(state.progressPercent, 40);
  assert.equal(state.forecastDate, "2026-06-10");
  assert.equal(state.complete, false);
});

test("pending rows are correctly absent from the feed — dashboard_milestone_updates() never sends them, and the derivation must not need them for 'current'", () => {
  // Only the approved row is passed, mirroring the RPC's approval_status =
  // 'approved' filter — no pending row exists in this fixture at all.
  const [state] = milestoneStates(
    [MILESTONE],
    [approvedUpdate({ id: "u-approved", progressPercent: 40 })]
  );
  assert.equal(state.progressPercent, 40, "current state is unaffected by the absence of pending rows");
  assert.deepEqual(state.pending, [], "no pending rows were ever fed in, exactly as the narrow RPC feed intends");
});

test("a milestone with only a pending update (none approved) reports unreported, never a stray figure", () => {
  // Simulates what the dashboard feed looks like for a milestone whose
  // only submission hasn't been approved yet: the approved-only fetch
  // returns ZERO update rows for it.
  const [state] = milestoneStates([MILESTONE], []);
  assert.equal(state.status, "not_started");
  assert.equal(state.progressPercent, undefined, "never a fabricated 0%");
  assert.equal(state.current, undefined);
});

test("newest APPROVED update wins when the same cut-off is not in conflict (agreed) — the narrow feed still carries as_of_date and submittedAt, which this needs", () => {
  const [state] = milestoneStates(
    [MILESTONE],
    [
      approvedUpdate({ id: "u-early", submittedAt: "2026-03-01T00:00:00Z", progressPercent: 30, asOfDate: undefined }),
      approvedUpdate({ id: "u-later", submittedAt: "2026-04-01T00:00:00Z", progressPercent: 55, asOfDate: undefined }),
    ]
  );
  assert.equal(state.progressPercent, 55, "undated rows: newest submittedAt wins, unchanged rule");
});

test("a regression is still correctly detected from the narrow feed (isRegression carried through)", () => {
  const [state] = milestoneStates(
    [MILESTONE],
    [
      approvedUpdate({ id: "u-1", submittedAt: "2026-03-01T00:00:00Z", progressPercent: 60 }),
      approvedUpdate({ id: "u-2", submittedAt: "2026-04-01T00:00:00Z", progressPercent: 45, isRegression: true }),
    ]
  );
  // Current is still "newest approved" here (both undated) — the point of
  // this fixture is that isRegression survives the narrow row mapping
  // without needing narrative/regressionReason to be present.
  assert.equal(state.current.progressPercent, 45);
  assert.equal(state.current.isRegression, true);
});

test("dashboard_master_milestones()'s excluded fields (description, weightPercent, payment fields, …) are genuinely absent, not silently zeroed, and the Dashboard's own consumer never needed them", () => {
  const [state] = milestoneStates([MILESTONE], [approvedUpdate({})]);
  assert.equal(state.milestone.description, undefined);
  assert.equal(state.milestone.weightPercent, undefined);
  assert.equal(state.milestone.paymentAmount, undefined);
  // governedMilestoneRow() (dashboard-data.ts) reads only these four —
  // all present and correct despite the narrow feed.
  assert.equal(state.milestone.id, MILESTONE.id);
  assert.equal(state.milestone.projectId, MILESTONE.projectId);
  assert.equal(state.milestone.departmentId, MILESTONE.departmentId);
  assert.equal(state.milestone.name, MILESTONE.name);
});

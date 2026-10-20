import assert from "node:assert/strict";
import test from "node:test";

import {
  applyNormalisation,
  blockingIssues,
  calculatePlanPerformance,
  proposeNormalisation,
  validatePlan,
} from "./index.ts";
import { findInput, worked265 } from "./fixtures.mjs";

/* Phase 13.10 — weight and completeness validation (`docs/02` §26.4 W1–W3,
   C1–C2) and Data Date integrity (§26.6 rule 3). */

const codes = (issues) => issues.map((finding) => finding.code);

test("the §26.5 plan is publishable: no blocking finding", () => {
  assert.deepEqual(blockingIssues(validatePlan(worked265())), []);
});

test("W1/W2 (§26.5): Utilities' weight left blank blocks with 'RBI: child weights total 75%'", () => {
  const plan = worked265();
  findInput(plan, "utl").localWeight = null;
  const result = calculatePlanPerformance(plan);
  assert.equal(result.status, "blocked");
  const w1 = result.issues.find((finding) => finding.code === "W1_CHILD_TOTAL");
  assert.equal(w1.message, "RBI: child weights total 75%.");
  assert.equal(w1.elementId, "rbi");
  const w2 = result.issues.find((finding) => finding.code === "W2_MISSING_WEIGHT");
  assert.equal(w2.message, "RBI: weight missing for Utilities.");
  assert.equal(result.performance, undefined, "never a partial calculation");
});

test("W1: totals within ±0.01 pass, beyond it block", () => {
  const near = worked265();
  findInput(near, "vdu").localWeight = 40.005;
  findInput(near, "cdu").localWeight = 34.995;
  assert.deepEqual(blockingIssues(validatePlan(near)), []);

  const off = worked265();
  findInput(off, "vdu").localWeight = 40.02;
  assert.deepEqual(codes(blockingIssues(validatePlan(off))), ["W1_CHILD_TOTAL"]);
});

test("W1: the project's own top-level children must total 100%", () => {
  const plan = worked265();
  findInput(plan, "sil").localWeight = 30;
  const issues = blockingIssues(validatePlan(plan));
  assert.equal(issues[0].code, "W1_CHILD_TOTAL");
  assert.equal(issues[0].elementId, null);
  assert.equal(issues[0].message, "Project: child weights total 90%.");
});

test("weights: out-of-range or non-numeric weights block; an empty node blocks", () => {
  const plan = worked265();
  findInput(plan, "vdu").localWeight = -5;
  findInput(plan, "hazop").children = [];
  const found = codes(blockingIssues(validatePlan(plan)));
  assert.ok(found.includes("WEIGHT_INVALID"));
  assert.ok(found.includes("EMPTY_NODE"));

  const nan = worked265();
  findInput(nan, "cdu").localWeight = Number.NaN;
  assert.ok(codes(validatePlan(nan)).includes("WEIGHT_INVALID"));
});

/* ---------------------------- W3 normalisation --------------------------- */

test("W3 (§26.5): proportional rescale of VDU 40 / CDU 35 / Utilities blank → 53.333 / 46.667 / 0", () => {
  const proposal = proposeNormalisation(
    "rbi",
    [
      { id: "vdu", localWeight: 40 },
      { id: "cdu", localWeight: 35 },
      { id: "utl", localWeight: null },
    ],
    "proportional_rescale"
  );
  assert.equal(proposal.ok, true);
  const after = Object.fromEntries(proposal.decision.after.map(({ id, localWeight }) => [id, localWeight]));
  assert.equal(after.vdu.toFixed(3), "53.333");
  assert.equal(after.cdu.toFixed(3), "46.667");
  assert.equal(after.utl, 0);
  assert.equal(proposal.decision.mode, "proportional_rescale");
  assert.deepEqual(proposal.decision.before.map((child) => child.localWeight), [40, 35, null], "the decision keeps what was entered");
});

test("W3: equal split only when no child weight is entered", () => {
  const blank = proposeNormalisation("x", [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], "equal_split");
  assert.equal(blank.ok, true);
  assert.deepEqual(blank.decision.after.map((child) => child.localWeight), [25, 25, 25, 25]);

  const partial = proposeNormalisation("x", [{ id: "a", localWeight: 10 }, { id: "b" }], "equal_split");
  assert.equal(partial.ok, false);
  assert.equal(proposeNormalisation("x", [{ id: "a" }], "proportional_rescale").ok, false, "nothing to rescale");
  assert.equal(proposeNormalisation("x", [], "equal_split").ok, false);
});

test("W3: normalisation is never silent — the engine only applies an explicit decision, to a NEW plan", () => {
  const plan = worked265();
  findInput(plan, "utl").localWeight = null;
  assert.equal(calculatePlanPerformance(plan).status, "blocked", "no automatic normalisation");

  const { decision } = proposeNormalisation(
    "rbi",
    findInput(plan, "rbi").children.map(({ id, localWeight }) => ({ id, localWeight })),
    "proportional_rescale"
  );
  const normalised = applyNormalisation(plan, decision);
  assert.equal(findInput(plan, "utl").localWeight, null, "the original plan is not modified");
  assert.equal(calculatePlanPerformance(normalised).status, "calculated");
  assert.equal(findInput(normalised, "utl").localWeight, 0);
  assert.equal(findInput(normalised, "vdu-a20").localWeight, 40, "only the decided parent's children change");
});

/* ------------------------------ C1 / C2 ---------------------------------- */

test("C2 (§26.5): VDU-A20 started with no confirmed % blocks — never counted as 0, never dropped", () => {
  const plan = worked265();
  findInput(plan, "vdu-a20").percentComplete = null;
  const result = calculatePlanPerformance(plan);
  assert.equal(result.status, "blocked");
  assert.deepEqual(codes(result.issues), ["C2_UNMEASURED_START"]);
  assert.equal(result.issues[0].elementId, "vdu-a20");
});

test("C1: an unstarted activity with no % is valid and earns 0", () => {
  const plan = worked265();
  assert.equal(findInput(plan, "vdu-a30").percentComplete, undefined);
  assert.equal(calculatePlanPerformance(plan).status, "calculated");
});

test("C1 advisory: % recorded without an actual start is flagged, and still earns 0", () => {
  const plan = worked265();
  findInput(plan, "vdu-a30").percentComplete = 10;
  const result = calculatePlanPerformance(plan);
  assert.equal(result.status, "calculated");
  assert.deepEqual(codes(result.performance.advisories), ["PROGRESS_WITHOUT_START"]);
  assert.equal(result.performance.elements.find((element) => element.id === "vdu-a30").ev, 0);
});

test("advisory: finished below 100% is flagged, not blocked", () => {
  const plan = worked265();
  findInput(plan, "vdu-a10").percentComplete = 95;
  const result = calculatePlanPerformance(plan);
  assert.equal(result.status, "calculated");
  assert.deepEqual(codes(result.performance.advisories), ["FINISHED_BELOW_100"]);
});

test("percent complete outside 0–100 blocks", () => {
  const plan = worked265();
  findInput(plan, "vdu-a20").percentComplete = 140;
  assert.deepEqual(codes(blockingIssues(validatePlan(plan))), ["PERCENT_INVALID"]);
});

/* -------------------------- Dates / Data Date ---------------------------- */

test("§26.6 rule 3: an actual date after the Data Date blocks", () => {
  const plan = worked265();
  findInput(plan, "utl-a10").actual = { start: "2026-10-04", finish: "2026-11-02" };
  assert.deepEqual(codes(blockingIssues(validatePlan(plan))), ["ACTUAL_AFTER_DATA_DATE"]);
});

test("§26.6 rule 3: incomplete work forecast before the Data Date blocks", () => {
  const plan = worked265();
  findInput(plan, "vdu-a20").forecast = { finish: "2026-10-20" };
  findInput(plan, "vdu-a30").forecast = { start: "2026-10-20", finish: "2026-11-30" };
  assert.deepEqual(codes(blockingIssues(validatePlan(plan))), ["FORECAST_BEFORE_DATA_DATE", "FORECAST_BEFORE_DATA_DATE"]);
});

test("BLn dates: missing or reversed BLn blocks — PV is never fabricated", () => {
  const plan = worked265();
  findInput(plan, "vdu-a20").baseline = { start: "2026-10-08" };
  findInput(plan, "cdu-a20").baseline = { start: "2026-11-22", finish: "2026-10-26" };
  const found = codes(blockingIssues(validatePlan(plan)));
  assert.deepEqual(found, ["BASELINE_DATES_INVALID", "BASELINE_DATES_INVALID"]);
});

test("H4: a true milestone must have zero duration and a BLn date", () => {
  const plan = worked265();
  findInput(plan, "vdu-m10").baseline = { start: "2026-12-10", finish: "2026-12-15" };
  assert.deepEqual(codes(blockingIssues(validatePlan(plan))), ["MILESTONE_NOT_ZERO_DURATION"]);
  findInput(plan, "vdu-m10").baseline = {};
  assert.deepEqual(codes(blockingIssues(validatePlan(plan))), ["BASELINE_DATES_INVALID"]);
});

test("dates: a present but invalid date blocks rather than being ignored", () => {
  const plan = worked265();
  findInput(plan, "vdu-a20").actual = { start: "2026-13-01" };
  assert.ok(codes(blockingIssues(validatePlan(plan))).includes("DATE_INVALID"));
});

test("plan: a missing Data Date, an empty working week or duplicate ids block", () => {
  const noDate = { ...worked265(), dataDate: "" };
  assert.ok(codes(validatePlan(noDate)).includes("PLAN_INVALID"));
  const noWeek = { ...worked265(), workingWeek: [] };
  assert.ok(codes(validatePlan(noWeek)).includes("PLAN_INVALID"));
  const duplicate = worked265();
  findInput(duplicate, "sil").children[0].id = "hazop-a10";
  assert.ok(codes(validatePlan(duplicate)).includes("DUPLICATE_ID"));
});

test("an empty plan is refused, not reported as 0%", () => {
  const result = calculatePlanPerformance({ projectId: "p", dataDate: "2026-10-31", workingWeek: ["sunday"], children: [] });
  assert.equal(result.status, "blocked");
  assert.deepEqual(codes(result.issues), ["EMPTY_NODE"]);
});

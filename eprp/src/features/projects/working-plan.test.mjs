import assert from "node:assert/strict";
import test from "node:test";

import { calculatePlanPerformance, effectiveWeights } from "../../lib/planning-engine/engine.ts";
import { DATA_DATE, WORKING_WEEK, worked265 } from "../../lib/planning-engine/fixtures.mjs";
import { proposeNormalisation } from "../../lib/planning-engine/validation.ts";
import {
  allParentSummaries,
  buildWorkingPlanTree,
  childrenOf,
  configurationChanged,
  configurationComplete,
  configurationProblems,
  describeConfiguration,
  effectiveContributions,
  flattenWorkingPlan,
  levelLabel,
  parentWeightSummary,
  proposeWeightDecision,
  recordedActivityBaseline,
  resolveEarningMethod,
  resolveReportingUnit,
  toEnginePlanInput,
  weightDecisionPayload,
  weightSourceChangeNeedsReason,
  workingPlanFindings,
  workingPlanRefusalMessage,
} from "./working-plan.ts";

/* Phase 13.11 — Working Plan hardening (`docs/02` §26.3, §26.4, §26.20).
   The pure rules behind the Master Plan editor, Planning Setup and the
   canonical Working Plan → Planning Engine adapter. */

const node = (id, overrides = {}) => ({
  id,
  projectId: "p1",
  code: id.toUpperCase(),
  name: id.toUpperCase(),
  itemType: "engineering",
  level: 0,
  sortOrder: 0,
  isMilestone: false,
  isControlAccount: false,
  source: "manual",
  active: true,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  ...overrides,
});

const activity = (id, overrides = {}) => ({
  id,
  projectId: "p1",
  code: id.toUpperCase(),
  name: id.toUpperCase(),
  isMilestone: false,
  source: "import",
  active: true,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  ...overrides,
});

const settings = (overrides = {}) => ({
  levelLabels: ["Control Account", "Unit"],
  controlAccountLevel: 1,
  weightSource: "eprp",
  defaultEarningMethod: "percent_complete",
  ...overrides,
});

/* ------------------------------ §26.5 fixture ----------------------------- */

// The approved worked example, entered as a real Working Plan: RBI rolled
// down to activities, HAZOP and SIL each carried by one activity that
// reproduces their stated PV / EV.



function fixture() {
  const workItems = [
    node("rbi", { localWeightPercent: 10, isControlAccount: true, sortOrder: 1 }),
    node("vdu", { parentWorkItemId: "rbi", localWeightPercent: 40, sortOrder: 1 }),
    node("cdu", { parentWorkItemId: "rbi", localWeightPercent: 35, sortOrder: 2 }),
    node("utl", { parentWorkItemId: "rbi", localWeightPercent: 25, sortOrder: 3 }),
    node("hazop", { localWeightPercent: 50, isControlAccount: true, sortOrder: 2 }),
    node("sil", { localWeightPercent: 40, isControlAccount: true, sortOrder: 3 }),
  ];
  return { workItems };
}

/* --------------------------------- Labels -------------------------------- */

test("level labels: configured label per depth, else 'Level n'", () => {
  assert.equal(levelLabel(["Control Account", "Unit"], 1), "Control Account");
  assert.equal(levelLabel(["Control Account", "Unit"], 2), "Unit");
  assert.equal(levelLabel(["Control Account", "Unit"], 3), "Level 3");
  assert.equal(levelLabel([], 1), "Level 1");
});

/* ----------------------------- Configuration ----------------------------- */

test("configuration: problems — at most 8 named levels, reporting level within them", () => {
  assert.deepEqual(configurationProblems(settings()), []);
  assert.match(configurationProblems(settings({ levelLabels: Array(9).fill("L") })).join(), /at most 8/);
  assert.match(configurationProblems(settings({ levelLabels: ["A", "  "] })).join(), /needs a name/);
  assert.match(configurationProblems(settings({ levelLabels: ["x".repeat(61)] })).join(), /60 characters/);
  assert.match(configurationProblems(settings({ controlAccountLevel: 3 })).join(), /named levels/);
  assert.match(configurationProblems(settings({ controlAccountLevel: 0 })).join(), /reported at/);
});

test("configuration: complete only when every 13.11 question is answered", () => {
  assert.equal(configurationComplete(settings()), true);
  assert.equal(configurationComplete(null), false);
  assert.equal(configurationComplete(settings({ levelLabels: [] })), false);
  assert.equal(configurationComplete(settings({ controlAccountLevel: undefined })), false);
  assert.equal(configurationComplete(settings({ weightSource: undefined })), false);
  assert.equal(configurationComplete(settings({ defaultEarningMethod: undefined })), false);
});

test("configuration: change detection trims labels; weight-source switch needs a reason once weights exist", () => {
  assert.equal(configurationChanged(settings(), settings({ levelLabels: [" Control Account ", "Unit"] })), false);
  assert.equal(configurationChanged(settings(), settings({ levelLabels: ["Control Account"] })), true);
  assert.equal(configurationChanged(settings(), settings({ weightSource: "imported" })), true);
  assert.equal(weightSourceChangeNeedsReason(settings(), settings({ weightSource: "imported" }), true), true);
  assert.equal(weightSourceChangeNeedsReason(settings(), settings({ weightSource: "imported" }), false), false);
  assert.equal(weightSourceChangeNeedsReason(settings({ weightSource: undefined }), settings(), true), false);
});

test("configuration: described in business language; nothing calculated is part of it", () => {
  const described = describeConfiguration(settings());
  assert.deepEqual(described.map((row) => row.label), [
    "Breakdown", "Performance reported at", "Weight source", "Default earning method",
  ]);
  assert.deepEqual(described.map((row) => row.value), [
    "Control Account → Unit",
    "Control Account",
    "Enter & manage weights in EPRP",
    "Percent complete",
  ]);
  assert.deepEqual(Object.keys(settings()).sort(), [
    "controlAccountLevel", "defaultEarningMethod", "levelLabels", "weightSource",
  ]);
});

/* -------------------------------- The tree ------------------------------- */

test("tree: nodes then activities under each parent, depths from the hierarchy, archived excluded", () => {
  const tree = buildWorkingPlanTree(
    [
      node("a", { sortOrder: 2 }),
      node("b", { sortOrder: 1 }),
      node("a1", { parentWorkItemId: "a" }),
      node("old", { active: false }),
    ],
    [activity("t1", { workItemId: "a1" }), activity("t0", { workItemId: "a" }), activity("gone", { active: false })]
  );
  assert.deepEqual(flattenWorkingPlan(tree).map((element) => `${element.id}@${element.depth}`), [
    "b@1", "a@1", "a1@2", "t1@3", "t0@2",
  ]);
  assert.equal(tree.hasHierarchy, true);
  assert.equal(tree.nodes.has("old"), false);
  assert.equal(tree.leaves.has("gone"), false);
});

test("tree: an activity whose node is archived is unattached, a node whose parent is archived is top level", () => {
  const tree = buildWorkingPlanTree(
    [node("live"), node("dead", { active: false }), node("child", { parentWorkItemId: "dead" })],
    [activity("x", { workItemId: "dead" }), activity("loose")]
  );
  assert.deepEqual(tree.roots.map((element) => element.id).sort(), ["child", "live", "loose", "x"]);
  assert.equal(tree.nodes.get("child").depth, 1);
  assert.deepEqual(tree.unattached.map((leaf) => leaf.id).sort(), ["loose", "x"]);
  assert.equal(tree.leaves.get("x").detachedFromArchived, true);
  assert.equal(tree.leaves.get("loose").detachedFromArchived, false);
});

/* --------------------------- Earning methods ----------------------------- */

test("earning method: activity → nearest node → project; a true milestone always earns by Milestone", () => {
  const tree = buildWorkingPlanTree(
    [node("ca", { earningMethod: "zero_hundred" }), node("wp", { parentWorkItemId: "ca" }), node("plain")],
    [
      activity("own", { workItemId: "wp", earningMethod: "fifty_fifty" }),
      activity("inherits", { workItemId: "wp" }),
      activity("project", { workItemId: "plain" }),
      activity("ms", { workItemId: "plain", isMilestone: true }),
    ]
  );
  const leaf = (id) => tree.leaves.get(id);
  assert.deepEqual(resolveEarningMethod(leaf("own"), "percent_complete"), { method: "fifty_fifty", source: "activity" });
  assert.deepEqual(resolveEarningMethod(leaf("inherits"), "percent_complete"), {
    method: "zero_hundred", source: "node", fromNodeId: "ca",
  });
  assert.deepEqual(resolveEarningMethod(leaf("project"), "percent_complete"), { method: "percent_complete", source: "project" });
  assert.deepEqual(resolveEarningMethod(leaf("ms"), "percent_complete"), { method: "milestone", source: "kind" });
  assert.deepEqual(resolveEarningMethod(leaf("project")), { method: null, reason: "not_set" });
});

test("earning method: a Milestone default never reaches a task — inheritance stops at the nearest default", () => {
  const tree = buildWorkingPlanTree(
    [node("ms-pkg", { earningMethod: "milestone" })],
    [activity("task", { workItemId: "ms-pkg" }), activity("ms", { workItemId: "ms-pkg", isMilestone: true })]
  );
  assert.deepEqual(resolveEarningMethod(tree.leaves.get("task"), "percent_complete"), {
    method: null, reason: "milestone_default_for_task", fromNodeId: "ms-pkg",
  });
  assert.equal(resolveEarningMethod(tree.leaves.get("ms"), "percent_complete").method, "milestone");
  const projectOnly = buildWorkingPlanTree([node("n")], [activity("t", { workItemId: "n" })]);
  assert.equal(resolveEarningMethod(projectOnly.leaves.get("t"), "milestone").reason, "milestone_default_for_task");
});

/* ---------------------------- Reporting units ---------------------------- */

test("reporting unit: own mapping, else inherited from the nearest node, else the project-level section", () => {
  const tree = buildWorkingPlanTree(
    [
      node("psm", { departmentId: "dep-1", systemId: "sys-1" }),
      node("psm-child", { parentWorkItemId: "psm" }),
      node("other", { structureNodeId: "unit-9" }),
      node("none"),
    ],
    [
      activity("over", { workItemId: "psm-child", departmentId: "dep-2" }),
      activity("inherit", { workItemId: "psm-child" }),
      activity("unit", { workItemId: "other" }),
      activity("free", { workItemId: "none" }),
    ]
  );
  assert.deepEqual(resolveReportingUnit(tree.leaves.get("over")), {
    unit: { family: "psm", departmentId: "dep-2", systemId: undefined, disciplineId: undefined }, source: "own",
  });
  assert.deepEqual(resolveReportingUnit(tree.leaves.get("inherit")), {
    unit: { family: "psm", departmentId: "dep-1", systemId: "sys-1", disciplineId: undefined },
    source: "inherited", fromNodeId: "psm",
  });
  assert.deepEqual(resolveReportingUnit(tree.leaves.get("unit")), {
    unit: { family: "other", structureNodeId: "unit-9" }, source: "inherited", fromNodeId: "other",
  });
  assert.deepEqual(resolveReportingUnit(tree.leaves.get("free")), { unit: null, source: "project_level" });
});

/* -------------------------------- Weights -------------------------------- */

test("weights: per-parent sums (W1/W2) — the Project and every node, nodes and activities together", () => {
  const { workItems } = fixture();
  const tree = buildWorkingPlanTree(workItems, [
    activity("a1", { workItemId: "vdu", localWeightPercent: 60 }),
    activity("a2", { workItemId: "vdu", localWeightPercent: 40 }),
    activity("c1", { workItemId: "cdu" }),
    activity("u1", { workItemId: "utl", localWeightPercent: 20 }),
  ]);
  const byParent = Object.fromEntries(allParentSummaries(tree).map((s) => [s.parentName, s]));
  assert.equal(byParent.Project.status, "complete");
  assert.equal(byParent.Project.enteredTotal, 100);
  assert.equal(byParent.RBI.status, "complete");
  assert.equal(byParent.VDU.status, "complete");
  assert.deepEqual(byParent.CDU.missing, ["C1"]);
  assert.equal(byParent.UTL.status, "incomplete");
  assert.equal(byParent.UTL.enteredTotal, 20);
  assert.equal(byParent.HAZOP.status, "empty");
});

test("weights: the recorded weight is never read as a local weight (13.11 'never silently reinterpreted')", () => {
  const tree = buildWorkingPlanTree([node("n", { weightPercent: 100 })], []);
  const summary = parentWeightSummary(null, tree.roots);
  assert.deepEqual(summary.missing, ["N"]);
  assert.equal(summary.recordedAvailable, 1);
  assert.equal(summary.status, "incomplete");
  assert.equal(effectiveContributions(tree).get("n"), null);
});

test("effective contribution (W4): product of local weights; reproduces §26.5; absent is null, never 0", () => {
  const { workItems } = fixture();
  const tree = buildWorkingPlanTree(workItems, [
    activity("vdu-a20", { workItemId: "vdu", localWeightPercent: 40 }),
    activity("cdu-a10", { workItemId: "cdu" }),
  ]);
  const ew = effectiveContributions(tree);
  assert.equal(ew.get("rbi"), 10);
  assert.ok(Math.abs(ew.get("vdu") - 4) < 1e-12);
  assert.ok(Math.abs(ew.get("cdu") - 3.5) < 1e-12);
  assert.ok(Math.abs(ew.get("utl") - 2.5) < 1e-12);
  assert.ok(Math.abs(ew.get("vdu-a20") - 1.6) < 1e-12);
  assert.equal(ew.get("cdu-a10"), null);
  // Same figures as the engine's own effective weights where every weight is entered.
  const engine = effectiveWeights({ children: tree.roots.map((root) => ({
    kind: "node", id: root.id, localWeight: root.item.localWeightPercent,
    children: root.children.filter((c) => c.kind === "node").map((c) => ({
      kind: "node", id: c.id, localWeight: c.item.localWeightPercent, children: [],
    })),
  })) });
  for (const id of ["rbi", "vdu", "cdu", "utl", "hazop", "sil"]) {
    assert.ok(Math.abs(engine.get(id) - ew.get(id)) < 1e-12, id);
  }
});

/* ---------------------------- Weight decisions --------------------------- */

const weighted = (weights) =>
  buildWorkingPlanTree(
    [node("parent")],
    weights.map((w, i) => activity(`c${i}`, { workItemId: "parent", localWeightPercent: w ?? undefined, weightPercent: 30 }))
  );

test("decision: §26.5 proportional rescale of RBI with Utilities blank → VDU 53.333, CDU 46.667, UTL 0", () => {
  const tree = buildWorkingPlanTree(
    [node("rbi"), node("vdu", { parentWorkItemId: "rbi", localWeightPercent: 40, sortOrder: 1 }),
     node("cdu", { parentWorkItemId: "rbi", localWeightPercent: 35, sortOrder: 2 }),
     node("utl", { parentWorkItemId: "rbi", sortOrder: 3 })],
    []
  );
  const proposal = proposeWeightDecision("rbi", childrenOf(tree, "rbi"), "proportional_rescale");
  assert.equal(proposal.ok, true);
  assert.deepEqual(proposal.children.map((c) => [c.id, c.before, c.after]), [
    ["vdu", 40, 53.333], ["cdu", 35, 46.667], ["utl", null, 0],
  ]);
});

test("decision: results total EXACTLY 100.000, each within 0.001 of the engine's exact proposal", () => {
  for (const weights of [[1, 1, 1], [10, 20, 30, 15], [7, 7, 7, 7, 7, 7, 7], Array(23).fill(3.3), [0.001, 99.9]]) {
    const tree = weighted(weights);
    const proposal = proposeWeightDecision("parent", childrenOf(tree, "parent"), "proportional_rescale");
    assert.equal(proposal.ok, true, String(weights));
    const thousandths = proposal.children.reduce((sum, c) => sum + Math.round(c.after * 1000), 0);
    assert.equal(thousandths, 100000, String(weights));
    const exact = proposeNormalisation("parent", weights.map((w, i) => ({ id: `c${i}`, localWeight: w })), "proportional_rescale");
    for (const [index, child] of proposal.children.entries()) {
      assert.ok(Math.abs(child.after - exact.decision.after[index].localWeight) < 0.001, `${weights}: ${child.id}`);
      assert.equal(child.after, Math.round(child.after * 1000) / 1000);
    }
  }
});

test("decision: equal split only when no child weight is entered; 3 children → 33.334 / 33.333 / 33.333", () => {
  const blank = weighted([null, null, null]);
  const proposal = proposeWeightDecision("parent", childrenOf(blank, "parent"), "equal_split");
  assert.deepEqual(proposal.children.map((c) => c.after), [33.334, 33.333, 33.333]);
  const partly = weighted([50, null]);
  assert.deepEqual(proposeWeightDecision("parent", childrenOf(partly, "parent"), "equal_split"), {
    ok: false, reason: "Equal split applies only when no child weight is entered.",
  });
});

test("decision: nothing to normalise when weights already total 100%; rescale needs a weight above 0", () => {
  assert.equal(proposeWeightDecision("parent", childrenOf(weighted([60, 40]), "parent"), "proportional_rescale").ok, false);
  assert.equal(proposeWeightDecision("parent", childrenOf(weighted([0, null]), "parent"), "proportional_rescale").ok, false);
});

test("decision: adopt_recorded proposes the recorded weight only for children with no local weight", () => {
  const tree = weighted([null, 70, null]);
  const proposal = proposeWeightDecision("parent", childrenOf(tree, "parent"), "adopt_recorded");
  assert.deepEqual(proposal.children.map((c) => [c.id, c.before, c.after]), [["c0", null, 30], ["c2", null, 30]]);
  assert.deepEqual(weightDecisionPayload(proposal.children), [
    { kind: "activity", id: "c0", before: null, after: 30 },
    { kind: "activity", id: "c2", before: null, after: 30 },
  ]);
  assert.equal(proposeWeightDecision("parent", childrenOf(weighted([10, 90]), "parent"), "adopt_recorded").ok, false);
});

/* -------------------------------- Findings ------------------------------- */

test("findings: W1/W2, unattached, missing method, milestone shape and weight, recorded weights to review", () => {
  const tree = buildWorkingPlanTree(
    [node("ca", { localWeightPercent: 100 }), node("empty", { parentWorkItemId: "ca", localWeightPercent: 50 })],
    [
      activity("t", { workItemId: "ca", localWeightPercent: 30 }),
      activity("ms", { workItemId: "ca", isMilestone: true, localWeightPercent: 5,
                       plannedStartDate: "2026-11-01", plannedFinishDate: "2026-11-03" }),
      activity("loose", { localWeightPercent: 0, weightPercent: 12 }),
    ]
  );
  const findings = workingPlanFindings(tree, settings({ defaultEarningMethod: undefined }));
  const codes = findings.map((f) => `${f.severity}:${f.code}:${f.elementName}`);
  assert.ok(codes.includes("blocking:EMPTY_NODE:EMPTY"));
  assert.ok(codes.includes("blocking:W1_CHILD_TOTAL:CA"));            // 50 + 30 + 5 = 85
  assert.ok(!codes.some((c) => c.endsWith(":Project") && c.startsWith("blocking")), "100 + 0 = 100");
  assert.ok(codes.includes("blocking:ACTIVITY_UNATTACHED:LOOSE"));
  assert.ok(codes.includes("blocking:EARNING_METHOD_MISSING:T"));
  assert.ok(!codes.some((c) => c.includes("EARNING_METHOD_MISSING:MS")));
  assert.ok(codes.includes("blocking:MILESTONE_NOT_ZERO_DURATION:MS"));
  assert.ok(codes.includes("advisory:MILESTONE_CARRIES_WEIGHT:MS"));
  assert.ok(codes.includes("advisory:CONFIGURATION_INCOMPLETE:Project"));
  assert.ok(!codes.some((c) => c.includes("RECORDED_WEIGHT_UNREVIEWED")), "LOOSE already has a local weight");
});

test("findings: a project with no hierarchy may hold activities directly (no unattached finding)", () => {
  const tree = buildWorkingPlanTree([], [activity("a", { localWeightPercent: 100 })]);
  assert.equal(tree.hasHierarchy, false);
  assert.ok(!workingPlanFindings(tree, settings()).some((f) => f.code === "ACTIVITY_UNATTACHED"));
  assert.deepEqual(workingPlanFindings(buildWorkingPlanTree([], []), settings()), []);
});

/* ------------------------------- The adapter ------------------------------ */

/**
 * The 13.10 §26.5 engine fixture, written back as REAL Working Plan rows:
 * nodes as planning_work_items, leaves as planning_activities. Only
 * non-default methods are stored on the activity (Percent Complete comes from
 * the project default — inheritance is exercised), and every row carries a
 * misleading RECORDED weight the adapter must ignore.
 */
function rowsFrom(plan) {
  const workItems = [];
  const activities = [];
  const walk = (children, parentId) => {
    children.forEach((child, index) => {
      if (child.kind === "node") {
        workItems.push(node(child.id, {
          code: child.code ?? child.id, name: child.name, parentWorkItemId: parentId,
          localWeightPercent: child.localWeight, isControlAccount: Boolean(child.isControlAccount),
          sortOrder: index, weightPercent: 99,
        }));
        walk(child.children, child.id);
      } else {
        activities.push(activity(child.id, {
          code: child.code, name: child.name, workItemId: parentId,
          localWeightPercent: child.localWeight, weightPercent: 99,
          isMilestone: child.earningMethod === "milestone",
          earningMethod: child.earningMethod === "percent_complete" ? undefined : child.earningMethod,
          baselineStartDate: child.baseline?.start ?? undefined,
          baselineFinishDate: child.baseline?.finish ?? undefined,
          plannedStartDate: child.forecast?.start ?? undefined,
          plannedFinishDate: child.forecast?.finish ?? undefined,
          actualStartDate: child.actual?.start ?? undefined,
          actualFinishDate: child.actual?.finish ?? undefined,
          percentCompletePhysical: child.percentComplete ?? undefined,
        }));
      }
    });
  };
  walk(plan.children, undefined);
  return { workItems, activities };
}

function fixtureByActivity(plan) {
  const map = new Map();
  const walk = (children) => children.forEach((child) => {
    if (child.kind === "node") walk(child.children);
    else map.set(child.id, child);
  });
  walk(plan.children);
  return map;
}

function adapted() {
  const reference = worked265();
  const { workItems, activities } = rowsFrom(reference);
  const leaves = fixtureByActivity(reference);
  const result = toEnginePlanInput(workItems, activities, {
    projectId: reference.projectId,
    dataDate: DATA_DATE,
    workingWeek: WORKING_WEEK,
    projectDefaultEarningMethod: "percent_complete",
    originalBaselineFor: (row) => leaves.get(row.id).originalBaseline ?? null,
    isKeyMilestone: (row) => Boolean(leaves.get(row.id).isKeyMilestone),
  });
  return { reference, result, workItems, activities };
}

test("adapter: nodes and activities map to the engine shape — local weights, CA flag, resolved method, forecast, actuals, physical %", () => {
  const { result } = adapted();
  assert.equal(result.status, "ready", JSON.stringify(result.findings));
  const rbi = result.plan.children.find((child) => child.id === "rbi");
  assert.equal(rbi.kind, "node");
  assert.equal(rbi.localWeight, 10);
  assert.equal(rbi.isControlAccount, true);
  const vdu = rbi.children.find((child) => child.id === "vdu");
  assert.deepEqual(vdu.children.find((child) => child.id === "vdu-a20"), {
    kind: "activity", id: "vdu-a20", code: "VDU-A20", name: "Damage mechanisms & corrosion loops",
    localWeight: 40,
    earningMethod: "percent_complete",
    baseline: { start: "2026-10-08", finish: "2026-11-04" },
    originalBaseline: null,
    forecast: { start: null, finish: "2026-11-12" },
    actual: { start: "2026-10-08", finish: null },
    percentComplete: 60,
    isKeyMilestone: false,
  });
  const m10 = vdu.children.find((child) => child.id === "vdu-m10");
  assert.equal(m10.earningMethod, "milestone");
  assert.equal(m10.isKeyMilestone, true);
  assert.deepEqual(m10.originalBaseline, { finish: "2026-12-01" });
  assert.equal(result.plan.projectId, "project-265");
  assert.deepEqual(result.plan.workingWeek, WORKING_WEEK);
});

test("adapter + engine: real Working Plan rows reproduce the §26.5 worked example exactly, both paths agreeing", () => {
  const { reference, result } = adapted();
  const fromRows = calculatePlanPerformance(result.plan);
  const fromFixture = calculatePlanPerformance(reference);
  assert.equal(fromRows.status, "calculated", JSON.stringify(fromRows.issues ?? []));
  assert.equal(fromFixture.status, "calculated");
  const close = (actual, expected, label) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} vs ${expected}`);
  const expected = new Map(fromFixture.performance.elements.map((e) => [e.id, e]));
  for (const element of fromRows.performance.elements) {
    const want = expected.get(element.id);
    for (const key of ["localWeight", "effectiveWeight", "pv", "ev", "sv", "pvContribution", "evContribution"]) {
      close(element[key], want[key], `${element.id}.${key}`);
    }
    assert.equal(element.isControlAccount, want.isControlAccount, element.id);
    assert.equal(element.earningMethod, want.earningMethod, element.id);
  }
  // The stated §26.5 figures.
  const by = Object.fromEntries(fromRows.performance.elements.map((e) => [e.id, e]));
  close(by.vdu.pv, 68, "VDU PV");
  close(by.vdu.ev, 54, "VDU EV");
  close(by.rbi.pv, 50.4, "RBI PV");
  close(by.rbi.ev, 44.75, "RBI EV");
  close(by.rbi.pvContribution, 5.04, "RBI contribution");
  close(fromRows.performance.project.pv, 52.04, "Project PV");
  close(fromRows.performance.project.ev, 49.475, "Project EV");
  assert.ok(fromRows.performance.crossCheck.maxDifference < 1e-9, "two calculation paths, one answer");
});

test("adapter: never substitutes the recorded weight — a missing local weight reaches the engine as missing (W2)", () => {
  const result = toEnginePlanInput([node("n", { weightPercent: 100 })],
    [activity("a", { workItemId: "n", localWeightPercent: 100 })], {
      projectId: "p1", dataDate: DATA_DATE, workingWeek: WORKING_WEEK, projectDefaultEarningMethod: "percent_complete",
    });
  assert.equal(result.status, "ready");
  assert.equal(result.plan.children[0].localWeight, null);
  const calc = calculatePlanPerformance(result.plan);
  assert.equal(calc.status, "blocked");
  assert.ok(calc.issues.some((issue) => issue.code === "W2_MISSING_WEIGHT"));
});

test("adapter: blocks (never drops) an unattached activity or one with no earning method", () => {
  const unattached = toEnginePlanInput([node("n", { localWeightPercent: 100 })], [activity("a", { localWeightPercent: 100 })], {
    projectId: "p1", dataDate: DATA_DATE, workingWeek: WORKING_WEEK, projectDefaultEarningMethod: "percent_complete",
  });
  assert.equal(unattached.status, "blocked");
  assert.ok(unattached.findings.some((f) => f.code === "ACTIVITY_UNATTACHED"));
  const methodless = toEnginePlanInput([node("n", { localWeightPercent: 100 })],
    [activity("a", { workItemId: "n", localWeightPercent: 100 })],
    { projectId: "p1", dataDate: DATA_DATE, workingWeek: WORKING_WEEK });
  assert.equal(methodless.status, "blocked");
  assert.ok(methodless.findings.some((f) => f.code === "EARNING_METHOD_MISSING"));
});

test("adapter: PSM and Other Projects produce the same engine shape — the reporting-unit mapping never enters it", () => {
  const options = { projectId: "p1", dataDate: DATA_DATE, workingWeek: WORKING_WEEK, projectDefaultEarningMethod: "percent_complete" };
  const base = [node("n", { localWeightPercent: 100 })];
  const acts = [activity("a", { workItemId: "n", localWeightPercent: 100, baselineStartDate: "2026-10-01", baselineFinishDate: "2026-10-30" })];
  const psm = toEnginePlanInput([node("n", { localWeightPercent: 100, departmentId: "d", systemId: "s" })], acts, options);
  const other = toEnginePlanInput([node("n", { localWeightPercent: 100, structureNodeId: "u" })], acts, options);
  const plain = toEnginePlanInput(base, acts, options);
  assert.deepEqual(psm.plan, plain.plan);
  assert.deepEqual(other.plan, plain.plan);
});

test("adapter: the BLn window is pluggable; the default is the recorded (provisional) activity baseline", () => {
  assert.deepEqual(recordedActivityBaseline(activity("a", { baselineStartDate: "2026-01-01" })), {
    start: "2026-01-01", finish: null,
  });
  const result = toEnginePlanInput([], [activity("a", { localWeightPercent: 100 })], {
    projectId: "p1", dataDate: DATA_DATE, workingWeek: WORKING_WEEK, projectDefaultEarningMethod: "zero_hundred",
    baselineFor: () => ({ start: "2026-02-01", finish: "2026-02-10" }),
  });
  assert.deepEqual(result.plan.children[0].baseline, { start: "2026-02-01", finish: "2026-02-10" });
});

/* ------------------------------- Refusals -------------------------------- */

test("refusals: every 13.11 database tag maps to a sentence; unrelated failures fall through", () => {
  for (const tag of ["STALE", "REASON_REQUIRED", "INVALID_DECISION", "ONBOARDING_NOT_CHOSEN", "NOT_PLANNING_GOVERNED",
    "INVALID_CONFIGURATION", "NODE_NOT_MILESTONE", "NODE_ARCHIVED", "ACTIVITY_DETACH", "REPORTING_UNIT_FAMILY",
    "REPORTING_UNIT_ARCHIVED", "REPORTING_UNIT_INCOMPLETE", "REPORTING_UNIT_NOT_IN_PROJECT"]) {
    const message = workingPlanRefusalMessage({ message: `[${tag}] database wording` });
    assert.ok(message && !message.includes("["), tag);
  }
  assert.match(workingPlanRefusalMessage({ message: 'violates check constraint "planning_activities_kind_method_consistent"' }), /Milestone method/);
  assert.equal(workingPlanRefusalMessage({ message: "[PROJECT_ARCHIVED] read-only" }), undefined);
  assert.equal(workingPlanRefusalMessage({ message: "something else" }), undefined);
});

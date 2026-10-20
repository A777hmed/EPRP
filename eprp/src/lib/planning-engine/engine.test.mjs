import assert from "node:assert/strict";
import test from "node:test";

import {
  calculatePlanPerformance,
  effectiveWeights,
  figureValue,
  PLANNING_ENGINE_VERSION,
} from "./index.ts";
import { clone, DATA_DATE, findInput, worked265, WORKING_WEEK } from "./fixtures.mjs";

/* Phase 13.10 — Planning Engine core. Acceptance: `docs/02` §26.5 is
   reproduced exactly, and both calculation paths agree. */

const EPS = 1e-9;
const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < EPS, `${message ?? ""} expected ${expected}, got ${actual}`);

function calculated(plan) {
  const result = calculatePlanPerformance(plan);
  assert.equal(result.status, "calculated", JSON.stringify(result.issues ?? []));
  return result.performance;
}

function byId(performance) {
  return new Map(performance.elements.map((element) => [element.id, element]));
}

/* ----------------------------- §26.5 fixture ----------------------------- */

test("§26.5: effective weights are calculated from local weights, never typed", () => {
  const weights = effectiveWeights(worked265());
  close(weights.get("rbi"), 10);
  close(weights.get("vdu"), 4.0);
  close(weights.get("cdu"), 3.5);
  close(weights.get("utl"), 2.5);
  close(weights.get("vdu-a10"), 1.2);
  close(weights.get("vdu-a20"), 1.6);
  close(weights.get("vdu-a30"), 1.2);
  close(weights.get("vdu-m10"), 0);
  close(weights.get("cdu-a10"), 1.4);
  close(weights.get("cdu-a20"), 2.1);
  close(weights.get("utl-a10"), 0.5);
  close(weights.get("utl-a20"), 2.0);
});

test("§26.5: the effective weights of all leaves sum to 100%", () => {
  const plan = worked265();
  const weights = effectiveWeights(plan);
  const leaves = calculated(plan).elements.filter((element) => element.kind === "activity");
  close(leaves.reduce((sum, leaf) => sum + weights.get(leaf.id), 0), 100);
});

test("§26.5: activity PV / EV and contributions match the worked example row by row", () => {
  const rows = byId(calculated(worked265()));
  const expected = {
    "vdu-a10": [100, 100, 1.2, 1.2],
    "vdu-a20": [80, 60, 1.28, 0.96],
    "vdu-a30": [20, 0, 0.24, 0],
    "vdu-m10": [0, 0, 0, 0],
    "cdu-a10": [100, 100, 1.4, 1.4],
    "cdu-a20": [20, 15, 0.42, 0.315],
    "utl-a10": [100, 100, 0.5, 0.5],
    "utl-a20": [0, 5, 0, 0.1],
  };
  for (const [id, [pv, ev, pvContribution, evContribution]] of Object.entries(expected)) {
    const row = rows.get(id);
    close(row.pv, pv, `${id} PV`);
    close(row.ev, ev, `${id} EV`);
    close(row.pvContribution, pvContribution, `${id} PV contribution`);
    close(row.evContribution, evContribution, `${id} EV contribution`);
  }
});

test("§26.5: node roll-up — PV, EV, SV and SPI — matches the worked example", () => {
  const rows = byId(calculated(worked265()));
  const expected = {
    vdu: [68, 54, -14, 0.79, 2.72, 2.16],
    cdu: [52, 49, -3, 0.94, 1.82, 1.715],
    utl: [20, 24, 4, 1.2, 0.5, 0.6],
    rbi: [50.4, 44.75, -5.65, 0.89, 5.04, 4.475],
    hazop: [70, 66, -4, 0.94, 35, 33],
    sil: [30, 30, 0, 1.0, 12, 12],
  };
  for (const [id, [pv, ev, sv, spi, pvContribution, evContribution]] of Object.entries(expected)) {
    const row = rows.get(id);
    close(row.pv, pv, `${id} PV`);
    close(row.ev, ev, `${id} EV`);
    close(row.sv, sv, `${id} SV`);
    assert.equal(row.spi.state, "value");
    assert.equal(row.spi.value.toFixed(2), spi.toFixed(2), `${id} SPI`);
    close(row.pvContribution, pvContribution, `${id} PV contribution`);
    close(row.evContribution, evContribution, `${id} EV contribution`);
  }
});

test("§26.5: project PV 52.04, EV 49.475, SV −2.565, SPI 0.95", () => {
  const { project } = calculated(worked265());
  close(project.pv, 52.04);
  close(project.ev, 49.475);
  close(project.sv, -2.565);
  assert.equal(project.spi.state, "value");
  assert.equal(project.spi.value.toFixed(2), "0.95");
  close(project.spi.value, 49.475 / 52.04);
});

test("§26.5: two calculation paths, one answer", () => {
  const { crossCheck, project } = calculated(worked265());
  close(crossCheck.levelByLevel.pv, crossCheck.effectiveWeights.pv);
  close(crossCheck.levelByLevel.ev, crossCheck.effectiveWeights.ev);
  close(crossCheck.levelByLevel.pv, project.pv);
  assert.ok(crossCheck.maxDifference < EPS);
});

test("§26.5: RBI contributes 5.04 points of PV both ways", () => {
  const rows = byId(calculated(worked265()));
  close(rows.get("rbi").pvContribution, 10 * 50.4 / 100);
  close(rows.get("vdu").pvContribution + rows.get("cdu").pvContribution + rows.get("utl").pvContribution, 5.04);
});

test("§26.5: the zero-weight milestone does not move SPI", () => {
  const withMilestoneAchieved = worked265();
  findInput(withMilestoneAchieved, "vdu-m10").actual = { finish: "2026-10-30" };
  const a = calculated(worked265()).project;
  const b = calculated(withMilestoneAchieved).project;
  close(a.pv, b.pv);
  close(a.ev, b.ev);
});

test("structure: elements come out in pre-order with depth, parent and Control Account flags", () => {
  const performance = calculated(worked265());
  const ids = performance.elements.map((element) => element.id);
  assert.deepEqual(ids.slice(0, 6), ["rbi", "vdu", "vdu-a10", "vdu-a20", "vdu-a30", "vdu-m10"]);
  const rows = byId(performance);
  assert.equal(rows.get("rbi").depth, 1);
  assert.equal(rows.get("rbi").parentId, null);
  assert.equal(rows.get("vdu-a20").parentId, "vdu");
  assert.equal(rows.get("vdu-a20").depth, 3);
  assert.equal(rows.get("rbi").isControlAccount, true);
  assert.equal(rows.get("vdu").isControlAccount, false);
  assert.equal(rows.get("vdu-a20").earningMethod, "percent_complete");
  assert.equal(rows.get("rbi").earningMethod, null);
});

/* -------------------------------- SPI ----------------------------------- */

test("SPI: N/A when PV = 0, with a semantic reason — never 0, never 1", () => {
  const plan = {
    projectId: "p",
    dataDate: "2026-01-01",
    workingWeek: WORKING_WEEK,
    children: [
      {
        kind: "activity",
        id: "a",
        name: "Future work",
        localWeight: 100,
        earningMethod: "percent_complete",
        baseline: { start: "2026-06-01", finish: "2026-06-30" },
      },
    ],
  };
  const { project } = calculated(plan);
  assert.equal(project.pv, 0);
  assert.equal(project.ev, 0);
  assert.deepEqual(project.spi, { state: "not_applicable", reason: "pv_zero" });
  assert.equal(figureValue(project.spi), null);
});

test("SPI: work started early with PV = 0 still has no SPI (EV > 0 is reported, the ratio is not)", () => {
  const rows = byId(calculated(worked265()));
  const utilitiesA20 = rows.get("utl-a20");
  assert.equal(utilitiesA20.pv, 0);
  assert.equal(utilitiesA20.ev, 5);
  assert.equal(utilitiesA20.spi.state, "not_applicable");
});

/* ------------------------- Provenance / immutability ---------------------- */

test("provenance: every calculation records the engine version, project and Data Date", () => {
  const performance = calculated(worked265());
  assert.equal(performance.engineVersion, PLANNING_ENGINE_VERSION);
  assert.match(PLANNING_ENGINE_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(performance.projectId, "project-265");
  assert.equal(performance.dataDate, DATA_DATE);
});

test("immutability: a calculated result is frozen, deeply", () => {
  const performance = calculated(worked265());
  assert.ok(Object.isFrozen(performance));
  assert.ok(Object.isFrozen(performance.project));
  assert.ok(Object.isFrozen(performance.elements[0]));
  assert.throws(() => {
    performance.project.pv = 99;
  }, TypeError);
});

test("draft vs published: editing the Working Plan after a calculation never changes the frozen result", () => {
  const draft = worked265();
  const published = calculated(draft);
  const before = JSON.stringify(published);

  // A draft edit: VDU-A20 progresses to 90%.
  findInput(draft, "vdu-a20").percentComplete = 90;
  findInput(draft, "rbi").name = "RBI (renamed in draft)";

  assert.equal(JSON.stringify(published), before, "the published result must not move");
  const recalculated = calculated(draft);
  assert.ok(recalculated.project.ev > published.project.ev, "only a new calculation sees the draft");
});

test("determinism: the same plan always produces the same figures", () => {
  assert.equal(JSON.stringify(calculated(worked265())), JSON.stringify(calculated(clone(worked265()))));
});

test("purity: the input plan is never modified by a calculation", () => {
  const plan = worked265();
  const before = JSON.stringify(plan);
  calculated(plan);
  assert.equal(JSON.stringify(plan), before);
});

/* --------------------------- PSM and Other Project ----------------------- */

/**
 * `02` §26.3 H6: Planning and Project Structure are separate trees. A node may
 * map to a reporting unit — Department / System / Program & Study on PSM, a
 * Project Structure unit on Other Projects — and the mapping never changes
 * the hierarchy or its weights. The engine has no project-type input at all.
 */
function withMapping(plan, mapping) {
  const copy = clone(plan);
  const walk = (children) => {
    for (const child of children) {
      if (mapping[child.id]) child.reportingUnit = mapping[child.id];
      if (child.kind === "node") walk(child.children);
    }
  };
  walk(copy.children);
  return copy;
}

test("PSM project: Department / System / Program & Study mapping does not change any figure", () => {
  const psm = withMapping(worked265(), {
    rbi: { kind: "department", departmentId: "dept-inspection" },
    vdu: { kind: "system", departmentId: "dept-inspection", systemId: "sys-vdu" },
    "vdu-a20": { kind: "program_study", departmentId: "dept-inspection", programStudyId: "ps-rbi" },
    hazop: { kind: "department", departmentId: "dept-process-safety" },
  });
  psm.projectId = "psm-project";
  const base = calculated(worked265());
  const mapped = calculated(psm);
  assert.deepEqual(
    mapped.elements.map(({ id, pv, ev, effectiveWeight }) => [id, pv, ev, effectiveWeight]),
    base.elements.map(({ id, pv, ev, effectiveWeight }) => [id, pv, ev, effectiveWeight])
  );
  assert.equal(mapped.projectId, "psm-project");
});

test("Other Project: a configured structure-unit mapping does not change any figure", () => {
  const other = withMapping(worked265(), {
    rbi: { kind: "structure_unit", unitId: "unit-area-1" },
    cdu: { kind: "structure_unit", unitId: "unit-area-2" },
    sil: { kind: "structure_unit", unitId: "unit-area-3" },
  });
  other.projectId = "other-project";
  const base = calculated(worked265());
  const mapped = calculated(other);
  close(mapped.project.pv, base.project.pv);
  close(mapped.project.ev, base.project.ev);
  assert.equal(mapped.elements.length, base.elements.length);
});

test("PSM and Other: projects with different hierarchy depths use the same engine and SPI definition", () => {
  // A two-level Other Project (Area → activities) next to the three-level §26.5 plan.
  const otherFlat = {
    projectId: "other-flat",
    dataDate: DATA_DATE,
    workingWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    children: [
      {
        kind: "node",
        id: "area-1",
        name: "Area 1",
        localWeight: 60,
        children: [
          { kind: "activity", id: "x1", name: "Walkdown", localWeight: 50, earningMethod: "zero_hundred", baseline: { start: "2026-10-01", finish: "2026-10-10" }, actual: { start: "2026-10-01", finish: "2026-10-09" } },
          { kind: "activity", id: "x2", name: "Report", localWeight: 50, earningMethod: "fifty_fifty", baseline: { start: "2026-10-20", finish: "2026-11-20" }, actual: { start: "2026-10-22" } },
        ],
      },
      { kind: "activity", id: "x3", name: "Close-out", localWeight: 40, earningMethod: "milestone", baseline: { finish: "2026-12-01" } },
    ],
  };
  const { project } = calculated(otherFlat);
  // Area 1: PV 0.5×100 + 0.5×50 = 75; EV 0.5×100 + 0.5×50 = 75. Project = 0.6 × 75.
  close(project.pv, 45);
  close(project.ev, 45);
  close(project.spi.value, 1);
});

/* ------------------------------ Null safety ------------------------------ */

test("null safety: absent optional fields are accepted and never read as values", () => {
  const plan = {
    projectId: "p",
    dataDate: "2026-10-31",
    workingWeek: WORKING_WEEK,
    children: [
      {
        kind: "activity",
        id: "a",
        name: "Bare activity",
        code: null,
        localWeight: 100,
        earningMethod: "zero_hundred",
        baseline: { start: "2026-10-01", finish: "2026-10-20" },
        originalBaseline: null,
        forecast: null,
        actual: null,
        percentComplete: null,
      },
    ],
  };
  const performance = calculated(plan);
  assert.equal(performance.elements[0].code, null);
  assert.equal(performance.project.pv, 100);
  assert.equal(performance.project.ev, 0);
  assert.equal(performance.project.spi.value, 0);
});

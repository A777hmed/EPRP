import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PLANNING_ENGINE_VERSION } from "../../../lib/planning-engine/engine.ts";
import { buildBaselineRequest, buildPublishPayload } from "./publish-plan.ts";
import { planningRefusal } from "./publish-refusals.ts";
import {
  approvedBaselines,
  bundleOf,
  captureOf,
  DATA_DATE,
  fixtureRows,
  uuidFor,
} from "./fixture-26-5.mjs";

// Phase 13.12 — the ONE publish orchestration (docs/02 §26.25 D-A): Working
// Plan rows → 13.11 adapter → validation → 13.10 engine → v2 payload. The
// runtime SQL suite 133 feeds the payload this produces into the real
// trusted writer (`publish_planning_snapshot_v2`).

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const close = (actual, expected, label, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} ≠ ${expected}`);

const ready = (bundle = bundleOf(fixtureRows("current"), { baselines: approvedBaselines() }), request = { dataDate: DATA_DATE }) => {
  const result = buildPublishPayload(bundle, request);
  assert.equal(result.status, "ready", JSON.stringify(result.problems ?? []));
  return result;
};

/* ------------------------------ §26.5 exactly ------------------------------ */

test("§26.5 is reproduced through the publish path: project, node and activity figures", () => {
  const { payload, summary } = ready();
  close(payload.project.pv, 52.04, "project PV", 1e-6);
  close(payload.project.ev, 49.475, "project EV", 1e-6);
  close(payload.project.sv, -2.565, "project SV", 1e-6);
  assert.ok(Math.abs(payload.project.spi - 0.95) < 0.005, `SPI ${payload.project.spi}`);
  assert.equal(payload.project.spi_reason, null);
  const node = (key) => payload.nodes.find((n) => n.work_item_id === uuidFor(key));
  close(node("rbi").pv, 50.4, "RBI PV", 1e-6);
  close(node("rbi").ev, 44.75, "RBI EV", 1e-6);
  close(node("rbi").pv_contribution, 5.04, "RBI PV contribution", 1e-6);
  close(node("vdu").pv, 68, "VDU PV", 1e-6);
  close(node("vdu").effective_weight, 4, "VDU effective weight", 1e-9);
  const activity = (key) => payload.activities.find((a) => a.activity_id === uuidFor(key));
  close(activity("vdu-a20").pv, 80, "VDU-A20 PV (16 of 20 working days)", 1e-6);
  close(activity("vdu-a20").ev, 60, "VDU-A20 EV", 1e-6);
  close(activity("utl-a20").pv, 0, "UTL-A20 PV (BLn start not reached)", 1e-9);
  close(activity("utl-a20").ev, 5, "UTL-A20 EV (started early)", 1e-9);
  // Both calculation paths agree (§26.5 "two calculation paths, one answer").
  assert.ok(payload.cross_check_max_difference < 1e-6);
  assert.equal(payload.coverage_percent, 100);
  assert.equal(summary.nodeCount, 6);
  // VDU 4 · CDU 2 · Utilities 2 · HAZOP 1 · SIL 1.
  assert.equal(summary.activityCount, 10);
});

test("the milestone is frozen separately: +14 days vs BLn, +28 vs BL0, never blended", () => {
  const { payload } = ready();
  const milestone = payload.milestones.find((m) => m.activity_id === uuidFor("vdu-m10"));
  assert.equal(payload.milestones.length, 1);
  assert.equal(milestone.bln_date, "2026-12-15");
  assert.equal(milestone.bl0_date, "2026-12-01");
  assert.equal(milestone.forecast_date, "2026-12-29");
  assert.equal(milestone.slip_vs_bln, 14);
  assert.equal(milestone.slip_vs_bl0, 28);
  assert.equal(milestone.status, "upcoming");
  // Zero weight: it does not move PV / EV.
  close(payload.activities.find((a) => a.activity_id === uuidFor("vdu-m10")).effective_weight, 0, "VDU-M10 weight");
});

test("provenance frozen: engine version, Data Date, BL0 and BLn, the Working Plan identity", () => {
  const { payload } = ready();
  assert.equal(payload.engine_version, PLANNING_ENGINE_VERSION);
  assert.equal(payload.data_date, DATA_DATE);
  assert.equal(payload.bl0_baseline_id, uuidFor("bl0"));
  assert.equal(payload.bln_baseline_id, uuidFor("bl1"));
  assert.equal(payload.fingerprint, "fp-26-5");
  // Engine inputs are the STORED values (the writer compares them to the Working Plan).
  const a20 = payload.activities.find((a) => a.activity_id === uuidFor("vdu-a20"));
  assert.deepEqual(
    [a20.local_weight, a20.percent_complete, a20.forecast_finish, a20.actual_start, a20.bln_start, a20.bln_finish],
    [40, 60, "2026-11-12", "2026-10-08", "2026-10-08", "2026-11-04"]
  );
  // Schedule-condition inputs (D-C): forecast finish vs BLn finish, BL0 finish.
  assert.equal(payload.finish.bln_finish, "2026-12-15");
  assert.equal(payload.finish.bl0_finish, "2026-12-01");
  assert.equal(payload.finish.forecast_finish, "2026-12-29");
});

test("the forecast curve opens at the earned point (EV at the Data Date); no baseline curve is borrowed", () => {
  const { payload } = ready();
  assert.equal(payload.forecast_curve_reason, null);
  assert.equal(payload.forecast_curve[0].date, DATA_DATE);
  close(payload.forecast_curve[0].value, payload.project.ev, "earned point", 1e-9);
  close(payload.forecast_curve.at(-1).value, 100, "forecast completes", 1e-6);
});

/* ------------------------------ Refusals ----------------------------------- */

test("refused: no approved BL0 — nothing reaches the engine", () => {
  const result = buildPublishPayload(bundleOf(fixtureRows("current")), { dataDate: DATA_DATE });
  assert.equal(result.status, "refused");
  assert.equal(result.problems[0].code, "NO_APPROVED_BL0");
});

test("refused: new scope not in the current approved baseline (no artificial zero PV)", () => {
  const rows = fixtureRows("current");
  rows.activities.push({ ...rows.activities[0], id: "00000000-0000-4000-d265-999999999999", code: "VDU-A40", name: "New scope" });
  const result = buildPublishPayload(bundleOf(rows, { baselines: approvedBaselines() }), { dataDate: DATA_DATE });
  assert.equal(result.status, "refused");
  assert.equal(result.problems[0].code, "NEW_SCOPE_NOT_BASELINED");
  assert.match(result.problems[0].message, /VDU-A40.*re-baseline/);
});

test("refused: no formal schedule, missing Data Date, invalid weights, unmeasured started work", () => {
  const noFormal = buildPublishPayload(
    bundleOf(fixtureRows("current"), { baselines: approvedBaselines(), onboardingMode: "no_formal_schedule" }),
    { dataDate: DATA_DATE }
  );
  assert.equal(noFormal.problems[0].code, "NO_FORMAL_SCHEDULE");

  assert.equal(buildPublishPayload(bundleOf(fixtureRows("current"), { baselines: approvedBaselines() }), { dataDate: "" }).problems[0].code, "DATA_DATE_REQUIRED");

  const weights = fixtureRows("current");
  weights.activities.find((a) => a.id === uuidFor("utl-a20")).local_weight_percent = 60; // Utilities totals 80
  const weightResult = buildPublishPayload(bundleOf(weights, { baselines: approvedBaselines() }), { dataDate: DATA_DATE });
  assert.equal(weightResult.status, "refused");
  assert.ok(weightResult.problems.some((p) => p.code === "W1_CHILD_TOTAL"));

  const unmeasured = fixtureRows("current");
  unmeasured.activities.find((a) => a.id === uuidFor("cdu-a20")).percent_complete_physical = null;
  const c2 = buildPublishPayload(bundleOf(unmeasured, { baselines: approvedBaselines() }), { dataDate: DATA_DATE });
  assert.ok(c2.problems.some((p) => p.code === "C2_UNMEASURED_START"));
});

test("refusals read as sentences — never null, undefined or database text", () => {
  for (const result of [
    buildPublishPayload(bundleOf(fixtureRows("current")), { dataDate: DATA_DATE }),
    buildPublishPayload(bundleOf(fixtureRows("current"), { baselines: approvedBaselines(), onboardingMode: "no_formal_schedule" }), { dataDate: DATA_DATE }),
  ]) {
    for (const problem of result.problems) {
      assert.match(problem.message, /^[A-Z].*\.$/);
      assert.doesNotMatch(problem.message, /null|undefined|\bSQL|violates|\[/);
    }
  }
  assert.deepEqual(planningRefusal({ message: "[SELF_APPROVAL] You cannot decide your own baseline request." }, "fallback"),
    { code: "SELF_APPROVAL", message: "You cannot decide your own baseline request." });
  assert.equal(planningRefusal({ message: 'duplicate key value violates unique constraint "x"', code: "23505" }, "Try again.").message, "Try again.");
  assert.equal(planningRefusal({ message: "permission denied for function x", code: "42501" }, "Try again.").code, "NOT_AUTHORIZED");
});

/* --------------------------- PSM / Other mapping ---------------------------- */

test("one engine, one payload: only the frozen reporting-unit mapping differs (PSM vs Other)", () => {
  const psm = ready(bundleOf(fixtureRows("current", { mapping: { rbi: { department_id: uuidFor("project") } } }), { baselines: approvedBaselines() })).payload;
  const other = ready(bundleOf(fixtureRows("current", { mapping: { hazop: { structure_node_id: uuidFor("project") } } }), { baselines: approvedBaselines(), family: "other" })).payload;
  // PSM: RBI's department is inherited by its work.
  assert.equal(psm.activities.find((a) => a.activity_id === uuidFor("vdu-a20")).department_id, uuidFor("project"));
  assert.equal(psm.activities.find((a) => a.activity_id === uuidFor("hazop-a10")).department_id, null);
  // Other: HAZOP's structure unit is inherited by its activity.
  assert.equal(other.activities.find((a) => a.activity_id === uuidFor("hazop-a10")).structure_node_id, uuidFor("project"));
  // Same figures either way.
  assert.equal(psm.project.pv, other.project.pv);
  assert.equal(psm.project.ev, other.project.ev);
});

/* ------------------------------ Baseline request --------------------------- */

test("baseline request: the engine's baseline curve of the dates the database captures", () => {
  const original = buildBaselineRequest(bundleOf(fixtureRows("bl0")), "2026-08-15");
  assert.equal(original.status, "ready");
  assert.equal(original.kind, "original");
  assert.equal(original.engineVersion, PLANNING_ENGINE_VERSION);
  close(original.curve.at(-1).value, 100, "complete curve", 1e-6);
  assert.equal(original.curve[0].value, 0);
  const rebaseline = buildBaselineRequest(bundleOf(fixtureRows("bl1"), { baselines: approvedBaselines().slice(0, 1) }), "2026-09-15");
  assert.equal(rebaseline.kind, "rebaseline");
  // The capture the fixture models is exactly the database's: a milestone is one date.
  const captured = captureOf(fixtureRows("bl0")).activities.find((a) => a.id === uuidFor("vdu-m10"));
  assert.deepEqual([captured.start, captured.finish], ["2026-12-01", "2026-12-01"]);
});

test("baseline request refused without dates, and for a no-formal-schedule project", () => {
  const rows = fixtureRows("bl0");
  rows.activities[0].planned_finish_date = null;
  const missing = buildBaselineRequest(bundleOf(rows), "2026-08-15");
  assert.equal(missing.status, "refused");
  assert.equal(missing.problems[0].code, "BASELINE_DATES_MISSING");
  assert.equal(buildBaselineRequest(bundleOf(fixtureRows("bl0"), { onboardingMode: "no_formal_schedule" }), "2026-08-15").problems[0].code, "NO_FORMAL_SCHEDULE");
});

/* --------------------------- Boundaries (source) ---------------------------- */

test("one engine implementation: the orchestration calls the 13.10 engine and the 13.11 adapter, and computes no figure", () => {
  const plan = read("./publish-plan.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.match(plan, /calculatePlanPerformance\(plan\)/);
  assert.match(plan, /toEnginePlanInput\(workItems, activities, \{/);
  assert.match(plan, /forecastCurve\(plan, \{ reportingDay: pre\.reportingDay \}\)/);
  // No arithmetic on PV / EV: every figure is copied from the engine result.
  assert.doesNotMatch(plan, /\.pv\s*[-+*/]|\.ev\s*[-+*/]|[-+*/]\s*\w+\.pv\b|[-+*/]\s*\w+\.ev\b/);
});

test("the browser never sends a figure: the action re-derives the user, reads as them, and calls the server-only writer", () => {
  const action = read("./actions.ts");
  assert.match(action, /^"use server";/);
  assert.match(action, /const user = await getAuthenticatedUser\(\);/);
  assert.match(action, /server\.rpc\("planning_publish_inputs", \{ p_project: projectId \}\)/);
  // The writer names the caller re-derived above (publishDeps(user.id) → p_actor).
  assert.match(action, /admin\.rpc\("publish_planning_snapshot_v2", \{\s*p_actor: actorId,/);
  assert.match(action, /submitPublish\(await publishDeps\(user\.id\), input\)/);
  assert.match(action, /admin\.rpc\("request_planning_baseline", \{\s*p_actor: user\.id,/);
  assert.match(action, /p_confirm_setup_control: confirmSetupControl,/);
  assert.match(read("./publish-context.ts"), /deps\.write\(input\.projectId, plan\.payload, input\.confirmSetupControl === true\)/);
  // The input type carries no figure.
  const inputType = action.slice(action.indexOf("export async function publishPlanningSnapshotV2"), action.indexOf("}): Promise"));
  assert.doesNotMatch(inputType, /\bpv\b|\bev\b|\bspi\b|payload/i);
});

test("D-B compatibility bridge: v2 snapshots answer with frozen figures; legacy keep the legacy formula", async () => {
  const { rollupFromFrozenEngine, computeRollupFromActivities } = await import("../../../lib/planning-rollup.ts");
  const frozen = rollupFromFrozenEngine({ pv: 52.04, ev: 49.475, sv: -2.565, spi: 0.9507, coveragePercent: 100 });
  assert.deepEqual(frozen, { plannedProgress: 52.04, actualProgress: 49.475, variance: -2.565, plannedValue: null, earnedValue: null, spi: 0.9507, coveragePercent: 100 });
  // The legacy formula is unchanged for legacy snapshots.
  assert.equal(computeRollupFromActivities([{ weightPercent: 50, percentCompletePlanned: 20, percentCompletePhysical: 10 }]).plannedProgress, 20);
  const service = read("../../../services/planning-rollup-service.ts");
  assert.match(service, /if \(snapshot\.v2\) return rollupFromFrozenEngine\(snapshot\.v2\);\s*if \(snapshot\.sourceOpeningPositionId\)/);
  const sql = read("../../../../supabase/migrations/20261025090100_v2_compatibility_rollup.sql");
  assert.match(sql, /where ls\.source_opening_position_id is null and ls\.engine_version is null/);
  assert.match(sql, /ls\.project_pv as planned_progress, ls\.project_ev as actual_progress, ls\.project_sv as variance/);
});

test("no screen-specific consumer rewiring: Dashboard, Weekly, Monthly, Executive and Calendar do not touch the engine or v2 tables", async () => {
  const { readdirSync } = await import("node:fs");
  for (const dir of ["dashboard", "weekly-reports", "monthly-reports", "executive-reports", "calendar"]) {
    const files = readdirSync(new URL(`../../${dir}/`, import.meta.url), { recursive: true })
      .map(String).filter((name) => /\.(ts|tsx)$/.test(name));
    for (const name of files) {
      const source = read(`../../${dir}/${name}`);
      assert.doesNotMatch(source, /planning-engine|planning_snapshot_nodes|planning_snapshot_milestones|publish-plan|planning-publish/, `${dir}/${name}`);
    }
  }
});

/* ---------------------- Runtime suite and UI contracts ---------------------- */

test("the runtime SQL suite 133 feeds exactly the payload the real orchestration produces (no drift)", async () => {
  const { BEGIN, END, generatedFixtureSql } = await import("./sql-fixture.mjs");
  const suite = read("../../../../scripts/p0-validation/133_runtime_13_12_snapshot_v2.sql");
  const block = suite.slice(suite.indexOf(BEGIN), suite.indexOf(END) + END.length);
  assert.ok(block.length > BEGIN.length, "generated block present");
  assert.equal(block, generatedFixtureSql(), "regenerate with scripts/p0-validation/gen_133_fixture.mjs");
});

test("snapshot identity: engine (v2) · legacy · declared, read from the row — never guessed", async () => {
  const { mapSnapshot } = await import("../../../services/planning-row-mappers.ts");
  const base = { id: "s", project_id: "p", version: 1, source_import_batch_id: null, source_opening_position_id: null, baseline_id: null,
    is_opening_snapshot: false, label: null, data_date: "2026-10-31", snapshot_data: {}, published_by_contact_id: null, published_at: "2026-10-31T10:00:00Z" };
  const nulls = Object.fromEntries(["engine_version", "published_by_user_id", "bl0_baseline_id", "bln_baseline_id", "source_kind",
    "working_plan_fingerprint", "configuration_updated_at", "edits_since_source", "edits_high_water_at", "project_pv", "project_ev",
    "project_sv", "project_spi", "project_spi_reason", "coverage_percent", "cross_check_max_difference", "bl0_finish_date",
    "bln_finish_date", "forecast_finish_date", "forecast_curve_reason", "schedule_condition", "advisories"].map((key) => [key, null]));
  assert.equal(mapSnapshot({ ...base, ...nulls }).calculation, "legacy");
  assert.equal(mapSnapshot({ ...base, ...nulls }).v2, undefined);
  assert.equal(mapSnapshot({ ...base, ...nulls, is_opening_snapshot: true }).calculation, "declared");
  const v2 = mapSnapshot({ ...base, ...nulls, engine_version: "1.0.0", bl0_baseline_id: "b0", bln_baseline_id: "b1", source_kind: "manual",
    working_plan_fingerprint: "fp", project_pv: "52.0400", project_ev: "49.4750", project_sv: "-2.5650", project_spi: null,
    project_spi_reason: "pv_zero", coverage_percent: "100", schedule_condition: "not_evaluated" });
  assert.equal(v2.calculation, "engine");
  assert.deepEqual([v2.v2.pv, v2.v2.ev, v2.v2.sv, v2.v2.spi, v2.v2.spiReason, v2.v2.scheduleCondition], [52.04, 49.475, -2.565, null, "pv_zero", "not_evaluated"]);
});

test("Baselines & Snapshots: requests and publishes through the server actions; only an Opening Position uses the legacy RPC", () => {
  const panel = read("../components/planning/baselines-snapshots-panel.tsx");
  assert.match(panel, /import \{\s*preparePlanningPublish,\s*publishPlanningSnapshotV2,\s*requestPlanningBaseline,\s*\} from "\.\.\/\.\.\/planning-publish\/actions";/);
  assert.equal((panel.match(/planningService\.publishSnapshot\(/g) ?? []).length, 1);
  assert.match(panel, /planningService\.publishSnapshot\(\{\s*projectId: project\.id,\s*openingPositionId: openingPosition\.id,/);
  assert.doesNotMatch(panel, /createBaseline|from\("planning_snapshots"\)\.insert/);
  // The decision UI: never the requester; the first BL0 asks for the setup-control confirmation.
  assert.match(panel, /baseline\.revisionStatus === "requested" && identity\.isGlobalAuthority && !own/);
  assert.match(panel, /You cannot approve your own baseline request\./);
  assert.match(panel, /confirmSetupControl: firstAnchor && anchorConfirmed,/);
  // Legacy captures and v2 snapshots are named for what they are.
  assert.match(panel, /legacy: \{ label: "Legacy capture — not an approved baseline"/);
  assert.match(panel, /Schedule condition: \{SCHEDULE_CONDITION_NOT_EVALUATED\}/);
});

test("Superseded by BL0: Planned Start / Finish are shown superseded once BL0 is approved, nowhere else", async () => {
  const setup = read("../setup-amendments.ts");
  assert.match(setup, /if \(supersededByBl0 && entry\.futureClass === "superseded" && entry\.futureSlice === "13\.12"\) return "superseded";/);
  const ui = read("../components/governance/setup-governance-ui.tsx");
  assert.match(ui, /Superseded by the approved original baseline \(BL0\)/);
  assert.match(read("../components/setup/project-setup-view.tsx"), /supersededByBl0: Boolean\(controlState\.bl0ApprovedAt\),/);
  const service = read("../../../services/setup-governance-service.ts");
  assert.match(service, /\.eq\("revision_status", "approved"\)\.eq\("revision_number", 0\)/);
});

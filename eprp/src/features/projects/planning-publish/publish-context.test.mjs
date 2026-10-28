import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PLANNING_ENGINE_VERSION } from "../../../lib/planning-engine/engine.ts";
import {
  isStalePublishRefusal,
  preparePublish,
  publishContextOf,
  publishContextProblem,
  STALE_PLAN_MESSAGE,
  submitPublish,
} from "./publish-context.ts";
import { approvedBaselines, bundleOf, captureOf, DATA_DATE, fixtureRows, uuidFor } from "./fixture-26-5.mjs";

// Phase 13.12 browser UAT (P1) — a Publish dialog left open while another tab
// edits the Working Plan must be refused, not silently recalculated against
// the newer plan. The dialog prepares a publish context when it opens; Publish
// rebuilds it from a fresh read and compares. The database's own fingerprint
// check (publish_planning_snapshot_v2 → [STALE_WORKING_PLAN], runtime suite
// 133 §04 and §13) stays underneath, unchanged.

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const PROJECT = uuidFor("project");
const BATCH = "33333333-3333-4333-8333-333333333333";
const TICK = "2026-10-25T09:00:00+00:00";

/**
 * A fake project store: what `planning_publish_inputs()` and the batch reads
 * return, with a fingerprint over the same inputs the database hashes
 * (settings, calendar, every node and activity row with its last change, the
 * approved revisions). "Tab B" edits it; the writer records what reached it.
 */
function store() {
  const state = {
    rows: fixtureRows("current"),
    baselines: approvedBaselines(),
    settings: {},
    calendar: {},
    batches: [{
      id: BATCH, project_id: PROJECT, data_date: DATA_DATE, status: "validated", updated_at: "2026-10-24T08:00:00+00:00",
      file_name: "schedule.xml", source_type: "p6_xml", row_count: 12,
    }],
    engineVersion: PLANNING_ENGINE_VERSION,
    writes: [],
    writerRefusal: null,
  };
  const bundle = () => {
    const b = structuredClone(bundleOf(state.rows, { baselines: state.baselines }));
    Object.assign(b.settings, state.settings);
    Object.assign(b.project, state.calendar);
    b.fingerprint = createHash("md5").update(JSON.stringify([
      b.settings, b.project.working_week, b.project.weekly_reporting_day, b.work_items, b.activities,
      b.baselines.map((baseline) => baseline.id),
    ])).digest("hex");
    return b;
  };
  const deps = {
    readInputs: async () => bundle(),
    readSources: async () => structuredClone(state.batches),
    readSource: async (id) => structuredClone(state.batches.find((batch) => batch.id === id) ?? null),
    write: async (projectId, payload, confirm) => {
      if (state.writerRefusal) return state.writerRefusal;
      state.writes.push({ projectId, payload, confirm });
      return { snapshotId: `snap-${state.writes.length}`, version: 4 + state.writes.length };
    },
    get engineVersion() { return state.engineVersion; },
  };
  /** Tab B: the planner saves a new physical % on one activity (the row's updated_at moves, as the trigger does). */
  const editPercent = (percent) => {
    const activity = state.rows.activities.find((a) => a.percent_complete_physical === 60);
    activity.percent_complete_physical = percent;
    activity.updated_at = TICK;
  };
  return { state, deps, editPercent };
}

const prepared = async (deps) => {
  const result = await preparePublish(deps, PROJECT);
  assert.equal(result.ok, true, JSON.stringify(result.problems ?? []));
  return result.value;
};
const manual = (context, over = {}) => ({
  projectId: PROJECT, context, dataDate: DATA_DATE, sourceImportBatchId: null, label: "Stale Plan UAT", confirmSetupControl: false, ...over,
});

/* ----------------------- the exact browser UAT path ------------------------ */

test("UAT path: dialog prepared → tab B saves a new % complete → Publish in tab A is refused, nothing is written", async () => {
  const { state, deps, editPercent } = store();
  const context = await prepared(deps); // tab A opens Publish Planning Snapshot
  editPercent(61);                       // tab B saves the activity
  const result = await submitPublish(deps, manual(context)); // tab A clicks Publish Snapshot
  assert.equal(result.ok, false);
  assert.deepEqual(result.problems, [{ code: "STALE_PUBLISH_CONTEXT", message: STALE_PLAN_MESSAGE }]);
  assert.equal(STALE_PLAN_MESSAGE, "The Working Plan changed after this publish was prepared. Review the latest plan and open Publish Snapshot again.");
  assert.equal(state.writes.length, 0, "the newer plan was not published");
  assert.equal(isStalePublishRefusal(result.problems), true, "the dialog disables Publish until reopened");
});

test("reopening Publish after the change prepares against the latest plan and publishes it", async () => {
  const { state, deps, editPercent } = store();
  const before = await prepared(deps);
  const baselineRun = await submitPublish(deps, manual(before));
  assert.equal(baselineRun.ok, true);
  editPercent(61);
  const reopened = await prepared(deps);
  assert.notEqual(reopened.fingerprint, before.fingerprint);
  const result = await submitPublish(deps, manual(reopened));
  assert.equal(result.ok, true, JSON.stringify(result.problems ?? []));
  assert.equal(state.writes.length, 2);
  const [first, second] = state.writes.map((write) => write.payload);
  assert.equal(second.fingerprint, reopened.fingerprint, "the writer receives the prepared Working Plan identity");
  assert.ok(second.project.ev > first.project.ev, "the new % complete is in the new snapshot");
});

test("unchanged context publishes normally — manual and import batch", async () => {
  const { state, deps } = store();
  const context = await prepared(deps);
  assert.deepEqual(context.sources.map((source) => source.batchId), [BATCH]);
  assert.equal((await submitPublish(deps, manual(context))).ok, true);
  const fromBatch = await submitPublish(deps, manual(context, { dataDate: "1999-01-01", sourceImportBatchId: BATCH }));
  assert.equal(fromBatch.ok, true, JSON.stringify(fromBatch.problems ?? []));
  const payload = state.writes.at(-1).payload;
  assert.equal(payload.data_date, DATA_DATE, "a batch publishes at its own Data Date, never a typed one");
  assert.equal(payload.source_import_batch_id, BATCH);
});

/* ------------------------------ what is governed ---------------------------- */

test("a baseline approved after the dialog was prepared refuses the publish", async () => {
  const { state, deps } = store();
  const context = await prepared(deps);
  state.baselines.push({
    id: uuidFor("bl2"), revision_number: 2, revision_kind: "rebaseline", decided_at: TICK, capture: captureOf(fixtureRows("current")),
  });
  const result = await submitPublish(deps, manual(context));
  assert.equal(result.problems?.[0].code, "STALE_PUBLISH_BASELINES");
  assert.match(result.problems[0].message, /^The approved baselines changed after this publish was prepared\. .*open Publish Snapshot again\.$/);
  assert.equal(state.writes.length, 0);
});

test("planning configuration that feeds the engine refuses the publish: settings, working week, reporting day, engine version", async () => {
  for (const [label, change] of [
    ["default earning method", (s) => { s.settings = { default_earning_method: "fifty_fifty", updated_at: TICK }; }],
    ["working week", (s) => { s.calendar = { working_week: "Mon – Fri" }; }],
    ["reporting day", (s) => { s.calendar = { weekly_reporting_day: "monday" }; }],
  ]) {
    const { state, deps } = store();
    const context = await prepared(deps);
    change(state);
    const result = await submitPublish(deps, manual(context));
    assert.equal(result.problems?.[0].code, "STALE_PUBLISH_CONTEXT", label);
    assert.equal(state.writes.length, 0, label);
  }
  const { state, deps } = store();
  const context = await prepared(deps);
  state.engineVersion = "9.9.9";
  const result = await submitPublish(deps, manual(context));
  assert.equal(result.problems?.[0].code, "STALE_PUBLISH_ENGINE");
  assert.equal(state.writes.length, 0);
});

test("the import source: a changed Data Date or status, or a batch the dialog never offered, is refused", async () => {
  for (const [label, change] of [
    ["Data Date", (batch) => { batch.data_date = "2026-11-07"; batch.updated_at = TICK; }],
    ["published elsewhere", (batch) => { batch.status = "published"; batch.updated_at = TICK; }],
    ["re-validated", (batch) => { batch.updated_at = TICK; }],
  ]) {
    const { state, deps } = store();
    const context = await prepared(deps);
    change(state.batches[0]);
    const result = await submitPublish(deps, manual(context, { sourceImportBatchId: BATCH }));
    assert.equal(result.problems?.[0].code, "STALE_PUBLISH_SOURCE", label);
    assert.equal(state.writes.length, 0, label);
  }
  const { state, deps } = store();
  const context = await prepared(deps);
  const late = { ...state.batches[0], id: "44444444-4444-4444-8444-444444444444" };
  state.batches.push(late);
  const result = await submitPublish(deps, manual(context, { sourceImportBatchId: late.id }));
  assert.equal(result.problems?.[0].code, "STALE_PUBLISH_SOURCE", "not offered when prepared");
  assert.equal(state.writes.length, 0);
});

test("no prepared context, or one prepared for another project, never reaches the engine or the writer", async () => {
  const { state, deps } = store();
  const context = await prepared(deps);
  for (const bad of [null, undefined, { ...context, projectId: "55555555-5555-4555-8555-555555555555" }]) {
    const result = await submitPublish(deps, manual(bad));
    assert.equal(result.problems?.[0].code, "PUBLISH_NOT_PREPARED");
  }
  assert.equal(state.writes.length, 0);
});

test("the database freshness check stays underneath: a last-moment [STALE_WORKING_PLAN] reads as the same refusal", async () => {
  const { state, deps } = store();
  const context = await prepared(deps);
  state.writerRefusal = { code: "STALE_WORKING_PLAN", message: "The Working Plan changed while the snapshot was being calculated. Nothing was published — publish again." };
  const result = await submitPublish(deps, manual(context));
  assert.deepEqual(result.problems, [{ code: "STALE_PUBLISH_CONTEXT", message: STALE_PLAN_MESSAGE }]);
  state.writerRefusal = { code: "NEW_SCOPE_NOT_BASELINED", message: "Not in the current approved baseline (BL1): X. New scope reaches the plan only through an approved re-baseline." };
  assert.equal((await submitPublish(deps, manual(context))).problems[0].code, "NEW_SCOPE_NOT_BASELINED", "other writer refusals pass through");
});

test("the context is pure identity: it carries no figure, and comparing equal contexts finds nothing", () => {
  const bundle = bundleOf(fixtureRows("current"), { baselines: approvedBaselines() });
  const context = publishContextOf(bundle, []);
  assert.deepEqual(Object.keys(context).sort(), ["bl0BaselineId", "blnBaselineId", "engineVersion", "fingerprint", "projectId", "sources"]);
  assert.equal(context.bl0BaselineId, uuidFor("bl0"));
  assert.equal(context.blnBaselineId, uuidFor("bl1"));
  assert.equal(publishContextProblem(context, structuredClone(context), null), null);
  assert.equal(publishContextOf({ ...bundle, fingerprint: null }, []).code, "NOT_AUTHORIZED");
});

/* ------------------------- browser-facing contract -------------------------- */

test("contract: the dialog prepares on open, submits that context, and is never refreshed in place", () => {
  const panel = read("../components/planning/baselines-snapshots-panel.tsx");
  const dialog = panel.slice(panel.indexOf("function PublishSnapshotDialog"));
  // Prepared once, when the dialog mounts (it unmounts on close, so reopening prepares again).
  assert.match(dialog, /React\.useEffect\(\(\) => \{\s*let cancelled = false;\s*void preparePlanningPublish\(\{ projectId: project\.id \}\)/);
  assert.match(dialog, /\}, \[project\.id\]\);/);
  assert.match(panel, /\{publishOpen && \(\s*<PublishSnapshotDialog/);
  // The offered batches are the prepared ones; Publish sends that context.
  assert.match(dialog, /const batches = context\?\.sources \?\? \[\];/);
  assert.match(dialog, /publishPlanningSnapshotV2\(\{\s*projectId: project\.id,\s*context,/);
  // A stale refusal disables Publish; nothing re-prepares behind the user's back.
  assert.match(dialog, /setStale\(isStalePublishRefusal\(result\.problems\)\);/);
  assert.match(dialog, /publishing \|\|\s*preparing \|\|\s*!context \|\|\s*stale \|\|/);
  assert.equal((dialog.match(/preparePlanningPublish\(/g) ?? []).length, 1);
  assert.doesNotMatch(dialog, /setInterval|planningService\.listImportBatches/);
});

test("contract: the server action prepares and submits through the one flow, as the signed-in caller", () => {
  const action = read("./actions.ts");
  assert.match(action, /export async function preparePlanningPublish\(input: \{ projectId: string \}\)/);
  assert.match(action, /return preparePublish\(await publishDeps\(user\.id\), input\.projectId\);/);
  assert.match(action, /return submitPublish\(await publishDeps\(user\.id\), input\);/);
  assert.match(action, /context: PublishContext;/);
  // The flow compares before the engine runs, and the engine runs before the writer.
  const flow = read("./publish-context.ts");
  const submit = flow.slice(flow.indexOf("export async function submitPublish"));
  const order = ["publishContextProblem(prepared, current", "buildPublishPayload(inputs", "deps.write("].map((needle) => submit.indexOf(needle));
  assert.ok(order.every((at) => at > 0) && order[0] < order[1] && order[1] < order[2], JSON.stringify(order));
});

test("browser UAT P1 regression: no \"use server\" file exports a name list (Turbopack registers type-only names and the module throws on load)", async () => {
  const { readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && /^\s*["']use server["'];/.test(readFileSync(path, "utf8"))) files.push(path);
    }
  };
  walk(root);
  assert.ok(files.some((file) => file.endsWith("actions.ts")), "the publish actions are scanned");
  for (const file of files) {
    const source = readFileSync(file, "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(source, /^\s*export\s+(type\s+)?\{|^\s*export\s+\*|^\s*export\s+(const|let|var|class|default)\b/m, file);
  }
});

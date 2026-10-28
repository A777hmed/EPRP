import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";

import { approvedBaselines, bundleOf, DATA_DATE, fixtureRows, uuidFor } from "./fixture-26-5.mjs";

// Phase 13.12 browser UAT — the REAL server actions (`actions.ts`: session
// re-derivation, the read / write wiring, `preparePublish` / `submitPublish`)
// on the Publish dialog's path: open → prepare → another tab edits → Publish
// → refused; reopen → prepare → Publish → published. Only the three
// infrastructure modules are replaced (session, server client, service-role
// client), by a project store that answers the same calls the way the
// database does. The database's own checks are proven by runtime suite 133.

registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = {
      "@/features/auth/session":
        "export const getAuthenticatedUser = async () => globalThis.__publishActionStub.user;",
      "@/lib/supabase/server":
        "export const createSupabaseServerClient = async () => globalThis.__publishActionStub.client('user');",
      "@/lib/supabase/admin":
        "export function createSupabaseAdminClient() { return globalThis.__publishActionStub.client('service'); }",
    }[specifier];
    return stub
      ? { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true }
      : nextResolve(specifier, context);
  },
});

const PROJECT = uuidFor("project");
const USER = "99999999-9999-4999-8999-999999999999";

/** The project as the database holds it: Working Plan rows, revisions (one legacy capture), snapshots (one legacy). */
function database() {
  const db = {
    rows: fixtureRows("current"),
    baselines: [
      { id: uuidFor("legacy-capture"), revision_status: "legacy", revision_number: null, capture: null },
      ...approvedBaselines().map((baseline) => ({ ...baseline, revision_status: "approved" })),
    ],
    tables: {
      planning_import_batches: [],
      planning_snapshots: [{ id: "legacy-v1", project_id: PROJECT, version: 1, engine_version: null }],
    },
    calls: [],
  };
  // planning_publish_inputs(): approved revisions only, the fingerprint over every row and its last change.
  db.inputs = () => {
    const bundle = structuredClone(bundleOf(db.rows, {
      baselines: db.baselines.filter((baseline) => baseline.revision_status === "approved")
        .map((baseline) => ({ id: baseline.id, revision_number: baseline.revision_number, revision_kind: baseline.revision_kind,
          decided_at: baseline.decided_at, capture: baseline.capture })),
    }));
    bundle.fingerprint = createHash("md5").update(JSON.stringify([bundle.settings, bundle.work_items, bundle.activities,
      bundle.baselines.map((baseline) => baseline.id)])).digest("hex");
    return bundle;
  };
  db.rpc = async (name, args, as) => {
    db.calls.push({ name, as, args });
    if (name === "planning_publish_inputs" && as === "user") return { data: db.inputs(), error: null };
    if (name === "publish_planning_snapshot_v2" && as === "service") {
      if (args.p_payload.fingerprint !== db.inputs().fingerprint) {
        return { data: null, error: { code: "PT409", message: "[STALE_WORKING_PLAN] The Working Plan changed while the snapshot was being calculated. Nothing was published — publish again." } };
      }
      const version = Math.max(...db.tables.planning_snapshots.map((snapshot) => snapshot.version)) + 1;
      const id = `v2-${version}`;
      db.tables.planning_snapshots.push({ id, project_id: args.p_project, version, engine_version: args.p_payload.engine_version, ev: args.p_payload.project.ev });
      return { data: id, error: null };
    }
    return { data: null, error: { code: "42501", message: `permission denied for function ${name}` } };
  };
  return db;
}

function client(db, as) {
  return {
    rpc: (name, args) => db.rpc(name, args, as),
    from(table) {
      const filters = [];
      let columns = null;
      const run = () => (db.tables[table] ?? [])
        .filter((row) => filters.every(([column, value]) => row[column] === value))
        .map((row) => (columns ? Object.fromEntries(columns.map((column) => [column, row[column] ?? null])) : { ...row }));
      const query = {
        select(list) { columns = list === "*" ? null : list.split(",").map((column) => column.trim()); return query; },
        eq(column, value) { filters.push([column, value]); return query; },
        order() { return query; },
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then: (resolve, reject) => Promise.resolve({ data: run(), error: null }).then(resolve, reject),
      };
      return query;
    },
  };
}

function signedIn(db, user = { id: USER }) {
  globalThis.__publishActionStub = { user, client: (as) => client(db, as) };
}

/** What crosses the server-action boundary: plain data only (no Date, bigint, function, undefined, class instance). */
function assertPlain(value, path = "result") {
  if (value === null || ["string", "boolean"].includes(typeof value)) return;
  if (typeof value === "number") return assert.ok(Number.isFinite(value), path);
  assert.ok(typeof value === "object", `${path}: ${typeof value}`);
  const proto = Object.getPrototypeOf(value);
  assert.ok(Array.isArray(value) || proto === Object.prototype || proto === null, `${path}: not a plain object`);
  for (const [key, entry] of Object.entries(value)) assertPlain(entry, `${path}.${key}`);
}

const { preparePlanningPublish, publishPlanningSnapshotV2 } = await import("./actions.ts");
const editPercent = (db, percent) => {
  const activity = db.rows.activities.find((a) => a.percent_complete_physical === 60);
  activity.percent_complete_physical = percent;
  activity.updated_at = "2026-10-26T09:00:00+00:00";
};
const manual = (context) => ({ projectId: PROJECT, context, dataDate: DATA_DATE, label: "Stale Plan UAT", confirmSetupControl: false });

test("opening Publish on a controlled project with BL0 / BL1 and no import batch prepares, past a legacy capture and snapshot", async () => {
  const db = database();
  signedIn(db);
  const result = await preparePlanningPublish({ projectId: PROJECT });
  assert.equal(result.ok, true, JSON.stringify(result.problems ?? []));
  assertPlain(result);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result, "survives the server-action boundary unchanged");
  assert.equal(result.value.projectId, PROJECT);
  assert.equal(result.value.bl0BaselineId, uuidFor("bl0"));
  assert.equal(result.value.blnBaselineId, uuidFor("bl1"));
  assert.deepEqual(result.value.sources, [], "no import batch is a valid (manual) publish");
  // Read as the user; nothing written.
  assert.deepEqual(db.calls.map((call) => `${call.as}:${call.name}`), ["user:planning_publish_inputs"]);
  assert.equal(db.tables.planning_snapshots.length, 1);
});

test("signed out: prepare and publish are refused as a sentence, nothing is read or written", async () => {
  const db = database();
  signedIn(db, null);
  assert.deepEqual(await preparePlanningPublish({ projectId: PROJECT }),
    { ok: false, problems: [{ code: "NOT_AUTHORIZED", message: "Sign in again to continue." }] });
  assert.equal((await publishPlanningSnapshotV2(manual(null))).problems[0].code, "NOT_AUTHORIZED");
  assert.equal(db.calls.length, 0);
});

test("UAT path through the real actions: prepare → another tab saves a % → Publish is refused; reopen → publishes", async () => {
  const db = database();
  signedIn(db);
  const opened = await preparePlanningPublish({ projectId: PROJECT });
  editPercent(db, 61);
  const stale = await publishPlanningSnapshotV2(manual(opened.value));
  assertPlain(stale);
  assert.deepEqual(stale, { ok: false, problems: [{
    code: "STALE_PUBLISH_CONTEXT",
    message: "The Working Plan changed after this publish was prepared. Review the latest plan and open Publish Snapshot again.",
  }] });
  assert.ok(!db.calls.some((call) => call.name === "publish_planning_snapshot_v2"), "the writer was never called");
  assert.deepEqual(db.tables.planning_snapshots.map((snapshot) => snapshot.id), ["legacy-v1"], "no snapshot, the legacy one untouched");

  const reopened = await preparePlanningPublish({ projectId: PROJECT });
  assert.notEqual(reopened.value.fingerprint, opened.value.fingerprint);
  const published = await publishPlanningSnapshotV2(manual(reopened.value));
  assert.equal(published.ok, true, JSON.stringify(published.problems ?? []));
  assertPlain(published);
  assert.equal(published.value.version, 2);
  const write = db.calls.find((call) => call.name === "publish_planning_snapshot_v2");
  assert.equal(write.as, "service");
  assert.equal(write.args.p_actor, USER, "the writer names the re-derived caller");
  assert.equal(write.args.p_payload.fingerprint, reopened.value.fingerprint);
  assert.equal(write.args.p_confirm_setup_control, false);
  assert.equal(published.value.summary.ev, write.args.p_payload.project.ev, "the new % complete is what was frozen");
});

test("a change between the action's read and the write is still caught by the writer and reads as the same refusal", async () => {
  const db = database();
  signedIn(db);
  const opened = await preparePlanningPublish({ projectId: PROJECT });
  const rpc = db.rpc;
  db.rpc = async (name, args, as) => {
    if (name === "publish_planning_snapshot_v2") editPercent(db, 62); // another tab saves at the last moment
    return rpc(name, args, as);
  };
  const result = await publishPlanningSnapshotV2(manual(opened.value));
  assert.equal(result.problems?.[0].code, "STALE_PUBLISH_CONTEXT");
  assert.equal(db.tables.planning_snapshots.length, 1);
});

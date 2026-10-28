/**
 * Phase 13.12 — the generated fixture block of the runtime SQL suite
 * `scripts/p0-validation/133_runtime_13_12_snapshot_v2.sql`. Test-only.
 *
 * The suite cannot run TypeScript, so the Working Plan rows of each stage,
 * the engine's baseline curves and the engine's publish payload for §26.5
 * are produced HERE by the real orchestration (`publish-plan.ts`) and written
 * into the suite between its GENERATED markers. The suite seeds the same rows,
 * requests and approves BL0 and BL1 through the real functions, and hands this
 * payload to the real trusted writer, patching only the identities the server
 * reads from the database at publish time (the Working Plan fingerprint and
 * the approved baseline ids). `publish-plan.test.mjs` fails if the block in the
 * suite drifts from what this produces.
 *
 * Regenerate:  node --import ./src/features/notifications/test-runtime.mjs \
 *                scripts/p0-validation/gen_133_fixture.mjs
 */

import { buildBaselineRequest, buildPublishPayload } from "./publish-plan.ts";
import { approvedBaselines, bundleOf, DATA_DATE, fixtureRows, uuidFor } from "./fixture-26-5.mjs";

export const BEGIN = "-- @@GENERATED-BEGIN@@ (src/features/projects/planning-publish/sql-fixture.mjs — do not edit by hand)";
export const END = "-- @@GENERATED-END@@";

const pick = (row, keys) => Object.fromEntries(keys.map((key) => [key, row[key]]));

export function generatedFixtureSql() {
  const bl0Rows = fixtureRows("bl0");
  const bl1Rows = fixtureRows("bl1");
  const current = fixtureRows("current");

  const curve0 = buildBaselineRequest(bundleOf(bl0Rows), "2026-08-15");
  const curve1 = buildBaselineRequest(bundleOf(bl1Rows, { baselines: approvedBaselines().slice(0, 1) }), "2026-09-15");
  const publish = buildPublishPayload(bundleOf(current, { baselines: approvedBaselines() }), { dataDate: DATA_DATE });
  if (curve0.status !== "ready" || curve1.status !== "ready" || publish.status !== "ready") {
    throw new Error("The §26.5 fixture no longer calculates.");
  }

  const nodeKeys = ["id", "parent_work_item_id", "code", "name", "item_type", "level", "sort_order",
    "local_weight_percent", "is_control_account"];
  const activityKeys = ["id", "work_item_id", "code", "name", "is_milestone", "local_weight_percent", "earning_method",
    "planned_start_date", "planned_finish_date"];
  const stateKeys = ["id", "planned_start_date", "planned_finish_date", "actual_start_date", "actual_finish_date",
    "percent_complete_physical"];

  const entries = {
    project_id: uuidFor("project"),
    placeholder_bl0: uuidFor("bl0"),
    placeholder_bl1: uuidFor("bl1"),
    data_date: DATA_DATE,
    work_items: bl0Rows.workItems.map((row) => pick(row, nodeKeys)),
    activities_bl0: bl0Rows.activities.map((row) => pick(row, activityKeys)),
    state_bl1: bl1Rows.activities.map((row) => pick(row, stateKeys)),
    state_current: current.activities.map((row) => pick(row, stateKeys)),
    curve_bl0: curve0.curve,
    curve_bl1: curve1.curve,
    engine_version: curve0.engineVersion,
    payload: publish.payload,
  };

  const lines = [
    BEGIN,
    "create temp table fx(key text primary key, value jsonb) on commit drop;",
    "grant select on fx to authenticated, anon, service_role;",
  ];
  for (const [key, value] of Object.entries(entries)) {
    lines.push(`insert into fx values ('${key}', $fx$${JSON.stringify(value)}$fx$::jsonb);`);
  }
  lines.push(END);
  return lines.join("\n");
}

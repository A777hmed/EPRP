import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as setupSave from "../features/projects/setup-save.ts";
import * as storage from "./project-party-storage.ts";
import { persistProjectParties } from "../features/projects/project-parties.ts";
import { formValuesToProjectInfoUpdate, projectToFormValues } from "../features/projects/schemas/project-form.ts";

const PROJECT = "ee654f5a-12bf-42d2-b062-137609eb85c8";
const initialRow = () => ({
  id: PROJECT, client_id: "client-a", code: "PARTY-01", name: "Party foundation",
  structure_family: "other", project_type_id: "category", project_category_detail: null,
  project_manager_id: "pm", project_control_manager_id: "pcm", reporting_coordinator_id: "rc",
  planned_start_date: "2026-01-01", planned_finish_date: "2026-12-31", description: "Regression",
  status: "planning", overall_status: "on_track", priority: "medium", current_phase_id: "phase",
  currency: "EGP", working_week: "Sun – Thu", time_zone: "Africa/Cairo", country: "Egypt", site: "Site",
  weekly_enabled: true, monthly_enabled: true, executive_enabled: true, weekly_reporting_day: "thursday", monthly_cutoff_day: 25,
  default_language: "en", include_qr_code: true, include_signature_section: true, created_at: "v1", updated_at: "v1",
});

// Exercise the REAL service/read-back path with an isolated transport double.
// This is not a PostgreSQL implementation or proof that live RLS was exercised.
function harness({ missing = false, authorized = true, readError = null } = {}) {
  let sequence = 0;
  let row = initialRow();
  let parties = persistProjectParties(undefined, [], () => `party-${++sequence}`);
  const calls = [];
  const client = {
    from(table) {
      const filters = [];
      let single = false;
      const query = {
        select() { return query; },
        in(column, values) { filters.push([column, values]); return query; },
        eq(column, value) { filters.push([column, [value]]); return query; },
        order() { return query; },
        maybeSingle() { single = true; return query; },
        single() { single = true; return query; },
        then(resolve, reject) {
          calls.push({ table, operation: "select" });
          let result;
          if (table === "project_parties" && readError) result = { data: null, error: readError };
          else if (table === "project_parties" && missing) result = { data: null, error: { code: "PGRST205", message: "Missing table" } };
          else {
            let data = table === "projects" ? [structuredClone(row)] : table === "project_parties"
              ? parties.map((party) => ({ id: party.id, project_id: PROJECT, kind: party.kind, name: party.name ?? null, sort_order: party.sortOrder })) : [];
            for (const [column, values] of filters) data = data.filter((item) => values.includes(item[column]));
            result = { data: single ? data[0] ?? null : data, error: null };
          }
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name, args) {
      calls.push({ name, args: structuredClone(args) });
      if (!authorized) return { data: null, error: { code: "42501", message: "Project Setup access is required." } };
      if (args.p_expected_updated_at !== row.updated_at) return { data: null, error: { code: "PT409", message: "Project Setup changed" } };
      assert.equal(name, "save_project_setup_patch");
      if ("parties" in args.p_relations) parties = persistProjectParties(parties, args.p_relations.parties, () => `party-${++sequence}`);
      row = { ...row, ...args.p_columns, updated_at: `v${++sequence}` };
      return { data: row.updated_at, error: null };
    },
  };
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(new URL("./supabase-project-service.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports, console,
    require(name) {
      if (name === "@/lib/supabase/client") return { getSupabaseBrowserClient: () => client };
      if (name === "@/lib/perf-temp") return { startTimer: () => () => {}, timed: (_name, fn) => fn() };
      if (name === "@/features/projects/setup-save") return setupSave;
      if (name === "./project-party-storage") return storage;
      if (["./replace-person", "./classification-correction"].includes(name)) return {};
      throw new Error(`Unexpected service dependency ${name}`);
    },
  });
  return { service: exports.supabaseProjectService, calls, snapshot: () => structuredClone({ row, parties }) };
}

test("one subcontractor saves through the actual setup patch and persists on fresh read", async () => {
  const { service, calls } = harness();
  const original = await service.getProjectById(PROJECT);
  const values = { ...projectToFormValues(original), subcontractors: [{ name: "Alpha contractor" }] };
  const saved = await service.updateProject(PROJECT, formValuesToProjectInfoUpdate(values), original.updatedAt);
  const refreshed = await service.getProjectById(PROJECT);
  assert.equal(refreshed.parties.filter((party) => party.kind === "subcontractor")[0].name, "Alpha contractor");
  assert.equal(refreshed.parties[2].id, saved.parties[2].id);
  const rpc = calls.find((call) => call.name);
  assert.deepEqual(Object.keys(rpc.args.p_relations).sort(), ["parties", "positions", "sites"]);
  assert.equal(rpc.args.p_relations.parties.length, 1);
  assert.equal(rpc.args.p_relations.parties[0].kind, "subcontractor");
  assert.ok(calls.filter((call) => call.table === "projects").length >= 4);
});

test("multiple subcontractors, reorder, rename and removal retain identities through service and list reads", async () => {
  const { service } = harness();
  let project = await service.getProjectById(PROJECT);
  project = await service.updateProject(PROJECT, { parties: ["Alpha", "Beta"].map((name, sortOrder) => ({ kind: "subcontractor", name, sortOrder })) }, project.updatedAt);
  const requiredIds = project.parties.slice(0, 2).map((party) => party.id);
  const [alpha, beta] = project.parties.slice(2);
  project = await service.updateProject(PROJECT, { parties: [{ ...beta, name: "Beta renamed" }, alpha] }, project.updatedAt);
  assert.deepEqual(project.parties.slice(2).map((party) => party.id), [beta.id, alpha.id]);
  assert.deepEqual(project.parties.slice(2).map((party) => party.sortOrder), [0, 1]);
  const listed = (await service.getProjects())[0];
  assert.deepEqual(JSON.parse(JSON.stringify(listed.parties)), JSON.parse(JSON.stringify(project.parties)));
  project = await service.updateProject(PROJECT, { parties: [], clientId: "client-b" }, project.updatedAt);
  assert.equal(project.clientId, "client-b");
  assert.deepEqual(project.parties.map((party) => party.id), requiredIds);
  assert.deepEqual(project.parties.map((party) => party.kind), ["eprom", "owner"]);
});

test("unmigrated projects remain readable and zero-subcontractor saves omit unavailable relation", async () => {
  const { service, calls } = harness({ missing: true });
  const project = await service.getProjectById(PROJECT);
  assert.equal(project.parties, undefined);
  assert.deepEqual(projectToFormValues(project).subcontractors, []);
  const saved = await service.updateProject(PROJECT, { name: "Existing project renamed", parties: [] }, project.updatedAt);
  assert.equal(saved.name, "Existing project renamed");
  assert.equal("parties" in calls.find((call) => call.name).args.p_relations, false);
});

test("unavailable storage refuses nonempty parties before update or project creation", async () => {
  const { service, calls, snapshot } = harness({ missing: true });
  const before = snapshot();
  const input = { parties: [{ kind: "subcontractor", name: "Alpha", sortOrder: 0 }] };
  await assert.rejects(service.updateProject(PROJECT, input, before.row.updated_at), /not available yet/);
  await assert.rejects(service.createProject(input), /not available yet/);
  assert.equal(calls.some((call) => call.name), false);
  assert.deepEqual(snapshot(), before);
});

test("a denied save or stale version never changes parties or Client", async () => {
  for (const authorized of [true, false]) {
    const { service, snapshot } = harness({ authorized });
    const before = snapshot();
    await assert.rejects(service.updateProject(PROJECT, { clientId: "client-b", parties: [{ kind: "subcontractor", name: "Alpha", sortOrder: 0 }] }, authorized ? "old-version" : "v1"), authorized ? /changed/ : /access is required/);
    assert.deepEqual(snapshot(), before);
  }
});

test("permission and network failures are not misreported as an unapplied migration", async () => {
  for (const error of [{ code: "42501", message: "permission denied" }, { code: "NETWORK", message: "offline" }, { code: "PGRST204", message: "schema cache column mismatch" }]) {
    const { service, calls } = harness({ readError: error });
    await assert.rejects(service.getProjectById(PROJECT), new RegExp(error.message));
    await assert.rejects(service.updateProject(PROJECT, { parties: [] }, "v1"), new RegExp(error.message));
    assert.equal(calls.some((call) => call.name), false);
  }
});

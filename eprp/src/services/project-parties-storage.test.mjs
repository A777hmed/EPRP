import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as setupSave from "../features/projects/setup-save.ts";
import * as storage from "./project-party-storage.ts";
import * as memberStorage from "./project-member-storage.ts";
import { persistProjectParties } from "../features/projects/project-parties.ts";
import { formValuesToProjectInfoUpdate, projectToFormValues } from "../features/projects/schemas/project-form.ts";

const PROJECT = "ee654f5a-12bf-42d2-b062-137609eb85c8";
// A complete 2C.3B subcontractor; the professional fields are required on save.
const sub = (name, sortOrder = 0, extra = {}) => ({ kind: "subcontractor", name, scope: `${name} package`, engagementStatus: "active", sortOrder, ...extra });
const subForm = (name, extra = {}) => ({ name, shortName: "", scope: `${name} package`, contractReference: "", engagementStatus: "active", ...extra });
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
function harness({ missing = false, authorized = true, readError = null, foundationOnly = false, legacy = false } = {}) {
  let sequence = 0;
  let row = initialRow();
  let parties = persistProjectParties(undefined, [], () => `party-${++sequence}`);
  // A 2C.3A row saved before the professional columns existed.
  if (legacy) parties = [...parties, { id: "legacy-sub", kind: "subcontractor", name: "Legacy Works", sortOrder: 0 }];
  const toRow = (party) => ({ id: party.id, project_id: PROJECT, kind: party.kind, name: party.name ?? null, sort_order: party.sortOrder,
    ...(foundationOnly ? {} : { short_name: party.shortName ?? null, scope: party.scope ?? null,
      contract_reference: party.contractReference ?? null, engagement_status: party.engagementStatus ?? null }) });
  const calls = [];
  const client = {
    from(table) {
      const filters = [];
      let single = false;
      let columns = "*";
      const query = {
        select(selected = "*") { columns = selected; return query; },
        limit() { return query; },
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
          else if (table === "project_parties" && foundationOnly && columns.includes("scope")) result = { data: null, error: { code: "42703", message: "column project_parties.scope does not exist" } };
          else {
            let data = table === "projects" ? [structuredClone(row)] : table === "project_parties"
              ? parties.map(toRow) : [];
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
      if (name === "./project-member-storage") return memberStorage;
      if (["./replace-person", "./classification-correction"].includes(name)) return {};
      throw new Error(`Unexpected service dependency ${name}`);
    },
  });
  return { service: exports.supabaseProjectService, calls, snapshot: () => structuredClone({ row, parties }) };
}

test("one subcontractor saves through the actual setup patch and persists on fresh read", async () => {
  const { service, calls } = harness();
  const original = await service.getProjectById(PROJECT);
  const values = { ...projectToFormValues(original), subcontractors: [subForm("Alpha contractor", { shortName: " ALC ", contractReference: "SC-01", engagementStatus: "planned" })] };
  const saved = await service.updateProject(PROJECT, formValuesToProjectInfoUpdate(values), original.updatedAt);
  const refreshed = await service.getProjectById(PROJECT);
  const stored = refreshed.parties.filter((party) => party.kind === "subcontractor")[0];
  assert.equal(stored.name, "Alpha contractor");
  assert.equal(stored.shortName, "ALC");
  assert.equal(stored.scope, "Alpha contractor package");
  assert.equal(stored.contractReference, "SC-01");
  assert.equal(stored.engagementStatus, "planned");
  assert.equal(projectToFormValues(refreshed).subcontractors[0].engagementStatus, "planned");
  assert.equal(refreshed.parties[2].id, saved.parties[2].id);
  const rpc = calls.find((call) => call.name);
  assert.deepEqual(Object.keys(rpc.args.p_relations).sort(), ["parties", "positions", "sites"]);
  assert.equal(rpc.args.p_relations.parties.length, 1);
  assert.equal(rpc.args.p_relations.parties[0].kind, "subcontractor");
  // As sent over JSON: a new row carries no id; blank optional fields are omitted.
  assert.deepEqual(JSON.parse(JSON.stringify(rpc.args.p_relations.parties[0])), { kind: "subcontractor", name: "Alpha contractor", shortName: "ALC",
    scope: "Alpha contractor package", contractReference: "SC-01", engagementStatus: "planned", sortOrder: 0 });
  assert.ok(calls.filter((call) => call.table === "projects").length >= 4);
});

test("multiple subcontractors, reorder, rename and removal retain identities through service and list reads", async () => {
  const { service } = harness();
  let project = await service.getProjectById(PROJECT);
  project = await service.updateProject(PROJECT, { parties: ["Alpha", "Beta"].map((name, sortOrder) => sub(name, sortOrder)) }, project.updatedAt);
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
  const input = { parties: [sub("Alpha")] };
  await assert.rejects(service.updateProject(PROJECT, input, before.row.updated_at), /not available yet/);
  await assert.rejects(service.createProject(input), /not available yet/);
  assert.equal(calls.some((call) => call.name), false);
  assert.deepEqual(snapshot(), before);
});

test("a denied save or stale version never changes parties or Client", async () => {
  for (const authorized of [true, false]) {
    const { service, snapshot } = harness({ authorized });
    const before = snapshot();
    await assert.rejects(service.updateProject(PROJECT, { clientId: "client-b", parties: [sub("Alpha")] }, authorized ? "old-version" : "v1"), authorized ? /changed/ : /access is required/);
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

test("2C.3A-only database refuses subcontractor details instead of silently dropping them", async () => {
  const { service, calls, snapshot } = harness({ foundationOnly: true });
  const before = snapshot();
  const project = await service.getProjectById(PROJECT);
  assert.deepEqual(project.parties.map((party) => party.kind), ["eprom", "owner"]);
  await assert.rejects(service.updateProject(PROJECT, { parties: [sub("Alpha")] }, project.updatedAt), /database is updated/);
  await assert.rejects(service.createProject({ parties: [sub("Alpha")] }), /database is updated/);
  assert.equal(calls.some((call) => call.name), false);
  assert.deepEqual(snapshot(), before);
  // Zero subcontractors still saves ordinary Project Information.
  const saved = await service.updateProject(PROJECT, { name: "Renamed project", parties: [] }, project.updatedAt);
  assert.equal(saved.name, "Renamed project");
});

test("legacy subcontractor without scope/status stays readable, unselected, and must be completed to save", async () => {
  const { service } = harness({ legacy: true });
  const project = await service.getProjectById(PROJECT);
  const legacy = project.parties[2];
  assert.deepEqual([legacy.id, legacy.name, legacy.scope, legacy.engagementStatus], ["legacy-sub", "Legacy Works", undefined, undefined]);
  const form = projectToFormValues(project).subcontractors[0];
  assert.deepEqual({ ...form }, { id: "legacy-sub", name: "Legacy Works", shortName: "", scope: "", contractReference: "", engagementStatus: "" });
  // An untouched legacy row is never saved with an invented status.
  await assert.rejects(service.updateProject(PROJECT, formValuesToProjectInfoUpdate(projectToFormValues(project)), project.updatedAt), /engagement status|scope/);
  const completed = { ...projectToFormValues(project), subcontractors: [{ ...form, scope: "Civil works", engagementStatus: "suspended" }] };
  const saved = await service.updateProject(PROJECT, formValuesToProjectInfoUpdate(completed), project.updatedAt);
  assert.deepEqual([saved.parties[2].id, saved.parties[2].scope, saved.parties[2].engagementStatus], ["legacy-sub", "Civil works", "suspended"]);
});

test("duplicate company names (trim + case-insensitive) are refused before any write", async () => {
  const { service, calls, snapshot } = harness();
  const before = snapshot();
  await assert.rejects(service.updateProject(PROJECT, { parties: [sub("Alpha Ltd"), sub("  alpha LTD ", 1)] }, "v1"), /only once per project/);
  assert.equal(calls.some((call) => call.name), false);
  assert.deepEqual(snapshot(), before);
});

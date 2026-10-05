import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  mapProjectStructureError,
  PROJECT_STRUCTURE_MESSAGES,
  ProjectStructureError,
} from "./project-structure-errors.ts";
import {
  archiveNodePatch,
  configureLevelsRpcArgs,
  createNodeRow,
  createSupabaseProjectStructureService,
  nodeFromRow,
  updateNodePatch,
} from "./supabase-project-structure-service.ts";
import { createInMemoryProjectStructureService } from "./project-structure-service.ts";

const source = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replaceAll("\r", "");
const reasonOf = async (promise) => {
  try {
    await promise;
    return "accepted";
  } catch (error) {
    assert.ok(error instanceof ProjectStructureError, `unexpected error: ${error}`);
    return error.reason;
  }
};

/* ------------------------------- error mapping ------------------------------ */

test("every database [TAG] maps to fixed, plain-language wording", () => {
  const tags = {
    NOT_AUTHORIZED: "not_authorized", NOT_OTHER: "not_other", PROJECT_ARCHIVED: "project_archived", STALE: "stale",
    INVALID_LEVELS: "invalid_levels", LEVEL_LIMIT: "level_limit", LEVEL_GAP: "level_gap",
    DUPLICATE_LABEL: "duplicate_label", LEVEL_IN_USE: "level_in_use", LEVEL_IMMUTABLE: "level_immutable",
    PARENT_LEVEL: "parent_level", PARENT_ARCHIVED: "parent_archived", ACTIVE_CHILDREN: "active_children",
    REPORTING_OVERLAP: "reporting_overlap", NOT_FOUND: "not_found",
  };
  for (const [tag, reason] of Object.entries(tags)) {
    const mapped = mapProjectStructureError({ message: `[${tag}] raw database sentence`, code: "23514" });
    assert.equal(mapped.reason, reason, tag);
    assert.equal(mapped.message, PROJECT_STRUCTURE_MESSAGES[reason]);
    assert.doesNotMatch(mapped.message, /raw database sentence|\[/);
  }
  assert.equal(
    mapProjectStructureError({ message: "[STALE] x", code: "PT409" }).message,
    "The project changed since this page loaded. Reload before saving."
  );
});

test("unique-index and foreign-key violations map without leaking constraint names", () => {
  const cases = [
    [{ code: "23505", message: 'duplicate key value violates unique constraint "project_structure_nodes_active_sibling_name_unique"' }, "duplicate_name"],
    [{ code: "23505", message: 'duplicate key value violates unique constraint "project_structure_nodes_active_code_unique"' }, "duplicate_code"],
    [{ code: "23503", message: 'insert or update on table "project_structure_nodes" violates foreign key constraint "project_structure_nodes_parent_fk"' }, "parent_invalid"],
    [{ code: "23503", message: 'update or delete on table "project_structure_nodes" violates foreign key constraint "project_structure_nodes_parent_fk" on table "project_structure_nodes"' }, "has_children"],
    [{ code: "23503", message: 'insert or update on table "project_structure_nodes" violates foreign key constraint "project_structure_nodes_level_fk"' }, "level_undefined"],
    [{ code: "23503", message: 'update or delete on table "project_structure_levels" violates foreign key constraint "project_structure_nodes_level_fk" on table "project_structure_nodes"' }, "level_in_use"],
    [{ code: "23514", message: 'new row violates check constraint "project_structure_nodes_root_rule"' }, "parent_level"],
    [{ code: "23514", message: 'new row violates check constraint "project_structure_nodes_archived_not_reporting"' }, "archived_reporting"],
    [{ code: "23505", message: 'duplicate key value violates unique constraint "project_structure_levels_singular_key_unique"' }, "duplicate_label"],
  ];
  for (const [error, reason] of cases) {
    const mapped = mapProjectStructureError(error);
    assert.equal(mapped.reason, reason, error.message);
    assert.doesNotMatch(mapped.message, /project_structure|constraint|violates|null|undefined/i);
  }
});

test("RLS / authority, stale, missing and unknown failures are app-safe", () => {
  assert.equal(mapProjectStructureError({ code: "42501", message: 'new row violates row-level security policy for table "project_structure_nodes"' }).reason, "not_authorized");
  assert.equal(mapProjectStructureError({ message: "permission denied by row-level security" }).reason, "not_authorized");
  assert.equal(mapProjectStructureError({ code: "PT409", message: "conflict" }).reason, "stale");
  assert.equal(mapProjectStructureError({ code: "P0001", message: "[STALE] x" }).reason, "stale");
  // Not stale: a genuine serialization failure, or a generic 409 (unique violation).
  assert.equal(mapProjectStructureError({ code: "40001", message: "could not serialize access" }).reason, "failed");
  assert.equal(mapProjectStructureError({ code: "23505", message: "duplicate key value" }).reason, "failed");
  assert.equal(mapProjectStructureError({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }).reason, "not_found");
  const unknown = mapProjectStructureError({ code: "XX000", message: "internal error at line 42 in function foo" });
  assert.equal(unknown.reason, "failed");
  assert.doesNotMatch(unknown.message, /line 42|function foo/);
  assert.equal(mapProjectStructureError(null).reason, "failed");
  for (const message of Object.values(PROJECT_STRUCTURE_MESSAGES)) {
    assert.doesNotMatch(message, /null|undefined|\bsql\b|constraint|_/i);
  }
});

/* ------------------------- Supabase service, fake client ------------------- */

/** Records every query and answers from per-table queues. */
function fakeClient(responses = {}) {
  const calls = [];
  const from = (table) => {
    const call = { table, ops: [] };
    calls.push(call);
    const builder = new Proxy({}, {
      get(_, prop) {
        if (prop === "then") {
          const answer = responses[table]?.shift() ?? { data: null, error: null };
          return (resolve, reject) => Promise.resolve(answer).then(resolve, reject);
        }
        return (...args) => {
          call.ops.push([prop, ...args]);
          return builder;
        };
      },
    });
    return builder;
  };
  const rpc = (name, args) => {
    calls.push({ rpc: name, args });
    return Promise.resolve(responses.rpc?.shift() ?? { data: null, error: null });
  };
  return { calls, client: { from, rpc } };
}

const quietly = async (fn) => {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
};

const levelRow = (n, singular) => ({
  id: `L${n}`, project_id: "P", level_number: n, singular_label: singular, plural_label: `${singular}s`,
  created_at: "c", updated_at: "u",
});
const nodeRow = (id, level, parent, extra = {}) => ({
  id, project_id: "P", level_number: level, parent_id: parent, name: extra.name ?? id, code: extra.code ?? null,
  description: null, sort_order: 0, weekly_reporting_required: extra.weekly ?? false,
  monthly_reporting_required: false, archived_at: extra.archived ?? null, created_at: "c", updated_at: "u",
});

const version = (v) => ({ data: { id: "P", updated_at: v }, error: null });

test("structure read: stable window — version, children, same version — mapped and sorted", async () => {
  const { calls, client } = fakeClient({
    projects: [version("2026-10-03T10:00:00Z"), version("2026-10-03T10:00:00Z")],
    project_structure_levels: [{ data: [levelRow(2, "Area"), levelRow(1, "Package")], error: null }],
    project_structure_nodes: [{ data: [nodeRow("A1", 2, "P1"), nodeRow("P1", 1, null, { code: "PKG", weekly: true })], error: null }],
  });
  const service = createSupabaseProjectStructureService(() => client);
  const structure = await service.getStructure("P");
  assert.equal(structure.version, "2026-10-03T10:00:00Z");
  assert.deepEqual(structure.levels.map((l) => [l.levelNumber, l.singularLabel]), [[1, "Package"], [2, "Area"]]);
  assert.deepEqual(structure.nodes.map((n) => n.id), ["P1", "A1"]);
  assert.deepEqual(structure.nodes[0], {
    id: "P1", projectId: "P", levelNumber: 1, parentId: undefined, name: "P1", code: "PKG", description: undefined,
    sortOrder: 0, weeklyReportingRequired: true, monthlyReportingRequired: false, archivedAt: undefined,
    createdAt: "c", updatedAt: "u",
  });
  const archived = nodeFromRow(nodeRow("X", 2, "P1", { archived: "2026-10-01T00:00:00Z" }));
  assert.deepEqual([archived.archivedAt, archived.parentId, archived.code], ["2026-10-01T00:00:00Z", "P1", undefined]);
  // Version read first and again last; the children in between.
  assert.deepEqual(calls.map((c) => c.table), ["projects", "project_structure_levels", "project_structure_nodes", "projects"]);
  assert.ok(calls.every((c) => c.ops.every(([op]) => ["select", "eq", "order", "maybeSingle"].includes(op))));
});

test("structure read: a version change between the child reads rejects the mixed result as stale", async () => {
  const { client } = fakeClient({
    projects: [version("v1"), version("v2")],
    project_structure_levels: [{ data: [levelRow(1, "Package")], error: null }],
    project_structure_nodes: [{ data: [], error: null }],
  });
  const error = await createSupabaseProjectStructureService(() => client).getStructure("P").catch((e) => e);
  assert.equal(error.reason, "stale");
  assert.equal(error.message, "The project changed since this page loaded. Reload before saving.");
});

test("structure read: a project that disappears (or was never visible) is not found, never a partial structure", async () => {
  const { client } = fakeClient({
    projects: [version("v1"), { data: null, error: null }, { data: null, error: null }],
    project_structure_levels: [{ data: [levelRow(1, "Package")], error: null }],
    project_structure_nodes: [{ data: [], error: null }],
  });
  const service = createSupabaseProjectStructureService(() => client);
  assert.equal(await reasonOf(service.getStructure("P")), "not_found");
  assert.equal(await reasonOf(service.getStructure("hidden")), "not_found");
});

test("structure read: an empty Other project is levels [] and nodes []", async () => {
  const { client } = fakeClient({
    projects: [version("v"), version("v")],
    project_structure_levels: [{ data: [], error: null }],
    project_structure_nodes: [{ data: null, error: null }],
  });
  assert.deepEqual(await createSupabaseProjectStructureService(() => client).getStructure("P"),
    { projectId: "P", version: "v", levels: [], nodes: [] });
});

test("level RPC: complete set, sorted, trimmed, ids only when kept; returns the new version", async () => {
  const input = {
    projectId: "P", expectedVersion: "v1",
    levels: [
      { levelNumber: 2, singularLabel: " Area ", pluralLabel: "Areas" },
      { id: "L1", levelNumber: 1, singularLabel: "Package", pluralLabel: " Packages " },
    ],
  };
  assert.deepEqual(configureLevelsRpcArgs(input), {
    p_project: "P", p_expected_updated_at: "v1",
    p_levels: [
      { id: "L1", level_number: 1, singular_label: "Package", plural_label: "Packages" },
      { level_number: 2, singular_label: "Area", plural_label: "Areas" },
    ],
  });
  const { calls, client } = fakeClient({ rpc: [{ data: "v2", error: null }] });
  const service = createSupabaseProjectStructureService(() => client);
  assert.deepEqual(await service.configureLevels(input), { version: "v2" });
  assert.equal(calls[0].rpc, "configure_project_structure_levels");
});

test("level RPC: stale and tagged refusals surface as app errors, never retried", async () => {
  const { calls, client } = fakeClient({
    rpc: [
      { data: null, error: { code: "PT409", message: "[STALE] The project changed since this page loaded." } },
      { data: null, error: { code: "23514", message: "[LEVEL_IN_USE] Levels already used ..." } },
      { data: null, error: { code: "42501", message: "[NOT_AUTHORIZED] You cannot configure ..." } },
    ],
  });
  const service = createSupabaseProjectStructureService(() => client);
  const input = { projectId: "P", expectedVersion: "old", levels: [{ levelNumber: 1, singularLabel: "A", pluralLabel: "As" }] };
  await quietly(async () => {
    assert.equal(await reasonOf(service.configureLevels(input)), "stale");
    assert.equal(await reasonOf(service.configureLevels(input)), "level_in_use");
    assert.equal(await reasonOf(service.configureLevels(input)), "not_authorized");
  });
  assert.equal(calls.length, 3, "each call is one attempt — nothing retried");
});

const REF = { id: "A1", updatedAt: "2026-10-03T10:00:00.123456+00:00" };

test("unit writes: one unit, filtered on its id AND the version the caller read", async () => {
  assert.deepEqual(createNodeRow({ projectId: "P", levelNumber: 1, parentId: "ignored", name: " Package A ", code: " ", description: "" }), {
    project_id: "P", level_number: 1, parent_id: null, name: "Package A", code: null, description: null,
    sort_order: 0, weekly_reporting_required: false, monthly_reporting_required: false,
  });
  assert.deepEqual(updateNodePatch({ code: "" }), { code: null });
  assert.deepEqual(updateNodePatch({ name: " New ", sortOrder: 3 }), { name: "New", sort_order: 3 });
  assert.deepEqual(archiveNodePatch("t"), { archived_at: "t", weekly_reporting_required: false, monthly_reporting_required: false });

  const saved = { data: nodeRow("A1", 2, "P2"), error: null };
  const { calls, client } = fakeClient({ project_structure_nodes: [...Array.from({ length: 6 }, () => ({ ...saved })), { data: [{ id: "A1" }], error: null }] });
  const service = createSupabaseProjectStructureService(() => client);
  await service.createNode({ projectId: "P", levelNumber: 2, parentId: "P2", name: "A1" });
  await service.updateNode(REF, { name: "Area" });
  await service.moveNode(REF, "P2");
  await service.setReportingFlags(REF, { monthlyReportingRequired: true });
  await service.archiveNode(REF);
  await service.restoreNode(REF);
  await service.deleteNode(REF);
  const ops = calls.map((c) => c.ops);
  assert.equal(ops[0][0][0], "insert");
  assert.deepEqual(ops[1][0], ["update", { name: "Area" }]);
  assert.deepEqual(ops[2][0], ["update", { parent_id: "P2" }]);
  assert.deepEqual(ops[3][0], ["update", { monthly_reporting_required: true }]);
  assert.equal(ops[4][0][1].archived_at.length > 0 && ops[4][0][1].weekly_reporting_required === false, true);
  assert.deepEqual(ops[5][0], ["update", { archived_at: null }]);
  assert.equal(ops[6][0][0], "delete");
  for (const writeOps of ops.slice(1)) {
    assert.deepEqual(writeOps[1], ["eq", "id", "A1"], "every write targets exactly one unit");
    assert.deepEqual(writeOps[2], ["eq", "updated_at", REF.updatedAt], "and only the version the caller read");
  }
});

test("unit writes: a concurrent change is refused as stale, never silently overwritten", async () => {
  const { calls, client } = fakeClient({
    project_structure_nodes: [
      // The filtered update matches nothing; the unit is still there with a newer version.
      { data: null, error: null }, { data: { id: "A1", updated_at: "2026-10-03T10:05:00+00:00" }, error: null },
      // Same for delete.
      { data: [], error: null }, { data: { id: "A1", updated_at: "2026-10-03T10:05:00+00:00" }, error: null },
      // Unit gone.
      { data: null, error: null }, { data: null, error: null },
      // Unit unchanged but the write matched nothing: RLS refused it.
      { data: null, error: null }, { data: { id: "A1", updated_at: REF.updatedAt }, error: null },
    ],
  });
  const service = createSupabaseProjectStructureService(() => client);
  const stale = await service.updateNode(REF, { name: "Mine" }).catch((e) => e);
  assert.equal(stale.reason, "stale");
  assert.equal(stale.message, "The project changed since this page loaded. Reload before saving.");
  assert.equal(await reasonOf(service.deleteNode(REF)), "stale");
  assert.equal(await reasonOf(service.archiveNode(REF)), "not_found");
  assert.equal(await reasonOf(service.setReportingFlags(REF, { weeklyReportingRequired: true })), "not_authorized");
  assert.equal(calls.length, 8, "one attempt and one diagnosis read each — nothing retried");
});

test("unit writes: database refusals are app-safe", async () => {
  const { client } = fakeClient({
    project_structure_nodes: [
      { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "project_structure_nodes_active_sibling_name_unique"' } },
      { data: null, error: { code: "42501", message: 'new row violates row-level security policy for table "project_structure_nodes"' } },
      { data: null, error: { code: "23514", message: "[REPORTING_OVERLAP] A unit and ..." } },
    ],
  });
  const service = createSupabaseProjectStructureService(() => client);
  await quietly(async () => {
    assert.equal(await reasonOf(service.createNode({ projectId: "P", levelNumber: 1, name: "Dup" })), "duplicate_name");
    assert.equal(await reasonOf(service.createNode({ projectId: "P", levelNumber: 1, name: "Mine" })), "not_authorized");
    assert.equal(await reasonOf(service.setReportingFlags(REF, { weeklyReportingRequired: true })), "reporting_overlap");
  });
});

test("Supabase contract: caller's own client only, the two structure tables and one RPC, no other writes", () => {
  const code = source("./supabase-project-structure-service.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /service_role|SERVICE_ROLE|createClient\(|serviceRole/);
  assert.match(code, /getSupabaseBrowserClient\(\)/);
  const tables = [...code.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tables)].sort(), ["project_structure_levels", "project_structure_nodes", "projects"]);
  assert.deepEqual([...code.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]), ["configure_project_structure_levels"]);
  // The unit's own *_reporting_required flags are the only weekly/monthly names here.
  assert.doesNotMatch(code, /planning_|weekly_(?!reporting_required)|monthly_(?!reporting_required)|project_contacts|departments|disciplines|systems|structure_node_id/);
  assert.doesNotMatch(code, /\.upsert\(/);
  assert.doesNotMatch(code, /from\("projects"\)\.(?:insert|update|delete)|from\("project_structure_levels"\)\.(?:insert|update|delete)/);
  // Every update / delete of a unit carries the caller's version filter.
  assert.match(code, /\.update\(patch\)\s*\.eq\("id", ref\.id\)\s*\.eq\("updated_at", ref\.updatedAt\)/);
  assert.match(code, /\.delete\(\)\.eq\("id", ref\.id\)\.eq\("updated_at", ref\.updatedAt\)/);
  assert.equal((code.match(/\.update\(/g) ?? []).length, 1);
  assert.equal((code.match(/\.delete\(/g) ?? []).length, 1);
});

/* ------------------------------ in-memory mock ----------------------------- */

/** A stand-in for the shared project store: one version per project. */
function projectStore() {
  let tick = Date.parse("2026-10-03T00:00:00Z");
  const next = () => new Date(tick++).toISOString();
  const projects = {
    O: { structureFamily: "other", status: "active", version: next() },
    O2: { structureFamily: "other", status: "active", version: next() },
    PSM: { structureFamily: "psm", status: "active", version: next() },
    LEG: { status: "active", version: next() },
    ARC: { structureFamily: "other", status: "archived", version: next() },
  };
  return {
    projects,
    now: next,
    store: {
      read: async (id) => (projects[id] ? { ...projects[id] } : undefined),
      advance: async (id) => (projects[id].version = next()),
    },
    /** What a Project Information save does to the shared version. */
    saveProjectInfo(id, expected) {
      if (projects[id].version !== expected) throw new Error("Project Setup changed since this page loaded. Reload before saving.");
      projects[id].version = next();
    },
  };
}

function mock() {
  const shared = projectStore();
  return Object.assign(createInMemoryProjectStructureService({ projects: shared.store, now: shared.now }), { shared });
}

const levels = (...names) => names.map((name, index) => ({ levelNumber: index + 1, singularLabel: name, pluralLabel: `${name}s` }));
const keep = (structure) => structure.levels.map((l) => ({ id: l.id, levelNumber: l.levelNumber, singularLabel: l.singularLabel, pluralLabel: l.pluralLabel }));

test("mock: empty structure, level configuration rules, shared version and stale", async () => {
  const service = mock();
  const empty = await service.getStructure("O");
  assert.deepEqual([empty.levels, empty.nodes], [[], []]);
  assert.equal(empty.version, service.shared.projects.O.version, "structure.version is the project's own version");
  assert.equal(await reasonOf(service.getStructure("missing")), "not_found");

  const { version } = await service.configureLevels({ projectId: "O", expectedVersion: empty.version, levels: levels("Package", "Area", "Discipline", "Team") });
  assert.equal(version, service.shared.projects.O.version, "the write advanced the project's own version");
  assert.notEqual(version, empty.version);
  assert.equal(await reasonOf(service.configureLevels({ projectId: "O", expectedVersion: empty.version, levels: levels("A") })), "stale");
  assert.equal(await reasonOf(service.configureLevels({ projectId: "O", expectedVersion: version, levels: levels("a", "b", "c", "d", "e") })), "level_limit");
  assert.equal(await reasonOf(service.configureLevels({ projectId: "O", expectedVersion: version, levels: [{ levelNumber: 1, singularLabel: "A", pluralLabel: "As" }, { levelNumber: 3, singularLabel: "C", pluralLabel: "Cs" }] })), "level_gap");
  assert.equal(await reasonOf(service.configureLevels({ projectId: "O", expectedVersion: version, levels: levels("Area", "area") })), "duplicate_label");
  for (const id of ["PSM", "LEG"]) {
    const s = await service.getStructure(id);
    assert.deepEqual([s.levels, s.nodes], [[], []], "a PSM / legacy project simply has no structure");
    assert.equal(await reasonOf(service.configureLevels({ projectId: id, expectedVersion: s.version, levels: levels("A") })), "not_other");
  }
  const archived = await service.getStructure("ARC");
  assert.equal(await reasonOf(service.configureLevels({ projectId: "ARC", expectedVersion: archived.version, levels: levels("A") })), "project_archived");
});

test("mock: one version per project — Project Information and Structure invalidate each other", async () => {
  const service = mock();
  const { shared } = service;
  // Project Information saved after Structure was read: the Structure token is stale.
  const read = await service.getStructure("O");
  shared.saveProjectInfo("O", read.version);
  assert.equal(await reasonOf(service.configureLevels({ projectId: "O", expectedVersion: read.version, levels: levels("Package") })), "stale");
  // A Structure write: the Project Information token read before it is stale.
  const fresh = await service.getStructure("O");
  const setupToken = shared.projects.O.version;
  assert.equal(fresh.version, setupToken);
  await service.configureLevels({ projectId: "O", expectedVersion: fresh.version, levels: levels("Package") });
  assert.throws(() => shared.saveProjectInfo("O", setupToken), /Reload before saving/);
  // Unit writes advance the same version too.
  const before = shared.projects.O.version;
  await service.createNode({ projectId: "O", levelNumber: 1, name: "Package 1" });
  assert.notEqual(shared.projects.O.version, before);
});

test("mock: unit rules match the database", async () => {
  const service = mock();
  let s = await service.getStructure("O");
  await service.configureLevels({ projectId: "O", expectedVersion: s.version, levels: levels("Package", "Area", "Discipline") });
  let p1 = await service.createNode({ projectId: "O", levelNumber: 1, name: "Package 1", code: "P1", weeklyReportingRequired: true });
  let a1 = await service.createNode({ projectId: "O", levelNumber: 2, parentId: p1.id, name: "Area 1" });
  let d1 = await service.createNode({ projectId: "O", levelNumber: 3, parentId: a1.id, name: "Discipline 1", monthlyReportingRequired: true });

  s = await service.getStructure("O2");
  await service.configureLevels({ projectId: "O2", expectedVersion: s.version, levels: levels("Plant", "Unit") });
  const foreign = await service.createNode({ projectId: "O2", levelNumber: 1, name: "Plant" });

  assert.equal(await reasonOf(service.createNode({ projectId: "O", levelNumber: 3, parentId: p1.id, name: "Skip" })), "parent_level");
  assert.equal(await reasonOf(service.createNode({ projectId: "O", levelNumber: 2, parentId: foreign.id, name: "Cross" })), "parent_invalid");
  assert.equal(await reasonOf(service.createNode({ projectId: "O", levelNumber: 1, name: "package 1" })), "duplicate_name");
  assert.equal(await reasonOf(service.createNode({ projectId: "O", levelNumber: 1, name: "Package 2", code: "p1" })), "duplicate_code");
  assert.equal(await reasonOf(service.createNode({ projectId: "O", levelNumber: 4, name: "Too deep" })), "level_undefined");
  assert.equal(await reasonOf(service.setReportingFlags(a1, { weeklyReportingRequired: true })), "reporting_overlap");
  assert.equal(await reasonOf(service.setReportingFlags(d1, { weeklyReportingRequired: true })), "reporting_overlap");
  assert.equal(await reasonOf(service.setReportingFlags(a1, { monthlyReportingRequired: true })), "reporting_overlap");

  assert.equal(await reasonOf(service.archiveNode(a1)), "active_children");
  assert.equal(await reasonOf(service.deleteNode(a1)), "has_children");
  d1 = await service.archiveNode(d1);
  assert.equal(d1.monthlyReportingRequired, false, "archiving clears the flags");
  a1 = await service.archiveNode(a1);
  assert.equal(await reasonOf(service.restoreNode(d1)), "parent_archived");
  assert.equal(await reasonOf(service.setReportingFlags(d1, { weeklyReportingRequired: true })), "archived_reporting");
  a1 = await service.restoreNode(a1);
  d1 = await service.restoreNode(d1);

  const p2 = await service.createNode({ projectId: "O", levelNumber: 1, name: "Package 2" });
  a1 = await service.moveNode(a1, p2.id);
  assert.equal(a1.parentId, p2.id);
  assert.equal(await reasonOf(service.moveNode(d1, p1.id)), "parent_level");
  d1 = await service.setReportingFlags(d1, { weeklyReportingRequired: true });
  assert.equal(await reasonOf(service.moveNode(a1, p1.id)), "reporting_overlap", "an unflagged unit with a flagged descendant cannot move under a flagged parent");
  assert.equal(await reasonOf(service.updateNode({ id: p1.id, updatedAt: "1999-01-01T00:00:00.000Z" }, { name: "Old view" })), "stale");
  p1 = (await service.getStructure("O")).nodes.find((n) => n.id === p1.id);
  assert.equal(p1.name, "Package 1");
});

test("mock: level changes once units exist follow the RPC exactly — including no id on an appended level", async () => {
  const service = mock();
  let s = await service.getStructure("O");
  await service.configureLevels({ projectId: "O", expectedVersion: s.version, levels: levels("Package", "Area") });
  const p1 = await service.createNode({ projectId: "O", levelNumber: 1, name: "Package 1" });
  await service.createNode({ projectId: "O", levelNumber: 2, parentId: p1.id, name: "Area 1" });
  s = await service.getStructure("O");
  const [l1, l2] = s.levels;

  assert.equal(await reasonOf(service.configureLevels({ projectId: "O", expectedVersion: s.version, levels: [
    ...keep(s), { id: l1.id, levelNumber: 3, singularLabel: "Team", pluralLabel: "Teams" },
  ] })), "invalid_levels", "an appended level carrying an existing id is refused");
  assert.equal(await reasonOf(service.configureLevels({ projectId: "O", expectedVersion: s.version, levels: [
    ...keep(s), { id: "c3f1b5a0-0000-4000-a000-000000000099", levelNumber: 3, singularLabel: "Team", pluralLabel: "Teams" },
  ] })), "invalid_levels", "and so is one carrying any id");
  assert.equal(await reasonOf(service.configureLevels({ projectId: "O", expectedVersion: s.version, levels: [
    { id: l1.id, levelNumber: 1, singularLabel: "Package", pluralLabel: "Packages" },
    { levelNumber: 2, singularLabel: "Zone", pluralLabel: "Zones" },
    { id: l2.id, levelNumber: 3, singularLabel: "Area", pluralLabel: "Areas" },
  ] })), "level_in_use", "middle insertion stays refused");

  const appended = await service.configureLevels({ projectId: "O", expectedVersion: s.version, levels: [
    ...keep(s), { levelNumber: 3, singularLabel: "Team", pluralLabel: "Teams" },
  ] });
  const after = await service.getStructure("O");
  assert.equal(after.version, appended.version);
  assert.deepEqual(after.levels.map((l) => l.id).slice(0, 2), [l1.id, l2.id], "kept levels keep their ids");
  await service.configureLevels({ projectId: "O", expectedVersion: after.version, levels: keep(s) });
  assert.equal((await service.getStructure("O")).levels.length, 2, "the deepest unused level can be removed");
});

test("mock concurrency: a stale copy is never written back after an await", async () => {
  const service = mock();
  const s = await service.getStructure("O");
  await service.configureLevels({ projectId: "O", expectedVersion: s.version, levels: levels("Package") });
  const unit = await service.createNode({ projectId: "O", levelNumber: 1, name: "Package 1" });

  // Two concurrent edits from the same view: the first lands, the second is
  // refused as stale — the first edit is never lost.
  const [renamed, coded] = await Promise.allSettled([
    service.updateNode(unit, { name: "Package One" }),
    service.updateNode(unit, { code: "PKG-1" }),
  ]);
  assert.equal(renamed.status, "fulfilled");
  assert.equal(coded.status, "rejected");
  assert.equal(coded.reason.reason, "stale");
  let now = (await service.getStructure("O")).nodes[0];
  assert.deepEqual([now.name, now.code], ["Package One", undefined]);

  // Compatible edits applied in turn (each from the current version) both persist.
  const second = await service.updateNode(now, { code: "PKG-1" });
  assert.deepEqual([second.name, second.code], ["Package One", "PKG-1"]);

  // Archive racing an unrelated edit from the same view can never un-archive.
  const [archived, edited] = await Promise.allSettled([
    service.archiveNode(second),
    service.updateNode(second, { description: "Late edit" }),
  ]);
  assert.equal(archived.status, "fulfilled");
  assert.equal(edited.status, "rejected");
  assert.equal(edited.reason.reason, "stale");
  now = (await service.getStructure("O")).nodes[0];
  assert.ok(now.archivedAt, "still archived");
  assert.equal(now.description, undefined);

  // In the other order the edit lands and the archive (from the old view) is refused.
  const restored = await service.restoreNode(now);
  const [edit2, archive2] = await Promise.allSettled([
    service.updateNode(restored, { description: "First" }),
    service.archiveNode(restored),
  ]);
  assert.deepEqual([edit2.status, archive2.status, archive2.reason?.reason], ["fulfilled", "rejected", "stale"]);
  now = (await service.getStructure("O")).nodes[0];
  assert.deepEqual([now.archivedAt, now.description], [undefined, "First"]);
});

test("mock wiring: structure shares the mock project store's version with Project Setup (both directions)", async () => {
  // A child process isolates service selection from the developer's environment
  // (as in project-identity.test.mjs) and uses the real mock project service.
  const { spawnSync } = await import("node:child_process");
  const script = `
    import assert from 'node:assert/strict';
    import { projectService, listProjectsSync } from './src/services/project-service.ts';
    import { projectStructureService } from './src/services/project-structure-service.ts';
    const { id: _i, createdAt: _c, updatedAt: _u, ...base } = listProjectsSync()[0];
    const project = await projectService.createProject({ ...base, structureFamily: 'other', status: 'active' });
    const levels = [{ levelNumber: 1, singularLabel: 'Package', pluralLabel: 'Packages' }];

    // Project Information saved after Structure was read: Structure token stale.
    const read = await projectStructureService.getStructure(project.id);
    assert.equal(read.version, project.updatedAt);
    await projectService.updateProject(project.id, { name: project.name + ' (renamed)' }, read.version);
    await assert.rejects(projectStructureService.configureLevels({ projectId: project.id, expectedVersion: read.version, levels }),
      (e) => e.reason === 'stale');

    // Structure write: the Project Setup token read before it is stale.
    const setupToken = (await projectService.getProjectById(project.id)).updatedAt;
    const fresh = await projectStructureService.getStructure(project.id);
    assert.equal(fresh.version, setupToken);
    const { version } = await projectStructureService.configureLevels({ projectId: project.id, expectedVersion: fresh.version, levels });
    assert.equal((await projectService.getProjectById(project.id)).updatedAt, version);
    await assert.rejects(projectService.updateProject(project.id, { name: 'x' }, setupToken), /Reload before saving/);
  `;
  const result = spawnSync(process.execPath, ["--experimental-transform-types", "--import", "./src/features/notifications/test-runtime.mjs", "--input-type=module", "-e", script], {
    cwd: new URL("../../", import.meta.url),
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("the service contract exposes no bulk write and no future-phase fields", () => {
  const contract = source("./project-structure-service.ts");
  const iface = contract.slice(contract.indexOf("export interface ProjectStructureService"), contract.indexOf("/* ------------------------------ in-memory mock"));
  assert.deepEqual([...iface.matchAll(/^  (\w+)\(/gm)].map((m) => m[1]), [
    "getStructure", "configureLevels", "createNode", "updateNode", "moveNode",
    "setReportingFlags", "archiveNode", "restoreNode", "deleteNode",
  ]);
  // Every change to an existing unit carries the unit's version.
  for (const method of ["updateNode", "moveNode", "setReportingFlags", "archiveNode", "restoreNode", "deleteNode"]) {
    assert.match(iface, new RegExp(`  ${method}\\(node: StructureNodeVersion`), method);
  }
  const types = readFileSync(new URL("../types/project-structure.ts", import.meta.url), "utf8");
  for (const forbidden of [/departmentId/, /disciplineId/, /systemId/, /planning/i, /reviewer|approver|consolidat(?:ed|or)Owner|rollUp/]) {
    assert.doesNotMatch(types.replace(/\/\*[\s\S]*?\*\//g, ""), forbidden);
  }
  assert.doesNotMatch(contract + types, /structure_node_id|structureNodeId/);
  // The mock has no private version map: it reads and advances the project store.
  assert.doesNotMatch(contract, /versions\s*=\s*new Map/);
  assert.match(contract, /options\.projects\.advance\(/);
});

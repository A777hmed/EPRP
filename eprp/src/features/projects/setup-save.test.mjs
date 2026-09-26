import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  confirmSetupSave,
  collectSetupRelations,
  isSetupDraftDirty,
  reconcileSetupSave,
  relationForSetupStep,
} from "./setup-save.ts";

const baseline = {
  id: "project-1",
  updatedAt: "v1",
  departments: [{ departmentId: "a", systems: [] }],
  disciplines: [{ disciplineId: "d" }],
  team: [{ contactId: "p" }],
};

test("each editable step owns exactly one relation", () => {
  assert.equal(relationForSetupStep("departments"), "departments");
  assert.equal(relationForSetupStep("systems"), "departments");
  assert.equal(relationForSetupStep("disciplines"), "disciplines");
  assert.equal(relationForSetupStep("contacts"), "team");
  for (const step of ["info", "team", "review"]) {
    assert.equal(relationForSetupStep(step), null);
  }
});

test("confirmed save clears dirty state, and another edit restores it", async () => {
  const submitted = {
    ...baseline,
    departments: [{ departmentId: "a", systems: [{ id: "s" }] }],
  };
  const saved = { ...submitted, updatedAt: "v2" };
  const confirmed = await confirmSetupSave(async () => "v2", async () => saved);
  const next = reconcileSetupSave(baseline, submitted, submitted, confirmed, "departments");
  assert.equal(isSetupDraftDirty(next, confirmed), false);
  assert.equal(
    isSetupDraftDirty({ ...next, departments: [] }, confirmed),
    true
  );
});

test("a failed or partial write never confirms a new baseline", async () => {
  let reads = 0;
  for (const message of ["insert failed", "partial write rejected", "stale project version", "unauthorized access", "NULL payload rejected"]) {
    await assert.rejects(
      confirmSetupSave(
        async () => { throw new Error(message); },
        async () => { reads++; return baseline; }
      ),
      new RegExp(message)
    );
  }
  assert.equal(reads, 0);
  assert.equal(isSetupDraftDirty({ ...baseline, team: [] }, baseline), true);
});

test("confirmation preserves all timestamp precision through JSON transport", async () => {
  const version = "2026-09-26T12:34:56.123456+00:00";
  const saved = JSON.parse(JSON.stringify({ ...baseline, updatedAt: version }));
  assert.equal(await confirmSetupSave(async () => version, async () => saved), saved);
  await assert.rejects(
    confirmSetupSave(async () => version, async () => ({ ...saved, updatedAt: "2026-09-26T12:34:56.123457+00:00" })),
    /changed again/
  );
});

// These are source contracts, not an execution of PostgreSQL or its RLS policies.
const migration = readFileSync(new URL("../../../supabase/migrations/20260926000002_project_setup_atomic_save.sql", import.meta.url), "utf8");

test("SQL contract rejects NULL authorization and NULL or invalid relations before writing", () => {
  assert.match(migration, /if public\.can_manage_project_setup\(p_project\) is distinct from true then\s+raise exception[^;]+42501/s);
  assert.match(migration, /if p_relation is null or p_relation not in \('departments', 'disciplines', 'team', 'positions', 'sites', 'delegations'\)/);
  assert.match(migration, /p_rows is null or jsonb_typeof\(p_rows\) <> 'array'/);
  const relationRpc = migration.slice(migration.indexOf("create function public.save_project_setup_relation("));
  assert.ok(relationRpc.indexOf("'22023'") < relationRpc.indexOf("update public.projects"));
});

test("legacy payload preserves ownership and rejects unloaded relations before transport", () => {
  assert.deepEqual(collectSetupRelations({ name: "Renamed", team: [] }), { team: [] });
  assert.deepEqual(collectSetupRelations({ departments: baseline.departments, disciplines: baseline.disciplines }), {
    departments: baseline.departments, disciplines: baseline.disciplines,
  });
  for (const relation of ["departments", "disciplines", "team", "sites", "positions", "delegations"]) {
    assert.throws(() => collectSetupRelations({ [relation]: undefined }), /not finished loading/);
    assert.throws(() => collectSetupRelations({ [relation]: null }), /not finished loading/);
  }
});

test("batch reconciliation clears saved fields while retaining other steps and in-flight edits", () => {
  const submitted = { ...baseline, departments: [], disciplines: [] };
  const saved = { ...submitted, updatedAt: "v2" };
  const latest = { ...submitted, disciplines: [{ disciplineId: "new" }], team: [] };
  const next = reconcileSetupSave(baseline, submitted, latest, saved, ["departments", "disciplines"]);
  assert.deepEqual(next.departments, saved.departments);
  assert.deepEqual(next.disciplines, latest.disciplines);
  assert.deepEqual(next.team, latest.team);
  assert.equal(isSetupDraftDirty(next, saved), true);
  const infoRefresh = reconcileSetupSave(baseline, baseline, latest, { ...baseline, name: "Saved info", updatedAt: "v2" }, []);
  assert.deepEqual(infoRefresh.team, latest.team);
  assert.deepEqual(infoRefresh.departments, latest.departments);
  assert.equal(infoRefresh.name, "Saved info");
});

test("a write without a version or a failed confirmation never clears dirty data", async () => {
  let reads = 0;
  await assert.rejects(confirmSetupSave(async () => "", async () => { reads++; return baseline; }), /no confirmed/);
  assert.equal(reads, 0);
  await assert.rejects(confirmSetupSave(async () => "v2", async () => { throw new Error("read failed"); }), /read failed/);
});

test("SQL contract keeps invoker authorization, stale guard and rollback propagation", () => {
  assert.match(migration, /security invoker\s+set search_path = ''/);
  assert.match(migration, /where id = p_project and updated_at = p_expected_updated_at/);
  assert.match(migration, /if not found then\s+raise exception[^;]+40001/s);
  assert.match(migration, /if v_actual_count <> jsonb_array_length\(p_rows\) then\s+raise exception[^;]+P0001/s);
  assert.doesNotMatch(migration, /exception\s+when|\bcommit\s*;|\brollback\s*;/i);
  assert.match(migration, /from public, anon;/);
  assert.match(migration, /return v_saved_at;/);
});

test("missing or changed read-back refuses confirmation", async () => {
  await assert.rejects(confirmSetupSave(async () => "v2", async () => null), /could not be read back/);
  await assert.rejects(confirmSetupSave(async () => "v2", async () => baseline), /changed again/);
});

test("save reconciliation preserves unrelated unsaved edits and edits made while saving", () => {
  const submitted = { ...baseline, departments: [] };
  const latest = {
    ...submitted,
    departments: [{ departmentId: "new", systems: [] }],
    team: [{ contactId: "new-person" }],
  };
  const saved = { ...baseline, departments: [], updatedAt: "v2" };
  const next = reconcileSetupSave(baseline, submitted, latest, saved, "departments");
  assert.deepEqual(next.departments, latest.departments);
  assert.deepEqual(next.team, latest.team);
  assert.equal(next.updatedAt, "v2");
  assert.equal(isSetupDraftDirty(next, saved), true);
});

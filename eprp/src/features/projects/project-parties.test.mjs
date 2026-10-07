import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { persistProjectParties, subcontractorsForSave } from "./project-parties.ts";
import { collectSetupRelations } from "./setup-save.ts";
import { computeSectionStatuses, labelForPath } from "./form-meta.ts";
import { createProjectDraftSchema, createProjectFinalSchema, emptyProjectFormValues,
  formValuesToProjectInfoUpdate, formValuesToProjectInput, projectToFormValues } from "./schemas/project-form.ts";
import { evaluateDraftWorkflow, resolveSetupSteps } from "../../config/project-workflow.ts";

const valid = (family = "other", subcontractors = []) => ({
  ...emptyProjectFormValues(), name: "Party foundation project", code: "PARTY-01",
  structureFamily: family, projectTypeId: family === "other" ? "category" : "",
  clientId: "client-a", description: "Project parties regression", currentPhaseId: "phase",
  plannedStartDate: "2026-01-01", plannedFinishDate: "2026-12-31", site: "Site",
  projectManagerId: "pm", projectControlManagerId: "pcm", reportingCoordinatorId: "rc", subcontractors,
});
let sequence = 0;
const newId = () => `party-${++sequence}`;

test("zero subcontractors is valid and Project Information is complete for PSM and Other", () => {
  for (const family of ["psm", "other"]) {
    const values = valid(family);
    const schema = createProjectFinalSchema([], { requireStructureFamily: true });
    assert.equal(schema.safeParse(values).success, true);
    assert.deepEqual(computeSectionStatuses(values, schema, {})[1], { kind: "complete", missingCount: 0 });
    const input = formValuesToProjectInput(values);
    const status = evaluateDraftWorkflow(input, resolveSetupSteps(input))[0];
    assert.equal(status.complete, true);
    assert.equal(status.passedCount, status.total);
    const parties = persistProjectParties(undefined, input.parties, newId);
    assert.deepEqual(parties.map((party) => party.kind), ["eprom", "owner"]);
    assert.deepEqual(collectSetupRelations({ parties }), { parties: [] });
  }
});

test("blank configured subcontractor must be named or removed, including on drafts", () => {
  for (const schema of [createProjectDraftSchema([]), createProjectFinalSchema([])]) {
    const parsed = schema.safeParse(valid("other", [{ name: "   " }]));
    assert.equal(parsed.success, false);
    assert.ok(parsed.error.issues.some((issue) => issue.path.join(".") === "subcontractors.0.name"));
  }
  assert.equal(labelForPath(["subcontractors", 1, "name"]), "Subcontractor 2 — Name");
});

test("multiple subcontractors preserve saved identities and explicit ordering through the form", () => {
  const input = formValuesToProjectInput(valid("other", [{ name: "Alpha" }, { name: "Beta" }]));
  const parties = persistProjectParties(undefined, input.parties, newId);
  const project = { ...input, id: "project", parties, createdAt: "v1", updatedAt: "v1" };
  const refreshed = projectToFormValues(structuredClone(project));
  assert.deepEqual(refreshed.subcontractors.map((party) => party.name), ["Alpha", "Beta"]);
  const reversed = { ...refreshed, subcontractors: refreshed.subcontractors.toReversed() };
  const patch = formValuesToProjectInfoUpdate(reversed);
  const saved = persistProjectParties(parties, patch.parties, newId);
  assert.deepEqual(saved.slice(2).map((party) => party.id), parties.slice(2).toReversed().map((party) => party.id));
  assert.deepEqual(saved.slice(2).map((party) => party.sortOrder), [0, 1]);
  assert.equal("departments" in patch, false);
  assert.equal("team" in patch, false);
  assert.equal("structureFamily" in patch, false);
});

test("subcontractor removal and Client change retain EPROM and Owner identity", () => {
  const input = formValuesToProjectInput(valid("other", [{ name: "Alpha" }]));
  const parties = persistProjectParties(undefined, input.parties, newId);
  const project = { ...input, id: "project", parties, createdAt: "v1", updatedAt: "v1" };
  const values = { ...projectToFormValues(project), clientId: "client-b", subcontractors: [] };
  const patch = formValuesToProjectInfoUpdate(values);
  assert.equal(patch.clientId, "client-b");
  const saved = persistProjectParties(parties, patch.parties, newId);
  assert.deepEqual(saved, parties.slice(0, 2));
  assert.ok(saved.every((party) => !("clientId" in party) && !("name" in party)));
});

test("legacy projects without party data remain readable and do not invent subcontractors", () => {
  const legacy = formValuesToProjectInput(valid());
  delete legacy.parties;
  assert.deepEqual(projectToFormValues(legacy).subcontractors, []);
  assert.deepEqual(collectSetupRelations(legacy).parties, undefined);
  assert.throws(() => collectSetupRelations({ parties: undefined }), /not finished loading/);
  assert.throws(() => collectSetupRelations({ parties: null }), /not finished loading/);
});

test("subcontractor identities cannot be duplicated, cross-project, or inferred from a name", () => {
  assert.throws(() => persistProjectParties([], [{ id: "elsewhere", kind: "subcontractor", name: "Alpha", sortOrder: 0 }], newId), /does not belong/);
  const sameName = persistProjectParties(undefined, [0, 1].map((sortOrder) => ({ kind: "subcontractor", name: "Same company", sortOrder })), newId);
  assert.notEqual(sameName[2].id, sameName[3].id);
  assert.throws(() => subcontractorsForSave([sameName[2], sameName[2]]), /appear twice/);
});

// SQL source contracts only: no PostgreSQL/RLS execution or migration application.
const sql = readFileSync(new URL("../../../supabase/migrations/20261006123219_project_parties_foundation.sql", import.meta.url), "utf8").replaceAll("\r", "");
test("schema enforces required kinds, names, immutable identities and project ownership", () => {
  assert.match(sql, /unique index project_parties_required_kind[\s\S]*?where kind in \('eprom', 'owner'\)/);
  assert.match(sql, /v_count <> 2/);
  assert.match(sql, /deferrable initially deferred/);
  assert.match(sql, /references public.projects\(id\) on delete cascade/);
  assert.match(sql, /new.id is distinct from old.id[\s\S]*?new.kind is distinct from old.kind/);
  assert.match(sql, /kind = 'subcontractor' and name is not null/);
  assert.match(sql, /length\(name\) between 1 and 140/);
  assert.doesNotMatch(sql, /alter table public.projects|contacts.organization|create table public.clients/i);
});

test("unauthorized callers cannot write parties; fixed parties are never editable through client RLS", () => {
  assert.match(sql, /alter table public.project_parties enable row level security/);
  assert.match(sql, /revoke all on table public.project_parties from public, anon, authenticated/);
  for (const operation of ["insert", "update", "delete"]) {
    const policy = sql.slice(sql.indexOf(`create policy project_parties_${operation}`)).split(";")[0];
    assert.match(policy, /kind = 'subcontractor' and public.can_manage_project_setup\(project_id\)/);
  }
  const rpc = sql.slice(sql.indexOf("create or replace function public.save_project_setup_relation"));
  assert.ok(rpc.indexOf("public.can_manage_project_setup") < rpc.indexOf("update public.projects"));
  assert.match(rpc, /is distinct from true[\s\S]*?errcode = '42501'/);
  assert.match(rpc, /security invoker\s+set search_path = ''/);
  assert.match(rpc, /errcode = 'PT409'/);
  assert.match(sql, /revoke execute on function public.initialize_project_parties\(\) from public, anon, authenticated, service_role/);
});

test("additive backfill precedes invalidation and relation save cannot delete required parties", () => {
  const backfill = sql.slice(sql.indexOf("insert into public.project_parties"), sql.indexOf("create function public.initialize_project_parties"));
  assert.match(backfill, /from public.projects p cross join \(values \('eprom', 0\), \('owner', 1\)\)/);
  assert.doesNotMatch(backfill, /update public.projects|delete from/i);
  assert.ok(sql.indexOf("cross join") < sql.indexOf("create trigger invalidate_setup_project_version"));
  const branch = sql.split("elsif p_relation = 'parties' then")[1].split("elsif p_relation = 'positions'")[0];
  assert.match(branch, /delete from public.project_parties\s+where project_id = p_project and kind = 'subcontractor'/);
  assert.match(branch, /where id = v_id and project_id = p_project and kind = 'subcontractor'/);
  assert.match(branch, /errcode = '23503'/);
});

test("existing relation dispatcher branches and authority remain unchanged", () => {
  const baseline = readFileSync(new URL("../../../supabase/migrations/20261004000001_stale_conflict_sqlstate_pt409.sql", import.meta.url), "utf8").replaceAll("\r", "");
  const rpcOf = (text) => text.slice(text.indexOf("create or replace function public.save_project_setup_relation("), text.indexOf("/* ---- save_project_setup_patch"));
  const current = sql.slice(sql.indexOf("create or replace function public.save_project_setup_relation("))
    .replace(", 'parties')", ")")
    .replace(/  elsif p_relation = 'parties' then[\s\S]*?(?=  elsif p_relation = 'positions' then)/, "");
  assert.equal(current.trim(), rpcOf(baseline).trim());
  assert.doesNotMatch(sql, /create or replace function public.(configure_project_structure_levels|correct_project_structure_family|replace_project_person)/);
});

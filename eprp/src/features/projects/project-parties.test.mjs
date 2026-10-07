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
/** A complete 2C.3B subcontractor form row. */
const subRow = (name, extra = {}) => ({ name, shortName: "", scope: `${name} package`, contractReference: "", engagementStatus: "active", ...extra });
const blankRow = () => ({ name: "", shortName: "", scope: "", contractReference: "", engagementStatus: "" });
const sub = (name, sortOrder = 0, extra = {}) => ({ kind: "subcontractor", name, scope: `${name} package`, engagementStatus: "planned", sortOrder, ...extra });

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

test("blank configured subcontractor must be completed or removed, including on drafts", () => {
  for (const schema of [createProjectDraftSchema([]), createProjectFinalSchema([])]) {
    const parsed = schema.safeParse(valid("other", [{ ...blankRow(), name: "   " }]));
    assert.equal(parsed.success, false);
    const paths = parsed.error.issues.map((issue) => issue.path.join("."));
    for (const field of ["name", "scope", "engagementStatus"]) assert.ok(paths.includes(`subcontractors.0.${field}`), field);
    assert.ok(!paths.includes("subcontractors.0.shortName") && !paths.includes("subcontractors.0.contractReference"));
  }
  assert.equal(labelForPath(["subcontractors", 1, "name"]), "Subcontractor 2 — Registered Company Name");
  assert.equal(labelForPath(["subcontractors", 0, "scope"]), "Subcontractor 1 — Scope / Package");
  assert.equal(labelForPath(["subcontractors", 0, "engagementStatus"]), "Subcontractor 1 — Engagement Status");
});

test("multiple subcontractors preserve saved identities and explicit ordering through the form", () => {
  const input = formValuesToProjectInput(valid("other", [subRow("Alpha"), subRow("Beta")]));
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
  const input = formValuesToProjectInput(valid("other", [subRow("Alpha")]));
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
  assert.throws(() => persistProjectParties([], [{ ...sub("Alpha"), id: "elsewhere" }], newId), /does not belong/);
  const two = persistProjectParties(undefined, [sub("Alpha"), sub("Beta", 1)], newId);
  assert.notEqual(two[2].id, two[3].id);
  assert.throws(() => subcontractorsForSave([two[2], two[2]]), /appear twice/);
  // Renaming keeps the stable UUID: the name is a business label, not identity.
  const renamed = persistProjectParties(two, [{ ...two[2], name: "Alpha Holdings" }, two[3]], newId);
  assert.deepEqual(renamed.slice(2).map((party) => party.id), [two[2].id, two[3].id]);
});

test("2C.3B: duplicate company names are blocked by trim + case-insensitive comparison in schema and save", () => {
  for (const schema of [createProjectDraftSchema([]), createProjectFinalSchema([])]) {
    const parsed = schema.safeParse(valid("psm", [subRow("Alpha Ltd"), subRow("Beta"), subRow("  alpha ltd  ")]));
    assert.equal(parsed.success, false);
    const duplicate = parsed.error.issues.filter((issue) => /already listed/.test(issue.message));
    assert.deepEqual(duplicate.map((issue) => issue.path.join(".")), ["subcontractors.2.name"]);
  }
  assert.throws(() => subcontractorsForSave([sub("Alpha Ltd"), sub(" ALPHA LTD", 1)]), /only once per project/);
  assert.throws(() => persistProjectParties(undefined, [sub("Same"), sub("same", 1)], newId), /only once per project/);
  // Distinct companies whose names merely share a prefix are allowed.
  assert.equal(subcontractorsForSave([sub("Alpha"), sub("Alpha Ltd", 1)]).length, 2);
});

test("2C.3B: professional fields are trimmed, optional fields stay optional, and lengths match the database", () => {
  const [row] = subcontractorsForSave([sub("  Alpha Contracting Co.  ", 0, {
    shortName: "  ACC ", scope: "  HVAC package ", contractReference: "  ", engagementStatus: "completed" })]);
  assert.deepEqual(row, { id: undefined, kind: "subcontractor", name: "Alpha Contracting Co.", shortName: "ACC",
    scope: "HVAC package", contractReference: undefined, engagementStatus: "completed", sortOrder: 0 });
  const schema = createProjectFinalSchema([]);
  const ok = valid("other", [subRow("A".repeat(140), { shortName: "S".repeat(40), scope: "P".repeat(250), contractReference: "R".repeat(100) })]);
  assert.equal(schema.safeParse(ok).success, true);
  for (const [field, length] of [["name", 141], ["shortName", 41], ["scope", 251], ["contractReference", 101]]) {
    const parsed = schema.safeParse(valid("other", [subRow("Alpha", { [field]: "x".repeat(length) })]));
    assert.equal(parsed.success, false, field);
    assert.ok(parsed.error.issues.some((issue) => issue.path.join(".") === `subcontractors.0.${field}`), field);
    assert.throws(() => subcontractorsForSave([sub("Alpha", 0, { [field]: "x".repeat(length) })]), /up to/, field);
  }
});

test("2C.3B: Engagement Status is controlled and never defaulted", () => {
  for (const status of ["planned", "active", "suspended", "completed"]) {
    assert.equal(subcontractorsForSave([sub("Alpha", 0, { engagementStatus: status })])[0].engagementStatus, status);
  }
  for (const status of [undefined, "", "Active", "terminated"]) {
    assert.throws(() => subcontractorsForSave([sub("Alpha", 0, { engagementStatus: status })]), /engagement status/);
  }
  const parsed = createProjectFinalSchema([]).safeParse(valid("other", [subRow("Alpha", { engagementStatus: "" })]));
  assert.deepEqual(parsed.error.issues.map((issue) => [issue.path.join("."), issue.message]),
    [["subcontractors.0.engagementStatus", "Select an engagement status"]]);
  const input = formValuesToProjectInput(valid("other", [subRow("Alpha", { engagementStatus: "" })]));
  assert.equal(input.parties[0].engagementStatus, undefined);
});

test("2C.3B: PSM and Other share completion — zero is Complete, complete rows are Complete, legacy rows Need completion", () => {
  for (const family of ["psm", "other"]) {
    const input = formValuesToProjectInput(valid(family));
    const infoOf = (parties) => evaluateDraftWorkflow({ ...input, parties }, resolveSetupSteps(input))[0];
    const fixed = persistProjectParties(undefined, [], newId);
    const zero = infoOf(fixed);
    assert.equal(zero.complete, true);
    assert.equal(zero.checks.some((check) => /Subcontractor/.test(check.label)), false);
    assert.equal(zero.total, infoOf(undefined).total);
    const complete = infoOf(persistProjectParties(undefined, [sub("Alpha")], newId));
    assert.equal(complete.complete, true);
    assert.equal(complete.passedCount, complete.total);
    for (const legacy of [{ id: "l1", kind: "subcontractor", name: "Legacy", sortOrder: 0 },
      { id: "l2", kind: "subcontractor", name: "Legacy", scope: "Civil", sortOrder: 0 },
      { id: "l3", kind: "subcontractor", name: "Legacy", engagementStatus: "active", sortOrder: 0 }]) {
      const status = infoOf([...fixed, legacy]);
      assert.equal(status.complete, false, legacy.id);
      const failed = status.checks.filter((check) => !check.passed);
      assert.deepEqual(failed.map((check) => check.label), ["Subcontractor details complete"]);
      assert.match(failed[0].hint, /1 subcontractor needs Scope \/ Package and Engagement Status/);
    }
  }
});

test("2C.3B: a save without a parties relation leaves stored rows, including legacy rows, untouched", () => {
  const legacy = { id: "legacy", kind: "subcontractor", name: "Legacy", sortOrder: 0 };
  const stored = [...persistProjectParties(undefined, [], newId), legacy];
  assert.deepEqual(persistProjectParties(stored, undefined, newId), stored);
  assert.throws(() => persistProjectParties(stored, [legacy], newId), /scope/);
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

// 2C.3B SQL source contracts only: no PostgreSQL execution and the migration is not applied.
const professionalSql = readFileSync(new URL("../../../supabase/migrations/20261007120000_project_parties_professional_information.sql", import.meta.url), "utf8").replaceAll("\r", "");
// Executable DDL only: line comments and COMMENT ON documentation are removed.
const professionalDdl = professionalSql.slice(0, professionalSql.indexOf("create or replace function"))
  .replace(/--.*$/gm, "").replace(/comment on column[\s\S]*?;/g, "");
test("2C.3B migration is additive: nullable columns, no backfill, no default, no enum, no unique index", () => {
  assert.match(professionalDdl, /add column short_name text,\s+add column scope text,\s+add column contract_reference text,\s+add column engagement_status text;/);
  assert.doesNotMatch(professionalDdl, /\bdefault\b|create type|create (unique )?index|^\s*update |^\s*delete |^\s*insert |drop /im);
  // The DDL and the new parties branch touch no people, structure or chart data.
  const branch = professionalSql.split("elsif p_relation = 'parties' then")[1].split("elsif p_relation = 'positions'")[0];
  for (const text of [professionalDdl, branch]) {
    assert.doesNotMatch(text, /alter table public\.projects|create table|contact|project_structure|organization|responsib/i);
  }
});

test("2C.3B constraints: shape is validated, required professional data is NOT VALID for legacy rows", () => {
  const shape = professionalDdl.slice(professionalDdl.indexOf("project_parties_professional_shape"), professionalDdl.indexOf("project_parties_subcontractor_professional_required"));
  assert.match(shape, /kind in \('eprom', 'owner'\)\s+and short_name is null and scope is null\s+and contract_reference is null and engagement_status is null/);
  assert.match(shape, /length\(short_name\) between 1 and 40/);
  assert.match(shape, /length\(scope\) between 1 and 250/);
  assert.match(shape, /length\(contract_reference\) between 1 and 100/);
  assert.match(shape, /engagement_status in \('planned', 'active', 'suspended', 'completed'\)/);
  assert.doesNotMatch(shape, /not valid/);
  assert.match(professionalDdl, /project_parties_subcontractor_professional_required check \(\s+kind <> 'subcontractor' or \(scope is not null and engagement_status is not null\)\s+\) not valid;/);
});

test("2C.3B save function: only the parties branch changes; it requires professional data and refuses duplicates", () => {
  const rpcOf = (text) => text.slice(text.indexOf("create or replace function public.save_project_setup_relation("));
  const withoutParties = (text) => rpcOf(text).replace(/  elsif p_relation = 'parties' then[\s\S]*?(?=  elsif p_relation = 'positions' then)/, "");
  assert.equal(withoutParties(professionalSql), withoutParties(sql));
  const branch = professionalSql.split("elsif p_relation = 'parties' then")[1].split("elsif p_relation = 'positions'")[0];
  assert.match(branch, /group by lower\(btrim\(x\.value->>'name'\)\) having count\(\*\) > 1[\s\S]*?errcode = '23505'/);
  assert.ok(branch.indexOf("having count(*) > 1") < branch.indexOf("insert into public.project_parties"));
  assert.match(branch, /length\(btrim\(v_item->>'scope'\)\) not between 1 and 250/);
  assert.match(branch, /jsonb_typeof\(v_item->'engagementStatus'\) is distinct from 'string'/);
  assert.match(branch, /v_item->>'engagementStatus' not in \('planned', 'active', 'suspended', 'completed'\)/);
  assert.match(branch, /length\(btrim\(coalesce\(v_item->>'shortName', ''\)\)\) > 40/);
  assert.match(branch, /length\(btrim\(coalesce\(v_item->>'contractReference', ''\)\)\) > 100/);
  assert.match(branch, /where id = v_id and project_id = p_project and kind = 'subcontractor'/);
  assert.match(branch, /delete from public.project_parties\s+where project_id = p_project and kind = 'subcontractor'/);
  assert.doesNotMatch(branch, /'planned'\s*\)?\s*,\s*cardinality|coalesce\(v_item->>'engagementStatus'/);
  assert.match(professionalSql, /grant execute on function public.save_project_setup_relation\(uuid, timestamptz, text, jsonb\)\s+to authenticated, service_role;/);
});

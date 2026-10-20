import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

// Phase 13.9B — Step 4: structure / scope governance + slice closeout.
// SOURCE / PRESENTATION CONTRACTS. The database is authoritative (migration
// 20261019090000); these prove what the screens OFFER, how a request is
// worded and sent, and that the migration keeps the shape the runtime suite
// (scripts/p0-validation/126) exercises.

registerHooks({ load(url, context, nextLoad) {
  if (!(url.includes("/eprp/src/") && url.endsWith(".ts"))) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });

const structure = await import("./structure-amendments.ts");
const amendments = await import("./setup-amendments.ts");
const history = await import("./setup-history.ts");

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");
const MIGRATION = "20261019090000_project_setup_structure_governance.sql";
const sql = readFileSync(new URL(`../../../supabase/migrations/${MIGRATION}`, import.meta.url), "utf8").replaceAll("\r", "");
const fn = (name) => {
  const start = sql.indexOf(`function public.${name}(`);
  assert.ok(start >= 0, name);
  const open = sql.indexOf("$fn$", start);
  return sql.slice(start, sql.indexOf("$fn$", open + 4));
};

const amendment = (over) => ({
  id: "a1", projectId: "p1", fieldKey: "structure_units", targetKey: "unit:u2", amendmentClass: "governed",
  previousValue: {}, proposedValue: {}, reason: "r", impactCode: "STRUCTURE_SCOPE", impactWarning: "w",
  requestedBy: "x", requestedByName: "X", requestedAt: "2026-10-17T10:00:00Z", status: "pending",
  decidedBy: null, decidedByName: null, decidedAt: null, decisionComment: null, ...over,
});

/* ------------------------------ pure model ------------------------------- */

test("the four structure keys are the registry's governed relation keys", async () => {
  const { SETUP_FIELD_REGISTRY } = await import("./setup-governance.ts");
  for (const key of structure.STRUCTURE_FIELD_KEYS) {
    const entry = SETUP_FIELD_REGISTRY.find((candidate) => candidate.fieldKey === key);
    assert.equal(entry?.kind, "relation", key);
    assert.equal(entry?.fieldClass, "governed", key);
    assert.equal(entry?.enforcedFrom, "13.9B-4", key);
  }
  for (const key of ["structure_display_order", "structure_notes"]) {
    assert.equal(SETUP_FIELD_REGISTRY.find((candidate) => candidate.fieldKey === key)?.fieldClass, "free_logged", key);
  }
});

test("proposal payloads are the database's snake_case action payloads, without empty values", () => {
  assert.deepEqual(
    structure.proposalPayload({ fieldKey: "structure_units", action: "rename", unitId: "u2", name: "  Unit Two ", code: "" }),
    { action: "rename", unit_id: "u2", name: "Unit Two" });
  assert.deepEqual(
    structure.proposalPayload({ fieldKey: "structure_units", action: "add", levelNumber: 1, parentId: null, name: "Area",
      weeklyReportingRequired: false, monthlyReportingRequired: true }),
    { action: "add", level_number: 1, name: "Area", weekly_reporting_required: false, monthly_reporting_required: true });
  assert.deepEqual(
    structure.proposalPayload({ fieldKey: "structure_departments", action: "set_department_scope", departmentId: "d",
      systemIds: ["s2", "s1", "s2"], reportingRequired: false }),
    { action: "set_department_scope", department_id: "d", system_ids: ["s1", "s2"], reporting_required: false });
  assert.deepEqual(
    structure.proposalPayload({ fieldKey: "structure_disciplines", action: "move_discipline", disciplineId: "p", departmentId: "d", systemId: null }),
    { action: "move_discipline", discipline_id: "p", department_id: "d" });
  assert.deepEqual(structure.proposalPayload({ fieldKey: "structure_levels", action: "remove_level", levelNumber: 4 }),
    { action: "remove_level", level_number: 4 });
});

test("target keys match the database's target_key format", () => {
  assert.equal(structure.unitTarget("u1"), "unit:u1");
  assert.equal(structure.departmentTarget("d1"), "department:d1");
  assert.equal(structure.disciplineTarget("p1"), "discipline:p1");
  assert.equal(structure.LEVELS_TARGET, "levels");
  assert.equal(structure.addUnitTarget(null, 1, " Pump House "), "add:root:1:pump house");
  // The database builds the same keys.
  const validate = fn("project_structure_validate");
  assert.match(validate, /'add:' \|\| coalesce\(v_parent\.id::text, 'root'\) \|\| ':' \|\| v_level \|\| ':' \|\| lower\(v_name\)/);
  assert.match(validate, /'unit:' \|\| v_unit\.id::text/);
  assert.match(validate, /'levels'::text/);
  assert.match(validate, /'department:' \|\| v_department::text/);
  assert.match(validate, /'discipline:' \|\| v_discipline::text/);
});

test("pending requests are keyed by target for structure and by field for fields — never mixed", () => {
  const rows = [
    amendment({ id: "s1", targetKey: "unit:u2" }),
    amendment({ id: "s2", targetKey: "levels", fieldKey: "structure_levels" }),
    amendment({ id: "s3", targetKey: "unit:u9", status: "rejected" }),
    amendment({ id: "f1", targetKey: "", fieldKey: "code", amendmentClass: "governed" }),
  ];
  const targets = structure.pendingStructureTargets(rows);
  assert.deepEqual([...targets.keys()].sort(), ["levels", "unit:u2"]);
  const fields = amendments.pendingAmendmentsByField(rows);
  assert.deepEqual([...fields.keys()], ["code"]);
  assert.equal(structure.isStructureAmendment(rows[0]), true);
  assert.equal(structure.isStructureAmendment(rows[3]), false);
});

test("structure requests read in business words — never ids, null or raw payloads", () => {
  const rename = structure.describeStructureChange(amendment({
    previousValue: { unit: { name: "U2", code: null } },
    proposedValue: { action: "rename", unit_id: "u2", name: "Unit Two", code: "U-2", labels: { target: "U2", level: "Unit" } },
  }));
  assert.deepEqual(rename, { title: "Rename Unit · U2", from: "U2", to: "Unit Two (U-2)" });
  const move = structure.describeStructureChange(amendment({
    proposedValue: { action: "move", unit_id: "u2", parent_id: "a2", labels: { target: "U2", level: "Unit", current_parent: "A1", parent: "A2" } },
  }));
  assert.deepEqual(move, { title: "Move Unit · U2", from: "Under A1", to: "Under A2" });
  const scope = structure.describeStructureChange(amendment({
    fieldKey: "structure_departments", targetKey: "department:d",
    previousValue: { assignment: { reporting_required: true } },
    proposedValue: { action: "set_department_scope", department_id: "d", system_ids: ["s1", "s2"], reporting_required: true,
      labels: { target: "Process", systems: ["CDU", "Tank Farm"], current_systems: ["CDU"], current_reporting_required: true } },
  }));
  assert.deepEqual(scope, { title: "Change department scope · Process", from: "CDU · reports", to: "CDU, Tank Farm · reports" });
  const reporting = structure.describeStructureChange(amendment({
    previousValue: { unit: { weekly_reporting_required: true, monthly_reporting_required: false } },
    proposedValue: { action: "set_reporting_scope", weekly_reporting_required: false, monthly_reporting_required: true, labels: { target: "A2" } },
  }));
  assert.deepEqual(reporting, { title: "Change reporting input · A2", from: "Weekly input", to: "Monthly input" });
  for (const described of [rename, move, scope, reporting]) {
    assert.doesNotMatch(Object.values(described).join(" "), /null|undefined|\{|u2|a2\b/);
  }
});

test("one wording for field and structure amendments (queue, panel, history)", () => {
  const field = structure.amendmentWording(
    amendment({ fieldKey: "code", targetKey: "", previousValue: { code: "OLD" }, proposedValue: { code: "NEW" } }),
    (_key, value) => String(value.code));
  assert.deepEqual(field, { subject: "Project Code", previous: "OLD", proposed: "NEW" });
  const unit = structure.amendmentWording(
    amendment({ proposedValue: { action: "archive", unit_id: "u1", labels: { target: "K1", level: "Package" } } }), () => "x");
  assert.equal(unit.subject, "Archive Package · K1");
  for (const file of ["./components/governance/setup-amendments-panel.tsx", "./setup-history.ts"]) {
    assert.match(code(file), /amendmentWording\(amendment,/, file);
  }
  assert.match(code("../dashboard/components/setup-amendment-queue.tsx"), /describeStructureChange\(amendment\)\.title/);
});

test("Project History words structure records and names free changes", () => {
  const events = history.composeSetupHistory({
    fieldChanges: [], amendments: [], corrections: [], finalisation: null, reportedProgress: [],
    relationChanges: [
      { id: "r1", projectId: "p", relation: "structure_units", action: "changed",
        previousValue: { level_label: "Area", name: "A1", code: "A-1", parent_name: null, archived: false,
          weekly_reporting_required: false, monthly_reporting_required: false, description: null, sort_order: 0 },
        newValue: { level_label: "Area", name: "A1", code: "A-1", parent_name: null, archived: false,
          weekly_reporting_required: false, monthly_reporting_required: false, description: "Main", sort_order: 4 },
        changedBy: "x", changedByName: "X", changedAt: "2026-10-17T10:00:00Z" },
      { id: "r2", projectId: "p", relation: "disciplines", action: "added", previousValue: null,
        newValue: { discipline_name: "Corrosion Study", department_name: "Process", system_name: "CDU" },
        changedBy: "x", changedByName: "X", changedAt: "2026-10-17T09:00:00Z" },
    ],
  }, { value: () => "", classification: () => "", date: (iso) => iso });
  assert.equal(events[0].title, "Structure unit changed");
  assert.match(events[0].previous, /Area A1 \(A-1\) · No reporting input · Description: not set · Display order: 1/);
  assert.match(events[0].next, /Description: Main · Display order: 5/);
  assert.equal(events[1].title, "Program & Study added");
  assert.equal(events[1].next, "Corrosion Study — Process · CDU");
});

/* ---------------------------- service contract ---------------------------- */

test("the service proposes through the structure RPC and never writes a table", () => {
  const service = code("../../services/setup-governance-service.ts");
  assert.match(service, /rpc\("request_project_structure_amendment", \{\s+p_project: input\.projectId,\s+p_field_key: input\.proposal\.fieldKey,\s+p_proposed: proposalPayload\(input\.proposal\),\s+p_reason: input\.reason,/);
  assert.match(service, /targetKey: row\.target_key \?\? ""/);
  assert.doesNotMatch(service, /\.(insert|update|upsert|delete)\(/);
});

/* --------------------------- migration contract --------------------------- */

test("the structure guard compares old and new on the four structure tables", () => {
  const guard = fn("guard_structure_setup_controlled");
  for (const table of ["project_departments", "project_disciplines", "project_structure_levels", "project_structure_nodes"]) {
    assert.match(sql, new RegExp(`create trigger guard_structure_setup_controlled\\s+before insert or update or delete on public\\.${table}`), table);
  }
  // Row images, not record fields (one function serves four different tables).
  assert.match(guard, /to_jsonb\(old\)/);
  assert.match(guard, /v_new -> c is distinct from v_old -> c/);
  // Governed columns per table; free ones (order, notes, lead, description) absent.
  assert.match(guard, /array\['level_number', 'parent_id', 'name', 'code',\s+'weekly_reporting_required', 'monthly_reporting_required'\]/);
  assert.match(guard, /\(v_new ->> 'archived_at' is null\) is distinct from \(v_old ->> 'archived_at' is null\)/);
  assert.match(guard, /public\.project_system_ids\(v_new -> 'systems'\) is distinct from public\.project_system_ids\(v_old -> 'systems'\)/);
  assert.doesNotMatch(guard, /'sort_order'|'description'|'lead_name'|'project_description'/);
  // Before Controlled nothing changes; an upsert of an existing PSM row is judged as an UPDATE.
  assert.match(guard, /not public\.project_setup_controlled\(v_project\) then\s+return/);
  assert.match(guard, /BEFORE INSERT fires before ON CONFLICT is resolved/);
  // Bound to an approval of exactly this key and target, in this transaction.
  const authorised = fn("project_structure_change_authorised");
  assert.match(authorised, /a\.target_key = p_target_key\s+and a\.status = 'approved' and a\.applied_transaction_id = pg_catalog\.pg_current_xact_id\(\)/);
  assert.match(guard, /\[SETUP_CONTROLLED\]/);
});

test("structure requests reuse the one amendment model: one pending per target, decided by the same function", () => {
  assert.match(sql, /alter table public\.project_setup_amendments add column target_key text not null default ''/);
  assert.match(sql, /create unique index project_setup_amendments_one_pending\s+on public\.project_setup_amendments \(project_id, field_key, target_key\) where status = 'pending'/);
  assert.doesNotMatch(sql, /create table public\.\w*structure\w*amendment/i);
  const request = fn("request_project_structure_amendment");
  assert.match(request, /\[AMENDMENT_PENDING\]/);
  assert.match(request, /\[SETUP_NOT_CONTROLLED\]/);
  assert.match(request, /\[PROJECT_ARCHIVED\]/);
  assert.match(request, /can_manage_project_setup\(p_project\)/);
  assert.match(request, /pg_advisory_xact_lock\(190726, 1\)/);
  const decide = fn("decide_project_setup_amendment");
  assert.match(decide, /\[SELF_APPROVAL\]/);
  assert.match(decide, /v_structure := v_row\.target_key <> ''/);
  assert.match(decide, /project_structure_state\(v_row\.project_id, v_row\.field_key, v_row\.proposed_value\)/);
  assert.match(decide, /can no longer be applied: /);
  assert.match(decide, /perform public\.project_setup_apply_structure\(/);
  // B24: archived refused before anything else is decided.
  assert.ok(decide.indexOf("[PROJECT_ARCHIVED]") < decide.indexOf("[SELF_APPROVAL]"));
});

test("Programs & Studies are saved as differences, and the structure joins the relation history", () => {
  const saveStart = sql.indexOf("function public.save_project_setup_relation(");
  const save = sql.slice(saveStart, sql.indexOf("$function$;", saveStart));
  assert.doesNotMatch(save, /delete from public\.project_disciplines where project_id = p_project;/);
  assert.match(save, /on conflict \(project_id, discipline_id\) do update/);
  assert.match(sql, /check \(relation in \('contacts', 'sites', 'parties', 'departments', 'disciplines', 'structure_levels', 'structure_units'\)\)/);
  for (const table of ["project_departments", "project_disciplines", "project_structure_levels", "project_structure_nodes"]) {
    assert.match(sql, new RegExp(`create trigger log_project_setup_relation_change\\s+after insert or update or delete on public\\.${table}`), table);
  }
  // Internal helpers are not callable by clients.
  assert.match(sql, /'public\.project_setup_apply_structure\(uuid,text,jsonb\)',/);
  assert.match(sql, /v_client constant text\[\] := array\[\s+'public\.request_project_structure_amendment\(uuid,text,jsonb,text\)',/);
});

/* ------------------------------- UI contracts ------------------------------ */

test("Controlled structure steps are read-only editors plus a Propose panel; free edits stay direct", () => {
  const view = code("./components/setup/project-setup-view.tsx");
  assert.match(view, /const structureStep = step === "structure" \|\| step === "departments" \|\| step === "systems" \|\| step === "disciplines";/);
  assert.match(view, /if \(structureStep && governance\.status !== "ready"\)/);
  assert.match(view, /const governed = structureStep && governance\.controlled;/);
  // The Departments step has its own governed mode (UAT fix: its X was inert inside a disabled fieldset);
  // Systems and Programs & Studies stay read-only editors with no remove control.
  assert.match(view, /<SetupEditScope readOnly=\{readOnly\}>\s+<SetupStepDepartments/);
  for (const editor of ["SetupStepSystems", "SetupStepDisciplines"]) {
    assert.match(view, new RegExp(`<SetupEditScope readOnly=\\{readOnly \\|\\| governed\\}>\\s+<${editor}`), editor);
  }
  assert.match(view, /\{step === "departments" && governed && psmPanel\("departments"\)\}/);
  assert.match(view, /\{step === "systems" && governed && psmPanel\("departments"\)\}/);
  assert.match(view, /\{step === "disciplines" && governed && psmPanel\("disciplines"\)\}/);
  // The second Project Info editor is not offered once Controlled.
  assert.match(view, /\{project && !readOnly && !controlled && setupFlowFor\(\{ structureFamily, saved \}\) !== "other" && \(\s+<ProjectInfoWorkspace/);
  // Department notes: governed values are sent back unchanged.
  assert.match(view, /assignment\.departmentId === departmentId \? \{ \.\.\.assignment, \.\.\.notes \} : assignment/);

  const step = code("./components/setup/structure/project-structure-step.tsx");
  assert.match(step, /if \(governance\) \{[\s\S]*?<ProjectStructureWorkspace[\s\S]*?canManage=\{false\}[\s\S]*?<StructureGovernancePanel/);
  // The frozen workspace contract is untouched.
  assert.doesNotMatch(code("./structure/structure-workspace-contract.ts"), /governance|amendment/i);
});

test("panels offer contextual requests, mark pending targets and block a duplicate", () => {
  const other = code("./components/governance/structure-governance-panel.tsx");
  const psm = code("./components/governance/psm-scope-governance-panel.tsx");
  for (const action of ["add", "rename", "move", "restore", "set_reporting_scope", "archive", "add_level", "rename_level", "remove_level"]) {
    assert.match(other, new RegExp(`STRUCTURE_REQUEST_LABEL\\.${action}\\b`), action);
  }
  for (const action of ["add_department", "set_department_scope", "remove_department", "add_discipline", "move_discipline", "remove_discipline"]) {
    assert.match(psm, new RegExp(`STRUCTURE_REQUEST_LABEL\\.${action}\\b`), action);
  }
  for (const panel of [other, psm]) {
    assert.match(panel, /pendingStructureTargets\(amendments\)/);
    assert.match(panel, /Pending approval/);
    assert.match(panel, /A change is already awaiting approval/);
    assert.match(panel, /<AmendmentList items=\{pendingHere\}/);
    assert.match(panel, /<ProposeStructureChangeDialog open/);
    assert.doesNotMatch(panel, /supabase|\.rpc\(/);
  }
  // Free edits: unit description and order through the existing action, never a governed field.
  assert.match(other, /actions\.updateNode\(unit, \{ description: description\.trim\(\), sortOrder: position - 1 \}\)/);
  // Programs & Studies are never called Disciplines.
  assert.match(psm, /Programs & Studies/);
  assert.doesNotMatch(psm, /["'>][^"'<>{}]*\bDisciplines?\b[^"'<>{}]*["'<]/);
  const dialog = code("./components/governance/propose-structure-change-dialog.tsx");
  assert.match(dialog, /setupGovernanceService\.requestStructureAmendment\(/);
  // (UAT: Submit is also disabled while child structure blocks a removal — see structure-dependencies.test.mjs.)
  assert.match(dialog, /disabled=\{saving \|\| !proposal \|\| !reason\.trim\(\) \|\| Boolean\(blockedReason\)\}/);
  assert.match(dialog, /You cannot approve your own request\./);
});

/* -------------------------------- closeout -------------------------------- */

test("A. the legacy /edit route redirects to the governed Project Setup (no second editor)", () => {
  const page = code("../../app/(app)/projects/[projectId]/edit/page.tsx");
  assert.match(page, /redirect\(`\$\{projectWorkflowHref\(projectId, "info"\)\}\$\{suffix \? `\?\$\{suffix\}` : ""\}`\)/);
  assert.doesNotMatch(page, /ProjectForm|ProjectFormView|"use client"/);
});

test("B. the Publish Snapshot dialog shows no typed planned / actual progress", () => {
  const panel = code("./components/planning/baselines-snapshots-panel.tsx");
  assert.doesNotMatch(panel, /project\.plannedProgress|project\.actualProgress|Project summary \(as recorded\)/);
  assert.match(panel, /Project Setup:\{" "\}\s+\{firstAnchor\s+\? "not yet controlled/);
});

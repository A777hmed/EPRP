import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

// Phase 13.9B structure governance UAT — Departments step on a Controlled project:
//   1. the X / remove control must start a governed request (it was an inert,
//      disabled button inside a disabled fieldset);
//   2. "Add Department" must link an EXISTING department to the project and keep
//      creating a shared Master Data department clearly separate.
// SOURCE / PRESENTATION CONTRACTS; the database rules are proved by
// scripts/p0-validation/126 (remove_department, self-approval, archived).

registerHooks({ load(url, context, nextLoad) {
  if (!(url.includes("/eprp/src/") && url.endsWith(".ts"))) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });

const structure = await import("./structure-amendments.ts");

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");

const STEP = "./components/setup/setup-step-departments.tsx";
const ROW = "./components/setup/linked-record-row.tsx";
const VIEW = "./components/setup/project-setup-view.tsx";
const PANEL = "./components/governance/psm-scope-governance-panel.tsx";

/* ---------------------- 1. the remove control is governed ------------------ */

test("root cause removed: the Departments step is no longer an inert editor inside a disabled fieldset", () => {
  const view = code(VIEW);
  // Only an archived project is a disabled fieldset; a Controlled one presents its own governed mode.
  assert.match(view, /<SetupEditScope readOnly=\{readOnly\}>\s+<SetupStepDepartments/);
  assert.doesNotMatch(view, /<SetupEditScope readOnly=\{readOnly \|\| governed\}>\s+<SetupStepDepartments/);
  assert.match(view, /governed=\{\s*governed\s*\?\s*\{\s*pendingIds: pendingDepartmentIds,\s*canRequest: canPropose,/);
  assert.match(view, /onRequestRemoval: \(departmentId\) => requestScope\(\{ action: "remove_department", departmentId \}\)/);
  assert.match(view, /onRequestAdd: \(\) => requestScope\(\{ action: "add_department" \}\)/);
  // The request reaches the panel's dialog.
  assert.match(view, /request=\{scopeRequest\}/);
  // Archived: nothing is offered and the fieldset still disables the step.
  assert.match(view, /canPropose=\{canManage && !readOnly\}/);
});

test("a controlled department row offers 'Request removal' (or 'pending'), never a direct remove", () => {
  const step = code(STEP);
  assert.match(step, /onRemove=\{\s*governed\s*\?\s*undefined\s*:/);
  assert.match(step, /governedRemoval=\{\s*governed && governed\.canRequest/);
  assert.match(step, /pending: governed\.pendingIds\.has\(assignment\.departmentId\)/);
  assert.match(step, /onRequest: \(\) => governed\.onRequestRemoval\(assignment\.departmentId\)/);
  // The values stay read-only: selector, reporting switch and scope text are disabled.
  assert.match(step, /disabled=\{Boolean\(governed\)\}/);
  assert.equal((step.match(/disabled=\{Boolean\(governed\)\}/g) ?? []).length, 3);
  const row = code(ROW);
  assert.match(row, /Request removal/);
  assert.match(row, /Removal pending approval/);
  assert.match(row, /aria-label=\{`Request removal of \$\{name\}`\}/);
  // The ordinary X still exists for a project that is not Controlled.
  assert.match(row, /aria-label=\{`Remove \$\{name\}`\}/);
});

test("the dialog shows the impact, requires a reason, and the department stays until approved", () => {
  const panel = code(PANEL);
  // Impact of removing a department: its systems and any Programs & Studies still assigned.
  // (Now from the shared assessment — real names, correct grammar, Submit disabled while blocked;
  // see structure-dependencies.test.mjs.)
  assert.match(panel, /departmentRemovalAssessment\(\{/);
  assert.match(panel, /<RemovalImpact assessment=\{assessment\}/);
  const dependencies = code("./structure-dependencies.ts");
  assert.match(dependencies, /together with \$\{countNoun\(systems\.length, "system", "systems"\)\}/);
  assert.match(dependencies, /The shared Department record in Master Data is not changed\./);
  assert.match(dependencies, /Move \$\{assigned\.length === 1 \? "it" : "them"\} to another department/);
  // The request is the one governed path: the shared dialog (mandatory reason, impact, no self-approval).
  assert.match(panel, /<ProposeStructureChangeDialog open/);
  const dialog = code("./components/governance/propose-structure-change-dialog.tsx");
  assert.match(dialog, /disabled=\{saving \|\| !proposal \|\| !reason\.trim\(\) \|\| Boolean\(blockedReason\)\}/);
  assert.match(dialog, /You cannot approve your own request\./);
  // The payload is the governed remove_department action; nothing is written until approval.
  assert.deepEqual(
    structure.proposalPayload({ fieldKey: "structure_departments", action: "remove_department", departmentId: "d1" }),
    { action: "remove_department", department_id: "d1" });
  assert.doesNotMatch(panel, /saveProjectSetupRelation|\.rpc\(|supabase/);
  // Database rules this relies on (proved at runtime by suite 126).
  const sql = readFileSync(new URL("../../../supabase/migrations/20261019090000_project_setup_structure_governance.sql", import.meta.url), "utf8");
  assert.match(sql, /Move or remove the department''s Programs & Studies first\./);
  assert.match(sql, /\[SELF_APPROVAL\]/);
});

test("a request started from a row opens its dialog once per click (derived state, not an effect)", () => {
  const panel = code(PANEL);
  assert.match(panel, /request\.seq !== handledRequest/);
  assert.match(panel, /if \(canPropose\) \{/);
  assert.match(panel, /setDialog\(\{ kind: request\.action === "scope" \? "scope" : "remove_department", assignment \}\)/);
  const view = code(VIEW);
  assert.match(view, /seq: \(previous\?\.seq \?\? 0\) \+ 1/);
});

test("Systems and Programs & Studies steps no longer show a dead remove control on a Controlled project", () => {
  const view = code(VIEW);
  assert.match(view, /<SetupStepSystems[\s\S]*?locked=\{governed\}/);
  assert.match(view, /<SetupStepDisciplines[\s\S]*?locked=\{governed\}/);
  assert.match(code("./components/setup/setup-step-systems.tsx"), /onRemove=\{\s*locked\s*\?\s*undefined/);
  const disciplines = code("./components/setup/setup-step-disciplines.tsx");
  assert.match(disciplines, /\{!locked && \(\s*<Button/);
  assert.match(disciplines, /onRemove=\{\s*locked\s*\?\s*undefined/);
  assert.match(view, /function GovernedStepNote/);
  assert.match(view, /Controlled project: a department&apos;s systems are changed with <b>Request scope change<\/b>/);
});

/* ------------------------- 2. Add Department behaviour --------------------- */

test("project setup links an EXISTING department; creating a shared one is a labelled Master Data action", () => {
  const step = source(STEP);
  // Not Controlled: the global create is a quiet, clearly labelled Master Data button.
  assert.match(step, /New Department in Master Data/);
  assert.match(step, /Creates a new shared Department in Master Data \(applies to every project\)/);
  assert.doesNotMatch(step.replace(/\/\/[^\n]*/g, ""), />\s*Add Department\s*</);
  assert.match(step, /Select existing departments to link them to this project\. A department that does not exist yet is created\s+in Master Data\./);
  assert.match(step, /Pick the contributing departments from the list/);
  // Controlled: the global create link is not offered at all; the governed request is.
  const action = step.slice(step.indexOf("action={"), step.indexOf("{governed && ("));
  assert.match(action, /governed\.canRequest \? \(\s*<Button variant="outline" size="sm" onClick=\{governed\.onRequestAdd\}>/);
  assert.match(action, /Request department/);
  // The request dialog says it only links an existing department and keeps Master Data separate.
  const panel = source(PANEL);
  assert.match(panel, /links an <b>existing<\/b> department to this project only\. It does not create or change the shared/);
  assert.match(panel, /Master Data → New Department/);
  assert.match(panel, /\(a global action that applies to every project\)/);
  // Only existing, active departments that are not already in the project are offered.
  assert.match(code(PANEL), /departments\.filter\(\s*\(department\) => department\.active && !assigned\.some\(\(candidate\) => candidate\.departmentId === department\.id\)/);
});

test("PSM hierarchy and Other-project hierarchy are untouched by this change", () => {
  // No label, route or model change: the same panel, steps and request keys.
  assert.deepEqual([...structure.STRUCTURE_FIELD_KEYS],
    ["structure_units", "structure_levels", "structure_departments", "structure_disciplines"]);
  assert.match(code(VIEW), /\{step === "departments" && governed && psmPanel\("departments"\)\}/);
  assert.match(code(VIEW), /\{step === "disciplines" && governed && psmPanel\("disciplines"\)\}/);
  // The Other-project structure step has its own panel and is not routed through the Departments step.
  assert.match(code(VIEW), /<StructureGovernancePanel|governance=\{\s*governed/);
});

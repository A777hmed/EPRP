// Phase 2C.1c-c — Other Project Structure in the Project Setup workflow:
// step resolution, completion, gating, the frozen UI contract and the mock
// Project Type correction guard. No database.
//   node --import ./src/features/notifications/test-runtime.mjs --experimental-transform-types --test src/features/projects/structure/structure-workflow.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  evaluateProjectWorkflow,
  getProjectWorkflowStep,
  resolveSetupSteps,
  structureStepChecks,
} from "../../../config/project-workflow.ts";
import { applyProjectTypeCorrection } from "../../../services/classification-correction.ts";
import { createStructureActions } from "./structure-workspace-contract.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const ids = (list) => list.map((item) => item.id);
const DATA = { systems: [], disciplines: [], contacts: [] };

/* --------------------------------- fixtures -------------------------------- */

const level = (n, plural) => ({
  id: `L${n}`, projectId: "p1", levelNumber: n, singularLabel: plural.slice(0, -1), pluralLabel: plural,
  createdAt: "t", updatedAt: "t",
});
const unit = (id, levelNumber, parentId, extra = {}) => ({
  id, projectId: "p1", levelNumber, parentId, name: id, sortOrder: 0,
  weeklyReportingRequired: false, monthlyReportingRequired: false, createdAt: "t", updatedAt: "t", ...extra,
});
const structureOf = (levels, nodes) => ({ projectId: "p1", version: "v1", levels, nodes });

/** A two-level structure with an active unit on each level. */
const TWO_LEVELS = structureOf(
  [level(1, "Packages"), level(2, "Areas")],
  [unit("P1", 1, undefined), unit("A1", 2, "P1")]
);

function otherProject(reporting = { weeklyEnabled: false, monthlyEnabled: false }, overrides = {}) {
  return {
    id: "p1", code: "O-1", name: "Other", clientId: "c1", structureFamily: "other", projectTypeId: "t1",
    currentPhaseId: "ph1", plannedStartDate: "2026-01-01", plannedFinishDate: "2026-12-31",
    projectManagerId: "pm", projectControlManagerId: "pcm", reportingCoordinatorId: "rc",
    departments: [], disciplines: [], team: [], reporting, ...overrides,
  };
}
function psmProject(overrides = {}) {
  return {
    ...otherProject({ weeklyEnabled: true, monthlyEnabled: true }),
    structureFamily: "psm",
    departments: [{ departmentId: "d1", reportingRequired: true, systems: [{ id: "s1", name: "S" }] }],
    disciplines: [{ disciplineId: "x1", departmentId: "d1", systemId: "s1" }],
    team: [{ contactId: "k1", departmentId: "d1", assignmentRole: "department_manager" }],
    ...overrides,
  };
}
const evaluate = (project, structure, error) =>
  evaluateProjectWorkflow(project, { ...DATA, structure: { structure, error } });
const structureStatus = (project, structure, error) => evaluate(project, structure, error)[1];

/* ------------------------------ 1. PSM unchanged ---------------------------- */

test("1. PSM keeps Departments → Systems → Programs & Studies and ignores structure data", () => {
  const steps = resolveSetupSteps({ structureFamily: "psm", saved: true });
  assert.deepEqual(ids(steps), ["info", "departments", "systems", "disciplines", "contacts", "team", "review"]);
  const project = psmProject();
  const without = evaluateProjectWorkflow(project, DATA);
  const withStructure = evaluate(project, TWO_LEVELS);
  assert.deepEqual(withStructure, without);
  assert.ok(without.every((status) => status.complete));
  // PSM contacts still use the department checks; the team still needs members.
  assert.ok(without[4].checks.some((check) => /Department Manager/.test(check.label)));
  assert.deepEqual(without[5].checks.map((check) => check.label), ["Project team assembled"]);
});

/* ------------------------- 2–3. Other: one structure step ------------------- */

test("2. Other has exactly ONE Project Structure step, whatever its levels", () => {
  const steps = resolveSetupSteps({ structureFamily: "other", saved: true });
  assert.deepEqual(ids(steps), ["info", "structure", "contacts", "team", "review"]);
  assert.equal(steps.filter((step) => step.id === "structure").length, 1);
  const fourLevels = structureOf(
    [level(1, "Packages"), level(2, "Areas"), level(3, "Disciplines"), level(4, "Teams")],
    [unit("P", 1), unit("A", 2, "P"), unit("D", 3, "A"), unit("T", 4, "D")]
  );
  const statuses = evaluate(otherProject(), fourLevels);
  assert.deepEqual(ids(statuses), ids(steps));
  assert.equal(statuses[1].complete, true);
  assert.equal(getProjectWorkflowStep("structure").label, "Project Structure");
  assert.notEqual(getProjectWorkflowStep("structure").available, false);
});

test("3. Other never falls back to Departments / Systems / Disciplines", () => {
  const statuses = evaluate(otherProject(), TWO_LEVELS);
  for (const status of statuses) {
    assert.ok(!["departments", "systems", "disciplines"].includes(status.id));
    for (const check of status.checks) {
      assert.doesNotMatch(check.label, /department|system|discipline|programs/i, `${status.id}: ${check.label}`);
    }
  }
  // Contacts: the existing project-level holder only; Team: the required holders.
  assert.deepEqual(statuses[2].checks.map((check) => check.label), ["Reporting coordinator assigned"]);
  assert.deepEqual(statuses[3].checks.map((check) => check.label), [
    "Project Manager assigned", "Project Control Manager assigned", "Reporting Coordinator assigned",
  ]);
  const view = read("../components/setup/project-setup-view.tsx");
  // (2C.3E: inside the archived read-only scope.)
  assert.match(view, /step === "contacts" && !isOther && \(\s*<SetupEditScope readOnly=\{readOnly\}>\s*<SetupStepContacts/);
  assert.match(view, /step === "team" && !isOther && \(\s*<SetupStepTeam/);
  // 2C.3C: every project type gets the same Project Team on Contacts; the
  // department builder above stays PSM / legacy only.
  assert.match(view, /step === "contacts" && \(\s*<ProjectTeamWorkspace/);
  assert.match(view, /step === "team" && isOther && \(\s*<OtherProjectResponsibilities/);
  const review = read("../components/setup/setup-step-review.tsx");
  assert.match(review, /\{isOther \? \(\s*<>\s*<Summary label="Structure levels"/);
  assert.match(review, /\{isOther \? \(\s*<SectionCard\s+title="Structure breakdown"/);
});

/* ---------------------- 4. empty structure is in progress -------------------- */

test("4. an empty Other structure is an incomplete, in-progress step — not an error", () => {
  const status = structureStatus(otherProject(), structureOf([], []));
  assert.equal(status.available, true);
  assert.equal(status.unlocked, true);
  assert.equal(status.complete, false);
  assert.deepEqual(status.missing, [
    "At least one structure level defined",
    "At least one active top-level unit",
    "Every structure level has an active unit",
  ]);
  // Not loaded yet / failed load: one plain check, never a pass.
  assert.deepEqual(structureStatus(otherProject(), null).missing, ["Project structure loaded"]);
  const failed = structureStatus(otherProject(), null, "The project structure could not be loaded. Reload the page.");
  assert.equal(failed.complete, false);
  assert.equal(failed.checks[0].hint, "The project structure could not be loaded. Reload the page.");
  for (const check of [...status.checks, ...failed.checks]) {
    assert.doesNotMatch(`${check.label} ${check.hint ?? ""}`, /null|undefined|NaN|\[[A-Z_]+\]/);
  }
});

/* ----------------------------- 5. structural rules -------------------------- */

test("5. structural completion: levels, an active root, every level used", () => {
  const missing = (structure) => structureStatus(otherProject(), structure).missing;
  assert.ok(missing(structureOf([], [])).includes("At least one structure level defined"));
  // Levels, but the only root is archived: no active root.
  assert.deepEqual(missing(structureOf([level(1, "Packages")], [unit("P1", 1, undefined, { archivedAt: "t" })])), [
    "At least one active top-level unit",
    "Every structure level has an active unit",
  ]);
  // A configured level with no active unit.
  const unused = structureOf([level(1, "Packages"), level(2, "Areas")], [unit("P1", 1)]);
  assert.deepEqual(missing(unused), ["Every structure level has an active unit"]);
  assert.match(structureStatus(otherProject(), unused).checks[2].hint, /Areas/);
  // Complete hierarchy.
  const complete = structureStatus(otherProject(), TWO_LEVELS);
  assert.equal(complete.complete, true);
  assert.equal(complete.total, 3);
});

/* ------------------------- 6–8. reporting requirements ---------------------- */

test("6. Weekly enabled requires an active unit owing Weekly input", () => {
  const weekly = otherProject({ weeklyEnabled: true, monthlyEnabled: false });
  assert.deepEqual(structureStatus(weekly, TWO_LEVELS).missing, ["At least one unit owes Weekly input"]);
  const owing = structureOf(TWO_LEVELS.levels, [unit("P1", 1), unit("A1", 2, "P1", { weeklyReportingRequired: true })]);
  assert.equal(structureStatus(weekly, owing).complete, true);
  // Disabled: no Weekly requirement at all.
  assert.ok(!structureStepChecks(otherProject(), { structure: TWO_LEVELS }).some((c) => /Weekly/.test(c.label)));
});

test("7. Monthly enabled requires an active unit owing Monthly input", () => {
  const monthly = otherProject({ weeklyEnabled: false, monthlyEnabled: true });
  assert.deepEqual(structureStatus(monthly, TWO_LEVELS).missing, ["At least one unit owes Monthly input"]);
  const owing = structureOf(TWO_LEVELS.levels, [unit("P1", 1, undefined, { monthlyReportingRequired: true }), unit("A1", 2, "P1")]);
  assert.equal(structureStatus(monthly, owing).complete, true);
  const both = otherProject({ weeklyEnabled: true, monthlyEnabled: true });
  assert.equal(structureStatus(both, owing).complete, false);
  assert.ok(!structureStepChecks(otherProject(), { structure: TWO_LEVELS }).some((c) => /Monthly/.test(c.label)));
  // The enable switches are the project's own reporting settings — no new storage.
  const workflow = read("../../../config/project-workflow.ts");
  assert.match(workflow, /project\.reporting\?\.weeklyEnabled/);
  assert.match(workflow, /project\.reporting\?\.monthlyEnabled/);
});

test("8. archived reporting units never satisfy completion", () => {
  const project = otherProject({ weeklyEnabled: true, monthlyEnabled: true });
  const archivedOwing = structureOf(TWO_LEVELS.levels, [
    unit("P1", 1),
    unit("A1", 2, "P1"),
    unit("A2", 2, "P1", { archivedAt: "t", weeklyReportingRequired: true, monthlyReportingRequired: true }),
  ]);
  assert.deepEqual(structureStatus(project, archivedOwing).missing, [
    "At least one unit owes Weekly input",
    "At least one unit owes Monthly input",
  ]);
});

/* --------------------------- 9. no bypassing the gate ------------------------ */

test("9. later steps stay locked until Project Structure is complete; direct routes cannot bypass it", () => {
  for (const structure of [null, structureOf([], []), structureOf([level(1, "Packages")], [])]) {
    const statuses = evaluate(otherProject(), structure);
    for (const status of statuses.slice(2)) {
      assert.equal(status.unlocked, false, status.id);
      assert.equal(status.blockedBy, "structure", status.id);
      assert.equal(status.lockReason, "earlier-step", status.id);
    }
  }
  const done = evaluate(otherProject(), TWO_LEVELS);
  assert.equal(done[2].unlocked, true);
  assert.ok(done.every((status) => status.complete));
  // The page refuses a locked step whatever the URL, and only offers Save &
  // Continue once the step is complete. 2C.3E: an ARCHIVED project's steps
  // are all viewable read-only (nothing can be saved there).
  const view = read("../components/setup/project-setup-view.tsx");
  assert.match(view, /if \(!status\.unlocked && !readOnly\) \{[\s\S]+?<SectionCard title="Step locked">/);
  assert.match(view, /disabled=\{saving \|\| !status\.complete\}/);
  assert.match(view, /const workflow = useProjectWorkflow\(current, \{ structure: structureState \}\);/);
});

/* ------------------------- 10. the right project only ------------------------ */

test("10. a project switch or reload only ever uses THIS project's structure", () => {
  const hook = read("../use-project-workflow.ts");
  assert.match(hook, /structureState\.structure\?\.projectId === project\.id \? structureState\.structure : null/);
  assert.match(hook, /useProjectStructure\(\s*isOther && !options\.structure \? project\.id : undefined\s*\)/);
  const view = read("../components/setup/project-setup-view.tsx");
  assert.match(view, /useProjectStructure\(isOther && project \? project\.id : undefined\)/);
  assert.match(view, /<SetupShell\s+key=\{project\?\.id \?\? "new"\}/);
  const step = read("../components/setup/structure/project-structure-step.tsx");
  assert.match(step, /loaded\?\.projectId === project\.id \? loaded : null/);
  // Another project's structure in hand reads as "not loaded", never as data.
  const elsewhere = { ...TWO_LEVELS, projectId: "p2" };
  const status = structureStatus(otherProject(), elsewhere.projectId === "p1" ? elsewhere : null);
  assert.deepEqual(status.missing, ["Project structure loaded"]);
});

/* ---------------------- 11. Project Type correction guard -------------------- */

test("11. the mock correction applies the database's Other -> PSM active-structure guard", () => {
  const existing = { id: "p1", updatedAt: "v1", structureFamily: "other", projectTypeId: "t1" };
  const toPsm = { projectId: "p1", expectedUpdatedAt: "v1", structureFamily: "psm", reason: "Wrong type" };
  assert.throws(() => applyProjectTypeCorrection(existing, toPsm, "t", 2), (error) => error.reason === "structure_exists");
  // Archived units alone do not block it.
  assert.equal(applyProjectTypeCorrection(existing, toPsm, "t", 0).classification.structureFamily, "psm");
  // PSM -> Other is never blocked by structure; stale still wins first.
  const psm = { ...existing, structureFamily: "psm", projectTypeId: undefined };
  const toOther = { ...toPsm, structureFamily: "other", projectTypeId: "t1" };
  assert.equal(applyProjectTypeCorrection(psm, toOther, "t", 5).classification.structureFamily, "other");
  assert.throws(() => applyProjectTypeCorrection(existing, { ...toPsm, expectedUpdatedAt: "old" }, "t", 2), (error) => error.reason === "stale");
});

test("11b. mock mode end to end: refused with an active unit, allowed once it is archived", async () => {
  const { spawnSync } = await import("node:child_process");
  const script = `
    import assert from 'node:assert/strict';
    import { projectService, listProjectsSync } from './src/services/project-service.ts';
    import { projectStructureService } from './src/services/project-structure-service.ts';
    const { id: _i, createdAt: _c, updatedAt: _u, ...base } = listProjectsSync()[0];
    const project = await projectService.createProject({ ...base, code: 'ZZ-2C1CC', structureFamily: 'other', status: 'active' });
    const empty = await projectStructureService.getStructure(project.id);
    await projectStructureService.configureLevels({ projectId: project.id, expectedVersion: empty.version,
      levels: [{ levelNumber: 1, singularLabel: 'Package', pluralLabel: 'Packages' }] });
    const node = await projectStructureService.createNode({ projectId: project.id, levelNumber: 1, name: 'P1' });
    const correct = async () => projectService.correctProjectType({ projectId: project.id,
      expectedUpdatedAt: (await projectService.getProjectById(project.id)).updatedAt, structureFamily: 'psm', reason: 'Wrong type' });
    await assert.rejects(correct(), (e) => e.reason === 'structure_exists');
    assert.equal((await projectService.listClassificationCorrections(project.id)).length, 0);
    assert.equal((await projectService.getProjectById(project.id)).structureFamily, 'other');
    await projectStructureService.archiveNode(node);
    assert.equal((await correct()).structureFamily, 'psm');
    assert.equal((await projectService.listClassificationCorrections(project.id)).length, 1);
  `;
  const result = spawnSync(process.execPath, ["--experimental-transform-types", "--import", "./src/features/notifications/test-runtime.mjs", "--input-type=module", "-e", script], {
    cwd: new URL("../../../../", import.meta.url),
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});

/* ----------------------- 12. the frozen UI props contract -------------------- */

test("12. the UI contract is project / structure / canManage / actions, typed, with no data access", () => {
  const contract = read("./structure-workspace-contract.ts");
  const props = contract.slice(contract.indexOf("export interface ProjectStructureWorkspaceProps"));
  assert.deepEqual([...props.slice(0, props.indexOf("\n}")).matchAll(/^  (\w+):/gm)].map((m) => m[1]),
    ["project", "structure", "canManage", "actions"]);
  const actions = contract.slice(contract.indexOf("export interface ProjectStructureActions"));
  assert.deepEqual([...actions.slice(0, actions.indexOf("\n}")).matchAll(/^  (\w+)\(/gm)].map((m) => m[1]), [
    "configureLevels", "createNode", "updateNode", "moveNode", "setReportingFlags",
    "archiveNode", "restoreNode", "deleteNode", "saveUnitResponsibilities", "refresh",
  ]);
  // The placeholder body (replaced later) and the contract never touch data
  // directly, never decide authority and never carry mock data.
  const body = read("../components/setup/structure/project-structure-workspace.tsx");
  // Runtime code only: comments and type-only imports carry no data access.
  const runtime = (file) =>
    file.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/^import type [\s\S]*?;$/gm, "");
  for (const file of [contract, body, read("../components/setup/structure/structure-level-summary.tsx")]) {
    const code = runtime(file);
    assert.doesNotMatch(code, /supabase|mock/i);
    assert.doesNotMatch(code, /getSupabaseBrowserClient|createClient\(|\.from\(|\.rpc\(|\bprojectStructureService\b/);
    assert.doesNotMatch(code, /useProjectAuthority|canManageOperations|isSystemAdmin/);
  }
  // 2C.3D: the optional people directory rides along; the four contract props are unchanged.
  assert.match(body, /export function ProjectStructureWorkspace\(\{ project, structure, canManage, actions, people \}: ProjectStructureWorkspaceProps\)/);
  // Only the workflow container wires the service, and it never imports Supabase.
  const container = read("../components/setup/structure/project-structure-step.tsx");
  assert.match(container, /import \{ projectStructureService \} from "@\/services\/project-structure-service";/);
  assert.doesNotMatch(container, /supabase/i);
  assert.match(container, /<ProjectStructureWorkspace\s+project=\{project\}\s+structure=\{structure\}\s+canManage=\{canManage\}\s+actions=\{actions\}/);
});

test("12b. actions: container-owned project id and version, one call, reload after a write, errors unchanged", async () => {
  const calls = [];
  let afterWrites = 0;
  const stale = Object.assign(new Error("The project changed since this page loaded. Reload before saving."), { reason: "stale" });
  const refused = Object.assign(new Error("Archive this unit's child units first."), { reason: "active_children" });
  const service = {
    configureLevels: async (input) => { calls.push(["configureLevels", input]); return { version: "v2" }; },
    createNode: async (input) => { calls.push(["createNode", input]); return { id: "n1" }; },
    updateNode: async () => { calls.push(["updateNode"]); throw stale; },
    moveNode: async () => ({}), setReportingFlags: async () => ({}), restoreNode: async () => ({}),
    archiveNode: async () => { calls.push(["archiveNode"]); throw refused; },
    deleteNode: async () => { calls.push(["deleteNode"]); },
  };
  const actions = createStructureActions({
    service, projectId: "p1", currentVersion: () => "v1", afterWrite: () => { afterWrites += 1; }, refresh: () => {},
  });
  const levels = [{ levelNumber: 1, singularLabel: "Package", pluralLabel: "Packages" }];
  assert.equal(await actions.configureLevels(levels), undefined);
  assert.deepEqual(calls.at(-1), ["configureLevels", { projectId: "p1", expectedVersion: "v1", levels }]);
  await actions.createNode({ levelNumber: 1, name: "P1", projectId: "IGNORED" });
  assert.equal(calls.at(-1)[1].projectId, "p1");
  assert.equal(afterWrites, 2);
  // A stale refusal reloads; any other refusal does not. Both rethrown as is.
  await assert.rejects(actions.updateNode({ id: "n1", updatedAt: "t0" }, { name: "x" }), (error) => error === stale);
  assert.equal(afterWrites, 3);
  await assert.rejects(actions.archiveNode({ id: "n1", updatedAt: "t1" }), (error) => error === refused);
  assert.equal(afterWrites, 3);
  // Exactly one service call per action — nothing retried.
  assert.deepEqual(calls.map(([name]) => name), ["configureLevels", "createNode", "updateNode", "archiveNode"]);
});

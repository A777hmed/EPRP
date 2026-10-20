import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

// Phase 13.9B — dependency-aware governed removal (platform-wide).
// A parent must never be removed while governed child structure is still
// assigned: the dialog names the children by their real name and code, says
// what must be done first, and disables Submit. Shared logic, used by the PSM
// Departments / Systems / Programs & Studies and the Other-project hierarchy.

registerHooks({ load(url, context, nextLoad) {
  if (!(url.includes("/eprp/src/") && url.endsWith(".ts"))) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });

const dep = await import("./structure-dependencies.ts");
const { PSM_HIERARCHY_TERMS, DEFAULT_HIERARCHY_TERMS } = await import("../../config/project-terminology.ts");

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");

/* --------------------------------- fixtures -------------------------------- */

const HSE = "d-hse", PROCESS = "d-proc";
const CDU = "s-cdu", TANK = "s-tank";
const departments = [
  { id: HSE, name: "HSE", code: "HSE" },
  { id: PROCESS, name: "Process", code: "PRC" },
];
// Master Data holds the system even though it is no longer ACTIVE; the stored
// snapshot on the project was written as the placeholder by older code.
const systems = [
  { id: CDU, name: "Crude Distillation Unit", code: "CDU" },
  { id: TANK, name: "Tank Farm", code: "TF" },
];
const disciplines = [
  { id: "p-corr", name: "Corrosion Study", code: "CS" },
  { id: "p-rbi", name: "RBI Program", code: null },
];
const lookups = { departments, systems, disciplines };
const hrefs = { disciplines: "/projects/p1/setup/disciplines", systems: "/projects/p1/setup/systems" };

const project = (over = {}) => ({
  id: "p1",
  departments: [
    { departmentId: HSE, reportingRequired: true, systems: [{ id: CDU, name: "Unknown system" }] },
    { departmentId: PROCESS, reportingRequired: true, systems: [{ id: TANK, name: "Tank Farm" }] },
  ],
  disciplines: [{ disciplineId: "p-corr", departmentId: HSE, systemId: CDU }],
  ...over,
});

/* --------------------------- wording and resolution ------------------------ */

test("counts agree with their noun and are spaced — never '1Program(s)'", () => {
  assert.equal(dep.countNoun(1, "Program & Study", "Programs & Studies"), "1 Program & Study");
  assert.equal(dep.countNoun(2, "Program & Study", "Programs & Studies"), "2 Programs & Studies");
  assert.equal(dep.countNoun(0, "system", "systems"), "0 systems");
  assert.equal(dep.isAre(1), "is");
  assert.equal(dep.isAre(3), "are");
});

test("a stored placeholder is resolved to the real system; a missing record gets a traceable label", () => {
  assert.equal(dep.isUnresolvedName("Unknown system"), true);
  assert.equal(dep.isUnresolvedName("  unknown system "), true);
  assert.equal(dep.isUnresolvedName("Tank Farm"), false);
  assert.equal(dep.isUnresolvedName(""), true);
  // ROOT CAUSE case: the snapshot says "Unknown system" but Master Data knows the record.
  const resolved = dep.resolveRecord("System", { id: CDU, name: "Unknown system" }, systems);
  assert.deepEqual(resolved, { label: "Crude Distillation Unit", code: "CDU", resolved: true });
  assert.equal(dep.labelWithCode(resolved), "Crude Distillation Unit (CDU)");
  // The snapshot is used when Master Data lacks the record; its code when it has no usable name.
  assert.equal(dep.resolveRecord("System", { id: "x", name: "Flare System" }, []).label, "Flare System");
  assert.equal(dep.resolveRecord("System", { id: "x", name: "Unknown system", code: "FLR" }, []).label, "FLR");
  // Genuinely missing: a controlled semantic fallback with a reference — never a bare "Unknown system".
  const missing = dep.resolveRecord("System", { id: "0123456789abcdef" }, []);
  assert.equal(missing.resolved, false);
  assert.equal(missing.label, "System (record unavailable) · ref 01234567");
  assert.doesNotMatch(missing.label, /^Unknown/i);
});

/* ------------------------ PSM: department removal (HSE) -------------------- */

test("HSE removal: resolved system names in the impact, the blocking Program & Study named with where it sits", () => {
  const result = dep.departmentRemovalAssessment({ project: project(), departmentId: HSE, lookups, terms: PSM_HIERARCHY_TERMS, hrefs });
  assert.equal(dep.isBlocked(result), true);
  assert.match(result.impact[0], /^Once approved, HSE leaves this project's scope together with 1 system: Crude Distillation Unit \(CDU\)\.$/);
  assert.doesNotMatch(result.impact.join(" "), /Unknown/);
  assert.match(result.impact[1], /shared Department record in Master Data is not changed/);
  assert.equal(result.blockers.length, 1);
  const [group] = result.blockers;
  assert.equal(group.heading, "1 Program & Study is still assigned to HSE.");
  assert.deepEqual(group.items.map((item) => [item.label, item.detail]), [["Corrosion Study (CS)", "HSE · Crude Distillation Unit (CDU)"]]);
  assert.match(group.todo, /^Move it to another department, or remove it from the project, before HSE can be removed\.$/);
  assert.deepEqual(group.link, { label: "Open Programs & Studies", href: hrefs.disciplines });
  assert.match(dep.blockedSummary(result), /^1 Program & Study is still assigned to HSE\.$/);
});

test("plural grammar, project terminology, and a pending request on a blocker", () => {
  const two = project({ disciplines: [
    { disciplineId: "p-corr", departmentId: HSE, systemId: CDU },
    { disciplineId: "p-rbi", departmentId: HSE, systemId: undefined },
  ] });
  const result = dep.departmentRemovalAssessment({
    project: two, departmentId: HSE, lookups, terms: PSM_HIERARCHY_TERMS, hrefs, pending: new Set(["discipline:p-rbi"]) });
  assert.equal(result.blockers[0].heading, "2 Programs & Studies are still assigned to HSE.");
  assert.match(result.blockers[0].todo, /Move them to another department, or remove them from the project/);
  assert.equal(result.blockers[0].items[1].detail, "HSE · no system");
  assert.equal(result.blockers[0].items[1].note, "A request for this is awaiting approval");
  // A legacy project that says Disciplines keeps its own wording.
  const legacy = dep.departmentRemovalAssessment({ project: project(), departmentId: HSE, lookups, terms: DEFAULT_HIERARCHY_TERMS, hrefs });
  assert.equal(legacy.blockers[0].heading, "1 Discipline is still assigned to HSE.");
  assert.equal(legacy.blockers[0].link.label, "Open Disciplines");
});

test("once the blockers are cleared the normal governed request is available", () => {
  const clear = dep.departmentRemovalAssessment({ project: project({ disciplines: [] }), departmentId: HSE, lookups, terms: PSM_HIERARCHY_TERMS, hrefs });
  assert.equal(dep.isBlocked(clear), false);
  assert.equal(dep.blockedSummary(clear), "");
  assert.equal(clear.impact.length, 2);
  // A Program & Study in ANOTHER department does not block HSE.
  const other = dep.departmentRemovalAssessment({
    project: project({ disciplines: [{ disciplineId: "p-corr", departmentId: PROCESS, systemId: TANK }] }),
    departmentId: HSE, lookups, terms: PSM_HIERARCHY_TERMS, hrefs });
  assert.equal(dep.isBlocked(other), false);
});

/* ------------------------- PSM: a system leaving the scope ----------------- */

test("a system cannot leave a department's scope while a Program & Study is filed under it", () => {
  const blocked = dep.departmentScopeAssessment({
    project: project(), departmentId: HSE, proposedSystemIds: [], lookups, terms: PSM_HIERARCHY_TERMS, hrefs });
  assert.equal(dep.isBlocked(blocked), true);
  assert.equal(blocked.blockers[0].heading, "1 Program & Study is still assigned to Crude Distillation Unit (CDU).");
  assert.match(blocked.blockers[0].todo, /before Crude Distillation Unit \(CDU\) can leave the scope\.$/);
  assert.match(blocked.impact[0], /^Once approved, 1 system leaves HSE's scope in this project: Crude Distillation Unit \(CDU\)\.$/);
  // Keeping the system, or removing one nothing hangs from, is fine.
  const kept = dep.departmentScopeAssessment({
    project: project(), departmentId: HSE, proposedSystemIds: [CDU], lookups, terms: PSM_HIERARCHY_TERMS, hrefs });
  assert.deepEqual(kept, { impact: [], blockers: [] });
  const free = dep.departmentScopeAssessment({
    project: project({ disciplines: [] }), departmentId: HSE, proposedSystemIds: [], lookups, terms: PSM_HIERARCHY_TERMS, hrefs });
  assert.equal(dep.isBlocked(free), false);
});

/* ------------------------ Other project: dynamic hierarchy ----------------- */

const levels = [
  { id: "l1", projectId: "p1", levelNumber: 1, singularLabel: "Area", pluralLabel: "Areas" },
  { id: "l2", projectId: "p1", levelNumber: 2, singularLabel: "Work Package", pluralLabel: "Work Packages" },
];
const node = (id, levelNumber, name, over = {}) => ({
  id, projectId: "p1", levelNumber, name, parentId: undefined, sortOrder: 0,
  weeklyReportingRequired: false, monthlyReportingRequired: false, ...over });
const area = node("a1", 1, "Area 1", { code: "A1" });
const nodes = [area, node("w1", 2, "Pipe Rack", { parentId: "a1", code: "WP1" }), node("w2", 2, "Tie-ins", { parentId: "a1" }),
  node("w3", 2, "Old Package", { parentId: "a1", archivedAt: "2026-01-01" })];

test("archiving a unit is blocked by its ACTIVE children, named with the project's own level wording", () => {
  const result = dep.unitArchiveAssessment({ structure: { levels, nodes }, unit: area, pending: new Set(["unit:w2"]) });
  assert.equal(dep.isBlocked(result), true);
  const [group] = result.blockers;
  assert.equal(group.heading, "2 Work Packages are still active under Area 1 (A1).");
  assert.deepEqual(group.items.map((item) => item.label), ["Pipe Rack (WP1)", "Tie-ins"]);
  assert.ok(group.items.every((item) => item.detail === "Work Package"));
  // The archived child does not block; one with a request pending is not offered another.
  assert.equal(group.items[0].fix.label, "Request archive");
  assert.equal(group.items[0].fix.unitId, "w1");
  assert.equal(group.items[1].fix, undefined);
  assert.equal(group.items[1].note, "A request for this is awaiting approval");
  // Singular wording, and a leaf with nothing underneath is free to archive.
  const one = dep.unitArchiveAssessment({ structure: { levels, nodes: [area, nodes[1]] }, unit: area });
  assert.equal(one.blockers[0].heading, "1 Work Package is still active under Area 1 (A1).");
  assert.equal(dep.isBlocked(dep.unitArchiveAssessment({ structure: { levels, nodes }, unit: nodes[1] })), false);
});

test("archiving is blocked by active people and responsibilities until they are removed", () => {
  const structure = { levels, nodes: [area], assignments: {
    unitMembers: [{ id: "m1", nodeId: "a1", memberId: "x", unitRole: "lead" }, { id: "m2", nodeId: "a1", memberId: "y", unitRole: "member", endedAt: "2026-02-01" }],
    reportResponsibilities: [{ id: "r1", nodeId: "a1", memberId: "x", reportKind: "weekly", responsibility: "responsible" }],
  } };
  const result = dep.unitArchiveAssessment({ structure, unit: area });
  assert.equal(result.blockers.length, 1);
  assert.equal(result.blockers[0].heading, "Area 1 (A1) still has 1 active person and 1 reporting responsibility.");
  assert.match(result.blockers[0].todo, /Project Team step/);
  // Ended rows are history and do not block.
  const history = { levels, nodes: [area], assignments: { unitMembers: [{ id: "m2", nodeId: "a1", memberId: "y", unitRole: "member", endedAt: "2026-02-01" }], reportResponsibilities: [] } };
  assert.equal(dep.isBlocked(dep.unitArchiveAssessment({ structure: history, unit: area })), false);
});

test("a level that still has units (archived included) cannot be removed", () => {
  const blocked = dep.levelRemovalAssessment({ structure: { levels, nodes }, level: levels[1] });
  assert.equal(blocked.blockers[0].heading, "3 Work Packages are still on this level (1 archived included).");
  assert.deepEqual(blocked.blockers[0].items.map((item) => item.detail), ["Active", "Active", "Archived"]);
  assert.match(blocked.blockers[0].todo, /A level that has units cannot be removed\./);
  const empty = dep.levelRemovalAssessment({ structure: { levels, nodes: [area] }, level: levels[1] });
  assert.equal(dep.isBlocked(empty), false);
  assert.match(empty.impact[0], /^Once approved, the Work Package level \(level 2\) is removed/);
});

/* -------------------- the screens use the shared logic --------------------- */

test("root cause removed: nothing writes or shows a bare 'Unknown system' any more", () => {
  const files = [
    "./components/setup/setup-step-systems.tsx", "./components/setup/setup-step-disciplines.tsx",
    "./components/setup/setup-step-review.tsx", "./components/milestones/scope-options.ts",
    "./components/governance/psm-scope-governance-panel.tsx", "./components/governance/structure-governance-panel.tsx",
  ];
  for (const file of files) assert.doesNotMatch(code(file), /["'`]Unknown system["'`]/, file);
  const systemsStep = code("./components/setup/setup-step-systems.tsx");
  // Resolves against ACTIVE and ALL system records (an archived system may still be in scope).
  assert.match(systemsStep, /const \{ records: allSystemRecords \} = useMasterData\("system"\);/);
  assert.match(systemsStep, /resolveRecord\(\s*"System",\s*\{ id, name: existing\?\.name, code: existing\?\.code \},\s*\[\.\.\.systems, \.\.\.\(allSystemRecords as System\[\]\)\]/);
});

test("every governed removal dialog uses the shared assessment and disables Submit while blocked", () => {
  const psm = code("./components/governance/psm-scope-governance-panel.tsx");
  const other = code("./components/governance/structure-governance-panel.tsx");
  const dialog = code("./components/governance/propose-structure-change-dialog.tsx");
  // PSM: department removal + a system leaving the scope.
  assert.match(psm, /departmentRemovalAssessment\(\{\s*project, departmentId: dialog\.assignment\.departmentId, lookups, terms, hrefs, pending: pendingTargets,/);
  assert.match(psm, /departmentScopeAssessment\(\{\s*project, departmentId: dialog\.assignment\.departmentId, proposedSystemIds: systemIds,/);
  // Other: unit archive (children, people) and level removal.
  assert.match(other, /unitArchiveAssessment\(\{ structure, unit: dialog\.unit, pending: pendingTargets \}\)/);
  assert.match(other, /levelRemovalAssessment\(\{ structure, level: dialog\.level \}\)/);
  for (const panel of [psm, other]) {
    assert.match(panel, /blockedReason = isBlocked\(assessment\) \? blockedSummary\(assessment\) : undefined;/);
    assert.match(panel, /<RemovalImpact assessment=\{assessment\}/);
    assert.match(panel, /blockedReason=\{blockedReason\}/);
  }
  // The dialog: Submit is disabled and a no-op while blocked; the reason is stated.
  assert.match(dialog, /disabled=\{saving \|\| !proposal \|\| !reason\.trim\(\) \|\| Boolean\(blockedReason\)\}/);
  assert.match(dialog, /if \(!proposal \|\| !reason\.trim\(\) \|\| blockedReason\) return;/);
  assert.match(dialog, /Submit for approval is unavailable until the items above are cleared\./);
  // The shared block: alert role, real names, what to do first, and a navigation link.
  const shared = code("./components/governance/removal-impact.tsx");
  assert.match(shared, /role="alert"/);
  assert.match(shared, /Removal is blocked\. \{group\.heading\}/);
  assert.match(shared, /<Link href=\{group\.link\.href\}>/);
  assert.match(shared, /onFix\(item\.fix!\.unitId\)/);
});

test("removal is always reachable so the dialog can explain; the old terse hints and grammar are gone", () => {
  const psm = source("./components/governance/psm-scope-governance-panel.tsx");
  assert.doesNotMatch(psm, /Program\(s\)/);
  assert.doesNotMatch(psm, /Remove its Programs & Studies first/);
  assert.doesNotMatch(psm, /disabled=\{inUse\}/);
  assert.match(psm, /countNoun\(links\.length, terms\.singular, terms\.plural\)/);
  // The wording comes from the project's terms, not a literal.
  assert.match(code("./components/setup/project-setup-view.tsx"), /terms=\{workflow\.terms\}/);
  // Other projects: the deepest level's removal is offered even when units sit on it, so the dialog explains why not.
  const other = code("./components/governance/structure-governance-panel.tsx");
  assert.match(other, /\{deepest && levels\.length > 1 && \(/);
  assert.match(other, /onRequestArchive=\{\(unitId\) =>/);
  // The authority and self-approval rules still live in the one governed dialog / database.
  assert.match(code("./components/governance/propose-structure-change-dialog.tsx"), /You cannot approve your own request\./);
});

test("a Unit Lead's extra row does not inflate the headcount (people, not rows)", () => {
  const structure = { levels, nodes: [area], assignments: {
    unitMembers: [
      { id: "m1", nodeId: "a1", memberId: "x", unitRole: "member" }, { id: "m2", nodeId: "a1", memberId: "x", unitRole: "lead" },
      { id: "m3", nodeId: "a1", memberId: "y", unitRole: "member" },
    ],
    reportResponsibilities: [
      { id: "r1", nodeId: "a1", memberId: "x", reportKind: "weekly", responsibility: "responsible" },
      { id: "r2", nodeId: "a1", memberId: "y", reportKind: "weekly", responsibility: "backup" },
    ],
  } };
  const result = dep.unitArchiveAssessment({ structure, unit: area });
  assert.equal(result.blockers[0].heading, "Area 1 (A1) still has 2 active people and 2 reporting responsibilities.");
});

// Phase 2C.3D Wave 1 — Other Project Structure Responsibilities UI. Real React
// markup over the real rules; no database, no installed test dependency.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

registerHooks({ resolve(specifier, context, nextResolve) {
  const next = { "next/link": "next/link.js", "next/navigation": "next/navigation.js" }[specifier];
  return nextResolve(next ?? specifier, context);
}, load(url, context, nextLoad) {
  const appSource = url.includes("/eprp/src/") && (url.endsWith(".tsx") || url.endsWith(".ts"));
  if (!appSource) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });

const { StructureResponsibilityForm } = await import("../components/setup/structure/structure-responsibility-dialog.tsx");
const { StructureResponsibilitiesWorkspace } = await import("../components/setup/structure/structure-responsibilities-workspace.tsx");
const { StructureHierarchyView } = await import("../components/setup/structure/structure-hierarchy-view.tsx");
const { ProjectTeamWorkspace } = await import("../components/setup/project-team-workspace.tsx");
const { buildTeamDirectory } = await import("./structure-responsibilities.ts");

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const count = (html, pattern) => (html.match(pattern) ?? []).length;
const between = (html, start, end) => html.slice(html.indexOf(start), end ? html.indexOf(end, html.indexOf(start)) : undefined);

/* -------------------------------- fixtures -------------------------------- */

const EPROM = { id: "p-eprom", kind: "eprom", sortOrder: 0 };
const OWNER = { id: "p-owner", kind: "owner", sortOrder: 1 };
const member = (id, extra = {}) => ({ id, projectId: "prj", contactId: `c-${id}`, partyId: "p-eprom", projectRole: "Engineer",
  createdAt: "t0", updatedAt: "t0", ...extra });
const MEMBERS = [member("ahmed", { projectRole: "Civil Lead" }), member("mona", { partyId: "p-owner" }), member("mostafa"),
  member("dina", { partyId: undefined, projectRole: undefined })];
const contacts = ["ahmed", "mona", "mostafa", "dina"].map((id) => ({ id: `c-${id}`, name: `${id[0].toUpperCase()}${id.slice(1)} Name`, position: "", active: true }));
const project = (reporting = { weeklyEnabled: true, monthlyEnabled: true }) => ({
  id: "prj", code: "PRJ", name: "Other project", structureFamily: "other", status: "planning", clientId: "client",
  projectManagerId: "c-ahmed", projectControlManagerId: "c-mostafa", reportingCoordinatorId: "c-mona",
  departments: [], team: [], parties: [EPROM, OWNER], members: MEMBERS, reporting,
  updatedAt: "2026-10-12T10:00:00Z", createdAt: "2026-10-01T00:00:00Z",
});
const level = (n, singular) => ({ id: `l${n}`, projectId: "prj", levelNumber: n, singularLabel: singular, pluralLabel: `${singular}s`, createdAt: "t", updatedAt: "t" });
const node = (id, levelNumber, parentId, extra = {}) => ({ id, projectId: "prj", levelNumber, parentId, name: id, sortOrder: 0,
  weeklyReportingRequired: false, monthlyReportingRequired: false, createdAt: "t", updatedAt: "t", ...extra });
const unitRow = (id, nodeId, memberId, unitRole = "member") => ({ id, projectId: "prj", nodeId, memberId, unitRole, createdAt: "t", updatedAt: "t" });
const reportRow = (id, nodeId, memberId, unitMemberId, reportKind, responsibility) =>
  ({ id, projectId: "prj", nodeId, memberId, unitMemberId, reportKind, responsibility, createdAt: "t", updatedAt: "t" });
const NODES = [
  node("Civil", 1, undefined, { weeklyReportingRequired: true, code: "CIV" }),
  node("Earthworks", 2, "Civil", { monthlyReportingRequired: true }),
  node("Mech", 1),
  node("Retired", 1, undefined, { archivedAt: "2026-09-01T00:00:00Z" }),
];
const structure = (assignments = { unitMembers: [], reportResponsibilities: [] }) => ({
  projectId: "prj", version: "v1", levels: [level(1, "Function"), level(2, "Workstream")], nodes: NODES,
  ...(assignments === null ? {} : { assignments }),
});
const staffed = () => ({
  unitMembers: [unitRow("u1", "Civil", "ahmed"), unitRow("u2", "Civil", "mona"), unitRow("u3", "Civil", "dina"), unitRow("u4", "Civil", "ahmed", "lead")],
  reportResponsibilities: [reportRow("r1", "Civil", "ahmed", "u1", "weekly", "responsible"), reportRow("r2", "Civil", "mona", "u2", "weekly", "backup")],
});
const directory = () => buildTeamDirectory(project(), contacts, "SOPC");
const formHtml = (unit, extra = {}) => renderToStaticMarkup(React.createElement(StructureResponsibilityForm, {
  project: project(), node: unit, levelLabel: "Function", assignments: staffed(), directory: directory(),
  canManage: true, onSave: async () => {}, onClose() {}, ...extra,
}));

/* ------------------------------- the dialog ------------------------------- */

test("the Responsibility editor shows Weekly / Monthly sections only where the unit owes that input", () => {
  const civil = formHtml(NODES[0]);
  assert.equal(count(civil, /data-report-fields="weekly"/g), 1);
  assert.equal(count(civil, /data-report-fields="monthly"/g), 0);
  assert.match(civil, /Weekly Responsible \(required\)/);
  assert.match(civil, /Weekly Backup/);
  const earth = formHtml(NODES[1]);
  assert.equal(count(earth, /data-report-fields="weekly"/g), 0);
  assert.equal(count(earth, /data-report-fields="monthly"/g), 1);
  const mech = formHtml(NODES[2]);
  assert.equal(count(mech, /data-report-fields=/g), 0);
  assert.match(mech, /does not provide Weekly or Monthly input/);
  // A report the project does not use is never required.
  const off = formHtml(NODES[0], { project: project({ weeklyEnabled: false, monthlyEnabled: true }) });
  assert.doesNotMatch(off, /Weekly Responsible \(required\)/);
  assert.match(off, /Weekly reporting is off for this project/);
});

test("the person pool is the active project team; incomplete members are marked and explained", () => {
  const html = formHtml(NODES[0]);
  assert.deepEqual([...html.matchAll(/data-member-option="([a-z]+)"/g)].map((m) => m[1]), ["ahmed", "dina", "mona", "mostafa"]);
  const dina = between(html, 'data-member-option="dina"', "</li>");
  assert.match(dina, /Needs party/);
  assert.match(dina, /Needs project role/);
  assert.match(html, /cannot be its Lead, Responsible or Backup until\s+their membership is completed/);
  assert.match(html, /grants no report-writing or approval authority/);
  assert.match(html, /Grants no platform or project authority/);
  assert.doesNotMatch(html, /Organization Chart/i);
});

test("read-only and unavailable states never offer a save", () => {
  const readOnly = formHtml(NODES[0], { canManage: false });
  assert.doesNotMatch(readOnly, /Save Changes/);
  assert.match(readOnly, /<fieldset[^>]*disabled=""/);
  assert.match(readOnly, />Close</);
  const archived = formHtml({ ...NODES[0], archivedAt: "x" });
  assert.match(archived, /This unit is archived, so its people are read-only/);
  const unavailable = formHtml(NODES[0], { assignments: undefined });
  assert.match(unavailable, /not available on this database yet/);
  assert.doesNotMatch(unavailable, /Save Changes/);
});

/* --------------------------- the hierarchy card --------------------------- */

const hierarchyHtml = (struct, extra = {}) => renderToStaticMarkup(React.createElement(StructureHierarchyView, {
  project: project(), structure: struct, canManage: true, onManage() {}, ...extra,
}));

test("Structure Hierarchy cards stay units-only without the people directory", () => {
  const html = hierarchyHtml(structure(staffed()));
  assert.equal(count(html, /data-unit-people/g), 0);
  assert.doesNotMatch(html, /Lead not assigned|Responsible|>People</);
  assert.match(html, /It shows units, not people/);
});

test("with people: a concise read-only summary per card, and one People action per unit", () => {
  const html = hierarchyHtml(structure(staffed()), { people: directory(), onEditPeople() {} });
  const civil = between(html, 'data-structure-node="Civil"', "</article>");
  assert.match(civil, /Lead <span class="font-medium">Ahmed Name<\/span>/);
  assert.match(civil, /3 members/);
  assert.match(civil, /Weekly <span class="font-medium">Ahmed Name<\/span><span class="text-muted-foreground"> · Backup Mona Name<\/span>/);
  assert.doesNotMatch(civil, /Monthly/, "Civil owes no Monthly input");
  const earth = between(html, 'data-structure-node="Earthworks"', "</article>");
  assert.match(earth, /Lead not assigned/);
  assert.match(earth, /0 members/);
  assert.match(earth, /Monthly Responsible required/);
  assert.doesNotMatch(earth, /Weekly/);
  const mech = between(html, 'data-structure-node="Mech"', "</article>");
  assert.doesNotMatch(mech, /Weekly|Monthly/);
  assert.equal(count(html, /aria-label="People for /g), 3, "active units only");
  assert.match(html, /1 unit needs a required Responsible/);
  assert.match(html, /with each unit&#x27;s Lead, members and reporting Responsibles/);
  // Read-only: the card itself never writes.
  const code = read("../components/setup/structure/structure-hierarchy-view.tsx");
  assert.doesNotMatch(code, /saveUnitResponsibilities|createNode|setReportingFlags|\.rpc\(|\.from\(/);
});

/* -------------------- Project Team & Responsibilities step ----------------- */

const workspaceHtml = (struct, extra = {}) => renderToStaticMarkup(React.createElement(StructureResponsibilitiesWorkspace, {
  project: project(), structure: struct, directory: directory(), canManage: true, onSave: async () => {}, ...extra,
}));

test("the workspace lists active units in hierarchy order with blockers, Lead warnings and the Needs-responsible filter", () => {
  const empty = workspaceHtml(structure());
  assert.deepEqual([...empty.matchAll(/data-responsibility-unit="([A-Za-z]+)"/g)].map((m) => m[1]), ["Civil", "Earthworks", "Mech"]);
  assert.match(empty, /2 units need a required Responsible — Project Setup cannot complete until assigned/);
  assert.match(empty, /3 units have no Unit Lead \(a warning, not a blocker\)/);
  assert.match(empty, /Needs responsible \(2\)/);
  assert.match(between(empty, 'data-responsibility-unit="Civil"', "</li>"), /Weekly Responsible required/);
  assert.match(between(empty, 'data-responsibility-unit="Earthworks"', "</li>"), /margin-inline-start:1.25rem/);
  assert.doesNotMatch(between(empty, 'data-responsibility-unit="Mech"', "</li>"), /Weekly|Monthly/);
  assert.equal(count(empty, />Edit people</g), 3);
  const done = workspaceHtml(structure(staffed()), { project: project({ weeklyEnabled: true, monthlyEnabled: false }) });
  assert.match(done, /Every unit that provides Weekly or Monthly input has its Responsible/);
  assert.doesNotMatch(done, /Needs responsible/);
  assert.match(between(done, 'data-responsibility-unit="Civil"', "</li>"), /Ahmed Name<span class="text-muted-foreground"> · Backup: Mona Name/);
  assert.match(between(done, 'data-responsibility-unit="Earthworks"', "</li>"), /Not assigned · Monthly reporting is off for this project/);
  const readOnly = workspaceHtml(structure(), { canManage: false });
  assert.equal(count(readOnly, />View people</g), 3);
  assert.doesNotMatch(readOnly, />Edit people</);
  assert.match(workspaceHtml(structure(null)), /not available on this database yet/);
  assert.match(workspaceHtml({ ...structure(), nodes: [] }), /No active structure units yet/);
});

/* ------------------------- reverse view on the team ------------------------ */

test("Project Team member cards show each member's units and responsibilities (Other projects only)", () => {
  const render = (extra) => renderToStaticMarkup(React.createElement(ProjectTeamWorkspace, {
    project: project(), contacts, clientName: "SOPC", canManage: true, canEditPeople: false, onProjectChanged() {}, ...extra,
  }));
  const html = render({ structure: structure(staffed()) });
  const card = (id) => between(html, `data-member-id="${id}"`, "</li>");
  assert.match(card("ahmed"), /Structure units<\/dt><dd>Civil \(Lead, Weekly Responsible\)/);
  assert.match(card("mona"), /Civil \(Weekly Backup\)/);
  assert.match(card("mostafa"), /No unit assignment/);
  assert.equal(count(render({}), /data-member-units/g), 0, "PSM / legacy: no reverse view");
});

/* ------------------------------ scope contracts ---------------------------- */

test("structure responsibilities stay authority-free and reach data only through the actions", () => {
  const files = [
    "../components/setup/structure/structure-responsibility-dialog.tsx",
    "../components/setup/structure/structure-responsibilities-workspace.tsx",
    "../components/setup/structure/structure-views.tsx",
    "../components/setup/other-project-responsibilities.tsx",
    "./structure-responsibilities.ts",
  ].map(read).join("\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(files, /supabase|\.rpc\(|\.from\(|useProjectAuthority|can_manage|is_project_control|canManageOperations/);
  assert.doesNotMatch(files, /Organization Chart|Department Manager|project_contacts|project_delegations/);
  // One canonical editor, used by the hierarchy, the Manage View and the team step.
  assert.match(read("../components/setup/structure/structure-views.tsx"), /<StructureResponsibilityDialog/);
  assert.match(read("../components/setup/structure/structure-responsibilities-workspace.tsx"), /<StructureResponsibilityDialog/);
  const editor = read("../components/setup/structure/structure-units-editor.tsx");
  assert.match(editor, /\{active && onEditPeople && <DropdownMenuItem className="min-h-11" onSelect=\{\(\) => onEditPeople\(node\)\}>People &amp; responsibilities<\/DropdownMenuItem>\}/);
  // The Other team step renders the workspace; PSM keeps its department team.
  const view = read("../components/setup/project-setup-view.tsx");
  assert.match(view, /step === "team" && isOther && \(\s*<OtherProjectResponsibilities[\s\S]*?structureState=\{structureState\}/);
  assert.match(view, /step === "team" && !isOther && \(\s*<SetupStepTeam/);
});

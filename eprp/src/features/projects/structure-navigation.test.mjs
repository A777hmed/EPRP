import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

// An Other project's structure vocabulary is its CONFIGURED hierarchy. Every
// project-local surface asks the one shared model, so none hard-codes
// Departments / Systems / Disciplines for an Other project (or a level name).
// PSM keeps Departments → Systems → Programs & Studies. Display and routing
// only; the stored hierarchy, ids and routes of PSM are untouched.

registerHooks({ load(url, context, nextLoad) {
  if (!(url.includes("/eprp/src/") && url.endsWith(".ts"))) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });

const nav = await import("./structure-navigation.ts");
const { PSM_HIERARCHY_TERMS, DEFAULT_HIERARCHY_TERMS, hierarchyTermsForProject } = await import("../../config/project-terminology.ts");

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");

const FUNCTIONS = [
  { levelNumber: 1, singularLabel: "Function", pluralLabel: "Functions" },
  { levelNumber: 2, singularLabel: "Workstream", pluralLabel: "Workstreams" },
];
const PSM_WORDS = /\b(Departments?|Systems?|Disciplines?|Programs? & Stud(y|ies))\b/;

/* --------------------------------- the model -------------------------------- */

test("ZZ-STRUCT-UI-01: an Other project shows exactly Function → Workstream — no PSM words, no invented third level", () => {
  const result = nav.structureNavFor({ structureFamily: "other", terms: DEFAULT_HIERARCHY_TERMS, levels: FUNCTIONS });
  assert.equal(result.other, true);
  assert.equal(result.pending, false);
  assert.deepEqual(result.items.map((item) => [item.kind, item.label, item.singular]),
    [["level", "Functions", "Function"], ["level", "Workstreams", "Workstream"]]);
  for (const item of result.items) assert.doesNotMatch(item.label, PSM_WORDS);
  assert.equal(result.items.length, 2);
  assert.equal(nav.hierarchyLine(FUNCTIONS), "Function → Workstream");
  assert.deepEqual(result.items.map((item) => nav.structureLevelHref("p1", item.levelNumber)),
    ["/projects/p1/structure/1", "/projects/p1/structure/2"]);
});

test("levels follow the configuration: order, count and wording (one to four)", () => {
  const unordered = [
    { levelNumber: 3, singularLabel: "Package", pluralLabel: "Packages" },
    { levelNumber: 1, singularLabel: "Area", pluralLabel: "Areas" },
    { levelNumber: 2, singularLabel: "Unit", pluralLabel: "Units" },
    { levelNumber: 4, singularLabel: "Task", pluralLabel: "Tasks" },
  ];
  const four = nav.structureNavFor({ structureFamily: "other", terms: DEFAULT_HIERARCHY_TERMS, levels: unordered });
  assert.deepEqual(four.items.map((item) => item.label), ["Areas", "Units", "Packages", "Tasks"]);
  const one = nav.structureNavFor({ structureFamily: "other", terms: DEFAULT_HIERARCHY_TERMS, levels: [FUNCTIONS[0]] });
  assert.deepEqual(one.items.map((item) => item.label), ["Functions"]);
  assert.equal(nav.hierarchyLine(unordered), "Area → Unit → Package → Task");
});

test("an Other project whose levels are still loading shows nothing — never the PSM words", () => {
  const loading = nav.structureNavFor({ structureFamily: "other", terms: DEFAULT_HIERARCHY_TERMS, levels: null });
  assert.deepEqual(loading, { pending: true, other: true, items: [] });
  const none = nav.structureNavFor({ structureFamily: "other", terms: DEFAULT_HIERARCHY_TERMS, levels: [] });
  assert.deepEqual(none, { pending: false, other: true, items: [] });
});

test("PSM is unchanged: Departments → Systems → Programs & Studies; a legacy project says Disciplines", () => {
  const psm = nav.structureNavFor({ structureFamily: "psm", terms: PSM_HIERARCHY_TERMS, levels: null });
  assert.equal(psm.other, false);
  assert.deepEqual(psm.items.map((item) => [item.kind, item.id, item.label]),
    [["section", "departments", "Departments"], ["section", "systems", "Systems"], ["section", "disciplines", "Programs & Studies"]]);
  const legacy = nav.structureNavFor({ structureFamily: undefined, terms: DEFAULT_HIERARCHY_TERMS, levels: null });
  assert.deepEqual(legacy.items.map((item) => item.label), ["Departments", "Systems", "Disciplines"]);
  // A PSM project's levels (if any were ever passed) are ignored: the structure is fixed.
  const ignored = nav.structureNavFor({ structureFamily: "psm", terms: PSM_HIERARCHY_TERMS, levels: FUNCTIONS });
  assert.deepEqual(ignored.items.map((item) => item.label), ["Departments", "Systems", "Programs & Studies"]);
  // The wording resolver is untouched by this change.
  assert.equal(hierarchyTermsForProject({ structureFamily: "psm" }, null), PSM_HIERARCHY_TERMS);
  assert.equal(hierarchyTermsForProject({ structureFamily: "other", code: "MDP-PSAIM-01" }, null), DEFAULT_HIERARCHY_TERMS);
  for (const id of nav.PSM_STRUCTURE_SECTION_IDS) assert.equal(nav.isPsmStructureSectionId(id), true);
  assert.equal(nav.isPsmStructureSectionId("structure"), false);
});

test("routes and breadcrumbs: /structure/<n> carries only the level number; its name is the project's", () => {
  assert.equal(nav.parseStructureLevel("1"), 1);
  assert.equal(nav.parseStructureLevel("4"), 4);
  for (const bad of ["0", "5", "x", "", undefined, "12"]) assert.equal(nav.parseStructureLevel(bad), null, String(bad));
  assert.equal(nav.structureRouteLabel("structure", "2", FUNCTIONS), "Workstreams");
  assert.equal(nav.structureRouteLabel("structure", "2", null), "Project Structure");
  assert.equal(nav.structureRouteLabel("structure", "9", FUNCTIONS), "Project Structure");
  assert.equal(nav.structureRouteLabel("setup", "2", FUNCTIONS), null);
  assert.match(nav.structureSetupHref("p1"), /^\/projects\/p1\/setup\/structure$/);
  assert.equal(nav.OTHER_SECTION_DESCRIPTION.setup, "Guided setup: project structure, team and responsibilities.");
  for (const text of Object.values(nav.OTHER_SECTION_DESCRIPTION)) assert.doesNotMatch(text, /department/i);
});

/* ------------------------------ surfaces audited ---------------------------- */

test("sidebar (expanded and collapsed) builds its structure group from the shared model", () => {
  const sidebar = code("../../components/layout/project-nav-group.tsx");
  assert.match(sidebar, /const structureNav = useStructureNav\(project\);/);
  assert.match(sidebar, /group === "Project Structure"\s*\?\s*structureEntries\(\)/);
  assert.match(sidebar, /if \(structureNav\.pending\) return \[\];/);
  assert.match(sidebar, /structureLevelHref\(projectId, item\.levelNumber\)/);
  // One entry model feeds both renderings; no per-section label hack remains.
  assert.doesNotMatch(sidebar, /sectionLabel\(/);
  assert.match(sidebar, /<CollapsedSectionLink[\s\S]*?icon=\{entry\.icon\}/);
  assert.match(sidebar, /<SectionLink[\s\S]*?icon=\{entry\.icon\}/);
  // The PSM labels come only from the shared model.
  assert.match(sidebar, /\.\.\.sectionEntry\(section\), label: item\.label/);
});

test("overview navigation, overview sections, breadcrumbs, scope summary and section routes use the shared model", () => {
  const sectionNav = code("./components/project-section-nav.tsx");
  assert.match(sectionNav, /export function structureAwareSections\(/);
  assert.match(sectionNav, /if \(!nav\.other\) return localizeProjectSections\(sections, terms\);/);
  const overview = code("./components/project-details-view.tsx");
  assert.match(overview, /const structureNav = useStructureNav\(project\);/);
  assert.match(overview, /sections=\{structureAwareSections\(projectSections, structureNav, terms\)\}/);
  assert.match(overview, /\{structureNav\.other \? \(\s*structureNav\.items\.map/);
  const crumbs = code("../../components/layout/breadcrumbs.tsx");
  assert.match(crumbs, /segment === "structure"/);
  assert.match(crumbs, /structureRouteLabel\(segment, pathname\.split\("\/"\)\[4\], levels\)/);
  const form = code("./components/project-form.tsx");
  assert.match(form, /structureFamily === "other" \? \(\s*<OtherStructureScopeSummary projectId=\{projectId\} \/>\s*\) : \(\s*<ProjectScopeSummary/);
  const view = code("./components/sections/project-section-view.tsx");
  assert.match(view, /project\.structureFamily === "other" && isPsmStructureSectionId\(section\)/);
  assert.match(view, /router\.replace\(structureLevelHref\(projectId, level\)\)/);
  assert.match(view, /OTHER_SECTION_DESCRIPTION\[section\]/);
});

test("the level page exists, validates its level, and names everything from the project's own levels", () => {
  assert.equal(existsSync(new URL("../../app/(app)/projects/[projectId]/structure/[level]/page.tsx", import.meta.url)), true);
  const page = code("../../app/(app)/projects/[projectId]/structure/[level]/page.tsx");
  assert.match(page, /parseStructureLevel\(level\)/);
  assert.match(page, /if \(levelNumber === null\) notFound\(\);/);
  const levelView = code("./components/sections/project-structure-level-view.tsx");
  assert.match(levelView, /title=\{level\.pluralLabel\}/);
  assert.match(levelView, /hierarchyLine\(levels\)/);
  assert.match(levelView, /\{parentLevel\.singularLabel\}: \{parent\.name\}/);
  assert.doesNotMatch(levelView, /["'`>][^"'`<>{}]*\b(Departments?|Systems?|Disciplines?)\b[^"'`<>{}]*["'`<]/);
  // A non-Other project that reaches it is sent to its Overview.
  assert.match(levelView, /if \(family !== "other"\) router\.replace\(projectSectionHref\(project\.id, "overview"\)\)/);
});

test("Project Setup, Review and the structure-governance UI are already dynamic; Weekly / Monthly are department-scoped", () => {
  // Setup steps and the Review for an Other project come from the Other flow and the configured levels.
  const workflow = code("../../config/project-workflow.ts");
  assert.match(workflow, /if \(context\.structureFamily === "other"\) return "other";/);
  assert.match(code("./components/setup/setup-step-review.tsx"), /StructureLevelSummary/);
  // Governance panel: level names for parents, children, labels and blockers.
  const panel = code("./components/governance/structure-governance-panel.tsx");
  assert.match(panel, /level\.singularLabel/);
  assert.match(panel, /levelLabel\(unit\.levelNumber\)/);
  // (The role "System Administrator" is the only appearance of those words.)
  assert.doesNotMatch(panel.replaceAll("System Administrator", ""), /\b(Departments?|Systems?|Disciplines?)\b/);
  const dependencies = code("./structure-dependencies.ts");
  assert.match(dependencies, /levelLabel\(structure\.levels, unit\.levelNumber \+ 1, true\)/);
  // Weekly / Monthly are built on Department entities (not units): their words are
  // not relabelled, because relabelling would misdescribe the data they operate on.
  assert.match(code("../weekly-reports/components/weekly-departments-panel.tsx"), /title="Departments"/);
});

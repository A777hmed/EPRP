// Other Project — Structure Levels & Structure Hierarchy UX. Real React markup
// over the real structure rules; no database, no installed test dependency.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

registerHooks({ load(url, context, nextLoad) {
  if (!url.endsWith(".tsx")) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });
const hierarchyModule = await import("./structure-hierarchy.ts");
const patterns = await import("./structure-patterns-ui.ts");
const workflow = await import("../../../config/project-workflow.ts");
const { StructureHierarchyView, StructureNodeCard } = await import("../components/setup/structure/structure-hierarchy-view.tsx");
const { StructureViews } = await import("../components/setup/structure/structure-views.tsx");
const { StructureUnitsEditor } = await import("../components/setup/structure/structure-units-editor.tsx");
const { StructureLevelsEditor } = await import("../components/setup/structure/structure-levels-editor.tsx");
const { buildStructureHierarchy, branchIds, defaultStructureView, countLabel } = hierarchyModule;

const LABELS = [["Function", "Functions"], ["Discipline", "Disciplines"], ["Package", "Packages"], ["Workfront", "Workfronts"]];
const levelsOf = (count) => LABELS.slice(0, count).map(([singularLabel, pluralLabel], index) => ({
  id: `l${index + 1}`, projectId: "p", levelNumber: index + 1, singularLabel, pluralLabel, createdAt: "t", updatedAt: "t",
}));
let order = 0;
const unit = (id, levelNumber, parentId, extra = {}) => ({
  id, projectId: "p", levelNumber, parentId, name: id, code: undefined, description: undefined, sortOrder: order++,
  weeklyReportingRequired: false, monthlyReportingRequired: false, createdAt: "t", updatedAt: "t", ...extra,
});
const structureOf = (levelCount, nodes = []) => ({ projectId: "p", version: "v1", levels: levelsOf(levelCount), nodes });
const project = { id: "p", code: "PRJ-OTH", name: "Other structure project", status: "active", structureFamily: "other",
  reporting: { weeklyEnabled: true, monthlyEnabled: true } };
const props = (structure, extra = {}) => ({ project, structure, canManage: true, actions: {}, ...extra });
const hierarchyHtml = (structure, extra = {}) =>
  renderToStaticMarkup(React.createElement(StructureHierarchyView, { project, structure, canManage: true, onManage() {}, ...extra }));
const levelsHtml = (structure, canManage = true) =>
  renderToStaticMarkup(React.createElement(StructureLevelsEditor, props(structure, { canManage })));
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const count = (html, pattern) => (html.match(pattern) ?? []).length;
const between = (html, start, end) => html.slice(html.indexOf(start), end ? html.indexOf(end, html.indexOf(start)) : undefined);

// The worked example: Engineering → Civil / Mechanical / Electrical → packages.
const engineering = () => {
  order = 0;
  return structureOf(3, [
    unit("Engineering", 1),
    unit("Civil", 2, "Engineering", { weeklyReportingRequired: true }),
    unit("Foundations", 3, "Civil"),
    unit("Structural", 3, "Civil", { monthlyReportingRequired: true }),
    unit("Mechanical", 2, "Engineering"),
    unit("Static Equipment", 3, "Mechanical"),
    unit("Rotating Equipment", 3, "Mechanical"),
    unit("Electrical", 2, "Engineering"),
    unit("Substation Package", 3, "Electrical"),
  ]);
};

/* ----------------------------- level definition ---------------------------- */

for (const levelCount of [1, 2, 3, 4]) {
  test(`${levelCount} configured level(s): the level flow shows exactly those levels in order, each under the one above`, () => {
    const html = levelsHtml(structureOf(levelCount));
    const flow = between(html, 'aria-label="Level order, top to bottom"', "</ol>");
    assert.equal(count(flow, /Level \d<\/span>/g), levelCount, "no fake unused levels");
    for (let n = 1; n <= levelCount; n++) {
      assert.match(flow, new RegExp(`Level ${n}<\\/span>`));
      assert.match(flow, new RegExp(`>${LABELS[n - 1][0]}<`));
    }
    assert.ok(flow.indexOf("Level 1<") < (levelCount > 1 ? flow.indexOf("Level 2<") : Infinity));
    assert.match(flow, /Top structural level/);
    for (let n = 2; n <= levelCount; n++) assert.match(flow, new RegExp(`Reports under ${LABELS[n - 2][0]}`));
    assert.equal(count(flow, /lowest level/g), levelCount > 1 ? 1 : 0);
    assert.doesNotMatch(flow, /Level [5-9]/);
    // The Structure Hierarchy level legend agrees.
    const legend = buildStructureHierarchy(structureOf(levelCount)).levels;
    assert.deepEqual(legend.map((level) => level.singular), LABELS.slice(0, levelCount).map(([singular]) => singular));
  });
}

test("level flow is visible read-only, counts active units, and long level names wrap", () => {
  const long = "Engineering, Procurement and Construction Management Coordination Function";
  const source = { ...structureOf(2, [unit("A", 1), unit("B", 1), unit("C", 2, "A")]),
    levels: [{ ...levelsOf(1)[0], singularLabel: long, pluralLabel: `${long}s` }, levelsOf(2)[1]] };
  const html = levelsHtml(source, false);
  const flow = between(html, 'aria-label="Level order, top to bottom"', "</ol>");
  assert.match(flow, new RegExp(long));
  assert.match(flow, /break-words text-sm font-semibold/);
  assert.match(flow, /2 Engineering, Procurement/);
  assert.match(flow, /1 Discipline/);
  assert.match(flow, new RegExp(`Reports under ${long}`));
});

test("draft levels keep their meaning before they are named", () => {
  assert.equal(patterns.levelRelation([{ levelNumber: 1, singularLabel: "" }], 2), "Reports under Level 1");
  assert.equal(patterns.levelRelation([], 1), "Top structural level");
});

/* ------------------------------ the hierarchy ------------------------------ */

test("parent-child units render nested under their parent with siblings in order", () => {
  const html = hierarchyHtml(engineering());
  const civil = between(html, 'aria-label="Civil: 2 Packages"', "</ul>");
  assert.match(civil, /data-hierarchy-unit="Foundations"/);
  assert.match(civil, /data-hierarchy-unit="Structural"/);
  assert.doesNotMatch(civil, /Static Equipment/);
  const engineeringChildren = between(html, 'aria-label="Engineering: 3 Disciplines"');
  const order = ["Civil", "Mechanical", "Electrical"].map((name) => engineeringChildren.indexOf(`data-hierarchy-unit="${name}"`));
  assert.ok(order.every((index) => index > 0) && order[0] < order[1] && order[1] < order[2]);
  assert.equal(count(html, /data-structure-node="/g), 9);
});

test("multiple Level 1 units become side-by-side columns joined by one connector", () => {
  order = 0;
  const source = structureOf(2, [unit("North", 1), unit("South", 1), unit("East", 1), unit("N1", 2, "North")]);
  const html = hierarchyHtml(source);
  assert.equal(count(html, /data-hierarchy-root="/g), 3);
  assert.match(html, /aria-label="Functions"/);
  const code = read("../components/setup/structure/structure-hierarchy-view.tsx");
  for (const piece of ["first:before:left-1/2", "last:before:right-1/2", "only:before:hidden", "after:left-1/2"]) assert.ok(code.includes(piece), piece);
  // A wide diagram opens centred on the Project apex (scroll position only).
  assert.match(code, /const overflow = region\.scrollWidth - region\.clientWidth;\s+if \(overflow > 0\) region\.scrollLeft = overflow \/ 2;/);
  assert.match(code, /\}, \[rootCount\]\);/);
});

test("a four-level deep hierarchy renders every level with level identity and parent context", () => {
  order = 0;
  const source = structureOf(4, [unit("F", 1), unit("D", 2, "F"), unit("P", 3, "D"), unit("W", 4, "P", { weeklyReportingRequired: true })]);
  const html = hierarchyHtml(source);
  for (const [name, level, label] of [["F", 1, "Function"], ["D", 2, "Discipline"], ["P", 3, "Package"], ["W", 4, "Workfront"]]) {
    const card = between(html, `data-structure-node="${name}"`, "</article>");
    assert.match(card, new RegExp(`L${level}<`));
    assert.match(card, new RegExp(`title="${label}"`));
  }
  assert.match(html, /aria-label="W — Workfront, Level 4, under P"/);
  assert.deepEqual(branchIds(buildStructureHierarchy(source).roots), ["F", "D", "P"]);
});

test("long unit names wrap in full; the level label truncates with its full text kept", () => {
  order = 0;
  const long = "Rotating Equipment Package for the Gas Compression Train Including Lube Oil Skids";
  const html = hierarchyHtml(structureOf(1, [unit("x", 1, undefined, { name: long })]));
  const card = between(html, 'data-structure-node="x"', "</article>");
  assert.match(card, new RegExp(`break-words text-sm font-semibold leading-snug">${long}<`));
  assert.match(card, /truncate" title="Function"/);
  const code = read("../components/setup/structure/structure-hierarchy-view.tsx");
  assert.match(code, /overflow-x-auto overscroll-x-contain/);
  assert.match(code, /w-max min-w-full/);
  assert.match(code, /w-72 shrink-0/);
});

test("Weekly and Monthly input flags are visible only where required; archived units are hidden and counted", () => {
  const source = engineering();
  source.nodes.push(unit("Old", 2, "Engineering", { archivedAt: "2026-09-01", weeklyReportingRequired: false }));
  const html = hierarchyHtml(source);
  const civil = between(html, 'data-structure-node="Civil"', "</article>");
  const structural = between(html, 'data-structure-node="Structural"', "</article>");
  const mechanical = between(html, 'data-structure-node="Mechanical"', "</article>");
  assert.match(civil, />Weekly input</); assert.doesNotMatch(civil, />Monthly input</);
  assert.match(structural, />Monthly input</); assert.doesNotMatch(structural, />Weekly input</);
  assert.doesNotMatch(mechanical, /input</);
  assert.doesNotMatch(html, /data-structure-node="Old"/);
  assert.match(html, /1 archived unit hidden · shown in the Manage View/);
  assert.match(html, /Weekly input: 1 unit</); assert.match(html, /Monthly input: 1 unit</);
  assert.match(html, /9 active units across 3 levels/);
});

test("collapsed branches say what is hidden; expand / collapse controls are labelled", () => {
  const view = buildStructureHierarchy(engineering());
  const civil = view.roots[0].children[0];
  const collapsedCard = renderToStaticMarkup(React.createElement(StructureNodeCard, { node: civil, depth: 1, expanded: false, controls: "c", onToggle() {} }));
  assert.match(collapsedCard, /aria-expanded="false"/);
  assert.match(collapsedCard, /aria-label="Expand Civil \(2 Packages\)"/);
  assert.match(collapsedCard, /2 Packages · 2 units hidden/);
  const html = hierarchyHtml(engineering());
  assert.match(html, /aria-label="Collapse Engineering \(3 Disciplines\)"/);
  assert.match(html, /Expand all/); assert.match(html, /Collapse all/);
  assert.equal(view.roots[0].descendantCount, 8);
});

test("empty states: no levels, and levels without units (Manage View offered only to managers)", () => {
  assert.match(hierarchyHtml({ ...structureOf(0) }), /No structure levels yet/);
  const empty = hierarchyHtml(structureOf(2));
  assert.match(empty, /No Functions yet/); assert.match(empty, /Open Manage View/);
  assert.doesNotMatch(empty, /Structure Hierarchy diagram/);
  const readOnly = hierarchyHtml(structureOf(2), { canManage: false });
  assert.doesNotMatch(readOnly, /Open Manage View/); assert.doesNotMatch(readOnly, /<button/);
});

/* ------------------------ two views, one structure ------------------------- */

test("Hierarchy View and Manage View show the same units, levels and reporting input from one structure", () => {
  const source = engineering(); const before = JSON.stringify(source);
  const hierarchy = hierarchyHtml(source);
  const manage = renderToStaticMarkup(React.createElement(StructureUnitsEditor, props(source)));
  const shownIn = (html, attribute) => [...html.matchAll(new RegExp(`${attribute}="([^"]+)"`, "g"))].map((match) => match[1]).sort();
  assert.deepEqual(shownIn(hierarchy, "data-structure-node"), shownIn(manage, "data-structure-unit"));
  assert.equal(count(hierarchy, />Weekly input</g), count(manage, />Weekly input required</g));
  assert.equal(count(hierarchy, />Monthly input</g), count(manage, />Monthly input required</g));
  assert.equal(JSON.stringify(source), before, "views never change the structure");
});

test("the view opens on the Hierarchy once units exist, otherwise on Manage; one switch, pressed state exposed", () => {
  assert.equal(defaultStructureView(structureOf(2)), "manage");
  assert.equal(defaultStructureView(structureOf(2, [unit("Old", 1, undefined, { archivedAt: "x" })])), "manage");
  assert.equal(defaultStructureView(engineering()), "hierarchy");
  const withUnits = renderToStaticMarkup(React.createElement(StructureViews, props(engineering())));
  assert.match(withUnits, /Step 2 · Structure Hierarchy/);
  assert.match(withUnits, /aria-pressed="true"[^>]*>Hierarchy View/);
  assert.match(withUnits, /aria-pressed="false"[^>]*>Manage View/);
  const empty = renderToStaticMarkup(React.createElement(StructureViews, props(structureOf(2))));
  assert.match(empty, /Step 2 · Structure Hierarchy/);
  assert.match(empty, /aria-label="Structure Hierarchy · Manage View"/);
  assert.match(empty, /aria-pressed="true"[^>]*>Manage View/);
  for (const html of [withUnits, empty]) assert.equal(count(html, /aria-label="Structure view"/g), 1);
  const code = read("../components/setup/structure/structure-views.tsx");
  assert.match(code, /useState<StructureViewMode>\(\(\) => defaultStructureView\(props\.structure\)\)/, "chosen once per visit");
  assert.match(code, /<StructureUnitsEditor \{\.\.\.props\} headerAction=\{viewSwitch\} \/>/, "Manage View is the existing editor, same props");
  assert.match(code, /switchButtons\.current\[view\]\?\.focus\(\)/, "focus stays on the switch");
});

test("the Manage View keeps every existing write path; the hierarchy has none", () => {
  const editor = read("../components/setup/structure/structure-units-editor.tsx");
  assert.match(editor, /\{ headerAction, \.\.\.props \}: ProjectStructureWorkspaceProps & \{ headerAction\?: React\.ReactNode \}/);
  for (const intent of ["create", "details", "reporting", "move", "archive", "restore", "delete"]) assert.ok(editor.includes(`mode: "${intent}"`), intent);
  const view = [read("../components/setup/structure/structure-hierarchy-view.tsx"), read("./structure-hierarchy.ts"), read("../components/setup/structure/structure-views.tsx")].join("\n");
  assert.doesNotMatch(view, /createNode|updateNode|moveNode|archiveNode|restoreNode|deleteNode|setReportingFlags|configureLevels|supabase|\.rpc\(|\.from\(/);
});

/* -------------------------- scope and terminology -------------------------- */

test("one vocabulary — Level, Structure Unit, Structure Hierarchy — across Step 1, both Step 2 views and unit messages", async () => {
  const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'");
  const loose = /\b(layers?|groups?|grouping|items?)\b|hierarchy types?|input owners?/i;
  const source = engineering();
  const manage = (structure) => renderToStaticMarkup(React.createElement(StructureUnitsEditor, props(structure)));
  for (const html of [levelsHtml(source), levelsHtml(structureOf(0)), hierarchyHtml(source), hierarchyHtml(structureOf(2)),
    hierarchyHtml(structureOf(0)), manage(source), manage(structureOf(2)), manage(structureOf(0))]) {
    assert.doesNotMatch(visible(html), loose);
  }
  // Two representations of one step: same Step 2 name, same reporting-input summary.
  for (const text of [visible(hierarchyHtml(source)), visible(manage(source))]) {
    assert.match(text, /Step 2 · Structure Hierarchy/);
    assert.match(text, /Weekly input: 1 unit /); assert.match(text, /Monthly input: 1 unit /);
  }
  const units = await import("./structure-units-ui.ts");
  for (const reason of ["not_found", "archived", "not_archived", "deepest_level", "active_children", "parent_archived",
    "has_children", "same_parent", "wrong_level", "duplicate_name", "duplicate_code", "reporting_overlap", undefined]) {
    assert.doesNotMatch(units.unitRuleMessage(reason), loose, String(reason));
  }
  const dialog = read("../components/setup/structure/structure-unit-dialog.tsx");
  assert.doesNotMatch(dialog, /this item|hierarchy type|input owner|contributes input|responsibility will/i);
  assert.match(dialog, /provides input for\. Each report takes input from one unit per branch/);
});

test("Structure Hierarchy shows units only — no people, no Organization Chart wording", () => {
  const html = hierarchyHtml(engineering());
  assert.match(html, /Step 2 · Structure Hierarchy/);
  assert.match(html, /It shows units, not people/);
  assert.doesNotMatch(html, /Organization Chart|Org Chart/i);
  assert.doesNotMatch(html, /\b(Lead|Manager|Members?|Responsible|Backup|Delegate)\b/);
  const code = [read("../components/setup/structure/structure-hierarchy-view.tsx"), read("./structure-hierarchy.ts")].join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /Organization Chart|contactId|memberId|project_members/);
  assert.equal(countLabel(1, "Package", "Packages"), "1 Package");
  assert.equal(countLabel(2), "2 units");
});

test("PSM structure is untouched: Departments → Systems → Programs & Studies, no Project Structure step", () => {
  const psm = workflow.resolveSetupSteps({ structureFamily: "psm", saved: true }).map((step) => step.id);
  assert.deepEqual(psm.slice(0, 4), ["info", "departments", "systems", "disciplines"]);
  assert.equal(psm.includes("structure"), false);
  const other = workflow.resolveSetupSteps({ structureFamily: "other", saved: true }).map((step) => step.id);
  assert.deepEqual(other.slice(0, 2), ["info", "structure"]);
  const code = [read("../components/setup/structure/structure-hierarchy-view.tsx"), read("../components/setup/structure/structure-views.tsx"), read("./structure-hierarchy.ts")].join("\n");
  assert.doesNotMatch(code, /Departments|Systems|Programs & Studies|Disciplines/);
});

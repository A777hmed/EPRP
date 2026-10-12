// Phase 2C.1c-e/f: deterministic component callbacks, real React markup,
// domain preflight and action wiring. No database or installed test dependency.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

registerHooks({ load(url, context, nextLoad) {
  if (!url.endsWith(".tsx")) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });
const rules = await import("./structure-rules.ts");
const ui = await import("./structure-units-ui.ts");
const workflow = await import("../../../config/project-workflow.ts");
const { ProjectStructureError } = await import("../../../services/project-structure-errors.ts");
const { createStructureActions } = await import("./structure-workspace-contract.ts");
const { StructureUnitsEditor } = await import("../components/setup/structure/structure-units-editor.tsx");
const { StructureLevelsEditor } = await import("../components/setup/structure/structure-levels-editor.tsx");
const { ProjectStructureWorkspace } = await import("../components/setup/structure/project-structure-workspace.tsx");
const { StructureViews } = await import("../components/setup/structure/structure-views.tsx");

const levels = [
  { id: "l1", projectId: "p", levelNumber: 1, singularLabel: "Function", pluralLabel: "Functions", createdAt: "t", updatedAt: "t" },
  { id: "l2", projectId: "p", levelNumber: 2, singularLabel: "Workstream", pluralLabel: "Workstreams", createdAt: "t", updatedAt: "t" },
];
const node = (id, levelNumber = 1, parentId, extra = {}) => ({
  id, projectId: "p", levelNumber, parentId, name: id, code: undefined, description: undefined, sortOrder: 0,
  weeklyReportingRequired: false, monthlyReportingRequired: false, createdAt: "t", updatedAt: "t", ...extra,
});
const root = node("Alpha"), another = node("Beta"), child = node("Scope A", 2, root.id);
const structure = (nodes = []) => ({ projectId: "p", version: "v1", levels, nodes });
const project = { id: "p", code: "P", name: "Project", status: "active", structureFamily: "other", reporting: { weeklyEnabled: true, monthlyEnabled: true } };
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const make = (mode, target = root) => mode === "create" ? { mode, levelNumber: 1 } : { mode, node: target };
const fields = (intent, patch = {}) => ({ ...ui.initialUnitFields(intent), ...patch });
const issues = (source, intent, patch = {}) => ui.unitFormIssues(source, intent, fields(intent, patch));
const propsFor = (source = structure(), extra = {}) => ({ project, structure: source, canManage: true, actions: {}, ...extra });
const render = (source, extra = {}) => renderToStaticMarkup(React.createElement(StructureUnitsEditor, propsFor(source, extra)));

test("workspace sibling editors have unique stable keys scoped to their role and project", () => {
  const editorKeys = (projectId, extra = {}) => {
    const workspace = ProjectStructureWorkspace(propsFor(structure(), { project: { ...project, id: projectId }, ...extra }));
    const editors = workspace.props.children.props.children.filter((child) => React.isValidElement(child) && typeof child.type === "function");
    assert.equal(editors.length, 2);
    const keys = editors.map((editor) => editor.key);
    assert.equal(new Set(keys).size, keys.length, "Level and Units editors must not share a sibling key");
    return keys;
  };
  const projectId = "ee654f5a-12bf-42d2-b062-137609eb85c8";
  const keys = editorKeys(projectId);
  assert.deepEqual(editorKeys(projectId), keys);
  assert.deepEqual(editorKeys(projectId, { canManage: false }), keys);
  const otherKeys = editorKeys("another-project");
  assert.ok(keys.every((key, index) => key !== otherKeys[index]), "Both editors reset when project identity changes");
});

test("workspace composes exactly one levels editor and one structure-views container with unchanged callbacks", () => {
  for (const canManage of [true, false]) {
    const props = propsFor(structure([root, child]), { canManage, actions: { configureLevels() {}, createNode() {}, updateNode() {}, refresh() {} } });
    const workspace = ProjectStructureWorkspace(props);
    const children = workspace.props.children.props.children.filter(React.isValidElement);
    const levelEditors = children.filter((entry) => entry.type === StructureLevelsEditor);
    // The units are shown through StructureViews: Hierarchy View or Manage View
    // (the unchanged StructureUnitsEditor), both over the same props.
    const views = children.filter((entry) => entry.type === StructureViews);
    assert.equal(levelEditors.length, 1); assert.equal(views.length, 1);
    for (const editor of [...levelEditors, ...views]) {
      assert.equal(editor.props.actions, props.actions);
      assert.equal(editor.props.structure, props.structure);
      assert.equal(editor.props.project, props.project);
      assert.equal(editor.props.canManage, canManage);
    }
  }
});

test("complete workspace markup contains each step heading and configured level row exactly once", () => {
  for (const canManage of [true, false]) {
    for (const source of [structure(), structure([root, child]), { ...structure(), levels: [] }]) {
      const html = renderToStaticMarkup(React.createElement(ProjectStructureWorkspace, propsFor(source, { canManage })));
      const hasUnits = source.nodes.some((entry) => !entry.archivedAt);
      assert.equal((html.match(/<h3[^>]*>Step 1 · How is this project organized\?<\/h3>/g) ?? []).length, 1);
      // Exactly one Step 2, named the same in both views: the Hierarchy View
      // once there are units, otherwise the Manage View.
      assert.equal((html.match(/<h3[^>]*>Step 2 · [^<]*<\/h3>/g) ?? []).length, 1);
      assert.equal((html.match(/<h3[^>]*>Step 2 · Structure Hierarchy<\/h3>/g) ?? []).length, 1);
      assert.equal((html.match(/aria-label="Structure level configuration"/g) ?? []).length, 1);
      assert.equal((html.match(/aria-label="Structure Hierarchy · Manage View"/g) ?? []).length, hasUnits ? 0 : 1);
      assert.equal((html.match(/aria-label="Structure Hierarchy · Hierarchy View"/g) ?? []).length, hasUnits ? 1 : 0);
      assert.equal((html.match(/aria-label="Structure view"/g) ?? []).length, 1, "one view switch");
      for (const level of source.levels) {
        assert.equal((html.match(new RegExp(`value="${level.singularLabel}"`, "g")) ?? []).length, 1);
        assert.equal((html.match(new RegExp(`value="${level.pluralLabel}"`, "g")) ?? []).length, 1);
      }
    }
  }
});

// Executes real production handlers with the repository's minimal hook
// lifecycle convention. Real primitive markup is separately rendered above.
function componentHarness(filename, initialProps) {
  const slots = [], effects = [], notifications = [], unload = new Map();
  let cursor = 0, effectCursor = 0, tree;
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useId: () => "unit",
    useEffect(effect, deps) {
      const index = effectCursor++, previous = effects[index];
      if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) {
        previous?.cleanup?.(); effects[index] = { deps, effect, pending: true };
      }
    },
  };
  const primitives = (names) => Object.fromEntries(names.map((name) => [name, name]));
  const modules = {
    react: hooks, sonner: { toast: { success: (message) => notifications.push(message) } },
    "lucide-react": primitives(["Check", "ChevronDown", "ChevronRight", "Circle", "MoreHorizontal", "Plus"]),
    "@/components/ui/button": { Button: "button" }, "@/components/ui/input": { Input: "input" },
    "@/components/ui/label": { Label: "label" }, "@/components/ui/textarea": { Textarea: "textarea" },
    "@/components/ui/dialog": primitives(["Dialog", "DialogContent", "DialogDescription", "DialogFooter", "DialogHeader", "DialogTitle"]),
    "@/components/ui/select": primitives(["Select", "SelectContent", "SelectItem", "SelectTrigger", "SelectValue"]),
    "@/components/ui/dropdown-menu": primitives(["DropdownMenu", "DropdownMenuContent", "DropdownMenuItem", "DropdownMenuSeparator", "DropdownMenuTrigger"]),
    "@/config/project-workflow": workflow, "../../../structure/structure-rules": rules,
    "../../../structure/structure-units-ui": ui, "./structure-unit-dialog": { StructureUnitDialog: "UnitDialog" },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(`../components/setup/structure/${filename}.tsx`), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText, {
    exports,
    window: { addEventListener: (name, fn) => unload.set(name, fn), removeEventListener: (name) => unload.delete(name) },
    require(name) { if (modules[name]) return modules[name]; throw new Error(`Unexpected UI dependency: ${name}`); },
  });
  const props = { ...initialProps };
  const component = exports[filename === "structure-unit-dialog" ? "StructureUnitDialog" : "StructureUnitsEditor"];
  function walk(entry, predicate) {
    if (!entry || typeof entry !== "object") return [];
    if (Array.isArray(entry)) return entry.flatMap((part) => walk(part, predicate));
    return [...(predicate(entry) ? [entry] : []), ...walk(entry.props?.children, predicate)];
  }
  function textOf(entry) {
    if (Array.isArray(entry)) return entry.map(textOf).join("");
    if (entry == null || typeof entry === "boolean") return "";
    return typeof entry === "object" ? textOf(entry.props?.children) : String(entry);
  }
  function render(patch = {}) {
    Object.assign(props, patch); cursor = 0; effectCursor = 0; tree = component(props);
    for (const effect of effects) if (effect.pending) { effect.pending = false; effect.cleanup = effect.effect(); }
  }
  render();
  return {
    render, notifications, unload,
    all: (type) => walk(tree, (entry) => entry.type === type),
    text: () => textOf(tree),
    button: (name) => walk(tree, (entry) => entry.type === "button" && textOf(entry).trim() === name)[0],
    menu: (name) => walk(tree, (entry) => entry.type === "DropdownMenuItem" && textOf(entry).trim() === name)[0],
    field: (field) => walk(tree, (entry) => entry.props?.id === `unit-${field}`)[0],
    submit: () => walk(tree, (entry) => entry.type === "form")[0].props.onSubmit({ preventDefault() {} }),
  };
}
const dialog = (source, intent, extra = {}) => componentHarness("structure-unit-dialog", propsFor(source, { intent, onClose() {}, onSaved() {}, onReload() {}, ...extra }));

test("empty state and action use the configured first type", () => {
  const html = render(structure());
  assert.match(html, /Add your first Function/);
  assert.match(html, /Add Function/);
  assert.match(html, /Functions are this project&#x27;s Level 1 Structure Units/);
  assert.doesNotMatch(html, /Add node|parent node|node id|Add Level 1 unit/);
});
test("root create callback sends one validated explicit action without keystroke saving", async () => {
  const calls = []; let saved = 0;
  const harness = dialog(structure(), make("create"), { actions: { createNode: async (input) => { calls.push(JSON.parse(JSON.stringify(input))); } }, onSaved: () => { saved++; } });
  harness.field("name").props.onChange({ target: { value: " Gamma " } }); harness.render();
  assert.equal(calls.length, 0);
  await harness.submit(); harness.render();
  assert.deepEqual(calls, [{ levelNumber: 1, name: "Gamma", code: "", description: "", weeklyReportingRequired: false, monthlyReportingRequired: false }]);
  assert.equal(saved, 1);
});
test("child creation uses configured terminology, parent and exactly one deeper type", async () => {
  const harness = componentHarness("structure-units-editor", propsFor(structure([root])));
  harness.menu("Add Workstream under Alpha").props.onSelect(); harness.render();
  const intent = harness.all("UnitDialog")[0].props.intent;
  assert.deepEqual(JSON.parse(JSON.stringify(intent)), { mode: "create", levelNumber: 2, parentId: "Alpha" });
  const calls = [];
  const form = dialog(structure([root]), intent, { actions: { createNode: async (input) => calls.push(input) } });
  form.field("name").props.onChange({ target: { value: "Scope B" } }); form.render();
  await form.submit();
  assert.equal(calls[0].parentId, "Alpha"); assert.equal(calls[0].levelNumber, 2);
  assert.match(form.text(), /Parent Function/);
});
test("parent candidates are active and immediately above; picker shows full paths", () => {
  const archivedRoot = node("Old", 1, undefined, { archivedAt: "a" });
  const source = structure([root, another, archivedRoot, child]);
  assert.deepEqual(rules.parentCandidates(source, 2).map((n) => n.id), ["Alpha", "Beta"]);
  const form = dialog(source, { mode: "create", levelNumber: 2 });
  assert.deepEqual(form.all("SelectItem").map((entry) => entry.props.value), ["Alpha", "Beta"]);
});
test("invalid or missing parent is blocked before create", async () => {
  const intent = { mode: "create", levelNumber: 2 };
  assert.match(issues(structure([root, child]), intent, { name: "New", parentId: child.id })[0].message, /immediately above/);
  assert.match(issues(structure([root]), intent, { name: "New" })[0].message, /Select the parent/);
  let calls = 0;
  const form = dialog(structure([root]), intent, { actions: { createNode: async () => { calls++; } } });
  form.field("name").props.onChange({ target: { value: "New" } }); form.render(); await form.submit();
  assert.equal(calls, 0);
});
test("duplicate normalized active sibling name is blocked; another parent is allowed", () => {
  const intent = { mode: "create", levelNumber: 2 };
  assert.ok(issues(structure([root, another, child]), intent, { name: " scope a ", parentId: root.id }).some((i) => i.field === "name"));
  assert.deepEqual(issues(structure([root, another, child]), intent, { name: "Scope A", parentId: another.id }), []);
});
test("duplicate active project code is blocked for creation and detail editing", () => {
  const coded = node("Coded", 1, undefined, { code: "A1" });
  for (const intent of [make("create"), make("details")]) {
    assert.ok(issues(structure([root, coded]), intent, { name: "New", code: " a1 " }).some((i) => i.field === "code"));
  }
});
test("explicit detail edit sends name/code/description with original record, no level mutation", async () => {
  const calls = [], intent = make("details");
  const form = dialog(structure([root]), intent, { actions: { updateNode: async (...args) => calls.push(args) } });
  for (const [field, value] of [["name", "Renamed"], ["code", "C2"], ["description", "Useful context"]]) {
    form.field(field).props.onChange({ target: { value } }); form.render();
  }
  assert.equal(calls.length, 0); await form.submit();
  assert.equal(calls[0][0], root);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), { name: "Renamed", code: "C2", description: "Useful context" });
  assert.equal(form.field("levelNumber"), undefined);
});
test("detail validation excludes self and does not revalidate immutable parent or reporting flags", () => {
  assert.deepEqual(issues(structure([root, child]), make("details", child), { description: "Changed" }), []);
  const archivedRoot = { ...root, archivedAt: "a" }, archivedChild = { ...child, archivedAt: "a" };
  assert.deepEqual(issues(structure([archivedRoot, archivedChild]), make("details", archivedChild), { description: "Changed" }), []);
});
test("valid move sends original record and selected immediately higher parent", async () => {
  const intent = make("move", child), source = structure([root, another, child]), calls = [];
  assert.deepEqual(issues(source, intent, { parentId: another.id }), []);
  const form = dialog(source, intent, { actions: { moveNode: async (...args) => calls.push(args) } });
  form.all("Select")[0].props.onValueChange(another.id); form.render(); await form.submit();
  assert.deepEqual(calls, [[child, another.id]]);
});
test("invalid moves: wrong type, missing parent, archived parent and sibling duplicate", () => {
  const old = node("Old", 1, undefined, { archivedAt: "a" });
  const duplicate = node("duplicate", 2, another.id, { name: child.name });
  const source = structure([root, another, child, old, duplicate]);
  for (const parentId of [child.id, "missing", old.id, another.id]) assert.ok(issues(source, make("move", child), { parentId }).length > 0);
});
test("archive confirmation calls one action; active children block archive", async () => {
  const calls = [], intent = make("archive");
  const form = dialog(structure([root]), intent, { actions: { archiveNode: async (record) => calls.push(record) } });
  assert.match(form.text(), /Weekly and Monthly input settings will be cleared/);
  await form.submit(); assert.deepEqual(calls, [root]);
  assert.match(issues(structure([root, child]), intent)[0].message, /active children first/);
  const blocked = dialog(structure([root, child]), intent, { actions: { archiveNode: async (record) => calls.push(record) } });
  await blocked.submit(); assert.equal(calls.length, 1);
});
test("archived units cannot provide input or offer reporting/move/create-child actions", () => {
  const old = { ...root, archivedAt: "a" }, source = structure([old]);
  assert.ok(issues(source, make("reporting", old), { weeklyReportingRequired: true }).length > 0);
  const harness = componentHarness("structure-units-editor", propsFor(source));
  harness.button("Show archived (1)").props.onClick(); harness.render();
  assert.equal(harness.menu("Reporting input"), undefined);
  assert.equal(harness.menu("Move Function"), undefined);
  assert.equal(harness.menu("Add Workstream under Alpha").props.disabled, true);
  assert.ok(harness.button("Add Function"), "can add a root even when all displayed roots are archived");
});
test("restore preflight and explicit confirmation", async () => {
  const old = { ...child, archivedAt: "a" }, calls = [], intent = make("restore", old);
  assert.deepEqual(issues(structure([root, old]), intent), []);
  const form = dialog(structure([root, old]), intent, { actions: { restoreNode: async (record) => calls.push(record) } });
  await form.submit(); assert.deepEqual(calls, [old]);
  assert.ok(issues(structure([{ ...root, archivedAt: "a" }, old]), intent).length > 0);
});
test("restore rejects duplicate active name and duplicate active code", () => {
  const old = { ...child, archivedAt: "a", code: "C1" }, intent = make("restore", old);
  const sameName = node("Other", 2, root.id, { name: child.name });
  const sameCode = node("Other", 2, root.id, { code: "c1" });
  assert.match(issues(structure([root, old, sameName]), intent)[0].message, /name/);
  assert.match(issues(structure([root, old, sameCode]), intent)[0].message, /code/);
});
test("permitted delete requires confirmation, children (including archived) prevent deletion", async () => {
  const calls = [], intent = make("delete", child);
  const form = dialog(structure([root, child]), intent, { actions: { deleteNode: async (record) => calls.push(record) } });
  assert.equal(calls.length, 0);
  assert.match(form.text(), /protected references/);
  await form.submit(); assert.deepEqual(calls, [child]);
  assert.ok(issues(structure([root, { ...child, archivedAt: "a" }]), make("delete")).length > 0);
});
test("Weekly and Monthly input save independently through existing flag action", async () => {
  for (const field of ["weeklyReportingRequired", "monthlyReportingRequired"]) {
    const calls = [], form = dialog(structure([root]), make("reporting"), { actions: { setReportingFlags: async (...args) => calls.push(args) } });
    form.field(field).props.onChange({ target: { checked: true } }); form.render();
    assert.equal(calls.length, 0); await form.submit();
    assert.equal(calls[0][0], root); assert.equal(calls[0][1][field], true);
  }
});
test("same-type nested reporting overlaps are blocked in both directions", () => {
  for (const field of ["weeklyReportingRequired", "monthlyReportingRequired"]) {
    const parentOwns = { ...root, [field]: true }, childOwns = { ...child, [field]: true };
    assert.match(issues(structure([parentOwns, child]), make("reporting", child), { [field]: true })[0].message, /one unit per branch/);
    assert.ok(issues(structure([root, childOwns]), make("reporting"), { [field]: true }).length > 0);
  }
});
test("cross-report parent/child input is allowed", () => {
  const parentOwns = { ...root, weeklyReportingRequired: true };
  assert.deepEqual(issues(structure([parentOwns, child]), make("reporting", child), { monthlyReportingRequired: true }), []);
});
test("creation reporting conflict is explained before any save", () => {
  const parentOwns = { ...root, weeklyReportingRequired: true }, intent = { mode: "create", levelNumber: 2, parentId: root.id };
  assert.match(issues(structure([parentOwns]), intent, { name: "New", weeklyReportingRequired: true })[0].message, /one unit per branch/);
});
test("move previews reporting overlap introduced by the new parent branch", () => {
  const owner = { ...another, weeklyReportingRequired: true }, reports = { ...child, weeklyReportingRequired: true };
  assert.match(issues(structure([root, owner, reports]), make("move", reports), { parentId: owner.id })[0].message, /one unit per branch/);
});
test("completion reacts to creation and independent Weekly/Monthly input units", () => {
  const remaining = (nodes) => workflow.structureStepChecks(project, { structure: structure(nodes) }).filter((c) => !c.passed).map((c) => c.label);
  assert.equal(remaining([]).length, 4);
  assert.equal(remaining([root]).length, 3);
  assert.equal(remaining([root, child]).length, 2);
  const weeklyRoot = { ...root, weeklyReportingRequired: true };
  assert.equal(remaining([weeklyRoot, child]).length, 1);
  const monthlyChild = { ...child, monthlyReportingRequired: true };
  assert.deepEqual(remaining([weeklyRoot, monthlyChild]), []);
  assert.match(render(structure([weeklyRoot, monthlyChild])), /Project Structure requirements complete/);
  assert.match(render(structure([weeklyRoot, monthlyChild])), /Weekly input: 1 unit</);
  assert.match(render(structure([weeklyRoot, monthlyChild])), /Monthly input: 1 unit</);
});
test("read-only hierarchy and reporting remain readable, with no mutation controls", async () => {
  const source = structure([{ ...root, weeklyReportingRequired: true }, child]);
  const html = render(source, { canManage: false });
  assert.match(html, /Weekly input required/); assert.match(html, /Parent Function/);
  assert.doesNotMatch(html, /Actions for|Add Function|Edit Function/);
  const harness = componentHarness("structure-units-editor", propsFor(source, { canManage: false }));
  assert.equal(harness.all("DropdownMenuItem").length, 0);
  let calls = 0;
  const form = dialog(source, make("details"), { canManage: false, actions: { updateNode: async () => { calls++; } } });
  await form.submit(); assert.equal(calls, 0);
});
test("archived projects use container read-only authority; UI never grants its own", () => {
  const html = render(structure([root]), { project: { ...project, status: "archived" }, canManage: false });
  assert.doesNotMatch(html, /Actions for|Add Function/);
  assert.match(read("../components/setup/project-setup-view.tsx"), /canManageStructure=\{canManage && savedBaseline.status !== "archived"\}/);
});
test("stale refusal is dynamic and safe, preserves edits, blocks saving and does not retry", async () => {
  let calls = 0;
  const source = structure([root]), form = dialog(source, make("details"), { actions: { updateNode: async () => { calls++; throw new ProjectStructureError("stale"); } } });
  form.field("name").props.onChange({ target: { value: "Local edit" } }); form.render(); await form.submit(); form.render();
  assert.equal(calls, 1); assert.equal(form.field("name").props.value, "Local edit");
  assert.match(form.text(), /This Function changed/);
  await form.submit(); assert.equal(calls, 1);
  assert.ok(form.button("Reload and discard edits"));
});
test("winner refresh never silently replaces local dialog fields or the original record", async () => {
  let calls = 0;
  const form = dialog(structure([root]), make("details"), { actions: { updateNode: async () => { calls++; } } });
  form.field("name").props.onChange({ target: { value: "Local edit" } }); form.render();
  form.render({ structure: structure([{ ...root, name: "Server winner", updatedAt: "new" }]) });
  assert.equal(form.field("name").props.value, "Local edit"); await form.submit(); assert.equal(calls, 0);
});
test("unknown failures never leak SQL or constraint text; protected delete refusal stays visible", async () => {
  assert.doesNotMatch(ui.unitActionError(new Error("SQL constraint null undefined"), "Function").message, /SQL|constraint|null|undefined/);
  assert.equal(ui.unitActionError(new ProjectStructureError("failed"), "Function").reload, true);
  assert.doesNotMatch(ui.unitActionError(new ProjectStructureError("failed"), "Function").message, /No changes were made/);
  const form = dialog(structure([root]), make("delete"), { actions: { deleteNode: async () => { throw new ProjectStructureError("has_children"); } } });
  await form.submit(); form.render(); assert.match(form.text(), /child/);
});
test("unsaved dialog Cancel requires explicit discard and browser unload is guarded", () => {
  let closed = 0;
  const form = dialog(structure(), make("create"), { onClose: () => { closed++; } });
  form.field("name").props.onChange({ target: { value: "Unsaved" } }); form.render();
  assert.equal(form.unload.has("beforeunload"), true);
  form.button("Cancel").props.onClick(); form.render(); assert.equal(closed, 0);
  assert.match(form.text(), /Discard the unsaved edits/);
  form.button("Discard changes").props.onClick(); assert.equal(closed, 1);
});
test("disabled saving and submit guard prevent concurrent duplicate writes", async () => {
  let calls = 0, resolve;
  const form = dialog(structure(), make("create"), { actions: { createNode: () => { calls++; return new Promise((done) => { resolve = done; }); } } });
  form.field("name").props.onChange({ target: { value: "New" } }); form.render();
  const saving = form.submit(); await form.submit(); assert.equal(calls, 1);
  form.render(); assert.equal(form.field("name").props.disabled, true);
  resolve(); await saving;
});
test("mutation menus stay disabled until a new container read arrives", () => {
  const source = structure([root]), harness = componentHarness("structure-units-editor", propsFor(source));
  harness.menu("Edit Function").props.onSelect(); harness.render();
  harness.all("UnitDialog")[0].props.onSaved(); harness.render();
  assert.equal(harness.all("button").find((b) => b.props["aria-label"]?.startsWith("Actions for")).props.disabled, true);
  harness.render({ structure: structure([root]) });
  assert.equal(harness.all("button").find((b) => b.props["aria-label"]?.startsWith("Actions for")).props.disabled, false);
});
test("action contract uses original updatedAt and reloads stale once without retry", async () => {
  let reloads = 0, calls = 0;
  const service = { updateNode: async (ref) => { calls++; assert.equal(ref.updatedAt, root.updatedAt); throw new ProjectStructureError("stale"); } };
  const actions = createStructureActions({ projectId: "p", service, currentVersion: () => "v1", afterWrite: () => { reloads++; }, refresh() {} });
  await assert.rejects(ui.saveStructureUnit(actions, make("details"), fields(make("details"), { name: "Changed" })), (e) => e.reason === "stale");
  assert.equal(calls, 1); assert.equal(reloads, 1);
});
test("configured custom labels work without Construction demo data or a PSM fallback", () => {
  const custom = { ...structure([root]), levels: [{ ...levels[0], singularLabel: "Zone", pluralLabel: "Zones" }] };
  assert.match(render(custom), /Add Zone/);
  const code = [read("./structure-units-ui.ts"), read("../components/setup/structure/structure-unit-dialog.tsx"), read("../components/setup/structure/structure-units-editor.tsx")].join("\n");
  assert.doesNotMatch(code, /Civil|Earthworks|Mechanical|Piping|Procurement|Departments|Systems|Disciplines/);
  assert.doesNotMatch(code, /Add node|node id|Parent node/);
});
test("UI has no direct data client, own authority, fabricated version, or schema/report/planning writes", () => {
  const code = [read("./structure-units-ui.ts"), read("../components/setup/structure/structure-unit-dialog.tsx"), read("../components/setup/structure/structure-units-editor.tsx")].join("\n");
  assert.doesNotMatch(code, /supabase|\.from\(|\.rpc\(|createClient|useProjectAuthority|canManageOperations|expectedVersion|Date\.now|Math\.random|structure_node_id|planningService|weeklyReportService|monthlyReportService/);
  assert.match(code, /structureStepChecks\(project, \{ structure \}\)/);
  assert.match(code, /structureCompleteness\(structure\)/);
});
test("dialog labels, linked errors, reporting helper, keyboard actions and responsive rows", () => {
  const dialogCode = read("../components/setup/structure/structure-unit-dialog.tsx");
  assert.match(dialogCode, /DialogTitle/); assert.match(dialogCode, /DialogDescription/);
  assert.match(dialogCode, /aria-describedby/); assert.match(dialogCode, /aria-invalid/);
  assert.match(dialogCode, /htmlFor/); assert.match(dialogCode, /min-h-11/);
  assert.match(dialogCode, /sm:grid-cols-2/); assert.match(dialogCode, /max-h-\[85dvh\]/);
  assert.match(read("../components/setup/structure/structure-units-editor.tsx"), /grid-cols-\[minmax\(0,1fr\)_auto\]/);
});

test("dialog restores focus to its invoking row, with a hierarchy fallback after deletion", () => {
  let restored = 0, prevented = 0;
  const form = dialog(structure([root]), make("details"), { onReturnFocus: () => { restored++; } });
  form.all("DialogContent")[0].props.onCloseAutoFocus({ preventDefault: () => { prevented++; } });
  assert.equal(restored, 1); assert.equal(prevented, 1);
  const harness = componentHarness("structure-units-editor", propsFor(structure([root])));
  let rowFocus = 0, sectionFocus = 0;
  const row = { isConnected: true, disabled: false, focus: () => { rowFocus++; } };
  harness.all("button").find((entry) => entry.props["aria-label"] === "Actions for Function Alpha").props.ref(row);
  harness.all("section")[0].props.ref.current = { focus: () => { sectionFocus++; } };
  harness.menu("Edit Function").props.onSelect(); harness.render();
  harness.all("UnitDialog")[0].props.onReturnFocus(); assert.equal(rowFocus, 1);
  row.isConnected = false;
  harness.all("UnitDialog")[0].props.onReturnFocus(); assert.equal(sectionFocus, 1);
});

const treeHarness = (source, extra = {}) => componentHarness("structure-units-editor", propsFor(source, extra));
const treeRows = (harness) => harness.all("li").filter((entry) => entry.props["data-structure-unit"]);
const branchButton = (harness, name) => harness.all("button").find((entry) => entry.props["aria-label"] === name);

test("root hierarchy nodes expose identity, compact card, code, description and textual states", () => {
  const source = structure([{ ...root, code: "AL", description: "Main project group", weeklyReportingRequired: true }]);
  const harness = treeHarness(source);
  assert.equal(treeRows(harness).length, 1);
  assert.equal(treeRows(harness)[0].key, root.id);
  const card = harness.all("div").find((entry) => entry.props["aria-label"] === "Function: Alpha");
  assert.match(card.props.className, /rounded-md border bg-card p-3/);
  for (const text of ["Alpha", "AL", "Main project group", "Function", "Active", "Weekly input required", "Monthly input —"]) assert.ok(harness.text().includes(text));
});

test("child and contextual creation belong to their parent's connected branch, with unique stable keys", () => {
  const harness = treeHarness(structure([root, child]));
  const branch = harness.all("ul").find((entry) => entry.props["aria-label"] === "Alpha children");
  assert.match(branch.props.className, /border-l-2 border-border/);
  const siblings = branch.props.children.flat(Infinity).filter(Boolean);
  assert.deepEqual(siblings.map((entry) => entry.key), [child.id, `add:${root.id}`]);
  assert.equal(new Set(siblings.map((entry) => entry.key)).size, siblings.length);
  assert.match(siblings[0].props.children[0].props.className, /border-t-2 border-border/);
  assert.equal(siblings[0].props.children[0].props["aria-hidden"], "true");
});

test("multiple roots stay separate and only their own descendants collapse", () => {
  const secondChild = node("Scope B", 2, another.id);
  const harness = treeHarness(structure([root, child, another, secondChild]));
  const roots = harness.all("ul").find((entry) => entry.props["aria-label"] === "Functions");
  assert.match(roots.props.className, /space-y-4/);
  assert.deepEqual(roots.props.children.map((entry) => entry.key), [root.id, another.id]);
  branchButton(harness, "Collapse Function Alpha branch").props.onClick(); harness.render();
  assert.deepEqual(treeRows(harness).map((entry) => entry.key), [root.id, another.id, secondChild.id]);
  assert.equal(branchButton(harness, "Expand Function Alpha branch").props["aria-expanded"], false);
  branchButton(harness, "Expand Function Alpha branch").props.onClick(); harness.render();
  assert.equal(treeRows(harness).length, 4);
});

test("collapse keeps ownership and completion facts, expands with a labelled native control", () => {
  const source = structure([{ ...root, weeklyReportingRequired: true }, { ...child, monthlyReportingRequired: true }]);
  const harness = treeHarness(source); const before = JSON.stringify(source);
  const button = branchButton(harness, "Collapse Function Alpha branch");
  assert.equal(button.type, "button"); assert.equal(button.props["aria-expanded"], true);
  assert.equal(button.props["aria-controls"], harness.all("ul").find((entry) => entry.props["aria-label"] === "Alpha children").props.id);
  assert.match(button.props.className, /size-11/);
  button.props.onClick(); harness.render();
  assert.equal(treeRows(harness).length, 1);
  for (const text of ["Weekly input required", "1 Workstreams · collapsed", "Weekly input: 1 unit", "Monthly input: 1 unit", "Project Structure requirements complete", "Continue to Contacts"]) assert.ok(harness.text().includes(text));
  assert.equal(JSON.stringify(source), before);
});

test("contextual creation uses configured terminology and the existing dialog/actions", () => {
  const source = { ...structure([root]), levels: [{ ...levels[0], singularLabel: "Zone", pluralLabel: "Zones" }, { ...levels[1], singularLabel: "Section", pluralLabel: "Sections" }] };
  const actions = {}; const harness = treeHarness(source, { actions });
  branchButton(harness, "Add Section under Alpha").props.onClick({ currentTarget: {} }); harness.render();
  const dialogProps = harness.all("UnitDialog")[0].props;
  assert.deepEqual(JSON.parse(JSON.stringify(dialogProps.intent)), { mode: "create", levelNumber: 2, parentId: root.id });
  assert.equal(dialogProps.actions, actions); assert.equal(dialogProps.structure, source);
  assert.ok(harness.menu("Add Section under Alpha"));
  assert.ok(branchButton(harness, "Collapse Zone Alpha branch"));
});

test("contextual dialog returns focus to its actual invoking button", () => {
  const harness = treeHarness(structure([root])); let focus = 0;
  const trigger = { isConnected: true, disabled: false, focus: () => { focus++; } };
  branchButton(harness, "Add Workstream under Alpha").props.onClick({ currentTarget: trigger }); harness.render();
  harness.all("UnitDialog")[0].props.onReturnFocus();
  assert.equal(focus, 1);
});

test("contextual child save expands its parent and preserves the read-before-next-write guard", () => {
  const source = structure([root]); const harness = treeHarness(source);
  branchButton(harness, "Add Workstream under Alpha").props.onClick({ currentTarget: {} }); harness.render();
  branchButton(harness, "Collapse Function Alpha branch").props.onClick(); harness.render();
  harness.all("UnitDialog")[0].props.onSaved(); harness.render();
  assert.ok(branchButton(harness, "Collapse Function Alpha branch"));
  assert.equal(branchButton(harness, "Add Workstream under Alpha").props.disabled, true);
  harness.render({ structure: structure([root, child]) });
  assert.equal(branchButton(harness, "Add Workstream under Alpha").props.disabled, false);
});

test("read-only branches still expand and collapse with ownership visible and no mutation controls", () => {
  const harness = treeHarness(structure([{ ...root, weeklyReportingRequired: true }, child]), { canManage: false });
  assert.equal(harness.all("DropdownMenuItem").length, 0);
  assert.equal(branchButton(harness, "Add Workstream under Alpha"), undefined);
  branchButton(harness, "Collapse Function Alpha branch").props.onClick(); harness.render();
  assert.ok(harness.text().includes("Weekly input required"));
  assert.ok(branchButton(harness, "Expand Function Alpha branch"));
});

test("archived branches retain explicit lifecycle state and restore menus but no child creation", () => {
  const archivedRoot = { ...root, archivedAt: "archived", weeklyReportingRequired: true };
  const harness = treeHarness(structure([archivedRoot]));
  assert.equal(treeRows(harness).length, 0);
  harness.button("Show archived (1)").props.onClick(); harness.render();
  assert.equal(treeRows(harness).length, 1); assert.ok(harness.text().includes("Archived"));
  assert.ok(harness.menu("Restore Function"));
  assert.equal(branchButton(harness, "Add Workstream under Alpha"), undefined);
  assert.equal(harness.text().includes("Weekly input required"), false);
});

test("third and fourth configured levels render recursively with dynamic child actions", () => {
  const source = { ...structure([root, child, node("Deep", 3, child.id), node("Leaf", 4, "Deep")]), levels: [...levels,
    { ...levels[0], id: "l3", levelNumber: 3, singularLabel: "Section", pluralLabel: "Sections" },
    { ...levels[0], id: "l4", levelNumber: 4, singularLabel: "Task group", pluralLabel: "Task groups" }] };
  const harness = treeHarness(source);
  assert.deepEqual(treeRows(harness).map((entry) => entry.key), [root.id, child.id, "Deep", "Leaf"]);
  assert.ok(branchButton(harness, "Add Section under Scope A"));
  assert.ok(branchButton(harness, "Add Task group under Deep"));
  assert.equal(harness.all("button").some((entry) => entry.props["aria-label"] === "Add Task group under Leaf"), false);
  assert.ok(harness.text().includes("Parent Section: Deep"));
});

test("Civil Weekly and Earthworks Monthly fixture remains intact with all five workflow checks passed", () => {
  const civil = node("civil", 1, undefined, { name: "Civil", code: "CIV", weeklyReportingRequired: true });
  const earthworks = node("earthworks", 2, civil.id, { name: "Earthworks", code: "EW", monthlyReportingRequired: true });
  const source = structure([civil, earthworks]); const before = JSON.stringify(source);
  const harness = treeHarness(source);
  assert.equal(workflow.structureStepChecks(project, { structure: source }).filter((entry) => entry.passed).length, 5);
  assert.ok(harness.text().includes("Parent Function: Civil"));
  assert.ok(harness.text().includes("Weekly input required")); assert.ok(harness.text().includes("Monthly input required"));
  branchButton(harness, "Collapse Function Civil branch").props.onClick(); harness.render();
  assert.ok(harness.text().includes("Project Structure requirements complete"));
  assert.equal(JSON.stringify(source), before);
  assert.equal(issues(source, make("reporting", earthworks), { weeklyReportingRequired: true }).some((entry) => entry.reason === "reporting_overlap" || entry.message?.includes("Weekly")), true);
});

// Phase 2C.1c-d: actual server-rendered controls plus local form transitions,
// domain validation and atomic action wiring. No database or test dependency.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// This suite renders the production TSX with React. Next owns TSX in the app;
// Node needs the installed TypeScript compiler for this test-only loader.
registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".tsx")) return nextLoad(url, context);
    return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    };
  },
});

const { ProjectStructureWorkspace } = await import("../components/setup/structure/project-structure-workspace.tsx");
const draftModule = await import("./structure-levels-draft.ts");
const patternsModule = await import("./structure-patterns-ui.ts");
const { createLevelsDraft, levelsDraftReducer: reduce, levelsAreDirty: dirty, canRemoveDeepestLevel: removable, levelIssueMessage } = draftModule;
const rulesModule = await import("./structure-rules.ts");
const { levelConfigurationIssues } = rulesModule;
const { createStructureActions } = await import("./structure-workspace-contract.ts");
const { ProjectStructureError } = await import("../../../services/project-structure-errors.ts");

const level = (n) => ({ id: `l${n}`, projectId: "p", levelNumber: n, singularLabel: `Scope ${n}`, pluralLabel: `Scopes ${n}`, createdAt: "t", updatedAt: "t" });
const node = (n, archivedAt) => ({ id: `n${n}`, projectId: "p", levelNumber: n, name: "Unit", sortOrder: 0, weeklyReportingRequired: false, monthlyReportingRequired: false, createdAt: "t", updatedAt: "t", archivedAt });
const structure = (count = 0, nodes = []) => ({ projectId: "p", version: "v1", levels: Array.from({ length: count }, (_, i) => level(i + 1)), nodes });
const project = { id: "p", code: "P", name: "Project", status: "active", reporting: { weeklyEnabled: true, monthlyEnabled: true } };
const actions = { configureLevels: async () => {}, refresh: () => {} };
const render = (source = structure(), canManage = true, status = "active") => renderToStaticMarkup(React.createElement(ProjectStructureWorkspace, { structure: source, project: { ...project, status }, canManage, actions }));
const edit = (draft, n, field, value) => reduce(draft, { type: "edit", levelNumber: n, field, value });
const issues = (draft) => levelConfigurationIssues(draft.source, draft.levels);
const sourceText = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// Same minimal hook lifecycle convention as use-project-structure.test.mjs.
// Runs the production component's actual callbacks; React SSR above separately
// verifies the real primitives. This is component testing, not browser UAT.
function editorHarness(source = structure(), canManage = true, configureLevels = async () => {}) {
  const slots = [], effects = [], notifications = [], windowHandlers = new Map();
  let cursor = 0, effectCursor = 0, rerender = false, tree;
  const hooks = {
    ...React,
    useReducer(reducer, initial, init) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = init(initial);
      return [slots[index], (action) => { slots[index] = reducer(slots[index], action); rerender = true; }];
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; rerender = true; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useId: () => "editor",
    useEffect(effect, deps) {
      const index = effectCursor++, previous = effects[index];
      if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) {
        previous?.cleanup?.();
        effects[index] = { deps, effect, pending: true };
      }
    },
  };
  const exports = {};
  const dependencies = {
    react: hooks,
    "lucide-react": { Plus: "svg", Trash2: "svg" },
    sonner: { toast: { success: (message) => notifications.push(message) } },
    "@/components/ui/button": { Button: "button" },
    "@/components/ui/input": { Input: "input" },
    "@/components/ui/label": { Label: "label" },
    "@/types/project-structure": { MAX_STRUCTURE_LEVELS: 4 },
    "../../../structure/structure-rules": rulesModule,
    "../../../structure/structure-levels-draft": draftModule,
    "../../../structure/structure-patterns-ui": patternsModule,
  };
  vm.runInNewContext(ts.transpileModule(sourceText("../components/setup/structure/structure-levels-editor.tsx"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText, {
    exports, HTMLInputElement: class {},
    window: {
      addEventListener: (name, handler) => windowHandlers.set(name, handler),
      removeEventListener: (name) => windowHandlers.delete(name),
    },
    require(name) {
      if (dependencies[name]) return dependencies[name];
      throw new Error(`Unexpected editor dependency: ${name}`);
    },
  });
  const props = { project, structure: source, canManage, actions: { configureLevels, refresh: () => {} } };
  function render(patch = {}) {
    Object.assign(props, patch);
    for (let tries = 0; tries < 5; tries++) {
      cursor = 0; effectCursor = 0; rerender = false;
      tree = exports.StructureLevelsEditor(props);
      if (!rerender) break;
      assert.notEqual(tries, 4, "editor render must settle");
    }
    for (const effect of effects) if (effect.pending) {
      effect.pending = false; effect.cleanup = effect.effect();
    }
    return tree;
  }
  function walk(node, predicate) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap((entry) => walk(entry, predicate));
    return [...(predicate(node) ? [node] : []), ...walk(node.props?.children, predicate)];
  }
  function textOf(node) {
    if (Array.isArray(node)) return node.map(textOf).join("");
    if (node == null || typeof node === "boolean") return "";
    return typeof node === "object" ? textOf(node.props?.children) : String(node);
  }
  render();
  return {
    render, notifications, windowHandlers,
    textOf,
    text: () => textOf(tree),
    buttons: () => walk(tree, (entry) => entry.type === "button"),
    all: (type) => walk(tree, (entry) => entry.type === type),
    pattern: (id) => walk(tree, (entry) => entry.type === "input" && entry.props.id === `editor-pattern-${id}`)[0],
    button: (name) => walk(tree, (entry) => entry.type === "button" && textOf(entry).trim() === name)[0],
    input: (n, field) => walk(tree, (entry) => entry.type === "input" && entry.props.id === `editor-${n}-${field}`)[0],
    submit: () => tree.props.onSubmit({ preventDefault() {} }),
  };
}

test("production UI callbacks add, edit, save complete trimmed levels, and wait for reload", async () => {
  const calls = [];
  const harness = editorHarness(structure(), true, async (levels) => { calls.push(JSON.parse(JSON.stringify(levels))); });
  harness.button("Add first grouping").props.onClick(); harness.render();
  assert.equal(harness.button("Save Changes").props.disabled, true);
  harness.input(1, "singularLabel").props.onChange({ target: { value: " Section " } });
  harness.input(1, "pluralLabel").props.onChange({ target: { value: " Sections " } }); harness.render();
  assert.equal(harness.button("Save Changes").props.disabled, false);
  assert.equal(calls.length, 0, "typing does not save");
  assert.equal(harness.windowHandlers.has("beforeunload"), true);
  await harness.submit(); harness.render();
  assert.deepEqual(calls, [[{ levelNumber: 1, singularLabel: "Section", pluralLabel: "Sections" }]]);
  assert.equal(harness.button("Save Changes").props.disabled, true);
  assert.match(harness.text(), /Refreshing the configuration/);
  assert.deepEqual(harness.notifications, ["Hierarchy levels saved"]);
  harness.render({ structure: { ...structure(1), levels: [{ ...level(1), singularLabel: "Section", pluralLabel: "Sections" }] } });
  assert.equal(harness.input(1, "singularLabel").props.value, "Section");
  assert.equal(harness.windowHandlers.has("beforeunload"), false);
});
test("production UI keeps dirty labels on new reads and blocks Save until explicit reload", async () => {
  let calls = 0, reloads = 0;
  const harness = editorHarness(structure(1), true, async () => { calls++; });
  harness.input(1, "singularLabel").props.onChange({ target: { value: "Local" } }); harness.render();
  harness.render({ structure: structure(2), actions: { configureLevels: async () => { calls++; }, refresh: () => { reloads++; } } });
  assert.equal(harness.input(1, "singularLabel").props.value, "Local");
  assert.equal(harness.button("Save Changes").props.disabled, true);
  await harness.submit(); assert.equal(calls, 0);
  harness.button("Reload and discard edits").props.onClick(); harness.render();
  assert.equal(reloads, 1);
  assert.equal(harness.input(1, "singularLabel").props.value, "Scope 1");
  assert.equal(harness.button("Save Changes").props.disabled, true);
});
test("production stale refusal has safe wording, preserves input and never retries", async () => {
  let calls = 0;
  const harness = editorHarness(structure(1), true, async () => { calls++; throw new ProjectStructureError("stale"); });
  harness.input(1, "singularLabel").props.onChange({ target: { value: "Local" } }); harness.render();
  await harness.submit(); harness.render();
  assert.equal(calls, 1);
  assert.match(harness.text(), /Reload before saving/);
  assert.equal(harness.input(1, "singularLabel").props.value, "Local");
  assert.equal(harness.button("Save Changes").props.disabled, true);
});
test("production field errors are linked on blur; Reset clears edits and errors", () => {
  const harness = editorHarness(structure(2));
  harness.input(2, "pluralLabel").props.onChange({ target: { value: " scopes 1 " } });
  harness.input(2, "pluralLabel").props.onBlur(); harness.render();
  assert.equal(harness.input(2, "pluralLabel").props["aria-invalid"], true);
  assert.equal(harness.input(2, "pluralLabel").props["aria-describedby"], "editor-2-pluralLabel-error");
  assert.match(harness.text(), /Use a different label/);
  harness.button("Reset changes").props.onClick(); harness.render();
  assert.equal(harness.input(2, "pluralLabel").props.value, "Scopes 2");
  assert.equal(harness.input(2, "pluralLabel").props["aria-invalid"], false);
});
test("production submit guard refuses writes when canManage=false", async () => {
  let calls = 0;
  const harness = editorHarness(structure(1), false, async () => { calls++; });
  await harness.submit();
  assert.equal(calls, 0);
  assert.equal(harness.buttons().length, 0);
  assert.equal(harness.input(1, "singularLabel").props.readOnly, true);
});

test("empty editor has a compact honest state and Add first level", () => {
  const html = render();
  assert.match(html, /No structure pattern yet/);
  assert.match(html, /Add first grouping/);
  assert.match(html, /Step 2 · Build your project structure/);
  assert.match(html, /Configure the hierarchy types above/);
});
test("add first level produces blank user-named fields without a fabricated id", () => {
  const draft = reduce(createLevelsDraft(structure()), { type: "append" });
  assert.deepEqual(draft.levels, [{ levelNumber: 1, singularLabel: "", pluralLabel: "" }]);
});
test("append four contiguous levels and refuse a fifth", () => {
  let draft = createLevelsDraft(structure());
  for (let n = 0; n < 4; n++) draft = reduce(draft, { type: "append" });
  assert.deepEqual(draft.levels.map((l) => l.levelNumber), [1, 2, 3, 4]);
  assert.equal(reduce(draft, { type: "append" }), draft);
  assert.match(render(structure(4)), /disabled=""[^>]*>.*?Add another layer/);
});
test("singular and plural edits affect only their own retained level", () => {
  let draft = createLevelsDraft(structure(2));
  draft = edit(draft, 2, "singularLabel", "Section");
  draft = edit(draft, 2, "pluralLabel", "Sections");
  assert.equal(draft.levels[0].singularLabel, "Scope 1");
  assert.deepEqual(draft.levels[1], { id: "l2", levelNumber: 2, singularLabel: "Section", pluralLabel: "Sections" });
});
test("dirty detection and reset restore the saved configuration", () => {
  const source = structure(2);
  let draft = createLevelsDraft(source);
  assert.equal(dirty(draft), false);
  draft = edit(draft, 1, "pluralLabel", "Sections");
  assert.equal(dirty(draft), true);
  draft = reduce(draft, { type: "reset", source });
  assert.equal(dirty(draft), false);
  assert.equal(draft.levels[0].pluralLabel, "Scopes 1");
});
test("Save and Reset are disabled when unchanged", () => {
  const html = render(structure(1));
  assert.match(html, /disabled=""[^>]*>Reset changes/);
  assert.match(html, /disabled=""[^>]*>Save Changes/);
});
test("complete valid configuration goes through one atomic action, retaining IDs", async () => {
  let draft = edit(createLevelsDraft(structure(2, [node(1)])), 1, "singularLabel", "Section");
  draft = reduce(draft, { type: "append" });
  draft = edit(edit(draft, 3, "singularLabel", "Workstream"), 3, "pluralLabel", "Workstreams");
  assert.deepEqual(issues(draft), []);
  const calls = [];
  let refreshed = 0;
  const wired = createStructureActions({ projectId: "p", currentVersion: () => "container-version", service: {
    configureLevels: async (input) => { calls.push(input); return { version: "returned-version" }; },
  }, afterWrite: () => { refreshed++; }, refresh: () => {} });
  await wired.configureLevels(draft.levels);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { projectId: "p", expectedVersion: "container-version", levels: draft.levels });
  assert.deepEqual(draft.levels.map((l) => l.id), ["l1", "l2", undefined]);
  assert.equal(Object.hasOwn(draft.levels[2], "id"), false);
  assert.equal(refreshed, 1);
});
test("in-use and archived-used deepest levels cannot be removed", () => {
  for (const archivedAt of [undefined, "archived"]) {
    const draft = createLevelsDraft(structure(2, [node(2, archivedAt)]));
    assert.equal(removable(draft), false);
    assert.equal(reduce(draft, { type: "removeDeepest" }), draft);
    assert.doesNotMatch(render(draft.source), /aria-label="Remove Level/);
  }
});
test("only deepest unused level offers removal, preserving retained numbering", () => {
  const source = structure(3, [node(1)]);
  const html = render(source);
  assert.deepEqual([...html.matchAll(/aria-label="Remove Level (\d)"/g)].map((m) => m[1]), ["3"]);
  let draft = reduce(createLevelsDraft(source), { type: "removeDeepest" });
  assert.deepEqual(draft.levels.map((l) => [l.id, l.levelNumber]), [["l1", 1], ["l2", 2]]);
  draft = reduce(draft, { type: "removeDeepest" });
  assert.equal(removable(draft), false);
});
test("an unfinished appended row can be removed without validating other labels", () => {
  let draft = reduce(createLevelsDraft(structure(1)), { type: "append" });
  assert.equal(removable(draft), true);
  draft = reduce(draft, { type: "removeDeepest" });
  assert.equal(dirty(draft), false);
});
test("normalized duplicate labels are blocked with field-specific friendly errors", () => {
  const draft = edit(createLevelsDraft(structure(2)), 2, "pluralLabel", "  SCOPES 1  ");
  const found = issues(draft).find((i) => i.code === "duplicate_label");
  assert.deepEqual(found, { code: "duplicate_label", levelNumber: 2, field: "pluralLabel" });
  assert.equal(levelIssueMessage(found), "Use a different label from the other levels.");
});
test("blank singular and plural labels are blocked with friendly messages", () => {
  const draft = reduce(createLevelsDraft(structure()), { type: "append" });
  assert.deepEqual(issues(draft).map((i) => levelIssueMessage(i)), ["Enter a singular label.", "Enter a plural label."]);
});
test("domain helpers reject gaps, middle insertion, replaced IDs, and carried appended IDs", () => {
  const source = structure(2, [node(1)]);
  const next = createLevelsDraft(source).levels;
  for (const invalid of [
    [{ ...next[0], levelNumber: 2 }, next[1]],
    [next[0], { ...next[1], id: "inserted" }],
    [...next, { ...level(3), id: "l2" }],
  ]) assert.ok(levelConfigurationIssues(source, invalid).length > 0);
});
test("stale refusal keeps local edits and reloads once through the existing contract", async () => {
  let refreshed = 0;
  const error = new ProjectStructureError("stale");
  const wired = createStructureActions({ projectId: "p", currentVersion: () => "v1", service: {
    configureLevels: async () => { throw error; },
  }, afterWrite: () => { refreshed++; }, refresh: () => {} });
  await assert.rejects(wired.configureLevels([]), (failure) => failure === error);
  let draft = edit(createLevelsDraft(structure(1)), 1, "singularLabel", "Changed");
  draft = reduce(draft, { type: "saveFailed", error });
  assert.equal(draft.stale, true);
  assert.equal(draft.levels[0].singularLabel, "Changed");
  assert.match(draft.error, /Reload before saving/);
  assert.equal(refreshed, 1);
});
test("unknown errors never expose raw database text", () => {
  const draft = reduce(createLevelsDraft(structure()), { type: "saveFailed", error: new Error("SQL constraint null undefined") });
  assert.equal(draft.error, "The project structure could not be saved. No changes were made.");
});
test("unrelated rerenders and external reads do not overwrite a dirty draft", () => {
  const source = structure(1);
  const draft = edit(createLevelsDraft(source), 1, "singularLabel", "Unsaved");
  assert.equal(reduce(draft, { type: "receive", source }), draft);
  assert.equal(reduce(draft, { type: "receive", source: structure(2) }), draft);
});
test("save waits for container reload, then accepts returned identities and data", () => {
  const original = structure(1);
  let draft = edit(createLevelsDraft(original), 1, "singularLabel", "Saved");
  draft = reduce(draft, { type: "saveStarted" });
  const returned = { ...structure(1), levels: [{ ...level(1), id: "returned-id", singularLabel: "Saved" }], version: "returned" };
  assert.equal(reduce(draft, { type: "receive", source: returned }), draft);
  draft = reduce(draft, { type: "saveSucceeded" });
  assert.equal(draft.awaitingReload, true);
  assert.equal(reduce(draft, { type: "append" }), draft);
  draft = reduce(draft, { type: "receive", source: returned });
  assert.equal(dirty(draft), false);
  assert.equal(draft.levels[0].id, "returned-id");
});
test("explicit reload discards edits and waits before allowing more changes", () => {
  const source = structure(1);
  let draft = edit(createLevelsDraft(source), 1, "singularLabel", "Unsaved");
  draft = reduce(draft, { type: "reload", source });
  assert.equal(dirty(draft), false);
  assert.equal(draft.awaitingReload, true);
  assert.equal(reduce(draft, { type: "append" }), draft);
});
test("read-only mode exposes values but no write controls", () => {
  const html = render(structure(2), false);
  assert.match(html, /readOnly=""/);
  assert.doesNotMatch(html, /Save Changes|Add another layer|Remove layer|Reset changes/);
  assert.match(render(structure(), false), /No structure pattern yet/);
  assert.doesNotMatch(render(structure(), false), /Add first grouping/);
});
test("archived project is explicitly read-only with supplied container authority", () => {
  assert.match(render(structure(1), false, "archived"), /Archived project · structure is read-only/);
  const container = sourceText("../components/setup/project-setup-view.tsx");
  assert.match(container, /canManageStructure=\{canManage && savedBaseline.status !== "archived"\}/);
});
test("rendered fields have matching labels, required meaning and keyboard controls", () => {
  const html = render(structure(2));
  const inputIds = [...html.matchAll(/<input\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(inputIds.length, 9, "four label fields plus five named pattern choices");
  for (const id of inputIds) assert.ok(html.includes(`for="${id}"`));
  assert.match(html, /\(required\)/);
  assert.match(html, /aria-label="Remove Level 2"/);
});
test("editor has responsive stacking, field-linked errors and unload protection", () => {
  const editor = sourceText("../components/setup/structure/structure-levels-editor.tsx");
  assert.match(editor, /sm:grid-cols-.*lg:grid-cols-/);
  assert.match(editor, /min-w-0/);
  assert.match(editor, /aria-describedby=\{error/);
  assert.match(editor, /aria-invalid=\{Boolean\(error\)\}/);
  assert.match(editor, /beforeunload/);
  assert.match(editor, /removeEventListener/);
  assert.match(editor, /if \(!canManage \|\| !dirty \|\| busy \|\| blocked \|\| submitting.current\) return/);
});
test("level configuration keeps its data/permission/version boundaries and has no unit actions", () => {
  const code = [sourceText("../components/setup/structure/structure-levels-editor.tsx"), sourceText("../components/setup/structure/project-structure-workspace.tsx"), sourceText("./structure-levels-draft.ts")]
    .join("\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /supabase|createClient|\.from\(|\.rpc\(|useProjectAuthority|canManageOperations|expectedVersion|\.version\b|Date\.now|Math\.random/);
  assert.doesNotMatch(code, /Departments|Systems|Disciplines|createNode|moveNode|archiveNode|restoreNode|deleteNode|setReportingFlags/);
  assert.match(code, /levelConfigurationIssues/);
  assert.match(code, /actions\.configureLevels\(draft\.levels\.map/);
});

test("first use presents five labelled patterns without four empty layers", () => {
  const harness = editorHarness();
  assert.equal(harness.all("input").filter((entry) => entry.props.type === "radio").length, 5);
  assert.equal(harness.all("input").filter((entry) => entry.props.type !== "radio").length, 0);
  assert.match(harness.text(), /How is this project organized\?/);
  assert.equal(harness.all("details")[0].props.open, false);
});

for (const pattern of patternsModule.STRUCTURE_PATTERNS) {
  test(`${pattern.name} preset changes only the local type draft until explicit Save`, async () => {
    const source = structure(); const before = JSON.stringify(source); const calls = [];
    const harness = editorHarness(source, true, async (levels) => calls.push(levels));
    harness.pattern(pattern.id).props.onChange(); harness.render();
    assert.equal(calls.length, 0);
    for (const [index, [singular, plural]] of pattern.labels.entries()) {
      assert.equal(harness.input(index + 1, "singularLabel").props.value, singular);
      assert.equal(harness.input(index + 1, "pluralLabel").props.value, plural);
    }
    assert.equal(JSON.stringify(source), before, "no saved levels or actual groups changed");
    assert.equal(source.nodes.length, 0);
    assert.equal(harness.all("details")[0].props.open, false);
    assert.equal(harness.button("Save Changes").props.disabled, false);
    await harness.submit();
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), patternsModule.structurePatternDraft([], pattern.id));
  });
}

test("Custom structure starts with one blank main grouping and clear business labels", () => {
  const harness = editorHarness();
  harness.pattern("custom").props.onChange(); harness.render();
  assert.equal(harness.input(1, "singularLabel").props.value, "");
  assert.equal(harness.input(2, "singularLabel"), undefined);
  assert.equal(harness.all("details")[0].props.open, true);
  assert.match(harness.text(), /Main project group/);
  assert.match(harness.text(), /What is one group called\?/);
  assert.match(harness.text(), /What are multiple groups called\?/);
});

test("live preview follows preset and custom edits without any action", () => {
  let calls = 0; const harness = editorHarness(structure(), true, async () => { calls++; });
  harness.pattern("area-function").props.onChange(); harness.render();
  const preview = () => harness.textOf(harness.all("section").find((entry) => entry.props["aria-label"] === "Structure preview"));
  assert.match(preview(), /Draft pattern: Area → Function/);
  harness.pattern("custom").props.onChange(); harness.render();
  harness.input(1, "singularLabel").props.onChange({ target: { value: "Zone" } }); harness.render();
  assert.match(preview(), /Custom structure/); assert.match(preview(), /Zone/);
  assert.equal(calls, 0);
});

test("exact saved pattern recognition never rewrites labels or identities", () => {
  const saved = patternsModule.structurePatternDraft(createLevelsDraft(structure(2)).levels, "function-workstream");
  const source = { ...structure(2), levels: saved }; const before = JSON.stringify(source);
  const harness = editorHarness(source);
  assert.equal(patternsModule.recognizeStructurePattern(saved), "function-workstream");
  assert.match(harness.text(), /Current pattern: Function → Workstream/);
  assert.equal(harness.button("Save Changes").props.disabled, true);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(saved.map((entry) => entry.id), ["l1", "l2"]);
});

test("non-preset, whitespace-different and differently cased saved names stay Custom", () => {
  for (const levels of [createLevelsDraft(structure(2)).levels,
    [{ levelNumber: 1, singularLabel: " function ", pluralLabel: "Functions" }],
    [{ levelNumber: 1, singularLabel: "function", pluralLabel: "Functions" }]]) {
    assert.equal(patternsModule.recognizeStructurePattern(levels), "custom");
  }
  assert.match(render(structure(2)), /Current pattern: Custom structure/);
});

test("preset drafts retain existing IDs and omit IDs on newly appended layers", () => {
  const draft = createLevelsDraft(structure(1));
  const selected = reduce(draft, { type: "pattern", pattern: "package-workstream" });
  assert.equal(selected.levels[0].id, "l1");
  assert.equal(Object.hasOwn(selected.levels[1], "id"), false);
  assert.deepEqual(issues(selected), []);
});

test("active or archived groups hide preset replacement and keep node-aware editing rules", () => {
  for (const archivedAt of [undefined, "archived"]) {
    const source = structure(2, [node(2, archivedAt)]), draft = createLevelsDraft(source);
    assert.equal(editorHarness(source).pattern("single"), undefined);
    assert.equal(reduce(draft, { type: "pattern", pattern: "single" }), draft);
    assert.equal(reduce(draft, { type: "removeDeepest" }), draft);
    assert.equal(edit(draft, 1, "singularLabel", "Zone").levels[0].id, "l1");
    assert.equal(reduce(draft, { type: "append" }).levels[2].levelNumber, 3);
  }
});

test("a single grouping is a valid complete type configuration", () => {
  const draft = reduce(createLevelsDraft(structure()), { type: "pattern", pattern: "single" });
  assert.deepEqual(issues(draft), []); assert.equal(draft.levels.length, 1);
  assert.equal(removable(draft), false);
});

test("custom Add another layer grows progressively to four and blocks a fifth", () => {
  const harness = editorHarness();
  harness.pattern("custom").props.onChange(); harness.render();
  for (let n = 2; n <= 4; n++) { harness.button("Add another layer").props.onClick(); harness.render(); assert.ok(harness.input(n, "singularLabel")); }
  assert.equal(harness.button("Add another layer").props.disabled, true);
  harness.button("Add another layer").props.onClick(); harness.render();
  assert.equal(harness.input(5, "singularLabel"), undefined);
  assert.match(harness.text(), /Add another layer only|Maximum of four layers/);
});

test("pattern changes respect busy, stale and external-snapshot guards", () => {
  const original = createLevelsDraft(structure());
  for (const flag of ["saving", "awaitingReload", "stale"]) {
    const blocked = { ...original, [flag]: true };
    assert.equal(reduce(blocked, { type: "pattern", pattern: "single" }), blocked);
  }
  const harness = editorHarness(structure(1));
  harness.input(1, "singularLabel").props.onChange({ target: { value: "Unsaved" } }); harness.render();
  harness.render({ structure: structure(2) });
  harness.pattern("single").props.onChange(); harness.render();
  assert.equal(harness.input(1, "singularLabel").props.value, "Unsaved");
  assert.equal(harness.all("fieldset")[0].props.disabled, true);
});

test("custom labels are progressively disclosed on existing projects and remain readable read-only", () => {
  const source = structure(2, [node(1)]);
  const harness = editorHarness(source);
  assert.equal(harness.all("details")[0].props.open, false);
  harness.all("details")[0].props.onToggle({ currentTarget: { open: true } }); harness.render();
  assert.equal(harness.all("details")[0].props.open, true);
  assert.ok(harness.input(1, "singularLabel"));
  const readonly = editorHarness(source, false);
  assert.equal(readonly.pattern("custom"), undefined); assert.equal(readonly.buttons().length, 0);
  assert.match(readonly.text(), /View hierarchy labels/);
});

test("pattern definitions contain hierarchy types only, with no clients, IDs, groups or writes", () => {
  const code = sourceText("./structure-patterns-ui.ts");
  assert.doesNotMatch(code, /Civil|Earthworks|Mechanical|Piping|Package A|createNode|supabase|\.from\(|\.rpc\(|Date\.now|Math\.random/);
});

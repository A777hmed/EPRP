import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Executes the real hook source with a minimal hook lifecycle (no DOM needed),
// the same approach as project-identity.test.mjs.
function loadHook(service) {
  const source = readFileSync(new URL("./use-project-structure.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });

  const slots = [];
  let cursor = 0;
  const effects = [];
  let effectCursor = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useEffect(effect, deps) {
      const index = effectCursor++;
      const previous = effects[index];
      if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) {
        previous?.cleanup?.();
        effects[index] = { deps, effect, pending: true, cleanup: undefined };
      }
    },
    useCallback: (fn) => fn,
  };
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      if (name === "react") return react;
      if (name === "@/services/project-structure-service") return { projectStructureService: service };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return {
    render(projectId) {
      cursor = 0;
      effectCursor = 0;
      const state = exports.useProjectStructure(projectId);
      for (const entry of effects) {
        if (entry?.pending) {
          entry.pending = false;
          entry.cleanup = entry.effect();
        }
      }
      return state;
    },
  };
}

const flush = async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); };
const structureOf = (projectId, extra = {}) => ({ projectId, version: "v1", levels: [], nodes: [], ...extra });

test("loads by project id; an empty Other structure is levels [] and nodes [], not null", async () => {
  const calls = [];
  const hook = loadHook({ getStructure: async (id) => { calls.push(id); return structureOf(id); } });
  let state = hook.render("P");
  assert.deepEqual([state.structure, state.loading, state.error], [null, true, null]);
  await flush();
  state = hook.render("P");
  assert.deepEqual([state.structure, state.loading, state.error], [structureOf("P"), false, null]);
  assert.deepEqual(calls, ["P"]);
});

test("no project id: nothing loads, nothing is invented", () => {
  const hook = loadHook({ getStructure: async () => { throw new Error("must not load"); } });
  const state = hook.render(undefined);
  assert.deepEqual([state.structure, state.loading, state.error], [null, false, null]);
});

test("refresh reloads and keeps the same project's structure visible meanwhile", async () => {
  let version = 1;
  const hook = loadHook({ getStructure: async (id) => structureOf(id, { version: `v${version}` }) });
  hook.render("P");
  await flush();
  let state = hook.render("P");
  version = 2;
  state.refresh();
  state = hook.render("P");
  assert.equal(state.loading, true);
  assert.equal(state.structure.version, "v1");
  await flush();
  state = hook.render("P");
  assert.deepEqual([state.loading, state.structure.version], [false, "v2"]);
});

test("switching project never shows the previous project's structure; late answers are ignored", async () => {
  const pending = new Map();
  const hook = loadHook({ getStructure: (id) => new Promise((resolve) => pending.set(id, resolve)) });
  hook.render("A");
  let state = hook.render("B");
  assert.deepEqual([state.structure, state.loading], [null, true]);
  pending.get("B")(structureOf("B"));
  await flush();
  pending.get("A")(structureOf("A"));
  await flush();
  state = hook.render("B");
  assert.equal(state.structure.projectId, "B");
});

test("errors are plain language: the service's own message, or a generic one", async () => {
  const known = Object.assign(new Error("This project or structure unit is no longer available. Reload the page."), { name: "ProjectStructureError" });
  let hook = loadHook({ getStructure: async () => { throw known; } });
  hook.render("P");
  await flush();
  let state = hook.render("P");
  assert.deepEqual([state.structure, state.loading, state.error], [null, false, known.message]);

  hook = loadHook({ getStructure: async () => { throw new Error('relation "x" does not exist'); } });
  hook.render("P");
  await flush();
  state = hook.render("P");
  assert.equal(state.error, "The project structure could not be loaded. Reload the page.");
});

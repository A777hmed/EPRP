import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Execute the actual hook and TSX with a small hook lifecycle / JSX harness.
// No DOM package is installed; production React rendering remains browser UAT.
function load(relativePath, imports, extra = "") {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source + extra, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      if (!(name in imports)) throw new Error(`Unexpected dependency: ${name}`);
      return imports[name];
    },
  });
  return exports;
}

function hookHarness(service) {
  let state = null;
  let dependencies;
  let pendingEffect;
  let cleanup;
  const react = {
    useState: () => [state, (value) => { state = value; }],
    useEffect(effect, next) {
      if (!dependencies || next[0] !== dependencies[0]) {
        dependencies = next;
        pendingEffect = effect;
      }
    },
  };
  const { useProjectById } = load("./use-project-by-id.ts", {
    react,
    "@/services/project-service": { projectService: service },
  });
  function ProjectProbe(id) {
    return useProjectById(id);
  }
  return {
    render(id) {
      const result = ProjectProbe(id);
      if (pendingEffect) {
        cleanup?.();
        cleanup = pendingEffect();
        pendingEffect = undefined;
      }
      return result;
    },
    unmount: () => cleanup?.(),
  };
}

const uuid = "64c7e356-dffb-4dc0-b9f4-7f834f374ad2";
const saved = { id: uuid, code: "PSM-02", shortName: "PSM-ETHYDCO", name: "Process Safety Management" };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test("UUID identity loads via getProjectById; loading and cleared id are safe", async () => {
  const calls = [];
  const hook = hookHarness({ getProjectById: async (id) => { calls.push(id); return saved; } });
  assert.equal(hook.render(uuid), null);
  await flush();
  assert.equal(hook.render(uuid), saved);
  assert.deepEqual(calls, [uuid]);
  assert.equal(hook.render(undefined), null);
  hook.unmount();
});

test("changing projectId refreshes and ignores late previous responses", async () => {
  const requests = new Map();
  const hook = hookHarness({ getProjectById: (id) => new Promise((resolve) => requests.set(id, resolve)) });
  hook.render(uuid);
  assert.equal(hook.render("second"), null);
  const second = { ...saved, id: "second", code: "P-2" };
  requests.get("second")(second);
  await flush();
  assert.equal(hook.render("second"), second);
  requests.get(uuid)(saved);
  await flush();
  assert.equal(hook.render("second"), second);
  assert.equal(hook.render("missing"), null);
  requests.get("missing")(null);
  await flush();
  assert.equal(hook.render("missing"), null);
  hook.unmount();
});

test("missing and rejected loads stay unresolved", async () => {
  for (const getProjectById of [async () => null, async () => { throw new Error("Unavailable"); }]) {
    const hook = hookHarness({ getProjectById });
    assert.equal(hook.render(uuid), null);
    await flush();
    assert.equal(hook.render(uuid), null);
    hook.unmount();
  }
});

test("mock mode resolves through the real mock project service", async () => {
  // Child isolates service selection from a developer's configured environment.
  const { spawnSync } = await import("node:child_process");
  const script = `
    import assert from 'node:assert/strict';
    import { projectService, listProjectsSync } from './src/services/project-service.ts';
    const project = listProjectsSync()[0];
    assert.ok(project);
    assert.deepEqual(await projectService.getProjectById(project.id), project);
  `;
  const result = spawnSync(process.execPath, ["--experimental-transform-types", "--import", "./src/features/notifications/test-runtime.mjs", "--input-type=module", "-e", script], {
    cwd: new URL("../../../", import.meta.url),
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});

const jsx = (type, props) => ({ type, props });
const elementText = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  if (Array.isArray(node)) return node.map(elementText).join("|");
  return elementText(node.props?.children);
};
let currentProject;
let loadedId;
const imports = {
  react: {},
  "react/jsx-runtime": { jsx, jsxs: jsx },
  "next/link": { default: "Link" },
  "next/navigation": { usePathname: () => `/projects/${uuid}/setup` },
  "lucide-react": {},
  "@/components/ui/tooltip": {},
  "@/components/ui/breadcrumb": {},
  "@/config/navigation": { findNavItem: () => null },
  "@/config/project-sections": {
    activeProjectId: (path) => path.split("/")[2],
    isNewProjectRoute: () => false,
    isProjectSection: () => false,
    projectSections: [],
  },
  "@/config/project-workflow": {},
  "@/config/site": { siteConfig: { name: "EPRP" } },
  "@/features/projects/new-project-draft-store": {},
  "@/features/projects/use-hierarchy-terms": { useHierarchyTerms: () => ({}) },
  "@/features/projects/use-project-by-id": { useProjectById: (id) => { loadedId = id; return currentProject; } },
  "@/lib/utils": { cn: () => "" },
};
const nav = load("../../components/layout/project-nav-group.tsx", imports);
const breadcrumbs = load("../../components/layout/breadcrumbs.tsx", imports);

function sidebarText(project, collapsed = false) {
  currentProject = project;
  const tree = nav.ProjectContextNav({ pathname: `/projects/${uuid}/setup`, collapsed });
  const identity = tree.props.children[0];
  return elementText(identity.type(identity.props));
}

test("sidebar primary renders code and secondary renders short name", () => {
  const text = sidebarText(saved);
  assert.match(text, /PSM-02/);
  assert.match(text, /PSM-ETHYDCO/);
  assert.doesNotMatch(text, /Process Safety Management/);
  assert.equal(loadedId, uuid);
  assert.match(sidebarText(saved, true), /PSM/);
});

test("sidebar secondary falls back to full name", () => {
  assert.match(sidebarText({ ...saved, shortName: undefined }), /Process Safety Management/);
});

test("breadcrumb renders short name and keeps the setup trail", () => {
  currentProject = saved;
  const text = elementText(breadcrumbs.Breadcrumbs());
  assert.match(text, /Projects.*PSM-ETHYDCO.*Project Setup/);
  assert.doesNotMatch(text, /Process Safety Management/);
  assert.equal(loadedId, uuid);
});

test("breadcrumb falls back to full name", () => {
  currentProject = { ...saved, shortName: undefined };
  assert.match(elementText(breadcrumbs.Breadcrumbs()), /Process Safety Management/);
});

test("loading or missing project renders Project in both surfaces, never UUID", () => {
  assert.match(sidebarText(null), /Project/);
  currentProject = null;
  const text = elementText(breadcrumbs.Breadcrumbs());
  assert.match(text, /Projects.*Project.*Project Setup/);
  assert.doesNotMatch(text, new RegExp(uuid));
});

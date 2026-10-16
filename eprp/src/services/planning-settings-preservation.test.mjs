import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Phase 13.9A hardening — `project_planning_settings.default_import_source`
// must survive a Project Setup save that does not change it.
//
// Runs the REAL planning-service.ts against an in-memory table that applies
// PostgREST upsert semantics (`Prefer: resolution=merge-duplicates`): on a
// conflict, only the columns present in the payload are updated; on insert,
// an absent column takes its default (NULL). No database connection here.

const PROJECT = "9b1f3c2e-0a4d-4f6e-8c1a-2d3e4f5a6b7c";

function harness(initial) {
  const table = new Map(initial ? [[initial.project_id, { ...initial }]] : []);
  const payloads = [];
  const client = {
    from(name) {
      assert.equal(name, "project_planning_settings");
      let pending;
      const builder = {
        upsert(row, options) {
          assert.equal(options.onConflict, "project_id");
          payloads.push(structuredClone(row));
          const existing = table.get(row.project_id);
          const next = existing
            ? { ...existing, ...row, updated_at: "2026-10-15T10:00:00Z" }
            : {
                default_import_source: null,
                planning_enabled: true,
                created_at: "2026-10-15T10:00:00Z",
                updated_at: "2026-10-15T10:00:00Z",
                ...row,
              };
          table.set(row.project_id, next);
          pending = next;
          return builder;
        },
        select() {
          return builder;
        },
        eq(column, value) {
          assert.equal(column, "project_id");
          pending = table.get(value) ?? null;
          return builder;
        },
        single: async () => ({ data: pending, error: null }),
        maybeSingle: async () => ({ data: pending, error: null }),
      };
      return builder;
    },
  };

  const exports = {};
  const compiled = ts.transpileModule(readFileSync(new URL("./planning-service.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    console,
    require(name) {
      if (name === "@/lib/supabase/client") return { getSupabaseBrowserClient: () => client };
      if (name === "./service-errors") return { describeFailure: async ({ error }) => new Error(error.message) };
      throw new Error(`Unexpected service dependency ${name}`);
    },
  });
  return { service: exports.planningService, payloads, stored: () => table.get(PROJECT) };
}

const storedRow = (defaultImportSource) => ({
  project_id: PROJECT,
  onboarding_mode: "new_project",
  default_import_source: defaultImportSource,
  planning_enabled: true,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
});

test("existing default_import_source → save an unrelated setup change → value preserved", async () => {
  for (const source of ["p6", "eprp_excel", "msproject", "manual"]) {
    const { service, payloads, stored } = harness(storedRow(source));
    // Exactly what Project Setup's save sends: the onboarding mode alone.
    const saved = await service.upsertSettings({ projectId: PROJECT, onboardingMode: "existing_active_project" });
    assert.equal(stored().default_import_source, source, `${source} survives the save`);
    assert.equal(stored().onboarding_mode, "existing_active_project");
    assert.equal(saved.defaultImportSource, source);
    // The column is not even sent — nothing for the database to overwrite.
    assert.deepEqual(Object.keys(payloads[0]).sort(), ["onboarding_mode", "project_id"]);
  }
});

test("saving the SAME onboarding mode again (no planning change at all) also preserves it", async () => {
  const { service, stored } = harness(storedRow("p6"));
  await service.upsertSettings({ projectId: PROJECT, onboardingMode: "new_project" });
  await service.upsertSettings({ projectId: PROJECT, onboardingMode: "new_project" });
  assert.equal(stored().default_import_source, "p6");
});

test("a first save with no stored row creates it without inventing a source", async () => {
  const { service, payloads, stored } = harness();
  await service.upsertSettings({ projectId: PROJECT, onboardingMode: "no_formal_schedule" });
  assert.equal(stored().default_import_source, null);
  assert.ok(!("default_import_source" in payloads[0]));
});

test("only an explicit caller value writes the column (null clears it explicitly)", async () => {
  const explicit = harness(storedRow("p6"));
  await explicit.service.upsertSettings({ projectId: PROJECT, onboardingMode: "new_project", defaultImportSource: "manual" });
  assert.equal(explicit.stored().default_import_source, "manual");

  const cleared = harness(storedRow("p6"));
  await cleared.service.upsertSettings({ projectId: PROJECT, onboardingMode: "new_project", defaultImportSource: null });
  assert.equal(cleared.stored().default_import_source, null);

  const undefinedKey = harness(storedRow("p6"));
  await undefinedKey.service.upsertSettings({ projectId: PROJECT, onboardingMode: "new_project", defaultImportSource: undefined });
  assert.equal(undefinedKey.stored().default_import_source, "p6");
});

test("UAT bug: choose no_formal_schedule → save → a fresh read returns it; source still preserved", async () => {
  const { service, stored } = harness(storedRow("p6"));
  // What either Project Setup save now sends after the project row saves.
  const saved = await service.upsertSettings({ projectId: PROJECT, onboardingMode: "no_formal_schedule" });
  assert.equal(saved.onboardingMode, "no_formal_schedule"); // becomes the form's stored baseline
  // The read every planning surface uses (Project Progress via usePlanningPosition).
  const reread = await service.getSettings(PROJECT);
  assert.equal(reread.onboardingMode, "no_formal_schedule");
  assert.equal(stored().onboarding_mode, "no_formal_schedule");
  assert.equal(stored().default_import_source, "p6");
});

/* ------------------- Callers: nothing else writes the column ------------- */

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");

test("Project Setup saves the onboarding mode alone; no UI writes default_import_source", () => {
  const form = source("../features/projects/components/project-form.tsx");
  assert.match(form, /planningService\.upsertSettings\(\{ projectId, onboardingMode \}\)/);
  assert.doesNotMatch(form, /defaultImportSource|default_import_source/);
});

test("the external-schedule guidance answer persists nothing", () => {
  const entry = source("../features/projects/components/planning-entry.tsx");
  const question = entry.slice(entry.indexOf("function ExternalScheduleQuestion("));
  // Its only state is component-local; no service, storage or URL write.
  assert.match(question, /const \[answer, setAnswer\] = React\.useState<ExternalScheduleAnswer \| null>\(null\);/);
  assert.doesNotMatch(
    question,
    /planningService|upsertSettings|defaultImportSource|default_import_source|localStorage|sessionStorage|history\.(push|replace)State|searchParams|fetch\(/
  );
  // Choosing an answer only sets that local state.
  assert.match(question, /onChange=\{\(\) => setAnswer\(choice\.value\)\}/);
  // And it never reaches the form's save: PlanningEntry's onChange is the onboarding mode only.
  assert.doesNotMatch(entry, /onChange\(answer|onChange\(choice\.value as ExternalScheduleAnswer/);
});

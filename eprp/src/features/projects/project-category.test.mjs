// Phase 2C.1b — Project Category picker for Other projects.
// Run with the existing test runtime (resolves @/ imports):
//   node --import ./src/features/notifications/test-runtime.mjs --test src/features/projects/project-category.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ADD_PROJECT_CATEGORY_LABEL,
  canManageProjectCategories,
  createdCategoryOutcome,
  isOtherProjectCategory,
  MANAGE_PROJECT_CATEGORIES_LABEL,
  otherProjectCategoryCreateGuard,
  PSM_FAMILY_CATEGORY_REFUSAL,
  selectProjectCategory,
} from "./project-category.ts";
import { duplicateFieldOf, normalizeMasterValue } from "../master-data/duplicates.ts";
import { saveWithCreateGuard } from "../master-data/save-guard.ts";
import { isPsmProjectType, isReservedPsmCode, isReservedPsmName } from "../../config/project-terminology.ts";

const source = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replaceAll("\r", "");
const picker = source("./components/project-classification.tsx");
const select = source("../master-data/components/managed-select.tsx");
const dialog = source("../master-data/components/master-data-dialog.tsx");
const services = source("../master-data/services.ts");

/** The category list as it exists locally, including the same-named rows. */
const CATEGORIES = [
  { id: "1", name: "Inspection Program", code: "INSP" },
  { id: "2", name: "Inspection Program", code: "INSP-DEMO" },
  { id: "3", name: "Consultancy", code: "CONS" },
  { id: "4", name: "Process Safety and Asset Integrity Management", code: "PSAIM-DEMO" },
];

test("an authorized user sees Add and Manage; nobody else does", () => {
  assert.equal(canManageProjectCategories({ resolved: true, isGlobalAuthority: true }), true);
  // Assigned Project Control (not a global authority), viewers, unresolved identity.
  assert.equal(canManageProjectCategories({ resolved: true, isGlobalAuthority: false }), false);
  assert.equal(canManageProjectCategories({ resolved: false, isGlobalAuthority: true }), false);

  // The picker passes that answer straight to the select — no new permission.
  assert.match(picker, /const canManageCategories = canManageProjectCategories\(useCurrentIdentity\(\)\);/);
  assert.match(picker, /allowManage=\{canManageCategories\}/);
  assert.doesNotMatch(picker, /allowManage=\{false\}/);
  // With allowManage off the select renders neither action nor the dialog.
  assert.match(select, /\{allowManage && \(\s+<>\s+<CommandSeparator \/>/);
  assert.match(select, /\{allowManage && \(\s+<Button[\s\S]+?aria-label=\{manageLabel \?\?/);
  assert.match(select, /\{allowManage && \(\s+<MasterDataDialog/);
});

test("the actions use Project Category wording — never \"Add New Project\"", () => {
  assert.equal(ADD_PROJECT_CATEGORY_LABEL, "Add New Project Category");
  assert.equal(MANAGE_PROJECT_CATEGORIES_LABEL, "Manage Project Categories");
  assert.match(picker, /addLabel=\{ADD_PROJECT_CATEGORY_LABEL\}/);
  assert.match(picker, /manageLabel=\{MANAGE_PROJECT_CATEGORIES_LABEL\}/);
  assert.match(select, /<Plus className="size-4" aria-hidden="true" \/>\s+\{addLabel \?\?/);
  assert.match(services, /singular: "Project Category",\s+plural: "Project Categories",/);
  // Minimum fields of the inline dialog: name and code, both required.
  assert.match(services, /\{ key: "name", label: "Category Name", type: "text", required: true \},/);
  assert.match(services, /\{ key: "code", label: "Category Code", type: "text", required: true \},/);
});

test("a newly created category becomes the selected one", () => {
  const before = { structureFamily: "other", projectTypeId: "3", projectCategoryDetail: "" };
  const created = { id: "9", name: "Tank Inspection", code: "TANK", allowsCustomName: false };
  const outcome = createdCategoryOutcome(before, created);
  assert.equal(outcome.selected, true);
  assert.equal(outcome.value.projectTypeId, "9");
  assert.equal(outcome.value.structureFamily, "other");
  // Wired: the select reports the created record and the picker applies it.
  assert.match(select, /const selectable = !filter \|\| filter\(record\);\s+if \(selectable\) onChange\(record\.id\);\s+onRecordCreated\?\.\(record, selectable\);/);
  assert.match(picker, /const outcome = createdCategoryOutcome\(value, record as ProjectType\);\s+if \(outcome\.selected\) onChange\(outcome\.value\);/);
  // The dialog closes after an inline add and hands back to the select.
  assert.match(dialog, /onCreated\?\.\(record\);\s+if \(initialMode === "create"\) \{[\s\S]+?onOpenChange\(false\);/);
});

test("adding a category preserves every other unsaved Project Setup value", () => {
  // Selecting touches the classification fields only.
  const value = { structureFamily: "other", projectTypeId: "", projectCategoryDetail: "typed" };
  const next = selectProjectCategory(value, "3", { allowsCustomName: false });
  assert.deepEqual(Object.keys(next).sort(), ["projectCategoryDetail", "projectTypeId", "structureFamily"]);
  assert.deepEqual(next, { structureFamily: "other", projectTypeId: "3", projectCategoryDetail: "" });
  // A custom-name category keeps what was typed.
  assert.equal(selectProjectCategory(value, "8", { allowsCustomName: true }).projectCategoryDetail, "typed");
  // The whole add / manage flow is an in-page dialog: nothing navigates.
  for (const file of [select, dialog, picker, source("../master-data/components/master-data-form.tsx")]) {
    assert.doesNotMatch(file, /useRouter|router\.(?:push|replace)|window\.location|<Link\b/);
  }
  // The form applies the change through setValue on three fields only.
  const form = source("./components/project-form.tsx");
  const setter = form.slice(form.indexOf("const setClassification = "), form.indexOf("const { records: categoryRecords }"));
  assert.deepEqual(
    [...setter.matchAll(/setValue\("([a-zA-Z]+)"/g)].map((match) => match[1]),
    ["structureFamily", "projectTypeId", "projectCategoryDetail"]
  );
});

test("a normalized duplicate name is refused; codes stay unique", () => {
  assert.equal(normalizeMasterValue("  Inspection   PROGRAM "), "inspection program");
  // Same name in any casing / spacing — refused, even with a brand-new code.
  for (const name of ["Inspection Program", "inspection program", "  Inspection   Program "]) {
    assert.equal(duplicateFieldOf({ name, code: "NEW-1" }, CATEGORIES), "name", name);
  }
  // Unique code is still enforced, case-insensitively.
  assert.equal(duplicateFieldOf({ name: "Tank Inspection", code: "insp" }, CATEGORIES), "code");
  // A genuinely new category passes.
  assert.equal(duplicateFieldOf({ name: "Tank Inspection", code: "TANK" }, CATEGORIES), undefined);
  // Editing a record does not collide with itself; omitted keys are not checked.
  assert.equal(duplicateFieldOf({ name: "Consultancy", code: "CONS" }, CATEGORIES, "3"), undefined);
  assert.equal(duplicateFieldOf({ code: "TANK" }, CATEGORIES), undefined);
  // Both backends use this one rule — existing rows are never merged.
  assert.match(services, /const field = duplicateFieldOf\(input, store\.values\(\), excludeId\);/);
  assert.match(source("../master-data/supabase-service.ts"), /const field = duplicateFieldOf\(input, cache\.values\(\), excludeId\);/);
});

test("the category code is provided as the secondary label", () => {
  assert.match(services, /optionSublabel: \(record\) => record\.code\?\.trim\(\) \|\| undefined,/);
  // The select renders the sublabel on every option, and beside the chosen value.
  assert.match(select, /const sublabel = config\.optionSublabel\?\.\(record\);/);
  assert.match(select, /\{sublabel && \(\s+<span className="ml-2 shrink-0 text-xs text-muted-foreground">\s+\{sublabel\}/);
  assert.match(picker, /showSublabelInTrigger/);
  // Same-named rows stay separate, distinguishable options (no silent merge).
  const inspection = CATEGORIES.filter((category) => category.name === "Inspection Program");
  assert.deepEqual(inspection.map((category) => category.code), ["INSP", "INSP-DEMO"]);
  assert.match(select, /value=\{`\$\{record\.name\} \$\{record\.code \?\? ""\}`\}/);
});

test("PSM-family categories stay excluded — including one that was just added", () => {
  assert.deepEqual(
    CATEGORIES.filter(isOtherProjectCategory).map((category) => category.code),
    ["INSP", "INSP-DEMO", "CONS"]
  );
  assert.equal(isOtherProjectCategory({ code: "AIM-01", name: "Asset Integrity" }), true);
  assert.equal(isOtherProjectCategory({ code: "PSM-NEW", name: "Anything" }), false);
  assert.equal(isOtherProjectCategory({ name: "Process Safety Reviews" }), false);

  // Created as PSM / PSAIM: it exists in master data, but is not selected here.
  const before = { structureFamily: "other", projectTypeId: "3", projectCategoryDetail: "" };
  const outcome = createdCategoryOutcome(before, { id: "9", name: "PSAIM Studies", code: "PSAIM-9" });
  assert.equal(outcome.selected, false);
  assert.deepEqual(outcome.value, before);
  assert.match(outcome.message, /PSM \/ PSAIM category/);
  // The picker still filters (and enforces the filter) on every option.
  assert.match(picker, /filter=\{isOtherCategory\}\s+enforceFilter/);
  assert.match(picker, /isOtherProjectCategory\(record as ProjectType\)/);
});

/* ------- PSM / PSAIM-family categories are refused BEFORE creation ------- */

/** A stand-in for the master-data create call that records every use. */
function createSpy() {
  const calls = [];
  return {
    calls,
    create: async (input) => {
      calls.push(input);
      return { id: `new-${calls.length}`, active: true, ...input };
    },
  };
}

const addFromOtherPicker = (input, spy) =>
  saveWithCreateGuard({
    mode: "create",
    input,
    guard: otherProjectCategoryCreateGuard,
    save: () => spy.create(input),
  });

test("1+2. Other-project inline Add refuses a PSM/PSAIM category and never calls create", async () => {
  assert.equal(
    PSM_FAMILY_CATEGORY_REFUSAL,
    "This category is reserved for the PSM/PSAIM project family and cannot be created for an Other Project."
  );
  const refusedInputs = [
    [{ name: "PSAIM Studies", code: "PSAIM-9" }, "code"],
    [{ name: "Anything", code: "psm-02" }, "code"],
    [{ name: "Anything", code: "PSM" }, "code"],
    // No code: the name decides.
    [{ name: "Process Safety Reviews" }, "name"],
    [{ name: "process   safety programme", code: "  " }, "name"],
  ];
  for (const [input, field] of refusedInputs) {
    const spy = createSpy();
    const result = await addFromOtherPicker(input, spy);
    assert.deepEqual(result, { refused: { field, message: PSM_FAMILY_CATEGORY_REFUSAL } }, JSON.stringify(input));
    // Nothing reached the service: no row is inserted.
    assert.equal(spy.calls.length, 0, JSON.stringify(input));
  }
});

test("3. a valid Other category is still created and auto-selected", async () => {
  const spy = createSpy();
  const input = { name: "Tank Inspection", code: "TANK" };
  const result = await addFromOtherPicker(input, spy);
  assert.ok("saved" in result);
  assert.deepEqual(spy.calls, [input]);
  // Created once, then selected by the picker as before.
  const before = { structureFamily: "other", projectTypeId: "", projectCategoryDetail: "" };
  const outcome = createdCategoryOutcome(before, result.saved);
  assert.equal(outcome.selected, true);
  assert.equal(outcome.value.projectTypeId, result.saved.id);
  // AIM-01 is not PSM-family. (A reserved NAME is no longer let through by a
  // non-PSM code — see the independent name/code test below.)
  for (const allowed of [{ name: "Asset Integrity", code: "AIM-01" }, { name: "Tank Inspection", code: "TANK" }]) {
    assert.equal(otherProjectCategoryCreateGuard(allowed), undefined, JSON.stringify(allowed));
  }
});

test("the guard is context-only: editing and standalone Master Data are unchanged", async () => {
  // Edit mode is never blocked by a create guard.
  const edit = createSpy();
  const edited = await saveWithCreateGuard({
    mode: "edit",
    input: { name: "PSAIM Studies", code: "PSAIM-9" },
    guard: otherProjectCategoryCreateGuard,
    save: () => edit.create({ name: "PSAIM Studies", code: "PSAIM-9" }),
  });
  assert.ok("saved" in edited);
  assert.equal(edit.calls.length, 1);
  // No guard (standalone Master Data): a PSM/PSAIM category is created normally.
  const standalone = createSpy();
  const created = await saveWithCreateGuard({
    mode: "create",
    input: { name: "PSAIM Studies", code: "PSAIM-9" },
    save: () => standalone.create({ name: "PSAIM Studies", code: "PSAIM-9" }),
  });
  assert.ok("saved" in created);
  assert.equal(standalone.calls.length, 1);

  // Wiring: only the Other-project picker supplies the guard, and the form
  // consults it before the service.
  assert.match(picker, /createGuard=\{otherProjectCategoryCreateGuard\}/);
  const form = source("../master-data/components/master-data-form.tsx");
  const save = form.slice(form.indexOf("const result = await saveWithCreateGuard({"), form.indexOf("onSaved(result.saved"));
  assert.match(save, /guard: createGuard,/);
  assert.match(save, /if \("refused" in result\) \{\s+const \{ field, message \} = result\.refused;\s+setErrors\(\(prev\) => \(\{ \.\.\.prev, \[field\]: message \}\)\);\s+return;/);
  // The only service.create call sits inside the guarded save.
  assert.equal([...form.matchAll(/service\.create\(/g)].length, 1);
  assert.match(save, /service\.create\(/);
  assert.match(select, /createGuard=\{createGuard\}/);
  assert.match(dialog, /createGuard=\{createGuard\}/);
  // No other caller passes a guard.
  for (const file of ["../master-data/components/master-data-page-form.tsx", "./components/project-form.tsx"]) {
    assert.doesNotMatch(source(file), /createGuard/);
  }
});

/* ---- Name and code are judged independently: neither can bypass the other ---- */

test("a reserved NAME is refused even with a non-PSM code, and vice versa — before create", async () => {
  const mustRefuse = [
    // Required examples.
    [{ name: "PSM", code: "TANK" }, "name"],
    [{ name: "PSAIM", code: "ABC" }, "name"],
    [{ name: "Process Safety", code: "CONS" }, "name"],
    [{ name: "Tank Inspection", code: "PSM-TANK" }, "code"],
    [{ name: "Tank Inspection", code: "PSAIM-01" }, "code"],
    // Reserved names, case / spacing variants.
    [{ name: "PSM Project", code: "X1" }, "name"],
    [{ name: "PSAIM Program", code: "X2" }, "name"],
    [{ name: "Process Safety Management", code: "X3" }, "name"],
    [{ name: "  process   SAFETY  ", code: "X4" }, "name"],
    [{ name: "psm", code: "X5" }, "name"],
    // Reserved codes.
    [{ name: "Anything", code: "PSM" }, "code"],
    [{ name: "Anything", code: "PSM-01" }, "code"],
    [{ name: "Anything", code: "PSAIM" }, "code"],
    [{ name: "Anything", code: "psaim-test" }, "code"],
    // Both reserved: one message, under Category Code.
    [{ name: "PSAIM Program", code: "PSAIM-01" }, "code"],
  ];
  for (const [input, field] of mustRefuse) {
    const spy = createSpy();
    const result = await addFromOtherPicker(input, spy);
    assert.deepEqual(result, { refused: { field, message: PSM_FAMILY_CATEGORY_REFUSAL } }, JSON.stringify(input));
    assert.equal(spy.calls.length, 0, `create was called for ${JSON.stringify(input)}`);
  }
});

test("unrelated names and codes are not falsely blocked", async () => {
  const mustAllow = [
    // Required examples.
    { name: "Tank Inspection", code: "TANK" },
    { name: "Asset Integrity", code: "AIM-01" },
    // Same letters inside other words / tokens are not the PSM token.
    { name: "Upstream Maintenance", code: "UPSM" },
    { name: "PSMX Rollout", code: "ROLL" },
    { name: "Safety Process Review", code: "SPR" },
    { name: "Asset Integrity Management", code: "AIM" },
    { name: "Tank Inspection", code: "TANK-PSM" },
  ];
  for (const input of mustAllow) {
    const spy = createSpy();
    const result = await addFromOtherPicker(input, spy);
    assert.ok("saved" in result, JSON.stringify(input));
    assert.equal(spy.calls.length, 1, JSON.stringify(input));
  }
});

test("the guard reuses the shared PSM rule; the stored-family rule is unchanged", () => {
  // Code: the same anchored, word-boundary rule isPsmProjectType applies to a code.
  for (const code of ["PSM", "PSM-01", "PSAIM", "PSAIM-TEST", "psm-02"]) {
    assert.equal(isReservedPsmCode(code), true, code);
    assert.equal(isPsmProjectType({ id: "x", name: "n", code, active: true }), true, code);
  }
  for (const code of ["AIM-01", "PSMX", "TANK", "TANK-PSM", "", undefined]) {
    assert.equal(isReservedPsmCode(code), false, String(code));
  }
  // Name: "process safety" is the same pattern the family rule falls back to.
  assert.equal(isReservedPsmName("Process Safety"), true);
  assert.equal(isPsmProjectType({ id: "x", name: "Process Safety", active: true }), true);
  assert.equal(isReservedPsmName("Upstream"), false);
  // Existing records are NOT reclassified: with a code present the code still
  // decides the family, exactly like the database rule.
  assert.equal(isPsmProjectType({ id: "x", name: "Process Safety", code: "CONS", active: true }), false);
  // The guard is built from the shared helpers, not its own patterns.
  const guard = source("./project-category.ts");
  const body = guard.slice(guard.indexOf("export function otherProjectCategoryCreateGuard("));
  assert.match(body, /if \(isReservedPsmCode\(code\)\) return \{ field: "code"/);
  assert.match(body, /if \(isReservedPsmName\(name\)\) return \{ field: "name"/);
  assert.doesNotMatch(body, /\/[^/\n]+\/[a-z]*\.test\(/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  categoryChangeKeepsDetail,
  classificationIssues,
  classificationSaveFields,
  classificationSummary,
  classifyPayload,
  firstSaveGate,
  typeLockConfirmationCopy,
  isClassificationComplete,
  projectCategoryLabel,
  structureFamilyChangePatch,
} from "./classification.ts";

const CUSTOM = "cat-other";
const NORMAL = "cat-inspection";
const rules = { customNameCategoryIds: [CUSTOM] };
const paths = (issues) => issues.map((issue) => issue.path);
const source = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replaceAll("\r", "");

test("PSM creation does not require a Project Category", () => {
  const values = { structureFamily: "psm", projectTypeId: "", projectCategoryDetail: "" };
  assert.deepEqual(classificationIssues(values, { ...rules, requireStructureFamily: true }), []);
  assert.deepEqual(classificationIssues(values, { ...rules, requireStructureFamily: true, final: true }), []);
});

test("a new project must choose PSM or Other before saving", () => {
  const values = { structureFamily: "", projectTypeId: "", projectCategoryDetail: "" };
  assert.deepEqual(paths(classificationIssues(values, { requireStructureFamily: true })), ["structureFamily"]);
});

test("Other creation requires a Project Category, on drafts and final saves", () => {
  const values = { structureFamily: "other", projectTypeId: "", projectCategoryDetail: "" };
  assert.deepEqual(paths(classificationIssues(values, rules)), ["projectTypeId"]);
  assert.deepEqual(paths(classificationIssues(values, { ...rules, final: true })), ["projectTypeId"]);
  assert.deepEqual(classificationIssues({ ...values, projectTypeId: NORMAL }, { ...rules, final: true }), []);
});

test("a custom-name category requires the custom name; blank does not count", () => {
  const values = { structureFamily: "other", projectTypeId: CUSTOM, projectCategoryDetail: "" };
  assert.deepEqual(paths(classificationIssues(values, rules)), ["projectCategoryDetail"]);
  assert.deepEqual(paths(classificationIssues({ ...values, projectCategoryDetail: "   " }, rules)), ["projectCategoryDetail"]);
  assert.deepEqual(classificationIssues({ ...values, projectCategoryDetail: "Tank Inspection" }, rules), []);
});

test("switching family clears incompatible category and custom name", () => {
  const other = { structureFamily: "other", projectTypeId: CUSTOM, projectCategoryDetail: "Tank Inspection" };
  assert.deepEqual(structureFamilyChangePatch(other, "psm"), {
    structureFamily: "psm",
    projectTypeId: "",
    projectCategoryDetail: "",
  });
  assert.deepEqual(structureFamilyChangePatch({ structureFamily: "psm" }, "other"), {
    structureFamily: "other",
    projectTypeId: "",
    projectCategoryDetail: "",
  });
  // Choosing the same family again keeps what was entered.
  assert.equal(structureFamilyChangePatch(other, "other"), null);
  // A category without custom naming drops a previously typed custom name.
  assert.equal(categoryChangeKeepsDetail({ allowsCustomName: false }), false);
  assert.equal(categoryChangeKeepsDetail(undefined), false);
  assert.equal(categoryChangeKeepsDetail({ allowsCustomName: true }), true);
});

test("a legacy project (no family) stays valid on an ordinary edit", () => {
  const legacy = { structureFamily: "", projectTypeId: NORMAL, projectCategoryDetail: "" };
  assert.deepEqual(classificationIssues(legacy, { ...rules, final: true }), []);
  assert.deepEqual(classificationIssues(legacy, rules), []);
  // The legacy final-save rule is unchanged: a category is still needed.
  const blank = { ...legacy, projectTypeId: "" };
  assert.deepEqual(paths(classificationIssues(blank, { ...rules, final: true })), ["projectTypeId"]);
  assert.deepEqual(classificationIssues(blank, rules), []);
});

test("projectCategoryLabel shows the custom name alone, otherwise the category", () => {
  const category = { name: "Other" };
  assert.equal(projectCategoryLabel({ projectCategoryDetail: "Tank Inspection" }, category), "Tank Inspection");
  assert.equal(projectCategoryLabel({ projectCategoryDetail: "  " }, { name: "Inspection" }), "Inspection");
  assert.equal(projectCategoryLabel({}, null), undefined);
  assert.equal(classificationSummary("other", "Tank Inspection"), "Other Project · Tank Inspection");
  assert.equal(classificationSummary("other", "Inspection"), "Other Project · Inspection");
  assert.equal(classificationSummary("psm", "Inspection"), "PSM Project");
  assert.equal(classificationSummary("", undefined), "Not classified");
  assert.doesNotMatch(classificationSummary("other", "Tank Inspection"), /Other —/);
});

test("create sends the chosen classification; an ordinary update never sends the family", () => {
  const values = { structureFamily: "other", projectTypeId: CUSTOM, projectCategoryDetail: " Tank Inspection " };
  assert.deepEqual(classificationSaveFields(values, "create"), {
    structureFamily: "other",
    projectTypeId: CUSTOM,
    projectCategoryDetail: "Tank Inspection",
  });
  const update = classificationSaveFields(values, "update");
  assert.equal("structureFamily" in update, false);
  assert.deepEqual(update, { projectTypeId: CUSTOM, projectCategoryDetail: "Tank Inspection" });
  // PSM never carries a category or custom name; a cleared value is an explicit clear.
  assert.deepEqual(classificationSaveFields({ structureFamily: "psm", projectTypeId: "", projectCategoryDetail: "x" }, "create"), {
    structureFamily: "psm",
    projectTypeId: undefined,
    projectCategoryDetail: undefined,
  });
});

test("PSM never saves a category, even if a stale one is still in the form", () => {
  const stale = { structureFamily: "psm", projectTypeId: NORMAL, projectCategoryDetail: "Old name" };
  for (const mode of ["create", "update"]) {
    const fields = classificationSaveFields(stale, mode);
    assert.equal(fields.projectTypeId, undefined, mode);
    assert.equal(fields.projectCategoryDetail, undefined, mode);
    assert.ok("projectTypeId" in fields && "projectCategoryDetail" in fields, mode);
  }
});

test("the main form's update path strips structureFamily before saving", () => {
  const schema = source("./schemas/project-form.ts");
  const update = schema.slice(schema.indexOf("export function formValuesToProjectInfoUpdate("), schema.indexOf("/** Map validated form values to the service input shape. */"));
  assert.match(update, /structureFamily: _structureFamily,\s+\.\.\.info/);
  assert.match(update, /return \{ \.\.\.info, \.\.\.classificationSaveFields\(values, "update"\) \};/);
  const input = schema.slice(schema.indexOf("export function formValuesToProjectInput("));
  assert.match(input, /\.\.\.classificationSaveFields\(values, "create"\)/);
});

test("one-time classification: PSM explicitly clears the category; Other sends it", () => {
  const values = { projectTypeId: CUSTOM, projectCategoryDetail: "Tank Inspection" };
  const psm = classifyPayload("psm", values);
  assert.deepEqual(psm, { structureFamily: "psm", projectTypeId: undefined, projectCategoryDetail: undefined });
  // Present keys, so the key-presence mapper writes NULL rather than skipping them.
  assert.ok("projectTypeId" in psm && "projectCategoryDetail" in psm);
  assert.deepEqual(classifyPayload("other", values), {
    structureFamily: "other",
    projectTypeId: CUSTOM,
    projectCategoryDetail: "Tank Inspection",
  });
});

test("workflow check: PSM by family, Other by category, legacy by type", () => {
  assert.equal(isClassificationComplete({ structureFamily: "psm" }), true);
  assert.equal(isClassificationComplete({ structureFamily: "other" }), false);
  assert.equal(isClassificationComplete({ structureFamily: "other", projectTypeId: NORMAL }), true);
  assert.equal(isClassificationComplete({}), false);
  assert.equal(isClassificationComplete({ projectTypeId: NORMAL }), true);
  const workflow = source("../../config/project-workflow.ts");
  assert.match(workflow, /check\("Project type selected", isClassificationComplete\(project\)\)/);
});

test("Duplicate Project inherits family, category, custom name and portfolio group", () => {
  // Supabase: the copy is the full source project minus identity/timestamps,
  // overriding only code, name and status — and, since 2C.3D Wave 2, the
  // department-team rows (a copy has no project team to hold them).
  const supabase = source("../../services/supabase-project-service.ts");
  const duplicate = supabase.slice(supabase.indexOf("  async duplicateProject("), supabase.indexOf("  async archiveProject("));
  assert.match(duplicate, /return supabaseProjectService\.createProject\(\{\s+\.\.\.rest,\s+(?:\/\/[^\n]*\n\s+)*team: \[\],\s+code: `\$\{source\.code\}-COPY`,\s+name: `\$\{source\.name\} \(Copy\)`,\s+status: "planning",\s+\}\);/);
  for (const key of ["structureFamily", "projectTypeId", "projectCategoryDetail", "portfolioGroupId"]) {
    assert.doesNotMatch(duplicate, new RegExp(`\\b${key}\\b`), `${key} must not be reset on duplicate`);
  }
  // createProject maps every inherited key (flattenProject, key-presence).
  const mapper = supabase.slice(supabase.indexOf("function flattenProject("), supabase.indexOf("/** Wizard-added"));
  for (const column of ["structure_family", "project_type_id", "project_category_detail", "portfolio_group_id"]) {
    assert.match(mapper, new RegExp(`set\\("${column}"`));
  }
  // Mock adapter: a structured clone of the whole source project.
  const mock = source("../../services/project-service.ts");
  const mockDuplicate = mock.slice(mock.indexOf("  async duplicateProject("), mock.indexOf("  async archiveProject("));
  assert.match(mockDuplicate, /\.\.\.clone\(source\),/);
  for (const key of ["structureFamily", "projectTypeId", "projectCategoryDetail", "portfolioGroupId"]) {
    assert.doesNotMatch(mockDuplicate, new RegExp(`\\b${key}\\b`));
  }
});

/* ---------------- E. First save locks the Project Type (2C.1b) ---------------- */


test("E. the lock confirmation is asked only on a new project's first save", () => {
  for (const intent of ["submit", "draft"]) {
    const first = firstSaveGate({}, { type: "request", intent, isNewProject: true });
    assert.deepEqual(first, { state: { pending: intent }, effect: { kind: "none" } });
    // Later saves (the project exists) go straight through — no confirmation.
    const later = firstSaveGate({}, { type: "request", intent, isNewProject: false });
    assert.deepEqual(later, { state: {}, effect: { kind: "save", intent } });
  }
});

test("E. Change Project Type returns to classification; Save and Lock performs the save", () => {
  const pending = { pending: "submit" };
  assert.deepEqual(firstSaveGate(pending, { type: "change-type" }), { state: {}, effect: { kind: "classify" } });
  assert.deepEqual(firstSaveGate(pending, { type: "confirm" }), { state: {}, effect: { kind: "save", intent: "submit" } });
  assert.deepEqual(firstSaveGate({ pending: "draft" }, { type: "confirm" }), { state: {}, effect: { kind: "save", intent: "draft" } });
  assert.deepEqual(firstSaveGate(pending, { type: "dismiss" }), { state: {}, effect: { kind: "none" } });
  // Confirm with nothing pending does nothing.
  assert.deepEqual(firstSaveGate({}, { type: "confirm" }), { state: {}, effect: { kind: "none" } });
});

test("E. the confirmation names the chosen type and the audited-correction rule", () => {
  const psm = typeLockConfirmationCopy("psm");
  assert.equal(psm.title, "Save and lock Project Type?");
  assert.equal(psm.body, "This project will be saved as a PSM Project.");
  assert.equal(typeLockConfirmationCopy("other").body, "This project will be saved as an Other Project.");
  assert.equal(psm.detail, "Project Type cannot be changed after the first save. Only a System Admin can correct it later with an audited correction.");
  assert.equal(psm.changeLabel, "Change Project Type");
  assert.equal(psm.confirmLabel, "Save and Lock");
});

test("E. the form routes BOTH first-save paths through the gate", () => {
  const form = source("./components/project-form.tsx");
  assert.match(form, /firstSaveGate\(firstSave, \{ type: "request", intent: "submit", isNewProject \}\)/);
  assert.match(form, /firstSaveGate\(firstSave, \{ type: "request", intent: "draft", isNewProject \}\)/);
  // Change Project Type reopens the classification screen; nothing is saved.
  assert.match(form, /if \(next\.effect\.kind === "classify"\) \{\s+setPendingValues\(null\);\s+setClassificationPhase\("classify"\);\s+return;/);
  assert.match(form, /<FirstSaveLockDialog\s+open=\{Boolean\(firstSave\.pending\)\}/);
  // The database lock is untouched: the gate only adds a confirmation.
  assert.match(form, /const isNewProject = !projectId;/);
});

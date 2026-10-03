import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyProjectTypeCorrection,
  correctionRpcArgs,
  mapProjectTypeCorrectionError,
  PROJECT_TYPE_CORRECTION_MESSAGES,
  ProjectTypeCorrectionError,
} from "./classification-correction.ts";
import {
  canCorrectProjectType,
  classificationFormValues,
  classificationLabel,
  correctionHistoryLabel,
  correctionIssues,
} from "../features/projects/classification.ts";

const source = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replaceAll("\r", "");
const ADMIN = { resolved: true, isAdmin: true };

test("10. only a resolved System Admin is offered the correction, and only on a locked live project", () => {
  const classified = { structureFamily: "other", status: "active" };
  assert.equal(canCorrectProjectType(ADMIN, classified), true);
  assert.equal(canCorrectProjectType({ resolved: true, isAdmin: false }, classified), false);
  assert.equal(canCorrectProjectType({ resolved: false, isAdmin: true }, classified), false);
  // Legacy projects are classified, not corrected; archived projects are read-only.
  assert.equal(canCorrectProjectType(ADMIN, { structureFamily: undefined, status: "active" }), false);
  assert.equal(canCorrectProjectType(ADMIN, { structureFamily: "psm", status: "archived" }), false);
  assert.equal(canCorrectProjectType(ADMIN, null), false);
  // Every hosting view gates the action on this predicate.
  for (const file of [
    "../features/projects/components/setup/project-setup-view.tsx",
    "../features/projects/components/project-form-view.tsx",
    "../features/projects/components/project-type-corrections.tsx",
  ]) {
    assert.match(source(file), /canCorrectProjectType\(identity, /, file);
  }
});

test("11. a PSM target sends Project Category and custom name as NULL", () => {
  const args = correctionRpcArgs({
    projectId: "p1",
    expectedUpdatedAt: "v1",
    structureFamily: "psm",
    projectTypeId: "stale-category",
    projectCategoryDetail: "Stale name",
    reason: "  Created under the wrong type  ",
  });
  assert.deepEqual(args, {
    p_project: "p1",
    p_expected_updated_at: "v1",
    p_new_family: "psm",
    p_project_type_id: null,
    p_project_category_detail: null,
    p_reason: "Created under the wrong type",
  });
});

test("12. an Other target sends the selected category and custom name", () => {
  const args = correctionRpcArgs({
    projectId: "p1",
    expectedUpdatedAt: "v1",
    structureFamily: "other",
    projectTypeId: "cat-other",
    projectCategoryDetail: " Tank Inspection ",
    reason: "Not a PSM project",
  });
  assert.equal(args.p_new_family, "other");
  assert.equal(args.p_project_type_id, "cat-other");
  assert.equal(args.p_project_category_detail, "Tank Inspection");
  assert.equal(correctionRpcArgs({ ...args, structureFamily: "other", projectId: "p1", expectedUpdatedAt: "v1", reason: "r", projectTypeId: "cat", projectCategoryDetail: "  " }).p_project_category_detail, null);
});

test("13. dialog validation: category, custom name, different type and reason", () => {
  const rules = { customNameCategoryIds: ["cat-other"] };
  const paths = (issues) => issues.map((issue) => issue.path).sort();
  assert.deepEqual(paths(correctionIssues("psm", { structureFamily: "other", projectTypeId: "" }, "why", rules)), ["projectTypeId"]);
  assert.deepEqual(paths(correctionIssues("psm", { structureFamily: "other", projectTypeId: "cat-other", projectCategoryDetail: "" }, "why", rules)), ["projectCategoryDetail"]);
  assert.deepEqual(correctionIssues("psm", { structureFamily: "other", projectTypeId: "cat-other", projectCategoryDetail: "Tank Inspection" }, "why", rules), []);
  assert.deepEqual(paths(correctionIssues("psm", { structureFamily: "psm" }, "why", rules)), ["structureFamily"]);
  assert.deepEqual(paths(correctionIssues("other", { structureFamily: "psm" }, "   ", rules)), ["reason"]);
  assert.deepEqual(correctionIssues("other", { structureFamily: "psm" }, "Wrongly created as Other", rules), []);
});

test("refusals map to fixed wording; raw database text never reaches the user", () => {
  const raw = { message: "[DETAIL_REQUIRED] relation \"public.project_types\" internal detail", code: "23514" };
  const mapped = mapProjectTypeCorrectionError(raw);
  assert.ok(mapped instanceof ProjectTypeCorrectionError);
  assert.equal(mapped.reason, "detail_required");
  assert.equal(mapped.message, PROJECT_TYPE_CORRECTION_MESSAGES.detail_required);
  assert.doesNotMatch(mapped.message, /relation|public\./);
  assert.equal(mapProjectTypeCorrectionError({ message: "[CATEGORY_PSM_FAMILY] x", code: "23514" }).reason, "category_psm_family");
  assert.equal(mapProjectTypeCorrectionError({ message: "permission denied for table projects", code: "42501" }).reason, "not_authorized");
  assert.equal(mapProjectTypeCorrectionError({ message: "could not serialize", code: "40001" }).reason, "stale");
  const unknown = mapProjectTypeCorrectionError({ message: "syntax error at or near \"x\"", code: "42601" });
  assert.equal(unknown.reason, "failed");
  assert.doesNotMatch(unknown.message, /syntax/);
});

test("the Supabase service calls only the audited RPC — never a project update", () => {
  const service = source("./supabase-project-service.ts");
  const correct = service.slice(service.indexOf("  async correctProjectType("), service.indexOf("  async listClassificationCorrections("));
  assert.match(correct, /client\(\)\.rpc\(\s+"correct_project_structure_family",\s+correctionRpcArgs\(input\)\s+\)/);
  assert.match(correct, /if \(error\) throw mapProjectTypeCorrectionError\(error\);/);
  assert.doesNotMatch(correct, /\.from\(|\.update\(|save_project_setup_patch|updateProject/);
  // The views route the correction through the service method, not updateProject.
  for (const file of ["../features/projects/components/setup/project-setup-view.tsx", "../features/projects/components/project-form-view.tsx"]) {
    const view = source(file);
    const handler = view.slice(view.indexOf("const handleCorrectProjectType"), view.indexOf("return corrected;"));
    assert.match(handler, /projectService\.correctProjectType\(/, file);
    assert.doesNotMatch(handler, /updateProject/, file);
  }
});

test("14. a successful correction refreshes the displayed classification with no stale category", () => {
  const existing = {
    id: "p1",
    updatedAt: "v2",
    structureFamily: "other",
    projectTypeId: "pt-cat",
    projectCategoryDetail: "Tank Inspection",
  };
  const { classification, entry } = applyProjectTypeCorrection(
    existing,
    {
      projectId: "p1",
      expectedUpdatedAt: "v2",
      structureFamily: "psm",
      projectTypeId: "pt-cat",
      projectCategoryDetail: "Tank Inspection",
      reason: " Was created as the wrong type ",
    },
    "2026-10-01T10:00:00Z"
  );
  assert.deepEqual(classification, {
    structureFamily: "psm",
    projectTypeId: undefined,
    projectCategoryDetail: undefined,
  });
  // What the form adopts: nothing stale left in the category fields.
  assert.deepEqual(classificationFormValues({ ...existing, ...classification }), {
    structureFamily: "psm",
    projectTypeId: "",
    projectCategoryDetail: "",
  });
  assert.deepEqual(entry, {
    projectId: "p1",
    oldFamily: "other",
    newFamily: "psm",
    oldProjectTypeId: "pt-cat",
    newProjectTypeId: undefined,
    oldCategoryDetail: "Tank Inspection",
    newCategoryDetail: undefined,
    reason: "Was created as the wrong type",
    correctedAt: "2026-10-01T10:00:00Z",
  });
  // Refusals: stale version, blank reason, Other without category, same type, legacy.
  const attempt = (overrides, project = existing) => () =>
    applyProjectTypeCorrection(project, {
      projectId: "p1", expectedUpdatedAt: "v2", structureFamily: "psm", reason: "why", ...overrides,
    }, "t");
  assert.throws(attempt({ expectedUpdatedAt: "v1" }), (error) => error.reason === "stale");
  assert.throws(attempt({ reason: "   " }), (error) => error.reason === "reason_required");
  assert.throws(attempt({ structureFamily: "other", projectTypeId: "" }, { ...existing, structureFamily: "psm", projectTypeId: undefined }), (error) => error.reason === "category_required");
  assert.throws(attempt({ structureFamily: "other", projectTypeId: "x" }), (error) => error.reason === "same_type");
  assert.throws(attempt({}, { ...existing, structureFamily: undefined }), (error) => error.reason === "not_classified");
  // The in-memory backend delegates to this exact rule.
  assert.match(source("./project-service.ts"), /applyProjectTypeCorrection\(existing, input, nowIso\(\)\)/);
  // Every host adopts the RPC result, so Details and Setup show the correction.
  assert.match(source("../features/projects/components/project-form.tsx"), /adoptClassification\(await onCorrectProjectType\(target\)\)/);
  assert.match(source("../features/projects/components/setup/project-setup-view.tsx"), /acceptInfoSaved\(corrected\);/);
  assert.match(source("../features/projects/components/project-form-view.tsx"), /setProject\(corrected\);/);
  assert.match(source("../features/projects/components/project-details-view.tsx"), /onCorrected=\{setProject\}/);
});

test("15. history labels use readable category / custom values, never ids", () => {
  const names = { "cat-insp": "Inspection", "cat-other": "Other" };
  const lookup = (id) => names[id];
  const entry = {
    oldFamily: "other",
    newFamily: "psm",
    oldProjectTypeId: "cat-other",
    oldProjectTypeName: "Other",
    oldCategoryDetail: "Tank Inspection",
  };
  assert.equal(correctionHistoryLabel(entry, "old", lookup), "Other Project · Tank Inspection");
  assert.equal(correctionHistoryLabel(entry, "new", lookup), "PSM Project");
  // No snapshot (in-memory backend): falls back to the current master name.
  const reverse = { oldFamily: "psm", newFamily: "other", newProjectTypeId: "cat-insp" };
  assert.equal(correctionHistoryLabel(reverse, "new", lookup), "Other Project · Inspection");
  assert.equal(correctionHistoryLabel(reverse, "old", lookup), "PSM Project");
  // An unknown category degrades to the family label — still no raw id.
  const unknown = correctionHistoryLabel({ oldFamily: "psm", newFamily: "other", newProjectTypeId: "uuid-123" }, "new", () => undefined);
  assert.equal(unknown, "Other Project");
  assert.doesNotMatch(unknown, /uuid/);
  assert.equal(classificationLabel("psm", "Inspection", "x"), "PSM Project");
});

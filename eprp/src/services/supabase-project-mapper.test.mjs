import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

import {
  classificationIssues,
  classificationSaveFields,
  classifyPayload,
  structureFamilyChangePatch,
} from "../features/projects/classification.ts";

// Executes the REAL flattenProject() / rowToProject() source. The service
// module itself imports the browser Supabase client and `@/` aliases, so the
// two pure mappers are lifted out of the file, type-stripped and evaluated —
// no copy of their logic lives in this test.
const service = readFileSync(new URL("./supabase-project-service.ts", import.meta.url), "utf8").replaceAll("\r", "");
const slice = (from, to) => {
  const start = service.indexOf(from);
  const end = service.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `could not locate ${from}`);
  return service.slice(start, end);
};
const code = [
  slice("function flattenProject(", "/** Wizard-added"),
  slice("const TEAM_ROLE", "\n\n"),
  slice("export function rowToProject(", "/* ---------------------------- Join-table writes").replace("export ", ""),
].join("\n");
const { flattenProject, rowToProject } = new Function(
  `${stripTypeScriptTypes(code)}\nreturn { flattenProject, rowToProject };`
)();

const NEW_COLUMNS = ["structure_family", "project_category_detail", "portfolio_group_id"];

test("omitted classification keys and portfolio group are never sent", () => {
  const row = flattenProject({ name: "Renamed" });
  assert.deepEqual(row, { name: "Renamed" });
  for (const column of NEW_COLUMNS) assert.equal(column in row, false);
  // A relation-only update must not touch a single Project Info column.
  assert.deepEqual(flattenProject({ departments: [] }), {});
});

test("explicitly provided values are mapped to their columns", () => {
  assert.deepEqual(
    flattenProject({ structureFamily: "other", projectCategoryDetail: "Tank Inspection", portfolioGroupId: "pg-1" }),
    { structure_family: "other", project_category_detail: "Tank Inspection", portfolio_group_id: "pg-1" }
  );
  assert.deepEqual(flattenProject({ structureFamily: "psm" }), { structure_family: "psm" });
});

test("a present-but-undefined key is an explicit clear, written as NULL", () => {
  assert.deepEqual(
    flattenProject({ structureFamily: undefined, projectCategoryDetail: undefined, portfolioGroupId: undefined }),
    { structure_family: null, project_category_detail: null, portfolio_group_id: null }
  );
});

/* ---- Classification payloads, end to end through the real mapper ---- */

test("1. legacy -> PSM classification clears project_type_id and project_category_detail", () => {
  const legacyForm = { structureFamily: "", projectTypeId: "type-legacy", projectCategoryDetail: "" };
  assert.deepEqual(flattenProject(classifyPayload("psm", legacyForm)), {
    structure_family: "psm",
    project_type_id: null,
    project_category_detail: null,
  });
});

test("2. legacy -> Other classification keeps the selected category (and requires it)", () => {
  const chosen = { structureFamily: "other", projectTypeId: "type-other", projectCategoryDetail: "Tank Inspection" };
  assert.deepEqual(flattenProject(classifyPayload("other", chosen)), {
    structure_family: "other",
    project_type_id: "type-other",
    project_category_detail: "Tank Inspection",
  });
  assert.deepEqual(
    classificationIssues({ structureFamily: "other", projectTypeId: "" }, { requireStructureFamily: true }).map((issue) => issue.path),
    ["projectTypeId"]
  );
});

test("3. Other -> PSM during creation clears both category fields", () => {
  const other = { structureFamily: "other", projectTypeId: "type-other", projectCategoryDetail: "Tank Inspection" };
  const switched = { ...other, ...structureFamilyChangePatch(other, "psm") };
  const row = flattenProject(classificationSaveFields(switched, "create"));
  assert.deepEqual(row, { structure_family: "psm", project_type_id: null, project_category_detail: null });
});

test("4. an ordinary edit of a classified PSM project cannot resurrect an old category", () => {
  // Even a stale category still sitting in the form is saved as NULL, and the
  // locked family itself is never sent.
  const form = { structureFamily: "psm", projectTypeId: "type-old", projectCategoryDetail: "Old name" };
  const row = flattenProject(classificationSaveFields(form, "update"));
  assert.deepEqual(row, { project_type_id: null, project_category_detail: null });
  assert.equal("structure_family" in row, false);
});

test("rowToProject maps the classification columns, NULL as undefined", () => {
  const base = {
    id: "p1", code: "P-1", name: "Project", short_name: null, description: null,
    project_type_id: "t1", client_id: "c1", portfolio_group_id: "pg-1",
    planned_start_date: "2026-01-01", planned_finish_date: "2026-12-31",
    status: "active", overall_status: "on_track", planned_progress: 0, actual_progress: 0,
    priority: "medium", weekly_enabled: true, monthly_enabled: true, executive_enabled: true,
    weekly_reporting_day: "thursday", monthly_cutoff_day: 25, milestone_update_approval: "manual",
    currency: "EGP", working_week: "sun-thu", time_zone: "Africa/Cairo",
    default_language: "en", include_qr_code: false, include_signature_section: true,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  };
  const classified = rowToProject({ ...base, structure_family: "other", project_category_detail: "Tank Inspection" }, []);
  assert.equal(classified.structureFamily, "other");
  assert.equal(classified.projectCategoryDetail, "Tank Inspection");
  assert.equal(classified.portfolioGroupId, "pg-1");

  const legacy = rowToProject({ ...base, structure_family: null, project_category_detail: null, portfolio_group_id: null }, []);
  assert.equal(legacy.structureFamily, undefined);
  assert.equal(legacy.projectCategoryDetail, undefined);
  assert.equal(legacy.portfolioGroupId, undefined);
});

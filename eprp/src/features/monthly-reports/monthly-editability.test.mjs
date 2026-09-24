import assert from "node:assert/strict";
import test from "node:test";

import { monthlyEditability } from "./monthly-editability.ts";

/*
 * Regression coverage for Access & Visibility hotfix item 3A/3B:
 * `monthlyEditability()` used to return `canEdit: true` unconditionally for
 * any consolidator (`scope.canConsolidate`), regardless of the report's own
 * lifecycle status or its project's archived state. These pin the fixed
 * behavior directly against the real, exported function.
 */

const CONSOLIDATOR_SCOPE = {
  projectId: "prj-1",
  contactId: "contact-pc",
  capability: "project",
  departmentIds: ["dept-eng"],
  managedDepartmentIds: [],
  itemsByDepartment: { "dept-eng": "all" },
  terms: { unit: "Discipline", unitPlural: "Disciplines" },
  canConsolidate: true,
  canControlReportLifecycle: true,
};

const NONE_SCOPE = {
  ...CONSOLIDATOR_SCOPE,
  capability: "none",
  departmentIds: [],
  itemsByDepartment: {},
  canConsolidate: false,
  canControlReportLifecycle: false,
};

const PORTFOLIO_READ_SCOPE = {
  ...CONSOLIDATOR_SCOPE,
  capability: "portfolio_read",
  canConsolidate: false,
  canControlReportLifecycle: false,
  portfolioReadTier: "full",
};

test("no assignment on the project: always read-only", () => {
  const result = monthlyEditability(NONE_SCOPE, "draft", "active");
  assert.equal(result.canEdit, false);
  assert.match(result.reason, /no assignments/i);
});

test("portfolio-wide read grant: always read-only, whatever the status", () => {
  const result = monthlyEditability(PORTFOLIO_READ_SCOPE, "draft", "active");
  assert.equal(result.canEdit, false);
});

test("consolidator on a closed report status (locked/finalized/archived) is read-only — the 3A fix", () => {
  for (const status of ["locked", "finalized", "archived"]) {
    const result = monthlyEditability(CONSOLIDATOR_SCOPE, status, "active");
    assert.equal(result.canEdit, false, `${status} must close CONTENT even for a consolidator`);
  }
});

test("consolidator on an archived PROJECT is read-only regardless of the report's own status — the 3B fix", () => {
  const result = monthlyEditability(CONSOLIDATOR_SCOPE, "draft", "archived");
  assert.equal(result.canEdit, false);
  assert.match(result.reason, /project is archived/i);
});

test("consolidator RETAINS legitimate edit authority on an active project with an open report", () => {
  for (const status of ["draft", "auto_compiled", "department_review", "under_review", "approved"]) {
    const result = monthlyEditability(CONSOLIDATOR_SCOPE, status, "active");
    assert.equal(result.canEdit, true, `${status}: the hotfix must not remove authority that was never in question`);
  }
});

test("non-consolidator (department contributor): editable only inside the department round", () => {
  const contributorScope = {
    ...NONE_SCOPE,
    capability: "scope_items",
    departmentIds: ["dept-eng"],
    itemsByDepartment: { "dept-eng": ["disc-1"] },
    canConsolidate: false,
  };
  assert.equal(monthlyEditability(contributorScope, "draft", "active").canEdit, true);
  assert.equal(monthlyEditability(contributorScope, "auto_compiled", "active").canEdit, true);
  assert.equal(monthlyEditability(contributorScope, "under_review", "active").canEdit, false);
  assert.equal(monthlyEditability(contributorScope, "approved", "active").canEdit, false);
});

test("projectStatus omitted (caller without the project row) skips the archived-project check safely", () => {
  // No third argument at all — must not throw, and must fall back to the
  // pre-3B behavior (report-status-only) rather than refusing everything.
  const result = monthlyEditability(CONSOLIDATOR_SCOPE, "draft");
  assert.equal(result.canEdit, true);
});

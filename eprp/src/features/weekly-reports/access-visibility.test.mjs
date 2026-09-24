import assert from "node:assert/strict";
import test from "node:test";

import { resolveWeeklyScope, weeklyEditability } from "./scope.ts";
import { isEditableReport, isEditableReportStatus } from "./utils.ts";

/*
 * Regression coverage for the Access & Visibility Reconciliation hotfix.
 *
 * These exercise the REAL, aliased-import modules (`resolveWeeklyScope`,
 * `weeklyEditability`) rather than reimplementing the rule, so a future
 * change to either function is caught here. They cover the known
 * reproduction case directly: Nour Adel, platform role Viewer, Reporting
 * Coordinator on PSAIM-001 only, must retain full operational authority on
 * PSAIM-001 and get NONE on an unrelated project (PRJ-002).
 *
 * NOT covered here, and NOT coverable without a live database: the
 * row-level security policies (`can_manage_reporting_workflow()`,
 * `is_report_coordinator()`, `projects_select`, …) that are the actual
 * write/read boundary. This module proves the TypeScript mirror of those
 * rules is internally consistent; it cannot prove the database agrees.
 */

const PSAIM_001 = "prj-psaim-001";
const PRJ_002 = "prj-002";
const NOUR_CONTACT_ID = "contact-nour-adel";
const UNRELATED_CONTACT_ID = "contact-unrelated";

function projectFixture(overrides = {}) {
  return {
    id: PSAIM_001,
    status: "active",
    departments: [{ departmentId: "dept-eng" }],
    team: [
      { contactId: NOUR_CONTACT_ID, role: "reporting_coordinator" },
    ],
    projectControlManagerId: undefined,
    reportingCoordinatorId: undefined,
    ...overrides,
  };
}

test("Reporting Coordinator: full consolidation authority on the ASSIGNED project", () => {
  const project = projectFixture();
  const scope = resolveWeeklyScope(project, NOUR_CONTACT_ID);

  assert.equal(scope.capability, "project");
  assert.equal(scope.canConsolidate, true, "a Report Coordinator consolidates their own project");
  assert.equal(
    scope.canControlReportLifecycle,
    false,
    "a Report Coordinator prepares/consolidates but never rules on the whole report (05_PERMISSION_MODEL.md §1.4)"
  );
});

test("Reporting Coordinator: NO authority on an UNASSIGNED project (the Nour Adel reproduction case)", () => {
  // PRJ-002: same contact, but she holds no project_contacts-equivalent
  // assignment on it at all — no team entry, not the named controller.
  const unrelatedProject = {
    id: PRJ_002,
    status: "active",
    departments: [{ departmentId: "dept-eng" }],
    team: [{ contactId: UNRELATED_CONTACT_ID, role: "project_control_manager" }],
    projectControlManagerId: undefined,
    reportingCoordinatorId: undefined,
  };
  const scope = resolveWeeklyScope(unrelatedProject, NOUR_CONTACT_ID);

  assert.equal(scope.capability, "none");
  assert.equal(scope.canConsolidate, false);
  assert.equal(scope.canControlReportLifecycle, false);
  assert.deepEqual(scope.departmentIds, []);

  // The Edit-route gate (`isEditableReportStatus` + `editability.canEdit` +
  // `scope.canConsolidate`) and the detail page's Edit/Duplicate/transition
  // buttons all key off `canConsolidate` — false here closes every one of
  // them, matching the fixed bug exactly.
  const editability = weeklyEditability(scope, "collecting");
  assert.equal(editability.canEdit, false);
  assert.match(editability.reason, /no assignments/i);
});

test("Project Control / Planning holder: canControlReportLifecycle is true (may rule on the report)", () => {
  const project = projectFixture({ projectControlManagerId: "contact-pc" });
  const scope = resolveWeeklyScope(project, "contact-pc");

  assert.equal(scope.capability, "project");
  assert.equal(scope.canConsolidate, true);
  assert.equal(scope.canControlReportLifecycle, true);
});

test("Platform administrator: sees and controls every project (isAdmin bypass)", () => {
  const unrelatedProject = { id: PRJ_002, status: "active", departments: [], team: [] };
  const scope = resolveWeeklyScope(unrelatedProject, "contact-admin", { isAdmin: true });

  assert.equal(scope.capability, "all_projects");
  assert.equal(scope.canConsolidate, true);
  assert.equal(scope.canControlReportLifecycle, true);
});

test("weeklyEditability: locked/finalized/archived report status is read-only even for a consolidator", () => {
  const scope = resolveWeeklyScope(projectFixture(), NOUR_CONTACT_ID);
  assert.equal(scope.canConsolidate, true); // sanity: she has authority here

  for (const status of ["locked", "finalized", "archived"]) {
    const editability = weeklyEditability(scope, status);
    assert.equal(editability.canEdit, false, `${status} must be read-only regardless of canConsolidate`);
  }
});

test("weeklyEditability: an ARCHIVED PROJECT is read-only even for a consolidator on an otherwise-open report", () => {
  const scope = resolveWeeklyScope(projectFixture(), NOUR_CONTACT_ID);
  const editability = weeklyEditability(scope, "draft", "archived");

  assert.equal(editability.canEdit, false);
  assert.match(editability.reason, /project is archived/i);
});

test("weeklyEditability: a consolidator RETAINS legitimate edit authority on an active project/report", () => {
  const scope = resolveWeeklyScope(projectFixture(), NOUR_CONTACT_ID);
  const editability = weeklyEditability(scope, "draft", "active");

  assert.equal(editability.canEdit, true, "the hotfix must not remove authority that was never in question");
});

test("weeklyEditability: portfolio-wide READ grant is always read-only, whatever the report status", () => {
  const readOnlyScope = {
    projectId: PRJ_002,
    contactId: UNRELATED_CONTACT_ID,
    capability: "portfolio_read",
    departmentIds: ["dept-eng"],
    managedDepartmentIds: [],
    itemsByDepartment: { "dept-eng": "all" },
    terms: { unit: "Discipline", unitPlural: "Disciplines" },
    canConsolidate: false,
    canControlReportLifecycle: false,
    portfolioReadTier: "full",
  };
  const editability = weeklyEditability(readOnlyScope, "draft", "active");
  assert.equal(editability.canEdit, false);
});

test("isEditableReportStatus / isEditableReport agree, and only admit draft|collecting|returned", () => {
  for (const status of ["draft", "collecting", "returned"]) {
    assert.equal(isEditableReportStatus(status), true, status);
  }
  for (const status of ["under_review", "approved", "finalized", "locked", "archived", "rejected"]) {
    assert.equal(isEditableReportStatus(status), false, status);
    assert.equal(isEditableReport({ status }), false, status);
  }
});

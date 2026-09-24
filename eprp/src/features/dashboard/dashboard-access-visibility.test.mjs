import assert from "node:assert/strict";
import test from "node:test";

import { dashboardProjectScope } from "./dashboard-project-scope.ts";

/*
 * Access & Visibility hotfix, item 1 — the code-level half of "every
 * authenticated user sees the active portfolio Dashboard regardless of
 * their assigned projects".
 *
 * `dashboardProjectScope()` is proven here to apply NO per-user filter at
 * all: it takes no viewer/role/assignment argument and its output depends
 * only on `status`. That is necessary but not sufficient — the confirmed
 * QA reproduction (Nour Adel: Viewer role, Reporting Coordinator on
 * PSAIM-001 only, saw ZERO Dashboard projects) traced to `projects_select`
 * row-level security (`supabase/migrations/20260912000003_portfolio_read_
 * entitlements.sql`), which now admits a row only for an operationally
 * assigned account or an explicit portfolio-read grant — rows never reach
 * this function or `projectService.getProjects()` in the first place. That
 * half needs a database-level decision (see the session's completion
 * report) and cannot be exercised without a live Supabase project; it is
 * NOT covered by this file.
 */

function project(id, status, extra = {}) {
  return { id, name: id, status, actual: 50, ...extra };
}

test("dashboardProjectScope takes no viewer/role/assignment parameter", () => {
  assert.equal(dashboardProjectScope.length, 1, "the function signature itself proves it cannot filter by who is asking");
});

test("a project with no assignment-shaped fields at all still passes through when active", () => {
  // No `assignedTo`, `teamContactIds`, `visibleTo`, or similar — deliberately
  // absent, to prove the function reads only `status`.
  const projects = [project("active-unassigned", "active")];
  assert.deepEqual(dashboardProjectScope(projects).map((p) => p.id), ["active-unassigned"]);
});

test("an explicit (and wrong) per-user assignment marker is ignored — visibility is not assignment-gated here", () => {
  const projects = [
    project("mine", "active", { assignedToContactId: "contact-viewer" }),
    project("not-mine", "active", { assignedToContactId: "contact-someone-else" }),
    project("nobodys", "active", { assignedToContactId: null }),
  ];
  const visible = dashboardProjectScope(projects).map((p) => p.id);
  assert.deepEqual(
    visible.sort(),
    ["mine", "not-mine", "nobodys"].sort(),
    "every active project must appear regardless of who it is 'assigned' to on the object"
  );
});

test("archived stays excluded even when it carries an assignment marker for the viewer", () => {
  const projects = [
    project("active-mine", "active", { assignedToContactId: "contact-viewer" }),
    project("archived-mine", "archived", { assignedToContactId: "contact-viewer" }),
  ];
  assert.deepEqual(dashboardProjectScope(projects).map((p) => p.id), ["active-mine"]);
});

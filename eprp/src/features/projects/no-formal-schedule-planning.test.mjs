import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NO_FORMAL_SCHEDULE_NOTICE, planningAuthoringAllowed } from "./planning-experience.ts";
import { workingPlanRefusalMessage } from "./working-plan.ts";

// Phase 13.11 UAT (P1): while a project's Planning Approach is "No formal
// schedule", no Working Plan / import / baseline authoring is possible — in
// the UI and at the database. Runtime proof against real PostgreSQL and real
// roles: scripts/p0-validation/131_runtime_13_11_working_plan.sql §09.

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const MIGRATION = read("../../../supabase/migrations/20261023090000_no_formal_schedule_planning_guard.sql");
const code = MIGRATION.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
const PLANNING = "./components/planning/";

/* --------------------------------- The rule -------------------------------- */

test("authoring is allowed for every Planning Approach except 'No formal schedule'", () => {
  assert.equal(planningAuthoringAllowed("no_formal_schedule"), false);
  assert.equal(planningAuthoringAllowed("new_project"), true);
  assert.equal(planningAuthoringAllowed("existing_active_project"), true);
  // Before the approach is chosen nothing is no-formal-schedule.
  assert.equal(planningAuthoringAllowed(undefined), true);
  assert.equal(planningAuthoringAllowed(null), true);
});

test("the read-only notice says what the state is and where to change it", () => {
  assert.equal(NO_FORMAL_SCHEDULE_NOTICE.title, "No formal schedule");
  assert.match(NO_FORMAL_SCHEDULE_NOTICE.description, /reported without planning governance/);
  assert.match(NO_FORMAL_SCHEDULE_NOTICE.description, /Change the Planning Approach in Project Setup before creating or importing a schedule\./);
});

/* ---------------------------- Database guard ------------------------------- */

test("database: one guard on exactly the eight planning authoring tables, INSERT and UPDATE, every role", () => {
  const tables = code.match(/foreach v_table in array array\[([\s\S]*?)\]/)[1].match(/'(\w+)'/g).map((t) => t.slice(1, -1));
  assert.deepEqual(tables.sort(), [
    "planning_activities", "planning_baselines", "planning_confirmations", "planning_import_batches",
    "planning_import_rows", "planning_milestone_links", "planning_opening_positions", "planning_work_items",
  ]);
  assert.match(code, /create trigger guard_no_formal_schedule_planning before insert or update on public\.%I/);
  assert.match(code, /s\.onboarding_mode = 'no_formal_schedule'/);
  assert.match(code, /\[NOT_PLANNING_GOVERNED\][^']*'\s+using errcode = '42501'/);
  // No role exemption, no client call, fails closed for an unknown table.
  assert.doesNotMatch(code, /is_system_admin|current_user_role|can_manage_project_operations/);
  assert.match(code, /revoke execute on function public\.guard_no_formal_schedule_planning\(\) from public, anon, authenticated;/);
  assert.match(code, /else\s+raise exception 'guard_no_formal_schedule_planning\(\) is not defined for table %'/);
});

test("database: reads, deletes, snapshots (publish already refuses) and other guards are untouched", () => {
  assert.doesNotMatch(code, /before (insert or update or )?delete|or delete/i);
  assert.doesNotMatch(code, /'planning_snapshots'|'planning_snapshot_activities'/);
  assert.doesNotMatch(code, /create (or replace )?function public\.(publish_planning_snapshot|guard_archived_project_planning|can_manage_project_operations)/);
  assert.doesNotMatch(code, /\b(insert into|update|delete from) public\./i, "no row written or repaired");
});

test("a refused write reads as a sentence, not database text", () => {
  assert.equal(
    workingPlanRefusalMessage({ message: "[NOT_PLANNING_GOVERNED] This project has no formal schedule…" }),
    "This project has no formal schedule. Change the Planning Approach in Project Setup before changing its plan."
  );
});

/* ---------------------------------- The UI --------------------------------- */

test("workspace: write authority for Master Plan, Imports and Baselines excludes 'No formal schedule'", () => {
  const workspace = read(`${PLANNING}planning-workspace.tsx`);
  assert.match(workspace, /const authoring =\s+canManage && facts !== undefined && planningAuthoringAllowed\(facts\?\.settings\?\.onboardingMode\);/);
  assert.match(workspace, /<MasterPlanPanel\s+project=\{project\}\s+canManage=\{authoring\}\s+noFormalSchedule=\{noFormalSchedule\}/);
  assert.match(workspace, /<PlanningDataPanel project=\{project\} canManage=\{authoring\} noFormalSchedule=\{noFormalSchedule\} \/>/);
  assert.match(workspace, /<BaselinesSnapshotsPanel\s+project=\{project\}\s+canManage=\{authoring\}/);
  // The tabs stay visible for orientation and history.
  assert.match(workspace, /PLANNING_WORKSPACE_VIEWS\.map/);
});

test("Master Plan: Add Node / Add Activity only with authority; a read-only empty state instead of the build invitation", () => {
  const panel = read(`${PLANNING}master-plan-panel.tsx`);
  assert.match(panel, /\{canManage && \(\s*<div className="flex gap-2 sm:ml-auto">[\s\S]*?Add Activity[\s\S]*?Add Node/);
  const empty = panel.slice(panel.indexOf("{noFormalSchedule && tree.roots.length === 0 ? ("));
  assert.ok(empty.length > 0);
  assert.ok(
    empty.indexOf("title={NO_FORMAL_SCHEDULE_NOTICE.title}") < empty.indexOf("Add the project breakdown"),
    "the no-formal-schedule state is chosen before the authoring invitation"
  );
  assert.match(panel, /<Link href=\{`\$\{projectWorkflowHref\(projectId, "info"\)\}#planning-entry`\}>Open Project Setup<\/Link>/);
  // Existing (legacy) rows stay visible, read-only, with the same notice.
  assert.match(panel, /\{noFormalSchedule && tree\.roots\.length > 0 && \(/);
});

test("Imports & Review: no Import schedule action and no import invitation for 'No formal schedule'", () => {
  const panel = read(`${PLANNING}planning-data-panel.tsx`);
  assert.equal((panel.match(/canManage \?|\{canManage && \(/g) ?? []).length, 2, "both Import buttons gated");
  const empty = panel.slice(panel.indexOf("{batches.length === 0 && noFormalSchedule ? ("));
  assert.ok(empty.indexOf("NO_FORMAL_SCHEDULE_NOTICE.title") < empty.indexOf("No imports yet"));
});

test("Baselines & Snapshots: Publish and Opening Position actions stay withheld for 'No formal schedule'", () => {
  const panel = read(`${PLANNING}baselines-snapshots-panel.tsx`);
  assert.match(panel, /\{canManage && !needsOpening && !noFormalSchedule && \(/);
  assert.match(panel, /settings\?\.onboardingMode === "existing_active_project" && snapshots\.length === 0/);
});

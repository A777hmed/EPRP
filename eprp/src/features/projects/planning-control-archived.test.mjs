import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

// Phase 13.9 — archived / read-only safety guards for Master Planning &
// Control. SOURCE CONTRACTS for
// 20261014090000_planning_control_archived_read_only.sql, the presentation
// authority the Milestones / Deliverables registers use, the service wording
// and the read-only screens. No database connection here: runtime behaviour is
// proved by scripts/p0-validation/121_runtime_13_9_planning_control_archived.sql.

// Some app modules use TS syntax Node's type-stripping rejects; transpile app
// sources loaded from here on (same hook as setup-authority-archived.test.mjs).
registerHooks({ load(url, context, nextLoad) {
  if (!(url.includes("/eprp/src/") && url.endsWith(".ts"))) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });

const { resolveMilestoneAuthority } = await import("./use-milestone-authority.ts");
const { PLANNING_CONTROL_ARCHIVED_MESSAGE, isPlanningControlReadOnly, isArchivedProjectRefusal } =
  await import("./planning-control-archived.ts");

const migrations = new URL("../../../supabase/migrations/", import.meta.url);
const scripts = new URL("../../../scripts/p0-validation/", import.meta.url);
const read = (dir, name) => readFileSync(new URL(name, dir), "utf8").replaceAll("\r", "");
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const FILE = "20261014090000_planning_control_archived_read_only.sql";
const sql = read(migrations, FILE);
const code = sql.replace(/--[^\n]*/g, "");
const sorted = () => readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort();

const TABLES = [
  "project_planning_settings", "planning_import_batches", "planning_import_rows",
  "planning_work_items", "planning_activities", "planning_confirmations",
  "planning_baselines", "planning_milestone_links", "planning_snapshots",
  "planning_snapshot_activities", "planning_opening_positions",
  "master_milestones", "milestone_updates", "weekly_milestone_drafts",
  "master_deliverables", "deliverable_updates",
];

/* ------------------------------ migration -------------------------------- */

test("13.9 is one additive migration directly after 2C.3E", () => {
  const files = sorted();
  assert.equal(files.indexOf(FILE), files.indexOf("20261013120000_member_eligibility_for_responsibilities.sql") + 1);
  // Additive: no existing function, table, policy or grant changed.
  assert.doesNotMatch(code, /create or replace|alter table|drop |create policy|alter policy|\bgrant\b/i);
  assert.deepEqual([...code.matchAll(/create function public\.([a-z_]+)\(/g)].map((match) => match[1]),
    ["guard_archived_project_planning"]);
  for (const earlier of files.slice(0, files.indexOf(FILE))) {
    const text = read(migrations, earlier);
    for (const name of ["guard_archived_project_planning", "block_archived_project_planning"]) {
      assert.ok(!text.includes(name), `${earlier} already uses ${name}`);
    }
  }
  // No row is written, repaired or normalised.
  assert.doesNotMatch(code, /\binsert into\b|\bupdate public\.|\bdelete from\b/i);
});

test("the guard is installed on exactly the 16 Planning / Milestone / Deliverable tables, for INSERT, UPDATE and DELETE", () => {
  const install = code.slice(code.indexOf("do $install$"), code.indexOf("$install$;", code.indexOf("do $install$")));
  const listed = [...install.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
  assert.deepEqual([...listed].sort(), [...TABLES].sort());
  assert.match(install, /create trigger block_archived_project_planning before insert or update or delete on public\.%I/);
  assert.match(install, /for each row execute function public\.guard_archived_project_planning\(\)/);
  // Each table resolves its project; an unknown table fails closed.
  const guard = code.slice(code.indexOf("create function public.guard_archived_project_planning("), code.indexOf("$guard$;"));
  for (const table of TABLES) assert.ok(guard.includes(`'${table}'`), `guard does not resolve ${table}`);
  assert.match(guard, /else\s+[\s\S]*raise exception 'guard_archived_project_planning\(\) is not defined for table %'/);
  // Both ends of an UPDATE count.
  assert.match(guard, /if tg_op <> 'INSERT' then v_rows := v_rows \|\| to_jsonb\(old\)/);
  assert.match(guard, /if tg_op <> 'DELETE' then v_rows := v_rows \|\| to_jsonb\(new\)/);
  assert.match(guard, /public\.project_is_archived\(v_project\)/);
});

test("the refusal uses the 2C.3E tag and SQLSTATE, and the same words the screens show", () => {
  assert.match(code, new RegExp(
    `raise exception '\\[PROJECT_ARCHIVED\\] ${PLANNING_CONTROL_ARCHIVED_MESSAGE.replace(/[.;]/g, "\\$&")}'\\s+using errcode = '42501'`));
  assert.match(code, /security definer set search_path = ''/);
  assert.match(code, /revoke execute on function public\.guard_archived_project_planning\(\) from public, anon, authenticated, service_role;/);
});

test("the shared operations predicate is deliberately not made archive-aware (scope boundary)", () => {
  assert.doesNotMatch(code, /function public\.can_manage_project_operations/);
  assert.match(code, /can_manage_project_operations\(\) was changed/); // proved by the post-check
});

test("the runtime script covers every actor, the owner path, reads, active writes and lifecycle, and rolls back", () => {
  const runtime = read(scripts, "121_runtime_13_9_planning_control_archived.sql");
  for (const key of ["P_X", "P_PCA", "P_SA", "P_Y", "P_V"]) assert.ok(runtime.includes(`'${key}'`), key);
  for (const area of ["01 ARCHIVED · PLANNING", "01 ARCHIVED · SNAPSHOT", "01 ARCHIVED · MILESTONES",
    "01 ARCHIVED · DELIVERABLES", "02 OWNER PATH", "03 ARCHIVED READS", "04 ACTIVE", "05 AUTHORITY",
    "06 LIFECYCLE", "07 CATALOG"]) assert.ok(runtime.includes(area), area);
  assert.match(runtime, /publish_planning_snapshot\(p_project_id => %L::uuid, p_opening_position_id/);
  assert.match(runtime, /publish_planning_snapshot\(p_project_id => %L::uuid, p_import_batch_id/);
  assert.match(runtime, /REFUSING TO RUN: this connection is not local/);
  assert.match(runtime.trimEnd(), /rollback;$/);
});

/* -------------------------- presentation authority ----------------------- */

const project = (extra = {}) => ({
  id: "prj", code: "PRJ", name: "P", status: "active", structureFamily: "psm",
  projectManagerId: "pm", projectControlManagerId: "pcm", reportingCoordinatorId: "rc",
  departments: [], disciplines: [], team: [], parties: [], members: [], positions: [],
  updatedAt: "v1", ...extra,
});
const as = (contactId, isGlobalAuthority = false, extra = {}) =>
  resolveMilestoneAuthority(project(extra), { contactId, isAdmin: false, isGlobalAuthority });

test("active project: Project Control and global authorities manage milestones and deliverables; the Reporting Coordinator does not", () => {
  for (const authority of [as("pcm"), as("anyone", true)]) {
    assert.deepEqual([authority.canManage, authority.canSubmit, authority.canReconcile, authority.archived], [true, true, true, false]);
  }
  const rc = as("rc");
  assert.deepEqual([rc.canManage, rc.canSubmit, rc.canReconcile], [false, false, false]);
});

test("archived project: every write is withdrawn for every role, global authorities included", () => {
  for (const authority of [as("pcm", false, { status: "archived" }), as("anyone", true, { status: "archived" }), as("rc", false, { status: "archived" })]) {
    assert.deepEqual([authority.canManage, authority.canSubmit, authority.canReconcile, authority.archived], [false, false, false, true]);
    assert.equal(authority.resolved, true);
  }
  assert.equal(isPlanningControlReadOnly({ status: "archived" }), true);
  assert.equal(isPlanningControlReadOnly({ status: "active" }), false);
  assert.equal(isPlanningControlReadOnly(null), false);
});

/* ------------------------------ service wording -------------------------- */

test("an archived refusal is recognised by its tag, not by the shared 42501", () => {
  assert.equal(isArchivedProjectRefusal({ message: `[PROJECT_ARCHIVED] ${PLANNING_CONTROL_ARCHIVED_MESSAGE}`, code: "42501" }), true);
  assert.equal(isArchivedProjectRefusal({ message: "new row violates row-level security policy", code: "42501" }), false);
  const errors = source("../../services/service-errors.ts");
  const describe = errors.slice(errors.indexOf("export async function describeFailure("));
  // Checked before the permission wording, so an archived project never reads "you do not have permission".
  assert.ok(describe.indexOf("isArchivedProjectRefusal(options.error)") >= 0);
  assert.ok(describe.indexOf("isArchivedProjectRefusal(options.error)") < describe.indexOf("isPermissionDenied(options.error)"));
  assert.match(describe, /return new Error\(PLANNING_CONTROL_ARCHIVED_MESSAGE\)/);
  for (const service of ["milestone-service.ts", "deliverable-service.ts", "planning-service.ts"]) {
    assert.match(source(`../../services/${service}`), /describeFailure\(/, `${service} routes failures through describeFailure`);
  }
});

/* --------------------------------- screens ------------------------------- */

test("the Planning workspace, Milestones and Deliverables show the archived read-only notice", () => {
  assert.match(source("./components/planning/planning-workspace.tsx"), /isPlanningControlReadOnly\(project\) && <ArchivedPlanningNotice \/>/);
  assert.match(source("./components/milestones/milestones-panel.tsx"), /authority\.archived && <ArchivedPlanningNotice \/>/);
  assert.match(source("./components/deliverables/deliverables-panel.tsx"), /authority\.archived && <ArchivedPlanningNotice \/>/);
  const notice = source("./components/planning/archived-planning-notice.tsx");
  assert.match(notice, /Archived · read-only/);
  assert.match(notice, /PLANNING_CONTROL_ARCHIVED_MESSAGE/);
});

test("approval queues on an archived project say the update stays undecided, not that it waits on Project Control", () => {
  for (const file of ["./components/milestones/approval-queue.tsx", "./components/deliverables/deliverable-approval-queue.tsx"]) {
    assert.match(source(file), /archived\s+\? "Archived project — this update stays undecided\."\s+: "Waiting on Project Control\."/, file);
  }
  assert.match(source("./components/milestones/milestones-panel.tsx"), /archived=\{authority\.archived\}/);
  assert.match(source("./components/deliverables/deliverables-panel.tsx"), /archived=\{authority\.archived\}/);
});

test("Planning actions stay gated on the archive-aware project authority", () => {
  const view = source("./components/sections/project-section-view.tsx");
  assert.match(view, /<PlanningWorkspace[\s\S]*canManage=\{authority\.canManageOperations\}/);
  assert.match(source("./use-project-authority.ts"), /canManageOperations: !archived && holdsOperations/);
});

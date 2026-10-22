import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// SOURCE CONTRACTS for Phase 13.11 (Working Plan hardening): the migration's
// boundaries, the untouched consumers and the UI authority gating. No
// PostgreSQL connection here — the runtime behaviour is proved by
// scripts/p0-validation/131_runtime_13_11_working_plan.sql.

const MIGRATIONS = new URL("../../../supabase/migrations/", import.meta.url);
const FILE = "20261022090000_working_plan_hardening.sql";
const sql = readFileSync(new URL(FILE, MIGRATIONS), "utf8").replaceAll("\r", "");
const code = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
const src = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");

const functions = [...code.matchAll(/create function public\.(\w+)\(/g)].map((m) => m[1]);

test("13.11 migrations: Working Plan hardening after the 13.9B close, then the no-formal-schedule guard (UAT)", () => {
  const names = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(names.slice(-3), [
    "20261021090000_notification_history_clear.sql",
    FILE,
    "20261023090000_no_formal_schedule_planning_guard.sql",
  ]);
});

test("13.11 migration: additive only — nothing dropped, no row written, publish and snapshots untouched", () => {
  assert.doesNotMatch(code, /\bdrop\s+(table|column|function|trigger|policy)\b/i);
  assert.doesNotMatch(code, /\bdelete\s+from\b/i);
  assert.doesNotMatch(code, /\binsert\s+into\s+public\.(?!planning_confirmations|planning_configuration_changes)/i);
  assert.doesNotMatch(code, /publish_planning_snapshot/);
  assert.doesNotMatch(code, /planning_snapshot(s|_activities)\b/);
  assert.doesNotMatch(code, /can_manage_project_operations\s*\([^)]*\)\s*returns/i, "authority predicate not redefined");
  assert.doesNotMatch(code, /guard_archived_project_planning\s*\(\s*\)\s*returns/i, "13.9 guard not redefined");
  // The recorded weight keeps its values and readers; nothing rewrites it.
  assert.doesNotMatch(code, /set\s+weight_percent\b/i);
  assert.doesNotMatch(code, /alter column weight_percent/i);
});

test("13.11 migration: every new function is security definer with an empty search_path", () => {
  assert.deepEqual(functions.sort(), [
    "guard_planning_configuration",
    "guard_planning_configuration_change_row",
    "guard_working_plan_item",
    "log_planning_configuration_change",
    "log_working_plan_change",
    "planning_level_labels_valid",
    "record_planning_weight_decision",
    "save_planning_configuration",
    "stamp_planning_confirmation",
  ]);
  for (const name of functions) {
    const start = code.indexOf(`create function public.${name}(`);
    const header = code.slice(start, code.indexOf(" as $fn$", start));
    assert.match(header, /set search_path = ''/, name);
    if (name !== "planning_level_labels_valid") assert.match(header, /security definer/, name);
  }
});

test("13.11 migration: only the two writers are client-callable; triggers are not", () => {
  for (const name of ["record_planning_weight_decision", "save_planning_configuration"]) {
    assert.match(code, new RegExp(`revoke execute on function public\\.${name}\\([^)]*\\) from public, anon;`), name);
    assert.match(code, new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to authenticated;`), name);
  }
  for (const name of ["guard_working_plan_item", "stamp_planning_confirmation", "log_working_plan_change",
    "guard_planning_configuration", "log_planning_configuration_change", "guard_planning_configuration_change_row"]) {
    assert.match(code, new RegExp(`revoke execute on function public\\.${name}\\(\\) from public, anon, authenticated;`), name);
    assert.doesNotMatch(code, new RegExp(`grant execute on function public\\.${name}\\(`), name);
  }
});

test("13.11 migration: both writers check authority and the archive before writing, and refuse stale input with PT409", () => {
  for (const name of ["record_planning_weight_decision", "save_planning_configuration"]) {
    const body = code.slice(code.indexOf(`create function public.${name}(`), code.indexOf("$fn$;", code.indexOf(`create function public.${name}(`)));
    assert.match(body, /auth\.uid\(\) is null or not public\.can_manage_project_operations\(p_project\)/, name);
    assert.match(body, /public\.project_is_archived\(p_project\)/, name);
    assert.match(body, /\[PROJECT_ARCHIVED\]/, name);
    assert.match(body, /\[STALE\][^']*'\s+using errcode = 'PT409'/, name);
    assert.ok(body.indexOf("project_is_archived") < body.indexOf("update public."), `${name}: archive before write`);
  }
  const decision = code.slice(code.indexOf("create function public.record_planning_weight_decision("));
  assert.match(decision, /\[REASON_REQUIRED\]/);
  assert.match(decision, /pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(p_project::text, 0\)\)/, "same lock as publish");
  assert.match(decision, /v_after_total <> 100/, "normalised weights total exactly 100");
  assert.match(decision, /abs\(\(v_entry ->> 'after'\)::numeric - v_exact\) >= 0\.001/);
  assert.match(decision, /a recorded weight never overwrites it/);
});

test("13.11 migration: the log table is append-only, readable by project readers, archived-guarded", () => {
  assert.match(code, /create table public\.planning_configuration_changes/);
  assert.match(code, /alter table public\.planning_configuration_changes enable row level security;/);
  const policies = [...code.matchAll(/create policy (\w+) on public\.planning_configuration_changes\s+for (\w+)/g)];
  assert.deepEqual(policies.map((m) => m[2]), ["select"]);
  assert.match(code, /create trigger block_archived_planning_configuration\s+before insert or update or delete on public\.planning_configuration_changes/);
  assert.match(code, /Planning configuration history is append-only/);
});

test("13.11 migration: Planning Decision log widened, never loosened for decisions", () => {
  assert.match(code, /check \(action in \('confirm', 'adjust', 'edit', 'normalise'\)\)/);
  assert.match(code, /\(reason is null and action = 'edit'\) or \(reason is not null and length\(btrim\(reason\)\) > 0\)/);
  assert.match(code, /new\.actor_user_id := auth\.uid\(\);/);
  assert.match(code, /new\.confirmed_at := now\(\);/);
  // Still no UPDATE / DELETE path on the log.
  assert.doesNotMatch(code, /create policy \w+ on public\.planning_confirmations/);
});

test("13.11 migration: integrity rules — kind/method, family mapping, no milestone nodes, no detaching", () => {
  assert.match(code, /check \(earning_method is null or \(\(earning_method = 'milestone'\) = is_milestone\)\)/);
  assert.match(code, /references public\.project_structure_nodes \(id, project_id\)/);
  for (const tag of ["REPORTING_UNIT_FAMILY", "REPORTING_UNIT_ARCHIVED", "REPORTING_UNIT_INCOMPLETE",
    "REPORTING_UNIT_NOT_IN_PROJECT", "NODE_NOT_MILESTONE", "NODE_ARCHIVED", "ACTIVITY_DETACH",
    "NOT_PLANNING_GOVERNED", "ONBOARDING_NOT_CHOSEN", "INVALID_CONFIGURATION", "INVALID_DECISION"]) {
    assert.match(code, new RegExp(`\\[${tag}\\]`), tag);
  }
  // The guard sorts after the 13.9 archived guard on both tables.
  assert.ok("block_archived_project_planning" < "guard_working_plan_item");
});

test("13.11 migration: the onboarding mode is never written by Planning Setup", () => {
  const save = code.slice(code.indexOf("create function public.save_planning_configuration("));
  assert.doesNotMatch(save.slice(0, save.indexOf("$fn$;")), /onboarding_mode\s*=/);
  assert.match(save, /\[ONBOARDING_NOT_CHOSEN\]/);
});

/* --------------------------- Consumers untouched -------------------------- */

test("no consumer reads the Working Plan adapter or the engine yet (13.14 / 13.17 / 13.19 / 13.20)", () => {
  const roots = ["../dashboard/", "../weekly-reports/", "../monthly-reports/", "../executive-reports/", "../calendar/"];
  for (const root of roots) {
    const files = readdirSync(new URL(root, import.meta.url), { recursive: true })
      .map(String)
      .filter((name) => /\.(ts|tsx)$/.test(name));
    for (const file of files) {
      const text = src(`${root}${file.replaceAll("\\", "/")}`);
      assert.doesNotMatch(text, /working-plan|planning-engine/, `${root}${file}`);
    }
  }
  // The legacy flat roll-up keeps reading the recorded weight only.
  const rollup = src("../../lib/planning-rollup.ts");
  assert.doesNotMatch(rollup, /localWeight/);
});

test("the adapter never reads the recorded weight", () => {
  const plan = src("./working-plan.ts");
  const adapter = plan.slice(plan.indexOf("export function toEnginePlanInput("));
  assert.doesNotMatch(adapter, /\.weightPercent\b/);
  assert.match(adapter, /localWeight: activity\.localWeightPercent \?\? null/);
  assert.match(adapter, /localWeight: element\.item\.localWeightPercent \?\? null/);
});

/* ------------------------------ UI governance ----------------------------- */

test("Master Plan: every write action is gated by canManage (archive-aware authority)", () => {
  const panel = src("./components/planning/master-plan-panel.tsx");
  assert.match(panel, /\{canManage && \(\s*<div className="flex gap-2 sm:ml-auto">/);
  // Read-only rows get History only (right-aligned in the Actions column).
  assert.match(panel, /if \(!canManage\) \{\s*return \(\s*<span className="inline-flex items-center justify-end">\s*<Button variant="ghost" size="sm" onClick=\{onHistory\}>/);
  const section = src("./components/sections/project-section-view.tsx");
  assert.match(section, /<PlanningWorkspace\s+project=\{project\}\s+canManage=\{authority\.canManageOperations\}/);
  const authority = src("./use-project-authority.ts");
  assert.match(authority, /canManageOperations: !archived && holdsOperations/);
});

test("Planning Setup: Guided and Advanced write the same four fields through one service call", () => {
  const panel = src("./components/planning/planning-setup-panel.tsx");
  assert.equal(panel.split("planningService.saveConfiguration(").length - 1, 1);
  assert.doesNotMatch(panel, /onboardingMode|upsertSettings|localStorage/);
  assert.match(panel, /disabled=\{readOnly \|\| saving/);
  const workspace = src("./components/planning/planning-workspace.tsx");
  assert.match(workspace, /mode !== "no_formal_schedule" && \(\s*<PlanningSetupPanel/);
});

test("import review never detaches an activity or writes an EPRP-owned field", () => {
  const review = src("./components/planning/planning-review-panel.tsx");
  assert.doesNotMatch(review, /work_item_id:/);
  assert.doesNotMatch(review, /local_weight_percent|earning_method|structure_node_id/);
});

test("node dialog never offers the deprecated Milestone classification for a new node", () => {
  const dialog = src("./components/planning/work-item-form-dialog.tsx");
  assert.match(dialog, /\.filter\(\s*\(type\) => type !== "milestone"\s*\)/);
  assert.match(dialog, /item\?\.itemType === "milestone" \? \[\.\.\.NODE_CLASSIFICATIONS, "milestone" as const\] : NODE_CLASSIFICATIONS/);
});

/* --------------------------- 13.11 UAT refinements ------------------------ */

test("Planning Setup: one short visible sentence; the detail lives in contextual help; one writer", () => {
  const panel = src("./components/planning/planning-setup-panel.tsx");
  assert.match(panel, /How this project&apos;s plan is broken down, weighted and measured\./);
  for (const concept of ["planningSetup", "setupViews", "planningLevels", "controlAccount", "weightSource", "earningMethod"]) {
    assert.ok(panel.includes(`concept="${concept}"`), concept);
  }
  // Guided questions carry their own help icon.
  assert.match(panel, /<PlanningHelp concept=\{guided\[step\]\.help\} \/>/);
  assert.doesNotMatch(panel, /BreakdownExample|SETTING_HELP|function Hint\(/);
  assert.equal(panel.split("planningService.saveConfiguration(").length - 1, 1);
});

test("workspace header: each summary fact is its own separated cell; values unchanged", () => {
  const workspace = src("./components/planning/planning-workspace.tsx");
  const strip = workspace.slice(workspace.indexOf("function WorkspaceHeaderStrip("));
  for (const label of ["Working Plan", "Published snapshot", "Data Date", "Planning approach"]) {
    assert.match(strip, new RegExp(`label: "${label}"`), label);
  }
  assert.match(strip, /\.\.\.\(snapshot\s+\? \[\{ key: "data-date"[^\]]*\]\s+: \[\]\)/, "Data Date still omitted without a snapshot");
  assert.match(strip, /index > 0 && "lg:border-l"/);
  assert.match(strip, /sm:grid-cols-2 lg:flex/);
});

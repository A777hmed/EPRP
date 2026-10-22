import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { isProjectControlPlanning } from "../../features/projects/assignment-rules.ts";

/* Phase 13.10 fences. The roadmap's 13.10 definition: "no schema or UI
   change; the existing flat roll-up is untouched". The engine is pure; the
   authority to publish what it calculates stays exactly where 13.9 / 13.9B
   left it — `publish_planning_snapshot()` behind
   `can_manage_project_operations()` with the archived refusal. */

const ENGINE_DIR = new URL("./", import.meta.url);
const MIGRATIONS_DIR = new URL("../../../supabase/migrations/", import.meta.url);
const ENGINE_SOURCES = readdirSync(ENGINE_DIR).filter((name) => name.endsWith(".ts"));

/* --------------------------------- Purity -------------------------------- */

test("purity: the engine imports nothing but its own files and type-only @/types", () => {
  for (const name of ENGINE_SOURCES) {
    const source = readFileSync(new URL(name, ENGINE_DIR), "utf8");
    for (const [, statement, specifier] of source.matchAll(/^(import[^;]*?)from\s+"([^"]+)";/gms)) {
      if (specifier.startsWith("./")) continue;
      assert.ok(specifier.startsWith("@/types"), `${name} imports ${specifier}`);
      assert.match(statement, /^import type /, `${name}: ${specifier} must be a type-only import`);
    }
  }
});

test("purity: no storage, network, React or clock reads inside the engine", () => {
  for (const name of ENGINE_SOURCES) {
    const source = readFileSync(new URL(name, ENGINE_DIR), "utf8");
    for (const forbidden of [/from "[^"]*supabase/i, /createClient/, /\bfetch\(/, /from "react"/, /Date\.now\(/, /new Date\(\)/, /localStorage/]) {
      assert.doesNotMatch(source, forbidden, `${name} must stay pure (${forbidden})`);
    }
  }
});

/* ------------------------------ No schema change ------------------------- */

test("13.10 adds no migration: nothing sorts between the 13.9B close and the 13.11 migration", () => {
  const names = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
  const close = names.indexOf("20261021090000_notification_history_clear.sql");
  assert.ok(close >= 0);
  // The next migration is 13.11's Working Plan hardening, not a 13.10 one.
  assert.equal(names[close + 1], "20261022090000_working_plan_hardening.sql");
});

/* ------------------------------ Immutability ----------------------------- */

test("published snapshots stay immutable: no UPDATE or DELETE policy on either snapshot table", () => {
  const all = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => readFileSync(new URL(name, MIGRATIONS_DIR), "utf8"))
    .join("\n");
  const policies = [...all.matchAll(/create policy\s+\w+\s+on public\.(planning_snapshots|planning_snapshot_activities)\s[^;]*;/gi)];
  assert.equal(policies.length, 4, "select + insert on each snapshot table");
  for (const [policy] of policies) {
    assert.match(policy, /\bfor\s+(select|insert)\b/i, policy.slice(0, 120));
  }
  assert.doesNotMatch(all, /alter policy\s+\w+\s+on public\.planning_snapshot/i, "no policy was widened later");
});

/* ---------------------------- Publish authority -------------------------- */

function latestPublishDefinition() {
  const names = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
  let latest = null;
  for (const name of names) {
    const source = readFileSync(new URL(name, MIGRATIONS_DIR), "utf8");
    const match = /create (?:or replace )?function public\.publish_planning_snapshot\([\s\S]*?\$function\$;/i.exec(source);
    if (match) latest = { name, body: match[0] };
  }
  return latest;
}

test("publish authority: the live publish requires Project Control authority, then refuses archived and no_formal_schedule", () => {
  const latest = latestPublishDefinition();
  assert.equal(latest.name, "20261016090000_project_setup_governance_core.sql");
  const { body } = latest;
  const authority = body.indexOf("public.can_manage_project_operations(p_project_id)");
  const archived = body.indexOf("public.project_is_archived(p_project_id)");
  const noSchedule = body.indexOf("'no_formal_schedule'");
  assert.ok(authority > 0, "authority check present");
  assert.ok(archived > authority, "archived refusal present");
  assert.ok(noSchedule > archived, "no_formal_schedule refusal present");
  assert.match(body, /using errcode = 'insufficient_privilege'/);
  assert.match(body, /security definer/i);
});

test("publish authority: can_manage_project_operations admits global operational authority or assigned Project Control only", () => {
  const source = readFileSync(new URL("20260824000001_authorization_foundation_wave1.sql", MIGRATIONS_DIR), "utf8");
  const definition = /create or replace function public\.can_manage_project_operations\(p_project uuid\)[\s\S]*?\$fn\$;/.exec(source)[0];
  assert.match(definition, /has_global_operational_authority\(\)/);
  assert.match(definition, /is_project_control_planning\(p_project\)/);
  assert.doesNotMatch(definition, /report_coordinator|consolidator/i, "the Report Coordinator gets no planning authority");
});

/* -------------------- Client authority mirror (presentation) ------------- */

const project = {
  projectControlManagerId: "pc-assigned",
  team: [
    { contactId: "pc-team", role: "project_control_manager" },
    { contactId: "rc", role: "reporting_coordinator" },
    { contactId: "dept-user", role: "team_member" },
  ],
};

test("permissions: System Admin and Project Control Admin may publish on every project", () => {
  assert.equal(isProjectControlPlanning(project, "anyone", { isGlobalAuthority: true }), true);
  assert.equal(isProjectControlPlanning({ team: [] }, "anyone", { isGlobalAuthority: true }), true);
});

test("permissions: Project Control / Planning may publish on ASSIGNED projects only", () => {
  assert.equal(isProjectControlPlanning(project, "pc-assigned"), true);
  assert.equal(isProjectControlPlanning(project, "pc-team"), true);
  const otherProject = { projectControlManagerId: "someone-else", team: [] };
  assert.equal(isProjectControlPlanning(otherProject, "pc-assigned"), false, "read-only elsewhere");
});

test("permissions: Report Coordinator, department users and unknown users get no planning write or publish", () => {
  assert.equal(isProjectControlPlanning(project, "rc"), false);
  assert.equal(isProjectControlPlanning(project, "dept-user"), false);
  assert.equal(isProjectControlPlanning(project, null), false);
  assert.equal(isProjectControlPlanning(project, undefined), false);
});

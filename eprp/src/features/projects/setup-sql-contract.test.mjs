import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

// SOURCE CONTRACTS ONLY: no PostgreSQL connection, migration execution or RLS test.
const migrations = new URL("../../../supabase/migrations/", import.meta.url);
const read = (name) => readFileSync(new URL(name, migrations), "utf8").replaceAll("\r", "");
const atomic = read("20260926000002_project_setup_atomic_save.sql");
const writers = read("20260926000003_project_setup_writer_serialization.sql");
const source = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const body = (sql, name, delimiter) => {
  const start = sql.indexOf(`function public.${name}(`);
  assert.ok(start >= 0);
  const finish = sql.indexOf(`\n${delimiter};`, start);
  assert.ok(finish > start);
  return sql.slice(start, finish + delimiter.length + 2);
};

test("migration filename and sequence are unique in this checkout", () => {
  const files = readdirSync(migrations);
  assert.deepEqual(files.filter((name) => name.endsWith("_project_setup_atomic_save.sql")), ["20260926000002_project_setup_atomic_save.sql"]);
  for (const prefix of ["20260926000002", "20260926000003"]) {
    assert.equal(files.filter((name) => name.startsWith(prefix)).length, 1);
  }
});

test("invoker grants cover reads and owned writes without granting anonymous access", () => {
  assert.match(atomic, /grant select on public\.projects to authenticated/);
  assert.match(atomic, /grant update \(updated_at\) on public\.projects to authenticated/);
  assert.match(atomic, /grant select, insert, update, delete on public\.project_contacts to authenticated/);
  assert.doesNotMatch(atomic, /^grant [^;]+ to (?:public|anon)\b/im);
  assert.doesNotMatch(atomic, /grant (?:all|update on public\.projects)/i);
  assert.match(atomic, /revoke execute on function public\.invalidate_setup_project_version\(\) from public, anon, authenticated, service_role/);
});

test("batch allowlist matches the existing mapper and excludes server-owned columns", () => {
  const service = source("../../services/supabase-project-service.ts");
  const mapper = service.slice(service.indexOf("function flattenProject("), service.indexOf("/** Wizard-added"));
  const mapped = new Set([
    ...[...mapper.matchAll(/set\("([a-z_]+)"/g)].map((match) => match[1]),
    ...[...mapper.matchAll(/row\.([a-z_]+) =/g)].map((match) => match[1]),
  ]);
  const allowlist = atomic.match(/v_columns constant text\[\] := array\[([\s\S]+?)\];/)[1];
  assert.deepEqual(new Set([...allowlist.matchAll(/'([a-z_]+)'/g)].map((match) => match[1])), mapped);
  for (const column of ["id", "created_at", "updated_at", "archived_at"]) assert.equal(mapped.has(column), false);
  assert.match(atomic, /if not \(v_key = any\(v_columns\)\) then/);
  assert.match(atomic, /get diagnostics v_count = row_count;\s+if v_count <> 1 then/);
});

test("all setup relation mutations invalidate the parent with a strictly advancing version", () => {
  for (const table of ["projects", "project_departments", "project_disciplines", "project_contacts", "project_delegations", "project_positions", "project_sites"]) {
    assert.ok(atomic.includes(`'${table}'`));
  }
  assert.match(atomic, /greatest\(clock_timestamp\(\), old\.updated_at \+ interval '1 microsecond'\)/);
  assert.match(atomic, /before insert or update or delete[^\n]+for each statement/);
  assert.match(atomic, /before insert or update or delete[^\n]+for each row/);
  const relation = body(atomic, "save_project_setup_relation", "$fn$");
  assert.match(relation, /select updated_at into strict v_saved_at[^;]+;\s+return v_saved_at;/);
});

test("RPCs lock before writes, reject stale and NULL data, and propagate every failure", () => {
  for (const [name, delimiter] of [["save_project_setup_relation", "$fn$"], ["save_project_setup_patch", "$patch$"]]) {
    const rpc = body(atomic, name, delimiter);
    assert.match(rpc, /p_project is null or p_expected_updated_at is null/);
    assert.match(rpc, /auth\.uid\(\) is null or public\.current_user_role\(\) is null/);
    assert.match(rpc, /can_manage_project_setup\(p_project\) is distinct from true/);
    assert.ok(rpc.indexOf("pg_advisory_xact_lock(190726, 1)") < rpc.indexOf("update public.projects") || name.endsWith("patch"));
    assert.doesNotMatch(rpc, /exception\s+when|\bcommit\s*;|\brollback\s*;/i);
    assert.match(rpc, /40001/);
  }
  const patch = body(atomic, "save_project_setup_patch", "$patch$");
  assert.ok(patch.indexOf("v_version is distinct from p_expected_updated_at") < patch.indexOf("insert into public.project_contacts"));
  assert.match(patch, /perform public\.save_project_setup_relation\(p_project, v_version, v_key, v_rows\)/);
});

test("forward master move preserves the existing body apart from guards and lock", () => {
  const original = body(read("20260819000005_move_discipline_system_master_sync.sql"), "move_discipline_system", "$$");
  const updated = body(writers, "move_discipline_system", "$$");
  const restored = updated
    .replace("security invoker\nset search_path = ''\n", "")
    .replace(/  if auth\.uid\(\) is null or public\.current_user_role\(\) is null\n     or public\.has_global_operational_authority\(\) is distinct from true then\n    raise exception 'Master data access is required\.' using errcode = '42501';\n  end if;\n/g, "")
    .replace("  -- Acquire the same setup lock BEFORE the existing discipline lock/reads.\n  perform pg_catalog.pg_advisory_xact_lock(190726, 1);\n", "");
  assert.equal(restored, original);
  assert.ok(updated.indexOf("pg_advisory_xact_lock") < updated.indexOf("select * into rec"));
});

test("forward Replace Person preserves all existing prechecks, CAS and history", () => {
  const original = body(read("20260910000001_replace_person_last_membership_precheck.sql"), "replace_project_responsibility", "$fn$");
  const updated = body(writers, "replace_project_responsibility", "$fn$");
  const restored = updated
    .replace("if auth.uid() is null or public.current_user_role() is null\n     or public.can_manage_project_responsibilities(p_project) is distinct from true then", "if not public.can_manage_project_responsibilities(p_project) then")
    .replace(/  -- Serialize all three replacement shapes BEFORE inspecting assignments\.[\s\S]+?  -- 2\. Input shape\./, "  -- 2. Input shape.")
    .replace("if p_unit_kind is null or p_unit_kind not in", "if p_unit_kind not in");
  assert.equal(restored, original);
  assert.ok(updated.indexOf("pg_advisory_xact_lock") < updated.indexOf("-- 2. Input shape."));
});

test("legacy update uses a loaded version and one RPC, never a pre-save table write", () => {
  const service = source("../../services/supabase-project-service.ts");
  const update = service.slice(service.indexOf("  async updateProject("), service.indexOf("  async duplicateProject("));
  assert.match(update, /if \(!expectedUpdatedAt\)/);
  assert.match(update, /p_expected_updated_at: expectedUpdatedAt/);
  assert.match(update, /rpc\("save_project_setup_patch"/);
  assert.doesNotMatch(update, /\.from\(|await replace|ensureResponsibilityContacts/);
  const links = source("./link-record-to-project.ts");
  assert.equal([...links.matchAll(/updateProject\(project\.id, \{[^}]+\}, project\.updatedAt\)/g)].length, 4);
  assert.match(service, /finalVersion\.updated_at !== row\.updated_at/);
});

test("a saved version cannot remount the workspace and discard unrelated edits", () => {
  const wizard = source("./components/setup/project-setup-view.tsx");
  assert.match(wizard, /<ProjectInfoWorkspace\s+key=\{project\.id\}/);
  assert.doesNotMatch(wizard, /key=\{project\.updatedAt\}/);
  assert.match(wizard, /reconcileSetupSave\(project, current, latestDraft\.current, saved, relation\)/);
  const workspace = source("./components/setup/project-info-workspace.tsx");
  assert.match(workspace, /baseline\.current = updated/);
  assert.match(workspace, /scope === "structure" \? \["departments", "disciplines"\] : \["team", "delegations"\]/);
});

test("master-delete locks cover every cascading FK into the protected setup tables", () => {
  const protectedTables = new Set(["projects", "project_departments", "project_disciplines", "project_contacts", "project_delegations", "project_positions", "project_sites"]);
  const edges = [];
  // These migrations declare the setup FKs; inspect all migrations so future
  // additions to an existing protected table also fail this coverage contract.
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql"))) {
    const sql = read(file).replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const statement of sql.matchAll(/(?:create table(?: if not exists)?|alter table) public\.([a-z_]+)\b([^;]*);/gi)) {
      if (!protectedTables.has(statement[1])) continue;
      for (const fk of statement[2].matchAll(/references (public|auth)\.([a-z_]+)\([^)]*\) on delete (set null|cascade|set default)/gi)) {
        edges.push(`${fk[1]}.${fk[2]} -> public.${statement[1]}`);
      }
    }
  }
  const sources = new Set(edges.map((edge) => edge.split(" -> ")[0]));
  assert.deepEqual(sources, new Set(["public.projects", "public.contacts", "public.project_phases", "public.departments", "public.systems", "public.disciplines", "auth.users", "public.portfolio_groups"]));
  const block = writers.slice(writers.indexOf("do $master_delete_locks$"));
  const installed = new Set([...block.matchAll(/'([a-z_]+)'/g)].map((match) => `public.${match[1]}`));
  assert.deepEqual(installed, new Set([...sources].filter((table) => table.startsWith("public.") && table !== "public.projects")));
  assert.match(block, /create trigger lock_project_setup_master_delete before delete on public\.%I for each statement execute function public\.lock_project_setup_statement\(\)/);
  assert.match(block, /create trigger lock_project_setup_master_delete before delete on auth\.users\s+for each statement execute function public\.lock_project_setup_statement\(\)/);
  assert.match(atomic, /'projects'[\s\S]+before insert or update or delete[^\n]+for each statement/);
});

test("master deletes reuse the same transaction lock without changing authorization or delete behavior", () => {
  const block = writers.slice(writers.indexOf("-- Master-delete lock inventory"));
  assert.doesNotMatch(block, /\b(?:grant|revoke|security definer|create policy|alter policy|drop policy|disable trigger|delete from)\b/i);
  const lock = atomic.slice(atomic.indexOf("create function public.lock_project_setup_statement()"), atomic.indexOf("$lock$;"));
  assert.match(lock, /pg_catalog\.pg_advisory_xact_lock\(190726, 1\)/);
  assert.match(lock, /return null;/);
  assert.doesNotMatch(lock, /exception\s+when|pg_advisory_unlock/i);
  const service = source("../master-data/supabase-service.ts");
  assert.match(service, /async delete\(id\)[\s\S]+?client\(\)\.from\(table\)\.delete\(\)\.eq\("id", id\)/);
  assert.match(service, /if \(error\)[\s\S]+?throw new Error/);
});

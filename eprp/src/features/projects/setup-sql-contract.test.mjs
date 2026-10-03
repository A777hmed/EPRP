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

/**
 * The LATEST definition of a function across all migrations, in filename
 * order — what a fully migrated database actually runs. Historical migrations
 * are never edited, so contracts against the live behaviour must read this.
 */
const latestBody = (name, delimiter) => {
  const files = readdirSync(migrations).filter((file) => file.endsWith(".sql")).sort();
  const file = files.filter((candidate) => read(candidate).includes(`function public.${name}(`)).at(-1);
  assert.ok(file, `no migration defines public.${name}`);
  return { file, sql: body(read(file), name, delimiter) };
};

test("batch allowlist (latest patch definition) matches the mapper and excludes server-owned columns", () => {
  const service = source("../../services/supabase-project-service.ts");
  const mapper = service.slice(service.indexOf("function flattenProject("), service.indexOf("/** Wizard-added"));
  const mapped = new Set([
    ...[...mapper.matchAll(/set\("([a-z_]+)"/g)].map((match) => match[1]),
    ...[...mapper.matchAll(/row\.([a-z_]+) =/g)].map((match) => match[1]),
  ]);
  const latest = latestBody("save_project_setup_patch", "$patch$");
  assert.equal(latest.file, "20261001000001_project_setup_classification.sql");
  const allowlist = latest.sql.match(/v_columns constant text\[\] := array\[([\s\S]+?)\];/)[1];
  assert.deepEqual(new Set([...allowlist.matchAll(/'([a-z_]+)'/g)].map((match) => match[1])), mapped);
  for (const column of ["id", "created_at", "updated_at", "archived_at"]) assert.equal(mapped.has(column), false);
  assert.match(latest.sql, /if not \(v_key = any\(v_columns\)\) then/);
  assert.match(latest.sql, /get diagnostics v_count = row_count;\s+if v_count <> 1 then/);
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

/* ------------------- Phase 2C.1 — Project Setup Classification ------------------- */

const CLASSIFICATION_FILE = "20261001000001_project_setup_classification.sql";
const classification = read(CLASSIFICATION_FILE);
const withoutComments = (sql) => sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
/** The migration minus every function body, i.e. only its top-level statements. */
const topLevel = withoutComments(classification).replace(/\$([a-z]+)\$[\s\S]*?\$\1\$/g, "$$body$$");
const allowlistOf = (sql) =>
  new Set([...sql.match(/v_columns constant text\[\] := array\[([\s\S]+?)\];/)[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]));
const NEW_PATCH_COLUMNS = ["structure_family", "project_category_detail", "portfolio_group_id"];

test("2C.1: classification migration name and sequence are unique and sort after the current setup migrations", () => {
  const files = readdirSync(migrations);
  assert.deepEqual(files.filter((name) => name.endsWith("_project_setup_classification.sql")), [CLASSIFICATION_FILE]);
  assert.equal(files.filter((name) => name.startsWith("20261001000001")).length, 1);
  const sorted = files.filter((name) => name.endsWith(".sql")).sort();
  assert.ok(sorted.indexOf(CLASSIFICATION_FILE) > sorted.indexOf("20260926000003_project_setup_writer_serialization.sql"));
});

test("2C.1: no backfill, no master-data seeding and no rename", () => {
  assert.doesNotMatch(topLevel, /\bupdate\s+public\.projects\b/i);
  assert.doesNotMatch(topLevel, /\binsert\s+into\s+public\.projects\b/i);
  assert.doesNotMatch(topLevel, /\b(?:insert\s+into|update|delete\s+from)\s+public\.project_types\b/i);
  assert.doesNotMatch(topLevel, /\brename\b/i);
  assert.doesNotMatch(topLevel, /\bdrop\s+(?:table|column|constraint|policy)\b/i);
  // New columns are nullable with no default, so existing rows stay NULL / legacy.
  assert.match(topLevel, /add column structure_family text,\s+add column project_category_detail text;/);
  assert.match(topLevel, /add column allows_custom_name boolean not null default false;/);
});

test("2C.1: classification rules are declared as constraints and a trigger", () => {
  assert.match(topLevel, /check \(structure_family is null or structure_family in \('psm', 'other'\)\)/);
  assert.match(topLevel, /check \(project_category_detail is null or length\(btrim\(project_category_detail\)\) > 0\)/);
  assert.match(topLevel, /check \(structure_family is distinct from 'other' or project_type_id is not null\)/);
  assert.match(topLevel, /check \(project_category_detail is null or structure_family = 'other'\)/);
  // PSM never requires a category: no constraint ties psm to project_type_id.
  assert.doesNotMatch(topLevel, /structure_family\s*=\s*'psm'[^)]*project_type_id/);
  assert.match(topLevel, /before insert or update of structure_family, project_type_id, project_category_detail\s+on public\.projects\s+for each row execute function public\.enforce_project_classification\(\)/);

  const trigger = body(classification, "enforce_project_classification", "$classify$");
  assert.match(trigger, /security definer\nset search_path = ''/);
  assert.match(trigger, /old\.structure_family is not null\s+and new\.structure_family is distinct from old\.structure_family/);
  // The only way past the lock is a correction row written by THIS transaction.
  assert.match(trigger, /c\.transaction_id = pg_catalog\.pg_current_xact_id\(\)/);
  assert.match(trigger, /v_allows_custom and new\.project_category_detail is null/);
  assert.match(trigger, /not v_allows_custom and new\.project_category_detail is not null/);
  assert.match(classification, /revoke execute on function public\.enforce_project_classification\(\)\s+from public, anon, authenticated, service_role;/);
});

test("2C.1: correction audit table is append-only for ordinary users and read-scoped", () => {
  assert.match(topLevel, /constraint project_classification_corrections_reason_not_blank\s+check \(length\(btrim\(reason\)\) > 0\)/);
  assert.match(topLevel, /transaction_id\s+xid8 not null default pg_catalog\.pg_current_xact_id\(\)/);
  assert.match(topLevel, /alter table public\.project_classification_corrections enable row level security;/);
  assert.match(topLevel, /revoke all on public\.project_classification_corrections from public, anon, authenticated;/);
  assert.match(topLevel, /grant select on public\.project_classification_corrections to authenticated;/);
  const policies = [...topLevel.matchAll(/create policy [a-z_]+\s+on public\.project_classification_corrections\s+for (\w+)/g)].map((match) => match[1]);
  assert.deepEqual(policies, ["select"]);
  assert.match(topLevel, /for select to authenticated\s+using \(public\.can_manage_project_operations\(project_id\)\);/);
  assert.doesNotMatch(topLevel, /grant (?:insert|update|delete|all)[^;]*project_classification_corrections/i);
});

const CORRECTION_SIGNATURE = "uuid, timestamptz, text, uuid, text, text";
const correction = () => body(classification, "correct_project_structure_family", "$correct$");

test("2C.1 T4: correction runs admin -> reason -> target -> lock -> audit -> update, in that order", () => {
  const correct = correction();
  assert.match(correct, /security definer\nset search_path = ''/);
  assert.match(correct, /p_project uuid,\s+p_expected_updated_at timestamptz,\s+p_new_family text,\s+p_project_type_id uuid,\s+p_project_category_detail text,\s+p_reason text\s+\) returns timestamptz/);
  const steps = [
    "public.is_system_admin() is distinct from true", // 1. System Admin
    "v_reason := nullif(btrim(coalesce(p_reason, '')), '');", // 2. reason
    "if p_new_family = 'psm' then", // 3. target rules
    "pg_catalog.pg_advisory_xact_lock(190726, 1)", // 4. setup lock
    "for update", // project row lock
    "insert into public.project_classification_corrections", // 5. audit
    "update public.projects", // 6. project
  ].map((step) => correct.indexOf(step));
  for (const index of steps) assert.ok(index >= 0);
  assert.deepEqual([...steps].sort((a, b) => a - b), steps, "steps out of order");
  // Authority is re-checked after the lock, like every other setup writer.
  assert.equal([...correct.matchAll(/public\.is_system_admin\(\) is distinct from true/g)].length, 2);
  assert.doesNotMatch(correct, /exception\s+when|\bcommit\s*;|\brollback\s*;/i);
});

test("2C.1 T4: System Admin only; blank reason rejected; stale version rejected", () => {
  const correct = correction();
  assert.match(correct, /\[NOT_AUTHORIZED\][^']*' *\n? *using errcode = '42501'/);
  assert.match(correct, /if v_reason is null then\s+raise exception '\[REASON_REQUIRED\]/);
  assert.match(correct, /v_version is distinct from p_expected_updated_at then\s+raise exception '\[STALE\]/);
  assert.match(classification, new RegExp(`revoke execute on function public\\.correct_project_structure_family\\(${CORRECTION_SIGNATURE}\\)\\s+from public, anon;`));
  assert.match(classification, new RegExp(`grant execute on function public\\.correct_project_structure_family\\(${CORRECTION_SIGNATURE}\\)\\s+to authenticated;`));
  // Exactly one definition: the old three-argument form is gone.
  assert.equal([...classification.matchAll(/create function public\.correct_project_structure_family\(/g)].length, 1);
  assert.doesNotMatch(classification, /correct_project_structure_family\(uuid, text, text\)/);
});

test("2C.1 T4: Other -> PSM clears the Project Category and custom name", () => {
  const correct = correction();
  assert.match(correct, /if p_new_family = 'psm' then\s+-- A PSM project has no Project Category\.\s+if p_project_type_id is not null or v_detail_in is not null then\s+raise exception '\[INVALID_TARGET\]/);
  assert.match(correct, /set structure_family = p_new_family,\s+project_type_id = p_project_type_id,\s+project_category_detail = v_detail_in/);
  // The recorded target is valid by construction, too.
  assert.match(topLevel, /check \(new_family <> 'psm' or \(new_project_type_id is null and new_category_detail is null\)\)/);
});

test("2C.1 T4: PSM -> Other requires an active category, and its custom name when required", () => {
  const correct = correction();
  assert.match(correct, /if p_project_type_id is null then\s+raise exception '\[CATEGORY_REQUIRED\]/);
  assert.match(correct, /if not found or v_type_active is distinct from true then\s+raise exception '\[CATEGORY_INVALID\]/);
  assert.match(correct, /if v_allows_custom and v_detail_in is null then\s+raise exception '\[DETAIL_REQUIRED\]/);
  assert.match(correct, /if not v_allows_custom and v_detail_in is not null then\s+raise exception '\[DETAIL_NOT_ALLOWED\]/);
  assert.match(topLevel, /check \(new_family <> 'other' or new_project_type_id is not null\)/);
});

test("2C.1 T4: audit captures old/new family, category (id + name), custom name and actor", () => {
  for (const column of [
    "old_family", "new_family", "old_project_type_id", "new_project_type_id",
    "old_project_type_name", "new_project_type_name", "old_category_detail", "new_category_detail",
    "reason", "corrected_by", "corrected_by_name", "corrected_at", "transaction_id",
  ]) {
    assert.match(topLevel, new RegExp(`\\n  ${column} +[a-z0-9]+`), column);
  }
  const insert = correction().match(/insert into public\.project_classification_corrections \(([^)]+)\) values \(([\s\S]+?)\n  \);/);
  const columns = insert[1].split(",").map((part) => part.trim());
  const values = insert[2].split(",").map((part) => part.trim());
  assert.deepEqual(Object.fromEntries(columns.map((column, index) => [column, values[index]])), {
    project_id: "p_project", old_family: "v_old", new_family: "p_new_family",
    old_project_type_id: "v_old_type", new_project_type_id: "p_project_type_id",
    old_project_type_name: "v_old_type_name", new_project_type_name: "v_new_type_name",
    old_category_detail: "v_old_detail", new_category_detail: "v_detail_in",
    reason: "v_reason", corrected_by: "auth.uid()", corrected_by_name: "v_actor_name",
  });
  // History is immutable: no UPDATE for anyone, enforced by trigger.
  assert.match(topLevel, /before update on public\.project_classification_corrections\s+for each row execute function public\.prevent_classification_correction_update\(\)/);
  // No foreign keys from history to master data: history never blocks or follows it.
  assert.doesNotMatch(topLevel, /project_type_id +uuid references/);
});

test("2C.1: one database PSM-family rule, identical to the app's isPsmProjectType()", async () => {
  const helper = body(classification, "is_psm_family_project_type", "$psm_family$");
  assert.match(helper, /language sql\nimmutable\nset search_path = ''/);
  // Code decides when present; the name is only a fallback.
  assert.match(helper, /when nullif\(btrim\(coalesce\(p_code, ''\)\), ''\) is not null\s+then btrim\(p_code\) ~\* '\^\(PSM\|PSAIM\)\\y'\s+else coalesce\(p_name, ''\) ~\* 'process\\s\+safety'/);
  assert.match(classification, /revoke execute on function public\.is_psm_family_project_type\(text, text\) from public, anon;/);

  // Run the SQL patterns (POSIX \y = word boundary) against the same rows as
  // the TypeScript rule: they must agree on every one.
  const codePattern = new RegExp(helper.match(/~\* '(\^\(PSM\|PSAIM\)\\y)'/)[1].replace("\\y", "\\b"), "i");
  const namePattern = new RegExp(helper.match(/~\* '(process\\s\+safety)'/)[1], "i");
  const sqlRule = ({ code, name }) =>
    code?.trim() ? codePattern.test(code.trim()) : namePattern.test(name ?? "");
  const { isPsmProjectType } = await import("../../config/project-terminology.ts");
  const rows = [
    { code: "PSAIM-01", name: "x" }, { code: "PSM", name: "x" }, { code: "psm-02", name: "x" },
    { code: "AIM-01", name: "Process Safety" }, { code: "PSMX", name: "x" }, { code: "INSP", name: "Inspection" },
    { code: "  ", name: "Process  Safety Program" }, { name: "Asset Integrity" }, { code: "", name: "process safety" },
  ];
  for (const row of rows) assert.equal(sqlRule(row), isPsmProjectType({ ...row, id: "x", active: true }), JSON.stringify(row));
});

test("2C.1: normal save paths reject an Other project on a PSM-family or inactive category", () => {
  const trigger = body(classification, "enforce_project_classification", "$classify$");
  const other = trigger.slice(trigger.indexOf("if new.structure_family = 'other' then"));
  assert.match(other, /public\.is_psm_family_project_type\(pt\.code, pt\.name\)/);
  assert.match(other, /if v_type_found is distinct from true or v_type_active is distinct from true then\s+raise exception/);
  assert.match(other, /if v_type_psm then\s+raise exception 'An Other project cannot use a PSM \/ PSAIM Project Category\.'/);
  // Every write path reaches the trigger: it fires on any change to the
  // classification columns, whoever writes them.
  assert.match(topLevel, /before insert or update of structure_family, project_type_id, project_category_detail\s+on public\.projects\s+for each row/);
  // PSM stores no category at all; legacy NULL projects are untouched.
  assert.match(topLevel, /constraint projects_psm_has_no_category\s+check \(structure_family is distinct from 'psm' or project_type_id is null\)/);
  assert.match(topLevel, /check \(project_category_detail is null or structure_family = 'other'\)/);
});

test("2C.1: the System Admin correction rejects a PSM-family category before taking any lock", () => {
  const correct = correction();
  const psmCheck = correct.indexOf("[CATEGORY_PSM_FAMILY]");
  assert.ok(psmCheck > correct.indexOf("[CATEGORY_INVALID]"));
  assert.ok(psmCheck < correct.indexOf("pg_catalog.pg_advisory_xact_lock(190726, 1)"));
  assert.match(correct, /public\.is_psm_family_project_type\(pt\.code, pt\.name\)\s+into v_allows_custom, v_new_type_name, v_type_active, v_type_psm/);
  assert.match(correct, /if v_type_psm then\s+raise exception '\[CATEGORY_PSM_FAMILY\]/);
  // A valid non-PSM category still flows through to the update.
  assert.match(correct, /set structure_family = p_new_family,\s+project_type_id = p_project_type_id,/);
});

test("2C.1 T4: the set-once lock still refuses a direct family change without this transaction's audit row", () => {
  const trigger = body(classification, "enforce_project_classification", "$classify$");
  assert.match(trigger, /if not exists \(\s+select 1\s+from public\.project_classification_corrections c\s+where c\.project_id = new\.id\s+and c\.old_family = old\.structure_family\s+and c\.new_family is not distinct from new\.structure_family\s+and c\.transaction_id = pg_catalog\.pg_current_xact_id\(\)/);
  // Ordinary users can neither write audit rows nor reach a write policy.
  assert.match(topLevel, /revoke all on public\.project_classification_corrections from public, anon, authenticated;/);
  assert.doesNotMatch(topLevel, /create policy [a-z_]+\s+on public\.project_classification_corrections\s+for (?:insert|update|delete|all)/);
});

test("2C.1: patch RPC is the current body with only three more editable columns", () => {
  const current = body(atomic, "save_project_setup_patch", "$patch$");
  const updated = body(classification, "save_project_setup_patch", "$patch$");
  const stripAllowlist = (sql) => sql.replace(/v_columns constant text\[\] := array\[[\s\S]+?\];/, "v_columns := <allowlist>;");
  assert.equal(stripAllowlist(updated), stripAllowlist(current));
  assert.deepEqual(allowlistOf(updated), new Set([...allowlistOf(current), ...NEW_PATCH_COLUMNS]));
  assert.match(updated, /security invoker set search_path = ''/);
  assert.match(classification, /create or replace function public\.save_project_setup_patch\(\n  p_project uuid, p_expected_updated_at timestamptz, p_columns jsonb, p_relations jsonb\n\)/);
  assert.match(classification, /revoke execute on function public\.save_project_setup_patch\(uuid, timestamptz, jsonb, jsonb\) from public, anon;/);
  assert.match(classification, /grant execute on function public\.save_project_setup_patch\(uuid, timestamptz, jsonb, jsonb\) to authenticated;/);
});

test("2C.1: only UPDATE grants for the new patch columns; no read or anonymous widening", () => {
  const grants = [...topLevel.matchAll(/grant ([^;]+?) on public\.projects to ([a-z_, ]+);/g)];
  assert.equal(grants.length, 1);
  assert.equal(grants[0][2], "authenticated");
  const columns = grants[0][1].trim().match(/^update \(([^)]+)\)$/)[1].split(",").map((column) => column.trim());
  assert.deepEqual(new Set(columns), new Set(NEW_PATCH_COLUMNS));
  assert.doesNotMatch(topLevel, /^grant [^;]+ to (?:[a-z_, ]*\b)?(?:public|anon)\b/im);
  assert.doesNotMatch(topLevel, /\b(?:create|alter|drop) policy [a-z_]+\s+on public\.projects\b/i);
  assert.doesNotMatch(topLevel, /grant select[^;]+public\.projects/i);
});

test("2C.1: the mapper writes the three new columns only through key-presence set()", () => {
  const service = source("../../services/supabase-project-service.ts");
  const mapper = service.slice(service.indexOf("function flattenProject("), service.indexOf("/** Wizard-added"));
  assert.match(mapper, /set\("structure_family", "structureFamily", input\.structureFamily \?\? null\);/);
  assert.match(mapper, /set\("project_category_detail", "projectCategoryDetail", input\.projectCategoryDetail \?\? null\);/);
  assert.match(mapper, /set\("portfolio_group_id", "portfolioGroupId", input\.portfolioGroupId \?\? null\);/);
  assert.match(mapper, /if \(!\(key in input\)\) return;/);
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

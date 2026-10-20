import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { mapProjectTypeCorrectionError, PROJECT_TYPE_CORRECTION_MESSAGES } from "../../services/classification-correction.ts";

// Phase 2C.1c-a — SOURCE CONTRACTS ONLY for the Other Project structure
// migration: no PostgreSQL connection, migration execution or RLS test. The
// runtime behaviour is proved by scripts/p0-validation/110_runtime_2c1c_structure.sql.

const migrations = new URL("../../../supabase/migrations/", import.meta.url);
const read = (name) => readFileSync(new URL(name, migrations), "utf8").replaceAll("\r", "");
const STRUCTURE_FILE = "20261003000001_project_structure_foundation.sql";
const CLASSIFICATION_FILE = "20261001000001_project_setup_classification.sql";
const structure = read(STRUCTURE_FILE);
const classification = read(CLASSIFICATION_FILE);
const withoutComments = (sql) => sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
/** Only the top-level statements: comments and function bodies removed. */
const topLevel = withoutComments(structure).replace(/\$([a-z_]+)\$[\s\S]*?\$\1\$/g, "$$body$$");
const body = (sql, name, delimiter) => {
  const start = sql.indexOf(`function public.${name}(`);
  assert.ok(start >= 0, `no function public.${name}`);
  const finish = sql.indexOf(`\n${delimiter};`, start);
  assert.ok(finish > start, `no end of public.${name}`);
  return sql.slice(start, finish + delimiter.length + 2);
};
const table = (name) => {
  const match = topLevel.match(new RegExp(`create table public\\.${name} \\(([\\s\\S]+?)\\n\\);`));
  assert.ok(match, `no create table ${name}`);
  return match[1];
};
const columnsOf = (definition) =>
  definition.split("\n").map((line) => line.trim().match(/^([a-z_]+)\s+(?:uuid|integer|text|boolean|timestamptz)\b/)?.[1]).filter(Boolean);
const sortedSql = () => readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort();
const latestDefinition = (name) =>
  sortedSql().filter((file) => read(file).includes(`function public.${name}(`)).at(-1);

test("2C.1c-a: migration name is unique and sorts directly after the classification migration", () => {
  const files = readdirSync(migrations);
  assert.deepEqual(files.filter((name) => name.endsWith("_project_structure_foundation.sql")), [STRUCTURE_FILE]);
  assert.equal(files.filter((name) => name.startsWith("20261003000001")).length, 1);
  const sorted = sortedSql();
  assert.equal(sorted.indexOf(STRUCTURE_FILE), sorted.indexOf(CLASSIFICATION_FILE) + 1);
});

test("2C.1c-a: both project-owned tables exist with exactly the approved columns", () => {
  assert.deepEqual(columnsOf(table("project_structure_levels")), [
    "id", "project_id", "level_number", "singular_label", "plural_label",
    "singular_label_key", "plural_label_key", "created_at", "updated_at",
  ]);
  assert.deepEqual(columnsOf(table("project_structure_nodes")), [
    "id", "project_id", "level_number", "parent_id", "name", "code", "description", "sort_order",
    "weekly_reporting_required", "monthly_reporting_required", "archived_at", "created_at", "updated_at",
  ]);
  for (const name of ["project_structure_levels", "project_structure_nodes"]) {
    assert.match(table(name), /project_id\s+uuid not null references public\.projects\(id\) on delete cascade/);
  }
  const nodes = table("project_structure_nodes");
  assert.match(nodes, /weekly_reporting_required\s+boolean not null default false/);
  assert.match(nodes, /monthly_reporting_required\s+boolean not null default false/);
  assert.match(nodes, /sort_order\s+integer not null default 0/);
});

test("2C.1c-a: levels are 1..4, unique per project, trimmed labels of at most 60, case-insensitively unique", () => {
  const levels = table("project_structure_levels");
  assert.match(levels, /check \(level_number between 1 and 4\)/);
  assert.match(levels, /unique \(project_id, level_number\)/);
  for (const label of ["singular_label", "plural_label"]) {
    assert.match(levels, new RegExp(`check \\(${label} = btrim\\(${label}\\) and length\\(${label}\\) between 1 and 60\\)`));
    assert.match(levels, new RegExp(`${label}_key\\s+text generated always as \\(lower\\(${label}\\)\\) stored`));
    assert.match(levels, new RegExp(`unique \\(project_id, ${label}_key\\) deferrable initially immediate`));
  }
});

test("2C.1c-a: contiguity is a statement-end constraint trigger over the whole level set", () => {
  const check = body(structure, "check_project_structure_levels", "$levels_check$");
  assert.match(check, /select count\(\*\), coalesce\(max\(l\.level_number\), 0\)/);
  assert.match(check, /if v_count <> v_max then\s+raise exception '\[LEVEL_GAP\]/);
  assert.match(topLevel, /create constraint trigger check_project_structure_levels\s+after insert or update or delete on public\.project_structure_levels\s+deferrable initially immediate\s+for each row/);
});

test("2C.1c-a: nodes use same-project composite references for their level and parent", () => {
  const nodes = table("project_structure_nodes");
  assert.match(nodes, /constraint project_structure_nodes_id_project_unique unique \(id, project_id\)/);
  assert.match(nodes, /foreign key \(project_id, level_number\)\s+references public\.project_structure_levels \(project_id, level_number\)\s*,/);
  assert.match(nodes, /foreign key \(parent_id, project_id\)\s+references public\.project_structure_nodes \(id, project_id\)\s*,/);
  // NO ACTION (the default): no ON DELETE clause, so a level or parent that is
  // still used can never be removed, and deleting a project still cascades.
  assert.doesNotMatch(nodes, /references public\.project_structure_(?:levels|nodes) \([^)]+\)\s+on delete/);
  assert.match(nodes, /check \(\(level_number = 1\) = \(parent_id is null\)\)/);
  assert.match(nodes, /check \(archived_at is null\s+or \(not weekly_reporting_required and not monthly_reporting_required\)\)/);
});

test("2C.1c-a: active sibling names and active project codes are unique, case-insensitively", () => {
  assert.match(topLevel, /create unique index project_structure_nodes_active_sibling_name_unique\s+on public\.project_structure_nodes \(project_id, parent_id, lower\(name\)\)\s+nulls not distinct\s+where archived_at is null;/);
  assert.match(topLevel, /create unique index project_structure_nodes_active_code_unique\s+on public\.project_structure_nodes \(project_id, upper\(code\)\)\s+where archived_at is null and code is not null;/);
});

test("2C.1c-a: cross-row node rules — parent level, active parent, archived children, no nested overlap", () => {
  const check = body(structure, "check_project_structure_node", "$node_check$");
  assert.match(check, /if v_parent_level is distinct from r\.level_number - 1 then\s+raise exception '\[PARENT_LEVEL\]/);
  assert.match(check, /if r\.archived_at is null and v_parent_arch is not null then\s+raise exception '\[PARENT_ARCHIVED\]/);
  assert.match(check, /c\.parent_id = r\.id and c\.archived_at is null[\s\S]+?raise exception '\[ACTIVE_CHILDREN\]/);
  assert.match(check, /\(v_anc_weekly and \(r\.weekly_reporting_required or v_desc_weekly\)\)\s+or \(r\.weekly_reporting_required and v_desc_weekly\)/);
  assert.match(check, /\(v_anc_monthly and \(r\.monthly_reporting_required or v_desc_monthly\)\)\s+or \(r\.monthly_reporting_required and v_desc_monthly\)/);
  assert.equal((check.match(/\[REPORTING_OVERLAP\]/g) ?? []).length, 2);
  // Re-reads the row's final state at the end of the statement.
  assert.match(check, /select \* into r from public\.project_structure_nodes n where n\.id = new\.id;/);
  assert.match(topLevel, /create constraint trigger check_project_structure_node\s+after insert or update on public\.project_structure_nodes\s+deferrable initially immediate\s+for each row/);
});

test("2C.1c-a: every write path is Other-only, archived-project safe and keeps level identity", () => {
  const guard = body(structure, "guard_project_structure_write", "$guard$");
  assert.match(guard, /if public\.project_is_archived\(v_project\) then\s+raise exception '\[PROJECT_ARCHIVED\]/);
  assert.match(guard, /if tg_op in \('INSERT', 'UPDATE'\) then[\s\S]+?if v_family is distinct from 'other' then\s+raise exception '\[NOT_OTHER\]/);
  assert.match(guard, /new\.level_number is distinct from old\.level_number[\s\S]+?\[LEVEL_IMMUTABLE\]/);
  for (const name of ["project_structure_levels", "project_structure_nodes"]) {
    assert.match(topLevel, new RegExp(`create trigger guard_project_structure_write\\s+before insert or update or delete on public\\.${name}\\s+for each row execute function public\\.guard_project_structure_write\\(\\);`));
    assert.match(topLevel, new RegExp(`create trigger set_updated_at before update on public\\.${name}`));
  }
  // The existing setup lock and version protocol, attached unchanged.
  assert.match(structure, /foreach v_table in array array\['project_structure_levels', 'project_structure_nodes'\] loop/);
  assert.match(structure, /execute function public\.lock_project_setup_statement\(\)', v_table\);/);
  assert.match(structure, /execute function public\.invalidate_setup_project_version\(\)', v_table\);/);
  assert.doesNotMatch(topLevel, /create (?:or replace )?function public\.(?:lock_project_setup_statement|invalidate_setup_project_version|project_is_archived|can_manage_project_setup)\b/);
});

test("2C.1c-a: RLS on both tables; reads never exceed project visibility, writes use the existing setup authority only", () => {
  for (const name of ["project_structure_levels", "project_structure_nodes"]) {
    assert.match(topLevel, new RegExp(`alter table public\\.${name} enable row level security;`));
    const policies = [...topLevel.matchAll(new RegExp(`create policy (\\w+) on public\\.${name}\\s+for (\\w+) to authenticated\\s*([^;]*);`, "g"))];
    assert.deepEqual(policies.map((match) => match[2]), ["select", "insert", "update", "delete"]);
    // Visible exactly when the project row is visible to the reader, through
    // the projects table's own RLS — never a blanket true.
    assert.equal(policies[0][3], `using (exists (select 1 from public.projects p where p.id = ${name}.project_id))`);
    assert.doesNotMatch(policies[0][3], /using \(true\)/);
    for (const [, , , clause] of policies.slice(1)) {
      const predicates = [...clause.matchAll(/public\.(\w+)\(/g)].map((match) => match[1]);
      assert.ok(predicates.length > 0);
      assert.deepEqual([...new Set(predicates)], ["can_manage_project_setup"]);
      assert.doesNotMatch(clause, /\btrue\b/);
    }
  }
});

test("2C.1c-a: grants go to authenticated only; nothing to anon or public", () => {
  assert.doesNotMatch(topLevel, /^grant [^;]+ to [^;]*\b(?:public|anon)\b/im);
  for (const name of ["project_structure_levels", "project_structure_nodes"]) {
    // Bounded ACL: everything is cleared for authenticated too (no inherited
    // TRUNCATE / REFERENCES / TRIGGER), then only row-level DML is granted.
    const revoke = topLevel.indexOf(`revoke all on public.${name} from public, anon, authenticated;`);
    const grant = topLevel.indexOf(`grant select, insert, update, delete on public.${name} to authenticated;`);
    assert.ok(revoke >= 0 && grant > revoke, name);
    const grants = [...topLevel.matchAll(new RegExp(`grant ([^;]+?) on public\\.${name} to`, "g"))].map((match) => match[1]);
    assert.deepEqual(grants, ["select, insert, update, delete"], name);
  }
  assert.doesNotMatch(topLevel, /grant[^;]*\b(?:truncate|references|trigger|all)\b[^;]*on public\.project_structure_/i);
  // The migration proves the bounded ACL on the real database before it commits.
  assert.match(structure, /has_table_privilege\('authenticated', 'public\.project_structure_levels', 'truncate, references, trigger'\)/);
  assert.match(structure, /has_table_privilege\('authenticated', 'public\.project_structure_nodes', 'truncate, references, trigger'\)/);
  for (const fn of ["guard_project_structure_write", "check_project_structure_levels", "check_project_structure_node"]) {
    assert.match(topLevel, new RegExp(`revoke execute on function public\\.${fn}\\(\\)\\s+from public, anon, authenticated, service_role;`));
  }
  assert.match(topLevel, /revoke execute on function public\.configure_project_structure_levels\(uuid, timestamptz, jsonb\)\s+from public, anon;/);
  assert.match(topLevel, /grant execute on function public\.configure_project_structure_levels\(uuid, timestamptz, jsonb\)\s+to authenticated;/);
  // Every security-definer function pins an empty search_path.
  const definers = [...structure.matchAll(/security definer\n([^\n]+)/g)].map((match) => match[1]);
  assert.ok(definers.length >= 4);
  for (const next of definers) assert.equal(next, "set search_path = ''");
});

test("2C.1c-a: the level RPC is invoker, locked, versioned, Other-only and tagged", () => {
  const rpc = body(structure, "configure_project_structure_levels", "$configure$");
  assert.match(rpc, /\) returns timestamptz\nlanguage plpgsql\nsecurity invoker\nset search_path = ''/);
  const lock = rpc.indexOf("pg_catalog.pg_advisory_xact_lock(190726, 1)");
  assert.ok(lock > 0);
  const authority = /public\.can_manage_project_setup\(p_project\) is distinct from true then\s+raise exception '\[NOT_AUTHORIZED\]/g;
  const checks = [...rpc.matchAll(authority)].map((match) => match.index);
  assert.equal(checks.length, 2);
  assert.ok(checks[0] < lock && checks[1] > lock, "authority is checked before and after the lock");
  assert.match(rpc, /from public\.projects p\s+where p\.id = p_project\s+for update;/);
  assert.match(rpc, /if v_version is distinct from p_expected_updated_at then\s+raise exception '\[STALE\]/);
  assert.match(rpc, /if v_family is distinct from 'other' then\s+raise exception '\[NOT_OTHER\]/);
  assert.match(rpc, /if v_status = 'archived' then\s+raise exception '\[PROJECT_ARCHIVED\]/);
  // Strict JSON types: labels are strings, the level number is a number.
  assert.match(rpc, /jsonb_typeof\(e -> 'level_number'\) is distinct from 'number'/);
  assert.match(rpc, /jsonb_typeof\(e -> 'singular_label'\) is distinct from 'string'/);
  assert.match(rpc, /jsonb_typeof\(e -> 'plural_label'\) is distinct from 'string'/);
  for (const tag of ["INVALID_LEVELS", "LEVEL_LIMIT", "LEVEL_GAP", "DUPLICATE_LABEL", "LEVEL_IN_USE", "NOT_FOUND"]) {
    assert.match(rpc, new RegExp(`raise exception '\\[${tag}\\]`), tag);
  }
  // Once units exist: rename in place only, append only, remove only unused deepest levels.
  assert.match(rpc, /if v_units > 0 then/);
  assert.match(rpc, /lower\(e ->> 'id'\) is distinct from l\.id::text/);
  assert.match(rpc, /n\.project_id = p_project and n\.level_number > v_count/);
  // Label swaps are checked after every row is written.
  assert.match(rpc, /set constraints public\.project_structure_levels_singular_key_unique,\s+public\.project_structure_levels_plural_key_unique deferred;[\s\S]+set constraints public\.project_structure_levels_singular_key_unique,\s+public\.project_structure_levels_plural_key_unique immediate;/);
  assert.doesNotMatch(rpc, /project_structure_nodes[^;]*\b(?:insert|update|delete)\b/i);
});

test("2C.1c-a: the correction RPC is unchanged except the Other -> PSM structure guard", () => {
  // Live definition: re-created by the PT409 migration with only the stale
  // SQLSTATE changed (proved in stale-sqlstate-contract.test.mjs), then by
  // 13.9B Step 2 for the one-time legacy classification bootstrap (owner
  // closure 2026-10-17, proved in reported-progress.test.mjs). The live body
  // still carries this 4b guard in the same place.
  const STEP2 = "20261017090000_project_setup_finalise_reported_progress.sql";
  assert.equal(latestDefinition("correct_project_structure_family"), STEP2);
  const liveSql = readFileSync(new URL(`../../../supabase/migrations/${STEP2}`, import.meta.url), "utf8").replaceAll("\r", "");
  const live = liveSql.slice(liveSql.indexOf("create or replace function public.correct_project_structure_family("),
    liveSql.indexOf("$function$;", liveSql.indexOf("create or replace function public.correct_project_structure_family(")));
  assert.match(live, /if v_old = 'other' and p_new_family = 'psm' and exists \(\s+select 1 from public\.project_structure_nodes n\s+where n\.project_id = p_project and n\.archived_at is null\s+\) then\s+raise exception '\[STRUCTURE_EXISTS\]/);
  assert.ok(live.indexOf("[STRUCTURE_EXISTS]") > live.indexOf("[SAME_TYPE]"));
  assert.ok(live.indexOf("[STRUCTURE_EXISTS]") < live.indexOf("insert into public.project_classification_corrections"));
  const before = body(classification, "correct_project_structure_family", "$correct$");
  const after = body(structure, "correct_project_structure_family", "$correct$");
  const guard = after.match(/\n  -- 4b\. \(2C\.1c\)[\s\S]+?\n  end if;\n/);
  assert.ok(guard, "the 4b guard block exists");
  assert.equal(after.replace(guard[0], ""), before);
  assert.match(guard[0], /if v_old = 'other' and p_new_family = 'psm' and exists \(\s+select 1 from public\.project_structure_nodes n\s+where n\.project_id = p_project and n\.archived_at is null\s+\) then\s+raise exception '\[STRUCTURE_EXISTS\]/);
  // Inside the lock, after the version check, before the audit row is written.
  assert.ok(after.indexOf("[STRUCTURE_EXISTS]") > after.indexOf("[SAME_TYPE]"));
  assert.ok(after.indexOf("[STRUCTURE_EXISTS]") < after.indexOf("insert into public.project_classification_corrections"));
  assert.match(topLevel, /revoke execute on function public\.correct_project_structure_family\(uuid, timestamptz, text, uuid, text, text\)\s+from public, anon;/);
  assert.match(topLevel, /grant execute on function public\.correct_project_structure_family\(uuid, timestamptz, text, uuid, text, text\)\s+to authenticated;/);
});

test("2C.1c-a: the application maps [STRUCTURE_EXISTS] to fixed wording", () => {
  const mapped = mapProjectTypeCorrectionError({ message: "[STRUCTURE_EXISTS] raw database text", code: "23514" });
  assert.equal(mapped.reason, "structure_exists");
  assert.equal(mapped.message, PROJECT_TYPE_CORRECTION_MESSAGES.structure_exists);
  assert.doesNotMatch(mapped.message, /raw database text/);
});

test("2C.1c-a: the Project Setup patch, PSM hierarchy, reporting and planning are untouched", () => {
  assert.equal(latestDefinition("save_project_setup_patch"), "20261004000001_stale_conflict_sqlstate_pt409.sql");
  assert.doesNotMatch(structure, /save_project_setup_patch/);
  const untouched = [
    "departments", "systems", "disciplines", "project_departments", "project_disciplines",
    "project_contacts", "project_positions", "project_types", "weekly_[a-z_]+", "monthly_[a-z_]+",
    "planning_[a-z_]+", "master_milestones", "master_deliverables",
  ];
  // The correction RPC is re-created whole and legitimately reads project_types;
  // everything else in the migration must not reference these tables at all.
  const correctionBody = body(structure, "correct_project_structure_family", "$correct$");
  const ownCode = withoutComments(structure.replace(correctionBody, ""));
  for (const name of untouched) {
    assert.doesNotMatch(ownCode, new RegExp(`public\\.${name}\\b`), name);
  }
  assert.doesNotMatch(structure, /structure_node_id/);
  assert.doesNotMatch(topLevel, /\balter table public\.(?!project_structure_)/i);
});

test("2C.1c-a: no backfill, no demo data, no seeded levels", () => {
  assert.doesNotMatch(topLevel, /\binsert\s+into\b/i);
  assert.doesNotMatch(topLevel, /\bupdate\s+public\./i);
  assert.doesNotMatch(topLevel, /\bdelete\s+from\b/i);
});

test("2C.1c-a: the flags mean operational input, not a consolidated-review role", () => {
  assert.match(structure, /comment on column public\.project_structure_nodes\.weekly_reporting_required is\s+'This unit owes Weekly OPERATIONAL INPUT\. Not a consolidated-review or management roll-up responsibility\./);
  assert.match(structure, /comment on column public\.project_structure_nodes\.monthly_reporting_required is\s+'This unit owes Monthly OPERATIONAL INPUT\./);
});

test("2C.1c-a: the project visibility that structure reads follow is today's projects_select", () => {
  // The structure SELECT policies delegate to the projects table's own RLS. This
  // pins what that means right now, so a future change to projects_select is a
  // visible, reviewed change to structure visibility too.
  const definitions = sortedSql().flatMap((file) =>
    [...read(file).matchAll(/(?:alter|create) policy projects_select on public\.projects\s+(?:for select to authenticated\s+)?using \(([^;]+)\);/g)]
      .map((match) => ({ file, using: match[1].replace(/\s+/g, " ").trim() })));
  assert.deepEqual(definitions.at(-1), {
    file: "20260912000003_portfolio_read_entitlements.sql",
    using: "public.can_access_project(id) or public.has_published_portfolio_read()",
  });
  assert.doesNotMatch(structure, /policy projects_select/);
});

/* ------------------------- runtime rehearsal script 110 ------------------------- */

const script = readFileSync(new URL("../../../scripts/p0-validation/110_runtime_2c1c_structure.sql", import.meta.url), "utf8").replaceAll("\r", "");
const scriptCode = script.replace(/^--[^\n]*$/gm, "");

test("2C.1c-a: script 110 fails closed before any fixture is created", () => {
  assert.ok(scriptCode.split("\n").includes(String.raw`\set ON_ERROR_STOP on`));
  assert.doesNotMatch(scriptCode, /ON_ERROR_STOP off/);
  const guard = scriptCode.indexOf("do $guard$");
  const begin = scriptCode.search(/^begin;$/m);
  assert.ok(guard > 0 && begin > guard, "the target guard runs before BEGIN");
  assert.equal(scriptCode.slice(0, begin).search(/\b(?:insert into|update public\.|delete from)\b/i), -1, "nothing is written before BEGIN");
  // Explicit invocation, then the connection itself must prove it is the main local cluster.
  assert.ok(scriptCode.includes(String.raw`\if :{?rehearsal_target}`));
  assert.ok(scriptCode.includes(String.raw`\if :{?expected_cluster}`));
  // The missing-variable branches raise (exit under ON_ERROR_STOP) rather than quit quietly.
  assert.equal((scriptCode.match(/do \$refuse\$ begin raise exception 'REFUSING TO RUN: [a-z_]+ is not set\.'; end \$refuse\$;/g) ?? []).length, 2);
  assert.doesNotMatch(scriptCode, /\\quit/);
  const checks = scriptCode.slice(guard, begin);
  assert.match(checks, /current_setting\('eprp\.rehearsal_target'\) <> 'eprp-main-local'/);
  assert.match(checks, /host\(inet_server_addr\(\)\) not in \('127\.0\.0\.1', '::1'\)/);
  assert.match(checks, /select system_identifier::text into v_cluster from pg_catalog\.pg_control_system\(\)/);
  assert.match(checks, /v_cluster is distinct from current_setting\('eprp\.expected_cluster'\)/);
  assert.match(checks, /to_regclass\('public\.project_structure_nodes'\) is null/);
  assert.match(checks, /email like '%@example\.invalid'/);
  assert.match(checks, /2C\.1c fixture rows already exist/);
  // Every refusal raises (ending psql under ON_ERROR_STOP); none just warns.
  assert.doesNotMatch(checks, /raise (?:notice|warning)/i);
  // No credentials and no hosted project reference anywhere in the script.
  assert.doesNotMatch(script, /password\s*=|PGPASSWORD|pooler\.supabase\.com|supabase\.co\b/i);
});

test("2C.1c-a: script 110 resolves fixture ids before switching identity", () => {
  assert.match(scriptCode, /create temp table fx\(code text primary key, id uuid not null\) on commit drop;/);
  assert.match(scriptCode, /create or replace function pg_temp\.pid\(p_code text\) returns uuid language sql as \$\$\n  select id from fx where code = p_code/);
  // In every block that switches identity, ids are taken in DECLARE (which runs
  // as postgres, before the switch), never resolved afterwards through RLS.
  const switched = [];
  for (const block of scriptCode.matchAll(/do \$(\w+)\$\ndeclare([\s\S]+?)\nbegin\n([\s\S]+?)\nend \$\1\$;/g)) {
    const [, name, declarations, statements] = block;
    if (!statements.includes("set local role authenticated")) continue;
    switched.push(name);
    const afterSwitch = statements.slice(statements.indexOf("set local request.jwt.claims"));
    assert.doesNotMatch(afterSwitch, /pg_temp\.(?:nid|lid)\(/, `${name} resolves a node or level id after switching identity`);
    assert.match(declarations, /pg_temp\.pid\(/, name);
  }
  assert.deepEqual(switched, ["outsider", "pcm", "admin", "admin2"]);
  // Authorization refusals assert the RLS SQLSTATE or the RPC tag, not "any error".
  assert.match(scriptCode, /'inserting a unit is refused by RLS',[\s\S]+?'42501'\);/);
  assert.match(scriptCode, /'inserting a unit there is refused by RLS',[\s\S]+?'42501'\);/);
  assert.match(scriptCode, /'the level RPC there is refused',[\s\S]+?'\[NOT_AUTHORIZED\]'\);/);
  assert.doesNotMatch(scriptCode, /pg_temp\.must_fail\(/);
});

test("2C.1c-a: script 110 covers the runtime-sensitive cases", () => {
  for (const area of [
    "17 NOT A MANAGER", "18 PCM ALLOWED", "24 PCM UNASSIGNED", "25 MULTI-ROW", "26 MULTI-ROW FLAGS",
    "27 SUBTREE MOVE", "28 LEVELS IN USE", "29 VERSION", "30 CASCADE", "21 CORRECTION GUARD", "22 CORRECTION GUARD",
  ]) {
    assert.match(scriptCode, new RegExp(`'${area}'`), area);
  }
  assert.match(scriptCode, /RPC: appending a deeper level while units exist is accepted/);
  assert.match(scriptCode, /RPC: removing the deepest UNUSED level while units exist is accepted/);
  assert.match(scriptCode, /delete from public\.projects where id = %L/);
  // Rollback proof covers every kind of fixture row.
  const tail = scriptCode.slice(scriptCode.lastIndexOf("rollback;"));
  for (const table of ["public.projects", "public.project_types", "public.contacts", "public.profiles", "auth.users", "public.project_structure_nodes", "public.project_structure_levels"]) {
    assert.ok(tail.includes(table), table);
  }
});

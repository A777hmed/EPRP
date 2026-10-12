import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

// Phase 2C.3D Wave 1 — SOURCE CONTRACTS for
// 20261012100000_structure_responsibilities.sql. No database connection here:
// runtime behaviour is proved by
// scripts/p0-validation/116_runtime_2c3d_structure_responsibilities.sql and
// the landing data by 115_preflight_2c3d_structure_responsibilities.sql.

const migrations = new URL("../../../supabase/migrations/", import.meta.url);
const scripts = new URL("../../../scripts/p0-validation/", import.meta.url);
const read = (dir, name) => readFileSync(new URL(name, dir), "utf8").replaceAll("\r", "");
const FILE = "20261012100000_structure_responsibilities.sql";
const sql = read(migrations, FILE);
const code = sql.replace(/--[^\n]*/g, "");
/** Top-level statements only: function bodies collapsed. */
const topLevel = code.replace(/\$([a-z_]+)\$[\s\S]*?\$\1\$/g, "$$body$$");
const sorted = () => readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort();
const at = (needle, text = code) => {
  const index = text.indexOf(needle);
  assert.ok(index >= 0, `missing: ${needle}`);
  return index;
};
const tableBody = (name) => {
  const match = topLevel.match(new RegExp(`create table public\\.${name} \\(([\\s\\S]+?)\\n\\);`));
  assert.ok(match, `no create table ${name}`);
  return match[1];
};
const columnsOf = (definition) =>
  definition.split("\n").map((line) => line.trim().match(/^([a-z_]+)\s+(?:uuid|text|timestamptz)\b/)?.[1]).filter(Boolean);
const fnBody = (name) => {
  const start = at(`create function public.${name}(`);
  const open = code.slice(start).match(/\bas\s+(\$\w*\$)/);
  const close = code.indexOf(open[1], start + open.index + open[0].length);
  return code.slice(start, close + open[1].length);
};
const UNIT = "project_structure_unit_members";
const REPORT = "project_structure_report_responsibilities";

test("2C.3D is one additive migration after the 2C.3C finalization", () => {
  const files = sorted();
  assert.equal(files.indexOf(FILE), files.indexOf("20261011090000_project_team_controlled_writes.sql") + 1);
  assert.equal(files.filter((name) => name.startsWith("20261012100000")).length, 1);
  // Additive: no existing function is redefined and no existing table altered.
  assert.doesNotMatch(code, /create or replace function/);
  assert.doesNotMatch(code, /alter table public\.(project_contacts|project_delegations|projects|project_members|project_structure_nodes|project_structure_levels|project_parties)\b/);
  assert.doesNotMatch(code, /project_contacts|project_delegations|replace_project_responsibility|project_responsibility_history/);
});

test("both tables have exactly the approved columns; ended_at is the only lifecycle field", () => {
  assert.deepEqual(columnsOf(tableBody(UNIT)), [
    "id", "project_id", "node_id", "member_id", "unit_role", "ended_at", "created_by", "created_at", "updated_at",
  ]);
  assert.deepEqual(columnsOf(tableBody(REPORT)), [
    "id", "project_id", "node_id", "member_id", "unit_member_id", "report_kind", "responsibility",
    "ended_at", "created_by", "created_at", "updated_at",
  ]);
  for (const name of [UNIT, REPORT]) {
    const body = tableBody(name);
    assert.doesNotMatch(body, /\bstatus\b|\bactive\s+boolean/, name);
    assert.match(body, /project_id\s+uuid not null references public\.projects\(id\) on delete cascade/, name);
    assert.match(body, /check \(ended_at is null or ended_at >= created_at\)/, name);
  }
  assert.match(tableBody(UNIT), /check \(unit_role in \('member', 'lead'\)\)/);
  assert.match(tableBody(REPORT), /check \(report_kind in \('weekly', 'monthly'\)\)/);
  assert.match(tableBody(REPORT), /check \(responsibility in \('responsible', 'backup'\)\)/);
});

test("same-project integrity is composite-key enforced; responsibilities hang on the same unit's member row", () => {
  const unit = tableBody(UNIT);
  assert.match(unit, /foreign key \(node_id, project_id\)\s+references public\.project_structure_nodes \(id, project_id\)/);
  assert.match(unit, /foreign key \(project_id, member_id\)\s+references public\.project_members \(project_id, id\)/);
  assert.match(unit, /unique \(id, project_id, node_id, member_id\)/);
  assert.doesNotMatch(unit, /on delete cascade\s*,?\s*\n\s*constraint project_structure_unit_members_node/, "unit delete never cascades");
  const report = tableBody(REPORT);
  assert.match(report, /foreign key \(unit_member_id, project_id, node_id, member_id\)\s+references public\.project_structure_unit_members \(id, project_id, node_id, member_id\)/);
});

test("unique indexes: one active member row per person, one active Lead, one Responsible / Backup, distinct people", () => {
  assert.match(code, /create unique index project_structure_unit_members_one_active\s+on public\.project_structure_unit_members \(node_id, member_id, unit_role\)\s+where ended_at is null;/);
  assert.match(code, /create unique index project_structure_unit_members_one_lead\s+on public\.project_structure_unit_members \(node_id\)\s+where unit_role = 'lead' and ended_at is null;/);
  assert.match(code, /create unique index project_structure_report_responsibilities_one_active\s+on public\.project_structure_report_responsibilities \(node_id, report_kind, responsibility\)\s+where ended_at is null;/);
  assert.match(code, /create unique index project_structure_report_responsibilities_distinct_people\s+on public\.project_structure_report_responsibilities \(node_id, report_kind, member_id\)\s+where ended_at is null;/);
});

test("every guard is a new hardened trigger function; the 2C.1c and 2C.3C guards are not edited", () => {
  for (const name of ["guard_structure_unit_member_write", "guard_structure_report_responsibility_write",
    "check_structure_report_backup", "guard_structure_node_people", "guard_project_member_unit_assignments"]) {
    assert.match(code, new RegExp(`create function public\\.${name}\\(\\) returns trigger\\s+language plpgsql security definer set search_path = ''`), name);
    assert.match(code, new RegExp(`revoke execute on function public\\.${name}\\(\\) from public, anon, authenticated, service_role;`), name);
  }
  assert.doesNotMatch(code, /function public\.(guard_project_member_write|guard_project_structure_write|check_project_structure_node)\(/);
  assert.match(code, /create trigger guard_structure_node_people\s+before update or delete on public\.project_structure_nodes/);
  assert.match(code, /create trigger guard_project_member_unit_assignments\s+before update on public\.project_members/);
  assert.match(code, /create constraint trigger check_structure_report_backup\s+after insert or update on public\.project_structure_report_responsibilities\s+deferrable initially deferred/);
  for (const table of [UNIT, REPORT]) {
    assert.match(code, new RegExp(`before insert or update or delete on public\\.${table}\\s+for each row execute function public\\.guard_`), table);
  }
  assert.match(code, /foreach v_table in array array\['project_structure_unit_members', 'project_structure_report_responsibilities'\] loop\s+execute format\('create trigger lock_project_setup_statement[\s\S]+?invalidate_setup_project_version[\s\S]+?set_updated_at/);
});

test("every approved refusal is an explicit tagged guard (never a silent cascade or a raw FK error)", () => {
  const tags = {
    MEMBER_HAS_UNIT_ASSIGNMENTS: "guard_project_member_unit_assignments",
    MEMBER_HAS_UNIT_RESPONSIBILITY: "guard_project_member_unit_assignments",
    UNIT_MEMBER_IS_LEAD: "guard_structure_unit_member_write",
    UNIT_MEMBER_HAS_RESPONSIBILITY: "guard_structure_unit_member_write",
    UNIT_HAS_ACTIVE_PEOPLE: "guard_structure_node_people",
    WEEKLY_RESPONSIBILITY_EXISTS: "guard_structure_node_people",
    MONTHLY_RESPONSIBILITY_EXISTS: "guard_structure_node_people",
    UNIT_HAS_PEOPLE_HISTORY: "guard_structure_node_people",
    BACKUP_WITHOUT_RESPONSIBLE: "guard_structure_report_responsibility_write",
    SAME_PERSON: "guard_structure_report_responsibility_write",
    MEMBERSHIP_INCOMPLETE: "guard_structure_report_responsibility_write",
    RESPONSIBLE_NOT_UNIT_MEMBER: "guard_structure_report_responsibility_write",
    UNIT_NOT_REPORTING: "guard_structure_report_responsibility_write",
    LEAD_NOT_UNIT_MEMBER: "guard_structure_unit_member_write",
    MEMBER_NOT_ACTIVE: "guard_structure_unit_member_write",
    UNIT_NOT_FOUND: "guard_structure_unit_member_write",
    UNIT_ARCHIVED: "guard_structure_unit_member_write",
    PROJECT_ARCHIVED: "guard_structure_unit_member_write",
    NOT_OTHER: "guard_structure_unit_member_write",
    ASSIGNMENT_ENDED: "guard_structure_unit_member_write",
    ASSIGNMENT_IMMUTABLE: "guard_structure_unit_member_write",
    ASSIGNMENT_HISTORY_PRESERVED: "guard_structure_unit_member_write",
    ASSIGNMENT_MUST_START_ACTIVE: "guard_structure_unit_member_write",
  };
  for (const [tag, fn] of Object.entries(tags)) assert.match(fnBody(fn), new RegExp(`\\[${tag}\\]`), `${fn}: ${tag}`);
  // The Lead's accountability needs a complete membership, in the guard too.
  assert.match(fnBody("guard_structure_unit_member_write"), /new\.unit_role = 'lead' then\s+if v_party is null or v_role is null then\s+raise exception '\[MEMBERSHIP_INCOMPLETE\]/);
  // The deferred Backup rule re-checks the unit + report at commit.
  assert.match(fnBody("check_structure_report_backup"), /\[BACKUP_WITHOUT_RESPONSIBLE\]/);
  // Nothing is auto-ended by another table's change.
  for (const fn of ["guard_structure_node_people", "guard_project_member_unit_assignments"]) {
    assert.doesNotMatch(fnBody(fn), /\bupdate public\.|\bdelete from public\./, `${fn} only refuses`);
  }
});

test("least privilege: RLS on, SELECT only for authenticated, no write policy, no DELETE for anyone", () => {
  for (const table of [UNIT, REPORT]) {
    assert.match(code, new RegExp(`alter table public\\.${table} enable row level security;`), table);
    assert.match(code, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated, service_role;`), table);
    assert.match(code, new RegExp(`grant select on table public\\.${table} to authenticated, service_role;`), table);
    assert.match(code, new RegExp(`create policy ${table}_select on public\\.${table}\\s+for select to authenticated\\s+using \\(exists \\(select 1 from public\\.projects p where p\\.id = ${table}\\.project_id\\)\\);`), table);
  }
  assert.doesNotMatch(topLevel, /grant[^;]*\b(insert|update|delete|truncate)\b[^;]*project_structure_(unit_members|report_responsibilities)/i);
  assert.doesNotMatch(topLevel, /create policy \w+ on public\.project_structure_(unit_members|report_responsibilities)\s+for (insert|update|delete|all)/);
});

test("the writer: hardened definer, authority first, archived refusal, setup lock, re-check, PT409, Other only", () => {
  const writer = fnBody("save_structure_unit_responsibilities");
  assert.match(writer, /\)\s+returns jsonb\s+language plpgsql\s+security definer\s+set search_path = ''/);
  const authority = writer.indexOf("public.has_global_operational_authority() or public.is_project_control_planning(p_project)");
  assert.ok(authority > 0 && authority < writer.indexOf("[INVALID_INPUT]"), "authority before anything else");
  assert.ok(writer.indexOf("[PROJECT_ARCHIVED]") < writer.indexOf("pg_advisory_xact_lock"), "archived refused before the lock");
  const lock = writer.indexOf("perform pg_catalog.pg_advisory_xact_lock(190726, 1);");
  assert.ok(lock > 0);
  assert.ok(writer.indexOf("is_project_control_planning(p_project)", lock) > lock, "authority re-checked after the lock");
  assert.match(writer, /where id = p_project and updated_at = p_expected_updated_at;\s+if not found then\s+raise exception '\[STALE\] Project Setup changed since this page loaded\. Reload before saving\.'\s+using errcode = 'PT409';/);
  assert.match(writer, /\[NOT_OTHER\]/);
  assert.doesNotMatch(writer, /can_manage_project_setup|is_report_coordinator|can_manage_reporting_workflow/, "Coordinator / department users are not admitted");
  const signature = "uuid, timestamptz, uuid, uuid\\[\\], uuid, uuid, uuid, uuid, uuid";
  assert.match(code, new RegExp(`revoke execute on function public\\.save_structure_unit_responsibilities\\(${signature}\\)\\s+from public, anon, service_role;`));
  assert.match(code, new RegExp(`grant execute on function public\\.save_structure_unit_responsibilities\\(${signature}\\)\\s+to authenticated;`));
  // Everything schema-qualified: no bare table references.
  assert.doesNotMatch(writer.replace(/public\.\w+|pg_catalog\.\w+|auth\.uid/g, ""), /\b(from|into|update|join)\s+(projects|project_members|project_structure_\w+)\b/);
});

test("the writer validates the desired state, then ends in dependency order and adds in reverse", () => {
  const writer = fnBody("save_structure_unit_responsibilities");
  for (const tag of ["LEAD_NOT_UNIT_MEMBER", "RESPONSIBLE_NOT_UNIT_MEMBER", "BACKUP_WITHOUT_RESPONSIBLE", "SAME_PERSON",
    "UNIT_NOT_FOUND", "UNIT_ARCHIVED", "UNIT_NOT_REPORTING", "MEMBER_NOT_ACTIVE", "MEMBERSHIP_INCOMPLETE"]) {
    assert.ok(writer.indexOf(`[${tag}]`) < writer.indexOf("set ended_at"), `${tag} is checked before any write`);
  }
  const endResponsibilities = at("update public.project_structure_report_responsibilities r", writer);
  const endLead = writer.indexOf("a.unit_role = 'lead' and a.ended_at is null\n     and a.member_id is distinct from p_lead");
  const endMembers = writer.indexOf("a.unit_role = 'member' and a.ended_at is null\n     and not (a.member_id = any (v_members))");
  const addMembers = writer.indexOf("insert into public.project_structure_unit_members (project_id, node_id, member_id, unit_role)\n  select");
  const addLead = writer.indexOf("values (p_project, p_node, p_lead, 'lead')");
  const addResponsibilities = writer.indexOf("insert into public.project_structure_report_responsibilities");
  assert.ok(endResponsibilities < endLead && endLead < endMembers && endMembers < addMembers
    && addMembers < addLead && addLead < addResponsibilities, "end: responsibilities, Lead, members; add: members, Lead, responsibilities");
  // A cleared slot (NULL) must end its row: null-safe comparison.
  assert.match(writer, /r\.member_id is not distinct from p_weekly_responsible/);
  assert.match(writer, /r\.member_id is not distinct from p_monthly_backup/);
  // Responsible before Backup, unchanged rows untouched.
  assert.match(writer, /\(1, 'weekly', 'responsible', p_weekly_responsible\),\s+\(2, 'weekly', 'backup', p_weekly_backup\)/);
  assert.match(writer, /if not exists \(select 1 from public\.project_structure_report_responsibilities r\s+where r\.node_id = p_node/);
  // Ends, never deletes; only this unit.
  assert.doesNotMatch(writer, /delete from/);
  assert.match(writer, /where r\.node_id = p_node and r\.ended_at is null/);
});

test("no backfill: both tables start empty and nothing outside the writer inserts rows", () => {
  assert.doesNotMatch(topLevel, /insert into public\./);
  assert.match(code, /2C\.3D post-check failed: % must start empty \(no backfill\)\./);
});

/** Last definition of each public function across ALL migrations, in order. */
function liveFunctions() {
  const live = new Map();
  for (const file of sorted()) {
    const text = read(migrations, file);
    for (const match of text.matchAll(/create (?:or replace )?function public\.(\w+)\(/g)) {
      const rest = text.slice(match.index);
      const open = rest.match(/\bas\s+(\$\w*\$)/);
      if (!open) continue;
      const close = rest.indexOf(open[1], open.index + open[0].length);
      live.set(match[1], { file, body: rest.slice(0, close + open[1].length) });
    }
  }
  return live;
}

test("structure responsibilities grant ZERO authority: no authorization helper or other policy reads them", () => {
  const helper = /^(can_|is_|has_|current_user_|current_contact_|weekly_can_|monthly_can_|executive_can_)|_accepts_department_input$/;
  const readers = [...liveFunctions()]
    .filter(([name, def]) => helper.test(name) && /project_structure_unit_members|project_structure_report_responsibilities/.test(def.body))
    .map(([name]) => name);
  assert.deepEqual(readers, []);
  for (const file of sorted()) {
    const text = read(migrations, file).replace(/--[^\n]*/g, "");
    for (const policy of text.matchAll(/create policy (\w+) on public\.(\w+)[\s\S]*?;/g)) {
      if (policy[2] === UNIT || policy[2] === REPORT) continue;
      assert.doesNotMatch(policy[0], /project_structure_unit_members|project_structure_report_responsibilities/, `${file}: ${policy[1]}`);
    }
  }
  assert.match(code, /2C\.3D post-check failed: authorization helper\(s\) read structure responsibilities or membership/);
  assert.match(code, /2C\.3D post-check failed: policies read structure responsibilities/);
});

test("preflight 115 is read-only and opt-in; runtime 116 is local-only and rolled back", () => {
  const preflight = read(scripts, "115_preflight_2c3d_structure_responsibilities.sql");
  assert.match(preflight, /begin transaction read only;/);
  assert.match(preflight, /\nrollback;\n?$/);
  assert.match(preflight, /confirm=PREFLIGHT/);
  assert.doesNotMatch(preflight.replace(/--[^\n]*/g, ""), /^\s*(insert|update|delete|create|drop|alter|grant|truncate)\b/im);
  const runtime = read(scripts, "116_runtime_2c3d_structure_responsibilities.sql");
  assert.match(runtime, /REFUSING TO RUN: this connection is not local/);
  assert.match(runtime, /\nrollback;\n?$/);
  assert.doesNotMatch(runtime, /\ncommit;/i);
  for (const area of ["01 WRITER", "02 CONTROLLED WRITES", "04 LEAD", "05 RESPONSIBILITY", "07 GUARDS", "08 INVARIANTS",
    "09 COMPLETE MEMBERSHIP", "10 ARCHIVED", "11 AUTHORITY", "12 ZERO AUTHORITY", "13 CATALOG", "14 HISTORY"]) {
    assert.ok(runtime.includes(`'${area}'`), area);
  }
});

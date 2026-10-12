import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

// SOURCE CONTRACTS for 20261007150000_project_team_membership.sql and its
// finalization 20261011090000_project_team_controlled_writes.sql. No database
// connection here: runtime behaviour is proved by
// scripts/p0-validation/114_runtime_2c3c_project_team.sql and the stored
// backfill by 113_verify_project_team_membership.sql.

const migrations = new URL("../../../supabase/migrations/", import.meta.url);
const scripts = new URL("../../../scripts/p0-validation/", import.meta.url);
const read = (dir, name) => readFileSync(new URL(name, dir), "utf8").replaceAll("\r", "");
const FILE = "20261007150000_project_team_membership.sql";
const sql = read(migrations, FILE);
const code = sql.replace(/--[^\n]*/g, "");
const at = (needle) => {
  const index = code.indexOf(needle);
  assert.ok(index >= 0, `missing: ${needle}`);
  return index;
};
const sorted = () => readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort();
const FINAL = "20261011090000_project_team_controlled_writes.sql";
const final = read(migrations, FINAL);
const finalCode = final.replace(/--[^\n]*/g, "");

test("2C.3C is one migration after 2C.3B plus one forward finalization; nothing earlier is edited", () => {
  const files = sorted();
  assert.equal(files.indexOf(FILE), files.indexOf("20261007120000_project_parties_professional_information.sql") + 1);
  assert.equal(files.indexOf(FINAL), files.indexOf(FILE) + 1);
  // Later phases (2C.3D onwards) may follow; none redefines a 2C.3C writer or guard.
  for (const later of files.slice(files.indexOf(FINAL) + 1)) {
    assert.doesNotMatch(read(migrations, later),
      /function public\.(add_project_member|update_project_member|end_project_member|guard_project_member_write|guard_project_member_delete|guard_project_party_team_history)\(/, later);
  }
  assert.doesNotMatch(code, /create or replace function public\.save_project_setup_relation|alter table public\.project_contacts|alter table public\.projects\b/);
});

test("approved order: permissive table -> V2 backfill -> NOT VALID rule -> logic", () => {
  const table = at("create table public.project_members");
  const backfill = at("insert into public.project_members (project_id, contact_id, party_id)");
  const rule = at("add constraint project_members_active_requires_party_and_role");
  const firstTrigger = at("create trigger");
  const rls = at("alter table public.project_members enable row level security");
  const fn = at("create function public.add_project_member(");
  assert.ok(table < backfill && backfill < rule && rule < firstTrigger && rule < rls && rule < fn);
});

test("columns are exactly the approved set; one lifecycle field, no status column", () => {
  const body = code.slice(at("create table public.project_members ("), at("create unique index project_members_one_active"));
  const columns = [...body.matchAll(/^\s{2}([a-z_]+)\s+(uuid|text|timestamptz)/gm)].map((match) => match[1]);
  assert.deepEqual(columns, ["id", "project_id", "contact_id", "party_id", "project_role", "reports_to_member_id",
    "ended_at", "created_by", "created_at", "updated_at"]);
  assert.doesNotMatch(body, /\bstatus\b/);
  assert.match(body, /project_id\s+uuid not null references public\.projects\(id\) on delete cascade/);
  assert.match(body, /contact_id\s+uuid not null references public\.contacts\(id\) on delete restrict/);
});

test("same-project integrity is composite-key enforced; no self-report; role shape; one ACTIVE membership", () => {
  assert.match(code, /constraint project_members_project_identity unique \(project_id, id\)/);
  assert.match(code, /constraint project_members_party_same_project\s+foreign key \(project_id, party_id\)\s+references public\.project_parties \(project_id, id\)/);
  assert.match(code, /constraint project_members_reports_to_same_project\s+foreign key \(project_id, reports_to_member_id\)\s+references public\.project_members \(project_id, id\)/);
  assert.match(code, /constraint project_members_no_self_report\s+check \(reports_to_member_id is distinct from id\)/);
  assert.match(code, /project_role = btrim\(project_role\) and length\(project_role\) between 1 and 80/);
  assert.match(code, /create unique index project_members_one_active\s+on public\.project_members \(project_id, contact_id\)\s+where ended_at is null;/);
  // 2C.3A already provides the composite target on project_parties.
  assert.match(read(migrations, "20261006123219_project_parties_foundation.sql"), /constraint project_parties_project_identity unique \(project_id, id\)/);
});

test("legacy-tolerant rule: active rows need Party AND Project Role, NOT VALID, added after the backfill", () => {
  assert.match(code, /add constraint project_members_active_requires_party_and_role\s+check \(ended_at is not null or \(party_id is not null and project_role is not null\)\)\s+not valid;/);
});

test("backfill = approved Preflight V2 rules (and the same as the preflight script)", () => {
  const backfill = code.slice(at("with fixed as ("), at("do $backfill_report$"));
  // Stale fixed-role mirror rows are not participation evidence.
  assert.match(backfill, /where pc\.role not in \('project_manager', 'project_control_manager', 'client_representative',\s+'reporting_coordinator', 'project_sponsor'\)\s+or exists \(select 1 from fixed f/);
  // Role-derived party: PM / PCM / RC -> EPROM, Client Representative -> Owner; Sponsor never mapped.
  assert.match(backfill, /f\.role in \('project_manager', 'project_control_manager', 'reporting_coordinator'\)\) as eprom_role/);
  assert.match(backfill, /f\.role = 'client_representative'\) as owner_role/);
  assert.doesNotMatch(backfill.slice(backfill.indexOf("evidence as")), /project_sponsor/);
  // Organization only ever downgrades: it appears only inside "is null or matches" guards.
  assert.match(backfill, /when e\.eprom_role and e\.owner_role then null/);
  assert.match(backfill, /when e\.eprom_role and \(e\.organization is null or e\.organization = 'EPROM'\) then 'eprom'/);
  assert.match(backfill, /when e\.owner_role and \(e\.organization is null\s+or e\.organization in \(e\.client_name, e\.client_short_name, e\.client_code\)\)\s+then 'owner'/);
  assert.match(backfill, /else null/);
  // Project Role / Reports To / ended_at are never derived.
  assert.match(backfill, /insert into public\.project_members \(project_id, contact_id, party_id\)\s+select d\.project_id, d\.contact_id, pp\.id/);
  // The preflight encodes the same rules.
  const preflight = read(scripts, "112_preflight_project_team_membership.sql");
  assert.match(preflight, /then exists \(select 1 from _fixed f where f\.project_id = pc\.project_id and f\.role = pc\.role and f\.contact_id = pc\.contact_id\) else true end as counts/);
  assert.match(preflight, /upper\(btrim\(c\.organization\)\) <> ''EPROM'' as eprom_contradicted/);
});

test("integrity triggers: active start, immutable identity/history, cycles, archive, delete and party-history guards", () => {
  for (const tag of ["MEMBER_MUST_START_ACTIVE", "INACTIVE_PERSON", "MEMBER_IDENTITY_IMMUTABLE", "MEMBER_ENDED",
    "END_IS_SEPARATE", "HAS_ACTIVE_REPORTS", "PROJECT_ARCHIVED", "SELF_REPORT", "REPORTS_TO_INACTIVE", "REPORTS_TO_CYCLE",
    "MEMBER_HISTORY_PRESERVED"]) {
    assert.match(code, new RegExp(`\\[${tag}\\]`), tag);
  }
  assert.match(code, /with recursive chain\(id\) as \(\s+select new\.reports_to_member_id\s+union\s+select m\.reports_to_member_id/);
  assert.match(code, /raise exception 'This subcontractor cannot be removed because project team history exists\.'\s+using errcode = '23503';/);
  assert.match(code, /create trigger guard_project_party_team_history before delete on public\.project_parties/);
  assert.match(code, /create trigger lock_project_setup_statement before insert or update or delete on public\.project_members/);
  assert.match(code, /create trigger invalidate_setup_project_version before insert or update or delete on public\.project_members/);
  for (const fn of ["guard_project_member_write", "guard_project_member_delete", "guard_project_party_team_history"]) {
    assert.match(code, new RegExp(`create function public\\.${fn}\\(\\) returns trigger\\s+language plpgsql security invoker set search_path = ''`), fn);
    assert.match(code, new RegExp(`revoke execute on function public\\.${fn}\\(\\) from public, anon, authenticated, service_role;`), fn);
  }
});

test("least privilege: RLS on, no DELETE anywhere, writes use the existing responsibility authority", () => {
  assert.match(code, /revoke all on table public\.project_members from public, anon, authenticated, service_role;/);
  assert.match(code, /grant select, insert, update on table public\.project_members to authenticated, service_role;/);
  assert.doesNotMatch(code, /grant[^;]*delete[^;]*project_members/i);
  assert.doesNotMatch(code, /create policy \w+ on public\.project_members\s+for delete/);
  assert.match(code, /create policy project_members_select on public\.project_members\s+for select to authenticated\s+using \(exists \(select 1 from public\.projects p where p\.id = project_members\.project_id\)\);/);
  for (const operation of ["insert", "update"]) {
    const policy = code.slice(at(`create policy project_members_${operation}`)).split(";")[0];
    assert.match(policy, /public\.can_manage_project_responsibilities\(project_id\)/, operation);
  }
});

test("original 2C.3C writers (superseded by the finalization): authority first, archive refusal, PT409 version check", () => {
  for (const [name, signature] of [
    ["add_project_member", "uuid, timestamptz, uuid, uuid, text, uuid"],
    ["update_project_member", "uuid, timestamptz, uuid, uuid, text, uuid"],
    ["end_project_member", "uuid, timestamptz, uuid"],
  ]) {
    const body = code.slice(at(`create function public.${name}(`), at(`grant execute on function public.${name}(`));
    assert.ok(body.indexOf("can_manage_project_responsibilities") < body.indexOf("update public.projects"), `${name}: authority before CAS`);
    assert.match(body, /\[PROJECT_ARCHIVED\]/, name);
    assert.match(body, /pg_catalog\.pg_advisory_xact_lock\(190726, 1\)/, name);
    assert.match(body, /where id = p_project and updated_at = p_expected_updated_at;\s+if not found then\s+raise exception '\[STALE\] Project Setup changed since this page loaded\. Reload before saving\.'\s+using errcode = 'PT409';/, name);
    assert.match(code, new RegExp(`revoke execute on function public\\.${name}\\(${signature}\\) from public, anon;`), name);
    assert.match(code, new RegExp(`grant execute on function public\\.${name}\\(${signature}\\) to authenticated;`), name);
  }
  const add = code.slice(at("create function public.add_project_member("), at("create function public.update_project_member("));
  assert.match(add, /\[PARTY_REQUIRED\][\s\S]*\[PROJECT_ROLE_REQUIRED\]/);
  const end = code.slice(at("create function public.end_project_member("), at("do $post$"));
  assert.doesNotMatch(end, /PARTY_REQUIRED|PROJECT_ROLE_REQUIRED/, "ending needs no Party / Role");
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

test("membership grants ZERO authority: no authorization helper or other policy reads project_members", () => {
  const helper = /^(can_|is_|has_|current_user_|current_contact_|weekly_can_|monthly_can_|executive_can_)|_accepts_department_input$/;
  const readers = [...liveFunctions()].filter(([name, def]) => helper.test(name) && /project_members/.test(def.body)).map(([name]) => name);
  assert.deepEqual(readers, []);
  // No policy on any other table mentions membership.
  for (const file of sorted()) {
    const text = read(migrations, file).replace(/--[^\n]*/g, "");
    for (const policy of text.matchAll(/create policy (\w+) on public\.(\w+)[\s\S]*?;/g)) {
      if (policy[2] === "project_members") continue;
      assert.doesNotMatch(policy[0], /project_members/, `${file}: ${policy[1]}`);
    }
  }
  // The migration refuses to finish if that ever changes.
  assert.match(code, /2C\.3C post-check failed: authorization helper\(s\) read project_members/);
  assert.match(code, /2C\.3C post-check failed: policies read project_members/);
});

test("verification and runtime scripts are read-only / rolled back and local-only", () => {
  const verify = read(scripts, "113_verify_project_team_membership.sql");
  assert.match(verify, /begin transaction read only;/);
  assert.match(verify, /\nrollback;/);
  assert.doesNotMatch(verify.replace(/--[^\n]*/g, ""), /^\s*(insert|update|delete|create|drop|alter|grant)\b/im);
  assert.match(verify, /matches_approved_v2/);
  const runtime = read(scripts, "114_runtime_2c3c_project_team.sql");
  assert.match(runtime, /REFUSING TO RUN: this connection is not local/);
  assert.match(runtime, /\nrollback;\n/);
  assert.doesNotMatch(runtime, /\ncommit;/i);
});

/* ------------------- finalization: controlled writes only ------------------- */

test("finalization closes direct DML: authenticated keeps SELECT only; write policies dropped; data untouched", () => {
  assert.match(finalCode, /revoke insert, update, delete on table public\.project_members from authenticated, anon, public;/);
  assert.match(finalCode, /drop policy if exists project_members_insert on public\.project_members;/);
  assert.match(finalCode, /drop policy if exists project_members_update on public\.project_members;/);
  assert.doesNotMatch(finalCode, /grant[^;]*(insert|update|delete)[^;]*project_members/i, "nothing re-granted");
  assert.doesNotMatch(finalCode, /create policy/i);
  // No row is changed and the schema shape is untouched (function bodies aside).
  const outsideFunctions = finalCode.replace(/\$(add|update|end|post)\$[\s\S]*?\$\1\$/g, "");
  assert.doesNotMatch(outsideFunctions, /insert into|delete from|alter table|create table|drop table|update public\./i);
});

/** Last definition of one public function across ALL migrations. */
function liveDefinition(name) {
  let found;
  for (const file of sorted()) {
    const text = read(migrations, file).replace(/--[^\n]*/g, "");
    const start = text.search(new RegExp(`create (?:or replace )?function public\\.${name}\\(`));
    if (start < 0) continue;
    const rest = text.slice(start);
    const open = rest.match(/\bas\s+(\$\w*\$)/);
    const close = rest.indexOf(open[1], open.index + open[0].length);
    found = { file, body: rest.slice(0, close + open[1].length) };
  }
  return found;
}

test("LIVE membership writers: hardened SECURITY DEFINER, explicit authority, archive refusal, PT409, authenticated-only EXECUTE", () => {
  for (const [name, signature] of [
    ["add_project_member", "uuid, timestamptz, uuid, uuid, text, uuid"],
    ["update_project_member", "uuid, timestamptz, uuid, uuid, text, uuid"],
    ["end_project_member", "uuid, timestamptz, uuid"],
  ]) {
    const live = liveDefinition(name);
    assert.equal(live.file, FINAL, name);
    const body = live.body;
    assert.match(body, /security definer\s+set search_path = ''/, name);
    // Explicit: System Admin / Project Control Admin, or Project Control / Planning on THIS project.
    const authority = "not (public.has_global_operational_authority() or public.is_project_control_planning(p_project))";
    assert.equal(body.split(authority).length - 1, 2, `${name}: authority checked before and after the setup lock`);
    assert.ok(body.indexOf(authority) < body.indexOf("update public.projects"), `${name}: authority before CAS`);
    assert.match(body, /auth\.uid\(\) is null or public\.current_user_role\(\) is null/, name);
    assert.match(body, /if public\.project_is_archived\(p_project\) then\s+raise exception '\[PROJECT_ARCHIVED\]/, name);
    assert.match(body, /where id = p_project and updated_at = p_expected_updated_at;\s+if not found then\s+raise exception '\[STALE\] Project Setup changed since this page loaded\. Reload before saving\.'\s+using errcode = 'PT409';/, name);
    assert.match(body, /pg_catalog\.pg_advisory_xact_lock\(190726, 1\)/, name);
    // Every relation and function is schema-qualified (empty search_path).
    // ("insert into", not bare "into": "returning id into v_member" is a variable.)
    for (const relation of body.matchAll(/\b(?:from|insert into|update|join)\s+([a-z_][\w.]*)/g)) {
      assert.match(relation[1], /^(public|pg_catalog)\./, `${name}: ${relation[0]}`);
    }
    assert.doesNotMatch(body, /[^.\w](btrim|length|clock_timestamp|jsonb_build_object)\(/, `${name}: builtins qualified with pg_catalog`);
    assert.match(finalCode, new RegExp(`revoke execute on function public\\.${name}\\(${signature}\\) from public, anon, service_role;`), name);
    assert.match(finalCode, new RegExp(`grant execute on function public\\.${name}\\(${signature}\\) to authenticated;`), name);
  }
  // update / end only touch a member of THIS project.
  for (const name of ["update_project_member", "end_project_member"]) {
    assert.match(liveDefinition(name).body, /where id = p_member and project_id = p_project and ended_at is null;/, name);
  }
  // Same validation as before: Party and Role on add / update, none on end.
  assert.match(liveDefinition("add_project_member").body, /\[PARTY_REQUIRED\][\s\S]*\[PROJECT_ROLE_REQUIRED\]/);
  assert.doesNotMatch(liveDefinition("end_project_member").body, /PARTY_REQUIRED|PROJECT_ROLE_REQUIRED/);
});

test("finalization post-checks refuse to finish if direct DML, write policies or broad EXECUTE remain", () => {
  for (const message of [
    "direct DML on project_members is still granted",
    "a write policy remains on project_members",
    "membership writers must be SECURITY DEFINER with an empty search_path",
    "EXECUTE must be authenticated-only",
    "authorization helper(s) read project_members",
  ]) assert.ok(final.includes(message), message);
});

test("the application never writes project_members directly — only through the three RPCs", () => {
  const sources = ["../../services/project-team-service.ts", "../../services/project-member-storage.ts",
    "../../services/supabase-project-service.ts"].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));
  for (const source of sources) {
    assert.doesNotMatch(source, /from\("project_members"\)\s*\.\s*(insert|update|upsert|delete)/);
  }
  const service = sources[0];
  for (const rpc of ["add_project_member", "update_project_member", "end_project_member"]) {
    assert.match(service, new RegExp(`rpc\\("${rpc}"`), rpc);
  }
});

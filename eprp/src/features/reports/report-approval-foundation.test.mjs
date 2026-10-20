import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

/*
 * Delegated report approval — foundation contract (grants + decision log).
 *
 * The two SQL files are DRAFTS under supabase/migration-drafts/report-approval
 * until their migration numbers are coordinated with the Notification Center
 * work. These tests read the real SQL of the drafts AND of every committed
 * migration, and prove the static contract:
 *
 *   · grants: System-Admin-only writers, actor never client-supplied, one
 *     active grant per (profile, project, scope), revoke-never-delete, live
 *     helper requiring an active account and a non-archived project;
 *   · isolation: no committed policy or function, and no draft policy,
 *     references approval grants — they cannot enter any read, content,
 *     operations, setup, planning or user-management predicate;
 *   · decision log: append-only, actor = auth.uid(), recorder not callable by
 *     any client, project-scoped read consistent with Full portfolio read,
 *     history survives revocation.
 *
 * NOT proven here: that Postgres accepts and runs the SQL. The drafts' own
 * post-checks cover apply-time facts, and TEST_report_approval_foundation.sql
 * (authenticated, rollback-only) covers the running system. Neither has run.
 */

const DRAFT_DIR = new URL("../../../supabase/migration-drafts/report-approval/", import.meta.url);
const MIGRATIONS_DIR = new URL("../../../supabase/migrations/", import.meta.url);
const GRANTS_FILE = "DRAFT_A_report_approval_grants.sql";
const LOG_FILE = "DRAFT_B_report_decision_log.sql";
const RUNTIME_TEST_FILE = "TEST_report_approval_foundation.sql";

const strip = (sql) =>
  sql.replace(/\r\n/g, "\n").replace(/^\s*\/\*[\s\S]*?\*\//gm, "").replace(/--[^\n]*/g, "");
const squash = (text) => text.replace(/\s+/g, " ").trim();
const readDraft = (name) => strip(readFileSync(new URL(name, DRAFT_DIR), "utf8"));

const GRANTS = readDraft(GRANTS_FILE);
const LOG = readDraft(LOG_FILE);
const MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();

const GRANT_TOKENS = /report_approval_grants|current_report_approval_grant|has_report_approval_grant/;
const GRANT_FUNCTIONS = [
  "report_approval_grants_guard",
  "grant_report_approval",
  "revoke_report_approval",
  "current_report_approval_grant",
  "has_report_approval_grant",
];

/** { name, header, body } for every `create function` in a SQL text. */
function functions(sql) {
  const found = [];
  const re = /create (?:or replace )?function public\.([a-z_0-9]+)\(([\s\S]*?)\$fn\$([\s\S]*?)\$fn\$/g;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    found.push({ name: m[1], header: squash(m[2]), body: squash(m[3]) });
  }
  return found;
}
const fn = (sql, name) => {
  const hit = functions(sql).find((f) => f.name === name);
  assert.ok(hit, `function ${name} not found`);
  return hit;
};

/** Every policy statement (create/alter) in a SQL text. */
function policies(sql) {
  const found = [];
  const re = /(create|alter) policy ([a-z_0-9]+) on public\.([a-z_0-9]+)([\s\S]*?);/g;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    found.push({ verb: m[1], name: m[2], table: m[3], text: squash(m[4]) });
  }
  return found;
}

function tableBody(sql, table) {
  const start = sql.indexOf(`create table public.${table} (`);
  assert.ok(start >= 0, `table ${table} not found`);
  let depth = 0;
  for (let i = sql.indexOf("(", start); i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    if (sql[i] === ")" && --depth === 0) return squash(sql.slice(start, i + 1));
  }
  throw new Error(`unterminated table ${table}`);
}

/* ============================== Placement ============================== */

test("drafts are outside supabase/migrations and not yet promoted", () => {
  for (const name of [GRANTS_FILE, LOG_FILE, RUNTIME_TEST_FILE]) {
    assert.ok(existsSync(new URL(name, DRAFT_DIR)), `${name} missing`);
  }
  for (const name of MIGRATIONS) {
    const sql = strip(readFileSync(new URL(name, MIGRATIONS_DIR), "utf8"));
    assert.doesNotMatch(sql, /report_approval_grants|report_decision_log/, `${name} already defines approval tables`);
  }
});

test("drafts are purely additive: no existing function, policy or table is altered", () => {
  for (const sql of [GRANTS, LOG]) {
    assert.doesNotMatch(sql, /create or replace function/);
    assert.doesNotMatch(sql, /alter policy|drop policy|drop function|drop table/);
    assert.doesNotMatch(sql, /alter table public\.(?!report_approval_grants|report_decision_log)/);
    assert.doesNotMatch(sql, /\b(insert into|update|delete from) public\.(?!report_approval_grants|report_decision_log)[a-z_]+/);
    assert.doesNotMatch(sql, /public\.project_contacts/);
  }
});

/* ================================ Grants ================================ */

test("grant table: profile, project, scope, grantor, revocation actor/time/reason", () => {
  const body = tableBody(GRANTS, "report_approval_grants");
  for (const column of [
    "profile_id uuid not null references public.profiles(id) on delete restrict",
    "project_id uuid not null references public.projects(id) on delete restrict",
    "granted_by uuid not null references public.profiles(id) on delete restrict",
    "granted_at timestamptz not null default now()",
    "revoked_by uuid references public.profiles(id) on delete restrict",
    "revoked_at timestamptz",
    "revoke_reason text",
  ]) {
    assert.ok(body.includes(column), `missing column: ${column}`);
  }
  assert.ok(body.includes("check (scope in ('weekly', 'monthly', 'executive_contribution'))"));
  // Revocation is complete and reasoned, or absent.
  assert.match(body, /revoked_at is null and revoked_by is null and revoke_reason is null\) or \(revoked_at is not null and revoked_by is not null and revoke_reason is not null and btrim\(revoke_reason\) <> ''/);
});

test("duplicate prevention: one ACTIVE grant per profile/project/scope; history rows allowed", () => {
  assert.match(
    squash(GRANTS),
    /create unique index report_approval_grants_one_active on public\.report_approval_grants\(profile_id, project_id, scope\) where revoked_at is null;/,
  );
  const grant = fn(GRANTS, "grant_report_approval");
  assert.match(grant.body, /exception when unique_violation then .* errcode = '23505'/);
});

test("only System Admin may grant or revoke, and the actor is always auth.uid()", () => {
  for (const name of ["grant_report_approval", "revoke_report_approval"]) {
    const f = fn(GRANTS, name);
    assert.match(f.header, /security definer set search_path = ''/);
    assert.doesNotMatch(f.header, /granted_by|revoked_by|p_actor/, `${name} must not accept an actor`);
    const guard = f.body.indexOf("if v_actor is null or not public.is_system_admin() then");
    const firstWrite = f.body.search(/insert into|update public/);
    assert.ok(guard >= 0 && guard < firstWrite, `${name} must check System Admin before writing`);
  }
  assert.match(fn(GRANTS, "grant_report_approval").body, /values \(p_profile, p_project, p_scope, v_actor,/);
  assert.match(fn(GRANTS, "revoke_report_approval").body, /revoked_by = v_actor/);
  assert.match(fn(GRANTS, "revoke_report_approval").body, /p_reason is null or btrim\(p_reason\) = ''/);
});

test("grants go only to active accounts on non-archived projects", () => {
  const body = fn(GRANTS, "grant_report_approval").body;
  assert.match(body, /from public\.profiles pr where pr\.id = p_profile and pr\.active/);
  assert.match(body, /p\.id = p_project and p\.status is distinct from 'archived'/);
});

test("RLS: recipient-owned or System Admin read; no write policy", () => {
  const own = policies(GRANTS).filter((p) => p.table === "report_approval_grants");
  assert.equal(own.length, 1);
  assert.equal(own[0].verb, "create");
  assert.match(own[0].text, /^for select to authenticated using \( profile_id = \(select auth\.uid\(\)\) or \(select public\.is_system_admin\(\)\) \)$/);
  assert.match(GRANTS, /enable row level security/);
});

test("least privilege: no client role may write the grant table directly", () => {
  const sql = squash(GRANTS);
  assert.ok(sql.includes("revoke all on public.report_approval_grants from public, anon, authenticated, service_role;"));
  assert.ok(sql.includes("grant select on public.report_approval_grants to authenticated, service_role;"));
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)[^;]*on public\.report_approval_grants/);
});

test("guard trigger: never delete, only a one-time revocation, only via the governed writers", () => {
  const body = fn(GRANTS, "report_approval_grants_guard").body;
  assert.match(body, /tg_op in \('DELETE', 'TRUNCATE'\)/);
  assert.match(body, /current_setting\('eprp\.report_approval_grant_write', true\), ''\) <> 'on'/);
  assert.match(body, /if old\.revoked_at is not null then raise exception/);
  // Every non-revocation column is compared, so none can be rewritten.
  const columns = tableBody(GRANTS, "report_approval_grants")
    .match(/\( (.*) \)$/)[1]
    .split(", ")
    .map((part) => part.split(" ")[0])
    .filter((name) => /^[a-z_]+$/.test(name) && name !== "constraint");
  const immutable = columns.filter((name) => !name.startsWith("revoke"));
  for (const column of immutable) {
    assert.ok(body.includes(`new.${column} is distinct from old.${column}`), `guard does not freeze ${column}`);
  }
  for (const op of ["before insert or update or delete on public.report_approval_grants", "before truncate on public.report_approval_grants"]) {
    assert.ok(squash(GRANTS).includes(op), `missing trigger: ${op}`);
  }
  for (const writer of ["grant_report_approval", "revoke_report_approval"]) {
    assert.match(fn(GRANTS, writer).body, /set_config\('eprp\.report_approval_grant_write', 'on', true\)/);
  }
});

test("helper is live, caller-bound, active-account and active-project gated, authenticated-only", () => {
  const current = fn(GRANTS, "current_report_approval_grant");
  assert.match(current.header, /stable security definer set search_path = ''/);
  for (const clause of [
    "g.profile_id = (select auth.uid())",
    "g.project_id = p_project",
    "g.scope = p_scope",
    "g.revoked_at is null",
    "and pr.active",
    "p.status is distinct from 'archived'",
  ]) {
    assert.ok(current.body.includes(clause), `helper lacks: ${clause}`);
  }
  assert.doesNotMatch(current.header, /p_profile/, "helper must not answer for another account");
  assert.equal(fn(GRANTS, "has_report_approval_grant").body, "select public.current_report_approval_grant(p_project, p_scope) is not null;");

  const sql = squash(GRANTS);
  for (const signature of ["current_report_approval_grant(uuid, text)", "has_report_approval_grant(uuid, text)"]) {
    assert.ok(sql.includes(`revoke execute on function public.${signature} from public, anon;`));
    assert.ok(sql.includes(`grant execute on function public.${signature} to authenticated;`));
    assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${signature.replace(/[()]/g, "\\$&")} to [^;]*(anon|service_role)`));
  }
});

/* =============================== Isolation =============================== */

test("no committed migration references approval grants in any policy or function", () => {
  for (const name of MIGRATIONS) {
    const sql = strip(readFileSync(new URL(name, MIGRATIONS_DIR), "utf8"));
    for (const p of policies(sql)) {
      assert.doesNotMatch(p.text, GRANT_TOKENS, `${name}: policy ${p.name}`);
    }
    for (const f of functions(sql)) {
      assert.doesNotMatch(f.body, GRANT_TOKENS, `${name}: function ${f.name}`);
    }
  }
});

test("within the drafts, grants are consumed only by their own functions and the recorder's validation", () => {
  for (const p of policies(GRANTS + LOG)) {
    if (p.table === "report_approval_grants") continue;
    assert.doesNotMatch(p.text, GRANT_TOKENS, `policy ${p.name} references approval grants`);
  }
  const consumers = functions(GRANTS + LOG)
    .filter((f) => GRANT_TOKENS.test(f.body))
    .map((f) => f.name)
    .sort();
  const allowed = [...GRANT_FUNCTIONS, "record_report_decision"];
  for (const name of consumers) {
    assert.ok(allowed.includes(name), `unexpected consumer ${name}`);
  }
  assert.ok(consumers.includes("record_report_decision"));
  // The recorder uses the grant only to VALIDATE a claimed delegated decision.
  assert.match(fn(LOG, "record_report_decision").body,
    /p_grant is distinct from public\.current_report_approval_grant\(p_project, v_scope\)/);
});

test("both post-checks fail the migration if a policy or unapproved function references grants", () => {
  const a = squash(GRANTS);
  assert.match(a, /from pg_policies where schemaname = 'public' and tablename <> 'report_approval_grants'/);
  assert.match(a, /p\.prosrc ~ '\(report_approval_grants\|current_report_approval_grant\|has_report_approval_grant\)'/);
  const b = squash(LOG);
  assert.match(b, /'has_report_approval_grant', 'record_report_decision'\)\)/);
});

/* ============================== Decision log ============================= */

test("decision log records subject, project, statuses, actor, time, authority and grant", () => {
  const body = tableBody(LOG, "report_decision_log");
  for (const column of [
    "subject_type text not null check (subject_type in ('weekly_report', 'monthly_report', 'executive_contribution'))",
    "subject_id uuid not null",
    "project_id uuid not null references public.projects(id) on delete restrict",
    "from_status text not null",
    "to_status text not null",
    "actor_profile_id uuid not null references public.profiles(id) on delete restrict",
    "actor_name text not null",
    "grant_id uuid references public.report_approval_grants(id) on delete restrict",
    "decided_at timestamptz not null default now()",
  ]) {
    assert.ok(body.includes(column), `missing: ${column}`);
  }
  assert.ok(body.includes("check (authority in ('delegated_grant', 'project_control', 'global_authority', 'report_preparation'))"));
  assert.ok(body.includes("check ( (authority = 'delegated_grant') = (grant_id is not null) )"));
  assert.ok(body.includes("check (from_status <> to_status)"));
});

test("actor identity and decision time are never client-controlled", () => {
  const recorder = fn(LOG, "record_report_decision");
  assert.doesNotMatch(recorder.header, /p_actor|actor_profile_id|decided_at/);
  assert.match(recorder.body, /v_actor uuid := \(select auth\.uid\(\)\)/);
  assert.match(recorder.body, /values \(p_subject_type, p_subject_id, p_project, p_from, p_to, v_actor, v_actor_name,/);
  const guard = fn(LOG, "report_decision_log_guard").body;
  assert.match(guard, /new\.actor_profile_id is distinct from \(select auth\.uid\(\)\)/);
  assert.match(guard, /new\.decided_at := now\(\)/);
});

test("the recorder verifies the claimed authority is currently held", () => {
  const body = fn(LOG, "record_report_decision").body;
  assert.match(body, /p_authority = 'global_authority' then if not public\.has_global_operational_authority\(\)/);
  assert.match(body, /p_authority = 'project_control' then if not public\.is_project_control_planning\(p_project\)/);
  assert.match(body, /p_authority = 'report_preparation' then if not public\.can_manage_reporting_workflow\(p_project\)/);
  assert.match(body, /from public\.weekly_reports r where r\.id = p_subject_id and r\.project_id = p_project/);
  assert.match(body, /from public\.monthly_reports r where r\.id = p_subject_id and r\.project_id = p_project/);
  assert.match(body, /Executive contribution decisions are not available yet/);
  assert.match(body, /pr\.id = v_actor and pr\.active/);
});

test("immutability: no client write, no write policy, triggers refuse update/delete/truncate", () => {
  const sql = squash(LOG);
  assert.ok(sql.includes("revoke all on public.report_decision_log from public, anon, authenticated, service_role;"));
  assert.ok(sql.includes("grant select on public.report_decision_log to authenticated, service_role;"));
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)[^;]*on public\.report_decision_log/);
  assert.ok(sql.includes("revoke execute on function public.record_report_decision(text, uuid, uuid, text, text, text, uuid, text) from public, anon, authenticated, service_role;"));
  assert.doesNotMatch(sql, /grant execute on function public\.record_report_decision/);
  const guard = fn(LOG, "report_decision_log_guard").body;
  assert.match(guard, /if tg_op <> 'INSERT' then raise exception/);
  assert.match(guard, /current_setting\('eprp\.report_decision_write', true\), ''\) <> 'on'/);
  assert.ok(sql.includes("before insert or update or delete on public.report_decision_log"));
  assert.ok(sql.includes("before truncate on public.report_decision_log"));
});

test("read access: project access (incl. Full portfolio read) or own decisions; never the Published tier", () => {
  const own = policies(LOG).filter((p) => p.table === "report_decision_log");
  assert.equal(own.length, 1);
  assert.equal(
    own[0].text,
    "for select to authenticated using ( public.can_access_project(project_id) or actor_profile_id = (select auth.uid()) )",
  );
  assert.doesNotMatch(LOG, /has_published_portfolio_read|portfolio_read_tier/);

  // can_access_project() is operational access OR the Full tier, and nothing
  // after 20260912000003 redefines it.
  const defining = MIGRATIONS.filter((name) =>
    /function public\.can_access_project\(/.test(strip(readFileSync(new URL(name, MIGRATIONS_DIR), "utf8"))));
  assert.equal(defining.at(-1), "20260912000003_portfolio_read_entitlements.sql");
  const src = squash(strip(readFileSync(new URL(defining.at(-1), MIGRATIONS_DIR), "utf8")));
  assert.match(src, /create or replace function public\.can_access_project\(p_project uuid\).*?select public\.has_operational_project_access\(p_project\) or public\.has_full_portfolio_read\(\);/);
});

test("audit history survives revocation: grants are never deleted and log references RESTRICT", () => {
  assert.match(fn(GRANTS, "revoke_report_approval").body, /update public\.report_approval_grants set revoked_at = now\(\)/);
  assert.doesNotMatch(GRANTS + LOG, /delete from public\.report_approval_grants|on delete cascade|on delete set null/);
});

test("the authenticated runtime test is rollback-only and creates no users", () => {
  const raw = readFileSync(new URL(RUNTIME_TEST_FILE, DRAFT_DIR), "utf8");
  const sql = strip(raw);
  assert.match(sql, /\nbegin;\n/);
  assert.match(sql, /\nrollback;\n/);
  assert.doesNotMatch(sql, /\ncommit;/);
  assert.doesNotMatch(sql, /auth\.users/);
  assert.doesNotMatch(sql, /insert into public\.profiles/);
});

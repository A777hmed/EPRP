import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

/*
 * Direct RPC access to `public.executive_report_summary(uuid)` — roles × report
 * states.
 *
 * The function is SECURITY DEFINER, so it bypasses executive_reports' RLS and
 * must re-state row visibility itself. These tests read the REAL SQL from the
 * migrations — the function's WHERE clause, the LATEST executive_reports_select
 * USING clause, and the helper bodies — and evaluate them over every role and
 * every report status, proving:
 *
 *   · the function never returns a summary for a row the policy would hide;
 *   · it returns one only to full-portfolio authority (Admin, Project Control
 *     Admin, full-tier grant) and only for rows the policy lets them see;
 *   · anonymous, restricted (project-assigned) and published-tier callers get
 *     NULL for every state, including approved and locked reports;
 *   · the function's row predicate IS the policy's, so a future policy change
 *     that is not mirrored fails here;
 *   · neither new function is executable by anon or PUBLIC.
 *
 * NOT proven here: that Postgres executes the SQL as written, or what the live
 * database's grants are. The migration's own post-check covers the apply-time
 * facts; the authenticated RPC checks in the phase report cover the rest.
 */

const MIGRATIONS_DIR = new URL("../../../supabase/migrations/", import.meta.url);
const FILES = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
// Block comments are stripped only where they START a line: a bare `/*` inside
// a line comment or a string would otherwise swallow real SQL up to the next `*/`.
const strip = (sql) =>
  sql
    .replace(/\r\n/g, "\n")
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
    .replace(/--[^\n]*/g, "");
const read = (name) => strip(readFileSync(new URL(name, MIGRATIONS_DIR), "utf8"));
const squash = (text) => text.replace(/\s+/g, " ").trim();

const MIGRATION = read("20260926000001_executive_summary_visibility.sql");

/** Text between the parenthesis opening at `start` and its match. */
function balanced(text, start) {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    if (text[index] === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(start + 1, index);
    }
  }
  throw new Error("unbalanced parentheses");
}

/** The USING clause of the last create/alter of executive_reports_select. */
function latestSelectPolicy() {
  let latest;
  for (const name of FILES) {
    if (name === "20260926000001_executive_summary_visibility.sql") continue;
    const sql = read(name);
    const pattern = /(create|alter) policy executive_reports_select on public\.executive_reports[\s\S]*?using\s*\(/g;
    for (let match = pattern.exec(sql); match; match = pattern.exec(sql)) {
      latest = { file: name, using: squash(balanced(sql, match.index + match[0].length - 1)) };
    }
  }
  assert.ok(latest, "executive_reports_select found");
  return latest;
}

function functionBody(sql, signature) {
  const match = sql.match(new RegExp(`create function public\\.${signature}[\\s\\S]*?\\$fn\\$([\\s\\S]*?)\\$fn\\$`));
  assert.ok(match, `${signature} defined`);
  return squash(match[1]);
}

const SUMMARY_BODY = functionBody(MIGRATION, "executive_report_summary\\(p_report_id uuid\\)");
const READABLE_BODY = functionBody(MIGRATION, "executive_summary_readable\\(\\)");
const WHERE = SUMMARY_BODY.slice(SUMMARY_BODY.indexOf(" where ") + " where ".length).replace(/;$/, "");
const READABLE_EXPR = READABLE_BODY.replace(/^select /, "").replace(/;$/, "");

/** Statuses `report_status_is_approved()` admits — parsed from its latest body. */
const APPROVED_STATUSES = (() => {
  let body;
  for (const name of FILES) {
    const match = read(name).match(/function public\.report_status_is_approved\(p_status text\)[\s\S]*?\$fn\$([\s\S]*?)\$fn\$/);
    if (match) body = match[1];
  }
  assert.ok(body, "report_status_is_approved() found");
  return [...body.matchAll(/'([a-z_]+)'/g)].map((entry) => entry[1]);
})();

/**
 * Evaluate one of the SQL boolean expressions above for a caller and a row.
 * Only the known helpers and AND/OR/parentheses are accepted — anything else in
 * the SQL makes this throw, so an unexpected clause cannot be silently ignored.
 */
function evaluate(expression, ctx) {
  const js = expression
    .replace(/\(select auth\.uid\(\)\) is not null/g, " SIGNED_IN ")
    .replace(/public\.executive_summary_readable\(\)/g, ` (${READABLE_EXPR}) `)
    .replace(/public\.executive_can_manage\(\)/g, " CAN_MANAGE ")
    .replace(/public\.has_full_portfolio_read\(\)/g, " FULL_READ ")
    .replace(/public\.report_status_is_approved\((r\.)?status\)/g, " APPROVED_STATUS ")
    .replace(/r\.id = p_report_id/g, " ROW_EXISTS ")
    .replace(/\band\b/g, "&&")
    .replace(/\bor\b/g, "||");
  // Second pass for the inlined executive_summary_readable() body.
  const resolved = js
    .replace(/public\.executive_can_manage\(\)/g, " CAN_MANAGE ")
    .replace(/public\.has_full_portfolio_read\(\)/g, " FULL_READ ")
    .replace(/\bor\b/g, "||");
  const leftover = resolved.replace(/SIGNED_IN|CAN_MANAGE|FULL_READ|APPROVED_STATUS|ROW_EXISTS|&&|\|\||[()\s]/g, "");
  assert.equal(leftover, "", `unrecognised SQL in predicate: ${leftover}`);
  const values = {
    SIGNED_IN: ctx.signedIn,
    CAN_MANAGE: ctx.canManage,
    FULL_READ: ctx.fullRead,
    APPROVED_STATUS: APPROVED_STATUSES.includes(ctx.status),
    ROW_EXISTS: ctx.rowExists,
  };
  return Function(...Object.keys(values), `return (${resolved});`)(...Object.values(values));
}

/*
 * Callers. Helper values follow the definitions verified for this review:
 * executive_can_manage() = active system_admin | project_control_admin;
 * has_full_portfolio_read() = active tier='full' grant. With no auth.uid() both
 * read no profile row and are false.
 */
const ROLES = {
  anon: { signedIn: false, canManage: false, fullRead: false },
  restrictedViewer: { signedIn: true, canManage: false, fullRead: false },
  publishedTier: { signedIn: true, canManage: false, fullRead: false },
  fullTier: { signedIn: true, canManage: false, fullRead: true },
  projectControlAdmin: { signedIn: true, canManage: true, fullRead: false },
  systemAdmin: { signedIn: true, canManage: true, fullRead: false },
};
/** Every status the table's CHECK constraint allows. */
const STATUSES = ["draft", "under_review", "approved", "locked", "archived"];
const ENTITLED = new Set(["fullTier", "projectControlAdmin", "systemAdmin"]);

function rpcReturnsSummary(role, status, rowExists = true) {
  return evaluate(WHERE, { ...ROLES[role], status, rowExists });
}
function policyShowsRow(role, status) {
  return evaluate(latestSelectPolicy().using.replace(/\bstatus\b/, "r.status"), { ...ROLES[role], status, rowExists: true });
}

/* ------------------------------- Structure -------------------------------- */

test("the function re-states row visibility as the LATEST executive_reports_select, verbatim", () => {
  const policy = latestSelectPolicy();
  assert.equal(policy.file, "20260912000003_portfolio_read_entitlements.sql");
  const mirrored = squash(WHERE.match(/and \(( public\.executive_can_manage\(\)[\s\S]*?)\) and public\.executive_summary_readable/)?.[1] ?? "");
  assert.equal(
    mirrored.replace(/r\.status/g, "status"),
    policy.using,
    "executive_report_summary() row check has drifted from executive_reports_select — update the function"
  );
});

test("the function requires ALL of: row id, signed-in caller, row visibility, summary entitlement", () => {
  assert.match(WHERE, /^r\.id = p_report_id and \(select auth\.uid\(\)\) is not null and \(/);
  assert.match(WHERE, /\) and public\.executive_summary_readable\(\)$/);
  assert.doesNotMatch(WHERE, /\bor public\.executive_summary_readable/, "entitlement must be ANDed, never ORed");
});

/* --------------------------- Roles × report states ------------------------ */

test("never returns a summary for a row the select policy would hide (every role × state)", () => {
  for (const role of Object.keys(ROLES)) {
    for (const status of STATUSES) {
      if (rpcReturnsSummary(role, status)) {
        assert.ok(policyShowsRow(role, status), `${role} got a ${status} summary the policy hides`);
      }
    }
  }
});

test("full-portfolio authority: summary for every state the policy explicitly grants them", () => {
  for (const role of ENTITLED) {
    for (const status of STATUSES) {
      assert.equal(policyShowsRow(role, status), true, `policy grants ${role} ${status} rows`);
      assert.equal(rpcReturnsSummary(role, status), true, `${role} × ${status}`);
    }
  }
});

test("restricted Viewer and published tier: NULL for every state — including approved and locked", () => {
  for (const role of ["restrictedViewer", "publishedTier"]) {
    for (const status of STATUSES) {
      assert.equal(rpcReturnsSummary(role, status), false, `${role} × ${status}`);
    }
    // They may still SEE the approved row itself (metadata) — just not the summary.
    assert.equal(policyShowsRow(role, "approved"), true);
    assert.equal(policyShowsRow(role, "draft"), false);
    assert.equal(policyShowsRow(role, "archived"), false);
  }
});

test("anonymous: NULL for every state, even if EXECUTE were ever granted", () => {
  for (const status of STATUSES) assert.equal(rpcReturnsSummary("anon", status), false);
});

test("a report id that does not exist returns NULL for everyone", () => {
  for (const role of Object.keys(ROLES)) assert.equal(rpcReturnsSummary(role, "approved", false), false);
});

test("report_status_is_approved() admits only approved / finalized / locked (draft, under_review, archived excluded)", () => {
  assert.deepEqual([...APPROVED_STATUSES].sort(), ["approved", "finalized", "locked"]);
});

/* --------------------------- Anonymous execution -------------------------- */

test("both new functions: EXECUTE revoked from PUBLIC and anon, granted to authenticated only", () => {
  for (const signature of ["executive_summary_readable\\(\\)", "executive_report_summary\\(uuid\\)"]) {
    assert.match(MIGRATION, new RegExp(`revoke execute on function public\\.${signature} from public, anon;`));
    assert.match(MIGRATION, new RegExp(`grant execute on function public\\.${signature} to authenticated;`));
    assert.doesNotMatch(MIGRATION, new RegExp(`grant execute on function public\\.${signature} to[^;]*\\banon\\b`));
  }
});

test("the post-check refuses to finish if anon can execute either function", () => {
  assert.match(MIGRATION, /has_function_privilege\('anon', 'public\.executive_report_summary\(uuid\)', 'EXECUTE'\)/);
  assert.match(MIGRATION, /has_function_privilege\('anon', 'public\.executive_summary_readable\(\)', 'EXECUTE'\)/);
});

test("the post-check stops if executive_reports gains another SELECT or any RESTRICTIVE policy", () => {
  assert.match(MIGRATION, /cmd in \('SELECT', 'ALL'\)\) <> 1/);
  assert.match(MIGRATION, /permissive = 'RESTRICTIVE'/);
});

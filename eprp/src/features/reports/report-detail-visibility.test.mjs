import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

/*
 * Weekly/Monthly report DETAIL visibility — roles × report statuses.
 *
 * `global_weekly_report_detail(uuid)` / `global_monthly_report_detail(uuid)`
 * return the report narrative (`summary` / `executive_summary`). Approved rule:
 *
 *   · legitimate project access (assignment, Project Control, global
 *     authority, or the Full portfolio-read tier) — every status, as before;
 *   · platform-wide register readers (Published tier, restricted Viewers) —
 *     only once 'finalized' or 'locked';
 *   · anonymous — never.
 *
 * These tests read the REAL SQL from the migrations: the LATEST definition of
 * each function, the helper bodies it calls, and the previous definition for
 * contrast. They evaluate its WHERE clause over every role and every report
 * status the platform uses. No database is touched.
 *
 * NOT proven here: that Postgres runs the SQL as written, or the live grants.
 * The migration's own post-check covers apply-time facts; the authenticated
 * test matrix covers the running system.
 */

const MIGRATIONS_DIR = new URL("../../../supabase/migrations/", import.meta.url);
const FILES = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
const NEW_FILE = "20260927000001_report_detail_published_narratives.sql";
const OLD_FILE = "20260922000002_global_report_register_visibility.sql";

// Block comments are stripped only where they START a line: a bare `/*` inside
// a line comment or string would otherwise swallow real SQL.
const strip = (sql) =>
  sql.replace(/\r\n/g, "\n").replace(/^\s*\/\*[\s\S]*?\*\//gm, "").replace(/--[^\n]*/g, "");
const read = (name) => strip(readFileSync(new URL(name, MIGRATIONS_DIR), "utf8"));
const squash = (text) => text.replace(/\s+/g, " ").trim();

const FUNCTIONS = ["global_weekly_report_detail", "global_monthly_report_detail"];
const ALIAS = { global_weekly_report_detail: "wr", global_monthly_report_detail: "mr" };
const NARRATIVE = { global_weekly_report_detail: "summary", global_monthly_report_detail: "executive_summary" };

/** Every (file, definition) of a function, in migration order. */
function definitions(name) {
  const found = [];
  for (const file of FILES) {
    const sql = read(file);
    const re = new RegExp(`create (or replace )?function public\\.${name}\\(p_report_id uuid\\)([\\s\\S]*?)\\$fn\\$([\\s\\S]*?)\\$fn\\$`, "g");
    for (let match = re.exec(sql); match; match = re.exec(sql)) {
      found.push({ file, header: squash(match[2]), body: squash(match[3]) });
    }
  }
  return found;
}

function whereClause(body) {
  return body.slice(body.indexOf(" where ") + " where ".length).replace(/;$/, "");
}

/** Latest body of a helper function across all migrations. */
function helperBody(signature) {
  let body;
  for (const file of FILES) {
    const match = read(file).match(
      new RegExp(`function public\\.${signature}[\\s\\S]*?(\\$fn\\$|\\$\\$)([\\s\\S]*?)\\1`)
    );
    if (match) body = squash(match[2]);
  }
  assert.ok(body, `${signature} found`);
  return body;
}

const quoted = (body) => [...body.matchAll(/'([a-z_]+)'/g)].map((entry) => entry[1]);
const COMPLETED = quoted(helperBody("weekly_report_completed\\(p_status text\\)"));
const APPROVED = quoted(helperBody("report_status_is_approved\\(p_status text\\)"));

/*
 * Callers. weekly_can_access_project() = can_access_project() =
 * has_operational_project_access() OR has_full_portfolio_read(), verified
 * below from the migrations themselves.
 */
const ROLES = {
  anonymous: { signedIn: false, projectAccess: false },
  restrictedViewer: { signedIn: true, projectAccess: false },
  publishedTier: { signedIn: true, projectAccess: false },
  projectAuthorized: { signedIn: true, projectAccess: true },
  fullPortfolioRead: { signedIn: true, projectAccess: true },
  systemAdmin: { signedIn: true, projectAccess: true },
};
const STATUSES = [
  "draft", "collecting", "submitted", "under_review", "department_review", "auto_compiled",
  "returned", "rejected", "approved", "finalized", "locked", "archived",
];

function evaluate(where, alias, ctx) {
  const js = where
    .replace(new RegExp(`${alias}\\.id = p_report_id`, "g"), " ROW ")
    .replace(/\(select auth\.uid\(\)\) is not null/g, " SIGNED_IN ")
    .replace(new RegExp(`public\\.weekly_can_access_project\\(${alias}\\.project_id\\)`, "g"), " ACCESS ")
    .replace(new RegExp(`public\\.weekly_report_completed\\(${alias}\\.status\\)`, "g"), " COMPLETED ")
    .replace(new RegExp(`public\\.report_status_is_approved\\(${alias}\\.status\\)`, "g"), " APPROVED ")
    .replace(/\band\b/g, "&&")
    .replace(/\bor\b/g, "||");
  const leftover = js.replace(/ROW|SIGNED_IN|ACCESS|COMPLETED|APPROVED|&&|\|\||[()\s]/g, "");
  assert.equal(leftover, "", `unrecognised SQL in predicate: ${leftover}`);
  const values = {
    ROW: ctx.rowExists ?? true,
    SIGNED_IN: ctx.signedIn,
    ACCESS: ctx.projectAccess,
    COMPLETED: COMPLETED.includes(ctx.status),
    APPROVED: APPROVED.includes(ctx.status),
  };
  return Function(...Object.keys(values), `return (${js});`)(...Object.values(values));
}

const latest = (name) => definitions(name).at(-1);
const returnsNarrative = (name, role, status, rowExists) =>
  evaluate(whereClause(latest(name).body), ALIAS[name], { ...ROLES[role], status, rowExists });

/* ------------------------------ Definitions ------------------------------- */

test("the new migration holds the LATEST definition of both detail functions, and sorts after the pending three", () => {
  for (const name of FUNCTIONS) assert.equal(latest(name).file, NEW_FILE, name);
  const index = FILES.indexOf(NEW_FILE);
  assert.ok(index > FILES.indexOf("20260926000003_project_setup_writer_serialization.sql"));
  // Later, unrelated migrations may exist (e.g. 2C.1 classification); none
  // of them may redefine the detail functions.
  for (const later of FILES.slice(index + 1)) {
    for (const name of FUNCTIONS) {
      assert.ok(!read(later).includes(`function public.${name}(`), `${later} redefines ${name}`);
    }
  }
});

test("signatures and result columns are unchanged from the original definitions", () => {
  for (const name of FUNCTIONS) {
    const [original] = definitions(name).filter((entry) => entry.file === OLD_FILE);
    assert.ok(original, `${name} original found`);
    assert.equal(latest(name).header, original.header, `${name} RETURNS TABLE / attributes changed`);
    assert.match(latest(name).header, /security definer set search_path = ''/);
    assert.match(latest(name).header, new RegExp(`\\b${NARRATIVE[name]} text\\b`));
  }
});

test("only the platform-wide branch changed: approved → finalized|locked", () => {
  for (const name of FUNCTIONS) {
    const alias = ALIAS[name];
    const [original] = definitions(name).filter((entry) => entry.file === OLD_FILE);
    const expectedNew = whereClause(original.body).replace(
      `public.report_status_is_approved(${alias}.status)`,
      `public.weekly_report_completed(${alias}.status)`
    );
    assert.equal(whereClause(latest(name).body), expectedNew);
    assert.doesNotMatch(latest(name).body, /report_status_is_approved/);
  }
});

test("helper semantics: completed = finalized|locked; approved = approved|finalized|locked", () => {
  assert.deepEqual([...COMPLETED].sort(), ["finalized", "locked"]);
  assert.deepEqual([...APPROVED].sort(), ["approved", "finalized", "locked"]);
});

test("weekly_can_access_project() folds in the Full tier — so Full readers keep drafts", () => {
  assert.equal(helperBody("weekly_can_access_project\\(p_project uuid\\)"), "select public.can_access_project(p_project);");
  assert.match(helperBody("can_access_project\\(p_project uuid\\)"), /has_operational_project_access\(p_project\) or public\.has_full_portfolio_read\(\)/);
  assert.doesNotMatch(helperBody("can_access_project\\(p_project uuid\\)"), /published/, "Published tier is NOT project access");
});

/* ------------------------- Roles × report statuses ------------------------ */

for (const name of FUNCTIONS) {
  test(`${name}: Full Portfolio Read, project-authorized and System Admin see every status`, () => {
    for (const role of ["fullPortfolioRead", "projectAuthorized", "systemAdmin"]) {
      for (const status of STATUSES) assert.equal(returnsNarrative(name, role, status), true, `${role} × ${status}`);
    }
  });

  test(`${name}: restricted Viewer and Published tier see ONLY finalized and locked`, () => {
    for (const role of ["restrictedViewer", "publishedTier"]) {
      for (const status of STATUSES) {
        assert.equal(returnsNarrative(name, role, status), ["finalized", "locked"].includes(status), `${role} × ${status}`);
      }
    }
  });

  test(`${name}: approved-only reports no longer expose narratives without project access`, () => {
    const [original] = definitions(name).filter((entry) => entry.file === OLD_FILE);
    const before = evaluate(whereClause(original.body), ALIAS[name], { ...ROLES.restrictedViewer, status: "approved" });
    assert.equal(before, true, "the previous definition exposed approved-only narratives (the defect)");
    assert.equal(returnsNarrative(name, "restrictedViewer", "approved"), false, "now closed");
    assert.equal(returnsNarrative(name, "publishedTier", "approved"), false);
    assert.equal(returnsNarrative(name, "projectAuthorized", "approved"), true, "authorized access unchanged");
  });

  test(`${name}: anonymous is denied for every status, and a missing id returns nothing`, () => {
    for (const status of STATUSES) assert.equal(returnsNarrative(name, "anonymous", status), false);
    for (const role of Object.keys(ROLES)) assert.equal(returnsNarrative(name, role, "locked", false), false);
  });
}

/* ------------------------------ Grants ------------------------------------ */

test("EXECUTE: revoked from PUBLIC and anon, granted to authenticated/service_role; post-check enforces it", () => {
  const sql = read(NEW_FILE);
  for (const name of FUNCTIONS) {
    assert.match(sql, new RegExp(`revoke execute on function public\\.${name}\\(uuid\\) from public, anon;`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\(uuid\\) to authenticated, service_role;`));
    assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${name}\\(uuid\\) to[^;]*\\banon\\b`));
    assert.match(sql, new RegExp(`has_function_privilege\\('anon', 'public\\.${name}\\(uuid\\)', 'EXECUTE'\\)`));
  }
});

/* -------------------------- No alternate path ----------------------------- */

test("register list functions return metadata only — no narrative column", () => {
  const sql = read(OLD_FILE);
  for (const name of ["global_weekly_report_register", "global_monthly_report_register"]) {
    const match = sql.match(new RegExp(`create function public\\.${name}\\(\\)[\\s\\S]*?\\$fn\\$([\\s\\S]*?)\\$fn\\$`));
    assert.ok(match, `${name} found`);
    assert.doesNotMatch(match[0], /\bsummary\b|executive_summary/, `${name} must not expose narrative`);
  }
});

test("no other SECURITY DEFINER function returns Weekly/Monthly narrative columns", () => {
  const offenders = [];
  for (const file of FILES) {
    const sql = read(file);
    const re = /create (?:or replace )?function public\.([a-z_0-9]+)\(([\s\S]*?)\$(fn|[a-z_]*)\$([\s\S]*?)\$\3\$/g;
    for (let match = re.exec(sql); match; match = re.exec(sql)) {
      const [whole, name] = match;
      if (!/security definer/i.test(whole)) continue;
      if (!/\b(weekly_reports|monthly_reports)\b/.test(whole)) continue;
      if (!/\b(wr|mr|weekly_reports|monthly_reports)\.(summary|executive_summary)\b|\bexecutive_summary\b\s*(,|from)/.test(match[4])) continue;
      offenders.push(name);
    }
  }
  assert.deepEqual([...new Set(offenders)].sort(), FUNCTIONS.slice().sort());
});

test("report-table RLS: no Weekly/Monthly SELECT policy admits approved-only rows without project access", () => {
  // Final USING clause per policy, replaying create/alter/drop in migration order.
  const finals = new Map();
  for (const file of FILES) {
    const sql = read(file);
    const re = /(create|alter|drop)\s+policy\s+(?:if\s+exists\s+)?([a-z_0-9]+)\s+on\s+public\.([a-z_0-9]+)([\s\S]*?);/gi;
    for (let match = re.exec(sql); match; match = re.exec(sql)) {
      const [, verb, policy, table, rest] = match;
      if (!/^(weekly|monthly)_/.test(table)) continue;
      const key = `${table}.${policy}`;
      if (/drop/i.test(verb) || /rename to/i.test(rest)) { finals.delete(key); continue; }
      const using = rest.match(/using\s*\(([\s\S]*)\)\s*(with check|$)/i);
      if (using) finals.set(key, squash(using[1]));
    }
  }
  assert.ok(finals.size > 5, "report policies found");
  for (const [key, using] of finals) {
    assert.doesNotMatch(using, /report_status_is_approved|_is_approved\(/, `${key} has an approved-only branch`);
  }
});

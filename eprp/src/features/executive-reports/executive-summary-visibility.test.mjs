import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * Executive Summary visibility — regression coverage.
 *
 * Policy: only full-portfolio authority (executive_can_manage() or
 * has_full_portfolio_read()) may receive the STORED, manually authored
 * Executive Summary. Restricted and published-tier readers receive only the
 * access-scoped auto-generated summary, and the stored text must never be in
 * an API response to them.
 *
 * What this proves:
 *   · the app gate mirrors the SQL predicate exactly (Admin, full, published,
 *     project-assigned, none);
 *   · the REAL record service, driving the REAL Supabase client, never asks
 *     PostgREST for `executive_summary` in a row read — checked on the actual
 *     HTTP requests, against a fake server that behaves like the database
 *     AFTER the migration (column denied, guarded function);
 *   · a restricted viewer never calls the summary function, and even a forged
 *     call gets NULL from it;
 *   · editing still writes the summary and reads it back through the function;
 *   · the app still works BEFORE the migration (deploy app first);
 *   · the migration's grant covers every column the app reads, withholds the
 *     summary, and touches nothing about Executive Notes.
 *
 * NOT proven here, and not provable without a live database: that Postgres
 * enforces the grant and the definer function as written. The migration's own
 * post-check asserts that at apply time; the authenticated checks listed in
 * the phase report confirm it end to end.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://eprp.supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

const { executiveRecordService, EXECUTIVE_RECORD_COLUMNS } = await import(
  "@/features/executive-reports/executive-record.ts"
);
const { canReadStoredExecutiveSummary } = await import("@/features/executive-reports/executive-scope.ts");

const MIGRATION = readFileSync(
  new URL("../../../supabase/migrations/20260926000001_executive_summary_visibility.sql", import.meta.url),
  "utf8"
);
/** The migration with comments stripped — statements only. */
const STATEMENTS = MIGRATION.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const STORED_SUMMARY = "CONFIDENTIAL: Hidden Refinery Revamp faces vendor insolvency exposure.";
const RECORD_ROW = {
  id: "rec-2026-09",
  reporting_month: "2026-09-01",
  status: "approved",
  prepared_by_contact_ids: [],
  signatories: {},
  title: "September 2026",
  confidentiality: "Internal",
  created_by_name: "System Admin",
  updated_by_name: "System Admin",
  archived_at: null,
  created_at: "2026-09-20T10:00:00Z",
  updated_at: "2026-09-21T10:00:00Z",
};

/**
 * A fake PostgREST that behaves like the database after the migration.
 *
 * `viewer` decides what `executive_report_summary()` returns, exactly as
 * `executive_summary_readable()` would. `migrated: false` emulates the database
 * BEFORE the migration: no function yet, column still readable.
 */
function installServer({ viewer, migrated = true }) {
  const requests = [];
  const authorized = canReadStoredExecutiveSummary(viewer);
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    const select = url.searchParams.get("select") ?? "";
    requests.push({ method, path: url.pathname, select, body });

    if (url.pathname === "/rest/v1/rpc/executive_report_summary") {
      if (!migrated) {
        return json({ code: "PGRST202", message: "Could not find the function public.executive_report_summary" }, 404);
      }
      return json(authorized ? STORED_SUMMARY : null);
    }

    if (url.pathname === "/rest/v1/executive_reports") {
      const asksForSummary = select === "*" || select.split(",").includes("executive_summary");
      if (asksForSummary && migrated) {
        return json({ code: "42501", message: "permission denied for column executive_summary" }, 401);
      }
      const row = asksForSummary ? { ...RECORD_ROW, executive_summary: STORED_SUMMARY } : { ...RECORD_ROW };
      const project = (full) =>
        select === "executive_summary" ? { executive_summary: full.executive_summary ?? null } : full;
      if (method === "PATCH") return json(project({ ...row, ...body }));
      if (method === "POST") return json(project({ ...row, ...body, status: "draft" }));
      const single = (init.headers && JSON.stringify(init.headers).includes("vnd.pgrst.object")) || url.searchParams.has("reporting_month") || url.searchParams.has("id");
      return json(single ? project(row) : [project(row)]);
    }

    return json({ message: `unexpected request ${method} ${url.pathname}` }, 500);
  };
  return requests;
}

const ADMIN = { isAdmin: true, portfolioReadTier: "none" };
const FULL_READER = { isAdmin: false, portfolioReadTier: "full" };
const PUBLISHED_READER = { isAdmin: false, portfolioReadTier: "published" };
/** Nour (Viewer): project-assigned, no global role, no portfolio grant. */
const RESTRICTED_VIEWER = { isAdmin: false, portfolioReadTier: "none" };

function rowReadsNeverSelectSummary(requests) {
  for (const request of requests.filter((entry) => entry.path === "/rest/v1/executive_reports")) {
    assert.notEqual(request.select, "*", "a row read used select=*");
    assert.ok(!request.select.split(",").includes("executive_summary") || request.select === "executive_summary",
      `row read asked for executive_summary: ${request.select}`);
  }
}

/* ---------------------------- Entitlement gate ---------------------------- */

test("gate mirrors executive_summary_readable(): Admin and full-tier only", () => {
  assert.equal(canReadStoredExecutiveSummary(ADMIN), true);
  assert.equal(canReadStoredExecutiveSummary(FULL_READER), true);
  assert.equal(canReadStoredExecutiveSummary(PUBLISHED_READER), false, "published tier gets the generated summary");
  assert.equal(canReadStoredExecutiveSummary(RESTRICTED_VIEWER), false, "project assignment is not portfolio authority");
  assert.equal(canReadStoredExecutiveSummary({ isAdmin: false }), false, "no grant at all");
});

test("the SQL predicate is exactly the two existing mechanisms — no new flag", () => {
  const body = STATEMENTS.match(/create function public\.executive_summary_readable\(\)[\s\S]*?\$fn\$([\s\S]*?)\$fn\$/);
  assert.ok(body, "executive_summary_readable() is defined");
  assert.equal(
    body[1].replace(/\s+/g, " ").trim(),
    "select public.executive_can_manage() or public.has_full_portfolio_read();"
  );
});

/* ------------------------ Direct database access -------------------------- */

test("migration withholds executive_summary from every client role and grants every column the app reads", () => {
  assert.match(STATEMENTS, /revoke select on public\.executive_reports from public, anon, authenticated;/);

  const grant = STATEMENTS.match(/grant select \(([\s\S]*?)\) on public\.executive_reports to authenticated;/);
  assert.ok(grant, "column-level SELECT grant present");
  const granted = grant[1].split(",").map((column) => column.trim());
  assert.ok(!granted.includes("executive_summary"), "executive_summary must not be granted");

  for (const column of EXECUTIVE_RECORD_COLUMNS.split(",").map((entry) => entry.trim())) {
    assert.ok(granted.includes(column), `app reads ${column}, which the grant does not cover`);
  }
  assert.ok(!EXECUTIVE_RECORD_COLUMNS.includes("executive_summary"));
  assert.ok(!EXECUTIVE_RECORD_COLUMNS.includes("*"));

  // UPDATE is not revoked, so authorized editing keeps working.
  assert.doesNotMatch(STATEMENTS, /revoke\s+[^;]*update[^;]*executive_reports/i);
});

test("summary reader is SECURITY DEFINER, pinned search_path, gated, and not callable by anon", () => {
  const reader = STATEMENTS.match(/create function public\.executive_report_summary\(p_report_id uuid\)([\s\S]*?)\$fn\$;/);
  assert.ok(reader, "executive_report_summary(uuid) defined");
  assert.match(reader[1], /security definer/);
  assert.match(reader[1], /set search_path = ''/);
  assert.match(reader[1], /and public\.executive_summary_readable\(\)/);
  assert.match(STATEMENTS, /revoke execute on function public\.executive_report_summary\(uuid\) from public, anon;/);
  assert.match(STATEMENTS, /revoke execute on function public\.executive_summary_readable\(\) from public, anon;/);
});

test("Executive Notes permissions are untouched, and no row policy is changed", () => {
  assert.doesNotMatch(STATEMENTS, /executive_notes/);
  assert.doesNotMatch(STATEMENTS, /\b(create|alter|drop) policy\b/i);
});

test("a forged summary call from a restricted viewer returns NULL, not the stored text", async () => {
  installServer({ viewer: RESTRICTED_VIEWER });
  assert.equal(await executiveRecordService.readSummary(RECORD_ROW.id), undefined);
});

/* --------------------------------- Admin ---------------------------------- */

test("Admin: the record carries the stored summary, read through the guarded function", async () => {
  const requests = installServer({ viewer: ADMIN });
  const record = await executiveRecordService.getByMonth("2026-09", {
    includeSummary: canReadStoredExecutiveSummary(ADMIN),
  });
  assert.equal(record.executiveSummary, STORED_SUMMARY);
  assert.ok(requests.some((entry) => entry.path === "/rest/v1/rpc/executive_report_summary"));
  rowReadsNeverSelectSummary(requests);
});

test("full-tier reader receives the stored summary too", async () => {
  installServer({ viewer: FULL_READER });
  const record = await executiveRecordService.getByMonth("2026-09", {
    includeSummary: canReadStoredExecutiveSummary(FULL_READER),
  });
  assert.equal(record.executiveSummary, STORED_SUMMARY);
});

/* --------------------------- Restricted Viewer ---------------------------- */

test("restricted Viewer: no request asks for the summary, and the record has none", async () => {
  const requests = installServer({ viewer: RESTRICTED_VIEWER });
  const record = await executiveRecordService.getByMonth("2026-09", {
    includeSummary: canReadStoredExecutiveSummary(RESTRICTED_VIEWER),
  });
  assert.equal(record.executiveSummary, undefined);
  assert.ok(!requests.some((entry) => entry.path.startsWith("/rest/v1/rpc/")), "summary function never called");
  rowReadsNeverSelectSummary(requests);
  assert.ok(!JSON.stringify(record).includes("CONFIDENTIAL"));
});

/* ------------------------- Existing published reports --------------------- */

test("published-tier reader still sees existing approved reports — without the stored summary", async () => {
  const requests = installServer({ viewer: PUBLISHED_READER });
  const all = await executiveRecordService.list();
  assert.equal(all.length, 1);
  assert.equal(all[0].status, "approved");
  assert.equal(all[0].title, "September 2026");
  assert.equal(all[0].executiveSummary, undefined);

  const record = await executiveRecordService.getByMonth("2026-09", {
    includeSummary: canReadStoredExecutiveSummary(PUBLISHED_READER),
  });
  assert.equal(record.status, "approved");
  assert.equal(record.executiveSummary, undefined);
  rowReadsNeverSelectSummary(requests);
});

/* ----------------------------- Report editing ----------------------------- */

test("editing: the summary is written, the row comes back without it, and it is re-read through the function", async () => {
  const requests = installServer({ viewer: ADMIN });
  const next = await executiveRecordService.update(
    RECORD_ROW.id,
    { executiveSummary: STORED_SUMMARY, status: "approved" },
    { includeSummary: true }
  );
  const patch = requests.find((entry) => entry.method === "PATCH");
  assert.equal(patch.body.executive_summary, STORED_SUMMARY, "summary is still written");
  assert.ok(!patch.select.split(",").includes("executive_summary"), "RETURNING does not select the summary");
  assert.equal(next.executiveSummary, STORED_SUMMARY);
  rowReadsNeverSelectSummary(requests);
});

test("creating a draft record selects explicit columns only", async () => {
  const requests = installServer({ viewer: ADMIN });
  globalThis.fetch = ((original) => async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    // No record exists yet for this month, so ensure() must insert.
    if ((init?.method ?? "GET") === "GET" && url.searchParams.has("reporting_month")) {
      requests.push({ method: "GET", path: url.pathname, select: url.searchParams.get("select") ?? "" });
      return new Response("null", { status: 200, headers: { "content-type": "application/json" } });
    }
    return original(input, init);
  })(globalThis.fetch);

  const created = await executiveRecordService.ensure("2026-10", { includeSummary: true });
  assert.equal(created.status, "draft");
  assert.equal(created.executiveSummary, undefined);
  assert.ok(requests.some((entry) => entry.method === "POST"));
  rowReadsNeverSelectSummary(requests);
});

/* -------------------- Deploy order: app before migration ------------------ */

test("before the migration, the app still works for Admin (function missing → guarded fallback)", async () => {
  const requests = installServer({ viewer: ADMIN, migrated: false });
  const record = await executiveRecordService.getByMonth("2026-09", { includeSummary: true });
  assert.equal(record.executiveSummary, STORED_SUMMARY);
  // Row reads still use explicit columns; only the authorized fallback names the column.
  rowReadsNeverSelectSummary(requests);
});

test("before the migration, a restricted Viewer's page still never requests the summary", async () => {
  const requests = installServer({ viewer: RESTRICTED_VIEWER, migrated: false });
  const record = await executiveRecordService.getByMonth("2026-09", {
    includeSummary: canReadStoredExecutiveSummary(RESTRICTED_VIEWER),
  });
  assert.equal(record.executiveSummary, undefined);
  assert.ok(!requests.some((entry) => entry.select === "executive_summary" || entry.path.startsWith("/rest/v1/rpc/")));
});

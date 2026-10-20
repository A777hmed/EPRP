import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

// Phase 13.9B — Step 2: Setup Finalisation and the Reported Progress stream.
// SOURCE CONTRACTS for 20261017090000_project_setup_finalise_reported_progress.sql
// and the TypeScript contracts in reported-progress.ts. No database
// connection here: runtime behaviour is proved by
// scripts/p0-validation/124_runtime_13_9b_finalise_reported_progress.sql.

registerHooks({ load(url, context, nextLoad) {
  if (!(url.includes("/eprp/src/") && url.endsWith(".ts"))) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });

const {
  REPORTED_PROGRESS_ENTRY_KINDS, REPORTED_PROGRESS_LABEL, REPORTED_PROGRESS_SPI,
  reportedProgressHeads, latestReportedProgress, isReportedProgressWritable,
} = await import("./reported-progress.ts");
const { SETUP_GOVERNANCE_REFUSAL_TAGS, setupGovernanceRefusalMessage } = await import("./setup-governance.ts");

const migrations = new URL("../../../supabase/migrations/", import.meta.url);
const scripts = new URL("../../../scripts/p0-validation/", import.meta.url);
const read = (dir, name) => readFileSync(new URL(name, dir), "utf8").replaceAll("\r", "");
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const FILE = "20261017090000_project_setup_finalise_reported_progress.sql";
const sql = read(migrations, FILE);
const code = sql.replace(/--[^\n]*/g, "");
const sorted = () => readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort();
const tableBody = (name) => {
  const start = code.indexOf(`create table public.${name} (`);
  assert.ok(start >= 0, `missing table ${name}`);
  return code.slice(start, code.indexOf("\n);", start));
};
const columns = (name) => [...tableBody(name).matchAll(/^\s{2}([a-z_]+)\s+(?:uuid|text|date|numeric|boolean|timestamptz|xid8)/gm)].map((m) => m[1]);
const camel = (name) => name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const fnBody = (name) => {
  const start = code.indexOf(`create function public.${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  return code.slice(start, code.indexOf("$fn$;", start));
};

/* ------------------------------- migration -------------------------------- */

test("Step 2 is one migration directly after Step 1", () => {
  const files = sorted();
  assert.equal(files.indexOf(FILE), files.indexOf("20261016090000_project_setup_governance_core.sql") + 1);
  for (const earlier of files.slice(0, files.indexOf(FILE))) {
    const text = read(migrations, earlier);
    for (const name of ["project_setup_finalisations", "project_reported_progress"]) {
      assert.ok(!text.includes(name), `${earlier} already uses ${name}`);
    }
  }
});

test("Controlled derives from the earlier of the first snapshot and the finalisation (no BL0 yet)", () => {
  const fn = code.slice(code.indexOf("create or replace function public.project_setup_controlled_since("));
  const body = fn.slice(0, fn.indexOf("$fn$;"));
  assert.match(body, /least\(/);
  assert.match(body, /min\(s\.published_at\) from public\.planning_snapshots/);
  assert.match(body, /f\.finalised_at from public\.project_setup_finalisations/);
  assert.doesNotMatch(body, /baseline/i);
});

/* ---------------------------- type contracts ------------------------------ */

test("the entry kinds match the database constraint", () => {
  const check = /check \(entry_kind in \(([^)]*)\)\)/.exec(code)[1];
  assert.deepEqual([...check.matchAll(/'([a-z]+)'/g)].map((m) => m[1]), [...REPORTED_PROGRESS_ENTRY_KINDS]);
});

test("ReportedProgressEntry and SetupFinalisation mirror the table columns (no SPI / PV / EV anywhere)", () => {
  const types = source("./reported-progress.ts");
  const entryType = types.slice(types.indexOf("export interface ReportedProgressEntry"), types.indexOf("export interface SetupFinalisation"));
  const finalType = types.slice(types.indexOf("export interface SetupFinalisation"), types.indexOf("export function reportedProgressHeads"));
  for (const column of columns("project_reported_progress").filter((c) => c !== "transaction_id")) {
    assert.match(entryType, new RegExp(`\\b${camel(column)}:`), `ReportedProgressEntry lacks ${column}`);
  }
  for (const column of columns("project_setup_finalisations").filter((c) => c !== "transaction_id")) {
    assert.match(finalType, new RegExp(`\\b${camel(column)}:`), `SetupFinalisation lacks ${column}`);
  }
  const typesCode = types.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  for (const text of [tableBody("project_reported_progress"), tableBody("project_setup_finalisations"), typesCode]) {
    assert.doesNotMatch(text, /\b(spi|pv|ev|planned_value|earned_value|plannedValue|earnedValue)\b/i);
  }
  assert.equal(REPORTED_PROGRESS_LABEL, "Reported — not planning governed");
  assert.equal(REPORTED_PROGRESS_SPI, "N/A");
});

/* ----------------------------- chain resolver ----------------------------- */

const entry = (id, dataDate, entryKind = "report", supersedesEntryId = null) => ({
  id, projectId: "p", dataDate, entryKind, supersedesEntryId,
  reportedPlannedPercent: null, reportedActualPercent: entryKind === "withdrawal" ? null : 10,
  narrative: "n", reason: entryKind === "report" ? null : "r", isBackdated: false, source: "eprp_entry",
  recordedBy: "u", recordedByName: null, recordedAt: "2026-10-17T00:00:00Z",
});

test("heads: one per Data Date, the entry nothing supersedes; latest valid skips a withdrawn head", () => {
  // Same shape as runtime 124 section 04.
  const E1 = entry("E1", "2026-10-01"), C1 = entry("C1", "2026-10-01", "correction", "E1"),
    C2 = entry("C2", "2026-10-01", "correction", "C1"), E2 = entry("E2", "2026-10-05"),
    W2 = entry("W2", "2026-10-05", "withdrawal", "E2"), E3 = entry("E3", "2026-09-20");
  const all = [E1, C1, C2, E2, W2, E3];
  assert.deepEqual(reportedProgressHeads(all).map((e) => e.id), ["W2", "C2", "E3"]);
  assert.equal(latestReportedProgress(all).id, "C2");
  assert.equal(latestReportedProgress([E2, W2]), null);
  assert.equal(latestReportedProgress([]), null);
  // A later report after the withdrawal becomes the latest.
  assert.equal(latestReportedProgress([...all, entry("E4", "2026-10-03")]).id, "E4");
});

test("the TypeScript resolver states the same rule as the database read helpers", () => {
  const heads = fnBody("project_reported_progress_heads");
  assert.match(heads, /not exists \(select 1 from public\.project_reported_progress s where s\.supersedes_entry_id = e\.id\)/);
  const latest = fnBody("project_reported_progress_latest");
  assert.match(latest, /h\.entry_kind <> 'withdrawal'/);
  assert.match(latest, /order by h\.data_date desc\s+limit 1/);
  // Read helpers run as the caller, so RLS applies.
  assert.doesNotMatch(heads + latest, /security definer/);
});

test("writable only for a Finalised no_formal_schedule project without a snapshot that is not archived", () => {
  const ok = { onboardingMode: "no_formal_schedule", finalised: true, hasPublishedSnapshot: false, archived: false };
  assert.equal(isReportedProgressWritable(ok), true);
  assert.equal(isReportedProgressWritable({ ...ok, finalised: false }), false);
  assert.equal(isReportedProgressWritable({ ...ok, hasPublishedSnapshot: true }), false);
  assert.equal(isReportedProgressWritable({ ...ok, archived: true }), false);
  assert.equal(isReportedProgressWritable({ ...ok, onboardingMode: "new_project" }), false);
  assert.equal(isReportedProgressWritable({ ...ok, onboardingMode: null }), false);
  const writable = fnBody("assert_reported_progress_writable");
  for (const rule of ["project_is_archived(p_project)", "'no_formal_schedule'", "public.planning_snapshots", "public.project_setup_finalisations"]) {
    assert.ok(writable.includes(rule), rule);
  }
});

/* ------------------------- database enforcement --------------------------- */

test("chains are linear, same-project, same-date and acyclic by construction", () => {
  const table = tableBody("project_reported_progress");
  assert.match(table, /constraint project_reported_progress_one_successor unique \(supersedes_entry_id\)/);
  assert.match(table, /foreign key \(supersedes_entry_id, project_id\)\s+references public\.project_reported_progress \(id, project_id\)/);
  assert.match(table, /check \(\s*\(entry_kind = 'report'\) = \(supersedes_entry_id is null\)\)/);
  assert.match(code, /create unique index project_reported_progress_one_report_per_date\s+on public\.project_reported_progress \(project_id, data_date\) where entry_kind = 'report';/);
  const guard = fnBody("guard_reported_progress_entry");
  assert.match(guard, /new\.data_date := v_target\.data_date;/);
  assert.match(guard, /\[ENTRY_WITHDRAWN\]/);
  assert.match(guard, /\[ENTRY_NOT_CURRENT\]/);
  // The back-dated flag is computed by the server against the latest VALID date.
  assert.match(guard, /new\.is_backdated := v_latest is not null and new\.data_date < v_latest;/);
  assert.match(fnBody("project_reported_progress_latest_date"), /e\.entry_kind <> 'withdrawal'/);
});

test("authority is the operations predicate (System Administrator, Project Control Admin, assigned Project Control) — no Reporting Coordinator", () => {
  for (const name of ["finalise_project_setup", "record_reported_progress", "reported_progress_supersede"]) {
    const body = fnBody(name);
    assert.match(body, /public\.can_manage_project_operations\((p_project|v_project)\) is distinct from true/, name);
    assert.match(body, /pg_catalog\.pg_advisory_xact_lock\(190726, 1\)/, name);
    assert.doesNotMatch(body, /reporting_coordinator|is_reporting/i, name);
  }
});

test("both tables are archive-guarded first, append-only and not writable by any client", () => {
  assert.match(code, /create trigger block_archived_setup_governance\s+before insert or update or delete on public\.project_setup_finalisations/);
  assert.match(code, /create trigger block_archived_reported_progress\s+before insert or update or delete on public\.project_reported_progress/);
  for (const table of ["project_setup_finalisations", "project_reported_progress"]) {
    assert.match(code, new RegExp(`create trigger guard_setup_governance_history\\s+before update or delete on public\\.${table}`));
    assert.match(code, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated, service_role;`));
    assert.match(code, new RegExp(`grant select on public\\.${table} to authenticated, service_role;`));
  }
  assert.doesNotMatch(code, /grant (insert|update|delete)/i);
  assert.doesNotMatch(code, /function public\.(un_?finali[sz]e|revert|reopen)/i);
});

test("the legacy bootstrap is narrow: Controlled only, System Administrator only, recorded once as legacy_bootstrap", () => {
  const correction = code.slice(code.indexOf("create or replace function public.correct_project_structure_family("),
    code.indexOf("$function$;", code.indexOf("create or replace function public.correct_project_structure_family(")));
  assert.match(correction, /if v_old is null then\s+[\s\S]*?if not public\.project_setup_controlled\(p_project\) then\s+raise exception '\[NOT_CLASSIFIED\]/);
  assert.match(correction, /v_kind := 'legacy_bootstrap';/);
  assert.match(correction, /public\.is_system_admin\(\) is distinct from true/);
  assert.doesNotMatch(correction, /project_setup_amendments/);
  assert.match(code, /check \(\(correction_kind = 'legacy_bootstrap'\) = \(old_family is null\)\)/);
  assert.match(code, /create unique index project_classification_corrections_one_bootstrap/);
  // Step 1's broad exemption is gone from the re-created guard.
  const guard = code.slice(code.indexOf("create or replace function public.guard_project_setup_controlled()"));
  assert.doesNotMatch(guard.slice(0, guard.indexOf("$fn$;")), /v_legacy_classification|project_type_classification/);
});

/* ----------------------------- ownership ---------------------------------- */

test("no Weekly / Monthly / Executive / report code touches the stream, and nothing reads the retired typed progress as its source", () => {
  const files = [];
  const walk = (dir) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const next = new URL(`${item.name}${item.isDirectory() ? "/" : ""}`, dir);
      if (item.isDirectory()) walk(next);
      else if (/\.(ts|tsx)$/.test(item.name)) files.push(next);
    }
  };
  walk(new URL("../../", import.meta.url));
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const usesStream = /project_reported_progress|record_reported_progress|correct_reported_progress|withdraw_reported_progress|reported-progress/.test(text);
    if (!usesStream) continue;
    // Step 3: only Project Setup / Progress / History and the service own it.
    assert.doesNotMatch(file.pathname, /\/features\/(weekly-reports|monthly-reports|executive-reports|reports)\//,
      `${file.pathname} — Weekly / Monthly / Executive must not own Reported Progress`);
    assert.match(file.pathname,
      /\/(features\/projects\/|services\/setup-governance-service\.ts$)/,
      `${file.pathname} touches the Reported Progress stream outside Project Setup / Progress / History`);
  }
  // The stream's only writer in the app is the service (database functions);
  // the Progress panel never reads the retired typed progress or shows PV / EV / a curve.
  const panel = source("./components/progress/reported-progress-panel.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(panel, /plannedProgress|actualProgress/);
  assert.doesNotMatch(panel, /\b(PV|EV|S-curve)\b/);
  const contracts = source("./reported-progress.ts");
  assert.doesNotMatch(contracts.replace(/\/\*[\s\S]*?\*\//g, ""), /plannedProgress|actualProgress|planned_progress|actual_progress/);
  for (const name of ["record_reported_progress", "reported_progress_supersede", "guard_reported_progress_entry", "finalise_project_setup"]) {
    assert.doesNotMatch(fnBody(name), /\b(planned_progress|actual_progress)\b/, name);
    assert.doesNotMatch(fnBody(name), /weekly|monthly/i, name);
  }
});

/* ---------------------------- refusal wording ----------------------------- */

test("every Step 2 refusal reaches the user as its sentence", () => {
  for (const tag of ["FINALISE_CONFIRMATION_REQUIRED", "FINALISE_WRONG_MODE", "SETUP_ALREADY_CONTROLLED",
    "SETUP_ALREADY_FINALISED", "SETUP_NOT_FINALISED", "REPORTED_PROGRESS_NOT_ALLOWED", "REPORTED_PROGRESS_DATE_EXISTS",
    "DATA_DATE_IN_FUTURE", "BACKDATE_REASON_REQUIRED", "NARRATIVE_REQUIRED", "ENTRY_NOT_CURRENT", "ENTRY_WITHDRAWN"]) {
    assert.ok(SETUP_GOVERNANCE_REFUSAL_TAGS.includes(tag), tag);
    assert.match(code, new RegExp(`'\\[${tag}\\] [A-Z]`), `${tag} is raised with a sentence`);
  }
  assert.equal(setupGovernanceRefusalMessage({ message: "[ENTRY_NOT_CURRENT] This entry has already been corrected or withdrawn. Act on its latest version." }),
    "This entry has already been corrected or withdrawn. Act on its latest version.");
  assert.equal(setupGovernanceRefusalMessage({ message: "[PROJECT_ARCHIVED] This project is archived; its reported progress is read-only." }), null);
});

test("the runtime suite covers every area and rolls back", () => {
  const runtime = read(scripts, "124_runtime_13_9b_finalise_reported_progress.sql");
  for (const area of ["01 FINALISE AUTHORITY", "02 FINALISE RULES", "03 REPORTED PROGRESS", "04 CHAIN", "05 CONCURRENCY",
    "06 ELIGIBILITY", "07 ARCHIVED", "08 LEGACY BOOTSTRAP", "09 CATALOG"]) {
    assert.ok(runtime.includes(area), area);
  }
  for (const key of ["P_X", "P_X2", "P_Y", "P_D", "P_M", "P_PCA", "P_SA"]) assert.ok(runtime.includes(`'${key}'`), key);
  assert.match(runtime, /REFUSING TO RUN: this connection is not local/);
  assert.match(runtime.trimEnd(), /rollback;$/);
});

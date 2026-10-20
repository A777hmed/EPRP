import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

// Phase 13.9B — Project Setup Governance, Step 1 (governance core). SOURCE
// CONTRACTS for 20261016090000_project_setup_governance_core.sql: the
// TypeScript field registry is identical to the database registry, the owner's
// final classification holds, refusals reach the user as sentences, and no
// amendment UI exists yet. No database connection here: runtime behaviour is
// proved by scripts/p0-validation/123_runtime_13_9b_governance_core.sql.

registerHooks({ load(url, context, nextLoad) {
  if (!(url.includes("/eprp/src/") && url.endsWith(".ts"))) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });

const {
  SETUP_FIELD_REGISTRY, SETUP_FIELD_CLASSES, SETUP_SYSTEM_COLUMNS, SETUP_GOVERNANCE_REFUSAL_TAGS,
  setupFieldEntry, setupFieldForColumn, setupGovernanceRefusalMessage,
} = await import("./setup-governance.ts");

const migrations = new URL("../../../supabase/migrations/", import.meta.url);
const scripts = new URL("../../../scripts/p0-validation/", import.meta.url);
const read = (dir, name) => readFileSync(new URL(name, dir), "utf8").replaceAll("\r", "");
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const FILE = "20261016090000_project_setup_governance_core.sql";
const sql = read(migrations, FILE);
const code = sql.replace(/--[^\n]*/g, "");
const sorted = () => readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort();

/* ------------------------- SQL registry parsing -------------------------- */

const KEYS = ["fieldKey", "kind", "targetTable", "targetColumns", "fieldClass", "futureClass", "futureSlice",
  "enforcedFrom", "label", "impactCode", "impactWarning"];

function parseRow(row) {
  const values = [];
  let i = 0;
  while (i < row.length) {
    while (row[i] === " " || row[i] === ",") i += 1;
    if (i >= row.length) break;
    if (row.startsWith("null", i)) { values.push(null); i += 4; continue; }
    if (row.startsWith("array[]::text[]", i)) { values.push([]); i += 15; continue; }
    if (row.startsWith("array[", i)) {
      const end = row.indexOf("]", i);
      values.push([...row.slice(i + 6, end).matchAll(/'([^']*)'/g)].map((match) => match[1]));
      i = end + 1;
      continue;
    }
    assert.equal(row[i], "'", `unexpected registry token at: ${row.slice(i, i + 30)}`);
    let j = i + 1;
    let text = "";
    for (;;) {
      if (row[j] === "'" && row[j + 1] === "'") { text += "'"; j += 2; continue; }
      if (row[j] === "'") break;
      text += row[j];
      j += 1;
    }
    values.push(text);
    i = j + 1;
  }
  assert.equal(values.length, KEYS.length, `registry row has ${values.length} values: ${row}`);
  return Object.fromEntries(KEYS.map((key, index) => [key, values[index]]));
}

// The LIVE registry is the latest migration that (re)defines it (13.9B Step 3
// re-created it to mark Contacts / Sites / Parties as logged).
const REGISTRY_FILE = sorted().filter((name) => read(migrations, name).includes("function public.project_setup_field_registry()")).at(-1);
const registrySql = read(migrations, REGISTRY_FILE);
const registryBody = registrySql.slice(registrySql.indexOf("$registry$"), registrySql.lastIndexOf("$registry$"));
const SQL_REGISTRY = [...registryBody.matchAll(/^\s*\(('.*)\),?\s*$/gm)].map((match) => parseRow(match[1]));
const byKey = (key) => SETUP_FIELD_REGISTRY.find((entry) => entry.fieldKey === key);
const keysOf = (fieldClass, kind = "column") =>
  SETUP_FIELD_REGISTRY.filter((entry) => entry.fieldClass === fieldClass && entry.kind === kind)
    .map((entry) => entry.fieldKey).sort();

/* ------------------------------- migration -------------------------------- */

test("13.9B Step 1 is one migration directly after 13.9", () => {
  const files = sorted();
  assert.equal(files.indexOf(FILE), files.indexOf("20261014090000_planning_control_archived_read_only.sql") + 1);
  for (const earlier of files.slice(0, files.indexOf(FILE))) {
    const text = read(migrations, earlier);
    for (const name of ["project_setup_amendments", "project_setup_field_registry", "p_confirm_setup_control"]) {
      assert.ok(!text.includes(name), `${earlier} already uses ${name}`);
    }
  }
  // No existing row is written, repaired or normalised by the migration body.
  const topLevel = code.replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/g, "$$body$$");
  assert.doesNotMatch(topLevel, /\binsert into\b|\bupdate public\.|\bdelete from\b/i);
});

/* --------------------------- registry parity ------------------------------ */

test("the TypeScript registry is identical to the LIVE database registry, row for row", () => {
  assert.equal(REGISTRY_FILE, "20261018090000_project_setup_relation_history.sql");
  assert.ok(SQL_REGISTRY.length >= 60, `parsed only ${SQL_REGISTRY.length} SQL rows`);
  assert.deepEqual(SETUP_FIELD_REGISTRY.map((entry) => ({ ...entry, targetColumns: [...entry.targetColumns] })), SQL_REGISTRY);
  assert.equal(new Set(SETUP_FIELD_REGISTRY.map((entry) => entry.fieldKey)).size, SETUP_FIELD_REGISTRY.length);
});

test("the system-column list matches project_setup_system_columns()", () => {
  const fn = code.slice(code.indexOf("create function public.project_setup_system_columns()"));
  const list = /array\[([^\]]*)\]::text\[\]/.exec(fn)[1];
  assert.deepEqual([...list.matchAll(/'([^']*)'/g)].map((match) => match[1]), [...SETUP_SYSTEM_COLUMNS]);
});

test("only the seven approved classes exist; future states are recorded, not enforced", () => {
  assert.deepEqual([...SETUP_FIELD_CLASSES].sort(),
    ["free_logged", "governed", "lightweight", "planning_owned", "retired", "superseded", "system_admin_correction"]);
  for (const entry of SETUP_FIELD_REGISTRY) {
    assert.ok(SETUP_FIELD_CLASSES.includes(entry.fieldClass), entry.fieldKey);
    assert.ok(entry.futureClass === null || SETUP_FIELD_CLASSES.includes(entry.futureClass), entry.fieldKey);
    // Nothing is superseded or planning-owned before 13.12 / 13.14.
    assert.ok(!["superseded", "planning_owned"].includes(entry.fieldClass), entry.fieldKey);
  }
  assert.deepEqual([byKey("planned_start_date").futureClass, byKey("planned_start_date").futureSlice], ["superseded", "13.12"]);
  assert.deepEqual([byKey("planned_finish_date").futureClass, byKey("planned_finish_date").futureSlice], ["superseded", "13.12"]);
  assert.deepEqual([byKey("forecast_finish_date").futureClass, byKey("forecast_finish_date").futureSlice], ["planning_owned", "13.14"]);
});

/* -------------------- the owner's final classification -------------------- */

test("lightweight: Project Name, Short Name, Contract Number, PO Number, Actual Start, Actual Finish", () => {
  assert.deepEqual(keysOf("lightweight"),
    ["actual_finish_date", "actual_start_date", "contract_number", "name", "purchase_order_number", "short_name"]);
});

test("governed: identity, classification, onboarding, reporting, commercial, contractual and schedule fields (Forecast Finish included, B22)", () => {
  assert.deepEqual(keysOf("governed"), [
    "client_id", "code", "contract_start_date", "currency", "executive_enabled", "forecast_finish_date",
    "milestone_update_approval", "monthly_cutoff_day", "monthly_enabled", "onboarding_mode",
    "planned_finish_date", "planned_start_date", "project_category", "time_zone", "weekly_enabled",
    "weekly_reporting_day", "working_week",
  ].sort());
  assert.deepEqual([...byKey("project_category").targetColumns], ["project_type_id", "project_category_detail"]);
  assert.equal(byKey("onboarding_mode").targetTable, "project_planning_settings");
  for (const key of keysOf("governed").concat(keysOf("lightweight"))) {
    assert.ok(byKey(key).impactWarning, `${key} has no impact warning`);
    assert.ok(byKey(key).impactCode, `${key} has no impact code`);
  }
});

test("retired: Priority, overall_status and the typed progress pair; Project Type is the System Administrator correction only (B16)", () => {
  assert.deepEqual(keysOf("retired"), ["actual_progress", "overall_status", "planned_progress", "priority"]);
  assert.deepEqual(keysOf("system_admin_correction"), ["structure_family"]);
});

test("free / logged columns: lifecycle, phase, group, description, responsibilities, location, contacts and branding", () => {
  assert.deepEqual(keysOf("free_logged"), [
    "city", "client_contact_email", "client_contact_name", "client_contact_phone", "client_logo_ref",
    "client_representative_id", "country", "current_phase_id", "default_language", "description",
    "include_qr_code", "include_signature_section", "portfolio_group_id", "project_control_manager_id",
    "project_logo_ref", "project_manager_id", "project_sponsor_id", "report_footer_text",
    "report_header_title", "report_reference_prefix", "reporting_coordinator_id", "site", "status",
  ].sort());
});

test("structure (B17, owner decision 2026-10-16): renames and scope governed, display order and notes free, no lightweight structure class", () => {
  assert.deepEqual(keysOf("governed", "relation"),
    ["structure_departments", "structure_disciplines", "structure_levels", "structure_units"]);
  assert.match(byKey("structure_units").label, /rename/);
  assert.match(byKey("structure_levels").label, /rename/);
  assert.deepEqual(keysOf("free_logged", "relation"),
    ["contacts", "parties", "positions", "sites", "structure_display_order", "structure_notes", "team"]);
  assert.deepEqual(keysOf("lightweight", "relation"), []);
  for (const entry of SETUP_FIELD_REGISTRY.filter((item) => item.kind === "relation" && item.fieldKey.startsWith("structure_"))) {
    assert.equal(entry.enforcedFrom, "13.9B-4", `${entry.fieldKey} is enforced from Step 4, not Step 1`);
  }
});

test("lookup helpers resolve keys and stored columns", () => {
  assert.equal(setupFieldEntry("code").fieldClass, "governed");
  assert.equal(setupFieldForColumn("project_category_detail").fieldKey, "project_category");
  assert.equal(setupFieldForColumn("priority").fieldClass, "retired");
  assert.equal(setupFieldForColumn("updated_at"), undefined);
});

/* ------------------------- database enforcement --------------------------- */

test("the guards compare old with new values and bind amendments to the same transaction", () => {
  const guard = code.slice(code.indexOf("create function public.guard_project_setup_controlled()"),
    code.indexOf("create trigger guard_project_setup_controlled"));
  assert.match(guard, /continue when v_old_value = v_new_value;/);
  assert.match(guard, /project_setup_amendment_authorises\(new\.id, v_entry\.field_key, 'applied', v_new_value\)/);
  assert.match(guard, /project_setup_amendment_authorises\(new\.id, v_entry\.field_key, 'approved', v_new_value\)/);
  assert.match(guard, /\[SETUP_FIELD_RETIRED\]/);
  assert.match(guard, /if not public\.project_setup_controlled\(old\.id\) then\s+return new;/);
  const binding = code.slice(code.indexOf("create function public.project_setup_amendment_authorises("));
  assert.match(binding, /a\.applied_transaction_id = pg_catalog\.pg_current_xact_id\(\)/);
  assert.match(binding, /a\.proposed_value = p_value/);
});

test("Controlled is derived from the first Published Planning Snapshot only (Step 1)", () => {
  const fn = code.slice(code.indexOf("create function public.project_setup_controlled_since("),
    code.indexOf("create function public.project_setup_controlled("));
  assert.match(fn, /select min\(s\.published_at\) from public\.planning_snapshots s where s\.project_id = p_project;/);
  assert.doesNotMatch(fn, /finalisation|baseline/i);
});

test("B12: decide refuses the requester before checking authority, for every role; a constraint backs it", () => {
  const decide = code.slice(code.indexOf("create function public.decide_project_setup_amendment("),
    code.indexOf("create function public.withdraw_project_setup_amendment("));
  assert.ok(decide.indexOf("[PROJECT_ARCHIVED]") < decide.indexOf("[SELF_APPROVAL]"));
  assert.ok(decide.indexOf("[SELF_APPROVAL]") < decide.indexOf("has_global_operational_authority()"));
  assert.match(code, /check \(status not in \('approved', 'rejected'\) or decided_by <> requested_by\)/);
  assert.match(code, /create unique index project_setup_amendments_one_pending\s+on public\.project_setup_amendments \(project_id, field_key\) where status = 'pending';/);
});

test("publish: archived answers first, then the no_formal_schedule refusal, then the first-anchor confirmation — all before any write", () => {
  const publish = code.slice(code.indexOf("create function public.publish_planning_snapshot("));
  const archived = publish.indexOf("[PROJECT_ARCHIVED]");
  const noFormal = publish.indexOf("[NO_FORMAL_SCHEDULE]");
  const confirm = publish.indexOf("[SETUP_CONTROL_CONFIRMATION_REQUIRED]");
  const write = publish.indexOf("insert into public.planning_snapshots");
  assert.ok(archived > 0 && archived < noFormal && noFormal < confirm && confirm < write);
  assert.match(publish, /p_confirm_setup_control boolean default false/);
  assert.match(code, /drop function public\.publish_planning_snapshot\(uuid, uuid, uuid, boolean, text, uuid, date\);/);
  // The existing authority check is unchanged and still first.
  assert.ok(publish.indexOf("can_manage_project_operations(p_project_id)") < archived);
});

test("the new tables are append-only, archive-guarded first and not writable by any client", () => {
  for (const table of ["project_setup_amendments", "project_setup_field_changes"]) {
    assert.match(code, new RegExp(`create trigger block_archived_setup_governance\\s+before insert or update or delete on public\\.${table}\\s+for each row execute function public\\.guard_archived_project_setup\\(\\);`));
    assert.match(code, new RegExp(`create trigger guard_setup_governance_history\\s+before update or delete on public\\.${table}`));
    assert.match(code, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated, service_role;`));
    assert.match(code, new RegExp(`grant select on public\\.${table} to authenticated, service_role;`));
    assert.match(code, new RegExp(`for select to authenticated using \\(public\\.can_access_project\\(project_id\\)\\)`));
  }
  assert.doesNotMatch(code, /grant (insert|update|delete)/i);
});

/* ---------------------------- refusal wording ----------------------------- */

test("every tag the 13.9B migrations raise is either a governance refusal with a sentence or an existing shared tag", () => {
  // Step 2 re-creates the 2C.1 Project Type correction; its tags keep their
  // own mapping (services/classification-correction.ts) and are excluded.
  const step2 = read(migrations, "20261017090000_project_setup_finalise_reported_progress.sql").replace(/--[^\n]*/g, "");
  const correctionStart = step2.indexOf("create or replace function public.correct_project_structure_family(");
  const correctionEnd = step2.indexOf("$function$;", correctionStart);
  const step2Governance = step2.slice(0, correctionStart) + step2.slice(correctionEnd);
  const raised = new Set([...(code + step2Governance).matchAll(/raise exception\s*'\[([A-Z_]+)\]/g)].map((match) => match[1]));
  const shared = new Set(["PROJECT_ARCHIVED", "NOT_AUTHORIZED", "NOT_FOUND"]);
  for (const tag of raised) {
    assert.ok(SETUP_GOVERNANCE_REFUSAL_TAGS.includes(tag) || shared.has(tag), `unmapped tag ${tag}`);
  }
  for (const tag of SETUP_GOVERNANCE_REFUSAL_TAGS) assert.ok(raised.has(tag), `${tag} is never raised`);
});

test("a governance refusal reads as its sentence; anything else is left to the other rules", () => {
  assert.equal(
    setupGovernanceRefusalMessage({ message: "[SETUP_CONTROLLED] Project Code is controlled once Project Setup is controlled. Request an amendment; another Project Control Admin or System Administrator must approve it." }),
    "Project Code is controlled once Project Setup is controlled. Request an amendment; another Project Control Admin or System Administrator must approve it.");
  assert.equal(
    setupGovernanceRefusalMessage({ message: "[SETUP_CONTROL_CONFIRMATION_REQUIRED] Publishing the first Planning Snapshot makes Project Setup controlled. Confirm this to publish." }),
    "Publishing the first Planning Snapshot makes Project Setup controlled. Confirm this to publish.");
  assert.equal(setupGovernanceRefusalMessage({ message: "[PROJECT_ARCHIVED] This project is archived; its setup is read-only." }), null);
  assert.equal(setupGovernanceRefusalMessage({ message: "new row violates row-level security policy" }), null);
  assert.equal(setupGovernanceRefusalMessage({ message: null }), null);
});

test("service wording: governance refusals are recognised after the archived freeze and before the permission wording", () => {
  const errors = source("../../services/service-errors.ts");
  const describe = errors.slice(errors.indexOf("export async function describeFailure("));
  const archived = describe.indexOf("isArchivedProjectRefusal(options.error)");
  const governance = describe.indexOf("setupGovernanceRefusalMessage(options.error)");
  const permission = describe.indexOf("isPermissionDenied(options.error)");
  assert.ok(archived >= 0 && archived < governance && governance < permission);
});

test("the publish service passes the confirmation only when the caller gives it (never a hard-coded true)", () => {
  const planning = source("../../services/planning-service.ts");
  assert.match(planning, /p_confirm_setup_control: input\.confirmSetupControl \?\? false,/);
  assert.doesNotMatch(planning, /p_confirm_setup_control: true/);
});

/* --------------------------------- scope ---------------------------------- */

test("Step 3: screens never call a governance function directly — every write goes through the service", () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
      if (entry.isDirectory()) walk(next);
      else if (/\.tsx$/.test(entry.name)) files.push(next);
    }
  };
  walk(new URL("../../", import.meta.url));
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text,
      /rpc\(\s*"(request_project_setup_amendment|decide_project_setup_amendment|withdraw_project_setup_amendment|finalise_project_setup|record_reported_progress|correct_reported_progress|withdraw_reported_progress)"/,
      file.pathname);
    assert.doesNotMatch(text, /from\(\s*"project_setup_(amendments|field_changes|relation_changes|finalisations)"/, file.pathname);
  }
  const service = source("../../services/setup-governance-service.ts");
  for (const fn of ["request_project_setup_amendment", "decide_project_setup_amendment", "withdraw_project_setup_amendment",
    "finalise_project_setup", "record_reported_progress", "correct_reported_progress", "withdraw_reported_progress"]) {
    assert.ok(service.includes(`rpc("${fn}"`), fn);
  }
  // The service never writes a governance table directly.
  assert.doesNotMatch(service, /\.(insert|update|upsert|delete)\(/);
});

test("the preflight is read-only and the runtime suite covers every area and rolls back", () => {
  const preflight = read(scripts, "122_preflight_13_9b_setup_governance.sql");
  assert.match(preflight, /begin transaction read only;/);
  assert.doesNotMatch(preflight.replace(/--[^\n]*/g, ""), /\binsert into public\.|\bupdate public\.|\bdelete from public\./i);
  assert.match(preflight.trimEnd(), /rollback;$/);
  const runtime = read(scripts, "123_runtime_13_9b_governance_core.sql");
  for (const area of ["01 NOT CONTROLLED", "02 ANCHOR", "03 FREE", "04 LIGHTWEIGHT", "05 GOVERNED", "06 STALE",
    "07 RETIRED", "08 PROJECT TYPE", "09 ONBOARDING", "10 PUBLISH", "11 AUTHORITY", "12 ARCHIVED", "13 CATALOG"]) {
    assert.ok(runtime.includes(area), area);
  }
  for (const script of [preflight, runtime]) assert.match(script, /REFUSING TO RUN: this connection is not local/);
  assert.match(runtime.trimEnd(), /rollback;$/);
});

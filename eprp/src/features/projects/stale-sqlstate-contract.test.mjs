import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

// SOURCE CONTRACTS ONLY for 20261004000001_stale_conflict_sqlstate_pt409.sql:
// no PostgreSQL connection and no migration execution. The runtime behaviour
// (a prompt PT409 refusal instead of a PostgREST retry loop) is proved by
// scripts/p0-validation/111_runtime_2c1c_service_concurrency.mjs, S5 / S6.

const migrations = new URL("../../../supabase/migrations/", import.meta.url);
const read = (name) => readFileSync(new URL(name, migrations), "utf8").replaceAll("\r", "");
const PT409_FILE = "20261004000001_stale_conflict_sqlstate_pt409.sql";
const pt409 = read(PT409_FILE);
const sortedSql = () => readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort();
// Block comments first: the section separators contain "--".
const withoutComments = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

/** The functions whose CURRENT definition raised 40001 for a stale version. */
const RECREATED = [
  ["save_project_setup_relation", "20260926000002_project_setup_atomic_save.sql", "$fn$"],
  ["save_project_setup_patch", "20261001000001_project_setup_classification.sql", "$patch$"],
  ["configure_project_structure_levels", "20261003000001_project_structure_foundation.sql", "$configure$"],
  ["correct_project_structure_family", "20261003000001_project_structure_foundation.sql", "$correct$"],
];

/** A function definition through its revoke / grant statements. */
function block(sql, name, delimiter) {
  const start = sql.search(new RegExp(`^create (?:or replace )?function public\\.${name}\\(`, "m"));
  assert.ok(start >= 0, `no definition of ${name}`);
  const end = sql.indexOf(`\n${delimiter};`, start) + delimiter.length + 2;
  const grantAt = sql.indexOf(`grant execute on function public.${name}(`, end);
  assert.ok(grantAt > end, `no grant after ${name}`);
  return sql.slice(start, sql.indexOf(";", grantAt) + 1);
}

/** Every dollar-quoted public function definition in a migration, in order. */
function definitionsIn(sql) {
  const found = [];
  for (const match of sql.matchAll(/create (?:or replace )?function public\.(\w+)\(/g)) {
    const rest = sql.slice(match.index);
    const open = rest.match(/\bas\s+(\$\w*\$)/);
    if (!open || open.index > rest.indexOf(";")) continue;
    const close = rest.indexOf(open[1], open.index + open[0].length);
    found.push({ name: match[1], body: rest.slice(0, close + open[1].length) });
  }
  return found;
}

/** What a fully migrated database runs: the last definition of each function. */
function liveDefinitions() {
  const live = new Map();
  for (const file of sortedSql()) {
    for (const definition of definitionsIn(read(file))) live.set(definition.name, { ...definition, file });
  }
  return live;
}

test("PT409: one new forward migration, unique, sorting directly after the 2C.1c-a migration", () => {
  const files = sortedSql();
  assert.deepEqual(files.filter((name) => name.startsWith("20261004000001")), [PT409_FILE]);
  assert.equal(files.indexOf(PT409_FILE), files.indexOf("20261003000001_project_structure_foundation.sql") + 1);
});

test("PT409: re-creates exactly the four stale-raising functions and nothing else", () => {
  const top = withoutComments(pt409).replace(/\$([a-z_]+)\$[\s\S]*?\$\1\$/g, "$$body$$");
  const statements = top.split(";").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
  assert.deepEqual(
    statements.map((s) => s.match(/^(create or replace function|revoke execute on function|grant execute on function) public\.(\w+)\(/)?.slice(1).join(" ")),
    RECREATED.flatMap(([name]) => [
      `create or replace function ${name}`, `revoke execute on function ${name}`, `grant execute on function ${name}`,
    ]),
  );
});

test("PT409: each body is the current definition verbatim except the one stale SQLSTATE", () => {
  for (const [name, file, delimiter] of RECREATED) {
    const before = block(read(file), name, delimiter);
    const after = block(pt409, name, delimiter);
    assert.equal(before.split("errcode = '40001'").length - 1, 1, `${name}: one 40001 before`);
    assert.equal(after.split("errcode = 'PT409'").length - 1, 1, `${name}: one PT409 after`);
    const restored = after
      .replace("errcode = 'PT409'", "errcode = '40001'")
      .replace(/^create or replace function /, before.match(/^create (?:or replace )?function /)[0]);
    assert.equal(restored, before, `${name}: only the SQLSTATE (and create -> create or replace) differs`);
    // Spelled out, although implied by the equality above.
    const mode = name === "correct_project_structure_family" ? "definer" : "invoker";
    assert.match(after, new RegExp(`\\bsecurity ${mode}\\s+set search_path = ''`, "i"), `${name}: security ${mode} + search_path`);
    assert.ok(after.includes("pg_catalog.pg_advisory_xact_lock(190726, 1)"), `${name}: setup lock`);
  }
});

test("PT409: every PT409 is a business-stale refusal carrying the unchanged stale message", () => {
  const raises = [...pt409.matchAll(/raise exception '([^']*)'\s+using errcode = 'PT409'/g)].map((m) => m[1]);
  assert.deepEqual(raises, [
    "Project Setup changed since this page loaded. Reload before saving.",
    "Project Setup changed since this page loaded. Reload before saving.",
    "[STALE] The project changed since this page loaded. Reload before saving.",
    "[STALE] The project changed since this page loaded. Reload before correcting.",
  ]);
  assert.doesNotMatch(withoutComments(pt409), /40001|serialization_failure/);
});

test("PT409: the live functions raise no 40001 except the genuine Weekly concurrency retry", () => {
  const live = liveDefinitions();
  for (const [name] of RECREATED) {
    // Parties (2C.3A) and its professional fields (2C.3B) extend only the
    // relation dispatcher and retain the PT409 contract. 13.9B Step 2
    // re-creates the Project Type correction for the legacy bootstrap and
    // keeps its PT409 stale refusal. 13.9B Step 4 re-creates the relation
    // dispatcher so its Programs & Studies branch saves differences only;
    // every other branch, and the PT409 stale refusal, is unchanged.
    const expected = {
      save_project_setup_relation: "20261019090000_project_setup_structure_governance.sql",
      correct_project_structure_family: "20261017090000_project_setup_finalise_reported_progress.sql",
    }[name] ?? PT409_FILE;
    assert.equal(live.get(name)?.file, expected, name);
  }
  assert.match(live.get("correct_project_structure_family").body,
    /\[STALE\] The project changed since this page loaded\. Reload before correcting\.'\s+using errcode = 'PT409'/);
  const serialization = [...live.values()]
    .filter((d) => /errcode\s*=\s*'(?:40001|serialization_failure)'|sqlstate\s*'40001'/i.test(withoutComments(d.body)))
    .map((d) => `${d.file}:${d.name}`);
  // A concurrent Weekly insert not yet visible: retrying IS the right answer.
  assert.deepEqual(serialization, ["20260824121615_reporting_integration_wave1.sql:submit_finalized_weekly_milestones"]);
  assert.doesNotMatch(pt409, /submit_finalized_weekly_milestones/);
  const stale = [...live.values()].filter((d) => /errcode = 'PT409'/.test(d.body)).map((d) => d.name).sort();
  // 2C.3C adds three membership writers, and 2C.3D the per-unit people
  // writer, all born with the same business-stale refusal. 13.9B adds the
  // three Project Setup amendment functions (stale base, pending, decided).
  const LATER_PT409 = ["add_project_member", "end_project_member", "update_project_member",
    "save_structure_unit_responsibilities",
    "request_project_setup_amendment", "decide_project_setup_amendment", "withdraw_project_setup_amendment",
    // 13.9B Step 2: finalisation and Reported Progress writers (duplicate / not current).
    "finalise_project_setup", "guard_setup_finalisation_entry", "record_reported_progress",
    "reported_progress_supersede", "guard_reported_progress_entry",
    // 13.9B Step 4: a second pending request on the same structure target,
    // and an approved structure change whose row has gone.
    "request_project_structure_amendment", "project_setup_apply_structure"];
  assert.deepEqual(stale, [...RECREATED.map(([name]) => name), ...LATER_PT409].sort());
});

test("PT409: committed migrations are untouched (historic definitions keep 40001)", () => {
  for (const [name, file, delimiter] of RECREATED) {
    assert.match(block(read(file), name, delimiter), /errcode = '40001'/, `${file}: ${name}`);
  }
  assert.match(read("20261001000001_project_setup_classification.sql"), /\[STALE\] The project changed since this page loaded\. Reload before correcting\.'\s+using errcode = '40001'/);
});

/* ------------------------- rehearsal script 111 ------------------------- */

const script = readFileSync(new URL("../../../scripts/p0-validation/111_runtime_2c1c_service_concurrency.mjs", import.meta.url), "utf8")
  .replaceAll("\r", "");

test("script 111: S5 and S6 require a prompt PT409 stale refusal, never 40001", () => {
  assert.match(script, /const PROMPT_MS = 5_000;/);
  const s5 = script.slice(script.indexOf("S5 Project Setup -> Structure ---"), script.indexOf("S6 Structure -> Project Setup ---"));
  const s6 = script.slice(script.indexOf("S6 Structure -> Project Setup ---"), script.indexOf("S7 mixed getStructure read ---"));
  for (const [label, section] of [["S5", s5], ["S6", s6]]) {
    assert.match(section, /const started = performance\.now\(\);/, label);
    assert.match(section, /came back promptly \(under \$\{PROMPT_MS\} ms\), not retried until a timeout/, label);
    assert.match(section, /elapsed < PROMPT_MS/, label);
    assert.doesNotMatch(section, /"40001"/, label);
  }
  assert.match(s5, /reasonOf\(refusal\) === "stale"/);
  assert.match(s5, /!\(refusal instanceof TimeoutError\)/);
  assert.match(s5, /JSON\.stringify\(levelRows\(\)\) === JSON\.stringify\(levelsBefore\)/);
  assert.match(s6, /setup\.error\?\.code === "PT409" && setup\.status === 409/);
  assert.match(s6, /afterSave\.isNull === beforeSave\.isNull && afterSave\.description === beforeSave\.description/);
  assert.match(s6, /sameInstant\(afterSave\.version, beforeSave\.version\)/);
});

test("script 111: the success contract is 76 checks (74 + one prompt check each in S5 and S6)", () => {
  // Call sites (plus the helper's own definition); S1/S2 share raceOnNode and
  // the residue loop adds 10, so the runtime total is derived in the report.
  assert.equal([...script.matchAll(/\bcheck\((s|S\.s9|entry),/g)].length, 59);
});

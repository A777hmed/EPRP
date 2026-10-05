// Phase 2C.1c-b Other Project Structure — SERVICE CONCURRENCY rehearsal.
// LOCAL MAIN SUPABASE ONLY.
//
// DRAFT: written for review, NOT YET RUN against any database.
//
// Proves the structure service contract over the REAL request path: separate
// HTTP requests from separately signed-in callers, through the local Auth
// service and PostgREST, into the main local database. A SQL-only proof is not
// valid here: the node set_updated_at trigger uses now(), which is stable
// inside one transaction, so several writes in one SQL transaction would all
// carry the same token. Every write below is its own request and transaction.
//
// The structure calls go through the application's own factory,
// createSupabaseProjectStructureService(getClient), given a per-user
// supabase-js client. Nothing in src/ is modified or mocked. The Project Setup
// save calls the same RPC (save_project_setup_patch) with the same argument
// names the Project Setup service sends.
//
// ------------------------------------------------------------------------
// TARGET SAFETY — fails closed before any write
// ------------------------------------------------------------------------
//   Required, explicitly:
//     EPRP_REHEARSAL_TARGET = eprp-main-local
//     EPRP_EXPECTED_CLUSTER = PostgreSQL system identifier of the MAIN local
//                             container (supabase_db_eprp) — see HOW TO RUN
//     EPRP_LOCAL_ANON_KEY   = the LOCAL stack's anon / publishable key
//                             (not needed for --cleanup-only)
//   Optional:
//     EPRP_LOCAL_SUPABASE_URL   (default http://127.0.0.1:<[api] port>)
//     EPRP_REHEARSAL_STATE_DIR  (default <OS temp>/eprp-rehearsal-111)
//
//   Before anything is written, ALL of these must hold:
//     1. supabase/config.toml says project_id = "eprp"; the database container
//        is therefore supabase_db_eprp (never the -restore-a container);
//     2. ONE Docker target is resolved and validated — DOCKER_CONTEXT if set
//        (it wins over DOCKER_HOST), else DOCKER_HOST, else the current
//        context by name — and its endpoint must be local (a local named
//        pipe, a unix socket, or tcp on a loopback host; ssh and remote tcp
//        are refused). Every later docker command is pinned to it with
//        --context <name> or -H <host>, with DOCKER_HOST / DOCKER_CONTEXT
//        removed from the child environment;
//     3. the API URL is plain http on a loopback host, on config.toml's [api]
//        port — a hosted Supabase URL can never pass; every HTTP request is
//        held to that origin and redirects are refused, never followed;
//     4. the key is not a secret / service_role key, and not a hosted key
//        (a legacy JWT key carrying a project `ref` is refused);
//     5. in a READ ONLY transaction: the connection is a Unix socket or
//        loopback, the cluster's system identifier equals
//        EPRP_EXPECTED_CLUSTER (the value that tells main from restore), the
//        database is "postgres", the 2C.1 / 2C.1c objects exist, and the local
//        P0 fixtures exist;
//   and, once the fixtures exist:
//     6. BINDING PROOF — both callers sign in through the local Auth service
//        with passwords generated for THIS run, and read back this run's
//        fixture project (random run id in its name) over HTTP. So the HTTP
//        endpoint is proven to serve the very cluster verified in 5.
//   Every later psql call re-checks the cluster identifier first.
//   No service_role key is read or used. No production value appears here.
//
// ------------------------------------------------------------------------
// FIXTURE OWNERSHIP — exact IDs only, never a name, code or prefix
// ------------------------------------------------------------------------
//   Each run has a random run id. EVERY fixture row gets a random UUID chosen
//   by this script before it is inserted (project type, both projects, both
//   users, their auth identities, contacts, profiles and the four
//   assignments). Structure levels and units are created through the service
//   and their returned IDs are recorded as soon as they are known.
//
//   The IDs are written to a local MANIFEST (<state dir>/<run id>.json) BEFORE
//   the fixture insert runs, and updated as structure rows appear. It holds
//   IDs and the target cluster id only — never a password or key.
//
//   Cleanup deletes exactly the manifest's IDs. Structure rows also go with
//   their exact owned project (ON DELETE CASCADE), which covers a unit that
//   was committed in the instant before an interruption, before its ID could
//   be recorded. No DELETE uses LIKE, a prefix, a fixed UUID, or a name.
//   The manifest is removed only after a zero-residue check passes.
//
// HOW TO RUN (from eprp/, local stack only)
//   Prerequisites on the MAIN local database: 00_local_test_identity.sql
//   (it also mirrors the platform table grants) and 01_setup_test_fixtures.sql.
//   1. Read the MAIN container's identifier (read-only):
//        docker exec supabase_db_eprp psql -U postgres -d postgres -tAc "select system_identifier from pg_control_system()"
//   2. Take the LOCAL anon (or publishable) key from `npx supabase status`.
//   3. PowerShell:
//        $env:EPRP_REHEARSAL_TARGET = "eprp-main-local"
//        $env:EPRP_EXPECTED_CLUSTER = "<value from step 1>"
//        $env:EPRP_LOCAL_ANON_KEY   = "<local key from step 2>"
//        node --experimental-transform-types --import ./src/features/notifications/test-runtime.mjs scripts/p0-validation/111_runtime_2c1c_service_concurrency.mjs
//   The run id and manifest path are printed first. If a run is interrupted
//   and its own cleanup did not finish, remove its fixtures with:
//        node --experimental-transform-types --import ./src/features/notifications/test-runtime.mjs scripts/p0-validation/111_runtime_2c1c_service_concurrency.mjs --cleanup-only --run-id <run id>
//   (same target guards; refuses without a valid manifest for that run id).
//   A new run refuses to start while an unfinished manifest exists.
//
// BOUNDED COMPLETION
//   Every HTTP / Auth request has a deadline and refuses redirects; every
//   service call, sign-in and sign-out has an operation deadline; every
//   docker / psql process has a process deadline and a server-side
//   statement / lock / idle timeout; the lock holder releases itself after a
//   few seconds even if this process dies. A timeout is a FAIL and cleanup
//   still runs. SIGINT / SIGTERM abort in-flight requests, run cleanup, then
//   exit; a second signal exits at once (then use --cleanup-only). SIGKILL
//   cannot be handled: use --cleanup-only with the printed run id.
//
// SCENARIOS (one PASS/FAIL row each; a row passes only if all its checks pass)
//   S0 target + binding      S5 Project Setup -> Structure: stale levels save
//   S1 same node, diff field S6 Structure -> Project Setup: stale setup save
//   (S5 / S6 also require the stale refusal to come back promptly: PT409, not
//   the 40001 that PostgREST retries)
//   S2 same node, same field S7 mixed getStructure read refused
//   S3 stale delete          S8 level id rule through the real RPC
//   S4 different nodes       S9 cleanup leaves no rehearsal rows
//
// CONCURRENCY BARRIER (S1, S2, S4)
//   A separate psql session (application_name unique to this run) takes the
//   Project Setup advisory lock (190726, 1) — the lock every setup writer,
//   including each structure statement, takes first. Then:
//     1. baseline: NO session may be waiting for that lock (else refused);
//     2. exactly the two rehearsal requests are launched;
//     3. while the lock is still held, exactly TWO new backends must be found
//        waiting for it, each: the PostgREST login role, blocked by this run's
//        holder, its statement started after the baseline, and running an
//        UPDATE of public.project_structure_nodes that assigns exactly the
//        columns this scenario's requests assign; confirmed on a second look;
//     4. only then is the holder cancelled, releasing the lock.
//   After release, every successful write is tied to its waiter exactly: the
//   stored updated_at (now() = transaction start) must equal the recorded
//   xact_start of one of the two waiting backends.
//
// Exit codes: 0 all PASS · 1 any FAIL · 2 refused before any write.

import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { setMaxListeners } from "node:events";
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { createSupabaseProjectStructureService } from "../../src/services/supabase-project-structure-service.ts";

/* ================================ constants =============================== */

const TARGET = "eprp-main-local";
const MANIFEST_KIND = "eprp-rehearsal-111";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Deadlines (milliseconds unless noted).
const HTTP_TIMEOUT_MS = 15_000; // one HTTP / Auth request
const OP_TIMEOUT_MS = 40_000; // one service call, sign-in or sign-out
const SCENARIO_TIMEOUT_MS = 120_000;
const PSQL_TIMEOUT_MS = 30_000; // one psql process
const PSQL_STATEMENT_S = 20; // server-side statement_timeout for psql calls
const TEARDOWN_TIMEOUT_MS = 90_000;
const TEARDOWN_STATEMENT_S = 60;
const DOCKER_CLI_TIMEOUT_MS = 15_000;
const HOLDER_ACQUIRE_MS = 10_000; // holder must own the lock by then
const HOLDER_MAX_HOLD_S = 7; // holder releases itself after this, whatever happens
const BARRIER_MS = 4_000; // from launch until both waiters must be proven
const RELEASE_MS = 10_000; // holder must exit after cancel by then
const POLL_MS = 100;
// A stale refusal must come back at once. PostgREST retries SQLSTATE 40001, so
// a stale raise with that code looped until the HTTP deadline (first run of
// this script, S5 / S6); the database now raises PT409, which is not retried.
const PROMPT_MS = 5_000;

/* ============================== arguments ================================= */

const args = process.argv.slice(2);
const cleanupOnly = args.includes("--cleanup-only");
const runIdArg = args.includes("--run-id") ? args[args.indexOf("--run-id") + 1] : undefined;
for (const [i, arg] of args.entries()) {
  if (arg === "--cleanup-only" || arg === "--run-id" || args[i - 1] === "--run-id") continue;
  refuse(`unknown argument ${JSON.stringify(arg)}.`);
}
if (cleanupOnly && !UUID.test(runIdArg ?? "")) refuse("--cleanup-only requires --run-id <run id printed by the run>.");
if (!cleanupOnly && runIdArg !== undefined) refuse("--run-id is only accepted with --cleanup-only.");

const runId = cleanupOnly ? runIdArg.toLowerCase() : randomUUID();
const short = runId.slice(0, 8);
const PSQL_APP = `eprp-111-${short}-psql`;
const HOLDER_APP = `eprp-111-${short}-holder`;

/* ============================== small helpers ============================= */

const secrets = [];

function refuse(message) {
  process.stderr.write(`REFUSING TO RUN: ${message}\n`);
  process.exit(2);
}

function say(line = "") {
  process.stdout.write(`${line}\n`);
}

/** Never print a generated password or the key. */
function scrub(text) {
  let out = String(text ?? "");
  for (const secret of secrets) if (secret) out = out.split(secret).join("***");
  return out;
}

function lit(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function uuidArray(ids) {
  for (const id of ids) if (!UUID.test(id)) throw new Error("refusing a non-UUID fixture id");
  return `array[${ids.map(lit).join(", ")}]::uuid[]`;
}

function reasonOf(error) {
  return error && typeof error === "object" && "reason" in error ? error.reason : undefined;
}

function describe(error) {
  if (!error) return "unknown error";
  const reason = reasonOf(error);
  if (reason) return `refused: ${reason}`;
  return scrub(error.message ?? String(error)).split(/\r?\n/)[0].slice(0, 200);
}

class TimeoutError extends Error {}

/* ===================== run-wide abort, signals, children ================== */

const runAbort = new AbortController();
setMaxListeners(10_000, runAbort.signal);
const children = new Set();
let holderActive = false;
let stopReason = "";
let signals = 0;

// The validated Docker target (see docker-target below). Until it is set, no
// docker command can run: the wrappers below refuse rather than fall back.
let DOCKER_PIN = null;
let DOCKER_ENV = null;

function pinned(cliArgs) {
  if (!DOCKER_PIN || !DOCKER_ENV) throw new Error("refusing an unpinned docker command");
  return [...DOCKER_PIN, ...cliArgs];
}

/** The only synchronous docker entry point after resolution. */
function dockerSync(cliArgs, options = {}) {
  return spawnSync("docker", pinned(cliArgs), { ...options, env: DOCKER_ENV, windowsHide: true });
}

/** The only asynchronous docker entry point after resolution. */
function dockerSpawn(cliArgs, options = {}) {
  return spawn("docker", pinned(cliArgs), { ...options, env: DOCKER_ENV, windowsHide: true });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Rejects on timeout or on run interruption; settles the race either way. */
function withDeadline(promise, ms, label) {
  let timer;
  let onAbort;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${label} exceeded ${ms} ms`)), ms);
    onAbort = () => reject(new Error(`${label} interrupted: ${stopReason || "run aborted"}`));
    if (runAbort.signal.aborted) onAbort();
    else runAbort.signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([Promise.resolve(promise), guard]).finally(() => {
    clearTimeout(timer);
    runAbort.signal.removeEventListener("abort", onAbort);
  });
}

function op(label, fn) {
  return withDeadline(Promise.resolve().then(fn), OP_TIMEOUT_MS, label);
}

function killChildren() {
  for (const child of children) {
    try {
      child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

function onSignal(name) {
  signals += 1;
  if (signals > 1) {
    process.stderr.write(`\nSecond ${name}: exiting now. Remove this run's fixtures with --cleanup-only --run-id ${runId}\n`);
    killChildren();
    process.exit(130);
  }
  stopReason = `interrupted by ${name}`;
  process.stderr.write(`\n${name} received: aborting requests, then cleaning up (press again to exit at once).\n`);
  runAbort.abort(new Error(stopReason));
}
process.on("SIGINT", () => onSignal("SIGINT"));
process.on("SIGTERM", () => onSignal("SIGTERM"));
process.on("unhandledRejection", (error) => {
  stopReason ||= `unexpected rejection: ${describe(error)}`;
});
process.on("exit", () => {
  killChildren();
  if (holderActive) {
    // Best effort; the holder also releases itself after HOLDER_MAX_HOLD_S.
    try {
      dockerSync(psqlArgs(), {
        input: `select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity where application_name = ${lit(HOLDER_APP)};`,
        timeout: 5_000,
      });
    } catch {
      // Nothing more can be done from an exiting process.
    }
  }
});

/* ===================== guard 1–4 (no database writes) ===================== */

const env = process.env;
if (env.EPRP_REHEARSAL_TARGET !== TARGET) refuse(`set EPRP_REHEARSAL_TARGET=${TARGET} (see HOW TO RUN).`);
const EXPECTED_CLUSTER = (env.EPRP_EXPECTED_CLUSTER ?? "").trim();
if (!/^\d{6,25}$/.test(EXPECTED_CLUSTER)) {
  refuse("set EPRP_EXPECTED_CLUSTER to the system identifier of supabase_db_eprp (see HOW TO RUN).");
}

const configText = readFileSync(new URL("../../supabase/config.toml", import.meta.url), "utf8");
function tomlValue(section, key) {
  let current = "";
  for (const raw of configText.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      current = header[1].trim();
      continue;
    }
    const pair = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (pair && current === section && pair[1] === key) return pair[2].trim().replace(/^"(.*)"$/, "$1");
  }
  return undefined;
}
const projectId = tomlValue("", "project_id");
if (projectId !== "eprp") refuse(`supabase/config.toml project_id is "${projectId}", expected "eprp".`);
const CONTAINER = `supabase_db_${projectId}`;
if (/restore/i.test(CONTAINER)) refuse("the database container is a restore container.");
const apiPort = tomlValue("api", "port");
if (!/^\d+$/.test(apiPort ?? "")) refuse("cannot read the [api] port from supabase/config.toml.");

// --- docker-target:begin --------------------------------------------------
// Pure resolution of the ONE Docker target this run may use. All I/O goes
// through `run(args)`, so the precedence can be tested in isolation.
//   1. DOCKER_CONTEXT set  -> that exact context (it wins over DOCKER_HOST);
//   2. else DOCKER_HOST    -> that exact host;
//   3. else                -> the current context, resolved by name.
// The chosen endpoint must be local, and the result is a PIN that every later
// docker command carries (--context <name> or -H <host>). `run` is called with
// DOCKER_HOST / DOCKER_CONTEXT removed from its environment, the same
// environment every pinned command gets, so what is inspected is what runs.
const DOCKER_CONTEXT_NAME = /^[A-Za-z0-9][A-Za-z0-9_.+-]*$/;

function isLocalDockerEndpoint(host) {
  if (typeof host !== "string") return false;
  // Windows named pipe on THIS machine ("." is the local host): Docker Desktop.
  if (/^npipe:\/\/\/?\/?\.\/pipe\/[^/\s]+$/i.test(host)) return true;
  if (/^unix:\/\/\/\S+$/i.test(host)) return true;
  return /^tcp:\/\/(\[::1\]|127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(host);
}

function maskDockerHost(host) {
  return String(host).replace(/\/\/[^/@]*@/, "//***@");
}

function resolveDockerTarget(environment, run) {
  const contextVar = (environment.DOCKER_CONTEXT ?? "").trim();
  const hostVar = (environment.DOCKER_HOST ?? "").trim();

  let name;
  let source;
  if (contextVar) {
    name = contextVar;
    source = hostVar ? "DOCKER_CONTEXT (DOCKER_HOST ignored)" : "DOCKER_CONTEXT";
  } else if (hostVar) {
    if (!isLocalDockerEndpoint(hostVar)) {
      return { error: `DOCKER_HOST is not a local Docker endpoint (${maskDockerHost(hostVar)}).` };
    }
    return { pin: ["-H", hostVar], source: "DOCKER_HOST", host: hostVar };
  } else {
    const shown = run(["context", "show"]);
    if (!shown.ok) return { error: `cannot resolve the current Docker context (${shown.error}).` };
    name = shown.stdout.trim();
    source = "current context";
  }

  if (!DOCKER_CONTEXT_NAME.test(name)) return { error: `"${name}" is not a valid Docker context name.` };
  const inspected = run(["context", "inspect", name]);
  if (!inspected.ok) return { error: `cannot inspect Docker context ${name} (${inspected.error}).` };
  let host;
  try {
    const parsed = JSON.parse(inspected.stdout);
    if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0]?.Name !== name) throw new Error("shape");
    host = parsed[0].Endpoints?.docker?.Host;
  } catch {
    return { error: `unexpected output inspecting Docker context ${name}.` };
  }
  if (!isLocalDockerEndpoint(host)) {
    return { error: `Docker context ${name} (from ${source}) is not a local endpoint (${maskDockerHost(host)}).` };
  }
  return { pin: ["--context", name], source, context: name, host };
}
// --- docker-target:end ----------------------------------------------------

// Every docker process gets this environment: DOCKER_HOST / DOCKER_CONTEXT
// removed, so only the explicit pin decides the target.
DOCKER_ENV = { ...env };
delete DOCKER_ENV.DOCKER_HOST;
delete DOCKER_ENV.DOCKER_CONTEXT;

/** Resolution-only docker calls (context show / inspect <name>), bounded. */
function runDockerCli(cliArgs) {
  const result = spawnSync("docker", cliArgs, {
    encoding: "utf8", timeout: DOCKER_CLI_TIMEOUT_MS, killSignal: "SIGKILL", windowsHide: true, env: DOCKER_ENV,
  });
  const error = result.error ? result.error.code ?? result.error.message : result.status !== 0 ? `exit ${result.status}` : "";
  return { ok: !error, stdout: result.stdout ?? "", error };
}

const docker = resolveDockerTarget(env, runDockerCli);
if (docker.error) refuse(docker.error);
DOCKER_PIN = Object.freeze([...docker.pin]);

const SUPABASE_URL = (env.EPRP_LOCAL_SUPABASE_URL ?? `http://127.0.0.1:${apiPort}`).replace(/\/+$/, "");
let API_ORIGIN;
{
  let url;
  try {
    url = new URL(SUPABASE_URL);
  } catch {
    refuse("EPRP_LOCAL_SUPABASE_URL is not a URL.");
  }
  if (url.protocol !== "http:") refuse("the API URL must be plain http on the local stack.");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) refuse("the API URL is not a loopback host.");
  if (url.port !== apiPort) refuse(`the API URL port must be the local [api] port ${apiPort}.`);
  API_ORIGIN = url.origin;
}

const ANON_KEY = (env.EPRP_LOCAL_ANON_KEY ?? "").trim();
if (!cleanupOnly) {
  if (!ANON_KEY) refuse("set EPRP_LOCAL_ANON_KEY to the LOCAL anon / publishable key (see HOW TO RUN).");
  secrets.push(ANON_KEY);
  if (ANON_KEY.startsWith("sb_secret_")) refuse("that is a secret key; only the local anon / publishable key is accepted.");
  if (ANON_KEY.split(".").length === 3) {
    let claims;
    try {
      claims = JSON.parse(Buffer.from(ANON_KEY.split(".")[1], "base64url").toString("utf8"));
    } catch {
      refuse("the key is not a readable JWT.");
    }
    if (claims.role !== "anon") refuse("the key is not an anon key.");
    if ("ref" in claims) refuse("the key belongs to a hosted Supabase project.");
  }
}

/* ================================ manifest ================================ */

const STATE_DIR = env.EPRP_REHEARSAL_STATE_DIR ? resolve(env.EPRP_REHEARSAL_STATE_DIR) : join(tmpdir(), "eprp-rehearsal-111");
const MANIFEST_PATH = join(STATE_DIR, `${runId}.json`);
const ID_KINDS = ["projectTypes", "projects", "users", "identities", "contacts", "profiles", "assignments", "levels", "nodes"];
const ID_LIMITS = { projectTypes: 1, projects: 2, users: 2, identities: 2, contacts: 2, profiles: 2, assignments: 4, levels: 8, nodes: 16 };

let manifest;

function saveManifest() {
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  for (const secret of secrets) if (secret && text.includes(secret)) throw new Error("refusing to write a secret into the manifest");
  mkdirSync(STATE_DIR, { recursive: true });
  const temp = `${MANIFEST_PATH}.${process.pid}.tmp`;
  writeFileSync(temp, text, { encoding: "utf8", mode: 0o600 });
  renameSync(temp, MANIFEST_PATH);
}

function own(kind, id) {
  if (!UUID.test(id ?? "")) throw new Error(`refusing to record a non-UUID ${kind} id`);
  if (!manifest.ids[kind].includes(id)) {
    manifest.ids[kind].push(id);
    saveManifest();
  }
}

/** Cleanup-only: the manifest must exist, be well formed, and match this target. */
function loadManifest() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    refuse(`no readable manifest for run ${runId} at ${MANIFEST_PATH}.`);
  }
  if (parsed?.kind !== MANIFEST_KIND || parsed.version !== 1 || parsed.runId !== runId) {
    refuse("the manifest is not a script-111 manifest for this run id.");
  }
  if (parsed.cluster !== EXPECTED_CLUSTER || parsed.container !== CONTAINER) {
    refuse("the manifest was written for a different database cluster.");
  }
  for (const kind of ID_KINDS) {
    const ids = parsed.ids?.[kind];
    if (!Array.isArray(ids) || ids.length > ID_LIMITS[kind] || !ids.every((id) => typeof id === "string" && UUID.test(id))) {
      refuse(`the manifest's ${kind} list is not valid.`);
    }
  }
  if (Object.keys(parsed.ids).some((kind) => !ID_KINDS.includes(kind))) refuse("the manifest has unexpected entries.");
  return parsed;
}

/* ============================== psql (as postgres) ======================== */

function psqlArgs() {
  return ["exec", "-i", CONTAINER, "psql", "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-f", "-"];
}

const clusterCheck = `do $c$ begin
  if (select system_identifier::text from pg_catalog.pg_control_system()) is distinct from ${lit(EXPECTED_CLUSTER)} then
    raise exception 'REFUSING TO RUN: not the expected main local cluster.';
  end if;
end $c$;
`;

function sessionPrefix(statementSeconds) {
  return `set statement_timeout = '${statementSeconds}s';
set lock_timeout = '10s';
set idle_in_transaction_session_timeout = '${statementSeconds + 5}s';
set application_name = ${lit(PSQL_APP)};
${clusterCheck}`;
}

class PsqlError extends Error {}

/** Runs SQL in the verified main container, bounded on both sides. */
function psql(sql, { timeoutMs = PSQL_TIMEOUT_MS, statementSeconds = PSQL_STATEMENT_S } = {}) {
  const result = dockerSync(psqlArgs(), {
    input: sessionPrefix(statementSeconds) + sql, encoding: "utf8",
    timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    if (result.error.code === "ETIMEDOUT") throw new TimeoutError(`psql exceeded ${timeoutMs} ms`);
    throw new PsqlError(`docker exec failed: ${result.error.code ?? result.error.message}`);
  }
  if (result.status !== 0) {
    const firstError = (result.stderr || "").split(/\r?\n/).find((line) => /ERROR|FATAL|psql:/.test(line));
    throw new PsqlError(scrub(firstError ?? `psql exited ${result.status}`));
  }
  return result.stdout.split(/\r?\n/).filter((line) => line.length > 0);
}

/**
 * The same, without blocking the event loop — used while rehearsal requests
 * are in flight. Killed at its deadline; the server-side timeouts still apply.
 */
function psqlAsync(sql, { timeoutMs = PSQL_TIMEOUT_MS, statementSeconds = PSQL_STATEMENT_S } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = dockerSpawn(psqlArgs(), { stdio: ["pipe", "pipe", "pipe"] });
    children.add(child);
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new TimeoutError(`psql exceeded ${timeoutMs} ms`));
    }, timeoutMs);
    const settle = () => {
      clearTimeout(timer);
      children.delete(child);
    };
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.stdin.on("error", () => {
      // Exit is reported through "close" / "error".
    });
    child.on("error", (error) => {
      settle();
      reject(new PsqlError(`docker exec failed: ${error.code ?? error.message}`));
    });
    child.on("close", (code) => {
      settle();
      if (code === 0) resolvePromise(out.split(/\r?\n/).filter((line) => line.length > 0));
      else reject(new PsqlError(scrub(err.split(/\r?\n/).find((line) => /ERROR|FATAL|psql:/.test(line)) ?? `psql exited ${code}`)));
    });
    child.stdin.end(sessionPrefix(statementSeconds) + sql);
  });
}

function parseOneJson(lines) {
  if (lines.length !== 1) throw new PsqlError(`expected one JSON line, got ${lines.length}`);
  return JSON.parse(lines[0]);
}

/** One jsonb value per query, printed on one line. */
function psqlJson(sql) {
  return parseOneJson(psql(sql));
}

function psqlTrue(sql) {
  return psqlJson(`select to_jsonb(coalesce((${sql.replace(/;\s*$/, "")}), false));`) === true;
}

/* ============================ guard 5 (read only) ========================= */

function readOnlyGuard() {
  // Not prefixed with clusterCheck: this block reports the mismatch itself.
  const sql = `set statement_timeout = '${PSQL_STATEMENT_S}s';
set application_name = ${lit(PSQL_APP)};
begin transaction read only;
do $guard$
declare v_cluster text;
begin
  if inet_server_addr() is not null and host(inet_server_addr()) not in ('127.0.0.1', '::1') then
    raise exception 'REFUSING TO RUN: not a Unix-socket or loopback connection.';
  end if;
  begin
    select system_identifier::text into v_cluster from pg_catalog.pg_control_system();
  exception when others then
    raise exception 'REFUSING TO RUN: cannot read this cluster''s system identifier.';
  end;
  if v_cluster is distinct from ${lit(EXPECTED_CLUSTER)} then
    raise exception 'REFUSING TO RUN: this is not the expected main local cluster (connected cluster %).', v_cluster;
  end if;
  if current_database() <> 'postgres' then
    raise exception 'REFUSING TO RUN: unexpected database %.', current_database();
  end if;
  if to_regclass('public.project_structure_nodes') is null
     or to_regclass('public.project_structure_levels') is null
     or to_regclass('public.project_classification_corrections') is null
     or to_regprocedure('public.configure_project_structure_levels(uuid,timestamptz,jsonb)') is null
     or to_regprocedure('public.save_project_setup_patch(uuid,timestamptz,jsonb,jsonb)') is null then
    raise exception 'REFUSING TO RUN: the Phase 2C.1 / 2C.1c migrations are not applied here.';
  end if;
  if to_regprocedure('extensions.crypt(text,text)') is null then
    raise exception 'REFUSING TO RUN: pgcrypto (extensions.crypt) is not available.';
  end if;
  if not exists (select 1 from public.projects where code = 'ZZ-P0TEST-PRJ')
     or not exists (select 1 from auth.users
                     where id = '00000000-0000-4000-a000-0000000000a1' and email like '%@example.invalid') then
    raise exception 'REFUSING TO RUN: local P0 fixtures not found — run 00_local_test_identity.sql and 01_setup_test_fixtures.sql on the MAIN local database first.';
  end if;
end;
$guard$;
rollback;
`;
  const result = dockerSync(psqlArgs(), {
    input: sql, encoding: "utf8", timeout: PSQL_TIMEOUT_MS, killSignal: "SIGKILL",
  });
  if (result.error) refuse(`cannot reach the ${CONTAINER} container (${result.error.code ?? result.error.message}).`);
  if (result.status !== 0) {
    const line = (result.stderr || "").split(/\r?\n/).find((l) => /ERROR|FATAL|psql:|Error/.test(l));
    refuse(scrub(line ?? `psql exited ${result.status}`).replace(/^.*?REFUSING TO RUN: /, ""));
  }
}

/* ================================ fixtures ================================ */

/** Every ID is chosen here, before the insert, so the manifest can list it first. */
function planFixtures() {
  const ids = {
    projectType: randomUUID(),
    main: randomUUID(), levels: randomUUID(),
    userA: randomUUID(), userB: randomUUID(),
    identityA: randomUUID(), identityB: randomUUID(),
    contactA: randomUUID(), contactB: randomUUID(),
    assignments: [randomUUID(), randomUUID(), randomUUID(), randomUUID()],
  };
  return {
    ids,
    mainCode: `ZZ-111-${short}-MAIN`, mainName: `ZZ 111 ${runId} MAIN`,
    levelsCode: `ZZ-111-${short}-LEVELS`, levelsName: `ZZ 111 ${runId} LEVELS`,
    typeCode: `ZZ-111-${short}-CAT`,
    emailA: `p0test.111-${short}-a@example.invalid`, emailB: `p0test.111-${short}-b@example.invalid`,
    contactNameA: `ZZ-P0TEST 111 ${short} PCM A`, contactNameB: `ZZ-P0TEST 111 ${short} PCM B`,
  };
}

function createFixtures(plan, passwordA, passwordB) {
  const { ids } = plan;
  const user = (id, email, password, name) => `(
    '00000000-0000-0000-0000-000000000000', ${lit(id)}, 'authenticated', 'authenticated', ${lit(email)},
    extensions.crypt(${lit(password)}, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', ${lit(name)}),
    now(), now(), '', '', '', '')`;
  const identity = (identityId, userId, email) => `(
    ${lit(identityId)}, ${lit(userId)}, ${lit(userId)},
    jsonb_build_object('sub', ${lit(userId)}, 'email', ${lit(email)}, 'email_verified', true),
    'email', now(), now())`;
  const [a1, a2, a3, a4] = ids.assignments;

  psql(`begin;
do $fx$
declare v_source uuid;
begin
  select id into strict v_source from public.projects where code = 'ZZ-P0TEST-PRJ';

  insert into public.project_types (id, name, code)
  values (${lit(ids.projectType)}, ${lit(`ZZ 111 ${short} Category`)}, ${lit(plan.typeCode)});

  insert into public.projects (id, code, name, client_id, planned_start_date, planned_finish_date,
                               status, structure_family, project_type_id)
  select v.id, v.code, v.name, p.client_id, p.planned_start_date, p.planned_finish_date,
         'active', 'other', ${lit(ids.projectType)}::uuid
    from public.projects p,
         (values (${lit(ids.main)}::uuid, ${lit(plan.mainCode)}, ${lit(plan.mainName)}),
                 (${lit(ids.levels)}::uuid, ${lit(plan.levelsCode)}, ${lit(plan.levelsName)})) v(id, code, name)
   where p.id = v_source;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values ${user(ids.userA, plan.emailA, passwordA, plan.contactNameA)},
           ${user(ids.userB, plan.emailB, passwordB, plan.contactNameB)};

  insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
  values ${identity(ids.identityA, ids.userA, plan.emailA)}, ${identity(ids.identityB, ids.userB, plan.emailB)};

  insert into public.contacts (id, name, email) values
    (${lit(ids.contactA)}, ${lit(plan.contactNameA)}, ${lit(plan.emailA)}),
    (${lit(ids.contactB)}, ${lit(plan.contactNameB)}, ${lit(plan.emailB)});

  -- Both callers: Project Control Manager on both fixture projects, nothing else.
  insert into public.project_contacts (id, project_id, contact_id, role) values
    (${lit(a1)}, ${lit(ids.main)}, ${lit(ids.contactA)}, 'project_control_manager'),
    (${lit(a2)}, ${lit(ids.levels)}, ${lit(ids.contactA)}, 'project_control_manager'),
    (${lit(a3)}, ${lit(ids.main)}, ${lit(ids.contactB)}, 'project_control_manager'),
    (${lit(a4)}, ${lit(ids.levels)}, ${lit(ids.contactB)}, 'project_control_manager');

  insert into public.profiles (id, email, full_name, role, contact_id, active) values
    (${lit(ids.userA)}, ${lit(plan.emailA)}, ${lit(plan.contactNameA)}, 'viewer', ${lit(ids.contactA)}, true),
    (${lit(ids.userB)}, ${lit(plan.emailB)}, ${lit(plan.contactNameB)}, 'viewer', ${lit(ids.contactB)}, true);
end;
$fx$;
commit;
`);
  const counts = psqlJson(`select jsonb_build_array(
    (select count(*) from public.projects where id = any(${uuidArray([ids.main, ids.levels])})),
    (select count(*) from auth.users where id = any(${uuidArray([ids.userA, ids.userB])})),
    (select count(*) from public.project_contacts where id = any(${uuidArray(ids.assignments)})),
    (select count(*) from public.profiles where id = any(${uuidArray([ids.userA, ids.userB])})));`);
  if (JSON.stringify(counts) !== "[2,2,4,2]") throw new PsqlError(`fixtures not created as planned (${counts})`);
}

/* ============================ cleanup by exact ID ========================= */

function teardownSql(ids) {
  return `begin;
-- Assignments, then the exact owned projects: their structure levels and
-- units go with them (ON DELETE CASCADE), recorded or not.
delete from public.project_contacts where id = any(${uuidArray(ids.assignments)});
delete from public.projects where id = any(${uuidArray(ids.projects)});
-- Recorded structure rows by exact ID (already removed above in a normal run).
delete from public.project_structure_nodes where id = any(${uuidArray(ids.nodes)}) and parent_id is not null;
delete from public.project_structure_nodes where id = any(${uuidArray(ids.nodes)});
delete from public.project_structure_levels where id = any(${uuidArray(ids.levels)});
delete from public.project_types where id = any(${uuidArray(ids.projectTypes)});
delete from public.profiles where id = any(${uuidArray(ids.profiles)});
delete from public.contacts where id = any(${uuidArray(ids.contacts)});
delete from auth.identities where id = any(${uuidArray(ids.identities)});
delete from auth.users where id = any(${uuidArray(ids.users)});
commit;
`;
}

function residue(ids) {
  return psqlJson(`select jsonb_build_array(
  (select count(*) from public.projects where id = any(${uuidArray(ids.projects)})),
  (select count(*) from public.project_structure_levels
    where id = any(${uuidArray(ids.levels)}) or project_id = any(${uuidArray(ids.projects)})),
  (select count(*) from public.project_structure_nodes
    where id = any(${uuidArray(ids.nodes)}) or project_id = any(${uuidArray(ids.projects)})),
  (select count(*) from public.project_contacts
    where id = any(${uuidArray(ids.assignments)}) or project_id = any(${uuidArray(ids.projects)})
       or contact_id = any(${uuidArray(ids.contacts)})),
  (select count(*) from public.contacts where id = any(${uuidArray(ids.contacts)})),
  (select count(*) from public.profiles where id = any(${uuidArray(ids.profiles)})),
  (select count(*) from auth.identities
    where id = any(${uuidArray(ids.identities)}) or user_id = any(${uuidArray(ids.users)})),
  (select count(*) from auth.users where id = any(${uuidArray(ids.users)})),
  (select count(*) from auth.sessions where user_id = any(${uuidArray(ids.users)})),
  (select count(*) from public.project_types where id = any(${uuidArray(ids.projectTypes)})),
  (select count(*) from public.projects where code = 'ZZ-P0TEST-PRJ'),
  (select count(*) from auth.users where id = '00000000-0000-4000-a000-0000000000a1'));`);
}
const RESIDUE_LABELS = ["projects", "structure levels", "structure units", "assignments", "contacts",
  "profiles", "auth identities", "auth users", "auth sessions", "project type"];

function cleanup(s) {
  try {
    psql(teardownSql(manifest.ids), { timeoutMs: TEARDOWN_TIMEOUT_MS, statementSeconds: TEARDOWN_STATEMENT_S });
    check(s, "teardown of this run's exact fixture IDs committed", true);
  } catch (error) {
    check(s, "teardown of this run's exact fixture IDs committed", false, describe(error));
  }
  const counts = residue(manifest.ids).map(Number);
  RESIDUE_LABELS.forEach((label, i) => check(s, `no rehearsal ${label} remain`, counts[i] === 0, `found ${counts[i]}`));
  check(s, "shared P0 fixtures untouched (ZZ-P0TEST-PRJ and the P0 admin still exist)", counts[10] === 1 && counts[11] === 1);
  if (s.checks.every((c) => c.ok)) {
    rmSync(MANIFEST_PATH, { force: true });
    say(`Manifest removed: ${MANIFEST_PATH}`);
  } else {
    manifest.status = "cleanup-failed";
    saveManifest();
    say(`Manifest KEPT for a retry: ${MANIFEST_PATH}`);
    say(`Retry: ... 111_runtime_2c1c_service_concurrency.mjs --cleanup-only --run-id ${runId}`);
  }
}

/* ================================ results ================================= */

const scenarios = [];

function scenario(id, title) {
  const entry = { id, title, checks: [], ran: false };
  scenarios.push(entry);
  return entry;
}

function check(entry, label, ok, detail = "") {
  entry.checks.push({ label, ok: Boolean(ok), detail: scrub(detail) });
}

/** Runs one scenario under a deadline. A timeout stops the run (cleanup still runs). */
async function run(entry, body) {
  if (runAbort.signal.aborted) return;
  entry.ran = true;
  try {
    await withDeadline(Promise.resolve().then(() => body(entry)), SCENARIO_TIMEOUT_MS, `${entry.id}`);
  } catch (error) {
    check(entry, "completed without an unexpected error or timeout", false, describe(error));
    if (error instanceof TimeoutError && !runAbort.signal.aborted) {
      stopReason = `${entry.id} timed out`;
      runAbort.abort(new Error(stopReason));
    }
  }
}

function passed(entry) {
  return entry.ran && entry.checks.length > 0 && entry.checks.every((c) => c.ok);
}

/* ===================== callers: real HTTP, real sign-in =================== */

function requestUrl(input) {
  return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
}

/** Every request: this origin only, a deadline, run abort, and no redirects. */
function boundedFetch(input, init = {}) {
  if (requestUrl(input).origin !== API_ORIGIN) {
    return Promise.reject(new Error("refused a request outside the local API origin"));
  }
  const parts = [AbortSignal.timeout(HTTP_TIMEOUT_MS), runAbort.signal];
  if (init.signal) parts.push(init.signal);
  return fetch(input, { ...init, redirect: "error", signal: AbortSignal.any(parts) });
}

/**
 * Timing seam for S7, at the transport only: when armed, the first structure
 * child read (levels / units) waits until another caller's write has
 * committed, and every send is logged in order. The service code is untouched.
 */
const gate = { armed: false, interleave: null, pending: null, events: [] };

function gatedFetch(input, init) {
  const path = requestUrl(input).pathname;
  if (!gate.armed || !path.startsWith("/rest/v1/")) return boundedFetch(input, init);
  const table = path.slice("/rest/v1/".length);
  const send = () => {
    gate.events.push(`read ${table}`);
    return boundedFetch(input, init);
  };
  if (table === "project_structure_levels" || table === "project_structure_nodes") {
    gate.pending ??= gate.interleave();
    return gate.pending.then(send);
  }
  return send();
}

function makeClient(name, fetchImpl) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `eprp-111-${short}-${name}` },
    global: { fetch: fetchImpl },
  });
}

/* ============================ concurrency barrier ========================= */

const NODE_UPDATE = /UPDATE\s+"public"\."project_structure_nodes"\s+SET\s+([\s\S]*?)\s+(?:FROM|WHERE)\s/i;

/** Columns a PostgREST UPDATE of project_structure_nodes assigns, or null. */
function assignedColumns(query) {
  const match = NODE_UPDATE.exec(query ?? "");
  if (!match) return null;
  return [...match[1].matchAll(/"(\w+)"\s*=/g)].map((m) => m[1]).sort();
}

/** Everything on the setup lock (190726, 1), as the superuser sees it. Non-blocking. */
async function lockSnapshot(mark) {
  const afterMark = mark ? `a.query_start > ${lit(mark)}::timestamptz` : "null::boolean";
  return parseOneJson(await psqlAsync(`select jsonb_build_object('now', clock_timestamp()::text, 'rows', coalesce((
  select jsonb_agg(jsonb_build_object(
           'pid', a.pid, 'granted', l.granted, 'app', a.application_name, 'role', a.usename::text,
           'xactStart', a.xact_start::text, 'afterMark', ${afterMark},
           'blockedBy', to_jsonb(pg_catalog.pg_blocking_pids(a.pid)), 'query', left(a.query, 1500))
         order by a.pid)
    from pg_catalog.pg_locks l join pg_catalog.pg_stat_activity a on a.pid = l.pid
   where l.locktype = 'advisory' and l.classid = 190726 and l.objid = 1 and l.objsubid = 2
     and l.database = (select oid from pg_catalog.pg_database where datname = current_database())), '[]'::jsonb));`));
}

function startHolder() {
  const sql = `set application_name = ${lit(HOLDER_APP)};
set lock_timeout = '5s';
set statement_timeout = '${HOLDER_MAX_HOLD_S + 3}s';
set idle_in_transaction_session_timeout = '${HOLDER_MAX_HOLD_S + 3}s';
${clusterCheck}begin;
select pg_catalog.pg_advisory_xact_lock(190726, 1);
select pg_catalog.pg_sleep(${HOLDER_MAX_HOLD_S});
commit;
`;
  const child = dockerSpawn(psqlArgs(), { stdio: ["pipe", "ignore", "pipe"] });
  children.add(child);
  holderActive = true;
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.stdin.on("error", () => {
    // The process may already have exited; its exit is handled below.
  });
  const done = new Promise((resolve) => {
    child.on("error", (error) => resolve({ code: null, error }));
    child.on("close", (code) => resolve({ code, error: null }));
  }).then((outcome) => {
    children.delete(child);
    return { ...outcome, stderr: scrub(stderr.split(/\r?\n/)[0] ?? "") };
  });
  child.stdin.end(sql);
  return { child, done, pid: null, exited: false };
}

/** Releases (or, failing that, kills) the holder. Never throws. */
async function stopHolder(holder) {
  try {
    psql(`select pg_catalog.pg_cancel_backend(pid) from pg_catalog.pg_stat_activity
           where application_name = ${lit(HOLDER_APP)};`);
  } catch {
    // Fall through to terminate / kill.
  }
  const exited = await Promise.race([holder.done.then(() => true), wait(RELEASE_MS).then(() => false)]);
  if (!exited) {
    try {
      psql(`select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity
             where application_name = ${lit(HOLDER_APP)};`);
    } catch {
      // The holder releases itself after HOLDER_MAX_HOLD_S regardless.
    }
    try {
      holder.child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
  }
  holderActive = false;
  return exited;
}

/**
 * Holds the setup lock, proves the two rehearsal requests are the only new
 * waiters, then releases it. Records three checks on `s`.
 */
async function underHeldLock(s, expectedColumns, startCalls) {
  const holder = startHolder();
  let launched = null;
  let baselineClean = false;
  let proven = false;
  let detail = "";
  let waiters = [];
  try {
    // 1. The holder owns the lock.
    const acquireBy = Date.now() + HOLDER_ACQUIRE_MS;
    let snap;
    for (;;) {
      if (runAbort.signal.aborted) throw new Error(stopReason || "run aborted");
      snap = await lockSnapshot(null);
      const mine = snap.rows.filter((r) => r.granted && r.app === HOLDER_APP);
      if (mine.length === 1) {
        holder.pid = mine[0].pid;
        break;
      }
      if (Date.now() > acquireBy) throw new TimeoutError("the lock holder never acquired the Project Setup lock");
      await wait(POLL_MS);
    }

    // 2. Clean baseline: nobody is waiting for the lock; remember who is there.
    const mark = snap.now;
    const baselinePids = new Set(snap.rows.map((r) => r.pid));
    const baselineWaiters = snap.rows.filter((r) => !r.granted);
    baselineClean = baselineWaiters.length === 0 && snap.rows.length === 1;
    check(s, "baseline: no session was waiting for the setup lock before launch", baselineClean,
      baselineClean ? `holder pid ${holder.pid}` : `pre-existing lock sessions: ${snap.rows.map((r) => r.pid).join(", ")}`);
    if (!baselineClean) throw new Error("baseline not clean — the race was not launched");

    // 3. Launch exactly the two rehearsal requests.
    launched = Promise.allSettled(startCalls());

    // 4. While the lock is held: exactly two new, attributable waiters, twice.
    const want = expectedColumns.map((cols) => [...cols].sort().join(",")).sort().join(" | ");
    const proveBy = Date.now() + BARRIER_MS;
    let candidate = null;
    for (;;) {
      if (runAbort.signal.aborted) throw new Error(stopReason || "run aborted");
      if (Date.now() > proveBy) {
        detail ||= "fewer than two rehearsal waiters appeared before the deadline";
        break;
      }
      const now = await lockSnapshot(mark);
      const holderRow = now.rows.find((r) => r.granted && r.pid === holder.pid);
      if (!holderRow) {
        detail = "the holder lost the lock before the barrier was proven";
        break;
      }
      const fresh = now.rows.filter((r) => !r.granted && !baselinePids.has(r.pid));
      const strangers = now.rows.filter((r) => r.pid !== holder.pid && !fresh.includes(r));
      if (strangers.length > 0 || fresh.length > 2) {
        detail = `unexplained lock sessions: ${[...strangers, ...fresh].map((r) => r.pid).join(", ")}`;
        break;
      }
      const attributed = fresh.filter((r) =>
        r.role === "authenticator" && r.afterMark === true && Array.isArray(r.blockedBy)
        && r.blockedBy.includes(holder.pid) && assignedColumns(r.query) !== null);
      if (attributed.length !== fresh.length) {
        detail = `a waiter is not a rehearsal node update: ${fresh.filter((r) => !attributed.includes(r))
          .map((r) => `pid ${r.pid} ${r.role} ${String(r.query).slice(0, 120)}`).join("; ")}`;
        break;
      }
      if (fresh.length === 2) {
        const got = fresh.map((r) => assignedColumns(r.query).join(",")).sort().join(" | ");
        if (got !== want) {
          detail = `waiters assign [${got}], expected [${want}]`;
          break;
        }
        const key = fresh.map((r) => `${r.pid}@${r.xactStart}`).sort().join(" ");
        if (candidate === key) {
          proven = true;
          waiters = fresh.map((r) => ({ pid: r.pid, xactStart: r.xactStart, columns: assignedColumns(r.query) }));
          break;
        }
        candidate = key; // confirm the same two on the next look
      } else {
        candidate = null;
      }
      await wait(POLL_MS);
    }
    check(s, "exactly two NEW backends, both this race's node updates, were queued on the held lock",
      proven, proven ? waiters.map((w) => `pid ${w.pid} sets ${w.columns.join(",")}`).join("; ") : detail);
  } finally {
    // 5. Release only now (or because the barrier failed / an error occurred).
    const releasedCleanly = await stopHolder(holder);
    // Never leave a rehearsal request running into the next scenario.
    if (launched) await launched;
    if (baselineClean) {
      let after = -1;
      try {
        after = (await lockSnapshot(null)).rows.filter((r) => r.app === HOLDER_APP).length;
      } catch {
        // Reported as -1 below.
      }
      check(s, "the lock was released by this run after the barrier, and the holder is gone",
        proven && releasedCleanly && after === 0, `holder exited: ${releasedCleanly}; holder sessions left: ${after}`);
    }
  }
  const results = await launched;
  return { proven, waiters, results };
}

/* ================================== main ================================== */

readOnlyGuard();

// The service logs refusals with console.error before mapping them; keep that
// out of the verdict table and print it only if something fails.
const serviceLog = [];

if (cleanupOnly) {
  manifest = loadManifest();
  say(`Cleanup only — run ${runId}, manifest ${MANIFEST_PATH}`);
  const entry = scenario("S9", "cleanup leaves no rehearsal rows");
  entry.ran = true;
  try {
    cleanup(entry);
  } catch (error) {
    check(entry, "cleanup completed", false, describe(error));
  }
  report();
}

// A previous run whose cleanup did not finish must be cleaned up first.
let pending = [];
try {
  pending = readdirSync(STATE_DIR).filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name));
} catch {
  // No state directory yet: nothing pending.
}
if (pending.length > 0) {
  refuse(`an unfinished rehearsal manifest exists (${pending.join(", ")}) in ${STATE_DIR} — run --cleanup-only --run-id <that id> first.`);
}

const passwordA = randomBytes(24).toString("base64url");
const passwordB = randomBytes(24).toString("base64url");
secrets.push(passwordA, passwordB);

const plan = planFixtures();
manifest = {
  kind: MANIFEST_KIND, version: 1, runId, createdAt: new Date().toISOString(),
  cluster: EXPECTED_CLUSTER, container: CONTAINER, apiOrigin: API_ORIGIN, status: "creating",
  ids: {
    projectTypes: [plan.ids.projectType],
    projects: [plan.ids.main, plan.ids.levels],
    users: [plan.ids.userA, plan.ids.userB],
    identities: [plan.ids.identityA, plan.ids.identityB],
    contacts: [plan.ids.contactA, plan.ids.contactB],
    profiles: [plan.ids.userA, plan.ids.userB],
    assignments: [...plan.ids.assignments],
    levels: [],
    nodes: [],
  },
};
saveManifest();
say(`Rehearsal 111 — run ${runId}`);
say(`Manifest: ${MANIFEST_PATH}`);
say(`Docker target: ${docker.source} -> ${DOCKER_PIN.join(" ")} (local endpoint ${maskDockerHost(docker.host)})`);
say(`Fixture projects: ${plan.ids.main} (MAIN), ${plan.ids.levels} (LEVELS)`);

const originalError = console.error;
console.error = (...parts) => serviceLog.push(scrub(parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ")));

let clientA;
let clientB;

const S = {
  s0: scenario("S0", "target safety + HTTP binding to the verified cluster"),
  s1: scenario("S1", "same node, different fields from one token: one wins, one STALE"),
  s2: scenario("S2", "same node, same field from one token: one wins, one STALE"),
  s3: scenario("S3", "stale DELETE refused, node remains"),
  s4: scenario("S4", "different nodes edited concurrently: both succeed"),
  s5: scenario("S5", "Project Setup write makes a structure level token STALE"),
  s6: scenario("S6", "structure write makes a Project Setup token STALE"),
  s7: scenario("S7", "getStructure refuses a mixed read as STALE"),
  s8: scenario("S8", "level id rule through the real RPC"),
  s9: scenario("S9", "cleanup leaves no rehearsal rows"),
};

try {
  /* ------------------------------ S0 binding ----------------------------- */
  let svcA;
  let svcB;
  await run(S.s0, async (s) => {
    check(s, "target guard passed (local Docker endpoint, loopback API, cluster id, database, objects, P0 fixtures)", true);
    createFixtures(plan, passwordA, passwordB);
    manifest.status = "active";
    saveManifest();
    check(s, "fixtures created with this run's own random IDs (all four kinds counted back)", true);

    clientA = makeClient("a", gatedFetch);
    clientB = makeClient("b", boundedFetch);
    for (const [label, client, email, password, id] of [
      ["A", clientA, plan.emailA, passwordA, plan.ids.userA],
      ["B", clientB, plan.emailB, passwordB, plan.ids.userB],
    ]) {
      const signIn = await op(`sign-in ${label}`, () => client.auth.signInWithPassword({ email, password }));
      check(s, `caller ${label} signs in through the local Auth service with this run's password`, !signIn.error, describe(signIn.error));
      const who = await op(`getUser ${label}`, () => client.auth.getUser());
      check(s, `caller ${label} token belongs to its fixture user`, who.data?.user?.id === id);
      const seen = await op(`binding read ${label}`, () =>
        client.from("projects").select("id, name").eq("id", plan.ids.main).maybeSingle());
      check(s, `caller ${label} reads this run's fixture project over HTTP (run id matches)`,
        !seen.error && seen.data?.name === plan.mainName, describe(seen.error));
    }
    svcA = createSupabaseProjectStructureService(() => clientA);
    svcB = createSupabaseProjectStructureService(() => clientB);
  });

  if (!passed(S.s0)) throw new Error("S0 failed — no scenario was run against an unproven target");

  const P = plan.ids.main;
  const L = plan.ids.levels;

  /** Reads a structure and records every level / unit ID it contains. */
  async function read(svc, projectId, label) {
    const structure = await op(label, () => svc.getStructure(projectId));
    for (const level of structure.levels) own("levels", level.id);
    for (const node of structure.nodes) own("nodes", node.id);
    return structure;
  }
  async function createUnit(input) {
    const node = await op(`create ${input.name}`, () => svcA.createNode(input));
    own("nodes", node.id);
    return node;
  }

  /* ---------------------------- shared setup ----------------------------- */
  const empty = await read(svcA, P, "initial read");
  if (empty.levels.length !== 0 || empty.nodes.length !== 0) throw new Error("fixture project is not empty");
  await op("configure MAIN levels", () => svcA.configureLevels({
    projectId: P, expectedVersion: empty.version,
    levels: [{ levelNumber: 1, singularLabel: "Package", pluralLabel: "Packages" }],
  }));
  await read(svcA, P, "record MAIN levels");
  const created = {};
  for (const key of ["N", "M", "K"]) {
    created[key] = await createUnit({ projectId: P, levelNumber: 1, name: `Node ${key}`, code: `ZZ111-${key}` });
  }
  const T0 = created.N.updatedAt;

  const nodeRow = (id) => psqlJson(`select coalesce((select jsonb_build_object('name', name, 'code', coalesce(code, ''),
      'description', coalesce(description, '')) from public.project_structure_nodes where id = ${lit(id)}), 'null'::jsonb);`);
  const tokenIs = (id, token) =>
    psqlTrue(`select updated_at = ${lit(token)}::timestamptz from public.project_structure_nodes where id = ${lit(id)}`);
  const sameInstant = (a, b) => psqlTrue(`select ${lit(a)}::timestamptz = ${lit(b)}::timestamptz`);
  const findNode = (structure, id) => structure.nodes.find((n) => n.id === id);

  /** The stored write is exactly this waiter's transaction (now() = its xact_start). */
  const writtenBy = (id, waiter) => Boolean(waiter)
    && psqlTrue(`select updated_at = ${lit(waiter.xactStart)}::timestamptz from public.project_structure_nodes where id = ${lit(id)}`);

  /** Both callers read the node; both saves start from that one token. */
  async function raceOnNode(s, id, patchA, patchB) {
    const [viewA, viewB] = await Promise.all([read(svcA, P, "A reads"), read(svcB, P, "B reads")]);
    const nodeA = findNode(viewA, id);
    const nodeB = findNode(viewB, id);
    check(s, "both callers read the node at the same token T0", nodeA && nodeB && nodeA.updatedAt === nodeB.updatedAt);
    const race = await underHeldLock(s, [Object.keys(patchA), Object.keys(patchB)], () => [
      op("A saves", () => svcA.updateNode(nodeA, patchA)),
      op("B saves", () => svcB.updateNode(nodeB, patchB)),
    ]);
    if (!race.results || race.results.length !== 2) throw new Error("the race did not run");
    const ok = race.results.filter((r) => r.status === "fulfilled");
    const refused = race.results.filter((r) => r.status === "rejected");
    check(s, "exactly one save succeeded", ok.length === 1, `succeeded: ${ok.length}`);
    check(s, "exactly one save was refused as STALE", refused.length === 1 && reasonOf(refused[0].reason) === "stale",
      refused.map((r) => describe(r.reason)).join("; "));
    const aWon = race.results[0].status === "fulfilled";
    return { before: nodeA, aWon, winner: ok[0]?.value, waiters: race.waiters };
  }

  /* -------------------- S1 same node, different fields ------------------- */
  await run(S.s1, async (s) => {
    const before = nodeRow(created.N.id);
    const { aWon, winner, waiters } = await raceOnNode(s, created.N.id, { name: "Node N renamed by A" }, { code: "ZZ111-N-B" });
    const after = nodeRow(created.N.id);
    const expected = aWon ? { name: "Node N renamed by A", code: before.code } : { name: before.name, code: "ZZ111-N-B" };
    check(s, "the winner's change persisted", after.name === expected.name && after.code === expected.code,
      `winner ${aWon ? "A (name)" : "B (code)"}`);
    check(s, "no auto-merge: the loser's field kept its old value",
      aWon ? after.code === before.code : after.name === before.name);
    check(s, "the stored node is exactly the winner's returned version", winner && tokenIs(created.N.id, winner.updatedAt));
    const winnerWaiter = waiters.find((w) => w.columns.join(",") === (aWon ? "name" : "code"));
    check(s, "the stored write is the transaction of the winner's recorded waiter", writtenBy(created.N.id, winnerWaiter));
    check(s, "the stored updated_at is no longer T0", !tokenIs(created.N.id, T0));
  });

  /* ---------------------- S2 same node, same field ----------------------- */
  await run(S.s2, async (s) => {
    const { before, aWon, winner, waiters } = await raceOnNode(s, created.N.id, { name: "Same field by A" }, { name: "Same field by B" });
    const after = nodeRow(created.N.id);
    check(s, "no silent overwrite: the stored name is the winner's",
      after.name === (aWon ? "Same field by A" : "Same field by B"), `winner ${aWon ? "A" : "B"}`);
    check(s, "the stored node is exactly the winner's returned version", winner && tokenIs(created.N.id, winner.updatedAt));
    check(s, "the stored write is the transaction of one recorded waiter",
      waiters.filter((w) => writtenBy(created.N.id, w)).length === 1);
    check(s, "the stored updated_at moved past the shared token", before && !tokenIs(created.N.id, before.updatedAt));
  });

  /* --------------------------- S3 stale delete --------------------------- */
  await run(S.s3, async (s) => {
    if (tokenIs(created.N.id, T0)) {
      const fresh = findNode(await read(svcA, P, "S3 read"), created.N.id);
      await op("S3 change", () => svcA.updateNode(fresh, { description: "changed before the stale delete" }));
    }
    check(s, "N has changed since T0", !tokenIs(created.N.id, T0));
    let refusal;
    try {
      await op("stale delete", () => svcB.deleteNode({ id: created.N.id, updatedAt: T0 }));
    } catch (error) {
      refusal = error;
    }
    check(s, "DELETE with the old token T0 is refused as STALE", reasonOf(refusal) === "stale", refusal ? describe(refusal) : "DELETE was ACCEPTED");
    check(s, "N still exists", nodeRow(created.N.id) !== null);
    const current = findNode(await read(svcB, P, "S3 current"), created.N.id);
    await op("current delete", () => svcB.deleteNode(current));
    check(s, "control: DELETE with N's current token is accepted (the refusal was about the token)", nodeRow(created.N.id) === null);
  });

  /* -------------------------- S4 different nodes ------------------------- */
  await run(S.s4, async (s) => {
    const view = await read(svcA, P, "S4 read");
    const m = findNode(view, created.M.id);
    const k = findNode(view, created.K.id);
    const race = await underHeldLock(s, [["name"], ["name"]], () => [
      op("A saves M", () => svcA.updateNode(m, { name: "Node M by A" })),
      op("B saves K", () => svcB.updateNode(k, { name: "Node K by B" })),
    ]);
    if (!race.results || race.results.length !== 2) throw new Error("the race did not run");
    check(s, "both saves succeeded", race.results.every((r) => r.status === "fulfilled"),
      race.results.filter((r) => r.status === "rejected").map((r) => describe(r.reason)).join("; "));
    check(s, "both changes persisted", nodeRow(created.M.id)?.name === "Node M by A" && nodeRow(created.K.id)?.name === "Node K by B");
    check(s, "each node got a new token", !tokenIs(created.M.id, m.updatedAt) && !tokenIs(created.K.id, k.updatedAt));
    const [w1, w2] = race.waiters;
    check(s, "each stored write is the transaction of a different recorded waiter",
      (writtenBy(created.M.id, w1) && writtenBy(created.K.id, w2)) || (writtenBy(created.M.id, w2) && writtenBy(created.K.id, w1)));
  });

  /* -------------------- S5 Project Setup -> Structure -------------------- */
  await run(S.s5, async (s) => {
    const view = await read(svcA, P, "S5 read");
    const V0 = view.version;
    const setup = await op("S5 setup save", () => clientB.rpc("save_project_setup_patch", {
      p_project: P, p_expected_updated_at: V0,
      p_columns: { description: `Rehearsal 111 ${short} S5` }, p_relations: {},
    }));
    check(s, "an authorized Project Setup save from V0 succeeds", !setup.error, describe(setup.error));
    check(s, "the project version advanced past V0",
      psqlTrue(`select updated_at <> ${lit(V0)}::timestamptz from public.projects where id = ${lit(P)}`));
    const levelRows = () => psqlJson(`select coalesce(jsonb_agg(jsonb_build_object('id', id, 'level', level_number,
        'singular', singular_label, 'plural', plural_label, 'updatedAt', updated_at::text) order by level_number), '[]'::jsonb)
        from public.project_structure_levels where project_id = ${lit(P)};`);
    const levelsBefore = levelRows();
    let refusal;
    const started = performance.now();
    try {
      const level1 = view.levels.find((l) => l.levelNumber === 1);
      await op("S5 stale levels save", () => svcA.configureLevels({
        projectId: P, expectedVersion: V0,
        levels: [{ id: level1.id, levelNumber: 1, singularLabel: "Package S5", pluralLabel: "Packages S5" }],
      }));
    } catch (error) {
      refusal = error;
    }
    const elapsed = Math.round(performance.now() - started);
    check(s, "the levels save with V0 is refused as STALE", reasonOf(refusal) === "stale", refusal ? describe(refusal) : "save was ACCEPTED");
    check(s, `the stale refusal came back promptly (under ${PROMPT_MS} ms), not retried until a timeout`,
      refusal !== undefined && !(refusal instanceof TimeoutError) && elapsed < PROMPT_MS, `${elapsed} ms`);
    check(s, "the level configuration did not change (same ids, numbers, labels and versions)",
      JSON.stringify(levelRows()) === JSON.stringify(levelsBefore) && levelsBefore.length === 1
        && levelsBefore[0].singular === "Package");
  });

  /* -------------------- S6 Structure -> Project Setup -------------------- */
  await run(S.s6, async (s) => {
    const projectState = () => psqlJson(`select jsonb_build_object('isNull', description is null,
        'description', description, 'version', updated_at::text) from public.projects where id = ${lit(P)};`);
    const view = await read(svcA, P, "S6 read");
    const V1 = view.version;
    const m = findNode(view, created.M.id);
    await op("S6 structure write", () => svcA.updateNode(m, { description: "S6 structure write" }));
    check(s, "a structure write after V1 succeeds", nodeRow(created.M.id)?.description === "S6 structure write");
    const beforeSave = projectState();
    check(s, "the structure write advanced the shared project version", !sameInstant(beforeSave.version, V1));
    const attempted = `Rehearsal 111 ${short} S6`;
    const started = performance.now();
    const setup = await op("S6 stale setup save", () => clientB.rpc("save_project_setup_patch", {
      p_project: P, p_expected_updated_at: V1, p_columns: { description: attempted }, p_relations: {},
    }));
    const elapsed = Math.round(performance.now() - started);
    check(s, "the Project Setup save with V1 is refused as STALE (PT409, HTTP 409)",
      setup.error?.code === "PT409" && setup.status === 409
        && /changed since this page loaded/i.test(setup.error?.message ?? ""),
      setup.error ? `code ${setup.error.code}, HTTP ${setup.status}` : "save was ACCEPTED");
    check(s, `the stale refusal came back promptly (under ${PROMPT_MS} ms), not retried until a timeout`,
      elapsed < PROMPT_MS, `${elapsed} ms`);
    const afterSave = projectState();
    check(s, "the refused save left the exact previous description and version",
      afterSave.isNull === beforeSave.isNull && afterSave.description === beforeSave.description
        && afterSave.description !== attempted && sameInstant(afterSave.version, beforeSave.version),
      `before ${JSON.stringify(beforeSave.description)}, after ${JSON.stringify(afterSave.description)}`);
  });

  /* ---------------------- S7 mixed getStructure read --------------------- */
  await run(S.s7, async (s) => {
    const control = await read(svcA, P, "S7 control read");
    check(s, "control: an undisturbed read returns the current project version",
      psqlTrue(`select updated_at = ${lit(control.version)}::timestamptz from public.projects where id = ${lit(P)}`));

    gate.events = [];
    gate.pending = null;
    gate.interleave = async () => {
      const k = findNode(await read(svcB, P, "S7 B read"), created.K.id);
      await op("S7 interleaved write", () => svcB.updateNode(k, { description: "S7 interleaved write" }));
      gate.events.push("write committed");
    };
    gate.armed = true;
    let result;
    let refusal;
    try {
      result = await op("S7 mixed read", () => svcA.getStructure(P));
    } catch (error) {
      refusal = error;
    } finally {
      gate.armed = false;
    }
    const events = gate.events;
    const committed = events.indexOf("write committed");
    const childReads = events.map((e, i) => (/project_structure_/.test(e) ? i : -1)).filter((i) => i >= 0);
    check(s, "the interleaved write by caller B committed", committed >= 0 && nodeRow(created.K.id)?.description === "S7 interleaved write");
    check(s, "order: version read -> other caller's write commits -> structure reads -> version read",
      events[0] === "read projects" && committed > 0 && childReads.length === 2
        && childReads.every((i) => i > committed) && events.at(-1) === "read projects",
      events.join(" > "));
    check(s, "getStructure is refused as STALE", reasonOf(refusal) === "stale", refusal ? describe(refusal) : "a structure was returned");
    check(s, "no partial / mixed ProjectStructure was returned", result === undefined);
    const after = await read(svcA, P, "S7 fresh read");
    check(s, "a fresh read afterwards succeeds and includes the write",
      findNode(after, created.K.id)?.description === "S7 interleaved write");
  });

  /* --------------------- S8 level id rule via the RPC -------------------- */
  await run(S.s8, async (s) => {
    const start = await read(svcA, L, "S8 initial read");
    await op("configure LEVELS level 1", () => svcA.configureLevels({
      projectId: L, expectedVersion: start.version,
      levels: [{ levelNumber: 1, singularLabel: "Plant", pluralLabel: "Plants" }],
    }));
    await read(svcA, L, "record LEVELS level 1");
    const x = await createUnit({ projectId: L, levelNumber: 1, name: "Plant X", code: "ZZ111-X" });
    const before = await read(svcA, L, "S8 before");
    const level1 = before.levels.find((l) => l.levelNumber === 1);
    check(s, "precondition: level 1 exists and has a unit", level1 && before.nodes.some((n) => n.id === x.id));
    const retained = { id: level1.id, levelNumber: 1, singularLabel: "Plant", pluralLabel: "Plants" };

    for (const [label, id] of [["a new id", randomUUID()], ["level 1's own id", level1.id]]) {
      let refusal;
      try {
        await op(`append level 2 with ${label}`, () => svcA.configureLevels({
          projectId: L, expectedVersion: before.version,
          levels: [retained, { id, levelNumber: 2, singularLabel: "Unit", pluralLabel: "Units" }],
        }));
      } catch (error) {
        refusal = error;
      }
      check(s, `appending level 2 carrying ${label} is refused as INVALID_LEVELS`,
        reasonOf(refusal) === "invalid_levels", refusal ? describe(refusal) : "save was ACCEPTED");
    }
    const unchanged = await read(svcA, L, "S8 unchanged");
    check(s, "the refusals changed nothing (one level, same project version)",
      unchanged.levels.length === 1 && sameInstant(unchanged.version, before.version));

    const saved = await op("append level 2 without id", () => svcA.configureLevels({
      projectId: L, expectedVersion: before.version,
      levels: [retained, { levelNumber: 2, singularLabel: "Unit", pluralLabel: "Units" }],
    }));
    const after = await read(svcA, L, "S8 after");
    check(s, "appending level 2 WITHOUT an id succeeds", after.levels.length === 2 && sameInstant(after.version, saved.version));
    check(s, "level 1 kept its identity", after.levels.find((l) => l.levelNumber === 1)?.id === level1.id);
    const level2 = after.levels.find((l) => l.levelNumber === 2);
    check(s, "level 2 is a new row", level2 && level2.id !== level1.id);
    check(s, "the existing unit is still on level 1", findNode(after, x.id)?.levelNumber === 1);
  });
} catch (error) {
  stopReason ||= describe(error);
} finally {
  if (!runAbort.signal.aborted) {
    for (const client of [clientA, clientB]) {
      try {
        await op("sign-out", () => client?.auth.signOut());
      } catch {
        // The users are deleted below; their sessions go with them.
      }
    }
  }
  S.s9.ran = true;
  try {
    cleanup(S.s9);
  } catch (error) {
    check(S.s9, "cleanup completed", false, describe(error));
  }
  console.error = originalError;
  report();
}

/* ================================= report ================================= */

function report() {
  const rows = scenarios.map((entry) => ({ ...entry, verdict: passed(entry) ? "PASS" : "FAIL" }));
  say("");
  say(`Phase 2C.1c-b service concurrency rehearsal (111) — main local — run ${runId}`);
  say("-".repeat(78));
  for (const row of rows) {
    say(`${row.verdict}  ${row.id}  ${row.title}${row.ran ? "" : "  (not run)"}`);
    for (const c of row.checks) {
      if (!c.ok || row.verdict === "FAIL") say(`        ${c.ok ? "ok  " : "FAIL"}  ${c.label}${c.detail ? ` — ${c.detail}` : ""}`);
    }
  }
  const pass = rows.filter((r) => r.verdict === "PASS").length;
  const fail = rows.length - pass;
  const checks = rows.flatMap((r) => r.checks);
  say("-".repeat(78));
  say(`TOTAL PASS ${pass}`);
  say(`TOTAL FAIL ${fail}`);
  say(`(checks: ${checks.filter((c) => c.ok).length} ok, ${checks.filter((c) => !c.ok).length} failed)`);
  if (stopReason) say(`Run stopped before all scenarios finished: ${stopReason}`);
  if (fail > 0 && serviceLog.length) {
    say("\nService diagnostics (refusals logged by the service, scrubbed):");
    for (const line of serviceLog.slice(-20)) say(`  ${line.slice(0, 300)}`);
  }
  process.exit(fail > 0 ? 1 : 0);
}

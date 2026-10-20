import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

// Phase 13.9B UAT polish — in-app toasts over the EXISTING notification system.
// The bell stays the permanent record; these prove the toast layer's rules.

registerHooks({ load(url, context, nextLoad) {
  if (!(url.includes("/eprp/src/") && url.endsWith(".ts"))) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });

const feed = await import("./toast-feed.ts");
const poll = await import("./foreground-poll.ts");
const model = await import("./model.ts");
const notify = await import("../projects/setup-amendment-notifications.ts");
const bellStart = await import("./toast-bell-start.ts");

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_START = Date.parse("2026-10-18T10:00:00Z");
const NOW = () => SESSION_START;
const project = { id: PROJECT_ID, code: "MDP-PSAIM-01", name: "Pump Station" };
const amendment = (over = {}) => ({
  id: "22222222-2222-4222-8222-222222222222", projectId: PROJECT_ID, fieldKey: "project_category", targetKey: "",
  amendmentClass: "governed", previousValue: { project_type_id: "t1", project_category_detail: null },
  proposedValue: { project_type_id: "t2", project_category_detail: null }, reason: "r", impactCode: null, impactWarning: "w",
  requestedBy: "x", requestedByName: "Dina", requestedAt: "2026-10-18T10:05:00Z", status: "pending",
  decidedBy: null, decidedByName: null, decidedAt: null, decisionComment: null, ...over,
});
const lookups = { categoryName: (id) => ({ t1: "General", t2: "Asset Integrity" })[id] };
const item = (eventType, over = {}, a = amendment()) =>
  notify.composeAmendmentNotification({
    row: { id: `n-${eventType}`, eventType, projectId: PROJECT_ID, sourceId: a.id, actorName: null,
           createdAt: "2026-10-18T10:05:00Z", readAt: null, ...over },
    amendment: a, project, lookups, formatDateTime: String,
  });

/* ------------------------------- toast wording ----------------------------- */

test("each event has a compact toast: title, what was requested, who acted on which project", () => {
  const request = "Project Category / Classification: General → Asset Integrity";
  assert.deepEqual(item("amendment_submitted").toast, {
    title: "Approval required",
    description: `${request}\nRequested by Dina · Pump Station`,
    actionLabel: "View request",
  });
  const decided = { decidedByName: "Omar", decidedAt: "2026-10-18T10:07:00Z" };
  assert.deepEqual(item("amendment_approved", {}, amendment({ status: "approved", ...decided })).toast,
    { title: "Request approved", description: `${request}\nApproved by Omar · Pump Station`, actionLabel: "View details" });
  // The rejection reason stays in the Notification Center card; the toast is a glance.
  const rejected = item("amendment_rejected", {}, amendment({ status: "rejected", ...decided, decisionComment: "Not the contract category." })).toast;
  assert.deepEqual(rejected, { title: "Request rejected", description: `${request}\nRejected by Omar · Pump Station`, actionLabel: "View details" });
  assert.deepEqual(item("amendment_stale", {}, amendment({ status: "stale" })).toast, {
    title: "Request not applied", description: `${request}\nNot applied: the value changed · Pump Station`, actionLabel: "View details" });
  assert.deepEqual(item("amendment_frozen").toast, {
    title: "Request frozen", description: `${request}\nProject archived · Pump Station`, actionLabel: "View details" });
  // Every toast is two short lines, never a paragraph; long values are clipped.
  for (const event of ["amendment_submitted", "amendment_approved", "amendment_rejected", "amendment_stale", "amendment_frozen"]) {
    const lines = item(event, {}, amendment({ reason: "x".repeat(400), decisionComment: "y".repeat(400) })).toast.description.split("\n");
    assert.equal(lines.length, 2, event);
    assert.ok(lines.every((line) => line.length <= 90), event);
  }
  const long = notify.clipToastLine("z".repeat(200));
  assert.equal(long.length, 90);
  assert.ok(long.endsWith("…"));
});

test("a structure request toasts in business words (PSM and Other projects alike)", () => {
  const other = amendment({ fieldKey: "structure_units", targetKey: "unit:u2",
    proposedValue: { action: "rename", unit_id: "u2", name: "Unit Two", labels: { target: "U2", level: "Unit" } }, previousValue: { unit: { name: "U2" } } });
  assert.equal(item("amendment_submitted", {}, other).toast.description, "Rename Unit · U2 → Unit Two\nRequested by Dina · Pump Station");
  assert.equal(item("amendment_approved", {}, amendment({ ...other, decidedByName: "Omar" })).toast.description, "Rename Unit · U2 → Unit Two\nApproved by Omar · Pump Station");
  const psm = amendment({ fieldKey: "structure_departments", targetKey: "department:d1", previousValue: { assignment: null },
    proposedValue: { action: "add_department", department_id: "d1", system_ids: [], reporting_required: true, labels: { target: "Civil", systems: [] } } });
  assert.equal(item("amendment_rejected", {}, amendment({ ...psm, decidedByName: "Omar" })).toast.description, "Add department · Civil\nRejected by Omar · Pump Station");
});

/* --------------------------- backlog and dedup rules ----------------------- */

/* ------- toast state machine: baseline → discovered → pending → presented → handled ------- */

const NONE = { show: [], overflow: 0 };
const ids = (result) => result.show.map((entry) => entry.id);
const BEFORE = "2026-10-18T09:58:00Z";   // created before the session started (SESSION_START is 10:00)

test("1. backlog: what existed at session start never toasts — focused or not, now or later", () => {
  const trace = [];
  const gate = feed.createToastGate(NOW, (stage, list) => trace.push([stage, ...list]));
  const backlog = [item("amendment_submitted", { id: "n-backlog", createdAt: BEFORE }),
    item("amendment_approved", { id: "n-old", createdAt: "2026-10-17T09:00:00Z" })];
  assert.deepEqual(gate.observe(backlog, { present: false }), NONE);
  assert.deepEqual(gate.flush(), NONE, "focus does not replay the backlog");
  assert.deepEqual(gate.observe(backlog, { present: true }), NONE);
  assert.deepEqual(trace, [["baseline", "n-backlog", "n-old"]]);
  // A database clock a few seconds ahead of the browser's does not turn backlog into an arrival.
  assert.equal(feed.BASELINE_CLOCK_MARGIN_MS, 10_000);
  const skewed = feed.createToastGate(NOW);
  assert.deepEqual(skewed.observe([item("amendment_submitted", { id: "n-skew", createdAt: "2026-10-18T10:00:08Z" })]), NONE);
});

test("2. fresh while focused: toasts once", () => {
  const gate = feed.createToastGate(NOW);
  gate.observe([], { present: true });
  const fresh = item("amendment_submitted", { id: "n-fresh" });
  assert.deepEqual(ids(gate.observe([fresh], { present: true })), ["n-fresh"]);
  assert.deepEqual(gate.observe([fresh], { present: true }), NONE);
  assert.deepEqual(gate.flush(), NONE);
  // Several arrivals in one refresh, oldest first; another later.
  assert.deepEqual(ids(gate.observe([fresh, item("amendment_stale", { id: "n-two" })])), ["n-two"]);
});

test("3. fresh while unfocused and already fetched: pending (not consumed), then focus shows it once", () => {
  const trace = [];
  const gate = feed.createToastGate(NOW, (stage, list) => trace.push([stage, ...list]));
  const backlog = item("amendment_submitted", { id: "n-backlog", createdAt: BEFORE });
  gate.observe([backlog], { present: true });
  const arrival = item("amendment_rejected", { id: "n-arrival" });
  assert.deepEqual(gate.observe([arrival, backlog], { present: false }), NONE);
  assert.deepEqual(gate.observe([arrival, backlog], { present: false }), NONE);
  // The focus event shows it at once from the pending set, without waiting for a refresh.
  assert.deepEqual(ids(gate.flush()), ["n-arrival"]);
  assert.deepEqual(gate.observe([arrival, backlog], { present: true }), NONE);
  assert.deepEqual(gate.flush(), NONE);
  assert.deepEqual(trace, [["baseline", "n-backlog"], ["discovered", "n-arrival"], ["deferred", "n-arrival"],
    ["deferred", "n-arrival"], ["presented", "n-arrival"]]);
  // Same, when the first focused moment is a refresh rather than the focus event.
  const second = feed.createToastGate(NOW);
  second.observe([], { present: true });
  assert.deepEqual(second.observe([arrival], { present: false }), NONE);
  assert.deepEqual(ids(second.observe([arrival], { present: true })), ["n-arrival"]);
  assert.deepEqual(second.flush(), NONE);
});

/** The provider's refresh, reduced to its toast logic: fetch unread, feed the gate, record what toasts. */
function toastHarness({ inbox, gate = feed.createToastGate(NOW), visible = true, failFirst = 0 } = {}) {
  const env = fakeEnvironment(visible);
  const state = { inbox, focused: visible, shown: [], runs: 0, fail: failFirst, active: 0, maxActive: 0, hold: null };
  const stop = poll.startForegroundPoll(async () => {
    state.runs++; state.active++; state.maxActive = Math.max(state.maxActive, state.active);
    try {
      if (state.hold) await state.hold.promise;
      if (state.fail > 0) { state.fail--; throw new Error("8 s client timeout"); }
      const unread = state.inbox.filter((entry) => !entry.readAt);
      state.shown.push(...ids(gate.observe(unread, { present: state.focused })));
    } finally { state.active--; }
  }, { environment: env, onError: () => { state.errors = (state.errors ?? 0) + 1; } });
  const focus = () => { state.focused = true; env.change(true); state.shown.push(...ids(gate.flush())); };
  const blur = (hidden) => { state.focused = false; if (hidden) env.change(false); };
  const holdNext = () => { let release; const promise = new Promise((resolve) => { release = resolve; }); state.hold = { promise }; return () => { state.hold = null; release(); }; };
  return { env, state, gate, stop, focus, blur, holdNext };
}

test("4. fresh while unfocused and NOT fetched yet: focus triggers a catch-up refresh that shows it once", async () => {
  const backlog = item("amendment_submitted", { id: "n-backlog", createdAt: BEFORE });
  const arrival = item("amendment_rejected", { id: "n-arrival" });
  const h = toastHarness({ inbox: [backlog] });
  await settle();                                   // baseline
  h.blur(true);                                     // the other browser covers this window: hidden, no polling
  h.state.inbox = [backlog, arrival];               // it arrives; this window has not fetched it
  h.env.fire(); await settle();
  assert.deepEqual(h.state.shown, []);
  assert.deepEqual(h.gate.flush(), NONE, "nothing is pending yet: it was never fetched");
  h.focus(); await settle();                        // back: a catch-up refresh is guaranteed
  assert.deepEqual(h.state.shown, ["n-arrival"]);
  h.stop();
});

test("4b. the UAT sequence: the first refresh fails, the window is hidden, a rejection arrives, the user returns", async () => {
  const backlog = item("amendment_rejected", { id: "n-0859", createdAt: BEFORE });
  const arrival = item("amendment_rejected", { id: "n-1257" });
  const h = toastHarness({ inbox: [backlog], failFirst: 1 });   // reload: the first refresh times out — no baseline yet
  await settle();
  assert.equal(h.state.errors, 1, "the failure is reported, not swallowed");
  h.blur(true);
  h.state.inbox = [backlog, arrival];
  h.focus(); await settle();                        // the FIRST successful refresh already holds the arrival
  assert.deepEqual(h.state.shown, ["n-1257"], "the arrival toasts; the old rejection stays backlog");
  h.stop();
});

test("5. focus while a refresh is in flight: exactly one catch-up refresh runs right after it, never in parallel", async () => {
  const backlog = item("amendment_submitted", { id: "n-backlog", createdAt: BEFORE });
  const arrival = item("amendment_rejected", { id: "n-arrival" });
  const h = toastHarness({ inbox: [backlog] });
  await settle();                                   // run 1: baseline
  const release = h.holdNext();
  h.env.fire(); await settle();                     // run 2 starts and stalls, before the arrival exists
  assert.equal(h.state.runs, 2);
  h.blur(false);
  h.state.inbox = [backlog, arrival];
  h.focus(); h.focus(); h.env.fire();               // focus twice and an interval tick while run 2 is in flight
  await settle();
  assert.equal(h.state.runs, 2, "nothing runs in parallel");
  release(); await settle(); await settle();
  assert.equal(h.state.runs, 3, "one queued catch-up run, not one per event");
  assert.equal(h.state.maxActive, 1);
  assert.deepEqual(h.state.shown, ["n-arrival"]);
  h.env.fire(); await settle();
  assert.equal(h.state.runs, 4, "the 30 s interval carries on as before");
  h.stop();
});

test("6. repeated focus and refreshes never duplicate a toast", async () => {
  const h = toastHarness({ inbox: [] });
  await settle();
  h.state.inbox = [item("amendment_approved", { id: "n-once" })];
  h.env.fire(); await settle();
  for (let index = 0; index < 3; index++) { h.blur(index % 2 === 0); h.focus(); await settle(); h.env.fire(); await settle(); }
  assert.deepEqual(h.state.shown, ["n-once"]);
  h.stop();
});

test("7. reload: a new session never replays what the previous one saw", () => {
  const arrival = item("amendment_rejected", { id: "n-arrival" });
  const first = feed.createToastGate(NOW);
  first.observe([]);
  assert.deepEqual(ids(first.observe([arrival])), ["n-arrival"]);
  // Reloaded 25 minutes later; the notification is still unread.
  const reloaded = feed.createToastGate(() => Date.parse("2026-10-18T10:30:00Z"));
  assert.deepEqual(reloaded.observe([arrival]), NONE);
  assert.deepEqual(reloaded.flush(), NONE);
  assert.deepEqual(reloaded.observe([arrival]), NONE);
});

test("8. read before presentation: never toasted (read notifications never toast)", () => {
  const trace = [];
  const gate = feed.createToastGate(NOW, (stage, list) => trace.push([stage, ...list]));
  gate.observe([], { present: true });
  const arrival = item("amendment_rejected", { id: "n-read-elsewhere" });
  assert.deepEqual(gate.observe([arrival], { present: false }), NONE);              // pending
  assert.deepEqual(gate.observe([], { present: false }), NONE);                     // read elsewhere: left the unread list
  assert.deepEqual(gate.flush(), NONE, "focus does not toast a read notification");
  assert.deepEqual(gate.observe([arrival], { present: true }), NONE, "marked unread again later: not a new arrival");
  assert.ok(trace.some(([stage, id]) => stage === "dropped" && id === "n-read-elsewhere"));
  const readFirst = item("amendment_approved", { id: "n-read-first", readAt: "2026-10-18T10:06:00Z" });
  assert.deepEqual(gate.observe([readFirst], { present: true }), NONE);
});

test("every event type toasts for the requester or approver; read items and items without wording do not", () => {
  const gate = feed.createToastGate(NOW);
  gate.observe([]);
  const events = ["amendment_submitted", "amendment_approved", "amendment_rejected", "amendment_stale", "amendment_frozen"];
  const arrivals = events.map((event, index) => item(event, { id: `n${index}`, createdAt: `2026-10-18T10:0${index + 1}:00Z` }));
  const free = { ...item("amendment_approved", { id: "free" }), toast: undefined };          // no toast wording (e.g. ordinary history)
  const alreadyRead = item("amendment_stale", { id: "read", readAt: "2026-10-18T10:06:00Z" });
  const result = gate.observe([...arrivals, free, alreadyRead]);
  assert.equal(result.show.length + result.overflow, 5);
  assert.ok(!result.show.some((entry) => entry.id === "free" || entry.id === "read"));
});

test("a burst is capped and summarised; items older than the session are backlog", () => {
  const gate = feed.createToastGate(NOW);
  gate.observe([]);
  const burst = Array.from({ length: 5 }, (_, index) => item("amendment_submitted", { id: `b${index}`, createdAt: `2026-10-18T10:0${index + 1}:00Z` }));
  const old = item("amendment_submitted", { id: "old", createdAt: "2026-10-10T08:00:00Z" });
  const result = gate.observe([old, ...burst]);
  assert.deepEqual(result.show.map((entry) => entry.id), ["b0", "b1", "b2"]);   // oldest first
  assert.equal(result.overflow, 2);
  assert.ok(!result.show.some((entry) => entry.id === "old"));
});

test("the provider: one gate per session, focus shows pending + forces a catch-up, failures and transitions traced in development", () => {
  const provider = code("./provider.tsx");
  assert.match(provider, /showToasts\(gate\.observe\(unread\.items, \{ present: document\.hasFocus\(\) \}\)\)/);
  assert.match(provider, /const onFocus = \(\) => showToasts\(gate\.flush\(\)\);\s*window\.addEventListener\("focus", onFocus\);/);
  assert.match(provider, /window\.removeEventListener\("focus", onFocus\)/);
  // The gate survives an effect re-run (no re-baseline); the trace is development-only.
  assert.match(provider, /const gate = \(toastGate\.current \?\?= createToastGate\(Date\.now, DEVELOPMENT \? traceToastGate : undefined\)\);/);
  assert.match(provider, /const toastGate = React\.useRef<ToastGate \| null>\(null\);/);
  assert.match(provider, /const DEVELOPMENT = process\.env\.NODE_ENV === "development";/);
  assert.match(provider, /onError: DEVELOPMENT \? \(failure\) => console\.warn\(/);
  assert.match(provider, /if \(DEVELOPMENT && \(show\.length \|\| overflow\)\) console\.info\("\[EPRP toasts\] toast\(\) called"/);
  // One toast renderer for real toasts and the development renderer check.
  assert.equal((provider.match(/toast\(item\.toast!\.title/g) ?? []).length, 1);
  assert.match(provider, /showTestToast: \(\) => \{\s*if \(!DEVELOPMENT\) return;[\s\S]*?showToasts\(\{ show: \[/);
  assert.match(code("./notification-center.tsx"), /<Button size="sm" variant="ghost" onClick=\{showTestToast\}>Show test toast<\/Button>/);
  // The poll: visibility / focus requests a guaranteed catch-up; the interval does not queue; 30 s unchanged.
  const pollCode = code("./foreground-poll.ts");
  assert.match(pollCode, /options\.intervalMs \?\? 30_000/);
  assert.match(pollCode, /if \(inFlight\) \{\s*if \(catchUpRequest\) catchUp = true;\s*return;\s*\}/);
  assert.match(pollCode, /environment\.setInterval\(\(\) => tick\(false\), intervalMs\)/);
  assert.match(pollCode, /startTimer\(\);\s*tick\(true\);/);
  assert.match(pollCode, /window\.addEventListener\("focus", listener\)/);
});

test("free / logged and lightweight changes create no notification, hence no toast", () => {
  // The database creates rows only for a governed submit or a decision (suite 127 section 02);
  // the toast layer toasts only notifications that carry toast wording.
  const sql = readFileSync(new URL("../../../supabase/migrations/20261020090000_project_setup_amendment_notifications.sql", import.meta.url), "utf8");
  assert.match(sql, /new\.status = 'pending' and new\.amendment_class = 'governed'/);
  assert.doesNotMatch(feed.createToastGate.toString(), /lightweight|applied/);
  const gate = feed.createToastGate(NOW);
  gate.observe([]);
  assert.deepEqual(gate.observe([{ ...item("amendment_submitted"), toast: undefined }]), { show: [], overflow: 0 });
});

/* ------------------------------ deep link and UI --------------------------- */

test("clicking a toast uses the same deep link as the bell item", () => {
  const entry = item("amendment_submitted");
  assert.equal(model.notificationHref(entry.target), `/projects/${PROJECT_ID}/setup/info?amendment=22222222-2222-4222-8222-222222222222`);
  const provider = code("./provider.tsx");
  assert.match(provider, /const href = item\.projectId === item\.target\.projectId \? notificationHref\(item\.target\) : null;/);
  assert.match(provider, /action: href\s*\?\s*\{\s*label: item\.toast!\.actionLabel,/);
  assert.match(provider, /service\.setRead\(item\.id, true\)[\s\S]*?router\.push\(href\)/);
  // Dedup is also enforced by the toast id, and the toast auto-dismisses and can be closed.
  assert.match(provider, /id: `notification:\$\{item\.id\}`/);
  assert.match(provider, /icon: <ToastBell \/>,\s*position: TOAST_POSITION,\s*duration: TOAST_DURATION_MS,\s*closeButton: true,/);
  assert.equal(feed.TOAST_DURATION_MS, 12_000, "about 12 seconds");
  assert.equal(feed.TOAST_POSITION, "top-center");
});

test("the existing toast system and notification provider are reused", () => {
  const provider = code("./provider.tsx");
  assert.match(provider, /import \{ toast \} from "sonner";/);
  assert.match(provider, /if \(service\.mode !== "connected"\) return;/);        // not in the sample preview or disconnected mode
  assert.match(provider, /service\.list\(\{ projectId: "all", category: "all", read: "unread", page: 1, pageSize: 20 \}\)/);
  assert.match(provider, /gate\.observe\(unread\.items, /);
  assert.doesNotMatch(provider, /Notification\.requestPermission|serviceWorker|new WebSocket|channel\(/);
});

test("the Notification Center renders every item through one shared card", () => {
  const center = code("./notification-center.tsx");
  // Structured rows when present; "Notification sent" is the card's last row, so project/time never repeat below it.
  assert.match(center, /function NotificationBody\(\{ item \}: \{ item: NotificationItem \}\)/);
  assert.match(center, /<NotificationBody item=\{item\} \/>/);
  assert.match(center, /<dt className="font-medium text-foreground">Notification sent<\/dt>/);
  // The title is the item's own (no event-specific override in the JSX).
  assert.doesNotMatch(center, /"Approval required"|amendment_(submitted|approved|rejected|stale|frozen)/);
  assert.match(center, /\}\}>\{item\.title\}<ExternalLink/);
  // Unread is visibly stronger: accent edge, tint, dot and a heavier title.
  assert.match(center, /unread \? "border-l-4 border-primary\/30 border-l-primary bg-primary\/\[0\.06\] shadow-sm" : "bg-background"/);
  assert.match(center, /unread \? "font-semibold text-foreground" : "font-medium text-foreground\/80"/);
  assert.match(center, /data-unread=\{unread \? "true" : undefined\}/);
  // The composer produces the rows for every event; nothing event-specific lives in the UI.
  for (const event of ["amendment_submitted", "amendment_approved", "amendment_rejected", "amendment_stale", "amendment_frozen"]) {
    assert.ok(item(event, {}, amendment({ decidedByName: "Omar" })).details.length >= 4, event);
  }
});

/* --------------------------------- foreground poll ------------------------- */

function fakeEnvironment(visible = true) {
  const env = {
    visible, timers: new Map(), nextId: 1, listeners: new Set(),
    isVisible: () => env.visible,
    onVisibilityChange(listener) { env.listeners.add(listener); return () => env.listeners.delete(listener); },
    setInterval(handler) { const id = env.nextId++; env.timers.set(id, handler); return id; },
    clearInterval(id) { env.timers.delete(id); },
    fire() { for (const handler of [...env.timers.values()]) handler(); },
    change(next) { env.visible = next; for (const listener of [...env.listeners]) listener(); },
  };
  return env;
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("refresh runs now, on focus and on the interval — and never while the tab is hidden", async () => {
  const env = fakeEnvironment(true);
  let calls = 0;
  const stop = poll.startForegroundPoll(async () => { calls++; }, { intervalMs: 30_000, environment: env });
  await settle();
  assert.equal(calls, 1, "once at start");
  env.fire(); await settle();
  assert.equal(calls, 2, "on the interval");
  env.change(false);
  assert.equal(env.timers.size, 0, "hidden: the timer is stopped");
  env.fire(); await settle();
  assert.equal(calls, 2, "hidden: no request");
  env.change(true); await settle();
  assert.equal(calls, 3, "visible again: an immediate refresh");
  assert.equal(env.timers.size, 1);
  stop();
  assert.equal(env.timers.size, 0);
  env.change(true); env.fire(); await settle();
  assert.equal(calls, 3, "stopped: nothing runs");
});

test("a hidden tab at start makes no request and starts no timer; a slow request is not stacked", async () => {
  const hidden = fakeEnvironment(false);
  let calls = 0;
  const stopHidden = poll.startForegroundPoll(async () => { calls++; }, { environment: hidden });
  await settle();
  assert.equal(calls, 0);
  assert.equal(hidden.timers.size, 0);
  stopHidden();

  const env = fakeEnvironment(true);
  let release;
  let running = 0;
  const stop = poll.startForegroundPoll(() => { running++; return new Promise((resolve) => { release = resolve; }); }, { environment: env });
  env.fire(); env.fire();
  assert.equal(running, 1, "no second request while one is in flight");
  release(); await settle();
  env.fire();
  assert.equal(running, 2);
  stop();
});

/* ------------------------- attention cue (bell / ripple) ------------------- */

test("the toast carries an amber bell with a finite, reduced-motion-safe attention cue on a dark surface", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8").replaceAll("\r", "");
  const marker = "Notification toasts (13.9B UAT polish)";
  // ONE block: the earlier stacked overrides are gone.
  assert.equal(css.split(marker).length, 2, "exactly one notification toast block");
  const block = css.slice(css.indexOf(marker));
  assert.doesNotMatch(block, /polish v2|polish v3/);
  // Ring, glow and ripple: 3 pulses of 0.8 s (2.4 s), then static. Never infinite.
  const motion = block.slice(block.indexOf("@media (prefers-reduced-motion: no-preference)"));
  const durations = [...motion.matchAll(/animation: notif-toast-(ring|glow|ripple) ([\d.]+)s [^;]*? (\d+) both;/g)];
  assert.deepEqual(durations.map((match) => match[1]).sort(), ["glow", "ring", "ripple"]);
  for (const [, , seconds, count] of durations) {
    assert.equal(Number(count), 3, "3 pulses");
    const total = Number(seconds) * Number(count);
    assert.ok(total >= 2 && total <= 3, `about 2–3 s (${total} s)`);
  }
  for (const name of ["ring", "glow", "ripple"]) assert.match(block, new RegExp(`@keyframes notif-toast-${name} \\{`), name);
  assert.doesNotMatch(block, /infinite/);
  // Animation is declared ONLY for no-preference; reduced motion is explicitly static.
  const outsideNoPreference = block.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/, "");
  assert.doesNotMatch(outsideNoPreference, /animation: notif-toast-/);
  assert.match(block, /@media \(prefers-reduced-motion: reduce\) \{\s*\.notif-toast-bell,\s*\.notif-toast-bell__icon,\s*\.notif-toast-bell__ripple \{ animation: none; \}\s*\}/);
  // Amber bell; dark navy/charcoal surface with light text (not the bright primary blue).
  assert.match(block, /\.notif-toast-bell \{[^}]*color: #f5c451;/);
  const surface = block.match(/\[data-sonner-toast\]:has\(\.notif-toast-bell\) \{([^}]*)\}/)[1];
  assert.match(surface, /background: linear-gradient\(135deg, #17263d 0%, #0f1b2d 100%\) !important;/);
  assert.match(surface, /color: #f8fafc !important;/);
  assert.doesNotMatch(surface, /var\(--primary\)/);
  // Two-line description (request, then who / project).
  assert.match(block, /\[data-description\] \{[^}]*white-space: pre-line;/);
  // Top-centre, just below the 3.5 rem top bar.
  assert.match(block, /\[data-sonner-toaster\]\[data-y-position="top"\]\[data-x-position="center"\] \{\s*top: 4rem !important;/);
  assert.match(readFileSync(new URL("../../components/layout/top-bar.tsx", import.meta.url), "utf8"), /sticky top-0 z-40 flex h-14/);
  // The component: a ring icon plus a ripple, decorative only, no sound.
  const bell = code("./toast-bell.tsx");
  assert.match(bell, /<BellRing className="notif-toast-bell__icon" \/>/);
  assert.match(bell, /notif-toast-bell__ripple/);
  assert.match(bell, /aria-hidden="true"/);
  assert.doesNotMatch(bell + code("./provider.tsx"), /Audio\(|\.play\(|\bnew Howl\b/);
  // Every amendment toast (and the overflow summary) gets the icon and the placement.
  const provider = code("./provider.tsx");
  assert.equal((provider.match(/icon: <ToastBell \/>/g) ?? []).length, 2);
  assert.equal((provider.match(/position: TOAST_POSITION/g) ?? []).length, 2);
  // The ring is gated on a bell marked ringing (set on visible mount), never on the element alone.
  const rules = [...motion.slice(0, motion.indexOf("\n}")).matchAll(/^\s*([^{\n]+?) \{ animation: notif-toast-(\w+)/gm)].map((match) => [match[2], match[1]]);
  assert.deepEqual(rules, [
    ["glow", '.notif-toast-bell[data-ringing="true"]'],
    ["ring", '.notif-toast-bell[data-ringing="true"] .notif-toast-bell__icon'],
    ["ripple", '.notif-toast-bell[data-ringing="true"] .notif-toast-bell__ripple'],
  ]);
  assert.match(bell, /React\.useEffect\(\(\) => \(ref\.current \? ringWhenShown\(ref\.current\) : undefined\), \[\]\);/);
  assert.match(bell, /<span ref=\{ref\} className="notif-toast-bell"/);
});

/** A fake browser for the ring start: visibility, the toast's data-mounted, and painted frames. */
function bellWorld({ visible = true, mounted = "false", inToast = true } = {}) {
  const world = { visible, frames: [], visibilityListeners: new Set(), attributeListeners: new Set(), attrs: {} };
  world.toast = { attrs: { "data-mounted": mounted }, getAttribute: (name) => world.toast.attrs[name] ?? null };
  world.bell = {
    closest: (selector) => (inToast && selector === "[data-sonner-toast]" ? world.toast : null),
    setAttribute: (name, value) => { world.attrs[name] = value; },
  };
  world.env = {
    isVisible: () => world.visible,
    onVisibilityChange(listener) { world.visibilityListeners.add(listener); return () => world.visibilityListeners.delete(listener); },
    observeAttributes(target, listener) { assert.equal(target, world.toast); world.attributeListeners.add(listener); return () => world.attributeListeners.delete(listener); },
    nextFrame(callback) { const entry = { callback, cancelled: false }; world.frames.push(entry); return () => { entry.cancelled = true; }; },
  };
  world.paint = () => { for (const entry of world.frames.splice(0)) if (!entry.cancelled) entry.callback(); };
  world.mount = () => { world.toast.attrs["data-mounted"] = "true"; for (const listener of [...world.attributeListeners]) listener(); };
  world.show = () => { world.visible = true; for (const listener of [...world.visibilityListeners]) listener(); };
  return world;
}

test("the bell rings only once its toast is visibly mounted and two frames have painted — never at creation", () => {
  const world = bellWorld();
  const stop = bellStart.ringWhenShown(world.bell, world.env);
  world.paint(); world.paint();
  assert.equal(world.attrs["data-ringing"], undefined, "created but not mounted: no ring (it would finish unseen)");
  world.mount();
  assert.equal(world.attrs["data-ringing"], undefined, "mounted: waits for a painted frame");
  world.paint();
  assert.equal(world.attrs["data-ringing"], undefined, "one frame");
  world.paint();
  assert.equal(world.attrs["data-ringing"], "true", "two painted frames after mount: ring");
  // Once only: later attribute changes do not schedule another ring.
  world.mount(); world.paint(); world.paint();
  assert.equal(world.frames.length, 0);
  stop();
  assert.equal(world.visibilityListeners.size + world.attributeListeners.size, 0, "cleanup removes every listener");
});

test("a toast mounted while the page is hidden rings when the page becomes visible; unmounting first cancels it", () => {
  const hidden = bellWorld({ visible: false, mounted: "true" });
  bellStart.ringWhenShown(hidden.bell, hidden.env);
  hidden.paint(); hidden.paint();
  assert.equal(hidden.attrs["data-ringing"], undefined, "hidden: no ring");
  hidden.show(); hidden.paint(); hidden.paint();
  assert.equal(hidden.attrs["data-ringing"], "true");
  // Gone before it was painted: the pending frames are cancelled and nothing is set.
  const gone = bellWorld({ mounted: "true" });
  const stop = bellStart.ringWhenShown(gone.bell, gone.env);
  stop(); gone.paint(); gone.paint();
  assert.equal(gone.attrs["data-ringing"], undefined);
  // Outside a Sonner toast (no data-mounted to wait for): rings after two frames.
  const loose = bellWorld({ inToast: false });
  bellStart.ringWhenShown(loose.bell, loose.env);
  loose.paint(); loose.paint();
  assert.equal(loose.attrs["data-ringing"], "true");
});

test("Show test toast is a development diagnostic only (absent from production builds); real toasts never use it", () => {
  const center = code("./notification-center.tsx");
  // The button sits inside the development-only block (Next inlines NODE_ENV, so production drops it).
  const start = center.indexOf('{process.env.NODE_ENV === "development" && <div');
  const devBlock = center.slice(start, center.indexOf("</div>}", start));
  assert.ok(start > 0);
  assert.match(devBlock, /onClick=\{showTestToast\}>Show test toast<\/Button>/);
  assert.equal((center.match(/Show test toast/g) ?? []).length, 1);
  const provider = code("./provider.tsx");
  assert.match(provider, /showTestToast: \(\) => \{\s*if \(!DEVELOPMENT\) return;/);
  // The real path (poll → gate → toast) is independent of the diagnostic.
  const realPath = provider.slice(provider.indexOf("const stop = startForegroundPoll("), provider.indexOf("}, [service, showToasts]);"));
  assert.match(realPath, /showToasts\(gate\.observe\(unread\.items, \{ present: document\.hasFocus\(\) \}\)\)/);
  assert.doesNotMatch(realPath, /showTestToast|developmentNotifications/);
});

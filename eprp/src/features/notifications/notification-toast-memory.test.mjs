import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { composeBaselineNotification } from "../projects/baseline-notifications.ts";
import { createToastGate, TOAST_MEMORY_MAX_AGE_MS } from "./toast-feed.ts";
import { tabToastMemory } from "./toast-memory.ts";

// Phase 13.12 owner UAT — a BL1 re-baseline request reached the approver's
// bell and Notification Center but showed no toast. The approver's tab had
// been idle and came back as a fresh page (reload / a tab the browser
// discarded and restored) about three minutes after the request; the new
// toast gate counted the request as sign-in backlog. The gate (shared by every
// notification kind) now has a per-tab memory: a returning tab toasts what
// arrived while it was away, exactly once; a new tab or sign-in still never
// replays its backlog.

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const at = (iso) => () => Date.parse(iso);
const ids = (result) => result.show.map((entry) => entry.id);
const NONE = { show: [], overflow: 0 };
const PROJECT = "307520a0-b5be-4c87-8f4b-3aa283c66233";
const BASELINE = "22222222-2222-4222-8222-222222222222";

function storage() {
  const map = new Map();
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)) };
}

/** The approver's BL1 request exactly as the service composes it. */
const bl1Request = composeBaselineNotification({
  row: { id: "ca485029", eventType: "baseline_requested", projectId: PROJECT, baselineId: BASELINE,
    actorName: "Project Control", createdAt: "2026-10-26T09:11:36.752Z", readAt: null },
  baseline: { id: BASELINE, projectId: PROJECT, name: "Re-baseline", baselineDate: "2026-10-26", capturedItems: [],
    createdAt: "2026-10-26T09:11:36.752Z", revisionStatus: "requested", reason: "Scope change",
    requestedByUserId: "u-requester", requestedAt: "2026-10-26T09:11:36.752Z" },
  project: { id: PROJECT, code: "ZZ-UAT-PSM-01", name: "Pump Station" },
  number: 1,
  formatDateTime: (iso) => iso,
});
/** An older notification the approver's tab already saw yesterday (still unread). */
const yesterday = { ...bl1Request, id: "4b609b87", createdAt: "2026-10-25T12:05:18.501Z",
  toast: { title: "Baseline approved", description: "ZZ-UAT-PSM-01 · BL0 approved", actionLabel: "View", tone: "approved" } };
/** Any other kind on the same path (an amendment decision): the gate is kind-agnostic. */
const amendment = { ...bl1Request, id: "amend-1", createdAt: "2026-10-26T09:12:10.000Z", target: { type: "project_setup", id: "a", projectId: PROJECT },
  toast: { title: "Amendment approved", description: "ZZ-UAT-PSM-01 · Client", actionLabel: "View", tone: "approved" } };

test("the BL1 request carries the established compact copy (the toast the approver should see)", () => {
  assert.deepEqual(bl1Request.toast, { title: "Baseline approval required", description: "ZZ-UAT-PSM-01 · BL1 revision request", actionLabel: "Review", tone: "approval" });
  assert.equal(bl1Request.actionRequired, true);
});

test("UAT path: the approver's tab comes back as a fresh page after the request — the BL1 request toasts once (and an amendment too)", () => {
  const tab = storage();
  // 09:05 — the approver's tab looks; yesterday's item is already handled there.
  const before = createToastGate(at("2026-10-26T09:05:00Z"), undefined, tabToastMemory("approver", tab));
  assert.deepEqual(before.observe([yesterday], { present: true }), NONE);
  // 09:11:36 the request is made; 09:12 an amendment is decided; the tab is discarded meanwhile and restored at 09:15.
  const restored = createToastGate(at("2026-10-26T09:15:00Z"), undefined, tabToastMemory("approver", tab));
  const result = restored.observe([amendment, bl1Request, yesterday], { present: true });
  assert.deepEqual(ids(result), ["ca485029", "amend-1"], "oldest first; yesterday's item is not replayed");
  assert.deepEqual(result.show[0].toast, bl1Request.toast);
  // Never twice: later refreshes, focus, and another reload.
  assert.deepEqual(restored.observe([amendment, bl1Request, yesterday], { present: true }), NONE);
  assert.deepEqual(restored.flush(), NONE);
  const reloaded = createToastGate(at("2026-10-26T09:20:00Z"), undefined, tabToastMemory("approver", tab));
  assert.deepEqual(reloaded.observe([amendment, bl1Request, yesterday], { present: true }), NONE);
});

test("a new tab or a fresh sign-in (no memory) still never replays its backlog", () => {
  const fresh = createToastGate(at("2026-10-26T09:15:00Z"), undefined, tabToastMemory("approver", storage()));
  assert.deepEqual(fresh.observe([bl1Request, yesterday], { present: true }), NONE);
  const withoutStorage = createToastGate(at("2026-10-26T09:15:00Z"));
  assert.deepEqual(withoutStorage.observe([bl1Request, yesterday], { present: true }), NONE);
});

test("an arrival fetched while the window was unfocused, then reloaded before it showed, still toasts once", () => {
  const tab = storage();
  const first = createToastGate(at("2026-10-26T09:10:00Z"), undefined, tabToastMemory("approver", tab));
  first.observe([yesterday], { present: true });
  assert.deepEqual(first.observe([bl1Request, yesterday], { present: false }), NONE, "pending, not consumed");
  const reloaded = createToastGate(at("2026-10-26T09:13:00Z"), undefined, tabToastMemory("approver", tab));
  assert.deepEqual(ids(reloaded.observe([bl1Request, yesterday], { present: true })), ["ca485029"]);
  assert.deepEqual(reloaded.observe([bl1Request, yesterday], { present: true }), NONE);
});

test("a tab idle longer than the memory window starts afresh; read items never toast", () => {
  const tab = storage();
  createToastGate(at("2026-10-25T08:00:00Z"), undefined, tabToastMemory("approver", tab)).observe([], { present: true });
  // Restored the next morning, more than the memory window later: the request made meanwhile is backlog.
  assert.ok(Date.parse("2026-10-26T09:15:00Z") - Date.parse("2026-10-25T08:00:00Z") > TOAST_MEMORY_MAX_AGE_MS);
  const late = createToastGate(at("2026-10-26T09:15:00Z"), undefined, tabToastMemory("approver", tab));
  assert.deepEqual(late.observe([bl1Request], { present: true }), NONE);

  const other = storage();
  createToastGate(at("2026-10-26T09:05:00Z"), undefined, tabToastMemory("approver", other)).observe([], { present: true });
  const restored = createToastGate(at("2026-10-26T09:15:00Z"), undefined, tabToastMemory("approver", other));
  assert.deepEqual(restored.observe([{ ...bl1Request, readAt: "2026-10-26T09:14:00Z" }], { present: true }), NONE);
});

test("the memory is per tab and per user, bounded, and tolerant of missing or broken storage", () => {
  const tab = storage();
  createToastGate(at("2026-10-26T09:05:00Z"), undefined, tabToastMemory("approver", tab)).observe([yesterday], { present: true });
  assert.ok(tabToastMemory("approver", tab).load(), "remembered for this user");
  assert.equal(tabToastMemory("requester", tab).load(), null, "another account in the same tab starts afresh");
  assert.equal(tabToastMemory(null, tab), undefined, "no viewer, no memory");
  assert.equal(tabToastMemory("approver", null), undefined, "no storage, no memory");
  tab.setItem("eprp:notification-toasts:approver", "{not json");
  assert.equal(tabToastMemory("approver", tab).load(), null);
  const refusing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } };
  const gate = createToastGate(at("2026-10-26T09:15:00Z"), undefined, tabToastMemory("approver", refusing));
  assert.deepEqual(gate.observe([bl1Request], { present: true }), NONE, "behaves as a first visit");
  // Bounded: only the most recent handled ids are kept.
  const many = storage();
  const busy = createToastGate(at("2026-10-26T09:05:00Z"), undefined, tabToastMemory("approver", many));
  busy.observe(Array.from({ length: 250 }, (_, index) => ({ ...yesterday, id: `old-${index}` })), { present: true });
  assert.equal(JSON.parse(many.getItem("eprp:notification-toasts:approver")).handled.length, 200);
  assert.match(source("./toast-memory.ts"), /window\.sessionStorage/);
  assert.doesNotMatch(source("./toast-memory.ts"), /localStorage/);
});

test("the Notification Center does not depend on toasts: the gate never changes an item, and the bell / list never read it", () => {
  const before = structuredClone(bl1Request);
  const gate = createToastGate(at("2026-10-26T09:15:00Z"));
  gate.observe([bl1Request], { present: true });
  gate.observe([bl1Request], { present: false });
  gate.flush();
  assert.deepEqual(bl1Request, before);
  for (const file of ["./notification-center.tsx", "./notification-bell.tsx", "../../services/setup-notification-service.ts"]) {
    let text = "";
    try { text = source(file); } catch { continue; }
    assert.doesNotMatch(text, /toast-feed|toast-memory|createToastGate/, file);
  }
  // The list is the service's own read of user_notifications, whatever the toasts did.
  assert.match(source("./provider.tsx"), /void service\.list\(parsed\.query\)\.then\(/);
});

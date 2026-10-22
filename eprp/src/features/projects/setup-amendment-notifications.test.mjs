import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

// Phase 13.9B — actionable notifications for Project Setup amendments.
// SOURCE / PRESENTATION CONTRACTS. The database decides who is notified
// (migration 20261020090000; proved by scripts/p0-validation/127); these prove
// the wording, the deep link, that the EXISTING notification system is reused,
// and that the migration keeps the shape suite 127 exercises.

registerHooks({ load(url, context, nextLoad) {
  if (!(url.includes("/eprp/src/") && url.endsWith(".ts"))) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });

const notify = await import("./setup-amendment-notifications.ts");
const model = await import("../notifications/model.ts");

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");
const sql = readFileSync(new URL("../../../supabase/migrations/20261020090000_project_setup_amendment_notifications.sql", import.meta.url), "utf8").replaceAll("\r", "");
const fn = (name) => {
  const start = sql.indexOf(`function public.${name}(`);
  assert.ok(start >= 0, name);
  const open = sql.indexOf("$fn$", start);
  return sql.slice(start, sql.indexOf("$fn$", open + 4));
};

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const AMENDMENT_ID = "22222222-2222-4222-8222-222222222222";
const amendment = (over = {}) => ({
  id: AMENDMENT_ID, projectId: PROJECT_ID, fieldKey: "currency", targetKey: "", amendmentClass: "governed",
  previousValue: { currency: "EGP" }, proposedValue: { currency: "USD" }, reason: "Contract currency",
  impactCode: "COMMERCIAL_INTERPRETATION", impactWarning: "w", requestedBy: "x", requestedByName: "Dina Samir",
  requestedAt: "2026-10-17T10:00:00Z", status: "pending", decidedBy: null, decidedByName: null, decidedAt: null,
  decisionComment: null, ...over,
});
const row = (eventType, over = {}) => ({
  id: "33333333-3333-4333-8333-333333333333", eventType, projectId: PROJECT_ID, sourceId: AMENDMENT_ID,
  actorName: null, createdAt: "2026-10-17T10:00:00Z", readAt: null, ...over,
});
const project = { id: PROJECT_ID, code: "MDP-PSAIM-01", name: "Pump Station" };
const compose = (eventType, a, over = {}) =>
  notify.composeAmendmentNotification({
    row: row(eventType, over), amendment: a, project, lookups: {}, formatDateTime: (iso) => `@${iso.slice(0, 16)}`,
  });

/* --------------------------------- wording -------------------------------- */

const rows = (item) => Object.fromEntries(item.details.map((detail) => [detail.label, detail.value]));
const labels = (item) => item.details.map((detail) => detail.label);
const decided = { decidedByName: "Omar Fathy", decidedAt: "2026-10-17T12:30:00Z" };

test("submitted → approver: one structured card (requester, request, project, time, reason)", () => {
  const item = compose("amendment_submitted", amendment());
  assert.equal(item.title, "Approval required");
  assert.equal(item.category, "approvals");
  assert.deepEqual(item.details, [
    { label: "Requested by", value: "Dina Samir" },
    { label: "Request", value: "Currency: EGP → USD" },
    { label: "Project", value: "MDP-PSAIM-01 · Pump Station" },
    { label: "Requested", value: "@2026-10-17T10:00" },
    { label: "Reason", value: "Contract currency" },
  ]);
  // The fallback line is one short sentence, never a paragraph; the impact text is not in the card.
  assert.equal(item.description, "Currency: EGP → USD · MDP-PSAIM-01 · Pump Station");
  assert.ok(!JSON.stringify(item).includes('"w"'));
  assert.equal(item.readAt, null);
  assert.equal(item.projectId, PROJECT_ID);
});

test("approved → requester: request, requester, decider, project, both times", () => {
  const item = compose("amendment_approved", amendment({ status: "approved", ...decided }));
  assert.equal(item.title, "Request approved");
  assert.deepEqual(item.details, [
    { label: "Request", value: "Currency: EGP → USD" },
    { label: "Requested by", value: "Dina Samir" },
    { label: "Decision by", value: "Omar Fathy" },
    { label: "Project", value: "MDP-PSAIM-01 · Pump Station" },
    { label: "Requested", value: "@2026-10-17T10:00" },
    { label: "Decision time", value: "@2026-10-17T12:30" },
  ]);
  // An approval comment is shown only when one was recorded.
  assert.equal(rows(compose("amendment_approved", amendment({ status: "approved", ...decided, decisionComment: "Agreed with the client." }))).Comment, "Agreed with the client.");
});

test("rejected → requester: the same card plus the rejection reason", () => {
  const item = compose("amendment_rejected", amendment({ status: "rejected", ...decided, decisionComment: "Stays on the contract currency." }));
  assert.equal(item.title, "Request rejected");
  assert.deepEqual(labels(item), ["Request", "Requested by", "Decision by", "Project", "Requested", "Decision time", "Reason"]);
  assert.equal(rows(item).Reason, "Stays on the contract currency.");
  assert.equal(rows(item)["Decision by"], "Omar Fathy");
  // No decider name on the request: the notification's actor, then a neutral fallback.
  assert.equal(rows(compose("amendment_rejected", amendment({ status: "rejected" }), { actorName: "Executive Review" }))["Decision by"], "Executive Review");
  assert.equal(rows(compose("amendment_rejected", amendment({ status: "rejected" })))["Decision by"], "a Project Control Admin");
  assert.equal(rows(compose("amendment_rejected", amendment({ status: "rejected" }))).Reason, "No reason was recorded.");
});

test("stale → requester: nothing was applied, with the server's reason when it adds something", () => {
  const item = compose("amendment_stale", amendment({ status: "stale", decisionComment: "The value changed after this request; nothing was applied." }));
  assert.equal(item.title, "Request not applied");
  assert.deepEqual(labels(item), ["Request", "Requested by", "Project", "Requested", "Outcome", "Detail"]);
  assert.equal(rows(item).Outcome, "Nothing was applied: the underlying value changed after the request.");
  assert.equal(rows(item).Detail, "The value changed after this request; nothing was applied.");
  // Still says what happened when the amendment itself cannot be read.
  const unreadable = notify.composeAmendmentNotification({ row: row("amendment_stale"), amendment: null, project, lookups: {}, formatDateTime: String });
  assert.deepEqual(unreadable.details, [
    { label: "Request", value: "Project Setup request (no longer available)" },
    { label: "Project", value: "MDP-PSAIM-01 · Pump Station" },
    { label: "Outcome", value: "Nothing was applied: the underlying value changed after the request." },
  ]);
  assert.match(unreadable.description, /underlying value changed/);
});

test("frozen → requester: the project was archived while the request was pending", () => {
  const item = compose("amendment_frozen", amendment());
  assert.equal(item.title, "Request frozen");
  assert.equal(rows(item).Outcome, "The project was archived while the request was pending. It can no longer be decided.");
  assert.ok(!labels(item).includes("Decision by"));
});

test("structure requests are worded in business terms, never ids", () => {
  const item = compose("amendment_submitted", amendment({
    fieldKey: "structure_units", targetKey: "unit:u2", previousValue: { unit: { name: "U2", code: null } },
    proposedValue: { action: "rename", unit_id: "u2", name: "Unit Two", labels: { target: "U2", level: "Unit" } },
  }));
  assert.equal(rows(item).Request, "Rename Unit · U2 → Unit Two");
  assert.doesNotMatch([...item.details.map((detail) => detail.value), item.description, item.toast.description].join(" "), /null|undefined|unit_id|\{/);
});

test("every event uses the same card shape and correct Unicode (no mojibake)", () => {
  const events = ["amendment_submitted", "amendment_approved", "amendment_rejected", "amendment_stale", "amendment_frozen"];
  for (const event of events) {
    const item = compose(event, amendment({ status: "rejected", ...decided, decisionComment: "c" }));
    assert.ok(item.details.length >= 4, event);
    assert.ok(item.details.every((detail) => detail.label && detail.value), event);
    // 13.11 UAT: the toast has its own compact status title; the card keeps the full one.
    assert.ok(item.toast && item.toast.title && item.toast.description.split("\n").length === 1, event);
    const text = JSON.stringify(item);
    assert.doesNotMatch(text, /Ã|Â|â€|â†|�/, event);
  }
  // The notification sources themselves carry no double-encoded characters.
  for (const file of ["./setup-amendment-notifications.ts", "../notifications/notification-center.tsx", "../notifications/model.ts",
    "../notifications/toast-feed.ts", "../notifications/toast-bell.tsx", "../notifications/provider.tsx", "../../lib/formatters.ts", "../../app/globals.css"]) {
    assert.doesNotMatch(source(file), /Ã|Â|â€|â†/, file);
  }
});

/* -------------------------------- deep link ------------------------------- */

test("deep link: Project Setup → Info (Setup amendments) with the request focused", () => {
  const item = compose("amendment_submitted", amendment());
  assert.deepEqual(item.target, { type: "setup_amendment", id: AMENDMENT_ID, projectId: PROJECT_ID });
  assert.equal(model.notificationHref(item.target), `/projects/${PROJECT_ID}/setup/info?amendment=${AMENDMENT_ID}`);
  assert.equal(model.notificationHref({ type: "setup_amendment", id: "not-a-uuid", projectId: PROJECT_ID }), null);
  // The existing destinations are unchanged.
  assert.equal(model.notificationHref({ type: "milestone", id: AMENDMENT_ID, projectId: PROJECT_ID }), `/projects/${PROJECT_ID}/milestones`);
  // The page passes the request to the panel, which opens the right tab and highlights it.
  assert.match(code("../../app/(app)/projects/[projectId]/setup/[step]/page.tsx"), /focusAmendmentId=\{Array\.isArray\(amendment\) \? amendment\[0\] : amendment\}/);
  const panel = code("./components/governance/setup-amendments-panel.tsx");
  assert.match(panel, /focused\s*\?\s*actionable\.some\(\(amendment\) => amendment\.id === focused\.id\) \? "approvals" : "all"/);
  assert.match(panel, /scrollIntoView\(\{ block: "center"/);
  assert.match(panel, /data-focused=\{focused \? "true" : undefined\}/);
  assert.match(code("./components/setup/project-setup-view.tsx"), /focusAmendmentId=\{focusAmendmentId\}/);
});

/* ------------------------- the existing system is reused ------------------ */

test("the existing bell, inbox and contract are reused — a backend behind NotificationService, not a new framework", () => {
  const service = code("../../services/setup-notification-service.ts");
  assert.match(service, /mode: "connected"/);
  assert.match(service, /export function createSetupNotificationService\(\): NotificationService/);
  assert.match(service, /isSupabaseConfigured\(\) \? createSetupNotificationService\(\) : createNotificationAdapter\(\)/);
  // Reads its own rows and sets read_at; never inserts or deletes.
  assert.match(service, /from\("user_notifications"\)/);
  assert.doesNotMatch(service, /\.(insert|delete|upsert)\(/);
  assert.match(service, /update\(\{ read_at: /);
  assert.match(service, /rpc\("reconcile_my_setup_amendment_notifications"\)/);
  const provider = code("../notifications/provider.tsx");
  assert.match(provider, /useState<NotificationService>\(\(\) => createDefaultNotificationService\(\)\)/);
  assert.match(provider, /: createDefaultNotificationService\(\)\);/);
  // The shell, its categories and its adapter are untouched.
  assert.match(code("../notifications/model.ts"), /export function createNotificationAdapter\(/);
  assert.match(code("../notifications/notification-center.tsx"), /connected \? "Project Setup approvals"/);
});

/* ---------------------------- database contracts -------------------------- */

test("who is notified: governed submit → active approvers except the requester; decisions → the requester only", () => {
  const event = fn("notify_setup_amendment_event");
  assert.match(event, /new\.status = 'pending' and new\.amendment_class = 'governed'/);
  assert.match(event, /p\.active and p\.role in \('system_admin', 'project_control_admin'\) and p\.id <> new\.requested_by/);
  assert.match(event, /old\.status = 'pending' and new\.status in \('approved', 'rejected', 'stale'\)/);
  assert.match(event, /where p\.id = new\.requested_by/);
  // Withdrawn, lightweight (applied) and free edits are not events.
  assert.doesNotMatch(event, /withdrawn|'applied'|lightweight/);
  assert.match(sql, /create trigger notify_setup_amendment_event\s+after insert or update on public\.project_setup_amendments/);
  // No amendment writer was re-created: the event source is the table.
  assert.doesNotMatch(sql, /create (or replace )?function public\.(request_|decide_|withdraw_)/);
});

test("actionability is derived at read time and never mutates an amendment", () => {
  const visible = fn("setup_notification_visible");
  assert.match(visible, /p_event <> 'amendment_submitted' then true/);
  assert.match(visible, /public\.has_global_operational_authority\(\)/);
  assert.match(visible, /a\.status = 'pending'\s+and not public\.project_is_archived\(a\.project_id\)/);
  assert.match(sql, /using \(recipient_id = \(select auth\.uid\(\)\)\s+and public\.current_user_role\(\) is not null\s+and public\.setup_notification_visible\(event_type, source_id\)\)/);
  assert.doesNotMatch(sql, /update public\.project_setup_amendments|alter table public\.project_setup_amendments/);
  // Frozen: the requester is told; the amendment is left pending.
  const frozen = fn("notify_setup_amendments_frozen");
  assert.match(frozen, /a\.status = 'pending' and a\.amendment_class = 'governed'/);
  assert.match(sql, /after update of status on public\.projects\s+for each row when \(new\.status = 'archived' and old\.status is distinct from 'archived'\)/);
});

test("clients read their own rows and set read_at only; the reconcile is caller-scoped and idempotent", () => {
  assert.match(sql, /grant select on public\.user_notifications to authenticated, service_role;\s+grant update \(read_at\) on public\.user_notifications to authenticated;/);
  assert.match(sql, /create unique index user_notifications_one_per_event on public\.user_notifications \(recipient_id, event_type, source_id\)/);
  const reconcile = fn("reconcile_my_setup_amendment_notifications");
  assert.match(reconcile, /public\.has_global_operational_authority\(\) is distinct from true then\s+return/);
  assert.match(reconcile, /select auth\.uid\(\), 'amendment_submitted'/);
  assert.match(reconcile, /a\.requested_by <> auth\.uid\(\)/);
  assert.match(reconcile, /on conflict do nothing/);
  assert.match(reconcile, /not public\.project_is_archived\(a\.project_id\)/);
  // The one-time backfill writes notifications only.
  assert.match(sql, /one-time backfill \(pending\)[\s\S]*?insert into public\.user_notifications[\s\S]*?on conflict do nothing;/);
});


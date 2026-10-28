import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { baselineNumberOf, composeBaselineNotification, isBaselineNotificationEvent } from "./baseline-notifications.ts";
import { notificationHref } from "../notifications/model.ts";
import { isAmendmentNotificationEvent } from "./setup-amendment-notifications.ts";

// Phase 13.12 (browser UAT) — Baseline Revision notifications on the EXISTING
// notification system (user_notifications, bell, inbox, compact toast). The
// runtime proof against real PostgreSQL and roles is
// scripts/p0-validation/134_runtime_13_12_baseline_notifications.sql (33/33).

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const PROJECT = "11111111-1111-4111-8111-111111111111";
const BASELINE = "22222222-2222-4222-8222-222222222222";
const project = { id: PROJECT, code: "ZZ-UAT-PSM-01", name: "Pump Station" };
const baseline = (over = {}) => ({
  id: BASELINE, projectId: PROJECT, name: "Baseline request", baselineDate: "2026-10-25", capturedItems: [], createdAt: "2026-10-25T08:00:00Z",
  revisionStatus: "requested", reason: "Contract schedule agreed", requestedByUserId: "u-x", requestedAt: "2026-10-25T08:00:00Z",
  capture: { nodes: [], activities: [] }, curveEngineVersion: "1.0.0", ...over,
});
const row = (eventType, over = {}) => ({
  id: `n-${eventType}`, eventType, projectId: PROJECT, baselineId: BASELINE, actorName: "Requester Name",
  createdAt: "2026-10-25T08:00:00Z", readAt: null, ...over,
});
const compose = (eventType, b = baseline(), number = 0) =>
  composeBaselineNotification({ row: row(eventType), baseline: b, project, number, formatDateTime: (iso) => `@${iso.slice(0, 16)}` });

/* ------------------------------- the toast --------------------------------- */

test("BL0 request: 'BL0 approval required' · '<CODE> · Original baseline request' · Review — actionable while requested", () => {
  const item = compose("baseline_requested");
  assert.deepEqual(item.toast, { title: "BL0 approval required", description: "ZZ-UAT-PSM-01 · Original baseline request", actionLabel: "Review", tone: "approval" });
  assert.equal(item.title, "BL0 approval required");
  assert.equal(item.category, "approvals");
  assert.equal(item.actionRequired, true);
});

test("BLn request: 'Baseline approval required' · '<CODE> · BL<n> revision request'", () => {
  assert.deepEqual(compose("baseline_requested", baseline(), 2).toast,
    { title: "Baseline approval required", description: "ZZ-UAT-PSM-01 · BL2 revision request", actionLabel: "Review", tone: "approval" });
});

test("decisions notify the requester: 'Baseline approved' / 'Baseline rejected' · '<CODE> · BL<n> …'", () => {
  const approved = compose("baseline_approved", baseline({ revisionStatus: "approved", revisionNumber: 1, decidedAt: "2026-10-26T09:00:00Z" }), 1);
  assert.deepEqual(approved.toast, { title: "Baseline approved", description: "ZZ-UAT-PSM-01 · BL1 approved", actionLabel: "View", tone: "approved" });
  assert.equal(approved.actionRequired, false);
  const rejected = compose("baseline_rejected", baseline({ revisionStatus: "rejected", decidedAt: "2026-10-26T09:00:00Z", decisionComment: "Wrong period" }), 1);
  assert.deepEqual(rejected.toast, { title: "Baseline rejected", description: "ZZ-UAT-PSM-01 · BL1 rejected", actionLabel: "View", tone: "rejected" });
  assert.deepEqual(rejected.details.find((d) => d.label === "Reason"), { label: "Reason", value: "Wrong period" });
});

test("a decided or withdrawn request is no longer actionable (no dead approval action)", () => {
  for (const status of ["approved", "rejected", "withdrawn"]) {
    assert.equal(compose("baseline_requested", baseline({ revisionStatus: status })).actionRequired, false, status);
  }
  assert.equal(compose("baseline_requested", null).actionRequired, false, "no longer readable");
});

test("the toast stays compact: one context line, no reason, captured activities or people", () => {
  for (const event of ["baseline_requested", "baseline_approved", "baseline_rejected"]) {
    const toast = compose(event, baseline({ reason: "x".repeat(300), decisionComment: "y".repeat(300) })).toast;
    assert.equal(toast.description.split("\n").length, 1, event);
    assert.doesNotMatch(toast.description, /xxx|yyy|Requester|activities/, event);
  }
});

test("BL<n>: the approved number, or the number a request / rejection would take", () => {
  assert.equal(baselineNumberOf(baseline({ revisionStatus: "approved", revisionNumber: 3 }), []), 3);
  assert.equal(baselineNumberOf(baseline(), []), 0, "first request = BL0");
  assert.equal(baselineNumberOf(baseline({ requestedAt: "2026-10-25T08:00:00Z" }),
    ["2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"]), 2, "only approvals before it count");
  assert.equal(baselineNumberOf(null, []), null);
});

/* ------------------------------- the deep link ------------------------------ */

test("every baseline notification opens Planning Workspace → Baselines & Snapshots with the request focused", () => {
  const item = compose("baseline_requested");
  assert.deepEqual(item.target, { type: "planning_baseline", id: BASELINE, projectId: PROJECT });
  assert.equal(notificationHref(item.target), `/projects/${PROJECT}/planning?view=baselines&baseline=${BASELINE}`);
  const panel = read("./components/planning/baselines-snapshots-panel.tsx");
  assert.match(panel, /new URLSearchParams\(window\.location\.search\)\.get\("baseline"\)/);
  assert.match(panel, /data-focused=\{baseline\.id === focusId \? "true" : undefined\}/);
});

/* --------------------- one system; amendments unchanged --------------------- */

test("one notification system: the service composes amendment and baseline rows in inbox order", () => {
  const service = read("../../services/setup-notification-service.ts");
  assert.match(service, /const items: NotificationItem\[\] = inbox\.map\(\(entry\) => \{/);
  assert.match(service, /composeAmendmentNotification\(\{\s*row: entry\.row,\s*amendment: amendments\.get\(entry\.row\.sourceId\) \?\? null,/);
  assert.match(service, /composeBaselineNotification\(\{/);
  assert.match(service, /client\(\)\.rpc\("reconcile_my_setup_amendment_notifications"\)/);
  // The event families never overlap.
  for (const event of ["baseline_requested", "baseline_approved", "baseline_rejected"]) {
    assert.ok(isBaselineNotificationEvent(event) && !isAmendmentNotificationEvent(event), event);
  }
  assert.ok(!isBaselineNotificationEvent("amendment_submitted"));
});

test("database: approvers only, never the requester, one row each; read-time actionability; amendment branch unchanged", () => {
  const sql = read("../../../supabase/migrations/20261025090200_baseline_notifications.sql")
    .replace(/--[^\n]*/g, "");
  assert.match(sql, /where p\.active and p\.role in \('system_admin', 'project_control_admin'\)\s+and p\.id is distinct from new\.requested_by_user_id/);
  assert.match(sql, /elsif old\.revision_status = 'requested' and new\.revision_status in \('approved', 'rejected'\) then/);
  assert.match(sql, /where p\.id = new\.requested_by_user_id/);
  assert.match(sql, /create unique index user_notifications_one_per_baseline_event\s+on public\.user_notifications \(recipient_id, event_type, baseline_id\) where baseline_id is not null;/);
  assert.match(sql, /when p_event = 'baseline_requested' then\s+public\.has_global_operational_authority\(\)\s+and exists \(select 1 from public\.planning_baselines b\s+where b\.id = p_source and b\.revision_status = 'requested'\s+and not public\.project_is_archived\(b\.project_id\)\)/);
  assert.match(sql, /public\.setup_notification_visible\(event_type, coalesce\(source_id, baseline_id\)\)/);
  // The amendment branch keeps its 13.9B definition word for word.
  assert.match(sql, /when p_event = 'amendment_submitted' then\s+public\.has_global_operational_authority\(\)\s+and exists \(select 1 from public\.project_setup_amendments a\s+where a\.id = p_source and a\.status = 'pending'\s+and not public\.project_is_archived\(a\.project_id\)\)/);
  assert.doesNotMatch(sql, /create (or replace )?function public\.notify_setup_amendment_event/);
  // No withdrawal notification: approvers' rows stop being visible / actionable instead.
  assert.doesNotMatch(sql, /'baseline_withdrawn'/);
});

test("freshness: the deciding tab refreshes its bell after a request / decision / withdrawal (no polling added)", () => {
  const panel = read("./components/planning/baselines-snapshots-panel.tsx");
  assert.match(panel, /const notifications = useNotificationsIfAvailable\(\);/);
  assert.match(panel, /void notifications\?\.refresh\(\);/);
  assert.doesNotMatch(panel, /setInterval/);
});

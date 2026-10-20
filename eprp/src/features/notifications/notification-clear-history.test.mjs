import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

// Phase 13.9B (UAT) — "Clear history" for the notification inbox.
// SOURCE / CONTRACT tests. The database behaviour (own rows only, pending
// approvals kept, other users and amendments untouched, new events arrive
// normally) is proved on real RLS by scripts/p0-validation/129.

registerHooks({ load(url, context, nextLoad) {
  if (!(url.includes("/eprp/src/") && url.endsWith(".ts"))) return nextLoad(url, context);
  return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText };
} });

const model = await import("./model.ts");
const notify = await import("../projects/setup-amendment-notifications.ts");

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r", "");
const code = (path) => source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "").replace(/^\s*--[^\n]*$/gm, "");
const MIGRATION = "../../../supabase/migrations/20261021090000_notification_history_clear.sql";

test("storage: rows are hidden for their recipient (cleared_at), never deleted; the select policy hides them", () => {
  const sql = code(MIGRATION);
  assert.match(sql, /alter table public\.user_notifications add column cleared_at timestamptz;/);
  assert.match(sql, /create policy user_notifications_select on public\.user_notifications\s+for select to authenticated\s+using \(recipient_id = \(select auth\.uid\(\)\)\s+and cleared_at is null/);
  // Nothing is deleted, and no other table is written.
  assert.doesNotMatch(sql, /\bdelete\s+from\b|\btruncate\b/i);
  assert.deepEqual([...sql.matchAll(/\bupdate\s+(public\.\w+)/gi)].map((match) => match[1]), ["public.user_notifications"]);
  assert.doesNotMatch(sql, /project_setup_amendments\s+set|project_setup_relation_changes\s+set|insert into/i);
});

test("scope: the caller's own rows only, never one that still requires action", () => {
  const sql = code(MIGRATION);
  const clear = sql.slice(sql.indexOf("create function public.clear_my_notification_history()"), sql.indexOf("$fn$;", sql.indexOf("create function public.clear_my_notification_history()")));
  assert.match(clear, /security definer set search_path = ''/);
  assert.match(clear, /if auth\.uid\(\) is null or public\.current_user_role\(\) is null then\s+raise exception using errcode = '42501'/);
  assert.match(clear, /set cleared_at = now\(\)\s+where n\.recipient_id = auth\.uid\(\)\s+and n\.cleared_at is null\s+and not public\.notification_requires_action\(n\.event_type, n\.source_id\);/);
  // Action required = a request still pending (also while archived or the reader's authority lapsed).
  const requires = sql.slice(sql.indexOf("create function public.notification_requires_action"), sql.indexOf("$fn$;", sql.indexOf("create function public.notification_requires_action")));
  assert.match(requires, /when p_event = 'amendment_submitted' then exists \(\s*select 1 from public\.project_setup_amendments a where a\.id = p_source and a\.status = 'pending'\)/);
  assert.match(requires, /else false/);
  assert.doesNotMatch(requires, /archived|authority/);
  // Clients still write read_at only; anon cannot clear.
  assert.match(sql, /has_column_privilege\('authenticated', 'public\.user_notifications', 'cleared_at', 'UPDATE'\)/);
  assert.match(sql, /revoke execute on function public\.clear_my_notification_history\(\) from public, anon;/);
  assert.doesNotMatch(sql, /grant update \(cleared_at\)/);
});

test("the connected service clears through the server function only", () => {
  const service = code("../../services/setup-notification-service.ts");
  assert.match(service, /async clearHistory\(\) \{\s*const result = await client\(\)\.rpc\("clear_my_notification_history"\);\s*if \(result\.error\) throw new Error\(/);
  assert.doesNotMatch(service, /\.(insert|delete|upsert)\(|cleared_at/);
});

test("action required is carried on the item: a pending approval only", () => {
  const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
  const base = { id: "22222222-2222-4222-8222-222222222222", projectId: PROJECT_ID, fieldKey: "currency", targetKey: "", amendmentClass: "governed",
    previousValue: { currency: "EGP" }, proposedValue: { currency: "USD" }, reason: "r", impactCode: null, impactWarning: "", requestedBy: "x",
    requestedByName: "Dina", requestedAt: "2026-10-20T10:00:00Z", status: "pending", decidedBy: null, decidedByName: null, decidedAt: null, decisionComment: null };
  const compose = (eventType, amendment) => notify.composeAmendmentNotification({
    row: { id: "n", eventType, projectId: PROJECT_ID, sourceId: base.id, actorName: null, createdAt: "2026-10-20T10:00:00Z", readAt: null },
    amendment, project: { id: PROJECT_ID, code: "C", name: "P" }, lookups: {}, formatDateTime: String });
  assert.equal(compose("amendment_submitted", base).actionRequired, true);
  assert.equal(compose("amendment_submitted", { ...base, status: "approved" }).actionRequired, false);
  assert.equal(compose("amendment_submitted", null).actionRequired, false);
  for (const event of ["amendment_approved", "amendment_rejected", "amendment_stale", "amendment_frozen"]) {
    assert.equal(compose(event, { ...base, status: "rejected" }).actionRequired, false, event);
  }
});

test("the inbox: clear removes resolved items, keeps action-required ones; counts and filters stay right; new items arrive", async () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const samples = model.developmentNotifications(now);
  const service = model.createNotificationAdapter("development", samples.items, samples.options);
  const before = await service.getOverview();
  assert.ok(before.unreadCount > 1);
  await service.clearHistory();
  const all = await service.list({ ...model.defaultQuery, pageSize: 50 });
  assert.deepEqual(all.items.map((entry) => entry.id), ["sample-0"], "only the action-required item stays");
  assert.equal(all.total, 1);
  assert.equal((await service.getOverview()).unreadCount, 1, "the unread count follows");
  assert.equal((await service.list({ ...model.defaultQuery, read: "read" })).total, 0, "filters work on what remains");
  assert.equal((await service.list({ ...model.defaultQuery, projectId: all.items[0].projectId })).total, 1);
  // Clear and Mark all read are different operations: marking read keeps items; clearing again keeps the action.
  await service.markAllRead(now.toISOString());
  assert.equal((await service.list(model.defaultQuery)).total, 1);
  await service.clearHistory();
  assert.equal((await service.list(model.defaultQuery)).total, 1);
  // Without a backend nothing can be cleared.
  await assert.rejects(model.createNotificationAdapter().clearHistory(), /not connected/);
});

test("the UI: a confirmed, separate action beside Mark all read that refreshes the inbox without a reload", () => {
  const center = code("./notification-center.tsx");
  assert.match(center, /<CheckCheck className="size-4" \/>Mark all read<\/Button>\s*<ConfirmDialog/);
  assert.match(center, /title="Clear notification history\?"/);
  assert.match(center, /description="Removes resolved and informational notifications from your inbox\. Items that still require your action remain visible\. Project and approval history are not affected\."/);
  assert.match(center, /confirmLabel="Clear history"\s*cancelLabel="Cancel"/);
  assert.match(center, /if \(!\(await center\.clearHistory\(\)\)\) throw new Error\(/);   // a failure keeps the dialog open
  // The provider runs it like Mark all read: one mutation, then a refresh that re-renders the bell and every list.
  const provider = code("./provider.tsx");
  assert.match(provider, /clearHistory: \(\) => mutate\(\(\) => service\.clearHistory\(\)\),/);
  assert.match(provider, /try \{ await operation\(\); return await refresh\(\); \}/);
  assert.match(provider, /setOverview\(next\); setRevision\(\(value\) => value \+ 1\);/);
  // It is the platform's inbox action, not a Project Setup one.
  assert.match(code("./model.ts"), /clearHistory\(\): Promise<void>;/);
});

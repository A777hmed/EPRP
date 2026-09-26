import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createNotificationAdapter, defaultPreferences, defaultQuery, developmentNotifications, groupNotifications, notificationHref } from "./model.ts";
const seed = () => developmentNotifications(new Date("2026-09-27T12:00:00Z"));
const adapter = () => { const samples = seed(); return createNotificationAdapter("development", samples.items, samples.options); };

test("default adapter is genuinely empty even when samples are supplied", async () => {
  const samples = seed();
  const service = createNotificationAdapter("disconnected", samples.items, samples.options);
  assert.equal((await service.getOverview()).unreadCount, 0);
  assert.deepEqual((await service.getOverview()).options.projects, []);
  assert.deepEqual((await service.list(defaultQuery)).items, []);
  await assert.rejects(service.setRead("sample-1", true), /not connected/);
  await assert.rejects(service.markAllRead("2026-09-27T12:00:00Z"), /not connected/);
});
test("panel, history and unread count observe the same read-state service", async () => {
  const service = adapter();
  const before = (await service.getOverview()).unreadCount;
  const item = (await service.list({ ...defaultQuery, pageSize: 5 })).items[0];
  await service.setRead(item.id, true);
  assert.equal((await service.getOverview()).unreadCount, before - 1);
  assert.ok((await service.list(defaultQuery)).items.find((row) => row.id === item.id).readAt);
  await service.setRead(item.id, true);
  assert.equal((await service.getOverview()).unreadCount, before - 1);
  await service.setRead(item.id, false);
  assert.equal((await service.getOverview()).unreadCount, before);
});
test("mark all read uses a cutoff and does not consume newer arrivals", async () => {
  const service = adapter();
  await service.markAllRead("2026-09-27T11:00:00Z");
  assert.equal((await service.getOverview()).unreadCount, 1);
  await service.markAllRead("2026-09-28T12:00:00Z");
  assert.equal((await service.getOverview()).unreadCount, 0);
  assert.equal((await service.list({ ...defaultQuery, read: "unread" })).total, 0);
});
test("pagination, project/category filters and read filters compose without duplicating rows", async () => {
  const service = adapter();
  const first = await service.list({ ...defaultQuery, pageSize: 5 });
  const second = await service.list({ ...defaultQuery, pageSize: 5, page: 2 });
  assert.equal(first.pageCount, 3);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 10);
  const projectId = seed().options.projects[0].id;
  const filtered = await service.list({ ...defaultQuery, projectId, category: "tasks", read: "unread" });
  assert.ok(filtered.items.length > 0);
  assert.ok(filtered.items.every((item) => item.projectId === projectId && item.category === "tasks" && !item.readAt));
  assert.equal((await service.list({ ...defaultQuery, page: 999 })).page, 2);
  assert.equal((await service.list({ ...defaultQuery, projectId: "unknown" })).total, 0);
});
test("optional task/approval preferences and permitted project follows remain session-only", async () => {
  const service = adapter();
  const preferences = defaultPreferences(); preferences.categories.tasks = false; preferences.categories.approvals = false;
  preferences.followedProjectIds = [seed().options.projects[0].id];
  await service.savePreferences(preferences);
  assert.deepEqual((await service.getOverview()).preferences, preferences);
  assert.equal((await adapter().getOverview()).preferences.categories.tasks, true);
  const originalCount = (await service.getOverview()).unreadCount;
  assert.equal(originalCount, 9, "preferences do not delete historical deliveries or change workflow authority");
  await assert.rejects(service.savePreferences({ ...preferences, followedProjectIds: ["unauthorized-project"] }), /permitted projects/);
  assert.deepEqual((await service.getOverview()).preferences, preferences);
});
test("failed read mutations leave both history and unread count unchanged", async () => {
  const service = adapter(); const before = await service.getOverview();
  await assert.rejects(service.setRead("missing", true), /no longer available/);
  assert.deepEqual(await service.getOverview(), before);
});
test("adapter results are copies and cannot mutate internal read states or options", async () => {
  const service = adapter(); const overview = await service.getOverview(); overview.unreadCount = 999; overview.options.projects.length = 0;
  const page = await service.list(defaultQuery); page.items[0].readAt = "changed";
  assert.equal((await service.getOverview()).unreadCount, 9);
  assert.equal((await service.getOverview()).options.projects.length, 2);
  assert.equal((await service.list(defaultQuery)).items[0].readAt, null);
});
test("destinations accept only allowlisted entities and valid IDs, never raw URLs", () => {
  const target = seed().items[0].target;
  assert.match(notificationHref(target), /^\/projects\/[^/]+\/reports\/weekly\//);
  for (const type of ["external", "javascript:", "https://example.com"]) assert.equal(notificationHref({ ...target, type }), null);
  assert.equal(notificationHref({ ...target, id: "../../administration" }), null);
  assert.equal(notificationHref({ ...target, projectId: "https://example.com" }), null);
  assert.equal(notificationHref({ ...target, type: "monthly" }), `/projects/${target.projectId}/reports/monthly/${target.id}`);
});
test("date groups use local calendar boundaries", () => {
  const now = new Date(2026, 8, 27, 12);
  const base = seed().items[0];
  const dates = [new Date(2026, 8, 27, 1), new Date(2026, 8, 26, 23), new Date(2026, 8, 24, 12)];
  assert.deepEqual(groupNotifications(dates.map((date) => ({ ...base, createdAt: date.toISOString() })), now).map((group) => group.label), ["Today", "Yesterday", "Earlier"]);
});
test("shell shares one provider and development preview cannot enable itself in production", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(read("../../app/(app)/layout.tsx"), /<NotificationProvider>/);
  assert.match(read("../../components/layout/top-bar.tsx"), /<NotificationBell \/>/);
  assert.match(read("./provider.tsx"), /process\.env\.NODE_ENV !== "development"/);
  assert.doesNotMatch(read("./model.ts"), /fetch\(|localStorage|sessionStorage|supabase|\.rpc\(/);
});

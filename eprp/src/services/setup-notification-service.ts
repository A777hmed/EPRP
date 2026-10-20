import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { formatDate, formatDateTime } from "@/lib/formatters";
import {
  createNotificationAdapter,
  defaultPreferences,
  notificationCategories,
  type NotificationItem,
  type NotificationOptions,
  type NotificationPreferences,
  type NotificationService,
} from "@/features/notifications/model";
import {
  composeAmendmentNotification,
  isAmendmentNotificationEvent,
  type AmendmentNotificationProject,
  type AmendmentNotificationRow,
} from "@/features/projects/setup-amendment-notifications";
import type { SetupAmendment, SetupValueLookups } from "@/features/projects/setup-amendments";
import { rowToAmendment } from "./setup-governance-service";

/**
 * Phase 13.9B — the notification backend for Project Setup amendments.
 *
 * It is the first real implementation of the existing `NotificationService`
 * contract that the bell and the inbox already render; nothing about that UI
 * or contract is replaced. The database is the source of truth
 * (`user_notifications`, written by triggers on the amendment table): this
 * service only reads the signed-in user's own rows (row-level security),
 * sets `read_at`, and words each row from the amendment it points at.
 *
 * Preferences stay session-only, exactly as the inbox says, and never hide a
 * request that needs a decision.
 */

function client(): SupabaseClient {
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

interface NotificationRow {
  id: string;
  event_type: string;
  project_id: string;
  source_id: string;
  actor_name: string | null;
  created_at: string;
  read_at: string | null;
}

const toRow = (row: NotificationRow): AmendmentNotificationRow | null =>
  isAmendmentNotificationEvent(row.event_type)
    ? {
        id: row.id,
        eventType: row.event_type,
        projectId: row.project_id,
        sourceId: row.source_id,
        actorName: row.actor_name,
        createdAt: row.created_at,
        readAt: row.read_at,
      }
    : null;

const FAILED = "Notifications could not be loaded. Try again.";

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(FAILED);
  return result.data as T;
}

async function projectsFor(ids: string[]): Promise<Map<string, AmendmentNotificationProject>> {
  if (ids.length === 0) return new Map();
  const rows = unwrap(
    await client().from("projects").select("id, code, name").in("id", ids)
  ) as AmendmentNotificationProject[];
  return new Map(rows.map((row) => [row.id, row]));
}

export function createSetupNotificationService(): NotificationService {
  let preferences: NotificationPreferences = defaultPreferences();
  const categories: NotificationOptions["categories"] = ["approvals"];

  return {
    mode: "connected",

    async getOverview() {
      // Safety net for the caller only: any pending request they may decide
      // but have no row for yet (e.g. an approver created after it was made).
      await client().rpc("reconcile_my_setup_amendment_notifications");
      const unread = await client().from("user_notifications").select("id", { count: "exact", head: true }).is("read_at", null);
      if (unread.error) throw new Error(FAILED);
      const mine = unwrap(await client().from("user_notifications").select("project_id")) as { project_id: string }[];
      const projects = await projectsFor([...new Set(mine.map((row) => row.project_id))]);
      return {
        unreadCount: unread.count ?? 0,
        options: {
          projects: [...projects.values()].map((project) => ({ id: project.id, name: project.name })),
          categories,
          canFollowProjects: false,
        },
        preferences: structuredClone(preferences),
      };
    },

    async list(query) {
      const pageSize = Math.max(1, Math.min(50, Math.floor(query.pageSize) || 10));
      if (query.category !== "all" && query.category !== "approvals") return { items: [], total: 0, page: 1, pageCount: 1 };
      // One page of the caller's own rows (row-level security does the scoping).
      const fetchPage = async (requested: number) => {
        let request = client().from("user_notifications").select("*", { count: "exact" });
        if (query.projectId !== "all") request = request.eq("project_id", query.projectId);
        if (query.read === "unread") request = request.is("read_at", null);
        if (query.read === "read") request = request.not("read_at", "is", null);
        const result = await request
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range((requested - 1) * pageSize, requested * pageSize - 1);
        // A page past the end is answered as the last page, never as an error.
        if (result.error && result.status !== 416) throw new Error(FAILED);
        return { rows: (result.data ?? []) as NotificationRow[], total: result.count ?? 0 };
      };
      let page = Math.max(1, Math.floor(query.page) || 1);
      let fetched = await fetchPage(page);
      const pageCount = Math.max(1, Math.ceil(fetched.total / pageSize));
      if (page > pageCount) {
        page = pageCount;
        fetched = await fetchPage(page);
      }
      const total = fetched.total;
      const rows = fetched.rows
        .map(toRow)
        .filter((row): row is AmendmentNotificationRow => row !== null);

      const sourceIds = [...new Set(rows.map((row) => row.sourceId))];
      const amendments = new Map<string, SetupAmendment>();
      if (sourceIds.length > 0) {
        const found = unwrap(
          await client().from("project_setup_amendments").select("*").in("id", sourceIds)
        ) as Parameters<typeof rowToAmendment>[0][];
        for (const row of found) amendments.set(row.id, rowToAmendment(row));
      }
      const projects = await projectsFor([...new Set(rows.map((row) => row.projectId))]);

      // Names for client / category values, only when a request needs them.
      const lookups: SetupValueLookups = { formatDate };
      const needsNames = [...amendments.values()].some((amendment) => ["client_id", "project_category"].includes(amendment.fieldKey));
      if (needsNames) {
        const [clients, types] = await Promise.all([
          client().from("clients").select("id, name"),
          client().from("project_types").select("id, name"),
        ]);
        const clientNames = new Map(((clients.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));
        const typeNames = new Map(((types.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));
        lookups.clientName = (id) => clientNames.get(id);
        lookups.categoryName = (id) => typeNames.get(id);
      }

      const items: NotificationItem[] = rows.map((row) =>
        composeAmendmentNotification({
          row,
          amendment: amendments.get(row.sourceId) ?? null,
          project: projects.get(row.projectId),
          lookups,
          formatDateTime,
        })
      );
      return { items, total, page, pageCount };
    },

    async setRead(id, read) {
      const result = await client()
        .from("user_notifications")
        .update({ read_at: read ? new Date().toISOString() : null })
        .eq("id", id)
        .select("id");
      if (result.error) throw new Error("That notification could not be updated. Try again.");
      if (!result.data || result.data.length === 0) {
        throw new Error("This notification is no longer available. Refresh and try again.");
      }
    },

    async markAllRead(cutoff) {
      const result = await client()
        .from("user_notifications")
        .update({ read_at: new Date().toISOString() })
        .is("read_at", null)
        .lte("created_at", cutoff);
      if (result.error) throw new Error("Notifications could not be marked as read. Try again.");
    },

    async clearHistory() {
      // Server-side and caller-only: hides resolved / informational rows; anything
      // that still requires action (a pending approval) is never cleared.
      const result = await client().rpc("clear_my_notification_history");
      if (result.error) throw new Error("Notification history could not be cleared. Try again.");
    },

    async savePreferences(next) {
      if (next.followedProjectIds.length > 0) throw new Error("Refresh permitted projects before changing subscriptions.");
      if (Object.keys(next.categories).some((key) => !(key in notificationCategories))) throw new Error("Unknown notification category.");
      preferences = structuredClone(next);
      return structuredClone(preferences);
    },
  };
}

/** The connected service when Supabase is configured; otherwise the empty, disconnected adapter. */
export function createDefaultNotificationService(): NotificationService {
  return isSupabaseConfigured() ? createSetupNotificationService() : createNotificationAdapter();
}

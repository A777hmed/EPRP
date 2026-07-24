import type { SupabaseClient } from "@supabase/supabase-js";

import type { MasterRecordBase } from "@/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { TableName } from "@/lib/supabase/database.types";
import {
  DuplicateRecordError,
  type CanDeleteResult,
  type MasterDataService,
} from "./types";

/**
 * Supabase-backed master-data service (Phase 5C).
 *
 * Implements the same interface as the mock service, including the sync
 * snapshot + subscribe contract the reactive managed selects depend on. It
 * keeps an in-memory cache hydrated from Supabase: sync reads serve the
 * cache (loading it lazily on first access), and every mutation writes
 * through to Supabase then refreshes the cache and notifies subscribers.
 */

/* ----------------------------- Case mapping ------------------------------- */

const DB_ONLY_FIELDS = new Set(["created_at", "updated_at", "archived_at"]);

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function rowToModel<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (DB_ONLY_FIELDS.has(key)) continue;
    out[snakeToCamel(key)] = value;
  }
  return out as T;
}

function modelToRow(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    out[camelToSnake(key)] = value;
  }
  return out;
}

/* ------------------------------- Config ----------------------------------- */

export interface ReferenceCheck {
  table: TableName;
  column: string;
  /** Singular label for the summary, e.g. "project". */
  label: string;
}

export interface SupabaseServiceConfig {
  table: TableName;
  references: ReferenceCheck[];
  /** Default ordering column (snake_case). */
  orderBy?: string;
}

/* ------------------------------- Adapter ---------------------------------- */

function client(): SupabaseClient {
  // The typed browser client constrains `.from()` to a union that is
  // awkward for a generic adapter; use the untyped surface here.
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

function pluralize(label: string, count: number): string {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

export function createSupabaseMasterDataService<T extends MasterRecordBase>(
  config: SupabaseServiceConfig
): MasterDataService<T> {
  const { table, references, orderBy = "name" } = config;

  const cache = new Map<string, T>();
  const listeners = new Set<() => void>();
  let snapshot: T[] | null = null;
  let loadState: "idle" | "loading" | "loaded" = "idle";

  const notify = () => {
    snapshot = null;
    for (const listener of listeners) listener();
  };

  const setRecords = (records: T[]) => {
    cache.clear();
    for (const record of records) cache.set(record.id, record);
    notify();
  };

  const load = async (): Promise<void> => {
    loadState = "loading";
    const { data, error } = await client()
      .from(table)
      .select("*")
      .order(orderBy, { ascending: true });
    if (error) {
      loadState = "idle";
      throw new Error(error.message);
    }
    setRecords((data ?? []).map((row) => rowToModel<T>(row)));
    loadState = "loaded";
  };

  const ensureLoaded = async () => {
    if (loadState !== "loaded") await load();
  };

  const mapUniqueError = (error: { message?: string }): DuplicateRecordError => {
    const field = (error.message ?? "").toLowerCase().includes("code")
      ? "code"
      : "name";
    return new DuplicateRecordError(
      field,
      field === "code" ? "This code already exists" : "This name already exists"
    );
  };

  return {
    async getAll() {
      await ensureLoaded();
      return [...cache.values()];
    },
    async getActive() {
      await ensureLoaded();
      return [...cache.values()].filter((r) => r.active);
    },
    async getById(id) {
      const { data, error } = await client()
        .from(table)
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      const model = rowToModel<T>(data);
      cache.set(model.id, model);
      notify();
      return model;
    },
    async create(input) {
      const { data, error } = await client()
        .from(table)
        .insert(modelToRow(input as Record<string, unknown>))
        .select("*")
        .single();
      if (error) {
        if (isUniqueViolation(error)) throw mapUniqueError(error);
        throw new Error(error.message);
      }
      const model = rowToModel<T>(data);
      cache.set(model.id, model);
      notify();
      return model;
    },
    async update(id, input) {
      const { data, error } = await client()
        .from(table)
        .update(modelToRow(input as Record<string, unknown>))
        .eq("id", id)
        .select("*")
        .single();
      if (error) {
        if (isUniqueViolation(error)) throw mapUniqueError(error);
        throw new Error(error.message);
      }
      const model = rowToModel<T>(data);
      cache.set(model.id, model);
      notify();
      return model;
    },
    async archive(id) {
      const { data, error } = await client()
        .from(table)
        .update({ active: false, archived_at: new Date().toISOString() })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      const model = rowToModel<T>(data);
      cache.set(model.id, model);
      notify();
      return model;
    },
    async restore(id) {
      const { data, error } = await client()
        .from(table)
        .update({ active: true, archived_at: null })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      const model = rowToModel<T>(data);
      cache.set(model.id, model);
      notify();
      return model;
    },
    async canDelete(id) {
      const usedBy: string[] = [];
      for (const ref of references) {
        const { count, error } = await client()
          .from(ref.table)
          .select("id", { count: "exact", head: true })
          .eq(ref.column, id);
        if (error) throw new Error(error.message);
        if (count && count > 0) usedBy.push(pluralize(ref.label, count));
      }
      return { allowed: usedBy.length === 0, usedBy } satisfies CanDeleteResult;
    },
    async delete(id) {
      const { error } = await client().from(table).delete().eq("id", id);
      if (error) {
        // 23503 = FK violation; the record is still referenced.
        throw new Error(
          error.code === "23503"
            ? "Cannot delete — this record is still referenced."
            : error.message
        );
      }
      cache.delete(id);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      // Lazily hydrate the cache the first time anyone subscribes.
      if (loadState === "idle") {
        void load().catch(() => {
          // Surfaced by the async read paths; sync cache stays empty.
        });
      }
      return () => listeners.delete(listener);
    },
    getAllSync() {
      if (loadState === "idle") {
        void load().catch(() => {});
      }
      if (!snapshot) snapshot = [...cache.values()];
      return snapshot;
    },
    getByIdSync(id) {
      return id ? cache.get(id) : undefined;
    },
  };
}

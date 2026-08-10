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
  /**
   * Runs before an update is written. Throw to block the change.
   *
   * Used for cross-table invariants a column constraint cannot express —
   * moving a System to a different Department, for example, would leave its
   * dependent records pointing at a System their own Department no longer
   * owns. Blocking with a message that names the dependants is the safe
   * behaviour: nothing is silently reassigned and nothing is destroyed.
   */
  guardUpdate?: (
    id: string,
    input: Record<string, unknown>
  ) => Promise<void>;
  /**
   * Fields that cannot be written as a plain column update because changing
   * them has to move rows in another table at the same time.
   *
   * A PostgREST update is one statement over HTTP, so writing the master row
   * and then its dependent links is two round trips with a window between
   * them — exactly the partial state the move must not produce. When any
   * listed field changes, the update is routed through a database function
   * instead, where both writes share one transaction.
   */
  atomicMove?: {
    /** Camel-case fields whose change routes the update through the RPC. */
    fields: string[];
    /** Postgres function name. */
    rpc: string;
    /**
     * Builds the RPC arguments.
     *
     * `target` is the merged record the Save is aiming at; `rest` is the
     * remaining patch — the fields that are NOT in `fields` — carrying only
     * the keys the form actually submitted, so the function can tell "absent"
     * from "set to null". Both go to the database in one call: writing the
     * scalars separately first would make a refused move leave the record
     * half-saved.
     */
    args: (
      id: string,
      target: Record<string, unknown>,
      rest: Record<string, unknown>
    ) => Record<string, unknown>;
  };
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
  const {
    table,
    references,
    orderBy = "name",
    guardUpdate,
    atomicMove,
  } = config;

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

  /**
   * Reject a duplicate name or code before writing.
   *
   * The database only constrains some of these tables, and only
   * case-sensitively: `departments` and `job_titles` are unique on name, the
   * rest are not, so "Piping" and "piping" — or two identical client names —
   * were accepted here while the mock service rejected them. Checking in the
   * service keeps both implementations behaving identically.
   *
   * This is a read-then-write check, so two simultaneous inserts could still
   * both pass. The unique-violation mapping below remains the backstop, and a
   * case-insensitive unique index is the durable fix (see the sprint report).
   */
  const assertNoDuplicate = async (
    input: Partial<T>,
    excludeId?: string
  ): Promise<void> => {
    const matches = (a: string | undefined, b: string | undefined) =>
      Boolean(a) && Boolean(b) && a!.trim().toLowerCase() === b!.trim().toLowerCase();

    if (!("name" in input) && !("code" in input)) return;
    await ensureLoaded();

    for (const record of cache.values()) {
      if (record.id === excludeId) continue;
      if ("name" in input && matches(input.name, record.name)) {
        throw new DuplicateRecordError("name", "This name already exists");
      }
      if ("code" in input && matches(input.code, record.code)) {
        throw new DuplicateRecordError("code", "This code already exists");
      }
    }
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
      await assertNoDuplicate(input as Partial<T>);
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
      await assertNoDuplicate(input as Partial<T>, id);
      await guardUpdate?.(id, input as Record<string, unknown>);

      const patch = input as Record<string, unknown>;
      // The move is decided by comparing against the current record, and its
      // arguments are merged from it, so the cache has to be populated first.
      if (atomicMove) await ensureLoaded();
      const moving =
        atomicMove !== undefined &&
        atomicMove.fields.some(
          (field) =>
            field in patch &&
            patch[field] !==
              (cache.get(id) as Record<string, unknown> | undefined)?.[field]
        );

      let row: Record<string, unknown> | null = null;

      if (moving) {
        // The ENTIRE Save goes in one call — edited scalars included. Writing
        // them here first and moving afterwards would be two transactions, so
        // a refused move could leave the record renamed but not moved. The
        // function validates everything before it writes anything.
        const target = { ...(cache.get(id) as object), ...patch };
        const rest = Object.fromEntries(
          Object.entries(patch).filter(
            ([key]) => !atomicMove!.fields.includes(key)
          )
        );
        const { data, error } = await client().rpc(
          atomicMove!.rpc,
          atomicMove!.args(id, target as Record<string, unknown>, rest)
        );
        if (error) {
          if (isUniqueViolation(error)) throw mapUniqueError(error);
          // Duplicate name/code is raised by the function as unique_violation
          // so it reaches the form field rather than a generic banner.
          if (/already exists/i.test(error.message ?? "")) {
            throw mapUniqueError(error);
          }
          // Otherwise the message already names the conflicting projects.
          throw new Error(error.message);
        }
        // `returns <table>` yields the row itself, not an array.
        row = (Array.isArray(data) ? data[0] : data) as Record<
          string,
          unknown
        > | null;
        if (!row) {
          throw new Error(
            "The move did not return the updated record. Reload the page and check the current hierarchy before retrying."
          );
        }
      } else if (Object.keys(patch).length > 0) {
        const { data, error } = await client()
          .from(table)
          .update(modelToRow(patch))
          .eq("id", id)
          .select("*")
          .single();
        if (error) {
          if (isUniqueViolation(error)) throw mapUniqueError(error);
          throw new Error(error.message);
        }
        row = data;
      }

      // Nothing was sent, so nothing changed — hand back what is cached.
      if (!row) {
        const cached = cache.get(id);
        if (!cached) throw new Error("Record " + id + " not found");
        return cached;
      }

      const model = rowToModel<T>(row);
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

/**
 * Executive-owned report content — data access.
 *
 * This service reads and writes `executive_reports` and NOTHING else. It never
 * touches a project, a Weekly row or a Monthly row, so no Executive edit or
 * delete can reach source data.
 *
 * What the record holds is deliberately small: the reviewed summary wording,
 * a preparer override, lifecycle state and a little metadata. Every figure in
 * the report is still derived on load from approved Monthly data — the record
 * is what the Executive tier OWNS, not a copy of what it reads.
 *
 * The stored summary is NEVER selected with the row. Rows are read through
 * {@link EXECUTIVE_RECORD_COLUMNS}, which omits `executive_summary`; the summary
 * is read separately through `public.executive_report_summary()`, which
 * returns it only to full-portfolio authority and NULL to everyone else
 * (migration `20260926000001_executive_summary_visibility.sql`). Callers ask
 * for it only when `canReadStoredExecutiveSummary()` allows — so a restricted
 * viewer's page never even requests it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  parseSignatorySnapshot,
  serializeSignatorySnapshot,
  type SignatorySnapshot,
} from "./executive-signatories";

export type ExecutiveReportStatus = "draft" | "under_review" | "approved" | "locked" | "archived";

export const EXECUTIVE_STATUS_LABEL: Record<ExecutiveReportStatus, string> = {
  draft: "Draft",
  under_review: "Under Review",
  approved: "Approved",
  locked: "Locked",
  archived: "Archived",
};

/** Past approval a report is archived, never hard-deleted (§10.2). */
export const DELETABLE_STATUSES: ExecutiveReportStatus[] = ["draft", "under_review", "archived"];

export function canHardDelete(status: ExecutiveReportStatus): boolean {
  return DELETABLE_STATUSES.includes(status);
}

export interface ExecutiveReportRecord {
  id: string;
  reportingMonth: string;
  status: ExecutiveReportStatus;
  executiveSummary?: string;
  preparedByContactIds: string[];
  /**
   * Signatories as they should PRINT, copied at save time.
   *
   * Deliberately not re-resolved from Contacts on read — see
   * `executive-signatories.ts`. Editing a contact cannot alter an issued report.
   */
  signatories: SignatorySnapshot;
  title?: string;
  confidentiality?: string;
  createdByName?: string;
  updatedByName?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  reporting_month: string;
  status: string;
  prepared_by_contact_ids: string[] | null;
  signatories: unknown;
  title: string | null;
  confidentiality: string | null;
  created_by_name: string | null;
  updated_by_name: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

function client(): SupabaseClient {
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

function fromRow(row: Row): ExecutiveReportRecord {
  return {
    id: row.id,
    reportingMonth: row.reporting_month,
    status: row.status as ExecutiveReportStatus,
    preparedByContactIds: row.prepared_by_contact_ids ?? [],
    signatories: parseSignatorySnapshot(row.signatories),
    title: row.title ?? undefined,
    confidentiality: row.confidentiality ?? undefined,
    createdByName: row.created_by_name ?? undefined,
    updatedByName: row.updated_by_name ?? undefined,
    archivedAt: row.archived_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

/**
 * Every column the app reads from a record row — deliberately WITHOUT
 * `executive_summary`.
 *
 * Must stay a subset of the column-level SELECT grant in
 * `20260926000001_executive_summary_visibility.sql`; a test parses that grant
 * and fails if this list asks for a column the grant does not cover (which
 * would make every read fail with "permission denied" once it is applied).
 * Works identically before the migration, so the app can ship first.
 */
export const EXECUTIVE_RECORD_COLUMNS = [
  "id",
  "reporting_month",
  "status",
  "prepared_by_contact_ids",
  "signatories",
  "title",
  "confidentiality",
  "created_by_name",
  "updated_by_name",
  "archived_at",
  "created_at",
  "updated_at",
].join(", ");

/** PostgREST / Postgres codes for "that function does not exist (yet)". */
const MISSING_FUNCTION = new Set(["PGRST202", "42883"]);

function isMissingFunction(error: { code?: string } | null): boolean {
  return Boolean(error?.code && MISSING_FUNCTION.has(error.code));
}

/** Whether a record read should also load the stored summary. */
export interface RecordReadOptions {
  /**
   * Only pass `true` for a viewer `canReadStoredExecutiveSummary()`
   * allows. The database enforces the same rule independently.
   */
  includeSummary?: boolean;
}

function isMissingTable(error: { code?: string } | null): boolean {
  return Boolean(error?.code && MISSING_TABLE.has(error.code));
}

export interface ExecutiveRecordInput {
  executiveSummary?: string | null;
  preparedByContactIds?: string[];
  signatories?: SignatorySnapshot;
  title?: string | null;
  confidentiality?: string | null;
  status?: ExecutiveReportStatus;
}

export const executiveRecordService = {
  /**
   * The stored summary for one record, or undefined.
   *
   * Reads through `public.executive_report_summary()`, which returns NULL for
   * any caller without full-portfolio authority — indistinguishable from "no
   * summary stored", so nothing reveals that one exists.
   *
   * Before the migration is applied the function does not exist; only then,
   * and only for a caller the app has already authorized, the column is read
   * directly (it is still granted at that point). Once applied, that fallback
   * is unreachable: the function exists, and the column is no longer granted.
   */
  async readSummary(id: string): Promise<string | undefined> {
    const { data, error } = await client().rpc("executive_report_summary", { p_report_id: id });
    if (!error) return typeof data === "string" && data ? data : undefined;
    if (!isMissingFunction(error)) throw new Error(error.message);

    const legacy = await client()
      .from("executive_reports")
      .select("executive_summary")
      .eq("id", id)
      .maybeSingle();
    if (legacy.error) throw new Error(legacy.error.message);
    const value = (legacy.data as { executive_summary: string | null } | null)?.executive_summary;
    return value ? value : undefined;
  },

  /** Adds the stored summary to a record when — and only when — asked to. */
  async withSummary(
    record: ExecutiveReportRecord,
    options: RecordReadOptions | undefined
  ): Promise<ExecutiveReportRecord> {
    if (!options?.includeSummary) return record;
    const executiveSummary = await this.readSummary(record.id);
    return executiveSummary ? { ...record, executiveSummary } : record;
  },

  /** Every stored Executive record, newest period first. Never carries a summary. */
  async list(): Promise<ExecutiveReportRecord[]> {
    const { data, error } = await client()
      .from("executive_reports")
      .select(EXECUTIVE_RECORD_COLUMNS)
      .order("reporting_month", { ascending: false });
    if (error) {
      if (isMissingTable(error)) return [];
      throw new Error(error.message);
    }
    return ((data ?? []) as unknown as Row[]).map(fromRow);
  },

  async getByMonth(month: string, options?: RecordReadOptions): Promise<ExecutiveReportRecord | null> {
    const { data, error } = await client()
      .from("executive_reports")
      .select(EXECUTIVE_RECORD_COLUMNS)
      .eq("reporting_month", `${month}-01`)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) return null;
      throw new Error(error.message);
    }
    return data ? this.withSummary(fromRow(data as unknown as Row), options) : null;
  },

  /**
   * Get the record for a period, creating a draft if none exists.
   *
   * A reporting period exists because Monthly Reports exist for it; the
   * Executive record is created lazily the first time somebody edits, so the
   * register never fills with empty rows nobody asked for.
   */
  async ensure(month: string, options?: RecordReadOptions): Promise<ExecutiveReportRecord> {
    const existing = await this.getByMonth(month, options);
    if (existing) return existing;

    const { data, error } = await client()
      .from("executive_reports")
      .insert({ reporting_month: `${month}-01`, status: "draft" })
      .select(EXECUTIVE_RECORD_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    // A freshly created draft has no summary yet.
    return fromRow(data as unknown as Row);
  },

  /**
   * Writing `executive_summary` needs UPDATE, not SELECT, on the column, so an
   * authorized editor can still save it; the row comes back without it and the
   * summary is re-read through the guarded function when asked for.
   */
  async update(
    id: string,
    input: ExecutiveRecordInput,
    options?: RecordReadOptions
  ): Promise<ExecutiveReportRecord> {
    const fields = {
      ...(input.executiveSummary !== undefined ? { executive_summary: input.executiveSummary } : {}),
      ...(input.preparedByContactIds !== undefined
        ? { prepared_by_contact_ids: input.preparedByContactIds }
        : {}),
      ...(input.signatories !== undefined
        ? { signatories: serializeSignatorySnapshot(input.signatories) }
        : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.confidentiality !== undefined ? { confidentiality: input.confidentiality } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    };
    const { data, error } = await client()
      .from("executive_reports")
      .update(fields)
      .eq("id", id)
      .select(EXECUTIVE_RECORD_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return this.withSummary(fromRow(data as unknown as Row), options);
  },

  /**
   * Delete one Executive record.
   *
   * Deletes a single row in `executive_reports`. That table holds no foreign
   * key onto projects, Weekly, Monthly, risks, actions or milestones, so this
   * cannot cascade anywhere. A database trigger independently refuses the
   * delete once a report is approved or locked.
   */
  async remove(id: string): Promise<void> {
    const { error } = await client().from("executive_reports").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },

  async archive(id: string): Promise<ExecutiveReportRecord> {
    return this.update(id, { status: "archived" });
  },
};

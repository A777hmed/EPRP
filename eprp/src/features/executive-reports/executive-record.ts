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
  executive_summary: string | null;
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
    executiveSummary: row.executive_summary ?? undefined,
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
  /** Every stored Executive record, newest period first. */
  async list(): Promise<ExecutiveReportRecord[]> {
    const { data, error } = await client()
      .from("executive_reports")
      .select("*")
      .order("reporting_month", { ascending: false });
    if (error) {
      if (isMissingTable(error)) return [];
      throw new Error(error.message);
    }
    return ((data ?? []) as Row[]).map(fromRow);
  },

  async getByMonth(month: string): Promise<ExecutiveReportRecord | null> {
    const { data, error } = await client()
      .from("executive_reports")
      .select("*")
      .eq("reporting_month", `${month}-01`)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) return null;
      throw new Error(error.message);
    }
    return data ? fromRow(data as Row) : null;
  },

  /**
   * Get the record for a period, creating a draft if none exists.
   *
   * A reporting period exists because Monthly Reports exist for it; the
   * Executive record is created lazily the first time somebody edits, so the
   * register never fills with empty rows nobody asked for.
   */
  async ensure(month: string): Promise<ExecutiveReportRecord> {
    const existing = await this.getByMonth(month);
    if (existing) return existing;

    const { data, error } = await client()
      .from("executive_reports")
      .insert({ reporting_month: `${month}-01`, status: "draft" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return fromRow(data as Row);
  },

  async update(id: string, input: ExecutiveRecordInput): Promise<ExecutiveReportRecord> {
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
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return fromRow(data as Row);
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

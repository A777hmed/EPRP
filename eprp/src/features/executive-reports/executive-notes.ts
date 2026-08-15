/**
 * Executive-authored notes — types and data access.
 *
 * This is the ONLY place the Executive tier writes anything. It writes to
 * `executive_notes` and to nothing else: no Weekly table, no Monthly table, no
 * source record. Monthly compilation and the Weekly→Monthly dedupe cannot see
 * this data and are unaffected by it.
 *
 * The table is created by `20260812000003_executive_notes.sql`, which is NOT
 * yet applied — see `notesAvailability()` below and the blocker recorded in
 * `docs/15_DEVELOPMENT_ROADMAP.md`. Every read path here treats a missing table
 * as a first-class state rather than an error, so the module reports itself as
 * pending instead of crashing the Executive page.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Priority } from "@/types";

export type ExecutiveNoteCategory =
  | "executive_comment"
  | "management_direction"
  | "decision"
  | "risk_concern"
  | "follow_up";

export const EXECUTIVE_NOTE_CATEGORIES: [ExecutiveNoteCategory, string][] = [
  ["executive_comment", "Executive Comment"],
  ["management_direction", "Management Direction"],
  ["decision", "Decision"],
  ["risk_concern", "Risk / Concern"],
  ["follow_up", "Follow-up"],
];

export const EXECUTIVE_NOTE_CATEGORY_LABEL = Object.fromEntries(
  EXECUTIVE_NOTE_CATEGORIES
) as Record<ExecutiveNoteCategory, string>;

export interface ExecutiveNote {
  id: string;
  /** Undefined means the note is about the portfolio as a whole. */
  projectId?: string;
  category: ExecutiveNoteCategory;
  priority: Priority;
  body: string;
  includeInSummary: boolean;
  includeInPrint: boolean;
  createdByName?: string;
  /** Who last edited the note. Distinct from the immutable author. */
  updatedByName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutiveNoteInput {
  id?: string;
  projectId?: string;
  category: ExecutiveNoteCategory;
  priority: Priority;
  body: string;
  includeInSummary: boolean;
  includeInPrint: boolean;
}

interface ExecutiveNoteRow {
  id: string;
  project_id: string | null;
  category: string;
  priority: string;
  body: string;
  include_in_summary: boolean;
  include_in_print: boolean;
  created_by_name: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
}

function client(): SupabaseClient {
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

function fromRow(row: ExecutiveNoteRow): ExecutiveNote {
  return {
    id: row.id,
    projectId: row.project_id ?? undefined,
    category: row.category as ExecutiveNoteCategory,
    priority: row.priority as Priority,
    body: row.body,
    includeInSummary: row.include_in_summary,
    includeInPrint: row.include_in_print,
    createdByName: row.created_by_name ?? undefined,
    updatedByName: row.updated_by_name ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Whether the backing table exists.
 *
 * PostgREST answers a query against an unknown relation with `42P01`
 * (undefined_table) or its own `PGRST205` (table not found in schema cache).
 * Both mean the same thing here: the migration has not been applied. Treating
 * that as a state rather than a failure is what lets the Executive page render
 * a clear "pending migration" panel instead of a toast full of SQL.
 */
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);

export function isMissingNotesTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code && MISSING_TABLE_CODES.has(error.code)) return true;
  return /executive_notes/i.test(error.message ?? "") && /(does not exist|not find|schema cache)/i.test(error.message ?? "");
}

export type NotesAvailability = "ready" | "migration_pending" | "error";

export interface ExecutiveNotesResult {
  availability: NotesAvailability;
  notes: ExecutiveNote[];
  message?: string;
}

export const executiveNoteService = {
  /**
   * Every note the reader may see: portfolio-level plus the given projects.
   *
   * Row-level security is the real filter; the project list here only avoids
   * fetching notes for projects that are not on screen.
   */
  async list(projectIds: string[]): Promise<ExecutiveNotesResult> {
    const { data, error } = await client()
      .from("executive_notes")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      if (isMissingNotesTable(error)) {
        // Administrator-facing detail. The executive document shows a plain
        // "not available yet" state; the actionable cause belongs here.
        console.info(
          "[Executive Notes] executive_notes is missing. Apply supabase/migrations/20260812000003_executive_notes.sql — see the Executive section of docs/15_DEVELOPMENT_ROADMAP.md for the safe push sequence."
        );
        return { availability: "migration_pending", notes: [] };
      }
      return { availability: "error", notes: [], message: error.message };
    }

    const visible = new Set(projectIds);
    const notes = ((data ?? []) as ExecutiveNoteRow[])
      .map(fromRow)
      .filter((note) => !note.projectId || visible.has(note.projectId));

    return { availability: "ready", notes };
  },

  async save(input: ExecutiveNoteInput): Promise<ExecutiveNote> {
    const body = input.body.trim();
    if (!body) throw new Error("An Executive Note needs some text.");

    const fields = {
      project_id: input.projectId ?? null,
      category: input.category,
      priority: input.priority,
      body,
      include_in_summary: input.includeInSummary,
      include_in_print: input.includeInPrint,
    };

    const query = input.id
      ? client().from("executive_notes").update(fields).eq("id", input.id)
      : client().from("executive_notes").insert(fields);

    const { data, error } = await query.select("*").single();
    if (error) throw new Error(error.message);
    return fromRow(data as ExecutiveNoteRow);
  },

  async remove(id: string): Promise<void> {
    const { error } = await client().from("executive_notes").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },
};

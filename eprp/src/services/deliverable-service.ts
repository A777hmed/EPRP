import type {
  ClientReviewStatus,
  DeliverableUpdate,
  DeliverableUpdateSource,
  MasterDeliverable,
} from "@/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  DeliverableUpdateRow,
  MasterDeliverableRow,
} from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeFailure, type ServiceError } from "./service-errors";

/**
 * Master Deliverables (Phase 13.3).
 *
 * The same shape as `milestone-service.ts`, for the same reason: identity and
 * state are separate authorities. `create`/`update` write the register and are
 * Project Control's; `submitUpdate` appends to the stream and is open to any
 * contributor scoped to the deliverable's department. Row-level security
 * enforces both independently of this file.
 *
 * Nothing here computes current state — that is `deliverable-state.ts`.
 */

function client(): SupabaseClient {
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function mapDeliverable(row: MasterDeliverableRow): MasterDeliverable {
  return {
    id: row.id,
    projectId: row.project_id,
    code: row.code,
    title: row.title,
    description: row.description ?? undefined,
    departmentId: row.department_id ?? undefined,
    systemId: row.system_id ?? undefined,
    disciplineId: row.discipline_id ?? undefined,
    ownerContactId: row.owner_contact_id ?? undefined,
    milestoneId: row.milestone_id ?? undefined,
    plannedSubmissionDate: row.planned_submission_date ?? undefined,
    revision: row.revision ?? undefined,
    documentId: row.document_id ?? undefined,
    active: row.active,
    archivedAt: row.archived_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapUpdate(row: DeliverableUpdateRow): DeliverableUpdate {
  return {
    id: row.id,
    deliverableId: row.deliverable_id,
    source: row.source as DeliverableUpdateSource,
    weeklyReportId: row.weekly_report_id ?? undefined,
    monthlyReportId: row.monthly_report_id ?? undefined,
    departmentId: row.department_id ?? undefined,
    disciplineId: row.discipline_id ?? undefined,
    clientReviewStatus: row.client_review_status as ClientReviewStatus,
    clientReviewDate: row.client_review_date ?? undefined,
    clientReference: row.client_reference ?? undefined,
    forecastDate: row.forecast_date ?? undefined,
    actualSubmissionDate: row.actual_submission_date ?? undefined,
    revision: row.revision ?? undefined,
    narrative: row.narrative ?? undefined,
    approvalStatus: row.approval_status as DeliverableUpdate["approvalStatus"],
    approvedByContactId: row.approved_by_contact_id ?? undefined,
    approvedAt: row.approved_at ?? undefined,
    decisionNote: row.decision_note ?? undefined,
    submittedByContactId: row.submitted_by_contact_id ?? undefined,
    submittedAt: row.submitted_at,
  };
}

/** Identity fields a user may set. Never client review status or actual dates. */
export interface DeliverableInput {
  code: string;
  title: string;
  description?: string;
  departmentId?: string;
  systemId?: string;
  disciplineId?: string;
  ownerContactId?: string;
  /** The milestone this serves — an id into the master register, never a copy. */
  milestoneId?: string;
  plannedSubmissionDate?: string;
  revision?: string;
  documentId?: string;
}

/** One reported change of position. */
export interface DeliverableUpdateInput {
  deliverableId: string;
  source: DeliverableUpdateSource;
  weeklyReportId?: string;
  monthlyReportId?: string;
  departmentId?: string;
  disciplineId?: string;
  clientReviewStatus: ClientReviewStatus;
  clientReviewDate?: string;
  clientReference?: string;
  forecastDate?: string;
  actualSubmissionDate?: string;
  revision?: string;
  narrative?: string;
  submittedByContactId?: string;
}

export const deliverableService = {
  async list(projectId: string): Promise<MasterDeliverable[]> {
    const { data, error } = await client()
      .from("master_deliverables")
      .select("*")
      .eq("project_id", projectId)
      .order("planned_submission_date", { ascending: true, nullsFirst: false })
      .order("code", { ascending: true });
    if (error) throw await readFailure("list deliverables", error);
    return ((data ?? []) as MasterDeliverableRow[]).map(mapDeliverable);
  },

  /**
   * Every update for a project's deliverables, in one read.
   *
   * Fetched as a set rather than per deliverable so a register of any size
   * costs one round trip, and so the derivation sees the whole stream at once.
   */
  async listUpdates(projectId: string): Promise<DeliverableUpdate[]> {
    const { data: deliverables, error: deliverableError } = await client()
      .from("master_deliverables")
      .select("id")
      .eq("project_id", projectId);
    if (deliverableError)
      throw await readFailure("list deliverables for updates", deliverableError);

    const ids = (
      (deliverables ?? []) as Pick<MasterDeliverableRow, "id">[]
    ).map((row) => row.id);
    if (ids.length === 0) return [];

    const { data, error } = await client()
      .from("deliverable_updates")
      .select("*")
      .in("deliverable_id", ids)
      .order("submitted_at", { ascending: false });
    if (error) throw await readFailure("list deliverable updates", error);
    return ((data ?? []) as DeliverableUpdateRow[]).map(mapUpdate);
  },

  async create(
    projectId: string,
    input: DeliverableInput
  ): Promise<MasterDeliverable> {
    const { data, error } = await client()
      .from("master_deliverables")
      .insert({
        project_id: projectId,
        code: input.code.trim(),
        title: input.title.trim(),
        description: clean(input.description),
        department_id: clean(input.departmentId),
        system_id: clean(input.systemId),
        discipline_id: clean(input.disciplineId),
        owner_contact_id: clean(input.ownerContactId),
        milestone_id: clean(input.milestoneId),
        planned_submission_date: clean(input.plannedSubmissionDate),
        revision: clean(input.revision),
        document_id: clean(input.documentId),
      })
      .select("*")
      .single();
    if (error) throw await writeFailure("create the deliverable", error);
    return mapDeliverable(data as MasterDeliverableRow);
  },

  /** Edit identity. Client position is untouched — that lives in the stream. */
  async update(
    deliverableId: string,
    input: DeliverableInput
  ): Promise<MasterDeliverable> {
    const { data, error } = await client()
      .from("master_deliverables")
      .update({
        code: input.code.trim(),
        title: input.title.trim(),
        description: clean(input.description),
        department_id: clean(input.departmentId),
        system_id: clean(input.systemId),
        discipline_id: clean(input.disciplineId),
        owner_contact_id: clean(input.ownerContactId),
        milestone_id: clean(input.milestoneId),
        planned_submission_date: clean(input.plannedSubmissionDate),
        revision: clean(input.revision),
        document_id: clean(input.documentId),
      })
      .eq("id", deliverableId)
      .select("*")
      .single();
    if (error) throw await writeFailure("edit the deliverable", error);
    return mapDeliverable(data as MasterDeliverableRow);
  },

  /**
   * Archive rather than delete.
   *
   * A deliverable carries history that Weekly and Monthly reference; removing
   * it would break the record. There is deliberately no DELETE policy on the
   * table, so this is the only way out of the register.
   */
  async setActive(
    deliverableId: string,
    active: boolean
  ): Promise<MasterDeliverable> {
    const { data, error } = await client()
      .from("master_deliverables")
      .update({ active, archived_at: active ? null : new Date().toISOString() })
      .eq("id", deliverableId)
      .select("*")
      .single();
    if (error)
      throw await writeFailure(
        active ? "restore the deliverable" : "archive the deliverable",
        error
      );
    return mapDeliverable(data as MasterDeliverableRow);
  },

  /**
   * Append a reported change of position.
   *
   * Always lands as `pending`, whatever the client review status says. That is
   * D6 in one line: reporting that the client approved something is not the
   * same as Project Control accepting the report.
   */
  async submitUpdate(
    input: DeliverableUpdateInput
  ): Promise<DeliverableUpdate> {
    const { data, error } = await client()
      .from("deliverable_updates")
      .insert({
        deliverable_id: input.deliverableId,
        source: input.source,
        weekly_report_id: clean(input.weeklyReportId),
        monthly_report_id: clean(input.monthlyReportId),
        department_id: clean(input.departmentId),
        discipline_id: clean(input.disciplineId),
        client_review_status: input.clientReviewStatus,
        client_review_date: clean(input.clientReviewDate),
        client_reference: clean(input.clientReference),
        forecast_date: clean(input.forecastDate),
        actual_submission_date: clean(input.actualSubmissionDate),
        revision: clean(input.revision),
        narrative: clean(input.narrative),
        submitted_by_contact_id: clean(input.submittedByContactId),
        approval_status: "pending",
      })
      .select("*")
      .single();
    if (error) throw await writeFailure("submit the update", error);
    return mapUpdate(data as DeliverableUpdateRow);
  },

  /**
   * Decide a pending update.
   *
   * The decision is final: correcting it means submitting a new update, never
   * rewriting this one. A database trigger refuses anything else.
   */
  async decide(
    updateId: string,
    decision: "approved" | "rejected",
    options: { decisionNote?: string } = {}
  ): Promise<DeliverableUpdate> {
    const { data, error } = await client()
      .from("deliverable_updates")
      .update({
        approval_status: decision,
        decision_note: clean(options.decisionNote),
      })
      .eq("id", updateId)
      .select("*")
      .single();
    if (error) throw await writeFailure("decide the update", error);
    return mapUpdate(data as DeliverableUpdateRow);
  },
};

/**
 * Turn the database's own words into the user's.
 *
 * The constraints are the authority — this only translates them, so a rule can
 * never be enforced in one place and worded differently in another. The
 * mechanism lives in `service-errors.ts`; what stays here is this register's
 * own constraint dictionary and its wording.
 */

const DENIED =
  "You do not have permission to change this project's deliverable register. Project Control manages deliverables for this project.";

async function writeFailure(
  operation: string,
  error: ServiceError
): Promise<Error> {
  return describeFailure({
    scope: "deliverable-service",
    operation,
    error,
    known: friendly(error.message),
    deniedMessage: DENIED,
    fallback:
      "That change could not be saved. Please try again, and let Project Control know if it keeps happening.",
  });
}

async function readFailure(
  operation: string,
  error: ServiceError
): Promise<Error> {
  return describeFailure({
    scope: "deliverable-service",
    operation,
    error,
    deniedMessage: DENIED,
    fallback: "The deliverable register could not be loaded. Please try again.",
  });
}

/**
 * Known constraint violations, worded for the person who hit them.
 *
 * Returns `undefined` when the message is not one we recognise, so the caller
 * substitutes a safe generic rather than echoing raw database text.
 */
function friendly(message: string): string | undefined {
  if (message.includes("master_deliverables_project_code_unique")) {
    return "Another deliverable on this project already uses that code.";
  }
  if (message.includes("deliverable_updates_review_date_needs_submission")) {
    return "A review date or client reference only makes sense once the deliverable has been submitted.";
  }
  if (message.includes("deliverable_updates_client_review_valid")) {
    return "That is not a valid client review status.";
  }
  // Deliberately NOT `return message`. An unrecognised database message is a
  // diagnostic, and the caller turns it into something safe to show.
  return undefined;
}

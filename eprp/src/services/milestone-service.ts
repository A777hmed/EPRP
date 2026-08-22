import type {
  MasterMilestone,
  MilestonePriority,
  MilestoneSource,
  MilestoneStatus,
  MilestoneUpdate,
  MilestoneUpdateSource,
} from "@/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  MasterMilestoneRow,
  MilestoneUpdateRow,
} from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Master Milestones (Phase 13.2).
 *
 * Identity and state are separate operations because they are separate
 * authorities: `create`/`update` write the register and are Project Control's,
 * while `submitUpdate` appends to the state stream and is open to any
 * contributor scoped to the milestone's department. Row-level security enforces
 * both independently of this file.
 *
 * Nothing here computes current state — that is `milestone-state.ts`, so every
 * tier reads the same derivation.
 */

function client(): SupabaseClient {
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function mapMilestone(row: MasterMilestoneRow): MasterMilestone {
  return {
    id: row.id,
    projectId: row.project_id,
    code: row.code,
    name: row.name,
    description: row.description ?? undefined,
    departmentId: row.department_id ?? undefined,
    systemId: row.system_id ?? undefined,
    disciplineId: row.discipline_id ?? undefined,
    baselineDate: row.baseline_date ?? undefined,
    priority: row.priority as MilestonePriority,
    ownerContactId: row.owner_contact_id ?? undefined,
    source: row.source as MilestoneSource,
    sourceDocumentId: row.source_document_id ?? undefined,
    active: row.active,
    archivedAt: row.archived_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapUpdate(row: MilestoneUpdateRow): MilestoneUpdate {
  return {
    id: row.id,
    milestoneId: row.milestone_id,
    source: row.source as MilestoneUpdateSource,
    weeklyReportId: row.weekly_report_id ?? undefined,
    monthlyReportId: row.monthly_report_id ?? undefined,
    departmentId: row.department_id ?? undefined,
    disciplineId: row.discipline_id ?? undefined,
    status: row.status as MilestoneStatus,
    progressPercent: row.progress_percent ?? undefined,
    forecastDate: row.forecast_date ?? undefined,
    actualDate: row.actual_date ?? undefined,
    narrative: row.narrative ?? undefined,
    approvalStatus: row.approval_status as MilestoneUpdate["approvalStatus"],
    approvedByContactId: row.approved_by_contact_id ?? undefined,
    approvedAt: row.approved_at ?? undefined,
    decisionNote: row.decision_note ?? undefined,
    isRegression: row.is_regression,
    regressionReason: row.regression_reason ?? undefined,
    submittedByContactId: row.submitted_by_contact_id ?? undefined,
    submittedAt: row.submitted_at,
  };
}

/** Identity fields a user may set. Never status, progress or forecast. */
export interface MilestoneInput {
  code: string;
  name: string;
  description?: string;
  departmentId?: string;
  systemId?: string;
  disciplineId?: string;
  baselineDate?: string;
  priority: MilestonePriority;
  ownerContactId?: string;
  source?: MilestoneSource;
  sourceDocumentId?: string;
}

/** One reported change of state. */
export interface MilestoneUpdateInput {
  milestoneId: string;
  source: MilestoneUpdateSource;
  weeklyReportId?: string;
  monthlyReportId?: string;
  departmentId?: string;
  disciplineId?: string;
  status: MilestoneStatus;
  progressPercent?: number;
  forecastDate?: string;
  actualDate?: string;
  narrative?: string;
  /** Set by the caller from `isRegression()` before submitting. */
  isRegression?: boolean;
  submittedByContactId?: string;
}

export const milestoneService = {
  async list(projectId: string): Promise<MasterMilestone[]> {
    const { data, error } = await client()
      .from("master_milestones")
      .select("*")
      .eq("project_id", projectId)
      .order("baseline_date", { ascending: true, nullsFirst: false })
      .order("code", { ascending: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as MasterMilestoneRow[]).map(mapMilestone);
  },

  /**
   * Every update for a project's milestones, in one read.
   *
   * Fetched as a set rather than per milestone so a register of any size costs
   * one round trip, and so the derivation sees the whole stream at once.
   */
  async listUpdates(projectId: string): Promise<MilestoneUpdate[]> {
    const { data: milestones, error: milestoneError } = await client()
      .from("master_milestones")
      .select("id")
      .eq("project_id", projectId);
    if (milestoneError) throw new Error(milestoneError.message);

    const ids = ((milestones ?? []) as Pick<MasterMilestoneRow, "id">[]).map(
      (row) => row.id
    );
    if (ids.length === 0) return [];

    const { data, error } = await client()
      .from("milestone_updates")
      .select("*")
      .in("milestone_id", ids)
      .order("submitted_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as MilestoneUpdateRow[]).map(mapUpdate);
  },

  async create(
    projectId: string,
    input: MilestoneInput
  ): Promise<MasterMilestone> {
    const { data, error } = await client()
      .from("master_milestones")
      .insert({
        project_id: projectId,
        code: input.code.trim(),
        name: input.name.trim(),
        description: clean(input.description),
        department_id: clean(input.departmentId),
        system_id: clean(input.systemId),
        discipline_id: clean(input.disciplineId),
        baseline_date: clean(input.baselineDate),
        priority: input.priority,
        owner_contact_id: clean(input.ownerContactId),
        source: input.source ?? "manual",
        source_document_id: clean(input.sourceDocumentId),
      })
      .select("*")
      .single();
    if (error) throw new Error(friendly(error.message));
    return mapMilestone(data as MasterMilestoneRow);
  },

  /** Edit identity. Current state is untouched — that lives in the stream. */
  async update(
    milestoneId: string,
    input: MilestoneInput
  ): Promise<MasterMilestone> {
    const { data, error } = await client()
      .from("master_milestones")
      .update({
        code: input.code.trim(),
        name: input.name.trim(),
        description: clean(input.description),
        department_id: clean(input.departmentId),
        system_id: clean(input.systemId),
        discipline_id: clean(input.disciplineId),
        baseline_date: clean(input.baselineDate),
        priority: input.priority,
        owner_contact_id: clean(input.ownerContactId),
        source_document_id: clean(input.sourceDocumentId),
      })
      .eq("id", milestoneId)
      .select("*")
      .single();
    if (error) throw new Error(friendly(error.message));
    return mapMilestone(data as MasterMilestoneRow);
  },

  /**
   * Archive rather than delete.
   *
   * A milestone carries history that Weekly and Monthly reference; removing it
   * would break the record. There is deliberately no DELETE policy on the
   * table, so this is the only way out of the register.
   */
  async setActive(
    milestoneId: string,
    active: boolean
  ): Promise<MasterMilestone> {
    const { data, error } = await client()
      .from("master_milestones")
      .update({ active, archived_at: active ? null : new Date().toISOString() })
      .eq("id", milestoneId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return mapMilestone(data as MasterMilestoneRow);
  },

  /**
   * Append a reported change of state.
   *
   * Always lands as `pending`. Nothing here can make an update official — that
   * is the approval step, and it is a different authority.
   */
  async submitUpdate(input: MilestoneUpdateInput): Promise<MilestoneUpdate> {
    const { data, error } = await client()
      .from("milestone_updates")
      .insert({
        milestone_id: input.milestoneId,
        source: input.source,
        weekly_report_id: clean(input.weeklyReportId),
        monthly_report_id: clean(input.monthlyReportId),
        department_id: clean(input.departmentId),
        discipline_id: clean(input.disciplineId),
        status: input.status,
        progress_percent: input.progressPercent ?? null,
        forecast_date: clean(input.forecastDate),
        actual_date: clean(input.actualDate),
        narrative: clean(input.narrative),
        is_regression: input.isRegression ?? false,
        submitted_by_contact_id: clean(input.submittedByContactId),
        approval_status: "pending",
      })
      .select("*")
      .single();
    if (error) throw new Error(friendly(error.message));
    return mapUpdate(data as MilestoneUpdateRow);
  },

  /**
   * Decide a pending update.
   *
   * Approving a flagged regression requires a reason — the database refuses it
   * otherwise, so the rule cannot be bypassed by a future caller. The decision
   * is final: correcting it means submitting a new update, never rewriting this
   * one.
   */
  async decide(
    updateId: string,
    decision: "approved" | "rejected",
    options: { decisionNote?: string; regressionReason?: string } = {}
  ): Promise<MilestoneUpdate> {
    const { data, error } = await client()
      .from("milestone_updates")
      .update({
        approval_status: decision,
        decision_note: clean(options.decisionNote),
        regression_reason: clean(options.regressionReason),
      })
      .eq("id", updateId)
      .select("*")
      .single();
    if (error) throw new Error(friendly(error.message));
    return mapUpdate(data as MilestoneUpdateRow);
  },
};

/**
 * Turn the database's own words into the user's.
 *
 * The constraints are the authority — this only translates them, so a rule can
 * never be enforced in one place and worded differently in another.
 */
function friendly(message: string): string {
  if (message.includes("master_milestones_project_code_unique")) {
    return "Another milestone on this project already uses that code.";
  }
  if (message.includes("milestone_updates_regression_reason")) {
    return "This update reports less progress than the approved figure. Give a reason before approving it.";
  }
  if (message.includes("milestone_updates_status_valid")) {
    return "That is not a valid milestone status.";
  }
  if (message.includes("milestone_updates_progress_range")) {
    return "Progress must be between 0 and 100.";
  }
  return message;
}

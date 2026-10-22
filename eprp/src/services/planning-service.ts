import type {
  PlanningActivity,
  PlanningBaseline,
  PlanningConfigurationChange,
  UserRole,
  PlanningConfigurationField,
  PlanningConfirmation,
  PlanningConfirmationAction,
  PlanningEarningMethod,
  PlanningImportBatch,
  PlanningImportBatchStatus,
  PlanningImportRow,
  PlanningImportRowParseStatus,
  PlanningImportSourceFormat,
  PlanningItemSource,
  PlanningMilestoneLink,
  PlanningOnboardingMode,
  PlanningOpeningPosition,
  PlanningOpeningPositionStatus,
  PlanningSnapshot,
  PlanningSnapshotActivity,
  PlanningWorkItem,
  PlanningWeightDecisionMode,
  PlanningWeightSource,
  PlanningWorkItemType,
  ProjectPlanningSettings,
} from "@/types";
import { workingPlanRefusalMessage } from "@/features/projects/working-plan";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  PlanningActivityRow,
  PlanningBaselineRow,
  PlanningConfigurationChangeRow,
  PlanningConfirmationRow,
  PlanningImportBatchRow,
  PlanningImportRowRow,
  PlanningMilestoneLinkRow,
  PlanningOpeningPositionRow,
  PlanningSnapshotActivityRow,
  PlanningSnapshotRow,
  PlanningWorkItemRow,
  ProjectPlanningSettingsRow,
} from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeFailure, type ServiceError } from "./service-errors";

/**
 * Planning & Control.
 *
 * Slice 1 laid the foundation (settings, Opening Positions, snapshots).
 * Slice 2 adds the usable workflow: the Master Plan register
 * (planning_work_items), schedule activities (planning_activities), the
 * import pipeline (planning_import_batches/rows), the confirm/adjust review
 * (planning_confirmations), baselines, and Master Milestone linking.
 *
 * Raw import rows are never updated by this file — only ever inserted and
 * read. Every value a user confirms or adjusts is written to
 * planning_work_items/planning_activities directly, with the decision logged
 * to planning_confirmations; the original planning_import_rows.raw_data is
 * untouched, exactly as the schema requires.
 */

function client(): SupabaseClient {
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

/** Blank means "not stated", never zero — same convention as milestone-service. */
function num(value: number | string | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return Number.isFinite(value) ? value : null;
}

function clean(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/* -------------------------------- mappers -------------------------------- */

function mapSettings(row: ProjectPlanningSettingsRow): ProjectPlanningSettings {
  return {
    projectId: row.project_id,
    onboardingMode: row.onboarding_mode as PlanningOnboardingMode,
    defaultImportSource:
      (row.default_import_source as ProjectPlanningSettings["defaultImportSource"]) ??
      undefined,
    planningEnabled: row.planning_enabled,
    levelLabels: row.level_labels ?? [],
    controlAccountLevel: row.control_account_level ?? undefined,
    weightSource: (row.weight_source as PlanningWeightSource | null) ?? undefined,
    defaultEarningMethod: (row.default_earning_method as PlanningEarningMethod | null) ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSnapshot(row: PlanningSnapshotRow): PlanningSnapshot {
  return {
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    sourceImportBatchId: row.source_import_batch_id ?? undefined,
    sourceOpeningPositionId: row.source_opening_position_id ?? undefined,
    baselineId: row.baseline_id ?? undefined,
    isOpeningSnapshot: row.is_opening_snapshot,
    label: row.label ?? undefined,
    dataDate: row.data_date ?? undefined,
    snapshotData: row.snapshot_data,
    publishedByContactId: row.published_by_contact_id ?? undefined,
    publishedAt: row.published_at,
  };
}

function mapOpeningPosition(row: PlanningOpeningPositionRow): PlanningOpeningPosition {
  return {
    id: row.id,
    projectId: row.project_id,
    dataDate: row.data_date,
    plannedProgressPercent: row.planned_progress_percent ?? undefined,
    actualProgressPercent: row.actual_progress_percent ?? undefined,
    forecastFinishDate: row.forecast_finish_date ?? undefined,
    source: row.source,
    status: row.status as PlanningOpeningPositionStatus,
    promotedAt: row.promoted_at ?? undefined,
    promotedToSnapshotId: row.promoted_to_snapshot_id ?? undefined,
    createdByContactId: row.created_by_contact_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSnapshotActivity(row: PlanningSnapshotActivityRow): PlanningSnapshotActivity {
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    sourceActivityId: row.source_activity_id ?? undefined,
    sourceWorkItemId: row.source_work_item_id ?? undefined,
    externalId: row.external_id ?? undefined,
    code: row.code ?? undefined,
    name: row.name,
    isMilestone: row.is_milestone,
    plannedStartDate: row.planned_start_date ?? undefined,
    plannedFinishDate: row.planned_finish_date ?? undefined,
    baselineStartDate: row.baseline_start_date ?? undefined,
    baselineFinishDate: row.baseline_finish_date ?? undefined,
    actualStartDate: row.actual_start_date ?? undefined,
    actualFinishDate: row.actual_finish_date ?? undefined,
    remainingDurationDays: row.remaining_duration_days ?? undefined,
    percentCompletePlanned: row.percent_complete_planned ?? undefined,
    percentCompleteActual: row.percent_complete_actual ?? undefined,
    percentCompletePhysical: row.percent_complete_physical ?? undefined,
    weightPercent: row.weight_percent ?? undefined,
    status: row.status ?? undefined,
    plannedValue: row.planned_value ?? undefined,
    earnedValue: row.earned_value ?? undefined,
    createdAt: row.created_at,
  };
}

function mapWorkItem(row: PlanningWorkItemRow): PlanningWorkItem {
  return {
    id: row.id,
    projectId: row.project_id,
    parentWorkItemId: row.parent_work_item_id ?? undefined,
    originImportRowId: row.origin_import_row_id ?? undefined,
    departmentId: row.department_id ?? undefined,
    systemId: row.system_id ?? undefined,
    disciplineId: row.discipline_id ?? undefined,
    masterDeliverableId: row.master_deliverable_id ?? undefined,
    code: row.code,
    name: row.name,
    itemType: row.item_type as PlanningWorkItemType,
    level: row.level,
    sortOrder: row.sort_order,
    isMilestone: row.is_milestone,
    weightPercent: row.weight_percent ?? undefined,
    localWeightPercent: row.local_weight_percent ?? undefined,
    isControlAccount: row.is_control_account ?? false,
    earningMethod: (row.earning_method as PlanningEarningMethod | null) ?? undefined,
    structureNodeId: row.structure_node_id ?? undefined,
    plannedStartDate: row.planned_start_date ?? undefined,
    plannedFinishDate: row.planned_finish_date ?? undefined,
    baselineStartDate: row.baseline_start_date ?? undefined,
    baselineFinishDate: row.baseline_finish_date ?? undefined,
    plannedDurationDays: row.planned_duration_days ?? undefined,
    source: row.source as PlanningItemSource,
    active: row.active,
    archivedAt: row.archived_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapActivity(row: PlanningActivityRow): PlanningActivity {
  return {
    id: row.id,
    projectId: row.project_id,
    workItemId: row.work_item_id ?? undefined,
    originImportRowId: row.origin_import_row_id ?? undefined,
    externalId: row.external_id ?? undefined,
    code: row.code ?? undefined,
    name: row.name,
    isMilestone: row.is_milestone,
    localWeightPercent: row.local_weight_percent ?? undefined,
    earningMethod: (row.earning_method as PlanningEarningMethod | null) ?? undefined,
    departmentId: row.department_id ?? undefined,
    systemId: row.system_id ?? undefined,
    disciplineId: row.discipline_id ?? undefined,
    structureNodeId: row.structure_node_id ?? undefined,
    plannedStartDate: row.planned_start_date ?? undefined,
    plannedFinishDate: row.planned_finish_date ?? undefined,
    baselineStartDate: row.baseline_start_date ?? undefined,
    baselineFinishDate: row.baseline_finish_date ?? undefined,
    actualStartDate: row.actual_start_date ?? undefined,
    actualFinishDate: row.actual_finish_date ?? undefined,
    plannedDurationDays: row.planned_duration_days ?? undefined,
    remainingDurationDays: row.remaining_duration_days ?? undefined,
    percentCompletePlanned: row.percent_complete_planned ?? undefined,
    percentCompleteActual: row.percent_complete_actual ?? undefined,
    percentCompletePhysical: row.percent_complete_physical ?? undefined,
    weightPercent: row.weight_percent ?? undefined,
    status: row.status ?? undefined,
    plannedValue: row.planned_value ?? undefined,
    earnedValue: row.earned_value ?? undefined,
    source: row.source as PlanningItemSource,
    active: row.active,
    archivedAt: row.archived_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapImportBatch(row: PlanningImportBatchRow): PlanningImportBatch {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceType: row.source_type as PlanningImportSourceFormat,
    fileName: row.file_name ?? undefined,
    sourceDocumentId: row.source_document_id ?? undefined,
    dataDate: row.data_date ?? undefined,
    status: row.status as PlanningImportBatchStatus,
    rowCount: row.row_count,
    uploadedByContactId: row.uploaded_by_contact_id ?? undefined,
    uploadedAt: row.uploaded_at,
    validatedAt: row.validated_at ?? undefined,
    validatedByContactId: row.validated_by_contact_id ?? undefined,
    rejectionReason: row.rejection_reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapImportRow(row: PlanningImportRowRow): PlanningImportRow {
  return {
    id: row.id,
    batchId: row.batch_id,
    externalId: row.external_id ?? undefined,
    wbsPath: row.wbs_path ?? undefined,
    name: row.name ?? undefined,
    rawData: row.raw_data ?? {},
    parseStatus: row.parse_status as PlanningImportRowParseStatus,
    parseNotes: row.parse_notes ?? undefined,
    createdAt: row.created_at,
  };
}

function mapConfirmation(row: PlanningConfirmationRow): PlanningConfirmation {
  return {
    id: row.id,
    workItemId: row.work_item_id ?? undefined,
    activityId: row.activity_id ?? undefined,
    importRowId: row.import_row_id ?? undefined,
    action: row.action as PlanningConfirmationAction,
    fieldName: row.field_name,
    previousValue: row.previous_value ?? undefined,
    newValue: row.new_value ?? undefined,
    reason: row.reason ?? undefined,
    decisionId: row.decision_id ?? undefined,
    decisionMode: (row.decision_mode as PlanningWeightDecisionMode | null) ?? undefined,
    confirmedByContactId: row.confirmed_by_contact_id ?? undefined,
    confirmedAt: row.confirmed_at,
  };
}

function mapConfigurationChange(row: PlanningConfigurationChangeRow): PlanningConfigurationChange {
  return {
    id: row.id,
    projectId: row.project_id,
    fieldKey: row.field_key as PlanningConfigurationField,
    previousValue: row.previous_value,
    newValue: row.new_value,
    reason: row.reason ?? undefined,
    changedByContactId: row.changed_by_contact_id ?? undefined,
    changedAt: row.changed_at,
  };
}

function mapBaseline(row: PlanningBaselineRow): PlanningBaseline {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    baselineDate: row.baseline_date,
    capturedItems: row.captured_items,
    notes: row.notes ?? undefined,
    createdByContactId: row.created_by_contact_id ?? undefined,
    createdAt: row.created_at,
  };
}

function mapMilestoneLink(row: PlanningMilestoneLinkRow): PlanningMilestoneLink {
  return {
    id: row.id,
    masterMilestoneId: row.master_milestone_id,
    workItemId: row.work_item_id ?? undefined,
    activityId: row.activity_id ?? undefined,
    createdByContactId: row.created_by_contact_id ?? undefined,
    createdAt: row.created_at,
  };
}

/* --------------------------------- inputs -------------------------------- */

export interface PlanningWorkItemInput {
  parentWorkItemId?: string;
  departmentId?: string;
  systemId?: string;
  disciplineId?: string;
  masterDeliverableId?: string;
  code: string;
  name: string;
  itemType: PlanningWorkItemType;
  sortOrder?: number;
  /** 13.11: local weight — percent of the parent. The recorded weight is never written here. */
  localWeightPercent?: number;
  isControlAccount?: boolean;
  /** "" clears it (inherit). */
  earningMethod?: PlanningEarningMethod | "";
  /** Other-project reporting unit; "" clears it. */
  structureNodeId?: string;
  plannedStartDate?: string;
  plannedFinishDate?: string;
  baselineStartDate?: string;
  baselineFinishDate?: string;
  plannedDurationDays?: number;
}

export interface PlanningActivityInput {
  workItemId?: string;
  externalId?: string;
  code?: string;
  name: string;
  isMilestone?: boolean;
  /** 13.11 Working Plan fields. "" clears a reference (inherit). */
  localWeightPercent?: number;
  earningMethod?: PlanningEarningMethod | "";
  departmentId?: string;
  systemId?: string;
  disciplineId?: string;
  structureNodeId?: string;
  plannedStartDate?: string;
  plannedFinishDate?: string;
  baselineStartDate?: string;
  baselineFinishDate?: string;
  actualStartDate?: string;
  actualFinishDate?: string;
  plannedDurationDays?: number;
  remainingDurationDays?: number;
  percentCompletePlanned?: number;
  percentCompleteActual?: number;
  percentCompletePhysical?: number;
  weightPercent?: number;
  status?: string;
  plannedValue?: number;
  earnedValue?: number;
}

export const planningService = {
  /* ------------------------------ settings ------------------------------- */

  /** A project's Planning configuration, or `null` if it has none yet. */
  async getSettings(projectId: string): Promise<ProjectPlanningSettings | null> {
    const { data, error } = await client()
      .from("project_planning_settings")
      .select("*")
      .eq("project_id", projectId)
      .maybeSingle();
    if (error) throw await readFailure("read the planning configuration", error);
    return data ? mapSettings(data as ProjectPlanningSettingsRow) : null;
  },

  /**
   * Creates or updates a project's Planning configuration. Project Setup's
   * only write into this table — everything else here is read-only.
   *
   * `default_import_source` is written ONLY when the caller states it
   * (`null` clears it explicitly). Omitted, the column is left out of the
   * upsert payload, so an existing stored value survives: PostgREST's
   * merge-duplicates upsert updates only the columns it is sent. Project
   * Setup never sends it — it saves the onboarding mode alone — and the
   * 13.9A external-schedule guidance question is never persisted. (Before
   * 13.9A hardening every Setup save sent `null` here and wiped the value.)
   */
  async upsertSettings(input: {
    projectId: string;
    onboardingMode: PlanningOnboardingMode;
    defaultImportSource?: ProjectPlanningSettings["defaultImportSource"] | null;
  }): Promise<ProjectPlanningSettings> {
    const row: Record<string, string | null> = {
      project_id: input.projectId,
      onboarding_mode: input.onboardingMode,
    };
    if (input.defaultImportSource !== undefined) {
      row.default_import_source = input.defaultImportSource;
    }
    const { data, error } = await client()
      .from("project_planning_settings")
      .upsert(row, { onConflict: "project_id" })
      .select("*")
      .single();
    if (error) throw await writeFailure("save the Planning Onboarding Mode", error);
    return mapSettings(data as ProjectPlanningSettingsRow);
  },

  /**
   * 13.11 / `docs/02` §26.20: saves the Planning Configuration — the same
   * four fields whether the user answered the Guided questions or edited
   * Advanced mode. Never writes the onboarding mode. `expectedUpdatedAt` is
   * the version the page loaded; a newer row is refused (reload).
   */
  async saveConfiguration(input: {
    projectId: string;
    levelLabels: string[];
    controlAccountLevel?: number;
    weightSource?: PlanningWeightSource;
    defaultEarningMethod?: PlanningEarningMethod;
    expectedUpdatedAt: string;
    reason?: string;
  }): Promise<ProjectPlanningSettings> {
    const { data, error } = await client().rpc("save_planning_configuration", {
      p_project: input.projectId,
      p_level_labels: input.levelLabels,
      p_control_account_level: input.controlAccountLevel ?? null,
      p_weight_source: input.weightSource ?? null,
      p_default_earning_method: input.defaultEarningMethod ?? null,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_reason: clean(input.reason),
    });
    if (error) throw await writeFailure("save the planning configuration", error);
    return mapSettings(data as ProjectPlanningSettingsRow);
  },

  /** The append-only Planning Configuration history, newest first. */
  async listConfigurationChanges(projectId: string): Promise<PlanningConfigurationChange[]> {
    const { data, error } = await client()
      .from("planning_configuration_changes")
      .select("*")
      .eq("project_id", projectId)
      .order("changed_at", { ascending: false });
    if (error) throw await readFailure("read the planning configuration history", error);
    const rows = (data ?? []) as PlanningConfigurationChangeRow[];
    /*
     * 13.11 UAT: who made each change, from the audit row's own ids. A profile
     * is readable only where RLS allows it (the reader's own row; every row for
     * a System Administrator); the contact gives the name otherwise. A name
     * that cannot be read is left out, never guessed. Best effort: the history
     * still shows when either lookup fails.
     */
    const userIds = [...new Set(rows.flatMap((row) => (row.changed_by_user_id ? [row.changed_by_user_id] : [])))];
    const contactIds = [...new Set(rows.flatMap((row) => (row.changed_by_contact_id ? [row.changed_by_contact_id] : [])))];
    const [profiles, contacts] = await Promise.all([
      userIds.length > 0
        ? client().from("profiles").select("id, full_name, role").in("id", userIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string; role: string }[] }),
      contactIds.length > 0
        ? client().from("contacts").select("id, name").in("id", contactIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);
    const profileById = new Map(
      ((profiles.data ?? []) as { id: string; full_name: string; role: string }[]).map((profile) => [profile.id, profile])
    );
    const contactName = new Map(
      ((contacts.data ?? []) as { id: string; name: string }[]).map((contact) => [contact.id, contact.name])
    );
    return rows.map((row) => {
      const change = mapConfigurationChange(row);
      const profile = row.changed_by_user_id ? profileById.get(row.changed_by_user_id) : undefined;
      const name = (row.changed_by_contact_id && contactName.get(row.changed_by_contact_id)) || profile?.full_name;
      return {
        ...change,
        changedByName: name?.trim() || undefined,
        changedByRole: profile ? (profile.role as UserRole) : undefined,
      };
    });
  },

  /* ---------------------------- Master Plan ------------------------------- */

  /** Every active work item for a project — the Master Plan register. */
  async listWorkItems(projectId: string): Promise<PlanningWorkItem[]> {
    const { data, error } = await client()
      .from("planning_work_items")
      .select("*")
      .eq("project_id", projectId)
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .order("code", { ascending: true });
    if (error) throw await readFailure("read the Master Plan", error);
    return ((data ?? []) as PlanningWorkItemRow[]).map(mapWorkItem);
  },

  async createWorkItem(
    projectId: string,
    input: PlanningWorkItemInput
  ): Promise<PlanningWorkItem> {
    const { data, error } = await client()
      .from("planning_work_items")
      .insert({
        project_id: projectId,
        // `|| null`, not `?? null`: these arrive from a form field that
        // starts as "" (no selection made), and Postgres rejects an empty
        // string as a uuid — it must become null, not stay "".
        parent_work_item_id: input.parentWorkItemId || null,
        department_id: input.departmentId || null,
        system_id: input.systemId || null,
        discipline_id: input.disciplineId || null,
        master_deliverable_id: input.masterDeliverableId || null,
        code: input.code.trim(),
        name: input.name.trim(),
        item_type: input.itemType,
        sort_order: input.sortOrder ?? 0,
        local_weight_percent: num(input.localWeightPercent),
        is_control_account: input.isControlAccount ?? false,
        earning_method: input.earningMethod || null,
        structure_node_id: input.structureNodeId || null,
        planned_start_date: clean(input.plannedStartDate),
        planned_finish_date: clean(input.plannedFinishDate),
        baseline_start_date: clean(input.baselineStartDate),
        baseline_finish_date: clean(input.baselineFinishDate),
        planned_duration_days: num(input.plannedDurationDays),
      })
      .select("*")
      .single();
    if (error) throw await writeFailure("create the work item", error);
    return mapWorkItem(data as PlanningWorkItemRow);
  },

  async updateWorkItem(
    id: string,
    input: Partial<PlanningWorkItemInput>
  ): Promise<PlanningWorkItem> {
    const patch: Record<string, unknown> = {};
    if (input.parentWorkItemId !== undefined) patch.parent_work_item_id = input.parentWorkItemId || null;
    if (input.departmentId !== undefined) patch.department_id = input.departmentId || null;
    if (input.systemId !== undefined) patch.system_id = input.systemId || null;
    if (input.disciplineId !== undefined) patch.discipline_id = input.disciplineId || null;
    if (input.masterDeliverableId !== undefined) patch.master_deliverable_id = input.masterDeliverableId || null;
    if (input.code !== undefined) patch.code = input.code.trim();
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.itemType !== undefined) patch.item_type = input.itemType;
    if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
    if ("localWeightPercent" in input) patch.local_weight_percent = num(input.localWeightPercent);
    if (input.isControlAccount !== undefined) patch.is_control_account = input.isControlAccount;
    if (input.earningMethod !== undefined) patch.earning_method = input.earningMethod || null;
    if (input.structureNodeId !== undefined) patch.structure_node_id = input.structureNodeId || null;
    if (input.plannedStartDate !== undefined) patch.planned_start_date = clean(input.plannedStartDate);
    if (input.plannedFinishDate !== undefined) patch.planned_finish_date = clean(input.plannedFinishDate);
    if (input.baselineStartDate !== undefined) patch.baseline_start_date = clean(input.baselineStartDate);
    if (input.baselineFinishDate !== undefined) patch.baseline_finish_date = clean(input.baselineFinishDate);
    if (input.plannedDurationDays !== undefined) patch.planned_duration_days = num(input.plannedDurationDays);

    const { data, error } = await client()
      .from("planning_work_items")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw await writeFailure("update the work item", error);
    return mapWorkItem(data as PlanningWorkItemRow);
  },

  /** Archived, never deleted — no DELETE policy exists for this table. */
  async archiveWorkItem(id: string): Promise<void> {
    const { error } = await client()
      .from("planning_work_items")
      .update({ active: false, archived_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw await writeFailure("archive the work item", error);
  },

  async restoreWorkItem(id: string): Promise<void> {
    const { error } = await client()
      .from("planning_work_items")
      .update({ active: true, archived_at: null })
      .eq("id", id);
    if (error) throw await writeFailure("restore the work item", error);
  },

  /* ----------------------------- Activities -------------------------------- */

  /** Every active schedule activity for a project. */
  async listActivities(projectId: string): Promise<PlanningActivity[]> {
    const { data, error } = await client()
      .from("planning_activities")
      .select("*")
      .eq("project_id", projectId)
      .eq("active", true)
      .order("code", { ascending: true });
    if (error) throw await readFailure("read the planning activities", error);
    return ((data ?? []) as PlanningActivityRow[]).map(mapActivity);
  },

  async createActivity(
    projectId: string,
    input: PlanningActivityInput,
    originImportRowId?: string
  ): Promise<PlanningActivity> {
    const { data, error } = await client()
      .from("planning_activities")
      .insert({
        project_id: projectId,
        work_item_id: input.workItemId || null,
        origin_import_row_id: originImportRowId ?? null,
        external_id: clean(input.externalId),
        code: clean(input.code),
        name: input.name.trim(),
        is_milestone: input.isMilestone ?? false,
        local_weight_percent: num(input.localWeightPercent),
        earning_method: input.earningMethod || null,
        department_id: input.departmentId || null,
        system_id: input.systemId || null,
        discipline_id: input.disciplineId || null,
        structure_node_id: input.structureNodeId || null,
        planned_start_date: clean(input.plannedStartDate),
        planned_finish_date: clean(input.plannedFinishDate),
        baseline_start_date: clean(input.baselineStartDate),
        baseline_finish_date: clean(input.baselineFinishDate),
        actual_start_date: clean(input.actualStartDate),
        actual_finish_date: clean(input.actualFinishDate),
        planned_duration_days: num(input.plannedDurationDays),
        remaining_duration_days: num(input.remainingDurationDays),
        percent_complete_planned: num(input.percentCompletePlanned),
        percent_complete_actual: num(input.percentCompleteActual),
        percent_complete_physical: num(input.percentCompletePhysical),
        weight_percent: num(input.weightPercent),
        status: clean(input.status),
        planned_value: num(input.plannedValue),
        earned_value: num(input.earnedValue),
        source: originImportRowId ? "import" : "manual",
      })
      .select("*")
      .single();
    if (error) throw await writeFailure("create the activity", error);
    return mapActivity(data as PlanningActivityRow);
  },

  /**
   * 13.11: a direct Project Control edit of an activity's Working Plan
   * fields. Only the fields passed are written; the database logs every
   * governed change (`log_working_plan_change()`). The schedule-owned fields
   * of an IMPORTED activity change through Imports & Review, never here —
   * callers pass them only for manual activities.
   */
  async updateActivity(id: string, input: Partial<PlanningActivityInput>): Promise<PlanningActivity> {
    const patch: Record<string, unknown> = {};
    if (input.workItemId !== undefined) patch.work_item_id = input.workItemId || null;
    if (input.code !== undefined) patch.code = clean(input.code);
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.isMilestone !== undefined) patch.is_milestone = input.isMilestone;
    if ("localWeightPercent" in input) patch.local_weight_percent = num(input.localWeightPercent);
    if (input.earningMethod !== undefined) patch.earning_method = input.earningMethod || null;
    if (input.departmentId !== undefined) patch.department_id = input.departmentId || null;
    if (input.systemId !== undefined) patch.system_id = input.systemId || null;
    if (input.disciplineId !== undefined) patch.discipline_id = input.disciplineId || null;
    if (input.structureNodeId !== undefined) patch.structure_node_id = input.structureNodeId || null;
    if (input.plannedStartDate !== undefined) patch.planned_start_date = clean(input.plannedStartDate);
    if (input.plannedFinishDate !== undefined) patch.planned_finish_date = clean(input.plannedFinishDate);
    if (input.actualStartDate !== undefined) patch.actual_start_date = clean(input.actualStartDate);
    if (input.actualFinishDate !== undefined) patch.actual_finish_date = clean(input.actualFinishDate);
    if ("percentCompletePhysical" in input) {
      patch.percent_complete_physical = num(input.percentCompletePhysical);
    }

    const { data, error } = await client()
      .from("planning_activities")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw await writeFailure("update the activity", error);
    return mapActivity(data as PlanningActivityRow);
  },

  /**
   * 13.11 / W3: one explicit, logged weight decision for one parent's
   * children (`null` = the Project). `children` is the proposal from
   * `proposeWeightDecision()`; the database re-verifies it against the
   * stored weights and refuses a stale one. Returns the decision id.
   */
  async recordWeightDecision(input: {
    projectId: string;
    parentWorkItemId: string | null;
    mode: PlanningWeightDecisionMode;
    children: { kind: "node" | "activity"; id: string; before: number | null; after: number }[];
    reason: string;
  }): Promise<string> {
    const { data, error } = await client().rpc("record_planning_weight_decision", {
      p_project: input.projectId,
      p_parent_work_item_id: input.parentWorkItemId,
      p_mode: input.mode,
      p_children: input.children,
      p_reason: input.reason,
    });
    if (error) throw await writeFailure("record the weight decision", error);
    return data as string;
  },

  /**
   * Confirms or adjusts a single field on a live activity, logging the
   * decision to planning_confirmations in the same call. The raw import row
   * behind the activity, if any, is never touched.
   */
  async confirmActivityField(input: {
    activityId: string;
    fieldName: string;
    previousValue: string | null;
    newValue: string | null;
    action: PlanningConfirmationAction;
    reason: string;
    patch: Record<string, unknown>;
    importRowId?: string;
  }): Promise<void> {
    const { error: updateError } = await client()
      .from("planning_activities")
      .update(input.patch)
      .eq("id", input.activityId);
    if (updateError) throw await writeFailure("save the confirmed value", updateError);

    const { error: logError } = await client().from("planning_confirmations").insert({
      activity_id: input.activityId,
      import_row_id: input.importRowId ?? null,
      action: input.action,
      field_name: input.fieldName,
      previous_value: input.previousValue,
      new_value: input.newValue,
      reason: input.reason,
    });
    if (logError) throw await writeFailure("log the confirmation", logError);
  },

  async archiveActivity(id: string): Promise<void> {
    const { error } = await client()
      .from("planning_activities")
      .update({ active: false, archived_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw await writeFailure("archive the activity", error);
  },

  /* --------------------------- Import batches ------------------------------ */

  async listImportBatches(projectId: string): Promise<PlanningImportBatch[]> {
    const { data, error } = await client()
      .from("planning_import_batches")
      .select("*")
      .eq("project_id", projectId)
      .order("uploaded_at", { ascending: false });
    if (error) throw await readFailure("read the import batches", error);
    return ((data ?? []) as PlanningImportBatchRow[]).map(mapImportBatch);
  },

  async getImportBatch(id: string): Promise<PlanningImportBatch | null> {
    const { data, error } = await client()
      .from("planning_import_batches")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw await readFailure("read the import batch", error);
    return data ? mapImportBatch(data as PlanningImportBatchRow) : null;
  },

  async createImportBatch(input: {
    projectId: string;
    sourceType: PlanningImportSourceFormat;
    fileName?: string;
    /**
     * The schedule's own Data Date (Planning Integration 3A) — detected
     * from the file or entered by the user in the import wizard. Not
     * optional in practice: the wizard requires it before this is called,
     * and `publish_planning_snapshot()` refuses a batch without one.
     */
    dataDate?: string;
  }): Promise<PlanningImportBatch> {
    const { data, error } = await client()
      .from("planning_import_batches")
      .insert({
        project_id: input.projectId,
        source_type: input.sourceType,
        file_name: clean(input.fileName),
        data_date: clean(input.dataDate),
      })
      .select("*")
      .single();
    if (error) throw await writeFailure("create the import batch", error);
    return mapImportBatch(data as PlanningImportBatchRow);
  },

  /**
   * Persists every parsed row verbatim, insert-only. `rows` should be exactly
   * what the parser mapped, keyed however the caller likes — this never
   * infers or fabricates a value.
   */
  async saveImportRows(
    batchId: string,
    rows: {
      rowNumber: number;
      externalId?: string;
      wbsPath?: string;
      name?: string;
      rawData: Record<string, unknown>;
      parseStatus: PlanningImportRowParseStatus;
      parseNotes?: string;
    }[]
  ): Promise<void> {
    const payload = rows.map((row) => ({
      batch_id: batchId,
      row_number: row.rowNumber,
      external_id: clean(row.externalId),
      wbs_path: clean(row.wbsPath),
      name: clean(row.name),
      raw_data: row.rawData,
      parse_status: row.parseStatus,
      parse_notes: clean(row.parseNotes),
    }));
    const { error } = await client().from("planning_import_rows").insert(payload);
    if (error) throw await writeFailure("save the imported rows", error);

    const { error: statusError } = await client()
      .from("planning_import_batches")
      .update({ status: "validated", row_count: rows.length, validated_at: new Date().toISOString() })
      .eq("id", batchId);
    if (statusError) throw await writeFailure("mark the batch validated", statusError);
  },

  async listImportRows(batchId: string): Promise<PlanningImportRow[]> {
    const { data, error } = await client()
      .from("planning_import_rows")
      .select("*")
      .eq("batch_id", batchId)
      .order("row_number", { ascending: true });
    if (error) throw await readFailure("read the imported rows", error);
    return ((data ?? []) as PlanningImportRowRow[]).map(mapImportRow);
  },

  async rejectImportBatch(id: string, reason: string): Promise<void> {
    const { error } = await client()
      .from("planning_import_batches")
      .update({ status: "rejected", rejection_reason: reason })
      .eq("id", id);
    if (error) throw await writeFailure("reject the import batch", error);
  },

  /* ----------------------------- Confirmations ------------------------------ */

  async listConfirmationsForActivity(activityId: string): Promise<PlanningConfirmation[]> {
    const { data, error } = await client()
      .from("planning_confirmations")
      .select("*")
      .eq("activity_id", activityId)
      .order("confirmed_at", { ascending: false });
    if (error) throw await readFailure("read the confirmation history", error);
    return ((data ?? []) as PlanningConfirmationRow[]).map(mapConfirmation);
  },

  async listConfirmationsForWorkItem(workItemId: string): Promise<PlanningConfirmation[]> {
    const { data, error } = await client()
      .from("planning_confirmations")
      .select("*")
      .eq("work_item_id", workItemId)
      .order("confirmed_at", { ascending: false });
    if (error) throw await readFailure("read the confirmation history", error);
    return ((data ?? []) as PlanningConfirmationRow[]).map(mapConfirmation);
  },

  /* ------------------------------- Baselines -------------------------------- */

  async listBaselines(projectId: string): Promise<PlanningBaseline[]> {
    const { data, error } = await client()
      .from("planning_baselines")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) throw await readFailure("read the baselines", error);
    return ((data ?? []) as PlanningBaselineRow[]).map(mapBaseline);
  },

  async createBaseline(input: {
    projectId: string;
    name: string;
    baselineDate: string;
    notes?: string;
    capturedItems?: unknown;
  }): Promise<PlanningBaseline> {
    const { data, error } = await client()
      .from("planning_baselines")
      .insert({
        project_id: input.projectId,
        name: input.name.trim(),
        baseline_date: input.baselineDate,
        notes: clean(input.notes),
        captured_items: input.capturedItems ?? [],
      })
      .select("*")
      .single();
    if (error) throw await writeFailure("create the baseline", error);
    return mapBaseline(data as PlanningBaselineRow);
  },

  /* --------------------------- Milestone linking ----------------------------- */

  async listMilestoneLinksForProject(masterMilestoneIds: string[]): Promise<PlanningMilestoneLink[]> {
    if (masterMilestoneIds.length === 0) return [];
    const { data, error } = await client()
      .from("planning_milestone_links")
      .select("*")
      .in("master_milestone_id", masterMilestoneIds);
    if (error) throw await readFailure("read the milestone links", error);
    return ((data ?? []) as PlanningMilestoneLinkRow[]).map(mapMilestoneLink);
  },

  async linkWorkItemToMilestone(workItemId: string, masterMilestoneId: string): Promise<void> {
    const { error } = await client()
      .from("planning_milestone_links")
      .insert({ work_item_id: workItemId, master_milestone_id: masterMilestoneId });
    if (error) throw await writeFailure("link the work item to the milestone", error);
  },

  async unlinkMilestone(linkId: string): Promise<void> {
    const { error } = await client().from("planning_milestone_links").delete().eq("id", linkId);
    if (error) throw await writeFailure("remove the milestone link", error);
  },

  /* ------------------------------- Snapshots -------------------------------- */

  /** Every published snapshot for a project, newest first. */
  async listSnapshots(projectId: string): Promise<PlanningSnapshot[]> {
    const { data, error } = await client()
      .from("planning_snapshots")
      .select("*")
      .eq("project_id", projectId)
      .order("version", { ascending: false });
    if (error) throw await readFailure("read the planning snapshots", error);
    return ((data ?? []) as PlanningSnapshotRow[]).map(mapSnapshot);
  },

  /** One snapshot by id, or `null` if it does not exist (or is not visible under RLS). */
  async getSnapshotById(id: string): Promise<PlanningSnapshot | null> {
    const { data, error } = await client()
      .from("planning_snapshots")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw await readFailure("read the planning snapshot", error);
    return data ? mapSnapshot(data as PlanningSnapshotRow) : null;
  },

  /** The current (highest-version) published snapshot, or `null` if none. */
  async getLatestSnapshot(projectId: string): Promise<PlanningSnapshot | null> {
    const { data, error } = await client()
      .from("planning_snapshots")
      .select("*")
      .eq("project_id", projectId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw await readFailure("read the latest planning snapshot", error);
    return data ? mapSnapshot(data as PlanningSnapshotRow) : null;
  },

  /**
   * The snapshot a report dated `periodEnd` should resolve to (Planning
   * Integration 3A): among published snapshots whose `dataDate` is not
   * after `periodEnd`, the one with the LATEST dataDate — version only
   * breaks a tie between snapshots sharing that same dataDate. A snapshot
   * published later but reporting an EARLIER data date must still lose to
   * one reporting a later (but still eligible) data date, however much
   * higher its version — ordering by version first would let a later,
   * lower-position publish incorrectly outrank an earlier, more current
   * one. A `dataDate` after `periodEnd`, or null (a pre-3A snapshot with
   * no recoverable date), is never eligible.
   */
  async getSnapshotForPeriod(
    projectId: string,
    periodEnd: string
  ): Promise<PlanningSnapshot | null> {
    const { data, error } = await client()
      .from("planning_snapshots")
      .select("*")
      .eq("project_id", projectId)
      .lte("data_date", periodEnd)
      .order("data_date", { ascending: false })
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw await readFailure("resolve the planning snapshot for this period", error);
    }
    return data ? mapSnapshot(data as PlanningSnapshotRow) : null;
  },

  /**
   * The normalized, drillable activity history one snapshot owns. This is
   * the queryable path — `PlanningSnapshot.snapshotData`'s JSON is a
   * convenience archive of the same publish, not the only record.
   */
  async listSnapshotActivities(snapshotId: string): Promise<PlanningSnapshotActivity[]> {
    const { data, error } = await client()
      .from("planning_snapshot_activities")
      .select("*")
      .eq("snapshot_id", snapshotId)
      .order("code", { ascending: true });
    if (error) throw await readFailure("read the snapshot's activity history", error);
    return ((data ?? []) as PlanningSnapshotActivityRow[]).map(mapSnapshotActivity);
  },

  /**
   * The most recent PUBLISHED value for one activity, matched by its stable
   * external id (never by the mutable display code) — the "Previous
   * Published Snapshot" column in Planning Review.
   */
  async getPreviousSnapshotActivity(
    projectId: string,
    externalId: string
  ): Promise<PlanningSnapshotActivity | null> {
    if (!externalId) return null;
    const { data, error } = await client()
      .from("planning_snapshot_activities")
      .select("*, planning_snapshots!inner(project_id, version)")
      .eq("external_id", externalId)
      .eq("planning_snapshots.project_id", projectId)
      .order("version", { foreignTable: "planning_snapshots", ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw await readFailure("read the previous published value", error);
    return data ? mapSnapshotActivity(data as PlanningSnapshotActivityRow) : null;
  },

  /* --------------------------- Opening Position ----------------------------- */

  /** The project's current draft Opening Position, or `null` if none. */
  async getDraftOpeningPosition(projectId: string): Promise<PlanningOpeningPosition | null> {
    const { data, error } = await client()
      .from("planning_opening_positions")
      .select("*")
      .eq("project_id", projectId)
      .eq("status", "draft")
      .maybeSingle();
    if (error) throw await readFailure("read the Opening Position", error);
    return data ? mapOpeningPosition(data as PlanningOpeningPositionRow) : null;
  },

  /**
   * One Opening Position by id, regardless of status — recovers the
   * declared figures behind a Snapshot promoted from one
   * (`PlanningSnapshot.sourceOpeningPositionId`), since that snapshot has
   * no activities of its own to roll up. `getDraftOpeningPosition` cannot
   * reach it once promoted: its status has already moved to `"promoted"`.
   */
  async getOpeningPositionById(id: string): Promise<PlanningOpeningPosition | null> {
    const { data, error } = await client()
      .from("planning_opening_positions")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw await readFailure("read the Opening Position", error);
    return data ? mapOpeningPosition(data as PlanningOpeningPositionRow) : null;
  },

  /**
   * Declares a starting position for a project onboarded mid-execution.
   * Does not itself become Snapshot V1 — call `publishSnapshot` with the
   * returned id to promote it. "Do not create fake history": this never
   * writes a planning_work_items/planning_activities row.
   */
  async createOpeningPosition(input: {
    projectId: string;
    dataDate: string;
    plannedProgressPercent?: number;
    actualProgressPercent?: number;
    forecastFinishDate?: string;
    source: string;
  }): Promise<PlanningOpeningPosition> {
    const { data, error } = await client()
      .from("planning_opening_positions")
      .insert({
        project_id: input.projectId,
        data_date: input.dataDate,
        planned_progress_percent: num(input.plannedProgressPercent),
        actual_progress_percent: num(input.actualProgressPercent),
        forecast_finish_date: clean(input.forecastFinishDate),
        source: input.source,
      })
      .select("*")
      .single();
    if (error) throw await writeFailure("record the Opening Position", error);
    return mapOpeningPosition(data as PlanningOpeningPositionRow);
  },

  /**
   * Publishes the project's current governed planning register as one new,
   * immutable Planning Snapshot. Server-enforced: `publish_planning_snapshot()`
   * re-checks Project Control authority itself, independently of this call.
   *
   * Pass `openingPositionId` to promote an Opening Position as Snapshot V1 —
   * mutually exclusive with `importBatchId`.
   */
  async publishSnapshot(input: {
    projectId: string;
    importBatchId?: string;
    baselineId?: string;
    isOpeningSnapshot?: boolean;
    label?: string;
    openingPositionId?: string;
    /**
     * Required (Planning Integration 3A) ONLY when publishing manually —
     * neither an import batch nor an Opening Position. The database
     * refuses to publish without one in that case; an import batch or
     * Opening Position already carries its own Data Date and this must be
     * left unset when either is provided.
     */
    dataDate?: string;
    /**
     * 13.9B: the user's explicit "Project Setup becomes controlled"
     * confirmation. The database requires it for the project's FIRST
     * snapshot and ignores it afterwards. Never defaulted to true here: only
     * a confirmation the user actually gave may set it.
     */
    confirmSetupControl?: boolean;
  }): Promise<string> {
    const { data, error } = await client().rpc("publish_planning_snapshot", {
      p_project_id: input.projectId,
      p_import_batch_id: input.importBatchId ?? null,
      p_baseline_id: input.baselineId ?? null,
      p_is_opening_snapshot: input.isOpeningSnapshot ?? false,
      p_label: input.label ?? null,
      p_opening_position_id: input.openingPositionId ?? null,
      p_data_date: input.dataDate ?? null,
      p_confirm_setup_control: input.confirmSetupControl ?? false,
    });
    if (error) throw await writeFailure("publish the planning snapshot", error);
    return data as string;
  },
};

const DENIED =
  "You do not have permission to manage Planning for this project. Project Control manages Planning for this project.";

async function writeFailure(
  operation: string,
  error: ServiceError
): Promise<Error> {
  return describeFailure({
    scope: "planning-service",
    operation,
    error,
    known: workingPlanRefusalMessage(error),
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
    scope: "planning-service",
    operation,
    error,
    deniedMessage: DENIED,
    fallback: "Planning data could not be loaded. Please try again.",
  });
}

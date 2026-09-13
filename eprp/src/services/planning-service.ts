import type {
  PlanningOnboardingMode,
  PlanningOpeningPosition,
  PlanningOpeningPositionStatus,
  PlanningSnapshot,
  PlanningSnapshotActivity,
  ProjectPlanningSettings,
} from "@/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  PlanningOpeningPositionRow,
  PlanningSnapshotActivityRow,
  PlanningSnapshotRow,
  ProjectPlanningSettingsRow,
} from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeFailure, type ServiceError } from "./service-errors";

/**
 * Planning & Control — Slice 1 foundation.
 *
 * Import parsing, the confirm/adjust workflow and baseline capture are UI
 * work for a later slice (see 15_DEVELOPMENT_ROADMAP.md). This gives the
 * Planning & Control route shell, Project Setup, and future phases one place
 * to read a project's planning configuration, Opening Positions and
 * published snapshots — `publishSnapshot` wraps the one governed write this
 * slice defines.
 */

function client(): SupabaseClient {
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

function mapSettings(row: ProjectPlanningSettingsRow): ProjectPlanningSettings {
  return {
    projectId: row.project_id,
    onboardingMode: row.onboarding_mode as PlanningOnboardingMode,
    defaultImportSource:
      (row.default_import_source as ProjectPlanningSettings["defaultImportSource"]) ??
      undefined,
    planningEnabled: row.planning_enabled,
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
    code: row.code ?? undefined,
    name: row.name,
    isMilestone: row.is_milestone,
    plannedStartDate: row.planned_start_date ?? undefined,
    plannedFinishDate: row.planned_finish_date ?? undefined,
    baselineStartDate: row.baseline_start_date ?? undefined,
    baselineFinishDate: row.baseline_finish_date ?? undefined,
    percentCompletePlanned: row.percent_complete_planned ?? undefined,
    weightPercent: row.weight_percent ?? undefined,
    createdAt: row.created_at,
  };
}

export const planningService = {
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
   */
  async upsertSettings(input: {
    projectId: string;
    onboardingMode: PlanningOnboardingMode;
    defaultImportSource?: ProjectPlanningSettings["defaultImportSource"];
  }): Promise<ProjectPlanningSettings> {
    const { data, error } = await client()
      .from("project_planning_settings")
      .upsert(
        {
          project_id: input.projectId,
          onboarding_mode: input.onboardingMode,
          default_import_source: input.defaultImportSource ?? null,
        },
        { onConflict: "project_id" }
      )
      .select("*")
      .single();
    if (error) throw await writeFailure("save the Planning Onboarding Mode", error);
    return mapSettings(data as ProjectPlanningSettingsRow);
  },

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
        planned_progress_percent: input.plannedProgressPercent ?? null,
        actual_progress_percent: input.actualProgressPercent ?? null,
        forecast_finish_date: input.forecastFinishDate ?? null,
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
  }): Promise<string> {
    const { data, error } = await client().rpc("publish_planning_snapshot", {
      p_project_id: input.projectId,
      p_import_batch_id: input.importBatchId ?? null,
      p_baseline_id: input.baselineId ?? null,
      p_is_opening_snapshot: input.isOpeningSnapshot ?? false,
      p_label: input.label ?? null,
      p_opening_position_id: input.openingPositionId ?? null,
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

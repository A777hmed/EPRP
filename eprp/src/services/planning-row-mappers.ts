import type {
  PlanningActivity,
  PlanningBaseline,
  PlanningBaselineCapture,
  PlanningBaselineRevisionStatus,
  PlanningEarningMethod,
  PlanningItemSource,
  PlanningOnboardingMode,
  PlanningSnapshot,
  PlanningSnapshotActivity,
  PlanningSnapshotMilestone,
  PlanningSnapshotNode,
  PlanningWeightSource,
  PlanningWorkItem,
  PlanningWorkItemType,
  ProjectPlanningSettings,
} from "@/types";
import type {
  PlanningActivityRow,
  PlanningBaselineRow,
  PlanningSnapshotActivityRow,
  PlanningSnapshotMilestoneRow,
  PlanningSnapshotNodeRow,
  PlanningSnapshotRow,
  PlanningWorkItemRow,
  ProjectPlanningSettingsRow,
} from "@/lib/supabase/database.types";

/**
 * Row → domain mappers for the planning tables. Pure, with no client import,
 * so the browser service (`planning-service.ts`) and the server-side publish
 * (13.12, `features/projects/planning-publish/`) read rows the same way.
 *
 * Numeric columns arrive from PostgREST as numbers or numeric strings; the
 * helpers below accept both. Blank / null means "not stated", never zero.
 */

function numberOrUndefined(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function requiredNumber(value: number | string | null | undefined): number {
  return numberOrUndefined(value) ?? 0;
}

export function mapSettings(row: ProjectPlanningSettingsRow): ProjectPlanningSettings {
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

export function mapWorkItem(row: PlanningWorkItemRow): PlanningWorkItem {
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
    weightPercent: numberOrUndefined(row.weight_percent),
    localWeightPercent: numberOrUndefined(row.local_weight_percent),
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

export function mapActivity(row: PlanningActivityRow): PlanningActivity {
  return {
    id: row.id,
    projectId: row.project_id,
    workItemId: row.work_item_id ?? undefined,
    originImportRowId: row.origin_import_row_id ?? undefined,
    externalId: row.external_id ?? undefined,
    code: row.code ?? undefined,
    name: row.name,
    isMilestone: row.is_milestone,
    localWeightPercent: numberOrUndefined(row.local_weight_percent),
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
    percentCompletePlanned: numberOrUndefined(row.percent_complete_planned),
    percentCompleteActual: numberOrUndefined(row.percent_complete_actual),
    percentCompletePhysical: numberOrUndefined(row.percent_complete_physical),
    weightPercent: numberOrUndefined(row.weight_percent),
    status: row.status ?? undefined,
    plannedValue: numberOrUndefined(row.planned_value),
    earnedValue: numberOrUndefined(row.earned_value),
    source: row.source as PlanningItemSource,
    active: row.active,
    archivedAt: row.archived_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSnapshot(row: PlanningSnapshotRow): PlanningSnapshot {
  const engine = row.engine_version ?? null;
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
    calculation: engine ? "engine" : row.is_opening_snapshot ? "declared" : "legacy",
    v2: engine
      ? {
          engineVersion: engine,
          bl0BaselineId: row.bl0_baseline_id ?? "",
          blnBaselineId: row.bln_baseline_id ?? "",
          sourceKind: row.source_kind === "import_batch" ? "import_batch" : "manual",
          publishedByUserId: row.published_by_user_id ?? undefined,
          workingPlanFingerprint: row.working_plan_fingerprint ?? "",
          configurationUpdatedAt: row.configuration_updated_at ?? undefined,
          editsSinceSource: numberOrUndefined(row.edits_since_source),
          editsHighWaterAt: row.edits_high_water_at ?? undefined,
          pv: requiredNumber(row.project_pv),
          ev: requiredNumber(row.project_ev),
          sv: requiredNumber(row.project_sv),
          spi: numberOrUndefined(row.project_spi) ?? null,
          spiReason: row.project_spi_reason ?? undefined,
          coveragePercent: requiredNumber(row.coverage_percent),
          crossCheckMaxDifference: numberOrUndefined(row.cross_check_max_difference),
          bl0FinishDate: row.bl0_finish_date ?? undefined,
          blnFinishDate: row.bln_finish_date ?? undefined,
          forecastFinishDate: row.forecast_finish_date ?? undefined,
          forecastCurveReason: row.forecast_curve_reason ?? undefined,
          scheduleCondition: "not_evaluated",
        }
      : undefined,
  };
}

export function mapSnapshotActivity(row: PlanningSnapshotActivityRow): PlanningSnapshotActivity {
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
    percentCompletePlanned: numberOrUndefined(row.percent_complete_planned),
    percentCompleteActual: numberOrUndefined(row.percent_complete_actual),
    percentCompletePhysical: numberOrUndefined(row.percent_complete_physical),
    weightPercent: numberOrUndefined(row.weight_percent),
    status: row.status ?? undefined,
    plannedValue: numberOrUndefined(row.planned_value),
    earnedValue: numberOrUndefined(row.earned_value),
    createdAt: row.created_at,
    v2:
      row.earning_method && row.pv !== null && row.pv !== undefined
        ? {
            position: row.item_position ?? 0,
            earningMethod: row.earning_method as PlanningEarningMethod,
            localWeight: requiredNumber(row.local_weight),
            effectiveWeight: requiredNumber(row.effective_weight),
            pv: requiredNumber(row.pv),
            ev: requiredNumber(row.ev),
            sv: requiredNumber(row.sv),
            pvContribution: requiredNumber(row.pv_contribution),
            evContribution: requiredNumber(row.ev_contribution),
            bl0StartDate: row.bl0_start_date ?? undefined,
            bl0FinishDate: row.bl0_finish_date ?? undefined,
            blnStartDate: row.bln_start_date ?? undefined,
            blnFinishDate: row.bln_finish_date ?? undefined,
            departmentId: row.department_id ?? undefined,
            systemId: row.system_id ?? undefined,
            disciplineId: row.discipline_id ?? undefined,
            structureNodeId: row.structure_node_id ?? undefined,
          }
        : undefined,
  };
}

export function mapSnapshotNode(row: PlanningSnapshotNodeRow): PlanningSnapshotNode {
  return {
    snapshotId: row.snapshot_id,
    sourceWorkItemId: row.source_work_item_id,
    parentWorkItemId: row.parent_work_item_id ?? undefined,
    position: row.item_position,
    depth: row.depth,
    code: row.code ?? undefined,
    name: row.name,
    itemType: row.item_type ?? undefined,
    isControlAccount: row.is_control_account,
    localWeight: requiredNumber(row.local_weight),
    effectiveWeight: requiredNumber(row.effective_weight),
    pv: requiredNumber(row.pv),
    ev: requiredNumber(row.ev),
    sv: requiredNumber(row.sv),
    spi: numberOrUndefined(row.spi) ?? null,
    spiReason: row.spi_reason ?? undefined,
    pvContribution: requiredNumber(row.pv_contribution),
    evContribution: requiredNumber(row.ev_contribution),
    departmentId: row.department_id ?? undefined,
    systemId: row.system_id ?? undefined,
    disciplineId: row.discipline_id ?? undefined,
    structureNodeId: row.structure_node_id ?? undefined,
    scheduleCondition: "not_evaluated",
  };
}

export function mapSnapshotMilestone(row: PlanningSnapshotMilestoneRow): PlanningSnapshotMilestone {
  return {
    snapshotId: row.snapshot_id,
    sourceActivityId: row.source_activity_id,
    code: row.code ?? undefined,
    name: row.name,
    isKey: row.is_key,
    bl0Date: row.bl0_date ?? undefined,
    blnDate: row.bln_date ?? undefined,
    forecastDate: row.forecast_date ?? undefined,
    actualDate: row.actual_date ?? undefined,
    status: row.status as PlanningSnapshotMilestone["status"],
    slipVsBln: numberOrUndefined(row.slip_vs_bln) ?? null,
    slipVsBlnReason: row.slip_vs_bln_reason ?? undefined,
    slipVsBl0: numberOrUndefined(row.slip_vs_bl0) ?? null,
    slipVsBl0Reason: row.slip_vs_bl0_reason ?? undefined,
    due: row.due,
    scheduleCondition: "not_evaluated",
  };
}

export function mapBaseline(row: PlanningBaselineRow): PlanningBaseline {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    baselineDate: row.baseline_date,
    capturedItems: row.captured_items,
    notes: row.notes ?? undefined,
    createdByContactId: row.created_by_contact_id ?? undefined,
    createdAt: row.created_at,
    revisionStatus: (row.revision_status ?? "legacy") as PlanningBaselineRevisionStatus,
    revisionNumber: numberOrUndefined(row.revision_number),
    revisionKind: (row.revision_kind as PlanningBaseline["revisionKind"]) ?? undefined,
    reason: row.reason ?? undefined,
    requestedByUserId: row.requested_by_user_id ?? undefined,
    requestedByContactId: row.requested_by_contact_id ?? undefined,
    requestedAt: row.requested_at ?? undefined,
    decidedByUserId: row.decided_by_user_id ?? undefined,
    decidedByContactId: row.decided_by_contact_id ?? undefined,
    decidedAt: row.decided_at ?? undefined,
    decisionComment: row.decision_comment ?? undefined,
    capture: (row.capture as PlanningBaselineCapture | null) ?? undefined,
    curveEngineVersion: row.curve_engine_version ?? undefined,
  };
}

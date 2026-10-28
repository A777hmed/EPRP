/**
 * Phase 13.12 — the ONE publish orchestration (`docs/02` §26.25 D-A).
 *
 *   Working Plan (one consistent read) → the 13.11 adapter (toEnginePlanInput)
 *   → validation → the 13.10 Planning Engine → the v2 payload
 *
 * Pure: no storage, no clock, no client. The server action reads the inputs
 * as the user (`planning_publish_inputs()`), calls this, and hands the payload
 * to the server-only trusted writer, which re-checks every rule and freezes
 * the result. Nothing here re-implements an engine calculation: every figure
 * in the payload is the engine's own, copied field by field.
 *
 * The same module prepares a Baseline Revision request: the capture is made
 * by the database from the Working Plan; only its baseline curve — which only
 * the engine calculates — is produced here.
 */

import {
  baselineCurve,
  calculatePlanPerformance,
  finishDates,
  forecastCurve,
  isIsoDate,
  parseWorkingWeek,
  planMilestones,
  PLANNING_ENGINE_VERSION,
  type DateWindow,
  type EnginePlanInput,
  type PlanningFigure,
  type ValidationIssue,
} from "@/lib/planning-engine";
import type {
  PlanningActivityRow,
  PlanningWorkItemRow,
  ProjectPlanningSettingsRow,
} from "@/lib/supabase/database.types";
import { mapActivity, mapSettings, mapWorkItem } from "@/services/planning-row-mappers";
import type { PlanningActivity, PlanningBaselineCapture, PlanningEarningMethod, Weekday } from "@/types";
import {
  buildWorkingPlanTree,
  flattenWorkingPlan,
  resolveReportingUnit,
  toEnginePlanInput,
  type WorkingPlanElement,
} from "../working-plan";

/* -------------------------------------------------------------------------- */
/* Inputs                                                                     */
/* -------------------------------------------------------------------------- */

/** One approved Baseline Revision as `planning_publish_inputs()` returns it. */
export interface PublishInputsBaseline {
  id: string;
  revision_number: number;
  revision_kind: "original" | "rebaseline";
  decided_at: string;
  capture: PlanningBaselineCapture;
}

/** Exactly what `planning_publish_inputs(project)` returns (one consistent read). */
export interface PublishInputsBundle {
  fingerprint: string | null;
  project: {
    id: string;
    code: string;
    structure_family: "psm" | "other" | null;
    working_week: string | null;
    weekly_reporting_day: string | null;
    status: string | null;
  } | null;
  settings: ProjectPlanningSettingsRow | null;
  work_items: PlanningWorkItemRow[];
  activities: PlanningActivityRow[];
  baselines: PublishInputsBaseline[];
  controlled_since: string | null;
}

/** A refusal the user can act on — never a raw database or engine text. */
export interface PublishProblem {
  code: string;
  message: string;
}

/* -------------------------------------------------------------------------- */
/* The v2 payload (consumed by publish_planning_snapshot_v2)                  */
/* -------------------------------------------------------------------------- */

interface MappingFields {
  department_id: string | null;
  system_id: string | null;
  discipline_id: string | null;
  structure_node_id: string | null;
}

export interface PublishPayloadNode extends MappingFields {
  work_item_id: string;
  parent_id: string | null;
  item_position: number;
  depth: number;
  is_control_account: boolean;
  local_weight: number;
  effective_weight: number;
  pv: number;
  ev: number;
  sv: number;
  spi: number | null;
  spi_reason: string | null;
  pv_contribution: number;
  ev_contribution: number;
}

export interface PublishPayloadActivity extends MappingFields {
  activity_id: string;
  work_item_id: string | null;
  item_position: number;
  earning_method: PlanningEarningMethod;
  local_weight: number | null;
  effective_weight: number;
  pv: number;
  ev: number;
  sv: number;
  pv_contribution: number;
  ev_contribution: number;
  percent_complete: number | null;
  forecast_start: string | null;
  forecast_finish: string | null;
  actual_start: string | null;
  actual_finish: string | null;
  bln_start: string | null;
  bln_finish: string | null;
  bl0_start: string | null;
  bl0_finish: string | null;
}

export interface PublishPayloadMilestone {
  activity_id: string;
  is_key: boolean;
  bl0_date: string | null;
  bln_date: string | null;
  forecast_date: string | null;
  actual_date: string | null;
  status: "achieved" | "overdue" | "upcoming" | "unscheduled";
  slip_vs_bln: number | null;
  slip_vs_bln_reason: string | null;
  slip_vs_bl0: number | null;
  slip_vs_bl0_reason: string | null;
  due: boolean;
}

export interface PublishPayloadV2 {
  fingerprint: string;
  data_date: string;
  source_import_batch_id: string | null;
  label: string | null;
  engine_version: string;
  bl0_baseline_id: string;
  bln_baseline_id: string;
  project: { pv: number; ev: number; sv: number; spi: number | null; spi_reason: string | null };
  coverage_percent: number;
  cross_check_max_difference: number;
  advisories: { code: string; element: string; message: string }[];
  finish: { bl0_finish: string | null; bln_finish: string | null; forecast_finish: string | null };
  nodes: PublishPayloadNode[];
  activities: PublishPayloadActivity[];
  milestones: PublishPayloadMilestone[];
  forecast_curve: { date: string; value: number }[];
  forecast_curve_reason: string | null;
}

export type PublishPlanResult =
  | { status: "ready"; payload: PublishPayloadV2; summary: PublishSummary }
  | { status: "refused"; problems: PublishProblem[] };

export interface PublishSummary {
  dataDate: string;
  engineVersion: string;
  bl0Number: number;
  blnNumber: number;
  pv: number;
  ev: number;
  sv: number;
  spi: number | null;
  nodeCount: number;
  activityCount: number;
  milestoneCount: number;
  advisoryCount: number;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const refused = (...problems: PublishProblem[]): { status: "refused"; problems: PublishProblem[] } => ({
  status: "refused",
  problems,
});

const WEEKDAYS: readonly Weekday[] = ["saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday"];

function reportingDayOf(value: string | null | undefined): Weekday | null {
  const day = value?.trim().toLowerCase();
  return day && (WEEKDAYS as readonly string[]).includes(day) ? (day as Weekday) : null;
}

/** A figure as the writer stores it: the value, or null with its reason. */
function figureParts(value: PlanningFigure): { value: number | null; reason: string | null } {
  return value.state === "value" ? { value: value.value, reason: null } : { value: null, reason: value.reason };
}

function captureWindow(entry: PlanningBaselineCapture["activities"][number] | undefined): DateWindow {
  return { start: entry?.start ?? null, finish: entry?.finish ?? null };
}

function listOf(names: string[], limit = 5): string {
  const shown = names.slice(0, limit).join(", ");
  return names.length > limit ? `${shown} and ${names.length - limit} more` : shown;
}

function activityLabel(activity: PlanningActivity): string {
  return activity.code ?? activity.externalId ?? activity.name;
}

function mappingOf(element: WorkingPlanElement): MappingFields {
  const resolution = resolveReportingUnit(element);
  const unit = resolution.unit;
  if (!unit) return { department_id: null, system_id: null, discipline_id: null, structure_node_id: null };
  if (unit.family === "other") {
    return { department_id: null, system_id: null, discipline_id: null, structure_node_id: unit.structureNodeId };
  }
  return {
    department_id: unit.departmentId,
    system_id: unit.systemId ?? null,
    discipline_id: unit.disciplineId ?? null,
    structure_node_id: null,
  };
}

function engineProblems(issues: readonly ValidationIssue[]): PublishProblem[] {
  return issues
    .filter((issue) => issue.severity === "blocking")
    .map((issue) => ({ code: issue.code, message: issue.message }));
}

/** The shared preconditions of a publish and of a baseline request. */
function commonPreconditions(bundle: PublishInputsBundle):
  | { ok: true; workingWeek: Weekday[]; reportingDay: Weekday }
  | { ok: false; problems: PublishProblem[] } {
  if (!bundle.project) {
    return { ok: false, problems: [{ code: "NOT_FOUND", message: "This project could not be read. Reload and try again." }] };
  }
  if (!bundle.settings) {
    return {
      ok: false,
      problems: [{ code: "ONBOARDING_NOT_CHOSEN", message: "Decide how the project will be planned in Project Setup first." }],
    };
  }
  if (bundle.settings.onboarding_mode === "no_formal_schedule") {
    return {
      ok: false,
      problems: [{
        code: "NO_FORMAL_SCHEDULE",
        message: "This project is planned without a formal schedule, so it has no baselines and publishes no Planning Snapshot.",
      }],
    };
  }
  if (!bundle.fingerprint) {
    return { ok: false, problems: [{ code: "NOT_AUTHORIZED", message: "You cannot read this project's Working Plan." }] };
  }
  const workingWeek = parseWorkingWeek(bundle.project.working_week);
  const reportingDay = reportingDayOf(bundle.project.weekly_reporting_day);
  if (!workingWeek || !reportingDay) {
    return {
      ok: false,
      problems: [{
        code: "PLAN_INVALID",
        message: "Set the project's working week and weekly reporting day in Project Setup before planning against them.",
      }],
    };
  }
  return { ok: true, workingWeek, reportingDay };
}

/* -------------------------------------------------------------------------- */
/* Publish                                                                    */
/* -------------------------------------------------------------------------- */

export function buildPublishPayload(
  bundle: PublishInputsBundle,
  request: { dataDate: string | null | undefined; sourceImportBatchId?: string | null; label?: string | null }
): PublishPlanResult {
  const pre = commonPreconditions(bundle);
  if (!pre.ok) return refused(...pre.problems);

  const dataDate = request.dataDate ?? null;
  if (!isIsoDate(dataDate)) {
    return refused({ code: "DATA_DATE_REQUIRED", message: "Enter the Data Date this snapshot reports as of." });
  }

  // Baselines: an approved BL0, and the current BLn (the latest approved).
  const approved = [...bundle.baselines].sort((a, b) => a.revision_number - b.revision_number);
  const bl0 = approved.find((baseline) => baseline.revision_number === 0);
  if (!bl0) {
    return refused({
      code: "NO_APPROVED_BL0",
      message:
        "Publishing needs an approved original baseline (BL0). Request it below; another Project Control Admin or System Administrator approves it.",
    });
  }
  const bln = approved[approved.length - 1];

  const settings = mapSettings(bundle.settings!);
  const workItems = bundle.work_items.map(mapWorkItem);
  const activities = bundle.activities.map(mapActivity);

  // New scope reaches PV only through an approved re-baseline (§26.25).
  const blnById = new Map(bln.capture.activities.map((entry) => [entry.id, entry]));
  const bl0ById = new Map(bl0.capture.activities.map((entry) => [entry.id, entry]));
  const newScope = activities.filter((activity) => !blnById.has(activity.id));
  if (newScope.length > 0) {
    return refused({
      code: "NEW_SCOPE_NOT_BASELINED",
      message: `Not in the current approved baseline (BL${bln.revision_number}): ${listOf(newScope.map(activityLabel))}. New scope reaches the plan only through an approved re-baseline.`,
    });
  }

  const adapted = toEnginePlanInput(workItems, activities, {
    projectId: bundle.project!.id,
    dataDate,
    workingWeek: pre.workingWeek,
    projectDefaultEarningMethod: settings.defaultEarningMethod,
    baselineFor: (activity) => captureWindow(blnById.get(activity.id)),
    originalBaselineFor: (activity) => (bl0ById.has(activity.id) ? captureWindow(bl0ById.get(activity.id)) : null),
  });
  const adapterBlocking = adapted.findings.filter((finding) => finding.severity === "blocking");
  if (adapted.status === "blocked" || adapterBlocking.length > 0) {
    return refused(...adapterBlocking.map((finding) => ({ code: finding.code, message: finding.message })));
  }
  const plan: EnginePlanInput = adapted.plan;

  // The engine, once, for the Data Date.
  const calculation = calculatePlanPerformance(plan);
  if (calculation.status === "blocked") return refused(...engineProblems(calculation.issues));
  const performance = calculation.performance;

  const tree = buildWorkingPlanTree(workItems, activities);
  const elementById = new Map(flattenWorkingPlan(tree).map((element) => [element.id, element]));
  const activityById = new Map(activities.map((activity) => [activity.id, activity]));

  const nodes: PublishPayloadNode[] = [];
  const payloadActivities: PublishPayloadActivity[] = [];
  performance.elements.forEach((result, position) => {
    const element = elementById.get(result.id);
    if (!element) return;
    if (result.kind === "node") {
      const spi = figureParts(result.spi);
      nodes.push({
        work_item_id: result.id,
        parent_id: result.parentId,
        item_position: position,
        depth: result.depth,
        is_control_account: result.isControlAccount,
        local_weight: result.localWeight,
        effective_weight: result.effectiveWeight,
        pv: result.pv,
        ev: result.ev,
        sv: result.sv,
        spi: spi.value,
        spi_reason: spi.reason,
        pv_contribution: result.pvContribution,
        ev_contribution: result.evContribution,
        ...mappingOf(element),
      });
      return;
    }
    const activity = activityById.get(result.id)!;
    const blnEntry = blnById.get(activity.id);
    const bl0Entry = bl0ById.get(activity.id);
    payloadActivities.push({
      activity_id: activity.id,
      work_item_id: activity.workItemId ?? null,
      item_position: position,
      earning_method: result.earningMethod as PlanningEarningMethod,
      // The STORED values the engine read — the writer compares them to the Working Plan.
      local_weight: activity.localWeightPercent ?? null,
      effective_weight: result.effectiveWeight,
      pv: result.pv,
      ev: result.ev,
      sv: result.sv,
      pv_contribution: result.pvContribution,
      ev_contribution: result.evContribution,
      percent_complete: activity.percentCompletePhysical ?? null,
      forecast_start: activity.plannedStartDate ?? null,
      forecast_finish: activity.plannedFinishDate ?? null,
      actual_start: activity.actualStartDate ?? null,
      actual_finish: activity.actualFinishDate ?? null,
      bln_start: blnEntry?.start ?? null,
      bln_finish: blnEntry?.finish ?? null,
      bl0_start: bl0Entry?.start ?? null,
      bl0_finish: bl0Entry?.finish ?? null,
      ...mappingOf(element),
    });
  });

  // True milestones: schedule state against BLn and BL0, never blended.
  const milestones: PublishPayloadMilestone[] = planMilestones(plan).map((milestone) => {
    const activity = activityById.get(milestone.id)!;
    const vsBln = figureParts(milestone.schedule.slipVsCurrentBaseline);
    const vsBl0 = figureParts(milestone.schedule.slipVsOriginalBaseline);
    return {
      activity_id: milestone.id,
      is_key: milestone.isKey,
      bl0_date: bl0ById.get(milestone.id)?.finish ?? null,
      bln_date: blnById.get(milestone.id)?.finish ?? null,
      forecast_date: activity.plannedFinishDate ?? activity.plannedStartDate ?? null,
      actual_date: activity.actualFinishDate ?? activity.actualStartDate ?? null,
      status: milestone.schedule.status,
      slip_vs_bln: vsBln.value,
      slip_vs_bln_reason: vsBln.reason,
      slip_vs_bl0: vsBl0.value,
      slip_vs_bl0_reason: vsBl0.reason,
      due: milestone.schedule.due,
    };
  });

  // Schedule-condition inputs (§26.25 D-C): forecast finish vs BLn finish, and BL0 finish.
  const finish = finishDates(plan.children, dataDate);
  const bl0Finish =
    activities
      .map((activity) => bl0ById.get(activity.id)?.finish ?? null)
      .filter((date): date is string => isIsoDate(date))
      .sort()
      .at(-1) ?? null;

  const forecast = forecastCurve(plan, { reportingDay: pre.reportingDay });
  const projectSpi = figureParts(performance.project.spi);

  const payload: PublishPayloadV2 = {
    fingerprint: bundle.fingerprint!,
    data_date: dataDate,
    source_import_batch_id: request.sourceImportBatchId ?? null,
    label: request.label?.trim() || null,
    engine_version: performance.engineVersion,
    bl0_baseline_id: bl0.id,
    bln_baseline_id: bln.id,
    project: {
      pv: performance.project.pv,
      ev: performance.project.ev,
      sv: performance.project.sv,
      spi: projectSpi.value,
      spi_reason: projectSpi.reason,
    },
    // C3: the engine refuses a partial plan, so a calculated plan covers it all.
    coverage_percent: 100,
    cross_check_max_difference: performance.crossCheck.maxDifference,
    advisories: performance.advisories.map((issue) => ({
      code: issue.code,
      element: issue.elementName,
      message: issue.message,
    })),
    finish: { bl0_finish: bl0Finish, bln_finish: finish.baselineFinish, forecast_finish: finish.forecastFinish },
    nodes,
    activities: payloadActivities,
    milestones,
    forecast_curve: forecast.status === "calculated" ? forecast.points.map((point) => ({ ...point })) : [],
    forecast_curve_reason: forecast.status === "not_available" ? forecast.reason : null,
  };

  return {
    status: "ready",
    payload,
    summary: {
      dataDate,
      engineVersion: performance.engineVersion,
      bl0Number: bl0.revision_number,
      blnNumber: bln.revision_number,
      pv: performance.project.pv,
      ev: performance.project.ev,
      sv: performance.project.sv,
      spi: projectSpi.value,
      nodeCount: nodes.length,
      activityCount: payloadActivities.length,
      milestoneCount: milestones.length,
      advisoryCount: payload.advisories.length,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Baseline Revision request                                                  */
/* -------------------------------------------------------------------------- */

export type BaselineRequestResult =
  | {
      status: "ready";
      fingerprint: string;
      curve: { date: string; value: number }[];
      engineVersion: string;
      kind: "original" | "rebaseline";
    }
  | { status: "refused"; problems: PublishProblem[] };

/**
 * The baseline curve of the revision the database is about to capture: the
 * same Working Plan with each activity's current dates as its baseline (what
 * `request_planning_baseline()` copies), calculated by the engine.
 */
export function buildBaselineRequest(bundle: PublishInputsBundle, today: string): BaselineRequestResult {
  const pre = commonPreconditions(bundle);
  if (!pre.ok) return { status: "refused", problems: pre.problems };
  if (bundle.activities.length === 0) {
    return { status: "refused", problems: [{ code: "BASELINE_EMPTY", message: "There are no activities to baseline yet." }] };
  }

  const settings = mapSettings(bundle.settings!);
  const workItems = bundle.work_items.map(mapWorkItem);
  const activities = bundle.activities.map(mapActivity);

  // Exactly the dates the database captures: a milestone is one date.
  const captured = (activity: PlanningActivity): DateWindow =>
    activity.isMilestone
      ? {
          start: activity.plannedFinishDate ?? activity.plannedStartDate ?? null,
          finish: activity.plannedFinishDate ?? activity.plannedStartDate ?? null,
        }
      : { start: activity.plannedStartDate ?? null, finish: activity.plannedFinishDate ?? null };

  const adapted = toEnginePlanInput(workItems, activities, {
    projectId: bundle.project!.id,
    dataDate: isIsoDate(today) ? today : "1970-01-01",
    workingWeek: pre.workingWeek,
    projectDefaultEarningMethod: settings.defaultEarningMethod,
    baselineFor: captured,
  });
  if (adapted.status === "blocked") {
    return {
      status: "refused",
      problems: adapted.findings
        .filter((finding) => finding.severity === "blocking")
        .map((finding) => ({ code: finding.code, message: finding.message })),
    };
  }

  const curve = baselineCurve(adapted.plan, { baseline: "current", reportingDay: pre.reportingDay });
  if (curve.status === "blocked") return { status: "refused", problems: engineProblems(curve.issues) };
  if (curve.status === "not_available") {
    const names = curve.activityIds.map((id) => {
      const activity = activities.find((candidate) => candidate.id === id);
      return activity ? activityLabel(activity) : id;
    });
    return {
      status: "refused",
      problems: [{
        code: "BASELINE_DATES_MISSING",
        message: `Every activity needs its start and finish dates before it can be baselined: ${listOf(names)}.`,
      }],
    };
  }

  return {
    status: "ready",
    fingerprint: bundle.fingerprint!,
    curve: curve.points.map((point) => ({ ...point })),
    engineVersion: PLANNING_ENGINE_VERSION,
    kind: bundle.baselines.some((baseline) => baseline.revision_number === 0) ? "rebaseline" : "original",
  };
}

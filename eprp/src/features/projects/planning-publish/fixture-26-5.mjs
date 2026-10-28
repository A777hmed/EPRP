/**
 * Phase 13.12 — the `docs/02` §26.5 worked example as REAL Working Plan rows
 * (snake_case, exactly as `planning_publish_inputs()` returns them), with
 * fixed UUIDs, for the publish path. Test-only.
 *
 * Built from the 13.10 engine acceptance fixture, in the three stages a real
 * project goes through:
 *   - "bl0":     each activity's current dates are the ORIGINAL plan
 *                (VDU-M10 due 1 Dec) — requested and approved as BL0;
 *   - "bl1":     re-planned (VDU-M10 due 15 Dec) — approved as BL1 = BLn;
 *   - "current": the forecast and actuals at the Data Date (31 Oct 2026).
 * Every other activity keeps the same baseline window in BL0 and BL1, so PV
 * (against BLn) is exactly §26.5, and VDU-M10 reads +14 days vs BLn, +28 vs BL0.
 *
 * Shared by `publish-plan.test.mjs` and the generator of the runtime SQL
 * suite 133, so both prove the same data.
 */

import { DATA_DATE, worked265 } from "../../../lib/planning-engine/fixtures.mjs";

export { DATA_DATE };
export const WORKING_WEEK_LABEL = "Sun – Thu";
export const REPORTING_DAY = "thursday";
export const STAMP = "2026-10-20T08:00:00+00:00";

const KEYS = [];
/** A fixed UUID per fixture key (stable across runs and across JS / SQL). */
export function uuidFor(key) {
  let index = KEYS.indexOf(key);
  if (index < 0) {
    KEYS.push(key);
    index = KEYS.length - 1;
  }
  return `00000000-0000-4000-d265-${String(index + 1).padStart(12, "0")}`;
}

// Register every key once, in plan order, so the numbering never depends on call order.
(function register(children) {
  for (const child of children) {
    uuidFor(child.id);
    if (child.kind === "node") register(child.children);
  }
})(worked265().children);
for (const key of ["project", "bl0", "bl1"]) uuidFor(key);

const NODE_CODES = { rbi: "RBI", vdu: "VDU", cdu: "CDU", utl: "UTL", hazop: "HAZOP", sil: "SIL" };
const ACTIVITY_CODES = { "hazop-a10": "HAZOP-A10", "sil-a10": "SIL-A10" };

function datesFor(activity, stage) {
  if (activity.earningMethod === "milestone") {
    const date =
      stage === "bl0" ? activity.originalBaseline.finish
        : stage === "bl1" ? activity.baseline.finish
          : activity.forecast?.finish ?? null;
    return { start: stage === "current" ? null : date, finish: date };
  }
  if (stage === "current") {
    return { start: activity.forecast?.start ?? null, finish: activity.forecast?.finish ?? null };
  }
  return { start: activity.baseline.start, finish: activity.baseline.finish };
}

/**
 * The Working Plan rows at one stage. `mapping` optionally sets a reporting
 * unit on a node (PSM: { department_id, system_id? }, Other: { structure_node_id }).
 */
export function fixtureRows(stage, { projectId = uuidFor("project"), mapping = {} } = {}) {
  const workItems = [];
  const activities = [];
  let order = 0;
  const walk = (children, parent) => {
    for (const child of children) {
      if (child.kind === "node") {
        workItems.push({
          id: uuidFor(child.id),
          project_id: projectId,
          parent_work_item_id: parent ? uuidFor(parent) : null,
          origin_import_row_id: null,
          department_id: mapping[child.id]?.department_id ?? null,
          system_id: mapping[child.id]?.system_id ?? null,
          discipline_id: null,
          master_deliverable_id: null,
          code: NODE_CODES[child.id],
          name: child.name,
          item_type: "engineering",
          level: parent ? 2 : 1,
          sort_order: order++,
          is_milestone: false,
          weight_percent: null,
          local_weight_percent: child.localWeight,
          is_control_account: child.isControlAccount === true,
          earning_method: null,
          structure_node_id: mapping[child.id]?.structure_node_id ?? null,
          planned_start_date: null,
          planned_finish_date: null,
          baseline_start_date: null,
          baseline_finish_date: null,
          planned_duration_days: null,
          source: "manual",
          active: true,
          archived_at: null,
          created_at: STAMP,
          updated_at: STAMP,
        });
        walk(child.children, child.id);
        continue;
      }
      const dates = datesFor(child, stage);
      const current = stage === "current";
      activities.push({
        id: uuidFor(child.id),
        project_id: projectId,
        work_item_id: parent ? uuidFor(parent) : null,
        origin_import_row_id: null,
        external_id: null,
        code: child.code ?? ACTIVITY_CODES[child.id] ?? null,
        name: child.name,
        is_milestone: child.earningMethod === "milestone",
        local_weight_percent: child.localWeight,
        earning_method: child.earningMethod,
        department_id: null,
        system_id: null,
        discipline_id: null,
        structure_node_id: null,
        planned_start_date: dates.start,
        planned_finish_date: dates.finish,
        baseline_start_date: null,
        baseline_finish_date: null,
        actual_start_date: current ? child.actual?.start ?? null : null,
        actual_finish_date: current ? child.actual?.finish ?? null : null,
        planned_duration_days: null,
        remaining_duration_days: null,
        percent_complete_planned: null,
        percent_complete_actual: null,
        percent_complete_physical: current ? child.percentComplete ?? null : null,
        weight_percent: null,
        status: null,
        planned_value: null,
        earned_value: null,
        source: "manual",
        active: true,
        archived_at: null,
        created_at: STAMP,
        updated_at: STAMP,
      });
    }
  };
  walk(worked265().children, null);
  return { workItems, activities };
}

/** Exactly the capture `request_planning_baseline()` builds from these rows. */
export function captureOf({ workItems, activities }) {
  return {
    nodes: workItems.map((w) => ({
      id: w.id, parent_id: w.parent_work_item_id, code: w.code, name: w.name,
      local_weight: w.local_weight_percent, is_control_account: w.is_control_account,
    })),
    activities: activities.map((a) => ({
      id: a.id, work_item_id: a.work_item_id, code: a.code, external_id: a.external_id, name: a.name,
      is_milestone: a.is_milestone, local_weight: a.local_weight_percent,
      start: a.is_milestone ? a.planned_finish_date ?? a.planned_start_date : a.planned_start_date,
      finish: a.planned_finish_date ?? a.planned_start_date,
    })),
  };
}

export function bundleOf(rows, { baselines = [], onboardingMode = "new_project", fingerprint = "fp-26-5", projectId = uuidFor("project"), family = "psm" } = {}) {
  return {
    fingerprint,
    project: {
      id: projectId, code: "ZZ-1312-265", structure_family: family,
      working_week: WORKING_WEEK_LABEL, weekly_reporting_day: REPORTING_DAY, status: "active",
    },
    settings: {
      project_id: projectId, onboarding_mode: onboardingMode, default_import_source: null, planning_enabled: true,
      level_labels: ["Control Account", "Unit"], control_account_level: 1, weight_source: "eprp",
      default_earning_method: "percent_complete", created_at: STAMP, updated_at: STAMP,
    },
    work_items: rows.workItems,
    activities: rows.activities,
    baselines,
    controlled_since: baselines.length ? STAMP : null,
  };
}

/** The two approved revisions of the example: BL0 (original) and BL1 (BLn). */
export function approvedBaselines() {
  return [
    { id: uuidFor("bl0"), revision_number: 0, revision_kind: "original", decided_at: STAMP, capture: captureOf(fixtureRows("bl0")) },
    { id: uuidFor("bl1"), revision_number: 1, revision_kind: "rebaseline", decided_at: STAMP, capture: captureOf(fixtureRows("bl1")) },
  ];
}

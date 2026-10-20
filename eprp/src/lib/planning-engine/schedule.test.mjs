import assert from "node:assert/strict";
import test from "node:test";

import {
  calculatePlanPerformance,
  deriveMilestoneSchedule,
  figure,
  finishDates,
  planMilestones,
  PROPOSED_SCHEDULE_CONDITION_THRESHOLDS,
  scheduleCondition,
} from "./index.ts";
import { DATA_DATE, findInput, worked265 } from "./fixtures.mjs";

/* Phase 13.10 — milestone schedule state (`docs/02` §26.5, §26.6 rule 1) and
   the schedule-condition function with thresholds passed in (§26.7 rule 4). */

const THRESHOLDS = PROPOSED_SCHEDULE_CONDITION_THRESHOLDS;

/* ------------------------------- Milestones ------------------------------ */

test("§26.5 milestone: BL0 1 Dec, BLn 15 Dec, forecast 29 Dec → +14 vs BLn and +28 vs BL0, never blended", () => {
  const [milestone] = planMilestones(worked265());
  assert.equal(milestone.id, "vdu-m10");
  assert.equal(milestone.isKey, true);
  assert.deepEqual(milestone.schedule.slipVsCurrentBaseline, { state: "value", value: 14 });
  assert.deepEqual(milestone.schedule.slipVsOriginalBaseline, { state: "value", value: 28 });
  assert.equal(milestone.schedule.status, "upcoming");
  assert.equal(milestone.schedule.referenceDate, "2026-12-29");
  assert.equal(milestone.schedule.due, false);
});

test("milestone: achieved measures slip from the actual date; early is negative", () => {
  const schedule = deriveMilestoneSchedule({
    originalBaselineDate: "2026-10-20",
    baselineDate: "2026-10-25",
    forecastDate: "2026-10-30",
    actualDate: "2026-10-22",
    dataDate: DATA_DATE,
  });
  assert.equal(schedule.status, "achieved");
  assert.deepEqual(schedule.slipVsCurrentBaseline, { state: "value", value: -3 });
  assert.deepEqual(schedule.slipVsOriginalBaseline, { state: "value", value: 2 });
  assert.equal(schedule.due, true);
});

test("milestone: not achieved past its BLn date is overdue", () => {
  const schedule = deriveMilestoneSchedule({ baselineDate: "2026-10-25", forecastDate: "2026-11-05", dataDate: DATA_DATE });
  assert.equal(schedule.status, "overdue");
  assert.deepEqual(schedule.slipVsCurrentBaseline, { state: "value", value: 11 });
});

test("milestone: a missing baseline or forecast is a semantic absence, never 0 days", () => {
  const noBl0 = deriveMilestoneSchedule({ baselineDate: "2026-12-15", forecastDate: "2026-12-29", dataDate: DATA_DATE });
  assert.deepEqual(noBl0.slipVsOriginalBaseline, { state: "not_available", reason: "baseline_missing" });
  const noForecast = deriveMilestoneSchedule({ baselineDate: "2026-12-15", dataDate: DATA_DATE });
  assert.deepEqual(noForecast.slipVsCurrentBaseline, { state: "not_available", reason: "forecast_missing" });
  const nothing = deriveMilestoneSchedule({ dataDate: DATA_DATE });
  assert.equal(nothing.status, "unscheduled");
});

test("milestone: an actual date after the Data Date is not yet achieved", () => {
  const schedule = deriveMilestoneSchedule({ baselineDate: "2026-12-15", actualDate: "2026-11-02", forecastDate: "2026-11-02", dataDate: DATA_DATE });
  assert.equal(schedule.status, "upcoming");
});

/* ------------------------------ Finish dates ----------------------------- */

test("finish dates: BLn finish and forecast finish over the whole project", () => {
  const plan = worked265();
  const dates = finishDates(plan.children, plan.dataDate);
  assert.equal(dates.baselineFinish, "2026-12-15");
  assert.equal(dates.forecastFinish, "2026-12-29");
});

test("finish dates: one incomplete activity without a forecast makes the forecast finish unknown, not guessed", () => {
  const plan = worked265();
  delete findInput(plan, "sil-a10").forecast;
  assert.equal(finishDates(plan.children, plan.dataDate).forecastFinish, null);
});

/* --------------------------- Schedule condition -------------------------- */

const governed = (overrides) => ({
  hasPublishedSnapshot: true,
  pv: 50,
  spi: figure.value(1),
  keyMilestones: [],
  baselineFinish: "2026-12-15",
  forecastFinish: "2026-12-15",
  ...overrides,
});

test("schedule condition: On Track when SPI ≥ threshold, no key milestone late, finish on BLn", () => {
  assert.equal(scheduleCondition(governed({}), THRESHOLDS).condition, "on_track");
});

test("schedule condition: SPI bands are the thresholds passed in", () => {
  assert.equal(scheduleCondition(governed({ spi: figure.value(0.93) }), THRESHOLDS).condition, "at_risk");
  assert.equal(scheduleCondition(governed({ spi: figure.value(0.85) }), THRESHOLDS).condition, "behind");
  const strict = { onTrackMinSpi: 1.0, atRiskMinSpi: 0.97, keyMilestoneAtRiskDays: 7 };
  assert.equal(scheduleCondition(governed({ spi: figure.value(0.98) }), strict).condition, "at_risk");
});

test("schedule condition: key milestone slip up to the threshold is At Risk, beyond it Behind", () => {
  const slip = (days) => ({ slipVsCurrentBaseline: figure.value(days), due: false });
  assert.equal(scheduleCondition(governed({ keyMilestones: [slip(14)] }), THRESHOLDS).condition, "at_risk");
  assert.equal(scheduleCondition(governed({ keyMilestones: [slip(15)] }), THRESHOLDS).condition, "behind");
  assert.equal(scheduleCondition(governed({ keyMilestones: [slip(-3)] }), THRESHOLDS).condition, "on_track");
});

test("schedule condition: forecast finish later than BLn finish is Behind", () => {
  const result = scheduleCondition(governed({ forecastFinish: "2026-12-29" }), THRESHOLDS);
  assert.equal(result.condition, "behind");
  assert.match(result.reasons[0], /14 days later than the BLn finish/);
});

test("schedule condition: Unknown with no published snapshot, or PV = 0 with no key milestone due", () => {
  assert.equal(scheduleCondition(governed({ hasPublishedSnapshot: false }), THRESHOLDS).condition, "unknown");
  assert.equal(
    scheduleCondition(governed({ pv: 0, spi: figure.notApplicable("pv_zero") }), THRESHOLDS).condition,
    "unknown"
  );
  // PV = 0 but a key milestone is due: judged on the milestone alone.
  const due = { slipVsCurrentBaseline: figure.value(20), due: true };
  assert.equal(
    scheduleCondition(governed({ pv: 0, spi: figure.notApplicable("pv_zero"), keyMilestones: [due] }), THRESHOLDS).condition,
    "behind"
  );
});

test("schedule condition: a reading the data cannot support is 'not evaluated', never a pass or fail", () => {
  const result = scheduleCondition(
    governed({ forecastFinish: null, keyMilestones: [{ slipVsCurrentBaseline: figure.notAvailable("forecast_missing"), due: false }] }),
    THRESHOLDS
  );
  assert.equal(result.condition, "on_track");
  assert.deepEqual(result.evaluated, { spi: true, keyMilestones: false, forecastFinish: false });
});

test("schedule condition on §26.5: SPI 0.95 passes, but the key milestone +14 and the late finish read Behind", () => {
  const plan = worked265();
  const { performance } = calculatePlanPerformance(plan);
  const milestones = planMilestones(plan).filter((milestone) => milestone.isKey).map((milestone) => milestone.schedule);
  const dates = finishDates(plan.children, plan.dataDate);
  const result = scheduleCondition(
    {
      hasPublishedSnapshot: true,
      pv: performance.project.pv,
      spi: performance.project.spi,
      keyMilestones: milestones,
      ...dates,
    },
    THRESHOLDS
  );
  assert.equal(result.condition, "behind");
  assert.equal(result.reasons.length, 2);
});

test("B4 is open: the proposed thresholds are frozen defaults, not read implicitly", () => {
  assert.ok(Object.isFrozen(PROPOSED_SCHEDULE_CONDITION_THRESHOLDS));
  assert.deepEqual({ ...PROPOSED_SCHEDULE_CONDITION_THRESHOLDS }, { onTrackMinSpi: 0.95, atRiskMinSpi: 0.9, keyMilestoneAtRiskDays: 14 });
  assert.equal(scheduleCondition.length, 2, "thresholds are a required argument");
});

/**
 * Planning Engine core (Phase 13.10) — public surface. Pure: nothing here
 * reads or writes storage. See `types.ts` for units and `02` §26.4–§26.7 for
 * the rules each function implements.
 */
export * from "./types";
export { dayNumber, isIsoDate, parseWorkingWeek, weeklyGrid, WorkingCalendar, calendarDaysBetween } from "./calendar";
export { earnedPercentAt, plannedPercentAt } from "./earning";
export {
  applyNormalisation,
  blockingIssues,
  proposeNormalisation,
  validatePlan,
  WEIGHT_TOLERANCE,
  type NormalisationDecision,
  type NormalisationMode,
  type NormalisationProposal,
} from "./validation";
export { calculatePlanPerformance, effectiveWeights, PLANNING_ENGINE_VERSION, spiFigure } from "./engine";
export {
  baselineCurve,
  earnedCurve,
  forecastCurve,
  type CurvePoint,
  type CurveResult,
  type EarnedPoint,
  type EarnedPointInput,
} from "./curves";
export {
  deriveMilestoneSchedule,
  finishDates,
  planMilestones,
  PROPOSED_SCHEDULE_CONDITION_THRESHOLDS,
  SCHEDULE_CONDITION_LABEL,
  scheduleCondition,
  type MilestoneSchedule,
  type MilestoneScheduleInput,
  type MilestoneScheduleStatus,
  type PlanMilestone,
  type ScheduleCondition,
  type ScheduleConditionInput,
  type ScheduleConditionResult,
  type ScheduleConditionThresholds,
} from "./schedule";
export { PLANNING_FACTS, type PlanningFactClass, type PlanningFactDefinition, type PlanningFactKey } from "./provenance";

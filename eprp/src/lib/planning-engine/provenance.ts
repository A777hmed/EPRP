/**
 * Where every planning fact comes from (`02` §26.2 F2–F4, §26.4 W4, §26.21).
 *
 *   source      — arrives from a schedule (Schedule Version / import) and
 *                 enters the Working Plan only as an accepted, logged difference;
 *   controlled  — entered or confirmed by Project Control in the Working Plan
 *                 (a governed act, logged with actor and time);
 *   calculated  — produced by the Planning Engine; never entered, never typed
 *                 into Project Setup, the project record or a report;
 *   narrative   — what people add in reports; never a planning fact and never
 *                 able to change one (§26.21, conformance 14).
 *
 * A field may be `source` or `controlled` depending on how the plan was
 * built (import vs. Project Control entry); both are governed inputs.
 */
export type PlanningFactClass = "source" | "controlled" | "calculated" | "narrative";

export interface PlanningFactDefinition {
  label: string;
  classes: readonly PlanningFactClass[];
  note: string;
}

export const PLANNING_FACTS = {
  dataDate: {
    label: "Data Date",
    classes: ["source", "controlled"],
    note: "The snapshot's cut-off; from the Schedule Version or Project Control. Never the publish time.",
  },
  localWeight: {
    label: "Local weight",
    classes: ["source", "controlled"],
    note: "The only weight a user enters. Imported weights are proposals (W7); normalisation is explicit (W3).",
  },
  earningMethod: {
    label: "Earning method",
    classes: ["controlled"],
    note: "Percent Complete, 0/100, 50/50 or Milestone.",
  },
  baselineDates: {
    label: "BL0 / BLn dates",
    classes: ["controlled"],
    note: "Created only by an approved baseline; no import re-baselines.",
  },
  forecastDates: {
    label: "Forecast dates",
    classes: ["source", "controlled"],
    note: "The current schedule: latest accepted Schedule Version plus logged Project Control edits.",
  },
  actualDates: {
    label: "Actual dates",
    classes: ["source", "controlled"],
    note: "On or before the Data Date.",
  },
  percentComplete: {
    label: "Confirmed % complete",
    classes: ["source", "controlled"],
    note: "Percent Complete activities only; required once started (C2).",
  },
  effectiveWeight: {
    label: "Effective project contribution",
    classes: ["calculated"],
    note: "Product of local weights on the path (W4).",
  },
  plannedValue: { label: "Planned (PV)", classes: ["calculated"], note: "Against BLn, by earning method." },
  earnedValue: { label: "Earned (EV)", classes: ["calculated"], note: "At the Data Date, by earning method." },
  variance: { label: "Variance (SV)", classes: ["calculated"], note: "EV − PV, points." },
  spi: { label: "SPI", classes: ["calculated"], note: "EV ÷ PV only; N/A when PV = 0 or not planning governed." },
  milestoneSlip: {
    label: "Milestone slip",
    classes: ["calculated"],
    note: "Against BLn and against BL0, never blended.",
  },
  scheduleCondition: {
    label: "Schedule condition",
    classes: ["calculated"],
    note: "One function for every surface; thresholds are an open decision (B4).",
  },
  reportedProgress: {
    label: "Reported progress",
    classes: ["controlled"],
    note: "No-formal-schedule projects only, from the append-only Reported Progress stream. Not planning governed.",
  },
  reportComment: {
    label: "Report comments",
    classes: ["narrative"],
    note: "Confirmation, explanation, constraint, action. Never changes a planning fact or a snapshot.",
  },
} as const satisfies Record<string, PlanningFactDefinition>;

export type PlanningFactKey = keyof typeof PLANNING_FACTS;

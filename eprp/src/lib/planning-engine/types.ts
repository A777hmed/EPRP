import type { Weekday } from "@/types/core";

/**
 * Planning Engine core — contracts (Phase 13.10, `docs/02` §26.4–§26.7).
 *
 * The engine is a PURE module: no storage, no Supabase, no React. It turns a
 * Working Plan shape (planning nodes, activities, local weights, BLn / BL0 /
 * forecast / actual dates, confirmed progress) and a Data Date into the
 * figures a Published Planning Snapshot freezes: effective weights, PV, EV,
 * SV, SPI, curves and schedule condition. 13.12 calls it at publish time and
 * freezes the result; no consumer ever calls it to recompute a published
 * figure (`02` §26.2 rule F3).
 *
 * Units, throughout:
 *   - weights are PERCENT (local weight 40 = 40% of the parent);
 *   - PV / EV are PERCENT complete of the element they belong to (0–100);
 *   - SV is percentage POINTS (EV − PV);
 *   - a "contribution" is points of the whole PROJECT (EW% × PV% / 100).
 *
 * Nothing is rounded here. Rounding is presentation, never calculation.
 */

/** Calendar date, `yyyy-mm-dd`. Never a timestamp. */
export type IsoDate = string;

export type { Weekday };

/**
 * How an activity earns progress (`02` §26.4, initial set). The PV
 * distribution of each discrete method follows its earning points — owner
 * decision B7, closed 2026-10-20.
 */
export type EarningMethod = "percent_complete" | "zero_hundred" | "fifty_fifty" | "milestone";

export const EARNING_METHODS: readonly EarningMethod[] = [
  "percent_complete",
  "zero_hundred",
  "fifty_fifty",
  "milestone",
];

export const EARNING_METHOD_LABEL: Record<EarningMethod, string> = {
  percent_complete: "Percent Complete",
  zero_hundred: "0/100",
  fifty_fifty: "50/50",
  milestone: "Milestone",
};

/** A start / finish pair. A true milestone uses `finish` (start = finish). */
export interface DateWindow {
  start?: IsoDate | null;
  finish?: IsoDate | null;
}

/**
 * A leaf of the planning hierarchy that carries work (`02` §26.3).
 *
 * `localWeight` is the ONLY weight a user enters (W4). `null` / `undefined`
 * means "not entered" — it is never read as 0 (W2).
 */
export interface EngineActivityInput {
  kind: "activity";
  id: string;
  code?: string | null;
  name: string;
  localWeight: number | null | undefined;
  earningMethod: EarningMethod;
  /** Current approved baseline (BLn). PV and SPI are measured against it. */
  baseline: DateWindow;
  /** Original baseline (BL0). Slip only — never PV or SPI (`02` §26.6 rule 1). */
  originalBaseline?: DateWindow | null;
  /** The current schedule for incomplete work (Schedule Version + logged edits). */
  forecast?: DateWindow | null;
  actual?: DateWindow | null;
  /**
   * The CONFIRMED physical % complete (0–100). Read only by Percent Complete;
   * the discrete methods earn from actual dates.
   */
  percentComplete?: number | null;
  /** Key milestone flag — feeds the schedule condition (`02` §26.7 rule 4). */
  isKeyMilestone?: boolean;
}

/** A planning node: WBS element, Control Account or Work Package. */
export interface EngineNodeInput {
  kind: "node";
  id: string;
  code?: string | null;
  name: string;
  localWeight: number | null | undefined;
  isControlAccount?: boolean;
  children: readonly EngineElementInput[];
}

export type EngineElementInput = EngineNodeInput | EngineActivityInput;

/**
 * One project's plan as the engine reads it. The project itself is the
 * implicit root (100%); `children` share it (W1).
 *
 * Project-type agnostic on purpose: a PSM project and an Other Project hand
 * the engine the same shape (`02` §26.3 — only the reporting-unit mapping
 * differs, and that never changes the hierarchy or its weights, H6).
 */
export interface EnginePlanInput {
  projectId: string;
  dataDate: IsoDate;
  /** The project's configured working week (`02` §26.4). */
  workingWeek: readonly Weekday[];
  children: readonly EngineElementInput[];
}

/* -------------------------- Semantic figures ----------------------------- */

/**
 * Why a figure has no value. Absence is never a fake 0 and never a raw
 * `null` on a consumer surface (`02` §26.4 C4, §26.7 rule 3).
 */
export type FigureAbsenceReason =
  /** SPI with PV = 0 — the ratio is undefined. */
  | "pv_zero"
  /** The project is "Reported — not planning governed" (`02` §26.14). */
  | "not_planning_governed"
  /** No Published Planning Snapshot exists (C4: "No published plan"). */
  | "no_published_plan"
  /** An Opening Position declares a position; it has no PV/EV model, so SPI is N/A. */
  | "declared_position"
  /** The source simply did not state this figure. */
  | "not_declared"
  /** A legacy snapshot carried no planned/earned value data, so it has no SPI. */
  | "no_value_data"
  /** The baseline needed for this figure is missing. */
  | "baseline_missing"
  /** The forecast needed for this figure is missing. */
  | "forecast_missing";

export type PlanningFigure =
  | { state: "value"; value: number }
  /** The concept does not apply here — shown as "N/A". */
  | { state: "not_applicable"; reason: FigureAbsenceReason }
  /** The concept applies but the data does not exist — shown as "Not available". */
  | { state: "not_available"; reason: FigureAbsenceReason };

export const figure = {
  value(value: number): PlanningFigure {
    return { state: "value", value };
  },
  notApplicable(reason: FigureAbsenceReason): PlanningFigure {
    return { state: "not_applicable", reason };
  },
  notAvailable(reason: FigureAbsenceReason): PlanningFigure {
    return { state: "not_available", reason };
  },
};

/** The number behind a figure, or `null`. For arithmetic, never for display. */
export function figureValue(value: PlanningFigure): number | null {
  return value.state === "value" ? value.value : null;
}

/* ---------------------------- Validation --------------------------------- */

/**
 * Publish-blocking and advisory findings (`02` §26.4 W1–W3, C1–C2; §26.6
 * rule 3). `blocking` findings stop a calculation — the engine never produces
 * a partial figure that silently drops or zeroes work.
 */
export type ValidationCode =
  /** W1 — a parent's children do not total 100% ±0.01. */
  | "W1_CHILD_TOTAL"
  /** W2 — a child has no weight entered. */
  | "W2_MISSING_WEIGHT"
  /** A weight is negative, over 100 or not a number. */
  | "WEIGHT_INVALID"
  /** A node has no children, so it has nothing to earn with. */
  | "EMPTY_NODE"
  /** C2 — Percent Complete activity started with no confirmed % complete. */
  | "C2_UNMEASURED_START"
  /** A confirmed % complete outside 0–100. */
  | "PERCENT_INVALID"
  /** A date that is present but not a real `yyyy-mm-dd` calendar date. */
  | "DATE_INVALID"
  /** BLn dates needed for PV are missing or reversed. */
  | "BASELINE_DATES_INVALID"
  /** H4 — a true milestone with start ≠ finish. */
  | "MILESTONE_NOT_ZERO_DURATION"
  /** §26.6 rule 3 — an actual date after the Data Date. */
  | "ACTUAL_AFTER_DATA_DATE"
  /** §26.6 rule 3 — a forecast before the Data Date for incomplete work. */
  | "FORECAST_BEFORE_DATA_DATE"
  /** Two elements share an id. */
  | "DUPLICATE_ID"
  /** The Data Date or working week is missing / invalid. */
  | "PLAN_INVALID"
  /** Advisory: progress recorded without an actual start (C1 earns it 0). */
  | "PROGRESS_WITHOUT_START"
  /** Advisory: actual finish recorded but confirmed % complete below 100. */
  | "FINISHED_BELOW_100";

export interface ValidationIssue {
  code: ValidationCode;
  severity: "blocking" | "advisory";
  /** The element the finding is about (`null` for the plan / project root). */
  elementId: string | null;
  elementName: string;
  message: string;
}

/* ------------------------------ Results ---------------------------------- */

export interface ElementPerformance {
  id: string;
  kind: "node" | "activity";
  code: string | null;
  name: string;
  /** `null` for a top-level element (its parent is the project). */
  parentId: string | null;
  /** 1 for a child of the project. */
  depth: number;
  localWeight: number;
  /** Calculated, never entered (W4). Percent of the whole project. */
  effectiveWeight: number;
  /** % complete of this element, against BLn. */
  pv: number;
  /** % complete earned at the Data Date. */
  ev: number;
  /** EV − PV, points. */
  sv: number;
  /** EV ÷ PV; N/A when PV = 0. */
  spi: PlanningFigure;
  /** Points of the project's PV / EV this element carries. */
  pvContribution: number;
  evContribution: number;
  isControlAccount: boolean;
  earningMethod: EarningMethod | null;
}

export interface ProjectPerformance {
  pv: number;
  ev: number;
  sv: number;
  spi: PlanningFigure;
}

/**
 * The two calculation paths of `02` §26.5 ("two calculation paths, one
 * answer"): level-by-level roll-up and Σ effective weight × activity figure.
 */
export interface CalculationCrossCheck {
  levelByLevel: { pv: number; ev: number };
  effectiveWeights: { pv: number; ev: number };
  /** Largest absolute difference observed (points). */
  maxDifference: number;
}

export interface PlanPerformance {
  engineVersion: string;
  projectId: string;
  dataDate: IsoDate;
  project: ProjectPerformance;
  /** Pre-order (parent before children), in input order. */
  elements: ElementPerformance[];
  crossCheck: CalculationCrossCheck;
  advisories: ValidationIssue[];
}

export type PlanCalculation =
  | { status: "calculated"; performance: PlanPerformance }
  | { status: "blocked"; issues: ValidationIssue[] };

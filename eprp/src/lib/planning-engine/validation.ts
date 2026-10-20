import { dayNumber, WorkingCalendar } from "./calendar";
import type {
  DateWindow,
  EngineActivityInput,
  EngineElementInput,
  EngineNodeInput,
  EnginePlanInput,
  ValidationCode,
  ValidationIssue,
} from "./types";

/**
 * Weight and completeness validation (`02` §26.4 W1–W3, C1–C2) plus Data
 * Date integrity (§26.6 rule 3). The engine refuses to calculate while any
 * blocking finding stands, so a figure is never built on a silently dropped
 * or zeroed piece of work. 13.12 runs the same validation as publish
 * validation.
 */

/** W1 tolerance: children must total 100% ±0.01. */
export const WEIGHT_TOLERANCE = 0.01;

const PROJECT_LABEL = "Project";

function isEntered(weight: number | null | undefined): weight is number {
  return typeof weight === "number";
}

function isValidWeight(weight: number): boolean {
  return Number.isFinite(weight) && weight >= 0 && weight <= 100;
}

function formatTotal(total: number): string {
  return `${Math.round(total * 1000) / 1000}%`;
}

function issue(
  code: ValidationCode,
  element: { id: string; name: string } | null,
  message: string,
  severity: ValidationIssue["severity"] = "blocking"
): ValidationIssue {
  return {
    code,
    severity,
    elementId: element ? element.id : null,
    elementName: element ? element.name : PROJECT_LABEL,
    message,
  };
}

/** W1 / W2 / weight range for one parent's direct children. */
function validateChildWeights(
  parent: EngineNodeInput | null,
  children: readonly EngineElementInput[],
  issues: ValidationIssue[]
): void {
  const parentName = parent ? parent.name : PROJECT_LABEL;
  if (children.length === 0) {
    issues.push(issue("EMPTY_NODE", parent, `${parentName}: has no children to carry its weight.`));
    return;
  }

  const missing: string[] = [];
  let total = 0;
  let invalid = false;
  for (const child of children) {
    if (!isEntered(child.localWeight)) {
      missing.push(child.name);
      continue;
    }
    if (!isValidWeight(child.localWeight)) {
      invalid = true;
      issues.push(issue("WEIGHT_INVALID", child, `${child.name}: local weight must be between 0 and 100.`));
      continue;
    }
    total += child.localWeight;
  }

  if (missing.length > 0) {
    issues.push(issue("W2_MISSING_WEIGHT", parent, `${parentName}: weight missing for ${missing.join(", ")}.`));
  }
  if (!invalid && Math.abs(total - 100) > WEIGHT_TOLERANCE) {
    issues.push(issue("W1_CHILD_TOTAL", parent, `${parentName}: child weights total ${formatTotal(total)}.`));
  }
}

function checkDate(
  value: string | null | undefined,
  label: string,
  activity: EngineActivityInput,
  issues: ValidationIssue[]
): number | null {
  if (value === null || value === undefined) return null;
  const day = dayNumber(value);
  if (day === null) {
    issues.push(issue("DATE_INVALID", activity, `${activity.name}: ${label} "${value}" is not a valid date.`));
  }
  return day;
}

function validateBaseline(activity: EngineActivityInput, window: DateWindow, issues: ValidationIssue[]): void {
  const start = checkDate(window.start, "BLn start", activity, issues);
  const finish = checkDate(window.finish, "BLn finish", activity, issues);

  if (activity.earningMethod === "milestone") {
    if (start === null && finish === null) {
      issues.push(issue("BASELINE_DATES_INVALID", activity, `${activity.name}: milestone has no BLn date.`));
    } else if (start !== null && finish !== null && start !== finish) {
      issues.push(
        issue("MILESTONE_NOT_ZERO_DURATION", activity, `${activity.name}: a true milestone must start and finish on the same date.`)
      );
    }
    return;
  }

  if (start === null || finish === null) {
    issues.push(issue("BASELINE_DATES_INVALID", activity, `${activity.name}: BLn start and finish are required.`));
  } else if (finish < start) {
    issues.push(issue("BASELINE_DATES_INVALID", activity, `${activity.name}: BLn finish is before BLn start.`));
  }
}

function validateActivity(activity: EngineActivityInput, dataDay: number, issues: ValidationIssue[]): void {
  validateBaseline(activity, activity.baseline ?? {}, issues);

  const actual = activity.actual ?? {};
  const actualStart = checkDate(actual.start, "actual start", activity, issues);
  const actualFinish = checkDate(actual.finish, "actual finish", activity, issues);
  if (actualStart !== null && actualStart > dataDay) {
    issues.push(issue("ACTUAL_AFTER_DATA_DATE", activity, `${activity.name}: actual start is after the Data Date.`));
  }
  if (actualFinish !== null && actualFinish > dataDay) {
    issues.push(issue("ACTUAL_AFTER_DATA_DATE", activity, `${activity.name}: actual finish is after the Data Date.`));
  }

  const finished = actualFinish !== null && actualFinish <= dataDay;
  const started = finished || (actualStart !== null && actualStart <= dataDay);

  const forecast = activity.forecast ?? {};
  const forecastStart = checkDate(forecast.start, "forecast start", activity, issues);
  const forecastFinish = checkDate(forecast.finish, "forecast finish", activity, issues);
  if (!finished && forecastFinish !== null && forecastFinish < dataDay) {
    issues.push(
      issue("FORECAST_BEFORE_DATA_DATE", activity, `${activity.name}: incomplete work is forecast to finish before the Data Date.`)
    );
  }
  if (!started && forecastStart !== null && forecastStart < dataDay) {
    issues.push(
      issue("FORECAST_BEFORE_DATA_DATE", activity, `${activity.name}: unstarted work is forecast to start before the Data Date.`)
    );
  }

  checkDate(activity.originalBaseline?.start, "BL0 start", activity, issues);
  checkDate(activity.originalBaseline?.finish, "BL0 finish", activity, issues);

  const confirmed = activity.percentComplete;
  const hasConfirmed = confirmed !== null && confirmed !== undefined;
  if (hasConfirmed && !(Number.isFinite(confirmed) && confirmed >= 0 && confirmed <= 100)) {
    issues.push(issue("PERCENT_INVALID", activity, `${activity.name}: % complete must be between 0 and 100.`));
    return;
  }

  if (activity.earningMethod !== "percent_complete") return;

  if (started && !hasConfirmed) {
    issues.push(issue("C2_UNMEASURED_START", activity, `${activity.name}: started with no confirmed % complete.`));
  }
  if (!started && hasConfirmed && confirmed > 0) {
    issues.push(
      issue(
        "PROGRESS_WITHOUT_START",
        activity,
        `${activity.name}: % complete recorded without an actual start — it earns 0 until it has one.`,
        "advisory"
      )
    );
  }
  if (finished && hasConfirmed && confirmed < 100) {
    issues.push(
      issue("FINISHED_BELOW_100", activity, `${activity.name}: finished with a confirmed % complete below 100.`, "advisory")
    );
  }
}

/** Every finding for a plan, blocking and advisory, in tree order. */
export function validatePlan(plan: EnginePlanInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const dataDay = dayNumber(plan.dataDate);
  if (dataDay === null) {
    issues.push(issue("PLAN_INVALID", null, "The plan needs a valid Data Date."));
  }
  if (!new WorkingCalendar(plan.workingWeek ?? []).hasWorkingDays) {
    issues.push(issue("PLAN_INVALID", null, "The project's working week has no working days."));
  }

  const seen = new Set<string>();
  const visit = (parent: EngineNodeInput | null, children: readonly EngineElementInput[]) => {
    validateChildWeights(parent, children, issues);
    for (const child of children) {
      if (seen.has(child.id)) {
        issues.push(issue("DUPLICATE_ID", child, `${child.name}: id "${child.id}" is used more than once.`));
      }
      seen.add(child.id);
      if (child.kind === "node") visit(child, child.children);
      else if (dataDay !== null) validateActivity(child, dataDay, issues);
    }
  };
  visit(null, plan.children ?? []);
  return issues;
}

export function blockingIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return issues.filter((finding) => finding.severity === "blocking");
}

/* ----------------------------- W3 normalisation -------------------------- */

/**
 * W3: per parent, Project Control may choose proportional rescale of the
 * entered weights, or an equal split when no child weight is entered. The
 * engine only computes the proposal — it never applies one silently. The
 * Working Plan records the decision, its actor and the resulting weights
 * (13.11) and the snapshot freezes them (13.12).
 */
export type NormalisationMode = "proportional_rescale" | "equal_split";

export interface NormalisationDecision {
  /** `null` for the project's top-level children. */
  parentId: string | null;
  mode: NormalisationMode;
  before: { id: string; localWeight: number | null }[];
  after: { id: string; localWeight: number }[];
}

export type NormalisationProposal =
  | { ok: true; decision: NormalisationDecision }
  | { ok: false; reason: string };

export function proposeNormalisation(
  parentId: string | null,
  children: readonly { id: string; localWeight: number | null | undefined }[],
  mode: NormalisationMode
): NormalisationProposal {
  if (children.length === 0) return { ok: false, reason: "There are no child weights to normalise." };
  const before = children.map((child) => ({
    id: child.id,
    localWeight: isEntered(child.localWeight) ? child.localWeight : null,
  }));
  if (before.some((child) => child.localWeight !== null && !isValidWeight(child.localWeight))) {
    return { ok: false, reason: "Correct the invalid weights before normalising." };
  }

  if (mode === "equal_split") {
    if (before.some((child) => child.localWeight !== null)) {
      return { ok: false, reason: "Equal split applies only when no child weight is entered." };
    }
    const share = 100 / children.length;
    return { ok: true, decision: { parentId, mode, before, after: before.map(({ id }) => ({ id, localWeight: share })) } };
  }

  const total = before.reduce((sum, child) => sum + (child.localWeight ?? 0), 0);
  if (total <= 0) {
    return { ok: false, reason: "Proportional rescale needs at least one entered weight above 0." };
  }
  return {
    ok: true,
    decision: {
      parentId,
      mode,
      before,
      after: before.map(({ id, localWeight }) => ({ id, localWeight: ((localWeight ?? 0) * 100) / total })),
    },
  };
}

/**
 * A NEW plan with one normalisation decision applied. The input plan is not
 * modified — the caller decides whether, and by whom, the result is recorded.
 */
export function applyNormalisation(plan: EnginePlanInput, decision: NormalisationDecision): EnginePlanInput {
  // Ids are unique in a valid plan, so the decided parent's direct children
  // are exactly the elements named in the decision.
  const weights = new Map(decision.after.map(({ id, localWeight }) => [id, localWeight]));
  const reweigh = (children: readonly EngineElementInput[]): EngineElementInput[] =>
    children.map((child) => {
      const localWeight = weights.has(child.id) ? weights.get(child.id) : child.localWeight;
      return child.kind === "node"
        ? { ...child, localWeight, children: reweigh(child.children) }
        : { ...child, localWeight };
    });
  return { ...plan, children: reweigh(plan.children) };
}

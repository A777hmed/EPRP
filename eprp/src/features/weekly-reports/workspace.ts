import type {
  Project,
  WeeklyReport,
  WeeklySubmission,
} from "@/types";
import {
  ALL_ITEMS,
  canAccessDepartment,
  visibleScopeItems,
  weeklyDepartments,
  type WeeklyScope,
} from "./scope";

/**
 * Weekly workspace derivation.
 *
 * Turns a report plus its submissions into the shape the workspace renders:
 * a progress summary, and one section per department the viewer may see.
 *
 * Everything here is DERIVED. No progress figure, department list or
 * completion state is stored a second time — the report and its submissions
 * remain the only sources, so the screen cannot drift from the data.
 *
 * Pure and framework-free, so it is testable directly and reusable by any
 * renderer.
 */

/* ----------------------------- Progress summary --------------------------- */

export type ProgressHealth = "ahead" | "on_track" | "at_risk" | "behind";

export interface ProgressSummary {
  planned: number;
  actual: number;
  /** actual − planned. Negative means behind plan. */
  variance: number;
  health: ProgressHealth;
  /** The report's own overall status text, when it carries one. */
  overallStatus?: string;
  executiveSummary?: string;
}

/**
 * Health from the plan/actual gap.
 *
 * Thresholds are deliberately gentle: a single percentage point behind is
 * noise, not a risk, and flagging it would train people to ignore the signal.
 * A report that carries its own `overallProgressStatus` keeps it — a human
 * judgement outranks an arithmetic one.
 */
export function progressSummary(report: WeeklyReport): ProgressSummary {
  const planned = report.plannedProgress ?? 0;
  const actual = report.actualProgress ?? 0;
  const variance = Math.round((actual - planned) * 100) / 100;

  let health: ProgressHealth;
  if (variance >= 1) health = "ahead";
  else if (variance >= -1) health = "on_track";
  else if (variance >= -5) health = "at_risk";
  else health = "behind";

  return {
    planned,
    actual,
    variance,
    health,
    overallStatus: report.overallProgressStatus ?? undefined,
    // `summary` IS the Executive Summary narrative (spec section 5). Reused
    // rather than adding a second field that would store the same thing.
    executiveSummary: report.summary ?? undefined,
  };
}

/* --------------------------- Department completion ------------------------ */

/**
 * How far a department has got with this week's input.
 *
 * Derived from the department's own submissions rather than stored, so there
 * is no parallel lifecycle table to keep in step with the real one.
 */
export type DepartmentState =
  | "not_started"
  | "in_progress"
  | "submitted"
  | "reviewed"
  | "complete";

export const DEPARTMENT_STATE_LABELS: Record<DepartmentState, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  submitted: "Submitted",
  reviewed: "Reviewed",
  complete: "Complete",
};

/**
 * Weakest-link rule: a department is only as far along as its least advanced
 * submission. One unstarted row holds the department at "In Progress" rather
 * than letting an average hide it, because the point of this indicator is to
 * show Project Control what is still missing.
 */
export function deriveDepartmentState(
  submissions: WeeklySubmission[]
): DepartmentState {
  if (submissions.length === 0) return "not_started";

  const every = (predicate: (s: WeeklySubmission) => boolean) =>
    submissions.every(predicate);

  if (every((s) => s.status === "approved")) return "complete";
  if (every((s) => Boolean(s.reviewedByContactId))) return "reviewed";
  if (every((s) => s.status === "submitted" || s.status === "approved")) {
    return "submitted";
  }
  // A returned submission is active work again, not a finished state.
  if (every((s) => s.status === "pending") && !hasAnyContent(submissions)) {
    return "not_started";
  }
  return "in_progress";
}

/** Whether a department has actually typed anything yet. */
function hasAnyContent(submissions: WeeklySubmission[]): boolean {
  return submissions.some(
    (s) =>
      Boolean(s.summary?.trim()) ||
      Boolean(s.keyAchievement?.trim()) ||
      Boolean(s.delayConstraint?.trim()) ||
      Boolean(s.nextWeekPlan?.trim()) ||
      typeof s.progressPercent === "number"
  );
}

/* ------------------------------ Department view --------------------------- */

export interface DepartmentSection {
  departmentId: string;
  /** Every submission for this department the viewer may see. */
  submissions: WeeklySubmission[];
  /**
   * The department-level shared input: the submission with no scope item.
   * Undefined when the department has not created one yet.
   */
  generalUpdate?: WeeklySubmission;
  /** Submissions scoped to an item below the System. */
  scopedUpdates: WeeklySubmission[];
  state: DepartmentState;
  stateLabel: string;
  /** Nothing entered yet — what Project Control is chasing. */
  missingInput: boolean;
  /** The viewer may see every item here, not just their own. */
  seesWholeDepartment: boolean;
}

export interface WeeklyWorkspace {
  reportId: string;
  projectId: string;
  summary: ProgressSummary;
  departments: DepartmentSection[];
  /** Departments in the project the viewer may not see. Never their content. */
  hiddenDepartmentCount: number;
  /** Departments with no input at all, among those the viewer can see. */
  awaitingInput: string[];
  /** Wording for the scope-item level, from the project type. */
  scopeItemLabel: string;
  scopeItemLabelPlural: string;
}

/**
 * Build the workspace for one viewer.
 *
 * Departments come from the project's own assignment list, never from the
 * submissions: a department that owes input but has not started must still
 * appear, which is exactly the case a submission-derived list would miss.
 *
 * Filtering is applied through the scope resolver, so this adds no second
 * permission model. It decides what to RENDER; row-level security decides
 * what the viewer could ever load, and enforces the same rules independently.
 */
export function buildWeeklyWorkspace(
  project: Project,
  report: WeeklyReport,
  submissions: WeeklySubmission[],
  scope: WeeklyScope
): WeeklyWorkspace {
  const all = weeklyDepartments(project);
  const visible = all.filter((id) => canAccessDepartment(scope, id));

  const departments: DepartmentSection[] = visible.map((departmentId) => {
    const items = visibleScopeItems(scope, departmentId);
    const seesWholeDepartment = items === ALL_ITEMS;

    const mine = submissions.filter((s) => {
      if (s.departmentId !== departmentId) return false;
      if (seesWholeDepartment) return true;
      // The department-level row is shared input, reachable by anyone
      // assigned to the department — mirroring filterWeeklyRows().
      if (!s.disciplineId) return true;
      return (items as string[]).includes(s.disciplineId);
    });

    const state = deriveDepartmentState(mine);

    return {
      departmentId,
      submissions: mine,
      generalUpdate: mine.find((s) => !s.disciplineId),
      scopedUpdates: mine.filter((s) => Boolean(s.disciplineId)),
      state,
      stateLabel: DEPARTMENT_STATE_LABELS[state],
      missingInput: state === "not_started",
      seesWholeDepartment,
    };
  });

  return {
    reportId: report.id,
    projectId: project.id,
    summary: progressSummary(report),
    departments,
    hiddenDepartmentCount: all.length - visible.length,
    awaitingInput: departments
      .filter((d) => d.missingInput)
      .map((d) => d.departmentId),
    scopeItemLabel: scope.terms.singular,
    scopeItemLabelPlural: scope.terms.plural,
  };
}

/**
 * The department-level shared submission, or the shape to create one from.
 *
 * Returning the existing row's id when there is one is what stops a repeated
 * save from inserting a second general update: the caller updates in place
 * rather than appending. `discipline_id` stays NULL, which is the recorded
 * meaning of "general department input" — not a missing value.
 */
export function generalUpdateDraft(
  reportId: string,
  departmentId: string,
  existing: WeeklySubmission | undefined
): Pick<WeeklySubmission, "id" | "weeklyReportId" | "departmentId"> & {
  disciplineId: undefined;
} {
  return {
    id: existing?.id ?? "",
    weeklyReportId: reportId,
    departmentId,
    disciplineId: undefined,
  };
}

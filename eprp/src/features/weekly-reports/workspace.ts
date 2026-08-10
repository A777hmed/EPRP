import type {
  AssignmentRole,
  Project,
  WeeklyEntry,
  WeeklyReport,
  WeeklySubmission,
} from "@/types";
import { scopedAssignments } from "@/features/projects/assignment-rules";
import {
  ALL_ITEMS,
  canAccessDepartment,
  visibleScopeItems,
  weeklyDepartments,
  type ScopeItemAccess,
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

/* ------------------------------- Scope items ------------------------------- */

/**
 * One Program & Study / Discipline under a department, with its Weekly input.
 *
 * The item comes from the project's own scope links and the submission from
 * the report, paired here so the workspace can show what is expected as well
 * as what has arrived — an item nobody has filled in still has a row, which is
 * exactly the gap a submission-derived list would hide.
 */
/**
 * Who holds a scope item, and in what capacity.
 *
 * Read from the project's own scoped assignments — nothing about
 * responsibility is copied into a Weekly table, so a change made in Project
 * Setup shows up here on the next render rather than needing a backfill. One
 * record per (person, Assignment Role): the Core treats two roles on the same
 * item as two genuine assignments, not a duplicate to collapse.
 */
export interface ScopeItemResponsibility {
  contactId: string;
  assignmentRole: AssignmentRole;
  functionalTitle?: string;
}

export interface ScopeItemRow {
  /** Master-data id. Stored as `discipline_id` whatever the project calls it. */
  scopeItemId: string;
  /** The System this item sits under on this project, when the link records one. */
  systemId?: string;
  /** This item's own submission row. Undefined until someone saves one. */
  submission?: WeeklySubmission;
  /** The people assigned to this item on this project. Display only. */
  responsible: ScopeItemResponsibility[];
  /**
   * Narrative rows tagged to this item — the Required Action / Support list,
   * and the only place `includeInMonthly` is recorded. Weekly submissions
   * deliberately carry no such flag.
   */
  entries: WeeklyEntry[];
  /** Whether this item has been reported on — see {@link isReported}. */
  reported: boolean;
  /**
   * Carries Weekly input but is no longer linked to the project — a scope item
   * removed from the project after it was reported on. Shown read-only rather
   * than dropped: history stays visible (`CLAUDE.md`), and re-editing a row
   * whose item has left the project would be re-opening a closed decision.
   */
  detached: boolean;
}

/**
 * Whether a scope item has actually been reported on.
 *
 * A row alone is not enough — one can exist carrying nothing — but a status
 * someone deliberately moved off `pending` counts even with no narrative yet,
 * because marking an item submitted IS a report about it.
 */
function isReported(submission: WeeklySubmission | undefined): boolean {
  if (!submission) return false;
  return submission.status !== "pending" || hasAnyContent([submission]);
}

/**
 * Pair a department's scope items with their submissions.
 *
 * Detached rows always come last — everything still in the project's scope is
 * what someone is being asked to fill in. Ordering within each group is left
 * to the renderer, which can resolve the names this module deliberately does
 * not know about.
 */
function buildScopeItems(
  project: Project,
  departmentId: string,
  visible: ScopeItemAccess,
  submissions: WeeklySubmission[],
  entries: WeeklyEntry[]
): ScopeItemRow[] {
  const byItem = new Map<string, WeeklySubmission>();
  for (const submission of submissions) {
    if (submission.disciplineId) byItem.set(submission.disciplineId, submission);
  }

  /*
   * Responsibility is resolved once per department and indexed, rather than
   * re-scanned for every item: `scopedAssignments` walks the whole team list,
   * and a department with a dozen items would otherwise walk it a dozen times.
   */
  const responsibleByItem = new Map<string, ScopeItemResponsibility[]>();
  for (const assignment of scopedAssignments(project, departmentId)) {
    if (!assignment.disciplineId) continue;
    const held = responsibleByItem.get(assignment.disciplineId) ?? [];
    const already = held.some(
      (entry) =>
        entry.contactId === assignment.contactId &&
        entry.assignmentRole === assignment.assignmentRole
    );
    if (already) continue;
    held.push({
      contactId: assignment.contactId,
      assignmentRole: assignment.assignmentRole,
      functionalTitle: assignment.functionalTitle,
    });
    responsibleByItem.set(assignment.disciplineId, held);
  }

  const entriesByItem = new Map<string, WeeklyEntry[]>();
  for (const entry of entries) {
    if (entry.departmentId !== departmentId || !entry.disciplineId) continue;
    entriesByItem.set(entry.disciplineId, [
      ...(entriesByItem.get(entry.disciplineId) ?? []),
      entry,
    ]);
  }

  const rowFor = (
    scopeItemId: string,
    systemId: string | undefined,
    detached: boolean
  ): ScopeItemRow => {
    const submission = byItem.get(scopeItemId);
    return {
      scopeItemId,
      systemId,
      submission,
      responsible: responsibleByItem.get(scopeItemId) ?? [],
      entries: entriesByItem.get(scopeItemId) ?? [],
      reported: isReported(submission),
      detached,
    };
  };

  const rows: ScopeItemRow[] = [];
  const placed = new Set<string>();

  for (const link of project.disciplines ?? []) {
    if (link.departmentId !== departmentId) continue;
    if (!link.disciplineId || placed.has(link.disciplineId)) continue;
    // The same filter the submissions went through, applied to the expected
    // items too — a scoped member must not learn what else exists.
    if (visible !== ALL_ITEMS && !visible.includes(link.disciplineId)) continue;

    placed.add(link.disciplineId);
    rows.push(rowFor(link.disciplineId, link.systemId, false));
  }

  for (const scopeItemId of byItem.keys()) {
    if (placed.has(scopeItemId)) continue;
    placed.add(scopeItemId);
    rows.push(rowFor(scopeItemId, undefined, true));
  }

  return rows;
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
  /** The scope items this department owes input on, with what has arrived. */
  scopeItems: ScopeItemRow[];
  /** Scope items carrying content, out of those in scope for the viewer. */
  scopeItemsReported: number;
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
  scope: WeeklyScope,
  /** The report's narrative rows. Optional: callers that show none pass none. */
  entries: WeeklyEntry[] = []
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
    const scopeItems = buildScopeItems(
      project,
      departmentId,
      items,
      mine,
      entries
    );

    return {
      departmentId,
      submissions: mine,
      generalUpdate: mine.find((s) => !s.disciplineId),
      scopedUpdates: mine.filter((s) => Boolean(s.disciplineId)),
      scopeItems,
      scopeItemsReported: scopeItems.filter((item) => item.reported).length,
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

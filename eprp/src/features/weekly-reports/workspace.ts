import type {
  AssignmentRole,
  Project,
  ProgressStatus,
  WeeklyEntry,
  WeeklyReport,
  WeeklySubmission,
} from "@/types";
import {
  departmentManager,
  scopedAssignments,
} from "@/features/projects/assignment-rules";
import {
  calculateSpi,
  recommendScheduleStatus,
  scheduleVariance,
  type ScheduleRecommendation,
} from "@/lib/reporting";
import {
  ALL_ITEMS,
  canAccessDepartment,
  filterWeeklyRows,
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

export interface ProgressSummary {
  planned: number;
  actual: number;
  /** actual − planned, in percentage points. Negative means behind plan. */
  variance: number;
  /** Earned / planned. Presented beside the variance, never coloured apart. */
  spi: number;
  /**
   * The single arithmetic reading of the variance, from the thresholds in
   * `docs/06_WEEKLY_REPORT_SPEC.md` §5 (`recommendScheduleStatus`).
   */
  reading: ScheduleRecommendation;
  /** The report's own recorded verdict, when it carries one. */
  overallStatus?: ProgressStatus;
  /**
   * Whether the recorded verdict and the arithmetic reading say the same
   * thing. False is the ONLY case worth a remark on screen.
   */
  statusAgrees: boolean;
  executiveSummary?: string;
}

/**
 * Which arithmetic reading each recorded verdict corresponds to.
 *
 * The stored `ProgressStatus` has five values and the derived reading three,
 * so "agreement" needs a stated mapping rather than a string comparison.
 * Without one the screen reported a report as On Track and, on the same line,
 * announced that its variance read At Risk — two different threshold sets
 * asked the same question and were both believed.
 */
const READING_FOR_STATUS: Record<ProgressStatus, ScheduleRecommendation> = {
  ahead: "on_schedule",
  on_track: "on_schedule",
  at_risk: "delayed",
  behind: "delayed",
  critical: "critical",
};

/**
 * The week's progress, read ONE way.
 *
 * The variance is interpreted by the documented business rule and by nothing
 * else, so the variance figure, the SPI, and the status badge cannot be
 * coloured by three different opinions of the same number. A report that
 * carries its own `overallProgressStatus` still leads with it — a human
 * judgement outranks an arithmetic one — but the two are only ever remarked
 * on when they genuinely disagree.
 */
export function progressSummary(report: WeeklyReport): ProgressSummary {
  const planned = report.plannedProgress ?? 0;
  const actual = report.actualProgress ?? 0;
  const variance = scheduleVariance(planned, actual);
  const reading = recommendScheduleStatus(variance);
  const overallStatus = report.overallProgressStatus ?? undefined;

  return {
    planned,
    actual,
    variance,
    spi: calculateSpi(planned, actual),
    reading,
    overallStatus,
    statusAgrees: !overallStatus || READING_FOR_STATUS[overallStatus] === reading,
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
 * Everyone the project assigned to a department, one entry per person.
 *
 * Collapsed by person and ranked so the most senior hat each of them wears is
 * the one shown: someone holding five scope items is one candidate, not five.
 * Used for owner selection, which is a question about people, not about the
 * individual scope-item rows behind them.
 */
function departmentPeople(
  project: Project,
  departmentId: string,
  visible: ScopeItemAccess
): ScopeItemResponsibility[] {
  const rank: Record<AssignmentRole, number> = {
    department_manager: 3,
    team_member_lead: 2,
    team_member: 1,
  };
  const byPerson = new Map<string, ScopeItemResponsibility>();

  for (const assignment of scopedAssignments(project, departmentId)) {
    /*
     * A scoped member must not learn the department's full roster through the
     * owner picker. Someone assigned only to items outside this viewer's
     * scope is not offered — the same filter the item list goes through.
     */
    if (
      visible !== ALL_ITEMS &&
      (!assignment.disciplineId || !visible.includes(assignment.disciplineId))
    ) {
      continue;
    }
    const held = byPerson.get(assignment.contactId);
    if (held && rank[held.assignmentRole] >= rank[assignment.assignmentRole]) {
      continue;
    }
    byPerson.set(assignment.contactId, {
      contactId: assignment.contactId,
      assignmentRole: assignment.assignmentRole,
      functionalTitle: assignment.functionalTitle,
    });
  }

  return [...byPerson.values()];
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
   *
   * This is the **Department Overall Update** — optional by design, for what
   * applies to the department as a whole rather than to one scope item.
   * Undefined when the department has not written one, which is a perfectly
   * complete department: `deriveDepartmentState` reads the submissions that
   * exist and never requires this one.
   */
  overallUpdate?: WeeklySubmission;
  /** Submissions scoped to an item below the System. */
  scopedUpdates: WeeklySubmission[];
  /** The scope items this department owes input on, with what has arrived. */
  scopeItems: ScopeItemRow[];
  /** Scope items carrying content, out of those in scope for the viewer. */
  scopeItemsReported: number;
  /** Scope items still in the project's scope — the denominator on screen. */
  scopeItemsExpected: number;
  /** Expected items with nothing reported yet. What is being chased. */
  scopeItemsOutstanding: number;
  /** The department's manager on this project, from its own assignments. */
  managerContactId?: string;
  /**
   * Everyone the project has assigned to this department, de-duplicated by
   * person. This is the candidate list for "who owns this?" — a Weekly owner
   * must be someone the project actually put in the department, not any of
   * the thousands of contacts in master data.
   */
  eligiblePeople: ScopeItemResponsibility[];
  /** Required Action / Support rows in this department flagged for Monthly. */
  markedForMonthly: number;
  state: DepartmentState;
  stateLabel: string;
  /** Nothing entered yet — what Project Control is chasing. */
  missingInput: boolean;
  /** The viewer may see every item here, not just their own. */
  seesWholeDepartment: boolean;
}

/**
 * One line of the project-level Next Week Lookahead.
 *
 * A pointer into the Weekly data that already exists, not a second copy of
 * it: the text is the `nextWeekPlan` on the submission it came from, so
 * editing the department's own update is what changes the lookahead.
 */
export interface LookaheadLine {
  departmentId: string;
  /** Undefined for the Department Overall Update's plan. */
  scopeItemId?: string;
  plan: string;
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
  /** Live Risk and Issue items — see {@link projectEntries}. */
  criticalItems: WeeklyEntry[];
  /** Live Decision / Management Support items. */
  decisionItems: WeeklyEntry[];
  /** Live Action items. */
  actionItems: WeeklyEntry[];
  /** Live Key Comment items. */
  commentItems: WeeklyEntry[];
  /** Items not tied to a scope item: the consolidated section edits these. */
  projectLevelItems: WeeklyEntry[];
  /** How many items are recorded against individual scope items. */
  scopeItemLevelCount: number;
  /** Next week, gathered from the Weekly input that already records it. */
  lookahead: LookaheadLine[];
  /** Every row the viewer can see that is flagged for Monthly compilation. */
  markedForMonthly: number;
}

/** Entry statuses that mean the item is closed out and no longer live. */
const SETTLED_ENTRY_STATUSES = ["resolved", "closed"] as const;

function isLive(entry: WeeklyEntry): boolean {
  return !(SETTLED_ENTRY_STATUSES as readonly string[]).includes(entry.status);
}

/**
 * Split the report's management items into the report's rollups.
 *
 * Every list reads the SAME `weekly_entries` rows the workspace edits — one
 * entry, several presentations. No rollup has an editor of its own, so the
 * report cannot disagree with what was typed, and nothing is entered twice to
 * appear in two places.
 *
 * The split is on `entryType` alone, which is now the only thing that says
 * what an item IS:
 *
 * - **Critical issues / risks** — Risk and Issue.
 * - **Decisions / management support** — Decision.
 * - **Key actions** — Action.
 * - **Key comments** — Key Comment.
 *
 * The lists are disjoint by construction. They used to overlap: Decisions was
 * `category = escalation` and Critical was `entryType risk|issue` minus
 * escalations, so one row's classification depended on two columns that could
 * contradict each other.
 *
 * Rows written before the taxonomy split may still carry `category =
 * escalation`. They are read as decisions too, so a historical item is not
 * lost from the report — and nothing rewrites the stored value.
 */
function projectEntries(entries: WeeklyEntry[]): {
  criticalItems: WeeklyEntry[];
  decisionItems: WeeklyEntry[];
  actionItems: WeeklyEntry[];
  commentItems: WeeklyEntry[];
} {
  const live = entries.filter(isLive);
  const isLegacyEscalation = (entry: WeeklyEntry) =>
    entry.entryType !== "decision" && entry.category === "escalation";

  // Most pressing first, so the top of a compact list is the part that matters.
  const byPriority = (a: WeeklyEntry, b: WeeklyEntry) =>
    PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
  const sorted = (rows: WeeklyEntry[]) => [...rows].sort(byPriority);

  return {
    criticalItems: sorted(
      live.filter(
        (entry) =>
          (entry.entryType === "risk" || entry.entryType === "issue") &&
          !isLegacyEscalation(entry)
      )
    ),
    decisionItems: sorted(
      live.filter(
        (entry) => entry.entryType === "decision" || isLegacyEscalation(entry)
      )
    ),
    actionItems: sorted(
      live.filter(
        (entry) => entry.entryType === "action" && !isLegacyEscalation(entry)
      )
    ),
    commentItems: sorted(
      live.filter(
        (entry) => entry.entryType === "comment" && !isLegacyEscalation(entry)
      )
    ),
  };
}

const PRIORITY_ORDER = ["critical", "high", "medium", "low"] as const;

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
    const expected = scopeItems.filter((item) => !item.detached);

    return {
      departmentId,
      submissions: mine,
      overallUpdate: mine.find((s) => !s.disciplineId),
      scopedUpdates: mine.filter((s) => Boolean(s.disciplineId)),
      scopeItems,
      scopeItemsReported: scopeItems.filter((item) => item.reported).length,
      scopeItemsExpected: expected.length,
      scopeItemsOutstanding: expected.filter((item) => !item.reported).length,
      managerContactId: departmentManager(project, departmentId)?.contactId,
      eligiblePeople: departmentPeople(project, departmentId, items),
      markedForMonthly: scopeItems.reduce(
        (count, item) =>
          count + item.entries.filter((entry) => entry.includeInMonthly).length,
        0
      ),
      state,
      stateLabel: DEPARTMENT_STATE_LABELS[state],
      missingInput: state === "not_started",
      seesWholeDepartment,
    };
  });

  /*
   * Project-level lists are built from the rows this viewer may reach, using
   * the same filter the submissions go through — a scoped member's project
   * sections must not become the back door to the whole report.
   */
  const reachableEntries = filterWeeklyRows(scope, entries);
  const { criticalItems, decisionItems, actionItems, commentItems } =
    projectEntries(reachableEntries);

  const lookahead: LookaheadLine[] = [];
  for (const section of departments) {
    for (const submission of section.submissions) {
      const plan = submission.nextWeekPlan?.trim();
      if (!plan) continue;
      lookahead.push({
        departmentId: section.departmentId,
        scopeItemId: submission.disciplineId ?? undefined,
        plan,
      });
    }
  }

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
    criticalItems,
    decisionItems,
    actionItems,
    commentItems,
    // Split on the row's own scope, not on where it was typed, so one item is
    // never shown both on a scope item and in the consolidated list.
    projectLevelItems: reachableEntries.filter((entry) => !entry.disciplineId),
    scopeItemLevelCount: reachableEntries.filter((entry) => entry.disciplineId)
      .length,
    lookahead,
    markedForMonthly: reachableEntries.filter((entry) => entry.includeInMonthly)
      .length,
  };
}

/**
 * The Department Overall Update row, or the shape to create one from.
 *
 * Returning the existing row's id when there is one is what stops a repeated
 * save from inserting a second overall update: the caller updates in place
 * rather than appending. `discipline_id` stays NULL, which is the recorded
 * meaning of "applies to the department as a whole" — not a missing value.
 */
export function overallUpdateDraft(
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

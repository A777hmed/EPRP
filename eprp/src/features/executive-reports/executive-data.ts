/**
 * Executive portfolio derivations — pure functions over data that already exists.
 *
 * Nothing here invents a value and nothing here is stored. The Executive tier
 * SELECTS (`03_REPORTING_ARCHITECTURE.md` §6.2); it never re-derives operational
 * figures and never introduces a number the tier below it did not report.
 *
 * The three rules this module exists to enforce, all approved in Phase 2:
 *
 * 1. **Monthly is the official baseline.** A project's position comes from the
 *    latest APPROVED Monthly Report for the selected month. Where none exists
 *    the latest available Monthly is shown and marked Draft; where no Monthly
 *    exists at all the project reads "No Monthly Report".
 * 2. **Draft never contributes to an official aggregate.** Portfolio KPIs are
 *    computed from approved rows only, and every aggregate declares its basis —
 *    how many projects contributed and which were excluded (§7.4).
 * 3. **Absence is never zero.** A missing figure is `undefined` and renders as
 *    "Not Reported". A project that is not reporting is shown as not reporting
 *    (`08_DASHBOARD_ARCHITECTURE.md` §5.3), never as healthy and never as 0%.
 */

import { parseISO } from "date-fns";

import { APPROVED_REPORT_STATUSES } from "@/config/workflows";
import {
  ENTRY_STATUS_META,
  PRIORITY_META,
  PROGRESS_STATUS_META,
  REPORT_STATUS_META,
} from "@/lib/constants";
import { scheduleVariance } from "@/lib/reporting";
import type { StatusTone } from "@/components/shared/status-badge";
import type { MilestoneState } from "@/features/projects/milestone-state";
import type {
  Contact,
  MonthlyComment,
  MonthlyPlanItem,
  MonthlyReport,
  Priority,
  Project,
  ReportStatus,
  WeeklyEntry,
  WeeklyPlanItem,
  WeeklyReport,
} from "@/types";
/*
 * `monthEndStatus` is imported, not reimplemented: it is the Monthly report's
 * own single reading of its month, and the Executive tier must not run a second
 * one. See `readHealth()` below.
 */
import { NOT_RECORDED, monthEndStatus, nameOf, type NamedRecord } from "@/features/monthly-reports/monthly-data";

export { NOT_RECORDED, nameOf, type NamedRecord };

/** Text used wherever a project is present but has reported no position. */
export const NOT_REPORTED = "Not Reported";

/* ------------------------------ Monthly basis ------------------------------ */

/**
 * The statuses that make a Monthly Report eligible for official aggregation.
 *
 * Law 3: leadership sees nothing that has not been approved twice. `finalized`
 * and `locked` are past approval, so they qualify. `archived` deliberately does
 * NOT: an archived report is withdrawn from active use (§10.2 rule 6), so it
 * remains readable as a fallback position but must not carry a portfolio total.
 */
/**
 * Retained as the Executive tier's name for the shared rule. It is an ALIAS,
 * not a second definition — P0.4 moved the list to `config/workflows.ts` so
 * compilation, visibility and aggregation cannot drift apart.
 */
export const APPROVED_MONTHLY_STATUSES: ReportStatus[] = APPROVED_REPORT_STATUSES;

export function isApprovedMonthly(report: MonthlyReport): boolean {
  return APPROVED_MONTHLY_STATUSES.includes(report.status);
}

/** Which Monthly Report a project row is speaking from. */
export type MonthlyBasis = "approved" | "draft" | "none";

export const MONTHLY_BASIS_META: Record<MonthlyBasis, { label: string; tone: StatusTone; note: string }> = {
  approved: {
    label: "Approved Monthly",
    tone: "success",
    note: "Official position — contributes to portfolio aggregates.",
  },
  /*
   * "Draft / Not Approved", not "Draft".
   *
   * This basis covers every Monthly that has not reached approval — draft,
   * under review, returned, rejected AND archived. Labelling an archived report
   * "Draft" would misstate its lifecycle; the row carries the report's actual
   * status alongside this badge, so the reader sees both what it is and why it
   * does not count.
   */
  draft: {
    label: "Draft / Not Approved",
    tone: "warning",
    note: "Not approved — shown for visibility only and excluded from portfolio aggregates.",
  },
  none: {
    label: "No Monthly Report",
    tone: "neutral",
    note: "No Monthly Report exists for this month — excluded from portfolio aggregates.",
  },
};

export interface MonthlySelection {
  basis: MonthlyBasis;
  report?: MonthlyReport;
}

/**
 * The official Monthly position for one project in one month.
 *
 * Approved first, whatever its date within the month; otherwise the most
 * recently updated Monthly, marked Draft. Returning the basis alongside the
 * report is what lets every caller keep unapproved data out of a total without
 * re-deciding the rule.
 */
export function selectOfficialMonthly(reports: MonthlyReport[], month: string): MonthlySelection {
  const inMonth = reports.filter((report) => report.reportingMonth.slice(0, 7) === month);
  if (inMonth.length === 0) return { basis: "none" };

  const approved = inMonth
    .filter(isApprovedMonthly)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (approved.length > 0) return { basis: "approved", report: approved[0] };

  const latest = [...inMonth].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { basis: "draft", report: latest[0] };
}

/* -------------------------------- Health ---------------------------------- */

/**
 * The ONE Executive health reading.
 *
 * Resolution order, and no other:
 *   1. the Monthly's own recorded `overallProgressStatus` — a human judged the
 *      month and that judgement outranks arithmetic;
 *   2. otherwise the canonical variance helper `recommendScheduleStatus()`,
 *      which is the same rule Weekly and Monthly already read;
 *   3. otherwise Unknown.
 *
 * No new thresholds are introduced here. The Weekly finalization pass fixed a
 * bug where three threshold sets answered one question on one screen; this
 * module exists so that cannot recur at portfolio altitude.
 */
export type ExecHealth = "on_track" | "at_risk" | "delayed" | "critical" | "unknown";

export const EXEC_HEALTH_META: Record<ExecHealth, { label: string; tone: StatusTone; short: string }> = {
  on_track: { label: "On Track", tone: "success", short: "On Track" },
  at_risk: { label: "At Risk", tone: "warning", short: "At Risk" },
  delayed: { label: "Delayed", tone: "danger", short: "Delayed" },
  critical: { label: "Critical", tone: "danger", short: "Critical" },
  unknown: { label: "Not Reported", tone: "neutral", short: "Unknown" },
};

/**
 * Attention-first ordering: the portfolio opens on what is wrong
 * (`08_DASHBOARD_ARCHITECTURE.md` §9.2 rule 2).
 */
export const EXEC_HEALTH_ORDER: ExecHealth[] = ["critical", "delayed", "at_risk", "on_track", "unknown"];

/**
 * Which bucket each month-end label falls into.
 *
 * `monthEndStatus()` produces two vocabularies — the recorded `ProgressStatus`
 * labels when the Monthly carries a verdict, and its own derived labels when it
 * does not. Both are closed sets defined in this codebase, so mapping them is a
 * statement of correspondence rather than string-sniffing.
 *
 * `at_risk` is reachable only from a recorded verdict; the derived path has no
 * at-risk band and inventing one would be a new threshold, which §8 of the
 * approved brief forbids.
 */
const HEALTH_FOR_LABEL: Record<string, ExecHealth> = {
  // Recorded ProgressStatus labels.
  "Ahead of Schedule": "on_track",
  "On Track": "on_track",
  "At Risk": "at_risk",
  "Behind Schedule": "delayed",
  // Derived month-end labels.
  "On Plan": "on_track",
  Delayed: "delayed",
  Critical: "critical",
};

export interface HealthReading {
  health: ExecHealth;
  label: string;
  tone: StatusTone;
  /** Always recoverable — a figure in front of the Chairman must be explainable. */
  basis: string;
}

/**
 * The ONE Executive health reading — delegated, not recomputed.
 *
 * This calls `monthEndStatus()`, the Monthly report's own single interpretation
 * of its month, and presents its verdict verbatim. The Executive tier therefore
 * shows the SAME words the Monthly Report shows for the same project and month.
 *
 * It deliberately does NOT call `recommendScheduleStatus()` directly. Those two
 * helpers carry different bands — at −2.0% the Weekly rule reads "On Schedule"
 * while the Monthly rule reads "Delayed" — so running the Weekly rule here made
 * the portfolio contradict the very report it compiles. That is a defect under
 * `03_REPORTING_ARCHITECTURE.md` Law 6 and conformance rule 21 ("a dashboard can
 * never disagree with a report"), not a presentation choice.
 *
 * `monthEndStatus()` already implements the approved resolution order on its
 * own: a recorded `overallProgressStatus` wins, otherwise the variance decides.
 * Delegating to it is what keeps a single threshold set in the system.
 */
export function readHealth(report: MonthlyReport | undefined): HealthReading {
  if (!report) {
    const meta = EXEC_HEALTH_META.unknown;
    return { health: "unknown", label: meta.label, tone: meta.tone, basis: "No Monthly Report for this month." };
  }

  const status = monthEndStatus(report);
  const health = HEALTH_FOR_LABEL[status.label] ?? "unknown";

  return {
    health,
    label: status.label,
    tone: status.tone,
    basis: report.overallProgressStatus
      ? `Recorded on the Monthly Report as “${PROGRESS_STATUS_META[report.overallProgressStatus].label}” (${status.detail}).`
      : `The Monthly Report's own month-end reading of its schedule variance (${status.detail}).`,
  };
}

/* ----------------------------- Attention items ----------------------------- */

export type AttentionKind = "risk" | "decision" | "client_action" | "achievement";

export interface AttentionItem {
  id: string;
  projectId: string;
  projectName: string;
  kind: AttentionKind;
  text: string;
  priority: Priority;
  priorityLabel: string;
  priorityTone: StatusTone;
  statusLabel: string;
  statusTone: StatusTone;
  ownerName?: string;
  dueDate?: string;
  overdue: boolean;
}

const OPEN_COMMENT_STATUSES = ["open", "in_progress", "escalated", "pending"];

function isOpen(comment: MonthlyComment): boolean {
  return OPEN_COMMENT_STATUSES.includes(comment.status);
}

function commentStatus(comment: MonthlyComment): { label: string; tone: StatusTone } {
  if (comment.status === "pending") return { label: "Pending", tone: "warning" };
  return ENTRY_STATUS_META[comment.status];
}

const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Most pressing first, then soonest due — the top of a compact list must matter. */
export function bySeverity(a: AttentionItem, b: AttentionItem): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (rank !== 0) return rank;
  if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
  if (a.dueDate) return -1;
  if (b.dueDate) return 1;
  return a.projectName.localeCompare(b.projectName);
}

function attentionKind(comment: MonthlyComment): AttentionKind | undefined {
  if (comment.updateType === "risk_issue") return "risk";
  if (comment.updateType === "decision_management_support" || comment.escalateToManagement) return "decision";
  if (comment.updateType === "action") return "client_action";
  if (comment.updateType === "achievement" || comment.isMajorAchievement) return "achievement";
  return undefined;
}

/**
 * Turn a project's Monthly comments into ranked management attention.
 *
 * Only `includeInFinal` rows are considered: the Monthly tier already made a
 * selection decision and the Executive tier honours it rather than reaching
 * behind it.
 */
export function buildAttention(input: {
  comments: MonthlyComment[];
  project: Project;
  projectName: string;
  contacts: NamedRecord[];
  today: string;
}): AttentionItem[] {
  const { comments, project, projectName, contacts, today } = input;

  return comments
    .filter((comment) => comment.includeInFinal)
    .map((comment) => {
      const kind = attentionKind(comment);
      if (!kind) return undefined;
      const status = commentStatus(comment);
      const open = isOpen(comment);
      const item: AttentionItem = {
        id: comment.id,
        projectId: project.id,
        projectName,
        kind,
        text: (comment.presentationText?.trim() || comment.originalText.trim()).replace(/\s+/g, " "),
        priority: comment.priority,
        priorityLabel: PRIORITY_META[comment.priority].label,
        priorityTone: PRIORITY_META[comment.priority].tone,
        statusLabel: status.label,
        statusTone: status.tone,
        ownerName: comment.responsibleContactId ? nameOf(comment.responsibleContactId, contacts, NOT_RECORDED) : undefined,
        dueDate: comment.targetDate,
        overdue: Boolean(comment.targetDate && comment.targetDate < today && open),
      };
      return item;
    })
    .filter((item): item is AttentionItem => item !== undefined);
}

export function openItems(items: AttentionItem[], kind: AttentionKind): AttentionItem[] {
  return items.filter((item) => item.kind === kind && item.statusLabel !== "Resolved" && item.statusLabel !== "Closed");
}

/* -------------------------------- Milestones ------------------------------- */

export type MilestoneSource = "monthly_plan" | "weekly_plan";

export const MILESTONE_SOURCE_LABEL: Record<MilestoneSource, string> = {
  monthly_plan: "Monthly plan",
  weekly_plan: "Weekly plan",
};

export interface MilestoneRow {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  date?: string;
  ownerName?: string;
  statusLabel: string;
  statusTone: StatusTone;
  source: MilestoneSource;
  sourceLabel: string;
}

const PLAN_STATUS_META: Record<string, { label: string; tone: StatusTone }> = {
  not_started: { label: "Not Started", tone: "neutral" },
  in_progress: { label: "In Progress", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  delayed: { label: "Delayed", tone: "danger" },
  pending: { label: "Pending", tone: "warning" },
};

function planStatus(status: string): { label: string; tone: StatusTone } {
  return PLAN_STATUS_META[status] ?? { label: status.replaceAll("_", " "), tone: "neutral" };
}

/**
 * Forward-looking dated items, honestly sourced.
 *
 * These are Monthly plan items and Weekly plan milestones — NOT a project
 * milestone register, because no such table exists (Phase 1, §D). Every row
 * carries the source it came from so nothing reads as more authoritative than
 * it is.
 */
export function buildMilestones(input: {
  monthlyPlans: { projectId: string; projectName: string; items: MonthlyPlanItem[] }[];
  weeklyPlans: { projectId: string; projectName: string; items: WeeklyPlanItem[] }[];
  contacts: NamedRecord[];
}): MilestoneRow[] {
  const { monthlyPlans, weeklyPlans, contacts } = input;
  const rows: MilestoneRow[] = [];

  for (const group of monthlyPlans) {
    for (const item of group.items) {
      const status = planStatus(item.status);
      rows.push({
        id: `m-${item.id}`,
        projectId: group.projectId,
        projectName: group.projectName,
        title: item.title,
        date: item.targetDate,
        ownerName: item.ownerContactId ? nameOf(item.ownerContactId, contacts, NOT_RECORDED) : undefined,
        statusLabel: status.label,
        statusTone: status.tone,
        source: "monthly_plan",
        sourceLabel: MILESTONE_SOURCE_LABEL.monthly_plan,
      });
    }
  }

  for (const group of weeklyPlans) {
    for (const item of group.items) {
      if (item.kind !== "milestone") continue;
      const status = planStatus(item.status);
      rows.push({
        id: `w-${item.id}`,
        projectId: group.projectId,
        projectName: group.projectName,
        title: item.title,
        date: item.endDate,
        ownerName: item.ownerContactId ? nameOf(item.ownerContactId, contacts, NOT_RECORDED) : undefined,
        statusLabel: status.label,
        statusTone: status.tone,
        source: "weekly_plan",
        sourceLabel: MILESTONE_SOURCE_LABEL.weekly_plan,
      });
    }
  }

  // Undated items sort last: a timeline is ordered by date, and an item without
  // one cannot claim a position on it.
  return rows.sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return a.projectName.localeCompare(b.projectName);
  });
}

/**
 * Drop a Weekly plan milestone that the Monthly plan already carries.
 *
 * There is no id linking a `weekly_plan_items` row to a `monthly_plan_items`
 * row, so the match is on title + target date — the two facts that make them
 * the same commitment. Monthly wins, because it is the baseline. Anything the
 * Monthly does not carry survives as genuine Weekly-plan detail.
 */
export function dedupeMilestones(rows: MilestoneRow[]): MilestoneRow[] {
  const fromMonthly = new Set(
    rows
      .filter((row) => row.source === "monthly_plan")
      .map((row) => `${row.title.trim().toLowerCase()}|${row.date ?? ""}`)
  );
  return rows.filter(
    (row) =>
      row.source === "monthly_plan" ||
      !fromMonthly.has(`${row.title.trim().toLowerCase()}|${row.date ?? ""}`)
  );
}

/**
 * The one milestone the portfolio table should name.
 *
 * Overdue outranks upcoming: a commitment that has already slipped is what
 * management needs to see, and showing the next future date instead would hide
 * it. Completed milestones are never offered — they are not outstanding.
 */
export function nextDueMilestone(rows: MilestoneRow[], today: string): MilestoneRow | undefined {
  const outstanding = rows.filter((row) => row.statusLabel !== "Completed" && row.date);

  const overdue = outstanding
    .filter((row) => (row.date as string) < today)
    .sort((a, b) => (b.date as string).localeCompare(a.date as string));
  if (overdue.length) return overdue[0];

  const upcoming = outstanding
    .filter((row) => (row.date as string) >= today)
    .sort((a, b) => (a.date as string).localeCompare(b.date as string));
  if (upcoming.length) return upcoming[0];

  // Undated but outstanding: still a real commitment, just unschedulable.
  return rows.find((row) => row.statusLabel !== "Completed" && !row.date);
}

export function isOverdueMilestone(row: MilestoneRow | undefined, today: string): boolean {
  return Boolean(row?.date && row.date < today && row.statusLabel !== "Completed");
}

/* ------------------------------ Open actions ------------------------------- */

export interface OpenActionSummary {
  total: number;
  overdue: number;
}

const UNRESOLVED_STATUSES = new Set(["open", "in_progress", "pending", "escalated"]);

/**
 * The real unresolved action position for one project.
 *
 * Counts Monthly action items plus post-baseline Weekly actions, and counts
 * each commitment ONCE: any Weekly entry already compiled into the Monthly is
 * identified through `monthly_comments.source_weekly_entry_id` and skipped, so
 * the same action cannot be counted at both tiers.
 *
 * Resolved and Closed are excluded — the column reports what is still owed, not
 * how much work the project has ever recorded.
 */
export function openActionSummary(input: {
  comments: MonthlyComment[];
  laterWeeklies: WeeklyReport[];
  entriesByWeekly: Map<string, WeeklyEntry[]>;
  today: string;
}): OpenActionSummary {
  const { comments, laterWeeklies, entriesByWeekly, today } = input;

  const compiled = new Set(
    comments.map((comment) => comment.sourceWeeklyEntryId).filter((id): id is string => Boolean(id))
  );

  let total = 0;
  let overdue = 0;

  for (const comment of comments) {
    if (!comment.includeInFinal) continue;
    if (comment.updateType !== "action") continue;
    if (!UNRESOLVED_STATUSES.has(comment.status)) continue;
    total += 1;
    if (comment.targetDate && comment.targetDate < today) overdue += 1;
  }

  for (const weekly of laterWeeklies) {
    for (const entry of entriesByWeekly.get(weekly.id) ?? []) {
      if (entry.entryType !== "action") continue;
      if (compiled.has(entry.id)) continue;
      if (!UNRESOLVED_STATUSES.has(entry.status)) continue;
      total += 1;
      if (entry.dueDate && entry.dueDate < today) overdue += 1;
    }
  }

  return { total, overdue };
}

/** Milestones still ahead, or recently passed but not yet completed. */
export function upcomingMilestones(rows: MilestoneRow[], today: string, limit = 12): MilestoneRow[] {
  return rows
    .filter((row) => row.statusLabel !== "Completed")
    .filter((row) => !row.date || row.date >= today)
    .slice(0, limit);
}

/* ---------------------------- Weekly movement ------------------------------ */

export type MovementKind =
  | "new_risk"
  | "new_client_dependency"
  | "new_achievement"
  | "new_action"
  | "status_changed"
  | "milestone_changed";

export const MOVEMENT_META: Record<MovementKind, { label: string; tone: StatusTone }> = {
  new_risk: { label: "New Risk", tone: "danger" },
  new_client_dependency: { label: "New Client Dependency", tone: "warning" },
  new_achievement: { label: "New Achievement", tone: "success" },
  new_action: { label: "New Action", tone: "info" },
  status_changed: { label: "Status Changed", tone: "warning" },
  milestone_changed: { label: "Milestone Changed", tone: "warning" },
};

export const NO_MOVEMENT = "No material change since Monthly";

export interface MovementItem {
  id: string;
  kind: MovementKind;
  label: string;
  tone: StatusTone;
  text: string;
  weekNumber?: number;
}

/** Which Weekly entry types count as which movement. Comments are not movement. */
function movementKindFor(entry: WeeklyEntry): MovementKind | undefined {
  if (entry.entryType === "risk" || entry.entryType === "issue") return "new_risk";
  if (entry.entryType === "decision") return "new_client_dependency";
  if (entry.entryType === "action") return "new_action";
  if (entry.updateType === "achievement") return "new_achievement";
  return undefined;
}

export interface MovementInput {
  monthly?: MonthlyReport;
  /** Every Monthly comment on the selected report — supplies the dedupe set. */
  monthlyComments: MonthlyComment[];
  /** Weeklies for this project whose period falls AFTER the Monthly's month. */
  laterWeeklies: WeeklyReport[];
  /** Entries belonging to those weeklies, keyed by weekly report id. */
  entriesByWeekly: Map<string, WeeklyEntry[]>;
  /** Plan items belonging to those weeklies, keyed by weekly report id. */
  plansByWeekly: Map<string, WeeklyPlanItem[]>;
  limit?: number;
}

/**
 * What has moved since the official Monthly position — the freshness layer.
 *
 * **The dedupe is exact, not heuristic.** `monthly_comments.source_weekly_entry_id`
 * is a unique FK onto `weekly_entries.id`, so an entry already compiled into the
 * Monthly is identified by id and excluded. Nothing is matched on text, and
 * nothing already reported at the Monthly tier is repeated here.
 *
 * Only weeklies whose period falls after the Monthly's month are considered:
 * a Weekly inside the month is what the Monthly compiled, not movement past it.
 */
export function changesSinceMonthly(input: MovementInput): MovementItem[] {
  const { monthly, monthlyComments, laterWeeklies, entriesByWeekly, plansByWeekly, limit = 4 } = input;

  const compiled = new Set(
    monthlyComments
      .map((comment) => comment.sourceWeeklyEntryId)
      .filter((id): id is string => Boolean(id))
  );

  const items: MovementItem[] = [];
  const ordered = [...laterWeeklies].sort((a, b) => a.periodStart.localeCompare(b.periodStart));

  for (const weekly of ordered) {
    for (const entry of entriesByWeekly.get(weekly.id) ?? []) {
      if (compiled.has(entry.id)) continue;
      // Settled items are not movement — they are history.
      if (entry.status === "resolved" || entry.status === "closed") continue;
      const kind = movementKindFor(entry);
      if (!kind) continue;
      const meta = MOVEMENT_META[kind];
      items.push({
        id: entry.id,
        kind,
        label: meta.label,
        tone: meta.tone,
        text: entry.description.replace(/\s+/g, " "),
        weekNumber: weekly.weekNumber,
      });
    }

    for (const plan of plansByWeekly.get(weekly.id) ?? []) {
      if (plan.kind !== "milestone" || plan.status !== "delayed") continue;
      const meta = MOVEMENT_META.milestone_changed;
      items.push({
        id: plan.id,
        kind: "milestone_changed",
        label: meta.label,
        tone: meta.tone,
        text: `${plan.title} reported delayed`,
        weekNumber: weekly.weekNumber,
      });
    }
  }

  // A changed overall verdict is movement in its own right, and outranks the
  // individual items because it is the project's own summary of them.
  const latest = ordered.at(-1);
  if (latest?.overallProgressStatus && monthly?.overallProgressStatus) {
    if (latest.overallProgressStatus !== monthly.overallProgressStatus) {
      const meta = MOVEMENT_META.status_changed;
      items.unshift({
        id: `status-${latest.id}`,
        kind: "status_changed",
        label: meta.label,
        tone: meta.tone,
        text: `${PROGRESS_STATUS_META[monthly.overallProgressStatus].label} → ${PROGRESS_STATUS_META[latest.overallProgressStatus].label}`,
        weekNumber: latest.weekNumber,
      });
    }
  }

  return items.slice(0, limit);
}

/* ------------------------------ Project rows ------------------------------- */

export interface ProjectExecutiveRow {
  project: Project;
  projectName: string;
  clientName: string;
  managerName?: string;
  basis: MonthlyBasis;
  monthly?: MonthlyReport;
  monthlyStatusLabel?: string;
  planned?: number;
  actual?: number;
  variance?: number;
  reading: HealthReading;
  attention: AttentionItem[];
  risks: AttentionItem[];
  decisions: AttentionItem[];
  clientActions: AttentionItem[];
  achievements: AttentionItem[];
  overdue: AttentionItem[];
  /** Unresolved actions across both tiers, deduped. See openActionSummary(). */
  openActions: OpenActionSummary;
  keyConcern?: AttentionItem;
  /** Nearest overdue milestone, else nearest upcoming. See nextDueMilestone(). */
  nextMilestone?: MilestoneRow;
  nextMilestoneOverdue: boolean;
  milestones: MilestoneRow[];
  movement: MovementItem[];
  /** Governed Master Milestone current state for this project, read-only. */
  milestoneStates: MilestoneState[];
}

/** Attention-first, then worst variance, then name — a stable, meaningful order. */
export function byAttention(a: ProjectExecutiveRow, b: ProjectExecutiveRow): number {
  const rank = EXEC_HEALTH_ORDER.indexOf(a.reading.health) - EXEC_HEALTH_ORDER.indexOf(b.reading.health);
  if (rank !== 0) return rank;
  const av = a.variance ?? 0;
  const bv = b.variance ?? 0;
  if (av !== bv) return av - bv;
  return a.projectName.localeCompare(b.projectName);
}

/* ------------------------------- Aggregation ------------------------------- */

export interface PortfolioAggregate {
  /** Projects in view after access and filter, whatever their basis. */
  totalProjects: number;
  activeProjects: number;
  /** Rows whose basis is `approved` — the only rows behind the figures below. */
  contributing: number;
  excludedDraft: number;
  excludedMissing: number;
  planned?: number;
  actual?: number;
  variance?: number;
  health: Record<ExecHealth, number>;
  openDecisions: number;
  clientPendingActions: number;
  overdueActions: number;
  openRisks: number;
  /** Unresolved actions across the portfolio, deduped per project. */
  openActionsTotal: number;
  /** One sentence declaring what the figures are computed from (§7.4). */
  basisNote: string;
  /** True when no approved Monthly exists at all — the compact honest state. */
  noApprovedBasis: boolean;
  /**
   * The position including unapproved Monthly data.
   *
   * PRESENTATION ONLY, for the narrative. The official figures above remain
   * approved-only and are unchanged — this exists so the summary can tell
   * leadership where the portfolio actually stands while saying plainly that
   * the figure is provisional, instead of opening with a refusal to answer.
   */
  provisionalPlanned?: number;
  provisionalActual?: number;
  provisionalVariance?: number;
  provisionalCount: number;
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

/**
 * Portfolio position.
 *
 * **Only approved rows contribute.** Draft and missing rows are counted and
 * named as exclusions rather than folded in, so a total can never quietly
 * include unapproved data or treat an absent report as a zero.
 *
 * The mean is unweighted and says so: no project value, budget or man-hour
 * weight exists anywhere in the schema, so a weighted roll-up would require
 * inventing the denominator (Phase 1, §D).
 */
export function aggregatePortfolio(rows: ProjectExecutiveRow[]): PortfolioAggregate {
  const approved = rows.filter((row) => row.basis === "approved");
  const excludedDraft = rows.filter((row) => row.basis === "draft").length;
  const excludedMissing = rows.filter((row) => row.basis === "none").length;

  const health = EXEC_HEALTH_ORDER.reduce(
    (acc, key) => ({ ...acc, [key]: 0 }),
    {} as Record<ExecHealth, number>
  );
  for (const row of rows) health[row.reading.health] += 1;

  const planned = mean(approved.map((row) => row.planned ?? 0));
  const actual = mean(approved.map((row) => row.actual ?? 0));

  // Same arithmetic over every row that reported anything, approved or not.
  // Never shown as an official figure — only the narrative uses it, and only
  // while calling it provisional.
  const reporting = rows.filter((row) => row.monthly !== undefined);
  const provisionalPlanned = mean(reporting.map((row) => row.planned ?? 0));
  const provisionalActual = mean(reporting.map((row) => row.actual ?? 0));

  // Attention counts read every row the viewer can see, approved or not: an
  // unapproved project's open risk is still a risk leadership should know about.
  // The KPI tiles label them accordingly, so this is never confused with an
  // approved portfolio figure.
  const all = rows.flatMap((row) => row.attention);
  const openOf = (kind: AttentionKind) => openItems(all, kind).length;

  const noApprovedBasis = approved.length === 0;
  const basisNote = noApprovedBasis
    ? "Provisional — no approved Monthly Report for this period."
    : `Unweighted mean of ${approved.length} approved Monthly Report${approved.length === 1 ? "" : "s"}` +
      (excludedDraft || excludedMissing
        ? `; ${excludedDraft + excludedMissing} project${excludedDraft + excludedMissing === 1 ? "" : "s"} not yet approved.`
        : ".");

  return {
    totalProjects: rows.length,
    activeProjects: rows.filter((row) => row.project.status === "active").length,
    contributing: approved.length,
    excludedDraft,
    excludedMissing,
    planned,
    actual,
    variance: planned !== undefined && actual !== undefined ? scheduleVariance(planned, actual) : undefined,
    health,
    openDecisions: openOf("decision"),
    clientPendingActions: openOf("client_action"),
    overdueActions: all.filter((item) => item.overdue).length,
    openRisks: openOf("risk"),
    // Already deduped per project by openActionSummary(); summing is safe.
    openActionsTotal: rows.reduce((sum, row) => sum + row.openActions.total, 0),
    basisNote,
    noApprovedBasis,
    provisionalPlanned,
    provisionalActual,
    provisionalVariance:
      provisionalPlanned !== undefined && provisionalActual !== undefined
        ? scheduleVariance(provisionalPlanned, provisionalActual)
        : undefined,
    provisionalCount: reporting.length,
  };
}

/* ------------------------------- Sign-off ---------------------------------- */

export interface PreparedByPerson {
  contactId: string;
  name: string;
  /** The person's configured business job title — never a platform role. */
  title?: string;
  /** The projects this person is the responsible preparer for. */
  projects: string[];
}

export interface PreparedBy {
  people: PreparedByPerson[];
  /** Shown when no preparer can be resolved for some or all projects. */
  placeholder?: string;
}

/**
 * Who prepared the Executive Report, from project responsibility data.
 *
 * NOT the signed-in account. "System Administrator" is a platform permission,
 * not a business responsibility, and printing it on a controlled document
 * misattributes authorship to whoever happened to open the page.
 *
 * Resolution, per the approved rule:
 *
 *   per project ....... its Reporting Coordinator, falling back to Project
 *                       Control Manager where that project records none
 *   deduplicated ...... one person appears once, carrying every project they
 *                       are responsible for
 *   nobody at all ..... "Not assigned"
 *
 * EVERY unique preparer is returned, not just the first. A portfolio spanning
 * several projects is prepared by several people, and printing only one of them
 * would attribute the whole document to somebody who prepared part of it.
 * Projects with no preparer are named in the placeholder rather than passed
 * over in silence.
 */
export function resolvePreparedBy(
  rows: ProjectExecutiveRow[],
  contacts: Contact[]
): PreparedBy {
  if (rows.length === 0) return { people: [], placeholder: "Not assigned" };

  const byContact = new Map<string, PreparedByPerson>();
  const unresolved: string[] = [];

  for (const row of rows) {
    const contactId = row.project.reportingCoordinatorId ?? row.project.projectControlManagerId;
    const contact = contactId ? contacts.find((record) => record.id === contactId) : undefined;

    if (!contact) {
      unresolved.push(row.projectName);
      continue;
    }

    const held = byContact.get(contact.id);
    if (held) {
      held.projects.push(row.projectName);
      continue;
    }
    byContact.set(contact.id, {
      contactId: contact.id,
      name: contact.name,
      title: contact.position?.trim() || undefined,
      projects: [row.projectName],
    });
  }

  const people = [...byContact.values()].sort((a, b) => a.name.localeCompare(b.name));

  if (people.length === 0) return { people: [], placeholder: "Not assigned" };

  return {
    people,
    placeholder: unresolved.length
      ? `To be assigned — ${unresolved.join(", ")}`
      : undefined,
  };
}

/* --------------------------- Distribution helpers -------------------------- */

/**
 * Which way a project's variance points.
 *
 * The middle band is the platform's OWN "on schedule" threshold, not a new one:
 * `recommendScheduleStatus()` treats SV ≥ −3 points as on schedule, so a
 * project between −3 and 0 is behind plan but within tolerance — Acceptable.
 * Anything worse is Unfavourable, anything ahead is Favourable.
 *
 * Reusing the documented threshold is the point. Inventing a ±5% band for the
 * sake of a nicer-looking ring would put a number on screen that no rule in the
 * platform supports.
 */
export type VarianceBucket = "favourable" | "acceptable" | "unfavourable";

/** The canonical on-schedule tolerance, in percentage points. */
export const VARIANCE_TOLERANCE = -3;

export const VARIANCE_BUCKET_META: Record<VarianceBucket, { label: string; tone: StatusTone; note: string }> = {
  favourable: { label: "Favourable", tone: "success", note: "Ahead of plan" },
  acceptable: { label: "Acceptable", tone: "info", note: "Within the on-schedule tolerance" },
  unfavourable: { label: "Unfavourable", tone: "danger", note: "Beyond the on-schedule tolerance" },
};

export const VARIANCE_BUCKET_ORDER: VarianceBucket[] = ["favourable", "acceptable", "unfavourable"];

export function varianceBucketOf(variance: number | undefined): VarianceBucket | undefined {
  if (variance === undefined) return undefined;
  if (variance > 0) return "favourable";
  if (variance >= VARIANCE_TOLERANCE) return "acceptable";
  return "unfavourable";
}

export function varianceDistribution(rows: ProjectExecutiveRow[]): Record<VarianceBucket, number> {
  const counts: Record<VarianceBucket, number> = { favourable: 0, acceptable: 0, unfavourable: 0 };
  for (const row of rows) {
    const bucket = varianceBucketOf(row.variance);
    if (bucket) counts[bucket] += 1;
  }
  return counts;
}

/**
 * Open risks by priority, across the portfolio.
 *
 * All four stored priorities are reported separately. Collapsing Critical into
 * High would be a presentation decision that loses the distinction the data
 * actually records.
 */
export const PRIORITY_ORDER_DESC: Priority[] = ["critical", "high", "medium", "low"];

export function riskPriorityCounts(rows: ProjectExecutiveRow[]): Record<Priority, number> {
  const counts: Record<Priority, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const row of rows) {
    for (const risk of row.risks) counts[risk.priority] += 1;
  }
  return counts;
}

/** Project lifecycle status counts — master-data state, not reporting health. */
export function projectStatusCounts(rows: ProjectExecutiveRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const status = row.project.status;
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return counts;
}

/* --------------------------- Executive narrative --------------------------- */

/**
 * Draft the portfolio narrative from figures that are already reported.
 *
 * Every clause is conditional on its source existing, so an empty portfolio
 * produces a short honest paragraph rather than a template full of dashes.
 * This is derived and read-only in this increment — there is no Executive
 * record to author into yet.
 */
export function draftExecutiveNarrative(input: {
  rows: ProjectExecutiveRow[];
  aggregate: PortfolioAggregate;
  monthLabel: string;
  /** Executive Notes explicitly flagged for the summary. */
  notes?: { body: string; projectId?: string }[];
}): string {
  const { rows, aggregate, monthLabel, notes = [] } = input;
  const sentences: string[] = [];
  const count = aggregate.totalProjects;

  /* 1–2 · Period and coverage. */
  sentences.push(
    `${monthLabel} Portfolio Summary: the portfolio currently includes ` +
      `${count} project${count === 1 ? "" : "s"}.`
  );

  /* 3–4 · Position and schedule health. */
  const planned = aggregate.planned ?? aggregate.provisionalPlanned;
  const actual = aggregate.actual ?? aggregate.provisionalActual;
  const variance = aggregate.variance ?? aggregate.provisionalVariance;

  if (planned !== undefined && actual !== undefined && variance !== undefined) {
    if (count === 1 && rows[0]) {
      // One project: name it and speak about it directly. A "portfolio mean"
      // of a single project is a roundabout way of saying the same thing.
      const row = rows[0];
      sentences.push(
        `The ${row.projectName} project is reporting ${actual.toFixed(1)}% actual progress against ` +
          `${planned.toFixed(1)}% planned, with a schedule variance of ` +
          `${variance > 0 ? "+" : ""}${variance.toFixed(1)}% and a ${row.reading.label} schedule health status.`
      );
    } else {
      sentences.push(
        `Portfolio actual progress stands at ${actual.toFixed(1)}% against ${planned.toFixed(1)}% planned ` +
          `(SV ${variance > 0 ? "+" : ""}${variance.toFixed(1)}%).`
      );
      const spread = EXEC_HEALTH_ORDER.filter((health) => aggregate.health[health] > 0)
        .map((health) => `${aggregate.health[health]} ${EXEC_HEALTH_META[health].label}`)
        .join(", ");
      if (spread) sentences.push(`Schedule health across the portfolio: ${spread}.`);
    }
  }

  /* 5 · What needs attention. */
  const attention = rows.filter((row) => row.reading.health === "critical" || row.reading.health === "delayed");
  if (attention.length && count > 1) {
    sentences.push(
      `Requiring management attention: ${attention.map((row) => row.projectName).join(", ")}.`
    );
  }

  /* 6 · The single principal concern, if one is recorded. */
  const principal = [
    ...rows.flatMap((row) => row.decisions),
    ...rows.flatMap((row) => row.risks),
    ...rows.flatMap((row) => row.clientActions),
  ].sort(bySeverity)[0];
  if (principal) {
    sentences.push(
      `The principal management concern is ${principal.text.replace(/\.$/, "")}` +
        (count > 1 ? ` (${principal.projectName}).` : ".")
    );
  }

  /*
   * Executive commentary closes the summary, and is attributed as such: it is
   * authored judgement, not a compiled figure, and `03` §6.3 requires the two
   * to stay visibly distinct.
   */
  if (notes.length) {
    sentences.push(
      `Executive commentary: ${notes.map((note) => note.body.trim().replace(/\.$/, "")).join("; ")}.`
    );
  }

  /*
   * 7 · Approval coverage — LAST, stated once, in plain language.
   *
   * This is the only place the summary mentions approval. The caveat belongs at
   * the end: leadership needs the position first and its provenance second, not
   * a paragraph of qualification before any figure appears.
   */
  if (aggregate.noApprovedBasis) {
    sentences.push(
      "No approved Monthly Report is available for the selected period; portfolio figures are therefore provisional " +
        "and are not included in the official approved portfolio position."
    );
  } else if (aggregate.excludedDraft || aggregate.excludedMissing) {
    const pending = aggregate.excludedDraft + aggregate.excludedMissing;
    sentences.push(
      `Portfolio figures are compiled from ${aggregate.contributing} approved Monthly Report` +
        `${aggregate.contributing === 1 ? "" : "s"}; ${pending} project${pending === 1 ? "" : "s"} ` +
        `remain${pending === 1 ? "s" : ""} provisional pending approval.`
    );
  } else {
    sentences.push(
      `Portfolio figures are compiled from ${aggregate.contributing} approved Monthly Report` +
        `${aggregate.contributing === 1 ? "" : "s"}.`
    );
  }

  return sentences.join(" ");
}

/* --------------------------------- Periods --------------------------------- */

/** Reporting months that actually hold a Monthly Report, newest first. */
export function availableMonths(reports: MonthlyReport[]): string[] {
  return [...new Set(reports.map((report) => report.reportingMonth.slice(0, 7)))].sort((a, b) => b.localeCompare(a));
}

export function monthLabelOf(month: string): string {
  return parseISO(`${month}-01`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/** Presentation label for a Monthly report's lifecycle state. */
export function monthlyStatusLabel(report: MonthlyReport): string {
  return REPORT_STATUS_META[report.status]?.label ?? report.status;
}

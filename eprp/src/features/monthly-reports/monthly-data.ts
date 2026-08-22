/**
 * Monthly derivations — pure functions over data that already exists.
 *
 * Nothing here invents a value. Where the Monthly data model has no source for
 * something the report layout asks for (HSE event counts, a next-month planned
 * target, a numeric progress per scope item beyond what Weekly recorded), the
 * derivation returns `undefined` and the view renders a compact "Not recorded"
 * rather than a placeholder number.
 */

import { format, parseISO } from "date-fns";

import { ENTRY_STATUS_META, KPI_RATING_META, PROGRESS_STATUS_META, SUBMISSION_HEALTH_META } from "@/lib/constants";
import type { StatusTone } from "@/components/shared/status-badge";
import type {
  Contact,
  MonthlyComment,
  MonthlyDepartmentSummary,
  MonthlyReport,
  Project,
  WeeklyReport,
  WeeklySubmission,
} from "@/types";

import type { MonthlyCompilationResult } from "@/services/monthly-report-service";

/**
 * What to tell the user after a compilation run.
 *
 * A Weekly that is visible but not yet approved is deliberately not compiled
 * (P0.4). Saying so is the difference between a rule and an apparent bug.
 */
export function compilationMessage(result: MonthlyCompilationResult): string {
  const base =
    result.compiledFromReports === 0
      ? "No approved Weekly Reports for this month."
      : `Monthly items updated from ${result.compiledFromReports} approved Weekly Report${result.compiledFromReports === 1 ? "" : "s"}.`;
  if (result.skippedUnapprovedReports === 0) return base;
  return `${base} ${result.skippedUnapprovedReports} Weekly Report${result.skippedUnapprovedReports === 1 ? " was" : "s were"} not compiled - not yet approved (${result.skippedStatuses.join(", ")}).`;
}

/** Text used everywhere a real value is genuinely absent. */
export const NOT_RECORDED = "Not recorded";

export interface NamedRecord {
  id: string;
  name: string;
}

export function nameOf(id: string | undefined, rows: NamedRecord[], fallback = NOT_RECORDED): string {
  if (!id) return fallback;
  return rows.find((row) => row.id === id)?.name ?? fallback;
}

/* ----------------------------- Month-end status ---------------------------- */

export interface DerivedStatus {
  label: string;
  tone: StatusTone;
  detail?: string;
}

/**
 * The month-end verdict shown in Report Information.
 *
 * An explicitly recorded `overallProgressStatus` always wins — a human judged
 * the month and that judgement is data. Only when none was recorded is the
 * verdict derived from schedule variance, and the label then says so.
 */
export function monthEndStatus(report: MonthlyReport): DerivedStatus {
  const variance = report.scheduleVariance;
  const detail = `${variance > 0 ? "+" : ""}${variance.toFixed(1)}% vs plan`;

  if (report.overallProgressStatus) {
    const meta = PROGRESS_STATUS_META[report.overallProgressStatus];
    return { label: meta.label, tone: meta.tone, detail };
  }

  if (variance >= 0) return { label: "On Plan", tone: "success", detail };
  if (variance >= -1) return { label: "On Track", tone: "success", detail };
  if (variance >= -5) return { label: "Delayed", tone: "warning", detail };
  return { label: "Critical", tone: "danger", detail };
}

/** Per-week schedule verdict for the Weekly Breakdown table. */
export function weekStatus(planned: number, actual: number): DerivedStatus {
  const variance = actual - planned;
  if (variance >= -3) return { label: "On Schedule", tone: "success" };
  if (variance >= -8) return { label: "Delayed", tone: "warning" };
  return { label: "Critical", tone: "danger" };
}

export function commentStatusMeta(status: MonthlyComment["status"]): { label: string; tone: StatusTone } {
  if (status === "pending") return { label: "Pending", tone: "warning" };
  return ENTRY_STATUS_META[status];
}

export function nextMonthLabel(reportingMonth: string): string {
  const date = parseISO(`${reportingMonth.slice(0, 7)}-01`);
  date.setMonth(date.getMonth() + 1);
  return format(date, "MMMM yyyy");
}

/* ------------------------------- Scope status ------------------------------ */

export interface ScopeStatusRow {
  key: string;
  /** Programme & Study / Discipline name, or the department when unscoped. */
  scopeName: string;
  departmentName: string;
  systemName?: string;
  status?: DerivedStatus;
  /** Sourced from the Weekly submission; Monthly stores no progress column. */
  progressPercent?: number;
  latestUpdate?: string;
  responsibleName?: string;
}

export interface WeeklySubmissionInMonth {
  weekNumber: number;
  submission: WeeklySubmission;
}

/**
 * Section 4 rows — one per reported scope item.
 *
 * Union of what actually carries data this month: Monthly comments that name a
 * scope item, Monthly department summaries, and Weekly submissions. Scope items
 * the project holds but nobody reported against are omitted, because an empty
 * row asserts "reported, nothing to say" and that is not what silence means.
 *
 * Progress % comes from the latest Weekly submission for the scope item. Weekly
 * is the canonical operational source and it is read here, never written.
 */
export function buildScopeStatusRows(input: {
  comments: MonthlyComment[];
  summaries: MonthlyDepartmentSummary[];
  submissions: WeeklySubmissionInMonth[];
  departments: NamedRecord[];
  systems: NamedRecord[];
  disciplines: NamedRecord[];
  contacts: NamedRecord[];
}): ScopeStatusRow[] {
  const { comments, summaries, submissions, departments, systems, disciplines, contacts } = input;
  const rows = new Map<string, ScopeStatusRow>();

  /**
   * A scope item is identified by department + scope item, NOT by System.
   *
   * Weekly submissions are department/discipline-grained and carry no System,
   * while Monthly comments do. Keying on the System too would split one real
   * scope item into two rows — the Weekly half holding the progress figure and
   * the Monthly half holding the narrative. The System is an attribute of the
   * row, filled in by whichever source knows it.
   */
  const keyFor = (departmentId: string, disciplineId?: string) => `${departmentId}:${disciplineId ?? ""}`;

  const ensure = (departmentId?: string, systemId?: string, disciplineId?: string) => {
    if (!departmentId) return undefined;
    const key = keyFor(departmentId, disciplineId);
    const held = rows.get(key);
    if (held) {
      if (systemId && !held.systemName) held.systemName = nameOf(systemId, systems, NOT_RECORDED);
      return held;
    }
    const created: ScopeStatusRow = {
      key,
      scopeName: disciplineId ? nameOf(disciplineId, disciplines) : nameOf(departmentId, departments),
      departmentName: nameOf(departmentId, departments),
      systemName: systemId ? nameOf(systemId, systems, NOT_RECORDED) : undefined,
    };
    rows.set(key, created);
    return created;
  };

  // Weekly submissions first: they carry the only numeric progress available.
  for (const { submission } of [...submissions].sort((a, b) => a.weekNumber - b.weekNumber)) {
    const row = ensure(submission.departmentId, undefined, submission.disciplineId);
    if (!row) continue;
    if (typeof submission.progressPercent === "number") row.progressPercent = submission.progressPercent;
    if (submission.healthStatus) {
      const meta = SUBMISSION_HEALTH_META[submission.healthStatus];
      row.status = { label: meta.label, tone: meta.tone };
    }
    const text = submission.summary?.trim() || submission.keyAchievement?.trim();
    if (text) row.latestUpdate = text;
    if (submission.responsibleContactId) {
      row.responsibleName = nameOf(submission.responsibleContactId, contacts);
    }
  }

  // Monthly department summaries override the narrative where one was written.
  for (const summary of summaries) {
    const row = ensure(summary.departmentId, summary.systemId, summary.disciplineId);
    if (!row) continue;
    const text = summary.monthlySummary?.trim() || summary.keyAchievements?.trim();
    if (text) row.latestUpdate = text;
  }

  // Monthly comments are the most recent word on the scope item.
  const scoped = comments
    .filter((comment) => comment.includeInFinal && comment.departmentId)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const comment of scoped) {
    const row = ensure(comment.departmentId, comment.systemId, comment.disciplineId);
    if (!row) continue;
    row.latestUpdate = comment.presentationText?.trim() || comment.originalText.trim();
    row.status = commentStatusMeta(comment.status);
    if (comment.responsibleContactId) row.responsibleName = nameOf(comment.responsibleContactId, contacts);
  }

  return [...rows.values()].sort((a, b) =>
    a.departmentName.localeCompare(b.departmentName) || a.scopeName.localeCompare(b.scopeName)
  );
}

/* --------------------------- Responsibility resolve ------------------------ */

/**
 * Who signs the report, resolved from project responsibility assignments.
 *
 * Falls back through the project's recorded roles rather than naming anybody
 * arbitrarily: an unresolved slot renders blank for wet signature, which is
 * what an unassigned role means on a controlled document.
 */
export function resolveApprovers(report: MonthlyReport, project: Project | null) {
  return {
    preparedByContactId: report.preparedByContactId ?? project?.reportingCoordinatorId,
    reviewedByContactId: report.reviewedByContactId ?? project?.projectControlManagerId,
    approvedByContactId: report.approvedByContactId ?? project?.projectManagerId,
  };
}

export function contactLine(contact: Contact | undefined): string | undefined {
  if (!contact) return undefined;
  return contact.position ? `${contact.name} — ${contact.position}` : contact.name;
}

/* ---------------------------- Executive summary ---------------------------- */

/**
 * Draft the Executive Summary from Monthly data that is already recorded.
 *
 * Every clause is conditional on its source existing. With an empty report this
 * returns an empty string and the caller reports that nothing could be drafted,
 * rather than emitting a template full of dashes.
 */
export function autoDraftExecutiveSummary(input: {
  report: MonthlyReport;
  project: Project | null;
  clientName?: string;
  comments: MonthlyComment[];
  weeklies: WeeklyReport[];
  monthLabel: string;
}): string {
  const { report, project, clientName, comments, weeklies, monthLabel } = input;
  const included = comments.filter((comment) => comment.includeInFinal);
  const sentences: string[] = [];

  const subject = [project?.name ?? project?.code, clientName ? `(${clientName})` : undefined]
    .filter(Boolean)
    .join(" ");
  const variance = report.scheduleVariance;
  const status = monthEndStatus(report);

  sentences.push(
    `${[subject, monthLabel].filter(Boolean).join(" — ")}: cumulative progress reached ` +
      `${report.actualProgress.toFixed(1)}% actual against ${report.plannedProgress.toFixed(1)}% planned ` +
      `(SV ${variance > 0 ? "+" : ""}${variance.toFixed(1)}%, ${status.label}).`
  );

  // Two weeks minimum, for the same reason the KPI tile needs two: one week
  // gives no opening position to measure the month's gain against.
  if (weeklies.length >= 2) {
    const gained = report.actualProgress - weeklies[0].actualProgress;
    if (Number.isFinite(gained)) {
      sentences.push(
        `The project gained ${gained >= 0 ? "" : "-"}${Math.abs(gained).toFixed(1)} points across ` +
          `${weeklies.length} reporting weeks.`
      );
    }
  }

  const latestWeekly = weeklies.at(-1);
  if (latestWeekly?.manHoursToDate) {
    sentences.push(`Man-hours to date stand at ${latestWeekly.manHoursToDate.toLocaleString()}.`);
  }
  if (report.hseStatus) {
    sentences.push(`HSE performance is rated ${KPI_RATING_META[report.hseStatus].label.toLowerCase()}.`);
  }
  if (report.qualityStatus) {
    sentences.push(`Quality performance is rated ${KPI_RATING_META[report.qualityStatus].label.toLowerCase()}.`);
  }

  const group = (types: MonthlyComment["updateType"][]) =>
    included
      .filter((comment) => types.includes(comment.updateType))
      .map((comment) => (comment.presentationText?.trim() || comment.originalText.trim()).replace(/\.$/, ""));

  const achievements = group(["achievement"]);
  if (achievements.length) sentences.push(`Key achievements: ${achievements.join("; ")}.`);

  const progress = group(["progress_update", "general"]);
  if (progress.length) sentences.push(`Progress this month: ${progress.join("; ")}.`);

  const constraints = group(["challenge_constraint", "risk_issue"]);
  if (constraints.length) sentences.push(`Constraints and risks: ${constraints.join("; ")}.`);

  const actions = group(["action"]);
  if (actions.length) sentences.push(`Outstanding with the client: ${actions.join("; ")}.`);

  const decisions = group(["decision_management_support"]);
  if (decisions.length) sentences.push(`Management support required: ${decisions.join("; ")}.`);

  const nextMonth = group(["next_month_plan"]);
  if (nextMonth.length) sentences.push(`Next month focus: ${nextMonth.join("; ")}.`);

  return sentences.join(" ");
}

import type {
  ActivityStatus,
  CommentCategory,
  EntryStatus,
  IsoDate,
  IsoDateTime,
  KpiRating,
  Priority,
  ProgressStatus,
  ReportSource,
  ReportStatus,
  SubmissionHealthStatus,
  SubmissionStatus,
  WeeklyEntryType,
  WeeklyPlanStatus,
  WeeklyUpdateType,
} from "./core";

/* -------------------------------- Sign-off --------------------------------- */

/**
 * One person on a report's signature block.
 *
 * Declared HERE rather than imported from `features/executive-reports`:
 * `executive-signatories.ts` imports `PreparedBy` from `executive-data.ts`,
 * which imports from `@/types` — so importing it back into this file would
 * close a module cycle. The two declarations are structurally identical, which
 * is what lets the shared editor and parser serve both report tiers.
 *
 * `contactId` is provenance only. It is deliberately NOT a foreign key: the
 * name and title are a COPY taken at save time, so correcting a Contact later
 * cannot rewrite a report that was already signed.
 */
export interface ReportSignatory {
  id: string;
  name: string;
  /** Job title as it should PRINT, snapshotted at save time. */
  title?: string;
  /** Where the name was picked from. Never re-resolved on read. */
  contactId?: string;
  projects?: string[];
}

export type ReportSignatoryRole = "prepared" | "reviewed" | "approved";

export type SignatorySnapshot = Partial<
  Record<ReportSignatoryRole, ReportSignatory[]>
>;

/** File attached to a report, submission, or comment. */
export interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByContactId?: string;
  uploadedAt: IsoDateTime;
  /** Storage path or URL — resolved by the attachment service later. */
  storageRef: string;
}

/** Base fields shared by every report type. */
interface ReportBase {
  id: string;
  /** Human-readable report number, e.g. "EPR-W-2026-031". */
  reportNumber: string;
  projectId: string;
  status: ReportStatus;
  source: ReportSource;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  preparedByContactId?: string;
  reviewedByContactId?: string;
  approvedByContactId?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  attachmentIds: string[];
}

/* --------------------------------- Weekly --------------------------------- */

/**
 * One department/discipline's input into a weekly report — the row behind
 * the "Department Updates" section.
 *
 * The `accomplishments` / `plannedNextWeek` / `blockers` arrays remain the
 * multi-entry storage used by the detailed Phase 6B form; the singular
 * `keyAchievement` / `nextWeekPlan` / `delayConstraint` fields are what the
 * Phase 6A.3 summary row captures.
 */
export interface WeeklySubmission {
  id: string;
  weeklyReportId: string;
  departmentId: string;
  /** Discipline within the department (master-data id). */
  disciplineId?: string;
  status: SubmissionStatus;
  progressDelta?: number; // percentage points gained this week
  /** Cumulative progress for this department, 0-100. */
  progressPercent?: number;
  summary?: string;
  keyAchievement?: string;
  delayConstraint?: string;
  nextWeekPlan?: string;
  responsibleContactId?: string;
  targetDate?: IsoDate;
  /** Department verdict on the work (spec section 7). */
  healthStatus?: SubmissionHealthStatus;
  /** Free-text risks / issues summary for this row. */
  risksIssues?: string;
  /** Set by the review workflow in a later phase. */
  returnReason?: string;
  reviewedByContactId?: string;
  reviewedAt?: IsoDateTime;
  /** When collection started for this department. Absent means Not Sent. */
  sentAt?: IsoDateTime;
  /** When this department's input is due. Overdue is derived, never stored. */
  dueAt?: IsoDateTime;
  accomplishments: string[];
  plannedNextWeek: string[];
  blockers: string[];
  submittedByContactId?: string;
  submittedAt?: IsoDateTime;
}

/**
 * A narrative entry on a weekly report — key comment, risk, issue, or
 * action item. All four share the same field set, so they live in one
 * collection discriminated by `entryType` rather than four parallel ones.
 */
export interface WeeklyEntry {
  id: string;
  weeklyReportId: string;
  entryType: WeeklyEntryType;
  /** Clear user-facing meaning; legacy category remains internal only. */
  updateType: WeeklyUpdateType;
  category: CommentCategory;
  description: string;
  priority: Priority;
  status: EntryStatus;
  ownerContactId?: string;
  dueDate?: IsoDate;
  /** Master-data links, all optional. */
  departmentId?: string;
  systemId?: string;
  disciplineId?: string;
  /** Roll this entry up into the monthly report. */
  includeInMonthly: boolean;
  /** Original author is immutable; responsibility is ownerContactId. */
  createdByContactId?: string;
  updatedByContactId?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface WeeklyPlanItem {
  id: string;
  weeklyReportId: string;
  kind: "milestone" | "next_week";
  title: string;
  startDate?: IsoDate;
  endDate: IsoDate;
  ownerContactId?: string;
  departmentId?: string;
  status: WeeklyPlanStatus;
  sortOrder: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/**
 * One "Major Activity Completed" row on a weekly report (spec section 6).
 * Department and discipline are master-data references; the project is
 * reached through the parent report rather than duplicated here.
 */
export interface WeeklyActivity {
  id: string;
  weeklyReportId: string;
  title: string;
  departmentId?: string;
  disciplineId?: string;
  ownerContactId?: string;
  status: ActivityStatus;
  /** Whole percentage 0-100, or undefined when not tracked. */
  progressPercent?: number;
  remarks?: string;
  /** Authoring order within the report. */
  sortOrder: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface WeeklyReport extends ReportBase {
  weekNumber: number; // ISO week of periodStart
  plannedProgress: number; // cumulative planned %
  actualProgress: number; // cumulative actual %
  /** Disciplines in scope for this reporting week (master-data ids). */
  disciplineIds: string[];
  /** Cumulative man-hours expended to the end of this reporting week. */
  manHoursToDate?: number;
  hseStatus?: KpiRating;
  qualityStatus?: KpiRating;
  overallProgressStatus?: ProgressStatus;
  /** Executive Summary narrative for the week (spec section 5). */
  summary?: string;
  submissionIds: string[];
  /** Key comments, risks, issues, and action items (Phase 6A.4). */
  entryIds: string[];
  /** Major activities completed this week (Phase W2). */
  activityIds: string[];
  /**
   * Sign-off SNAPSHOT — name and job title copied at save time.
   *
   * Takes precedence over the `preparedBy/reviewedBy/approvedByContactId`
   * columns on `ReportBase`, which remain for reports saved before the
   * snapshot column existed. Holds no foreign key, so editing or deleting a
   * Contact cannot alter an issued report. Shape is shared with the Executive
   * Report rather than duplicated — see `executive-signatories.ts`.
   */
  signatories?: SignatorySnapshot;
}

/* --------------------------------- Monthly -------------------------------- */

export interface MonthlyComment {
  id: string;
  monthlyReportId: string;
  sourceKind: "weekly" | "monthly_manual";
  sourceWeeklyEntryId?: string;
  sourceWeeklyReportId?: string;
  weekNumber?: number;
  departmentId?: string;
  systemId?: string;
  disciplineId?: string;
  updateType: MonthlyUpdateType;
  /** Immutable source wording, copied only once from Weekly. */
  originalText: string;
  /** Optional Monthly consolidation wording; it never replaces originalText. */
  presentationText?: string;
  priority: Priority;
  status: EntryStatus | "pending";
  responsibleContactId?: string;
  targetDate?: IsoDate;
  includeInFinal: boolean;
  escalateToManagement: boolean;
  isMajorAchievement: boolean;
  createdByContactId?: string;
  updatedByContactId?: string;
  sourceCreatedAt?: IsoDateTime;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type MonthlyUpdateType =
  | "progress_update"
  | "achievement"
  | "challenge_constraint"
  | "risk_issue"
  | "decision_management_support"
  | "next_month_plan"
  | "action"
  | "general";

export interface MonthlyDepartmentSummary {
  id: string;
  monthlyReportId: string;
  departmentId: string;
  systemId?: string;
  disciplineId?: string;
  monthlySummary?: string;
  keyAchievements?: string;
  challenges?: string;
  outstandingActions?: string;
  nextMonthPlan?: string;
  createdByContactId?: string;
  updatedByContactId?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface MonthlyPlanItem {
  id: string;
  monthlyReportId: string;
  title: string;
  departmentId?: string;
  startDate?: IsoDate;
  targetDate?: IsoDate;
  ownerContactId?: string;
  status: "not_started" | "in_progress" | "completed" | "delayed" | "pending";
  remarks?: string;
  sortOrder: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface MonthlyReport extends ReportBase {
  /** First day of the consolidated calendar month. */
  reportingMonth: IsoDate;
  plannedProgress: number;
  actualProgress: number;
  scheduleVariance: number; // percentage points, negative = behind
  spi: number;
  hseStatus?: KpiRating;
  qualityStatus?: KpiRating;
  overallProgressStatus?: ProgressStatus;
  executiveSummary?: string;
}

/* -------------------------------- Executive ------------------------------- */

export interface ExecutiveReport extends ReportBase {
  title: string;
  /** Source reports the executive summary was built from. */
  monthlyReportIds: string[];
  headline?: string;
  executiveComment?: string;
}

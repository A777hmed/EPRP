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
  SubmissionStatus,
  WeeklyEntryType,
} from "./core";

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
  createdAt: IsoDateTime;
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
}

/* --------------------------------- Monthly -------------------------------- */

export interface MonthlyComment {
  id: string;
  monthlyReportId: string;
  category: CommentCategory;
  priority: Priority;
  text: string;
  important: boolean;
  authorContactId?: string;
  createdAt: IsoDateTime;
}

export interface MonthlyReport extends ReportBase {
  /** e.g. "July 2026" */
  monthLabel: string;
  /** Weekly reports compiled into this monthly report. */
  weeklyReportIds: string[];
  plannedProgress: number;
  actualProgress: number;
  scheduleVariance: number; // percentage points, negative = behind
  spi: number;
  commentIds: string[];
}

/* -------------------------------- Executive ------------------------------- */

export interface ExecutiveReport extends ReportBase {
  title: string;
  /** Source reports the executive summary was built from. */
  monthlyReportIds: string[];
  headline?: string;
  executiveComment?: string;
}

import { recommendScheduleStatus } from "@/lib/reporting";
import { APPROVED_REPORT_STATUSES } from "@/config/workflows";
import { SCHEDULE_RECOMMENDATION_META } from "@/lib/constants";
import type {
  ProgressStatus,
  ReportStatus,
  WeeklyReport,
  WeeklySubmission,
} from "@/types";

/** Statuses that count as "received" for submission progress. */
const RECEIVED: WeeklySubmission["status"][] = ["submitted", "approved"];

export function countReceived(submissions: WeeklySubmission[]): number {
  return submissions.filter((s) => RECEIVED.includes(s.status)).length;
}

/** Report statuses considered "in progress" (being collected or reviewed). */
export const IN_PROGRESS_STATUSES: ReportStatus[] = [
  "draft",
  "collecting",
  "submitted",
  "under_review",
  "returned",
];

/**
 * Report statuses considered "signed off".
 *
 * An ALIAS of the shared rule, not a second list. It previously repeated the
 * same three values under a different name, so a later change to what counts as
 * approved would have moved compilation, visibility and aggregation while
 * leaving this display grouping silently behind. Same values as before —
 * P0.4 removed the duplicate, not the meaning.
 */
export const SIGNED_OFF_STATUSES: ReportStatus[] = APPROVED_REPORT_STATUSES;

export function isEditableReport(report: WeeklyReport): boolean {
  return ["draft", "collecting", "returned"].includes(report.status);
}

/**
 * Tone for every figure derived from the schedule variance.
 *
 * Deliberately delegates to `recommendScheduleStatus` rather than carrying
 * thresholds of its own. It used to hold a second set (0 / −5), so a −2 point
 * variance was painted amber beside a status badge the documented rule called
 * On Schedule. One rule, one colour: the variance, the SPI and the status
 * reading now cannot contradict each other.
 */
export function varianceTone(
  variance: number
): "success" | "warning" | "danger" {
  return SCHEDULE_RECOMMENDATION_META[recommendScheduleStatus(variance)].tone;
}

/**
 * Overall progress verdict suggested by the schedule variance.
 *
 * The user can always override it — this only pre-selects a sensible default.
 * Every band lands inside the arithmetic reading its own variance produces
 * (`>= -3` on schedule, `>= -7` delayed, below that critical), so accepting
 * the suggestion can never create a report that disagrees with itself.
 */
export function suggestProgressStatus(variance: number): ProgressStatus {
  if (variance > 0) return "ahead";
  if (variance >= -3) return "on_track";
  if (variance >= -5) return "at_risk";
  if (variance >= -7) return "behind";
  return "critical";
}

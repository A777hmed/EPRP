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

/** Report statuses considered "signed off". */
export const SIGNED_OFF_STATUSES: ReportStatus[] = [
  "approved",
  "finalized",
  "locked",
];

export function isEditableReport(report: WeeklyReport): boolean {
  return ["draft", "collecting", "returned"].includes(report.status);
}

/** Tone for a schedule-variance reading (percentage points). */
export function varianceTone(
  variance: number
): "success" | "warning" | "danger" {
  if (variance >= 0) return "success";
  if (variance >= -5) return "warning";
  return "danger";
}

/** Tone for an SPI reading (1.0 = on plan). */
export function spiTone(spi: number): "success" | "warning" | "danger" {
  if (spi >= 1) return "success";
  if (spi >= 0.95) return "warning";
  return "danger";
}

/**
 * Overall progress verdict suggested by the schedule variance. The user can
 * always override it — this only pre-selects a sensible default.
 */
export function suggestProgressStatus(variance: number): ProgressStatus {
  if (variance > 0) return "ahead";
  if (variance === 0) return "on_track";
  if (variance >= -5) return "at_risk";
  if (variance >= -10) return "behind";
  return "critical";
}

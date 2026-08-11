/**
 * Core enums and union types shared across the EPR domain.
 * Keep these as string unions so they serialize cleanly and map 1:1 to
 * future database enum columns.
 */

/**
 * Health reading used by dashboard view models and milestone rollups.
 * Project master data uses the richer {@link ProjectLifecycleStatus} +
 * {@link OverallStatus} pair instead.
 */
export type ProjectStatus =
  | "on-track"
  | "at-risk"
  | "delayed"
  | "on-hold"
  | "completed";

/** Administrative lifecycle of a project (master data). */
export type ProjectLifecycleStatus =
  | "draft"
  | "planning"
  | "active"
  | "on_hold"
  | "delayed"
  | "completed"
  | "cancelled"
  | "archived";

/** Executive health verdict of a project (master data). */
export type OverallStatus =
  | "on_track"
  | "at_risk"
  | "behind"
  | "critical"
  | "completed";

export type Weekday =
  | "saturday"
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday";

/** Qualitative rating used for HSE and Quality KPIs on reports. */
export type KpiRating =
  | "excellent"
  | "good"
  | "fair"
  | "at_risk"
  | "critical";

/** Overall progress verdict recorded on a reporting period. */
export type ProgressStatus =
  | "ahead"
  | "on_track"
  | "at_risk"
  | "behind"
  | "critical";

/**
 * What a Weekly management item IS.
 *
 * They share one field set, so they are stored in a single table
 * discriminated by type rather than five near-identical structures.
 *
 * `decision` means management support or a decision is required. It replaces
 * the old habit of filing such an item under the *category* `escalation`,
 * which conflated "what kind of item is this" with "what is it about".
 */
export type WeeklyEntryType =
  | "comment"
  | "risk"
  | "issue"
  | "action"
  | "decision";

/** User-facing taxonomy for one persisted Weekly update/comment. */
export type WeeklyUpdateType =
  | "progress_update"
  | "achievement"
  | "delay_constraint"
  | "risk"
  | "issue"
  | "action_required"
  | "general";

/** Project Control plan lifecycle inside one Weekly report. */
export type WeeklyPlanStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "delayed";

/**
 * A department's verdict on its own work for the week (spec section 7).
 * Deliberately separate from {@link SubmissionStatus}, which tracks the
 * review lifecycle of the submission itself.
 */
export type SubmissionHealthStatus =
  | "on_track"
  | "at_risk"
  | "delayed"
  | "blocked";

/** Lifecycle of a major activity on a weekly report (spec section 6). */
export type ActivityStatus = "not_started" | "in_progress" | "completed";

/** Lifecycle of a comment / risk / issue / action item. */
export type EntryStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "closed"
  | "escalated";

export type Priority = "low" | "medium" | "high" | "critical";

/** @deprecated Use {@link Priority}. Kept for backward compatibility. */
export type ProjectPriority = Priority;

/** Lifecycle status shared by weekly, monthly, and executive reports. */
export type ReportStatus =
  | "draft"
  | "collecting"
  | "submitted"
  | "under_review"
  | "approved"
  | "finalized"
  | "locked"
  | "returned"
  | "rejected"
  | "archived";

/** Status of a single department/discipline submission inside a weekly report. */
export type SubmissionStatus =
  | "pending"
  | "in_progress"
  | "submitted"
  | "returned"
  | "approved";

/** How a report entered the platform. */
export type ReportSource =
  | "platform"
  | "admin_manual"
  | "excel_import"
  | "docx_import"
  | "secure_link";

/**
 * What business area a Weekly management item RELATES TO.
 *
 * Deliberately disjoint from {@link WeeklyEntryType}: a Risk is a type, not a
 * business area, and "needs a management decision" is a type too. The first
 * seven values are the ones offered.
 *
 * `risk`, `issue` and `escalation` are RETAINED, and remain legal in the
 * database, purely so historical rows written by the old form stay valid and
 * readable. Nothing offers them and nothing rewrites them — see
 * `LEGACY_COMMENT_CATEGORIES`.
 */
export type CommentCategory =
  | "progress"
  | "technical"
  | "hse"
  | "quality"
  | "financial"
  | "client_contractual"
  | "general"
  | "risk"
  | "issue"
  | "escalation";

export type RiskSeverity = "high" | "medium" | "low";

export type ReportPeriodType = "weekly" | "monthly" | "quarterly" | "annual";

/** ISO date string, e.g. "2026-07-31". */
export type IsoDate = string;

/** ISO datetime string, e.g. "2026-07-31T14:00:00Z". */
export type IsoDateTime = string;

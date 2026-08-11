import type {
  AssignmentRole,
  ActivityStatus,
  CommentCategory,
  EmploymentType,
  PositionStatus,
  EntryStatus,
  KpiRating,
  OverallStatus,
  Priority,
  ProgressStatus,
  ProjectLifecycleStatus,
  ProjectStatus,
  ReportSource,
  ReportStatus,
  RiskSeverity,
  SubmissionHealthStatus,
  SubmissionStatus,
  WeeklyEntryType,
} from "@/types";
import type { ScheduleRecommendation } from "@/lib/reporting";
import type { StatusTone } from "@/components/shared/status-badge";

/**
 * Semantic label + tone maps for domain enums.
 * Components read from these so status colors stay consistent platform-wide
 * and are never hardcoded per screen.
 */

export const PROJECT_STATUS_META: Record<
  ProjectStatus,
  { label: string; tone: StatusTone }
> = {
  "on-track": { label: "On Track", tone: "success" },
  "at-risk": { label: "At Risk", tone: "warning" },
  delayed: { label: "Delayed", tone: "danger" },
  "on-hold": { label: "On Hold", tone: "neutral" },
  completed: { label: "Completed", tone: "info" },
};

export const PROJECT_LIFECYCLE_META: Record<
  ProjectLifecycleStatus,
  { label: string; tone: StatusTone }
> = {
  draft: { label: "Draft", tone: "neutral" },
  planning: { label: "Planning", tone: "info" },
  active: { label: "Active", tone: "success" },
  on_hold: { label: "On Hold", tone: "neutral" },
  delayed: { label: "Delayed", tone: "danger" },
  completed: { label: "Completed", tone: "info" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  archived: { label: "Archived", tone: "neutral" },
};

export const OVERALL_STATUS_META: Record<
  OverallStatus,
  { label: string; tone: StatusTone }
> = {
  on_track: { label: "On Track", tone: "success" },
  at_risk: { label: "At Risk", tone: "warning" },
  behind: { label: "Behind", tone: "danger" },
  critical: { label: "Critical", tone: "danger" },
  completed: { label: "Completed", tone: "info" },
};

export const PRIORITY_META: Record<
  Priority,
  { label: string; tone: StatusTone }
> = {
  critical: { label: "Critical", tone: "danger" },
  high: { label: "High", tone: "warning" },
  medium: { label: "Medium", tone: "info" },
  low: { label: "Low", tone: "neutral" },
};

/** @deprecated Use {@link PRIORITY_META}. */
export const PROJECT_PRIORITY_META = PRIORITY_META;

export const REPORT_STATUS_META: Record<
  ReportStatus,
  { label: string; tone: StatusTone }
> = {
  draft: { label: "Draft", tone: "neutral" },
  collecting: { label: "Collecting", tone: "info" },
  submitted: { label: "Submitted", tone: "info" },
  under_review: { label: "Under Review", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  finalized: { label: "Finalized", tone: "success" },
  locked: { label: "Locked", tone: "neutral" },
  returned: { label: "Returned", tone: "warning" },
  rejected: { label: "Rejected", tone: "danger" },
  archived: { label: "Archived", tone: "neutral" },
};

export const SUBMISSION_STATUS_META: Record<
  SubmissionStatus,
  { label: string; tone: StatusTone }
> = {
  pending: { label: "Pending", tone: "neutral" },
  in_progress: { label: "In Progress", tone: "info" },
  submitted: { label: "Submitted", tone: "info" },
  returned: { label: "Returned", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
};

export const REPORT_SOURCE_META: Record<ReportSource, { label: string }> = {
  platform: { label: "Platform" },
  admin_manual: { label: "Manual Entry" },
  excel_import: { label: "Excel Import" },
  docx_import: { label: "DOCX Import" },
  secure_link: { label: "Secure Link" },
};

/** HSE / Quality qualitative ratings on reports. */
export const KPI_RATING_META: Record<
  KpiRating,
  { label: string; tone: StatusTone }
> = {
  excellent: { label: "Excellent", tone: "success" },
  good: { label: "Good", tone: "success" },
  fair: { label: "Fair", tone: "warning" },
  at_risk: { label: "At Risk", tone: "warning" },
  critical: { label: "Critical", tone: "danger" },
};

/** Overall progress verdict recorded on a reporting period. */
export const PROGRESS_STATUS_META: Record<
  ProgressStatus,
  { label: string; tone: StatusTone }
> = {
  ahead: { label: "Ahead of Schedule", tone: "success" },
  on_track: { label: "On Track", tone: "success" },
  at_risk: { label: "At Risk", tone: "warning" },
  behind: { label: "Behind Schedule", tone: "danger" },
  critical: { label: "Critical", tone: "danger" },
};

/**
 * Labels for the derived schedule recommendation (spec §5). Separate from
 * {@link PROGRESS_STATUS_META} because the recommendation has three values
 * and is never stored.
 */
export const SCHEDULE_RECOMMENDATION_META: Record<
  ScheduleRecommendation,
  // Narrowed: these three are the only tones the recommendation can take,
  // which lets read-only metric fields accept it without a cast.
  { label: string; tone: Extract<StatusTone, "success" | "warning" | "danger"> }
> = {
  on_schedule: { label: "On Schedule", tone: "success" },
  delayed: { label: "Delayed", tone: "warning" },
  critical: { label: "Critical", tone: "danger" },
};

/**
 * Department verdict on its own work (spec section 7). Separate from
 * {@link SUBMISSION_STATUS_META}, which labels the review lifecycle.
 */
export const SUBMISSION_HEALTH_META: Record<
  SubmissionHealthStatus,
  { label: string; tone: StatusTone }
> = {
  on_track: { label: "On Track", tone: "success" },
  at_risk: { label: "At Risk", tone: "warning" },
  delayed: { label: "Delayed", tone: "danger" },
  blocked: { label: "Blocked", tone: "danger" },
};

/** Major activity lifecycle (spec section 6). */
export const ACTIVITY_STATUS_META: Record<
  ActivityStatus,
  { label: string; tone: StatusTone }
> = {
  not_started: { label: "Not Started", tone: "neutral" },
  in_progress: { label: "In Progress", tone: "info" },
  completed: { label: "Completed", tone: "success" },
};

/** What a Weekly management item IS. */
export const WEEKLY_ENTRY_TYPE_META: Record<
  WeeklyEntryType,
  { singular: string; plural: string; description: string; tone: StatusTone }
> = {
  comment: {
    singular: "Key Comment",
    plural: "Key Comments",
    description: "Noteworthy remarks for this reporting week.",
    tone: "neutral",
  },
  risk: {
    singular: "Risk",
    plural: "Risks",
    description: "Potential events that could affect delivery.",
    tone: "warning",
  },
  issue: {
    singular: "Issue",
    plural: "Issues",
    description: "Problems already affecting the work.",
    tone: "danger",
  },
  action: {
    singular: "Action",
    plural: "Actions",
    description: "Committed follow-up actions with an owner and due date.",
    tone: "info",
  },
  decision: {
    singular: "Decision / Management Support",
    plural: "Decisions / Management Support",
    description: "Items needing a decision or support from management.",
    tone: "warning",
  },
};

/** The order management items are offered and listed in. */
export const WEEKLY_ENTRY_TYPES: WeeklyEntryType[] = [
  "action",
  "risk",
  "issue",
  "decision",
  "comment",
];

/**
 * Which fields each type actually requires.
 *
 * Driven by what the item MEANS, not by what the shared table can hold: an
 * Action without an owner and a date is not an action, while a Key Comment
 * needs neither. Showing every field as required on every type — because the
 * column exists — is what made one form serve five purposes badly.
 */
export interface EntryFieldRules {
  owner: boolean;
  dueDate: boolean;
  priority: boolean;
  status: boolean;
  category: boolean;
}

export const WEEKLY_ENTRY_REQUIRED: Record<WeeklyEntryType, EntryFieldRules> = {
  action: {
    owner: true,
    dueDate: true,
    priority: false,
    status: false,
    category: false,
  },
  risk: {
    owner: false,
    dueDate: false,
    priority: true,
    status: true,
    category: false,
  },
  issue: {
    owner: false,
    dueDate: false,
    priority: true,
    status: true,
    category: false,
  },
  decision: {
    owner: false,
    dueDate: false,
    priority: true,
    status: false,
    category: false,
  },
  comment: {
    owner: false,
    dueDate: false,
    priority: false,
    status: false,
    category: true,
  },
};

export const ENTRY_STATUS_META: Record<
  EntryStatus,
  { label: string; tone: StatusTone }
> = {
  open: { label: "Open", tone: "info" },
  in_progress: { label: "In Progress", tone: "warning" },
  resolved: { label: "Resolved", tone: "success" },
  closed: { label: "Closed", tone: "neutral" },
  escalated: { label: "Escalated", tone: "danger" },
};

/**
 * What business area an item relates to.
 *
 * The last three are legacy: they were offered by the old form, where
 * `category` was doubling as a second type field. They keep labels so a
 * historical row still reads sensibly, and they are never offered — see
 * {@link MANAGEMENT_CATEGORIES}.
 */
export const COMMENT_CATEGORY_META: Record<
  CommentCategory,
  { label: string; legacy?: true }
> = {
  progress: { label: "Progress / Schedule" },
  technical: { label: "Technical" },
  hse: { label: "HSE" },
  quality: { label: "Quality" },
  financial: { label: "Financial / Cost" },
  client_contractual: { label: "Client / Contractual" },
  general: { label: "General" },
  risk: { label: "Risk (legacy)", legacy: true },
  issue: { label: "Issue (legacy)", legacy: true },
  escalation: { label: "Escalation (legacy)", legacy: true },
};

/**
 * The categories the application offers, in order.
 *
 * Derived from the meta above rather than restated, so a category can never
 * be offered without a label or labelled without being offered.
 */
export const MANAGEMENT_CATEGORIES = (
  Object.keys(COMMENT_CATEGORY_META) as CommentCategory[]
).filter((category) => !COMMENT_CATEGORY_META[category].legacy);

/** Whether a stored category came from the retired taxonomy. */
export function isLegacyCategory(category: CommentCategory): boolean {
  return COMMENT_CATEGORY_META[category]?.legacy === true;
}

export const RISK_SEVERITY_META: Record<
  RiskSeverity,
  { label: string; tone: StatusTone }
> = {
  high: { label: "High", tone: "danger" },
  medium: { label: "Medium", tone: "warning" },
  low: { label: "Low", tone: "neutral" },
};

/** Lifecycle of a single seat on an organization chart (OC-4). */
export const POSITION_STATUS_META: Record<
  PositionStatus,
  { label: string; tone: StatusTone }
> = {
  active: { label: "Active", tone: "success" },
  vacant: { label: "Vacant", tone: "warning" },
  planned: { label: "Planned", tone: "info" },
  on_hold: { label: "On Hold", tone: "neutral" },
  closed: { label: "Closed", tone: "neutral" },
};

export const EMPLOYMENT_TYPE_META: Record<EmploymentType, { label: string }> = {
  staff: { label: "Staff" },
  contract: { label: "Contract" },
  secondment: { label: "Secondment" },
  agency: { label: "Agency" },
};

/** Project-specific assignment roles inside a department team (labels only). */
export const ASSIGNMENT_ROLE_META: Record<AssignmentRole, { label: string }> = {
  department_manager: { label: "Department Manager" },
  team_member_lead: { label: "Team Member Lead" },
  team_member: { label: "Team Member" },
};

/**
 * Weekly responsibilities a Department Manager may delegate. Keys are stored
 * on the delegation; labels are display-only. These mirror the existing
 * Weekly review actions — no new weekly workflow is introduced.
 */
export const WEEKLY_DELEGABLE_RESPONSIBILITIES: {
  key: string;
  label: string;
}[] = [
  { key: "review_submissions", label: "Review team weekly inputs" },
  { key: "return_submissions", label: "Return inputs for correction" },
  { key: "complete_department", label: "Mark department weekly input complete" },
];

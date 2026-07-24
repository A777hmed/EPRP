import type { ReportStatus } from "@/types";

/**
 * Central report workflow definitions (Phase 4C).
 *
 * Pure configuration — no database or side effects. The future report
 * services read these maps to validate status changes; UI reads them to
 * render status timelines and enable/disable actions.
 */

/**
 * Monthly reports pass through two stages that are not part of the shared
 * {@link ReportStatus} lifecycle: automatic compilation from weekly reports
 * and a department-level review round.
 */
export type MonthlyStage = "auto_compiled" | "department_review";

export type WorkflowStatus = ReportStatus | MonthlyStage;

export type ReportWorkflowType = "weekly" | "monthly" | "executive";

export interface WorkflowDefinition {
  type: ReportWorkflowType;
  /** The main (happy-path) sequence, in order. */
  mainPath: WorkflowStatus[];
  /** Every allowed transition, including returns and rejections. */
  transitions: Partial<Record<WorkflowStatus, WorkflowStatus[]>>;
  /** Statuses in which the report content can still be edited. */
  editableIn: WorkflowStatus[];
}

export const weeklyWorkflow: WorkflowDefinition = {
  type: "weekly",
  mainPath: [
    "draft",
    "collecting",
    "under_review",
    "approved",
    "finalized",
    "locked",
  ],
  transitions: {
    draft: ["collecting", "archived"],
    collecting: ["under_review"],
    under_review: ["approved", "returned", "rejected"],
    returned: ["collecting"],
    approved: ["finalized", "returned"],
    finalized: ["locked"],
    locked: ["archived"],
    rejected: ["archived"],
  },
  editableIn: ["draft", "collecting", "returned"],
};

export const monthlyWorkflow: WorkflowDefinition = {
  type: "monthly",
  mainPath: [
    "draft",
    "auto_compiled",
    "department_review",
    "under_review",
    "approved",
    "finalized",
    "locked",
  ],
  transitions: {
    draft: ["auto_compiled", "archived"],
    auto_compiled: ["department_review"],
    department_review: ["under_review", "returned"],
    under_review: ["approved", "returned", "rejected"],
    returned: ["department_review"],
    approved: ["finalized", "returned"],
    finalized: ["locked"],
    locked: ["archived"],
    rejected: ["archived"],
  },
  editableIn: ["draft", "auto_compiled", "department_review", "returned"],
};

export const executiveWorkflow: WorkflowDefinition = {
  type: "executive",
  mainPath: ["draft", "under_review", "approved", "finalized", "locked"],
  transitions: {
    draft: ["under_review", "archived"],
    under_review: ["approved", "returned", "rejected"],
    returned: ["draft"],
    approved: ["finalized", "returned"],
    finalized: ["locked"],
    locked: ["archived"],
    rejected: ["archived"],
  },
  editableIn: ["draft", "returned"],
};

export const reportWorkflows: Record<ReportWorkflowType, WorkflowDefinition> = {
  weekly: weeklyWorkflow,
  monthly: monthlyWorkflow,
  executive: executiveWorkflow,
};

/** Whether `from → to` is an allowed transition for the given workflow. */
export function canTransition(
  type: ReportWorkflowType,
  from: WorkflowStatus,
  to: WorkflowStatus
): boolean {
  return reportWorkflows[type].transitions[from]?.includes(to) ?? false;
}

/** Whether report content may be edited in the given status. */
export function isEditableStatus(
  type: ReportWorkflowType,
  status: WorkflowStatus
): boolean {
  return reportWorkflows[type].editableIn.includes(status);
}

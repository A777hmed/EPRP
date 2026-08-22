import type { ReportStatus } from "@/types";

/**
 * Central report workflow definitions (Phase 4C).
 *
 * Pure configuration — no database or side effects. The future report
 * services read these maps to validate status changes; UI reads them to
 * render status timelines and enable/disable actions.
 */

/**
 * The statuses that count as APPROVED across every tier.
 *
 * One definition, deliberately placed in the workflow config rather than inside
 * any single feature, because three separate rules depend on it and they must
 * never disagree:
 *
 * 1. **Compilation** — a Monthly Report compiles only approved Weekly data
 *    (`03_REPORTING_ARCHITECTURE.md` Law 1, `02_PLATFORM_ARCHITECTURE.md`
 *    §12.3 rule 1 and §24.4).
 * 2. **Visibility** — Tier B content becomes readable platform-wide from
 *    approved onward (§24.2.1).
 * 3. **Aggregation** — the Executive tier totals approved rows only.
 *
 * `finalized` and `locked` are past approval, so they qualify.
 *
 * **`archived` deliberately does NOT.** `archive()` overwrites `status`, and
 * `draft → archived` is a legal transition, so an archived row does not imply
 * the report was ever approved. Treating it as approved would compile and
 * publish abandoned drafts.
 *
 * The SQL mirror is `public.report_status_is_approved(text)`
 * (`20260820000003`). The two are a matched pair.
 */
export const APPROVED_REPORT_STATUSES: ReportStatus[] = [
  "approved",
  "finalized",
  "locked",
];

/** Whether a report status counts as approved. See {@link APPROVED_REPORT_STATUSES}. */
export function isApprovedReportStatus(status: ReportStatus): boolean {
  return APPROVED_REPORT_STATUSES.includes(status);
}

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
  /*
   * Archive is reachable from EVERY live state.
   *
   * This table previously allowed it only from draft, locked and rejected,
   * while the service bypassed the shape check for "archived" entirely — so the
   * real behaviour lived in a special case rather than here. When P0.3 mirrored
   * this table into SQL, the special case was lost and archive broke for every
   * other state. The rule now lives in ONE place: this table, and its SQL
   * mirror public.report_transition_allowed().
   */
  transitions: {
    draft: ["collecting", "archived"],
    collecting: ["under_review", "archived"],
    under_review: ["approved", "returned", "rejected", "archived"],
    returned: ["collecting", "archived"],
    approved: ["finalized", "returned", "archived"],
    finalized: ["locked", "archived"],
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
  /* Archive reachable from every live state — see the Weekly note above. */
  transitions: {
    draft: ["auto_compiled", "archived"],
    auto_compiled: ["department_review", "archived"],
    department_review: ["under_review", "returned", "archived"],
    under_review: ["approved", "returned", "rejected", "archived"],
    returned: ["department_review", "archived"],
    approved: ["finalized", "returned", "archived"],
    finalized: ["locked", "archived"],
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

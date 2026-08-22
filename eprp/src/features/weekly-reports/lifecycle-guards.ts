import type { ReportStatus, WeeklyReport, WeeklySubmission } from "@/types";

/**
 * Weekly lifecycle transition guards.
 *
 * `canTransition` in `config/workflows.ts` answers whether a transition is
 * *shaped* correctly (Draft → Collecting, never Draft → Locked). It does not
 * ask whether the report has earned it. That gap is how a real report reached
 *
 *   status = Locked · Reviewed By = empty · Approved By = empty · 1/2 submitted
 *
 * — an impossible state that the UI happily displayed. These guards add the
 * missing question: are the conditions for this stage actually satisfied?
 *
 * Enforced in the service layer, so no UI, import, or script can bypass them.
 */

export interface LifecycleContext {
  report: Pick<
    WeeklyReport,
    "status" | "reviewedByContactId" | "approvedByContactId"
  >;
  submissions: Pick<WeeklySubmission, "status">[];
  /**
   * An explicit, audited administrative override. Absent for normal
   * transitions — it is never implied and never defaulted.
   */
  override?: AdminOverride;
}

export interface AdminOverride {
  /** Free text; an override without a stated reason is rejected. */
  reason: string;
  /** The account performing the override. */
  actorId: string;
  /** ISO timestamp of the override. */
  at: string;
}

export interface GuardResult {
  allowed: boolean;
  /** Every unmet condition, so the UI can list them rather than say "no". */
  reasons: string[];
  /** True when an override carried the transition. Always audited. */
  overridden: boolean;
}

/**
 * A submission counts as complete once the department's lead accepts it, which
 * `SubmissionStatus` spells `approved`.
 *
 * This compared against `"accepted"` — a value that exists nowhere. The column
 * constraint `weekly_submissions_status_valid` admits
 * `pending | in_progress | submitted | returned | approved`, and
 * {@link SubmissionStatus} says the same. The comparison could therefore never
 * match, so `needsAllSubmissions` always failed and **no Weekly report could
 * ever reach `under_review`, `approved`, `finalized` or `locked`** through the
 * application. Corrected in P0.3, because P0.3 mirrors these conditions into
 * SQL and would otherwise have made an unsatisfiable rule authoritative.
 */
function acceptedCount(submissions: { status: string }[]): number {
  return submissions.filter((s) => s.status === "approved").length;
}

/**
 * Conditions each stage requires, independent of transition shape.
 *
 * Deliberately only checks what the stage *means*. Later stages inherit
 * earlier conditions, because reaching Locked implies having been approved.
 */
function unmetConditions(to: ReportStatus, ctx: LifecycleContext): string[] {
  const { report, submissions } = ctx;
  const total = submissions.length;
  const accepted = acceptedCount(submissions);
  const unmet: string[] = [];

  const needsAllSubmissions = () => {
    if (total === 0) {
      unmet.push("No department submissions exist for this report.");
    } else if (accepted < total) {
      unmet.push(
        `${accepted} of ${total} department submissions approved — all are required.`
      );
    }
  };
  const needsReviewer = () => {
    if (!report.reviewedByContactId) {
      unmet.push("No reviewer recorded.");
    }
  };
  const needsApprover = () => {
    if (!report.approvedByContactId) {
      unmet.push("No approver recorded.");
    }
  };

  switch (to) {
    case "under_review":
      needsAllSubmissions();
      break;
    case "approved":
      needsAllSubmissions();
      needsReviewer();
      break;
    case "finalized":
      needsAllSubmissions();
      needsReviewer();
      needsApprover();
      break;
    case "locked":
      needsAllSubmissions();
      needsReviewer();
      needsApprover();
      break;
    default:
      // draft, collecting, returned, rejected, archived carry no preconditions.
      break;
  }

  return unmet;
}

/**
 * Whether the report may move to `to`.
 *
 * An override is accepted only when it is explicit and complete — reason,
 * actor and timestamp. A partial override is rejected rather than silently
 * treated as absent, so an override can never happen by accident.
 */
export function checkWeeklyTransition(
  to: ReportStatus,
  ctx: LifecycleContext
): GuardResult {
  const unmet = unmetConditions(to, ctx);
  if (unmet.length === 0) {
    return { allowed: true, reasons: [], overridden: false };
  }

  const override = ctx.override;
  if (!override) {
    return { allowed: false, reasons: unmet, overridden: false };
  }

  const missing: string[] = [];
  if (!override.reason?.trim()) missing.push("an override reason");
  if (!override.actorId?.trim()) missing.push("the acting user");
  if (!override.at?.trim()) missing.push("a timestamp");

  if (missing.length > 0) {
    return {
      allowed: false,
      reasons: [
        ...unmet,
        `Administrative override is incomplete: it requires ${missing.join(", ")}.`,
      ],
      overridden: false,
    };
  }

  return { allowed: true, reasons: unmet, overridden: true };
}

/**
 * The audit record an override must produce. Returned rather than written
 * here so the caller persists it in the same operation as the status change.
 */
export function overrideAuditEntry(
  reportId: string,
  to: ReportStatus,
  result: GuardResult,
  override: AdminOverride
) {
  return {
    reportId,
    action: "weekly_lifecycle_override" as const,
    toStatus: to,
    bypassedConditions: result.reasons,
    reason: override.reason.trim(),
    actorId: override.actorId,
    at: override.at,
  };
}

/**
 * Statuses whose CONTENT is immutable.
 *
 * Distinct from `weeklyEditability`, which also weighs who is asking: this is
 * the rule no role escapes, because a locked or finalized report is history
 * and a change to it requires a new revision. Enforced in the service so no
 * form, import, or script can write past it.
 */
const IMMUTABLE_CONTENT_STATUSES: ReportStatus[] = [
  "finalized",
  "locked",
  "archived",
];

/** The reason a report's content is frozen, or undefined when it is not. */
export function contentFrozenReason(
  status: ReportStatus
): string | undefined {
  if (!IMMUTABLE_CONTENT_STATUSES.includes(status)) return undefined;
  return status === "archived"
    ? "This report is archived and cannot be edited."
    : "This report is locked. Changes require a new revision — locked reports stay immutable.";
}

/**
 * Is this report's stored state self-consistent?
 *
 * Used to detect records that reached an impossible state before these guards
 * existed. Reports the problems; never rewrites data.
 */
export function auditWeeklyState(ctx: LifecycleContext): string[] {
  return unmetConditions(ctx.report.status, ctx);
}

/**
 * The furthest status a report's own evidence actually supports.
 *
 * Used to normalize a historically invalid record deterministically —
 * downgrade to what is provable, never fabricate a reviewer or approver.
 */
export function highestSupportedStatus(ctx: LifecycleContext): ReportStatus {
  const order: ReportStatus[] = [
    "locked",
    "finalized",
    "approved",
    "under_review",
    "collecting",
  ];
  for (const status of order) {
    if (unmetConditions(status, ctx).length === 0) return status;
  }
  return "collecting";
}

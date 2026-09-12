/**
 * The Monthly department round: who is being asked, where each department has
 * got to, and what still holds the report.
 *
 * PURE. Every function here is a derivation over data the workspace has already
 * loaded — the project, its master data, and the Monthly submission rows. It
 * makes decisions; it does not enforce them. `monthly_submissions`' row-level
 * security is the boundary and applies the same rules independently.
 *
 * WHAT IS REUSED AND WHAT IS NOT.
 * `resolveDepartmentRecipients()` is taken from the Weekly feature unchanged:
 * it answers "who, on this project, in this department?", which is a question
 * about the PROJECT and not about a report tier. Nothing else is shared. The
 * Weekly distribution panel reads weekly submissions through the weekly service
 * and mirrors the Weekly lifecycle, so making one component serve both tiers
 * would have meant a wrapper with two of everything inside it — a bigger and
 * more fragile thing than the derivation below.
 */

import type {
  Contact,
  Department,
  MonthlyReport,
  MonthlySubmission,
  Project,
  SubmissionStatus,
} from "@/types";
import {
  resolveDepartmentRecipients,
  type DepartmentRecipients,
} from "@/features/weekly-reports/weekly-recipients";

/* ------------------------------ Distribution ------------------------------- */

/**
 * Where one department stands, as the follow-up table shows it.
 *
 * Deliberately NOT the same enum as `SubmissionStatus`: this answers Project
 * Control's question ("has it gone out, is it late, am I waiting?") which is a
 * function of the submission status AND the distribution timestamps.
 */
export type CollectionState =
  | "not_sent"
  | "waiting"
  | "submitted"
  | "approved"
  | "returned";

export const COLLECTION_STATE_LABEL: Record<CollectionState, string> = {
  not_sent: "Not Sent",
  waiting: "Waiting for Input",
  submitted: "Submitted",
  approved: "Dept. Approved",
  returned: "Returned",
};

export interface MonthlyCollectionRow {
  departmentId: string;
  departmentName: string;
  /** Absent until collection has been started for this department. */
  submission?: MonthlySubmission;
  recipients: DepartmentRecipients;
  state: CollectionState;
  /** Past its deadline and not yet answered. Never true once approved. */
  overdue: boolean;
  sentAt?: string;
  dueAt?: string;
  /** The most recent thing that happened, for the "last activity" column. */
  lastActivityAt?: string;
  /** The department said it had nothing to add, deliberately. */
  nilReturn: boolean;
}

export interface MonthlyCollectionCounters {
  notSent: number;
  waiting: number;
  submitted: number;
  approved: number;
  overdue: number;
  /** Departments in Monthly scope, i.e. the denominator of the round. */
  total: number;
}

function stateOf(submission: MonthlySubmission | undefined): CollectionState {
  if (!submission || !submission.sentAt) return "not_sent";
  switch (submission.status) {
    case "approved":
      return "approved";
    case "submitted":
      return "submitted";
    case "returned":
      return "returned";
    default:
      return "waiting";
  }
}

/**
 * Overdue means "we are still waiting and the date has passed".
 *
 * A department that has answered is never overdue, however late the answer was
 * — chasing it again would be noise. A returned submission IS overdue again
 * once the deadline passes, because the department owes another answer.
 */
function isOverdue(
  submission: MonthlySubmission | undefined,
  state: CollectionState,
  now: Date
): boolean {
  if (!submission?.dueAt) return false;
  if (state === "approved" || state === "submitted") return false;
  if (state === "not_sent") return false;
  return new Date(submission.dueAt).getTime() < now.getTime();
}

function lastActivity(submission: MonthlySubmission | undefined) {
  if (!submission) return undefined;
  return (
    submission.reviewedAt ??
    submission.submittedAt ??
    submission.updatedAt ??
    submission.sentAt
  );
}

/**
 * One row per department in the project's Monthly scope.
 *
 * Driven by the PROJECT's department list, not by the submission rows, so a
 * department that has not been sent anything still appears — that is precisely
 * the department Project Control needs to see.
 */
export function buildMonthlyCollectionRows(
  project: Project | null,
  submissions: MonthlySubmission[],
  departments: Department[],
  contacts: Contact[],
  now: Date = new Date()
): MonthlyCollectionRow[] {
  const byDepartment = new Map(
    submissions.map((row) => [row.departmentId, row])
  );

  return (project?.departments ?? []).map((assignment) => {
    const departmentId = assignment.departmentId;
    const submission = byDepartment.get(departmentId);
    const recipients = resolveDepartmentRecipients(
      project,
      departmentId,
      departments,
      contacts
    );
    const state = stateOf(submission);

    return {
      departmentId,
      departmentName: recipients.departmentName,
      submission,
      recipients,
      state,
      overdue: isOverdue(submission, state, now),
      sentAt: submission?.sentAt,
      dueAt: submission?.dueAt,
      lastActivityAt: lastActivity(submission),
      nilReturn: Boolean(submission?.noAdditionalComments),
    };
  });
}

export function monthlyCollectionCounters(
  rows: MonthlyCollectionRow[]
): MonthlyCollectionCounters {
  return {
    notSent: rows.filter((row) => row.state === "not_sent").length,
    // "Waiting" is everything that is out but not yet answered, which includes
    // a submission the manager returned for revision.
    waiting: rows.filter(
      (row) => row.state === "waiting" || row.state === "returned"
    ).length,
    submitted: rows.filter((row) => row.state === "submitted").length,
    approved: rows.filter((row) => row.state === "approved").length,
    overdue: rows.filter((row) => row.overdue).length,
    total: rows.length,
  };
}

/* -------------------------------- Lifecycle -------------------------------- */

/**
 * Why a Monthly may not move on yet.
 *
 * The pre-flight mirror of `monthly_transition_blockers()`. The database is the
 * boundary and refuses independently; this exists so the UI can state the
 * reason before the user clicks, and so the wording is the same in both places.
 *
 * A Monthly with NO collection rows is never blocked. Nothing was asked for, so
 * nothing is outstanding — that is what keeps a Monthly compiled straight from
 * approved Weekly data moving exactly as it does today.
 */
export function monthlyTransitionBlockers(
  to: MonthlyReport["status"],
  submissions: MonthlySubmission[]
): string[] {
  const gated: string[] = ["under_review", "approved", "finalized", "locked"];
  if (!gated.includes(to)) return [];
  if (submissions.length === 0) return [];

  const approved = submissions.filter(
    (row) => row.status === "approved"
  ).length;
  if (approved >= submissions.length) return [];

  return [
    `${approved} of ${submissions.length} department${
      submissions.length === 1 ? "" : "s"
    } approved — every department in the Monthly collection must be approved by its Department Manager.`,
  ];
}

/* -------------------------------- Invitation ------------------------------- */

/**
 * Where a recipient lands.
 *
 * Project-scoped when the project is known, so the reader keeps the project
 * sidebar and the reporting tabs instead of arriving in the global register.
 * The department is carried in the QUERY as well as the fragment: a fragment is
 * never sent to the server, so the sign-in round trip drops it and a recipient
 * who had to log in would otherwise land on the report with no department
 * selected. Navigation only — access is decided by scope and by RLS.
 */
export function monthlyDepartmentLink(
  origin: string,
  projectId: string | undefined,
  reportId: string,
  departmentId: string
): string {
  const path = projectId
    ? `/projects/${projectId}/reports/monthly/${reportId}/workspace`
    : `/monthly-reports/${reportId}/workspace`;
  return `${origin}${path}?dept=${encodeURIComponent(departmentId)}#dept-${departmentId}`;
}

export interface MonthlyInvitationContext {
  projectName: string;
  projectCode?: string;
  reportNumber: string;
  /** The month being reported, already formatted for a reader. */
  monthLabel: string;
  departmentName: string;
  dueAt?: string;
  link: string;
}

/**
 * The request, as text the sender can review before it goes.
 *
 * THE PLATFORM SENDS NOTHING. There is no mail provider, no credential and no
 * server route, so this returns a draft for the user's own mail client and says
 * so rather than implying delivery.
 */
export function monthlyInvitationEmail(context: MonthlyInvitationContext): {
  subject: string;
  body: string;
} {
  const project = context.projectCode
    ? `${context.projectName} (${context.projectCode})`
    : context.projectName;
  const due = context.dueAt
    ? `Please respond by ${new Date(context.dueAt).toLocaleDateString()}.`
    : "Please respond as soon as you are able.";

  return {
    subject: `${context.reportNumber} — Monthly input required: ${context.departmentName}`,
    body: [
      `Monthly Report input is requested for ${context.departmentName}.`,
      "",
      `Project: ${project}`,
      `Report: ${context.reportNumber}`,
      `Month: ${context.monthLabel}`,
      "",
      "Please review the month's content already compiled from the approved Weekly Reports, add any additional comments for your department, and submit your department's Monthly input:",
      context.link,
      "",
      "If your department has nothing to add this month, please record that explicitly rather than leaving the request unanswered.",
      "",
      due,
    ].join("\n"),
  };
}

/* ------------------------------ Department view ---------------------------- */

/** What a department may do with its own Monthly submission right now. */
export interface MonthlyDepartmentActions {
  /** The round is open and this person may write department input. */
  canEdit: boolean;
  /**
   * Project Control has actually asked this department for input.
   *
   * A submission row is created by starting collection, which only Project
   * Control may do — `monthly_submissions_insert` admits nobody else, so a
   * department cannot enrol itself. Until then there is no row to submit, and
   * offering the button would produce a row-level-security refusal instead of
   * an explanation.
   */
  roundStarted: boolean;
  /** Contributor action: hand the department's month to its manager. */
  canSubmit: boolean;
  /** Manager action on this department, and only this department. */
  canRecordVerdict: boolean;
  /** A verdict answers a submission, so it waits for one. */
  verdictBlocked: boolean;
}

const INPUT_STATUSES: SubmissionStatus[] = ["pending", "in_progress", "returned"];

/**
 * Resolve what to OFFER for one department's Monthly submission.
 *
 * `managedDepartmentIds` and `canConsolidate` are the SAME pair the Weekly
 * workspace resolves — project-scoped assignment, never a platform role — so a
 * Department Manager is a Department Manager in both tiers and nowhere else.
 *
 * `canConsolidate` (Report Coordinator, Project Control / Planning, or admin)
 * grants non-verdict content edit — legitimate preparation work. The verdict
 * itself has no such authority: per Phase A2's department-verdict
 * correction, only this department's own assigned Manager may record it —
 * not Coordinator, not Planning, not a global authority.
 * `monthly_submissions_update` enforces the identical rule at the database.
 */
export function monthlyDepartmentActions(options: {
  submission: MonthlySubmission | undefined;
  /** Report status; the round must still be open. */
  roundOpen: boolean;
  /** Assigned to this department on this project. */
  canContribute: boolean;
  canConsolidate: boolean;
  managedDepartmentIds: string[];
  departmentId: string;
}): MonthlyDepartmentActions {
  const {
    submission,
    roundOpen,
    canContribute,
    canConsolidate,
    managedDepartmentIds,
    departmentId,
  } = options;

  const status: SubmissionStatus = submission?.status ?? "pending";
  const isOwnDepartmentManager = managedDepartmentIds.includes(departmentId);
  const canRecordVerdict = isOwnDepartmentManager;
  const canEdit =
    roundOpen && (canContribute || canConsolidate || isOwnDepartmentManager);
  const roundStarted = Boolean(submission);

  // A verdict answers a submission: approving something the department never
  // handed over would skip the step the round exists for. No override here —
  // this is only reached by the department's own Manager, so answerability
  // applies to them exactly as it would to anyone (Phase A2).
  const answered =
    status === "submitted" || status === "approved" || status === "returned";

  return {
    canEdit,
    roundStarted,
    canSubmit: canEdit && roundStarted && INPUT_STATUSES.includes(status),
    canRecordVerdict: roundOpen && roundStarted && canRecordVerdict,
    verdictBlocked: !answered,
  };
}

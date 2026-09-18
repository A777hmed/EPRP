"use client";

/**
 * The department's own Monthly round: review the month, add what the Weekly
 * Reports did not say, and hand it to the Department Manager.
 *
 * WHAT A DEPARTMENT MAY AND MAY NOT TOUCH.
 *
 *   May .... its own additional Monthly comments, and its own submission state.
 *   May not  the Weekly-derived items. Those are compiled from an APPROVED and
 *            usually locked Weekly, and the Monthly is a consolidation of them,
 *            not a second chance to edit them. They are shown here read-only,
 *            as the historical source they are.
 *   May not  Monthly Overview figures, overall status, HSE/Quality ratings,
 *            Master Milestones, the Executive Summary or the Monthly sign-off.
 *            None of those are rendered by this panel at all — the department
 *            view is built from this component, not from a disabled copy of
 *            Project Control's workspace.
 *   May not  another department's comments: everything below is filtered to the
 *            department this card is for, and `monthly_comments` RLS refuses
 *            the rest independently.
 *
 * SILENCE IS NOT AN ANSWER. A department with nothing to add records that
 * explicitly, so Project Control can tell "reviewed, nothing to add" from
 * "never opened it".
 */

import * as React from "react";
import { Check, Loader2, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { SectionCard, StatusBadge, type StatusTone } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { SUBMISSION_STATUS_META } from "@/lib/constants";
import { formatDateTime } from "@/lib/formatters";
import { monthlyReportService } from "@/services/monthly-report-service";
import type { Contact, MonthlyComment, SubmissionStatus } from "@/types";
import { MonthlyCommentForm } from "./monthly-comment-form";
import { monthlyDepartmentActions } from "./monthly-collection";
import { nameOf, NOT_RECORDED } from "./monthly-data";
import type { MonthlyReportBundle } from "./monthly-report-document";

/** How a comment's origin reads to a person. Never the raw column value. */
const SOURCE_LABEL: Record<MonthlyComment["sourceKind"], string> = {
  weekly: "Weekly Report",
  monthly_manual: "Monthly (Project Control)",
  monthly_department: "Monthly Department Input",
};

const SOURCE_TONE: Record<MonthlyComment["sourceKind"], StatusTone> = {
  weekly: "info",
  monthly_manual: "neutral",
  monthly_department: "success",
};

function CommentCard({
  comment,
  bundle,
  readOnly,
}: {
  comment: MonthlyComment;
  bundle: MonthlyReportBundle;
  readOnly: boolean;
}) {
  const author = nameOf(
    comment.createdByContactId,
    bundle.contacts as Contact[],
    NOT_RECORDED
  );
  return (
    <li className="rounded-md border bg-background p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={SOURCE_TONE[comment.sourceKind]}>
          {comment.sourceKind === "weekly" && comment.weekNumber
            ? `Weekly W${comment.weekNumber}`
            : SOURCE_LABEL[comment.sourceKind]}
        </StatusBadge>
        {readOnly && (
          <span className="text-[0.68rem] text-muted-foreground">
            Source item — read-only
          </span>
        )}
        <span className="ml-auto text-[0.68rem] text-muted-foreground">
          {author} · {formatDateTime(comment.createdAt)}
        </span>
      </div>
      <p className="mt-1.5 text-sm whitespace-pre-wrap">
        {comment.presentationText || comment.originalText}
      </p>
      <p className="mt-1 flex flex-wrap gap-x-2 text-[0.68rem] text-muted-foreground">
        <span>{nameOf(comment.departmentId, bundle.departments, "Project level")}</span>
        {comment.systemId && (
          <span>· {nameOf(comment.systemId, bundle.systems, "System")}</span>
        )}
        {comment.disciplineId && (
          <span>
            · {nameOf(comment.disciplineId, bundle.disciplines, bundle.terms.singular)}
          </span>
        )}
      </p>
    </li>
  );
}

export interface MonthlyDepartmentInputProps {
  bundle: MonthlyReportBundle;
  departmentId: string;
  /** The round is open for this viewer — from the server-resolved editability. */
  roundOpen: boolean;
  /** Assigned to this department on this project. */
  canContribute: boolean;
  canConsolidate: boolean;
  managedDepartmentIds: string[];
  onChanged: () => Promise<void>;
}

export function MonthlyDepartmentInput({
  bundle,
  departmentId,
  roundOpen,
  canContribute,
  canConsolidate,
  managedDepartmentIds,
  onChanged,
}: MonthlyDepartmentInputProps) {
  const [saving, setSaving] = React.useState<SubmissionStatus | null>(null);
  const [nilSaving, setNilSaving] = React.useState(false);

  const submission = bundle.monthlySubmissions.find(
    (row) => row.departmentId === departmentId
  );
  const status: SubmissionStatus = submission?.status ?? "pending";

  const actions = monthlyDepartmentActions({
    submission,
    roundOpen,
    canContribute,
    canConsolidate,
    managedDepartmentIds,
    departmentId,
  });

  /*
   * Everything for THIS department, split by where it came from. The Weekly
   * items are the month's source record; the Monthly additions are what this
   * round is collecting. They are never merged into one list, because "who
   * said this, and in which round?" is the question the department round exists
   * to keep answerable.
   */
  const mine = bundle.comments.filter(
    (comment) => comment.departmentId === departmentId
  );
  const weeklyDerived = mine.filter((comment) => comment.sourceKind === "weekly");
  const additions = mine.filter(
    (comment) => comment.sourceKind === "monthly_department"
  );

  const record = async (next: SubmissionStatus) => {
    setSaving(next);
    try {
      await monthlyReportService.saveSubmission(bundle.report.id, {
        departmentId,
        status: next,
      });
      await onChanged();
      toast.success(
        next === "approved"
          ? "Monthly department input approved"
          : next === "returned"
            ? "Returned to the department for revision"
            : "Monthly department input submitted for review"
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not record this department decision."
      );
    } finally {
      setSaving(null);
    }
  };

  const setNilReturn = async (value: boolean) => {
    setNilSaving(true);
    try {
      await monthlyReportService.saveSubmission(bundle.report.id, {
        departmentId,
        // Status is carried unchanged: recording "nothing to add" is a
        // statement about content, not a submission in itself.
        status,
        noAdditionalComments: value,
      });
      await onChanged();
      toast.success(
        value
          ? "Recorded: no additional comments for this month."
          : "Cleared — this department has additions to make."
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not record this department's answer."
      );
    } finally {
      setNilSaving(false);
    }
  };

  const departmentName = nameOf(
    departmentId,
    bundle.departments,
    "Unknown department"
  );

  return (
    <SectionCard
      title={`Monthly Department Input — ${departmentName}`}
      description="Review the month as the Weekly Reports recorded it, then add anything else this department needs the Monthly to say."
      action={
        <StatusBadge tone={SUBMISSION_STATUS_META[status].tone}>
          {SUBMISSION_STATUS_META[status].label}
        </StatusBadge>
      }
      contentClassName="space-y-4"
    >
      {/* ------------------------- The round's state ------------------------ */}
      <div
        id={`dept-${departmentId}`}
        className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2"
      >
        <div className="mr-auto min-w-0">
          <p className="text-xs font-semibold">
            {actions.canRecordVerdict ? "Department Review" : "Department Submission"}
          </p>
          <p className="text-xs text-muted-foreground">
            {status === "approved"
              ? "Approved. Project Control can now include this department in the Monthly review."
              : status === "returned"
                ? submission?.returnReason
                  ? `Returned for revision — ${submission.returnReason}`
                  : "Returned to the department for revision."
                : status === "submitted"
                  ? actions.canRecordVerdict
                    ? "Submitted by the department and awaiting your decision."
                    : "Submitted. Awaiting the Department Manager’s decision."
                  : !actions.roundStarted
                    ? "Project Control has not started the Monthly collection for this department yet. You can review the month now; submission opens once the request is sent."
                    : actions.canRecordVerdict && actions.verdictBlocked
                      ? "The department has not submitted its Monthly input yet."
                      : "Submit once this department’s input for the month is complete."}
          </p>
          {submission?.submittedAt && (
            <p className="text-[0.68rem] text-muted-foreground">
              Submitted {formatDateTime(submission.submittedAt)} by{" "}
              {nameOf(
                submission.submittedByContactId,
                bundle.contacts as Contact[],
                NOT_RECORDED
              )}
              {submission.reviewedAt &&
                ` · Reviewed ${formatDateTime(submission.reviewedAt)} by ${nameOf(
                  submission.reviewedByContactId,
                  bundle.contacts as Contact[],
                  NOT_RECORDED
                )}`}
            </p>
          )}
        </div>

        {actions.canSubmit && (
          <Button size="sm" disabled={saving !== null} onClick={() => record("submitted")}>
            {saving === "submitted" ? (
              <Loader2
                data-icon="inline-start"
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Send data-icon="inline-start" aria-hidden="true" />
            )}
            Submit Monthly Department Input
          </Button>
        )}

        {/* The verdict pair is offered ONLY to the assigned Department Manager
            of this department (or Project Control). A Team Member never sees
            it, whatever their platform role says. */}
        {actions.canRecordVerdict && (
          <>
            <Button
              size="sm"
              disabled={saving !== null || status === "approved" || actions.verdictBlocked}
              onClick={() => record("approved")}
            >
              {saving === "approved" ? (
                <Loader2
                  data-icon="inline-start"
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <Check data-icon="inline-start" aria-hidden="true" />
              )}
              Approve Monthly Submission
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={saving !== null || status === "returned" || actions.verdictBlocked}
              onClick={() => record("returned")}
            >
              <Undo2 data-icon="inline-start" aria-hidden="true" />
              Return for Revision
            </Button>
          </>
        )}
      </div>

      {/* ---------------------- Weekly-derived source ----------------------- */}
      <div>
        <p className="mb-1.5 text-xs font-semibold">
          From this month’s approved Weekly Reports
        </p>
        {weeklyDerived.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            Nothing was carried into this Monthly from your department’s Weekly
            Reports.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {weeklyDerived.map((comment) => (
              <CommentCard
                key={comment.id}
                comment={comment}
                bundle={bundle}
                readOnly
              />
            ))}
          </ul>
        )}
      </div>

      {/* ------------------------ The month's additions --------------------- */}
      <div>
        <p className="mb-1.5 text-xs font-semibold">
          Additional Monthly comments from this department
        </p>
        {additions.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            None added for this month yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {additions.map((comment) => (
              <CommentCard
                key={comment.id}
                comment={comment}
                bundle={bundle}
                readOnly={false}
              />
            ))}
          </ul>
        )}

        {actions.canEdit && (
          <div className="mt-2 space-y-2">
            {/* Adding a comment does not need a submission row — it is a
                monthly_comments write, governed by its own policy. The nil
                return below does, because it is a fact about the submission. */}
            <MonthlyCommentForm
              reportId={bundle.report.id}
              project={bundle.project}
              departments={bundle.departments}
              disciplines={bundle.disciplines}
              contacts={bundle.contacts}
              buttonLabel="Add Monthly Comment"
              sourceKind="monthly_department"
              lockedDepartmentId={departmentId}
              onSaved={onChanged}
            />

            {/* Recording a nil return is an answer, so it is offered beside the
                thing it is an answer about. */}
            <label className="flex items-start gap-2 rounded-md border border-dashed px-3 py-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={Boolean(submission?.noAdditionalComments)}
                disabled={nilSaving || !actions.roundStarted}
                onChange={(event) => void setNilReturn(event.target.checked)}
              />
              <span>
                <b>No additional comments for this month.</b>
                <span className="block text-muted-foreground">
                  Records that this department reviewed the month and had
                  nothing to add — which is not the same as not answering.
                </span>
              </span>
            </label>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, StatusBadge } from "@/components/shared";
import {
  CLIENT_REVIEW_META,
  MILESTONE_APPROVAL_META,
  MILESTONE_CLIENT_APPROVAL_META,
  MILESTONE_PAYMENT_STATUS_META,
  MILESTONE_STATUS_META,
} from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/formatters";
import type { MilestoneUpdate } from "@/types";
import type { DeliverableState } from "../../deliverable-state";
import type { MilestoneState } from "../../milestone-state";

/**
 * Everything ever reported against one milestone.
 *
 * Rejected updates are shown, not hidden. The stream is the record of what was
 * reported and what was decided about it — a rejection that disappears leaves
 * the register looking like nobody ever raised the figure.
 *
 * The newest approved entry is marked as the current one, so the rule behind
 * every number on the register page is visible rather than asserted.
 */
export function MilestoneHistoryDialog({
  state,
  names,
  linked,
  onClose,
}: {
  state: MilestoneState;
  names: Record<string, string>;
  /**
   * Deliverables serving this milestone. Read through the deliverable
   * register — no deliverable field is copied onto the milestone.
   */
  linked: DeliverableState[];
  onClose: () => void;
}) {
  const { milestone } = state;

  // Newest first across every decision, so the dialog reads as a timeline
  // rather than as three separate lists.
  const entries = React.useMemo(
    () =>
      [...state.pending, ...state.history, ...rejectedOf(state)].sort((a, b) =>
        b.submittedAt.localeCompare(a.submittedAt)
      ),
    [state]
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {milestone.code} — {milestone.name}
          </DialogTitle>
          <DialogDescription>
            Every update reported against this milestone. The current figures
            come from the most recent approved entry.
          </DialogDescription>
        </DialogHeader>

        {linked.length > 0 && (
          <div className="rounded-md border p-3">
            <p className="text-sm font-medium">Related deliverables</p>
            <ul className="mt-1.5 space-y-1">
              {linked.map((item) => (
                <li
                  key={item.deliverable.id}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <span className="font-medium tabular-nums">
                    {item.deliverable.code}
                  </span>
                  <span>{item.deliverable.title}</span>
                  {/*
                    Labelled "Client:" for the same reason the deliverable
                    register labels it — this is what the client did, not our
                    acceptance of the report saying so (D6).
                  */}
                  <StatusBadge
                    tone={CLIENT_REVIEW_META[item.clientReviewStatus].tone}
                    className="ml-auto text-[10px]"
                  >
                    Client: {CLIENT_REVIEW_META[item.clientReviewStatus].label}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          </div>
        )}

        {entries.length === 0 ? (
          <EmptyState
            title="Nothing reported yet"
            description="This milestone is in the register but no update has been submitted against it."
            className="py-6"
          />
        ) : (
          <ol className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {entries.map((update) => (
              <li
                key={update.id}
                className={
                  update.id === state.current?.id
                    ? "rounded-lg border border-primary/40 bg-primary/5 p-3"
                    : "rounded-lg border p-3"
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={MILESTONE_STATUS_META[update.status].tone}>
                    {MILESTONE_STATUS_META[update.status].label}
                  </StatusBadge>
                  <StatusBadge
                    tone={MILESTONE_APPROVAL_META[update.approvalStatus].tone}
                  >
                    {MILESTONE_APPROVAL_META[update.approvalStatus].label}
                  </StatusBadge>
                  {update.id === state.current?.id && (
                    <StatusBadge tone="info" hideDot>
                      Current
                    </StatusBadge>
                  )}
                  {update.isRegression && (
                    <StatusBadge tone="warning">Regression</StatusBadge>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatDateTime(update.submittedAt)}
                    {update.submittedByContactId &&
                      ` · ${names[update.submittedByContactId] ?? "—"}`}
                  </span>
                </div>

                <p className="mt-2 text-sm tabular-nums">
                  {update.progressPercent === undefined
                    ? "Progress not measured"
                    : `${update.progressPercent}%`}
                  {update.forecastDate &&
                    ` · forecast ${formatDate(update.forecastDate)}`}
                  {update.actualDate &&
                    ` · completed ${formatDate(update.actualDate)}`}
                </p>

                {/*
                  Payment facts on their own line, labelled "Payment:". They
                  are never folded into the status chip above — money received
                  is not work delivered, and a reader must not be able to
                  mistake one for the other.
                */}
                {(update.paymentStatus ||
                  update.invoiceReference ||
                  update.invoicedDate ||
                  update.receivedDate ||
                  update.recoveredAmount !== undefined) && (
                  <p className="mt-1 text-sm tabular-nums">
                    <span className="text-muted-foreground">Payment: </span>
                    {update.paymentStatus
                      ? MILESTONE_PAYMENT_STATUS_META[update.paymentStatus].label
                      : "not stated"}
                    {update.invoiceReference && ` · inv ${update.invoiceReference}`}
                    {update.invoicedDate &&
                      ` · invoiced ${formatDate(update.invoicedDate)}`}
                    {update.receivedDate &&
                      ` · received ${formatDate(update.receivedDate)}`}
                    {update.recoveredAmount !== undefined &&
                      ` · recovered ${update.recoveredAmount}`}
                  </p>
                )}

                {/*
                  What the CLIENT decided, labelled as theirs. The chip above
                  labelled "Approved"/"Rejected" is OUR acceptance of this
                  report — the two are different facts and are never merged.
                */}
                {update.clientApprovalStatus && (
                  <p className="mt-1 text-sm">
                    <span className="text-muted-foreground">Client: </span>
                    {
                      MILESTONE_CLIENT_APPROVAL_META[update.clientApprovalStatus]
                        .label
                    }
                    {update.clientApprovalDate &&
                      ` · ${formatDate(update.clientApprovalDate)}`}
                  </p>
                )}

                {update.narrative && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {update.narrative}
                  </p>
                )}

                {update.regressionReason && (
                  <p className="mt-1 text-sm text-warning">
                    Regression accepted: {update.regressionReason}
                  </p>
                )}

                {update.decisionNote && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Decision note: {update.decisionNote}
                  </p>
                )}

                {update.approvedAt && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Decided {formatDateTime(update.approvedAt)}
                    {update.approvedByContactId &&
                      ` by ${names[update.approvedByContactId] ?? "—"}`}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Rejected updates.
 *
 * `MilestoneState` carries the two streams that decide the current figures —
 * approved and pending — because that is all the derivation needs. Rejections
 * belong to the record rather than to the state, so they are recovered here
 * from the same rows rather than widening the derived type for one dialog.
 */
function rejectedOf(state: MilestoneState): MilestoneUpdate[] {
  const accounted = new Set(
    [...state.history, ...state.pending].map((update) => update.id)
  );
  return state.allUpdates.filter(
    (update) => !accounted.has(update.id)
  );
}

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
import { CLIENT_REVIEW_META, MILESTONE_APPROVAL_META } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/formatters";
import type { DeliverableState } from "../../deliverable-state";

/**
 * Everything ever reported against one deliverable.
 *
 * Each entry shows both statuses side by side — what was reported of the client,
 * and what we decided about that report. Seeing them together in one timeline is
 * the clearest possible statement that they are two different facts, and it is
 * where a "client approved / report rejected" row becomes legible rather than
 * looking like a contradiction.
 *
 * Rejected updates are shown, not hidden: a rejection that disappears leaves the
 * register looking like nobody ever raised the position.
 */
export function DeliverableHistoryDialog({
  state,
  names,
  onClose,
}: {
  state: DeliverableState;
  names: Record<string, string>;
  onClose: () => void;
}) {
  const { deliverable } = state;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {deliverable.code} — {deliverable.title}
          </DialogTitle>
          <DialogDescription>
            Every update reported against this deliverable. The current position
            comes from the most recent approved entry.
          </DialogDescription>
        </DialogHeader>

        {state.allUpdates.length === 0 ? (
          <EmptyState
            title="Nothing reported yet"
            description="This deliverable is in the register but no update has been submitted against it."
            className="py-6"
          />
        ) : (
          <ol className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {state.allUpdates.map((update) => (
              <li
                key={update.id}
                className={
                  update.id === state.current?.id
                    ? "rounded-lg border border-primary/40 bg-primary/5 p-3"
                    : "rounded-lg border p-3"
                }
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Client:
                    <StatusBadge
                      tone={CLIENT_REVIEW_META[update.clientReviewStatus].tone}
                    >
                      {CLIENT_REVIEW_META[update.clientReviewStatus].label}
                    </StatusBadge>
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Report:
                    <StatusBadge
                      tone={MILESTONE_APPROVAL_META[update.approvalStatus].tone}
                    >
                      {MILESTONE_APPROVAL_META[update.approvalStatus].label}
                    </StatusBadge>
                  </span>
                  {update.id === state.current?.id && (
                    <StatusBadge tone="info" hideDot>
                      Current
                    </StatusBadge>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatDateTime(update.submittedAt)}
                    {update.submittedByContactId &&
                      ` · ${names[update.submittedByContactId] ?? "—"}`}
                  </span>
                </div>

                <p className="mt-2 text-sm tabular-nums">
                  {update.revision ?? "No revision given"}
                  {update.actualSubmissionDate &&
                    ` · submitted ${formatDate(update.actualSubmissionDate)}`}
                  {update.clientReviewDate &&
                    ` · reviewed ${formatDate(update.clientReviewDate)}`}
                </p>

                {update.clientReference && (
                  <p className="mt-1 text-sm">
                    <span className="text-muted-foreground">
                      Client reference:{" "}
                    </span>
                    {update.clientReference}
                  </p>
                )}

                {update.narrative && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {update.narrative}
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

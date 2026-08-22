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
  MILESTONE_APPROVAL_META,
  MILESTONE_STATUS_META,
} from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/formatters";
import type { MilestoneUpdate } from "@/types";
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
  onClose,
}: {
  state: MilestoneState;
  names: Record<string, string>;
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

"use client";

import * as React from "react";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, StatusBadge } from "@/components/shared";
import {
  MILESTONE_CLIENT_APPROVAL_META,
  MILESTONE_PAYMENT_STATUS_META,
  MILESTONE_STATUS_META,
} from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/formatters";
import { milestoneService } from "@/services/milestone-service";
import type { MasterMilestone, MilestoneUpdate } from "@/types";

/**
 * Updates waiting on a decision.
 *
 * Approving is what makes a reported figure the project's figure, so the queue
 * shows the whole submission rather than a summary line: an approver who cannot
 * see the narrative and the dates is not really deciding anything.
 *
 * A flagged regression cannot be approved without a reason. The button stays
 * disabled until one is written, and the database refuses the write regardless
 * — the rule is enforced in one place and merely surfaced here.
 */
export function ApprovalQueue({
  queue,
  names,
  canManage,
  onDecided,
}: {
  queue: { milestone: MasterMilestone; update: MilestoneUpdate }[];
  names: Record<string, string>;
  canManage: boolean;
  onDecided: () => void;
}) {
  if (queue.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Nothing awaiting approval"
        description="Submitted milestone updates appear here until Project Control accepts or rejects them."
        className="py-8"
      />
    );
  }

  return (
    <ul className="space-y-3">
      {queue.map((entry) => (
        <PendingCard
          key={entry.update.id}
          milestone={entry.milestone}
          update={entry.update}
          names={names}
          canManage={canManage}
          onDecided={onDecided}
        />
      ))}
    </ul>
  );
}

function PendingCard({
  milestone,
  update,
  names,
  canManage,
  onDecided,
}: {
  milestone: MasterMilestone;
  update: MilestoneUpdate;
  names: Record<string, string>;
  canManage: boolean;
  onDecided: () => void;
}) {
  const [note, setNote] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const statusMeta = MILESTONE_STATUS_META[update.status];
  const reasonMissing = update.isRegression && reason.trim().length === 0;

  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true);
    try {
      await milestoneService.decide(update.id, decision, {
        decisionNote: note,
        // Only meaningful on an approval; a rejected regression needs no
        // justification because nothing becomes official.
        regressionReason: decision === "approved" ? reason : undefined,
      });
      toast.success(
        decision === "approved" ? "Update approved." : "Update rejected."
      );
      onDecided();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not record the decision."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            {milestone.code} — {milestone.name}
          </p>
          <p className="text-xs text-muted-foreground">
            Submitted {formatDateTime(update.submittedAt)}
            {update.submittedByContactId &&
              ` by ${names[update.submittedByContactId] ?? "—"}`}
            {update.departmentId && ` · ${names[update.departmentId] ?? "—"}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {update.isRegression && (
            <StatusBadge tone="warning">Regression</StatusBadge>
          )}
          <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <Fact label="Progress">
          {update.progressPercent === undefined
            ? "—"
            : `${update.progressPercent}%`}
        </Fact>
        <Fact label="Forecast">{formatDate(update.forecastDate)}</Fact>
        <Fact label="Actual">{formatDate(update.actualDate)}</Fact>
        <Fact label="Planned">{formatDate(milestone.plannedDate)}</Fact>
        <Fact label="Baseline">{formatDate(milestone.baselineDate)}</Fact>
      </dl>

      {/*
        Payment facts get their own row, labelled "Reported payment". An
        approver is accepting a claim about money here, not a progress figure,
        and the two must not be read as one decision.
      */}
      {milestone.type === "commercial" && (
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border border-warning/25 bg-warning/5 p-2 text-sm sm:grid-cols-4">
          <Fact label="Reported payment">
            {update.paymentStatus
              ? MILESTONE_PAYMENT_STATUS_META[update.paymentStatus].label
              : "—"}
          </Fact>
          <Fact label="Invoice">{update.invoiceReference ?? "—"}</Fact>
          <Fact label="Invoiced">{formatDate(update.invoicedDate)}</Fact>
          <Fact label="Received">{formatDate(update.receivedDate)}</Fact>
          {milestone.isAdvancePayment && (
            <Fact label="Recovered">
              {update.recoveredAmount === undefined
                ? "—"
                : String(update.recoveredAmount)}
            </Fact>
          )}
        </dl>
      )}

      {/*
        What the CLIENT decided — reported data. The Approve / Reject buttons
        below are OUR acceptance of this report, which is a separate decision.
      */}
      {update.clientApprovalStatus && (
        <p className="mt-2 text-sm">
          <span className="text-muted-foreground">Reported client decision: </span>
          {MILESTONE_CLIENT_APPROVAL_META[update.clientApprovalStatus].label}
          {update.clientApprovalDate &&
            ` · ${formatDate(update.clientApprovalDate)}`}
        </p>
      )}

      {update.narrative && (
        <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
          {update.narrative}
        </p>
      )}

      {!canManage ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Waiting on Project Control.
        </p>
      ) : (
        <div className="mt-4 space-y-3 border-t pt-3">
          {update.isRegression && (
            <div className="grid gap-1.5">
              <Label
                htmlFor={`reason-${update.id}`}
                className="flex items-center gap-1.5 text-warning"
              >
                <TriangleAlert className="size-3.5" aria-hidden="true" />
                Reason for accepting reduced progress
              </Label>
              <Textarea
                id={`reason-${update.id}`}
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why the figure is being revised downwards."
              />
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor={`note-${update.id}`}>Decision note (optional)</Label>
            <Textarea
              id={`note-${update.id}`}
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Recorded against the decision."
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => void decide("rejected")}
              disabled={busy}
            >
              Reject
            </Button>
            <Button
              onClick={() => void decide("approved")}
              disabled={busy || reasonMissing}
            >
              Approve
            </Button>
          </div>
          {reasonMissing && (
            <p className="text-right text-xs text-muted-foreground">
              A flagged regression needs a reason before it can be approved.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

"use client";

import * as React from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, StatusBadge } from "@/components/shared";
import { CLIENT_REVIEW_META } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/formatters";
import { deliverableService } from "@/services/deliverable-service";
import type { DeliverableUpdate, MasterDeliverable } from "@/types";

/**
 * Deliverable updates waiting on a decision.
 *
 * The card shows the reported client position and the internal decision as two
 * clearly separate things (D6). Approving here means "this report is accurate",
 * never "the client approved" — the client's position is data the card
 * displays, not something this queue can change.
 */
export function DeliverableApprovalQueue({
  queue,
  names,
  canManage,
  onDecided,
}: {
  queue: { deliverable: MasterDeliverable; update: DeliverableUpdate }[];
  names: Record<string, string>;
  canManage: boolean;
  onDecided: () => void;
}) {
  if (queue.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Nothing awaiting approval"
        description="Submitted deliverable updates appear here until Project Control accepts or rejects the report."
        className="py-8"
      />
    );
  }

  return (
    <ul className="space-y-3">
      {queue.map((entry) => (
        <PendingCard
          key={entry.update.id}
          deliverable={entry.deliverable}
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
  deliverable,
  update,
  names,
  canManage,
  onDecided,
}: {
  deliverable: MasterDeliverable;
  update: DeliverableUpdate;
  names: Record<string, string>;
  canManage: boolean;
  onDecided: () => void;
}) {
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const reviewMeta = CLIENT_REVIEW_META[update.clientReviewStatus];

  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true);
    try {
      await deliverableService.decide(update.id, decision, {
        decisionNote: note,
      });
      toast.success(
        decision === "approved" ? "Report approved." : "Report rejected."
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
            {deliverable.code} — {deliverable.title}
          </p>
          <p className="text-xs text-muted-foreground">
            Submitted {formatDateTime(update.submittedAt)}
            {update.submittedByContactId &&
              ` by ${names[update.submittedByContactId] ?? "—"}`}
            {update.departmentId && ` · ${names[update.departmentId] ?? "—"}`}
          </p>
        </div>
        {/*
          Labelled "Reported:" so the chip can never be read as this queue's own
          verdict. The decision buttons below are the verdict.
        */}
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Reported:
          <StatusBadge tone={reviewMeta.tone}>{reviewMeta.label}</StatusBadge>
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <Fact label="Revision">{update.revision ?? "—"}</Fact>
        <Fact label="Submitted">
          {formatDate(update.actualSubmissionDate)}
        </Fact>
        <Fact label="Client reviewed">
          {formatDate(update.clientReviewDate)}
        </Fact>
        <Fact label="Planned">
          {formatDate(deliverable.plannedSubmissionDate)}
        </Fact>
      </dl>

      {update.clientReference && (
        <p className="mt-2 text-sm">
          <span className="text-muted-foreground">Client reference: </span>
          {update.clientReference}
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
          <div className="grid gap-1.5">
            <Label htmlFor={`dnote-${update.id}`}>
              Decision note (optional)
            </Label>
            <Textarea
              id={`dnote-${update.id}`}
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Recorded against the decision."
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <p className="mr-auto text-xs text-muted-foreground">
              Deciding whether this <em>report</em> is accurate — not whether the
              client approves.
            </p>
            <Button
              variant="outline"
              onClick={() => void decide("rejected")}
              disabled={busy}
            >
              Reject Report
            </Button>
            <Button onClick={() => void decide("approved")} disabled={busy}>
              Approve Report
            </Button>
          </div>
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

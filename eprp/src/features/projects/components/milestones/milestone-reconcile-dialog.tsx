"use client";

import * as React from "react";
import { Scale, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/shared";
import { MILESTONE_STATUS_META } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/formatters";
import { milestoneService } from "@/services/milestone-service";
import type { MilestoneStatus, MilestoneUpdate } from "@/types";
import type { CutoffState, MilestoneState } from "../../milestone-state";

const SOURCE_LABEL: Record<string, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  planning: "Planning",
  reconciliation: "Reconciliation",
};

/**
 * Resolve one disputed cut-off.
 *
 * Two departments reported different figures for the same cut-off and the
 * register is deliberately refusing to pick one. This is where Project Control
 * picks — by adopting a reported figure or entering its own — and says why.
 *
 * WHAT THIS SCREEN IS NOT: it is not an edit. The Weekly and Monthly rows below
 * are read-only and stay on the record exactly as submitted; the decision is
 * appended as a new row. That is what keeps "we changed our mind" visible
 * instead of making the disagreement disappear.
 *
 * The reason is mandatory. A governed override of what the site reported is not
 * a thing to record silently, and the database refuses a blank one regardless.
 */
export function MilestoneReconcileDialog({
  state,
  cutoff,
  names,
  reconciledByContactId,
  onClose,
  onReconciled,
}: {
  state: MilestoneState;
  cutoff: CutoffState;
  names: Record<string, string>;
  reconciledByContactId?: string;
  onClose: () => void;
  onReconciled: () => void;
}) {
  const { milestone } = state;

  /*
   * `undefined` means "entering an independent figure"; a row id means "adopt
   * this one". Held as the CHOICE rather than as a copied number, so the value
   * and its provenance can never drift apart.
   */
  const [adoptedId, setAdoptedId] = React.useState<string | undefined>(
    cutoff.reported[0]?.id
  );
  const [ownValue, setOwnValue] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const adopted = cutoff.reported.find((row) => row.id === adoptedId);
  const independent = adoptedId === undefined;

  const parsed = ownValue.trim() === "" ? undefined : Number(ownValue);
  const ownValid =
    parsed !== undefined && Number.isFinite(parsed) && parsed >= 0 && parsed <= 100;

  const officialValue = independent ? parsed : adopted?.progressPercent;
  const valid =
    reason.trim().length > 0 &&
    officialValue !== undefined &&
    (!independent || ownValid);

  const submit = async () => {
    if (!valid || officialValue === undefined) return;
    setSaving(true);
    try {
      await milestoneService.reconcile({
        milestoneId: milestone.id,
        asOfDate: cutoff.asOfDate,
        progressPercent: officialValue,
        // The status travels with the figure being adopted, so the official row
        // is coherent rather than a percentage with no state attached.
        status: (adopted?.status ??
          cutoff.reported[0]?.status ??
          "in_progress") as MilestoneStatus,
        adoptedFromUpdateId: adoptedId,
        reconciliationReason: reason,
        departmentId: milestone.departmentId,
        disciplineId: milestone.disciplineId,
        reconciledByContactId,
      });
      toast.success("Cut-off reconciled. This is now the official figure.");
      onReconciled();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not reconcile the cut-off."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="size-4" aria-hidden="true" />
            Reconcile {milestone.code} — {formatDate(cutoff.asOfDate)}
          </DialogTitle>
          <DialogDescription>
            Two sources reported different progress for this cut-off. Until you
            resolve it, this milestone has no official figure — nothing is being
            silently used in its place.
          </DialogDescription>
        </DialogHeader>

        <p className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Reported: {cutoff.reportedValues.join("% and ")}% as of{" "}
            {formatDate(cutoff.asOfDate)}. Your decision becomes the governed
            figure that Weekly, Monthly, Executive and the Dashboard read.
          </span>
        </p>

        <div className="grid gap-2">
          <Label>Official figure for this cut-off</Label>

          {cutoff.reported.map((row) => (
            <ReportedChoice
              key={row.id}
              row={row}
              names={names}
              selected={adoptedId === row.id}
              onSelect={() => setAdoptedId(row.id)}
            />
          ))}

          <label
            className={`flex items-start gap-3 rounded-md border p-3 text-sm ${
              independent ? "border-primary bg-primary/5" : ""
            }`}
          >
            <input
              type="radio"
              name="reconcile-choice"
              className="mt-1"
              checked={independent}
              onChange={() => setAdoptedId(undefined)}
            />
            <span className="grid flex-1 gap-1.5">
              <span className="font-medium">Enter a different figure</span>
              <span className="text-xs text-muted-foreground">
                Neither reported value is right — record the agreed one.
              </span>
              <Input
                inputMode="numeric"
                value={ownValue}
                onChange={(event) => {
                  setOwnValue(event.target.value);
                  setAdoptedId(undefined);
                }}
                placeholder="Progress %"
                className="max-w-32"
                aria-label="Reconciled progress percent"
                aria-invalid={independent && ownValue !== "" && !ownValid}
              />
            </span>
          </label>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="reconcile-reason">Reason</Label>
          <Textarea
            id="reconcile-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why this figure, and why not the other one."
          />
          <p className="text-xs text-muted-foreground">
            Required. It is kept with the decision permanently.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!valid || saving}>
            {saving
              ? "Recording…"
              : officialValue === undefined
                ? "Record Decision"
                : `Make ${officialValue}% Official`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One reported figure, offered as a choice and never as an editable value. */
function ReportedChoice({
  row,
  names,
  selected,
  onSelect,
}: {
  row: MilestoneUpdate;
  names: Record<string, string>;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-md border p-3 text-sm ${
        selected ? "border-primary bg-primary/5" : ""
      }`}
    >
      <input
        type="radio"
        name="reconcile-choice"
        className="mt-1"
        checked={selected}
        onChange={onSelect}
      />
      <span className="grid flex-1 gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium tabular-nums">
            {row.progressPercent}%
          </span>
          <StatusBadge tone="info" hideDot className="text-[10px]">
            {SOURCE_LABEL[row.source] ?? row.source}
          </StatusBadge>
          <StatusBadge
            tone={MILESTONE_STATUS_META[row.status].tone}
            className="text-[10px]"
          >
            {MILESTONE_STATUS_META[row.status].label}
          </StatusBadge>
        </span>
        <span className="text-xs text-muted-foreground">
          Reported {formatDateTime(row.submittedAt)}
          {row.submittedByContactId &&
            ` by ${names[row.submittedByContactId] ?? "—"}`}
          {row.departmentId && ` · ${names[row.departmentId] ?? ""}`}
        </span>
        {row.narrative && (
          <span className="text-xs text-muted-foreground">{row.narrative}</span>
        )}
      </span>
    </label>
  );
}

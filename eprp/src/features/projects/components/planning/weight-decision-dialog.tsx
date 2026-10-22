"use client";

import * as React from "react";
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
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { planningService } from "@/services/planning-service";
import type { PlanningWeightDecisionMode } from "@/types";
import {
  proposeWeightDecision,
  weightDecisionPayload,
  type WorkingPlanElement,
} from "../../working-plan";

const MODES: { value: PlanningWeightDecisionMode; label: string; description: string }[] = [
  {
    value: "proportional_rescale",
    label: "Rescale proportionally",
    description: "Keep the entered weights' proportions and scale them to total 100%. A child with no weight gets 0.",
  },
  {
    value: "equal_split",
    label: "Split equally",
    description: "Only when no child has a weight yet: every child gets the same share.",
  },
  {
    value: "adopt_recorded",
    label: "Use recorded weights",
    description:
      "Review a recorded weight (entered or imported before local weights) and accept it as the local weight, for children that have none.",
  },
];

function show(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

/**
 * The explicit, logged weight decision of `docs/02` §26.4 W3, for one
 * parent's direct children. EPRP never normalises silently: the user sees
 * every child's weight before and after, gives a reason, and the database
 * re-verifies the decision against the stored weights before recording it
 * with its actor and time.
 */
export function WeightDecisionDialog({
  projectId,
  parentId,
  parentName,
  childElements,
  initialMode,
  onClose,
  onDecided,
}: {
  projectId: string;
  /** `null` = the Project's top level. */
  parentId: string | null;
  parentName: string;
  childElements: readonly WorkingPlanElement[];
  initialMode: PlanningWeightDecisionMode;
  onClose: () => void;
  onDecided: () => void;
}) {
  const [mode, setMode] = React.useState<PlanningWeightDecisionMode>(initialMode);
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const proposal = React.useMemo(
    () => proposeWeightDecision(parentId, childElements, mode),
    [childElements, mode, parentId]
  );
  const changed = new Map(proposal.ok ? proposal.children.map((child) => [child.id, child]) : []);

  const decide = async () => {
    if (!proposal.ok || !reason.trim()) return;
    setSaving(true);
    try {
      await planningService.recordWeightDecision({
        projectId,
        parentWorkItemId: parentId,
        mode,
        children: weightDecisionPayload(proposal.children),
        reason: reason.trim(),
      });
      toast.success(`Weights of ${parentName} decided and logged.`);
      onDecided();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not record the weight decision.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Decide the weights of {parentName}</DialogTitle>
          <DialogDescription>
            An explicit decision, recorded with your name, the time and your
            reason. Nothing is normalised automatically.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="grid gap-2">
          <legend className="sr-only">Decision</legend>
          {MODES.map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm",
                mode === option.value && "border-primary bg-primary/[0.04]"
              )}
            >
              <input
                type="radio"
                name="weight-decision"
                value={option.value}
                checked={mode === option.value}
                onChange={() => setMode(option.value)}
                className="mt-1 accent-primary"
              />
              <span className="grid gap-0.5">
                <span className="font-medium">{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {proposal.ok ? (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Child</TableHead>
                  <TableHead className="text-right">Now</TableHead>
                  {mode === "adopt_recorded" && <TableHead className="text-right">Recorded</TableHead>}
                  <TableHead className="text-right">After</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {childElements.map((element) => {
                  const entry = changed.get(element.id);
                  const before =
                    (element.kind === "node" ? element.item.localWeightPercent : element.activity.localWeightPercent) ?? null;
                  const recorded =
                    (element.kind === "node" ? element.item.weightPercent : element.activity.weightPercent) ?? null;
                  return (
                    <TableRow key={element.id}>
                      <TableCell className="text-sm">
                        {element.kind === "node" ? element.item.name : element.activity.name}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{show(before)}</TableCell>
                      {mode === "adopt_recorded" && (
                        <TableCell className="text-right text-xs tabular-nums text-muted-foreground">{show(recorded)}</TableCell>
                      )}
                      <TableCell className={cn("text-right text-xs tabular-nums", entry && "font-semibold")}>
                        {entry ? `${entry.after}%` : `${show(before)} (unchanged)`}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">{proposal.reason}</p>
        )}

        <div className="grid gap-1.5">
          <Label htmlFor="weight-decision-reason">Reason</Label>
          <Textarea
            id="weight-decision-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why these weights are right for this part of the plan"
            rows={3}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void decide()} disabled={!proposal.ok || !reason.trim() || saving}>
            {saving ? "Recording…" : "Record decision"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  planningService,
  type PlanningWorkItemInput,
} from "@/services/planning-service";
import type {
  MasterDeliverable,
  MasterMilestone,
  PlanningWorkItem,
  PlanningWorkItemType,
} from "@/types";

const NONE = "none";

export const WORK_ITEM_TYPE_LABEL: Record<PlanningWorkItemType, string> = {
  study: "Study",
  deliverable: "Deliverable",
  report: "Report",
  activity: "Activity",
  engineering: "Engineering",
  procurement: "Procurement",
  construction: "Construction",
  inspection: "Inspection",
  commissioning: "Commissioning",
  milestone: "Milestone",
  other: "Other",
};

const WORK_ITEM_TYPES = Object.keys(WORK_ITEM_TYPE_LABEL) as PlanningWorkItemType[];

function toInput(item?: PlanningWorkItem): PlanningWorkItemInput & { masterMilestoneId?: string } {
  return {
    parentWorkItemId: item?.parentWorkItemId ?? "",
    masterDeliverableId: item?.masterDeliverableId ?? "",
    code: item?.code ?? "",
    name: item?.name ?? "",
    itemType: item?.itemType ?? "activity",
    weightPercent: item?.weightPercent,
    plannedStartDate: item?.plannedStartDate ?? "",
    plannedFinishDate: item?.plannedFinishDate ?? "",
    baselineStartDate: item?.baselineStartDate ?? "",
    baselineFinishDate: item?.baselineFinishDate ?? "",
    plannedDurationDays: item?.plannedDurationDays,
  };
}

/**
 * Create or edit a Master Plan work item.
 *
 * "Where an existing governed Deliverable/Study/Milestone exists, link it
 * instead of creating a competing duplicate source" — when the type is
 * deliverable or milestone, this offers the project's own governed register
 * to link against, rather than treating this row as the record of truth.
 */
export function WorkItemFormDialog({
  projectId,
  item,
  register,
  masterMilestones,
  masterDeliverables,
  onClose,
  onSaved,
}: {
  projectId: string;
  item?: PlanningWorkItem;
  /** The rest of the Master Plan, so a parent can be chosen from it. */
  register: PlanningWorkItem[];
  masterMilestones: MasterMilestone[];
  masterDeliverables: MasterDeliverable[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState(() => toInput(item));
  const [linkedMilestoneId, setLinkedMilestoneId] = React.useState<string>("");
  const [saving, setSaving] = React.useState(false);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const parents = register.filter(
    (candidate) => candidate.id !== item?.id && candidate.active
  );

  const valid = form.code.trim().length > 0 && form.name.trim().length > 0;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      let saved: PlanningWorkItem;
      if (item) {
        saved = await planningService.updateWorkItem(item.id, form);
        toast.success("Work item updated.");
      } else {
        saved = await planningService.createWorkItem(projectId, form);
        toast.success("Work item added to the Master Plan.");
      }
      if (form.itemType === "milestone" && linkedMilestoneId) {
        await planningService.linkWorkItemToMilestone(saved.id, linkedMilestoneId);
      }
      onSaved();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not save the work item."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? "Edit Work Item" : "Add Work Item"}</DialogTitle>
          <DialogDescription>
            What this part of the plan is and what was planned. Reported
            progress is entered through Weekly/Monthly, or confirmed here from
            an import.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="wi-code">Code</Label>
            <Input
              id="wi-code"
              value={form.code}
              onChange={(event) => set("code", event.target.value)}
              placeholder="WI-01"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wi-type">Type</Label>
            <Select
              value={form.itemType}
              onValueChange={(value) => set("itemType", value as PlanningWorkItemType)}
            >
              <SelectTrigger id="wi-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORK_ITEM_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {WORK_ITEM_TYPE_LABEL[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="wi-name">Name</Label>
            <Input
              id="wi-name"
              value={form.name}
              onChange={(event) => set("name", event.target.value)}
              placeholder="Detailed Engineering — Unit 300"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="wi-parent">Parent</Label>
            <Select
              value={form.parentWorkItemId || NONE}
              onValueChange={(value) => set("parentWorkItemId", value === NONE ? "" : value)}
            >
              <SelectTrigger id="wi-parent">
                <SelectValue placeholder="Top level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Top level</SelectItem>
                {parents.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.code} — {candidate.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="wi-weight">Weight %</Label>
            <Input
              id="wi-weight"
              inputMode="decimal"
              value={form.weightPercent === undefined ? "" : String(form.weightPercent)}
              onChange={(event) =>
                set("weightPercent", event.target.value === "" ? undefined : Number(event.target.value))
              }
              placeholder="Share of physical scope"
            />
          </div>

          {form.itemType === "deliverable" && (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="wi-deliverable">Governed Deliverable</Label>
              <Select
                value={form.masterDeliverableId || NONE}
                onValueChange={(value) => set("masterDeliverableId", value === NONE ? "" : value)}
              >
                <SelectTrigger id="wi-deliverable">
                  <SelectValue placeholder="Not linked" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not linked</SelectItem>
                  {masterDeliverables.map((deliverable) => (
                    <SelectItem key={deliverable.id} value={deliverable.id}>
                      {deliverable.code} — {deliverable.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                A reference only — the Master Deliverable register stays the
                single place this deliverable is defined.
              </p>
            </div>
          )}

          {form.itemType === "milestone" && (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="wi-milestone">Governed Milestone</Label>
              <Select value={linkedMilestoneId || NONE} onValueChange={(value) => setLinkedMilestoneId(value === NONE ? "" : value)}>
                <SelectTrigger id="wi-milestone">
                  <SelectValue placeholder="Not linked" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not linked</SelectItem>
                  {masterMilestones.map((milestone) => (
                    <SelectItem key={milestone.id} value={milestone.id}>
                      {milestone.code} — {milestone.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Master Milestones stays the one register a milestone exists
                in — this links to it rather than duplicating it.
              </p>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="wi-planned-start">Planned Start</Label>
            <Input
              id="wi-planned-start"
              type="date"
              value={form.plannedStartDate ?? ""}
              onChange={(event) => set("plannedStartDate", event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wi-planned-finish">Planned Finish</Label>
            <Input
              id="wi-planned-finish"
              type="date"
              value={form.plannedFinishDate ?? ""}
              onChange={(event) => set("plannedFinishDate", event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wi-baseline-start">Baseline Start</Label>
            <Input
              id="wi-baseline-start"
              type="date"
              value={form.baselineStartDate ?? ""}
              onChange={(event) => set("baselineStartDate", event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wi-baseline-finish">Baseline Finish</Label>
            <Input
              id="wi-baseline-finish"
              type="date"
              value={form.baselineFinishDate ?? ""}
              onChange={(event) => set("baselineFinishDate", event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The frozen contractual reference. Leave it alone in a re-plan.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!valid || saving}>
            {saving ? "Saving…" : item ? "Save Changes" : "Add Work Item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

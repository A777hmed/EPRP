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
import { Switch } from "@/components/ui/switch";
import {
  planningService,
  type PlanningWorkItemInput,
} from "@/services/planning-service";
import type {
  MasterDeliverable,
  MasterMilestone,
  PlanningEarningMethod,
  PlanningWorkItem,
  PlanningWorkItemType,
} from "@/types";
import {
  EARNING_METHOD_LABEL,
  inheritedNodeMethod,
  levelLabel,
  resolveReportingUnit,
  type WorkingPlanTree,
} from "../../working-plan";
import {
  EarningMethodSelect,
  LocalWeightField,
  parseWeightText,
  ReportingUnitFields,
  weightTextValid,
  type ReportingUnitOptions,
  type ReportingUnitValue,
} from "./working-plan-fields";
import { PlanningHelp } from "./planning-help";
import { LabelWithHelp } from "@/components/shared";

import { WORK_ITEM_TYPE_LABEL } from "./work-item-labels";

const NONE = "none";

export { WORK_ITEM_TYPE_LABEL };

/**
 * 13.11 (`docs/02` §26.3 H5): a node classification describes the work; it is
 * not a level and "Milestone" is not one. The deprecated value stays readable
 * on existing rows but is never offered for a new or changed node.
 */
const NODE_CLASSIFICATIONS = (Object.keys(WORK_ITEM_TYPE_LABEL) as PlanningWorkItemType[]).filter(
  (type) => type !== "milestone"
);

const NODE_METHODS: readonly PlanningEarningMethod[] = [
  "percent_complete",
  "zero_hundred",
  "fifty_fifty",
  "milestone",
];

interface NodeForm {
  parentWorkItemId: string;
  masterDeliverableId: string;
  code: string;
  name: string;
  itemType: PlanningWorkItemType;
  weightText: string;
  isControlAccount: boolean;
  earningMethod: PlanningEarningMethod | "";
  unit: ReportingUnitValue;
  plannedStartDate: string;
  plannedFinishDate: string;
  baselineStartDate: string;
  baselineFinishDate: string;
}

function toForm(item: PlanningWorkItem | undefined, parentId: string | undefined): NodeForm {
  return {
    parentWorkItemId: item?.parentWorkItemId ?? parentId ?? "",
    masterDeliverableId: item?.masterDeliverableId ?? "",
    code: item?.code ?? "",
    name: item?.name ?? "",
    itemType: item?.itemType ?? "engineering",
    weightText: item?.localWeightPercent === undefined ? "" : String(item.localWeightPercent),
    isControlAccount: item?.isControlAccount ?? false,
    earningMethod: item?.earningMethod ?? "",
    unit: {
      departmentId: item?.departmentId ?? "",
      systemId: item?.systemId ?? "",
      disciplineId: item?.disciplineId ?? "",
      structureNodeId: item?.structureNodeId ?? "",
    },
    plannedStartDate: item?.plannedStartDate ?? "",
    plannedFinishDate: item?.plannedFinishDate ?? "",
    baselineStartDate: item?.baselineStartDate ?? "",
    baselineFinishDate: item?.baselineFinishDate ?? "",
  };
}

/** Every node under `id` (to keep a node from being moved beneath itself). */
function descendantIds(tree: WorkingPlanTree, id: string): Set<string> {
  const out = new Set<string>();
  const walk = (nodeId: string) => {
    for (const child of tree.nodes.get(nodeId)?.children ?? []) {
      if (child.kind === "node" && !out.has(child.id)) {
        out.add(child.id);
        walk(child.id);
      }
    }
  };
  walk(id);
  return out;
}

/**
 * Create or edit a planning node (WBS element, Control Account or Work
 * Package) of the Working Plan.
 *
 * 13.11: the weight entered here is the LOCAL weight — the node's share of its
 * parent (`docs/02` §26.4 W4); the effective project contribution is
 * calculated and shown beside it, never typed. A recorded (pre-13.11) weight
 * is shown read-only and becomes a local weight only through an explicit
 * decision in the Master Plan. Every change is logged by the database.
 */
export function WorkItemFormDialog({
  projectId,
  item,
  parentId,
  tree,
  contributions,
  levelLabels,
  projectDefaultMethod,
  unitOptions,
  hierarchyTerm,
  masterMilestones,
  masterDeliverables,
  onClose,
  onSaved,
}: {
  projectId: string;
  item?: PlanningWorkItem;
  /** Pre-selected parent for "Add node under …". */
  parentId?: string;
  tree: WorkingPlanTree;
  contributions: Map<string, number | null>;
  levelLabels: string[];
  projectDefaultMethod?: PlanningEarningMethod;
  unitOptions: ReportingUnitOptions;
  hierarchyTerm: string;
  masterMilestones: MasterMilestone[];
  masterDeliverables: MasterDeliverable[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState(() => toForm(item, parentId));
  const [linkedMilestoneId, setLinkedMilestoneId] = React.useState<string>("");
  const [saving, setSaving] = React.useState(false);

  const set = <K extends keyof NodeForm>(key: K, value: NodeForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const excluded = item ? descendantIds(tree, item.id) : new Set<string>();
  const parents = [...tree.nodes.values()].filter(
    (candidate) => candidate.id !== item?.id && !excluded.has(candidate.id)
  );
  const parentNode = form.parentWorkItemId ? tree.nodes.get(form.parentWorkItemId) : undefined;
  const depth = parentNode ? parentNode.depth + 1 : 1;
  const parentName = parentNode?.item.name ?? "the Project";

  // What this node inherits when it states nothing itself.
  const inheritedMethod = parentNode
    ? inheritedNodeMethod(parentNode, projectDefaultMethod)
    : projectDefaultMethod
      ? { method: projectDefaultMethod, source: "project" as const }
      : null;
  const inheritedMethodLabel = inheritedMethod
    ? `${EARNING_METHOD_LABEL[inheritedMethod.method]} (${inheritedMethod.source === "project" ? "project default" : `from ${tree.nodes.get(inheritedMethod.fromNodeId ?? "")?.item.name ?? "parent"}`})`
    : "not set";
  const inheritedUnit = parentNode ? resolveReportingUnit(parentNode) : { unit: null, source: "project_level" as const };
  const inheritedUnitLabel = unitOptions.describe(inheritedUnit.unit);

  const classifications =
    item?.itemType === "milestone" ? [...NODE_CLASSIFICATIONS, "milestone" as const] : NODE_CLASSIFICATIONS;

  const valid =
    form.code.trim().length > 0 &&
    form.name.trim().length > 0 &&
    weightTextValid(form.weightText) &&
    !(form.itemType === "milestone" && item?.itemType !== "milestone");

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const input: PlanningWorkItemInput = {
        parentWorkItemId: form.parentWorkItemId,
        masterDeliverableId: form.masterDeliverableId,
        code: form.code,
        name: form.name,
        itemType: form.itemType,
        localWeightPercent: parseWeightText(form.weightText),
        isControlAccount: form.isControlAccount,
        earningMethod: form.earningMethod,
        plannedStartDate: form.plannedStartDate,
        plannedFinishDate: form.plannedFinishDate,
        baselineStartDate: form.baselineStartDate,
        baselineFinishDate: form.baselineFinishDate,
        ...(unitOptions.family === "other"
          ? { structureNodeId: form.unit.structureNodeId ?? "" }
          : {
              departmentId: form.unit.departmentId ?? "",
              systemId: form.unit.systemId ?? "",
              disciplineId: form.unit.disciplineId ?? "",
            }),
      };
      let saved: PlanningWorkItem;
      if (item) {
        saved = await planningService.updateWorkItem(item.id, input);
        toast.success("Node updated.");
      } else {
        saved = await planningService.createWorkItem(projectId, input);
        toast.success("Node added to the Working Plan.");
      }
      if (form.itemType === "milestone" && linkedMilestoneId) {
        await planningService.linkWorkItemToMilestone(saved.id, linkedMilestoneId);
      }
      onSaved();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save the node.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? "Edit Planning Node" : "Add Planning Node"}</DialogTitle>
          <DialogDescription>
            A part of the project breakdown — {levelLabel(levelLabels, depth)} level. Its
            local weight is its share of {parentName}; EPRP calculates its
            contribution to the project.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 [&>*]:min-w-0">
          <div className="grid gap-1.5">
            <Label htmlFor="wi-code">Code</Label>
            <Input
              id="wi-code"
              value={form.code}
              onChange={(event) => set("code", event.target.value)}
              placeholder="RBI"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wi-type">Classification</Label>
            <Select
              value={form.itemType}
              onValueChange={(value) => set("itemType", value as PlanningWorkItemType)}
            >
              <SelectTrigger className="w-full min-w-0" id="wi-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {classifications.map((type) => (
                  <SelectItem key={type} value={type}>
                    {WORK_ITEM_TYPE_LABEL[type]}
                    {type === "milestone" ? " (no longer used)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Describes the work. It is not a level and carries no weight.
            </p>
          </div>

          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="wi-name">Name</Label>
            <Input
              id="wi-name"
              value={form.name}
              onChange={(event) => set("name", event.target.value)}
              placeholder="Risk-Based Inspection"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="wi-parent">Parent</Label>
            <Select
              value={form.parentWorkItemId || NONE}
              onValueChange={(value) => set("parentWorkItemId", value === NONE ? "" : value)}
            >
              <SelectTrigger className="w-full min-w-0" id="wi-parent">
                <SelectValue placeholder="The Project (top level)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>The Project (top level)</SelectItem>
                {parents.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {"  ".repeat(candidate.depth - 1)}
                    {candidate.item.code} — {candidate.item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <LocalWeightField
            id="wi-weight"
            text={form.weightText}
            onText={(text) => set("weightText", text)}
            parentName={parentName}
            recordedWeight={item?.weightPercent}
            contribution={item ? (contributions.get(item.id) ?? null) : undefined}
          />

          <div className="flex items-start gap-3 rounded-lg border p-3 sm:col-span-2">
            <Switch
              id="wi-control-account"
              checked={form.isControlAccount}
              onCheckedChange={(checked) => set("isControlAccount", checked)}
            />
            <div className="grid gap-0.5">
              <LabelWithHelp help={<PlanningHelp concept="controlAccount" />}>
                <Label htmlFor="wi-control-account">Flag this node as a Control Account</Label>
              </LabelWithHelp>
              <p className="text-xs text-muted-foreground">
                Performance is reported and explained at this node.
              </p>
            </div>
          </div>

          <div className="grid gap-1.5 sm:col-span-2">
            <LabelWithHelp help={<PlanningHelp concept="earningMethod" />}>
              <Label htmlFor="wi-method">How the work under this node earns progress</Label>
            </LabelWithHelp>
            <EarningMethodSelect
              id="wi-method"
              value={form.earningMethod}
              onChange={(value) => set("earningMethod", value)}
              inheritedLabel={inheritedMethodLabel}
              methods={NODE_METHODS}
            />
            <p className="text-xs text-muted-foreground">
              A default for its activities; any activity may state its own.
            </p>
          </div>

          <ReportingUnitFields
            idPrefix="wi"
            options={unitOptions}
            value={form.unit}
            onChange={(unit) => set("unit", unit)}
            inheritedLabel={inheritedUnitLabel}
            hierarchyTerm={hierarchyTerm}
          />

          {form.itemType === "deliverable" && (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="wi-deliverable">Governed Deliverable</Label>
              <Select
                value={form.masterDeliverableId || NONE}
                onValueChange={(value) => set("masterDeliverableId", value === NONE ? "" : value)}
              >
                <SelectTrigger className="w-full min-w-0" id="wi-deliverable">
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
                <SelectTrigger className="w-full min-w-0" id="wi-milestone">
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
                A node is no longer a milestone. Add a milestone activity under
                it instead; this legacy link stays readable.
              </p>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="wi-planned-start">Planned Start</Label>
            <Input
              id="wi-planned-start"
              type="date"
              value={form.plannedStartDate}
              onChange={(event) => set("plannedStartDate", event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wi-planned-finish">Planned Finish</Label>
            <Input
              id="wi-planned-finish"
              type="date"
              value={form.plannedFinishDate}
              onChange={(event) => set("plannedFinishDate", event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wi-baseline-start">Baseline Start</Label>
            <Input
              id="wi-baseline-start"
              type="date"
              value={form.baselineStartDate}
              onChange={(event) => set("baselineStartDate", event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wi-baseline-finish">Baseline Finish</Label>
            <Input
              id="wi-baseline-finish"
              type="date"
              value={form.baselineFinishDate}
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
            {saving ? "Saving…" : item ? "Save Changes" : "Add Node"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

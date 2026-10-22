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
import { formatDate } from "@/lib/formatters";
import {
  planningService,
  type PlanningActivityInput,
} from "@/services/planning-service";
import type { PlanningActivity, PlanningEarningMethod } from "@/types";
import {
  EARNING_METHOD_LABEL,
  resolveEarningMethod,
  resolveReportingUnit,
  TASK_EARNING_METHODS,
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

const NONE = "none";

interface ActivityForm {
  workItemId: string;
  code: string;
  name: string;
  kind: "task" | "milestone";
  earningMethod: PlanningEarningMethod | "";
  weightText: string;
  unit: ReportingUnitValue;
  plannedStartDate: string;
  plannedFinishDate: string;
  actualStartDate: string;
  actualFinishDate: string;
  percentText: string;
}

function toForm(activity: PlanningActivity | undefined, nodeId: string | undefined): ActivityForm {
  return {
    workItemId: activity?.workItemId ?? nodeId ?? "",
    code: activity?.code ?? "",
    name: activity?.name ?? "",
    kind: activity?.isMilestone ? "milestone" : "task",
    earningMethod: activity?.earningMethod ?? "",
    weightText: activity?.localWeightPercent === undefined ? "" : String(activity.localWeightPercent),
    unit: {
      departmentId: activity?.departmentId ?? "",
      systemId: activity?.systemId ?? "",
      disciplineId: activity?.disciplineId ?? "",
      structureNodeId: activity?.structureNodeId ?? "",
    },
    plannedStartDate: activity?.plannedStartDate ?? "",
    plannedFinishDate: activity?.plannedFinishDate ?? "",
    actualStartDate: activity?.actualStartDate ?? "",
    actualFinishDate: activity?.actualFinishDate ?? "",
    percentText: activity?.percentCompletePhysical === undefined ? "" : String(activity.percentCompletePhysical),
  };
}

function percentValid(text: string): boolean {
  if (!text.trim()) return true;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

/**
 * Create or edit an activity of the Working Plan (13.11): a task or a true
 * milestone, attached to exactly one planning node once the project has a
 * hierarchy (`docs/02` §26.3 H3, H4).
 *
 * EPRP-owned fields — node, local weight, earning method, reporting unit —
 * are edited here for every activity. Schedule-owned fields (kind, dates,
 * progress) are edited here only for an activity entered in EPRP; an
 * imported activity's schedule values change through Imports & Review
 * (`docs/02` §26.10 rule 3). Every change is logged by the database.
 */
export function ActivityFormDialog({
  projectId,
  activity,
  nodeId,
  tree,
  contributions,
  projectDefaultMethod,
  unitOptions,
  hierarchyTerm,
  onClose,
  onSaved,
}: {
  projectId: string;
  activity?: PlanningActivity;
  /** Pre-selected node for "Add activity under …". */
  nodeId?: string;
  tree: WorkingPlanTree;
  contributions: Map<string, number | null>;
  projectDefaultMethod?: PlanningEarningMethod;
  unitOptions: ReportingUnitOptions;
  hierarchyTerm: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState(() => toForm(activity, nodeId));
  const [saving, setSaving] = React.useState(false);
  const set = <K extends keyof ActivityForm>(key: K, value: ActivityForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const imported = activity?.source === "import";
  const scheduleEditable = !imported;
  const node = form.workItemId ? tree.nodes.get(form.workItemId) : undefined;
  const parentName = node?.item.name ?? "the Project";
  const nodes = [...tree.nodes.values()];
  // Once attached, an activity is moved, never detached (database-enforced).
  const mayDetach = !activity?.workItemId && !tree.hasHierarchy;

  const isMilestone = form.kind === "milestone";
  const inherited = resolveEarningMethod(
    { activity: { ...(activity ?? ({} as PlanningActivity)), isMilestone, earningMethod: undefined }, parent: node ?? null },
    projectDefaultMethod
  );
  const inheritedLabel =
    inherited.method !== null
      ? `${EARNING_METHOD_LABEL[inherited.method]} (${inherited.source === "project" ? "project default" : inherited.source === "kind" ? "milestone" : `from ${tree.nodes.get(inherited.fromNodeId ?? "")?.item.name ?? "node"}`})`
      : inherited.reason === "milestone_default_for_task"
        ? "none — the default is By milestones; choose one"
        : "not set";
  const inheritedUnit = node ? resolveReportingUnit(node) : { unit: null, source: "project_level" as const };

  const milestoneShapeOk =
    !isMilestone || !form.plannedStartDate || !form.plannedFinishDate || form.plannedStartDate === form.plannedFinishDate;
  const valid =
    form.name.trim().length > 0 &&
    weightTextValid(form.weightText) &&
    percentValid(form.percentText) &&
    milestoneShapeOk &&
    (!tree.hasHierarchy || Boolean(form.workItemId)) &&
    !(isMilestone && form.earningMethod && form.earningMethod !== "milestone");

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const input: Partial<PlanningActivityInput> = {
        workItemId: form.workItemId,
        localWeightPercent: parseWeightText(form.weightText),
        // A milestone's method is its kind; storing it is redundant.
        earningMethod: isMilestone ? "" : form.earningMethod,
        ...(unitOptions.family === "other"
          ? { structureNodeId: form.unit.structureNodeId ?? "" }
          : {
              departmentId: form.unit.departmentId ?? "",
              systemId: form.unit.systemId ?? "",
              disciplineId: form.unit.disciplineId ?? "",
            }),
      };
      if (scheduleEditable) {
        Object.assign(input, {
          code: form.code,
          name: form.name,
          isMilestone,
          plannedStartDate: form.plannedStartDate,
          plannedFinishDate: isMilestone && form.plannedStartDate ? form.plannedStartDate : form.plannedFinishDate,
          actualStartDate: form.actualStartDate,
          actualFinishDate: isMilestone && form.actualStartDate ? form.actualStartDate : form.actualFinishDate,
          percentCompletePhysical: isMilestone ? undefined : parseWeightText(form.percentText),
        });
      }
      if (activity) {
        await planningService.updateActivity(activity.id, input);
        toast.success("Activity updated.");
      } else {
        await planningService.createActivity(projectId, {
          ...input,
          name: form.name,
        } as PlanningActivityInput);
        toast.success("Activity added to the Working Plan.");
      }
      onSaved();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save the activity.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{activity ? "Edit Activity" : "Add Activity"}</DialogTitle>
          <DialogDescription>
            A task or a true milestone of the Working Plan. PV, EV and SPI are
            calculated from it — never typed.
          </DialogDescription>
        </DialogHeader>

        {imported && (
          <p className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            Imported{activity?.externalId ? ` as ${activity.externalId}` : ""}. Its dates and
            progress come from the schedule and change through Imports &amp; Review. Here you
            set what EPRP owns: its node, weight, earning method and reporting unit.
          </p>
        )}

        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 [&>*]:min-w-0">
          <div className="grid gap-1.5">
            <Label htmlFor="act-code">Code</Label>
            <Input
              id="act-code"
              value={form.code}
              disabled={!scheduleEditable}
              onChange={(event) => set("code", event.target.value)}
              placeholder="VDU-A10"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="act-kind">Kind</Label>
            <Select
              value={form.kind}
              disabled={!scheduleEditable}
              onValueChange={(value) => {
                const kind = value as ActivityForm["kind"];
                setForm((current) => ({
                  ...current,
                  kind,
                  earningMethod: kind === "milestone" ? "" : current.earningMethod === "milestone" ? "" : current.earningMethod,
                  weightText: kind === "milestone" && !current.weightText ? "0" : current.weightText,
                }));
              }}
            >
              <SelectTrigger className="w-full min-w-0" id="act-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="task">Task — carries work</SelectItem>
                <SelectItem value="milestone">Milestone — an event, zero duration</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="act-name">Name</Label>
            <Input
              id="act-name"
              value={form.name}
              disabled={!scheduleEditable}
              onChange={(event) => set("name", event.target.value)}
              placeholder="Damage mechanisms & corrosion loops"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="act-node">Planning node</Label>
            <Select
              value={form.workItemId || NONE}
              onValueChange={(value) => set("workItemId", value === NONE ? "" : value)}
            >
              <SelectTrigger className="w-full min-w-0" id="act-node" aria-invalid={tree.hasHierarchy && !form.workItemId}>
                <SelectValue placeholder="Choose a node" />
              </SelectTrigger>
              <SelectContent>
                {mayDetach && <SelectItem value={NONE}>The Project (no hierarchy yet)</SelectItem>}
                {nodes.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {"  ".repeat(candidate.depth - 1)}
                    {candidate.item.code} — {candidate.item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tree.hasHierarchy && !form.workItemId && (
              <p className="text-xs text-destructive">
                Attach it to one planning node — it shares that node&apos;s 100%.
              </p>
            )}
          </div>

          <LocalWeightField
            id="act-weight"
            text={form.weightText}
            onText={(text) => set("weightText", text)}
            parentName={parentName}
            recordedWeight={activity?.weightPercent}
            contribution={activity ? (contributions.get(activity.id) ?? null) : undefined}
          />

          <div className="grid gap-1.5 sm:col-span-2">
            <LabelWithHelp help={<PlanningHelp concept="earningMethod" />}>
              <Label htmlFor="act-method">How it earns progress</Label>
            </LabelWithHelp>
            {isMilestone ? (
              <p id="act-method" className="text-sm text-muted-foreground">
                Milestone — 0 until achieved, then 100. A milestone carries 0%
                weight unless its work package earns through milestones.
              </p>
            ) : (
              <EarningMethodSelect
                id="act-method"
                value={form.earningMethod}
                onChange={(value) => set("earningMethod", value)}
                inheritedLabel={inheritedLabel}
                methods={TASK_EARNING_METHODS}
              />
            )}
          </div>

          <ReportingUnitFields
            idPrefix="act"
            options={unitOptions}
            value={form.unit}
            onChange={(unit) => set("unit", unit)}
            inheritedLabel={unitOptions.describe(inheritedUnit.unit)}
            hierarchyTerm={hierarchyTerm}
          />

          {scheduleEditable ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="act-start">{isMilestone ? "Forecast date" : "Forecast start"}</Label>
                <Input
                  id="act-start"
                  type="date"
                  value={form.plannedStartDate}
                  onChange={(event) => set("plannedStartDate", event.target.value)}
                />
              </div>
              {!isMilestone && (
                <div className="grid gap-1.5">
                  <Label htmlFor="act-finish">Forecast finish</Label>
                  <Input
                    id="act-finish"
                    type="date"
                    value={form.plannedFinishDate}
                    onChange={(event) => set("plannedFinishDate", event.target.value)}
                  />
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="act-actual-start">{isMilestone ? "Achieved on" : "Actual start"}</Label>
                <Input
                  id="act-actual-start"
                  type="date"
                  value={form.actualStartDate}
                  onChange={(event) => set("actualStartDate", event.target.value)}
                />
              </div>
              {!isMilestone && (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="act-actual-finish">Actual finish</Label>
                    <Input
                      id="act-actual-finish"
                      type="date"
                      value={form.actualFinishDate}
                      onChange={(event) => set("actualFinishDate", event.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="act-percent">Confirmed physical % complete</Label>
                    <Input
                      id="act-percent"
                      inputMode="decimal"
                      value={form.percentText}
                      aria-invalid={!percentValid(form.percentText)}
                      onChange={(event) => set("percentText", event.target.value)}
                      placeholder="Blank until measured"
                    />
                  </div>
                </>
              )}
              {!milestoneShapeOk && (
                <p className="text-xs text-destructive sm:col-span-2">
                  A milestone starts and finishes on the same date.
                </p>
              )}
            </>
          ) : (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border p-3 text-xs sm:col-span-2">
              <div>
                <dt className="text-muted-foreground">Forecast</dt>
                <dd>
                  {activity?.plannedStartDate ? formatDate(activity.plannedStartDate) : "—"} →{" "}
                  {activity?.plannedFinishDate ? formatDate(activity.plannedFinishDate) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Actual</dt>
                <dd>
                  {activity?.actualStartDate ? formatDate(activity.actualStartDate) : "—"} →{" "}
                  {activity?.actualFinishDate ? formatDate(activity.actualFinishDate) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Physical % complete</dt>
                <dd>{activity?.percentCompletePhysical ?? "Not measured"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Kind</dt>
                <dd>{activity?.isMilestone ? "Milestone" : "Task"}</dd>
              </div>
            </dl>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!valid || saving}>
            {saving ? "Saving…" : activity ? "Save Changes" : "Add Activity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

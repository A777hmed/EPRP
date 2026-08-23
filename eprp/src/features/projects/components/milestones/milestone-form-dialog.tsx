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
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { MILESTONE_TYPE_META, PRIORITY_META } from "@/lib/constants";
import {
  milestoneService,
  type MilestoneInput,
} from "@/services/milestone-service";
import type {
  MasterMilestone,
  MilestonePriority,
  MilestoneType,
} from "@/types";
import type { MilestoneScopeOptions } from "./scope-options";

const PRIORITIES: MilestonePriority[] = ["low", "medium", "high", "critical"];

const TYPES: MilestoneType[] = ["technical", "contractual", "commercial"];

/** The Select primitive cannot hold an empty value, so "none" stands in. */
const NONE = "none";

/** Numbers are held as typed text so a half-entered value is not coerced. */
const numberText = (value: number | undefined) =>
  value === undefined ? "" : String(value);

function toInput(milestone?: MasterMilestone): MilestoneInput {
  return {
    code: milestone?.code ?? "",
    name: milestone?.name ?? "",
    description: milestone?.description ?? "",
    departmentId: milestone?.departmentId ?? "",
    systemId: milestone?.systemId ?? "",
    disciplineId: milestone?.disciplineId ?? "",
    baselineDate: milestone?.baselineDate ?? "",
    priority: milestone?.priority ?? "medium",
    ownerContactId: milestone?.ownerContactId ?? "",

    type: milestone?.type ?? "technical",
    category: milestone?.category ?? "",
    plannedDate: milestone?.plannedDate ?? "",
    weightPercent: numberText(milestone?.weightPercent),
    plannedProgressPercent: numberText(milestone?.plannedProgressPercent),
    predecessorMilestoneId: milestone?.predecessorMilestoneId ?? "",
    clientApprovalRequired: milestone?.clientApprovalRequired ?? false,
    notes: milestone?.notes ?? "",

    paymentPercent: numberText(milestone?.paymentPercent),
    paymentAmount: numberText(milestone?.paymentAmount),
    paymentDueDate: milestone?.paymentDueDate ?? "",
    isAdvancePayment: milestone?.isAdvancePayment ?? false,
  };
}

/** 0–100, or blank. Blank means "not stated" and is always allowed. */
function percentValid(value: number | string | undefined): boolean {
  if (value === undefined || String(value).trim() === "") return true;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100;
}

function amountValid(value: number | string | undefined): boolean {
  if (value === undefined || String(value).trim() === "") return true;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
}

/**
 * Create or edit a milestone IDENTITY.
 *
 * Status, progress and forecast are deliberately absent from this form. They
 * are not properties of the milestone — they are what has been reported about
 * it, and they arrive only through an approved update. Offering them here would
 * create a second writable store of the same figure, which is exactly what the
 * two-table split exists to prevent.
 */
export function MilestoneFormDialog({
  projectId,
  milestone,
  register,
  options,
  scopeTerm,
  onClose,
  onSaved,
}: {
  projectId: string;
  milestone?: MasterMilestone;
  /** The rest of the register, so a predecessor can be chosen from it. */
  register: MasterMilestone[];
  options: MilestoneScopeOptions;
  /** "Discipline", or "Program & Study" on PSM/PSAIM projects. Display only. */
  scopeTerm: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState<MilestoneInput>(() =>
    toInput(milestone)
  );
  const [saving, setSaving] = React.useState(false);

  const set = <K extends keyof MilestoneInput>(
    key: K,
    value: MilestoneInput[K]
  ) => setForm((current) => ({ ...current, [key]: value }));

  // Systems belong to the department that brought them into the project, so
  // narrowing keeps the picker from offering a system the department does not own.
  const systems = form.departmentId
    ? options.systems.filter((system) => system.departmentId === form.departmentId)
    : options.systems;
  const disciplines = form.departmentId
    ? options.disciplines.filter(
        (item) => !item.departmentId || item.departmentId === form.departmentId
      )
    : options.disciplines;

  const commercial = form.type === "commercial";

  /*
   * A milestone cannot wait on itself, and the register already refuses a loop
   * — but offering the choice and then failing the save is a worse experience
   * than not offering it. Archived milestones stay selectable only if already
   * chosen, so an existing dependency is never silently dropped on edit.
   */
  const predecessors = register.filter(
    (candidate) =>
      candidate.id !== milestone?.id &&
      (candidate.active || candidate.id === form.predecessorMilestoneId)
  );

  const fieldsValid =
    (commercial || percentValid(form.weightPercent)) &&
    percentValid(form.plannedProgressPercent) &&
    percentValid(form.paymentPercent) &&
    amountValid(form.paymentAmount);

  const valid =
    form.code.trim().length > 0 && form.name.trim().length > 0 && fieldsValid;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      if (milestone) {
        await milestoneService.update(milestone.id, form);
        toast.success("Milestone updated.");
      } else {
        await milestoneService.create(projectId, form);
        toast.success("Milestone added to the register.");
      }
      onSaved();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not save the milestone."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {milestone ? "Edit Milestone" : "Add Milestone"}
          </DialogTitle>
          <DialogDescription>
            What this milestone is and what was planned. Progress, forecast and
            payment actuals are reported separately and take effect once
            approved.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="milestone-code">Code</Label>
            <Input
              id="milestone-code"
              value={form.code}
              onChange={(event) => set("code", event.target.value)}
              placeholder="M-01"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="milestone-priority">Priority / criticality</Label>
            <Select
              value={form.priority}
              onValueChange={(value) =>
                set("priority", value as MilestonePriority)
              }
            >
              <SelectTrigger id="milestone-priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((priority) => (
                  <SelectItem key={priority} value={priority}>
                    {PRIORITY_META[priority].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="milestone-type">Milestone type</Label>
            <Select
              value={form.type}
              onValueChange={(value) =>
                set("type", value as MilestoneType)
              }
            >
              <SelectTrigger id="milestone-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {MILESTONE_TYPE_META[type].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {MILESTONE_TYPE_META[form.type].description}
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="milestone-category">Category</Label>
            <Input
              id="milestone-category"
              value={String(form.category ?? "")}
              onChange={(event) => set("category", event.target.value)}
              placeholder="Your own label for this kind of milestone"
            />
          </div>

          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="milestone-name">Milestone</Label>
            <Input
              id="milestone-name"
              value={form.name}
              onChange={(event) => set("name", event.target.value)}
              placeholder="Issue HAZOP report for Unit 300"
            />
          </div>

          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="milestone-description">Description</Label>
            <Textarea
              id="milestone-description"
              rows={2}
              value={form.description ?? ""}
              onChange={(event) => set("description", event.target.value)}
              placeholder="What completion means, in the project's own words."
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="milestone-department">Department</Label>
            <Select
              value={form.departmentId || NONE}
              onValueChange={(value) => {
                const departmentId = value === NONE ? "" : value;
                // Clearing the children rather than leaving them behind: a
                // system from another department would file the milestone under
                // scope the department does not own.
                setForm((current) => ({
                  ...current,
                  departmentId,
                  systemId: "",
                  disciplineId: "",
                }));
              }}
            >
              <SelectTrigger id="milestone-department">
                <SelectValue placeholder="Project-wide" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Project-wide</SelectItem>
                {options.departments.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="milestone-system">System</Label>
            <Select
              value={form.systemId || NONE}
              onValueChange={(value) =>
                set("systemId", value === NONE ? "" : value)
              }
            >
              <SelectTrigger id="milestone-system">
                <SelectValue placeholder="Not system-specific" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not system-specific</SelectItem>
                {systems.map((system) => (
                  <SelectItem key={system.id} value={system.id}>
                    {system.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="milestone-discipline">{scopeTerm}</Label>
            <Select
              value={form.disciplineId || NONE}
              onValueChange={(value) =>
                set("disciplineId", value === NONE ? "" : value)
              }
            >
              <SelectTrigger id="milestone-discipline">
                <SelectValue placeholder={`Not ${scopeTerm.toLowerCase()}-specific`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>
                  Not {scopeTerm.toLowerCase()}-specific
                </SelectItem>
                {disciplines.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="milestone-owner">Owner</Label>
            <Select
              value={form.ownerContactId || NONE}
              onValueChange={(value) =>
                set("ownerContactId", value === NONE ? "" : value)
              }
            >
              <SelectTrigger id="milestone-owner">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Unassigned</SelectItem>
                {options.people.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="milestone-predecessor">Depends on</Label>
            <Select
              value={form.predecessorMilestoneId || NONE}
              onValueChange={(value) =>
                set("predecessorMilestoneId", value === NONE ? "" : value)
              }
            >
              <SelectTrigger id="milestone-predecessor">
                <SelectValue placeholder="No predecessor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No predecessor</SelectItem>
                {predecessors.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.code} — {candidate.name}
                    {candidate.active ? "" : " (archived)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/*
            Planned and baseline are both kept and both editable. Baseline is
            the contractual reference; planned is what was last agreed. Showing
            them side by side is what makes a re-plan visible rather than silent.
          */}
          <div className="grid gap-1.5 sm:col-span-2 sm:grid-cols-2 sm:gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="milestone-planned">Planned date</Label>
              <Input
                id="milestone-planned"
                type="date"
                value={String(form.plannedDate ?? "")}
                onChange={(event) => set("plannedDate", event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="milestone-baseline">Baseline date</Label>
              <Input
                id="milestone-baseline"
                type="date"
                value={form.baselineDate ?? ""}
                onChange={(event) => set("baselineDate", event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The frozen contractual reference. Leave it alone in a re-plan.
              </p>
            </div>
          </div>

          {/*
            Weight is PHYSICAL scope, so a commercial milestone cannot have one
            — the database refuses it outright. Hiding the field is the honest
            way to say so; disabling it would imply the value merely does not
            apply right now.
          */}
          {!commercial && (
            <div className="grid gap-1.5">
              <Label htmlFor="milestone-weight">Weight %</Label>
              <Input
                id="milestone-weight"
                inputMode="decimal"
                value={String(form.weightPercent ?? "")}
                onChange={(event) => set("weightPercent", event.target.value)}
                placeholder="Share of physical scope"
                aria-invalid={!percentValid(form.weightPercent)}
              />
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="milestone-planned-progress">Planned progress %</Label>
            <Input
              id="milestone-planned-progress"
              inputMode="numeric"
              value={String(form.plannedProgressPercent ?? "")}
              onChange={(event) =>
                set("plannedProgressPercent", event.target.value)
              }
              placeholder="What the plan expects by now"
              aria-invalid={!percentValid(form.plannedProgressPercent)}
            />
          </div>

          <div className="flex items-start gap-2 sm:col-span-2">
            <Checkbox
              id="milestone-client-approval"
              checked={form.clientApprovalRequired ?? false}
              onCheckedChange={(checked) =>
                set("clientApprovalRequired", checked === true)
              }
            />
            <div className="grid gap-0.5">
              <Label htmlFor="milestone-client-approval">
                Client approval required
              </Label>
              <p className="text-xs text-muted-foreground">
                Whether the client must approve. Whether they DID is reported
                through an update, never recorded here.
              </p>
            </div>
          </div>

          {commercial && (
            <div className="sm:col-span-2 grid gap-4 rounded-md border border-warning/25 bg-warning/5 p-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <p className="text-sm font-medium">Commercial / Payment</p>
                <p className="text-xs text-muted-foreground">
                  What was agreed. Invoicing, receipt and recovery are reported
                  through updates and approved like any other figure.
                  {/*
                    The accounting rule, stated where the decision is made. A
                    commercial milestone never adds to physical progress — this
                    is the constraint in words, not a preference.
                  */}{" "}
                  A payment never adds to physical progress: a 10% advance on a
                  100% contract does not make the project 110% delivered.
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="milestone-payment-percent">Payment %</Label>
                <Input
                  id="milestone-payment-percent"
                  inputMode="decimal"
                  value={String(form.paymentPercent ?? "")}
                  onChange={(event) => set("paymentPercent", event.target.value)}
                  placeholder="Share of contract value"
                  aria-invalid={!percentValid(form.paymentPercent)}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="milestone-payment-amount">Payment amount</Label>
                <Input
                  id="milestone-payment-amount"
                  inputMode="decimal"
                  value={String(form.paymentAmount ?? "")}
                  onChange={(event) => set("paymentAmount", event.target.value)}
                  aria-invalid={!amountValid(form.paymentAmount)}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="milestone-payment-due">Due date</Label>
                <Input
                  id="milestone-payment-due"
                  type="date"
                  value={String(form.paymentDueDate ?? "")}
                  onChange={(event) => set("paymentDueDate", event.target.value)}
                />
              </div>

              <div className="flex items-start gap-2">
                <Checkbox
                  id="milestone-advance"
                  checked={form.isAdvancePayment ?? false}
                  onCheckedChange={(checked) =>
                    set("isAdvancePayment", checked === true)
                  }
                />
                <div className="grid gap-0.5">
                  <Label htmlFor="milestone-advance">
                    Advance / down payment
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Recovered from later certificates. Tracked inside contract
                    value, never above it.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="milestone-notes">Notes</Label>
            <Textarea
              id="milestone-notes"
              rows={2}
              value={String(form.notes ?? "")}
              onChange={(event) => set("notes", event.target.value)}
              placeholder="Anything a reader of the register needs to know."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!valid || saving}>
            {saving ? "Saving…" : milestone ? "Save Changes" : "Add Milestone"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

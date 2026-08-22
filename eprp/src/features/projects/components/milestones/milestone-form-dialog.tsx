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
import { Textarea } from "@/components/ui/textarea";
import { PRIORITY_META } from "@/lib/constants";
import {
  milestoneService,
  type MilestoneInput,
} from "@/services/milestone-service";
import type { MasterMilestone, MilestonePriority } from "@/types";
import type { MilestoneScopeOptions } from "./scope-options";

const PRIORITIES: MilestonePriority[] = ["low", "medium", "high", "critical"];

/** The Select primitive cannot hold an empty value, so "none" stands in. */
const NONE = "none";

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
  };
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
  options,
  scopeTerm,
  onClose,
  onSaved,
}: {
  projectId: string;
  milestone?: MasterMilestone;
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

  const valid = form.code.trim().length > 0 && form.name.trim().length > 0;

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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {milestone ? "Edit Milestone" : "Add Milestone"}
          </DialogTitle>
          <DialogDescription>
            What this milestone is and when it is planned. Progress and forecast
            are reported separately and take effect once approved.
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
            <Label htmlFor="milestone-priority">Priority</Label>
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
            <Label htmlFor="milestone-baseline">Baseline date</Label>
            <Input
              id="milestone-baseline"
              type="date"
              value={form.baselineDate ?? ""}
              onChange={(event) => set("baselineDate", event.target.value)}
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

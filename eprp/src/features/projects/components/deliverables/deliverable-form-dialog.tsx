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
import {
  deliverableService,
  type DeliverableInput,
} from "@/services/deliverable-service";
import type { MasterDeliverable, MasterMilestone, ProjectDocument } from "@/types";
import type { MilestoneScopeOptions } from "../milestones/scope-options";

/** The Select primitive cannot hold an empty value, so "none" stands in. */
const NONE = "none";

function toInput(deliverable?: MasterDeliverable): DeliverableInput {
  return {
    code: deliverable?.code ?? "",
    title: deliverable?.title ?? "",
    description: deliverable?.description ?? "",
    departmentId: deliverable?.departmentId ?? "",
    systemId: deliverable?.systemId ?? "",
    disciplineId: deliverable?.disciplineId ?? "",
    ownerContactId: deliverable?.ownerContactId ?? "",
    milestoneId: deliverable?.milestoneId ?? "",
    plannedSubmissionDate: deliverable?.plannedSubmissionDate ?? "",
    revision: deliverable?.revision ?? "",
    documentId: deliverable?.documentId ?? "",
  };
}

/**
 * Create or edit a deliverable IDENTITY.
 *
 * Client review status, actual submission date and the submitted revision are
 * deliberately absent. They are not properties of the deliverable — they are
 * what has been reported about it, and they arrive only through an approved
 * update.
 *
 * The milestone picker stores an ID. Nothing about the chosen milestone is
 * copied onto this record, so `master_milestones` stays the only place a
 * milestone is defined.
 */
export function DeliverableFormDialog({
  projectId,
  deliverable,
  options,
  milestones,
  documents,
  scopeTerm,
  onClose,
  onSaved,
}: {
  projectId: string;
  deliverable?: MasterDeliverable;
  options: MilestoneScopeOptions;
  /** Active milestones on this project, for the reference picker. */
  milestones: MasterMilestone[];
  /** Controlled reference documents, for the evidence link. */
  documents: ProjectDocument[];
  scopeTerm: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState<DeliverableInput>(() =>
    toInput(deliverable)
  );
  const [saving, setSaving] = React.useState(false);

  const set = <K extends keyof DeliverableInput>(
    key: K,
    value: DeliverableInput[K]
  ) => setForm((current) => ({ ...current, [key]: value }));

  const systems = form.departmentId
    ? options.systems.filter(
        (system) => system.departmentId === form.departmentId
      )
    : options.systems;
  const disciplines = form.departmentId
    ? options.disciplines.filter(
        (item) => !item.departmentId || item.departmentId === form.departmentId
      )
    : options.disciplines;

  const valid = form.code.trim().length > 0 && form.title.trim().length > 0;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      if (deliverable) {
        await deliverableService.update(deliverable.id, form);
        toast.success("Deliverable updated.");
      } else {
        await deliverableService.create(projectId, form);
        toast.success("Deliverable added to the register.");
      }
      onSaved();
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Could not save the deliverable."
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
            {deliverable ? "Edit Deliverable" : "Add Deliverable"}
          </DialogTitle>
          <DialogDescription>
            What this deliverable is and when it is planned. Where it stands with
            the client is reported separately and takes effect once approved.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="deliverable-code">Code</Label>
            <Input
              id="deliverable-code"
              value={form.code}
              onChange={(event) => set("code", event.target.value)}
              placeholder="D-01"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="deliverable-revision">Planned revision</Label>
            <Input
              id="deliverable-revision"
              value={form.revision ?? ""}
              onChange={(event) => set("revision", event.target.value)}
              placeholder="IFR, Rev B…"
            />
          </div>

          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="deliverable-title">Title</Label>
            <Input
              id="deliverable-title"
              value={form.title}
              onChange={(event) => set("title", event.target.value)}
              placeholder="HAZOP Report — Unit 300"
            />
          </div>

          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="deliverable-description">Description</Label>
            <Textarea
              id="deliverable-description"
              rows={2}
              value={form.description ?? ""}
              onChange={(event) => set("description", event.target.value)}
              placeholder="What is being submitted, and to whom."
            />
          </div>

          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="deliverable-milestone">Serves milestone</Label>
            <Select
              value={form.milestoneId || NONE}
              onValueChange={(value) =>
                set("milestoneId", value === NONE ? "" : value)
              }
            >
              <SelectTrigger id="deliverable-milestone">
                <SelectValue placeholder="Not linked to a milestone" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not linked to a milestone</SelectItem>
                {milestones.map((milestone) => (
                  <SelectItem key={milestone.id} value={milestone.id}>
                    {milestone.code} — {milestone.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              A reference into the milestone register. The milestone&rsquo;s own
              dates and progress stay there and are never copied here.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="deliverable-department">Department</Label>
            <Select
              value={form.departmentId || NONE}
              onValueChange={(value) => {
                const departmentId = value === NONE ? "" : value;
                // Clearing the children rather than leaving them behind: a
                // system from another department would file the deliverable
                // under scope the department does not own.
                setForm((current) => ({
                  ...current,
                  departmentId,
                  systemId: "",
                  disciplineId: "",
                }));
              }}
            >
              <SelectTrigger id="deliverable-department">
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
            <Label htmlFor="deliverable-system">System</Label>
            <Select
              value={form.systemId || NONE}
              onValueChange={(value) =>
                set("systemId", value === NONE ? "" : value)
              }
            >
              <SelectTrigger id="deliverable-system">
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
            <Label htmlFor="deliverable-discipline">{scopeTerm}</Label>
            <Select
              value={form.disciplineId || NONE}
              onValueChange={(value) =>
                set("disciplineId", value === NONE ? "" : value)
              }
            >
              <SelectTrigger id="deliverable-discipline">
                <SelectValue
                  placeholder={`Not ${scopeTerm.toLowerCase()}-specific`}
                />
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
            <Label htmlFor="deliverable-owner">Owner</Label>
            <Select
              value={form.ownerContactId || NONE}
              onValueChange={(value) =>
                set("ownerContactId", value === NONE ? "" : value)
              }
            >
              <SelectTrigger id="deliverable-owner">
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
            <Label htmlFor="deliverable-planned">Planned submission</Label>
            <Input
              id="deliverable-planned"
              type="date"
              value={form.plannedSubmissionDate ?? ""}
              onChange={(event) =>
                set("plannedSubmissionDate", event.target.value)
              }
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="deliverable-document">Evidence document</Label>
            <Select
              value={form.documentId || NONE}
              onValueChange={(value) =>
                set("documentId", value === NONE ? "" : value)
              }
            >
              <SelectTrigger id="deliverable-document">
                <SelectValue placeholder="No file linked" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No file linked</SelectItem>
                {documents.map((document) => (
                  <SelectItem key={document.id} value={document.id}>
                    {document.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!valid || saving}>
            {saving
              ? "Saving…"
              : deliverable
                ? "Save Changes"
                : "Add Deliverable"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

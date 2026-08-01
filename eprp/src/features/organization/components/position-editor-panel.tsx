"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Loader2, Save, UserX, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/shared";
import {
  EMPLOYMENT_TYPE_META,
  POSITION_STATUS_META,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import {
  ManagedPersonSelect,
  ManagedSelect,
  getContactById,
} from "@/features/master-data";
import { wouldCreateCycle } from "@/lib/organization-tree";
import type {
  EmploymentType,
  MasterRecordBase,
  OrganizationPosition,
  PositionStatus,
} from "@/types";

/** The editable shape of a position, as the form holds it. */
export interface PositionEditorValues {
  code: string;
  contactId: string;
  title: string;
  departmentId: string;
  disciplineId: string;
  company: string;
  role: string;
  parentPositionId: string;
  /** Empty string means "not set", which clears the column on save. */
  employmentType: EmploymentType | "";
  email: string;
  phone: string;
  status: PositionStatus;
  startDate: string;
  endDate: string;
  notes: string;
}

function toValues(position: OrganizationPosition): PositionEditorValues {
  return {
    code: position.code ?? "",
    contactId: position.contactId ?? "",
    title: position.title,
    departmentId: position.departmentId ?? "",
    disciplineId: position.disciplineId ?? "",
    company: position.company ?? "",
    role: position.role ?? "",
    parentPositionId: position.parentPositionId ?? "",
    employmentType: position.employmentType ?? "",
    email: position.email ?? "",
    phone: position.phone ?? "",
    status: position.status,
    startDate: position.startDate ?? "",
    endDate: position.endDate ?? "",
    notes: position.notes ?? "",
  };
}

/** What the panel hands back on save. */
export type PositionEditorSubmit = PositionEditorValues & {
  /** True when the occupant changed, so history is only written when real. */
  contactChanged: boolean;
};

export interface PositionEditorPanelProps {
  position: OrganizationPosition;
  /** Every position in the chart, for the "Reports To" picker. */
  positions: OrganizationPosition[];
  saving: boolean;
  /** Locked charts still show their positions, but nothing can be changed. */
  readOnly?: boolean;
  onSave: (values: PositionEditorSubmit) => Promise<void>;
  onClose: () => void;
  className?: string;
}

/**
 * Right-hand editor for the selected position.
 *
 * Departments, disciplines, and people come from the existing managed master
 * data rather than free text, so a chart never invents records the rest of
 * the platform does not know about. A position with no person is a vacancy,
 * which is a first-class state rather than an empty field.
 */
export function PositionEditorPanel({
  position,
  positions,
  saving,
  readOnly = false,
  onSave,
  onClose,
  className,
}: PositionEditorPanelProps) {
  // Remount on selection change resets the form to the new position.
  const [values, setValues] = React.useState<PositionEditorValues>(() =>
    toValues(position)
  );
  // The last saved snapshot, for the dirty check. State rather than a ref
  // so it can be read during render.
  const [baseline, setBaseline] = React.useState<PositionEditorValues>(() =>
    toValues(position)
  );

  const set = <K extends keyof PositionEditorValues>(key: K, value: PositionEditorValues[K]) =>
    setValues((previous) => ({ ...previous, [key]: value }));

  const occupant = getContactById(values.contactId || undefined);
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline);

  // A position cannot report to itself or to anything beneath it.
  const reportsToOptions = positions.filter(
    (candidate) =>
      candidate.id !== position.id &&
      !wouldCreateCycle(positions, position.id, candidate.id)
  );

  const handleSave = async () => {
    // Only rebaseline once the save actually succeeded, so a failure leaves
    // the panel showing unsaved changes.
    await onSave({
      ...values,
      contactChanged: values.contactId !== (position.contactId ?? ""),
    });
    setBaseline(values);
  };

  const markVacant = () => {
    setValues((previous) => ({
      ...previous,
      contactId: "",
      status: "vacant",
    }));
  };

  return (
    <aside
      aria-label={
        readOnly ? `Position ${position.title}` : `Edit position ${position.title}`
      }
      className={cn(
        "flex h-[34rem] flex-col rounded-xl border bg-card shadow-soft",
        className
      )}
    >
      <header className="flex items-start justify-between gap-2 border-b p-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">
            {readOnly ? "Position details" : "Edit position"}
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {position.title}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <StatusBadge tone={POSITION_STATUS_META[values.status].tone}>
            {POSITION_STATUS_META[values.status].label}
          </StatusBadge>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close editor"
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {/* Disabling the set covers every control inside it, including the
            ones rendered by child components. */}
        <fieldset disabled={readOnly} className="contents">
        <Field>
          <FieldLabel htmlFor="pos-code">Position Code</FieldLabel>
          <Input
            id="pos-code"
            value={values.code}
            placeholder="e.g. PM-01"
            onChange={(event) => set("code", event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="pos-contact">Full Name</FieldLabel>
          <ManagedPersonSelect
            value={values.contactId}
            onChange={(id) =>
              setValues((previous) => ({
                ...previous,
                contactId: id,
                // Filling an empty seat makes it active; the user can
                // override afterwards.
                status:
                  id && previous.status === "vacant" ? "active" : previous.status,
              }))
            }
            allowClear
            placeholder="Search people…"
            clearLabel="Clear assigned person"
            controlProps={{ id: "pos-contact" }}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {occupant
                ? [occupant.position, occupant.email]
                    .filter(Boolean)
                    .join(" · ")
                : "No one assigned — this seat is vacant."}
            </p>
            {values.contactId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={markVacant}
                className="shrink-0"
              >
                <UserX data-icon="inline-start" aria-hidden="true" />
                Vacate
              </Button>
            )}
          </div>
        </Field>

        <Field>
          <FieldLabel htmlFor="pos-title">Job Title</FieldLabel>
          <Input
            id="pos-title"
            value={values.title}
            onChange={(event) => set("title", event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="pos-department">Department</FieldLabel>
          <ManagedSelect
            kind="department"
            value={values.departmentId}
            onChange={(id) =>
              setValues((previous) => ({
                ...previous,
                departmentId: id,
                // A discipline belongs to a department; changing the
                // department invalidates the narrower choice.
                disciplineId:
                  id === previous.departmentId ? previous.disciplineId : "",
              }))
            }
            allowClear
            placeholder="Select department…"
            controlProps={{ id: "pos-department" }}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="pos-discipline">Discipline</FieldLabel>
          <ManagedSelect
            kind="discipline"
            value={values.disciplineId}
            onChange={(id) => set("disciplineId", id)}
            allowClear
            filter={(record: MasterRecordBase) =>
              !values.departmentId ||
              (record as { departmentId?: string }).departmentId ===
                values.departmentId
            }
            emptyLabel="No disciplines in this department."
            placeholder="Select discipline…"
            controlProps={{ id: "pos-discipline" }}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="pos-company">Company</FieldLabel>
          <Input
            id="pos-company"
            value={values.company}
            placeholder="Employing organisation"
            onChange={(event) => set("company", event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="pos-role">Project Role</FieldLabel>
          <Input
            id="pos-role"
            value={values.role}
            placeholder="e.g. Discipline Lead"
            onChange={(event) => set("role", event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="pos-reports-to">Reports To</FieldLabel>
          <PositionCombobox
            id="pos-reports-to"
            value={values.parentPositionId}
            options={reportsToOptions}
            onChange={(id) => set("parentPositionId", id)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="pos-employment">Employment Type</FieldLabel>
          <Select
            value={values.employmentType || "none"}
            onValueChange={(next) =>
              set("employmentType", next === "none" ? "" : (next as EmploymentType))
            }
          >
            <SelectTrigger id="pos-employment" className="w-full">
              <SelectValue placeholder="Not set" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not set</SelectItem>
              {(Object.keys(EMPLOYMENT_TYPE_META) as EmploymentType[]).map(
                (type) => (
                  <SelectItem key={type} value={type}>
                    {EMPLOYMENT_TYPE_META[type].label}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="pos-email">Email</FieldLabel>
          <Input
            id="pos-email"
            type="email"
            value={values.email}
            placeholder={occupant?.email ?? "Role inbox"}
            onChange={(event) => set("email", event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="pos-phone">Phone</FieldLabel>
          <Input
            id="pos-phone"
            type="tel"
            value={values.phone}
            placeholder={occupant?.phone ?? "Role phone"}
            onChange={(event) => set("phone", event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="pos-status">Status</FieldLabel>
          <Select
            value={values.status}
            onValueChange={(next) => set("status", next as PositionStatus)}
          >
            <SelectTrigger id="pos-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(POSITION_STATUS_META) as PositionStatus[]).map(
                (status) => (
                  <SelectItem key={status} value={status}>
                    {POSITION_STATUS_META[status].label}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
          {values.status === "active" && !values.contactId && (
            <p className="text-xs text-warning">
              Marked active but nobody is assigned.
            </p>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field>
            <FieldLabel htmlFor="pos-start">Start Date</FieldLabel>
            <Input
              id="pos-start"
              type="date"
              value={values.startDate}
              onChange={(event) => set("startDate", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="pos-end">End Date</FieldLabel>
            <Input
              id="pos-end"
              type="date"
              value={values.endDate}
              min={values.startDate || undefined}
              onChange={(event) => set("endDate", event.target.value)}
            />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="pos-notes">Notes</FieldLabel>
          <Textarea
            id="pos-notes"
            rows={3}
            value={values.notes}
            onChange={(event) => set("notes", event.target.value)}
          />
        </Field>
        </fieldset>
      </div>

      <Separator />
      <footer className="flex items-center justify-between gap-2 p-3">
        <span className="text-xs text-muted-foreground">
          {readOnly
            ? "Read-only"
            : dirty
              ? "Unsaved changes"
              : "Saved"}
        </span>
        {!readOnly && (
        <Button
          // The failure is already reported by the caller's toast; swallow
          // it here so the click handler never rejects unhandled.
          onClick={() => void handleSave().catch(() => {})}
          disabled={saving || !dirty}
        >
          {saving ? (
            <Loader2
              data-icon="inline-start"
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <Save data-icon="inline-start" aria-hidden="true" />
          )}
          Save position
        </Button>
        )}
      </footer>
    </aside>
  );
}

/* ---------------------------- Reports-to picker --------------------------- */

/**
 * Searchable picker over the chart's other positions. Options are already
 * filtered to those that cannot create a cycle.
 */
function PositionCombobox({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: string;
  options: OrganizationPosition[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((option) => option.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {selected ? selected.title : "No one (root position)"}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder="Search positions…" />
          <CommandList>
            <CommandEmpty>No positions found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__root__"
                onSelect={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                <Check
                  className={cn("size-4", value ? "opacity-0" : "opacity-100")}
                />
                No one (root position)
              </CommandItem>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={`${option.title} ${option.code ?? ""}`}
                  onSelect={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "size-4",
                      value === option.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="truncate">{option.title}</span>
                  {option.code && (
                    <span className="ml-auto font-mono text-xs text-muted-foreground">
                      {option.code}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

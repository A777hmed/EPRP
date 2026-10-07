"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { useFieldArray, useWatch, type Control, type UseFormReturn } from "react-hook-form";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { SubcontractorEngagementStatus } from "@/types";
import {
  ENGAGEMENT_STATUS_LABELS,
  SUBCONTRACTOR_ENGAGEMENT_STATUSES,
  SUBCONTRACTOR_LIMITS,
  isEngagementStatus,
  subcontractorDisplayName,
} from "../project-parties";
import type { ProjectFormValues } from "../schemas/project-form";
import { RhfField } from "./form-field";

const STATUS_TONE: Record<SubcontractorEngagementStatus, StatusTone> = {
  planned: "info",
  active: "success",
  suspended: "warning",
  completed: "neutral",
};

/** Explicit "not chosen" state; a new row is never defaulted to Planned. */
const NEW_SUBCONTRACTOR: ProjectFormValues["subcontractors"][number] = {
  name: "", shortName: "", scope: "", contractReference: "", engagementStatus: "",
};

/**
 * Opening the list moves focus off the trigger; that is not "leaving" the
 * field. The field counts as interacted with when the list closes (with or
 * without a choice) or when focus leaves the closed trigger.
 */
function EngagementStatusSelect({ field, controlProps, disabled }: {
  field: { value: string; onChange: (value: string) => void; onBlur: () => void };
  controlProps: React.ComponentProps<typeof SelectTrigger>;
  disabled: boolean;
}) {
  const open = React.useRef(false);
  return (
    <Select
      value={isEngagementStatus(field.value) ? field.value : undefined}
      onValueChange={field.onChange}
      onOpenChange={(next) => {
        open.current = next;
        if (!next) field.onBlur();
      }}
      disabled={disabled}
    >
      <SelectTrigger {...controlProps} className="w-full" onBlur={() => { if (!open.current) field.onBlur(); }}>
        <SelectValue placeholder="Select engagement status" />
      </SelectTrigger>
      <SelectContent>
        {SUBCONTRACTOR_ENGAGEMENT_STATUSES.map((option) => (
          <SelectItem key={option} value={option}>{ENGAGEMENT_STATUS_LABELS[option]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const SUBCONTRACTOR_FIELDS = ["name", "shortName", "scope", "contractReference", "engagementStatus"] as const;

/** A subcontractor field shows its error only once touched (validation is unchanged). */
const showWhenTouched = ({ isTouched }: { isTouched: boolean }) => isTouched;

/**
 * Called on every Save Draft / Save Changes / Save & Continue attempt: marks
 * every field of every current subcontractor row as touched, so all of their
 * errors show. Values are unchanged and nothing is marked dirty. Rows added
 * later start untouched (neutral); remove() drops a row's touched state and
 * errors together.
 */
export function touchSubcontractorFields(
  form: Pick<UseFormReturn<ProjectFormValues>, "getValues" | "setValue">
): void {
  form.getValues("subcontractors").forEach((row, index) => {
    for (const key of SUBCONTRACTOR_FIELDS) {
      form.setValue(`subcontractors.${index}.${key}`, row[key] ?? "", { shouldTouch: true });
    }
  });
}

/**
 * Project Information owns these edits; nothing is written until its normal
 * save. PSM and Other projects render exactly the same Project Parties model.
 * A newly added card starts neutral: required markers show at once, errors
 * only after a field is left or a save is attempted.
 */
export function ProjectPartiesFields({
  control, ownerFields, disabled = false, supported = true,
}: {
  control: Control<ProjectFormValues>;
  ownerFields: React.ReactNode;
  disabled?: boolean;
  supported?: boolean;
}) {
  const { fields, append, remove } = useFieldArray({ control, name: "subcontractors" });
  const values = useWatch({ control, name: "subcontractors" }) ?? [];
  const locked = disabled || !supported;
  return (
    <section aria-labelledby="project-parties-heading" className="space-y-4 border-t pt-4 sm:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="project-parties-heading" className="text-sm font-semibold">Project Parties</h3>
        <p className="text-xs text-muted-foreground">
          <span className="text-destructive" aria-hidden="true">*</span> Required field
        </p>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-medium">EPROM</span>
        <span className="text-xs text-muted-foreground">Required · Fixed project party · Service provider</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{ownerFields}</div>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-medium">
            Subcontractors{fields.length > 0 && ` (${fields.length})`}{" "}
            <span className="text-xs font-normal text-muted-foreground">Optional</span>
          </h4>
          <Button type="button" variant="outline" size="sm" disabled={locked}
            onClick={() => append({ ...NEW_SUBCONTRACTOR })}>
            <Plus className="size-4" /> Add Subcontractor
          </Button>
        </div>
        {!supported && <p className="text-sm text-muted-foreground">Subcontractor setup is not available yet. Contact your administrator.</p>}
        {fields.length === 0 && <p className="text-sm text-muted-foreground">No subcontractors configured. You can complete Project Information without any.</p>}
        {fields.map((row, index) => {
          const value = values[index] ?? NEW_SUBCONTRACTOR;
          const heading = subcontractorDisplayName(value) || "New subcontractor";
          const status = isEngagementStatus(value.engagementStatus) ? value.engagementStatus : undefined;
          // A saved row (it has a party UUID) missing professional data, e.g. from 2C.3A.
          const needsCompletion = Boolean(value.id) && (!value.scope?.trim() || !status);
          const headingId = `subcontractor-${row.id}-heading`;
          return (
            <div key={row.id} role="group" aria-labelledby={headingId} className="space-y-4 rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-xs text-muted-foreground">Subcontractor {index + 1}</p>
                  <h5 id={headingId} className="truncate text-sm font-semibold">{heading}</h5>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {needsCompletion && <StatusBadge tone="warning">Needs completion</StatusBadge>}
                  {status && <StatusBadge tone={STATUS_TONE[status]}>{ENGAGEMENT_STATUS_LABELS[status]}</StatusBadge>}
                  <Button type="button" variant="ghost" size="icon" disabled={locked}
                    aria-label={`Remove subcontractor ${index + 1}`} onClick={() => remove(index)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-6">
                <RhfField control={control} name={`subcontractors.${index}.name`} label="Registered Company Name" required showError={showWhenTouched} className="sm:col-span-4">
                  {({ field, controlProps }) => <Input {...field} {...controlProps} disabled={locked} maxLength={SUBCONTRACTOR_LIMITS.name} placeholder="Company name as registered" />}
                </RhfField>
                <RhfField control={control} name={`subcontractors.${index}.shortName`} label="Short Name / Acronym" optional showError={showWhenTouched} className="sm:col-span-2">
                  {({ field, controlProps }) => <Input {...field} {...controlProps} value={field.value ?? ""} disabled={locked} maxLength={SUBCONTRACTOR_LIMITS.shortName} placeholder="e.g. ACME" />}
                </RhfField>
                <RhfField control={control} name={`subcontractors.${index}.scope`} label="Scope / Package" required showError={showWhenTouched} className="sm:col-span-6">
                  {({ field, controlProps }) => <Textarea {...field} {...controlProps} value={field.value ?? ""} rows={2} disabled={locked} maxLength={SUBCONTRACTOR_LIMITS.scope} placeholder="Work package or scope delivered by this subcontractor" />}
                </RhfField>
                <RhfField control={control} name={`subcontractors.${index}.contractReference`} label="Subcontract / Contract Reference" optional showError={showWhenTouched} className="sm:col-span-3">
                  {({ field, controlProps }) => <Input {...field} {...controlProps} value={field.value ?? ""} disabled={locked} maxLength={SUBCONTRACTOR_LIMITS.contractReference} placeholder="e.g. SC-2026-014" />}
                </RhfField>
                <RhfField control={control} name={`subcontractors.${index}.engagementStatus`} label="Engagement Status" required showError={showWhenTouched} className="sm:col-span-3">
                  {({ field, controlProps }) => <EngagementStatusSelect field={field} controlProps={controlProps} disabled={locked} />}
                </RhfField>
              </div>
            </div>
          );
        })}
        {fields.length > 0 && <p className="text-xs text-muted-foreground">Changes, including removals, take effect when Project Information is saved.</p>}
      </div>
    </section>
  );
}

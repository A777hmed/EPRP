"use client";

import { Plus, Trash2 } from "lucide-react";
import { useFieldArray, type Control } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProjectFormValues } from "../schemas/project-form";
import { RhfField } from "./form-field";

/** Project Information owns these edits; nothing is written until its normal save. */
export function ProjectPartiesFields({
  control, ownerFields, disabled = false, supported = true,
}: {
  control: Control<ProjectFormValues>;
  ownerFields: React.ReactNode;
  disabled?: boolean;
  supported?: boolean;
}) {
  const { fields, append, remove } = useFieldArray({ control, name: "subcontractors" });
  return (
    <section aria-labelledby="project-parties-heading" className="space-y-4 border-t pt-4 sm:col-span-2">
      <h3 id="project-parties-heading" className="text-sm font-semibold">Project Parties</h3>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-medium">EPROM</span>
        <span className="text-xs text-muted-foreground">Required · Fixed project party · Service provider</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{ownerFields}</div>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-medium">Subcontractors <span className="text-xs font-normal text-muted-foreground">Optional</span></h4>
          <Button type="button" variant="outline" size="sm" disabled={disabled || !supported}
            onClick={() => append({ name: "" })}>
            <Plus className="size-4" /> Add Subcontractor
          </Button>
        </div>
        {!supported && <p className="text-sm text-muted-foreground">Subcontractor setup is not available yet. Contact your administrator.</p>}
        {fields.length === 0 && <p className="text-sm text-muted-foreground">No subcontractors configured. You can complete Project Information without any.</p>}
        {fields.map((row, index) => (
          <div key={row.id} className="flex items-start gap-2">
            <RhfField control={control} name={`subcontractors.${index}.name`} label={`Subcontractor ${index + 1}`} required className="flex-1">
              {({ field, controlProps }) => <Input {...field} {...controlProps} disabled={disabled || !supported} maxLength={140} placeholder="Company name" />}
            </RhfField>
            <Button type="button" variant="ghost" size="icon" className="mt-6 shrink-0" disabled={disabled || !supported}
              aria-label={`Remove subcontractor ${index + 1}`} onClick={() => remove(index)}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        {fields.length > 0 && <p className="text-xs text-muted-foreground">Changes, including removals, take effect when Project Information is saved.</p>}
      </div>
    </section>
  );
}

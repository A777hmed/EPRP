"use client";

import { Trash2 } from "lucide-react";
import type { Control } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProjectFormValues } from "@/features/projects/schemas/project-form";
import { RhfField } from "./form-field";

export interface SystemAssignmentRowProps {
  control: Control<ProjectFormValues>;
  departmentIndex: number;
  systemIndex: number;
  onRemove: () => void;
}

/** One system row inside a department assignment: name, code, remove. */
export function SystemAssignmentRow({
  control,
  departmentIndex,
  systemIndex,
  onRemove,
}: SystemAssignmentRowProps) {
  return (
    <div className="flex items-start gap-2">
      <RhfField
        control={control}
        name={`departments.${departmentIndex}.systems.${systemIndex}.name`}
        label={`System ${systemIndex + 1} name`}
        required
        className="flex-1 [&>[data-slot=field-label]]:sr-only"
      >
        {({ field, controlProps }) => (
          <Input
            {...controlProps}
            placeholder="System name, e.g. Tank Farm"
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            name={field.name}
            ref={field.ref}
          />
        )}
      </RhfField>
      <RhfField
        control={control}
        name={`departments.${departmentIndex}.systems.${systemIndex}.code`}
        label={`System ${systemIndex + 1} code`}
        className="w-28 [&>[data-slot=field-label]]:sr-only"
      >
        {({ field, controlProps }) => (
          <Input
            {...controlProps}
            placeholder="Code"
            value={field.value ?? ""}
            onChange={field.onChange}
            onBlur={field.onBlur}
            name={field.name}
            ref={field.ref}
          />
        )}
      </RhfField>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Remove system ${systemIndex + 1}`}
        onClick={onRemove}
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </div>
  );
}

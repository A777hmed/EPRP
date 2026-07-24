"use client";

import { Plus, Trash2 } from "lucide-react";
import { useFieldArray, type Control } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useMasterData } from "@/features/master-data";
import type { ProjectFormValues } from "@/features/projects/schemas/project-form";
import { RhfField } from "./form-field";
import { SystemAssignmentRow } from "./system-assignment-row";

let systemSeq = 0;
function nextSystemId(): string {
  systemSeq += 1;
  return `sys-form-${Date.now()}-${systemSeq}`;
}

export interface DepartmentAssignmentCardProps {
  control: Control<ProjectFormValues>;
  index: number;
  /** Department ids already selected in other cards (kept unselectable). */
  takenDepartmentIds: string[];
  onRemove: () => void;
}

/**
 * One department assignment: department, lead, weekly-input requirement,
 * and a repeatable list of systems under the department.
 */
export function DepartmentAssignmentCard({
  control,
  index,
  takenDepartmentIds,
  onRemove,
}: DepartmentAssignmentCardProps) {
  const systems = useFieldArray({
    control,
    name: `departments.${index}.systems`,
  });
  const { activeRecords: departments } = useMasterData("department");

  return (
    <Card size="sm" className="bg-muted/30">
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <RhfField
            control={control}
            name={`departments.${index}.departmentId`}
            label="Department"
            required
          >
            {({ field, controlProps }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  {...controlProps}
                  className="w-full"
                  onBlur={field.onBlur}
                >
                  <SelectValue placeholder="Select a department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((dept) => (
                    <SelectItem
                      key={dept.id}
                      value={dept.id}
                      disabled={
                        dept.id !== field.value &&
                        takenDepartmentIds.includes(dept.id)
                      }
                    >
                      {dept.name}
                      {dept.code ? ` (${dept.code})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </RhfField>

          <RhfField
            control={control}
            name={`departments.${index}.leadName`}
            label="Department lead"
            required
          >
            {({ field, controlProps }) => (
              <Input
                {...controlProps}
                placeholder="Lead name"
                value={field.value ?? ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                ref={field.ref}
              />
            )}
          </RhfField>
        </div>

        <RhfField
          control={control}
          name={`departments.${index}.reportingRequired`}
          label="Weekly report input required"
          description="This department must submit input for every weekly report."
        >
          {({ field, controlProps }) => (
            <Switch
              {...controlProps}
              checked={field.value}
              onCheckedChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
            />
          )}
        </RhfField>

        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-medium">
            Systems
            <span className="text-xs font-normal text-muted-foreground">
              Optional — added rows need a name and code
            </span>
          </p>
          {systems.fields.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No systems added for this department yet.
            </p>
          )}
          {systems.fields.map((systemField, systemIndex) => (
            <SystemAssignmentRow
              key={systemField.id}
              control={control}
              departmentIndex={index}
              systemIndex={systemIndex}
              onRemove={() => systems.remove(systemIndex)}
            />
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              systems.append({ id: nextSystemId(), name: "", code: "" })
            }
          >
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add System
          </Button>
        </div>

        <div className="flex justify-end border-t pt-3">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onRemove}
          >
            <Trash2 data-icon="inline-start" aria-hidden="true" />
            Remove Department
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

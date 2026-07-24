"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  useFieldArray,
  useWatch,
  type Control,
  type UseFormSetValue,
} from "react-hook-form";

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
import { Textarea } from "@/components/ui/textarea";
import { SectionCard, StatusBadge } from "@/components/shared";
import {
  ManagedPersonSelect,
  ManagedSelect,
  useMasterData,
} from "@/features/master-data";
import { RhfField } from "@/features/projects/components/form-field";
import { SUBMISSION_STATUS_META } from "@/lib/constants";
import type { Discipline, MasterRecordBase, SubmissionStatus } from "@/types";
import {
  emptyDepartmentUpdate,
  type WeeklyReportHeaderValues,
} from "../schemas/weekly-report-header";

interface DepartmentUpdatesSectionProps {
  control: Control<WeeklyReportHeaderValues>;
  setValue: UseFormSetValue<WeeklyReportHeaderValues>;
  disabled?: boolean;
}

/** One repeatable department update row. */
function DepartmentUpdateRow({
  control,
  setValue,
  index,
  onRemove,
}: {
  control: Control<WeeklyReportHeaderValues>;
  setValue: UseFormSetValue<WeeklyReportHeaderValues>;
  index: number;
  onRemove: () => void;
}) {
  const departmentId = useWatch({
    control,
    name: `departmentUpdates.${index}.departmentId`,
  });
  const { records: disciplineRecords } = useMasterData("discipline");
  const disciplines = disciplineRecords as Discipline[];

  // Auto-link: only disciplines belonging to the chosen department.
  const disciplineFilter = React.useCallback(
    (record: MasterRecordBase) =>
      !departmentId ||
      (record as Discipline).departmentId === departmentId,
    [departmentId]
  );
  const matchingCount = departmentId
    ? disciplines.filter(
        (discipline) =>
          discipline.active && discipline.departmentId === departmentId
      ).length
    : 0;

  return (
    <Card
      size="sm"
      className="bg-muted/30"
      role="group"
      aria-label={`Department update ${index + 1}`}
    >
      <CardContent className="space-y-4">
        <p className="text-sm font-semibold">Update {index + 1}</p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <RhfField
            control={control}
            name={`departmentUpdates.${index}.departmentId`}
            label="Department"
            required
          >
            {({ field, controlProps }) => (
              <ManagedSelect
                kind="department"
                value={field.value}
                onChange={(nextDepartmentId) => {
                  field.onChange(nextDepartmentId);
                  if (nextDepartmentId !== departmentId) {
                    setValue(
                      `departmentUpdates.${index}.disciplineId`,
                      "",
                      { shouldDirty: true, shouldValidate: true }
                    );
                  }
                }}
                onBlur={field.onBlur}
                placeholder="Select department…"
                controlProps={controlProps}
              />
            )}
          </RhfField>

          <RhfField
            control={control}
            name={`departmentUpdates.${index}.disciplineId`}
            label="Discipline"
            optional
            description={
              departmentId
                ? `${matchingCount} discipline${matchingCount === 1 ? "" : "s"} in this department`
                : "Select a department first"
            }
          >
            {({ field, controlProps }) => (
              <ManagedSelect
                kind="discipline"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                allowClear
                disabled={!departmentId}
                filter={disciplineFilter}
                enforceFilter
                emptyLabel="No disciplines for this department."
                placeholder="Select discipline…"
                controlProps={controlProps}
              />
            )}
          </RhfField>

          <RhfField
            control={control}
            name={`departmentUpdates.${index}.progressPercent`}
            label="Progress %"
            optional
          >
            {({ field, controlProps }) => (
              <Input
                {...controlProps}
                type="number"
                min={0}
                max={100}
                inputMode="numeric"
                value={
                  typeof field.value === "number" && Number.isFinite(field.value)
                    ? String(field.value)
                    : ""
                }
                onChange={(event) =>
                  field.onChange(
                    event.target.value === ""
                      ? Number.NaN
                      : event.target.valueAsNumber
                  )
                }
                onBlur={field.onBlur}
                name={field.name}
                ref={field.ref}
              />
            )}
          </RhfField>

          <RhfField
            control={control}
            name={`departmentUpdates.${index}.status`}
            label="Status"
            required
          >
            {({ field, controlProps }) => {
              const meta =
                SUBMISSION_STATUS_META[field.value as SubmissionStatus];
              return (
                <div className="space-y-1.5">
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      {...controlProps}
                      className="w-full"
                      onBlur={field.onBlur}
                    >
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        Object.keys(
                          SUBMISSION_STATUS_META
                        ) as SubmissionStatus[]
                      ).map((status) => (
                        <SelectItem key={status} value={status}>
                          {SUBMISSION_STATUS_META[status].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {meta && (
                    <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                  )}
                </div>
              );
            }}
          </RhfField>
        </div>

        <RhfField
          control={control}
          name={`departmentUpdates.${index}.summary`}
          label="Update Summary"
          optional
        >
          {({ field, controlProps }) => (
            <Textarea
              {...controlProps}
              rows={2}
              placeholder="What happened in this department this week?"
              value={field.value ?? ""}
              onChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
            />
          )}
        </RhfField>

        <div className="grid gap-4 sm:grid-cols-3">
          <RhfField
            control={control}
            name={`departmentUpdates.${index}.keyAchievement`}
            label="Key Achievement"
            optional
          >
            {({ field, controlProps }) => (
              <Textarea
                {...controlProps}
                rows={2}
                placeholder="Main win this week"
                value={field.value ?? ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                ref={field.ref}
              />
            )}
          </RhfField>

          <RhfField
            control={control}
            name={`departmentUpdates.${index}.delayConstraint`}
            label="Delay / Constraint"
            optional
          >
            {({ field, controlProps }) => (
              <Textarea
                {...controlProps}
                rows={2}
                placeholder="Blocker or delay, if any"
                value={field.value ?? ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                ref={field.ref}
              />
            )}
          </RhfField>

          <RhfField
            control={control}
            name={`departmentUpdates.${index}.nextWeekPlan`}
            label="Next Week Plan"
            optional
          >
            {({ field, controlProps }) => (
              <Textarea
                {...controlProps}
                rows={2}
                placeholder="Planned for next week"
                value={field.value ?? ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                ref={field.ref}
              />
            )}
          </RhfField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <RhfField
            control={control}
            name={`departmentUpdates.${index}.responsibleContactId`}
            label="Responsible Person"
            optional
          >
            {({ field, controlProps }) => (
              <ManagedPersonSelect
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                allowClear
                placeholder="Search or select person…"
                controlProps={controlProps}
              />
            )}
          </RhfField>

          <RhfField
            control={control}
            name={`departmentUpdates.${index}.targetDate`}
            label="Target Date"
            optional
          >
            {({ field, controlProps }) => (
              <Input
                {...controlProps}
                type="date"
                value={field.value ?? ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                ref={field.ref}
              />
            )}
          </RhfField>
        </div>

        <div className="flex justify-end border-t pt-3">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onRemove}
            aria-label={`Remove department update ${index + 1}`}
          >
            <Trash2 data-icon="inline-start" aria-hidden="true" />
            Remove Update
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Phase 6A.3 — repeatable per-department updates. Departments and
 * disciplines come from the managed master data, with disciplines
 * auto-linked to the selected department.
 */
export function DepartmentUpdatesSection({
  control,
  setValue,
  disabled = false,
}: DepartmentUpdatesSectionProps) {
  const updates = useFieldArray({ control, name: "departmentUpdates" });

  return (
    <SectionCard
      title="Department Updates"
      description="One row per contributing department. Disciplines are limited to the department you pick."
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => updates.append(emptyDepartmentUpdate())}
        >
          <Plus data-icon="inline-start" aria-hidden="true" />
          Add Update
        </Button>
      }
      contentClassName="space-y-4"
    >
      {updates.fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No department updates yet. Selecting a project pre-fills a row for
          each reporting department, or add them manually.
        </p>
      ) : (
        updates.fields.map((row, index) => (
          <DepartmentUpdateRow
            key={row.id}
            control={control}
            setValue={setValue}
            index={index}
            onRemove={() => updates.remove(index)}
          />
        ))
      )}
    </SectionCard>
  );
}

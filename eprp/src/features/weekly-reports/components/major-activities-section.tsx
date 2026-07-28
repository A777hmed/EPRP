"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
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
import { ACTIVITY_STATUS_META } from "@/lib/constants";
import type { ActivityStatus, Discipline, MasterRecordBase } from "@/types";
import {
  emptyWeeklyActivity,
  type WeeklyActivityValues,
  type WeeklyReportHeaderValues,
} from "../schemas/weekly-report-header";

/** One repeatable Major Activity row. */
function ActivityRow({
  control,
  setValue,
  index,
  position,
  total,
  onRemove,
  onMove,
}: {
  control: Control<WeeklyReportHeaderValues>;
  setValue: UseFormSetValue<WeeklyReportHeaderValues>;
  index: number;
  position: number;
  total: number;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const departmentId = useWatch({
    control,
    name: `activities.${index}.departmentId`,
  });
  const { records: disciplineRecords } = useMasterData("discipline");
  const disciplines = disciplineRecords as Discipline[];

  // Auto-link: only disciplines belonging to the chosen department.
  const disciplineFilter = React.useCallback(
    (record: MasterRecordBase) =>
      !departmentId || (record as Discipline).departmentId === departmentId,
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
      aria-label={`Activity ${position}`}
    >
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">Activity {position}</p>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Move activity ${position} up`}
              onClick={() => onMove(-1)}
              disabled={index === 0}
            >
              <ChevronUp aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Move activity ${position} down`}
              onClick={() => onMove(1)}
              disabled={index === total - 1}
            >
              <ChevronDown aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove activity ${position}`}
              onClick={onRemove}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        </div>

        <RhfField
          control={control}
          name={`activities.${index}.title`}
          label="Activity"
          required
        >
          {({ field, controlProps }) => (
            <Input
              {...controlProps}
              placeholder="e.g. P&ID finalization"
              value={(field.value as string) ?? ""}
              onChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
            />
          )}
        </RhfField>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <RhfField
            control={control}
            name={`activities.${index}.departmentId`}
            label="Department"
            optional
          >
            {({ field, controlProps }) => (
              <ManagedSelect
                kind="department"
                value={field.value as string}
                onChange={(nextDepartmentId) => {
                  field.onChange(nextDepartmentId);
                  // A discipline from the old department no longer applies.
                  if (nextDepartmentId !== departmentId) {
                    setValue(`activities.${index}.disciplineId`, "", {
                      shouldDirty: true,
                    });
                  }
                }}
                onBlur={field.onBlur}
                controlProps={controlProps}
              />
            )}
          </RhfField>

          <RhfField
            control={control}
            name={`activities.${index}.disciplineId`}
            label="Discipline"
            optional
            description={
              departmentId
                ? `${matchingCount} in this department`
                : "Choose a department first"
            }
          >
            {({ field, controlProps }) => (
              <ManagedSelect
                kind="discipline"
                value={field.value as string}
                onChange={field.onChange}
                onBlur={field.onBlur}
                controlProps={controlProps}
                filter={disciplineFilter}
              />
            )}
          </RhfField>

          <RhfField
            control={control}
            name={`activities.${index}.ownerContactId`}
            label="Owner"
            optional
          >
            {({ field, controlProps }) => (
              <ManagedPersonSelect
                value={field.value as string}
                onChange={field.onChange}
                onBlur={field.onBlur}
                controlProps={controlProps}
              />
            )}
          </RhfField>

          <RhfField
            control={control}
            name={`activities.${index}.status`}
            label="Status"
            required
          >
            {({ field, controlProps }) => (
              <div className="space-y-1.5">
                <Select
                  value={field.value as string}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger
                    {...controlProps}
                    className="w-full"
                    onBlur={field.onBlur}
                  >
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.keys(ACTIVITY_STATUS_META) as ActivityStatus[]
                    ).map((status) => (
                      <SelectItem key={status} value={status}>
                        {ACTIVITY_STATUS_META[status].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {ACTIVITY_STATUS_META[field.value as ActivityStatus] && (
                  <StatusBadge
                    tone={
                      ACTIVITY_STATUS_META[field.value as ActivityStatus].tone
                    }
                  >
                    {ACTIVITY_STATUS_META[field.value as ActivityStatus].label}
                  </StatusBadge>
                )}
              </div>
            )}
          </RhfField>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <RhfField
            control={control}
            name={`activities.${index}.progressPercent`}
            label="Progress %"
            optional
          >
            {({ field, controlProps }) => (
              <Input
                {...controlProps}
                type="number"
                min={0}
                max={100}
                step={1}
                inputMode="numeric"
                placeholder="0–100"
                value={
                  typeof field.value === "number" &&
                  Number.isFinite(field.value)
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

          <div className="sm:col-span-3">
            <RhfField
              control={control}
              name={`activities.${index}.remarks`}
              label="Remarks"
              optional
            >
              {({ field, controlProps }) => (
                <Textarea
                  {...controlProps}
                  rows={2}
                  placeholder="Anything worth noting about this activity."
                  value={(field.value as string) ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                />
              )}
            </RhfField>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export interface MajorActivitiesSectionProps {
  control: Control<WeeklyReportHeaderValues>;
  setValue: UseFormSetValue<WeeklyReportHeaderValues>;
  disabled: boolean;
}

/**
 * "Major Activities Completed" (spec §2 section 6). Repeatable rows in the
 * authoring order shown on the report — reordering rewrites `sortOrder` on
 * save, so the list is stored exactly as arranged here.
 */
export function MajorActivitiesSection({
  control,
  setValue,
  disabled,
}: MajorActivitiesSectionProps) {
  const activities = useFieldArray({ control, name: "activities" });

  return (
    <SectionCard
      title="Major Activities Completed"
      description="Significant activities delivered in this reporting week."
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            activities.append(emptyWeeklyActivity() as WeeklyActivityValues)
          }
          disabled={disabled}
        >
          <Plus data-icon="inline-start" aria-hidden="true" />
          Add Activity
        </Button>
      }
    >
      {disabled ? (
        <p className="text-sm text-muted-foreground">
          Select a project first.
        </p>
      ) : activities.fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No activities recorded yet. Use “Add Activity” to list what was
          completed this week.
        </p>
      ) : (
        <div className="space-y-3">
          {activities.fields.map((field, index) => (
            <ActivityRow
              key={field.id}
              control={control}
              setValue={setValue}
              index={index}
              position={index + 1}
              total={activities.fields.length}
              onRemove={() => activities.remove(index)}
              onMove={(direction) =>
                activities.swap(index, index + direction)
              }
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

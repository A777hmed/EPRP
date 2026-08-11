"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Controller,
  useFieldArray,
  useWatch,
  type Control,
} from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { SectionCard, StatusBadge } from "@/components/shared";
import { ManagedPersonSelect, ManagedSelect } from "@/features/master-data";
import { RhfField } from "@/features/projects/components/form-field";
import {
  COMMENT_CATEGORY_META,
  ENTRY_STATUS_META,
  PRIORITY_META,
  WEEKLY_ENTRY_TYPE_META,
} from "@/lib/constants";
import type { HierarchyTerms } from "@/config/project-terminology";
import type {
  CommentCategory,
  Discipline,
  EntryStatus,
  MasterRecordBase,
  Priority,
  System,
  WeeklyEntryType,
} from "@/types";
import {
  emptyWeeklyEntry,
  type WeeklyEntryValues,
  type WeeklyReportHeaderValues,
} from "../schemas/weekly-report-header";

/** Highest priority first when sorting; mirrors the escalation order. */
const PRIORITY_RANK: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

type EntrySort = "added" | "priority" | "dueDate";

const SORT_LABELS: Record<EntrySort, string> = {
  added: "Order added",
  priority: "Priority",
  dueDate: "Due date",
};

interface WeeklyEntriesSectionProps {
  control: Control<WeeklyReportHeaderValues>;
  /** The project's wording for the level below a System. */
  terms: HierarchyTerms;
  disabled?: boolean;
}

/** One repeatable comment / risk / issue / action row. */
function WeeklyEntryRow({
  control,
  index,
  position,
  entryType,
  terms,
  onRemove,
}: {
  control: Control<WeeklyReportHeaderValues>;
  /** Index into the flat `entries` field array — the form path. */
  index: number;
  /** 1-based position within its own section, for labels. */
  position: number;
  entryType: WeeklyEntryType;
  terms: HierarchyTerms;
  onRemove: () => void;
}) {
  const label = WEEKLY_ENTRY_TYPE_META[entryType].singular;
  const monthlyId = React.useId();
  const departmentId = useWatch({
    control,
    name: `entries.${index}.departmentId`,
  });

  // Systems and disciplines narrow to the department once one is chosen.
  const systemFilter = React.useCallback(
    (record: MasterRecordBase) =>
      !departmentId || (record as System).departmentId === departmentId,
    [departmentId]
  );
  const disciplineFilter = React.useCallback(
    (record: MasterRecordBase) =>
      !departmentId || (record as Discipline).departmentId === departmentId,
    [departmentId]
  );

  return (
    <Card
      size="sm"
      className="bg-muted/30"
      role="group"
      aria-label={`${label} ${position}`}
    >
      <CardContent className="space-y-4">
        <p className="text-sm font-semibold">
          {label} {position}
        </p>

        <RhfField
          control={control}
          name={`entries.${index}.description`}
          label="Description"
          required
        >
          {({ field, controlProps }) => (
            <Textarea
              {...controlProps}
              rows={2}
              placeholder={`Describe this ${label.toLowerCase()}`}
              value={field.value ?? ""}
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
            name={`entries.${index}.category`}
            label="Category"
            required
          >
            {({ field, controlProps }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  {...controlProps}
                  className="w-full"
                  onBlur={field.onBlur}
                >
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.keys(COMMENT_CATEGORY_META) as CommentCategory[]
                  ).map((category) => (
                    <SelectItem key={category} value={category}>
                      {COMMENT_CATEGORY_META[category].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </RhfField>

          <RhfField
            control={control}
            name={`entries.${index}.priority`}
            label="Priority"
            required
          >
            {({ field, controlProps }) => {
              const meta = PRIORITY_META[field.value as Priority];
              return (
                <div className="space-y-1.5">
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      {...controlProps}
                      className="w-full"
                      onBlur={field.onBlur}
                    >
                      <SelectValue placeholder="Select priority" />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(PRIORITY_META) as Priority[]).map(
                        (priority) => (
                          <SelectItem key={priority} value={priority}>
                            {PRIORITY_META[priority].label}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                  {meta && (
                    <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                  )}
                </div>
              );
            }}
          </RhfField>

          <RhfField
            control={control}
            name={`entries.${index}.status`}
            label="Status"
            required
          >
            {({ field, controlProps }) => {
              const meta = ENTRY_STATUS_META[field.value as EntryStatus];
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
                      {(Object.keys(ENTRY_STATUS_META) as EntryStatus[]).map(
                        (status) => (
                          <SelectItem key={status} value={status}>
                            {ENTRY_STATUS_META[status].label}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                  {meta && (
                    <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                  )}
                </div>
              );
            }}
          </RhfField>

          <RhfField
            control={control}
            name={`entries.${index}.dueDate`}
            label="Due Date"
            required={entryType === "action"}
            optional={entryType !== "action"}
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

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <RhfField
            control={control}
            name={`entries.${index}.ownerContactId`}
            label="Owner"
            required={entryType === "action"}
            optional={entryType !== "action"}
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
            name={`entries.${index}.departmentId`}
            label="Related Department"
            optional
          >
            {({ field, controlProps }) => (
              <ManagedSelect
                kind="department"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                allowClear
                placeholder="Select department…"
                controlProps={controlProps}
              />
            )}
          </RhfField>

          <RhfField
            control={control}
            name={`entries.${index}.systemId`}
            label="Related System"
            optional
          >
            {({ field, controlProps }) => (
              <ManagedSelect
                kind="system"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                allowClear
                filter={systemFilter}
                emptyLabel="No systems for this department."
                placeholder="Select system…"
                controlProps={controlProps}
              />
            )}
          </RhfField>

          <RhfField
            control={control}
            name={`entries.${index}.disciplineId`}
            label={`Related ${terms.singular}`}
            optional
          >
            {({ field, controlProps }) => (
              <ManagedSelect
                kind="discipline"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                allowClear
                filter={disciplineFilter}
                emptyLabel={`No ${terms.pluralLower} for this department.`}
                placeholder={`Select ${terms.singularLower}…`}
                searchPlaceholder={`Search ${terms.pluralLower}…`}
                clearLabel={`Clear ${terms.singularLower}`}
                controlProps={controlProps}
              />
            )}
          </RhfField>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <Controller
            control={control}
            name={`entries.${index}.includeInMonthly`}
            render={({ field }) => (
              <div className="flex items-center gap-2">
                <Checkbox
                  id={monthlyId}
                  checked={Boolean(field.value)}
                  onCheckedChange={(checked) =>
                    field.onChange(checked === true)
                  }
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                />
                <Label htmlFor={monthlyId} className="font-normal">
                  Include in Monthly report
                </Label>
              </div>
            )}
          />

          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onRemove}
            aria-label={`Remove ${label.toLowerCase()} ${position}`}
          >
            <Trash2 data-icon="inline-start" aria-hidden="true" />
            Remove
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * One of the four entry sections. Rows live in the shared `entries` field
 * array and are selected by `entryType`, so a single Zod schema and a single
 * save call cover all four.
 */
function EntryTypeSection({
  control,
  entryType,
  rows,
  terms,
  onAdd,
  onRemove,
  disabled,
}: {
  control: Control<WeeklyReportHeaderValues>;
  entryType: WeeklyEntryType;
  /** Field-array entries of this type, paired with their flat index. */
  rows: { key: string; index: number }[];
  terms: HierarchyTerms;
  onAdd: () => void;
  onRemove: (index: number) => void;
  disabled: boolean;
}) {
  const [sort, setSort] = React.useState<EntrySort>("added");
  const meta = WEEKLY_ENTRY_TYPE_META[entryType];
  const values = useWatch({ control, name: "entries" }) as
    | WeeklyEntryValues[]
    | undefined;

  // Sorting is presentational only — the underlying array order is untouched,
  // so removing a row still targets the right index.
  const ordered = React.useMemo(() => {
    if (sort === "added") return rows;
    const withValue = rows.map((row) => ({ row, value: values?.[row.index] }));
    withValue.sort((a, b) => {
      if (sort === "priority") {
        const rankA = PRIORITY_RANK[a.value?.priority ?? "medium"];
        const rankB = PRIORITY_RANK[b.value?.priority ?? "medium"];
        return rankA - rankB || a.row.index - b.row.index;
      }
      // Rows without a due date sort last rather than jumping to the top.
      const dateA = a.value?.dueDate || "";
      const dateB = b.value?.dueDate || "";
      if (!dateA && !dateB) return a.row.index - b.row.index;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateA.localeCompare(dateB) || a.row.index - b.row.index;
    });
    return withValue.map((item) => item.row);
  }, [rows, sort, values]);

  const sortId = `${entryType}-sort`;

  return (
    <SectionCard
      title={meta.plural}
      description={meta.description}
      action={
        <div className="flex flex-wrap items-center gap-2">
          {rows.length > 1 && (
            <>
              <Label htmlFor={sortId} className="text-xs text-muted-foreground">
                Sort by
              </Label>
              <Select
                value={sort}
                onValueChange={(next) => setSort(next as EntrySort)}
              >
                <SelectTrigger id={sortId} size="sm" className="w-[9.5rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SORT_LABELS) as EntrySort[]).map((option) => (
                    <SelectItem key={option} value={option}>
                      {SORT_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={onAdd}
          >
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add {meta.singular}
          </Button>
        </div>
      }
      contentClassName="space-y-4"
    >
      {ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No {meta.plural.toLowerCase()} recorded for this week.
        </p>
      ) : (
        ordered.map((row, position) => (
          <WeeklyEntryRow
            key={row.key}
            control={control}
            index={row.index}
            position={position + 1}
            entryType={entryType}
            terms={terms}
            onRemove={() => onRemove(row.index)}
          />
        ))
      )}
    </SectionCard>
  );
}

const ENTRY_TYPES: WeeklyEntryType[] = ["comment", "risk", "issue", "action"];

/**
 * Phase 6A.4 — key comments, risks, issues, and action items. All four share
 * one field set and one `entries` field array, discriminated by `entryType`.
 */
export function WeeklyEntriesSection({
  control,
  terms,
  disabled = false,
}: WeeklyEntriesSectionProps) {
  const entries = useFieldArray({ control, name: "entries" });

  const rowsByType = React.useMemo(() => {
    const grouped: Record<WeeklyEntryType, { key: string; index: number }[]> = {
      comment: [],
      risk: [],
      issue: [],
      action: [],
    };
    entries.fields.forEach((field, index) => {
      grouped[field.entryType]?.push({ key: field.id, index });
    });
    return grouped;
  }, [entries.fields]);

  return (
    <>
      {ENTRY_TYPES.map((entryType) => (
        <EntryTypeSection
          key={entryType}
          control={control}
          entryType={entryType}
          rows={rowsByType[entryType]}
          terms={terms}
          disabled={disabled}
          onAdd={() => entries.append(emptyWeeklyEntry(entryType))}
          onRemove={(index) => entries.remove(index)}
        />
      ))}
    </>
  );
}

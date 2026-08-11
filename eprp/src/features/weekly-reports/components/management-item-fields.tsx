"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import {
  COMMENT_CATEGORY_META,
  ENTRY_STATUS_META,
  MANAGEMENT_CATEGORIES,
  PRIORITY_META,
  WEEKLY_ENTRY_REQUIRED,
  WEEKLY_ENTRY_TYPE_META,
  WEEKLY_ENTRY_TYPES,
  isLegacyCategory,
} from "@/lib/constants";
import type { HierarchyTerms } from "@/config/project-terminology";
import type {
  CommentCategory,
  EntryStatus,
  Priority,
  Project,
  WeeklyEntryType,
} from "@/types";
import {
  eligibleOwners,
  projectScopeItemIds,
  projectSystems,
  reconcileScopeSelection,
} from "../project-scope";
import {
  showsField,
  type ManagementItemDraft,
} from "../management-item";
import type { WeeklyNameLookup } from "./weekly-department-section";
import { ScopedPersonSelect } from "./scoped-person-select";

/** The sentinel a Select uses for "none" — Radix rejects an empty value. */
const NONE = "__none__";

function OptionalSelect({
  value,
  onChange,
  options,
  placeholder,
  label,
  disabled,
  emptyMessage,
}: {
  value: string;
  onChange: (next: string) => void;
  options: { id: string; label: string }[];
  placeholder: string;
  label: string;
  disabled?: boolean;
  emptyMessage: string;
}) {
  if (options.length === 0) {
    return (
      <p className="self-center text-xs text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }
  return (
    <Select
      value={value === "" ? NONE : value}
      onValueChange={(next) => onChange(next === NONE ? "" : next)}
    >
      <SelectTrigger className="w-full" disabled={disabled} aria-label={label}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{placeholder}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface ManagementItemFieldsProps {
  row: ManagementItemDraft;
  onChange: (change: Partial<ManagementItemDraft>) => void;
  onRemove: () => void;
  /** Needed for cascading and for who may own the item. */
  project: Project | null;
  names: WeeklyNameLookup;
  terms: HierarchyTerms;
  disabled?: boolean;
  /**
   * Whether to offer Related Department / System / scope item.
   *
   * False when the row is added from inside a scope item, which already
   * fixes all three — re-asking there is the re-entry this pass removes.
   */
  showScopeSelectors?: boolean;
}

/**
 * One Project Management Item's fields.
 *
 * Shared by both places an item can be created — the consolidated project
 * section and a scope item's own list — so the two cannot drift into
 * different forms over the same table.
 *
 * Two ideas are kept apart on purpose. TYPE says what the item IS (Risk,
 * Action, Decision…); CATEGORY says what business area it is ABOUT
 * (Technical, HSE, Financial…). They used to overlap: `category` offered
 * "Risk" and "Issue", so a Risk was filed under Risk, and "Escalation" stood
 * in for "management must decide" — which is a kind of item, not a subject.
 *
 * Which fields appear, and which are required, follows the type. A Key
 * Comment shows no priority or status because it has neither; an Action
 * requires an owner and a date because without them it is not an action.
 */
export function ManagementItemFields({
  row,
  onChange,
  onRemove,
  project,
  names,
  terms,
  disabled = false,
  showScopeSelectors = true,
}: ManagementItemFieldsProps) {
  const rules = WEEKLY_ENTRY_REQUIRED[row.entryType];
  const fieldId = React.useId();

  const systems = React.useMemo(
    () => projectSystems(project, row.departmentId || undefined),
    [project, row.departmentId]
  );
  const scopeItemIds = React.useMemo(
    () =>
      projectScopeItemIds(
        project,
        row.departmentId || undefined,
        row.systemId || undefined
      ),
    [project, row.departmentId, row.systemId]
  );
  const owners = React.useMemo(
    () =>
      eligibleOwners(project, {
        departmentId: row.departmentId || undefined,
        systemId: row.systemId || undefined,
        disciplineId: row.disciplineId || undefined,
      }),
    [project, row.departmentId, row.systemId, row.disciplineId]
  );

  const departmentOptions = (project?.departments ?? [])
    .map((assignment) => ({
      id: assignment.departmentId,
      label: names.department(assignment.departmentId)?.name ?? "Department",
    }))
    .filter((option) => Boolean(option.id));

  /**
   * Apply a change and re-validate the whole triple against the project.
   *
   * Choosing a different department must not leave last department's System
   * and scope item behind — `reconcileScopeSelection` clears whatever the new
   * parent does not support, so an impossible combination never reaches the
   * value that gets saved rather than merely looking wrong on screen. The
   * owner is re-checked too: a person valid for the old scope may hold no
   * assignment in the new one.
   */
  const applyScope = (change: Partial<ManagementItemDraft>) => {
    const next = { ...row, ...change };
    const scope = reconcileScopeSelection(project, next);
    const stillEligible = eligibleOwners(project, {
      departmentId: scope.departmentId || undefined,
      systemId: scope.systemId || undefined,
      disciplineId: scope.disciplineId || undefined,
    }).some((entry) => entry.contactId === next.ownerContactId);

    onChange({
      ...change,
      ...scope,
      ownerContactId: stillEligible ? next.ownerContactId : "",
    });
  };

  return (
    <div className="space-y-2 rounded-md border bg-background p-2.5">
      <div className="grid gap-2 sm:grid-cols-[12rem_1fr]">
        <Select
          value={row.entryType}
          onValueChange={(value) =>
            onChange({ entryType: value as WeeklyEntryType })
          }
        >
          <SelectTrigger className="w-full" disabled={disabled} aria-label="Type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WEEKLY_ENTRY_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {WEEKLY_ENTRY_TYPE_META[type].singular}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Textarea
          id={`${fieldId}-description`}
          rows={2}
          disabled={disabled}
          aria-label="Description"
          placeholder={WEEKLY_ENTRY_TYPE_META[row.entryType].description}
          value={row.description}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {showsField(row.entryType, "category") && (
          <Select
            value={row.category}
            onValueChange={(value) =>
              onChange({ category: value as CommentCategory })
            }
          >
            <SelectTrigger
              className="w-full"
              disabled={disabled}
              aria-label="Category"
            >
              <SelectValue placeholder="Category…" />
            </SelectTrigger>
            <SelectContent>
              {MANAGEMENT_CATEGORIES.map((category) => (
                <SelectItem key={category} value={category}>
                  {COMMENT_CATEGORY_META[category].label}
                </SelectItem>
              ))}
              {/* A historical value stays selectable on the row that holds
                  it, so opening an old item does not silently re-file it. */}
              {isLegacyCategory(row.category) && (
                <SelectItem value={row.category}>
                  {COMMENT_CATEGORY_META[row.category].label}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        )}

        {showsField(row.entryType, "priority") && (
          <Select
            value={row.priority}
            onValueChange={(value) => onChange({ priority: value as Priority })}
          >
            <SelectTrigger
              className="w-full"
              disabled={disabled}
              aria-label="Priority"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PRIORITY_META) as Priority[]).map((priority) => (
                <SelectItem key={priority} value={priority}>
                  {PRIORITY_META[priority].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {showsField(row.entryType, "status") && (
          <Select
            value={row.status}
            onValueChange={(value) => onChange({ status: value as EntryStatus })}
          >
            <SelectTrigger
              className="w-full"
              disabled={disabled}
              aria-label="Status"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ENTRY_STATUS_META) as EntryStatus[]).map((status) => (
                <SelectItem key={status} value={status}>
                  {ENTRY_STATUS_META[status].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <ScopedPersonSelect
          value={row.ownerContactId}
          onChange={(id) => onChange({ ownerContactId: id })}
          responsible={owners}
          department={[]}
          names={names}
          disabled={disabled}
          label={rules.owner ? "Owner (required)" : "Owner"}
        />

        <Input
          type="date"
          disabled={disabled}
          aria-label={rules.dueDate ? "Due date (required)" : "Due date"}
          value={row.dueDate}
          onChange={(event) => onChange({ dueDate: event.target.value })}
        />
      </div>

      {showScopeSelectors && (
        <div className="grid gap-2 sm:grid-cols-3">
          <OptionalSelect
            label="Related Department"
            placeholder="Whole project"
            value={row.departmentId}
            disabled={disabled}
            options={departmentOptions}
            emptyMessage="This project has no departments assigned."
            onChange={(id) => applyScope({ departmentId: id })}
          />
          <OptionalSelect
            label="Related System"
            placeholder={row.departmentId ? "Any system" : "Choose a department"}
            value={row.systemId}
            disabled={disabled || !row.departmentId}
            options={systems.map((system) => ({
              id: system.systemId,
              label: system.name,
            }))}
            emptyMessage={
              row.departmentId
                ? "No systems assigned to this department."
                : "Choose a department first."
            }
            onChange={(id) => applyScope({ systemId: id })}
          />
          <OptionalSelect
            label={`Related ${terms.singular}`}
            placeholder={
              row.departmentId ? `Any ${terms.singularLower}` : "Choose a department"
            }
            value={row.disciplineId}
            disabled={disabled || !row.departmentId}
            options={scopeItemIds.map((id) => ({
              id,
              label: names.scopeItem(id)?.name ?? "Unnamed",
            }))}
            emptyMessage={
              row.departmentId
                ? `No ${terms.pluralLower} in this selection.`
                : "Choose a department first."
            }
            onChange={(id) => applyScope({ disciplineId: id })}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="flex items-center gap-2 text-xs font-normal">
          <Checkbox
            checked={row.includeInMonthly}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange({ includeInMonthly: checked === true })
            }
          />
          Include in Monthly Report
        </Label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 data-icon="inline-start" aria-hidden="true" />
          Remove
        </Button>
      </div>
    </div>
  );
}

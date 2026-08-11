"use client";

import * as React from "react";
import { Pencil, Save, Star, Trash2 } from "lucide-react";

import { StatusBadge } from "@/components/shared";
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
import { ENTRY_STATUS_META } from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/formatters";
import type { EntryStatus, WeeklyUpdateType } from "@/types";
import type { ScopeItemResponsibility } from "../workspace";
import {
  WEEKLY_COMMENT_TYPES,
  WEEKLY_UPDATE_TYPE_META,
  weeklyUpdateErrors,
  type WeeklyUpdateDraft,
} from "../weekly-update";
import { ScopedPersonSelect } from "./scoped-person-select";
import type { WeeklyNameLookup } from "./weekly-department-section";

export interface WeeklyUpdateFieldsProps {
  row: WeeklyUpdateDraft;
  number: number;
  responsible: ScopeItemResponsibility[];
  departmentPeople: ScopeItemResponsibility[];
  names: WeeklyNameLookup;
  canEdit: boolean;
  saving?: boolean;
  onChange: (change: Partial<WeeklyUpdateDraft>) => void;
  onMonthlyChange: (checked: boolean) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
  onSave: () => Promise<boolean>;
}

/** One independent, persisted Weekly comment over the canonical entry row. */
export function WeeklyUpdateFields({
  row,
  number,
  responsible,
  departmentPeople,
  names,
  canEdit,
  saving = false,
  onChange,
  onMonthlyChange,
  onRemove,
  onSave,
}: WeeklyUpdateFieldsProps) {
  const source = row.source;
  const [editing, setEditing] = React.useState(!source);
  const fieldId = React.useId();
  const author = names.person(source?.createdByContactId)?.name;
  const editor = names.person(source?.updatedByContactId)?.name;
  const owner = names.person(row.ownerContactId)?.name;
  const edited = Boolean(source && source.updatedAt !== source.createdAt);
  const differentEditor = Boolean(
    source?.updatedByContactId &&
      source.updatedByContactId !== source.createdByContactId
  );
  const problems = weeklyUpdateErrors(row);

  const audit = source ? (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span>Added by: {author ?? "Not recorded (legacy)"}</span>
      <span>Created: {formatDateTime(source.createdAt)}</span>
      {differentEditor && <span>Last edited by: {editor ?? "Unknown"}</span>}
      {edited && <span>Last edited: {formatDateTime(source.updatedAt)}</span>}
    </div>
  ) : (
    <p className="text-xs text-muted-foreground">
      Original authorship and timestamps are recorded when this comment is
      saved.
    </p>
  );

  if (source && !editing) {
    return (
      <article className="rounded-lg border bg-background p-3">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold text-primary">
                Comment {number}
              </p>
              <StatusBadge tone={ENTRY_STATUS_META[row.status].tone}>
                {WEEKLY_UPDATE_TYPE_META[row.updateType].label}
              </StatusBadge>
              {row.includeInMonthly && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
                  <Star className="size-3 fill-current" aria-hidden="true" />
                  Monthly
                </span>
              )}
            </div>
            <p className="mt-2 text-sm whitespace-pre-wrap text-pretty">
              {row.description}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {owner && <span>Responsible: {owner}</span>}
              <span>Status: {ENTRY_STATUS_META[row.status].label}</span>
              {row.dueDate && <span>Due: {formatDate(row.dueDate)}</span>}
            </div>
          </div>
          {canEdit && (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => setEditing(true)}
              >
                <Pencil data-icon="inline-start" aria-hidden="true" />
                Edit
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => void onRemove()}
              >
                <Trash2 data-icon="inline-start" aria-hidden="true" />
                Remove
              </Button>
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-2">
          {audit}
          {canEdit && (
            <Label className="flex items-center gap-2 text-xs font-normal">
              <Checkbox
                checked={row.includeInMonthly}
                disabled={saving}
                onCheckedChange={(checked) =>
                  void onMonthlyChange(checked === true)
                }
              />
              Include in Monthly Report
            </Label>
          )}
        </div>
      </article>
    );
  }

  return (
    <article className="space-y-3 rounded-lg border border-primary/25 bg-background p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-primary">
          Comment {number}{source ? "" : " · New"}
        </p>
        {row.includeInMonthly && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
            <Star className="size-3 fill-current" aria-hidden="true" />
            Monthly
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-type`}>Update Type</Label>
          <Select
            value={row.updateType}
            onValueChange={(value) =>
              onChange({ updateType: value as WeeklyUpdateType })
            }
          >
            <SelectTrigger
              id={`${fieldId}-type`}
              disabled={saving || !canEdit}
              aria-label="Update Type"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEKLY_COMMENT_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {WEEKLY_UPDATE_TYPE_META[type].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-status`}>Status</Label>
          <Select
            value={row.status}
            onValueChange={(value) =>
              onChange({ status: value as EntryStatus })
            }
          >
            <SelectTrigger
              id={`${fieldId}-status`}
              disabled={saving || !canEdit}
              aria-label="Comment status"
            >
              <SelectValue />
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
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-comment`}>
          Comment / Update text <span className="text-destructive">*</span>
        </Label>
        <Textarea
          id={`${fieldId}-comment`}
          rows={3}
          disabled={saving || !canEdit}
          aria-label="Comment / Update text"
          placeholder="Record this week’s progress, achievement, constraint, or general update."
          value={row.description}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Responsible Person</Label>
          <ScopedPersonSelect
            value={row.ownerContactId}
            onChange={(id) => onChange({ ownerContactId: id })}
            responsible={responsible}
            department={departmentPeople}
            names={names}
            disabled={saving || !canEdit}
            label="Responsible person"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-due`}>Due Date</Label>
          <Input
            id={`${fieldId}-due`}
            type="date"
            disabled={saving || !canEdit}
            aria-label="Due Date"
            value={row.dueDate}
            onChange={(event) => onChange({ dueDate: event.target.value })}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-2">
        <Label className="flex items-center gap-2 text-xs font-normal">
          <Checkbox
            checked={row.includeInMonthly}
            disabled={saving || !canEdit}
            onCheckedChange={(checked) =>
              void onMonthlyChange(checked === true)
            }
          />
          Include in Monthly Report
        </Label>
        <div className="flex items-center gap-2">
          {source && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            disabled={saving || !canEdit || problems.length > 0}
            onClick={async () => {
              if (await onSave()) setEditing(false);
            }}
          >
            <Save data-icon="inline-start" aria-hidden="true" />
            {saving ? "Saving…" : "Save Comment"}
          </Button>
        </div>
      </div>

      {problems.length > 0 && (
        <p className="text-xs text-destructive">{problems[0]}</p>
      )}
      {audit}
    </article>
  );
}

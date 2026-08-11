"use client";

import { AlertOctagon, Gavel } from "lucide-react";

import { SectionCard, StatusBadge } from "@/components/shared";
import {
  ENTRY_STATUS_META,
  PRIORITY_META,
  WEEKLY_ENTRY_TYPE_META,
} from "@/lib/constants";
import { formatDate } from "@/lib/formatters";
import type { WeeklyEntry } from "@/types";
import type { WeeklyNameLookup } from "./weekly-department-section";

/**
 * Project-level narrative lists.
 *
 * Both read the report's existing `weekly_entries` rows — no new table, no new
 * form, no second action subsystem. `buildWeeklyWorkspace` does the splitting;
 * this only renders it. The split cannot repeat a scope item's Required Action
 * / Support rows, which are `action` + `general` and match neither list.
 *
 * Compact by construction: a project-level list is a handful of items that
 * matter to the project, and giving each one a card would bury that.
 */
function EntryRow({
  entry,
  names,
}: {
  entry: WeeklyEntry;
  names: WeeklyNameLookup;
}) {
  const department = names.department(entry.departmentId)?.name;
  const scopeItem = names.scopeItem(entry.disciplineId)?.name;
  const owner = names.person(entry.ownerContactId)?.name;

  const context = [department, scopeItem].filter(Boolean).join(" · ");
  const meta = [
    owner,
    entry.dueDate ? `due ${formatDate(entry.dueDate)}` : null,
    entry.includeInMonthly ? "In Monthly" : null,
  ].filter(Boolean);

  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-dashed py-2 last:border-0 last:pb-0">
      <StatusBadge tone={PRIORITY_META[entry.priority].tone}>
        {PRIORITY_META[entry.priority].label}
      </StatusBadge>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm text-pretty">{entry.description}</p>
        <p className="text-xs text-muted-foreground">
          {WEEKLY_ENTRY_TYPE_META[entry.entryType].singular}
          {context && ` · ${context}`}
          {meta.length > 0 && ` · ${meta.join(" · ")}`}
        </p>
      </div>
      <StatusBadge tone={ENTRY_STATUS_META[entry.status].tone}>
        {ENTRY_STATUS_META[entry.status].label}
      </StatusBadge>
    </li>
  );
}

export interface WeeklyProjectEntriesProps {
  title: string;
  description: string;
  entries: WeeklyEntry[];
  names: WeeklyNameLookup;
  /** One line, shown instead of an empty list. Kept deliberately short. */
  emptyMessage: string;
  variant: "critical" | "decision";
}

export function WeeklyProjectEntries({
  title,
  description,
  entries,
  names,
  emptyMessage,
  variant,
}: WeeklyProjectEntriesProps) {
  const Icon = variant === "critical" ? AlertOctagon : Gavel;

  return (
    <SectionCard
      title={title}
      description={description}
      action={
        entries.length > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {entries.length} open
          </span>
        ) : undefined
      }
    >
      {entries.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          {emptyMessage}
        </p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} names={names} />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

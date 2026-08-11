"use client";

import * as React from "react";
import { ClipboardList, Loader2, Plus, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SectionCard, StatusBadge } from "@/components/shared";
import {
  COMMENT_CATEGORY_META,
  ENTRY_STATUS_META,
  PRIORITY_META,
  WEEKLY_ENTRY_TYPE_META,
} from "@/lib/constants";
import { formatDate } from "@/lib/formatters";
import { weeklyReportService } from "@/services/weekly-report-service";
import type { HierarchyTerms } from "@/config/project-terminology";
import type { Project, WeeklyEntry } from "@/types";
import {
  managementItemErrors,
  newManagementItemDraft,
  toEntryInput,
  toManagementItemDraft,
  type ManagementItemDraft,
} from "../management-item";
import { ManagementItemFields } from "./management-item-fields";
import type { WeeklyNameLookup } from "./weekly-department-section";

/** One item, for a viewer who may not change it. */
function ReadOnlyItem({
  entry,
  names,
}: {
  entry: WeeklyEntry;
  names: WeeklyNameLookup;
}) {
  const type = WEEKLY_ENTRY_TYPE_META[entry.entryType];
  const context = [
    names.department(entry.departmentId)?.name,
    names.system(entry.systemId)?.name,
    names.scopeItem(entry.disciplineId)?.name,
  ]
    .filter(Boolean)
    .join(" · ");
  const meta = [
    COMMENT_CATEGORY_META[entry.category]?.label,
    names.person(entry.ownerContactId)?.name,
    entry.dueDate ? `due ${formatDate(entry.dueDate)}` : null,
    entry.includeInMonthly ? "In Monthly" : null,
  ].filter(Boolean);

  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-dashed py-2 last:border-0 last:pb-0">
      <StatusBadge tone={type.tone}>{type.singular}</StatusBadge>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm text-pretty">{entry.description}</p>
        <p className="text-xs text-muted-foreground">
          {[context, ...meta].filter(Boolean).join(" · ")}
        </p>
      </div>
      <StatusBadge tone={PRIORITY_META[entry.priority].tone}>
        {PRIORITY_META[entry.priority].label}
      </StatusBadge>
      <StatusBadge tone={ENTRY_STATUS_META[entry.status].tone}>
        {ENTRY_STATUS_META[entry.status].label}
      </StatusBadge>
    </li>
  );
}

export interface WeeklyManagementItemsProps {
  reportId: string;
  project: Project | null;
  /** Project- and department-level items. Scope-item ones live on their item. */
  entries: WeeklyEntry[];
  /** How many more are recorded against individual scope items. */
  scopeItemCount: number;
  names: WeeklyNameLookup;
  terms: HierarchyTerms;
  canEdit: boolean;
  onEntrySaved: (entry: WeeklyEntry) => void;
  onEntryDeleted: (entryId: string) => void;
}

/**
 * Project Management Items — one list, five kinds.
 *
 * This replaces four separate editors (Key Comments, Risks, Issues, Action
 * Items) plus the ad-hoc "escalation" convention that stood for a management
 * decision. They were four forms over one table, so adding a risk and adding
 * an action were different journeys for no reason, and the report's own
 * Critical Issues and Required Decisions sections had no single place to read
 * from. Now: **+ Add Item**, then say what it is.
 *
 * The rollups on the report and the preview are derived from exactly these
 * rows — nothing is entered twice, and no rollup has an editor of its own.
 *
 * Items tagged to a scope item are edited on that scope item and are only
 * counted here, so the same row is never shown in two places.
 */
export function WeeklyManagementItems({
  reportId,
  project,
  entries,
  scopeItemCount,
  names,
  terms,
  canEdit,
  onEntrySaved,
  onEntryDeleted,
}: WeeklyManagementItemsProps) {
  const [rows, setRows] = React.useState<ManagementItemDraft[]>(() =>
    entries.map(toManagementItemDraft)
  );
  const [pristine, setPristine] = React.useState(() =>
    JSON.stringify(entries.map(toManagementItemDraft))
  );
  const [removed, setRemoved] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const nextKey = React.useRef(0);

  const dirty = JSON.stringify(rows) !== pristine || removed.length > 0;
  const problems = rows.flatMap(managementItemErrors);
  const markedForMonthly = rows.filter((row) => row.includeInMonthly).length;

  const patch = (key: string, change: Partial<ManagementItemDraft>) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...change } : row))
    );

  const add = () => {
    nextKey.current += 1;
    setRows((current) => [
      ...current,
      newManagementItemDraft(`new-${nextKey.current}`),
    ]);
  };

  const remove = (key: string) => {
    const row = rows.find((candidate) => candidate.key === key);
    // Only a persisted row needs deleting; one added and dropped in the same
    // sitting never reached the database.
    if (row?.id) setRemoved((current) => [...current, row.id!]);
    setRows((current) => current.filter((candidate) => candidate.key !== key));
  };

  const save = async () => {
    if (problems.length > 0 || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      for (const entryId of removed) {
        await weeklyReportService.deleteEntry(reportId, entryId);
        onEntryDeleted(entryId);
        setRemoved((current) => current.filter((id) => id !== entryId));
      }

      const saved: ManagementItemDraft[] = [];
      for (const row of rows) {
        const entry = await weeklyReportService.saveEntry(
          reportId,
          toEntryInput(row)
        );
        onEntrySaved(entry);
        const next = { ...toManagementItemDraft(entry), key: row.key };
        saved.push(next);
        // Fold the id back as each row lands, so a retry after a later
        // failure updates what already saved instead of inserting a twin.
        setRows((current) =>
          current.map((candidate) =>
            candidate.key === row.key ? next : candidate
          )
        );
      }
      setPristine(JSON.stringify(saved));
      toast.success("Project management items saved");
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Could not save these items.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const counter = [
    rows.length > 0 && `${rows.length} at project level`,
    scopeItemCount > 0 && `${scopeItemCount} on scope items`,
    markedForMonthly > 0 && `${markedForMonthly} for Monthly`,
  ].filter(Boolean) as string[];

  return (
    <SectionCard
      title="Project Management Items"
      description="Comments, risks, issues, actions and decisions tracked for this week."
      action={
        <div className="flex flex-wrap items-center gap-3">
          {counter.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {counter.join(" · ")}
            </span>
          )}
          {canEdit && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={add}
            >
              <Plus data-icon="inline-start" aria-hidden="true" />
              Add Item
            </Button>
          )}
        </div>
      }
      contentClassName="space-y-2"
    >
      {!canEdit ? (
        entries.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ClipboardList className="size-4 shrink-0" aria-hidden="true" />
            Nothing raised at project level this week.
          </p>
        ) : (
          <ul>
            {entries.map((entry) => (
              <ReadOnlyItem key={entry.id} entry={entry} names={names} />
            ))}
          </ul>
        )
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <ClipboardList className="size-4 shrink-0" aria-hidden="true" />
              Nothing raised at project level this week. Use “Add Item” for a
              comment, risk, issue, action or decision that spans the project.
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map((row) => (
                <ManagementItemFields
                  key={row.key}
                  row={row}
                  project={project}
                  names={names}
                  terms={terms}
                  disabled={saving}
                  onChange={(change) => patch(row.key, change)}
                  onRemove={() => remove(row.key)}
                />
              ))}
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-3">
            {problems.length > 0 && (
              <span className="text-xs text-destructive">{problems[0]}</span>
            )}
            {dirty && !saving && (
              <span className="text-xs text-muted-foreground">
                Unsaved changes
              </span>
            )}
            <Button
              type="button"
              size="sm"
              onClick={save}
              disabled={saving || !dirty || problems.length > 0}
            >
              {saving ? (
                <Loader2
                  data-icon="inline-start"
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Save data-icon="inline-start" aria-hidden="true" />
              )}
              {saving ? "Saving…" : "Save items"}
            </Button>
          </div>
        </>
      )}
    </SectionCard>
  );
}

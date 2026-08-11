"use client";

import { EyeOff } from "lucide-react";

import { SectionCard } from "@/components/shared";
import type { WeeklyEntry, WeeklySubmission } from "@/types";
import type { WeeklyWorkspace } from "../workspace";
import {
  WeeklyDepartmentSection,
  useWeeklyNameLookup,
} from "./weekly-department-section";

export interface WeeklyDepartmentsPanelProps {
  reportId: string;
  workspace: WeeklyWorkspace;
  /** The reason it may be false is stated once, at page level. */
  canEdit: boolean;
  viewerContactId?: string;
  onSaved: (submission: WeeklySubmission) => void;
  onEntrySaved: (entry: WeeklyEntry) => void;
  onEntryDeleted: (entryId: string) => void;
}

/**
 * Project → Departments.
 *
 * One Weekly report, and under it every department the project assigned that
 * this viewer may see. The list comes from `buildWeeklyWorkspace`, which reads
 * the project's own assignment list — so a department that owes input but has
 * not started still appears, which is the case Project Control most needs, and
 * a department belonging to a different project can never appear at all.
 */
export function WeeklyDepartmentsPanel({
  reportId,
  workspace,
  canEdit,
  viewerContactId,
  onSaved,
  onEntrySaved,
  onEntryDeleted,
}: WeeklyDepartmentsPanelProps) {
  const names = useWeeklyNameLookup();
  const total = workspace.departments.length;
  const complete = workspace.departments.filter(
    (d) => d.state === "complete"
  ).length;
  const awaiting = workspace.awaitingInput.length;
  const outstanding = workspace.departments.reduce(
    (count, section) => count + section.scopeItemsOutstanding,
    0
  );

  return (
    <SectionCard
      title="Departments"
      description="Department input for this reporting week."
      action={
        total > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {complete}/{total} complete
            {awaiting > 0 && ` · ${awaiting} awaiting input`}
            {outstanding > 0 && ` · ${outstanding} items outstanding`}
          </span>
        ) : undefined
      }
      contentClassName="space-y-2"
    >
      {total === 0 ? (
        <p className="text-sm text-muted-foreground">
          {workspace.hiddenDepartmentCount > 0
            ? "You have no department assignments on this project, so there is nothing here for you to see."
            : "This project has no departments assigned yet. Add them in Project Setup before collecting Weekly input."}
        </p>
      ) : (
        workspace.departments.map((section) => (
          <WeeklyDepartmentSection
            key={section.departmentId}
            reportId={reportId}
            section={section}
            scopeItemLabel={workspace.scopeItemLabel}
            scopeItemLabelPlural={workspace.scopeItemLabelPlural}
            names={names}
            canEdit={canEdit}
            viewerContactId={viewerContactId}
            // Opened by default when the viewer covers exactly one department:
            // they came here to fill it in, not to look at a closed row.
            defaultOpen={total === 1}
            onSaved={onSaved}
            onEntrySaved={onEntrySaved}
            onEntryDeleted={onEntryDeleted}
          />
        ))
      )}

      {workspace.hiddenDepartmentCount > 0 && total > 0 && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <EyeOff className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {workspace.hiddenDepartmentCount} further department
          {workspace.hiddenDepartmentCount === 1 ? " is" : "s are"} assigned to
          this project outside your access.
        </p>
      )}
    </SectionCard>
  );
}

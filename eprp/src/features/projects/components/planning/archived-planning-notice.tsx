import { Archive } from "lucide-react";

import { PLANNING_CONTROL_ARCHIVED_MESSAGE } from "../../planning-control-archived";

/**
 * 13.9: shown on the Planning & Control workspace, the Milestones register and
 * the Deliverables register of an archived project. Everything stays visible;
 * nothing can be added, edited, imported, published or decided (the database
 * refuses it too, with the same sentence). Same presentation as the 2C.3E
 * `ArchivedSetupNotice`.
 */
export function ArchivedPlanningNotice() {
  return (
    <div
      role="status"
      data-archived-planning="notice"
      className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3"
    >
      <Archive className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-medium">Archived · read-only</p>
        <p className="text-xs text-muted-foreground text-pretty">
          {PLANNING_CONTROL_ARCHIVED_MESSAGE} Its plan, imports, snapshots,
          milestones and deliverables stay visible as history, but nothing can
          be added, edited, imported, published or decided.
        </p>
      </div>
    </div>
  );
}

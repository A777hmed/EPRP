import { Archive } from "lucide-react";

import { PROJECT_SETUP_ARCHIVED_MESSAGE } from "../../setup-save";

/**
 * 2C.3E: shown on every Project Setup step of an archived project. The data
 * stays visible; nothing can be saved, added, removed, replaced or ended
 * (the database refuses it too, with the same sentence).
 */
export function ArchivedSetupNotice() {
  return (
    <div
      role="status"
      data-archived-setup="notice"
      className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3"
    >
      <Archive className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-medium">Archived · read-only</p>
        <p className="text-xs text-muted-foreground text-pretty">
          {PROJECT_SETUP_ARCHIVED_MESSAGE} Its setup, team and history stay
          visible, but nothing can be saved, added, removed, replaced or ended.
        </p>
      </div>
    </div>
  );
}

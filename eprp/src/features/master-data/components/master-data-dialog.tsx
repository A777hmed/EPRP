"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { SearchInput, StatusBadge } from "@/components/shared";
import type { MasterRecordBase } from "@/types";
import { MASTER_KIND_CONFIG } from "../services";
import type { MasterKind } from "../types";
import { useMasterData } from "../use-master-data";
import { MasterDataForm } from "./master-data-form";
import { MasterDataTable } from "./master-data-table";
import { useMasterDataActions } from "./use-master-data-actions";

/** Neutral pill marking archived records. */
export function ArchiveBadge() {
  return <StatusBadge tone="neutral">Archived</StatusBadge>;
}

export interface MasterDataDialogProps {
  kind: MasterKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open directly in create mode (used by "+ Add new" in selects). */
  initialMode?: "list" | "create";
  /** Prefill for create mode, e.g. the current search text. */
  initialName?: string;
  /** Called after a create so the select can auto-pick the new record. */
  onCreated?: (record: MasterRecordBase) => void;
  /** Called after any successful mutation (dirty tracking, refreshes). */
  onMutated?: () => void;
}

type ViewState =
  | { view: "list" }
  | { view: "create" }
  | { view: "edit"; record: MasterRecordBase };

/**
 * Reusable management surface (in a dialog) for a master-data kind: search,
 * archived toggle, the shared table, the shared form (create/edit), and
 * archive / restore / safe-delete. Used by every ManagedSelect's Manage and
 * inline Add-new actions.
 */
export function MasterDataDialog({
  kind,
  open,
  onOpenChange,
  initialMode = "list",
  initialName,
  onCreated,
  onMutated,
}: MasterDataDialogProps) {
  const config = MASTER_KIND_CONFIG[kind];
  const { records } = useMasterData(kind);
  const actions = useMasterDataActions(kind, { onMutated });

  const [state, setState] = React.useState<ViewState>({ view: "list" });
  const [query, setQuery] = React.useState("");
  const [showArchived, setShowArchived] = React.useState(false);

  // Reset to the requested mode each time the dialog opens
  // (state-adjustment-during-render pattern from the React docs).
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setState(initialMode === "create" ? { view: "create" } : { view: "list" });
      setQuery("");
    }
  }

  const visible = records.filter((r) => {
    if (!showArchived && !r.active) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      r.name.toLowerCase().includes(q) ||
      (r.code ?? "").toLowerCase().includes(q)
    );
  });

  const handleSaved = (record: MasterRecordBase, mode: "create" | "edit") => {
    toast.success(
      mode === "create"
        ? `${config.singular} “${record.name}” added`
        : `${config.singular} updated`
    );
    onMutated?.();
    if (mode === "create") {
      onCreated?.(record);
      if (initialMode === "create") {
        // Inline quick-add: close and let the select take over.
        onOpenChange(false);
        setState({ view: "list" });
        return;
      }
    }
    setState({ view: "list" });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {state.view === "list" && `Manage ${config.plural}`}
              {state.view === "create" && `Add ${config.singular}`}
              {state.view === "edit" && `Edit ${config.singular}`}
            </DialogTitle>
            <DialogDescription>
              {state.view === "list"
                ? `Add, edit, archive, or delete ${config.plural.toLowerCase()}. Archived records stay in historical data but are hidden from new selections.`
                : `${state.view === "create" ? "Create a new" : "Update this"} ${config.singular.toLowerCase()}.`}
            </DialogDescription>
          </DialogHeader>

          {state.view === "list" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <SearchInput
                  value={query}
                  onValueChange={setQuery}
                  placeholder={`Search ${config.plural.toLowerCase()}…`}
                  containerClassName="w-full sm:w-56"
                />
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Switch
                    checked={showArchived}
                    onCheckedChange={setShowArchived}
                    aria-label="Show archived records"
                  />
                  Show archived
                </label>
                <Button
                  size="sm"
                  className="ml-auto"
                  onClick={() => setState({ view: "create" })}
                >
                  <Plus data-icon="inline-start" aria-hidden="true" />
                  Add {config.singular}
                </Button>
              </div>

              <div className="max-h-80 overflow-y-auto">
                <MasterDataTable
                  records={visible}
                  columns={[
                    {
                      header: "Name",
                      render: (r) => (
                        <span className="font-medium">{r.name}</span>
                      ),
                    },
                    {
                      header: "Code",
                      className: "font-mono text-xs",
                      render: (r) => r.code ?? "—",
                    },
                  ]}
                  emptyLabel={`No ${config.plural.toLowerCase()} found.`}
                  onEdit={(record) => setState({ view: "edit", record })}
                  onArchive={actions.requestArchive}
                  onRestore={actions.requestRestore}
                  onDelete={actions.requestDelete}
                />
              </div>
            </div>
          ) : (
            <MasterDataForm
              kind={kind}
              record={state.view === "edit" ? state.record : undefined}
              initialName={state.view === "create" ? initialName : undefined}
              onSaved={handleSaved}
              onCancel={() => setState({ view: "list" })}
            />
          )}
        </DialogContent>
      </Dialog>

      {actions.element}
    </>
  );
}

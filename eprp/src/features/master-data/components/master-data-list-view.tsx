"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterBar, PageHeader, SearchInput } from "@/components/shared";
import type { MasterRecordBase } from "@/types";
import { MASTER_KIND_CONFIG } from "../services";
import type { MasterKind } from "../types";
import { useMasterData } from "../use-master-data";
import { MasterDataForm } from "./master-data-form";
import {
  MasterDataTable,
  type MasterDataColumn,
} from "./master-data-table";
import { useMasterDataActions } from "./use-master-data-actions";

type StatusFilter = "all" | "active" | "archived";

export interface MasterDataListViewProps {
  kind: MasterKind;
  eyebrow: string;
  description: string;
  columns: MasterDataColumn<MasterRecordBase>[];
  /** When set, Add / View / Edit navigate to pages instead of dialogs. */
  pageBasePath?: string;
  /**
   * How Edit behaves when `pageBasePath` is set. "page" (the default, and
   * what every kind with a dedicated edit route uses) navigates to
   * `${pageBasePath}/${id}/edit`; "dialog" edits in place, for kinds that
   * have a list and a detail page but no separate edit route.
   */
  editMode?: "page" | "dialog";
  /** Record to open on arrival, from a deep link elsewhere in the app. */
  focusId?: string;
  /** Whether the focused record opens straight into edit mode. */
  focusMode?: "view" | "edit";
  /** Path to go back to — set when arriving from the project setup wizard. */
  returnTo?: string;
}

type DialogState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; record: MasterRecordBase };

/**
 * Full-page management view for a master-data kind: stats-free header with
 * an Add action, search + status filter, the reusable table, and
 * create/edit (dialog or page) plus archive/restore/safe-delete.
 */
export function MasterDataListView({
  kind,
  eyebrow,
  description,
  columns,
  pageBasePath,
  editMode = "page",
  focusId,
  focusMode = "view",
  returnTo,
}: MasterDataListViewProps) {
  const router = useRouter();
  const config = MASTER_KIND_CONFIG[kind];
  const { records } = useMasterData(kind);

  const focused = focusId
    ? records.find((candidate) => candidate.id === focusId)
    : undefined;

  // These kinds are managed from the list rather than a detail page, so
  // "Open" narrows the list to the record and "Edit" opens its dialog. Both
  // resolve in the state initializer so a deep link lands correctly on the
  // first render instead of flashing the unfiltered list.
  const [query, setQuery] = React.useState(() =>
    focused && focusMode === "view" ? focused.name : ""
  );
  const [status, setStatus] = React.useState<StatusFilter>("active");
  const [dialog, setDialog] = React.useState<DialogState>(() =>
    focused && focusMode === "edit"
      ? { mode: "edit", record: focused }
      : { mode: "closed" }
  );

  const actions = useMasterDataActions(kind);

  const visible = records.filter((r) => {
    if (status === "active" && !r.active) return false;
    if (status === "archived" && r.active) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      r.name.toLowerCase().includes(q) ||
      (r.code ?? "").toLowerCase().includes(q)
    );
  });

  // Editing falls back to the in-place dialog whenever there is no dedicated
  // edit route to navigate to.
  const editsInDialog = !pageBasePath || editMode === "dialog";

  const handleAdd = () => {
    if (pageBasePath) router.push(`${pageBasePath}/new`);
    else setDialog({ mode: "create" });
  };
  const handleView = pageBasePath
    ? (record: MasterRecordBase) => router.push(`${pageBasePath}/${record.id}`)
    : undefined;
  const handleEdit = (record: MasterRecordBase) => {
    if (editsInDialog) setDialog({ mode: "edit", record });
    else router.push(`${pageBasePath}/${record.id}/edit`);
  };

  const activeFilterCount =
    (query ? 1 : 0) + (status !== "active" ? 1 : 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={eyebrow}
        title={config.plural}
        description={description}
        actions={
          // Master-data INSERT is `has_global_operational_authority()`. The
          // list itself stays readable to everyone — only the way in to a
          // mutation is withheld.
          actions.canMutate ? (
            <Button onClick={handleAdd}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              Add {config.singular}
            </Button>
          ) : undefined
        }
      />

      {returnTo && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3">
          <p className="text-sm text-muted-foreground">
            {focused
              ? `Editing ${focused.name} from project setup.`
              : "Opened from project setup."}
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link href={returnTo}>
              <ArrowLeft data-icon="inline-start" aria-hidden="true" />
              Back to project setup
            </Link>
          </Button>
        </div>
      )}

      <FilterBar
        activeCount={activeFilterCount}
        onReset={() => {
          setQuery("");
          setStatus("active");
        }}
      >
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder={`Search ${config.plural.toLowerCase()}…`}
          containerClassName="w-full sm:w-64"
        />
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as StatusFilter)}
        >
          <SelectTrigger className="w-36" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      <MasterDataTable
        records={visible}
        columns={columns}
        emptyLabel={`No ${config.plural.toLowerCase()} match your filters.`}
        onView={handleView}
        {...(actions.canMutate
          ? {
              onEdit: handleEdit,
              onArchive: actions.requestArchive,
              onRestore: actions.requestRestore,
              onDelete: actions.requestDelete,
            }
          : // Row-level mutations withheld together, for the same policy
            // reason as Add. `onView` is deliberately kept: reading a record
            // is `USING (true)`.
            {})}
      />

      {actions.element}

      {/* Inline create/edit for kinds without a dedicated edit route */}
      {editsInDialog && (
        <Dialog
          open={dialog.mode !== "closed"}
          onOpenChange={(o) => !o && setDialog({ mode: "closed" })}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {dialog.mode === "edit"
                  ? `Edit ${config.singular}`
                  : `Add ${config.singular}`}
              </DialogTitle>
              <DialogDescription>
                {dialog.mode === "edit"
                  ? `Update this ${config.singular.toLowerCase()}.`
                  : `Create a new ${config.singular.toLowerCase()}.`}
              </DialogDescription>
            </DialogHeader>
            {dialog.mode !== "closed" && (
              <MasterDataForm
                kind={kind}
                record={dialog.mode === "edit" ? dialog.record : undefined}
                columns={1}
                onSaved={(record, mode) => {
                  toast.success(
                    mode === "create"
                      ? `${config.singular} “${record.name}” added`
                      : `${config.singular} updated`
                  );
                  setDialog({ mode: "closed" });
                }}
                onCancel={() => setDialog({ mode: "closed" })}
              />
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

"use client";

import * as React from "react";
import { toast } from "sonner";
import { Archive, Flag, Link2, Plus, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, FilterBar, LoadingState, SearchInput } from "@/components/shared";
import { formatDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { deliverableService } from "@/services/deliverable-service";
import { milestoneService } from "@/services/milestone-service";
import { planningService } from "@/services/planning-service";
import type {
  MasterDeliverable,
  MasterMilestone,
  PlanningWorkItem,
  PlanningWorkItemType,
} from "@/types";
import { WORK_ITEM_TYPE_LABEL, WorkItemFormDialog } from "./work-item-form-dialog";

const ALL_TYPES = "all";

/** Depth-first order with each node's indent depth, for a readable WBS table. */
function flattenHierarchy(
  items: PlanningWorkItem[]
): { item: PlanningWorkItem; depth: number }[] {
  const byParent = new Map<string | undefined, PlanningWorkItem[]>();
  for (const item of items) {
    const key = item.parentWorkItemId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(item);
  }
  const sortGroup = (group: PlanningWorkItem[]) =>
    [...group].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));

  const result: { item: PlanningWorkItem; depth: number }[] = [];
  const visited = new Set<string>();
  const walk = (parentId: string | undefined, depth: number) => {
    for (const item of sortGroup(byParent.get(parentId) ?? [])) {
      if (visited.has(item.id)) continue; // guards a corrupt cycle from hanging the UI
      visited.add(item.id);
      result.push({ item, depth });
      walk(item.id, depth + 1);
    }
  };
  walk(undefined, 0);
  // Anything whose parent is missing/archived still needs to be visible.
  for (const item of items) {
    if (!visited.has(item.id)) {
      visited.add(item.id);
      result.push({ item, depth: 0 });
    }
  }
  return result;
}

export function MasterPlanPanel({
  projectId,
  canManage,
  hierarchyTerm,
}: {
  projectId: string;
  canManage: boolean;
  /** "Discipline" or "Program & Study" — reserved for future scope columns. */
  hierarchyTerm: string;
}) {
  const [items, setItems] = React.useState<PlanningWorkItem[] | undefined>();
  const [milestones, setMilestones] = React.useState<MasterMilestone[]>([]);
  const [deliverables, setDeliverables] = React.useState<MasterDeliverable[]>([]);
  const [search, setSearch] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<string>(ALL_TYPES);
  const [editing, setEditing] = React.useState<PlanningWorkItem | null | "new">(null);

  const load = React.useCallback(() => {
    void planningService.listWorkItems(projectId).then(setItems);
    void milestoneService.list(projectId).then(setMilestones);
    void deliverableService.list(projectId).then(setDeliverables);
  }, [projectId]);

  React.useEffect(() => load(), [load]);

  if (items === undefined) {
    return <LoadingState variant="table" label="Loading the Master Plan…" />;
  }

  const filtered = items.filter((item) => {
    if (typeFilter !== ALL_TYPES && item.itemType !== typeFilter) return false;
    if (!search.trim()) return true;
    const needle = search.trim().toLowerCase();
    return (
      item.code.toLowerCase().includes(needle) ||
      item.name.toLowerCase().includes(needle)
    );
  });
  const rows = flattenHierarchy(filtered);

  const archive = async (item: PlanningWorkItem) => {
    try {
      await planningService.archiveWorkItem(item.id);
      toast.success(`${item.code} archived.`);
      load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not archive the item.");
    }
  };

  return (
    <div className="space-y-3" data-hierarchy-term={hierarchyTerm}>
      <FilterBar>
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search code or name…"
          containerClassName="sm:w-64"
        />
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TYPES}>All types</SelectItem>
            {(Object.keys(WORK_ITEM_TYPE_LABEL) as PlanningWorkItemType[]).map((type) => (
              <SelectItem key={type} value={type}>
                {WORK_ITEM_TYPE_LABEL[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canManage && (
          <Button size="sm" className="sm:ml-auto" onClick={() => setEditing("new")}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add Work Item
          </Button>
        )}
      </FilterBar>

      {rows.length === 0 ? (
        <EmptyState
          icon={Flag}
          title={items.length === 0 ? "The Master Plan is empty" : "No work items match"}
          description={
            items.length === 0
              ? "Add work items directly, or import a schedule from Planning Data."
              : "Try a different search or type filter."
          }
          className="py-10"
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Weight %</TableHead>
                <TableHead>Planned Start</TableHead>
                <TableHead>Planned Finish</TableHead>
                <TableHead>Source</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ item, depth }) => {
                const linked =
                  item.itemType === "deliverable"
                    ? Boolean(item.masterDeliverableId)
                    : undefined;
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {item.code}
                    </TableCell>
                    <TableCell style={{ paddingLeft: 12 + depth * 16 }}>
                      <span className={cn(depth === 0 && "font-semibold")}>{item.name}</span>
                      {linked && (
                        <Link2
                          className="ml-1.5 inline size-3 text-muted-foreground"
                          aria-label="Linked to a governed register"
                        />
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {WORK_ITEM_TYPE_LABEL[item.itemType]}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {item.weightPercent ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums text-muted-foreground">
                      {item.plannedStartDate ? formatDate(item.plannedStartDate) : "—"}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums text-muted-foreground">
                      {item.plannedFinishDate ? formatDate(item.plannedFinishDate) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {item.source === "import" ? "Imported" : "Manual"}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(item)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-destructive"
                          aria-label={`Archive ${item.code}`}
                          onClick={() => void archive(item)}
                        >
                          <Archive className="size-3.5" aria-hidden="true" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {items.some((item) => !item.active) && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <RotateCcw className="size-3" aria-hidden="true" />
          Archived items are hidden from this register but kept for history.
        </p>
      )}

      {editing && (
        <WorkItemFormDialog
          projectId={projectId}
          item={editing === "new" ? undefined : editing}
          register={items}
          masterMilestones={milestones}
          masterDeliverables={deliverables}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

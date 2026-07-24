"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  ChevronUp,
  Copy,
  CornerDownRight,
  FileSpreadsheet,
  GitBranch,
  LayoutGrid,
  LayoutTemplate,
  Maximize2,
  Network,
  Plus,
  Settings,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  ConfirmDialog,
  EmptyState,
  LoadingState,
  StatusBadge,
  type StatusTone,
} from "@/components/shared";
import { organizationChartService } from "@/services/organization-chart-service";
import {
  buildPositionTree,
  collectDescendantIds,
  reorderSiblingIds,
  siblingsOf,
} from "@/lib/organization-tree";
import {
  allowedStatusTransitions,
  chartStatusLabel,
  isChartEditable,
  isChartLocked,
  lockReason,
} from "@/lib/organization-lock";
import type {
  OrganizationChart,
  OrganizationPosition,
  OrganizationPositionNode,
} from "@/types";
import { AddPositionDialog } from "./add-position-dialog";
import {
  PositionEditorPanel,
  type PositionEditorSubmit,
} from "./position-editor-panel";
import {
  OrgChartCanvas,
  type ChartView,
  type OrgChartCanvasHandle,
} from "./org-chart-canvas";
import { TemplateSelectorDialog } from "./template-selector-dialog";
import { ImportWizardDialog } from "./import-wizard-dialog";
import { ChartSettingsDialog } from "./chart-settings-dialog";
import type { ChartTemplate } from "../lib/chart-templates";
import type { PositionTreeInput } from "@/services/organization-chart-service";

export interface OrgChartWorkspaceProps {
  chart: OrganizationChart;
  /** Raised when the lifecycle changes, so the owner can hold the new chart. */
  onChartChange?: (chart: OrganizationChart) => void;
  /** Raised after the chart is archived, so the owner can re-resolve. */
  onArchived?: () => void;
}

/** Tone for each lifecycle state, so the badge reads at a glance. */
const CHART_STATUS_TONE: Record<OrganizationChart["status"], StatusTone> = {
  draft: "neutral",
  in_progress: "info",
  under_review: "warning",
  approved: "success",
  locked: "neutral",
  archived: "neutral",
};

/**
 * The chart workspace: toolbar plus interactive canvas.
 *
 * Positions are loaded flat and assembled into a tree here, so the canvas
 * only ever receives derived structure — consistent with the data model,
 * which stores parentage and sibling order but no geometry.
 */
export function OrgChartWorkspace({
  chart,
  onChartChange,
  onArchived,
}: OrgChartWorkspaceProps) {
  const [positions, setPositions] = React.useState<
    OrganizationPosition[] | null
  >(null);
  const [selectedId, setSelectedId] = React.useState<string | undefined>();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [dialogParentId, setDialogParentId] = React.useState<
    string | undefined
  >();
  const [busy, setBusy] = React.useState(false);
  const [savingPosition, setSavingPosition] = React.useState(false);
  const [templateOpen, setTemplateOpen] = React.useState(false);
  const [applyingTemplate, setApplyingTemplate] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [lifecycleBusy, setLifecycleBusy] = React.useState(false);

  // Approved and locked charts are a record, not a working document.
  const editable = isChartEditable(chart.status);
  // Collapsed branches are a view preference, not chart data.
  const [collapsedIds, setCollapsedIds] = React.useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [scale, setScale] = React.useState(1);

  const canvasRef = React.useRef<OrgChartCanvasHandle>(null);

  // Initial load. Subsequent refreshes go through `reload` from handlers.
  React.useEffect(() => {
    organizationChartService.listPositions(chart.id).then(setPositions);
  }, [chart.id]);

  const reload = React.useCallback(
    () => organizationChartService.listPositions(chart.id).then(setPositions),
    [chart.id]
  );

  const roots: OrganizationPositionNode[] = React.useMemo(
    () => buildPositionTree(positions ?? []),
    [positions]
  );

  const selected = positions?.find((position) => position.id === selectedId);

  const openAddDialog = (parentId?: string) => {
    setDialogParentId(parentId);
    setDialogOpen(true);
  };

  /** A sibling shares the selected position's parent — a root if it has none. */
  const openAddSibling = () => {
    if (!selected) return;
    openAddDialog(selected.parentPositionId);
  };

  const handleCreate = async (title: string) => {
    try {
      const created = await organizationChartService.createPosition({
        chartId: chart.id,
        projectId: chart.projectId,
        parentPositionId: dialogParentId,
        title,
      });
      await reload();
      setSelectedId(created.id);
      toast.success(`“${created.title}” added`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not add the position"
      );
      throw error;
    }
  };


  const toggleCollapse = (positionId: string) =>
    setCollapsedIds((previous) => {
      const next = new Set(previous);
      if (next.has(positionId)) next.delete(positionId);
      else next.add(positionId);
      return next;
    });

  const collapseAll = () =>
    setCollapsedIds(
      new Set(
        positions
          ?.filter((position) =>
            positions.some(
              (child) => child.parentPositionId === position.id
            )
          )
          .map((position) => position.id) ?? []
      )
    );

  /** Wraps a hierarchy change with the shared busy / reload / report cycle. */
  const runOperation = async (
    label: string,
    operation: () => Promise<unknown>
  ) => {
    setBusy(true);
    try {
      await operation();
      await reload();
      toast.success(label);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update the chart"
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDuplicate = () => {
    if (!selected) return;
    void runOperation("Position duplicated", async () => {
      const copy = await organizationChartService.duplicatePosition(
        selected.id
      );
      setSelectedId(copy.id);
    });
  };

  /**
   * Load a template into this chart. The chart itself is untouched — same id,
   * same project, still the active one — only its positions are regenerated,
   * so nothing that points at the chart has to be updated.
   */
  const handleApplyTemplate = async (template: ChartTemplate) => {
    setApplyingTemplate(true);
    try {
      const created = await organizationChartService.applyPositionTree(
        chart.id,
        template.nodes,
        { replaceExisting: positions !== null && positions.length > 0 }
      );
      await reload();
      // Anything that was selected has just been archived.
      setSelectedId(created[0]?.id);
      setCollapsedIds(new Set());
      setTemplateOpen(false);
      toast.success(
        created.length > 0
          ? `${template.name} loaded — ${created.length} position${created.length === 1 ? "" : "s"} created`
          : "Chart cleared"
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not load the template"
      );
    } finally {
      setApplyingTemplate(false);
    }
  };

  /**
   * Import replaces this chart's positions, the same way loading a template
   * does. The chart itself is untouched — same id, same review status.
   */
  const handleImport = async (nodes: PositionTreeInput[]) => {
    setImporting(true);
    try {
      const created = await organizationChartService.applyPositionTree(
        chart.id,
        nodes,
        { replaceExisting: positions !== null && positions.length > 0 }
      );
      await reload();
      setSelectedId(created[0]?.id);
      setCollapsedIds(new Set());
      setImportOpen(false);
      toast.success(
        `Imported — ${created.length} position${created.length === 1 ? "" : "s"} created`
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not import the chart"
      );
    } finally {
      setImporting(false);
    }
  };

  /**
   * Deleting takes the whole branch with it — a position cannot be removed
   * while something still reports to it.
   */
  const descendantCount = React.useMemo(() => {
    if (!selected || !positions) return 0;
    return collectDescendantIds(positions, selected.id).size;
  }, [selected, positions]);

  const handleDelete = async () => {
    if (!selected) return;
    await runOperation(
      descendantCount > 0
        ? `“${selected.title}” and ${descendantCount} position${descendantCount === 1 ? "" : "s"} beneath it deleted`
        : `“${selected.title}” deleted`,
      async () => {
        await organizationChartService.archivePosition(selected.id);
        setSelectedId(undefined);
      }
    );
    setDeleteOpen(false);
  };


  /* --------------------------- Chart lifecycle ---------------------------- */

  const runLifecycle = async (
    label: string,
    operation: () => Promise<OrganizationChart>
  ) => {
    setLifecycleBusy(true);
    try {
      const next = await operation();
      onChartChange?.(next);
      toast.success(label);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update the chart"
      );
    } finally {
      setLifecycleBusy(false);
    }
  };

  const handleStatusChange = (status: OrganizationChart["status"]) =>
    void runLifecycle(`Chart moved to ${chartStatusLabel(status)}`, () =>
      organizationChartService.setChartStatus(chart.id, status)
    );

  /**
   * The way past a locked chart: the settled version is kept as the record
   * and an editable copy takes over as the project's current chart.
   */
  const handleCreateRevision = () =>
    void runLifecycle("New revision created", () =>
      organizationChartService.createRevision(chart.id)
    );

  /** Drag and drop, and the Reports To picker, both land here. */
  const handleReparent = (positionId: string, newParentId: string) => {
    void runOperation("Position moved", () =>
      organizationChartService.movePosition(positionId, newParentId)
    );
  };

  const handleReorder = (direction: "up" | "down") => {
    if (!selected || !positions) return;
    const group = siblingsOf(positions, selected.id);
    const ordered = group.map((position) => position.id);
    const next = reorderSiblingIds(ordered, selected.id, direction);
    // reorderSiblingIds returns the input untouched at either end.
    if (next === ordered) return;
    void runOperation("Order updated", () =>
      organizationChartService.reorderSiblings(next)
    );
  };

  /** Position of the selection within its sibling group, for button state. */
  const siblingIndex = React.useMemo(() => {
    if (!selected || !positions) return { index: -1, total: 0 };
    const group = siblingsOf(positions, selected.id);
    return {
      index: group.findIndex((position) => position.id === selected.id),
      total: group.length,
    };
  }, [selected, positions]);

  /**
   * Persist the editor. Re-parenting and contact assignment are separate
   * service calls because each has its own rules — cycle rejection for the
   * move, an audit entry for the assignment.
   */
  const handleSavePosition = async (values: PositionEditorSubmit) => {
    if (!selected) return;
    setSavingPosition(true);
    try {
      await organizationChartService.updatePosition(selected.id, {
        title: values.title,
        code: values.code,
        role: values.role,
        notes: values.notes,
        departmentId: values.departmentId,
        disciplineId: values.disciplineId,
        company: values.company,
        employmentType: values.employmentType,
        email: values.email,
        phone: values.phone,
        status: values.status,
        startDate: values.startDate,
        endDate: values.endDate,
      });

      const nextParent = values.parentPositionId || undefined;
      if (nextParent !== selected.parentPositionId) {
        await organizationChartService.movePosition(selected.id, nextParent);
      }
      if (values.contactChanged) {
        await organizationChartService.assignContact(
          selected.id,
          values.contactId || undefined
        );
      }

      await reload();
      toast.success("Position saved");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save the position"
      );
      // Rethrow so the panel keeps its unsaved state rather than claiming
      // the change landed.
      throw error;
    } finally {
      setSavingPosition(false);
    }
  };

  /**
   * Compacts sibling `sortOrder` values to 0…n-1 so ordering is gap-free and
   * unambiguous, then refits. Layout itself is always derived, so this is
   * the only part of "auto layout" that touches data.
   */
  const handleAutoLayout = async () => {
    if (!positions) return;
    setBusy(true);
    try {
      const groups = new Map<string, OrganizationPosition[]>();
      for (const position of positions) {
        const key = position.parentPositionId ?? "__root__";
        groups.set(key, [...(groups.get(key) ?? []), position]);
      }

      let changed = 0;
      for (const siblings of groups.values()) {
        const ordered = [...siblings].sort(
          (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)
        );
        for (const [index, position] of ordered.entries()) {
          if (position.sortOrder === index) continue;
          await organizationChartService.movePosition(
            position.id,
            position.parentPositionId,
            index
          );
          changed += 1;
        }
      }

      if (changed > 0) await reload();
      canvasRef.current?.fit();
      toast.success(
        changed > 0
          ? `Layout tidied — ${changed} position${changed === 1 ? "" : "s"} reordered`
          : "Layout is already tidy"
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not tidy the layout"
      );
    } finally {
      setBusy(false);
    }
  };

  const handleViewChange = React.useCallback((view: ChartView) => {
    setScale(view.scale);
  }, []);

  if (positions === null) {
    return <LoadingState variant="card" label="Loading chart…" />;
  }

  const isEmpty = positions.length === 0;

  const transitions = allowedStatusTransitions(chart.status);

  return (
    <div className="space-y-3">
      {/* ------------------------------ Lifecycle ------------------------- */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-card p-2 shadow-soft ring-1 ring-foreground/10">
        <span className="text-xs font-medium text-muted-foreground">
          Revision {chart.version}
        </span>
        <StatusBadge tone={CHART_STATUS_TONE[chart.status]}>
          {chartStatusLabel(chart.status)}
        </StatusBadge>
        {chart.isCurrent && (
          <StatusBadge tone="info">Current</StatusBadge>
        )}

        {!editable && (
          <p className="text-xs text-muted-foreground text-pretty">
            {lockReason(chart.status)}
          </p>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            disabled={lifecycleBusy}
          >
            <Settings data-icon="inline-start" aria-hidden="true" />
            Manage
          </Button>
          {transitions.map((status) => (
            <Button
              key={status}
              variant="outline"
              size="sm"
              onClick={() => handleStatusChange(status)}
              disabled={lifecycleBusy}
            >
              {status === "archived"
                ? "Archive"
                : `Move to ${chartStatusLabel(status)}`}
            </Button>
          ))}
          {isChartLocked(chart.status) && (
            <Button
              size="sm"
              onClick={handleCreateRevision}
              disabled={lifecycleBusy}
            >
              <GitBranch data-icon="inline-start" aria-hidden="true" />
              Create New Revision
            </Button>
          )}
        </div>
      </div>

      {/* -------------------------------- Toolbar ------------------------- */}
      <div
        role="toolbar"
        aria-label="Chart tools"
        className="flex flex-wrap items-center gap-2 rounded-xl bg-card p-2 shadow-soft ring-1 ring-foreground/10"
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => openAddDialog(undefined)}
          disabled={busy || !editable}
        >
          <Plus data-icon="inline-start" aria-hidden="true" />
          Add Root
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => openAddDialog(selectedId)}
          disabled={busy || !selectedId || !editable}
          title={
            selectedId
              ? `Add a position reporting to ${selected?.title}`
              : "Select a position first"
          }
        >
          <CornerDownRight data-icon="inline-start" aria-hidden="true" />
          Add Child
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={openAddSibling}
          disabled={busy || !selectedId || !editable}
          title={
            selectedId
              ? "Add a position alongside the selected one"
              : "Select a position first"
          }
        >
          <Plus data-icon="inline-start" aria-hidden="true" />
          Add Sibling
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDuplicate}
          disabled={busy || !selectedId || !editable}
          title={
            selectedId
              ? "Copy this position as a vacant sibling"
              : "Select a position first"
          }
        >
          <Copy data-icon="inline-start" aria-hidden="true" />
          Duplicate
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDeleteOpen(true)}
          disabled={busy || !selectedId || !editable}
          title={
            selectedId
              ? "Delete this position and everything beneath it"
              : "Select a position first"
          }
        >
          <Trash2 data-icon="inline-start" aria-hidden="true" />
          Delete
        </Button>

        <Separator orientation="vertical" className="mx-1 h-6!" />

        <Button
          variant="outline"
          size="icon"
          aria-label="Move up among siblings"
          onClick={() => handleReorder("up")}
          disabled={busy || !editable || siblingIndex.index <= 0}
        >
          <ChevronUp aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Move down among siblings"
          onClick={() => handleReorder("down")}
          disabled={
            busy ||
            !editable ||
            siblingIndex.index < 0 ||
            siblingIndex.index >= siblingIndex.total - 1
          }
        >
          <ChevronDown aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label={
            collapsedIds.size > 0 ? "Expand all branches" : "Collapse all branches"
          }
          onClick={() =>
            collapsedIds.size > 0 ? setCollapsedIds(new Set()) : collapseAll()
          }
          disabled={busy || isEmpty}
        >
          {collapsedIds.size > 0 ? (
            <ChevronsUpDown aria-hidden="true" />
          ) : (
            <ChevronsDownUp aria-hidden="true" />
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleAutoLayout}
          disabled={busy || isEmpty || !editable}
        >
          <LayoutGrid data-icon="inline-start" aria-hidden="true" />
          Auto Layout
        </Button>

        <Separator orientation="vertical" className="mx-1 h-6!" />

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Zoom out"
            onClick={() => canvasRef.current?.zoomBy(1 / 1.2)}
            disabled={isEmpty}
          >
            <ZoomOut aria-hidden="true" />
          </Button>
          <span
            className="w-12 text-center text-xs text-muted-foreground tabular-nums"
            aria-live="polite"
            aria-label="Zoom level"
          >
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Zoom in"
            onClick={() => canvasRef.current?.zoomBy(1.2)}
            disabled={isEmpty}
          >
            <ZoomIn aria-hidden="true" />
          </Button>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => canvasRef.current?.fit()}
          disabled={isEmpty}
        >
          <Maximize2 data-icon="inline-start" aria-hidden="true" />
          Fit Screen
        </Button>

        <Separator orientation="vertical" className="mx-1 h-6!" />

        <Button
          variant="outline"
          size="sm"
          onClick={() => setTemplateOpen(true)}
          disabled={busy || !editable}
          title={
            isEmpty
              ? "Start from a standard structure"
              : "Replace this chart with a standard structure"
          }
        >
          <LayoutTemplate data-icon="inline-start" aria-hidden="true" />
          Load Template
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setImportOpen(true)}
          disabled={busy || !editable}
          title={
            isEmpty
              ? "Import a chart from a spreadsheet"
              : "Replace this chart with a spreadsheet"
          }
        >
          <FileSpreadsheet data-icon="inline-start" aria-hidden="true" />
          Import Excel
        </Button>

        <div className="ml-auto flex items-center gap-2">
          {selected && (
            <span className="max-w-48 truncate text-xs text-muted-foreground">
              Selected: {selected.title}
            </span>
          )}
          <StatusBadge tone="neutral">
            {positions.length} position{positions.length === 1 ? "" : "s"}
          </StatusBadge>
        </div>
      </div>

      {/* -------------------------------- Canvas -------------------------- */}
      {isEmpty ? (
        <div className="rounded-xl border bg-muted/20 p-6">
          <EmptyState
            icon={Network}
            title="This chart is empty"
            description="Start with the top of the reporting structure, then add the positions beneath it."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  onClick={() => openAddDialog(undefined)}
                  disabled={!editable}
                >
                  <Plus data-icon="inline-start" aria-hidden="true" />
                  Add Root Position
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setTemplateOpen(true)}
                  disabled={!editable}
                >
                  <LayoutTemplate data-icon="inline-start" aria-hidden="true" />
                  Load Template
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setImportOpen(true)}
                  disabled={!editable}
                >
                  <FileSpreadsheet data-icon="inline-start" aria-hidden="true" />
                  Import Excel
                </Button>
              </div>
            }
            className="py-10"
          />
        </div>
      ) : (
        <div
          className={
            selected
              ? "gap-3 xl:grid xl:grid-cols-[minmax(0,1fr)_22rem]"
              : undefined
          }
        >
          <OrgChartCanvas
            ref={canvasRef}
            roots={roots}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onViewChange={handleViewChange}
            collapsedIds={collapsedIds}
            onToggleCollapse={toggleCollapse}
            onReparent={editable ? handleReparent : undefined}
          />
          {selected && (
            <PositionEditorPanel
              // Remounting on selection resets the form to the new position.
              key={selected.id}
              className="mt-3 xl:mt-0"
              position={selected}
              positions={positions}
              saving={savingPosition}
              readOnly={!editable}
              onSave={handleSavePosition}
              onClose={() => setSelectedId(undefined)}
            />
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Drag the canvas to pan, scroll to zoom, and click a position to select
        it. Drag a position onto another to change who it reports to; press
        Escape to abandon a drag.
      </p>

      <AddPositionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        parentTitle={
          dialogParentId
            ? positions.find((p) => p.id === dialogParentId)?.title
            : undefined
        }
        onSubmit={handleCreate}
      />

      <TemplateSelectorDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        existingPositionCount={positions.length}
        applying={applyingTemplate}
        onApply={handleApplyTemplate}
      />

      <ImportWizardDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        existingPositionCount={positions.length}
        importing={importing}
        onImport={handleImport}
      />

      <ChartSettingsDialog
        // Remount on a fresh chart so the form reseeds without an effect.
        key={`${chart.id}:${chart.updatedAt}`}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        chart={chart}
        onSaved={(next) => onChartChange?.(next)}
        onArchived={() => onArchived?.()}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={selected ? `Delete “${selected.title}”?` : "Delete position?"}
        description={
          descendantCount > 0
            ? `${descendantCount} position${descendantCount === 1 ? "" : "s"} report${descendantCount === 1 ? "s" : ""} to this one, directly or indirectly, and will be deleted with it.`
            : "This position will be removed from the chart."
        }
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
}

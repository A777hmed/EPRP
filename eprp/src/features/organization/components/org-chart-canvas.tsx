"use client";

import * as React from "react";
import { Building2, ChevronDown, ChevronRight, User, UserX } from "lucide-react";

import { cn } from "@/lib/utils";
import { getContactById, getDepartmentById } from "@/features/master-data";
import type { OrganizationPositionNode } from "@/types";
import {
  clampScale,
  fitToViewport,
  layoutChart,
  zoomAbout,
  type ChartLayout,
} from "../lib/chart-layout";
import { childCountById, pruneCollapsed } from "@/lib/organization-tree";
import { OrgChartMinimap } from "./org-chart-minimap";

export interface ChartView {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface OrgChartCanvasHandle {
  fit: () => void;
  zoomBy: (factor: number) => void;
  getScale: () => number;
}

export interface OrgChartCanvasProps {
  roots: OrganizationPositionNode[];
  selectedId?: string;
  onSelect: (positionId: string | undefined) => void;
  onViewChange?: (view: ChartView) => void;
  /** Ids whose children are hidden. Purely a view concern. */
  collapsedIds: ReadonlySet<string>;
  onToggleCollapse: (positionId: string) => void;
  /**
   * Re-parent by dragging one position onto another. The canvas only offers
   * drops that cannot create a cycle; the service checks again on save.
   */
  /** Omitted on a read-only chart, which also turns dragging off. */
  onReparent?: (positionId: string, newParentId: string) => void;
  className?: string;
}

/**
 * Interactive organization chart canvas.
 *
 * Node coordinates come from the layout pass, never from storage — panning
 * and zooming move a single transformed layer rather than the nodes, so the
 * underlying hierarchy is untouched by navigation.
 */
export const OrgChartCanvas = React.forwardRef<
  OrgChartCanvasHandle,
  OrgChartCanvasProps
>(function OrgChartCanvas(
  {
    roots,
    selectedId,
    onSelect,
    onViewChange,
    collapsedIds,
    onToggleCollapse,
    onReparent,
    className,
  },
  ref
) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = React.useState({ width: 0, height: 0 });
  const [view, setView] = React.useState<ChartView>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });

  // Collapsed branches are pruned before layout, so hidden nodes take up
  // no space and the connectors stop at the collapsed parent.
  const visibleRoots = React.useMemo(
    () => pruneCollapsed(roots, collapsedIds),
    [roots, collapsedIds]
  );
  const childCounts = React.useMemo(() => childCountById(roots), [roots]);

  const layout: ChartLayout = React.useMemo(
    () => layoutChart(visibleRoots),
    [visibleRoots]
  );

  const applyView = React.useCallback(
    (next: ChartView) => {
      setView(next);
      onViewChange?.(next);
    },
    [onViewChange]
  );

  /**
   * Read the canvas size straight from the DOM and cache it.
   *
   * ResizeObserver keeps this fresh while the layout shifts, but measuring
   * on demand means fitting and zooming still work if an observer callback
   * has not arrived yet — the observer is an optimisation, not the source
   * of truth.
   */
  const measure = React.useCallback(() => {
    const element = containerRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const size = { width: rect.width, height: rect.height };
    setViewport((previous) =>
      previous.width === size.width && previous.height === size.height
        ? previous
        : size
    );
    return size;
  }, []);

  const fit = React.useCallback(() => {
    const size = measure() ?? viewport;
    if (layout.nodes.length === 0 || size.width === 0) return;
    applyView(fitToViewport(layout, size));
  }, [applyView, layout, measure, viewport]);

  const zoomBy = React.useCallback(
    (factor: number) => {
      const size = measure() ?? viewport;
      applyView(
        zoomAbout(view, clampScale(view.scale * factor), {
          x: size.width / 2,
          y: size.height / 2,
        })
      );
    },
    [applyView, measure, view, viewport]
  );

  React.useImperativeHandle(
    ref,
    () => ({ fit, zoomBy, getScale: () => view.scale }),
    [fit, zoomBy, view.scale]
  );

  // Track size changes. Also covers window resizes, which some environments
  // report only through the window event.
  React.useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  // Fit once, as soon as there is a chart to fit. Measuring happens inside
  // `fit`, so this does not wait on an observer callback. Deferred a frame
  // so the state change is not synchronous with the effect body.
  const [hasFitted, setHasFitted] = React.useState(false);
  React.useEffect(() => {
    if (hasFitted || layout.nodes.length === 0) return;

    // A timer rather than requestAnimationFrame: fitting is behaviour, not
    // animation, and rAF is suspended while the document is hidden — a
    // chart opened in a background tab would otherwise never fit.
    let timer = 0;
    let attempts = 0;
    const tick = () => {
      const size = measure();
      if (size && size.width > 0) {
        applyView(fitToViewport(layout, size));
        setHasFitted(true);
        return;
      }
      // The canvas cannot be measured until it has been laid out, so retry
      // briefly instead of waiting on a resize notification.
      if (attempts++ < 10) timer = window.setTimeout(tick, 16);
    };
    timer = window.setTimeout(tick, 0);
    return () => window.clearTimeout(timer);
  }, [hasFitted, layout, applyView, measure]);


  /* ----------------------------- Drag and drop ---------------------------- */

  const dragRef = React.useRef<{
    pointerId: number;
    positionId: string;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = React.useState<string | null>(null);

  /** Positions a given node may legally be dropped onto. */
  const validTargets = React.useMemo(() => {
    if (!dragging) return new Set<string>();
    const flat = layout.nodes.map((laid) => laid.node);
    return new Set(
      flat
        .filter(
          (candidate) =>
            candidate.id !== dragging &&
            candidate.id !== flatParentId(flat, dragging) &&
            !isDescendantOf(flat, candidate.id, dragging)
        )
        .map((candidate) => candidate.id)
    );
  }, [dragging, layout.nodes]);

  /** Which node sits under a viewport point, if any. */
  const hitTest = React.useCallback(
    (clientX: number, clientY: number): string | null => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const x = (clientX - rect.left - view.offsetX) / view.scale;
      const y = (clientY - rect.top - view.offsetY) / view.scale;
      const hit = layout.nodes.find(
        (laid) =>
          x >= laid.x &&
          x <= laid.x + laid.width &&
          y >= laid.y &&
          y <= laid.y + laid.height
      );
      return hit?.id ?? null;
    },
    [layout.nodes, view]
  );

  const startDrag = (positionId: string, event: React.PointerEvent) => {
    // Read-only charts pan and zoom, but positions stay where they are.
    if (!onReparent) return;
    dragRef.current = {
      pointerId: event.pointerId,
      positionId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  };

  /* ------------------------------- Panning ------------------------------- */

  const panState = React.useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  // Mirrored in state purely so the cursor can react; the ref carries the
  // live values during a drag.
  const [panning, setPanning] = React.useState(false);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Only start a pan from the background, so node clicks still select.
    if ((event.target as HTMLElement).closest("[data-position-node]")) return;
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.offsetX,
      originY: view.offsetY,
    };
    setPanning(true);
    onSelect(undefined);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      // A few pixels of slack so a click on a node still selects it.
      if (
        !drag.moved &&
        Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4
      ) {
        return;
      }
      if (!drag.moved) {
        drag.moved = true;
        setDragging(drag.positionId);
      }
      const over = hitTest(event.clientX, event.clientY);
      setDropTargetId(over && over !== drag.positionId ? over : null);
      return;
    }

    const pan = panState.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    applyView({
      scale: view.scale,
      offsetX: pan.originX + (event.clientX - pan.startX),
      offsetY: pan.originY + (event.clientY - pan.startY),
    });
  };

  const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      const target = drag.moved ? hitTest(event.clientX, event.clientY) : null;
      dragRef.current = null;
      setDragging(null);
      setDropTargetId(null);
      if (target && target !== drag.positionId && validTargets.has(target)) {
        onReparent?.(drag.positionId, target);
      }
      return;
    }

    if (panState.current?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      panState.current = null;
      setPanning(false);
    }
  };

  /* -------------------------------- Zoom --------------------------------- */

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    applyView(
      zoomAbout(view, clampScale(view.scale * factor), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      })
    );
  };

  // Escape abandons a drag without re-parenting.
  React.useEffect(() => {
    if (!dragging) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      dragRef.current = null;
      setDragging(null);
      setDropTargetId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dragging]);

  const navigateTo = (chartPoint: { x: number; y: number }) => {
    applyView({
      scale: view.scale,
      offsetX: viewport.width / 2 - chartPoint.x * view.scale,
      offsetY: viewport.height / 2 - chartPoint.y * view.scale,
    });
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative h-[34rem] touch-none overflow-hidden rounded-xl border bg-muted/20",
        // Dot grid, so panning is visible even in empty space.
        "[background-image:radial-gradient(var(--color-border)_1px,transparent_1px)] [background-size:20px_20px]",
        panning ? "cursor-grabbing" : "cursor-grab",
        className
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onWheel={handleWheel}
      role="application"
      aria-label="Organization chart canvas"
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{
          width: layout.width,
          height: layout.height,
          transform: `translate(${view.offsetX}px, ${view.offsetY}px) scale(${view.scale})`,
        }}
      >
        <svg
          width={layout.width}
          height={layout.height}
          className="pointer-events-none absolute top-0 left-0 overflow-visible"
          aria-hidden="true"
        >
          {layout.edges.map((edge) => (
            <path
              key={edge.id}
              d={edge.path}
              fill="none"
              className="stroke-border"
              strokeWidth={1.5}
            />
          ))}
        </svg>

        {layout.nodes.map((laid) => (
          <PositionCard
            key={laid.id}
            x={laid.x}
            y={laid.y}
            width={laid.width}
            height={laid.height}
            node={laid.node}
            selected={laid.id === selectedId}
            childCount={childCounts.get(laid.id) ?? 0}
            collapsed={collapsedIds.has(laid.id)}
            dragging={dragging === laid.id}
            dropTarget={dropTargetId === laid.id && validTargets.has(laid.id)}
            invalidTarget={
              dragging !== null &&
              dragging !== laid.id &&
              !validTargets.has(laid.id)
            }
            onSelect={() => onSelect(laid.id)}
            onToggleCollapse={() => onToggleCollapse(laid.id)}
            onDragStart={(event) => startDrag(laid.id, event)}
          />
        ))}
      </div>

      <div className="pointer-events-none absolute right-3 bottom-3">
        <OrgChartMinimap
          layout={layout}
          view={view}
          viewport={viewport}
          selectedId={selectedId}
          onNavigate={navigateTo}
        />
      </div>
    </div>
  );
});

/* ------------------------------ Node card -------------------------------- */

function PositionCard({
  x,
  y,
  width,
  height,
  node,
  selected,
  childCount,
  collapsed,
  dragging,
  dropTarget,
  invalidTarget,
  onSelect,
  onToggleCollapse,
  onDragStart,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  node: OrganizationPositionNode;
  selected: boolean;
  childCount: number;
  collapsed: boolean;
  dragging: boolean;
  dropTarget: boolean;
  invalidTarget: boolean;
  onSelect: () => void;
  onToggleCollapse: () => void;
  onDragStart: (event: React.PointerEvent) => void;
}) {
  const contact = getContactById(node.contactId);
  const department = getDepartmentById(node.departmentId);

  return (
    <button
      type="button"
      data-position-node={node.id}
      onClick={onSelect}
      onPointerDown={onDragStart}
      aria-pressed={selected}
      aria-grabbed={dragging || undefined}
      style={{ left: x, top: y, width, height }}
      className={cn(
        "absolute flex cursor-grab flex-col justify-center gap-0.5 rounded-lg border bg-card px-3 py-2 text-left shadow-soft transition-colors",
        "hover:border-primary/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        selected && "border-primary ring-2 ring-primary/30",
        dragging && "opacity-50",
        dropTarget && "border-success ring-2 ring-success/40",
        invalidTarget && "opacity-60"
      )}
    >
      <span className="truncate text-sm font-semibold">{node.title}</span>

      <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
        {contact ? (
          <>
            <User className="size-3 shrink-0" aria-hidden="true" />
            {contact.name}
          </>
        ) : (
          <>
            <UserX className="size-3 shrink-0" aria-hidden="true" />
            Vacant
          </>
        )}
      </span>

      {department && (
        <span className="flex items-center gap-1 truncate text-[0.7rem] text-muted-foreground">
          <Building2 className="size-3 shrink-0" aria-hidden="true" />
          {department.name}
        </span>
      )}

      {childCount > 0 && (
        // A span rather than a nested button: buttons cannot nest, and the
        // pointer handlers here must not start a drag.
        <span
          role="button"
          tabIndex={0}
          aria-label={
            collapsed
              ? `Expand ${childCount} report${childCount === 1 ? "" : "s"}`
              : `Collapse ${childCount} report${childCount === 1 ? "" : "s"}`
          }
          aria-expanded={!collapsed}
          data-collapse-toggle
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapse();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            onToggleCollapse();
          }}
          className="absolute -bottom-2.5 left-1/2 flex -translate-x-1/2 cursor-pointer items-center gap-0.5 rounded-full border bg-background px-1.5 py-0.5 text-[0.65rem] font-medium shadow-soft hover:bg-muted"
        >
          {collapsed ? (
            <ChevronRight className="size-3" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-3" aria-hidden="true" />
          )}
          {childCount}
        </span>
      )}
    </button>
  );
}

/* ------------------------------ Drop rules -------------------------------- */

/** The current parent of a position, from a flat list. */
function flatParentId(
  positions: OrganizationPositionNode[],
  positionId: string
): string | undefined {
  return positions.find((candidate) => candidate.id === positionId)
    ?.parentPositionId;
}

/** Whether `candidateId` sits inside the subtree rooted at `ancestorId`. */
function isDescendantOf(
  positions: OrganizationPositionNode[],
  candidateId: string,
  ancestorId: string
): boolean {
  const byId = new Map(positions.map((p) => [p.id, p]));
  let cursor = byId.get(candidateId);
  const seen = new Set<string>();
  while (cursor?.parentPositionId) {
    if (seen.has(cursor.id)) break;
    seen.add(cursor.id);
    if (cursor.parentPositionId === ancestorId) return true;
    cursor = byId.get(cursor.parentPositionId);
  }
  return false;
}

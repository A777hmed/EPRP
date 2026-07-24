"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import type { ChartLayout } from "../lib/chart-layout";

const MAP_WIDTH = 168;
const MAP_HEIGHT = 112;

export interface OrgChartMinimapProps {
  layout: ChartLayout;
  /** Current view transform, in viewport pixels. */
  view: { scale: number; offsetX: number; offsetY: number };
  /** Size of the visible canvas area, in viewport pixels. */
  viewport: { width: number; height: number };
  selectedId?: string;
  /** Centre the canvas on a point given in chart space. */
  onNavigate: (chartPoint: { x: number; y: number }) => void;
  className?: string;
}

/**
 * Overview of the whole chart with the current viewport drawn on top.
 * Clicking or dragging inside re-centres the canvas.
 */
export function OrgChartMinimap({
  layout,
  view,
  viewport,
  selectedId,
  onNavigate,
  className,
}: OrgChartMinimapProps) {
  const ref = React.useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = React.useState(false);

  if (layout.nodes.length === 0) return null;

  // Scale the whole chart down to fit the minimap.
  const scale = Math.min(
    MAP_WIDTH / layout.width,
    MAP_HEIGHT / layout.height
  );
  const mapW = layout.width * scale;
  const mapH = layout.height * scale;

  // The slice of chart space currently on screen.
  const visible = {
    x: -view.offsetX / view.scale,
    y: -view.offsetY / view.scale,
    width: viewport.width / view.scale,
    height: viewport.height / view.scale,
  };

  const navigateFromEvent = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    onNavigate({
      x: (event.clientX - rect.left) / scale,
      y: (event.clientY - rect.top) / scale,
    });
  };

  return (
    <div
      className={cn(
        "pointer-events-auto rounded-lg border bg-background/95 p-1 shadow-soft backdrop-blur",
        className
      )}
    >
      <svg
        ref={ref}
        width={mapW}
        height={mapH}
        role="img"
        aria-label="Chart minimap"
        className="block cursor-pointer touch-none"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          navigateFromEvent(event);
        }}
        onPointerMove={(event) => {
          if (dragging) navigateFromEvent(event);
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
          setDragging(false);
        }}
      >
        {layout.nodes.map((node) => (
          <rect
            key={node.id}
            x={node.x * scale}
            y={node.y * scale}
            width={node.width * scale}
            height={node.height * scale}
            rx={1.5}
            className={
              node.id === selectedId
                ? "fill-primary"
                : "fill-muted-foreground/40"
            }
          />
        ))}
        <rect
          x={visible.x * scale}
          y={visible.y * scale}
          width={visible.width * scale}
          height={visible.height * scale}
          className="fill-primary/10 stroke-primary"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}

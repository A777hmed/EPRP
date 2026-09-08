"use client";

/**
 * The Next Week Plan's day axis and its bars.
 *
 * Presentation only. It renders what `next-week-window.ts` derived from the
 * report's own period, the project's working week, and each task's stored
 * dates — it fetches nothing, stores nothing, and owns no task state. The task
 * records it draws are the SAME `weekly_plan_items` rows the editor above it
 * writes; there is one dataset and one list.
 *
 * The original Weekly design put a working-week Gantt under "Next Week Plan",
 * and it is the clearest thing in that design: a reader sees at a glance which
 * days are loaded and which task runs into the next week. What is deliberately
 * NOT carried over is its form styling — the ruled grid, the boxed cells, the
 * printed-sheet frame. This sits on the Pass 1.2 reporting shell instead.
 *
 * NO PROGRESS IS SHOWN. `weekly_plan_items` records status, not percent
 * complete, so a part-filled bar would be an invention. Status is carried by
 * the bar's colour and by the row's own badge.
 */

import * as React from "react";

import { StatusBadge, type StatusTone } from "@/components/shared";
import { formatDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type { WeeklyPlanStatus } from "@/types";
import type { BarPlacement, NextWeekDay } from "../next-week-window";

export interface NextWeekStatusMeta {
  label: string;
  tone: StatusTone;
  /** Tailwind background class for the bar. */
  color: string;
}

/** The grid the header and every row share, so columns line up exactly. */
function columnStyle(count: number): React.CSSProperties {
  return { gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` };
}

export function NextWeekAxisHeader({
  days,
  className,
}: {
  days: NextWeekDay[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid overflow-hidden rounded-md border bg-muted/40",
        className
      )}
      style={columnStyle(days.length)}
    >
      {days.map((day) => (
        <div
          key={day.date}
          className="border-r px-1 py-1 text-center last:border-r-0"
          title={formatDate(day.date)}
        >
          <span className="block text-[0.625rem] font-bold tracking-[0.08em] text-primary uppercase">
            {day.label}
          </span>
          <span className="block text-[0.625rem] tabular-nums text-muted-foreground">
            {day.dayOfMonth}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * One task's bar, over the same column grid as the header.
 *
 * The ruled day columns are drawn first and the bar is laid OVER them as a
 * single element, rather than a coloured block per column. A task running
 * Monday to Thursday is one span of work, and four separate blocks with gaps at
 * every column boundary read as four — which is not what the data says.
 *
 * The empty track stays visible behind it, which is what lets a reader see the
 * shape of the week rather than a bar floating in space.
 */
export function NextWeekBar({
  days,
  placement,
  status,
  meta,
  label,
}: {
  days: NextWeekDay[];
  placement: BarPlacement;
  status: WeeklyPlanStatus;
  meta: Record<WeeklyPlanStatus, NextWeekStatusMeta>;
  /** Accessible description, e.g. "Draft SOP review · 12 Jul – 15 Jul". */
  label: string;
}) {
  if (days.length === 0) return null;

  const drawn =
    placement.kind !== "outside" &&
    placement.startIndex !== undefined &&
    placement.endIndex !== undefined;

  return (
    <div
      className="relative overflow-hidden rounded-md border bg-muted/25"
      role="img"
      aria-label={label}
    >
      {/* The ruled track. */}
      <div className="grid" style={columnStyle(days.length)}>
        {days.map((day) => (
          <div key={day.date} className="h-6 border-r last:border-r-0" />
        ))}
      </div>

      {drawn && (
        <span
          className={cn(
            "absolute top-1/2 h-2.5 -translate-y-1/2",
            meta[status].color,
            /* A clipped end stays square, so a bar that really does continue
               past the window never looks finished. */
            !placement.clippedStart && "rounded-l-full",
            !placement.clippedEnd && "rounded-r-full"
          )}
          style={{
            left: `calc(${(placement.startIndex! / days.length) * 100}% + 2px)`,
            width: `calc(${
              ((placement.endIndex! - placement.startIndex! + 1) / days.length) * 100
            }% - 4px)`,
          }}
        />
      )}
    </div>
  );
}

/**
 * The column template both the axis header and the task rows are laid out on,
 * so a bar sits under the day it belongs to. One constant, because two that
 * agree today will not agree after the next edit.
 */
export const NEXT_WEEK_GRID =
  /* The task name and the owner are what a reader scans; the chart only needs
     enough width to be read at a glance. Weighted so none of the three is
     truncated at 1280 with the project sidebar open. */
  "lg:grid-cols-[minmax(11rem,2.2fr)_9.5rem_minmax(11rem,1.8fr)_minmax(10rem,1.5fr)_6.5rem]";

/**
 * What the bar could not say, in words.
 *
 * Rendered beside the dates rather than on the chart, because these are facts
 * about the task's real span and the chart is only a window onto it.
 */
export function NextWeekPlacementNote({
  placement,
}: {
  placement: BarPlacement;
}) {
  if (placement.kind === "outside") {
    return (
      <StatusBadge tone="neutral">Outside the next-week window</StatusBadge>
    );
  }

  const notes: string[] = [];
  if (placement.clippedStart) notes.push("starts earlier");
  if (placement.clippedEnd) notes.push("continues past this week");
  if (placement.kind === "marker") notes.push("single-day target");

  if (notes.length === 0) return null;
  return (
    <span className="text-[0.6875rem] text-muted-foreground">
      {notes.join(" · ")}
    </span>
  );
}

/** "12 Jul – 15 Jul", or just the end date when no start was recorded. */
export function planItemRange(
  startDate: string | undefined,
  endDate: string
): string {
  return startDate ? `${formatDate(startDate)} – ${formatDate(endDate)}` : formatDate(endDate);
}

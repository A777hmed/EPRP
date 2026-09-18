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
        "grid overflow-hidden rounded-md border border-primary/25 bg-primary/[0.06]",
        className
      )}
      style={columnStyle(days.length)}
    >
      {days.map((day) => (
        <div
          key={day.date}
          className="border-r border-primary/20 py-1 text-center last:border-r-0"
          title={formatDate(day.date)}
        >
          <span className="block text-[0.625rem] leading-tight font-bold tracking-[0.08em] text-primary uppercase">
            {day.label}
          </span>
          <span className="block text-[0.6875rem] leading-tight font-semibold tabular-nums text-primary/70">
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
 * A CALENDAR SPAN, NOT A PROGRESS BAR — and the difference is the whole point
 * of this component. The first version drew a thin rounded pill across the
 * track, which is the shape of a progress meter: a reader saw "how far along"
 * rather than "which days". A task running Sunday to Wednesday on a Sunday-to
 * -Thursday week filled four fifths of the track and read as 80% complete,
 * which is not a claim the data makes at all — `weekly_plan_items` records
 * status, never percent.
 *
 * So the bar is a block that FILLS the day cells it occupies, and the day rules
 * are drawn back over the top of it. The cell boundaries stay visible through
 * the bar, so the span can be counted in days rather than estimated as a
 * fraction, and its right edge is a wall between two days rather than a point
 * on a scale.
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
      className="relative overflow-hidden rounded-md border bg-muted/30"
      role="img"
      aria-label={label}
    >
      {/* The day cells. */}
      <div className="grid" style={columnStyle(days.length)}>
        {days.map((day) => (
          <div key={day.date} className="h-8" />
        ))}
      </div>

      {/*
        The span. Positioned on exact column fractions — `startIndex / n` to
        `(endIndex + 1) / n` — so an edge always falls on a day boundary and
        never between two days.
      */}
      {drawn && (
        <div
          data-slot="next-week-bar"
          className={cn(
            "absolute inset-y-1",
            meta[status].color,
            /* A clipped end stays square: a task that really does continue past
               the window must not look as though it finishes at the edge. */
            !placement.clippedStart && "rounded-l-sm",
            !placement.clippedEnd && "rounded-r-sm"
          )}
          style={{
            left: `${(placement.startIndex! / days.length) * 100}%`,
            width: `${
              ((placement.endIndex! - placement.startIndex! + 1) / days.length) * 100
            }%`,
          }}
        />
      )}

      {/*
        Day rules, drawn LAST so they sit over the bar. This is what turns a
        filled block into a countable run of days.
      */}
      <div
        className="pointer-events-none absolute inset-0 grid"
        style={columnStyle(days.length)}
        aria-hidden="true"
      >
        {days.map((day) => (
          <div
            key={day.date}
            className="border-r border-background last:border-r-0"
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The column template both the axis header and the task rows are laid out on,
 * so a bar sits under the day it belongs to. One constant, because two that
 * agree today will not agree after the next edit.
 */
export const NEXT_WEEK_GRID =
  /* Task | Start | End | timeline | Status — the original Weekly's shape.
     The task column is wide enough for a real EPROM task name to wrap to two
     readable lines rather than being clipped, and the timeline keeps enough
     width that a day cell stays countable at 1280 with the project sidebar
     open. Both were measured, not guessed. */
  "lg:grid-cols-[minmax(14rem,2.6fr)_5.5rem_5.5rem_minmax(14rem,2.4fr)_6.5rem]";

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

/**
 * A column heading in the Gantt table.
 *
 * Small, uppercase and always present. The reviewer's note was that two bare
 * date inputs side by side give no way to tell Start from End; a heading over
 * every column is the cheapest fix that also holds for the read-only table.
 */
export function GanttColumnLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="hidden text-[0.625rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase lg:block">
      {children}
    </span>
  );
}

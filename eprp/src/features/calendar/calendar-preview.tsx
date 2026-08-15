"use client";

/**
 * The Dashboard's calendar panel.
 *
 * A COMPACT VIEW OF THE SAME DATA, not a second calendar. It calls the same
 * `useCalendar` hook the workspace does, over a one-week window, so an event
 * shown here and the same event in the workspace cannot disagree.
 *
 * Selecting an entry opens the same drawer component the workspace uses, which
 * is why a derived milestone stays read-only here too.
 */

import * as React from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { EmptyState, LoadingState } from "@/components/shared";
import { EVENT_TYPE_META, timeRangeLabel, type CalendarEvent } from "./calendar-types";
import { EventDrawer } from "./event-editor";
import {
  addDays,
  isoDate,
  startOfWeek,
  useCalendar,
  type CalendarFilters,
} from "./use-calendar";

export function CalendarPreview({
  projectId,
  departmentId,
  canManage,
}: {
  /** Driven by the Dashboard's global filters, so the panel follows the page. */
  projectId: string;
  departmentId: string;
  canManage: boolean;
}) {
  const [weekAnchor, setWeekAnchor] = React.useState<Date>(() => new Date());
  const [selected, setSelected] = React.useState<CalendarEvent | null>(null);

  const window = React.useMemo(() => {
    const start = startOfWeek(weekAnchor);
    return { from: isoDate(start), to: isoDate(addDays(start, 6)) };
  }, [weekAnchor]);

  const filters = React.useMemo<CalendarFilters>(
    () => ({ projectId, departmentId, types: [] }),
    [projectId, departmentId]
  );

  const calendar = useCalendar(window, filters);
  const today = isoDate(new Date());

  const days = React.useMemo(() => {
    const start = startOfWeek(weekAnchor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [weekAnchor]);

  return (
    <section className="dash-panel dash-calendar">
      <header className="dash-panel-head">
        <div>
          <b>Calendar</b>
          <small>{rangeLabel(window.from, window.to)}</small>
        </div>
        <div className="dash-cal-nav">
          <button type="button" onClick={() => setWeekAnchor(new Date())}>
            Today
          </button>
          <button type="button" onClick={() => setWeekAnchor((d) => addDays(d, -7))} aria-label="Previous week">
            <ChevronLeft aria-hidden />
          </button>
          <button type="button" onClick={() => setWeekAnchor((d) => addDays(d, 7))} aria-label="Next week">
            <ChevronRight aria-hidden />
          </button>
          <Link href="/calendar">Open Calendar</Link>
        </div>
      </header>

      {calendar.loading ? (
        <LoadingState label="Loading calendar…" />
      ) : calendar.events.length === 0 ? (
        <EmptyState
          title="Nothing scheduled"
          description="No meetings, milestones or report due dates fall in this week for the current filters."
          icon={CalendarDays}
        />
      ) : (
        <ol className="dash-cal-week">
          {days.map((day) => {
            const iso = isoDate(day);
            const items = calendar.events.filter((event) => event.date === iso);
            if (!items.length) return null;
            return (
              <li key={iso} className={iso === today ? "is-today" : undefined}>
                <div className="dash-cal-day">
                  <b>{day.getDate()}</b>
                  <span>{day.toLocaleDateString(undefined, { weekday: "short" })}</span>
                </div>
                <div className="dash-cal-items">
                  {items.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      className={`dash-cal-item cal-chip-${EVENT_TYPE_META[event.type].tone}`}
                      onClick={() => setSelected(event)}
                    >
                      <b>{event.title}</b>
                      <span>
                        {timeRangeLabel(event)} · {event.projectName}
                      </span>
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {selected && (
        <div className="dash-drawer-host">
          <EventDrawer
            event={selected}
            projects={calendar.projects}
            departments={calendar.departments}
            contacts={calendar.contacts}
            canManage={canManage}
            onClose={() => setSelected(null)}
            onChanged={calendar.reload}
          />
        </div>
      )}
    </section>
  );
}

function rangeLabel(from: string, to: string): string {
  const fmt = (value: string) =>
    new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${fmt(from)} – ${fmt(to)}`;
}

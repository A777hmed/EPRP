"use client";

/**
 * The Dashboard's Project Schedule panel.
 *
 * A COMPACT VIEW OF THE SAME DATA, not a second calendar. It calls the same
 * `useCalendar` hook the workspace does — over the visible month grid rather
 * than a single week — so an event shown here and the same event in the
 * workspace cannot disagree.
 *
 * Selecting an entry opens the same drawer component the workspace uses, which
 * is why a derived milestone stays read-only here too.
 *
 * The panel is sized by its CONTENT. It used to stretch to whichever column in
 * its row happened to be tallest, which left a band of empty white under the
 * legend; the row is top-aligned instead.
 */

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { EVENT_TYPE_META, timeRangeLabel, type CalendarEvent } from "./calendar-types";
import { EventDrawer } from "./event-editor";
import {
  addDays,
  isoDate,
  startOfWeek,
  useCalendar,
  type CalendarFilters,
} from "./use-calendar";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
  const [monthAnchor, setMonthAnchor] = React.useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = React.useState(() => isoDate(new Date()));
  const [selectedEvent, setSelectedEvent] = React.useState<CalendarEvent | null>(null);

  /* The query window is the visible grid, so trailing days of the neighbouring
     months carry their real indicators instead of reading as empty. */
  const days = React.useMemo(() => monthGrid(monthAnchor), [monthAnchor]);
  const window = React.useMemo(
    () => ({ from: isoDate(days[0]), to: isoDate(days[days.length - 1]) }),
    [days]
  );
  const filters = React.useMemo<CalendarFilters>(
    () => ({ projectId, departmentId, types: [] }),
    [projectId, departmentId]
  );

  const calendar = useCalendar(window, filters);
  const today = isoDate(new Date());

  const byDate = React.useMemo(() => {
    const grouped = new Map<string, CalendarEvent[]>();
    for (const event of calendar.events) {
      const list = grouped.get(event.date) ?? [];
      list.push(event);
      grouped.set(event.date, list);
    }
    return grouped;
  }, [calendar.events]);

  /* The key lists the types actually present in the visible month — a fixed
     legend would advertise categories the scope contains nothing of. */
  const legend = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const event of calendar.events) {
      const meta = EVENT_TYPE_META[event.type];
      if (!seen.has(meta.tone)) seen.set(meta.tone, meta.label);
    }
    return [...seen.entries()].map(([tone, label]) => ({ tone, label }));
  }, [calendar.events]);

  const selected = byDate.get(selectedDate) ?? [];

  const moveMonth = (offset: number) => {
    const next = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + offset, 1);
    setMonthAnchor(next);
    setSelectedDate(isoDate(next));
  };
  const goToToday = () => {
    const now = new Date();
    setMonthAnchor(startOfMonth(now));
    setSelectedDate(isoDate(now));
  };

  return (
    <section className="dash-panel dash-schedule">
      <header>
        <div>
          <b>Project Schedule</b>
          <small>Meetings, milestones and report due dates in scope</small>
        </div>
        <Link href="/calendar" className="dash-link">
          Open Calendar
        </Link>
      </header>

      <div className="dash-panel-body">
        <div className="dash-cal-bar">
          <button type="button" onClick={() => moveMonth(-1)} aria-label="Previous month">
            <ChevronLeft aria-hidden />
          </button>
          <b>{monthAnchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</b>
          <button type="button" onClick={() => moveMonth(1)} aria-label="Next month">
            <ChevronRight aria-hidden />
          </button>
          <button type="button" className="dash-cal-today" onClick={goToToday}>
            Today
          </button>
        </div>

        {calendar.loading ? (
          <div className="dash-cal-loading" aria-busy="true">
            {Array.from({ length: 42 }, (_, index) => (
              <Skeleton key={index} className="h-8 rounded-md" />
            ))}
          </div>
        ) : (
          <>
            <div className="dash-cal-weekdays" aria-hidden>
              {WEEKDAYS.map((weekday) => (
                <span key={weekday}>{weekday}</span>
              ))}
            </div>
            <div className="dash-cal-grid">
              {days.map((day) => {
                const iso = isoDate(day);
                const events = byDate.get(iso) ?? [];
                const outside = day.getMonth() !== monthAnchor.getMonth();
                return (
                  <button
                    key={iso}
                    type="button"
                    className={[
                      "dash-cal-cell",
                      outside ? "is-outside" : "",
                      iso === today ? "is-today" : "",
                      iso === selectedDate ? "is-selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-pressed={iso === selectedDate}
                    aria-label={`${day.toLocaleDateString(undefined, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })} — ${events.length} scheduled`}
                    onClick={() => setSelectedDate(iso)}
                  >
                    <span className="dash-cal-date">{day.getDate()}</span>
                    <span className="dash-cal-marks" aria-hidden>
                      {events.slice(0, 3).map((event) => (
                        <i key={event.id} className={`cal-chip-${EVENT_TYPE_META[event.type].tone}`} />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Selected-day detail appears only when the day holds something, so
                a quiet day costs no vertical space. */}
            {selected.length > 0 && (
              <ul className="dash-cal-agenda">
                {selected.slice(0, 2).map((event) => (
                  <li key={event.id}>
                    <button
                      type="button"
                      className={`cal-chip-${EVENT_TYPE_META[event.type].tone}`}
                      onClick={() => setSelectedEvent(event)}
                    >
                      <i aria-hidden />
                      <span>
                        <b>{event.title}</b>
                        <small>
                          {timeRangeLabel(event)} · {event.projectName}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
                {selected.length > 2 && (
                  <li className="dash-cal-more">
                    <Link href="/calendar">+{selected.length - 2} more on this day</Link>
                  </li>
                )}
              </ul>
            )}

            <div className="dash-cal-key">
              {legend.length ? (
                legend.map((entry) => (
                  <span key={entry.tone} className={`cal-chip-${entry.tone}`}>
                    <i aria-hidden />
                    {entry.label}
                  </span>
                ))
              ) : (
                <span className="dash-cal-key-empty">
                  Nothing scheduled this month for the current filters.
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {selectedEvent && (
        <div className="dash-drawer-host">
          <EventDrawer
            event={selectedEvent}
            projects={calendar.projects}
            departments={calendar.departments}
            contacts={calendar.contacts}
            canManage={canManage}
            onClose={() => setSelectedEvent(null)}
            onChanged={calendar.reload}
          />
        </div>
      )}
    </section>
  );
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Six fixed weeks, so the panel height does not jump between months. */
function monthGrid(month: Date): Date[] {
  const gridStart = startOfWeek(startOfMonth(month));
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

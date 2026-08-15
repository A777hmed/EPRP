"use client";

/**
 * The full Calendar workspace — `/calendar`.
 *
 * Four views over ONE event source (`useCalendar`), so the Dashboard preview
 * and this page can never show different calendars. Stored events are editable
 * in place; derived milestones and report due dates render alongside them and
 * link back to the record that owns them.
 *
 * Day and Week lay events on an hour grid; Month is a date grid; Agenda is a
 * chronological list. Timed events are positioned by their start hour, and
 * all-day entries (milestones, report due dates, meetings with no time) sit in
 * a band above the grid rather than being pinned to an arbitrary hour.
 */

import * as React from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/shared";
import { CalendarDays } from "lucide-react";
import {
  EVENT_TYPE_META,
  EVENT_TYPE_ORDER,
  timeRangeLabel,
  type CalendarEvent,
  type CalendarEventType,
} from "./calendar-types";
import { EventDrawer } from "./event-editor";
import {
  EMPTY_CALENDAR_FILTERS,
  addDays,
  isoDate,
  startOfWeek,
  useCalendar,
  windowFor,
  type CalendarFilters,
} from "./use-calendar";

type View = "day" | "week" | "month" | "agenda";

const VIEWS: View[] = ["day", "week", "month", "agenda"];
const VIEW_LABEL: Record<View, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  agenda: "Agenda",
};

/** 7am–7pm covers the working day without a scroll for the common case. */
const HOURS = Array.from({ length: 13 }, (_, i) => i + 7);

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface CalendarWorkspaceProps {
  /** Write access; mirrors the project-manage predicate used by RLS. */
  canManage: boolean;
}

export function CalendarWorkspace({ canManage }: CalendarWorkspaceProps) {
  const [view, setView] = React.useState<View>("week");
  const [anchor, setAnchor] = React.useState<Date>(() => new Date());
  const [filters, setFilters] = React.useState<CalendarFilters>(EMPTY_CALENDAR_FILTERS);
  const [selected, setSelected] = React.useState<CalendarEvent | null>(null);
  const [creatingOn, setCreatingOn] = React.useState<string | undefined>();
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const window = React.useMemo(() => windowFor(view, anchor), [view, anchor]);
  const calendar = useCalendar(window, filters);

  const step = (direction: 1 | -1) => {
    const days = view === "day" ? 1 : view === "week" ? 7 : view === "agenda" ? 30 : 0;
    if (days) {
      setAnchor((current) => addDays(current, days * direction));
      return;
    }
    setAnchor((current) => new Date(current.getFullYear(), current.getMonth() + direction, 1));
  };

  const openEvent = (event: CalendarEvent) => {
    setSelected(event);
    setCreatingOn(undefined);
    setDrawerOpen(true);
  };

  const openCreate = (date?: string) => {
    setSelected(null);
    setCreatingOn(date ?? isoDate(anchor));
    setDrawerOpen(true);
  };

  const toggleType = (type: CalendarEventType) =>
    setFilters((current) => ({
      ...current,
      types: current.types.includes(type)
        ? current.types.filter((t) => t !== type)
        : [...current.types, type],
    }));

  return (
    <div className="cal-stage">
      <header className="cal-header">
        <div className="cal-header-title">
          <p className="monthly-eyebrow">Tools &amp; Analytics</p>
          <h1>Calendar</h1>
          <span>Meetings, MOM/KOM, milestones and report due dates across your projects.</span>
        </div>

        <div className="cal-header-actions">
          <div className="cal-view-switch" role="tablist" aria-label="Calendar view">
            {VIEWS.map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={view === value}
                className={view === value ? "is-active" : undefined}
                onClick={() => setView(value)}
              >
                {VIEW_LABEL[value]}
              </button>
            ))}
          </div>
          {canManage && (
            <Button onClick={() => openCreate()}>
              <Plus aria-hidden /> Add Event
            </Button>
          )}
        </div>
      </header>

      <div className="cal-toolbar">
        <div className="cal-nav">
          <Button size="sm" variant="outline" onClick={() => setAnchor(new Date())}>
            Today
          </Button>
          <button type="button" onClick={() => step(-1)} aria-label="Previous period">
            <ChevronLeft aria-hidden />
          </button>
          <button type="button" onClick={() => step(1)} aria-label="Next period">
            <ChevronRight aria-hidden />
          </button>
          <b className="cal-range">{rangeLabel(view, anchor, window.from, window.to)}</b>
        </div>

        <div className="cal-filters">
          <label>
            <span>Project</span>
            <select
              value={filters.projectId}
              onChange={(e) => setFilters({ ...filters, projectId: e.target.value })}
            >
              <option value="">All Projects</option>
              {calendar.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Department</span>
            <select
              value={filters.departmentId}
              onChange={(e) => setFilters({ ...filters, departmentId: e.target.value })}
            >
              <option value="">All Departments</option>
              {calendar.departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="cal-chips" role="group" aria-label="Filter by event type">
        <button
          type="button"
          className={filters.types.length === 0 ? "is-active" : undefined}
          onClick={() => setFilters({ ...filters, types: [] })}
        >
          All
        </button>
        {EVENT_TYPE_ORDER.map((type) => (
          <button
            key={type}
            type="button"
            className={`cal-chip-filter cal-chip-${EVENT_TYPE_META[type].tone}${
              filters.types.includes(type) ? " is-active" : ""
            }`}
            onClick={() => toggleType(type)}
          >
            {EVENT_TYPE_META[type].short}
          </button>
        ))}
      </div>

      <div className={drawerOpen ? "cal-body has-drawer" : "cal-body"}>
        <div className="cal-surface">
          {calendar.loading ? (
            <LoadingState label="Loading calendar…" />
          ) : calendar.error ? (
            <EmptyState title="Calendar unavailable" description={calendar.error} icon={CalendarDays} />
          ) : view === "month" ? (
            <MonthGrid
              anchor={anchor}
              from={window.from}
              events={calendar.events}
              onOpen={openEvent}
              onCreate={canManage ? openCreate : undefined}
            />
          ) : view === "agenda" ? (
            <AgendaList events={calendar.events} onOpen={openEvent} />
          ) : (
            <TimeGrid
              days={view === "day" ? [anchor] : weekDays(anchor)}
              events={calendar.events}
              onOpen={openEvent}
              onCreate={canManage ? openCreate : undefined}
            />
          )}
        </div>

        {drawerOpen && (
          <EventDrawer
            event={selected}
            createOn={creatingOn}
            projects={calendar.projects}
            departments={calendar.departments}
            contacts={calendar.contacts}
            canManage={canManage}
            onClose={() => setDrawerOpen(false)}
            onChanged={calendar.reload}
          />
        )}
      </div>
    </div>
  );
}

/* --------------------------------- Labels ---------------------------------- */

function rangeLabel(view: View, anchor: Date, from: string, to: string): string {
  const fmt = (value: string) =>
    new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (view === "day") {
    return anchor.toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  if (view === "month") {
    return anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  return `${fmt(from)} – ${fmt(to)}, ${new Date(`${to}T00:00:00`).getFullYear()}`;
}

function weekDays(anchor: Date): Date[] {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/* -------------------------------- Time grid -------------------------------- */

function TimeGrid({
  days,
  events,
  onOpen,
  onCreate,
}: {
  days: Date[];
  events: CalendarEvent[];
  onOpen: (event: CalendarEvent) => void;
  onCreate?: (date: string) => void;
}) {
  const today = isoDate(new Date());

  return (
    <div className="cal-timegrid" style={{ "--cal-days": days.length } as React.CSSProperties}>
      <div className="cal-timegrid-head">
        <span className="cal-gutter" aria-hidden />
        {days.map((day) => {
          const iso = isoDate(day);
          return (
            <div key={iso} className={iso === today ? "cal-dayhead is-today" : "cal-dayhead"}>
              <span>{DAY_NAMES[day.getDay()]}</span>
              <b>{day.getDate()}</b>
            </div>
          );
        })}
      </div>

      {/* All-day band: milestones, report due dates, untimed meetings. */}
      <div className="cal-allday">
        <span className="cal-gutter">All day</span>
        {days.map((day) => {
          const iso = isoDate(day);
          const items = events.filter((e) => e.date === iso && !e.startTime);
          return (
            <div key={iso} className="cal-allday-cell">
              {items.map((event) => (
                <EventPill key={event.id} event={event} onOpen={onOpen} compact />
              ))}
            </div>
          );
        })}
      </div>

      <div className="cal-timegrid-body">
        <div className="cal-hours">
          {HOURS.map((hour) => (
            <div key={hour} className="cal-hour-label">
              {String(hour).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        {days.map((day) => {
          const iso = isoDate(day);
          return (
            <div key={iso} className="cal-daycol">
              {HOURS.map((hour) => {
                const slot = events.filter((event) => {
                  if (event.date !== iso || !event.startTime) return false;
                  return Number(event.startTime.slice(0, 2)) === hour;
                });
                return (
                  <div
                    key={hour}
                    className="cal-slot"
                    onDoubleClick={onCreate ? () => onCreate(iso) : undefined}
                  >
                    {slot.map((event) => (
                      <EventPill key={event.id} event={event} onOpen={onOpen} />
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------- Month grid ------------------------------- */

function MonthGrid({
  anchor,
  from,
  events,
  onOpen,
  onCreate,
}: {
  anchor: Date;
  from: string;
  events: CalendarEvent[];
  onOpen: (event: CalendarEvent) => void;
  onCreate?: (date: string) => void;
}) {
  const today = isoDate(new Date());
  const start = new Date(`${from}T00:00:00`);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const month = anchor.getMonth();

  return (
    <div className="cal-monthgrid">
      <div className="cal-monthhead">
        {DAY_NAMES.map((name) => (
          <span key={name}>{name}</span>
        ))}
      </div>
      <div className="cal-monthbody">
        {cells.map((day) => {
          const iso = isoDate(day);
          const items = events.filter((event) => event.date === iso);
          const outside = day.getMonth() !== month;
          return (
            <div
              key={iso}
              className={`cal-monthcell${outside ? " is-outside" : ""}${iso === today ? " is-today" : ""}`}
              onDoubleClick={onCreate ? () => onCreate(iso) : undefined}
            >
              <b>{day.getDate()}</b>
              <div className="cal-monthcell-events">
                {/* Three fit before the cell scrolls; the rest are counted so
                    nothing is silently hidden. */}
                {items.slice(0, 3).map((event) => (
                  <EventPill key={event.id} event={event} onOpen={onOpen} compact />
                ))}
                {items.length > 3 && <span className="cal-more">+{items.length - 3} more</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------- Agenda --------------------------------- */

function AgendaList({
  events,
  onOpen,
}: {
  events: CalendarEvent[];
  onOpen: (event: CalendarEvent) => void;
}) {
  if (!events.length) {
    return (
      <EmptyState
        title="Nothing scheduled"
        description="No meetings, milestones or report due dates fall in this period for the current filters."
        icon={CalendarDays}
      />
    );
  }

  const byDate = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const list = byDate.get(event.date) ?? [];
    list.push(event);
    byDate.set(event.date, list);
  }

  return (
    <ul className="cal-agenda">
      {[...byDate.entries()].map(([date, items]) => (
        <li key={date}>
          <div className="cal-agenda-date">
            <b>{new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</b>
            <span>{new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long" })}</span>
          </div>
          <div className="cal-agenda-items">
            {items.map((event) => (
              <button key={event.id} type="button" className="cal-agenda-item" onClick={() => onOpen(event)}>
                <span className={`cal-dot cal-chip-${EVENT_TYPE_META[event.type].tone}`} aria-hidden />
                <b>{event.title}</b>
                <em>{timeRangeLabel(event)}</em>
                <i>{event.projectName}</i>
              </button>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------- Pill ----------------------------------- */

export function EventPill({
  event,
  onOpen,
  compact,
}: {
  event: CalendarEvent;
  onOpen: (event: CalendarEvent) => void;
  compact?: boolean;
}) {
  const meta = EVENT_TYPE_META[event.type];
  return (
    <button
      type="button"
      className={`cal-event cal-chip-${meta.tone}${compact ? " is-compact" : ""}`}
      onClick={() => onOpen(event)}
      title={`${meta.label} · ${event.title} · ${event.projectName}`}
    >
      <b>{event.title}</b>
      {!compact && <span>{timeRangeLabel(event)}</span>}
    </button>
  );
}

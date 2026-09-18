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
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/shared";
import { DetailModal } from "@/components/shared/detail-modal";
import { SearchInput } from "@/components/shared/search-input";
import { CalendarDays } from "lucide-react";
import {
  EVENT_TYPE_META,
  EVENT_STATUS_LABEL,
  EVENT_TYPE_ORDER,
  timeRangeLabel,
  type CalendarEvent,
  type CalendarEventType,
} from "./calendar-types";
import { EventDrawerDialog } from "./event-editor";
import {
  EMPTY_CALENDAR_FILTERS,
  addDays,
  isoDate,
  startOfWeek,
  useCalendar,
  windowFor,
  type CalendarFilters,
  type UseCalendarResult,
} from "./use-calendar";

type View = "day" | "week" | "month" | "agenda";

const VIEWS: View[] = ["day", "week", "month", "agenda"];
const VIEW_LABEL: Record<View, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  agenda: "Agenda",
};

/** Normal working window; TimeGrid expands only when its current events need it. */
const DEFAULT_START_HOUR = 7;
const DEFAULT_END_HOUR = 19;
const OUTLIER_PADDING_HOURS = 1;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface CalendarWorkspaceProps {
  /** Write access; mirrors the project-manage predicate used by RLS. */
  canManage: boolean;
}

export function CalendarWorkspace({ canManage }: CalendarWorkspaceProps) {
  return <React.Suspense fallback={<LoadingState label="Loading calendar…" />}>
    <CalendarQueryWorkspace canManage={canManage} />
  </React.Suspense>;
}

function CalendarQueryWorkspace({ canManage }: CalendarWorkspaceProps) {
  const params = useSearchParams();
  const value = params.get("date") ?? "";
  const parsed = new Date(`${value}T00:00:00`);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parsed.getTime()) && isoDate(parsed) === value ? value : undefined;
  return <CalendarWorkspaceContent key={params.toString()} canManage={canManage} initialDate={date}
    initialProject={params.get("projectId") ?? ""} initialDepartment={params.get("departmentId") ?? ""} />;
}

function CalendarWorkspaceContent({ canManage, initialDate, initialProject, initialDepartment }: CalendarWorkspaceProps & {
  initialDate?: string; initialProject: string; initialDepartment: string;
}) {
  const [view, setView] = React.useState<View>("month");
  const [anchor, setAnchor] = React.useState<Date>(() => initialDate ? new Date(`${initialDate}T00:00:00`) : new Date());
  const [filters, setFilters] = React.useState<CalendarFilters>({ ...EMPTY_CALENDAR_FILTERS, projectId: initialProject, departmentId: initialDepartment });
  const [query, setQuery] = React.useState("");
  const [detailDate, setDetailDate] = React.useState<string | null>(initialDate ?? null);
  const [selected, setSelected] = React.useState<CalendarEvent | null>(null);
  const [creatingOn, setCreatingOn] = React.useState<string | undefined>();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const viewTabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const window = React.useMemo(() => windowFor(view, anchor), [view, anchor]);
  const calendar = useCalendar(window, filters);
  const events = React.useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    return calendar.events.filter((event) => !text || [event.title, event.description, event.projectName,
      event.departmentName, event.location, event.organizerName, event.sourceLabel,
      EVENT_TYPE_META[event.type].label, EVENT_STATUS_LABEL[event.status],
      ...event.attendees.map((person) => person.displayName)].filter(Boolean).join(" ").toLocaleLowerCase().includes(text));
  }, [calendar.events, query]);

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
    setDetailDate(null);
    setCreatingOn(undefined);
    setDrawerOpen(true);
  };

  const openDate = (date: string) => {
    setSelected(null);
    setDrawerOpen(false);
    setDetailDate(date);
  };

  const openCreate = (date?: string) => {
    setSelected(null);
    setDetailDate(null);
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

  const moveViewTab = (currentIndex: number, direction: 1 | -1) => {
    const nextIndex = (currentIndex + direction + VIEWS.length) % VIEWS.length;
    setView(VIEWS[nextIndex]);
    viewTabRefs.current[nextIndex]?.focus();
  };

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
            {VIEWS.map((value, index) => (
              <button
                key={value}
                ref={(node) => { viewTabRefs.current[index] = node; }}
                type="button"
                role="tab"
                id={`calendar-view-tab-${value}`}
                aria-controls={`calendar-view-panel-${value}`}
                aria-selected={view === value}
                tabIndex={view === value ? 0 : -1}
                className={view === value ? "is-active" : undefined}
                onClick={() => setView(value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    moveViewTab(index, -1);
                  } else if (event.key === "ArrowRight") {
                    event.preventDefault();
                    moveViewTab(index, 1);
                  }
                }}
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
          <SearchInput value={query} onValueChange={setQuery} placeholder="Search this period…" />
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

      <div className="cal-body">
        {VIEWS.map((panelView) => (
          <div
            key={panelView}
            className="cal-surface"
            role="tabpanel"
            id={`calendar-view-panel-${panelView}`}
            aria-labelledby={`calendar-view-tab-${panelView}`}
            hidden={view !== panelView}
            tabIndex={0}
          >
            {view === panelView && (calendar.loading ? (
              <LoadingState label="Loading calendar…" />
            ) : calendar.error ? (
              <EmptyState title="Calendar unavailable" description={calendar.error} icon={CalendarDays} />
            ) : panelView === "month" ? (
              <MonthGrid
                anchor={anchor}
                from={window.from}
                events={events}
                onOpen={openEvent}
                onDate={openDate}
              />
            ) : panelView === "agenda" ? (
              <AgendaList events={events} onOpen={openEvent} />
            ) : (
              <TimeGrid
                days={panelView === "day" ? [anchor] : weekDays(anchor)}
                events={events}
                onOpen={openEvent}
                onCreate={canManage ? openCreate : undefined}
              />
            ))}
          </div>
        ))}

        {drawerOpen && (
          <EventDrawerDialog
            event={selected ? calendar.all.find((event) => event.id === selected.id) ?? selected : null}
            createOn={creatingOn}
            projects={calendar.projects}
            departments={calendar.departments}
            contacts={calendar.contacts}
            canManage={canManage}
            onClose={() => { setDrawerOpen(false); setSelected(null); }}
            onChanged={calendar.reload}
          />
        )}
      </div>
      <CalendarDetailModal date={detailDate} event={drawerOpen ? null : selected} events={events} calendar={calendar} canManage={canManage}
        onSelect={setSelected} onClose={() => { setDetailDate(null); setSelected(null); }}
        onCreate={canManage ? openCreate : undefined} />
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
  const hours = React.useMemo(() => hoursForTimeGrid(days, events), [days, events]);

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
          {hours.map((hour) => (
            <div key={hour} className="cal-hour-label">
              {String(hour).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        {days.map((day) => {
          const iso = isoDate(day);
          return (
            <div key={iso} className="cal-daycol">
              {hours.map((hour) => {
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
  onDate,
}: {
  anchor: Date;
  from: string;
  events: CalendarEvent[];
  onOpen: (event: CalendarEvent) => void;
  onDate: (date: string) => void;
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
            >
              <button type="button" className="cal-date-button" onClick={() => onDate(iso)}
                aria-label={`${dateLabel(iso)} — ${items.length} events`} aria-current={iso === today ? "date" : undefined}>
                <b>{day.getDate()}</b><span>{items.length > 0 ? items.length : ""}</span>
              </button>
              <div className="cal-monthcell-events">
                {items.slice(0, 3).map((event) => (
                  <StickyEventCard key={event.id} event={event} onOpen={onOpen} />
                ))}
                {items.length > 3 && <button type="button" className="cal-more" onClick={() => onDate(iso)}
                  aria-label={`Show all ${items.length} events on ${dateLabel(iso)}`}>+{items.length - 3} more</button>}
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

export function dateLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

function hoursForTimeGrid(days: Date[], events: CalendarEvent[]): number[] {
  const visibleDates = new Set(days.map(isoDate));
  let earliest = DEFAULT_START_HOUR;
  let latest = DEFAULT_END_HOUR;

  for (const event of events) {
    if (!visibleDates.has(event.date) || !event.startTime) continue;
    const startHour = timeHour(event.startTime);
    if (startHour === undefined) continue;
    const endHour = timeHour(event.endTime) ?? startHour;
    earliest = Math.min(earliest, startHour - OUTLIER_PADDING_HOURS);
    latest = Math.max(latest, endHour + OUTLIER_PADDING_HOURS);
  }

  const from = Math.max(0, earliest);
  const to = Math.min(23, latest);
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

function timeHour(value?: string): number | undefined {
  if (!value) return undefined;
  const hour = Number(value.slice(0, 2));
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : undefined;
}

export function eventNoteTypeClass(type: CalendarEventType): string {
  return `cal-note-type cal-note-type-${type.replace("_", "-")}`;
}

/** Presentation only: every source supplies the existing CalendarEvent contract. */
export function StickyEventCard({ event, onOpen, compact = false }: {
  event: CalendarEvent;
  onOpen: (event: CalendarEvent) => void;
  compact?: boolean;
}) {
  const meta = EVENT_TYPE_META[event.type];
  const title = event.title?.trim() || "Untitled event";
  const project = event.projectName?.trim() || "Project not recorded";
  const status = EVENT_STATUS_LABEL[event.status];
  const timing = timeRangeLabel(event);
  const metadata = compact ? [timing, meta.short] : [timing, project];
  return <button type="button" className={`cal-note ${eventNoteTypeClass(event.type)}${compact ? " is-compact" : ""}`}
    onClick={() => onOpen(event)} aria-label={`Open ${title}, ${meta.label}, ${timing}, ${project}`}
    title={`${title} · ${project} · ${meta.label} · ${timing} · ${status}`}>
    <strong>{title}</strong>
    <span className="cal-note-meta">{metadata.join(" · ")}</span>
    {!compact && <span className="cal-note-source">{event.origin === "derived" ?
      `${event.sourceLabel || "Linked source"} · Read only` : `${meta.label} · ${status}`}</span>}
  </button>;
}

/** Shared date/list/detail navigation; editing is still owned by EventDrawer. */
export function CalendarDetailModal({ date, event, events, calendar, canManage, onSelect, onClose, onCreate }: {
  date: string | null; event: CalendarEvent | null; events: CalendarEvent[];
  calendar: UseCalendarResult; canManage: boolean;
  onSelect: (event: CalendarEvent | null) => void; onClose: () => void; onCreate?: (date: string) => void;
}) {
  const items = events.filter((item) => item.date === date);
  // Resolve against refreshed data after edits; preserve selection while a reload is pending.
  const current = event ? calendar.all.find((item) => item.id === event.id) ?? event : null;
  const closeDetail = date ? () => onSelect(null) : onClose;

  return <>
    <DetailModal open={Boolean(date)} onOpenChange={(open) => { if (!open) onClose(); }}
      title={date ? dateLabel(date) : "Events"}
      description={`${items.length} events in the current filters`}
      toolbar={date && onCreate ? <Button size="sm" onClick={() => onCreate(date)}><Plus aria-hidden /> Add Event</Button> : undefined}>
      <div className="cal-date-modal-body">
        {calendar.loading ? <LoadingState label="Loading events…" /> : calendar.error ?
          <EmptyState title="Calendar unavailable" description={calendar.error} icon={CalendarDays} /> :
          items.length ? <div className="cal-date-list">{items.map((item) =>
            <StickyEventCard key={item.id} event={item} onOpen={onSelect} />)}</div> :
            <EmptyState title="Nothing scheduled" description="No events for this date match the current filters." icon={CalendarDays} />}
      </div>
    </DetailModal>
    {current && <EventDrawerDialog key={current.id} event={current} projects={calendar.projects}
      departments={calendar.departments} contacts={calendar.contacts} canManage={canManage}
      onChanged={calendar.reload} onClose={closeDetail} />}
  </>;
}

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

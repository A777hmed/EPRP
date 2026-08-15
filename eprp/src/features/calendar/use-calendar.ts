"use client";

/**
 * One calendar source for the whole platform.
 *
 * The Dashboard preview and the full workspace both call this hook, so a
 * meeting shown on the Dashboard and the same meeting in the workspace cannot
 * disagree — there is no second calendar implementation to drift.
 *
 * It returns STORED events (editable) and DERIVED ones (milestones, report due
 * dates — read-only) already merged, resolved against master data and sorted.
 * The window is a date range, so a caller renders a week or a month by asking
 * for one, not by fetching everything and slicing.
 */

import * as React from "react";

import { useMasterData } from "@/features/master-data";
import { projectService } from "@/services/project-service";
import type { Contact, Department, Project } from "@/types";
import {
  byWhen,
  isoDate,
  type CalendarEvent,
  type CalendarEventType,
} from "./calendar-types";
import { loadDerivedEvents } from "./derived-events";
import { eventService, type StoredEventRow } from "./event-service";

export interface CalendarFilters {
  projectId: string;
  departmentId: string;
  /** Empty means every type. */
  types: CalendarEventType[];
}

export const EMPTY_CALENDAR_FILTERS: CalendarFilters = {
  projectId: "",
  departmentId: "",
  types: [],
};

export interface CalendarWindow {
  from: string;
  to: string;
}

export interface UseCalendarResult {
  loading: boolean;
  error?: string;
  /** Everything in the window, before filters. */
  all: CalendarEvent[];
  /** After project / department / type filters. */
  events: CalendarEvent[];
  projects: Project[];
  departments: Department[];
  contacts: Contact[];
  reload: () => Promise<void>;
}

export function useCalendar(
  window: CalendarWindow,
  filters: CalendarFilters
): UseCalendarResult {
  const { records: departmentRecords } = useMasterData("department");
  const { records: contactRecords } = useMasterData("contact");
  const departments = departmentRecords as Department[];
  const contacts = contactRecords as Contact[];

  const [projects, setProjects] = React.useState<Project[]>([]);
  const [stored, setStored] = React.useState<StoredEventRow[]>([]);
  const [derived, setDerived] = React.useState<CalendarEvent[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string>();

  const { from, to } = window;

  /*
   * Reload is a token bump rather than a callable loader.
   *
   * The fetch lives INSIDE the effect with a `cancelled` guard — the same shape
   * `use-executive-portfolio` uses — so a window change that lands mid-flight
   * cannot have the earlier response overwrite the later one.
   */
  const [reloadToken, setReloadToken] = React.useState(0);
  const reload = React.useCallback(async () => {
    setReloadToken((token) => token + 1);
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(undefined);
      try {
        const projectList = await projectService.getProjects();
        if (cancelled) return;
        setProjects(projectList);

        const [storedRows, derivedRows] = await Promise.all([
          eventService.listBetween(from, to),
          loadDerivedEvents(from, to, {
            projectName: (id) => projectList.find((p) => p.id === id)?.name ?? "Project",
            // Department names are resolved in the memo below, alongside the
            // stored events, so master data settling does not refetch the window.
            departmentName: () => undefined,
          }),
        ]);
        if (cancelled) return;

        setStored(storedRows);
        setDerived(derivedRows);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load the calendar.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [from, to, reloadToken]);

  const all = React.useMemo(() => {
    const resolved: CalendarEvent[] = stored.map((row) => ({
      id: row.id,
      origin: "stored",
      projectId: row.projectId,
      projectName: projects.find((p) => p.id === row.projectId)?.name ?? "Project",
      departmentId: row.departmentId,
      departmentName: departments.find((d) => d.id === row.departmentId)?.name,
      type: row.type,
      title: row.title,
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
      location: row.location,
      organizerContactId: row.organizerContactId,
      organizerName: contacts.find((c) => c.id === row.organizerContactId)?.name,
      status: row.status,
      description: row.description,
      attendees: row.attendees,
    }));

    // Derived entries get their department name here too, so both origins are
    // resolved against the same master data at the same moment.
    const named = derived.map((event) => ({
      ...event,
      departmentName:
        event.departmentName ?? departments.find((d) => d.id === event.departmentId)?.name,
    }));

    return [...resolved, ...named].sort(byWhen);
  }, [stored, derived, projects, departments, contacts]);

  const events = React.useMemo(
    () =>
      all.filter((event) => {
        if (filters.projectId && event.projectId !== filters.projectId) return false;
        if (filters.departmentId && event.departmentId !== filters.departmentId) return false;
        if (filters.types.length && !filters.types.includes(event.type)) return false;
        return true;
      }),
    [all, filters]
  );

  return { loading, error, all, events, projects, departments, contacts, reload };
}

/* ------------------------------ Window helpers ----------------------------- */

// Re-exported so callers need only this module; the implementation is local-time
// correct and lives with the calendar vocabulary.
export { isoDate, todayIso } from "./calendar-types";

export function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

/** Sunday-first, matching the reference calendar. */
export function startOfWeek(value: Date): Date {
  return addDays(value, -value.getDay());
}

export function startOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

export function endOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth() + 1, 0);
}

/**
 * The window a view needs.
 *
 * Month view is padded to whole weeks because the grid always shows the
 * trailing days of the previous month and the leading days of the next.
 */
export function windowFor(view: "day" | "week" | "month" | "agenda", anchor: Date): CalendarWindow {
  if (view === "day") return { from: isoDate(anchor), to: isoDate(anchor) };
  if (view === "week") {
    const start = startOfWeek(anchor);
    return { from: isoDate(start), to: isoDate(addDays(start, 6)) };
  }
  if (view === "agenda") {
    return { from: isoDate(anchor), to: isoDate(addDays(anchor, 30)) };
  }
  const gridStart = startOfWeek(startOfMonth(anchor));
  const gridEnd = addDays(startOfWeek(endOfMonth(anchor)), 6);
  return { from: isoDate(gridStart), to: isoDate(gridEnd) };
}

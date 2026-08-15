/**
 * The calendar's single event vocabulary.
 *
 * ONE type serves the Dashboard preview and the full workspace, and it covers
 * two very different origins:
 *
 *   STORED  — rows in `project_events`. Meetings, MOM, KOM, workshops,
 *             reminders. Editable, because the platform owns them.
 *   DERIVED — milestones from Weekly/Monthly plan items, and Weekly/Monthly
 *             report period ends. NOT editable and NOT copied into the event
 *             table: they already have an owner elsewhere, and duplicating them
 *             would create a second source of truth that drifts the moment a
 *             plan item is edited.
 *
 * `origin` is what tells the UI which is which, so a derived entry can never be
 * offered an Edit button that would write to the wrong record.
 */

import type { IsoDate } from "@/types";

export type CalendarEventType =
  | "mom"
  | "kom"
  | "meeting"
  | "client_meeting"
  | "workshop"
  | "milestone"
  | "reminder"
  | "report_due";

export type CalendarEventStatus = "scheduled" | "completed" | "cancelled" | "postponed";

export type AttendeeResponse = "invited" | "accepted" | "declined" | "tentative";

export interface CalendarAttendee {
  id: string;
  /** Set when the attendee is a platform contact; absent for external people. */
  contactId?: string;
  /** Snapshotted at invite time so a past attendee list stays stable. */
  displayName: string;
  organization?: string;
  response: AttendeeResponse;
}

export interface CalendarEvent {
  id: string;
  origin: "stored" | "derived";
  projectId: string;
  projectName: string;
  departmentId?: string;
  departmentName?: string;
  type: CalendarEventType;
  title: string;
  date: IsoDate;
  startTime?: string;
  endTime?: string;
  location?: string;
  organizerContactId?: string;
  organizerName?: string;
  status: CalendarEventStatus;
  description?: string;
  attendees: CalendarAttendee[];
  /** Where a derived entry came from, so the reader can open the real record. */
  sourceLabel?: string;
  sourceHref?: string;
}

/* ------------------------------- Presentation ------------------------------ */

export interface EventTypeMeta {
  label: string;
  /** Short chip label where horizontal room is scarce. */
  short: string;
  /** Semantic token name, mapped to colour in globals.css. */
  tone: "mom" | "kom" | "meeting" | "milestone" | "reminder" | "due";
}

export const EVENT_TYPE_META: Record<CalendarEventType, EventTypeMeta> = {
  mom: { label: "MOM", short: "MOM", tone: "mom" },
  kom: { label: "KOM", short: "KOM", tone: "kom" },
  meeting: { label: "Meeting", short: "Meeting", tone: "meeting" },
  client_meeting: { label: "Client Meeting", short: "Client", tone: "meeting" },
  workshop: { label: "Workshop", short: "Workshop", tone: "meeting" },
  milestone: { label: "Milestone", short: "Milestone", tone: "milestone" },
  reminder: { label: "Reminder", short: "Reminder", tone: "reminder" },
  report_due: { label: "Report Due", short: "Report Due", tone: "due" },
};

/** Chip order in the filter bar — the two meeting minutes types lead. */
export const EVENT_TYPE_ORDER: CalendarEventType[] = [
  "mom",
  "kom",
  "meeting",
  "client_meeting",
  "workshop",
  "milestone",
  "reminder",
  "report_due",
];

/** Types a user may actually create. Derived kinds are excluded deliberately. */
export const CREATABLE_EVENT_TYPES: CalendarEventType[] = [
  "mom",
  "kom",
  "meeting",
  "client_meeting",
  "workshop",
  "reminder",
];

export const EVENT_STATUS_LABEL: Record<CalendarEventStatus, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
  postponed: "Postponed",
};

/* ------------------------------ Local dates -------------------------------- */

/**
 * A calendar day as `YYYY-MM-DD`, in the READER'S timezone.
 *
 * `toISOString().slice(0, 10)` is wrong here and was a real bug: it converts
 * local midnight to UTC, so anywhere east of Greenwich — Egypt is UTC+2/+3 —
 * every date shifted back a day. Events landed in the wrong cell and "today"
 * highlighted yesterday. A calendar grid is a local-time artefact, so the date
 * is formatted from local components and never round-tripped through UTC.
 */
export function isoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayIso(): string {
  return isoDate(new Date());
}

/* --------------------------------- Sorting --------------------------------- */

/** Chronological, then timed events before all-day ones, then by title. */
export function byWhen(a: CalendarEvent, b: CalendarEvent): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const at = a.startTime ?? "99:99";
  const bt = b.startTime ?? "99:99";
  if (at !== bt) return at < bt ? -1 : 1;
  return a.title.localeCompare(b.title);
}

/** `HH:MM` from a `HH:MM:SS` column value, for display. */
export function shortTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const [h, m] = value.split(":");
  return h && m ? `${h}:${m}` : value;
}

export function timeRangeLabel(event: CalendarEvent): string {
  const start = shortTime(event.startTime);
  const end = shortTime(event.endTime);
  if (start && end) return `${start} – ${end}`;
  if (start) return start;
  return "All day";
}

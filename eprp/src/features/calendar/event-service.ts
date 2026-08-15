/**
 * Calendar event persistence — `project_events` and its attendees, nothing else.
 *
 * This service never touches a project, a Weekly row, a Monthly row or a
 * contact. Events reference those by id, and every reference except the owning
 * project is `ON DELETE SET NULL`, so nothing here can block or cascade into
 * reporting data.
 *
 * Row-level security does the authorization; the client simply asks. A reader
 * without scope on a project sees none of its events because the policy filters
 * them out, not because the UI hid them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  AttendeeResponse,
  CalendarAttendee,
  CalendarEventStatus,
  CalendarEventType,
} from "./calendar-types";

function client(): SupabaseClient {
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

/** Present before the migration is applied on a given environment. */
const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

function isMissingTable(error: { code?: string } | null): boolean {
  return Boolean(error?.code && MISSING_TABLE.has(error.code));
}

export interface StoredEventRow {
  id: string;
  projectId: string;
  departmentId?: string;
  type: CalendarEventType;
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  organizerContactId?: string;
  status: CalendarEventStatus;
  description?: string;
  relatedKind?: string;
  relatedId?: string;
  attendees: CalendarAttendee[];
  updatedByName?: string;
}

interface Row {
  id: string;
  project_id: string;
  department_id: string | null;
  event_type: string;
  title: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  organizer_contact_id: string | null;
  status: string;
  description: string | null;
  related_kind: string | null;
  related_id: string | null;
  updated_by_name: string | null;
  project_event_attendees?: AttendeeRow[] | null;
}

interface AttendeeRow {
  id: string;
  contact_id: string | null;
  display_name: string;
  organization: string | null;
  response: string;
}

function fromRow(row: Row): StoredEventRow {
  return {
    id: row.id,
    projectId: row.project_id,
    departmentId: row.department_id ?? undefined,
    type: row.event_type as CalendarEventType,
    title: row.title,
    date: row.event_date,
    startTime: row.start_time ?? undefined,
    endTime: row.end_time ?? undefined,
    location: row.location ?? undefined,
    organizerContactId: row.organizer_contact_id ?? undefined,
    status: row.status as CalendarEventStatus,
    description: row.description ?? undefined,
    relatedKind: row.related_kind ?? undefined,
    relatedId: row.related_id ?? undefined,
    updatedByName: row.updated_by_name ?? undefined,
    attendees: (row.project_event_attendees ?? []).map((a) => ({
      id: a.id,
      contactId: a.contact_id ?? undefined,
      displayName: a.display_name,
      organization: a.organization ?? undefined,
      response: a.response as AttendeeResponse,
    })),
  };
}

export interface EventInput {
  projectId: string;
  departmentId?: string | null;
  type: CalendarEventType;
  title: string;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  location?: string | null;
  organizerContactId?: string | null;
  status: CalendarEventStatus;
  description?: string | null;
  attendees: { contactId?: string; displayName: string; organization?: string }[];
}

const SELECT = `
  id, project_id, department_id, event_type, title, event_date,
  start_time, end_time, location, organizer_contact_id, status,
  description, related_kind, related_id, updated_by_name,
  project_event_attendees ( id, contact_id, display_name, organization, response )
`;

export const eventService = {
  /**
   * Events within a date range.
   *
   * Bounded by date rather than fetched wholesale: a calendar only ever shows a
   * window, and an estate with years of meetings should not ship all of them to
   * render one week.
   */
  async listBetween(from: string, to: string): Promise<StoredEventRow[]> {
    const { data, error } = await client()
      .from("project_events")
      .select(SELECT)
      .gte("event_date", from)
      .lte("event_date", to)
      .order("event_date", { ascending: true });

    if (error) {
      if (isMissingTable(error)) return [];
      throw new Error(error.message);
    }
    return ((data ?? []) as unknown as Row[]).map(fromRow);
  },

  async create(input: EventInput): Promise<StoredEventRow> {
    const { data, error } = await client()
      .from("project_events")
      .insert({
        project_id: input.projectId,
        department_id: input.departmentId ?? null,
        event_type: input.type,
        title: input.title,
        event_date: input.date,
        start_time: input.startTime ?? null,
        end_time: input.endTime ?? null,
        location: input.location ?? null,
        organizer_contact_id: input.organizerContactId ?? null,
        status: input.status,
        description: input.description ?? null,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    const id = (data as { id: string }).id;
    await replaceAttendees(id, input.attendees);
    return this.getById(id);
  },

  async update(id: string, input: EventInput): Promise<StoredEventRow> {
    const { error } = await client()
      .from("project_events")
      .update({
        project_id: input.projectId,
        department_id: input.departmentId ?? null,
        event_type: input.type,
        title: input.title,
        event_date: input.date,
        start_time: input.startTime ?? null,
        end_time: input.endTime ?? null,
        location: input.location ?? null,
        organizer_contact_id: input.organizerContactId ?? null,
        status: input.status,
        description: input.description ?? null,
      })
      .eq("id", id);

    if (error) throw new Error(error.message);
    await replaceAttendees(id, input.attendees);
    return this.getById(id);
  },

  async getById(id: string): Promise<StoredEventRow> {
    const { data, error } = await client()
      .from("project_events")
      .select(SELECT)
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return fromRow(data as unknown as Row);
  },

  /** Attendees cascade with the event; no separate cleanup is needed. */
  async remove(id: string): Promise<void> {
    const { error } = await client().from("project_events").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },
};

/**
 * Attendees are replaced wholesale rather than diffed.
 *
 * The list is small and always edited as a set, so a delete-then-insert is both
 * simpler and free of the partial-update bugs a diff invites. Responses are not
 * yet collected from attendees, so nothing is lost by rewriting them.
 */
async function replaceAttendees(
  eventId: string,
  attendees: EventInput["attendees"]
): Promise<void> {
  const supabase = client();
  const { error: clearError } = await supabase
    .from("project_event_attendees")
    .delete()
    .eq("event_id", eventId);
  if (clearError) throw new Error(clearError.message);

  const rows = attendees
    .filter((person) => person.displayName.trim())
    .map((person) => ({
      event_id: eventId,
      contact_id: person.contactId ?? null,
      display_name: person.displayName.trim(),
      organization: person.organization?.trim() || null,
    }));

  if (!rows.length) return;
  const { error } = await supabase.from("project_event_attendees").insert(rows);
  if (error) throw new Error(error.message);
}

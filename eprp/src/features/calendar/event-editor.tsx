"use client";

/**
 * Event detail and editing.
 *
 * Two states of one drawer: reading an event, and writing one. They share a
 * shell so the reader never has to hunt for where a field moved to.
 *
 * DERIVED ENTRIES ARE NEVER EDITABLE HERE. A milestone belongs to a Weekly or
 * Monthly plan item and a report due date belongs to a report; both are shown
 * read-only with a link to the record that owns them. Offering an Edit button
 * would either write to the wrong table or silently fork the value.
 */

import * as React from "react";
import Link from "next/link";
import { CalendarDays, Clock, MapPin, Trash2, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared";
import type { Contact, Department, Project } from "@/types";
import {
  CREATABLE_EVENT_TYPES,
  EVENT_STATUS_LABEL,
  EVENT_TYPE_META,
  timeRangeLabel,
  todayIso,
  type CalendarEvent,
  type CalendarEventStatus,
  type CalendarEventType,
} from "./calendar-types";
import { eventService, type EventInput } from "./event-service";

export interface EventEditorProps {
  event: CalendarEvent | null;
  /** Set when creating: the date the user clicked. */
  createOn?: string;
  projects: Project[];
  departments: Department[];
  contacts: Contact[];
  canManage: boolean;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}

interface DraftAttendee {
  contactId?: string;
  displayName: string;
  organization?: string;
}

interface Draft {
  projectId: string;
  departmentId: string;
  type: CalendarEventType;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  organizerContactId: string;
  status: CalendarEventStatus;
  description: string;
  attendees: DraftAttendee[];
}

function draftFrom(event: CalendarEvent | null, createOn: string | undefined, projects: Project[]): Draft {
  return {
    projectId: event?.projectId ?? projects[0]?.id ?? "",
    departmentId: event?.departmentId ?? "",
    type: event?.type && CREATABLE_EVENT_TYPES.includes(event.type) ? event.type : "meeting",
    title: event?.title ?? "",
    date: event?.date ?? createOn ?? todayIso(),
    startTime: event?.startTime?.slice(0, 5) ?? "",
    endTime: event?.endTime?.slice(0, 5) ?? "",
    location: event?.location ?? "",
    organizerContactId: event?.organizerContactId ?? "",
    status: event?.status ?? "scheduled",
    description: event?.description ?? "",
    attendees: (event?.attendees ?? []).map((a) => ({
      contactId: a.contactId,
      displayName: a.displayName,
      organization: a.organization,
    })),
  };
}

export function EventDrawer(props: EventEditorProps) {
  const { event, canManage } = props;
  const creating = !event;
  const derived = event?.origin === "derived";
  const [editing, setEditing] = React.useState(creating);

  if (derived) return <DerivedDetail {...props} event={event} />;
  if (editing) return <EventForm {...props} onDoneEditing={() => setEditing(false)} />;
  if (!event) return null;

  return (
    <DrawerShell title={event.title} onClose={props.onClose}>
      <DetailBody event={event} />
      {canManage && (
        <div className="cal-drawer-actions">
          <Button size="sm" onClick={() => setEditing(true)}>
            Edit Event
          </Button>
          <DeleteButton event={event} onChanged={props.onChanged} onClose={props.onClose} />
        </div>
      )}
    </DrawerShell>
  );
}

/* --------------------------------- Shell ---------------------------------- */

function DrawerShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <aside className="cal-drawer" aria-label="Event details">
      <header className="cal-drawer-head">
        <h2>{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close event details">
          <X aria-hidden />
        </button>
      </header>
      <div className="cal-drawer-body">{children}</div>
    </aside>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="cal-detail-row">
      <span className="cal-detail-icon">{icon}</span>
      <span className="cal-detail-label">{label}</span>
      <span className="cal-detail-value">{value}</span>
    </div>
  );
}

function DetailBody({ event }: { event: CalendarEvent }) {
  const meta = EVENT_TYPE_META[event.type];
  return (
    <>
      <div className="cal-detail-chips">
        <span className={`cal-chip cal-chip-${meta.tone}`}>{meta.label}</span>
        <StatusBadge tone={event.status === "cancelled" ? "danger" : event.status === "completed" ? "success" : "info"}>
          {EVENT_STATUS_LABEL[event.status]}
        </StatusBadge>
      </div>

      <Row icon={<CalendarDays aria-hidden />} label="Date" value={event.date} />
      <Row icon={<Clock aria-hidden />} label="Time" value={timeRangeLabel(event)} />
      <Row icon={<MapPin aria-hidden />} label="Location" value={event.location || "Not recorded"} />
      <Row icon={<Users aria-hidden />} label="Project" value={event.projectName} />
      {event.departmentName && (
        <Row icon={<Users aria-hidden />} label="Department" value={event.departmentName} />
      )}
      {event.organizerName && (
        <Row icon={<Users aria-hidden />} label="Organizer" value={event.organizerName} />
      )}

      <div className="cal-detail-block">
        <b>Attendees</b>
        {event.attendees.length ? (
          <ul className="cal-attendee-list">
            {event.attendees.map((person) => (
              <li key={person.id}>
                <span>{person.displayName}</span>
                {person.organization && <em>{person.organization}</em>}
                {!person.contactId && <i>External</i>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="cal-muted">No attendees recorded.</p>
        )}
      </div>

      <div className="cal-detail-block">
        <b>Agenda / Description</b>
        <p className={event.description ? "cal-detail-text" : "cal-muted"}>
          {event.description || "No agenda recorded."}
        </p>
      </div>
    </>
  );
}

/**
 * A derived entry is somebody else's record.
 *
 * It is shown in full but never edited here, with a link to the Weekly or
 * Monthly report that owns it — that is where a correction belongs.
 */
function DerivedDetail({ event, onClose }: EventEditorProps & { event: CalendarEvent }) {
  const meta = EVENT_TYPE_META[event.type];
  return (
    <DrawerShell title={event.title} onClose={onClose}>
      <div className="cal-detail-chips">
        <span className={`cal-chip cal-chip-${meta.tone}`}>{meta.label}</span>
        <span className="cal-chip cal-chip-derived">Derived · read only</span>
      </div>
      <Row icon={<CalendarDays aria-hidden />} label="Date" value={event.date} />
      <Row icon={<Users aria-hidden />} label="Project" value={event.projectName} />
      {event.departmentName && (
        <Row icon={<Users aria-hidden />} label="Department" value={event.departmentName} />
      )}
      <div className="cal-detail-block">
        <p className="cal-muted">
          This entry comes from {event.sourceLabel ?? "another record"} and is not edited on the
          calendar. Open the source to change it.
        </p>
        {event.sourceHref && (
          <Button asChild size="sm" variant="outline">
            <Link href={event.sourceHref}>Open {event.sourceLabel ?? "source record"}</Link>
          </Button>
        )}
      </div>
    </DrawerShell>
  );
}

/* --------------------------------- Delete ---------------------------------- */

function DeleteButton({
  event,
  onChanged,
  onClose,
}: {
  event: CalendarEvent;
  onChanged: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  if (!confirming) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
        <Trash2 aria-hidden /> Delete
      </Button>
    );
  }

  return (
    <span className="cal-confirm">
      <b>Delete this event?</b>
      <Button
        size="sm"
        variant="destructive"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await eventService.remove(event.id);
            toast.success("Event deleted.");
            await onChanged();
            onClose();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not delete the event.");
          } finally {
            setBusy(false);
          }
        }}
      >
        Yes, delete
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </span>
  );
}

/* ---------------------------------- Form ----------------------------------- */

function EventForm(props: EventEditorProps & { onDoneEditing?: () => void }) {
  const { event, createOn, projects, departments, contacts } = props;
  const [draft, setDraft] = React.useState<Draft>(() => draftFrom(event, createOn, projects));
  const [saving, setSaving] = React.useState(false);
  const [attendeeName, setAttendeeName] = React.useState("");

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const addContactAttendee = (contactId: string) => {
    const contact = contacts.find((c) => c.id === contactId);
    if (!contact) return;
    if (draft.attendees.some((a) => a.contactId === contactId)) return;
    set("attendees", [
      ...draft.attendees,
      { contactId: contact.id, displayName: contact.name, organization: contact.position },
    ]);
  };

  const addExternalAttendee = () => {
    const name = attendeeName.trim();
    if (!name) return;
    set("attendees", [...draft.attendees, { displayName: name }]);
    setAttendeeName("");
  };

  const save = async () => {
    if (!draft.projectId) {
      toast.error("Choose a project for this event.");
      return;
    }
    if (!draft.title.trim()) {
      toast.error("Give the event a title.");
      return;
    }
    setSaving(true);
    try {
      const input: EventInput = {
        projectId: draft.projectId,
        departmentId: draft.departmentId || null,
        type: draft.type,
        title: draft.title.trim(),
        date: draft.date,
        startTime: draft.startTime || null,
        endTime: draft.endTime || null,
        location: draft.location.trim() || null,
        organizerContactId: draft.organizerContactId || null,
        status: draft.status,
        description: draft.description.trim() || null,
        attendees: draft.attendees,
      };
      if (event) await eventService.update(event.id, input);
      else await eventService.create(input);

      toast.success(event ? "Event updated." : "Event created.");
      await props.onChanged();
      props.onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the event.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DrawerShell title={event ? "Edit Event" : "New Event"} onClose={props.onClose}>
      <div className="cal-form">
        <label>
          <span>Title</span>
          <input value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Weekly Progress Meeting" />
        </label>

        <div className="cal-form-pair">
          <label>
            <span>Event type</span>
            <select value={draft.type} onChange={(e) => set("type", e.target.value as CalendarEventType)}>
              {CREATABLE_EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {EVENT_TYPE_META[type].label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select value={draft.status} onChange={(e) => set("status", e.target.value as CalendarEventStatus)}>
              {(Object.keys(EVENT_STATUS_LABEL) as CalendarEventStatus[]).map((value) => (
                <option key={value} value={value}>
                  {EVENT_STATUS_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="cal-form-pair">
          <label>
            <span>Project</span>
            <select value={draft.projectId} onChange={(e) => set("projectId", e.target.value)}>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Department</span>
            <select value={draft.departmentId} onChange={(e) => set("departmentId", e.target.value)}>
              <option value="">Not department-specific</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="cal-form-triple">
          <label>
            <span>Date</span>
            <input type="date" value={draft.date} onChange={(e) => set("date", e.target.value)} />
          </label>
          <label>
            <span>Start</span>
            <input type="time" value={draft.startTime} onChange={(e) => set("startTime", e.target.value)} />
          </label>
          <label>
            <span>End</span>
            <input type="time" value={draft.endTime} onChange={(e) => set("endTime", e.target.value)} />
          </label>
        </div>

        <div className="cal-form-pair">
          <label>
            <span>Location</span>
            <input value={draft.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Main Conference Room" />
          </label>
          <label>
            <span>Organizer</span>
            <select value={draft.organizerContactId} onChange={(e) => set("organizerContactId", e.target.value)}>
              <option value="">Not recorded</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Attendees: platform contacts, or free-typed external people. */}
        <div className="cal-form-block">
          <span className="cal-form-legend">Attendees</span>
          {draft.attendees.length > 0 && (
            <ul className="cal-attendee-edit">
              {draft.attendees.map((person, index) => (
                <li key={`${person.displayName}-${index}`}>
                  <span>{person.displayName}</span>
                  {!person.contactId && <i>External</i>}
                  <button
                    type="button"
                    onClick={() => set("attendees", draft.attendees.filter((_, i) => i !== index))}
                    aria-label={`Remove ${person.displayName}`}
                  >
                    <X aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="cal-form-pair">
            <label>
              <span>Add from Contacts</span>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) addContactAttendee(e.target.value);
                }}
              >
                <option value="">Select a person…</option>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Add external attendee</span>
              <span className="cal-inline-add">
                <input
                  value={attendeeName}
                  onChange={(e) => setAttendeeName(e.target.value)}
                  placeholder="Full name"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addExternalAttendee();
                    }
                  }}
                />
                <Button size="sm" variant="outline" onClick={addExternalAttendee} disabled={!attendeeName.trim()}>
                  <UserPlus aria-hidden /> Add
                </Button>
              </span>
            </label>
          </div>
        </div>

        <label>
          <span>Agenda / Description</span>
          <textarea
            rows={4}
            value={draft.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Agenda items, purpose, or notes"
          />
        </label>

        <div className="cal-drawer-actions">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : event ? "Save Changes" : "Create Event"}
          </Button>
          <Button variant="outline" onClick={props.onClose} disabled={saving}>
            Cancel
          </Button>
        </div>
      </div>
    </DrawerShell>
  );
}

/**
 * Phase 13.9B — notification wording for Project Setup amendments.
 *
 * Pure: the database decides WHO is notified and WHEN (`user_notifications`,
 * written by triggers on `project_setup_amendments` / `projects`); this only
 * words a notification from the amendment it points at, in the same business
 * terms the queue, the amendments panel and Project History use.
 */

import type { NotificationDetail, NotificationItem, NotificationTarget, NotificationToast } from "@/features/notifications/model";
import { formatSetupValue, type SetupAmendment, type SetupValueLookups } from "./setup-amendments";
import { amendmentWording, isStructureAmendment } from "./structure-amendments";

export const AMENDMENT_NOTIFICATION_EVENTS = [
  "amendment_submitted",
  "amendment_approved",
  "amendment_rejected",
  "amendment_stale",
  "amendment_frozen",
] as const;
export type AmendmentNotificationEvent = (typeof AMENDMENT_NOTIFICATION_EVENTS)[number];

/** A `user_notifications` row. */
export interface AmendmentNotificationRow {
  id: string;
  eventType: AmendmentNotificationEvent;
  projectId: string;
  sourceId: string;
  actorName: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface AmendmentNotificationProject {
  id: string;
  code: string;
  name: string;
}

/**
 * One concise title per event, shared by the Notification Center card and the
 * toast. The same five events cover field and structure requests, PSM and
 * Other projects alike.
 */
export const AMENDMENT_NOTIFICATION_TITLE: Record<AmendmentNotificationEvent, string> = {
  amendment_submitted: "Approval required",
  amendment_approved: "Request approved",
  amendment_rejected: "Request rejected",
  amendment_stale: "Request not applied",
  amendment_frozen: "Request frozen",
};

/** What happened, for the events whose outcome is not a person's decision. */
const OUTCOME: Partial<Record<AmendmentNotificationEvent, string>> = {
  amendment_stale: "Nothing was applied: the underlying value changed after the request.",
  amendment_frozen: "The project was archived while the request was pending. It can no longer be decided.",
};

/** The toast's second line for those events. */
const OUTCOME_SHORT: Partial<Record<AmendmentNotificationEvent, string>> = {
  amendment_stale: "Not applied: the value changed",
  amendment_frozen: "Project archived",
};

/** A toast line is a glance, not a record: long values are clipped (the card has them in full). */
const TOAST_LINE_MAX = 90;
export function clipToastLine(text: string): string {
  return text.length <= TOAST_LINE_MAX ? text : `${text.slice(0, TOAST_LINE_MAX - 1).trimEnd()}…`;
}

/** Structure actions whose title does not already say the result: the request line adds "→ result". */
const STRUCTURE_ACTIONS_WITH_RESULT = new Set([
  "rename", "move", "set_reporting_scope", "rename_level", "set_department_scope", "move_discipline",
]);

/**
 * The request in one line, in business words: "Currency: EGP → USD" for a
 * field, "Rename Area · A1 → Area One (A1)" / "Add department · Civil" for a
 * structure change. Never an id or a raw payload.
 */
export function amendmentRequestLine(amendment: SetupAmendment, lookups: SetupValueLookups): string {
  const { subject, previous, proposed } = amendmentWording(amendment, (fieldKey, value) =>
    formatSetupValue(fieldKey, value, lookups)
  );
  if (!isStructureAmendment(amendment)) return `${subject}: ${previous} → ${proposed}`;
  return STRUCTURE_ACTIONS_WITH_RESULT.has(String(amendment.proposedValue.action ?? "")) ? `${subject} → ${proposed}` : subject;
}

/**
 * The in-app toast for a notification: the event title, then two short lines:
 * what was requested, and who acted on which project. The Notification Center
 * card stays the permanent, complete record; this is only the heads-up.
 */
export function amendmentToast(input: {
  eventType: AmendmentNotificationEvent;
  project: AmendmentNotificationProject | undefined;
  request: string | null;
  actorName: string | null;
}): NotificationToast {
  const { eventType, project, request, actorName } = input;
  const who =
    eventType === "amendment_submitted" ? `Requested by ${actorName ?? "Project Control"}`
      : eventType === "amendment_approved" ? `Approved by ${actorName ?? "a Project Control Admin"}`
        : eventType === "amendment_rejected" ? `Rejected by ${actorName ?? "a Project Control Admin"}`
          : OUTCOME_SHORT[eventType] ?? "";
  const second = [who, project?.name].filter(Boolean).join(" · ");
  return {
    title: AMENDMENT_NOTIFICATION_TITLE[eventType],
    description: [clipToastLine(request ?? "Project Setup request"), second].join("\n"),
    actionLabel: eventType === "amendment_submitted" ? "View request" : "View details",
  };
}

/**
 * The structured rows of the Notification Center card, one shape for every
 * event. Long impact text is deliberately left out: the deep-linked request
 * shows it in full. "Notification sent" is added by the card itself.
 */
export function amendmentNotificationDetails(input: {
  eventType: AmendmentNotificationEvent;
  amendment: SetupAmendment | null;
  request: string | null;
  projectLabel: string;
  actorName: string | null;
  decidedAt: string | null;
  formatDateTime: (iso: string) => string;
}): NotificationDetail[] {
  const { eventType, amendment, request, projectLabel, actorName, decidedAt, formatDateTime } = input;
  const rows: NotificationDetail[] = [];
  const add = (label: string, value: string | null | undefined) => {
    if (value && value.trim()) rows.push({ label, value });
  };
  const requester = amendment ? amendment.requestedByName ?? "Project Control" : null;
  const requested = amendment ? formatDateTime(amendment.requestedAt) : null;

  switch (eventType) {
    case "amendment_submitted":
      add("Requested by", requester);
      add("Request", request);
      add("Project", projectLabel);
      add("Requested", requested);
      add("Reason", amendment?.reason);
      break;
    case "amendment_approved":
    case "amendment_rejected":
      add("Request", request);
      add("Requested by", requester);
      add("Decision by", actorName ?? "a Project Control Admin");
      add("Project", projectLabel);
      add("Requested", requested);
      add("Decision time", decidedAt ? formatDateTime(decidedAt) : null);
      if (eventType === "amendment_rejected") add("Reason", amendment?.decisionComment ?? "No reason was recorded.");
      else add("Comment", amendment?.decisionComment);
      break;
    case "amendment_stale":
    case "amendment_frozen":
      add("Request", request);
      add("Requested by", requester);
      add("Project", projectLabel);
      add("Requested", requested);
      add("Outcome", OUTCOME[eventType]);
      // A stale request carries the server's own reason; show it only when it adds something.
      if (eventType === "amendment_stale" && amendment?.decisionComment && amendment.decisionComment !== OUTCOME.amendment_stale) {
        add("Detail", amendment.decisionComment);
      }
      break;
  }
  return rows;
}

/** The Project Setup page that shows the request, with the request focused. */
export function amendmentNotificationTarget(row: Pick<AmendmentNotificationRow, "projectId" | "sourceId">): NotificationTarget {
  return { type: "setup_amendment", id: row.sourceId, projectId: row.projectId };
}

export function isAmendmentNotificationEvent(value: string): value is AmendmentNotificationEvent {
  return (AMENDMENT_NOTIFICATION_EVENTS as readonly string[]).includes(value);
}

/**
 * The inbox item for one notification. `amendment` is null when the request
 * can no longer be read; the item still says what happened.
 */
export function composeAmendmentNotification(input: {
  row: AmendmentNotificationRow;
  amendment: SetupAmendment | null;
  project: AmendmentNotificationProject | undefined;
  lookups: SetupValueLookups;
  formatDateTime: (iso: string) => string;
}): NotificationItem {
  const { row, amendment, project, lookups, formatDateTime } = input;
  const { eventType } = row;
  const projectLabel = project ? `${project.code} · ${project.name}` : "A project";
  const request = amendment ? amendmentRequestLine(amendment, lookups) : null;
  const decision = eventType === "amendment_approved" || eventType === "amendment_rejected";
  // Who acted: the requester for a new request, the decider for a decision (the
  // notification row's actor is the fallback when the request can no longer be read).
  const actorName = eventType === "amendment_submitted"
    ? amendment?.requestedByName ?? row.actorName
    : decision ? amendment?.decidedByName ?? row.actorName : null;
  const details = amendmentNotificationDetails({
    eventType, amendment, request, projectLabel, actorName,
    decidedAt: decision ? amendment?.decidedAt ?? row.createdAt : null,
    formatDateTime,
  });
  // A request that can no longer be read still says what happened.
  if (!amendment) details.unshift({ label: "Request", value: "Project Setup request (no longer available)" });

  return {
    id: row.id,
    category: "approvals",
    title: AMENDMENT_NOTIFICATION_TITLE[eventType],
    // One short line for screen readers and any plain list; the card shows `details`.
    description: [request ?? "Project Setup request", OUTCOME[eventType], projectLabel].filter(Boolean).join(" · "),
    projectId: row.projectId,
    projectName: project?.name ?? "Project",
    createdAt: row.createdAt,
    readAt: row.readAt,
    target: amendmentNotificationTarget(row),
    details,
    // Mirrors notification_requires_action(): a request still waiting for this approver's decision.
    actionRequired: eventType === "amendment_submitted" && amendment?.status === "pending",
    toast: amendmentToast({ eventType, project, request, actorName }),
  };
}

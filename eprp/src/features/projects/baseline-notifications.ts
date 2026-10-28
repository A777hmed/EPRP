/**
 * Phase 13.12 (browser UAT) — notification wording for Baseline Revisions.
 *
 * Pure. The database decides WHO is notified and WHEN (`user_notifications`,
 * written by the trigger on `planning_baselines`): approvers when a BL0 or a
 * re-baseline is requested (never the requester), the requester when it is
 * approved or rejected. This only words a row from the revision it points at,
 * on the existing notification model and compact toast. The full reason,
 * captured activities and decision note stay on Baselines & Snapshots.
 */

import type { NotificationDetail, NotificationItem, NotificationTarget, NotificationToast } from "@/features/notifications/model";
import type { PlanningBaseline } from "@/types";

export const BASELINE_NOTIFICATION_EVENTS = ["baseline_requested", "baseline_approved", "baseline_rejected"] as const;
export type BaselineNotificationEvent = (typeof BASELINE_NOTIFICATION_EVENTS)[number];

export function isBaselineNotificationEvent(value: string): value is BaselineNotificationEvent {
  return (BASELINE_NOTIFICATION_EVENTS as readonly string[]).includes(value);
}

/** A `user_notifications` row of a baseline event. */
export interface BaselineNotificationRow {
  id: string;
  eventType: BaselineNotificationEvent;
  projectId: string;
  baselineId: string;
  actorName: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface BaselineNotificationProject {
  id: string;
  code: string;
  name: string;
}

/** Planning Workspace → Baselines & Snapshots, with the request focused. */
export function baselineNotificationTarget(row: Pick<BaselineNotificationRow, "projectId" | "baselineId">): NotificationTarget {
  return { type: "planning_baseline", id: row.baselineId, projectId: row.projectId };
}

/**
 * The revision number a row is about: the approved number, or — for a request
 * or a rejection — the number it would take (the approved revisions decided
 * before it). One request is pending per project at a time, so this is exact.
 */
export function baselineNumberOf(
  baseline: Pick<PlanningBaseline, "revisionStatus" | "revisionNumber" | "requestedAt" | "decidedAt"> | null,
  approvedDecisionTimes: readonly string[]
): number | null {
  if (!baseline) return null;
  if (baseline.revisionStatus === "approved" && baseline.revisionNumber !== undefined) return baseline.revisionNumber;
  const cutoff = baseline.requestedAt ?? baseline.decidedAt;
  if (!cutoff) return null;
  return approvedDecisionTimes.filter((at) => at < cutoff).length;
}

/** The compact toast (title, one context line, action) — `07` §10 compact toast. */
export function baselineToast(input: {
  eventType: BaselineNotificationEvent;
  projectCode: string | undefined;
  number: number | null;
}): NotificationToast {
  const { eventType, projectCode, number } = input;
  const code = projectCode ?? "Project";
  const label = number === null ? "Baseline" : `BL${number}`;
  switch (eventType) {
    case "baseline_requested":
      return number === 0
        ? { title: "BL0 approval required", description: `${code} · Original baseline request`, actionLabel: "Review", tone: "approval" }
        : { title: "Baseline approval required", description: `${code} · ${label} revision request`, actionLabel: "Review", tone: "approval" };
    case "baseline_approved":
      return { title: "Baseline approved", description: `${code} · ${label} approved`, actionLabel: "View", tone: "approved" };
    case "baseline_rejected":
      return { title: "Baseline rejected", description: `${code} · ${label} rejected`, actionLabel: "View", tone: "rejected" };
  }
}

/** The inbox item for one baseline notification; `baseline` is null when it can no longer be read. */
export function composeBaselineNotification(input: {
  row: BaselineNotificationRow;
  baseline: PlanningBaseline | null;
  project: BaselineNotificationProject | undefined;
  number: number | null;
  formatDateTime: (iso: string) => string;
}): NotificationItem {
  const { row, baseline, project, number, formatDateTime } = input;
  const toast = baselineToast({ eventType: row.eventType, projectCode: project?.code, number });
  const projectLabel = project ? `${project.code} · ${project.name}` : "A project";
  const subject = number === 0 ? "Original baseline (BL0)" : number === null ? "Baseline revision" : `Re-baseline (BL${number})`;

  const details: NotificationDetail[] = [];
  const add = (label: string, value: string | null | undefined) => {
    if (value && value.trim()) details.push({ label, value });
  };
  add("Request", subject);
  add("Project", projectLabel);
  if (row.eventType === "baseline_requested") {
    add("Requested by", row.actorName ?? "Project Control");
    add("Requested", baseline?.requestedAt ? formatDateTime(baseline.requestedAt) : formatDateTime(row.createdAt));
    add("Reason", baseline?.reason);
  } else {
    add("Decision by", row.actorName ?? "a Project Control Admin");
    add("Decision time", baseline?.decidedAt ? formatDateTime(baseline.decidedAt) : formatDateTime(row.createdAt));
    add(row.eventType === "baseline_rejected" ? "Reason" : "Comment", baseline?.decisionComment);
  }
  if (!baseline) add("Status", "This baseline request is no longer available.");

  return {
    id: row.id,
    category: "approvals",
    title: toast.title,
    description: toast.description,
    projectId: row.projectId,
    projectName: project?.name ?? "Project",
    createdAt: row.createdAt,
    readAt: row.readAt,
    target: baselineNotificationTarget(row),
    details,
    // Mirrors notification_requires_action(): a request still awaiting this approver's decision.
    actionRequired: row.eventType === "baseline_requested" && baseline?.revisionStatus === "requested",
    toast,
  };
}

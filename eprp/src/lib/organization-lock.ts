import type { OrganizationChartStatus } from "@/types";

/**
 * Chart locking rules (OC-6).
 *
 * Kept as pure functions so both the services and the UI decide editability
 * the same way — the server rejects a write the interface would not have
 * offered, rather than the two drifting apart.
 */

/** Working states. Anything not listed here is settled and read-only. */
const EDITABLE_STATUSES = new Set<OrganizationChartStatus>([
  "draft",
  "in_progress",
  "under_review",
]);

/** Can positions be added, edited, moved or deleted on this chart? */
export function isChartEditable(status: OrganizationChartStatus): boolean {
  return EDITABLE_STATUSES.has(status);
}

/**
 * Settled but still live: Approved and Locked charts are read-only, and the
 * way forward is a new revision. Archived charts are simply retired, so they
 * get no revision offer.
 */
export function isChartLocked(status: OrganizationChartStatus): boolean {
  return status === "approved" || status === "locked";
}

/** Which statuses a chart may be moved to from where it is now. */
export function allowedStatusTransitions(
  status: OrganizationChartStatus
): OrganizationChartStatus[] {
  switch (status) {
    case "draft":
      return ["in_progress", "archived"];
    case "in_progress":
      return ["under_review", "draft", "archived"];
    case "under_review":
      // Sending it back is how a review is rejected.
      return ["approved", "in_progress", "archived"];
    case "approved":
      return ["locked", "under_review", "archived"];
    case "locked":
      // Locked is deliberately a dead end — revise instead.
      return ["archived"];
    case "archived":
      return [];
  }
}

export function canTransitionTo(
  from: OrganizationChartStatus,
  to: OrganizationChartStatus
): boolean {
  return allowedStatusTransitions(from).includes(to);
}

export const CHART_STATUS_LABELS: Record<OrganizationChartStatus, string> = {
  draft: "Draft",
  in_progress: "In Progress",
  under_review: "Under Review",
  approved: "Approved",
  locked: "Locked",
  archived: "Archived",
};

export function chartStatusLabel(status: OrganizationChartStatus): string {
  return CHART_STATUS_LABELS[status];
}

/**
 * Why a chart cannot be edited, phrased for the reader. Returns undefined
 * when it can be.
 */
export function lockReason(
  status: OrganizationChartStatus
): string | undefined {
  if (isChartEditable(status)) return undefined;
  if (status === "archived") return "This chart has been archived.";
  return `This chart is ${chartStatusLabel(status).toLowerCase()} and cannot be changed. Create a new revision to make changes.`;
}

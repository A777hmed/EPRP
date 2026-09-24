/**
 * Normalizes governed Weekly entries / Monthly comments into one shared
 * shape for the Project Workspace Management tab (Dashboard Data Depth,
 * item 3). Only the four attention-worthy kinds are surfaced — a plain
 * progress comment or achievement is not a management-attention item — and
 * nothing here invents a narrative: `text` is always the governed
 * description/original wording, verbatim.
 */

import type { MonthlyComment, Priority, WeeklyEntry } from "@/types";

export type ManagementItemGroup = "risk_issue" | "decision" | "action";

export const MANAGEMENT_GROUP_LABEL: Record<ManagementItemGroup, string> = {
  risk_issue: "Risks & Issues",
  decision: "Decisions",
  action: "Actions",
};

/** Governed display order — risks and issues first (the most urgent read),
    decisions next, actions last. */
export const MANAGEMENT_GROUP_ORDER: ManagementItemGroup[] = ["risk_issue", "decision", "action"];

export interface NormalizedManagementItem {
  id: string;
  group: ManagementItemGroup;
  text: string;
  priority: Priority;
  status: string;
  ownerContactId?: string;
  dueDate?: string;
  /** Weekly-only: the item's category was recorded as Client/Contractual —
      surfaced as a badge rather than a separate section, since Monthly
      comments carry no equivalent field to test the same way. */
  isClient: boolean;
}

export function normalizeWeeklyEntries(entries: readonly WeeklyEntry[]): NormalizedManagementItem[] {
  const out: NormalizedManagementItem[] = [];
  for (const entry of entries) {
    const group: ManagementItemGroup | undefined =
      entry.entryType === "risk" || entry.entryType === "issue"
        ? "risk_issue"
        : entry.entryType === "decision"
          ? "decision"
          : entry.entryType === "action"
            ? "action"
            : undefined;
    if (!group) continue;
    out.push({
      id: entry.id,
      group,
      text: entry.description,
      priority: entry.priority,
      status: entry.status,
      ownerContactId: entry.ownerContactId,
      dueDate: entry.dueDate,
      isClient: entry.category === "client_contractual",
    });
  }
  return out;
}

export function normalizeMonthlyComments(comments: readonly MonthlyComment[]): NormalizedManagementItem[] {
  const out: NormalizedManagementItem[] = [];
  for (const comment of comments) {
    const group: ManagementItemGroup | undefined =
      comment.updateType === "risk_issue"
        ? "risk_issue"
        : comment.updateType === "decision_management_support"
          ? "decision"
          : comment.updateType === "action"
            ? "action"
            : undefined;
    if (!group) continue;
    out.push({
      id: comment.id,
      group,
      text: comment.presentationText ?? comment.originalText,
      priority: comment.priority,
      status: comment.status,
      ownerContactId: comment.responsibleContactId,
      dueDate: comment.targetDate,
      isClient: false,
    });
  }
  return out;
}

export function groupManagementItems(
  items: readonly NormalizedManagementItem[]
): Partial<Record<ManagementItemGroup, NormalizedManagementItem[]>> {
  const out: Partial<Record<ManagementItemGroup, NormalizedManagementItem[]>> = {};
  for (const item of items) {
    (out[item.group] ??= []).push(item);
  }
  return out;
}

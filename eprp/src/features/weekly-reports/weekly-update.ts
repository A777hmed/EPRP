import type {
  CommentCategory,
  EntryStatus,
  Priority,
  WeeklyEntry,
  WeeklyEntryType,
  WeeklyUpdateType,
} from "@/types";
import type { WeeklyEntryInput } from "@/services/weekly-report-service";

/**
 * The one user-facing narrative taxonomy for a department scope item.
 *
 * `weekly_entries.update_type` predates this UI and is constrained to seven
 * values. The two contextual distinctions that do not have a dedicated stored
 * value (Decision and Next Week Plan) reuse the existing entry type/category
 * compatibility fields; users never see or choose those implementation fields.
 */
export const WEEKLY_COMMENT_TYPES = [
  "progress_update",
  "achievement",
  "issue_constraint",
  "client_action",
  "risk",
  "decision_management_support",
  "next_week_plan",
  "action",
  "general",
 ] as const;

export type WeeklyCommentType = (typeof WEEKLY_COMMENT_TYPES)[number];

export interface WeeklyCommentTypeMeta {
  label: string;
  entryType: WeeklyEntryType;
  storedUpdateType: WeeklyUpdateType;
  category: CommentCategory;
  priority: Priority;
  requiresWorkflowFields: boolean;
  showWorkflowFields: boolean;
}

export const WEEKLY_COMMENT_TYPE_META: Record<
  WeeklyCommentType,
  WeeklyCommentTypeMeta
> = {
  progress_update: {
    label: "Progress Update",
    entryType: "comment",
    storedUpdateType: "progress_update",
    category: "progress",
    priority: "low",
    requiresWorkflowFields: false,
    showWorkflowFields: false,
  },
  achievement: {
    label: "Achievement",
    entryType: "comment",
    storedUpdateType: "achievement",
    category: "general",
    priority: "low",
    requiresWorkflowFields: false,
    showWorkflowFields: false,
  },
  issue_constraint: {
    label: "Issue / Constraint",
    entryType: "issue",
    storedUpdateType: "issue",
    category: "issue",
    priority: "medium",
    requiresWorkflowFields: false,
    showWorkflowFields: true,
  },
  /*
   * An action REQUIRED FROM THE CLIENT — approval pending, data awaited,
   * decision owed. Stored on the existing action/client_contractual axes, so
   * no schema change: the pairing is what distinguishes it from an internal
   * `action` on read.
   */
  client_action: {
    label: "Client Action",
    entryType: "action",
    storedUpdateType: "action_required",
    category: "client_contractual",
    priority: "high",
    requiresWorkflowFields: false,
    showWorkflowFields: true,
  },
  risk: {
    label: "Risk",
    entryType: "risk",
    storedUpdateType: "risk",
    category: "risk",
    priority: "high",
    requiresWorkflowFields: false,
    showWorkflowFields: true,
  },
  decision_management_support: {
    label: "Decision / Management Support",
    entryType: "comment",
    storedUpdateType: "general",
    category: "escalation",
    priority: "high",
    requiresWorkflowFields: false,
    showWorkflowFields: true,
  },
  next_week_plan: {
    label: "Next Week Plan",
    entryType: "action",
    storedUpdateType: "action_required",
    category: "progress",
    priority: "medium",
    requiresWorkflowFields: false,
    showWorkflowFields: false,
  },
  action: {
    label: "Action",
    entryType: "action",
    storedUpdateType: "action_required",
    category: "general",
    priority: "medium",
    requiresWorkflowFields: true,
    showWorkflowFields: true,
  },
  general: {
    label: "General",
    entryType: "comment",
    storedUpdateType: "general",
    category: "general",
    priority: "low",
    requiresWorkflowFields: false,
    showWorkflowFields: false,
  },
};

/** Translate persisted compatibility fields back to the one UI taxonomy. */
export function weeklyCommentTypeForEntry(entry: WeeklyEntry): WeeklyCommentType {
  if (entry.updateType === "progress_update") return "progress_update";
  if (entry.updateType === "achievement") return "achievement";
  if (entry.updateType === "delay_constraint" || entry.updateType === "issue") return "issue_constraint";
  if (entry.updateType === "risk") return "risk";
  if (entry.entryType === "decision") return "decision_management_support";
  if (entry.updateType === "action_required") {
    if (entry.category === "client_contractual") return "client_action";
    return entry.category === "progress" ? "next_week_plan" : "action";
  }
  if (entry.category === "escalation") return "decision_management_support";
  return "general";
}

export function weeklyCommentLabel(entry: WeeklyEntry): string {
  return WEEKLY_COMMENT_TYPE_META[weeklyCommentTypeForEntry(entry)].label;
}

/** Scope-level entries are the canonical Weekly narrative rows. */
export function isWeeklyComment(entry: WeeklyEntry): boolean {
  return Boolean(entry.departmentId);
}

export interface WeeklyUpdateDraft {
  key: string;
  id?: string;
  updateType: WeeklyCommentType;
  description: string;
  ownerContactId: string;
  dueDate: string;
  status: EntryStatus;
  includeInMonthly: boolean;
  source?: WeeklyEntry;
}

export function toWeeklyUpdateDraft(entry: WeeklyEntry): WeeklyUpdateDraft {
  return {
    key: entry.id,
    id: entry.id,
    updateType: weeklyCommentTypeForEntry(entry),
    description: entry.description,
    ownerContactId: entry.ownerContactId ?? "",
    dueDate: entry.dueDate ?? "",
    status: entry.status,
    includeInMonthly: entry.includeInMonthly,
    source: entry,
  };
}

export function newWeeklyUpdateDraft(key: string): WeeklyUpdateDraft {
  return {
    key,
    updateType: "progress_update",
    description: "",
    ownerContactId: "",
    dueDate: "",
    status: "open",
    includeInMonthly: false,
  };
}

export function weeklyUpdateErrors(row: WeeklyUpdateDraft): string[] {
  const missing: string[] = [];
  if (!row.description.trim()) missing.push("comment text");
  const meta = WEEKLY_COMMENT_TYPE_META[row.updateType];
  if (meta.requiresWorkflowFields && !row.ownerContactId) {
    missing.push("a responsible person");
  }
  if (meta.requiresWorkflowFields && !row.dueDate) {
    missing.push("a target date");
  }
  return missing.length ? [`Weekly update needs ${missing.join(" and ")}.`] : [];
}

export function toWeeklyUpdateInput(
  row: WeeklyUpdateDraft,
  scope: {
    departmentId: string;
    systemId?: string;
    disciplineId?: string;
    authorContactId?: string;
  }
): WeeklyEntryInput {
  const meta = WEEKLY_COMMENT_TYPE_META[row.updateType];
  return {
    id: row.id,
    entryType: meta.entryType,
    updateType: meta.storedUpdateType,
    // Compatibility-only storage. Normal users never choose this field.
    category: meta.category,
    description: row.description.trim(),
    priority: meta.priority,
    status: row.status,
    ownerContactId: row.ownerContactId || undefined,
    dueDate: row.dueDate || undefined,
    departmentId: scope.departmentId,
    systemId: scope.systemId,
    disciplineId: scope.disciplineId,
    includeInMonthly: row.includeInMonthly,
    authorContactId: scope.authorContactId,
  };
}

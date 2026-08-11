import type {
  EntryStatus,
  Priority,
  WeeklyEntry,
  WeeklyEntryType,
  WeeklyUpdateType,
} from "@/types";
import type { WeeklyEntryInput } from "@/services/weekly-report-service";

/** The four ordinary comment types shown inside a department scope item. */
export const WEEKLY_COMMENT_TYPES: WeeklyUpdateType[] = [
  "progress_update",
  "achievement",
  "delay_constraint",
  "general",
];

const WEEKLY_COMMENT_TYPE_SET = new Set<WeeklyUpdateType>(
  WEEKLY_COMMENT_TYPES
);

/** Formal risks, issues, actions and decisions stay in Management Items. */
export function isWeeklyComment(entry: WeeklyEntry): boolean {
  return WEEKLY_COMMENT_TYPE_SET.has(entry.updateType);
}

export const WEEKLY_UPDATE_TYPE_META: Record<
  WeeklyUpdateType,
  { label: string; entryType: WeeklyEntryType; priority: Priority }
> = {
  progress_update: { label: "Progress Update", entryType: "comment", priority: "low" },
  achievement: { label: "Achievement", entryType: "comment", priority: "low" },
  delay_constraint: { label: "Delay / Constraint", entryType: "comment", priority: "high" },
  risk: { label: "Risk", entryType: "risk", priority: "high" },
  issue: { label: "Issue", entryType: "issue", priority: "medium" },
  action_required: { label: "Action Required", entryType: "action", priority: "medium" },
  general: { label: "General Update", entryType: "comment", priority: "low" },
};

export interface WeeklyUpdateDraft {
  key: string;
  id?: string;
  updateType: WeeklyUpdateType;
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
    updateType: entry.updateType ?? "general",
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
  if (row.updateType === "action_required" && !row.ownerContactId) {
    missing.push("a responsible person");
  }
  if (row.updateType === "action_required" && !row.dueDate) {
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
  const meta = WEEKLY_UPDATE_TYPE_META[row.updateType];
  return {
    id: row.id,
    entryType: meta.entryType,
    updateType: row.updateType,
    // Compatibility-only storage. Normal users never choose this field.
    category: row.updateType === "progress_update" ? "progress" : "general",
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

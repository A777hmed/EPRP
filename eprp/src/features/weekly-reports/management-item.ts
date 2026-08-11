import {
  WEEKLY_ENTRY_REQUIRED,
  WEEKLY_ENTRY_TYPE_META,
} from "@/lib/constants";
import type {
  CommentCategory,
  EntryStatus,
  Priority,
  WeeklyEntry,
  WeeklyEntryType,
} from "@/types";
import type { WeeklyEntryInput } from "@/services/weekly-report-service";

/**
 * One Project Management Item, as the form holds it.
 *
 * Backed by `weekly_entries` unchanged — the same table that held Key
 * Comments, Risks, Issues and Action Items as four separate editors. Nothing
 * about the storage moved; what changed is that the five kinds are now ONE
 * list discriminated by `entryType`, so a user adds an item and says what it
 * is, instead of choosing which of four forms to scroll to.
 */
export interface ManagementItemDraft {
  /** Stable across renders, including before the row has an id. */
  key: string;
  id?: string;
  entryType: WeeklyEntryType;
  category: CommentCategory;
  description: string;
  priority: Priority;
  status: EntryStatus;
  ownerContactId: string;
  dueDate: string;
  departmentId: string;
  systemId: string;
  disciplineId: string;
  includeInMonthly: boolean;
}

export function toManagementItemDraft(entry: WeeklyEntry): ManagementItemDraft {
  return {
    key: entry.id,
    id: entry.id,
    entryType: entry.entryType,
    category: entry.category,
    description: entry.description,
    priority: entry.priority,
    status: entry.status,
    ownerContactId: entry.ownerContactId ?? "",
    dueDate: entry.dueDate ?? "",
    departmentId: entry.departmentId ?? "",
    systemId: entry.systemId ?? "",
    disciplineId: entry.disciplineId ?? "",
    includeInMonthly: entry.includeInMonthly,
  };
}

/**
 * A blank item.
 *
 * `preset` carries the scope a mount point already knows — a row added from
 * inside a scope item is that scope item's by construction, and asking the
 * user to re-pick the department they are standing in is exactly the kind of
 * re-entry this pass removes.
 */
export function newManagementItemDraft(
  key: string,
  preset: Partial<ManagementItemDraft> = {}
): ManagementItemDraft {
  return {
    key,
    entryType: "action",
    category: "general",
    description: "",
    priority: "medium",
    status: "open",
    ownerContactId: "",
    dueDate: "",
    departmentId: "",
    systemId: "",
    disciplineId: "",
    includeInMonthly: false,
    ...preset,
  };
}

/**
 * What is missing before this row can be saved.
 *
 * Requirements follow the TYPE, from `WEEKLY_ENTRY_REQUIRED`: an Action
 * without an owner and a date is not an action, while a Key Comment needs
 * neither. Fields the type does not require are never presented as required
 * merely because the shared table has a column for them.
 */
export function managementItemErrors(row: ManagementItemDraft): string[] {
  const rules = WEEKLY_ENTRY_REQUIRED[row.entryType];
  const label = WEEKLY_ENTRY_TYPE_META[row.entryType].singular;
  const missing: string[] = [];

  if (!row.description.trim()) missing.push("a description");
  if (rules.owner && !row.ownerContactId) missing.push("an owner");
  if (rules.dueDate && !row.dueDate) missing.push("a due date");
  // Priority and status always carry a value, so their "required" flag is
  // about presentation — the field is shown, not defaulted away.

  return missing.length === 0
    ? []
    : [`This ${label} needs ${missing.join(", ")}.`];
}

/** Whether a field is worth showing at all for this type. */
export function showsField(
  entryType: WeeklyEntryType,
  field: "owner" | "dueDate" | "priority" | "status" | "category"
): boolean {
  const rules = WEEKLY_ENTRY_REQUIRED[entryType];
  if (rules[field]) return true;
  switch (field) {
    // Owner and due date stay available everywhere — optional on most types,
    // but a Risk with a named owner is more useful than one without.
    case "owner":
    case "dueDate":
    case "category":
      return true;
    // A Key Comment has no lifecycle of its own and no severity worth ranking.
    case "priority":
    case "status":
      return entryType !== "comment";
  }
}

/** The service payload for one row. Blank optional values become "not set". */
export function toEntryInput(row: ManagementItemDraft): WeeklyEntryInput {
  const blank = (value: string) => (value ? value : undefined);
  return {
    id: row.id,
    entryType: row.entryType,
    category: row.category,
    description: row.description.trim(),
    priority: row.priority,
    status: row.status,
    ownerContactId: blank(row.ownerContactId),
    dueDate: blank(row.dueDate),
    departmentId: blank(row.departmentId),
    systemId: blank(row.systemId),
    disciplineId: blank(row.disciplineId),
    includeInMonthly: row.includeInMonthly,
  };
}

/**
 * Where an item belongs on screen.
 *
 * An item tagged to a scope item is shown on that scope item; everything else
 * is a project- or department-level concern and belongs in the consolidated
 * section. Splitting on the row's own `disciplineId` rather than on where it
 * happened to be typed is what keeps the same item from appearing twice.
 */
export function isScopeItemLevel(entry: WeeklyEntry): boolean {
  return Boolean(entry.disciplineId);
}

/** Items to show in the project-level Project Management Items section. */
export function projectLevelEntries(entries: WeeklyEntry[]): WeeklyEntry[] {
  return entries.filter((entry) => !isScopeItemLevel(entry));
}

import type { ProjectStructure, StructureLevelInput } from "@/types/project-structure";
import { MAX_STRUCTURE_LEVELS } from "@/types/project-structure";
import { levelConfigurationIssues, sortLevels, type StructureIssue } from "./structure-rules";
import { ProjectStructureError, PROJECT_STRUCTURE_MESSAGES } from "@/services/project-structure-errors";

/** Local form state only. The supplied snapshot stays with the draft; versions belong to the container. */
export interface StructureLevelsDraft {
  source: ProjectStructure;
  levels: StructureLevelInput[];
  saving: boolean;
  awaitingReload: boolean;
  error: string | null;
  stale: boolean;
}

export function createLevelsDraft(source: ProjectStructure): StructureLevelsDraft {
  return {
    source,
    levels: sortLevels(source.levels).map(({ id, levelNumber, singularLabel, pluralLabel }) => ({
      id, levelNumber, singularLabel, pluralLabel,
    })),
    saving: false, awaitingReload: false, error: null, stale: false,
  };
}

export function levelsAreDirty(draft: StructureLevelsDraft): boolean {
  return JSON.stringify(draft.levels) !== JSON.stringify(createLevelsDraft(draft.source).levels);
}

// Only structural issues determine whether a removal is available. Unfinished
// labels on another row must not prevent undoing a newly appended row.
const structuralIssues = new Set<StructureIssue["code"]>([
  "level_count", "level_limit", "level_gap", "level_in_use", "new_level_has_id",
]);

export function canRemoveDeepestLevel(draft: StructureLevelsDraft): boolean {
  if (draft.levels.length <= 1) return false;
  return !levelConfigurationIssues(draft.source, draft.levels.slice(0, -1))
    .some((issue) => structuralIssues.has(issue.code));
}

export function levelIssueMessage(issue: StructureIssue): string {
  switch (issue.code) {
    case "label_required": return `Enter a ${issue.field === "pluralLabel" ? "plural" : "singular"} label.`;
    case "label_too_long": return "Use no more than 60 characters.";
    case "duplicate_label": return "Use a different label from the other levels.";
    case "level_count": return "Add at least one hierarchy level before saving.";
    case "level_limit": return PROJECT_STRUCTURE_MESSAGES.level_limit;
    case "level_gap": return PROJECT_STRUCTURE_MESSAGES.level_gap;
    case "level_in_use": return PROJECT_STRUCTURE_MESSAGES.level_in_use;
    case "new_level_has_id": return "Add new levels below the existing hierarchy. Reset your edits and try again.";
    default: return "Check the hierarchy level configuration before saving.";
  }
}

export type LevelsDraftAction =
  | { type: "edit"; levelNumber: number; field: "singularLabel" | "pluralLabel"; value: string }
  | { type: "append" }
  | { type: "removeDeepest" }
  | { type: "reset"; source: ProjectStructure }
  | { type: "reload"; source: ProjectStructure }
  | { type: "receive"; source: ProjectStructure }
  | { type: "saveStarted" }
  | { type: "saveSucceeded" }
  | { type: "saveFailed"; error: unknown };

export function levelsDraftReducer(draft: StructureLevelsDraft, action: LevelsDraftAction): StructureLevelsDraft {
  switch (action.type) {
    case "receive":
      if (draft.saving || draft.source === action.source) return draft;
      // A new container snapshot acknowledges a completed save. Otherwise an
      // unsolicited refresh never discards a dirty draft or silently rebases it.
      return draft.awaitingReload || (!levelsAreDirty(draft) && !draft.stale)
        ? createLevelsDraft(action.source) : draft;
    case "reset": return createLevelsDraft(action.source);
    case "reload": return { ...createLevelsDraft(action.source), awaitingReload: true };
    case "saveStarted": return { ...draft, saving: true, error: null };
    case "saveSucceeded": return { ...draft, saving: false, awaitingReload: true };
    case "saveFailed": return {
      ...draft, saving: false, awaitingReload: false,
      error: action.error instanceof ProjectStructureError ? action.error.message : PROJECT_STRUCTURE_MESSAGES.failed,
      stale: action.error instanceof ProjectStructureError && ["stale", "not_found"].includes(action.error.reason),
    };
  }
  if (draft.saving || draft.awaitingReload || draft.stale) return draft;
  switch (action.type) {
    case "edit": return {
      ...draft, error: null,
      levels: draft.levels.map((level) => level.levelNumber === action.levelNumber
        ? { ...level, [action.field]: action.value } : level),
    };
    case "append": return draft.levels.length >= MAX_STRUCTURE_LEVELS ? draft : {
      ...draft, error: null,
      levels: [...draft.levels, { levelNumber: draft.levels.length + 1, singularLabel: "", pluralLabel: "" }],
    };
    case "removeDeepest": return canRemoveDeepestLevel(draft)
      ? { ...draft, error: null, levels: draft.levels.slice(0, -1) } : draft;
  }
}

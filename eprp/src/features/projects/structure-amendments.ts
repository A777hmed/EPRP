/**
 * Phase 13.9B — Step 4: structure / scope amendments, presentation logic.
 *
 * Pure functions only (no React, no service). A structure amendment is a row
 * of the same `project_setup_amendments` model as a field amendment, with a
 * non-empty `targetKey`: its `proposedValue` is `{action, …payload, labels}`
 * and its `previousValue` the server-read state of exactly that target. The
 * database validates, applies and guards every change
 * (`request_project_structure_amendment()`, `decide_project_setup_amendment()`,
 * `guard_structure_setup_controlled`); this file only decides what the
 * screens offer and how a request reads. Docs: `02` §26.24.2a, `07` §10.12.
 */

import { setupFieldEntry } from "./setup-governance";
import type { SetupAmendment } from "./setup-amendments";

/* --------------------------------- model --------------------------------- */

export const STRUCTURE_FIELD_KEYS = [
  "structure_units",
  "structure_levels",
  "structure_departments",
  "structure_disciplines",
] as const;
export type StructureFieldKey = (typeof STRUCTURE_FIELD_KEYS)[number];

export type UnitAction = "add" | "rename" | "move" | "archive" | "restore" | "set_reporting_scope";
export type LevelAction = "rename_level" | "add_level" | "remove_level";
export type DepartmentAction = "add_department" | "remove_department" | "set_department_scope";
export type DisciplineAction = "add_discipline" | "remove_discipline" | "move_discipline";
export type StructureAction = UnitAction | LevelAction | DepartmentAction | DisciplineAction;

/** One proposed structure change, in the screen's words. */
export type StructureProposal =
  | {
      fieldKey: "structure_units";
      action: "add";
      levelNumber: number;
      /** Null for a top-level unit. */
      parentId: string | null;
      name: string;
      code?: string;
      description?: string;
      weeklyReportingRequired: boolean;
      monthlyReportingRequired: boolean;
    }
  | { fieldKey: "structure_units"; action: "rename"; unitId: string; name: string; code?: string }
  | { fieldKey: "structure_units"; action: "move"; unitId: string; parentId: string }
  | { fieldKey: "structure_units"; action: "archive" | "restore"; unitId: string }
  | {
      fieldKey: "structure_units";
      action: "set_reporting_scope";
      unitId: string;
      weeklyReportingRequired: boolean;
      monthlyReportingRequired: boolean;
    }
  | { fieldKey: "structure_levels"; action: "rename_level" | "add_level"; levelNumber: number; singularLabel: string; pluralLabel: string }
  | { fieldKey: "structure_levels"; action: "remove_level"; levelNumber: number }
  | {
      fieldKey: "structure_departments";
      action: "add_department" | "set_department_scope";
      departmentId: string;
      systemIds: string[];
      reportingRequired: boolean;
    }
  | { fieldKey: "structure_departments"; action: "remove_department"; departmentId: string }
  | {
      fieldKey: "structure_disciplines";
      action: "add_discipline" | "move_discipline";
      disciplineId: string;
      departmentId: string;
      systemId: string | null;
    }
  | { fieldKey: "structure_disciplines"; action: "remove_discipline"; disciplineId: string };

const trimmed = (value: string | undefined): string | undefined => {
  const text = value?.trim();
  return text ? text : undefined;
};

/** The stored payload (`p_proposed`), snake_case, without empty values. */
export function proposalPayload(proposal: StructureProposal): Record<string, unknown> {
  const payload: Record<string, unknown> = { action: proposal.action };
  const put = (key: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== "") payload[key] = value;
  };
  switch (proposal.action) {
    case "add":
      put("level_number", proposal.levelNumber);
      put("parent_id", proposal.parentId);
      put("name", trimmed(proposal.name));
      put("code", trimmed(proposal.code));
      put("description", trimmed(proposal.description));
      payload.weekly_reporting_required = proposal.weeklyReportingRequired;
      payload.monthly_reporting_required = proposal.monthlyReportingRequired;
      break;
    case "rename":
      put("unit_id", proposal.unitId);
      put("name", trimmed(proposal.name));
      put("code", trimmed(proposal.code));
      break;
    case "move":
      put("unit_id", proposal.unitId);
      put("parent_id", proposal.parentId);
      break;
    case "archive":
    case "restore":
      put("unit_id", proposal.unitId);
      break;
    case "set_reporting_scope":
      put("unit_id", proposal.unitId);
      payload.weekly_reporting_required = proposal.weeklyReportingRequired;
      payload.monthly_reporting_required = proposal.monthlyReportingRequired;
      break;
    case "rename_level":
    case "add_level":
      put("level_number", proposal.levelNumber);
      put("singular_label", trimmed(proposal.singularLabel));
      put("plural_label", trimmed(proposal.pluralLabel));
      break;
    case "remove_level":
      put("level_number", proposal.levelNumber);
      break;
    case "add_department":
    case "set_department_scope":
      put("department_id", proposal.departmentId);
      payload.system_ids = [...new Set(proposal.systemIds)].sort();
      payload.reporting_required = proposal.reportingRequired;
      break;
    case "remove_department":
      put("department_id", proposal.departmentId);
      break;
    case "add_discipline":
    case "move_discipline":
      put("discipline_id", proposal.disciplineId);
      put("department_id", proposal.departmentId);
      put("system_id", proposal.systemId);
      break;
    case "remove_discipline":
      put("discipline_id", proposal.disciplineId);
      break;
  }
  return payload;
}

/* --------------------------------- targets -------------------------------- */

/** The same target keys the database writes (`project_setup_amendments.target_key`). */
export const unitTarget = (unitId: string) => `unit:${unitId}`;
export const LEVELS_TARGET = "levels";
export const departmentTarget = (departmentId: string) => `department:${departmentId}`;
export const disciplineTarget = (disciplineId: string) => `discipline:${disciplineId}`;
export const addUnitTarget = (parentId: string | null, levelNumber: number, name: string) =>
  `add:${parentId ?? "root"}:${levelNumber}:${name.trim().toLowerCase()}`;

export function isStructureAmendment(amendment: Pick<SetupAmendment, "targetKey">): boolean {
  return Boolean(amendment.targetKey);
}

/** Pending structure requests by target, so a target shows "Pending approval" and cannot be requested twice. */
export function pendingStructureTargets(amendments: readonly SetupAmendment[]): Map<string, SetupAmendment> {
  const pending = new Map<string, SetupAmendment>();
  for (const amendment of amendments) {
    if (amendment.status === "pending" && amendment.targetKey) pending.set(amendment.targetKey, amendment);
  }
  return pending;
}

/** The Project Setup step where a structure request's target is shown. */
export function structureAmendmentStep(fieldKey: string): "structure" | "departments" | "disciplines" | undefined {
  switch (fieldKey) {
    case "structure_units":
    case "structure_levels":
      return "structure";
    case "structure_departments":
      return "departments";
    case "structure_disciplines":
      return "disciplines";
    default:
      return undefined;
  }
}

/** The contextual wording for each request action (never a bare "Edit"). */
export const STRUCTURE_REQUEST_LABEL: Record<StructureAction, string> = {
  add: "Request new unit",
  rename: "Request rename",
  move: "Request move",
  archive: "Request archive",
  restore: "Request restore",
  set_reporting_scope: "Request reporting change",
  rename_level: "Request level rename",
  add_level: "Request new level",
  remove_level: "Request level removal",
  add_department: "Request department",
  remove_department: "Request removal",
  set_department_scope: "Request scope change",
  add_discipline: "Request Program & Study",
  remove_discipline: "Request removal",
  move_discipline: "Request move",
};

/* ------------------------------- description ------------------------------ */

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {});
const str = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

/** "Weekly and Monthly input" · "Weekly input" · "Monthly input" · "No reporting input". */
export function reportingInputText(weekly: unknown, monthly: unknown): string {
  if (weekly === true && monthly === true) return "Weekly and Monthly input";
  if (weekly === true) return "Weekly input";
  if (monthly === true) return "Monthly input";
  return "No reporting input";
}

const named = (name: string | undefined, code: unknown) =>
  `${name ?? "Unit"}${str(code) ? ` (${str(code)})` : ""}`;
const systemsText = (names: string[]) => (names.length ? names.join(", ") : "No systems");
const reportsText = (value: unknown) => (value === true ? "reports" : "does not report");

export interface StructureChangeDescription {
  /** What changes, e.g. "Rename Unit · Pump House". */
  title: string;
  /** The target before the change, in business words. */
  from: string;
  /** The target after the change. */
  to: string;
}

/** A structure request in business words — never an id, "null" or a raw payload. */
export function describeStructureChange(
  amendment: Pick<SetupAmendment, "fieldKey" | "previousValue" | "proposedValue">
): StructureChangeDescription {
  const proposed = obj(amendment.proposedValue);
  const state = obj(amendment.previousValue);
  const labels = obj(proposed.labels);
  const action = str(proposed.action) as StructureAction | undefined;
  const target = str(labels.target) ?? "the structure";
  const level = str(labels.level) ?? "unit";
  const unit = obj(state.unit);
  const levelState = obj(state.level);
  const assignment = obj(state.assignment);

  switch (action) {
    case "add":
      return {
        title: `Add ${level} · ${str(proposed.name) ?? target}`,
        from: "Not in the structure",
        to: `${named(str(proposed.name), proposed.code)} ${str(labels.parent) ? `under ${str(labels.parent)}` : "at the top level"} · ${reportingInputText(proposed.weekly_reporting_required, proposed.monthly_reporting_required)}`,
      };
    case "rename":
      return {
        title: `Rename ${level} · ${target}`,
        from: named(str(unit.name) ?? target, unit.code),
        to: named(str(proposed.name), proposed.code),
      };
    case "move":
      return {
        title: `Move ${level} · ${target}`,
        from: `Under ${str(labels.current_parent) ?? "the top level"}`,
        to: `Under ${str(labels.parent) ?? "the chosen parent"}`,
      };
    case "archive":
      return { title: `Archive ${level} · ${target}`, from: "Active", to: "Archived (owes no reporting input)" };
    case "restore":
      return { title: `Restore ${level} · ${target}`, from: "Archived", to: "Active" };
    case "set_reporting_scope":
      return {
        title: `Change reporting input · ${target}`,
        from: reportingInputText(unit.weekly_reporting_required, unit.monthly_reporting_required),
        to: reportingInputText(proposed.weekly_reporting_required, proposed.monthly_reporting_required),
      };
    case "rename_level":
      return {
        title: `Rename level ${String(proposed.level_number ?? "")} · ${target}`.trim(),
        from: `${str(levelState.singular_label) ?? target} / ${str(levelState.plural_label) ?? str(labels.current_plural) ?? ""}`,
        to: `${str(proposed.singular_label) ?? ""} / ${str(proposed.plural_label) ?? ""}`,
      };
    case "add_level":
      return {
        title: `Add level ${String(proposed.level_number ?? "")} · ${str(proposed.singular_label) ?? target}`,
        from: `${String(state.level_count ?? "")} level${state.level_count === 1 ? "" : "s"}`.trim(),
        to: `New deepest level: ${str(proposed.singular_label) ?? ""} / ${str(proposed.plural_label) ?? ""}`,
      };
    case "remove_level":
      return {
        title: `Remove level ${String(proposed.level_number ?? "")} · ${target}`,
        from: `${str(levelState.singular_label) ?? target} / ${str(levelState.plural_label) ?? ""}`,
        to: "Removed (it has no units)",
      };
    case "add_department":
      return {
        title: `Add department · ${target}`,
        from: "Not in the project",
        to: `${systemsText(list(labels.systems))} · ${reportsText(proposed.reporting_required)}`,
      };
    case "remove_department":
      return {
        title: `Remove department · ${target}`,
        from: `${systemsText(list(labels.current_systems))} · ${reportsText(labels.current_reporting_required ?? assignment.reporting_required)}`,
        to: "Removed from the project",
      };
    case "set_department_scope":
      return {
        title: `Change department scope · ${target}`,
        from: `${systemsText(list(labels.current_systems))} · ${reportsText(labels.current_reporting_required ?? assignment.reporting_required)}`,
        to: `${systemsText(list(labels.systems))} · ${reportsText(proposed.reporting_required)}`,
      };
    case "add_discipline":
      return {
        title: `Add Program & Study · ${target}`,
        from: "Not in the project",
        to: [str(labels.department), str(labels.system)].filter(Boolean).join(" · ") || "Chosen department",
      };
    case "move_discipline":
      return {
        title: `Move Program & Study · ${target}`,
        from: [str(labels.current_department), str(labels.current_system) ?? "no system"].filter(Boolean).join(" · "),
        to: [str(labels.department), str(labels.system) ?? "no system"].filter(Boolean).join(" · "),
      };
    case "remove_discipline":
      return {
        title: `Remove Program & Study · ${target}`,
        from: [str(labels.current_department), str(labels.current_system)].filter(Boolean).join(" · ") || "In the project",
        to: "Removed from the project",
      };
    default:
      return {
        title: setupFieldEntry(amendment.fieldKey)?.label ?? "Structure change",
        from: "Current structure",
        to: "Proposed structure",
      };
  }
}

/* ------------------------- one wording for both kinds --------------------- */

/**
 * The subject and before / after of ANY amendment, so the approval queue, the
 * amendments panel and Project History word field and structure requests the
 * same way. `formatField` words a field amendment's {column: value}.
 */
export function amendmentWording(
  amendment: Pick<SetupAmendment, "fieldKey" | "targetKey" | "previousValue" | "proposedValue">,
  formatField: (fieldKey: string, value: Readonly<Record<string, unknown>>) => string
): { subject: string; previous: string; proposed: string } {
  if (isStructureAmendment(amendment)) {
    const described = describeStructureChange(amendment);
    return { subject: described.title, previous: described.from, proposed: described.to };
  }
  return {
    subject: setupFieldEntry(amendment.fieldKey)?.label ?? amendment.fieldKey.replace(/_/g, " "),
    previous: formatField(amendment.fieldKey, amendment.previousValue),
    proposed: formatField(amendment.fieldKey, amendment.proposedValue),
  };
}

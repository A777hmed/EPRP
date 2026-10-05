import type { ProjectStructure, ProjectStructureNode } from "@/types/project-structure";
import type { ProjectStructureActions } from "./structure-workspace-contract";
import {
  canArchiveNode, canDeleteNode, canMoveNode, canRestoreNode, canSetReportingFlags,
  findLevel, isActiveNode, nodeInputIssues, pathOf, type StructureIssue, type StructureRuleReason,
} from "./structure-rules";
import { ProjectStructureError } from "@/services/project-structure-errors";

export type StructureUnitIntent =
  | { mode: "create"; levelNumber: number; parentId?: string }
  | { mode: "details" | "reporting" | "move" | "archive" | "restore" | "delete"; node: ProjectStructureNode };

/** Form fields, not another structure model. Existing records are passed intact to actions. */
export interface StructureUnitFields {
  name: string;
  code: string;
  description: string;
  parentId: string;
  weeklyReportingRequired: boolean;
  monthlyReportingRequired: boolean;
}

export interface StructureUnitFormIssue {
  field?: keyof StructureUnitFields;
  message: string;
}

export function unitLabels(structure: ProjectStructure, levelNumber: number) {
  const level = findLevel(structure.levels, levelNumber);
  return { singular: level?.singularLabel ?? "Item", plural: level?.pluralLabel ?? "Items" };
}

export function unitPathLabel(structure: ProjectStructure, id: string): string {
  return pathOf(structure.nodes, id).map((entry) => entry.name).join(" › ");
}

export function initialUnitFields(intent: StructureUnitIntent): StructureUnitFields {
  const node = intent.mode === "create" ? undefined : intent.node;
  return {
    name: node?.name ?? "", code: node?.code ?? "", description: node?.description ?? "",
    parentId: node?.parentId ?? (intent.mode === "create" ? intent.parentId : undefined) ?? "",
    weeklyReportingRequired: node?.weeklyReportingRequired ?? false,
    monthlyReportingRequired: node?.monthlyReportingRequired ?? false,
  };
}

export function unitRuleMessage(reason: StructureRuleReason | undefined): string {
  switch (reason) {
    case "active_children": return "Archive the active children first. This change never cascades.";
    case "has_children": return "This item still has children, including archived children. Archive it instead.";
    case "parent_archived": return "Restore the parent first, then try again.";
    case "duplicate_name": return "Another active item under that parent already uses this name.";
    case "duplicate_code": return "Another active item in this project already uses this code.";
    case "wrong_level": return "Choose a parent from the hierarchy type immediately above.";
    case "same_parent": return "Choose a different parent to move this item.";
    case "reporting_overlap": return "Weekly or Monthly input already belongs to another item on this branch. Choose one input owner for each report type.";
    case "archived": return "Archived items cannot own reporting input, accept children or move. Restore this item first.";
    case "deepest_level": return "This is the deepest hierarchy type; no child type is configured.";
    case "not_found": return "This item or its parent is no longer available. Reload the hierarchy.";
    case "not_archived": return "This item is already active.";
    default: return "Check this change before saving.";
  }
}

function inputIssueMessage(issue: StructureIssue): string {
  switch (issue.code) {
    case "name_required": return "Enter a name.";
    case "name_too_long": return "Use a name of at most 140 characters.";
    case "code_too_long": return "Use a code of at most 40 characters.";
    case "description_too_long": return "Use a description of at most 2,000 characters.";
    case "duplicate_name": return unitRuleMessage("duplicate_name");
    case "duplicate_code": return unitRuleMessage("duplicate_code");
    case "parent_required": return "Select the parent before saving.";
    case "parent_archived": return unitRuleMessage("parent_archived");
    case "parent_level": return unitRuleMessage("wrong_level");
    case "parent_not_allowed": return "The first hierarchy type has no parent.";
    case "level_undefined": return "This hierarchy type is no longer configured. Reload before adding an item.";
    case "reporting_overlap": return unitRuleMessage("reporting_overlap");
    default: return "Check the fields before saving.";
  }
}

const descriptiveCodes = new Set<StructureIssue["code"]>([
  "name_required", "name_too_long", "code_too_long", "description_too_long", "duplicate_name", "duplicate_code",
]);

/** Uses domain previews for every operation; no second implementation of their rules. */
export function unitFormIssues(structure: ProjectStructure, intent: StructureUnitIntent, fields: StructureUnitFields): StructureUnitFormIssue[] {
  if (intent.mode === "create" || intent.mode === "details") {
    const node = intent.mode === "details" ? intent.node : undefined;
    const input = { ...fields, levelNumber: node?.levelNumber ?? (intent.mode === "create" ? intent.levelNumber : 1), parentId: fields.parentId || undefined };
    const scope = node ? { ...structure, nodes: structure.nodes.filter((entry) => entry.id !== node.id) } : structure;
    const issues = nodeInputIssues(scope, node ? { ...input, weeklyReportingRequired: false, monthlyReportingRequired: false } : input);
    return issues.filter((issue) => !node || (descriptiveCodes.has(issue.code)
      && (isActiveNode(node) || !["duplicate_name", "duplicate_code"].includes(issue.code))))
      .map((issue) => ({
        field: issue.field && issue.field !== "levelNumber" && issue.field !== "singularLabel" && issue.field !== "pluralLabel" ? issue.field : undefined,
        message: inputIssueMessage(issue),
      }));
  }
  const { node } = intent;
  const verdict = intent.mode === "move"
    ? (isActiveNode(node) ? canMoveNode(structure, node.id, fields.parentId) : { ok: false, reason: "archived" as const })
    : intent.mode === "reporting" ? canSetReportingFlags(structure.nodes, { nodeId: node.id, weeklyReportingRequired: fields.weeklyReportingRequired, monthlyReportingRequired: fields.monthlyReportingRequired })
    : intent.mode === "archive" ? canArchiveNode(structure.nodes, node.id)
    : intent.mode === "restore" ? canRestoreNode(structure.nodes, node.id)
    : canDeleteNode(structure.nodes, node.id);
  return verdict.ok ? [] : [{ field: intent.mode === "move" ? "parentId" : undefined, message: unitRuleMessage(verdict.reason) }];
}

/** Exactly one write per explicit save. The original record supplies its existing concurrency token. */
export async function saveStructureUnit(actions: ProjectStructureActions, intent: StructureUnitIntent, fields: StructureUnitFields): Promise<void> {
  switch (intent.mode) {
    case "create": await actions.createNode({
      levelNumber: intent.levelNumber, parentId: fields.parentId || undefined,
      name: fields.name.trim(), code: fields.code.trim(), description: fields.description.trim(),
      weeklyReportingRequired: fields.weeklyReportingRequired, monthlyReportingRequired: fields.monthlyReportingRequired,
    }); break;
    case "details": await actions.updateNode(intent.node, { name: fields.name.trim(), code: fields.code.trim(), description: fields.description.trim() }); break;
    case "move": await actions.moveNode(intent.node, fields.parentId); break;
    case "reporting": await actions.setReportingFlags(intent.node, { weeklyReportingRequired: fields.weeklyReportingRequired, monthlyReportingRequired: fields.monthlyReportingRequired }); break;
    case "archive": await actions.archiveNode(intent.node); break;
    case "restore": await actions.restoreNode(intent.node); break;
    case "delete": await actions.deleteNode(intent.node); break;
  }
}

export function unitActionError(error: unknown, singular: string): { message: string; reload: boolean } {
  if (!(error instanceof ProjectStructureError) || error.reason === "failed") return { message: "The save could not be confirmed. Your edits are kept. Reload the hierarchy before trying again.", reload: true };
  const reload = error.reason === "stale" || error.reason === "not_found";
  if (error.reason === "stale") return { message: `This ${singular} changed since you opened it. Your edits are kept. Reload the current hierarchy before trying again.`, reload };
  return {
    message: error.message.replace(/structure unit/gi, singular).replace(/\bunits\b/gi, "items").replace(/\bunit\b/gi, singular),
    reload,
  };
}

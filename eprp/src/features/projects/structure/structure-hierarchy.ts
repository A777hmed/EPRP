import type { ProjectStructure } from "@/types/project-structure";
import {
  archivedNodes,
  buildStructureTree,
  findLevel,
  isActiveNode,
  nodesByLevel,
  sortLevels,
  type StructureTreeNode,
} from "./structure-rules";
import { levelRelation } from "./structure-patterns-ui";

/**
 * Read model for the Other project's Structure Hierarchy view.
 *
 * Pure and derived: it reads the same canonical `ProjectStructure` the Manage
 * View edits (through the existing structure rules) and never stores,
 * copies or re-validates anything. Units only — people and responsibilities
 * are a later phase and are deliberately absent here.
 */

/** One configured level, in order, with how it relates to the level above. */
export interface HierarchyLevel {
  levelNumber: number;
  singular: string;
  plural: string;
  /** "Top structural level" or "Reports under <parent level>". */
  relation: string;
  /** True for the deepest configured level when there is more than one level. */
  lowest: boolean;
  activeCount: number;
}

/** One active unit as the hierarchy shows it. */
export interface HierarchyNode {
  id: string;
  name: string;
  code?: string;
  levelNumber: number;
  levelSingular: string;
  /** Name of the parent unit, for context; undefined at the first level. */
  parentName?: string;
  weeklyInputRequired: boolean;
  monthlyInputRequired: boolean;
  /** Plural label of the level below, when one is configured. */
  childLevelPlural?: string;
  /** Every active unit below this one, at any depth. */
  descendantCount: number;
  children: HierarchyNode[];
}

export interface StructureHierarchy {
  levels: HierarchyLevel[];
  roots: HierarchyNode[];
  activeCount: number;
  archivedCount: number;
  weeklyInputCount: number;
  monthlyInputCount: number;
}

function toView(
  entry: StructureTreeNode,
  structure: Pick<ProjectStructure, "levels">,
  parentName: string | undefined
): HierarchyNode {
  const { node, level } = entry;
  const children = entry.children.map((child) => toView(child, structure, node.name));
  return {
    id: node.id,
    name: node.name,
    code: node.code || undefined,
    levelNumber: node.levelNumber,
    levelSingular: level?.singularLabel ?? `Level ${node.levelNumber}`,
    parentName,
    weeklyInputRequired: node.weeklyReportingRequired,
    monthlyInputRequired: node.monthlyReportingRequired,
    childLevelPlural: findLevel(structure.levels, node.levelNumber + 1)?.pluralLabel,
    descendantCount: children.reduce((total, child) => total + 1 + child.descendantCount, 0),
    children,
  };
}

/** Active units only, as one tree, with per-level context and summary counts. */
export function buildStructureHierarchy(
  structure: Pick<ProjectStructure, "levels" | "nodes">
): StructureHierarchy {
  const levels = sortLevels(structure.levels);
  const active = nodesByLevel(structure);
  const roots = buildStructureTree(structure).map((entry) => toView(entry, structure, undefined));
  const activeCount = [...active.values()].reduce((total, group) => total + group.length, 0);
  const all = (nodes: HierarchyNode[]): HierarchyNode[] => nodes.flatMap((node) => [node, ...all(node.children)]);
  const units = all(roots);
  return {
    levels: levels.map((level, index) => ({
      levelNumber: level.levelNumber,
      singular: level.singularLabel,
      plural: level.pluralLabel,
      relation: levelRelation(levels, level.levelNumber),
      lowest: levels.length > 1 && index === levels.length - 1,
      activeCount: active.get(level.levelNumber)?.length ?? 0,
    })),
    roots,
    activeCount,
    archivedCount: archivedNodes(structure.nodes).length,
    weeklyInputCount: units.filter((unit) => unit.weeklyInputRequired).length,
    monthlyInputCount: units.filter((unit) => unit.monthlyInputRequired).length,
  };
}

export type StructureViewMode = "hierarchy" | "manage";

/**
 * The view a visit opens on: the Hierarchy View once there is something to
 * look at, the Manage View while the structure is still empty. Chosen once
 * per visit, so adding the first unit never pulls the user out of Manage.
 */
export function defaultStructureView(structure: Pick<ProjectStructure, "nodes">): StructureViewMode {
  return structure.nodes.some(isActiveNode) ? "hierarchy" : "manage";
}

/** Ids of every unit that has children — the branches "Collapse all" folds. */
export function branchIds(nodes: readonly HierarchyNode[]): string[] {
  return nodes.flatMap((node) => (node.children.length > 0 ? [node.id, ...branchIds(node.children)] : []));
}

/** "1 Package" / "3 Packages", falling back to "unit(s)" when no label exists. */
export function countLabel(count: number, singular?: string, plural?: string): string {
  const one = singular?.trim() || "unit";
  const many = plural?.trim() || "units";
  return `${count} ${count === 1 ? one : many}`;
}

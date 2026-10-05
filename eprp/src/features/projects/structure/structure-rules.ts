import {
  MAX_STRUCTURE_LEVELS,
  type CreateStructureNodeInput,
  type ProjectStructure,
  type ProjectStructureLevel,
  type ProjectStructureNode,
  type StructureLevelInput,
  type StructureReportKind,
  type StructureReportingScope,
} from "@/types/project-structure";

/**
 * Other Project structure rules (Phase 2C.1c) — pure and deterministic.
 *
 * The database is the authority: it enforces every rule here (levels 1..n
 * without gaps, a parent exactly one level up in the same project, archive
 * order, unique active names and codes, no nested reporting overlap). These
 * helpers exist so the UI can say what is possible before it asks, and so an
 * obviously invalid request never reaches the database as a raw error. They
 * never grant anything the database would refuse.
 *
 * Nothing here knows about departments, systems, disciplines or Planning.
 */

export const STRUCTURE_LABEL_MAX = 60;
export const STRUCTURE_NODE_NAME_MAX = 140;
export const STRUCTURE_NODE_CODE_MAX = 40;
export const STRUCTURE_NODE_DESCRIPTION_MAX = 2000;

const REPORT_KINDS: readonly StructureReportKind[] = ["weekly", "monthly"];

/** The structure of a project with nothing configured yet. */
export function emptyProjectStructure(projectId: string, version: string): ProjectStructure {
  return { projectId, version, levels: [], nodes: [] };
}

/* ------------------------------- ordering --------------------------------- */

export function sortLevels(levels: readonly ProjectStructureLevel[]): ProjectStructureLevel[] {
  return [...levels].sort((a, b) => a.levelNumber - b.levelNumber);
}

/**
 * Display order among units: level, then the chosen sort order, then name
 * (case-insensitive), then id — so the order is total and never depends on
 * how rows arrived.
 */
export function compareStructureNodes(a: ProjectStructureNode, b: ProjectStructureNode): number {
  return (
    a.levelNumber - b.levelNumber ||
    a.sortOrder - b.sortOrder ||
    a.name.localeCompare(b.name, "en", { sensitivity: "base" }) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function sortNodes(nodes: readonly ProjectStructureNode[]): ProjectStructureNode[] {
  return [...nodes].sort(compareStructureNodes);
}

/* ------------------------------ membership -------------------------------- */

export function isActiveNode(node: ProjectStructureNode): boolean {
  return node.archivedAt === undefined;
}

export function activeNodes(nodes: readonly ProjectStructureNode[]): ProjectStructureNode[] {
  return sortNodes(nodes.filter(isActiveNode));
}

export function archivedNodes(nodes: readonly ProjectStructureNode[]): ProjectStructureNode[] {
  return sortNodes(nodes.filter((node) => !isActiveNode(node)));
}

export function findNode(
  nodes: readonly ProjectStructureNode[],
  id: string | undefined
): ProjectStructureNode | undefined {
  return id === undefined ? undefined : nodes.find((node) => node.id === id);
}

export function findLevel(
  levels: readonly ProjectStructureLevel[],
  levelNumber: number
): ProjectStructureLevel | undefined {
  return levels.find((level) => level.levelNumber === levelNumber);
}

/** The deepest defined level number, or 0 when no level is defined. */
export function deepestLevelNumber(levels: readonly ProjectStructureLevel[]): number {
  return levels.reduce((max, level) => Math.max(max, level.levelNumber), 0);
}

/* -------------------------------- the tree -------------------------------- */

export interface TreeOptions {
  /** Include archived units (default: active units only). */
  includeArchived?: boolean;
}

function scoped(nodes: readonly ProjectStructureNode[], options: TreeOptions = {}) {
  return options.includeArchived ? [...nodes] : nodes.filter(isActiveNode);
}

export function rootNodes(
  nodes: readonly ProjectStructureNode[],
  options: TreeOptions = {}
): ProjectStructureNode[] {
  return sortNodes(scoped(nodes, options).filter((node) => node.parentId === undefined));
}

/** Children grouped by parent id; roots are under `null`. Each group sorted. */
export function childrenByParent(
  nodes: readonly ProjectStructureNode[],
  options: TreeOptions = {}
): Map<string | null, ProjectStructureNode[]> {
  const groups = new Map<string | null, ProjectStructureNode[]>();
  for (const node of sortNodes(scoped(nodes, options))) {
    const key = node.parentId ?? null;
    const group = groups.get(key);
    if (group) group.push(node);
    else groups.set(key, [node]);
  }
  return groups;
}

export function childrenOf(
  nodes: readonly ProjectStructureNode[],
  parentId: string,
  options: TreeOptions = {}
): ProjectStructureNode[] {
  return sortNodes(scoped(nodes, options).filter((node) => node.parentId === parentId));
}

/**
 * Ancestors of a unit, root first, excluding the unit itself. Stops at a
 * missing parent and never loops (at most three steps above level 4).
 */
export function ancestorsOf(
  nodes: readonly ProjectStructureNode[],
  nodeId: string
): ProjectStructureNode[] {
  const path: ProjectStructureNode[] = [];
  const seen = new Set<string>([nodeId]);
  let parent = findNode(nodes, findNode(nodes, nodeId)?.parentId);
  while (parent && !seen.has(parent.id)) {
    path.unshift(parent);
    seen.add(parent.id);
    parent = findNode(nodes, parent.parentId);
  }
  return path;
}

/** The unit and its ancestors, root first — e.g. Package › Area › Discipline. */
export function pathOf(
  nodes: readonly ProjectStructureNode[],
  nodeId: string
): ProjectStructureNode[] {
  const node = findNode(nodes, nodeId);
  return node ? [...ancestorsOf(nodes, nodeId), node] : [];
}

/** Every descendant, depth-first in display order (archived included). */
export function descendantsOf(
  nodes: readonly ProjectStructureNode[],
  nodeId: string
): ProjectStructureNode[] {
  const groups = childrenByParent(nodes, { includeArchived: true });
  const result: ProjectStructureNode[] = [];
  const seen = new Set<string>([nodeId]);
  const visit = (id: string) => {
    for (const child of groups.get(id) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      result.push(child);
      visit(child.id);
    }
  };
  visit(nodeId);
  return result;
}

/** Units grouped by level number, for every defined level (empty levels included). */
export function nodesByLevel(
  structure: Pick<ProjectStructure, "levels" | "nodes">,
  options: TreeOptions = {}
): Map<number, ProjectStructureNode[]> {
  const groups = new Map<number, ProjectStructureNode[]>();
  for (const level of sortLevels(structure.levels)) groups.set(level.levelNumber, []);
  for (const node of sortNodes(scoped(structure.nodes, options))) {
    groups.get(node.levelNumber)?.push(node);
  }
  return groups;
}

export interface StructureTreeNode {
  node: ProjectStructureNode;
  level?: ProjectStructureLevel;
  children: StructureTreeNode[];
}

/**
 * The structure as a tree, in display order. A unit whose parent is outside
 * the chosen scope (e.g. an active unit under an archived parent, which the
 * database never allows) is not silently promoted to a root.
 */
export function buildStructureTree(
  structure: Pick<ProjectStructure, "levels" | "nodes">,
  options: TreeOptions = {}
): StructureTreeNode[] {
  const groups = childrenByParent(structure.nodes, options);
  const levelOf = (n: number) => findLevel(structure.levels, n);
  const build = (node: ProjectStructureNode, seen: Set<string>): StructureTreeNode => ({
    node,
    level: levelOf(node.levelNumber),
    children: (groups.get(node.id) ?? [])
      .filter((child) => !seen.has(child.id))
      .map((child) => build(child, new Set([...seen, child.id]))),
  });
  return (groups.get(null) ?? []).map((root) => build(root, new Set([root.id])));
}

/* ------------------------------- reporting -------------------------------- */

function owes(node: ProjectStructureNode, kind: StructureReportKind): boolean {
  return kind === "weekly" ? node.weeklyReportingRequired : node.monthlyReportingRequired;
}

/** Active units owing operational input for one report, in display order. */
export function reportingNodes(
  nodes: readonly ProjectStructureNode[],
  kind: StructureReportKind
): ProjectStructureNode[] {
  return activeNodes(nodes).filter((node) => owes(node, kind));
}

export function reportingScope(nodes: readonly ProjectStructureNode[]): StructureReportingScope {
  return { weekly: reportingNodes(nodes, "weekly"), monthly: reportingNodes(nodes, "monthly") };
}

export interface ReportingOverlap {
  kind: StructureReportKind;
  /** The unit higher up the branch. */
  ancestorId: string;
  /** The unit below it that also owes the same report. */
  descendantId: string;
}

/**
 * Every place where a unit and one of its ancestors both owe the same report
 * — the condition the database refuses. Different reports on one branch are
 * not an overlap.
 */
export function findReportingOverlaps(nodes: readonly ProjectStructureNode[]): ReportingOverlap[] {
  const overlaps: ReportingOverlap[] = [];
  for (const node of sortNodes(nodes)) {
    for (const kind of REPORT_KINDS) {
      if (!owes(node, kind)) continue;
      for (const ancestor of ancestorsOf(nodes, node.id)) {
        if (owes(ancestor, kind)) {
          overlaps.push({ kind, ancestorId: ancestor.id, descendantId: node.id });
        }
      }
    }
  }
  return overlaps;
}

/** A proposed change to one unit's flags or parent. */
export interface StructureNodeChange {
  nodeId: string;
  weeklyReportingRequired?: boolean;
  monthlyReportingRequired?: boolean;
  parentId?: string;
}

/**
 * Which reports would overlap after this change (empty when it is fine). Only
 * overlaps the change introduces are reported, so an unrelated existing one
 * never blames this action.
 */
export function reportingOverlapAfter(
  nodes: readonly ProjectStructureNode[],
  change: StructureNodeChange
): StructureReportKind[] {
  const key = (o: ReportingOverlap) => `${o.kind}:${o.ancestorId}:${o.descendantId}`;
  const before = new Set(findReportingOverlaps(nodes).map(key));
  const next = nodes.map((node) =>
    node.id === change.nodeId
      ? {
          ...node,
          weeklyReportingRequired: change.weeklyReportingRequired ?? node.weeklyReportingRequired,
          monthlyReportingRequired: change.monthlyReportingRequired ?? node.monthlyReportingRequired,
          parentId: change.parentId ?? node.parentId,
        }
      : node
  );
  const introduced = findReportingOverlaps(next).filter((o) => !before.has(key(o)));
  return REPORT_KINDS.filter((kind) => introduced.some((o) => o.kind === kind));
}

/* ------------------------------ what is allowed --------------------------- */

export type StructureRuleReason =
  | "not_found"
  | "archived"
  | "not_archived"
  | "deepest_level"
  | "active_children"
  | "parent_archived"
  | "has_children"
  | "same_parent"
  | "wrong_level"
  | "duplicate_name"
  | "duplicate_code"
  | "reporting_overlap";

export interface RuleResult {
  ok: boolean;
  reason?: StructureRuleReason;
}

const allow: RuleResult = { ok: true };
const deny = (reason: StructureRuleReason): RuleResult => ({ ok: false, reason });

/** Whether a child unit may be added under this one. */
export function canAcceptChild(
  structure: Pick<ProjectStructure, "levels" | "nodes">,
  nodeId: string
): RuleResult {
  const node = findNode(structure.nodes, nodeId);
  if (!node) return deny("not_found");
  if (!isActiveNode(node)) return deny("archived");
  if (!findLevel(structure.levels, node.levelNumber + 1)) return deny("deepest_level");
  return allow;
}

/**
 * Where a unit may sit: the active units exactly one level up. Level-1 units
 * have no parent, so the list is empty for them.
 */
export function parentCandidates(
  structure: Pick<ProjectStructure, "levels" | "nodes">,
  levelNumber: number
): ProjectStructureNode[] {
  if (levelNumber <= 1 || !findLevel(structure.levels, levelNumber)) return [];
  return activeNodes(structure.nodes).filter((node) => node.levelNumber === levelNumber - 1);
}

/** An active unit, other than `self`, that the database would see as a duplicate. */
function activeConflict(
  nodes: readonly ProjectStructureNode[],
  self: ProjectStructureNode,
  parentId: string | undefined
): "duplicate_name" | "duplicate_code" | undefined {
  const others = nodes.filter((other) => other.id !== self.id && isActiveNode(other));
  if (others.some((other) => (other.parentId ?? null) === (parentId ?? null) && norm(other.name) === norm(self.name))) {
    return "duplicate_name";
  }
  if (self.code && others.some((other) => other.code && norm(other.code) === norm(self.code as string))) {
    return "duplicate_code";
  }
  return undefined;
}

/** Whether a unit may move under `parentId` (same level, active parent, unique name, no overlap). */
export function canMoveNode(
  structure: Pick<ProjectStructure, "levels" | "nodes">,
  nodeId: string,
  parentId: string
): RuleResult {
  const node = findNode(structure.nodes, nodeId);
  const parent = findNode(structure.nodes, parentId);
  if (!node || !parent) return deny("not_found");
  if (parent.levelNumber !== node.levelNumber - 1) return deny("wrong_level");
  if (node.parentId === parentId) return deny("same_parent");
  if (isActiveNode(node) && !isActiveNode(parent)) return deny("parent_archived");
  if (isActiveNode(node) && activeConflict(structure.nodes, node, parentId) === "duplicate_name") {
    return deny("duplicate_name");
  }
  if (reportingOverlapAfter(structure.nodes, { nodeId, parentId }).length > 0) {
    return deny("reporting_overlap");
  }
  return allow;
}

/** Archive needs every child archived first. Archiving clears the reporting flags. */
export function canArchiveNode(nodes: readonly ProjectStructureNode[], nodeId: string): RuleResult {
  const node = findNode(nodes, nodeId);
  if (!node) return deny("not_found");
  if (!isActiveNode(node)) return deny("archived");
  if (childrenOf(nodes, nodeId).length > 0) return deny("active_children");
  return allow;
}

/**
 * Restore needs an active parent (a level-1 unit always has one) and no
 * active unit already using its name (among siblings) or its code.
 */
export function canRestoreNode(nodes: readonly ProjectStructureNode[], nodeId: string): RuleResult {
  const node = findNode(nodes, nodeId);
  if (!node) return deny("not_found");
  if (isActiveNode(node)) return deny("not_archived");
  const parent = findNode(nodes, node.parentId);
  if (node.parentId !== undefined && (!parent || !isActiveNode(parent))) return deny("parent_archived");
  const conflict = activeConflict(nodes, node, node.parentId);
  if (conflict) return deny(conflict);
  return allow;
}

/** Delete is only for a unit with no children at all (archived ones included). */
export function canDeleteNode(nodes: readonly ProjectStructureNode[], nodeId: string): RuleResult {
  if (!findNode(nodes, nodeId)) return deny("not_found");
  if (nodes.some((node) => node.parentId === nodeId)) return deny("has_children");
  return allow;
}

/** Whether setting these flags is possible: active unit, no new overlap. */
export function canSetReportingFlags(
  nodes: readonly ProjectStructureNode[],
  change: StructureNodeChange
): RuleResult {
  const node = findNode(nodes, change.nodeId);
  if (!node) return deny("not_found");
  const turningOn = change.weeklyReportingRequired === true || change.monthlyReportingRequired === true;
  if (turningOn && !isActiveNode(node)) return deny("archived");
  if (reportingOverlapAfter(nodes, change).length > 0) return deny("reporting_overlap");
  return allow;
}

/* ------------------------------- validation ------------------------------- */

export type StructureIssueCode =
  | "level_count"
  | "level_limit"
  | "level_gap"
  | "label_required"
  | "label_too_long"
  | "duplicate_label"
  | "level_in_use"
  | "new_level_has_id"
  | "name_required"
  | "name_too_long"
  | "code_too_long"
  | "description_too_long"
  | "level_undefined"
  | "parent_required"
  | "parent_not_allowed"
  | "parent_level"
  | "parent_archived"
  | "duplicate_name"
  | "duplicate_code"
  | "reporting_overlap";

export interface StructureIssue {
  code: StructureIssueCode;
  /** Which level (1-based) or field the issue is about, when there is one. */
  levelNumber?: number;
  field?: "name" | "code" | "description" | "parentId" | "levelNumber" | "singularLabel" | "pluralLabel";
}

const blank = (value: string | undefined) => !value || value.trim() === "";
const norm = (value: string) => value.trim().toLowerCase();

/**
 * Checks a complete desired level set against the rules the level RPC
 * applies. With units present, a kept level must carry its own id at its own
 * number (rename only), new levels go below the deepest one, and only the
 * deepest levels with no units at all may be removed.
 */
export function levelConfigurationIssues(
  structure: Pick<ProjectStructure, "levels" | "nodes">,
  next: readonly StructureLevelInput[]
): StructureIssue[] {
  const issues: StructureIssue[] = [];
  if (next.length === 0) return [{ code: "level_count" }];
  if (next.length > MAX_STRUCTURE_LEVELS) return [{ code: "level_limit" }];

  const numbers = next.map((level) => level.levelNumber);
  const contiguous = [...numbers].sort((a, b) => a - b).every((n, index) => n === index + 1);
  if (!contiguous || new Set(numbers).size !== numbers.length) issues.push({ code: "level_gap" });

  for (const level of next) {
    for (const field of ["singularLabel", "pluralLabel"] as const) {
      if (blank(level[field])) issues.push({ code: "label_required", levelNumber: level.levelNumber, field });
      else if (level[field].trim().length > STRUCTURE_LABEL_MAX) {
        issues.push({ code: "label_too_long", levelNumber: level.levelNumber, field });
      }
    }
  }
  for (const field of ["singularLabel", "pluralLabel"] as const) {
    const seen = new Set<string>();
    for (const level of next) {
      if (blank(level[field])) continue;
      const key = norm(level[field]);
      if (seen.has(key)) issues.push({ code: "duplicate_label", levelNumber: level.levelNumber, field });
      seen.add(key);
    }
  }

  // Exactly the committed RPC's rules once units exist (ids are ignored while
  // the structure has no units, as the RPC ignores them).
  if (structure.nodes.length > 0 && contiguous) {
    const current = sortLevels(structure.levels);
    for (const level of current) {
      const proposed = next.find((entry) => entry.levelNumber === level.levelNumber);
      // A kept level carries its own id at its own, unchanged number.
      if (proposed && proposed.id !== level.id) {
        issues.push({ code: "level_in_use", levelNumber: level.levelNumber });
      }
      // A removed level may hold no unit at all (archived ones included).
      if (!proposed && structure.nodes.some((node) => node.levelNumber === level.levelNumber)) {
        issues.push({ code: "level_in_use", levelNumber: level.levelNumber });
      }
    }
    // An appended level is new: it never carries an id, so it can never
    // masquerade as a kept level.
    for (const entry of next) {
      if (entry.levelNumber > current.length && entry.id !== undefined && entry.id !== "") {
        issues.push({ code: "new_level_has_id", levelNumber: entry.levelNumber });
      }
    }
  }
  return issues;
}

/** Checks a new unit against the structure it joins. */
export function nodeInputIssues(
  structure: Pick<ProjectStructure, "levels" | "nodes">,
  input: Omit<CreateStructureNodeInput, "projectId">
): StructureIssue[] {
  const issues: StructureIssue[] = [];
  const name = input.name?.trim() ?? "";
  if (!name) issues.push({ code: "name_required", field: "name" });
  else if (name.length > STRUCTURE_NODE_NAME_MAX) issues.push({ code: "name_too_long", field: "name" });
  const code = input.code?.trim() ?? "";
  if (code.length > STRUCTURE_NODE_CODE_MAX) issues.push({ code: "code_too_long", field: "code" });
  if ((input.description ?? "").length > STRUCTURE_NODE_DESCRIPTION_MAX) {
    issues.push({ code: "description_too_long", field: "description" });
  }

  if (!findLevel(structure.levels, input.levelNumber)) {
    issues.push({ code: "level_undefined", field: "levelNumber" });
    return issues;
  }
  if (input.levelNumber === 1 && input.parentId !== undefined) {
    issues.push({ code: "parent_not_allowed", field: "parentId" });
  }
  if (input.levelNumber > 1) {
    const parent = findNode(structure.nodes, input.parentId);
    if (!parent) issues.push({ code: "parent_required", field: "parentId" });
    else if (parent.levelNumber !== input.levelNumber - 1) issues.push({ code: "parent_level", field: "parentId" });
    else if (!isActiveNode(parent)) issues.push({ code: "parent_archived", field: "parentId" });
  }

  const siblings = activeNodes(structure.nodes).filter(
    (node) => (node.parentId ?? null) === (input.levelNumber === 1 ? null : input.parentId ?? null)
  );
  if (name && siblings.some((node) => norm(node.name) === norm(name))) {
    issues.push({ code: "duplicate_name", field: "name" });
  }
  if (code && activeNodes(structure.nodes).some((node) => node.code && norm(node.code) === norm(code))) {
    issues.push({ code: "duplicate_code", field: "code" });
  }

  if (input.weeklyReportingRequired || input.monthlyReportingRequired) {
    const probe: ProjectStructureNode = {
      id: "\u0000proposed",
      projectId: "",
      levelNumber: input.levelNumber as ProjectStructureNode["levelNumber"],
      parentId: input.levelNumber === 1 ? undefined : input.parentId,
      name,
      sortOrder: 0,
      weeklyReportingRequired: input.weeklyReportingRequired ?? false,
      monthlyReportingRequired: input.monthlyReportingRequired ?? false,
      createdAt: "",
      updatedAt: "",
    };
    if (findReportingOverlaps([...structure.nodes, probe]).some((o) => o.descendantId === probe.id)) {
      issues.push({ code: "reporting_overlap" });
    }
  }
  return issues;
}

/* ------------------------- completeness primitives ------------------------ */

/**
 * The facts a later setup step can judge completeness from. Deliberately not
 * a verdict: which of these are required (and whether Weekly / Monthly are
 * enabled for the project) is decided by the workflow slice, not here.
 */
export interface StructureCompleteness {
  levelCount: number;
  activeRootCount: number;
  /** Defined level numbers that have no active unit. */
  emptyLevels: number[];
  activeNodeCount: number;
  weeklyUnitCount: number;
  monthlyUnitCount: number;
}

export function structureCompleteness(
  structure: Pick<ProjectStructure, "levels" | "nodes">
): StructureCompleteness {
  const byLevel = nodesByLevel(structure);
  return {
    levelCount: structure.levels.length,
    activeRootCount: rootNodes(structure.nodes).length,
    emptyLevels: [...byLevel].filter(([, nodes]) => nodes.length === 0).map(([level]) => level),
    activeNodeCount: activeNodes(structure.nodes).length,
    weeklyUnitCount: reportingNodes(structure.nodes, "weekly").length,
    monthlyUnitCount: reportingNodes(structure.nodes, "monthly").length,
  };
}

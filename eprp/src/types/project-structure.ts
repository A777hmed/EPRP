/**
 * Other Project dynamic structure (Phase 2C.1c).
 *
 * An Other project defines its own hierarchy of 1–4 named levels (for example
 * Package → Area → Discipline) and its own units at those levels. The project
 * owns both; nothing here is shared master data, and none of it refers to the
 * PSM hierarchy (departments, systems, disciplines) or to Planning.
 *
 * Project Structure is the single authoritative place where an Other project
 * says which units owe Weekly / Monthly OPERATIONAL INPUT. Weekly and Monthly
 * will consume that scope later; they never re-declare it.
 *
 * Project Structure is NOT a planning WBS. A schedule hierarchy, when it
 * arrives, is a separate, revision-controlled entity that may map to these
 * units — never be generated from them or into them.
 */

/** A structure level's number — its structural identity. Never changes. */
export type StructureLevelNumber = 1 | 2 | 3 | 4;

/** The most levels a project structure may have. */
export const MAX_STRUCTURE_LEVELS = 4;

/** The report a unit may owe operational input to. */
export type StructureReportKind = "weekly" | "monthly";

/** One named level of a project's structure, e.g. level 2 = "Area" / "Areas". */
export interface ProjectStructureLevel {
  id: string;
  projectId: string;
  levelNumber: StructureLevelNumber;
  singularLabel: string;
  pluralLabel: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One unit of a project's structure.
 *
 * `weeklyReportingRequired` / `monthlyReportingRequired` mean OPERATIONAL
 * INPUT REQUIRED from this unit — not reviewer, approver, roll-up owner or
 * consolidated reporter. A unit and its own ancestor or descendant never both
 * owe the same report; different reports on one branch are fine.
 */
export interface ProjectStructureNode {
  id: string;
  projectId: string;
  levelNumber: StructureLevelNumber;
  /** Absent exactly for a level-1 unit. */
  parentId?: string;
  name: string;
  code?: string;
  description?: string;
  sortOrder: number;
  weeklyReportingRequired: boolean;
  monthlyReportingRequired: boolean;
  /** Set when the unit is archived; an archived unit owes no input. */
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A project's complete structure. A configured-but-empty Other project is
 * `levels: []`, `nodes: []` — never null, never seeded, never departments.
 */
export interface ProjectStructure {
  projectId: string;
  /**
   * The project version read BEFORE the levels and units, so an atomic level
   * change built on this snapshot is refused as stale rather than overwriting
   * anything newer. Any structure write advances it.
   */
  version: string;
  levels: ProjectStructureLevel[];
  nodes: ProjectStructureNode[];
}

/** The units owing operational input, per report. */
export interface StructureReportingScope {
  weekly: ProjectStructureNode[];
  monthly: ProjectStructureNode[];
}

/** One entry of the complete desired level set. */
export interface StructureLevelInput {
  /** The existing level's id; required to keep a level once units exist. */
  id?: string;
  levelNumber: number;
  singularLabel: string;
  pluralLabel: string;
}

/** Replaces the project's whole level set in one atomic save. */
export interface ConfigureStructureLevelsInput {
  projectId: string;
  /** `ProjectStructure.version` the change was built on. */
  expectedVersion: string;
  levels: StructureLevelInput[];
}

export interface CreateStructureNodeInput {
  projectId: string;
  levelNumber: number;
  /** Required for levels 2–4, absent for level 1. */
  parentId?: string;
  name: string;
  code?: string;
  description?: string;
  sortOrder?: number;
  weeklyReportingRequired?: boolean;
  monthlyReportingRequired?: boolean;
}

/**
 * A unit's descriptive fields. Only the keys present change; a blank `code`
 * or `description` clears it. Level, parent, reporting and archive state have
 * their own operations.
 */
export interface UpdateStructureNodeInput {
  name?: string;
  code?: string;
  description?: string;
  sortOrder?: number;
}

/**
 * Which unit, as last read. Every change to an existing unit is refused as
 * stale when the unit has changed since `updatedAt` was read — two people
 * editing the same unit never silently overwrite each other. A
 * `ProjectStructureNode` satisfies this directly.
 */
export type StructureNodeVersion = Pick<ProjectStructureNode, "id" | "updatedAt">;

/** Only the flags present change. */
export interface StructureReportingFlagsInput {
  weeklyReportingRequired?: boolean;
  monthlyReportingRequired?: boolean;
}

import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  canArchiveNode,
  canDeleteNode,
  canRestoreNode,
  findNode,
  isActiveNode,
  levelConfigurationIssues,
  nodeInputIssues,
  reportingOverlapAfter,
  sortLevels,
  sortNodes,
  STRUCTURE_NODE_CODE_MAX,
  STRUCTURE_NODE_DESCRIPTION_MAX,
  STRUCTURE_NODE_NAME_MAX,
  type StructureIssue,
} from "@/features/projects/structure/structure-rules";
import type {
  ConfigureStructureLevelsInput,
  CreateStructureNodeInput,
  ProjectStructure,
  ProjectStructureLevel,
  ProjectStructureNode,
  StructureLevelNumber,
  StructureNodeVersion,
  StructureReportingFlagsInput,
  UpdateStructureNodeInput,
} from "@/types/project-structure";
import {
  ProjectStructureError,
  type ProjectStructureErrorReason,
} from "./project-structure-errors";
import { supabaseProjectStructureService } from "./supabase-project-structure-service";

/**
 * Other Project structure service (Phase 2C.1c) — the one contract the setup
 * workflow and the Project Structure UI use.
 *
 * Every refusal is a `ProjectStructureError` carrying a fixed, plain-language
 * message and a `reason`; no database text, constraint name or stack trace
 * reaches the screen. Nothing is ever retried.
 *
 * Concurrency, without a second version system:
 * - `ProjectStructure.version` IS the project's own version (the one Project
 *   Setup saves against). Any structure write advances it, and any Project
 *   Setup save advances it, so each makes the other's older token stale. The
 *   atomic level change is checked against it.
 * - A change to an existing unit carries that unit's `updatedAt` as read; the
 *   write applies only while the unit is unchanged, so two people editing the
 *   same unit never silently overwrite each other ("reason: stale").
 *
 * Writes are one unit at a time — no bulk update.
 */
export interface ProjectStructureService {
  /**
   * Levels and units from one consistent read window, with the project
   * version that window was read at. An empty structure is `levels: []`,
   * `nodes: []`.
   */
  getStructure(projectId: string): Promise<ProjectStructure>;
  /** Replaces the complete level set atomically; returns the new project version. */
  configureLevels(input: ConfigureStructureLevelsInput): Promise<{ version: string }>;
  createNode(input: CreateStructureNodeInput): Promise<ProjectStructureNode>;
  /** Name, code, description, sort order — only the keys present change. */
  updateNode(node: StructureNodeVersion, input: UpdateStructureNodeInput): Promise<ProjectStructureNode>;
  /** Re-parents a unit within its level. */
  moveNode(node: StructureNodeVersion, parentId: string): Promise<ProjectStructureNode>;
  /** Weekly / Monthly operational-input flags — only the flags present change. */
  setReportingFlags(node: StructureNodeVersion, flags: StructureReportingFlagsInput): Promise<ProjectStructureNode>;
  /** Children must be archived first. Clears the unit's reporting flags. */
  archiveNode(node: StructureNodeVersion): Promise<ProjectStructureNode>;
  /** The parent must be active and the name / code still free. */
  restoreNode(node: StructureNodeVersion): Promise<ProjectStructureNode>;
  /** Only a unit with no children; refused by the database once referenced. */
  deleteNode(node: StructureNodeVersion): Promise<void>;
}

/* ------------------------------ in-memory mock ----------------------------- */

/** What the mock reads about a project. `version` is the project's own version. */
export interface StructureProjectInfo {
  structureFamily?: "psm" | "other";
  status: string;
  version: string;
}

/**
 * The project store the mock shares with Project Setup, so there is exactly
 * one version per project: structure reads it, structure writes advance it.
 */
export interface StructureProjectStore {
  read(projectId: string): Promise<StructureProjectInfo | undefined> | StructureProjectInfo | undefined;
  /** Advance the project's version after a structure write; returns the new one. */
  advance(projectId: string): Promise<string> | string;
}

export interface InMemoryStructureOptions {
  projects: StructureProjectStore;
  now?: () => string;
  newId?: () => string;
}

/** Structure issue → the reason the database would give for the same request. */
const ISSUE_REASON: Record<StructureIssue["code"], ProjectStructureErrorReason> = {
  level_count: "invalid_levels",
  level_limit: "level_limit",
  level_gap: "level_gap",
  label_required: "invalid_levels",
  label_too_long: "invalid_levels",
  duplicate_label: "duplicate_label",
  level_in_use: "level_in_use",
  new_level_has_id: "invalid_levels",
  name_required: "invalid_node",
  name_too_long: "invalid_node",
  code_too_long: "invalid_node",
  description_too_long: "invalid_node",
  level_undefined: "level_undefined",
  parent_required: "parent_level",
  parent_not_allowed: "parent_level",
  parent_level: "parent_level",
  parent_archived: "parent_archived",
  duplicate_name: "duplicate_name",
  duplicate_code: "duplicate_code",
  reporting_overlap: "reporting_overlap",
};

/** Which issue the database would raise first, in its own check order. */
const ISSUE_PRIORITY: StructureIssue["code"][] = [
  "level_limit", "level_count", "label_required", "label_too_long", "level_gap", "duplicate_label",
  "level_in_use", "new_level_has_id",
  "name_required", "name_too_long", "code_too_long", "description_too_long", "level_undefined",
  "parent_required", "parent_not_allowed", "parent_level", "parent_archived",
  "duplicate_name", "duplicate_code", "reporting_overlap",
];

function refuseFirst(issues: StructureIssue[]): void {
  const first = ISSUE_PRIORITY.find((code) => issues.some((issue) => issue.code === code));
  if (first) throw new ProjectStructureError(ISSUE_REASON[first]);
}

const optional = (value: string | undefined) => value?.trim() || undefined;

/**
 * The database's structure rules, for a backend without one. Authority is the
 * database's alone; the mock only refuses what the database would refuse.
 *
 * Every operation runs one at a time (like the database's setup lock) and
 * reads the CURRENT state inside that turn, so an awaited step can never let
 * a stale copy of a unit be written back.
 */
export function createInMemoryProjectStructureService(options: InMemoryStructureOptions): ProjectStructureService {
  const now = options.now ?? (() => new Date().toISOString());
  let sequence = 0;
  const newId = options.newId ?? (() => `structure-${++sequence}`);
  const levels = new Map<string, ProjectStructureLevel[]>();
  const nodes = new Map<string, ProjectStructureNode>();

  let turn: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = turn.then(operation, operation);
    turn = result.then(() => undefined, () => undefined);
    return result;
  };

  /** A row timestamp strictly later than the one it replaces. */
  const stamp = (previous?: string) =>
    new Date(Math.max(Date.parse(now()), previous ? Date.parse(previous) + 1 : 0)).toISOString();
  const snapshot = (projectId: string) => ({
    levels: sortLevels(levels.get(projectId) ?? []),
    nodes: sortNodes([...nodes.values()].filter((node) => node.projectId === projectId)),
  });
  const clone = <T>(value: T): T => structuredClone(value);

  const info = async (projectId: string) => {
    const project = await options.projects.read(projectId);
    if (!project) throw new ProjectStructureError("not_found");
    return project;
  };
  const assertWritable = async (projectId: string) => {
    const project = await info(projectId);
    if (project.status === "archived") throw new ProjectStructureError("project_archived");
    if (project.structureFamily !== "other") throw new ProjectStructureError("not_other");
    return project;
  };
  /** The unit as it is NOW, provided it is still the version the caller read. */
  const current = (ref: StructureNodeVersion) => {
    const node = nodes.get(ref.id);
    if (!node) throw new ProjectStructureError("not_found");
    if (node.updatedAt !== ref.updatedAt) throw new ProjectStructureError("stale");
    return node;
  };
  const save = async (node: ProjectStructureNode, previous?: ProjectStructureNode) => {
    const saved = { ...node, updatedAt: stamp(previous?.updatedAt) };
    nodes.set(saved.id, saved);
    await options.projects.advance(saved.projectId);
    return clone(saved);
  };
  const assertUnique = (node: ProjectStructureNode) => {
    if (!isActiveNode(node)) return;
    const others = snapshot(node.projectId).nodes.filter((other) => other.id !== node.id && isActiveNode(other));
    const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    if (others.some((other) => (other.parentId ?? null) === (node.parentId ?? null) && same(other.name, node.name))) {
      throw new ProjectStructureError("duplicate_name");
    }
    if (node.code && others.some((other) => other.code && same(other.code, node.code as string))) {
      throw new ProjectStructureError("duplicate_code");
    }
  };

  return {
    getStructure: (projectId) =>
      exclusive(async () => {
        const project = await info(projectId);
        return clone({ projectId, version: project.version, ...snapshot(projectId) });
      }),

    configureLevels: (input) =>
      exclusive(async () => {
        const project = await assertWritable(input.projectId);
        if (input.expectedVersion !== project.version) throw new ProjectStructureError("stale");
        const structure = snapshot(input.projectId);
        refuseFirst(levelConfigurationIssues(structure, input.levels));

        const timestamp = now();
        const next = [...input.levels]
          .sort((a, b) => a.levelNumber - b.levelNumber)
          .map((level): ProjectStructureLevel => {
            const existing = structure.levels.find((entry) => entry.levelNumber === level.levelNumber);
            return {
              id: existing?.id ?? newId(),
              projectId: input.projectId,
              levelNumber: level.levelNumber as StructureLevelNumber,
              singularLabel: level.singularLabel.trim(),
              pluralLabel: level.pluralLabel.trim(),
              createdAt: existing?.createdAt ?? timestamp,
              updatedAt: timestamp,
            };
          });
        levels.set(input.projectId, next);
        return { version: await options.projects.advance(input.projectId) };
      }),

    createNode: (input) =>
      exclusive(async () => {
        await assertWritable(input.projectId);
        const structure = snapshot(input.projectId);
        if (input.levelNumber > 1 && input.parentId !== undefined && !findNode(structure.nodes, input.parentId)) {
          throw new ProjectStructureError("parent_invalid");
        }
        refuseFirst(nodeInputIssues(structure, input));
        const timestamp = stamp();
        return save({
          id: newId(),
          projectId: input.projectId,
          levelNumber: input.levelNumber as StructureLevelNumber,
          parentId: input.levelNumber === 1 ? undefined : input.parentId,
          name: input.name.trim(),
          code: optional(input.code),
          description: optional(input.description),
          sortOrder: input.sortOrder ?? 0,
          weeklyReportingRequired: input.weeklyReportingRequired ?? false,
          monthlyReportingRequired: input.monthlyReportingRequired ?? false,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }),

    updateNode: (ref, input) =>
      exclusive(async () => {
        await assertWritable(nodes.get(ref.id)?.projectId ?? "");
        const node = current(ref);
        const next: ProjectStructureNode = {
          ...node,
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...("code" in input ? { code: optional(input.code) } : {}),
          ...("description" in input ? { description: optional(input.description) } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        };
        if (!next.name || next.name.length > STRUCTURE_NODE_NAME_MAX
            || (next.code?.length ?? 0) > STRUCTURE_NODE_CODE_MAX
            || (next.description?.length ?? 0) > STRUCTURE_NODE_DESCRIPTION_MAX) {
          throw new ProjectStructureError("invalid_node");
        }
        assertUnique(next);
        return save(next, node);
      }),

    moveNode: (ref, parentId) =>
      exclusive(async () => {
        await assertWritable(nodes.get(ref.id)?.projectId ?? "");
        const node = current(ref);
        const structure = snapshot(node.projectId);
        const parent = findNode(structure.nodes, parentId);
        if (!parent) throw new ProjectStructureError("parent_invalid");
        if (parent.levelNumber !== node.levelNumber - 1) throw new ProjectStructureError("parent_level");
        if (isActiveNode(node) && !isActiveNode(parent)) throw new ProjectStructureError("parent_archived");
        const next = { ...node, parentId };
        assertUnique(next);
        if (reportingOverlapAfter(structure.nodes, { nodeId: node.id, parentId }).length > 0) {
          throw new ProjectStructureError("reporting_overlap");
        }
        return save(next, node);
      }),

    setReportingFlags: (ref, flags) =>
      exclusive(async () => {
        await assertWritable(nodes.get(ref.id)?.projectId ?? "");
        const node = current(ref);
        const next = {
          ...node,
          weeklyReportingRequired: flags.weeklyReportingRequired ?? node.weeklyReportingRequired,
          monthlyReportingRequired: flags.monthlyReportingRequired ?? node.monthlyReportingRequired,
        };
        if (!isActiveNode(node) && (next.weeklyReportingRequired || next.monthlyReportingRequired)) {
          throw new ProjectStructureError("archived_reporting");
        }
        if (reportingOverlapAfter(snapshot(node.projectId).nodes, { nodeId: node.id, ...flags }).length > 0) {
          throw new ProjectStructureError("reporting_overlap");
        }
        return save(next, node);
      }),

    archiveNode: (ref) =>
      exclusive(async () => {
        await assertWritable(nodes.get(ref.id)?.projectId ?? "");
        const node = current(ref);
        if (!canArchiveNode(snapshot(node.projectId).nodes, node.id).ok && isActiveNode(node)) {
          throw new ProjectStructureError("active_children");
        }
        return save({ ...node, archivedAt: node.archivedAt ?? now(), weeklyReportingRequired: false, monthlyReportingRequired: false }, node);
      }),

    restoreNode: (ref) =>
      exclusive(async () => {
        await assertWritable(nodes.get(ref.id)?.projectId ?? "");
        const node = current(ref);
        if (isActiveNode(node)) return clone(node);
        const verdict = canRestoreNode(snapshot(node.projectId).nodes, node.id);
        if (verdict.reason === "parent_archived") throw new ProjectStructureError("parent_archived");
        const next = { ...node, archivedAt: undefined };
        assertUnique(next);
        return save(next, node);
      }),

    deleteNode: (ref) =>
      exclusive(async () => {
        const projectId = nodes.get(ref.id)?.projectId;
        if (!projectId) throw new ProjectStructureError("not_found");
        const project = await info(projectId);
        if (project.status === "archived") throw new ProjectStructureError("project_archived");
        const node = current(ref);
        if (!canDeleteNode(snapshot(node.projectId).nodes, node.id).ok) throw new ProjectStructureError("has_children");
        nodes.delete(node.id);
        await options.projects.advance(node.projectId);
      }),
  };
}

/* ------------------------------- selection -------------------------------- */

/**
 * Supabase when configured; otherwise the in-memory rules over the SAME mock
 * project store Project Setup uses (loaded lazily, so this module never
 * imports it eagerly), so both share one project version.
 */
export const projectStructureService: ProjectStructureService = isSupabaseConfigured()
  ? supabaseProjectStructureService
  : createInMemoryProjectStructureService({
      projects: {
        read: async (projectId) => {
          const { projectService } = await import("./project-service");
          const project = await projectService.getProjectById(projectId);
          return project
            ? { structureFamily: project.structureFamily, status: project.status, version: project.updatedAt }
            : undefined;
        },
        advance: async (projectId) => {
          const { advanceMockProjectVersion } = await import("./project-service");
          return advanceMockProjectVersion(projectId);
        },
      },
    });

import type { Project } from "@/types";
import type {
  CreateStructureNodeInput,
  ProjectStructure,
  ProjectStructureNode,
  StructureLevelInput,
  StructureNodeVersion,
  StructureReportingFlagsInput,
  UpdateStructureNodeInput,
} from "@/types/project-structure";
import type { ProjectStructureService } from "@/services/project-structure-service";

/**
 * The FROZEN contract between the Project Setup workflow and the Other
 * Project Structure UI (Phase 2C.1c-c).
 *
 * Ownership:
 * - The workflow container (ProjectStructureStep) owns data and service
 *   wiring: it loads the structure, decides `canManage`, builds `actions`,
 *   and keeps the structure and the project version in step after every
 *   write.
 * - The structure UI (ProjectStructureWorkspace, replaced in a later slice)
 *   only renders `ProjectStructureWorkspaceProps` and calls `actions`. It never
 *   creates a Supabase client, queries structure tables, decides authority,
 *   re-implements the structure rules (use structure-rules.ts for previews),
 *   tracks versions, or invents data.
 *
 * Errors: every action rejects with the service's ProjectStructureError,
 * whose `message` is already plain language (and whose `reason`, e.g.
 * "stale", may steer the UI). Raw database text never reaches the UI.
 */

/** What the structure UI may know about the project — display only. */
export type StructureWorkspaceProject = Pick<
  Project,
  "id" | "code" | "name" | "status" | "reporting"
>;

/**
 * Typed write callbacks. Versions are the container's concern: the UI passes
 * the unit it is acting on (a `ProjectStructureNode` satisfies
 * `StructureNodeVersion`) and never a project version.
 *
 * After every action that reached the database — success, or a "stale" /
 * "not_found" refusal — the container reloads the structure and the project,
 * so the next render shows current data. The UI does not need to call
 * `refresh` after an action.
 */
export interface ProjectStructureActions {
  /** Replaces the complete level set (1–4 levels). */
  configureLevels(levels: StructureLevelInput[]): Promise<void>;
  createNode(input: Omit<CreateStructureNodeInput, "projectId">): Promise<ProjectStructureNode>;
  updateNode(node: StructureNodeVersion, input: UpdateStructureNodeInput): Promise<ProjectStructureNode>;
  moveNode(node: StructureNodeVersion, parentId: string): Promise<ProjectStructureNode>;
  setReportingFlags(
    node: StructureNodeVersion,
    flags: StructureReportingFlagsInput
  ): Promise<ProjectStructureNode>;
  archiveNode(node: StructureNodeVersion): Promise<ProjectStructureNode>;
  restoreNode(node: StructureNodeVersion): Promise<ProjectStructureNode>;
  deleteNode(node: StructureNodeVersion): Promise<void>;
  /** Reload on demand (e.g. a "Reload" button after a stale refusal). */
  refresh(): void;
}

/** Everything the structure UI receives. Nothing else. */
export interface ProjectStructureWorkspaceProps {
  project: StructureWorkspaceProject;
  /** Always THIS project's structure; empty is `levels: []`, `nodes: []`. */
  structure: ProjectStructure;
  /**
   * Whether to offer write controls. Presentation only: the database is the
   * authority and refuses any write it does not allow.
   */
  canManage: boolean;
  actions: ProjectStructureActions;
}

/** The service methods the actions use — the active service in the app. */
export type StructureWriteService = Pick<
  ProjectStructureService,
  | "configureLevels"
  | "createNode"
  | "updateNode"
  | "moveNode"
  | "setReportingFlags"
  | "archiveNode"
  | "restoreNode"
  | "deleteNode"
>;

export interface StructureActionDeps {
  service: StructureWriteService;
  projectId: string;
  /** The project version of the structure currently shown. */
  currentVersion: () => string;
  /** Reload the structure and the project after a write reached the database. */
  afterWrite: () => void;
  refresh: () => void;
}

/** Refusals that mean "what you see is out of date" — reload either way. */
const RELOAD_AFTER: ReadonlySet<string> = new Set(["stale", "not_found"]);

function reasonOf(error: unknown): string | undefined {
  const candidate = error as { reason?: unknown } | null;
  return typeof candidate?.reason === "string" ? candidate.reason : undefined;
}

/**
 * Builds the typed actions over the structure service. Pure wiring: the
 * project id and expected version come from the container, never the UI; one
 * call per action, never retried; the service's error is rethrown unchanged.
 */
export function createStructureActions(deps: StructureActionDeps): ProjectStructureActions {
  const run = async <T>(write: () => Promise<T>): Promise<T> => {
    try {
      const result = await write();
      deps.afterWrite();
      return result;
    } catch (error) {
      if (RELOAD_AFTER.has(reasonOf(error) ?? "")) deps.afterWrite();
      throw error;
    }
  };
  const { service, projectId } = deps;
  return {
    async configureLevels(levels) {
      await run(() =>
        service.configureLevels({ projectId, expectedVersion: deps.currentVersion(), levels })
      );
    },
    createNode: (input) => run(() => service.createNode({ ...input, projectId })),
    updateNode: (node, input) => run(() => service.updateNode(node, input)),
    moveNode: (node, parentId) => run(() => service.moveNode(node, parentId)),
    setReportingFlags: (node, flags) => run(() => service.setReportingFlags(node, flags)),
    archiveNode: (node) => run(() => service.archiveNode(node)),
    restoreNode: (node) => run(() => service.restoreNode(node)),
    deleteNode: (node) => run(() => service.deleteNode(node)),
    refresh: deps.refresh,
  };
}

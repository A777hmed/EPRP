import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  ProjectStructureLevelRow,
  ProjectStructureNodeRow,
} from "@/lib/supabase/database.types";
import { sortLevels, sortNodes } from "@/features/projects/structure/structure-rules";
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
  mapProjectStructureError,
  ProjectStructureError,
} from "./project-structure-errors";
// Type-only: no runtime edge back to the selecting module.
import type { ProjectStructureService } from "./project-structure-service";
import type { ServiceError } from "./service-errors";

/**
 * Other Project structure on Supabase (Phase 2C.1c).
 *
 * Runs as the signed-in caller through the browser client: Row Level Security
 * decides what is visible (structure follows project visibility) and who may
 * write (Project Setup authority). No service-role path, and no authority
 * check duplicated here — the database owns both.
 *
 * Writes go one unit at a time; there is no bulk update. The active-name /
 * active-code unique indexes are checked immediately, row by row, so a true
 * swap of two active units' names or codes is NOT two plain saves — the first
 * save collides with the other unit. It needs an intermediate value (A → temp,
 * B → A, A → B) or a future explicit strategy; none is offered here.
 *
 * Concurrency, with no second version system and no new migration:
 * - Reads: the project version is read before and after the levels and units;
 *   a change in between rejects the mixed result as stale, so
 *   `ProjectStructure.version` always matches the data returned.
 * - Levels: the RPC checks the project version atomically ([STALE]).
 * - Units: every change to an existing unit is ONE UPDATE / DELETE filtered on
 *   the unit's id AND the `updated_at` the caller read. The row's own
 *   updated_at is set by the existing set_updated_at trigger on every write,
 *   and the setup statement lock serialises writers, so a concurrent change
 *   makes the filter match nothing: the write is refused as stale instead of
 *   silently overwriting. Every write still advances the project version.
 * Nothing here retries a stale write.
 */

const LEVEL_COLUMNS =
  "id, project_id, level_number, singular_label, plural_label, created_at, updated_at";
const NODE_COLUMNS =
  "id, project_id, level_number, parent_id, name, code, description, sort_order, weekly_reporting_required, monthly_reporting_required, archived_at, created_at, updated_at";

export type StructureClient = Pick<SupabaseClient, "from" | "rpc">;

export function levelFromRow(row: ProjectStructureLevelRow): ProjectStructureLevel {
  return {
    id: row.id,
    projectId: row.project_id,
    levelNumber: row.level_number as StructureLevelNumber,
    singularLabel: row.singular_label,
    pluralLabel: row.plural_label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function nodeFromRow(row: ProjectStructureNodeRow): ProjectStructureNode {
  return {
    id: row.id,
    projectId: row.project_id,
    levelNumber: row.level_number as StructureLevelNumber,
    parentId: row.parent_id ?? undefined,
    name: row.name,
    code: row.code ?? undefined,
    description: row.description ?? undefined,
    sortOrder: row.sort_order,
    weeklyReportingRequired: row.weekly_reporting_required,
    monthlyReportingRequired: row.monthly_reporting_required,
    archivedAt: row.archived_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Blank clears an optional text field; the database stores NULL. */
function optionalText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Arguments for configure_project_structure_levels(): the complete level set. */
export function configureLevelsRpcArgs(input: ConfigureStructureLevelsInput) {
  return {
    p_project: input.projectId,
    p_expected_updated_at: input.expectedVersion,
    p_levels: [...input.levels]
      .sort((a, b) => a.levelNumber - b.levelNumber)
      .map((level) => ({
        ...(level.id ? { id: level.id } : {}),
        level_number: level.levelNumber,
        singular_label: level.singularLabel.trim(),
        plural_label: level.pluralLabel.trim(),
      })),
  };
}

/** The insert row for a new unit. A level-1 unit never carries a parent. */
export function createNodeRow(input: CreateStructureNodeInput) {
  return {
    project_id: input.projectId,
    level_number: input.levelNumber,
    parent_id: input.levelNumber === 1 ? null : input.parentId ?? null,
    name: input.name.trim(),
    code: optionalText(input.code),
    description: optionalText(input.description),
    sort_order: input.sortOrder ?? 0,
    weekly_reporting_required: input.weeklyReportingRequired ?? false,
    monthly_reporting_required: input.monthlyReportingRequired ?? false,
  };
}

/** Only the descriptive keys present in the input. */
export function updateNodePatch(input: UpdateStructureNodeInput): Partial<ProjectStructureNodeRow> {
  const patch: Partial<ProjectStructureNodeRow> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if ("code" in input) patch.code = optionalText(input.code);
  if ("description" in input) patch.description = optionalText(input.description);
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
  return patch;
}

export function reportingFlagsPatch(flags: StructureReportingFlagsInput): Partial<ProjectStructureNodeRow> {
  const patch: Partial<ProjectStructureNodeRow> = {};
  if (flags.weeklyReportingRequired !== undefined) patch.weekly_reporting_required = flags.weeklyReportingRequired;
  if (flags.monthlyReportingRequired !== undefined) patch.monthly_reporting_required = flags.monthlyReportingRequired;
  return patch;
}

/** Archiving also clears the reporting flags — an archived unit owes no input. */
export function archiveNodePatch(at: string): Partial<ProjectStructureNodeRow> {
  return { archived_at: at, weekly_reporting_required: false, monthly_reporting_required: false };
}

/** The full error, kept for diagnosis and never shown. */
function fail(operation: string, error: ServiceError): ProjectStructureError {
  console.error(`[project-structure-service] ${operation} failed`, {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });
  return mapProjectStructureError(error);
}

export function createSupabaseProjectStructureService(
  getClient: () => StructureClient
): ProjectStructureService {
  const nodes = () => getClient().from("project_structure_nodes");

  /**
   * Why a version-filtered write matched no row: the unit is gone (or
   * invisible), it changed since it was read, or RLS refused the write.
   */
  const explainNoRow = async (ref: StructureNodeVersion): Promise<ProjectStructureError> => {
    const { data, error } = await nodes().select("id, updated_at").eq("id", ref.id).maybeSingle();
    if (error) return fail("check the unit", error);
    if (!data) return new ProjectStructureError("not_found");
    return new ProjectStructureError(
      (data as { updated_at: string }).updated_at === ref.updatedAt ? "not_authorized" : "stale"
    );
  };

  /** One unit's update, applied only while it is the version the caller read. */
  const updateNode = async (
    operation: string,
    ref: StructureNodeVersion,
    patch: Partial<ProjectStructureNodeRow>
  ): Promise<ProjectStructureNode> => {
    const { data, error } = await nodes()
      .update(patch)
      .eq("id", ref.id)
      .eq("updated_at", ref.updatedAt)
      .select(NODE_COLUMNS)
      .maybeSingle();
    if (error) throw fail(operation, error);
    if (!data) throw await explainNoRow(ref);
    return nodeFromRow(data as ProjectStructureNodeRow);
  };

  /** No field to change: return the unit, still refusing a stale reference. */
  const readCurrent = async (ref: StructureNodeVersion): Promise<ProjectStructureNode> => {
    const { data, error } = await nodes().select(NODE_COLUMNS).eq("id", ref.id).maybeSingle();
    if (error) throw fail("read the unit", error);
    if (!data) throw new ProjectStructureError("not_found");
    const node = nodeFromRow(data as ProjectStructureNodeRow);
    if (node.updatedAt !== ref.updatedAt) throw new ProjectStructureError("stale");
    return node;
  };

  const readVersion = async (client: StructureClient, projectId: string): Promise<string | null> => {
    const { data, error } = await client.from("projects").select("id, updated_at").eq("id", projectId).maybeSingle();
    if (error) throw fail("read the project version", error);
    return data ? (data as { updated_at: string }).updated_at : null;
  };

  return {
    async getStructure(projectId) {
      const client = getClient();
      // Same protocol as the project read: version, children, version again.
      const before = await readVersion(client, projectId);
      if (before === null) throw new ProjectStructureError("not_found");

      const [levels, units] = await Promise.all([
        client.from("project_structure_levels").select(LEVEL_COLUMNS).eq("project_id", projectId)
          .order("level_number", { ascending: true }),
        client.from("project_structure_nodes").select(NODE_COLUMNS).eq("project_id", projectId)
          .order("level_number", { ascending: true })
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true }),
      ]);
      if (levels.error) throw fail("read the structure levels", levels.error);
      if (units.error) throw fail("read the structure units", units.error);

      // A writer committed while the children loaded: refuse the mixed result.
      const after = await readVersion(client, projectId);
      if (after === null) throw new ProjectStructureError("not_found");
      if (after !== before) throw new ProjectStructureError("stale");

      const structure: ProjectStructure = {
        projectId,
        version: before,
        levels: sortLevels(((levels.data ?? []) as ProjectStructureLevelRow[]).map(levelFromRow)),
        nodes: sortNodes(((units.data ?? []) as ProjectStructureNodeRow[]).map(nodeFromRow)),
      };
      return structure;
    },

    async configureLevels(input) {
      const { data, error } = await getClient().rpc("configure_project_structure_levels", configureLevelsRpcArgs(input));
      if (error) throw fail("configure the structure levels", error);
      if (typeof data !== "string") throw new ProjectStructureError("failed");
      return { version: data };
    },

    async createNode(input) {
      const { data, error } = await nodes().insert(createNodeRow(input)).select(NODE_COLUMNS).single();
      if (error) throw fail("add the unit", error);
      return nodeFromRow(data as ProjectStructureNodeRow);
    },

    async updateNode(ref, input) {
      const patch = updateNodePatch(input);
      if (Object.keys(patch).length === 0) return readCurrent(ref);
      return updateNode("update the unit", ref, patch);
    },

    moveNode(ref, parentId) {
      return updateNode("move the unit", ref, { parent_id: parentId });
    },

    async setReportingFlags(ref, flags) {
      const patch = reportingFlagsPatch(flags);
      if (Object.keys(patch).length === 0) return readCurrent(ref);
      return updateNode("change the unit's reporting", ref, patch);
    },

    archiveNode(ref) {
      return updateNode("archive the unit", ref, archiveNodePatch(new Date().toISOString()));
    },

    restoreNode(ref) {
      return updateNode("restore the unit", ref, { archived_at: null });
    },

    async deleteNode(ref) {
      const { data, error } = await nodes().delete().eq("id", ref.id).eq("updated_at", ref.updatedAt).select("id");
      if (error) throw fail("delete the unit", error);
      if (!data || (data as unknown[]).length === 0) throw await explainNoRow(ref);
    },
  };
}

export const supabaseProjectStructureService = createSupabaseProjectStructureService(
  () => getSupabaseBrowserClient() as unknown as StructureClient
);

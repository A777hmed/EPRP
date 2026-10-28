/**
 * Phase 13.12 (browser UAT) — the publish CONTEXT: what the Publish dialog
 * was prepared against, and the proof at submit that it is still current.
 *
 *   open the dialog → prepare: read the Working Plan as the user, capture
 *                     { project, Working Plan fingerprint, BL0 / BLn,
 *                       engine version, the offered import batches }
 *   Publish         → submit: read the Working Plan again, rebuild the same
 *                     context, and refuse if any governed input moved; only
 *                     an unchanged context reaches the engine and the writer
 *
 * The context is not a lock and is never refreshed in place: a stale dialog is
 * refused and the user opens Publish Snapshot again, which prepares a new one.
 * It is a consistency guard, not an authorization artifact — authority, the
 * Data Date, the baselines and the database's own fingerprint check
 * (`publish_planning_snapshot_v2` → [STALE_WORKING_PLAN]) all still run on
 * the server for every publish.
 *
 * Pure apart from the injected reads and the writer, so the exact browser
 * path (prepare → another tab edits → submit) is tested without a server.
 */

import { PLANNING_ENGINE_VERSION } from "@/lib/planning-engine";
import {
  buildPublishPayload,
  type PublishInputsBundle,
  type PublishPayloadV2,
  type PublishProblem,
  type PublishSummary,
} from "./publish-plan";

export type PlanningActionResult<T> = { ok: true; value: T } | { ok: false; problems: PublishProblem[] };

/** A validated import batch offered by the dialog, as it was when prepared. */
export interface PublishSource {
  batchId: string;
  dataDate: string | null;
  status: string;
  /** Moves on every change to the batch (validation, rejection, publish). */
  updatedAt: string;
  fileName: string | null;
  sourceType: string;
  rowCount: number;
}

/** What one Publish dialog was prepared against. Carries no figure. */
export interface PublishContext {
  projectId: string;
  /** `planning_working_plan_fingerprint()`: settings, calendar, nodes, activities, approved revisions. */
  fingerprint: string;
  bl0BaselineId: string | null;
  blnBaselineId: string | null;
  engineVersion: string;
  sources: PublishSource[];
}

/** The import batch columns the context reads. */
export interface PublishSourceRow {
  id: string;
  project_id: string;
  data_date: string | null;
  status: string;
  updated_at: string;
  file_name: string | null;
  source_type: string;
  row_count: number;
}

export const PUBLISH_SOURCE_COLUMNS = "id, project_id, data_date, status, updated_at, file_name, source_type, row_count";

export const STALE_PLAN_MESSAGE =
  "The Working Plan changed after this publish was prepared. Review the latest plan and open Publish Snapshot again.";
const STALE_BASELINES_MESSAGE =
  "The approved baselines changed after this publish was prepared. Review the latest plan and open Publish Snapshot again.";
const STALE_SOURCE_MESSAGE =
  "The import batch changed after this publish was prepared. Review it and open Publish Snapshot again.";
const STALE_ENGINE_MESSAGE =
  "The Planning Engine was updated after this publish was prepared. Open Publish Snapshot again.";
const NOT_PREPARED_MESSAGE = "This publish was not prepared for this project. Close it and open Publish Snapshot again.";

/** Refusals that only a fresh dialog can clear: retrying the same one is pointless. */
const STALE_CODES = new Set([
  "STALE_PUBLISH_CONTEXT",
  "STALE_PUBLISH_BASELINES",
  "STALE_PUBLISH_SOURCE",
  "STALE_PUBLISH_ENGINE",
  "PUBLISH_NOT_PREPARED",
]);

export function isStalePublishRefusal(problems: readonly PublishProblem[]): boolean {
  return problems.some((problem) => STALE_CODES.has(problem.code));
}

export function sourceOf(row: PublishSourceRow): PublishSource {
  return {
    batchId: row.id,
    dataDate: row.data_date,
    status: row.status,
    updatedAt: row.updated_at,
    fileName: row.file_name,
    sourceType: row.source_type,
    rowCount: row.row_count,
  };
}

/** The context of one consistent Working Plan read, plus the batches read with it. */
export function publishContextOf(
  bundle: PublishInputsBundle,
  sources: readonly PublishSource[],
  engineVersion: string = PLANNING_ENGINE_VERSION
): PublishContext | PublishProblem {
  if (!bundle.project) return { code: "NOT_FOUND", message: "This project could not be read. Reload and try again." };
  if (!bundle.fingerprint) return { code: "NOT_AUTHORIZED", message: "You cannot read this project's Working Plan." };
  const approved = [...bundle.baselines].sort((a, b) => a.revision_number - b.revision_number);
  return {
    projectId: bundle.project.id,
    fingerprint: bundle.fingerprint,
    bl0BaselineId: approved.find((baseline) => baseline.revision_number === 0)?.id ?? null,
    blnBaselineId: approved.at(-1)?.id ?? null,
    engineVersion,
    sources: sources.map((source) => ({ ...source })),
  };
}

/**
 * Null when `current` is the context `prepared` was made against; otherwise
 * the refusal. Baselines are named before the fingerprint (an approval moves
 * both), so the user reads the most specific reason.
 */
export function publishContextProblem(
  prepared: PublishContext,
  current: PublishContext,
  sourceImportBatchId: string | null
): PublishProblem | null {
  if (prepared.projectId !== current.projectId) return { code: "PUBLISH_NOT_PREPARED", message: NOT_PREPARED_MESSAGE };
  if (prepared.engineVersion !== current.engineVersion) {
    return { code: "STALE_PUBLISH_ENGINE", message: STALE_ENGINE_MESSAGE };
  }
  if (prepared.bl0BaselineId !== current.bl0BaselineId || prepared.blnBaselineId !== current.blnBaselineId) {
    return { code: "STALE_PUBLISH_BASELINES", message: STALE_BASELINES_MESSAGE };
  }
  if (prepared.fingerprint !== current.fingerprint) return { code: "STALE_PUBLISH_CONTEXT", message: STALE_PLAN_MESSAGE };
  if (sourceImportBatchId) {
    const before = prepared.sources.find((source) => source.batchId === sourceImportBatchId);
    const now = current.sources.find((source) => source.batchId === sourceImportBatchId);
    if (
      !before ||
      !now ||
      before.dataDate !== now.dataDate ||
      before.status !== now.status ||
      before.updatedAt !== now.updatedAt
    ) {
      return { code: "STALE_PUBLISH_SOURCE", message: STALE_SOURCE_MESSAGE };
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* The flow (reads and writer injected by the server action)                  */
/* -------------------------------------------------------------------------- */

export interface PublishFlowDeps {
  /** `planning_publish_inputs()` as the user. */
  readInputs(projectId: string): Promise<PublishInputsBundle | PublishProblem>;
  /** The project's validated import batches, as the user. */
  readSources(projectId: string): Promise<PublishSourceRow[] | PublishProblem>;
  /** One import batch, as the user; null when it cannot be read. */
  readSource(batchId: string): Promise<PublishSourceRow | null>;
  /** The server-only trusted writer. */
  write(
    projectId: string,
    payload: PublishPayloadV2,
    confirmSetupControl: boolean
  ): Promise<{ snapshotId: string; version: number | null } | PublishProblem>;
  engineVersion?: string;
}

export interface PublishSubmission {
  projectId: string;
  /** The context the dialog was prepared against — required. */
  context: PublishContext | null | undefined;
  dataDate?: string | null;
  sourceImportBatchId?: string | null;
  label?: string | null;
  /** The user's explicit first-anchor confirmation; never defaulted to true. */
  confirmSetupControl: boolean;
}

const isProblem = (value: unknown): value is PublishProblem =>
  typeof value === "object" && value !== null && "code" in value && "message" in value;

/** Opening the dialog: one read of the Working Plan and the offered batches. */
export async function preparePublish(deps: PublishFlowDeps, projectId: string): Promise<PlanningActionResult<PublishContext>> {
  const [inputs, rows] = await Promise.all([deps.readInputs(projectId), deps.readSources(projectId)]);
  if (isProblem(inputs)) return { ok: false, problems: [inputs] };
  if (isProblem(rows)) return { ok: false, problems: [rows] };
  const context = publishContextOf(
    inputs,
    rows.filter((row) => row.project_id === projectId && row.status === "validated").map(sourceOf),
    deps.engineVersion
  );
  return isProblem(context) ? { ok: false, problems: [context] } : { ok: true, value: context };
}

/** Publish: the current Working Plan must still be the prepared one. */
export async function submitPublish(
  deps: PublishFlowDeps,
  input: PublishSubmission
): Promise<PlanningActionResult<{ snapshotId: string; version: number | null; summary: PublishSummary }>> {
  const prepared = input.context;
  if (!prepared || prepared.projectId !== input.projectId) {
    return { ok: false, problems: [{ code: "PUBLISH_NOT_PREPARED", message: NOT_PREPARED_MESSAGE }] };
  }

  // An import batch carries its own Data Date (read now, as the caller).
  let batch: PublishSourceRow | null = null;
  if (input.sourceImportBatchId) {
    batch = await deps.readSource(input.sourceImportBatchId);
    if (!batch || batch.project_id !== input.projectId) {
      return { ok: false, problems: [{ code: "INVALID_SOURCE", message: "This import batch is not available on this project." }] };
    }
  }

  const inputs = await deps.readInputs(input.projectId);
  if (isProblem(inputs)) return { ok: false, problems: [inputs] };
  const current = publishContextOf(inputs, batch ? [sourceOf(batch)] : [], deps.engineVersion);
  if (isProblem(current)) return { ok: false, problems: [current] };
  const drift = publishContextProblem(prepared, current, input.sourceImportBatchId ?? null);
  if (drift) return { ok: false, problems: [drift] };

  // Only now, with the prepared Working Plan proven current, does the engine run.
  const plan = buildPublishPayload(inputs, {
    dataDate: batch ? batch.data_date : (input.dataDate ?? null),
    sourceImportBatchId: input.sourceImportBatchId ?? null,
    label: input.label ?? null,
  });
  if (plan.status === "refused") return { ok: false, problems: plan.problems };

  const written = await deps.write(input.projectId, plan.payload, input.confirmSetupControl === true);
  if (isProblem(written)) {
    // The writer's own freshness check caught a change in the last moment:
    // this dialog is stale too, and says so the same way.
    if (written.code === "STALE_WORKING_PLAN") return { ok: false, problems: [{ code: "STALE_PUBLISH_CONTEXT", message: STALE_PLAN_MESSAGE }] };
    if (written.code === "BASELINE_CHANGED") return { ok: false, problems: [{ code: "STALE_PUBLISH_BASELINES", message: STALE_BASELINES_MESSAGE }] };
    return { ok: false, problems: [written] };
  }
  return { ok: true, value: { ...written, summary: plan.summary } };
}

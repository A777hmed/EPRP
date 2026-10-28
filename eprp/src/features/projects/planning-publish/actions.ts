"use server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAuthenticatedUser } from "@/features/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  PUBLISH_SOURCE_COLUMNS,
  preparePublish,
  submitPublish,
  type PlanningActionResult,
  type PublishContext,
  type PublishFlowDeps,
  type PublishSourceRow,
} from "./publish-context";
import {
  buildBaselineRequest,
  type PublishInputsBundle,
  type PublishProblem,
  type PublishSummary,
} from "./publish-plan";
import { planningRefusal } from "./publish-refusals";

/**
 * Phase 13.12 (`docs/02` §26.25 D-A) — the ONLY entry to the server-only
 * trusted writers.
 *
 * 1. The caller is re-derived from their session token (`auth.getUser()`).
 * 2. The Working Plan is read AS the caller, in one consistent statement
 *    (`planning_publish_inputs()`, RLS applies). Opening the Publish dialog
 *    prepares a publish context from that read; Publish reads it again and is
 *    refused if the Working Plan, the baselines, the engine or the chosen
 *    import batch moved since (`publish-context.ts`).
 * 3. The 13.11 adapter and the 13.10 engine run here, once.
 * 4. The result goes to the trusted writer through the service-role client,
 *    naming the caller; the database then re-checks every rule as that user
 *    (authority, archived, no formal schedule, Data Date, approved BL0,
 *    first-publish confirmation, Working Plan unchanged) before freezing it.
 *
 * The browser never sends a figure: it sends the project, the prepared
 * context, the Data Date or import batch, a label and the confirmation.
 */

// No `export { … }` / `export type { … }` lists here: Turbopack's server-action
// transform registers every listed name as a runtime export, and type-only
// names then throw "ReferenceError: … is not defined" when the module loads,
// taking every action in this file down. Callers import the types from
// `./publish-context`.

const NOT_SIGNED_IN: PublishProblem = { code: "NOT_AUTHORIZED", message: "Sign in again to continue." };
const PUBLISH_FALLBACK = "The snapshot could not be published. Nothing was changed — please try again.";
const BASELINE_FALLBACK = "The baseline could not be requested. Nothing was changed — please try again.";

function untyped(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

async function readInputs(projectId: string): Promise<PublishInputsBundle | PublishProblem> {
  const server = untyped(await createSupabaseServerClient());
  const { data, error } = await server.rpc("planning_publish_inputs", { p_project: projectId });
  if (error || !data) return planningRefusal(error, "The Working Plan could not be read. Please try again.");
  return data as PublishInputsBundle;
}

/** The reads and the writer of the publish flow, as the signed-in caller. */
async function publishDeps(actorId: string): Promise<PublishFlowDeps> {
  const server = untyped(await createSupabaseServerClient());
  return {
    readInputs,
    async readSources(projectId) {
      const { data, error } = await server
        .from("planning_import_batches")
        .select(PUBLISH_SOURCE_COLUMNS)
        .eq("project_id", projectId)
        .eq("status", "validated")
        .order("uploaded_at", { ascending: false });
      if (error) return planningRefusal(error, "The import batches could not be read. Please try again.");
      return (data ?? []) as PublishSourceRow[];
    },
    async readSource(batchId) {
      const { data, error } = await server.from("planning_import_batches").select(PUBLISH_SOURCE_COLUMNS).eq("id", batchId).maybeSingle();
      return error ? null : ((data as PublishSourceRow | null) ?? null);
    },
    async write(projectId, payload, confirmSetupControl) {
      const admin = untyped(createSupabaseAdminClient());
      const { data, error } = await admin.rpc("publish_planning_snapshot_v2", {
        p_actor: actorId,
        p_project: projectId,
        p_payload: payload,
        p_confirm_setup_control: confirmSetupControl,
      });
      if (error || typeof data !== "string") return planningRefusal(error, PUBLISH_FALLBACK);
      const { data: published } = await server.from("planning_snapshots").select("version").eq("id", data).maybeSingle();
      return { snapshotId: data, version: (published as { version: number } | null)?.version ?? null };
    },
  };
}

/** Opening the Publish dialog: the context it is prepared against (read as the caller). */
export async function preparePlanningPublish(input: { projectId: string }): Promise<PlanningActionResult<PublishContext>> {
  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, problems: [NOT_SIGNED_IN] };
  return preparePublish(await publishDeps(user.id), input.projectId);
}

export async function publishPlanningSnapshotV2(input: {
  projectId: string;
  /** From preparePlanningPublish when the dialog opened; a stale one is refused, never refreshed. */
  context: PublishContext;
  dataDate?: string | null;
  sourceImportBatchId?: string | null;
  label?: string | null;
  /** The user's explicit first-anchor confirmation; never defaulted to true. */
  confirmSetupControl: boolean;
}): Promise<PlanningActionResult<{ snapshotId: string; version: number | null; summary: PublishSummary }>> {
  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, problems: [NOT_SIGNED_IN] };
  return submitPublish(await publishDeps(user.id), input);
}

export async function requestPlanningBaseline(input: {
  projectId: string;
  reason: string;
}): Promise<PlanningActionResult<{ baselineId: string; kind: "original" | "rebaseline" }>> {
  const user = await getAuthenticatedUser();
  if (!user) return { ok: false, problems: [NOT_SIGNED_IN] };
  if (!input.reason.trim()) {
    return { ok: false, problems: [{ code: "REASON_REQUIRED", message: "A reason is required to request a baseline." }] };
  }

  const inputs = await readInputs(input.projectId);
  if ("code" in inputs && "message" in inputs) return { ok: false, problems: [inputs] };

  const prepared = buildBaselineRequest(inputs, new Date().toISOString().slice(0, 10));
  if (prepared.status === "refused") return { ok: false, problems: prepared.problems };

  const admin = untyped(createSupabaseAdminClient());
  const { data, error } = await admin.rpc("request_planning_baseline", {
    p_actor: user.id,
    p_project: input.projectId,
    p_reason: input.reason.trim(),
    p_fingerprint: prepared.fingerprint,
    p_curve: prepared.curve,
    p_engine_version: prepared.engineVersion,
  });
  const row = data as { id?: string } | null;
  if (error || !row?.id) return { ok: false, problems: [planningRefusal(error, BASELINE_FALLBACK)] };
  return { ok: true, value: { baselineId: row.id, kind: prepared.kind } };
}

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type {
  AmendmentStatus,
  SetupAmendment,
} from "@/features/projects/setup-amendments";
import type {
  ReportedProgressEntry,
  ReportedProgressEntryKind,
  SetupFinalisation,
} from "@/features/projects/reported-progress";
import { setupFieldEntry } from "@/features/projects/setup-governance";
import { proposalPayload, type StructureProposal } from "@/features/projects/structure-amendments";
import { describeFailure, type ServiceError } from "./service-errors";

/**
 * Phase 13.9B — Steps 3–4: the service layer over the Project Setup Governance
 * database contracts (migrations 20261016090000, 20261017090000,
 * 20261018090000, 20261019090000).
 *
 * Every write is one of the hardened database functions; this file never
 * writes a governance table directly and never re-implements an authority
 * rule — the database is authoritative and its refusals come back as the
 * plain sentence it raised (each 13.9B refusal is "[TAG] Sentence."). Reads go
 * through RLS (`can_access_project`), so a caller sees only what the database
 * lets them see.
 */

function client(): SupabaseClient {
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

const DENIED = "You do not have authority for this Project Setup governance action.";
const FALLBACK = "That could not be completed. Nothing was changed. Please try again.";

/** A 13.9B database refusal is written for the user after its tag. */
function databaseSentence(error: ServiceError): string | undefined {
  const tagged = /^\[[A-Z_]+\]\s*([\s\S]+)$/.exec((error.message ?? "").trim());
  return tagged ? tagged[1] : undefined;
}

async function failure(operation: string, error: ServiceError): Promise<Error> {
  return describeFailure({
    scope: "setup-governance-service",
    operation,
    error,
    known: databaseSentence(error),
    deniedMessage: DENIED,
    fallback: FALLBACK,
  });
}

/* --------------------------------- rows ---------------------------------- */

interface AmendmentRow {
  id: string;
  project_id: string;
  field_key: string;
  /** Step 4; absent only on a database without the structure migration. */
  target_key?: string | null;
  amendment_class: "lightweight" | "governed";
  previous_value: Record<string, unknown>;
  proposed_value: Record<string, unknown>;
  reason: string;
  impact_code: string | null;
  impact_warning: string;
  requested_by: string;
  requested_by_name: string | null;
  requested_at: string;
  status: AmendmentStatus;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_comment: string | null;
}

export function rowToAmendment(row: AmendmentRow): SetupAmendment {
  return {
    id: row.id,
    projectId: row.project_id,
    fieldKey: row.field_key,
    targetKey: row.target_key ?? "",
    amendmentClass: row.amendment_class,
    previousValue: row.previous_value ?? {},
    proposedValue: row.proposed_value ?? {},
    reason: row.reason,
    impactCode: row.impact_code,
    impactWarning: row.impact_warning,
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name,
    requestedAt: row.requested_at,
    status: row.status,
    decidedBy: row.decided_by,
    decidedByName: row.decided_by_name,
    decidedAt: row.decided_at,
    decisionComment: row.decision_comment,
  };
}

interface FinalisationRow {
  id: string;
  project_id: string;
  onboarding_mode_at_finalisation: "no_formal_schedule";
  state_before: "not_controlled";
  state_after: "controlled";
  acknowledgement: string;
  note: string | null;
  finalised_by: string;
  finalised_by_name: string | null;
  finalised_at: string;
  source: "project_setup";
}

export function rowToFinalisation(row: FinalisationRow): SetupFinalisation {
  return {
    id: row.id,
    projectId: row.project_id,
    onboardingModeAtFinalisation: row.onboarding_mode_at_finalisation,
    stateBefore: row.state_before,
    stateAfter: row.state_after,
    acknowledgement: row.acknowledgement,
    note: row.note,
    finalisedBy: row.finalised_by,
    finalisedByName: row.finalised_by_name,
    finalisedAt: row.finalised_at,
    source: row.source,
  };
}

interface ReportedProgressRow {
  id: string;
  project_id: string;
  data_date: string;
  entry_kind: ReportedProgressEntryKind;
  reported_planned_percent: number | string | null;
  reported_actual_percent: number | string | null;
  narrative: string | null;
  supersedes_entry_id: string | null;
  reason: string | null;
  is_backdated: boolean;
  source: "eprp_entry";
  recorded_by: string;
  recorded_by_name: string | null;
  recorded_at: string;
}

const percent = (value: number | string | null): number | null =>
  value === null || value === undefined ? null : Number(value);

export function rowToReportedProgress(row: ReportedProgressRow): ReportedProgressEntry {
  return {
    id: row.id,
    projectId: row.project_id,
    dataDate: row.data_date,
    entryKind: row.entry_kind,
    reportedPlannedPercent: percent(row.reported_planned_percent),
    reportedActualPercent: percent(row.reported_actual_percent),
    narrative: row.narrative,
    supersedesEntryId: row.supersedes_entry_id,
    reason: row.reason,
    isBackdated: row.is_backdated,
    source: row.source,
    recordedBy: row.recorded_by,
    recordedByName: row.recorded_by_name,
    recordedAt: row.recorded_at,
  };
}

/** A free / logged column change (`project_setup_field_changes`). */
export interface SetupFieldChange {
  id: string;
  projectId: string;
  fieldKey: string;
  previousValue: Record<string, unknown>;
  newValue: Record<string, unknown>;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: string;
}

/**
 * A Contacts / Sites / Parties (Step 3) or structure (Step 4) change
 * (`project_setup_relation_changes`).
 */
export interface SetupRelationChange {
  id: string;
  projectId: string;
  relation: "contacts" | "sites" | "parties" | "departments" | "disciplines" | "structure_levels" | "structure_units";
  action: "added" | "changed" | "removed";
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: string;
}

/** Where Setup stands, derived by the database (never stored). */
export interface SetupControlState {
  /** The earliest governance anchor; null while not Controlled. */
  controlledSince: string | null;
  finalisation: SetupFinalisation | null;
  hasPublishedSnapshot: boolean;
}

export const NOT_CONTROLLED: SetupControlState = {
  controlledSince: null,
  finalisation: null,
  hasPublishedSnapshot: false,
};

/** A pending amendment awaiting the viewer's decision, with its project. */
export interface ActionableAmendment {
  amendment: SetupAmendment;
  project: { id: string; code: string; name: string };
}

/* -------------------------------- service -------------------------------- */

export const setupGovernanceService = {
  /** Controlled state, finalisation and snapshot presence for one project. */
  async getControlState(projectId: string): Promise<SetupControlState> {
    if (!isSupabaseConfigured()) return NOT_CONTROLLED;
    const db = client();
    const [since, final, snapshot] = await Promise.all([
      db.rpc("project_setup_controlled_since", { p_project: projectId }),
      db.from("project_setup_finalisations").select("*").eq("project_id", projectId).maybeSingle(),
      db.from("planning_snapshots").select("id").eq("project_id", projectId).limit(1),
    ]);
    if (since.error) throw await failure("read the Project Setup control state", since.error);
    if (final.error) throw await failure("read the Setup Finalisation", final.error);
    if (snapshot.error) throw await failure("read the Planning Snapshots", snapshot.error);
    return {
      controlledSince: (since.data as string | null) ?? null,
      finalisation: final.data ? rowToFinalisation(final.data as FinalisationRow) : null,
      hasPublishedSnapshot: (snapshot.data ?? []).length > 0,
    };
  },

  /**
   * The authoritative current value of an amendable field, {column: value},
   * read when the Amend dialog opens. It is sent back as the base value, so a
   * change made in between is refused (PT409) rather than overwritten.
   */
  async getFieldValue(projectId: string, fieldKey: string): Promise<Record<string, unknown>> {
    const entry = setupFieldEntry(fieldKey);
    if (!entry || entry.kind !== "column") throw new Error("This field cannot be amended.");
    if (entry.targetTable === "project_planning_settings") {
      const { data, error } = await client()
        .from("project_planning_settings").select("onboarding_mode").eq("project_id", projectId).maybeSingle();
      if (error) throw await failure("read the current value", error);
      return { onboarding_mode: (data as { onboarding_mode?: string } | null)?.onboarding_mode ?? "new_project" };
    }
    const { data, error } = await client()
      .from("projects").select(entry.targetColumns.join(", ")).eq("id", projectId).single();
    if (error) throw await failure("read the current value", error);
    const row = data as unknown as Record<string, unknown>;
    return Object.fromEntries(entry.targetColumns.map((column) => [column, row[column] ?? null]));
  },

  async requestAmendment(input: {
    projectId: string;
    fieldKey: string;
    expectedValue: Record<string, unknown>;
    proposedValue: Record<string, unknown>;
    reason: string;
  }): Promise<SetupAmendment> {
    const { data, error } = await client().rpc("request_project_setup_amendment", {
      p_project: input.projectId,
      p_field_key: input.fieldKey,
      p_expected_value: input.expectedValue,
      p_proposed_value: input.proposedValue,
      p_reason: input.reason,
    });
    if (error) throw await failure("submit the amendment", error);
    return rowToAmendment(data as AmendmentRow);
  },

  /**
   * A governed structure / scope change on a Controlled project (Step 4).
   * The database validates the action against the live structure, records the
   * target's current state as the stale basis and refuses a second pending
   * request on the same target. Nothing changes until another Project Control
   * Admin or System Administrator approves it.
   */
  async requestStructureAmendment(input: {
    projectId: string;
    proposal: StructureProposal;
    reason: string;
  }): Promise<SetupAmendment> {
    const { data, error } = await client().rpc("request_project_structure_amendment", {
      p_project: input.projectId,
      p_field_key: input.proposal.fieldKey,
      p_proposed: proposalPayload(input.proposal),
      p_reason: input.reason,
    });
    if (error) throw await failure("submit the structure change", error);
    return rowToAmendment(data as AmendmentRow);
  },

  async approveAmendment(amendmentId: string, comment?: string): Promise<SetupAmendment> {
    const { data, error } = await client().rpc("decide_project_setup_amendment", {
      p_amendment: amendmentId,
      p_decision: "approve",
      p_comment: comment?.trim() || null,
    });
    if (error) throw await failure("approve the amendment", error);
    return rowToAmendment(data as AmendmentRow);
  },

  async rejectAmendment(amendmentId: string, comment: string): Promise<SetupAmendment> {
    const { data, error } = await client().rpc("decide_project_setup_amendment", {
      p_amendment: amendmentId,
      p_decision: "reject",
      p_comment: comment,
    });
    if (error) throw await failure("reject the amendment", error);
    return rowToAmendment(data as AmendmentRow);
  },

  async withdrawAmendment(amendmentId: string, comment?: string): Promise<SetupAmendment> {
    const { data, error } = await client().rpc("withdraw_project_setup_amendment", {
      p_amendment: amendmentId,
      p_comment: comment?.trim() || null,
    });
    if (error) throw await failure("withdraw the amendment", error);
    return rowToAmendment(data as AmendmentRow);
  },

  async listProjectAmendments(projectId: string): Promise<SetupAmendment[]> {
    if (!isSupabaseConfigured()) return [];
    const { data, error } = await client()
      .from("project_setup_amendments").select("*").eq("project_id", projectId)
      .order("requested_at", { ascending: false });
    if (error) throw await failure("load the Project Setup amendments", error);
    return ((data ?? []) as AmendmentRow[]).map(rowToAmendment);
  },

  /**
   * Pending requests the viewer may decide, across projects: never their own,
   * never on an archived project (presentation; the database re-checks).
   */
  async listActionableApprovals(viewerProfileId: string): Promise<ActionableAmendment[]> {
    if (!isSupabaseConfigured() || !viewerProfileId) return [];
    const { data, error } = await client()
      .from("project_setup_amendments")
      .select("*, projects!inner(id, code, name, status)")
      .eq("status", "pending")
      .neq("requested_by", viewerProfileId)
      .order("requested_at", { ascending: true });
    if (error) throw await failure("load the amendment approvals", error);
    return ((data ?? []) as (AmendmentRow & { projects: { id: string; code: string; name: string; status: string } })[])
      .filter((row) => row.projects.status !== "archived")
      .map((row) => ({
        amendment: rowToAmendment(row),
        project: { id: row.projects.id, code: row.projects.code, name: row.projects.name },
      }));
  },

  async listFieldChanges(projectId: string): Promise<SetupFieldChange[]> {
    if (!isSupabaseConfigured()) return [];
    const { data, error } = await client()
      .from("project_setup_field_changes").select("*").eq("project_id", projectId)
      .order("changed_at", { ascending: false });
    if (error) throw await failure("load the Project Setup changes", error);
    return ((data ?? []) as {
      id: string; project_id: string; field_key: string; previous_value: Record<string, unknown>;
      new_value: Record<string, unknown>; changed_by: string | null; changed_by_name: string | null; changed_at: string;
    }[]).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      fieldKey: row.field_key,
      previousValue: row.previous_value,
      newValue: row.new_value,
      changedBy: row.changed_by,
      changedByName: row.changed_by_name,
      changedAt: row.changed_at,
    }));
  },

  async listRelationChanges(projectId: string): Promise<SetupRelationChange[]> {
    if (!isSupabaseConfigured()) return [];
    const { data, error } = await client()
      .from("project_setup_relation_changes").select("*").eq("project_id", projectId)
      .order("changed_at", { ascending: false });
    if (error) throw await failure("load the Project Setup relation history", error);
    return ((data ?? []) as {
      id: string; project_id: string; relation: SetupRelationChange["relation"]; action: SetupRelationChange["action"];
      previous_value: Record<string, unknown> | null; new_value: Record<string, unknown> | null;
      changed_by: string | null; changed_by_name: string | null; changed_at: string;
    }[]).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      relation: row.relation,
      action: row.action,
      previousValue: row.previous_value,
      newValue: row.new_value,
      changedBy: row.changed_by,
      changedByName: row.changed_by_name,
      changedAt: row.changed_at,
    }));
  },

  /* ---------------------------- Finalisation ---------------------------- */

  async finaliseSetup(input: { projectId: string; acknowledgement: string; note?: string }): Promise<SetupFinalisation> {
    const { data, error } = await client().rpc("finalise_project_setup", {
      p_project: input.projectId,
      p_confirm: true,
      p_acknowledgement: input.acknowledgement,
      p_note: input.note?.trim() || null,
    });
    if (error) throw await failure("finalise Project Setup", error);
    return rowToFinalisation(data as FinalisationRow);
  },

  /* -------------------------- Reported Progress -------------------------- */

  async listReportedProgress(projectId: string): Promise<ReportedProgressEntry[]> {
    if (!isSupabaseConfigured()) return [];
    const { data, error } = await client()
      .from("project_reported_progress").select("*").eq("project_id", projectId)
      .order("data_date", { ascending: false }).order("recorded_at", { ascending: true });
    if (error) throw await failure("load the Reported Progress history", error);
    return ((data ?? []) as ReportedProgressRow[]).map(rowToReportedProgress);
  },

  /** The latest valid position (`project_reported_progress_latest()`), or null. */
  async getLatestReportedProgress(projectId: string): Promise<ReportedProgressEntry | null> {
    if (!isSupabaseConfigured()) return null;
    const { data, error } = await client().rpc("project_reported_progress_latest", { p_project: projectId });
    if (error) throw await failure("load the latest Reported Progress", error);
    const rows = (data ?? []) as ReportedProgressRow[];
    return rows.length > 0 ? rowToReportedProgress(rows[0]) : null;
  },

  async recordReportedProgress(input: {
    projectId: string;
    dataDate: string;
    reportedActualPercent: number;
    reportedPlannedPercent?: number | null;
    narrative: string;
    reason?: string;
  }): Promise<ReportedProgressEntry> {
    const { data, error } = await client().rpc("record_reported_progress", {
      p_project: input.projectId,
      p_data_date: input.dataDate,
      p_reported_actual_percent: input.reportedActualPercent,
      p_narrative: input.narrative,
      p_reported_planned_percent: input.reportedPlannedPercent ?? null,
      p_reason: input.reason?.trim() || null,
    });
    if (error) throw await failure("record Reported Progress", error);
    return rowToReportedProgress(data as ReportedProgressRow);
  },

  async correctReportedProgress(input: {
    entryId: string;
    reportedActualPercent: number;
    reportedPlannedPercent?: number | null;
    narrative: string;
    reason: string;
  }): Promise<ReportedProgressEntry> {
    const { data, error } = await client().rpc("correct_reported_progress", {
      p_entry: input.entryId,
      p_reported_actual_percent: input.reportedActualPercent,
      p_narrative: input.narrative,
      p_reason: input.reason,
      p_reported_planned_percent: input.reportedPlannedPercent ?? null,
    });
    if (error) throw await failure("correct the Reported Progress entry", error);
    return rowToReportedProgress(data as ReportedProgressRow);
  },

  async withdrawReportedProgress(input: { entryId: string; reason: string }): Promise<ReportedProgressEntry> {
    const { data, error } = await client().rpc("withdraw_reported_progress", {
      p_entry: input.entryId,
      p_reason: input.reason,
    });
    if (error) throw await failure("withdraw the Reported Progress entry", error);
    return rowToReportedProgress(data as ReportedProgressRow);
  },
};

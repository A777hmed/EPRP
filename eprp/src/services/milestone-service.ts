import type {
  MasterMilestone,
  MilestoneClientApprovalStatus,
  MilestonePaymentStatus,
  MilestonePriority,
  MilestoneSource,
  MilestoneStatus,
  MilestoneType,
  MilestoneUpdate,
  MilestoneUpdateSource,
} from "@/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  MasterMilestoneRow,
  MilestoneUpdateRow,
} from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeFailure, type ServiceError } from "./service-errors";

/**
 * Master Milestones (Phase 13.2).
 *
 * Identity and state are separate operations because they are separate
 * authorities: `create`/`update` write the register and are Project Control's,
 * while `submitUpdate` appends to the state stream and is open to any
 * contributor scoped to the milestone's department. Row-level security enforces
 * both independently of this file.
 *
 * Nothing here computes current state — that is `milestone-state.ts`, so every
 * tier reads the same derivation.
 */

function client(): SupabaseClient {
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * A number a user typed, or null.
 *
 * Blank means "not stated", never zero — the same rule the register applies to
 * an unreported progress figure. A value that is not a number is also null
 * rather than NaN, so the database is never asked to store one.
 */
function num(value: number | string | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return Number.isFinite(value) ? value : null;
}

function mapMilestone(row: MasterMilestoneRow): MasterMilestone {
  return {
    id: row.id,
    projectId: row.project_id,
    code: row.code,
    name: row.name,
    description: row.description ?? undefined,
    departmentId: row.department_id ?? undefined,
    systemId: row.system_id ?? undefined,
    disciplineId: row.discipline_id ?? undefined,
    baselineDate: row.baseline_date ?? undefined,
    priority: row.priority as MilestonePriority,
    ownerContactId: row.owner_contact_id ?? undefined,
    source: row.source as MilestoneSource,
    sourceDocumentId: row.source_document_id ?? undefined,
    active: row.active,
    archivedAt: row.archived_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,

    // 13.2c. `milestone_type` defaults to 'technical' in the database, so a row
    // written before this migration still classifies correctly.
    type: (row.milestone_type ?? "technical") as MilestoneType,
    category: row.category ?? undefined,
    plannedDate: row.planned_date ?? undefined,
    weightPercent: row.weight_percent ?? undefined,
    plannedProgressPercent: row.planned_progress_percent ?? undefined,
    predecessorMilestoneId: row.predecessor_milestone_id ?? undefined,
    clientApprovalRequired: row.client_approval_required ?? false,
    notes: row.notes ?? undefined,
    paymentPercent: row.payment_percent ?? undefined,
    paymentAmount: row.payment_amount ?? undefined,
    paymentDueDate: row.payment_due_date ?? undefined,
    isAdvancePayment: row.is_advance_payment ?? false,
  };
}

function mapUpdate(row: MilestoneUpdateRow): MilestoneUpdate {
  return {
    id: row.id,
    milestoneId: row.milestone_id,
    source: row.source as MilestoneUpdateSource,
    weeklyReportId: row.weekly_report_id ?? undefined,
    monthlyReportId: row.monthly_report_id ?? undefined,
    departmentId: row.department_id ?? undefined,
    disciplineId: row.discipline_id ?? undefined,
    status: row.status as MilestoneStatus,
    progressPercent: row.progress_percent ?? undefined,
    forecastDate: row.forecast_date ?? undefined,
    actualDate: row.actual_date ?? undefined,
    narrative: row.narrative ?? undefined,
    approvalStatus: row.approval_status as MilestoneUpdate["approvalStatus"],
    approvedByContactId: row.approved_by_contact_id ?? undefined,
    approvedAt: row.approved_at ?? undefined,
    decisionNote: row.decision_note ?? undefined,
    isRegression: row.is_regression,
    regressionReason: row.regression_reason ?? undefined,
    submittedByContactId: row.submitted_by_contact_id ?? undefined,
    submittedAt: row.submitted_at,

    // 13.2c reported facts.
    paymentStatus:
      (row.payment_status as MilestonePaymentStatus | null) ?? undefined,
    invoiceReference: row.invoice_reference ?? undefined,
    invoicedDate: row.invoiced_date ?? undefined,
    receivedDate: row.received_date ?? undefined,
    recoveredAmount: row.recovered_amount ?? undefined,
    clientApprovalStatus:
      (row.client_approval_status as MilestoneClientApprovalStatus | null) ??
      undefined,
    clientApprovalDate: row.client_approval_date ?? undefined,

    // 13.2d.
    asOfDate: row.as_of_date ?? undefined,
    adoptedFromUpdateId: row.adopted_from_update_id ?? undefined,
    reconciliationReason: row.reconciliation_reason ?? undefined,
  };
}

/** Identity fields a user may set. Never status, progress or forecast. */
export interface MilestoneInput {
  code: string;
  name: string;
  description?: string;
  departmentId?: string;
  systemId?: string;
  disciplineId?: string;
  baselineDate?: string;
  priority: MilestonePriority;
  ownerContactId?: string;
  source?: MilestoneSource;
  sourceDocumentId?: string;

  /* --------------------------- 13.2c — the plan -------------------------- */
  type: MilestoneType;
  category?: string;
  plannedDate?: string;
  /** Physical weight. Sent as null on a commercial milestone — see `write()`. */
  weightPercent?: number | string;
  plannedProgressPercent?: number | string;
  predecessorMilestoneId?: string;
  clientApprovalRequired?: boolean;
  notes?: string;

  /* --------------- 13.2c — commercial plan (type "commercial") ----------- */
  paymentPercent?: number | string;
  paymentAmount?: number | string;
  paymentDueDate?: string;
  isAdvancePayment?: boolean;
}

/**
 * Identity columns, built once for both create and update.
 *
 * The commercial fields are cleared unless the milestone IS commercial, and the
 * physical weight is cleared when it is. Both are also refused by CHECK
 * constraints; doing it here as well means a user who reclassifies an existing
 * milestone gets a clean save rather than a constraint error they cannot act
 * on. The database stays the authority — this only keeps the form honest.
 */
function identityColumns(input: MilestoneInput) {
  const commercial = input.type === "commercial";
  return {
    code: input.code.trim(),
    name: input.name.trim(),
    description: clean(input.description),
    department_id: clean(input.departmentId),
    system_id: clean(input.systemId),
    discipline_id: clean(input.disciplineId),
    baseline_date: clean(input.baselineDate),
    priority: input.priority,
    owner_contact_id: clean(input.ownerContactId),
    source_document_id: clean(input.sourceDocumentId),

    milestone_type: input.type,
    category: clean(input.category),
    planned_date: clean(input.plannedDate),
    // Money is not delivered work: a commercial milestone carries no physical
    // weight, and the database refuses one outright.
    weight_percent: commercial ? null : num(input.weightPercent),
    planned_progress_percent: num(input.plannedProgressPercent),
    predecessor_milestone_id: clean(input.predecessorMilestoneId),
    client_approval_required: input.clientApprovalRequired ?? false,
    notes: clean(input.notes),

    payment_percent: commercial ? num(input.paymentPercent) : null,
    payment_amount: commercial ? num(input.paymentAmount) : null,
    payment_due_date: commercial ? clean(input.paymentDueDate) : null,
    is_advance_payment: commercial ? (input.isAdvancePayment ?? false) : false,
  };
}

/** One reported change of state. */
export interface MilestoneUpdateInput {
  milestoneId: string;
  source: MilestoneUpdateSource;
  weeklyReportId?: string;
  monthlyReportId?: string;
  departmentId?: string;
  disciplineId?: string;
  status: MilestoneStatus;
  progressPercent?: number;
  forecastDate?: string;
  actualDate?: string;
  narrative?: string;
  /** Set by the caller from `isRegression()` before submitting. */
  isRegression?: boolean;
  submittedByContactId?: string;

  /* ---------- 13.2c — commercial actuals, for commercial milestones ------- */
  paymentStatus?: MilestonePaymentStatus;
  invoiceReference?: string;
  invoicedDate?: string;
  receivedDate?: string;
  recoveredAmount?: number | string;

  /* ------------------- 13.2c — what the CLIENT decided ------------------- */
  clientApprovalStatus?: MilestoneClientApprovalStatus;
  clientApprovalDate?: string;

  /**
   * 13.2d — the reporting cut-off this describes.
   *
   * Optional here so existing callers keep working, but Weekly and Monthly MUST
   * supply it when 13.4 wires them in: without a cut-off a figure cannot be
   * compared against another source, and conflict detection silently skips it.
   */
  asOfDate?: string;
}

/**
 * Project Control declaring the OFFICIAL progress for one cut-off (13.2d).
 *
 * The one act behind all three offered choices — adopt Weekly, adopt Monthly,
 * or enter an independent figure. Adopting is just a reconciliation whose value
 * happens to equal a reported one, recorded with `adoptedFromUpdateId` so the
 * provenance survives.
 */
export interface MilestoneReconciliationInput {
  milestoneId: string;
  /** The cut-off being resolved. Required — a reconciliation resolves a date. */
  asOfDate: string;
  /** The official figure. */
  progressPercent: number;
  status: MilestoneStatus;
  /** The reported update adopted, when one was. Omit for an independent figure. */
  adoptedFromUpdateId?: string;
  /** Mandatory. The database refuses a blank one. */
  reconciliationReason: string;
  departmentId?: string;
  disciplineId?: string;
  narrative?: string;
  reconciledByContactId?: string;
}

export const milestoneService = {
  async list(projectId: string): Promise<MasterMilestone[]> {
    const { data, error } = await client()
      .from("master_milestones")
      .select("*")
      .eq("project_id", projectId)
      .order("baseline_date", { ascending: true, nullsFirst: false })
      .order("code", { ascending: true });
    if (error) throw await readFailure("list milestones", error);
    return ((data ?? []) as MasterMilestoneRow[]).map(mapMilestone);
  },

  /**
   * Every update for a project's milestones, in one read.
   *
   * Fetched as a set rather than per milestone so a register of any size costs
   * one round trip, and so the derivation sees the whole stream at once.
   */
  async listUpdates(projectId: string): Promise<MilestoneUpdate[]> {
    const { data: milestones, error: milestoneError } = await client()
      .from("master_milestones")
      .select("id")
      .eq("project_id", projectId);
    if (milestoneError) throw new Error(milestoneError.message);

    const ids = ((milestones ?? []) as Pick<MasterMilestoneRow, "id">[]).map(
      (row) => row.id
    );
    if (ids.length === 0) return [];

    const { data, error } = await client()
      .from("milestone_updates")
      .select("*")
      .in("milestone_id", ids)
      .order("submitted_at", { ascending: false })
      // Deterministic tie-break. Several updates written in one transaction
      // share a submitted_at, and without a stable secondary key "latest"
      // would depend on the order the database happened to return rows in.
      .order("id", { ascending: false });
    if (error) throw await readFailure("list milestone updates", error);
    return ((data ?? []) as MilestoneUpdateRow[]).map(mapUpdate);
  },

  /**
   * THE REPORTING INTEGRATION CONTRACT (Phase 13.4 / 13.7).
   *
   * One read of the governed register across many projects, for the tiers that
   * present milestones rather than manage them — Weekly, Monthly, Executive and
   * the Dashboard.
   *
   * Those tiers currently read `weekly_plan_items` / `monthly_plan_items`,
   * which are per-report ad-hoc rows and not a register: the same commitment
   * appears once per report, with no identity, no baseline and no governance.
   * This is the replacement source. It returns identity and stream separately,
   * exactly as the per-project reads do, so every tier derives current state
   * through `milestoneStates()` in `milestone-state.ts` and none of them can
   * invent its own rule.
   *
   * Archived milestones are excluded: they are history, not commitments, and a
   * report that lists them would overstate what the project owes.
   *
   * Two round trips regardless of how many projects are asked for. RLS still
   * applies — a caller sees only the projects they can already access.
   */
  async listRegister(projectIds: string[]): Promise<{
    milestones: MasterMilestone[];
    updates: MilestoneUpdate[];
  }> {
    if (projectIds.length === 0) return { milestones: [], updates: [] };

    const { data: rows, error } = await client()
      .from("master_milestones")
      .select("*")
      .in("project_id", projectIds)
      .eq("active", true)
      .order("planned_date", { ascending: true, nullsFirst: false })
      .order("code", { ascending: true });
    if (error) throw await readFailure("read the milestone register", error);

    const milestones = ((rows ?? []) as MasterMilestoneRow[]).map(mapMilestone);
    if (milestones.length === 0) return { milestones, updates: [] };

    const { data: stream, error: streamError } = await client()
      .from("milestone_updates")
      .select("*")
      .in(
        "milestone_id",
        milestones.map((milestone) => milestone.id)
      )
      .order("submitted_at", { ascending: false })
      // Deterministic tie-break. Several updates written in one transaction
      // share a submitted_at, and without a stable secondary key "latest"
      // would depend on the order the database happened to return rows in.
      .order("id", { ascending: false });
    if (streamError) throw new Error(streamError.message);

    return {
      milestones,
      updates: ((stream ?? []) as MilestoneUpdateRow[]).map(mapUpdate),
    };
  },

  async create(
    projectId: string,
    input: MilestoneInput
  ): Promise<MasterMilestone> {
    const { data, error } = await client()
      .from("master_milestones")
      .insert({
        project_id: projectId,
        ...identityColumns(input),
        source: input.source ?? "manual",
      })
      .select("*")
      .single();
    if (error) throw await writeFailure("create the milestone", error);
    return mapMilestone(data as MasterMilestoneRow);
  },

  /** Edit identity. Current state is untouched — that lives in the stream. */
  async update(
    milestoneId: string,
    input: MilestoneInput
  ): Promise<MasterMilestone> {
    const { data, error } = await client()
      .from("master_milestones")
      .update(identityColumns(input))
      .eq("id", milestoneId)
      .select("*")
      .single();
    if (error) throw await writeFailure("edit the milestone", error);
    return mapMilestone(data as MasterMilestoneRow);
  },

  /**
   * Archive rather than delete.
   *
   * A milestone carries history that Weekly and Monthly reference; removing it
   * would break the record. There is deliberately no DELETE policy on the
   * table, so this is the only way out of the register.
   */
  async setActive(
    milestoneId: string,
    active: boolean
  ): Promise<MasterMilestone> {
    const { data, error } = await client()
      .from("master_milestones")
      .update({ active, archived_at: active ? null : new Date().toISOString() })
      .eq("id", milestoneId)
      .select("*")
      .single();
    if (error) {
      throw await writeFailure(
        active ? "restore the milestone" : "archive the milestone",
        error
      );
    }
    return mapMilestone(data as MasterMilestoneRow);
  },

  /**
   * Append a reported change of state.
   *
   * Always lands as `pending`. Nothing here can make an update official — that
   * is the approval step, and it is a different authority.
   */
  async submitUpdate(input: MilestoneUpdateInput): Promise<MilestoneUpdate> {
    const { data, error } = await client()
      .from("milestone_updates")
      .insert({
        milestone_id: input.milestoneId,
        source: input.source,
        weekly_report_id: clean(input.weeklyReportId),
        monthly_report_id: clean(input.monthlyReportId),
        department_id: clean(input.departmentId),
        discipline_id: clean(input.disciplineId),
        status: input.status,
        progress_percent: input.progressPercent ?? null,
        forecast_date: clean(input.forecastDate),
        actual_date: clean(input.actualDate),
        narrative: clean(input.narrative),
        is_regression: input.isRegression ?? false,
        submitted_by_contact_id: clean(input.submittedByContactId),
        approval_status: "pending",

        // 13.2c. Null when not reported — absence is not "planned", and not
        // zero recovered.
        payment_status: input.paymentStatus ?? null,
        invoice_reference: clean(input.invoiceReference),
        invoiced_date: clean(input.invoicedDate),
        received_date: clean(input.receivedDate),
        recovered_amount: num(input.recoveredAmount),
        client_approval_status: input.clientApprovalStatus ?? null,
        client_approval_date: clean(input.clientApprovalDate),
        as_of_date: clean(input.asOfDate),
      })
      .select("*")
      .single();
    if (error) throw await writeFailure("submit the update", error);
    return mapUpdate(data as MilestoneUpdateRow);
  },

  /**
   * Resolve a cut-off (13.2d).
   *
   * Appends the governance decision as a NEW row — the reported Weekly and
   * Monthly rows it settles are never touched, so the disagreement stays on the
   * record alongside its resolution.
   *
   * Written already `approved`, because a reconciliation IS the approval: it is
   * authored by Project Control, and routing it into a queue would ask the same
   * person to accept their own decision. The database enforces that too, and
   * refuses a reconciliation from anyone without reconciliation authority.
   */
  async reconcile(
    input: MilestoneReconciliationInput
  ): Promise<MilestoneUpdate> {
    const now = new Date().toISOString();
    const { data, error } = await client()
      .from("milestone_updates")
      .insert({
        milestone_id: input.milestoneId,
        source: "reconciliation",
        as_of_date: input.asOfDate,
        status: input.status,
        progress_percent: input.progressPercent,
        adopted_from_update_id: clean(input.adoptedFromUpdateId),
        reconciliation_reason: input.reconciliationReason.trim(),
        department_id: clean(input.departmentId),
        discipline_id: clean(input.disciplineId),
        narrative: clean(input.narrative),
        // Reconciled BY and AT are these two columns on a reconciliation row —
        // deliberately not a second pair of columns saying the same thing.
        submitted_by_contact_id: clean(input.reconciledByContactId),
        approval_status: "approved",
        approved_at: now,
        approved_by_contact_id: clean(input.reconciledByContactId),
      })
      .select("*")
      .single();
    if (error) throw await writeFailure("reconcile the cut-off", error);
    return mapUpdate(data as MilestoneUpdateRow);
  },

  /**
   * Decide a pending update.
   *
   * Approving a flagged regression requires a reason — the database refuses it
   * otherwise, so the rule cannot be bypassed by a future caller. The decision
   * is final: correcting it means submitting a new update, never rewriting this
   * one.
   */
  async decide(
    updateId: string,
    decision: "approved" | "rejected",
    options: { decisionNote?: string; regressionReason?: string } = {}
  ): Promise<MilestoneUpdate> {
    const { data, error } = await client()
      .from("milestone_updates")
      .update({
        approval_status: decision,
        decision_note: clean(options.decisionNote),
        regression_reason: clean(options.regressionReason),
      })
      .eq("id", updateId)
      .select("*")
      .single();
    if (error) throw await writeFailure("decide the update", error);
    return mapUpdate(data as MilestoneUpdateRow);
  },
};

/**
 * Turn the database's own words into the user's.
 *
 * The constraints are the authority — this only translates them, so a rule can
 * never be enforced in one place and worded differently in another. The
 * mechanism lives in `service-errors.ts`; what stays here is this register's
 * own constraint dictionary and its wording.
 */

const DENIED =
  "You do not have permission to change this project's milestone register. Project Control manages milestones for this project.";

async function writeFailure(
  operation: string,
  error: ServiceError
): Promise<Error> {
  return describeFailure({
    scope: "milestone-service",
    operation,
    error,
    known: friendly(error.message),
    deniedMessage: DENIED,
    fallback:
      "That change could not be saved. Please try again, and let Project Control know if it keeps happening.",
  });
}

async function readFailure(
  operation: string,
  error: ServiceError
): Promise<Error> {
  return describeFailure({
    scope: "milestone-service",
    operation,
    error,
    deniedMessage: DENIED,
    fallback: "The milestone register could not be loaded. Please try again.",
  });
}

/**
 * Known constraint violations, worded for the person who hit them.
 *
 * Returns `undefined` when the message is not one we recognise, so the caller
 * substitutes a safe generic rather than echoing raw database text.
 */
function friendly(message: string): string | undefined {
  if (message.includes("master_milestones_project_code_unique")) {
    return "Another milestone on this project already uses that code.";
  }
  if (message.includes("milestone_updates_regression_reason")) {
    return "This update reports less progress than the approved figure. Give a reason before approving it.";
  }
  if (message.includes("milestone_updates_status_valid")) {
    return "That is not a valid milestone status.";
  }
  if (message.includes("milestone_updates_progress_range")) {
    return "Progress must be between 0 and 100.";
  }
  // 13.2c.
  if (message.includes("master_milestones_commercial_no_physical_weight")) {
    return "A commercial milestone cannot carry a physical weight — payment is tracked separately from delivered progress.";
  }
  if (message.includes("master_milestones_payment_needs_commercial")) {
    return "Payment details only apply to a Commercial / Payment milestone.";
  }
  if (message.includes("master_milestones_weight_range")) {
    return "Weight must be between 0 and 100.";
  }
  if (message.includes("master_milestones_planned_progress_range")) {
    return "Planned progress must be between 0 and 100.";
  }
  if (message.includes("master_milestones_payment_percent_range")) {
    return "Payment % must be between 0 and 100.";
  }
  if (message.includes("master_milestones_payment_amount_positive")) {
    return "A payment amount cannot be negative.";
  }
  if (message.includes("master_milestones_predecessor_not_self")) {
    return "A milestone cannot depend on itself.";
  }
  if (message.includes("milestone_updates_recovered_amount_positive")) {
    return "A recovered amount cannot be negative.";
  }
  if (message.includes("milestone_updates_client_approval_date_needs_decision")) {
    return "Record a client approval date only once the client has approved or rejected.";
  }
  // 13.2d.
  if (message.includes("milestone_updates_reconciliation_complete")) {
    return "A reconciliation needs a cut-off date, an official progress figure and a reason.";
  }
  if (message.includes("milestone_updates_reconciliation_fields")) {
    return "Only a reconciliation can carry an adopted value or a reconciliation reason.";
  }
  if (message.includes("milestone_updates_reconciliation_is_decided")) {
    return "A reconciliation is the decision, so it cannot be left awaiting approval.";
  }
  // Reconciliation is the one RLS refusal specific enough to name precisely:
  // this table's only restricted write is the reconciliation row.
  if (
    message.includes("row-level security") &&
    message.includes("milestone_updates")
  ) {
    return "You do not have authority to reconcile milestone progress on this project. Reconciliation is Project Control's decision.";
  }
  // Deliberately NOT `return message`. An unrecognised database message is a
  // diagnostic, and the caller turns it into something safe to show.
  return undefined;
}

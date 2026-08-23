import type {
  MasterMilestone,
  MilestoneClientApprovalStatus,
  MilestonePaymentStatus,
  MilestoneStatus,
  MilestoneUpdate,
} from "@/types";

/**
 * Deriving a milestone's current state from its update stream.
 *
 * Pure functions, no storage. This is the single place the platform answers
 * "how is this milestone going?", so Master Planning, Weekly, Monthly,
 * Executive and the Dashboard cannot each derive it slightly differently.
 *
 * The rule is frozen (R5): **current state is the latest APPROVED update**, not
 * the latest submitted one. A pending update is visible as pending and changes
 * nothing official until Project Control accepts it.
 */

/**
 * How one reporting cut-off resolved (13.2d).
 *
 * A cut-off is a date several sources may report against. It resolves when
 * either exactly one figure was approved for it, or Project Control reconciled
 * it. It is `in_conflict` when two or more approved sources disagree and nobody
 * has adjudicated — and an unresolved cut-off never yields an official figure.
 */
export interface CutoffState {
  asOfDate: string;
  /** approved | in_conflict | unreported */
  resolution: "agreed" | "reconciled" | "in_conflict" | "unreported";
  /** The governed figure, present only when the cut-off resolved. */
  officialProgressPercent?: number;
  /** The update that defines the official figure. */
  officialUpdate?: MilestoneUpdate;
  /** Every approved OBSERVATION at this cut-off (never reconciliations). */
  reported: MilestoneUpdate[];
  /** The distinct approved figures. Length > 1 is what makes a conflict. */
  reportedValues: number[];
  /** Reconciliations for this cut-off, newest first. */
  reconciliations: MilestoneUpdate[];
}

/** A milestone plus everything derived from its stream. */
export interface MilestoneState {
  milestone: MasterMilestone;
  /** The update that defines the current figures, if any has been approved. */
  current?: MilestoneUpdate;
  /** Submitted updates still awaiting a decision, newest first. */
  pending: MilestoneUpdate[];
  /** Approved history, newest first. `current` is its first entry. */
  history: MilestoneUpdate[];
  /**
   * Every update ever submitted against this milestone, newest first —
   * rejections included. Nothing here decides the current figures; it is the
   * record, and a rejected update that vanishes makes the register read as
   * though the figure was never raised.
   */
  allUpdates: MilestoneUpdate[];
  status: MilestoneStatus;
  /** Undefined when nothing has been approved — never silently zero. */
  progressPercent?: number;
  forecastDate?: string;
  actualDate?: string;
  /** True once an actual date has been approved. */
  complete: boolean;
  /** Approved forecast/actual is later than baseline. Undefined when unknowable. */
  slipDays?: number;

  /* ------------------------------ 13.2c -------------------------------- */
  /**
   * Days between the current PLANNED date and the approved forecast/actual.
   * Positive is late. Distinct from `slipDays`, which measures against the
   * frozen baseline: a re-planned milestone can be on plan and still behind
   * baseline, and management needs both numbers, not a blend of them.
   */
  varianceDays?: number;
  /**
   * Approved progress minus planned progress. Negative is behind plan.
   * Undefined unless BOTH figures exist — a variance against an unstated plan
   * would be a number nobody committed to.
   */
  progressVariance?: number;
  /** True for a Commercial / Payment milestone. Excluded from physical progress. */
  commercial: boolean;
  /** Reported payment position, once approved. */
  paymentStatus?: MilestonePaymentStatus;
  /** Reported client decision, once approved. Never our own approval. */
  clientApprovalStatus?: MilestoneClientApprovalStatus;
  /** Approved recovery of an advance, in money. */
  recoveredAmount?: number;
  /** Recovered ÷ agreed amount, 0–100. Undefined when no amount was agreed. */
  recoveryPercent?: number;
  /** Agreed amount still to be recovered. Undefined when no amount was agreed. */
  outstandingAdvance?: number;

  /* ------------------------ 13.2d — reconciliation ---------------------- */
  /** Every dated cut-off, newest first. Undated rows are not cut-offs. */
  cutoffs: CutoffState[];
  /**
   * Cut-offs where approved sources disagree and nobody has reconciled.
   * Non-empty means Project Control owes a decision.
   */
  conflicts: CutoffState[];
  /** True when any cut-off is unresolved. */
  inConflict: boolean;
}

/**
 * Newest first, deterministically.
 *
 * `submittedAt` alone is not a total order: several updates written in one
 * transaction share a timestamp — which is exactly what 13.4's report
 * finalization hook will do — and a tie left "current state" depending on the
 * order the database happened to return rows in. `id` breaks it stably.
 */
const newestFirst = (a: MilestoneUpdate, b: MilestoneUpdate) =>
  b.submittedAt.localeCompare(a.submittedAt) || b.id.localeCompare(a.id);

/** Whole days between two ISO dates, positive when `later` is after `earlier`. */
function daysBetween(earlier: string, later: string): number {
  const from = Date.parse(earlier);
  const to = Date.parse(later);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/**
 * Fold one milestone's updates into its current state.
 *
 * `updates` may be the whole project's stream; rows for other milestones are
 * ignored, so callers can pass one fetch rather than slicing per milestone.
 */
export function milestoneState(
  milestone: MasterMilestone,
  updates: MilestoneUpdate[]
): MilestoneState {
  const mine = updates
    .filter((update) => update.milestoneId === milestone.id)
    .sort(newestFirst);
  const history = mine
    .filter((update) => update.approvalStatus === "approved")
    .sort(newestFirst);
  const pending = mine
    .filter((update) => update.approvalStatus === "pending")
    .sort(newestFirst);

  /*
   * R5, as amended in 13.2d.
   *
   *   was  "current = latest approved"
   *   now  "current = latest RESOLVED governed value for the latest RESOLVED
   *        cut-off"
   *
   * The old rule made the official figure depend on data-entry order: Weekly
   * 50% and Monthly 60%, both approved, resolved to whichever was written last.
   * Reversing the entry order reversed the answer.
   *
   * Rows that state no cut-off cannot be compared against anything, so they are
   * exempt and keep the old behaviour — which is what makes this change
   * invisible to every row written before 13.2d. A dated cut-off outranks them
   * whenever one exists, because a figure that declares what it describes is
   * worth more than one that does not.
   */
  const cutoffs = resolveCutoffs(history);
  const conflicts = cutoffs.filter(
    (cutoff) => cutoff.resolution === "in_conflict"
  );
  const resolved = cutoffs.find((cutoff) => cutoff.officialUpdate);

  const undated = history.filter((update) => !update.asOfDate);
  const current = resolved?.officialUpdate ?? undated[0];

  /*
   * Absence is never zero. A milestone with nothing approved reports
   * `not_started` with an UNDEFINED progress, so a caller cannot average it in
   * as 0% — the same rule the dashboard already applies to unreported projects.
   */
  const slipBase = current?.actualDate ?? current?.forecastDate;
  const slipDays =
    milestone.baselineDate && slipBase
      ? daysBetween(milestone.baselineDate, slipBase)
      : undefined;

  /*
   * Two variances, deliberately not merged.
   *
   *   slipDays     — against the frozen BASELINE. What the contract said.
   *   varianceDays — against the current PLAN. What we last agreed.
   *
   * A re-planned milestone is on plan and behind baseline at the same time.
   * Averaging or picking one would hide whichever fact is inconvenient.
   */
  const varianceDays =
    milestone.plannedDate && slipBase
      ? daysBetween(milestone.plannedDate, slipBase)
      : undefined;

  const progressVariance =
    current?.progressPercent !== undefined &&
    milestone.plannedProgressPercent !== undefined
      ? current.progressPercent - milestone.plannedProgressPercent
      : undefined;

  // Recovery is derived, never stored twice: the agreed amount lives on the
  // milestone, the recovered amount is reported, and these two follow.
  const recoveredAmount = current?.recoveredAmount;
  const agreed = milestone.paymentAmount;
  const recoverable = agreed !== undefined && agreed > 0;
  const recoveryPercent =
    recoverable && recoveredAmount !== undefined
      ? Math.min(100, (recoveredAmount / agreed) * 100)
      : undefined;
  const outstandingAdvance = recoverable
    ? Math.max(0, agreed - (recoveredAmount ?? 0))
    : undefined;

  return {
    milestone,
    current,
    pending,
    history,
    allUpdates: mine,
    status: current?.status ?? "not_started",
    progressPercent: current?.progressPercent,
    forecastDate: current?.forecastDate,
    actualDate: current?.actualDate,
    complete: Boolean(current?.actualDate),
    slipDays,

    varianceDays,
    progressVariance,
    commercial: milestone.type === "commercial",
    paymentStatus: current?.paymentStatus,
    clientApprovalStatus: current?.clientApprovalStatus,
    recoveredAmount,
    recoveryPercent,
    outstandingAdvance,

    cutoffs,
    conflicts,
    inConflict: conflicts.length > 0,
  };
}

/**
 * Group the approved stream by cut-off and decide how each one resolved.
 *
 * The rule, in order:
 *   1. a reconciliation for that cut-off  -> reconciled, its figure is official
 *   2. otherwise all approved sources agree -> agreed, that figure is official
 *   3. otherwise they disagree              -> in_conflict, NO official figure
 *
 * Comparison is exact — 0 percentage points of tolerance, as specified. A
 * configurable per-project tolerance is a documented future enhancement and is
 * deliberately not invented here.
 *
 * Rows reporting no figure at all take no part: a Weekly that updates only a
 * forecast date is not disagreeing with anyone about progress.
 */
function resolveCutoffs(approved: MilestoneUpdate[]): CutoffState[] {
  const byDate = new Map<string, MilestoneUpdate[]>();
  for (const update of approved) {
    if (!update.asOfDate) continue;
    const bucket = byDate.get(update.asOfDate);
    if (bucket) bucket.push(update);
    else byDate.set(update.asOfDate, [update]);
  }

  const states: CutoffState[] = [];
  for (const [asOfDate, rows] of byDate) {
    const reconciliations = rows
      .filter((row) => row.source === "reconciliation")
      .sort(newestFirst);
    const reported = rows
      .filter((row) => row.source !== "reconciliation")
      .sort(newestFirst);
    const reportedValues = [
      ...new Set(
        reported
          .map((row) => row.progressPercent)
          .filter((value): value is number => value !== undefined)
      ),
    ];

    // A reconciliation is the governed answer and outranks the observations it
    // was written to settle, however many of them there are.
    if (reconciliations.length > 0) {
      states.push({
        asOfDate,
        resolution: "reconciled",
        officialProgressPercent: reconciliations[0].progressPercent,
        officialUpdate: reconciliations[0],
        reported,
        reportedValues,
        reconciliations,
      });
      continue;
    }

    if (reportedValues.length === 0) {
      states.push({
        asOfDate,
        resolution: "unreported",
        reported,
        reportedValues,
        reconciliations,
      });
      continue;
    }

    if (reportedValues.length === 1) {
      states.push({
        asOfDate,
        resolution: "agreed",
        officialProgressPercent: reportedValues[0],
        // The newest row carrying the agreed figure, so the caller can still
        // reach a status, a forecast and a narrative.
        officialUpdate: reported.find(
          (row) => row.progressPercent === reportedValues[0]
        ),
        reported,
        reportedValues,
        reconciliations,
      });
      continue;
    }

    // Two or more approved sources disagree. NO official figure — that is the
    // whole point. Letting the newest win here is the defect this closes.
    states.push({
      asOfDate,
      resolution: "in_conflict",
      reported,
      reportedValues,
      reconciliations,
    });
  }

  // Newest cut-off first.
  return states.sort((a, b) => b.asOfDate.localeCompare(a.asOfDate));
}

/** Derive state for a whole register in one pass. */
export function milestoneStates(
  milestones: MasterMilestone[],
  updates: MilestoneUpdate[]
): MilestoneState[] {
  return milestones.map((milestone) => milestoneState(milestone, updates));
}

/**
 * Would this submission report less progress than the current approved figure?
 *
 * R7 — a regression is legitimate (a correction, a re-baseline) but must never
 * happen silently. Detected at submission so the row is stored already flagged;
 * the database then refuses to approve a flagged row without a reason.
 *
 * Only a genuine decrease counts. Reporting the same figure, or reporting
 * progress for the first time, is not a regression.
 */
export function isRegression(
  proposedProgress: number | undefined,
  state: Pick<MilestoneState, "progressPercent">
): boolean {
  if (proposedProgress === undefined) return false;
  if (state.progressPercent === undefined) return false;
  return proposedProgress < state.progressPercent;
}

/** Every update awaiting a decision across a register, newest first. */
export function approvalQueue(states: MilestoneState[]): {
  milestone: MasterMilestone;
  update: MilestoneUpdate;
}[] {
  return states
    .flatMap((state) =>
      state.pending.map((update) => ({ milestone: state.milestone, update }))
    )
    .sort((a, b) => newestFirst(a.update, b.update));
}

/**
 * Register summary. Counts PEOPLE-style facts, not rows: a milestone appears in
 * exactly one status bucket, and "unreported" is its own bucket rather than
 * being folded into not_started.
 */
export interface MilestoneSummary {
  total: number;
  notStarted: number;
  inProgress: number;
  completed: number;
  delayed: number;
  /** Approved nothing yet — distinct from deliberately not started. */
  unreported: number;
  awaitingApproval: number;
  /** Approved forecast or actual later than baseline. */
  slipping: number;
  /** Commercial / Payment milestones. Never part of the physical measure. */
  commercial: number;
  /** Commercial milestones awaiting the client's money. */
  paymentOutstanding: number;
  /** Milestones that need a client decision and have not had one approved. */
  awaitingClient: number;
  /** Milestones with at least one cut-off where sources disagree (13.2d). */
  inConflict: number;
}

/**
 * Every unresolved cut-off across a register, newest first.
 *
 * The reconciliation queue, and the exact counterpart of `approvalQueue()`:
 * that one lists reports awaiting acceptance, this one lists cut-offs awaiting
 * adjudication. They are different decisions and never share a list.
 */
export function reconciliationQueue(states: MilestoneState[]): {
  milestone: MasterMilestone;
  cutoff: CutoffState;
}[] {
  return states
    .flatMap((state) =>
      state.conflicts.map((cutoff) => ({ milestone: state.milestone, cutoff }))
    )
    .sort((a, b) => b.cutoff.asOfDate.localeCompare(a.cutoff.asOfDate));
}

/**
 * Physical and commercial progress, as two separate measures (13.2c).
 *
 * THE RULE THIS FUNCTION EXISTS TO HOLD:
 *
 *   An Advance / Down Payment does NOT increase physical progress.
 *
 * If the contract is 100% and a 10% advance is received, the project is 10%
 * paid, not 110% built. So commercial milestones are excluded from the physical
 * roll-up entirely — not down-weighted, excluded — and reported on their own
 * scale, weighted by payment share instead of physical weight. The database
 * refuses a commercial milestone a `weightPercent` at all, so the two measures
 * cannot be blended even by a caller that ignores this function.
 *
 * Both figures are weighted averages over milestones that CARRY a weight and
 * have an approved figure. A milestone with no weight is not scored as zero —
 * it simply is not part of a weighted measure, and `weightedCoverage` says how
 * much of the register the number actually speaks for.
 */
export interface RegisterProgress {
  /** Weighted physical progress, 0–100. Undefined when nothing qualifies. */
  physicalPercent?: number;
  /** Share of physical weight that has an approved figure behind it, 0–100. */
  physicalCoverage: number;
  /** Weighted commercial progress, 0–100. Never added to `physicalPercent`. */
  commercialPercent?: number;
  /** Total agreed value of commercial milestones, when amounts were entered. */
  commercialValue?: number;
  /** Agreed value actually reported as received. */
  receivedValue?: number;
  /** Advance still to be recovered across the register. */
  outstandingAdvance?: number;
}

export function registerProgress(states: MilestoneState[]): RegisterProgress {
  let physicalWeight = 0;
  let physicalReportedWeight = 0;
  let physicalScore = 0;

  let paymentWeight = 0;
  let paymentScore = 0;

  let commercialValue: number | undefined;
  let receivedValue: number | undefined;
  let outstandingAdvance: number | undefined;

  for (const state of states) {
    const { milestone } = state;

    if (!state.commercial) {
      const weight = milestone.weightPercent ?? 0;
      if (weight <= 0) continue;
      physicalWeight += weight;
      if (state.progressPercent === undefined) continue;
      physicalReportedWeight += weight;
      physicalScore += weight * state.progressPercent;
      continue;
    }

    /*
     * Commercial. Progress here means "how far through the payment", which is
     * received-or-better, not a percentage anyone reports as work done.
     */
    const share = milestone.paymentPercent ?? 0;
    if (share > 0) {
      paymentWeight += share;
      paymentScore += share * (isPaid(state.paymentStatus) ? 100 : 0);
    }

    if (milestone.paymentAmount !== undefined) {
      commercialValue = (commercialValue ?? 0) + milestone.paymentAmount;
      if (isPaid(state.paymentStatus)) {
        receivedValue = (receivedValue ?? 0) + milestone.paymentAmount;
      }
    }
    if (milestone.isAdvancePayment && state.outstandingAdvance !== undefined) {
      outstandingAdvance = (outstandingAdvance ?? 0) + state.outstandingAdvance;
    }
  }

  return {
    physicalPercent:
      physicalReportedWeight > 0
        ? physicalScore / physicalReportedWeight
        : undefined,
    physicalCoverage:
      physicalWeight > 0 ? (physicalReportedWeight / physicalWeight) * 100 : 0,
    commercialPercent: paymentWeight > 0 ? paymentScore / paymentWeight : undefined,
    commercialValue,
    receivedValue,
    outstandingAdvance,
  };
}

/** Received, or anything downstream of it. Recovery follows receipt. */
function isPaid(status: MilestonePaymentStatus | undefined): boolean {
  return (
    status === "received" ||
    status === "partially_recovered" ||
    status === "fully_recovered"
  );
}

export function summarise(states: MilestoneState[]): MilestoneSummary {
  const summary: MilestoneSummary = {
    total: states.length,
    notStarted: 0,
    inProgress: 0,
    completed: 0,
    delayed: 0,
    unreported: 0,
    awaitingApproval: 0,
    slipping: 0,
    commercial: 0,
    paymentOutstanding: 0,
    awaitingClient: 0,
    inConflict: 0,
  };

  for (const state of states) {
    if (!state.current) summary.unreported += 1;
    if (state.status === "not_started") summary.notStarted += 1;
    if (state.status === "in_progress") summary.inProgress += 1;
    if (state.status === "completed") summary.completed += 1;
    if (state.status === "delayed") summary.delayed += 1;
    if (state.pending.length > 0) summary.awaitingApproval += 1;
    if ((state.slipDays ?? 0) > 0) summary.slipping += 1;
    if (state.commercial) {
      summary.commercial += 1;
      if (!isPaid(state.paymentStatus)) summary.paymentOutstanding += 1;
    }
    if (
      state.milestone.clientApprovalRequired &&
      state.clientApprovalStatus !== "approved"
    ) {
      summary.awaitingClient += 1;
    }
    if (state.inConflict) summary.inConflict += 1;
  }
  return summary;
}

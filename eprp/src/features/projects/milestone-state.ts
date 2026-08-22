import type {
  MasterMilestone,
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
}

const newestFirst = (a: MilestoneUpdate, b: MilestoneUpdate) =>
  b.submittedAt.localeCompare(a.submittedAt);

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

  const current = history[0];

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
  };
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
  };

  for (const state of states) {
    if (!state.current) summary.unreported += 1;
    if (state.status === "not_started") summary.notStarted += 1;
    if (state.status === "in_progress") summary.inProgress += 1;
    if (state.status === "completed") summary.completed += 1;
    if (state.status === "delayed") summary.delayed += 1;
    if (state.pending.length > 0) summary.awaitingApproval += 1;
    if ((state.slipDays ?? 0) > 0) summary.slipping += 1;
  }
  return summary;
}

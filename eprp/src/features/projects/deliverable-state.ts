import type {
  ClientReviewStatus,
  DeliverableUpdate,
  MasterDeliverable,
} from "@/types";

/**
 * Deriving a deliverable's current state from its update stream.
 *
 * Pure functions, no storage — the counterpart to `milestone-state.ts`, and
 * built on the same frozen rule (R5): **current state is the latest APPROVED
 * update**, not the latest submitted one. A pending update is visible as
 * pending and changes nothing official.
 *
 * THE DISTINCTION THIS FILE MUST NOT BLUR (D6). Every state below reports the
 * CLIENT's position — where the deliverable stands in its review cycle. Whether
 * Project Control accepts the report saying so is `approvalStatus`, and it is
 * what decides which row is read here. The two are never merged into one status
 * and never rendered in one control.
 */

/** A deliverable plus everything derived from its stream. */
export interface DeliverableState {
  deliverable: MasterDeliverable;
  /** The update that defines the current position, if any has been approved. */
  current?: DeliverableUpdate;
  /** Submitted updates still awaiting a decision, newest first. */
  pending: DeliverableUpdate[];
  /** Approved history, newest first. `current` is its first entry. */
  history: DeliverableUpdate[];
  /** Every update ever submitted, rejections included. The record, not the state. */
  allUpdates: DeliverableUpdate[];
  /** Where the CLIENT stands. Never conflated with the approval of the report. */
  clientReviewStatus: ClientReviewStatus;
  clientReviewDate?: string;
  clientReference?: string;
  forecastDate?: string;
  actualSubmissionDate?: string;
  /** The revision actually submitted, falling back to the planned one. */
  revision?: string;
  /** True once the deliverable has actually gone out. */
  submitted: boolean;
  /**
   * True when the client has finished with it — approved outright, or approved
   * with comments. Comments are an obligation to respond, not a rejection.
   */
  accepted: boolean;
  /** The client wants it again: rejected or explicitly asked to resubmit. */
  returned: boolean;
  /** Submission later than plan, in whole days. Undefined when unknowable. */
  slipDays?: number;
}

const newestFirst = (a: DeliverableUpdate, b: DeliverableUpdate) =>
  b.submittedAt.localeCompare(a.submittedAt);

/** Whole days between two ISO dates, positive when `later` is after `earlier`. */
function daysBetween(earlier: string, later: string): number {
  const from = Date.parse(earlier);
  const to = Date.parse(later);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/** The client has finished reviewing, with or without comments. */
export function isAccepted(status: ClientReviewStatus): boolean {
  return status === "approved" || status === "approved_with_comments";
}

/** The client has sent it back. */
export function isReturned(status: ClientReviewStatus): boolean {
  return status === "rejected" || status === "resubmit";
}

/**
 * Fold one deliverable's updates into its current state.
 *
 * `updates` may be the whole project's stream; rows for other deliverables are
 * ignored, so callers can pass one fetch rather than slicing per deliverable.
 */
export function deliverableState(
  deliverable: MasterDeliverable,
  updates: DeliverableUpdate[]
): DeliverableState {
  const mine = updates
    .filter((update) => update.deliverableId === deliverable.id)
    .sort(newestFirst);
  const history = mine.filter((update) => update.approvalStatus === "approved");
  const pending = mine.filter((update) => update.approvalStatus === "pending");

  const current = history[0];

  /*
   * Nothing approved means `not_submitted` — which is the truth, not a
   * placeholder: no accepted report says this has gone anywhere. The same
   * "absence is never invented" rule the milestone register applies to progress.
   */
  const clientReviewStatus = current?.clientReviewStatus ?? "not_submitted";

  const slipBase = current?.actualSubmissionDate ?? current?.forecastDate;
  const slipDays =
    deliverable.plannedSubmissionDate && slipBase
      ? daysBetween(deliverable.plannedSubmissionDate, slipBase)
      : undefined;

  return {
    deliverable,
    current,
    pending,
    history,
    allUpdates: mine,
    clientReviewStatus,
    clientReviewDate: current?.clientReviewDate,
    clientReference: current?.clientReference,
    forecastDate: current?.forecastDate,
    actualSubmissionDate: current?.actualSubmissionDate,
    // The planned revision is the fallback, so a deliverable that has not been
    // reported still reads at the revision it is planned at.
    revision: current?.revision ?? deliverable.revision,
    submitted: Boolean(current?.actualSubmissionDate),
    accepted: isAccepted(clientReviewStatus),
    returned: isReturned(clientReviewStatus),
    slipDays,
  };
}

/** Derive state for a whole register in one pass. */
export function deliverableStates(
  deliverables: MasterDeliverable[],
  updates: DeliverableUpdate[]
): DeliverableState[] {
  return deliverables.map((deliverable) =>
    deliverableState(deliverable, updates)
  );
}

/** Every update awaiting a decision across a register, newest first. */
export function deliverableApprovalQueue(states: DeliverableState[]): {
  deliverable: MasterDeliverable;
  update: DeliverableUpdate;
}[] {
  return states
    .flatMap((state) =>
      state.pending.map((update) => ({
        deliverable: state.deliverable,
        update,
      }))
    )
    .sort((a, b) => newestFirst(a.update, b.update));
}

/**
 * The deliverables serving one milestone.
 *
 * The join runs in this direction — deliverables reference the milestone —
 * because that is where the foreign key lives. Nothing about the milestone is
 * copied or re-derived; a caller wanting the milestone's own figures reads
 * `milestone-state.ts`.
 */
export function forMilestone(
  states: DeliverableState[],
  milestoneId: string
): DeliverableState[] {
  return states.filter(
    (state) => state.deliverable.milestoneId === milestoneId
  );
}

/**
 * Register summary. A deliverable lands in exactly one bucket, and
 * "unreported" is its own rather than being folded into not-submitted.
 */
export interface DeliverableSummary {
  total: number;
  notSubmitted: number;
  awaitingClient: number;
  accepted: number;
  returned: number;
  /** Approved nothing yet — distinct from deliberately not submitted. */
  unreported: number;
  awaitingApproval: number;
  /** Submitted or forecast later than planned. */
  slipping: number;
}

export function summariseDeliverables(
  states: DeliverableState[]
): DeliverableSummary {
  const summary: DeliverableSummary = {
    total: states.length,
    notSubmitted: 0,
    awaitingClient: 0,
    accepted: 0,
    returned: 0,
    unreported: 0,
    awaitingApproval: 0,
    slipping: 0,
  };

  for (const state of states) {
    if (!state.current) summary.unreported += 1;
    if (state.clientReviewStatus === "not_submitted") summary.notSubmitted += 1;
    if (
      state.clientReviewStatus === "submitted" ||
      state.clientReviewStatus === "under_review"
    ) {
      summary.awaitingClient += 1;
    }
    if (state.accepted) summary.accepted += 1;
    if (state.returned) summary.returned += 1;
    if (state.pending.length > 0) summary.awaitingApproval += 1;
    if ((state.slipDays ?? 0) > 0) summary.slipping += 1;
  }
  return summary;
}

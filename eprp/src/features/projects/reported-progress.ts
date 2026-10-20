/**
 * Phase 13.9B — Step 2: Setup Finalisation and the Reported Progress stream.
 *
 * Contracts only (no screen, no service call yet — Step 3). They mirror the
 * database model of migration 20261017090000 (`project_setup_finalisations`,
 * `project_reported_progress`, `project_reported_progress_heads()` /
 * `_latest()`), and `reported-progress.test.mjs` proves the mirror. Docs:
 * `02` §26.14 and §26.24.5, `06` §10A.11.4–§10A.11.5.
 *
 * Ownership (B14): the stream is the canonical progress of a Finalised
 * no-formal-schedule project. It is NOT the project record's typed
 * planned / actual progress (retired) and it is NOT Weekly or Monthly — they
 * may later reference an entry by id (13.17–13.19) but never write or own it.
 * There is no PV, EV or SPI here; SPI is always "N/A".
 */

export const REPORTED_PROGRESS_LABEL = "Reported — not planning governed";
export const REPORTED_PROGRESS_SPI = "N/A";

export type ReportedProgressEntryKind = "report" | "correction" | "withdrawal";

export const REPORTED_PROGRESS_ENTRY_KINDS: readonly ReportedProgressEntryKind[] = [
  "report",
  "correction",
  "withdrawal",
];

/** One immutable row of `project_reported_progress`. */
export interface ReportedProgressEntry {
  id: string;
  projectId: string;
  /** The as-of date (ISO yyyy-mm-dd). Never in the future in the project's time zone. */
  dataDate: string;
  entryKind: ReportedProgressEntryKind;
  /** Optional; NULL for a withdrawal. */
  reportedPlannedPercent: number | null;
  /** Required for a report or correction; NULL for a withdrawal. */
  reportedActualPercent: number | null;
  narrative: string | null;
  /** The entry this one replaces (correction) or withdraws (withdrawal). NULL for a report. */
  supersedesEntryId: string | null;
  /** Required for a correction, a withdrawal and a back-dated report. */
  reason: string | null;
  /** Set by the database: a report dated before the latest valid Data Date. */
  isBackdated: boolean;
  source: "eprp_entry";
  recordedBy: string;
  recordedByName: string | null;
  recordedAt: string;
}

/** The append-only, irreversible row of `project_setup_finalisations`. */
export interface SetupFinalisation {
  id: string;
  projectId: string;
  onboardingModeAtFinalisation: "no_formal_schedule";
  stateBefore: "not_controlled";
  stateAfter: "controlled";
  acknowledgement: string;
  note: string | null;
  finalisedBy: string;
  finalisedByName: string | null;
  finalisedAt: string;
  source: "project_setup";
}

/**
 * The current head of every chain: an entry nothing supersedes. Chains never
 * leave their Data Date, so there is exactly one head per Data Date. Same rule
 * as `project_reported_progress_heads()`; newest Data Date first.
 */
export function reportedProgressHeads(entries: readonly ReportedProgressEntry[]): ReportedProgressEntry[] {
  const superseded = new Set(entries.map((entry) => entry.supersedesEntryId).filter((id): id is string => id !== null));
  return entries
    .filter((entry) => !superseded.has(entry.id))
    .sort((a, b) => (a.dataDate < b.dataDate ? 1 : a.dataDate > b.dataDate ? -1 : 0));
}

/**
 * The latest valid Reported Progress position: the head with the greatest
 * Data Date that is not a withdrawal (`project_reported_progress_latest()`).
 * A back-dated entry is latest only when its date is the latest.
 */
export function latestReportedProgress(entries: readonly ReportedProgressEntry[]): ReportedProgressEntry | null {
  return reportedProgressHeads(entries).find((entry) => entry.entryKind !== "withdrawal") ?? null;
}

export const REPORTED_PROGRESS_KIND_LABEL: Record<ReportedProgressEntryKind, string> = {
  report: "Report",
  correction: "Correction",
  withdrawal: "Withdrawal",
};

/** One Data Date's chain: the original report, then each correction, then a final withdrawal if any. */
export interface ReportedProgressChain {
  dataDate: string;
  /** Oldest first: report → correction* → [withdrawal]. */
  entries: ReportedProgressEntry[];
  /** The current head (nothing supersedes it). */
  head: ReportedProgressEntry;
  /** Closed: the head is a withdrawal (final in 13.9B, owner 2026-10-17). */
  withdrawn: boolean;
}

/** Every Data Date's chain, newest Data Date first. */
export function reportedProgressChains(entries: readonly ReportedProgressEntry[]): ReportedProgressChain[] {
  const successor = new Map<string, ReportedProgressEntry>();
  for (const entry of entries) {
    if (entry.supersedesEntryId) successor.set(entry.supersedesEntryId, entry);
  }
  const chains: ReportedProgressChain[] = [];
  for (const origin of entries.filter((entry) => entry.entryKind === "report")) {
    const ordered: ReportedProgressEntry[] = [origin];
    let next = successor.get(origin.id);
    while (next && ordered.length <= entries.length) {
      ordered.push(next);
      next = successor.get(next.id);
    }
    const head = ordered[ordered.length - 1];
    chains.push({ dataDate: origin.dataDate, entries: ordered, head, withdrawn: head.entryKind === "withdrawal" });
  }
  return chains.sort((a, b) => (a.dataDate < b.dataDate ? 1 : a.dataDate > b.dataDate ? -1 : 0));
}

/** The chain for one Data Date, or undefined. */
export function reportedProgressChainFor(
  entries: readonly ReportedProgressEntry[],
  dataDate: string
): ReportedProgressChain | undefined {
  return reportedProgressChains(entries).find((chain) => chain.dataDate === dataDate);
}

/** Correct / Withdraw are offered on the current head only, never on a withdrawal (final). */
export function canActOnEntry(entry: ReportedProgressEntry, entries: readonly ReportedProgressEntry[]): boolean {
  if (entry.entryKind === "withdrawal") return false;
  return !entries.some((other) => other.supersedesEntryId === entry.id);
}

/**
 * The latest valid Data Date: a new report dated before it needs a reason and
 * is marked back-dated (B20). Same rule as `project_reported_progress_latest_date()`.
 */
export function latestValidDataDate(entries: readonly ReportedProgressEntry[]): string | null {
  return latestReportedProgress(entries)?.dataDate ?? null;
}

/** A report for this date is back-dated (needs a reason). */
export function isBackdatedDate(dataDate: string, entries: readonly ReportedProgressEntry[]): boolean {
  const latest = latestValidDataDate(entries);
  return Boolean(latest && dataDate && dataDate < latest);
}

/**
 * Whether the stream accepts a write, as the database decides it (presentation
 * only — the database is authoritative). Authority is checked separately:
 * System Administrator, Project Control Admin or the assigned Project Control.
 */
export function isReportedProgressWritable(state: {
  onboardingMode: string | null | undefined;
  finalised: boolean;
  hasPublishedSnapshot: boolean;
  archived: boolean;
}): boolean {
  return (
    !state.archived &&
    (state.onboardingMode ?? "new_project") === "no_formal_schedule" &&
    state.finalised &&
    !state.hasPublishedSnapshot
  );
}

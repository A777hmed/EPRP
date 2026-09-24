export type ExecutiveMonthlyBasis = "approved" | "draft" | "none";

export interface ExecutiveGovernanceCounts {
  /** Current, non-archived projects in the management scope. */
  active: number;
  /** Projects with any Monthly report for the selected period. */
  submitted: number;
  /** Projects whose selected Monthly is approved/finalized/locked. */
  approved: number;
  /** Projects with a Monthly that has not reached approval. */
  draft: number;
  /** Projects with no Monthly report for the selected period. */
  missing: number;
}

export function executiveGovernanceCounts(
  rows: readonly { basis: ExecutiveMonthlyBasis }[]
): ExecutiveGovernanceCounts {
  const approved = rows.filter((row) => row.basis === "approved").length;
  const draft = rows.filter((row) => row.basis === "draft").length;
  const missing = rows.filter((row) => row.basis === "none").length;

  return {
    active: rows.length,
    submitted: approved + draft,
    approved,
    draft,
    missing,
  };
}

/**
 * Project health is a reporting-presence question, not an approval question.
 * Draft Monthlies remain excluded from approved performance, but they are
 * reported and may carry a real Executive health reading.
 */
export function monthlyForExecutiveHealth<Monthly>(
  basis: ExecutiveMonthlyBasis,
  report: Monthly | undefined
): Monthly | undefined {
  return basis === "none" ? undefined : report;
}

export function executiveHealthCounts<Health extends string>(
  rows: readonly { health: Health }[],
  healthOrder: readonly Health[]
): Record<Health, number> {
  const counts = Object.fromEntries(healthOrder.map((health) => [health, 0])) as Record<
    Health,
    number
  >;
  for (const row of rows) counts[row.health] += 1;
  return counts;
}

export interface ApprovedPerformance {
  planned?: number;
  actual?: number;
  /** Projects with an approved Monthly and both reported figures. */
  contributing: number;
}

function mean(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

/**
 * Approved-only portfolio performance over one consistent contributor set.
 *
 * A row missing either Planned or Actual is omitted from both means. This is
 * intentionally different from substituting zero: zero is a valid reported
 * value, while absence is not a value at all.
 */
export function approvedExecutivePerformance(
  rows: readonly {
    basis: ExecutiveMonthlyBasis;
    planned?: number;
    actual?: number;
  }[]
): ApprovedPerformance {
  const contributing = rows.filter(
    (row): row is { basis: "approved"; planned: number; actual: number } =>
      row.basis === "approved" &&
      typeof row.planned === "number" &&
      typeof row.actual === "number"
  );

  return {
    planned: mean(contributing.map((row) => row.planned)),
    actual: mean(contributing.map((row) => row.actual)),
    contributing: contributing.length,
  };
}

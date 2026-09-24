export interface ReportRegisterSummary<Group extends string> {
  total: number;
  statusCounts: Record<Group, number>;
}

/**
 * Summarize the report collection already selected for a register.
 *
 * Filtering stays with each register because Weekly and Monthly expose
 * different period fields, but cards and rows must consume the same filtered
 * collection. Status groups are supplied by the caller so lifecycle semantics
 * remain owned by the existing Weekly/Monthly rules.
 */
export function summarizeReportRegister<
  Report extends { status: string },
  Group extends string,
>(
  reports: readonly Report[],
  statusGroups: Readonly<Record<Group, readonly string[]>>
): ReportRegisterSummary<Group> {
  const entries = Object.entries(statusGroups).map(([group, statuses]) => [
    group,
    reports.filter((report) => (statuses as readonly string[]).includes(report.status)).length,
  ]);

  return {
    total: reports.length,
    statusCounts: Object.fromEntries(entries) as Record<Group, number>,
  };
}

/** Count reports in the latest period present in the same filtered scope. */
export function latestPeriodCount<Report, Period extends number | string>(
  reports: readonly Report[],
  periodOf: (report: Report) => Period
): number {
  if (reports.length === 0) return 0;
  const periods = reports.map(periodOf);
  const latest = [...periods].sort((a, b) =>
    String(b).localeCompare(String(a), undefined, { numeric: true })
  )[0];
  return periods.filter((period) => period === latest).length;
}

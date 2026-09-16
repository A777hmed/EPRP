"use client";
/* Register data loads from the browser services after mount. */
/* eslint-disable react-hooks/set-state-in-effect */

/**
 * The Executive Report Register — `/executive-reports` (Top-Level Reporting 4B).
 *
 * READ-ONLY, consolidated across every project the viewer can see. Consistent
 * with the Weekly and Monthly registers: a list of reporting periods with their
 * coverage, from which a reader opens the consolidated report — this is not a
 * creation or editing surface, and Executive Reports are never authored from
 * here. Editing the Executive-owned summary/signatories happens from inside
 * the portfolio report itself (`/executive-reports/portfolio`), which every row
 * still opens; nothing here removes that reach, only the register's OWN
 * Edit/Archive/Delete row actions.
 *
 * IMPORTANT — a row is a REPORTING PERIOD derived from the Monthly Reports
 * that exist, not a stored Executive Report with its own number or revision.
 * Every figure on it is counted from real data; the register describes what
 * CAN be reported, not what has been issued.
 */

import * as React from "react";
import Link from "next/link";
import { FileBarChart, FileText, Printer, Search, SearchX } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, StatusBadge } from "@/components/shared";
import { useMasterData } from "@/features/master-data";
import { monthlyReportService } from "@/services/monthly-report-service";
import { projectService } from "@/services/project-service";
import {
  planningRollupService,
  type PlanningSnapshotRollup,
} from "@/services/planning-rollup-service";
import type { Client, MonthlyReport, PortfolioGroup, Project } from "@/types";
import {
  EXEC_HEALTH_META,
  EXEC_HEALTH_ORDER,
  isApprovedMonthly,
  monthLabelOf,
  readHealth,
  type ExecHealth,
} from "./executive-data";
import { executiveRecordService, EXECUTIVE_STATUS_LABEL, type ExecutiveReportRecord } from "./executive-record";
import { visibleProjects } from "./executive-scope";
import type { ExecutiveViewerProps } from "./executive-view";
import { ExecutiveDenied } from "./executive-view";

/**
 * The register's own reading of schedule health for a period — a tally
 * across every Monthly Report in it (approved or not, mirroring Dashboard's
 * "absence is never zero"), reduced to the single worst bucket for a compact
 * badge. Deliberately a DIFFERENT concept from Approved Monthly Basis: a
 * fully-approved period can still be unhealthy, and a provisional one can
 * still be on track. Collapsing the two into one badge was the defect this
 * separates.
 */
function summarizeHealth(reports: MonthlyReport[]): { worst: ExecHealth; counts: Partial<Record<ExecHealth, number>> } {
  const counts: Partial<Record<ExecHealth, number>> = {};
  for (const report of reports) {
    const { health } = readHealth(report);
    counts[health] = (counts[health] ?? 0) + 1;
  }
  const worst = EXEC_HEALTH_ORDER.find((health) => (counts[health] ?? 0) > 0) ?? "unknown";
  return { worst, counts };
}

interface PlanningSummary {
  /** Text for the cell itself — always present. */
  label: string;
  /** Longer breakdown for the title tooltip, when there is more to say. */
  detail?: string;
}

/**
 * Planning provenance for a period, from APPROVED Monthlies only — a draft
 * Monthly's pin is not yet an official position (mirrors Approved Monthly
 * Basis' own approved-only rule). Reads each report's OWN pinned
 * `planningSnapshotId` via the already-fetched rollup map; never resolves a
 * latest or current snapshot (Planning Integration 3E / 4B).
 */
function summarizePlanning(
  approvedReports: MonthlyReport[],
  rollups: Map<string, PlanningSnapshotRollup | null>
): PlanningSummary {
  if (approvedReports.length === 0) {
    return { label: "—" };
  }

  const pinned = approvedReports.filter((report) => report.planningSnapshotId);
  if (pinned.length === 0) {
    return { label: "Manual / fallback" };
  }

  const resolved = pinned
    .map((report) => (report.planningSnapshotId ? rollups.get(report.planningSnapshotId) : undefined))
    .filter((rollup): rollup is PlanningSnapshotRollup => Boolean(rollup));

  const distinctSnapshots = new Map(resolved.map((rollup) => [rollup.snapshotId, rollup]));

  if (pinned.length === approvedReports.length && distinctSnapshots.size <= 1) {
    const only = [...distinctSnapshots.values()][0];
    if (only) {
      return {
        label: `Snapshot v${only.snapshotVersion}${only.dataDate ? ` · ${only.dataDate}` : ""}`,
        detail: `${only.coveragePercent.toFixed(0)}% activity coverage.`,
      };
    }
    // Pinned but not yet resolved (in flight, or the lookup failed).
    return { label: "Planning-backed" };
  }

  const detail = [...distinctSnapshots.values()]
    .map((rollup) => `v${rollup.snapshotVersion}${rollup.dataDate ? ` (${rollup.dataDate})` : ""}`)
    .join(", ");

  if (pinned.length === approvedReports.length) {
    return { label: `Planning-backed (${distinctSnapshots.size} snapshots)`, detail };
  }

  return {
    label: `Planning-backed — ${pinned.length}/${approvedReports.length}`,
    detail: detail ? `Snapshots: ${detail}` : undefined,
  };
}

interface RegisterRow {
  month: string;
  monthLabel: string;
  projectCount: number;
  clientNames: string[];
  groupNames: string[];
  approvedCount: number;
  reportedCount: number;
  lastUpdated?: string;
  health: { worst: ExecHealth; counts: Partial<Record<ExecHealth, number>> };
  planning: PlanningSummary;
  searchHaystack: string;
  /** The stored Executive record, once somebody has edited this period. */
  record?: ExecutiveReportRecord;
}

/**
 * One row per reporting month that holds at least one Monthly Report, among
 * the projects currently in scope (access AND the Client/Portfolio Group
 * filters both narrow this before rows are ever built — never after, so a
 * count can never disclose a project the reader filtered out or cannot open).
 *
 * A month with no Monthly Report in scope is not listed: there would be
 * nothing to consolidate, and an empty row would imply a report that does
 * not exist.
 */
function buildRegister(
  reports: MonthlyReport[],
  projects: Project[],
  clients: Client[],
  portfolioGroups: PortfolioGroup[],
  planningRollups: Map<string, PlanningSnapshotRollup | null>,
  records: ExecutiveReportRecord[]
): RegisterRow[] {
  const recordByMonth = new Map(records.map((record) => [record.reportingMonth.slice(0, 7), record]));
  const projectById = new Map(projects.map((project) => [project.id, project]));

  const byMonth = new Map<string, MonthlyReport[]>();
  for (const report of reports) {
    const month = report.reportingMonth.slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) ?? []), report]);
  }

  return [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, monthReports]) => {
      const projectIds = new Set(monthReports.map((report) => report.projectId));
      const monthProjects = [...projectIds].map((id) => projectById.get(id)).filter((p): p is Project => Boolean(p));

      const clientNames = [
        ...new Set(
          monthProjects.map((project) => {
            const client = clients.find((c) => c.id === project.clientId);
            return client?.shortName ?? client?.name;
          })
        ),
      ].filter((name): name is string => Boolean(name)).sort((a, b) => a.localeCompare(b));

      const groupNames = [
        ...new Set(
          monthProjects
            .map((project) => (project.portfolioGroupId ? portfolioGroups.find((g) => g.id === project.portfolioGroupId)?.name : undefined))
            .filter((name): name is string => Boolean(name))
        ),
      ].sort((a, b) => a.localeCompare(b));

      const approvedReports = monthReports.filter(isApprovedMonthly);

      return {
        month,
        monthLabel: monthLabelOf(month),
        projectCount: projectIds.size,
        clientNames,
        groupNames,
        approvedCount: approvedReports.length,
        reportedCount: monthReports.length,
        lastUpdated: monthReports.map((r) => r.updatedAt).sort((a, b) => b.localeCompare(a))[0],
        health: summarizeHealth(monthReports),
        planning: summarizePlanning(approvedReports, planningRollups),
        searchHaystack: [monthLabelOf(month), ...clientNames, ...monthProjects.map((p) => p.name)]
          .join(" ")
          .toLowerCase(),
        record: recordByMonth.get(month),
      };
    });
}

interface Filters {
  search: string;
  clientId: string | "all";
  portfolioGroupId: string | "all";
  month: string | "all";
  basis: "all" | "approved" | "provisional";
}

const defaultFilters: Filters = {
  search: "",
  clientId: "all",
  portfolioGroupId: "all",
  month: "all",
  basis: "all",
};

export function ExecutiveRegisterView(props: ExecutiveViewerProps) {
  const [allProjects, setAllProjects] = React.useState<Project[]>([]);
  const [allReports, setAllReports] = React.useState<MonthlyReport[]>([]);
  const [records, setRecords] = React.useState<ExecutiveReportRecord[]>([]);
  const [planningRollups, setPlanningRollups] = React.useState<Map<string, PlanningSnapshotRollup | null>>(new Map());
  const [loaded, setLoaded] = React.useState(false);
  const [filters, setFilters] = React.useState<Filters>(defaultFilters);
  const { records: clientRecords } = useMasterData("client");
  const { records: portfolioGroupRecords } = useMasterData("portfolioGroup");
  const clients = clientRecords as Client[];
  const portfolioGroups = portfolioGroupRecords as PortfolioGroup[];

  const scopedProjects = React.useMemo(
    () =>
      visibleProjects(allProjects, {
        contactId: props.contactId,
        isAdmin: props.isAdmin,
        portfolioReadTier: props.portfolioReadTier,
      }),
    [allProjects, props.contactId, props.isAdmin, props.portfolioReadTier]
  );

  const load = React.useCallback(async () => {
    try {
      const [nextProjects, nextReports, nextRecords] = await Promise.all([
        projectService.getProjects(),
        monthlyReportService.list(),
        executiveRecordService.list(),
      ]);
      setAllProjects(nextProjects);
      setAllReports(nextReports);
      setRecords(nextRecords);
      setLoaded(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load Executive reporting periods.");
      setAllProjects([]);
      setAllReports([]);
      setRecords([]);
      setLoaded(true);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Reports whose project is not (or no longer) visible to this viewer never
  // reach snapshot resolution, counting or display — access is filtered
  // BEFORE aggregation, never after.
  const visibleReports = React.useMemo(() => {
    const visibleIds = new Set(scopedProjects.map((project) => project.id));
    return allReports.filter((report) => visibleIds.has(report.projectId));
  }, [allReports, scopedProjects]);

  React.useEffect(() => {
    let cancelled = false;
    // Planning Integration 3E/4B: each report's OWN pinned snapshot, read by
    // immutable id — never `getLatestSnapshot()`/`getSnapshotForPeriod()`.
    // Only APPROVED monthlies' pins count toward provenance, deduped across
    // the whole register in one batch.
    const pinnedIds = [
      ...new Set(
        visibleReports
          .filter(isApprovedMonthly)
          .map((report) => report.planningSnapshotId)
          .filter((id): id is string => Boolean(id))
      ),
    ];
    void (async () => {
      const pairs = await Promise.all(
        pinnedIds.map(async (id) => {
          try {
            return [id, await planningRollupService.computeSnapshotRollup(id)] as const;
          } catch {
            return [id, null] as const;
          }
        })
      );
      if (!cancelled) setPlanningRollups(new Map(pairs));
    })();
    return () => {
      cancelled = true;
    };
  }, [visibleReports]);

  // Client and Portfolio Group narrow the PROJECT SET before rows are built,
  // so every count on a filtered register (Projects in View, Clients,
  // Approved Monthly Basis) reflects the filtered scope rather than the whole
  // portfolio with a mismatched label.
  const filteredProjects = React.useMemo(
    () =>
      scopedProjects.filter(
        (project) =>
          (filters.clientId === "all" || project.clientId === filters.clientId) &&
          (filters.portfolioGroupId === "all" || project.portfolioGroupId === filters.portfolioGroupId)
      ),
    [scopedProjects, filters.clientId, filters.portfolioGroupId]
  );

  const rows = React.useMemo(() => {
    const filteredIds = new Set(filteredProjects.map((project) => project.id));
    const reportsInScope = visibleReports.filter((report) => filteredIds.has(report.projectId));
    return buildRegister(reportsInScope, filteredProjects, clients, portfolioGroups, planningRollups, records);
  }, [visibleReports, filteredProjects, clients, portfolioGroups, planningRollups, records]);

  const visibleRows = React.useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    return rows.filter((row) => {
      if (query && !row.searchHaystack.includes(query)) return false;
      if (filters.month !== "all" && row.month !== filters.month) return false;
      if (filters.basis === "approved" && !(row.approvedCount === row.reportedCount && row.reportedCount > 0)) return false;
      if (filters.basis === "provisional" && row.approvedCount === row.reportedCount && row.reportedCount > 0) return false;
      return true;
    });
  }, [rows, filters.search, filters.month, filters.basis]);

  const clientOptions = clients
    .filter((client) => scopedProjects.some((project) => project.clientId === client.id))
    .sort((a, b) => (a.shortName ?? a.name).localeCompare(b.shortName ?? b.name));
  const portfolioGroupOptions = portfolioGroups
    .filter((group) => scopedProjects.some((project) => project.portfolioGroupId === group.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const monthOptions = rows.map((row) => row.month);

  const activeFilters =
    (filters.search ? 1 : 0) +
    (filters.clientId !== "all" ? 1 : 0) +
    (filters.portfolioGroupId !== "all" ? 1 : 0) +
    (filters.month !== "all" ? 1 : 0) +
    (filters.basis !== "all" ? 1 : 0);

  if (!props.allowed) return <ExecutiveDenied reason={props.deniedReason} />;
  if (!loaded) return <LoadingState label="Loading Executive reporting periods…" />;

  return (
    <div className="monthly-list-view exec-register">
      <div className="monthly-list-header">
        <div>
          <p className="monthly-eyebrow">Executive reporting</p>
          <h1>Executive Reports</h1>
          <span>
            Consolidated portfolio reporting periods, across every project you can access. Each period opens the
            existing multi-project Executive Report — this register does not create or edit one.
          </span>
        </div>
      </div>

      <div className="monthly-list-toolbar">
        <label className="monthly-search-field">
          <Search aria-hidden />
          <input
            aria-label="Search reporting periods"
            placeholder="Search period, project or client…"
            value={filters.search}
            onChange={(event) => setFilters((f) => ({ ...f, search: event.target.value }))}
          />
        </label>
        <select
          aria-label="Filter by client"
          value={filters.clientId}
          onChange={(event) => setFilters((f) => ({ ...f, clientId: event.target.value }))}
        >
          <option value="all">All clients</option>
          {clientOptions.map((client) => (
            <option key={client.id} value={client.id}>
              {client.shortName ?? client.name}
            </option>
          ))}
        </select>
        {portfolioGroupOptions.length > 0 && (
          <select
            aria-label="Filter by portfolio group"
            value={filters.portfolioGroupId}
            onChange={(event) => setFilters((f) => ({ ...f, portfolioGroupId: event.target.value }))}
          >
            <option value="all">All portfolio groups</option>
            {portfolioGroupOptions.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Filter by reporting period"
          value={filters.month}
          onChange={(event) => setFilters((f) => ({ ...f, month: event.target.value }))}
        >
          <option value="all">All periods</option>
          {monthOptions.map((month) => (
            <option key={month} value={month}>
              {monthLabelOf(month)}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by approval basis"
          value={filters.basis}
          onChange={(event) => setFilters((f) => ({ ...f, basis: event.target.value as Filters["basis"] }))}
        >
          <option value="all">All bases</option>
          <option value="approved">Fully approved</option>
          <option value="provisional">Provisional</option>
        </select>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No reporting periods available"
          description="An Executive Report is consolidated from Monthly Reports. None are available for the projects you can access."
          icon={FileBarChart}
        />
      ) : visibleRows.length === 0 ? (
        <EmptyState
          title="No reporting periods match these filters"
          description="Clear a filter to see the rest of the register."
          icon={SearchX}
        />
      ) : (
        <div className="monthly-list-card">
          <div className="monthly-table-wrap">
            <table className="monthly-table exec-register-table">
              <thead>
                <tr>
                  <th>Reporting Period</th>
                  <th>Projects in View</th>
                  <th>Clients</th>
                  <th>Approved Monthly Basis</th>
                  <th>Portfolio Health</th>
                  <th>Planning</th>
                  <th>Last Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const healthMeta = EXEC_HEALTH_META[row.health.worst];
                  const healthDetail = EXEC_HEALTH_ORDER.filter((h) => (row.health.counts[h] ?? 0) > 0)
                    .map((h) => `${row.health.counts[h]} ${EXEC_HEALTH_META[h].label}`)
                    .join(", ");
                  return (
                    <tr key={row.month}>
                      <td>
                        <Link className="monthly-link" href={`/executive-reports/portfolio?month=${row.month}`}>
                          {row.monthLabel}
                        </Link>
                        {row.record && (
                          <small className="exec-record-state">
                            Executive record: {EXECUTIVE_STATUS_LABEL[row.record.status]}
                          </small>
                        )}
                      </td>
                      <td className="exec-numeric">
                        {row.projectCount} Project{row.projectCount === 1 ? "" : "s"}
                        {row.groupNames.length > 0 && (
                          <small title={row.groupNames.join(", ")}>
                            {row.groupNames.length === 1 ? row.groupNames[0] : `${row.groupNames.length} groups`}
                          </small>
                        )}
                      </td>
                      <td className="exec-numeric" title={row.clientNames.join(", ") || undefined}>
                        {row.clientNames.length} Client{row.clientNames.length === 1 ? "" : "s"}
                        {row.clientNames.length > 0 && row.clientNames.length <= 2 && (
                          <small>{row.clientNames.join(", ")}</small>
                        )}
                      </td>
                      <td className="exec-numeric">
                        {row.approvedCount} / {row.reportedCount} Approved
                      </td>
                      <td>
                        <StatusBadge tone={healthMeta.tone}>{healthMeta.label}</StatusBadge>
                        {healthDetail && <small className="exec-record-state">{healthDetail}</small>}
                      </td>
                      <td className="exec-planning-cell" title={row.planning.detail}>
                        {row.planning.label}
                      </td>
                      <td>{row.lastUpdated ? format(parseISO(row.lastUpdated.slice(0, 10)), "dd MMM yyyy") : "—"}</td>
                      <td>
                        <div className="monthly-row-action-cell">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Open the ${row.monthLabel} portfolio report`}
                            title="Open Portfolio"
                            asChild
                          >
                            <Link href={`/executive-reports/portfolio?month=${row.month}`}>
                              <FileText aria-hidden="true" />
                            </Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Preview ${row.monthLabel}`}
                            title="Preview / PDF"
                            asChild
                          >
                            <Link href={`/executive-reports/preview?month=${row.month}`}>
                              <Printer aria-hidden="true" />
                            </Link>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="exec-register-note">
            Reporting periods are derived from the Monthly Reports that exist. Executive Reports are not yet stored as
            numbered, revisioned records, so no report number or approval state is shown.
            {activeFilters > 0 ? " Figures reflect the current filters." : ""}
          </p>
        </div>
      )}
    </div>
  );
}

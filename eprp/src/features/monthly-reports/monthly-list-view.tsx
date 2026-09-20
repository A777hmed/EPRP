"use client";
/* Monthly data loads from the browser service after mount. */
/* eslint-disable react-hooks/set-state-in-effect */

/**
 * The Monthly register (/monthly-reports) and the create screen.
 *
 * The register is a READ-ONLY portfolio view (Top-Level Reporting 4A): every
 * Monthly report a user may see, with the schedule position on the row so
 * leadership can scan the estate without opening each report. It is not a
 * creation or editing surface — raising and editing a Monthly Report happens
 * inside its project, at `/projects/[projectId]/reports/monthly/...`. This
 * register only ever links a row to the same Open/Preview views those
 * project-scoped routes also open, never to a form or a write action. RLS
 * (`monthly_reports_select`) is the only thing that decides which rows
 * appear; nothing here re-filters or widens that set.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, FilePlus2, Printer, Search, SearchX } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, StatusBadge } from "@/components/shared";
import { REPORT_STATUS_META } from "@/lib/constants";
import { getMonthLabel } from "@/lib/reporting";
import { monthlyReportService } from "@/services/monthly-report-service";
import { projectService } from "@/services/project-service";
import {
  planningRollupService,
  type PlanningSnapshotRollup,
} from "@/services/planning-rollup-service";
import { useMasterData } from "@/features/master-data";
import type { Client, Contact, MonthlyReport, PortfolioGroup, Project } from "@/types";
import { NOT_RECORDED, monthEndStatus, nameOf } from "./monthly-data";
import { summarizeReportRegister } from "@/features/reports/register-summary";

/**
 * Planning Integration 4A — the report's pinned snapshot only, never a
 * re-resolved "latest". Mirrors the same cell used on the Weekly register.
 */
function PlanningCell({
  report,
  rollup,
}: {
  report: MonthlyReport;
  rollup: PlanningSnapshotRollup | null | undefined;
}) {
  if (!report.planningSnapshotId || !rollup) {
    return <span className="muted">Manual / fallback</span>;
  }
  return (
    <span className="muted" title={`Snapshot v${rollup.snapshotVersion}`}>
      Snapshot v{rollup.snapshotVersion}
      {rollup.dataDate ? ` · ${rollup.dataDate}` : ""}
    </span>
  );
}

export function MonthlyReportsView() {
  const [reports, setReports] = React.useState<MonthlyReport[] | undefined>();
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [planningRollups, setPlanningRollups] = React.useState<
    Map<string, PlanningSnapshotRollup | null>
  >(new Map());
  const [search, setSearch] = React.useState("");
  const [projectFilter, setProjectFilter] = React.useState("");
  const [clientFilter, setClientFilter] = React.useState("");
  const [portfolioGroupFilter, setPortfolioGroupFilter] = React.useState("");
  const [monthFilter, setMonthFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("");
  const { records: contactRecords } = useMasterData("contact");
  const { records: clientRecords } = useMasterData("client");
  const { records: portfolioGroupRecords } = useMasterData("portfolioGroup");
  const contacts = contactRecords as Contact[];
  const clients = clientRecords as Client[];
  const portfolioGroups = portfolioGroupRecords as PortfolioGroup[];

  const load = React.useCallback(async () => {
    try {
      const [nextReports, nextProjects] = await Promise.all([monthlyReportService.list(), projectService.getProjects()]);
      setReports(nextReports);
      setProjects(nextProjects);

      /*
       * Each report's OWN pinned snapshot, read by immutable id — never
       * `getLatestSnapshot()`/`getSnapshotForPeriod()`. Deduped by snapshot
       * id and settled per-snapshot, so one bad id cannot blank the whole
       * register.
       */
      const pinnedIds = [
        ...new Set(
          nextReports
            .map((r) => r.planningSnapshotId)
            .filter((id): id is string => Boolean(id))
        ),
      ];
      const rollupPairs = await Promise.all(
        pinnedIds.map(async (id) => {
          try {
            return [id, await planningRollupService.computeSnapshotRollup(id)] as const;
          } catch {
            return [id, null] as const;
          }
        })
      );
      setPlanningRollups(new Map(rollupPairs));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load Monthly Reports.");
      setReports([]);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (!reports) return <LoadingState label="Loading Monthly Reports…" />;

  const projectOf = (id: string) => projects.find((project) => project.id === id);
  const projectName = (id: string) => projectOf(id)?.name ?? NOT_RECORDED;
  const clientName = (id: string) => {
    const clientId = projectOf(id)?.clientId;
    return clientId ? nameOf(clientId, clients as unknown as { id: string; name: string }[], NOT_RECORDED) : NOT_RECORDED;
  };
  const portfolioGroupName = (id: string) => {
    const groupId = projectOf(id)?.portfolioGroupId;
    return groupId ? portfolioGroups.find((g) => g.id === groupId)?.name : undefined;
  };
  const preparedByName = (report: MonthlyReport) =>
    nameOf(report.preparedByContactId, contacts as unknown as { id: string; name: string }[], "Not assigned");

  const filtered = reports.filter((report) => {
    const haystack = `${report.reportNumber} ${projectName(report.projectId)} ${preparedByName(report)}`;
    return (
      (!search || haystack.toLowerCase().includes(search.toLowerCase())) &&
      (!projectFilter || report.projectId === projectFilter) &&
      (!clientFilter || projectOf(report.projectId)?.clientId === clientFilter) &&
      (!portfolioGroupFilter || projectOf(report.projectId)?.portfolioGroupId === portfolioGroupFilter) &&
      (!monthFilter || report.reportingMonth.slice(0, 7) === monthFilter) &&
      (!statusFilter || report.status === statusFilter)
    );
  });

  const summary = summarizeReportRegister(filtered, {
    draft: ["draft"],
    review: ["submitted", "under_review"],
    approved: ["approved", "finalized", "locked", "archived"],
  });
  const counts = {
    total: summary.total,
    draft: summary.statusCounts.draft,
    review: summary.statusCounts.review,
    approved: summary.statusCounts.approved,
  };

  const clientOptions = clients
    .filter((c) => projects.some((p) => p.clientId === c.id))
    .sort((a, b) => (a.shortName ?? a.name).localeCompare(b.shortName ?? b.name));
  const portfolioGroupOptions = portfolioGroups
    .filter((g) => projects.some((p) => p.portfolioGroupId === g.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="monthly-list-view monthly-register-view">
      <div className="monthly-list-header">
        <div>
          <p className="monthly-eyebrow">Reporting register</p>
          <h1>Monthly Reports</h1>
          <span>Consolidated Monthly Progress Reports across every project you can access. Raised and edited from each project&rsquo;s own Reporting area.</span>
        </div>
      </div>

      <div className="monthly-counter-row">
        {(
          [
            ["Total Reports", counts.total],
            ["Draft", counts.draft],
            ["Under Review", counts.review],
            ["Approved / Finalized", counts.approved],
          ] as const
        ).map(([label, value]) => (
          <div className="monthly-counter" key={label}>
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </div>

      <div className="monthly-list-toolbar">
        <label className="monthly-search-field">
          <Search aria-hidden />
          <input
            aria-label="Search Monthly Reports"
            placeholder="Search report no., project, or prepared by"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <select aria-label="Filter by project" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
          <option value="">All projects</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <select aria-label="Filter by client" value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}>
          <option value="">All clients</option>
          {clientOptions.map((client) => (
            <option key={client.id} value={client.id}>
              {client.shortName ?? client.name}
            </option>
          ))}
        </select>
        {portfolioGroupOptions.length > 0 && (
          <select
            aria-label="Filter by portfolio group"
            value={portfolioGroupFilter}
            onChange={(event) => setPortfolioGroupFilter(event.target.value)}
          >
            <option value="">All portfolio groups</option>
            {portfolioGroupOptions.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        )}
        <input aria-label="Filter by month" type="month" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)} />
        <select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(REPORT_STATUS_META).map(([value, meta]) => (
            <option value={value} key={value}>
              {meta.label}
            </option>
          ))}
        </select>
      </div>

      {reports.length === 0 ? (
        <EmptyState
          title="No Monthly Reports yet"
          description="No Monthly Report has been raised on a project you can access yet. Reports are created from a project's own Reporting area, not from this register."
          icon={FilePlus2}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No Monthly Reports match these filters"
          description="Clear a filter to see the rest of the register."
          icon={SearchX}
        />
      ) : (
        <div className="monthly-list-card">
          <div className="monthly-table-wrap">
            <table className="monthly-table monthly-register-table">
              <thead>
                <tr>
                  <th>Report No.</th>
                  <th>Project</th>
                  <th>Client</th>
                  <th>Month</th>
                  <th>Planned</th>
                  <th>Actual</th>
                  <th>Variance</th>
                  <th>Planning</th>
                  <th>Prepared By</th>
                  <th>Status</th>
                  <th>Last Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((report) => {
                  const status = monthEndStatus(report);
                  const groupName = portfolioGroupName(report.projectId);
                  return (
                    <tr key={report.id}>
                      <td>
                        <Link className="monthly-link" href={`/monthly-reports/${report.id}`}>
                          {report.reportNumber}
                        </Link>
                      </td>
                      <td className="monthly-register-project">
                        <span
                          className="monthly-register-primary"
                          title={projectName(report.projectId)}
                        >
                          {projectName(report.projectId)}
                        </span>
                        {(projectOf(report.projectId)?.code || groupName) && (
                          <small
                            className="block muted monthly-register-meta"
                            title={[
                              projectOf(report.projectId)?.code,
                              groupName,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          >
                            {projectOf(report.projectId)?.code}
                            {groupName ? ` · ${groupName}` : ""}
                          </small>
                        )}
                      </td>
                      <td className="monthly-register-client">
                        <span title={clientName(report.projectId)}>
                          {clientName(report.projectId)}
                        </span>
                      </td>
                      <td>{getMonthLabel(report.reportingMonth)}</td>
                      <td className="planned-value">{report.plannedProgress.toFixed(1)}%</td>
                      <td className="actual-value">{report.actualProgress.toFixed(1)}%</td>
                      <td className="variance-value">
                        {report.scheduleVariance > 0 ? "+" : ""}
                        {report.scheduleVariance.toFixed(1)}%
                      </td>
                      <td>
                        <PlanningCell
                          report={report}
                          rollup={report.planningSnapshotId ? planningRollups.get(report.planningSnapshotId) : null}
                        />
                      </td>
                      <td className="muted">
                        <span
                          className="monthly-register-compact-text"
                          title={preparedByName(report)}
                        >
                          {preparedByName(report)}
                        </span>
                      </td>
                      <td>
                        <StatusBadge tone={status.tone}>{REPORT_STATUS_META[report.status]?.label ?? status.label}</StatusBadge>
                      </td>
                      <td>{format(new Date(report.updatedAt), "dd MMM yyyy")}</td>
                      <td>
                        <div className="monthly-row-action-cell">
                          <Button variant="ghost" size="icon-sm" aria-label={`View ${report.reportNumber}`} title="Open Report" asChild>
                            <Link href={`/monthly-reports/${report.id}`}>
                              <Eye />
                            </Link>
                          </Button>
                          <Button variant="ghost" size="icon-sm" aria-label={`Preview ${report.reportNumber}`} title="Print Preview / PDF" asChild>
                            <Link href={`/monthly-reports/${report.id}/preview`}>
                              <Printer />
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
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Create screen ----------------------------- */

export interface MonthlyNewViewProps {
  /**
   * Create against ONE fixed project and stay inside it afterwards.
   *
   * Set by `/projects/[projectId]/reports/monthly/new`. The project selector
   * is replaced by the fixed project, and both exits return to project-scoped
   * routes. Omitted on the global `/monthly-reports/new`, which keeps its
   * selector and global destinations.
   *
   * The creation itself is untouched in both cases — same
   * `monthlyReportService.create` followed by `compileFromWeeklies`, so the
   * Weekly-consolidation governance rule is applied identically however the
   * form was reached.
   */
  projectId?: string;
}

export function MonthlyNewView({
  projectId: fixedProjectId,
}: MonthlyNewViewProps = {}) {
  const router = useRouter();
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [projectId, setProjectId] = React.useState(fixedProjectId ?? "");
  const [month, setMonth] = React.useState(format(new Date(), "yyyy-MM"));
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    projectService
      .getProjects()
      .then(setProjects)
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not load projects."));
  }, []);

  const create = async () => {
    if (!projectId || !month) {
      toast.error("Select a project and a reporting month.");
      return;
    }
    setCreating(true);
    try {
      const report = await monthlyReportService.create(projectId, `${month}-01`);
      await monthlyReportService.compileFromWeeklies(report.id);
      router.push(
        fixedProjectId
          ? `/projects/${fixedProjectId}/reports/monthly/${report.id}/workspace`
          : `/monthly-reports/${report.id}/workspace`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the Monthly Report.");
      setCreating(false);
    }
  };

  return (
    <div className="monthly-new-view">
      <div className="monthly-new-header">
        <p className="monthly-eyebrow">Reporting</p>
        <h1>Create Monthly Report</h1>
        <span>Creates the Monthly report and imports eligible Weekly items selected for Monthly reporting.</span>
      </div>
      <div className="monthly-list-card monthly-create-card">
        <div className="monthly-create-grid">
          <label>
            Project
            {fixedProjectId ? (
              // Fixed by the route. Rendered as the project's NAME, never its
              // id, and disabled rather than removed so the field still reads
              // as part of the form.
              <select value={fixedProjectId} disabled>
                <option value={fixedProjectId}>
                  {projects.find((project) => project.id === fixedProjectId)
                    ?.name ?? "This project"}
                </option>
              </select>
            ) : (
              <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                <option value="">Select a project</option>
                {projects.map((project) => (
                  <option value={project.id} key={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            )}
          </label>
          <label>
            Reporting Month
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </label>
        </div>
        <p className="monthly-create-note">
          One Monthly report exists per project per month. Weekly items already imported are never duplicated, so this step is safe to repeat.
        </p>
        <div className="monthly-create-actions">
          <Button onClick={create} disabled={!projectId || !month || creating}>
            <FilePlus2 />
            {creating ? "Creating…" : "Create Monthly Report"}
          </Button>
          <Button asChild variant="outline">
            <Link
              href={
                fixedProjectId
                  ? `/projects/${fixedProjectId}/reporting?tab=monthly`
                  : "/monthly-reports"
              }
            >
              Cancel
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

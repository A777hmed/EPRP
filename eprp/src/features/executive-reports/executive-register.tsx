"use client";
/* Register data loads from the browser services after mount. */
/* eslint-disable react-hooks/set-state-in-effect */

/**
 * The Executive Report Register — `/executive-reports`.
 *
 * Consistent with the Weekly and Monthly registers: a list of reporting periods
 * with their coverage, from which a reader opens the consolidated report.
 *
 * IMPORTANT — these are not stored Executive Reports. No `executive_reports`
 * table exists, so inventing report numbers, revisions or approval states here
 * would be fabricating records. Each row is a REPORTING PERIOD derived from the
 * Monthly Reports that exist, and every figure on it is counted from real data.
 * The register therefore describes what CAN be reported, not what has been
 * issued — and the Portfolio Status column says so in as many words.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, FileBarChart, MoreHorizontal, PenLine, Printer, Trash2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog, EmptyState, LoadingState, StatusBadge } from "@/components/shared";
import { useMasterData } from "@/features/master-data";
import { monthlyReportService } from "@/services/monthly-report-service";
import { projectService } from "@/services/project-service";
import type { MonthlyReport, Project } from "@/types";
import { isApprovedMonthly, monthLabelOf } from "./executive-data";
import {
  canHardDelete,
  executiveRecordService,
  EXECUTIVE_STATUS_LABEL,
  type ExecutiveReportRecord,
} from "./executive-record";
import { visibleProjects } from "./executive-scope";
import type { ExecutiveViewerProps } from "./executive-view";
import { ExecutiveDenied } from "./executive-view";

interface RegisterRow {
  month: string;
  monthLabel: string;
  projectCount: number;
  clientCount: number;
  approvedCount: number;
  reportedCount: number;
  lastUpdated?: string;
  /** The stored Executive record, once somebody has edited this period. */
  record?: ExecutiveReportRecord;
}

/**
 * One row per reporting month that holds at least one Monthly Report.
 *
 * A month with no Monthly Report is not listed: there would be nothing to
 * consolidate, and an empty row would imply a report that does not exist.
 */
function buildRegister(
  reports: MonthlyReport[],
  projects: Project[],
  records: ExecutiveReportRecord[]
): RegisterRow[] {
  const recordByMonth = new Map(records.map((record) => [record.reportingMonth.slice(0, 7), record]));

  const byMonth = new Map<string, MonthlyReport[]>();
  for (const report of reports) {
    const month = report.reportingMonth.slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) ?? []), report]);
  }

  return [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, monthReports]) => {
      const projectIds = new Set(monthReports.map((report) => report.projectId));
      const clientIds = new Set(
        projects.filter((project) => projectIds.has(project.id)).map((project) => project.clientId)
      );
      return {
        month,
        monthLabel: monthLabelOf(month),
        projectCount: projectIds.size,
        clientCount: clientIds.size,
        approvedCount: monthReports.filter(isApprovedMonthly).length,
        reportedCount: monthReports.length,
        lastUpdated: monthReports.map((r) => r.updatedAt).sort((a, b) => b.localeCompare(a))[0],
        record: recordByMonth.get(month),
      };
    });
}

export function ExecutiveRegisterView(props: ExecutiveViewerProps) {
  const router = useRouter();
  const [rows, setRows] = React.useState<RegisterRow[] | undefined>();
  const [pending, setPending] = React.useState<{ row: RegisterRow; mode: "delete" | "archive" } | null>(null);
  const { records: clients } = useMasterData("client");

  const load = React.useCallback(async () => {
    try {
      const [allProjects, reports, records] = await Promise.all([
        projectService.getProjects(),
        monthlyReportService.list(),
        executiveRecordService.list(),
      ]);

      // Filtered before counting, so a register figure cannot disclose the
      // existence of a project the reader may not open.
      const projects = visibleProjects(allProjects, {
        contactId: props.contactId,
        isAdmin: props.isAdmin,
      });
      const visibleIds = new Set(projects.map((project) => project.id));
      setRows(buildRegister(reports.filter((r) => visibleIds.has(r.projectId)), projects, records));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load Executive reporting periods.");
      setRows([]);
    }
  }, [props.contactId, props.isAdmin]);

  React.useEffect(() => {
    void load();
  }, [load, clients]);

  const confirmRemoval = async () => {
    // Captured before the dialog closes: `pending` is cleared by onOpenChange,
    // and reading it later gave an early return on a delete that had run.
    const target = pending;
    if (!target?.row.record) return;
    const recordId = target.row.record.id;

    try {
      if (target.mode === "archive") {
        const archived = await executiveRecordService.archive(recordId);
        setRows((current) =>
          current?.map((row) => (row.month === target.row.month ? { ...row, record: archived } : row))
        );
        toast.success("Executive Report archived. It remains readable.");
      } else {
        await executiveRecordService.remove(recordId);
        // Reflect the removal immediately; the reload below reconciles.
        setRows((current) =>
          current?.map((row) => (row.month === target.row.month ? { ...row, record: undefined } : row))
        );
        toast.success("Executive Report deleted. Monthly, Weekly and project data are untouched.");
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not complete the action.");
      await load();
    }
  };

  if (!props.allowed) return <ExecutiveDenied reason={props.deniedReason} />;
  if (!rows) return <LoadingState label="Loading Executive reporting periods…" />;

  return (
    <div className="monthly-list-view exec-register">
      <div className="monthly-list-header">
        <div>
          <p className="monthly-eyebrow">Executive reporting</p>
          <h1>Executive Reports</h1>
          <span>
            Consolidated portfolio reporting periods. Each period opens one multi-project Executive Report.
          </span>
        </div>
      </div>

      {rows.length ? (
        <div className="monthly-list-card">
          <div className="monthly-table-wrap">
            <table className="monthly-table exec-register-table">
              <thead>
                <tr>
                  <th>Reporting Period</th>
                  <th>Projects in View</th>
                  <th>Clients</th>
                  <th>Approved Monthly Basis</th>
                  <th>Portfolio Status</th>
                  <th>Last Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const fullyApproved = row.approvedCount === row.reportedCount && row.reportedCount > 0;
                  return (
                    <tr key={row.month}>
                      <td>
                        <Link className="monthly-link" href={`/executive-reports/portfolio?month=${row.month}`}>
                          {row.monthLabel}
                        </Link>
                      </td>
                      <td className="exec-numeric">
                        {row.projectCount} Project{row.projectCount === 1 ? "" : "s"}
                      </td>
                      <td className="exec-numeric">
                        {row.clientCount} Client{row.clientCount === 1 ? "" : "s"}
                      </td>
                      <td className="exec-numeric">
                        {row.approvedCount} / {row.reportedCount} Approved
                      </td>
                      <td>
                        <StatusBadge tone={fullyApproved ? "success" : "warning"}>
                          {fullyApproved ? "Approved basis" : "Provisional"}
                        </StatusBadge>
                        {/* The Executive record's own lifecycle, once one exists.
                            Distinct from the Monthly basis above it. */}
                        {row.record && (
                          <small className="exec-record-state">
                            Executive record: {EXECUTIVE_STATUS_LABEL[row.record.status]}
                          </small>
                        )}
                      </td>
                      <td>{row.lastUpdated ? format(parseISO(row.lastUpdated.slice(0, 10)), "dd MMM yyyy") : "—"}</td>
                      <td>
                        <div className="monthly-row-action-cell">
                          {/*
                            Labelled "Open" rather than "Open Portfolio".
                            The Actions column is 13% of the table, which is
                            not wide enough for the full phrase beside the
                            overflow trigger — forcing it wrapped the group
                            onto a second line and inflated every row. The
                            accessible name keeps the full wording, so nothing
                            is lost to a screen reader or a tooltip.
                          */}
                          <Button
                            size="sm"
                            title={`Open the ${row.monthLabel} portfolio report`}
                            aria-label={`Open Portfolio — ${row.monthLabel}`}
                            onClick={() => router.push(`/executive-reports/portfolio?month=${row.month}`)}
                          >
                            Open
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="outline"
                                size="icon-sm"
                                aria-label={`More actions for ${row.monthLabel}`}
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-60">
                              <DropdownMenuLabel>{row.monthLabel}</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem asChild>
                                <Link href={`/executive-reports/portfolio?month=${row.month}`}>
                                  <FileBarChart />
                                  Open Portfolio
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                <Link href={`/executive-reports/workspace?month=${row.month}`}>
                                  <PenLine />
                                  Edit
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                <Link href={`/executive-reports/preview?month=${row.month}`}>
                                  <Printer />
                                  Preview / PDF
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {/*
                                Past approval the report is part of the reporting
                                record: Archive replaces Delete, and the database
                                refuses the delete independently of this menu.
                              */}
                              {row.record && !canHardDelete(row.record.status) ? (
                                <DropdownMenuItem
                                  onSelect={(event) => {
                                    event.preventDefault();
                                    setPending({ row, mode: "archive" });
                                  }}
                                >
                                  <Archive />
                                  Archive
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  disabled={!row.record}
                                  onSelect={(event) => {
                                    event.preventDefault();
                                    if (row.record) setPending({ row, mode: "delete" });
                                  }}
                                >
                                  <Trash2 />
                                  {row.record ? "Delete" : "Delete — nothing saved yet"}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ConfirmDialog
            open={Boolean(pending)}
            onOpenChange={(next) => !next && setPending(null)}
            title={
              pending?.mode === "archive"
                ? "Archive this Executive Report?"
                : "Delete this Executive Report?"
            }
            description={
              pending?.mode === "archive"
                ? `${pending?.row.monthLabel} will be withdrawn from active use and remain readable. No Monthly, Weekly or project data is affected.`
                : `Deletes only the Executive record for ${pending?.row.monthLabel} — its reviewed summary, preparer override and Executive metadata. Monthly Reports, Weekly Reports, projects, risks, actions and milestones are NOT affected, and the portfolio can be composed again at any time.`
            }
            confirmLabel={pending?.mode === "archive" ? "Archive Report" : "Delete Executive Report"}
            onConfirm={confirmRemoval}
          />

          <p className="exec-register-note">
            Reporting periods are derived from the Monthly Reports that exist. Executive Reports are not yet stored as
            numbered, revisioned records, so no report number or approval state is shown.
          </p>
        </div>
      ) : (
        <EmptyState
          title="No reporting periods available"
          description="An Executive Report is consolidated from Monthly Reports. None are available for the projects you can access."
          icon={FileBarChart}
        />
      )}
    </div>
  );
}

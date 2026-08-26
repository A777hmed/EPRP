"use client";
/* Monthly data loads from the browser service after mount; the same loader is
   reused to refresh the register after a row action writes. */
/* eslint-disable react-hooks/set-state-in-effect */

/**
 * The Monthly register (/monthly-reports) and the create screen.
 *
 * The register is a portfolio view: every Monthly report a user may see, with
 * the schedule position on the row so leadership can scan the estate without
 * opening each report.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, FilePlus2, MoreHorizontal, PenLine, Printer, RefreshCw, Search } from "lucide-react";
import { format } from "date-fns";
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
import { REPORT_STATUS_META } from "@/lib/constants";
import { getMonthLabel } from "@/lib/reporting";
import { monthlyReportService } from "@/services/monthly-report-service";
import { projectService } from "@/services/project-service";
import { isProjectConsolidator } from "@/features/projects/assignment-rules";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { useMasterData } from "@/features/master-data";
import type { Contact, MonthlyReport, Project, UserRole } from "@/types";
import { NOT_RECORDED, compilationMessage, monthEndStatus, nameOf } from "./monthly-data";

/**
 * Row actions.
 *
 * One visible primary action plus an overflow menu, rather than a stack of
 * blue links: the common case (open the report) is a button, and everything
 * else is one click away and named for what it does.
 *
 * Every entry is gated on the signed-in role. This is presentation only — RLS
 * is what actually refuses the write — but offering an action a user cannot
 * perform just produces a permission error they did not ask for.
 */
function RowActions({
  report,
  canEdit,
  onChanged,
}: {
  report: MonthlyReport;
  canEdit: boolean;
  onChanged: () => Promise<void>;
}) {
  const [archiving, setArchiving] = React.useState(false);
  const [updating, setUpdating] = React.useState(false);
  const alreadyArchived = report.status === "archived";

  const updateFromWeekly = async () => {
    setUpdating(true);
    try {
      const result = await monthlyReportService.compileFromWeeklies(report.id);
      await onChanged();
      toast.success(compilationMessage(result));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update from Weekly Reports.");
    } finally {
      setUpdating(false);
    }
  };

  const archive = async () => {
    try {
      await monthlyReportService.changeStatus(report.id, "archived");
      await onChanged();
      toast.success("Monthly report archived.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not archive the report.");
    }
  };

  return (
    <div className="monthly-row-action-cell">
      <Button asChild size="sm">
        <Link href={`/monthly-reports/${report.id}`}>Open Report</Link>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-sm" aria-label={`More actions for ${report.reportNumber}`} title="More actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>{report.reportNumber}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {canEdit && (
            <DropdownMenuItem asChild>
              <Link href={`/monthly-reports/${report.id}/workspace`}>
                <PenLine />
                Edit in Workspace
              </Link>
            </DropdownMenuItem>
          )}
          {/* One entry per destination. "Open Report" is the primary button, so
              repeating it here as "Preview Report" only made two labels compete
              for the same page. /preview is the print-ready view, named for it. */}
          <DropdownMenuItem asChild>
            <Link href={`/monthly-reports/${report.id}/preview`}>
              <Printer />
              Print Preview / PDF
            </Link>
          </DropdownMenuItem>
          {canEdit && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={updating} onSelect={(event) => { event.preventDefault(); void updateFromWeekly(); }}>
                <RefreshCw />
                {updating ? "Updating…" : "Update from Weekly Reports"}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={alreadyArchived}
                onSelect={(event) => {
                  event.preventDefault();
                  setArchiving(true);
                }}
              >
                <Archive />
                {alreadyArchived ? "Already archived" : "Archive Report"}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title="Archive this Monthly report?"
        description={`${report.reportNumber} will move to Archived status. Its data, Weekly links and comments are kept — nothing is deleted — and an administrator can restore it by changing the status back.`}
        confirmLabel="Archive Report"
        onConfirm={archive}
      />
    </div>
  );
}

export function MonthlyReportsView({ role }: { role?: UserRole }) {
  const [reports, setReports] = React.useState<MonthlyReport[] | undefined>();
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [search, setSearch] = React.useState("");
  const [projectFilter, setProjectFilter] = React.useState("");
  const [monthFilter, setMonthFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("");
  const { records: contacts } = useMasterData("contact");
  /* The contact this login is linked to. Without it nobody can be matched to a
     project assignment, so the register stays read-only until it resolves. */
  const [viewerContactId, setViewerContactId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let active = true;
    void (async () => {
      const sb = getSupabaseBrowserClient();
      const { data: auth } = await sb.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) return;
      const { data } = await sb
        .from("profiles")
        .select("contact_id")
        .eq("id", userId)
        .maybeSingle();
      if (active) setViewerContactId((data as { contact_id?: string | null } | null)?.contact_id ?? null);
    })().catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const load = React.useCallback(async () => {
    try {
      const [nextReports, nextProjects] = await Promise.all([monthlyReportService.list(), projectService.getProjects()]);
      setReports(nextReports);
      setProjects(nextProjects);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load Monthly Reports.");
      setReports([]);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  /*
   * Monthly write authority is PER PROJECT, so it cannot be answered once for
   * the whole register.
   *
   * This read `hasPermission(role, "edit_monthly")`, a platform-wide matrix
   * lookup. That was wrong in both directions: it handed every Project Manager
   * edit authority on projects they hold no assignment to, and it denied the
   * assigned Report Coordinator the Monthly they are responsible for, because
   * a responsibility is not a platform role.
   *
   * `canEditReport` mirrors `can_manage_reporting_workflow()`: the two global
   * authorities, plus the assigned Project Control / Planning or Report
   * Coordinator via `isProjectConsolidator` — which is the reporting predicate
   * and is the correct one here, unlike for Master Milestones.
   */
  const isGlobalAuthority = role === "system_admin" || role === "project_control_admin";

  const canEditReport = React.useCallback(
    (report: MonthlyReport): boolean => {
      // No role means no profile row resolved; treat that as read-only rather
      // than assuming administrator.
      if (!role) return false;
      if (isGlobalAuthority) return true;
      if (!viewerContactId) return false;
      const project = projects.find((candidate) => candidate.id === report.projectId);
      return project ? isProjectConsolidator(project, viewerContactId) : false;
    },
    [role, isGlobalAuthority, viewerContactId, projects]
  );

  if (!reports) return <LoadingState label="Loading Monthly Reports…" />;

  const projectName = (id: string) => projects.find((project) => project.id === id)?.name ?? NOT_RECORDED;
  const filtered = reports.filter((report) => {
    const haystack = `${report.reportNumber} ${projectName(report.projectId)} ${nameOf(report.preparedByContactId, contacts as Contact[], "")}`;
    return (
      (!search || haystack.toLowerCase().includes(search.toLowerCase())) &&
      (!projectFilter || report.projectId === projectFilter) &&
      (!monthFilter || report.reportingMonth.slice(0, 7) === monthFilter) &&
      (!statusFilter || report.status === statusFilter)
    );
  });

  const counts = {
    total: reports.length,
    draft: reports.filter((report) => report.status === "draft").length,
    review: reports.filter((report) => ["submitted", "under_review"].includes(report.status)).length,
    approved: reports.filter((report) => ["approved", "finalized", "locked", "archived"].includes(report.status)).length,
  };

  return (
    <div className="monthly-list-view">
      <div className="monthly-list-header">
        <div>
          <p className="monthly-eyebrow">Reporting register</p>
          <h1>Monthly Reports</h1>
          <span>Consolidated Monthly Progress Reports across every project you can access.</span>
        </div>
        <Button asChild>
          <Link href="/monthly-reports/new">
            <FilePlus2 />
            New Monthly Report
          </Link>
        </Button>
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

      {filtered.length ? (
        <div className="monthly-list-card">
          <div className="monthly-table-wrap">
            <table className="monthly-table monthly-register-table">
              <thead>
                <tr>
                  <th>Report No.</th>
                  <th>Project</th>
                  <th>Month</th>
                  <th>Planned</th>
                  <th>Actual</th>
                  <th>Variance</th>
                  <th>Status</th>
                  <th>Last Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((report) => {
                  const status = monthEndStatus(report);
                  return (
                    <tr key={report.id}>
                      <td>
                        <Link className="monthly-link" href={`/monthly-reports/${report.id}`}>
                          {report.reportNumber}
                        </Link>
                      </td>
                      <td>{projectName(report.projectId)}</td>
                      <td>{getMonthLabel(report.reportingMonth)}</td>
                      <td className="planned-value">{report.plannedProgress.toFixed(1)}%</td>
                      <td className="actual-value">{report.actualProgress.toFixed(1)}%</td>
                      <td className="variance-value">
                        {report.scheduleVariance > 0 ? "+" : ""}
                        {report.scheduleVariance.toFixed(1)}%
                      </td>
                      <td>
                        <StatusBadge tone={status.tone}>{REPORT_STATUS_META[report.status]?.label ?? status.label}</StatusBadge>
                      </td>
                      <td>{format(new Date(report.updatedAt), "dd MMM yyyy")}</td>
                      <td>
                        <RowActions report={report} canEdit={canEditReport(report)} onChanged={load} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState
          title={reports.length ? "No Monthly Reports match these filters" : "No Monthly Reports yet"}
          description={reports.length ? "Clear a filter to see the rest of the register." : "Create the first Monthly Report to begin consolidating Weekly data."}
          icon={FilePlus2}
        />
      )}
    </div>
  );
}

/* ------------------------------- Create screen ----------------------------- */

export function MonthlyNewView() {
  const router = useRouter();
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [projectId, setProjectId] = React.useState("");
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
      router.push(`/monthly-reports/${report.id}/workspace`);
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
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">Select a project</option>
              {projects.map((project) => (
                <option value={project.id} key={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
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
            <Link href="/monthly-reports">Cancel</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

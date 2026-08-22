"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  CalendarDays,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  FileText,
  MoreHorizontal,
  PenLine,
  Plus,
  Printer,
  SearchX,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
  PageHeader,
  SearchInput,
  StatCard,
} from "@/components/shared";
import { REPORT_STATUS_META } from "@/lib/constants";
import { formatDate } from "@/lib/formatters";
import { projectService } from "@/services/project-service";
import { weeklyReportService } from "@/services/weekly-report-service";
import type { Project, ReportStatus, WeeklyReport } from "@/types";
import {
  countReceived,
  IN_PROGRESS_STATUSES,
  isEditableReport,
  SIGNED_OFF_STATUSES,
} from "@/features/weekly-reports/utils";
import { ConfirmDialog } from "@/components/shared";
import { WeeklyStatusBadge } from "./weekly-status-badge";

/**
 * Schedule variance for a register row.
 *
 * Derived here rather than stored: actual less planned is the same arithmetic
 * the Dashboard and the Executive Report already use, and duplicating it as a
 * column on the report record would create a second figure that could drift
 * from the two it is computed from.
 *
 * "Not recorded" is shown when either side is absent — never 0, which would
 * assert a position that was never reported.
 */
function VarianceCell({
  planned,
  actual,
}: {
  planned: number | null | undefined;
  actual: number | null | undefined;
}) {
  if (planned === null || planned === undefined || actual === null || actual === undefined) {
    return <span className="text-muted-foreground">Not recorded</span>;
  }
  const variance = Math.round((actual - planned) * 10) / 10;
  const tone =
    variance < -3
      ? "text-destructive"
      : variance < 0
        ? "text-warning"
        : "text-success";
  return (
    <span className={`font-medium ${tone}`}>
      {variance > 0 ? "+" : variance < 0 ? "−" : ""}
      {Math.abs(variance)}%
    </span>
  );
}

interface Filters {
  query: string;
  status: ReportStatus | "all";
  projectId: string | "all";
  week: string; // "all" or week number
}

const defaultFilters: Filters = {
  query: "",
  status: "all",
  projectId: "all",
  week: "all",
};

const statusOrder: ReportStatus[] = [
  "draft",
  "collecting",
  "under_review",
  "approved",
  "finalized",
  "locked",
  "returned",
  "archived",
];

/** /weekly-reports — list with summary cards, filters, and row actions. */
export function WeeklyReportsView() {
  const router = useRouter();
  const [reports, setReports] = React.useState<WeeklyReport[] | null>(null);
  const [projects, setProjects] = React.useState<Map<string, Project>>(
    new Map()
  );
  const [received, setReceived] = React.useState<Map<string, number>>(new Map());
  const [error, setError] = React.useState(false);
  const [filters, setFilters] = React.useState(defaultFilters);
  const [archiveTarget, setArchiveTarget] = React.useState<WeeklyReport | null>(
    null
  );
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [reportList, projectList] = await Promise.all([
          weeklyReportService.list(),
          projectService.getProjects(),
        ]);
        const subCounts = await Promise.all(
          reportList.map((r) => weeklyReportService.listSubmissions(r.id))
        );
        if (cancelled) return;
        setProjects(new Map(projectList.map((p) => [p.id, p])));
        setReceived(
          new Map(reportList.map((r, i) => [r.id, countReceived(subCounts[i])]))
        );
        setReports(reportList);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const reload = () => {
    setError(false);
    setReports(null);
    setReloadKey((k) => k + 1);
  };

  const projectName = (id: string) =>
    projects.get(id)?.shortName ?? projects.get(id)?.name ?? "—";

  const weekOptions = React.useMemo(() => {
    const weeks = new Set((reports ?? []).map((r) => r.weekNumber));
    return [...weeks].sort((a, b) => b - a);
  }, [reports]);

  const visible = React.useMemo(() => {
    const all = reports ?? [];
    const query = filters.query.trim().toLowerCase();
    return all.filter((r) => {
      if (filters.status !== "all" && r.status !== filters.status) return false;
      if (filters.projectId !== "all" && r.projectId !== filters.projectId)
        return false;
      if (filters.week !== "all" && String(r.weekNumber) !== filters.week)
        return false;
      if (query) {
        const haystack =
          `${r.reportNumber} ${projectName(r.projectId)}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports, filters, projects]);

  const stats = React.useMemo(() => {
    const all = reports ?? [];
    return {
      total: all.length,
      inProgress: all.filter((r) => IN_PROGRESS_STATUSES.includes(r.status))
        .length,
      signedOff: all.filter((r) => SIGNED_OFF_STATUSES.includes(r.status))
        .length,
      thisWeek: weekOptions.length > 0
        ? all.filter((r) => r.weekNumber === Math.max(...weekOptions)).length
        : 0,
    };
  }, [reports, weekOptions]);

  const handleDuplicate = async (report: WeeklyReport) => {
    const copy = await weeklyReportService.duplicate(report.id);
    toast.success("Weekly report duplicated");
    router.push(`/weekly-reports/${copy.id}`);
  };

  /*
   * A failed archive must never look like a successful one.
   *
   * This awaited the service with no catch, so when the database refused the
   * transition the rejection escaped as an unhandled promise: no error toast,
   * no success toast, nothing. The report stayed exactly as it was and the user
   * had no way to know why. Matches the Monthly handler's shape, which already
   * did this correctly.
   */
  const handleArchive = async () => {
    if (!archiveTarget) return;
    try {
      await weeklyReportService.archive(archiveTarget.id);
      toast.success("Weekly report archived");
      setArchiveTarget(null);
      reload();
    } catch (error) {
      // The report keeps its current status and stays in the list. The message
      // comes from the database rule that refused it, so it says which.
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not archive this weekly report."
      );
    }
  };

  const activeFilters =
    (filters.query ? 1 : 0) +
    (filters.status !== "all" ? 1 : 0) +
    (filters.projectId !== "all" ? 1 : 0) +
    (filters.week !== "all" ? 1 : 0);

  const projectOptions = [...projects.values()].sort((a, b) =>
    (a.shortName ?? a.name).localeCompare(b.shortName ?? b.name)
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reporting"
        title="Weekly Reports"
        description="Weekly progress reports collected from project departments."
        actions={
          <Button asChild>
            <Link href="/weekly-reports/new">
              <Plus data-icon="inline-start" aria-hidden="true" />
              New Weekly Report
            </Link>
          </Button>
        }
      />

      <section aria-label="Weekly report summary">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Total Reports" value={String(stats.total)} icon={FileText} />
          <StatCard label="In Progress" value={String(stats.inProgress)} icon={Clock} />
          <StatCard label="Approved +" value={String(stats.signedOff)} icon={CheckCircle2} />
          <StatCard label="Latest Week" value={String(stats.thisWeek)} icon={CalendarDays} />
        </div>
      </section>

      <FilterBar
        activeCount={activeFilters}
        onReset={() => setFilters(defaultFilters)}
      >
        <SearchInput
          value={filters.query}
          onValueChange={(query) => setFilters((f) => ({ ...f, query }))}
          placeholder="Search report # or project…"
          containerClassName="w-full sm:w-60"
        />
        <Select
          value={filters.status}
          onValueChange={(v) =>
            setFilters((f) => ({ ...f, status: v as Filters["status"] }))
          }
        >
          <SelectTrigger className="w-36" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {statusOrder.map((s) => (
              <SelectItem key={s} value={s}>
                {REPORT_STATUS_META[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.projectId}
          onValueChange={(v) => setFilters((f) => ({ ...f, projectId: v }))}
        >
          <SelectTrigger className="w-44" aria-label="Filter by project">
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {projectOptions.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.shortName ?? p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.week}
          onValueChange={(v) => setFilters((f) => ({ ...f, week: v }))}
        >
          <SelectTrigger className="w-28" aria-label="Filter by week">
            <SelectValue placeholder="Week" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All weeks</SelectItem>
            {weekOptions.map((w) => (
              <SelectItem key={w} value={String(w)}>
                Week {w}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      {error ? (
        <ErrorState
          title="Weekly reports could not be loaded"
          description="The report list failed to load. Try again."
          onRetry={reload}
        />
      ) : reports === null ? (
        <LoadingState variant="table" count={5} label="Loading weekly reports…" />
      ) : reports.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No weekly reports yet"
          description="Create the first weekly report to start collecting department input."
          action={
            <Button asChild>
              <Link href="/weekly-reports/new">
                <Plus data-icon="inline-start" aria-hidden="true" />
                New Weekly Report
              </Link>
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No reports match your filters"
          description="Try a different search or reset the filters."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Report #</TableHead>
                <TableHead className="min-w-40">Project</TableHead>
                <TableHead>Week</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Planned</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead>Submissions</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((report) => {
                const total = report.submissionIds.length;
                const got = received.get(report.id) ?? 0;
                return (
                  <TableRow key={report.id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/weekly-reports/${report.id}`}
                        className="hover:underline"
                      >
                        {report.reportNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium">
                      {projectName(report.projectId)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      W{report.weekNumber}
                    </TableCell>
                    <TableCell className="tabular-nums whitespace-nowrap text-muted-foreground">
                      {formatDate(report.periodStart)} –{" "}
                      {formatDate(report.periodEnd)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {report.plannedProgress}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {report.actualProgress}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <VarianceCell
                        planned={report.plannedProgress}
                        actual={report.actualProgress}
                      />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {got}/{total}
                    </TableCell>
                    <TableCell>
                      <WeeklyStatusBadge status={report.status} />
                    </TableCell>
                    <TableCell className="tabular-nums whitespace-nowrap text-muted-foreground">
                      {formatDate(report.updatedAt)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Actions for ${report.reportNumber}`}
                          >
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem asChild>
                            <Link href={`/weekly-reports/${report.id}`}>
                              <Eye aria-hidden="true" /> View
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            asChild
                            disabled={!isEditableReport(report)}
                          >
                            <Link href={`/weekly-reports/${report.id}/edit`}>
                              <PenLine aria-hidden="true" /> Edit
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/weekly-reports/${report.id}/preview`}>
                              <Printer aria-hidden="true" /> Preview / PDF
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleDuplicate(report)}
                          >
                            <Copy aria-hidden="true" /> Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={report.status === "archived"}
                            onClick={() => setArchiveTarget(report)}
                          >
                            <Archive aria-hidden="true" /> Archive
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(o) => !o && setArchiveTarget(null)}
        title={`Archive ${archiveTarget?.reportNumber}?`}
        description="Archived weekly reports are hidden from the active list but remain in project history. You can still view them directly."
        confirmLabel="Archive report"
        destructive
        onConfirm={handleArchive}
      />
    </div>
  );
}

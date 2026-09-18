"use client";

import * as React from "react";
import Link from "next/link";
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Printer,
  SearchX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  planningRollupService,
  type PlanningSnapshotRollup,
} from "@/services/planning-rollup-service";
import { useMasterData } from "@/features/master-data";
import type {
  Client,
  Contact,
  PortfolioGroup,
  Project,
  ReportStatus,
  WeeklyReport,
} from "@/types";
import {
  countReceived,
  IN_PROGRESS_STATUSES,
  SIGNED_OFF_STATUSES,
} from "@/features/weekly-reports/utils";
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

/**
 * Planning Integration 4A — the report's pinned snapshot only, never a
 * re-resolved "latest". `rollup === undefined` means "not fetched yet",
 * `null` means "fetch failed or no rollup", both rendered as "Manual /
 * fallback" alongside a genuinely unpinned report — the register cannot
 * tell "still loading" from "no pin" apart at a glance, and showing a
 * spinner per row for a compact provenance cell is not worth the churn.
 */
function PlanningCell({
  report,
  rollup,
}: {
  report: WeeklyReport;
  rollup: PlanningSnapshotRollup | null | undefined;
}) {
  if (!report.planningSnapshotId || !rollup) {
    return <span className="text-xs text-muted-foreground">Manual / fallback</span>;
  }
  return (
    <span className="text-xs text-muted-foreground" title={`Snapshot v${rollup.snapshotVersion}`}>
      Snapshot v{rollup.snapshotVersion}
      {rollup.dataDate ? ` · ${formatDate(rollup.dataDate)}` : ""}
    </span>
  );
}

interface Filters {
  query: string;
  status: ReportStatus | "all";
  projectId: string | "all";
  clientId: string | "all";
  portfolioGroupId: string | "all";
  week: string; // "all" or week number
}

const defaultFilters: Filters = {
  query: "",
  status: "all",
  projectId: "all",
  clientId: "all",
  portfolioGroupId: "all",
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

/**
 * /weekly-reports — READ-ONLY consolidated register across every project
 * the viewer can see (Top-Level Reporting 4A).
 *
 * This is not a creation or editing surface. Raising and editing a Weekly
 * Report happens inside its project, at
 * `/projects/[projectId]/reports/weekly/...` — this register only ever
 * links a row to the SAME detail/preview views those project-scoped routes
 * also open, never to a form. RLS (`weekly_reports_select`) is the only
 * thing that decides which rows appear; nothing here re-filters or widens
 * that set.
 */
export function WeeklyReportsView() {
  const [reports, setReports] = React.useState<WeeklyReport[] | null>(null);
  const [projects, setProjects] = React.useState<Map<string, Project>>(
    new Map()
  );
  const [received, setReceived] = React.useState<Map<string, number>>(new Map());
  const [planningRollups, setPlanningRollups] = React.useState<
    Map<string, PlanningSnapshotRollup | null>
  >(new Map());
  const [error, setError] = React.useState(false);
  const [filters, setFilters] = React.useState(defaultFilters);
  const [reloadKey, setReloadKey] = React.useState(0);

  const { records: clientRecords } = useMasterData("client");
  const { records: portfolioGroupRecords } = useMasterData("portfolioGroup");
  const { records: contactRecords } = useMasterData("contact");
  const clients = clientRecords as Client[];
  const portfolioGroups = portfolioGroupRecords as PortfolioGroup[];
  const contacts = contactRecords as Contact[];

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

        /*
         * Each report's OWN pinned snapshot, read by immutable id — never
         * `getLatestSnapshot()`/`getSnapshotForPeriod()`. Deduped by
         * snapshot id (several reports can share one) and settled
         * per-snapshot, so one bad id cannot blank the whole register.
         */
        const pinnedIds = [
          ...new Set(
            reportList
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
        if (cancelled) return;
        setPlanningRollups(new Map(rollupPairs));
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

  const projectOf = (id: string) => projects.get(id);
  const projectName = (id: string) =>
    projectOf(id)?.shortName ?? projectOf(id)?.name ?? "—";
  const clientName = (projectId: string) => {
    const clientId = projectOf(projectId)?.clientId;
    return clientId ? (clients.find((c) => c.id === clientId)?.shortName ?? clients.find((c) => c.id === clientId)?.name ?? "—") : "—";
  };
  const portfolioGroupName = (projectId: string) => {
    const groupId = projectOf(projectId)?.portfolioGroupId;
    return groupId ? portfolioGroups.find((g) => g.id === groupId)?.name : undefined;
  };
  const preparedByName = (report: WeeklyReport) =>
    report.preparedByContactId
      ? (contacts.find((c) => c.id === report.preparedByContactId)?.name ?? "Not assigned")
      : "Not assigned";

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
      if (filters.clientId !== "all" && projectOf(r.projectId)?.clientId !== filters.clientId)
        return false;
      if (
        filters.portfolioGroupId !== "all" &&
        projectOf(r.projectId)?.portfolioGroupId !== filters.portfolioGroupId
      )
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

  const activeFilters =
    (filters.query ? 1 : 0) +
    (filters.status !== "all" ? 1 : 0) +
    (filters.projectId !== "all" ? 1 : 0) +
    (filters.clientId !== "all" ? 1 : 0) +
    (filters.portfolioGroupId !== "all" ? 1 : 0) +
    (filters.week !== "all" ? 1 : 0);

  const projectOptions = [...projects.values()].sort((a, b) =>
    (a.shortName ?? a.name).localeCompare(b.shortName ?? b.name)
  );
  const clientOptions = [...clients]
    .filter((c) => [...projects.values()].some((p) => p.clientId === c.id))
    .sort((a, b) => (a.shortName ?? a.name).localeCompare(b.shortName ?? b.name));
  const portfolioGroupOptions = [...portfolioGroups]
    .filter((g) => [...projects.values()].some((p) => p.portfolioGroupId === g.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reporting"
        title="Weekly Reports"
        description="Consolidated Weekly progress reports across every project you can access. Raised and edited from each project's own Reporting area."
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
          value={filters.clientId}
          onValueChange={(v) => setFilters((f) => ({ ...f, clientId: v }))}
        >
          <SelectTrigger className="w-40" aria-label="Filter by client">
            <SelectValue placeholder="Client" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clientOptions.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.shortName ?? c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {portfolioGroupOptions.length > 0 && (
          <Select
            value={filters.portfolioGroupId}
            onValueChange={(v) => setFilters((f) => ({ ...f, portfolioGroupId: v }))}
          >
            <SelectTrigger className="w-44" aria-label="Filter by portfolio group">
              <SelectValue placeholder="Portfolio Group" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All portfolio groups</SelectItem>
              {portfolioGroupOptions.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
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
          description="No Weekly Report has been raised on a project you can access yet. Reports are created from a project's own Reporting area, not from this register."
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
                <TableHead>Client</TableHead>
                <TableHead>Week</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Planned</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead>Planning</TableHead>
                <TableHead>Submissions</TableHead>
                <TableHead>Prepared By</TableHead>
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
                const groupName = portfolioGroupName(report.projectId);
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
                      {projectOf(report.projectId)?.code && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {projectOf(report.projectId)?.code}
                          {groupName ? ` · ${groupName}` : ""}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{clientName(report.projectId)}</TableCell>
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
                    <TableCell>
                      <PlanningCell
                        report={report}
                        rollup={
                          report.planningSnapshotId
                            ? planningRollups.get(report.planningSnapshotId)
                            : null
                        }
                      />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {got}/{total}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {preparedByName(report)}
                    </TableCell>
                    <TableCell>
                      <WeeklyStatusBadge status={report.status} />
                    </TableCell>
                    <TableCell className="tabular-nums whitespace-nowrap text-muted-foreground">
                      {formatDate(report.updatedAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`View ${report.reportNumber}`}
                          title="View"
                          asChild
                        >
                          <Link href={`/weekly-reports/${report.id}`}>
                            <Eye aria-hidden="true" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Preview ${report.reportNumber}`}
                          title="Preview / PDF"
                          asChild
                        >
                          <Link href={`/weekly-reports/${report.id}/preview`}>
                            <Printer aria-hidden="true" />
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

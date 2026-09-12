"use client";

/**
 * Milestones stay on the Dashboard: "View All" (Milestone Progress and
 * Milestones Upcoming) and every milestone row open this one large modal
 * rather than navigating to a Weekly/Monthly report or the project's own
 * Milestones section. It is a plain list -> detail stack over data the
 * Dashboard already has in scope — nothing here is fetched separately, and
 * the search/status/project controls below only narrow what this modal
 * shows, never the Dashboard's own filters. The source report stays
 * reachable, but only as a secondary action in the footer, never the
 * primary way to read the milestone.
 */

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  FileText,
  Gauge,
  Search,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DetailModal, StatusBadge, type StatusTone } from "@/components/shared";
import { milestoneStageOf, type Tone } from "./dashboard-analytics";
import type { DashboardMilestone } from "./dashboard-data";
import type { Department } from "@/types";

export interface MilestoneModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Already scoped to the Dashboard's current filters — not capped to a
      panel's compact row count. The header counters and "All Projects"
      project filter are both derived from this full set. */
  milestones: DashboardMilestone[];
  /** All Projects groups rows under a project heading; a single project is
      already one project, so the list stays flat and the in-modal project
      filter is hidden. */
  groupByProject: boolean;
  /** Shown under the list title: "All Projects" or the one project in scope. */
  scopeLabel: string;
  /** Opens straight to this milestone's detail; undefined opens the list. */
  initialMilestoneId?: string;
  /** For resolving `departmentId` to a name in the detail view — omitted
      entirely when it doesn't resolve, never shown as a placeholder. */
  departments: Department[];
}

/** The 4 statuses the schema actually allows across both plan-item tables,
    which the header counters bucket into. Anything else (a legacy value, or
    monthly's extra 'pending') falls into Not Started rather than being
    invented a bucket of its own. */
type StatusBucket = "not_started" | "in_progress" | "delayed" | "completed";

function bucketOf(status: string): StatusBucket {
  if (status === "completed" || status === "done") return "completed";
  if (status === "delayed" || status === "at_risk") return "delayed";
  if (status === "in_progress") return "in_progress";
  return "not_started";
}

const STATUS_FILTERS: { value: StatusBucket; label: string }[] = [
  { value: "not_started", label: "Not Started" },
  { value: "in_progress", label: "In Progress" },
  { value: "delayed", label: "Delayed" },
  { value: "completed", label: "Completed" },
];

export function MilestoneModal({
  open,
  onOpenChange,
  milestones,
  groupByProject,
  scopeLabel,
  initialMilestoneId,
  departments,
}: MilestoneModalProps) {
  const [selectedId, setSelectedId] = React.useState<string | undefined>(initialMilestoneId);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<StatusBucket | "all">("all");
  const [projectFilter, setProjectFilter] = React.useState<string>("all");

  /*
   * Each time the modal opens, it starts from what the caller asked for —
   * the list for "View All", one milestone for a row click, search/filters
   * cleared — never wherever it was left last time. Adjusted during render
   * (React's documented pattern for resetting state on a prop change) rather
   * than in an effect, so there is no frame where the modal shows stale
   * selection or filtering.
   */
  const [openedFrom, setOpenedFrom] = React.useState({ open, initialMilestoneId });
  if (open !== openedFrom.open || initialMilestoneId !== openedFrom.initialMilestoneId) {
    setOpenedFrom({ open, initialMilestoneId });
    if (open) {
      setSelectedId(initialMilestoneId);
      setSearch("");
      setStatusFilter("all");
      setProjectFilter("all");
    }
  }

  const selected = selectedId ? milestones.find((milestone) => milestone.id === selectedId) : undefined;

  /* The counters describe the FULL scope handed in, not the in-modal search/
     filter below — they are the "how much is really here" overview the
     filters then help narrow down from. */
  const counts = React.useMemo(() => {
    const totals: Record<StatusBucket, number> = { not_started: 0, in_progress: 0, delayed: 0, completed: 0 };
    for (const milestone of milestones) totals[bucketOf(milestone.status)] += 1;
    return { total: milestones.length, ...totals };
  }, [milestones]);

  const projectOptions = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const milestone of milestones) {
      if (!seen.has(milestone.projectId)) seen.set(milestone.projectId, milestone.projectName);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [milestones]);

  const visible = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return milestones.filter((milestone) => {
      if (statusFilter !== "all" && bucketOf(milestone.status) !== statusFilter) return false;
      if (groupByProject && projectFilter !== "all" && milestone.projectId !== projectFilter) return false;
      if (query && !milestone.title.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [milestones, search, statusFilter, projectFilter, groupByProject]);

  /* The detail view's sequence number matches what the visitor saw in the
     list: position within its project's date-ordered set (or the whole set,
     ungrouped) — never a number invented independently of the list. */
  const sequence = React.useMemo(() => {
    if (!selected) return 0;
    const siblings = groupByProject
      ? milestones.filter((milestone) => milestone.projectId === selected.projectId)
      : milestones;
    return siblings.findIndex((milestone) => milestone.id === selected.id) + 1;
  }, [selected, milestones, groupByProject]);

  return (
    <DetailModal
      open={open}
      onOpenChange={onOpenChange}
      title={selected ? selected.title : "Milestones"}
      description={selected ? selected.projectName : scopeLabel}
      onBack={selected ? () => setSelectedId(undefined) : undefined}
      backLabel="Back to Milestones"
      toolbar={
        !selected && (
          <MilestoneToolbar
            counts={counts}
            search={search}
            onSearchChange={setSearch}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            projectFilter={projectFilter}
            onProjectFilterChange={setProjectFilter}
            projectOptions={groupByProject ? projectOptions : undefined}
          />
        )
      }
      footer={
        selected && (
          <Button asChild variant="outline" size="sm">
            <Link href={selected.source.href}>Open Source Report</Link>
          </Button>
        )
      }
    >
      {selected ? (
        <MilestoneDetail milestone={selected} sequence={sequence} departments={departments} />
      ) : (
        <MilestoneList
          milestones={visible}
          isFiltered={milestones.length > 0 && visible.length !== milestones.length}
          groupByProject={groupByProject}
          onSelect={setSelectedId}
        />
      )}
    </DetailModal>
  );
}

/* -------------------------------- Toolbar ------------------------------------ */

function MilestoneToolbar({
  counts,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  projectFilter,
  onProjectFilterChange,
  projectOptions,
}: {
  counts: Record<"total" | StatusBucket, number>;
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: StatusBucket | "all";
  onStatusFilterChange: (value: StatusBucket | "all") => void;
  projectFilter: string;
  onProjectFilterChange: (value: string) => void;
  /** Present only in All Projects mode — a single project has nothing to filter by. */
  projectOptions?: { id: string; name: string }[];
}) {
  /* Total always resets to "all"; the four status chips toggle their own
     bucket — clicking the already-active one clears back to "all" too, so a
     counter is never a one-way trap. */
  const toggleBucket = (bucket: StatusBucket) =>
    onStatusFilterChange(statusFilter === bucket ? "all" : bucket);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <CountChip
          label="Total"
          value={counts.total}
          tone="neutral"
          active={statusFilter === "all"}
          onClick={() => onStatusFilterChange("all")}
        />
        <CountChip
          label="Delayed"
          value={counts.delayed}
          tone="danger"
          active={statusFilter === "delayed"}
          onClick={() => toggleBucket("delayed")}
        />
        <CountChip
          label="In Progress"
          value={counts.in_progress}
          tone="warning"
          active={statusFilter === "in_progress"}
          onClick={() => toggleBucket("in_progress")}
        />
        <CountChip
          label="Not Started"
          value={counts.not_started}
          tone="neutral"
          active={statusFilter === "not_started"}
          onClick={() => toggleBucket("not_started")}
        />
        <CountChip
          label="Completed"
          value={counts.completed}
          tone="success"
          active={statusFilter === "completed"}
          onClick={() => toggleBucket("completed")}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[160px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search milestones…"
            className="h-8 pl-7"
            aria-label="Search milestones"
          />
        </div>
        {projectOptions && projectOptions.length > 1 && (
          <Select value={projectFilter} onValueChange={onProjectFilterChange}>
            <SelectTrigger size="sm" className="w-[180px]" aria-label="Filter by project">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {projectOptions.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={statusFilter} onValueChange={(value) => onStatusFilterChange(value as StatusBucket | "all")}>
          <SelectTrigger size="sm" className="w-[150px]" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_FILTERS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function CountChip({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone: StatusTone;
  /** This chip's bucket is the modal's current status filter. */
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none",
        active ? CHIP_TONE_ACTIVE[tone] : cn(CHIP_TONE[tone], "hover:brightness-95")
      )}
    >
      <span className="font-semibold text-foreground">{value}</span>
      <span className={active ? "font-medium text-foreground" : "text-muted-foreground"}>{label}</span>
    </button>
  );
}

const CHIP_TONE: Record<StatusTone, string> = {
  success: "border-success/25 bg-success/10",
  warning: "border-warning/25 bg-warning/10",
  danger: "border-destructive/25 bg-destructive/10",
  info: "border-info/25 bg-info/10",
  neutral: "border-border bg-muted/40",
};

/** Stronger border/tint/ring than the resting state above — the active
    bucket must read as clearly selected, not just differently shaded. */
const CHIP_TONE_ACTIVE: Record<StatusTone, string> = {
  success: "border-success bg-success/20 ring-1 ring-success/50",
  warning: "border-warning bg-warning/20 ring-1 ring-warning/50",
  danger: "border-destructive bg-destructive/20 ring-1 ring-destructive/50",
  info: "border-info bg-info/20 ring-1 ring-info/50",
  neutral: "border-foreground/50 bg-muted ring-1 ring-foreground/20",
};

/* ---------------------------------- List ------------------------------------ */

function MilestoneList({
  milestones,
  isFiltered,
  groupByProject,
  onSelect,
}: {
  milestones: DashboardMilestone[];
  /** True when search/status/project narrowed a non-empty set down to zero —
      distinct from there being no milestone in scope at all. */
  isFiltered: boolean;
  groupByProject: boolean;
  onSelect: (id: string) => void;
}) {
  if (milestones.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {isFiltered
          ? "No milestones match the current filters."
          : "No dated milestone is recorded ahead of today for this scope."}
      </p>
    );
  }

  if (!groupByProject) {
    return <MilestoneTimeline milestones={milestones} onSelect={onSelect} />;
  }

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-5 lg:grid-cols-2">
      {groupMilestonesByProject(milestones).map((group) => (
        <div key={group.projectId}>
          <h3 className="mb-2 truncate text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {group.projectName} · {group.items.length} {group.items.length === 1 ? "Milestone" : "Milestones"}
          </h3>
          <MilestoneTimeline milestones={group.items} onSelect={onSelect} />
        </div>
      ))}
    </div>
  );
}

function groupMilestonesByProject(
  milestones: DashboardMilestone[]
): { projectId: string; projectName: string; items: DashboardMilestone[] }[] {
  const groups = new Map<string, { projectId: string; projectName: string; items: DashboardMilestone[] }>();
  for (const milestone of milestones) {
    const group = groups.get(milestone.projectId);
    if (group) group.items.push(milestone);
    else
      groups.set(milestone.projectId, {
        projectId: milestone.projectId,
        projectName: milestone.projectName,
        items: [milestone],
      });
  }
  return [...groups.values()];
}

/** A numbered vertical rail, one project's (or the whole scope's) milestones
    in date order — the order they already arrive in. The number is a UI-only
    position marker; status is carried separately by the icon + badge. */
function MilestoneTimeline({
  milestones,
  onSelect,
}: {
  milestones: DashboardMilestone[];
  onSelect: (id: string) => void;
}) {
  return (
    <ol className="flex flex-col">
      {milestones.map((milestone, index) => {
        const stage = milestoneStageOf(milestone.status);
        const tone = badgeTone(stage.tone);
        const StatusIcon = STATUS_ICON[stage.tone];
        const isLast = index === milestones.length - 1;
        return (
          <li key={milestone.id} className="relative flex gap-3 pb-3 last:pb-0">
            {!isLast && <span className="absolute top-7 bottom-0 left-3.5 w-px bg-border" aria-hidden />}
            <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-border bg-card text-[11px] font-bold text-muted-foreground">
              {String(index + 1).padStart(2, "0")}
            </span>
            <button
              type="button"
              onClick={() => onSelect(milestone.id)}
              className="group min-w-0 flex-1 cursor-pointer rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <StatusIcon className={cn("size-3.5 shrink-0", ICON_TONE[tone])} aria-hidden />
                  <span className="truncate text-sm font-semibold text-foreground">{milestone.title}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <StatusBadge tone={tone}>{stage.label}</StatusBadge>
                  <ChevronRight
                    className="size-4 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground"
                    aria-hidden
                  />
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="size-3" aria-hidden />
                  {formatDate(milestone.dueDate)}
                </span>
                <span className="capitalize">{milestone.source.kind} report</span>
                {milestone.percentComplete !== undefined && <span>{Math.round(milestone.percentComplete)}% complete</span>}
              </div>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/* --------------------------------- Detail ------------------------------------ */

function MilestoneDetail({
  milestone,
  sequence,
  departments,
}: {
  milestone: DashboardMilestone;
  sequence: number;
  departments: Department[];
}) {
  const stage = milestoneStageOf(milestone.status);
  const tone = badgeTone(stage.tone);
  const departmentName = milestone.departmentId
    ? departments.find((department) => department.id === milestone.departmentId)?.name
    : undefined;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 pt-1">
      <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-border text-xs font-bold text-muted-foreground">
          {String(sequence).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-foreground">{milestone.title}</h3>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{milestone.projectName}</p>
        </div>
        <StatusBadge tone={tone} className="mt-0.5 shrink-0">
          {stage.label}
        </StatusBadge>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DetailCard icon={CalendarDays} label="Due date" value={formatDate(milestone.dueDate)} />
        <DetailCard
          icon={FileText}
          label="Source"
          value={milestone.source.kind === "weekly" ? "Weekly Report" : "Monthly Report"}
        />
        {/* Populated only where the source plan item actually records a
            completion percentage — never invented for a row that has none. */}
        {milestone.percentComplete !== undefined && (
          <DetailCard icon={Gauge} label="Progress" value={`${Math.round(milestone.percentComplete)}%`} />
        )}
        {departmentName && <DetailCard icon={Building2} label="Department" value={departmentName} />}
      </dl>
    </div>
  );
}

function DetailCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="truncate text-sm font-medium text-foreground">{value}</dd>
      </div>
    </div>
  );
}

/* --------------------------------- Helpers ------------------------------------ */

const STATUS_ICON: Record<Tone, LucideIcon> = {
  success: CheckCircle2,
  warning: Clock,
  danger: AlertTriangle,
  behind: AlertTriangle,
  default: Circle,
};

const ICON_TONE: Record<StatusTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-info",
  neutral: "text-muted-foreground",
};

function badgeTone(tone: Tone): StatusTone {
  if (tone === "default") return "neutral";
  if (tone === "behind") return "warning";
  return tone;
}

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

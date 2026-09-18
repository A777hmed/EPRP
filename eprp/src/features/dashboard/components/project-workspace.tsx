"use client";

/**
 * Project Workspace — Top-Level 5A1 correction, §C/§D.
 *
 * A wide right-side `DetailDrawer` with a FIXED internal navigation rail —
 * Overview / Performance / Planning / Milestones / Reports / Management —
 * so exploring a flagged project happens IN ONE PLACE. The rail stays
 * pinned to the top of the workspace as its content pane scrolls (`sticky`
 * against the drawer's own scroll container, not the viewport — the
 * correct anchor for a panel that can open at any scroll position).
 * Switching tabs never closes and reopens the drawer; opening a milestone
 * from the Milestones tab shows its detail INSIDE this same workspace (a
 * local list/detail stack with its own Back control), never a second
 * stacked overlay.
 *
 * Only tabs with real content for the selected project are shown — a
 * project with no governed milestones has no Milestones tab, one with no
 * Weekly/Monthly report has no Reports tab, and Management appears only
 * when the project is actually flagged (the same predicate
 * `ManagementAttention` already uses). Nothing here fetches or recomputes:
 * every figure comes from the same `ProjectPosition`/`DashboardMilestone[]`/
 * `WeeklyReport[]`/`MonthlyReport[]` the rest of the Dashboard already has
 * in scope.
 */

import * as React from "react";
import Link from "next/link";
import { CalendarClock, ClipboardList, MapPinned } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DetailDrawer,
  DrawerContextRow,
  DrawerEmptyNote,
  DrawerFact,
  DrawerFactGrid,
  DrawerSection,
  DrawerSummary,
  StatusBadge,
} from "@/components/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MilestoneDetail, MilestoneTimeline } from "../milestone-modal";
import { BASIS_LABEL, HEALTH_META, type DashboardMilestone, type ProjectPosition } from "../dashboard-data";
import { healthDrawerTone, healthStatusBadgeTone, pct, signedPct } from "./dashboard-format";
import { activityProgressRows, coverageBreakdown } from "./planning-activity";
import {
  MANAGEMENT_GROUP_LABEL,
  MANAGEMENT_GROUP_ORDER,
  groupManagementItems,
  type NormalizedManagementItem,
} from "./management-items";
import { usePlanningSnapshotActivities } from "../use-planning-snapshot-activities";
import { useManagementItems } from "../use-management-items";
import type { Contact, Department, MonthlyReport, Project, ProjectPhase, WeeklyReport } from "@/types";

export type WorkspaceTab = "overview" | "performance" | "planning" | "milestones" | "reports" | "management";

const TAB_LABEL: Record<WorkspaceTab, string> = {
  overview: "Overview",
  performance: "Performance",
  planning: "Planning",
  milestones: "Milestones",
  reports: "Reports",
  management: "Management",
};

export interface ProjectWorkspaceSelection {
  projectId: string;
  /** Opening tab — e.g. Management Attention opens straight to "management". */
  tab?: WorkspaceTab;
}

function basisLabelOf(position: ProjectPosition): string {
  return position.basis === "none" ? "Not Reported" : BASIS_LABEL[position.basis];
}

function PerformanceContextRow({ position }: { position: ProjectPosition }) {
  return (
    <DrawerContextRow
      items={[
        { label: "Planned", value: pct(position.planned) },
        { label: "Actual", value: pct(position.actual) },
        { label: "Variance", value: signedPct(position.variance) },
        {
          label: "SPI",
          value: position.basis !== "planning" ? "—" : position.spi == null ? "N/A" : position.spi.toFixed(2),
        },
      ]}
    />
  );
}

/* --------------------------------- Overview -------------------------------- */

function OverviewTab({
  position,
  phaseName,
  delayedMilestones,
  onOpenMilestones,
}: {
  position: ProjectPosition;
  phaseName?: string;
  delayedMilestones: DashboardMilestone[];
  onOpenMilestones: () => void;
}) {
  const project = position.project;
  return (
    <div className="flex flex-col gap-5">
      <DrawerSummary
        label="Dashboard Schedule Health"
        value={HEALTH_META[position.health].label}
        tone={healthDrawerTone(position.health)}
        context={<PerformanceContextRow position={position} />}
      />
      <DrawerEmptyNote>
        {position.basis === "none"
          ? "This project has no Weekly or Monthly report and no usable Planning Snapshot, so no schedule health can be derived — it is not counted as on track or as a failure."
          : "Schedule health is derived from the current variance band for this Dashboard position — no additional cause is recorded."}
      </DrawerEmptyNote>

      <DrawerSection title="Project">
        <DrawerFactGrid>
          <DrawerFact label="Project" value={project.name} />
          <DrawerFact label="Code" value={project.code} />
          {phaseName && <DrawerFact label="Current Phase" value={phaseName} icon={MapPinned} />}
          {project.forecastFinishDate && (
            <DrawerFact label="Forecast Finish" value={project.forecastFinishDate} icon={CalendarClock} />
          )}
          <DrawerFact label="Reporting Basis" value={basisLabelOf(position)} />
          <DrawerFact label="Data Date" value={position.dataDate ?? position.reportedOn ?? "—"} />
        </DrawerFactGrid>
      </DrawerSection>

      {delayedMilestones.length > 0 && (
        <DrawerSection
          title="Milestones & Schedule Risks"
          hint={
            <button type="button" className="cursor-pointer text-primary hover:underline" onClick={onOpenMilestones}>
              View all →
            </button>
          }
        >
          <ul className="flex flex-col divide-y divide-border">
            {delayedMilestones.slice(0, 2).map((milestone) => (
              <li key={milestone.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <span className="min-w-0 truncate text-sm text-foreground">{milestone.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{milestone.dueDate}</span>
              </li>
            ))}
          </ul>
        </DrawerSection>
      )}
    </div>
  );
}

/* -------------------------------- Performance ------------------------------- */

function PerformanceTab({ position }: { position: ProjectPosition }) {
  return (
    <div className="flex flex-col gap-5">
      <DrawerSection title="Performance">
        <DrawerFactGrid>
          <DrawerFact label="Planned" value={pct(position.planned)} />
          <DrawerFact label="Actual" value={pct(position.actual)} />
          <DrawerFact label="Variance" value={signedPct(position.variance)} />
          <DrawerFact
            label="SPI"
            value={position.basis !== "planning" ? "N/A" : position.spi == null ? "N/A" : position.spi.toFixed(2)}
          />
        </DrawerFactGrid>
      </DrawerSection>
      {position.basis !== "planning" && (
        <DrawerEmptyNote>
          SPI is only available for a Planning-backed position. This project&rsquo;s current position comes from its{" "}
          {position.basis === "none" ? "existing Weekly/Monthly reporting" : `latest ${BASIS_LABEL[position.basis]}`}.
        </DrawerEmptyNote>
      )}
    </div>
  );
}

/* --------------------------------- Planning --------------------------------- */

/**
 * Activity Progress + Coverage Detail (Dashboard Data Depth, items 1/2).
 * Both sections read the SAME `planning_snapshot_activities` rows behind
 * this position's `coveragePercent` — one fetch, two views of it: which
 * activities are behind plan, and how much of the schedule that percentage
 * actually speaks for.
 */
function PlanningTab({ position }: { position: ProjectPosition }) {
  const activities = usePlanningSnapshotActivities(position.snapshotId);
  const rows = React.useMemo(() => (activities ? activityProgressRows(activities) : undefined), [activities]);
  const coverage = React.useMemo(() => (activities ? coverageBreakdown(activities) : undefined), [activities]);

  return (
    <div className="flex flex-col gap-5">
      <DrawerSection title="Planning Basis">
        <DrawerFactGrid>
          <DrawerFact label="Source" value="Planning Snapshot" />
          <DrawerFact label="Snapshot" value={position.snapshotVersion !== undefined ? `v${position.snapshotVersion}` : "—"} />
          <DrawerFact label="Data Date" value={position.dataDate ?? "—"} />
          <DrawerFact
            label="Coverage"
            value={typeof position.coveragePercent === "number" ? `${Math.round(position.coveragePercent)}%` : "—"}
          />
        </DrawerFactGrid>
      </DrawerSection>

      <DrawerSection
        title="Activity Progress"
        hint={rows ? `${rows.length} ${rows.length === 1 ? "activity" : "activities"} · behind plan first` : undefined}
      >
        {rows === undefined ? (
          <DrawerEmptyNote>Loading activity progress…</DrawerEmptyNote>
        ) : rows.length === 0 ? (
          <DrawerEmptyNote>This snapshot has no activity rows recorded.</DrawerEmptyNote>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Activity</TableHead>
                  <TableHead>Planned</TableHead>
                  <TableHead>Physical</TableHead>
                  <TableHead>Variance</TableHead>
                  <TableHead>Weight</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ activity, variance }) => (
                  <TableRow key={activity.id}>
                    <TableCell className="font-medium">
                      {activity.name}
                      {activity.code && <span className="ml-1.5 text-xs text-muted-foreground">{activity.code}</span>}
                    </TableCell>
                    <TableCell>{pct(activity.percentCompletePlanned)}</TableCell>
                    <TableCell>{pct(activity.percentCompletePhysical)}</TableCell>
                    <TableCell className={variance === null ? "text-muted-foreground" : undefined}>
                      {variance === null ? "—" : signedPct(variance)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {typeof activity.weightPercent === "number" ? `${Math.round(activity.weightPercent)}%` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DrawerSection>

      <DrawerSection title="Coverage">
        {coverage === undefined ? (
          <DrawerEmptyNote>Loading coverage detail…</DrawerEmptyNote>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-2xl font-semibold tracking-tight text-foreground">
                {typeof position.coveragePercent === "number" ? `${Math.round(position.coveragePercent)}%` : "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Share of the snapshot&rsquo;s weighted schedule for which both Planned and Physical progress are
                reported. Missing progress data is not counted as zero — it is simply not yet reported.
              </p>
            </div>
            <DrawerFactGrid>
              <DrawerFact
                label="Included"
                value={`${coverage.includedCount} ${coverage.includedCount === 1 ? "activity" : "activities"} · ${Math.round(coverage.includedWeight)}% weight`}
              />
              <DrawerFact
                label="Missing progress data"
                value={
                  coverage.missingCount === 0
                    ? "None"
                    : `${coverage.missingCount} ${coverage.missingCount === 1 ? "activity" : "activities"} · ${Math.round(coverage.missingWeight)}% weight`
                }
              />
              {coverage.unweightedCount > 0 && (
                <DrawerFact
                  label="No weight recorded"
                  value={`${coverage.unweightedCount} ${coverage.unweightedCount === 1 ? "activity" : "activities"} — excluded`}
                />
              )}
            </DrawerFactGrid>
          </div>
        )}
      </DrawerSection>
    </div>
  );
}

/* -------------------------------- Milestones -------------------------------- */

function MilestonesTab({
  milestones,
  departments,
  selectedMilestoneId,
  onSelectMilestone,
}: {
  milestones: DashboardMilestone[];
  departments: Department[];
  selectedMilestoneId: string | null;
  onSelectMilestone: (id: string | null) => void;
}) {
  const selected = selectedMilestoneId ? milestones.find((m) => m.id === selectedMilestoneId) : undefined;
  if (selected) {
    const sequence = milestones.findIndex((m) => m.id === selected.id) + 1;
    return <MilestoneDetail milestone={selected} sequence={sequence} departments={departments} />;
  }
  return <MilestoneTimeline milestones={milestones} onSelect={(id) => onSelectMilestone(id)} />;
}

/* ---------------------------------- Reports ---------------------------------- */

function ReportsTab({
  position,
  weeklies,
  monthlies,
}: {
  position: ProjectPosition;
  weeklies: WeeklyReport[];
  monthlies: MonthlyReport[];
}) {
  const latestWeekly = [...weeklies].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
  const latestMonthly = [...monthlies].sort((a, b) => (b.reportingMonth ?? "").localeCompare(a.reportingMonth ?? ""))[0];

  return (
    <div className="flex flex-col gap-5">
      <DrawerSection title="Current Reporting Basis">
        <DrawerFactGrid>
          <DrawerFact label="Basis" value={basisLabelOf(position)} />
          <DrawerFact label="Data Date" value={position.dataDate ?? position.reportedOn ?? "—"} />
          <DrawerFact
            label="Latest Weekly"
            value={latestWeekly ? `${latestWeekly.reportNumber} · ${latestWeekly.periodEnd}` : "None filed"}
          />
          <DrawerFact
            label="Latest Monthly"
            value={latestMonthly ? `${latestMonthly.reportNumber} · ${latestMonthly.reportingMonth}` : "None filed"}
          />
        </DrawerFactGrid>
      </DrawerSection>

      {weeklies.length > 0 && (
        <DrawerSection title="Weekly" hint={`${weeklies.length} report${weeklies.length === 1 ? "" : "s"}`}>
          <ul className="flex flex-col divide-y divide-border">
            {weeklies.slice(0, 5).map((report) => (
              <li key={report.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <Link href={`/weekly-reports/${report.id}`} className="min-w-0 truncate text-sm text-primary hover:underline">
                  {report.reportNumber}
                </Link>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <span>{report.periodEnd}</span>
                  <span className="capitalize">{report.status}</span>
                </span>
              </li>
            ))}
          </ul>
        </DrawerSection>
      )}
      {monthlies.length > 0 && (
        <DrawerSection title="Monthly" hint={`${monthlies.length} report${monthlies.length === 1 ? "" : "s"}`}>
          <ul className="flex flex-col divide-y divide-border">
            {monthlies.slice(0, 5).map((report) => (
              <li key={report.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <Link href={`/monthly-reports/${report.id}`} className="min-w-0 truncate text-sm text-primary hover:underline">
                  {report.reportNumber}
                </Link>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <span>{report.reportingMonth}</span>
                  <span className="capitalize">{report.status}</span>
                </span>
              </li>
            ))}
          </ul>
        </DrawerSection>
      )}
    </div>
  );
}

/* -------------------------------- Management --------------------------------- */

const PRIORITY_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  low: "neutral",
  medium: "info",
  high: "warning",
  critical: "danger",
};

function ManagementItemRow({ item, ownerName }: { item: NormalizedManagementItem; ownerName?: string }) {
  return (
    <li className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm text-foreground">{item.text}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          {item.isClient && <StatusBadge tone="info">Client</StatusBadge>}
          <StatusBadge tone={PRIORITY_TONE[item.priority] ?? "neutral"}>{item.priority}</StatusBadge>
        </div>
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span className="capitalize">{item.status.replace(/_/g, " ")}</span>
        {ownerName && <span>Owner: {ownerName}</span>}
        {item.dueDate && <span>Due {item.dueDate}</span>}
      </p>
    </li>
  );
}

/**
 * Management Attention narrative (Dashboard Data Depth, item 3) — the
 * project's LATEST governed reporting basis that actually carries risk/
 * issue/decision/action narrative (`useManagementItems`'s own Weekly-then-
 * Monthly precedence). The Dashboard-Schedule-Health explanation above it
 * is unrelated and unchanged: that states WHY the KPI flagged this project;
 * this states WHAT, if anything, has actually been recorded about it.
 */
function ManagementTab({
  position,
  weeklies,
  monthlies,
  contacts,
}: {
  position: ProjectPosition;
  weeklies: WeeklyReport[];
  monthlies: MonthlyReport[];
  contacts: Contact[];
}) {
  const meta = HEALTH_META[position.health];
  const source = useManagementItems(weeklies, monthlies);
  const ownerName = (contactId?: string) => (contactId ? contacts.find((c) => c.id === contactId)?.name : undefined);

  return (
    <div className="flex flex-col gap-5">
      <DrawerSummary
        label="Why this project is flagged"
        value={meta.label}
        tone={healthDrawerTone(position.health)}
        context={<PerformanceContextRow position={position} />}
      />
      <DrawerEmptyNote>
        This project appears in Management Attention because its Dashboard Schedule Health is {meta.label.toLowerCase()}
        {typeof position.variance === "number" ? ` (schedule variance ${signedPct(position.variance)})` : ""} — derived
        from the current variance band, not from a recorded risk or issue.
      </DrawerEmptyNote>

      <DrawerSection
        title="Management Attention"
        hint={source.status === "ready" ? `${source.sourceLabel} · ${source.sourcePeriod}` : undefined}
      >
        {source.status === "loading" && <DrawerEmptyNote>Loading management-attention items…</DrawerEmptyNote>}
        {source.status === "none" && (
          <DrawerEmptyNote>No management-attention items are recorded for the current reporting basis.</DrawerEmptyNote>
        )}
        {source.status === "ready" && (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">
              Source:{" "}
              <Link href={source.sourceHref} className="text-primary hover:underline">
                {source.sourceLabel}
              </Link>{" "}
              · {source.sourcePeriod}
            </p>
            {(() => {
              const grouped = groupManagementItems(source.items);
              return MANAGEMENT_GROUP_ORDER.map((group) => {
                const items = grouped[group];
                if (!items || items.length === 0) return null;
                return (
                  <div key={group}>
                    <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                      {MANAGEMENT_GROUP_LABEL[group]}
                    </h4>
                    <ul className="flex flex-col divide-y divide-border">
                      {items.map((item) => (
                        <ManagementItemRow key={item.id} item={item} ownerName={ownerName(item.ownerContactId)} />
                      ))}
                    </ul>
                  </div>
                );
              });
            })()}
          </div>
        )}
      </DrawerSection>
    </div>
  );
}

/* ---------------------------------- Shell ------------------------------------ */

export function ProjectWorkspace({
  selection,
  onOpenChange,
  positions,
  milestones,
  projectPhases,
  weeklies,
  monthlies,
  departments,
  contacts,
}: {
  selection: ProjectWorkspaceSelection | null;
  onOpenChange: (open: boolean) => void;
  positions: ProjectPosition[];
  milestones: DashboardMilestone[];
  projectPhases: ProjectPhase[];
  weeklies: WeeklyReport[];
  monthlies: MonthlyReport[];
  departments: Department[];
  contacts: Contact[];
}) {
  /* Content (and the active tab) stays mounted through the close animation —
     clearing it the instant `selection` goes to `null` would blank the
     workspace while it is still visibly sliding out. */
  const [rendered, setRendered] = React.useState(selection);
  const [tab, setTab] = React.useState<WorkspaceTab>(selection?.tab ?? "overview");
  const [selectedMilestoneId, setSelectedMilestoneId] = React.useState<string | null>(null);

  if (selection !== null && selection !== rendered) {
    setRendered(selection);
    setTab(selection.tab ?? "overview");
    setSelectedMilestoneId(null);
  }

  const position = rendered ? positions.find((p) => p.project.id === rendered.projectId) : undefined;
  const open = Boolean(selection && position);

  const projectMilestones = React.useMemo(
    () => (position ? milestones.filter((m) => m.projectId === position.project.id) : []),
    [milestones, position]
  );
  const delayedMilestones = React.useMemo(
    () => projectMilestones.filter((m) => m.status === "delayed" || m.status === "at_risk"),
    [projectMilestones]
  );
  const projectWeeklies = React.useMemo(
    () => (position ? weeklies.filter((w) => w.projectId === position.project.id) : []),
    [weeklies, position]
  );
  const projectMonthlies = React.useMemo(
    () => (position ? monthlies.filter((m) => m.projectId === position.project.id) : []),
    [monthlies, position]
  );
  const phaseName = React.useMemo(() => {
    if (!position?.project.currentPhaseId) return undefined;
    return projectPhases.find((phase) => phase.id === position.project.currentPhaseId)?.name;
  }, [position, projectPhases]);

  const availableTabs = React.useMemo<WorkspaceTab[]>(() => {
    if (!position) return ["overview"];
    const tabs: WorkspaceTab[] = ["overview"];
    if (position.planned !== undefined) tabs.push("performance");
    if (position.basis === "planning") tabs.push("planning");
    if (projectMilestones.length > 0) tabs.push("milestones");
    if (projectWeeklies.length > 0 || projectMonthlies.length > 0) tabs.push("reports");
    if (position.health !== "on_track") tabs.push("management");
    return tabs;
  }, [position, projectMilestones, projectWeeklies, projectMonthlies]);

  const activeTab: WorkspaceTab = availableTabs.includes(tab) ? tab : "overview";

  if (!rendered || !position) {
    return <DetailDrawer open={false} onOpenChange={onOpenChange} title="">{null}</DetailDrawer>;
  }

  const project: Project = position.project;

  /* Nested milestone detail (§C2): nothing stacks another overlay — the
     drawer's own back control returns to the Milestones list inside this
     same workspace. Absent everywhere else, since only the Milestones tab
     has a list/detail split. */
  const inMilestoneDetail = activeTab === "milestones" && selectedMilestoneId !== null;

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={project.name}
      description={`${project.code} · Project Workspace`}
      badge={<StatusBadge tone={healthStatusBadgeTone(position.health)}>{HEALTH_META[position.health].label}</StatusBadge>}
      onBack={inMilestoneDetail ? () => setSelectedMilestoneId(null) : undefined}
      backLabel={inMilestoneDetail ? "Back to Milestones" : undefined}
      footer={
        <>
          <Button asChild variant="outline" size="sm">
            <Link href={`/projects/${project.id}`}>Open full page</Link>
          </Button>
          {projectMilestones.length > 0 && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/projects/${project.id}/milestones`}>
                <ClipboardList aria-hidden />
                View Master Milestones
              </Link>
            </Button>
          )}
          {position.basis === "planning" && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/projects/${project.id}/planning`}>Open Planning Workspace</Link>
            </Button>
          )}
        </>
      }
    >
      <div className="flex min-h-full flex-col gap-4 sm:flex-row sm:gap-5">
        <nav
          aria-label="Project workspace sections"
          className="flex gap-1 overflow-x-auto sm:sticky sm:top-0 sm:w-36 sm:shrink-0 sm:flex-col sm:self-start sm:overflow-visible sm:border-r sm:pr-3"
        >
          {availableTabs.map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => {
                setTab(entry);
                setSelectedMilestoneId(null);
              }}
              aria-current={entry === activeTab}
              className={cn(
                "shrink-0 cursor-pointer rounded-md px-3 py-2 text-left text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 sm:whitespace-normal",
                entry === activeTab
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              )}
            >
              {TAB_LABEL[entry]}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {activeTab === "overview" && (
            <OverviewTab
              position={position}
              phaseName={phaseName}
              delayedMilestones={delayedMilestones}
              onOpenMilestones={() => setTab("milestones")}
            />
          )}
          {activeTab === "performance" && <PerformanceTab position={position} />}
          {activeTab === "planning" && <PlanningTab position={position} />}
          {activeTab === "milestones" && (
            <MilestonesTab
              milestones={projectMilestones}
              departments={departments}
              selectedMilestoneId={selectedMilestoneId}
              onSelectMilestone={setSelectedMilestoneId}
            />
          )}
          {activeTab === "reports" && (
            <ReportsTab position={position} weeklies={projectWeeklies} monthlies={projectMonthlies} />
          )}
          {activeTab === "management" && (
            <ManagementTab position={position} weeklies={projectWeeklies} monthlies={projectMonthlies} contacts={contacts} />
          )}
        </div>
      </div>
    </DetailDrawer>
  );
}

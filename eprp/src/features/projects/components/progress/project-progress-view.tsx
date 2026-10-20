"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  Flag,
  Gauge,
  LineChart,
  ListTree,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, StatusBadge } from "@/components/shared";
import { projectSectionHref } from "@/config/project-sections";
import { formatDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type { PlanningSnapshot, Project } from "@/types";
import { isPlanningControlReadOnly } from "../../planning-control-archived";
import {
  planningGovernanceOf,
  planningViewHref,
  snapshotFigures,
  type SnapshotFigures,
} from "../../planning-experience";
import {
  usePlanningPosition,
  type PlanningPositionState,
} from "../../use-planning-position";
import { ArchivedPlanningNotice } from "../planning/archived-planning-notice";
import { PlanningFact } from "../planning/planning-status";
import { ReportedProgressPanel } from "./reported-progress-panel";

function activityCountOf(snapshot: PlanningSnapshot): number | undefined {
  const data = snapshot.snapshotData;
  if (data && typeof data === "object" && "activities" in data) {
    const activities = (data as { activities?: unknown }).activities;
    if (Array.isArray(activities)) return activities.length;
  }
  return undefined;
}

/** A titled analytical panel — restrained: one border, no nested cards. */
function Panel({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon: typeof Gauge;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border bg-card shadow-soft", className)}>
      <header className="flex items-start gap-2 border-b px-4 py-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{description}</p>
          )}
        </div>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** The truthful "the engine has not produced this yet" body. */
function PendingEngine({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground text-pretty">
      {children}
    </div>
  );
}

/** Shown wherever a snapshot pre-dates the governed engine model. */
const LEGACY_SNAPSHOT_HINT = "Published before the governed Planning Engine calculation model.";

/** Subtle, consistent per-row marker for a figure the engine has not produced. */
function PendingEngineMarker() {
  return (
    <span className="rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground">
      Pending engine
    </span>
  );
}

const WBS_COLUMNS = [
  "Node",
  "Local weight",
  "Effective weight",
  "PV",
  "EV",
  "SPI",
  "Variance",
  "Contribution",
];

function KpiBand({ figures, isOpening }: { figures: SnapshotFigures; isOpening: boolean }) {
  const cells = [
    { label: "Planned value (PV)", value: figures.planned, help: "Planned progress at the Data Date" },
    { label: "Earned value (EV)", value: figures.earned, help: isOpening ? "Declared actual progress" : "Earned progress at the Data Date" },
    { label: "Schedule variance", value: figures.variance, help: "Earned less planned" },
    {
      label: "SPI",
      value: figures.spi,
      help: isOpening ? "Not applicable to a declared Opening Position" : "Earned value ÷ planned value",
    },
  ];
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-xl border bg-card shadow-soft lg:grid-cols-4">
      {cells.map((cell, index) => (
        <div
          key={cell.label}
          className={cn(
            "px-4 py-3.5",
            index % 2 === 1 && "border-l",
            index >= 2 && "border-t lg:border-t-0",
            index === 2 && "lg:border-l"
          )}
        >
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {cell.label}
          </dt>
          <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{cell.value}</dd>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{cell.help}</p>
        </div>
      ))}
    </dl>
  );
}

/**
 * Phase 13.9A — Project Progress as a read-only analytical workspace
 * (`docs/02` §26.23.8, `docs/07` §10.12).
 *
 * Reads ONLY the project's latest Published Planning Snapshot and the figures
 * it already carries. It never falls back to the project record's typed
 * progress, offers no "Update progress", and never draws a curve or a WBS
 * figure the Planning Engine has not produced: those sections show a truthful
 * pending state until the engine slices fill them.
 */
export function ProjectProgressView({
  project,
  position: supplied,
}: {
  project: Project;
  /** Already loaded by the page (it also drives the header subtitle). */
  position?: PlanningPositionState;
}) {
  const own = usePlanningPosition(supplied ? undefined : project.id);
  const position = supplied ?? own;
  const archived = isPlanningControlReadOnly(project);

  if (position.status === "loading") {
    return <LoadingState variant="page" label="Loading project performance…" />;
  }
  if (position.status === "error") {
    return (
      <EmptyState
        icon={Gauge}
        title="Project performance could not be loaded"
        description="The Published Planning Snapshot could not be read. Try again in a moment."
      />
    );
  }

  const mode = position.settings?.onboardingMode ?? "new_project";
  const governance = planningGovernanceOf(mode, Boolean(position.snapshot));
  const workspaceLink = (
    <Button variant="outline" size="sm" asChild>
      <Link href={projectSectionHref(project.id, "planning")}>
        Open Planning Workspace
        <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
      </Link>
    </Button>
  );

  if (governance === "not-governed") {
    // 13.9B: the canonical Reported Progress stream (Reported — not planning
    // governed, SPI N/A). No PV, EV, curve or WBS performance is shown here.
    return (
      <div className="space-y-4">
        {archived && <ArchivedPlanningNotice />}
        <ReportedProgressPanel
          project={project}
          onboardingMode={mode}
          hasPublishedSnapshot={Boolean(position.snapshot)}
        />
      </div>
    );
  }

  if (governance === "awaiting-snapshot" || !position.snapshot) {
    const existing = mode === "existing_active_project";
    return (
      <div className="space-y-4">
        {archived && <ArchivedPlanningNotice />}
        {/* A project that moved here from "no formal schedule" keeps its
            Reported Progress as read-only history (nothing shown when none). */}
        <ReportedProgressPanel project={project} onboardingMode={mode} hasPublishedSnapshot={false} frozen />
        <EmptyState
          icon={Gauge}
          title="Awaiting first Published Planning Snapshot"
          description={
            existing
              ? "This project is already running. Once its Opening Position is declared and promoted as Snapshot V1, its performance appears here."
              : "Once the plan is built and the first Planning Snapshot is published, the project's performance appears here."
          }
          action={
            <Button variant="outline" asChild>
              <Link href={planningViewHref(project.id, existing ? "baselines" : "summary")}>
                Open Planning Workspace
                <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const snapshot = position.snapshot;
  const rollup = position.rollup;
  const figures = snapshotFigures({
    plannedProgress: rollup?.plannedProgress ?? null,
    actualProgress: rollup?.actualProgress ?? null,
    variance: rollup?.variance ?? null,
    spi: rollup?.spi ?? null,
    isOpeningSnapshot: snapshot.isOpeningSnapshot,
  });
  const activities = activityCountOf(snapshot);

  return (
    <div className="space-y-4">
      {archived && <ArchivedPlanningNotice />}

      {/* A. Performance header */}
      <section className="rounded-xl border bg-card px-4 py-3.5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              {snapshot.isOpeningSnapshot ? (
                <StatusBadge tone="info">Opening Position — declared</StatusBadge>
              ) : (
                <span title={LEGACY_SNAPSHOT_HINT} className="inline-flex">
                  <StatusBadge tone="neutral">Legacy snapshot</StatusBadge>
                </span>
              )}
            </div>
            <h2 className="mt-1.5 text-base font-semibold tracking-tight">
              Performance as of {formatDate(snapshot.dataDate)}
            </h2>
            <p className="text-xs text-muted-foreground">
              From Published Planning Snapshot v{snapshot.version}
              {snapshot.label ? ` — ${snapshot.label}` : ""}, published{" "}
              {formatDate(snapshot.publishedAt)}.
              {!snapshot.isOpeningSnapshot && ` ${LEGACY_SNAPSHOT_HINT}`}
            </p>
          </div>
          {workspaceLink}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 border-t pt-3 sm:flex sm:flex-wrap">
          <PlanningFact label="Data Date" value={formatDate(snapshot.dataDate)} />
          <PlanningFact label="Snapshot" value={`v${snapshot.version}`} />
          <PlanningFact
            label="Schedule condition"
            value={<span className="font-normal text-muted-foreground">Not derived yet</span>}
            hint="Derived by the Planning Engine from SPI, milestone slip and forecast finish"
          />
          {rollup && (
            <PlanningFact
              label="Snapshot coverage"
              value={`${Math.round(rollup.coveragePercent)}%`}
              hint="Share of the snapshot's weight that carries planned and actual figures"
            />
          )}
        </dl>
      </section>

      {/* B. KPI row */}
      <KpiBand figures={figures} isOpening={snapshot.isOpeningSnapshot} />

      {/* C. S-curve */}
      <Panel
        icon={LineChart}
        title="S-curve"
        description="Baseline, forecast and earned progress over time, with the Data Date marked."
      >
        {/* No legend, axes or series until governed time-phased data exists:
            an empty chart frame reads as a chart that failed to load. */}
        <PendingEngine>
          <LineChart className="mx-auto mb-2 size-5 text-muted-foreground/60" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">S-Curve not available yet</p>
          <p className="mx-auto mt-1 max-w-md">
            The Planning Engine will generate Original Baseline, Current
            Baseline, Forecast and Earned curves automatically once governed
            time-phased planning data is available.
          </p>
        </PendingEngine>
      </Panel>

      {/* D. WBS / Control Account performance */}
      <Panel
        icon={ListTree}
        title="WBS / Control Account performance"
        description="Each node's weight, planned and earned value, SPI, variance and contribution. Selecting a node will redraw this page for it."
      >
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[42rem] text-left text-xs">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                {WBS_COLUMNS.map((column) => (
                  <th key={column} scope="col" className="px-3 py-2 font-medium first:sticky first:left-0 first:bg-muted/40">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={WBS_COLUMNS.length} className="px-3 py-6 text-center text-muted-foreground text-pretty">
                  Node-level performance is calculated by the Planning Engine.
                  {activities !== undefined &&
                    ` This snapshot carries ${activities} activit${activities === 1 ? "y" : "ies"}.`}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      {/* E. Exceptions / schedule health */}
      <Panel
        icon={TriangleAlert}
        title="Exceptions & schedule health"
        description="What needs attention at this Data Date."
      >
        <p className="mb-3 text-xs text-muted-foreground text-pretty">
          Schedule exceptions are calculated by the Planning Engine from
          governed schedule data. None is shown until then.
        </p>
        <ul className="divide-y rounded-lg border text-sm">
          {[
            { label: "Late activities", detail: "Activities that should have started or finished by the Data Date." },
            { label: "Overdue activities", detail: "Incomplete work past its forecast finish." },
            { label: "Forecast finish vs BL0 / BLn", detail: "Project finish slip against both baselines." },
          ].map((item) => (
            <li key={item.label} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.detail}</p>
              </div>
              <PendingEngineMarker />
            </li>
          ))}
          <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
            <div className="min-w-0">
              <p className="font-medium">Key milestone exposure</p>
              <p className="text-xs text-muted-foreground">
                Governed milestones live in the one Milestones register.
              </p>
            </div>
            <Link
              href={projectSectionHref(project.id, "milestones")}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              <Flag className="size-3" aria-hidden="true" />
              Milestones register
            </Link>
          </li>
        </ul>
      </Panel>
    </div>
  );
}

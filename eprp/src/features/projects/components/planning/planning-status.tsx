"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { StatusBadge } from "@/components/shared";
import { projectSectionHref } from "@/config/project-sections";
import { formatDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  planningGovernanceOf,
  SCHEDULE_CONDITION_NOT_EVALUATED,
  snapshotCalculationLabel,
  snapshotFigures,
} from "../../planning-experience";
import {
  usePlanningPosition,
  type PlanningPositionState,
} from "../../use-planning-position";

/** One labelled read-only value in a dense row. */
export function PlanningFact({
  label,
  value,
  hint,
  help,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  /** Optional contextual help (`ContextHelp`) shown beside the label. */
  help?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)} title={hint}>
      <dt className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {help}
      </dt>
      <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * Phase 13.9A — the compact, read-only Planning Status (`docs/02` §26.23.4).
 *
 * Replaces the large Governed Performance block in Project Setup, and the
 * typed-progress metrics on the project header. It shows only what the
 * project's latest Published Planning Snapshot already carries — version,
 * Data Date, planned and earned progress, variance and SPI — and never the
 * project record's typed progress. No Opening Position action lives here:
 * that is Planning Workspace → Baselines & Snapshots only.
 */
export function PlanningStatus({
  projectId,
  position: supplied,
  workspaceLink = true,
  className,
}: {
  /** Absent for a project that has not been saved yet. */
  projectId?: string;
  /** Already loaded by the caller — avoids reading the same snapshot twice. */
  position?: PlanningPositionState;
  /**
   * Offer a Planning Workspace link in the no-snapshot state. Off where the
   * host already carries "Open Planning Workspace" as its primary action
   * (Project Setup → Planning Entry), so the status stays a status.
   */
  workspaceLink?: boolean;
  className?: string;
}) {
  const own = usePlanningPosition(supplied ? undefined : projectId);
  const position = supplied ?? own;
  const shell = cn("rounded-lg border bg-muted/20 px-3 py-2.5", className);

  if (!projectId) {
    return (
      <p className={cn(shell, "text-xs text-muted-foreground")}>
        Planning status appears once the project is saved.
      </p>
    );
  }

  if (position.status === "loading") {
    return (
      <p className={cn(shell, "text-xs text-muted-foreground")} aria-busy="true">
        Loading planning status…
      </p>
    );
  }

  if (position.status === "error") {
    return (
      <p className={cn(shell, "text-xs text-muted-foreground")}>
        Planning status could not be loaded. Open the Planning Workspace to try again.
      </p>
    );
  }

  const mode = position.settings?.onboardingMode ?? "new_project";
  const governance = planningGovernanceOf(mode, Boolean(position.snapshot));
  const progressLink = (
    <Link
      href={projectSectionHref(projectId, "kpis")}
      className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
    >
      View Project Progress
      <ArrowUpRight className="size-3" aria-hidden="true" />
    </Link>
  );

  if (governance === "not-governed") {
    return (
      <div className={cn(shell, "flex flex-wrap items-center justify-between gap-2")}>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="neutral">Reported — not planning governed</StatusBadge>
          <span className="text-xs text-muted-foreground">SPI N/A</span>
        </div>
        {progressLink}
      </div>
    );
  }

  if (governance === "awaiting-snapshot" || !position.snapshot) {
    return (
      <div className={cn(shell, "flex flex-wrap items-center justify-between gap-2")}>
        <p className="text-xs text-muted-foreground">Awaiting first Published Planning Snapshot</p>
        {workspaceLink && (
          <Link
            href={projectSectionHref(projectId, "planning")}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            Planning Workspace
            <ArrowUpRight className="size-3" aria-hidden="true" />
          </Link>
        )}
      </div>
    );
  }

  const snapshot = position.snapshot;
  const rollup = position.rollup;
  const calculation = snapshotCalculationLabel(snapshot);
  const figures = snapshotFigures({
    plannedProgress: rollup?.plannedProgress ?? null,
    actualProgress: rollup?.actualProgress ?? null,
    variance: rollup?.variance ?? null,
    spi: rollup?.spi ?? null,
    isOpeningSnapshot: snapshot.isOpeningSnapshot,
  });

  return (
    <div className={cn(shell, "space-y-2")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span title={calculation.hint} className="inline-flex">
            <StatusBadge tone={calculation.tone}>{calculation.badge}</StatusBadge>
          </span>
        </div>
        {progressLink}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 xl:grid-cols-7">
        <PlanningFact label="Snapshot" value={`v${snapshot.version}`} />
        <PlanningFact label="Data Date" value={formatDate(snapshot.dataDate)} />
        <PlanningFact label="Planned" value={figures.planned} hint="Planned progress (PV) carried by the snapshot" />
        <PlanningFact label="Earned" value={figures.earned} hint="Earned progress (EV) carried by the snapshot" />
        <PlanningFact label="Variance" value={figures.variance} hint="Earned less planned, in percentage points" />
        <PlanningFact label="SPI" value={figures.spi} hint="Earned value ÷ planned value" />
        <PlanningFact
          label="Condition"
          value={
            <span className="font-normal text-muted-foreground">
              {snapshot.calculation === "engine" ? SCHEDULE_CONDITION_NOT_EVALUATED : "Not derived yet"}
            </span>
          }
          hint="Schedule Condition is derived by the Planning Engine"
        />
      </dl>
    </div>
  );
}

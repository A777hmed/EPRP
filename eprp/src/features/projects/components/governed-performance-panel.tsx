"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowUpRight, Rocket, Workflow } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, KpiCard, LoadingState, StatusBadge } from "@/components/shared";
import type { StatusTone } from "@/components/shared/status-badge";
import { formatDate } from "@/lib/formatters";
import { formatVariance } from "@/features/projects/utils";
import { projectSectionHref } from "@/config/project-sections";
import { useProjectAuthority } from "@/features/projects/use-project-authority";
import {
  planningRollupService,
  type PlanningSnapshotRollup,
} from "@/services/planning-rollup-service";
import { planningService } from "@/services/planning-service";
import { deriveDashboardPlanningFigures } from "@/features/dashboard/planning-integration";
import { healthOf, HEALTH_META } from "@/features/dashboard/dashboard-data";
import type {
  PlanningOpeningPosition,
  PlanningSnapshot,
  Project,
  ProjectPlanningSettings,
} from "@/types";
import { OpeningPositionDialog } from "./planning/opening-position-dialog";

export interface GovernedPerformancePanelProps {
  /** Absent for a project that has not been created yet — nothing to govern. */
  project?: Project | null;
}

interface ReadyState {
  status: "ready";
  snapshot: PlanningSnapshot | null;
  rollup: PlanningSnapshotRollup | null;
  settings: ProjectPlanningSettings | null;
  draftOpening: PlanningOpeningPosition | null;
  /** The declared source note behind the CURRENT governing snapshot, only
      when that snapshot was promoted from an Opening Position. */
  governingOpeningSource?: string;
}

type LoadState = { status: "loading" } | ReadyState | { status: "error" };

function toStatusTone(
  tone: "success" | "warning" | "danger" | "info" | "default"
): StatusTone {
  return tone === "default" ? "neutral" : tone;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

const PANEL_HEADER = (
  <div className="flex flex-wrap items-center justify-between gap-2">
    <div className="flex items-center gap-1.5 text-sm font-medium">
      <Workflow className="size-4 text-muted-foreground" aria-hidden="true" />
      Governed Performance
    </div>
    <p className="text-xs text-muted-foreground">
      Governed by Master Planning &amp; Control
    </p>
  </div>
);

async function loadGovernedPerformance(projectId: string): Promise<LoadState> {
  try {
    const [snapshot, settings, draftOpening] = await Promise.all([
      planningRollupService.getLatestPublishedSnapshot(projectId),
      planningService.getSettings(projectId),
      planningService.getDraftOpeningPosition(projectId),
    ]);
    const rollup = snapshot
      ? await planningRollupService.computeSnapshotRollup(snapshot.id)
      : null;

    let governingOpeningSource: string | undefined;
    if (snapshot?.isOpeningSnapshot && snapshot.sourceOpeningPositionId) {
      const opening = await planningService.getOpeningPositionById(
        snapshot.sourceOpeningPositionId
      );
      governingOpeningSource = opening?.source;
    }

    return {
      status: "ready",
      snapshot,
      rollup,
      settings,
      draftOpening,
      governingOpeningSource,
    };
  } catch {
    return { status: "error" };
  }
}

/**
 * Read-only performance reading for Project Setup — Planned Progress, Actual
 * Progress, Variance, SPI and schedule health, sourced from the project's
 * latest usable published Planning Snapshot. Never manually re-entered here.
 *
 * Health reuses the Dashboard's own derivation (`healthOf` / `HEALTH_META` in
 * `features/dashboard/dashboard-data.ts`) rather than introducing a second
 * health algorithm — the same rule the Dashboard's "current position" applies
 * (`positionsFor`): every figure comes from ONE governed rollup, or the panel
 * says plainly that none exists yet. Absence is never shown as zero.
 *
 * Mid-project onboarding: a project onboarded as `existing_active_project`
 * with no published snapshot yet may declare an Opening Position — the SAME
 * `planning_opening_positions` mechanism the Planning workspace's Baselines &
 * Snapshots tab already uses (`OpeningPositionDialog`, `planningService
 * .createOpeningPosition` / `.publishSnapshot`). This panel only adds a second
 * entry point into that one mechanism; it never stores or computes a progress
 * figure of its own.
 */
export function GovernedPerformancePanel({
  project,
}: GovernedPerformancePanelProps) {
  const projectId = project?.id;
  const authority = useProjectAuthority(project ?? null);
  const canManage = authority.canManageOperations;

  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const [reloadToken, setReloadToken] = React.useState(0);
  const [openingDialogOpen, setOpeningDialogOpen] = React.useState(false);
  const [promoting, setPromoting] = React.useState(false);

  const refresh = React.useCallback(() => setReloadToken((k) => k + 1), []);

  React.useEffect(() => {
    // No project yet — nothing to fetch. The render below branches on
    // `projectId` directly rather than routing this through state.
    if (!projectId) return;
    let cancelled = false;
    void loadGovernedPerformance(projectId).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadToken]);

  const promoteOpening = React.useCallback(async () => {
    if (!projectId || state.status !== "ready" || !state.draftOpening) return;
    setPromoting(true);
    try {
      const id = await planningService.publishSnapshot({
        projectId,
        openingPositionId: state.draftOpening.id,
      });
      toast.success(`Opening Position promoted as Snapshot V1 (${id.slice(0, 8)}).`);
      refresh();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not promote the Opening Position."
      );
    } finally {
      setPromoting(false);
    }
  }, [projectId, state, refresh]);

  const openWorkspaceAction = (
    <Button asChild variant="outline" size="sm">
      <Link href={projectId ? projectSectionHref(projectId, "planning") : "/projects/new"}>
        Open Planning Workspace
        <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
      </Link>
    </Button>
  );

  if (!projectId) {
    return (
      <div className="space-y-3 border-t pt-4">
        {PANEL_HEADER}
        <EmptyState
          icon={Workflow}
          title="Available once the project is created"
          description="Planned Progress, Actual Progress, Variance, and SPI are sourced from the project's Published Planning Snapshot."
        />
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="space-y-3 border-t pt-4">
        {PANEL_HEADER}
        <LoadingState variant="card" count={4} label="Loading governed performance…" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="space-y-3 border-t pt-4">
        {PANEL_HEADER}
        <EmptyState
          icon={Workflow}
          title="Governed performance is unavailable right now"
          description="Planning Snapshot figures could not be loaded. Try again from the Planning Workspace."
          action={openWorkspaceAction}
        />
      </div>
    );
  }

  const figures = deriveDashboardPlanningFigures(state.rollup);

  if (!figures.planningBacked) {
    // Mid-project onboarding (Planning Integration 3A / Slice 1): a project
    // declared "existing_active_project" with no published snapshot yet may
    // establish ONE Opening Position rather than being asked to fabricate
    // from-zero history. Mirrors `needsOpening` in
    // `baselines-snapshots-panel.tsx` exactly — the same condition, not a
    // second rule.
    const needsOpening =
      state.settings?.onboardingMode === "existing_active_project" && !state.snapshot;

    if (needsOpening && state.draftOpening) {
      const draft = state.draftOpening;
      return (
        <div className="space-y-3 border-t pt-4">
          {PANEL_HEADER}
          <div className="space-y-3 rounded-xl border border-dashed p-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="info">Opening Position drafted</StatusBadge>
              <span className="text-xs text-muted-foreground">
                Not yet governing — promote it to start reporting against it.
              </span>
            </div>
            <p className="text-sm">
              As of {formatDate(draft.dataDate)} · Planned{" "}
              {draft.plannedProgressPercent ?? "N/A"}% · Actual{" "}
              {draft.actualProgressPercent ?? "N/A"}%
            </p>
            <p className="text-xs text-muted-foreground">Source: {draft.source}</p>
            <div className="flex flex-wrap gap-2">
              {canManage && (
                <Button size="sm" disabled={promoting} onClick={() => void promoteOpening()}>
                  <Rocket data-icon="inline-start" aria-hidden="true" />
                  {promoting ? "Promoting…" : "Promote as Snapshot V1"}
                </Button>
              )}
              {openWorkspaceAction}
            </div>
          </div>
        </div>
      );
    }

    if (needsOpening) {
      return (
        <div className="space-y-3 border-t pt-4">
          {PANEL_HEADER}
          <EmptyState
            icon={Workflow}
            title="No published Planning Snapshot yet"
            description="This project was onboarded mid-execution. Establish one honest Opening Position — as of a data date — to govern Planned Progress, Actual Progress, Variance, and SPI until a full schedule is published. This is an onboarding position only; it is superseded automatically the moment a real Planning Snapshot is published."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                {canManage && (
                  <Button size="sm" onClick={() => setOpeningDialogOpen(true)}>
                    Set Opening Position
                  </Button>
                )}
                {openWorkspaceAction}
              </div>
            }
          />
          {openingDialogOpen && (
            <OpeningPositionDialog
              projectId={projectId}
              onClose={() => setOpeningDialogOpen(false)}
              onSaved={() => {
                setOpeningDialogOpen(false);
                refresh();
              }}
            />
          )}
        </div>
      );
    }

    return (
      <div className="space-y-3 border-t pt-4">
        {PANEL_HEADER}
        <EmptyState
          icon={Workflow}
          title="No published Planning Snapshot yet"
          description="Publish a Planning Snapshot in the Planning Workspace to govern this project's Planned Progress, Actual Progress, Variance, and SPI here."
          action={openWorkspaceAction}
        />
      </div>
    );
  }

  const health = healthOf(figures.variance ?? undefined);
  const healthMeta = HEALTH_META[health];
  const isOpeningSnapshot = state.snapshot?.isOpeningSnapshot ?? false;

  return (
    <div className="space-y-3 border-t pt-4">
      {PANEL_HEADER}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Planned Progress"
          value={`${Math.round(figures.plannedProgress!)}%`}
          progress={figures.plannedProgress!}
        />
        <KpiCard
          label="Actual Progress"
          value={`${Math.round(figures.actualProgress!)}%`}
          progress={figures.actualProgress!}
        />
        <KpiCard
          label="Schedule Variance"
          value={formatVariance(round1(figures.variance ?? 0))}
          helper="Actual less planned"
        />
        <KpiCard
          label="SPI"
          value={figures.spi === null ? "N/A" : figures.spi.toFixed(2)}
          helper={
            figures.spi === null
              ? "Earned / planned value not available"
              : "Earned value / planned value"
          }
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          Dashboard Schedule Health
          <StatusBadge tone={toStatusTone(healthMeta.tone)}>
            {healthMeta.label}
          </StatusBadge>
        </span>
        <span>Coverage {Math.round(figures.coveragePercent ?? 0)}%</span>
        {isOpeningSnapshot ? (
          <span className="flex items-center gap-1.5">
            <StatusBadge tone="info">Manual Opening Position</StatusBadge>
            Data Date {formatDate(figures.dataDate)}
          </span>
        ) : (
          <span>
            Planning Snapshot v{figures.snapshotVersion} · Data Date {formatDate(figures.dataDate)}
          </span>
        )}
        <span className="ml-auto">{openWorkspaceAction}</span>
      </div>
      {isOpeningSnapshot && state.governingOpeningSource && (
        <p className="text-xs text-muted-foreground">
          Source: {state.governingOpeningSource}
        </p>
      )}
    </div>
  );
}

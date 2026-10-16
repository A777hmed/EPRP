"use client";

import * as React from "react";

import {
  planningRollupService,
  type PlanningSnapshotRollup,
} from "@/services/planning-rollup-service";
import { planningService } from "@/services/planning-service";
import type { PlanningSnapshot, ProjectPlanningSettings } from "@/types";

export type PlanningPositionState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      settings: ProjectPlanningSettings | null;
      snapshot: PlanningSnapshot | null;
      /** The figures the latest snapshot already carries — never recomputed. */
      rollup: PlanningSnapshotRollup | null;
    };

/**
 * The project's current planning position for read-only surfaces (Project
 * Setup → Planning Status, Project Progress, the project header): its
 * onboarding settings and its LATEST Published Planning Snapshot with that
 * snapshot's existing rollup. Reads published data only; never the Working
 * Plan, never the project record's typed progress.
 */
export function usePlanningPosition(
  projectId: string | undefined,
  /**
   * Re-read when this changes — e.g. Project Setup passes the stored
   * onboarding mode, so a save is reflected at once instead of the value
   * read on mount.
   */
  reloadKey?: string
): PlanningPositionState {
  const [state, setState] = React.useState<PlanningPositionState>({ status: "loading" });

  React.useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [settings, snapshot] = await Promise.all([
          planningService.getSettings(projectId),
          planningRollupService.getLatestPublishedSnapshot(projectId),
        ]);
        const rollup = snapshot
          ? await planningRollupService.computeSnapshotRollup(snapshot.id)
          : null;
        if (!cancelled) setState({ status: "ready", settings, snapshot, rollup });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadKey]);

  return state;
}

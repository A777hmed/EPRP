"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react";

import { planningService } from "@/services/planning-service";
import type { PlanningSnapshotActivity } from "@/types";

/**
 * The normalized activity rows behind ONE published Planning Snapshot
 * (Dashboard Data Depth) — the same `planning_snapshot_activities` table
 * `planningRollupService` already folds into Planned/Actual/Variance/
 * Coverage. Reading them here does not recompute anything: the rollup
 * figures stay the single source of truth, this just lets a drill-down show
 * the per-activity rows behind them.
 *
 * `undefined` while loading or when `snapshotId` is empty (no Planning-
 * backed position in scope, so nothing to fetch); `[]` once loaded for a
 * snapshot with no activity rows — distinct states, same convention as
 * `usePlanningProgressCurve`.
 */
export function usePlanningSnapshotActivities(
  snapshotId: string | undefined
): PlanningSnapshotActivity[] | undefined {
  const [activities, setActivities] = React.useState<PlanningSnapshotActivity[] | undefined>(undefined);

  React.useEffect(() => {
    if (!snapshotId) {
      setActivities(undefined);
      return;
    }
    let cancelled = false;
    setActivities(undefined);

    planningService
      .listSnapshotActivities(snapshotId)
      .then((rows) => {
        if (!cancelled) setActivities(rows);
      })
      .catch(() => {
        if (!cancelled) setActivities([]);
      });

    return () => {
      cancelled = true;
    };
  }, [snapshotId]);

  return activities;
}

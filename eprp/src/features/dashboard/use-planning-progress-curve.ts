"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react";

import { planningRollupService } from "@/services/planning-rollup-service";
import { planningProgressCurve, type ProgressCurvePoint } from "./planning-integration";

/**
 * The "Planned vs Actual Progress Curve" for ONE Planning-backed project
 * (3D). Reads `listPublishedSnapshotRollups` — every published snapshot,
 * never draft/live Planning data — and reduces it to one point per Data
 * Date via `planningProgressCurve` (latest version wins on a shared date).
 *
 * `undefined` while loading or when `projectId` is empty (no project
 * scoped, or the scope is not Planning-backed and the caller should not
 * fetch this at all); `[]` once loaded for a project with no published
 * snapshot yet — both distinct from a real, empty-but-loaded curve so the
 * Trend panel never flashes one state as another.
 */
export function usePlanningProgressCurve(projectId: string): ProgressCurvePoint[] | undefined {
  const [curve, setCurve] = React.useState<ProgressCurvePoint[] | undefined>(undefined);

  React.useEffect(() => {
    if (!projectId) {
      setCurve(undefined);
      return;
    }
    let cancelled = false;
    setCurve(undefined);

    planningRollupService
      .listPublishedSnapshotRollups(projectId)
      .then((rollups) => {
        if (!cancelled) setCurve(planningProgressCurve(rollups));
      })
      .catch(() => {
        if (!cancelled) setCurve([]);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return curve;
}

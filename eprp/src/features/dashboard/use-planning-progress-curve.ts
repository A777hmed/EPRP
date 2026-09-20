"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react";

import { planningRollupService } from "@/services/planning-rollup-service";
import { planningProgressCurve } from "./planning-integration";
import { buildProjectProgressCurve, type ProjectProgressCurvePoint } from "./progress-curve";
import { computePortfolioProgressTrend, type PortfolioProgressPoint } from "./portfolio-progress";

/**
 * One project's own Progress Curve — every published Planning Snapshot's
 * real Data Date, Planned and Actual both taken from that snapshot's own
 * governed rollup (`planningProgressCurve`, sparse and real; see
 * `progress-curve.ts` for why this is NOT time-phased from activity dates).
 *
 * `undefined` while loading or when `projectId` is empty (no project
 * scoped, or the scope is not Planning-backed and the caller should not
 * fetch this at all); `[]` once loaded for a project with no published
 * snapshot yet — both distinct from a real, empty-but-loaded curve so the
 * Trend panel never flashes one state as another.
 */
export function usePlanningProgressCurve(projectId: string): ProjectProgressCurvePoint[] | undefined {
  const [curve, setCurve] = React.useState<ProjectProgressCurvePoint[] | undefined>(undefined);

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
        if (!cancelled) setCurve(buildProjectProgressCurve(planningProgressCurve(rollups)));
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

/**
 * The Portfolio Progress trend for every ACTIVE project in `projectIds` —
 * the "All Active Projects" scope in the Progress Analysis modal. Builds
 * each project's own curve exactly the way `usePlanningProgressCurve` does
 * for one project, then folds them into an unweighted portfolio mean via
 * `computePortfolioProgressTrend`.
 *
 * `undefined` while loading or when `projectIds` is empty; `[]` once loaded
 * for a scope with no published Planning Snapshot anywhere in it.
 */
export function usePortfolioProgressCurve(projectIds: readonly string[]): PortfolioProgressPoint[] | undefined {
  const [trend, setTrend] = React.useState<PortfolioProgressPoint[] | undefined>(undefined);
  const key = projectIds.join(",");

  React.useEffect(() => {
    if (!projectIds.length) {
      setTrend(undefined);
      return;
    }
    let cancelled = false;
    setTrend(undefined);

    Promise.all(
      projectIds.map((projectId) =>
        planningRollupService
          .listPublishedSnapshotRollups(projectId)
          .then((rollups) => [projectId, buildProjectProgressCurve(planningProgressCurve(rollups))] as const)
          .catch(() => [projectId, [] as ProjectProgressCurvePoint[]] as const)
      )
    ).then((entries) => {
      if (cancelled) return;
      setTrend(computePortfolioProgressTrend(new Map(entries), projectIds.length));
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return trend;
}

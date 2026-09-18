import type { IsoDate, PlanningSnapshot } from "@/types";
import { computeRollupFromActivities, type SnapshotRollupMetrics } from "@/lib/planning-rollup";
import { planningService } from "./planning-service";

/**
 * Planning Snapshot rollups (Planning Integration 3A).
 *
 * The one place that turns a Published Planning Snapshot into the figures
 * a report or dashboard actually wants — Planned/Actual/Variance/SPI,
 * weighted and coverage-aware — with full provenance attached, so a caller
 * can never present a number without saying which snapshot it came from.
 *
 * Deliberately reads ONLY `planning_snapshots` / `planning_snapshot_activities`
 * (both immutable, published-only, already RLS-scoped the same way as
 * everywhere else in Planning). Never touches `planning_activities`,
 * `planning_import_rows`, or `planning_confirmations` — draft/unpublished
 * data cannot reach a rollup through this file, by construction.
 *
 * This module does not yet decide WHEN to use a rollup versus a project's
 * fallback figures, and does not write anything — that wiring is a later
 * integration slice (Dashboard/Weekly/Monthly/Executive, 3B+).
 */

export interface PlanningSnapshotRollup extends SnapshotRollupMetrics {
  source: "planning";
  snapshotId: string;
  snapshotVersion: number;
  /**
   * Undefined only for a pre-3A snapshot with no recoverable Data Date.
   * Every snapshot published going forward is guaranteed one — a caller
   * seeing this undefined should treat the rollup as unpositioned rather
   * than assume "current".
   */
  dataDate?: IsoDate;
}

function toRollup(snapshot: PlanningSnapshot, metrics: SnapshotRollupMetrics): PlanningSnapshotRollup {
  return {
    source: "planning",
    snapshotId: snapshot.id,
    snapshotVersion: snapshot.version,
    dataDate: snapshot.dataDate,
    ...metrics,
  };
}

export const planningRollupService = {
  /**
   * The project's current (highest-version) published snapshot, or `null`
   * if none has been published yet. Thin reuse of `planningService` — no
   * new query.
   */
  async getLatestPublishedSnapshot(projectId: string): Promise<PlanningSnapshot | null> {
    return planningService.getLatestSnapshot(projectId);
  },

  /**
   * The snapshot a report ending on `periodEnd` should resolve to: among
   * published snapshots whose `dataDate` is not after `periodEnd`, the one
   * with the latest `dataDate` (version only breaks a tie between
   * snapshots sharing that date). `null` when no published snapshot yet
   * qualifies — the caller's fallback path, not this function's concern.
   */
  async getSnapshotForPeriod(
    projectId: string,
    periodEnd: IsoDate
  ): Promise<PlanningSnapshot | null> {
    return planningService.getSnapshotForPeriod(projectId, periodEnd);
  },

  /**
   * The full rollup for one snapshot, with provenance. Throws if the
   * snapshot id does not resolve (deleted is impossible — snapshots have
   * no DELETE policy — but a bad id or one outside the caller's RLS
   * visibility is a real error, not a silent empty rollup).
   */
  async computeSnapshotRollup(snapshotId: string): Promise<PlanningSnapshotRollup> {
    const snapshot = await planningService.getSnapshotById(snapshotId);
    if (!snapshot) {
      throw new Error(`Planning snapshot ${snapshotId} was not found.`);
    }
    const activities = await planningService.listSnapshotActivities(snapshotId);
    return toRollup(snapshot, computeRollupFromActivities(activities));
  },

  /**
   * Every published snapshot's rollup for a project, oldest-to-newest-
   * agnostic ordering left to the caller (`planningService.listSnapshots`
   * already orders newest-first). For later trend/S-curve use — one call
   * per snapshot today; a project publishes snapshots rarely enough
   * (weekly/monthly cadence at most) that this is not a hot path yet.
   */
  async listPublishedSnapshotRollups(projectId: string): Promise<PlanningSnapshotRollup[]> {
    const snapshots = await planningService.listSnapshots(projectId);
    return Promise.all(
      snapshots.map(async (snapshot) => {
        const activities = await planningService.listSnapshotActivities(snapshot.id);
        return toRollup(snapshot, computeRollupFromActivities(activities));
      })
    );
  },
};

/**
 * Phase 13.10 — the planning consumer contract (`docs/02` §26.2, §26.8,
 * §26.13, §26.14).
 *
 * ONE pure answer to "what is this project's planning position, and where did
 * it come from?", for every consumer: Project Setup, Project Progress,
 * Dashboard, Weekly, Monthly, Executive and Calendar. It resolves the basis
 * (engine-calculated snapshot · legacy snapshot · Opening Position · Reported
 * Progress · nothing published), carries the provenance, and states every
 * figure as a semantic {@link PlanningFigure} — never a raw null, never a fake
 * 0, and SPI only where EV ÷ PV exists.
 *
 * It READS figures; it never calculates performance (`02` §26.2 F3). Inputs
 * are published data only — a snapshot and the figures it already carries, or
 * the append-only Reported Progress stream — never the Working Plan, so a
 * draft edit cannot reach a consumer through this contract.
 *
 * 13.10 delivers the contract and its tests. Moving each consumer onto it is
 * the consumer slices' work (13.14 Dashboard / Project Progress / Calendar,
 * 13.17 Weekly, 13.19 Monthly, 13.20 Executive); the existing per-consumer
 * `planning-integration.ts` modules are unchanged until then.
 *
 * Type-only `@/` imports plus two pure helpers, so the module stays
 * standalone-testable.
 */

import type { SnapshotRollupMetrics } from "@/lib/planning-rollup";
import { spiFigure } from "@/lib/planning-engine/engine";
import { figure, type PlanningFigure } from "@/lib/planning-engine/types";
import type { PlanningOnboardingMode, PlanningSnapshot } from "@/types";

import { planningGovernanceOf, type PlanningGovernance } from "./planning-experience";
import { latestReportedProgress, REPORTED_PROGRESS_LABEL, type ReportedProgressEntry } from "./reported-progress";

export type PlanningPositionBasis =
  /** A v2 snapshot whose figures the Planning Engine calculated (13.12+). */
  | "planning_snapshot"
  /** A snapshot published before 13.12: its own flat roll-up, never re-derived. */
  | "legacy_snapshot"
  /** A declared position for a project onboarded mid-execution. SPI N/A. */
  | "opening_position"
  /** No formal schedule: the latest Reported Progress entry. Not planning governed. */
  | "reported"
  /** Nothing published yet (C4: "No published plan", never 0%). */
  | "none";

export const PLANNING_POSITION_BASIS_LABEL: Record<PlanningPositionBasis, string> = {
  planning_snapshot: "Published Planning Snapshot",
  legacy_snapshot: "Published Planning Snapshot — legacy calculation",
  opening_position: "Opening Position — declared",
  reported: REPORTED_PROGRESS_LABEL,
  none: "No published plan",
};

/** The frozen engine figures of a v2 snapshot (supplied from 13.12 on). */
export interface FrozenEngineFigures {
  engineVersion: string;
  pv: number;
  ev: number;
}

export interface PlanningPositionInput {
  projectId: string;
  /** `null` when the project has no Planning settings row yet. */
  onboardingMode: PlanningOnboardingMode | null;
  /** The snapshot in force for the question asked (current, or for a period). */
  snapshot: Pick<
    PlanningSnapshot,
    | "id"
    | "projectId"
    | "version"
    | "dataDate"
    | "publishedAt"
    | "publishedByContactId"
    | "isOpeningSnapshot"
    | "sourceImportBatchId"
    | "sourceOpeningPositionId"
  > | null;
  /** The figures that snapshot already carries (`planningRollupService`). */
  rollup: SnapshotRollupMetrics | null;
  /** Present only for a v2 snapshot; none exists before 13.12. */
  engineFigures?: FrozenEngineFigures | null;
  /** The project's Reported Progress stream (any order). */
  reportedProgress?: readonly ReportedProgressEntry[];
  /** Resolve the position as of this date (a report period end). Defaults to current. */
  asOf?: string | null;
}

export type PlanningPositionProvenance =
  | {
      kind: "snapshot";
      projectId: string;
      snapshotId: string;
      snapshotVersion: number;
      /** `null` only for a pre-3A snapshot with no recoverable Data Date. */
      dataDate: string | null;
      publishedAt: string;
      publishedByContactId: string | null;
      source: "schedule_import" | "opening_position" | "manual";
      sourceId: string | null;
      calculation: "engine" | "legacy" | "declared";
      engineVersion: string | null;
    }
  | {
      kind: "reported_progress";
      projectId: string;
      entryId: string;
      dataDate: string;
      recordedAt: string;
      recordedBy: string;
      recordedByName: string | null;
      source: "eprp_entry";
    };

export interface PlanningPosition {
  projectId: string;
  basis: PlanningPositionBasis;
  label: string;
  governance: PlanningGovernance;
  /** `null` exactly when `basis` is "none", or "reported" with no entry yet. */
  provenance: PlanningPositionProvenance | null;
  plannedProgress: PlanningFigure;
  actualProgress: PlanningFigure;
  variance: PlanningFigure;
  spi: PlanningFigure;
  /** Share of the weighted plan behind the figures. */
  coverage: PlanningFigure;
}

function stated(value: number | null | undefined): PlanningFigure {
  return typeof value === "number" && Number.isFinite(value) ? figure.value(value) : figure.notAvailable("not_declared");
}

function difference(planned: PlanningFigure, actual: PlanningFigure): PlanningFigure {
  return planned.state === "value" && actual.state === "value"
    ? figure.value(actual.value - planned.value)
    : figure.notAvailable("not_declared");
}

function snapshotSource(
  snapshot: NonNullable<PlanningPositionInput["snapshot"]>
): Pick<Extract<PlanningPositionProvenance, { kind: "snapshot" }>, "source" | "sourceId"> {
  if (snapshot.sourceOpeningPositionId) return { source: "opening_position", sourceId: snapshot.sourceOpeningPositionId };
  if (snapshot.sourceImportBatchId) return { source: "schedule_import", sourceId: snapshot.sourceImportBatchId };
  return { source: "manual", sourceId: null };
}

function fromSnapshot(
  input: PlanningPositionInput,
  snapshot: NonNullable<PlanningPositionInput["snapshot"]>,
  governance: PlanningGovernance
): PlanningPosition {
  const opening = snapshot.isOpeningSnapshot || Boolean(snapshot.sourceOpeningPositionId);
  const engine = !opening && input.engineFigures ? input.engineFigures : null;
  const basis: PlanningPositionBasis = engine ? "planning_snapshot" : opening ? "opening_position" : "legacy_snapshot";

  const provenance: PlanningPositionProvenance = {
    kind: "snapshot",
    projectId: snapshot.projectId,
    snapshotId: snapshot.id,
    snapshotVersion: snapshot.version,
    dataDate: snapshot.dataDate ?? null,
    publishedAt: snapshot.publishedAt,
    publishedByContactId: snapshot.publishedByContactId ?? null,
    ...snapshotSource(snapshot),
    calculation: engine ? "engine" : opening ? "declared" : "legacy",
    engineVersion: engine ? engine.engineVersion : null,
  };

  if (engine) {
    return {
      projectId: input.projectId,
      basis,
      label: PLANNING_POSITION_BASIS_LABEL[basis],
      governance,
      provenance,
      plannedProgress: figure.value(engine.pv),
      actualProgress: figure.value(engine.ev),
      variance: figure.value(engine.ev - engine.pv),
      spi: spiFigure(engine.pv, engine.ev),
      // C3: every v2 snapshot covers 100% of the weighted plan.
      coverage: figure.value(100),
    };
  }

  const rollup = input.rollup;
  const plannedProgress = stated(rollup?.plannedProgress);
  const actualProgress = stated(rollup?.actualProgress);
  return {
    projectId: input.projectId,
    basis,
    label: PLANNING_POSITION_BASIS_LABEL[basis],
    governance,
    provenance,
    plannedProgress,
    actualProgress,
    variance: stated(rollup?.variance),
    spi: opening
      ? figure.notApplicable("declared_position")
      : typeof rollup?.spi === "number" && Number.isFinite(rollup.spi)
        ? figure.value(rollup.spi)
        : figure.notAvailable("no_value_data"),
    coverage: rollup ? figure.value(rollup.coveragePercent) : figure.notAvailable("not_declared"),
  };
}

function fromReportedProgress(input: PlanningPositionInput, governance: PlanningGovernance): PlanningPosition {
  const asOf = input.asOf ?? null;
  // Chains never leave their Data Date, so filtering by date keeps whole chains.
  const entries = (input.reportedProgress ?? []).filter((entry) => asOf === null || entry.dataDate <= asOf);
  const latest = latestReportedProgress(entries);
  const plannedProgress = stated(latest?.reportedPlannedPercent);
  const actualProgress = stated(latest?.reportedActualPercent);
  return {
    projectId: input.projectId,
    basis: "reported",
    label: PLANNING_POSITION_BASIS_LABEL.reported,
    governance,
    provenance: latest
      ? {
          kind: "reported_progress",
          projectId: latest.projectId,
          entryId: latest.id,
          dataDate: latest.dataDate,
          recordedAt: latest.recordedAt,
          recordedBy: latest.recordedBy,
          recordedByName: latest.recordedByName,
          source: latest.source,
        }
      : null,
    plannedProgress,
    actualProgress,
    variance: difference(plannedProgress, actualProgress),
    // `02` §26.14: never a ratio of typed percentages.
    spi: figure.notApplicable("not_planning_governed"),
    coverage: figure.notApplicable("not_planning_governed"),
  };
}

/**
 * Resolve a project's planning position. A published snapshot governs
 * whatever the onboarding mode (`02` §26.14, and B18 forbids leaving
 * governance once one exists); without one, a no-formal-schedule project
 * reads its Reported Progress stream and every other project reads
 * "No published plan".
 */
export function resolvePlanningPosition(input: PlanningPositionInput): PlanningPosition {
  const snapshot = input.snapshot && input.snapshot.projectId === input.projectId ? input.snapshot : null;
  const governance = planningGovernanceOf(input.onboardingMode ?? "new_project", snapshot !== null);

  if (snapshot) return fromSnapshot(input, snapshot, governance);
  if (input.onboardingMode === "no_formal_schedule") return fromReportedProgress(input, governance);

  const absent = figure.notAvailable("no_published_plan");
  return {
    projectId: input.projectId,
    basis: "none",
    label: PLANNING_POSITION_BASIS_LABEL.none,
    governance,
    provenance: null,
    plannedProgress: absent,
    actualProgress: absent,
    variance: absent,
    spi: absent,
    coverage: absent,
  };
}

/* ------------------------------- Display text ---------------------------- */

export type PlanningFigureFormat = "percent" | "points" | "ratio";

/**
 * Display text for a figure, in the conventions the existing surfaces use
 * (`snapshotFigures()`): one decimal for percentages and points, two for
 * SPI; "N/A" for a concept that does not apply; "No published plan" for C4;
 * "Not available" otherwise. Never "0" for an absence.
 */
export function planningFigureText(value: PlanningFigure, format: PlanningFigureFormat): string {
  if (value.state === "not_applicable") return "N/A";
  if (value.state === "not_available") {
    return value.reason === "no_published_plan" ? "No published plan" : "Not available";
  }
  const n = value.value;
  if (format === "ratio") return n.toFixed(2);
  const rounded = Math.round(n * 10) / 10;
  if (format === "points") return `${rounded > 0 ? "+" : ""}${rounded} pts`;
  return `${rounded}%`;
}

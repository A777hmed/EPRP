"use client";

/**
 * Shared building blocks for the Planned-vs-Actual analysis surfaces —
 * `PlanningCurveChart` (a published-Planning-Snapshot-history curve, plotted
 * by Data Date — never a full time-phased baseline S-curve: the platform
 * does not compute one, since a re-plan can move the Planned line between
 * snapshots, which a true baseline never does), `ProjectChipSelector` (a
 * compact selector for a handful of candidates) and `PlanningFigureStrip`
 * (the Planned/Actual/Variance/SPI/Coverage readout). No interpolation, no
 * invented points, no missing value plotted as zero.
 *
 * Dashboard UX Part 1: the Dashboard's own default progress panel is now
 * `ProjectProgressComparisonPanel` (`progress-comparison-panel.tsx`), which
 * compares every visible project's current position at once rather than one
 * project's curve. These three pieces remain the shared vocabulary for the
 * Expanded Progress Analysis modal (`progress-curve-modal.tsx`), where a
 * single project's history is exactly what is being read.
 */

import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@/lib/utils";
import { PanelEmpty } from "../dashboard-analytics";
import type { ProjectPosition } from "../dashboard-data";
import type { ProgressCurvePoint } from "../planning-integration";
import { pct, signedPct, varianceTone } from "./dashboard-format";

const AXIS = { fontSize: 10, fill: "var(--dash-muted)" } as const;
const GRID = "var(--dash-hairline)";
const PLANNED = "var(--dash-chart-planned)";
const ACTUAL = "var(--dash-chart-actual)";

function formatShortDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function percentTooltip(value: unknown): string {
  return typeof value === "number" ? `${value.toFixed(1)}%` : "—";
}

/** The chart alone — shared verbatim between the inline panel and the
    expanded analysis modal, so the two can never draw the same data two
    different ways. */
export function PlanningCurveChart({
  curve,
  reduced,
  height = 220,
}: {
  curve: ProgressCurvePoint[] | undefined;
  reduced: boolean;
  height?: number;
}) {
  const rows = (curve ?? []).map((point) => ({
    label: formatShortDate(point.dataDate),
    planned: point.planned ?? undefined,
    actual: point.actual ?? undefined,
  }));

  if (curve === undefined) {
    return <PanelEmpty>Loading Planning Snapshot history…</PanelEmpty>;
  }
  if (rows.length === 0) {
    return <PanelEmpty>No published Planning Snapshot date is recorded for this project yet.</PanelEmpty>;
  }
  /* Final Visual Polish: one Data Date is a real, current position — not
     nothing — so it earns a compact readout rather than the same big empty
     canvas as zero. It only ever becomes a curve once a second position is
     published; nothing here interpolates toward one. */
  if (rows.length === 1) {
    const point = curve[0];
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border border-dashed px-4 py-6 text-center">
        <p className="text-xs font-medium text-muted-foreground">Current position — {formatShortDate(point.dataDate)}</p>
        <dl className="dash-planning-strip" style={{ maxWidth: 220 }}>
          <div className="dash-planning-figure">
            <dt>Planned</dt>
            <dd>{pct(point.planned)}</dd>
          </div>
          <div className="dash-planning-figure">
            <dt>Actual</dt>
            <dd>{pct(point.actual)}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          More published Planning positions are required to show a progress history.
        </p>
      </div>
    );
  }

  return (
    <div className="dash-plot" role="img" aria-label="Planned and actual progress by Planning Snapshot Data Date">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={rows} margin={{ top: 10, right: 14, bottom: 0, left: -16 }}>
          <defs>
            <linearGradient id="dashPlanningActualFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACTUAL} stopOpacity={0.22} />
              <stop offset="100%" stopColor={ACTUAL} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} dy={4} />
          <YAxis unit="%" domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} width={44} />
          <Tooltip formatter={percentTooltip} cursor={{ stroke: GRID }} />
          <Area
            type="monotone"
            dataKey="planned"
            name="Planned"
            stroke={PLANNED}
            strokeWidth={1.75}
            strokeDasharray="5 4"
            fill="transparent"
            dot={false}
            isAnimationActive={!reduced}
            animationDuration={600}
          />
          <Area
            type="monotone"
            dataKey="actual"
            name="Actual"
            stroke={ACTUAL}
            strokeWidth={2.25}
            fill="url(#dashPlanningActualFill)"
            dot={{ r: 2.5, fill: ACTUAL, strokeWidth: 0 }}
            activeDot={{ r: 4.5 }}
            isAnimationActive={!reduced}
            animationDuration={700}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** The compact "chip" project selector — shared between the inline panel and
    the expanded modal's project list, at two different visual weights. */
export function ProjectChipSelector({
  candidates,
  selectedProjectId,
  onSelect,
}: {
  candidates: ProjectPosition[];
  selectedProjectId: string;
  onSelect: (projectId: string) => void;
}) {
  if (candidates.length <= 1) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Select project">
      {candidates.map((position) => {
        const active = position.project.id === selectedProjectId;
        return (
          <button
            key={position.project.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(position.project.id)}
            className={cn(
              "cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1",
              active
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted/50"
            )}
          >
            {position.project.shortName?.trim() || position.project.name}
          </button>
        );
      })}
    </div>
  );
}

const varianceClass = (tone: ReturnType<typeof varianceTone>) => (tone === "default" ? undefined : `is-${tone}`);

/** The below-chart Planned/Actual/Variance/SPI/Coverage strip — shared by
    the inline panel (compact) and reused inside the expanded modal. */
export function PlanningFigureStrip({ position }: { position: ProjectPosition }) {
  return (
    <dl className="dash-planning-strip">
      <div className="dash-planning-figure">
        <dt>Planned</dt>
        <dd>{pct(position.planned)}</dd>
      </div>
      <div className="dash-planning-figure">
        <dt>Actual</dt>
        <dd>{pct(position.actual)}</dd>
      </div>
      <div className={cn("dash-planning-figure", varianceClass(varianceTone(position.variance)))}>
        <dt>Variance</dt>
        <dd>{signedPct(position.variance)}</dd>
      </div>
      <div className="dash-planning-figure">
        <dt>SPI</dt>
        <dd>{position.spi === null || position.spi === undefined ? "N/A" : position.spi.toFixed(2)}</dd>
      </div>
      <div className="dash-planning-figure">
        <dt>Coverage</dt>
        <dd>{typeof position.coveragePercent === "number" ? `${Math.round(position.coveragePercent)}%` : "N/A"}</dd>
      </div>
    </dl>
  );
}

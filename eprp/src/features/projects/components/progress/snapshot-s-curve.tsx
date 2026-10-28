"use client";

import * as React from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { LineChart as LineChartIcon } from "lucide-react";

import { useReducedMotion } from "@/features/dashboard/dashboard-analytics";
import { formatDate } from "@/lib/formatters";
import { planningService } from "@/services/planning-service";
import type { PlanningCurvePoint, PlanningSnapshot } from "@/types";
import {
  forecastCurveReasonText,
  sCurveRows,
  sCurveSeriesPresent,
  type SCurveSeries,
} from "../../s-curve";

/**
 * Phase 13.12 closure — the S-curve of a v2 Published Planning Snapshot,
 * drawn only from what 13.12 froze: the BL0 and BLn revisions' engine
 * baseline curves, the snapshot's forecast curve, and its EV at the Data
 * Date (`../../s-curve.ts`). Read-only; nothing is recalculated here.
 */

const STROKE: Record<SCurveSeries, string> = {
  original: "var(--muted-foreground)",
  current: "var(--chart-1)",
  forecast: "var(--chart-4)",
  earned: "var(--chart-2)",
};
const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" } as const;
const MAX_TICKS = 8;

type CurveState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      original: PlanningCurvePoint[];
      current: PlanningCurvePoint[] | null;
      forecast: PlanningCurvePoint[];
      blnNumber: number | null;
    };

function shortDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" });
}

function PendingCurve({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground text-pretty">
      <LineChartIcon className="mx-auto mb-2 size-5 text-muted-foreground/60" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md">{children}</p>}
    </div>
  );
}

export function SnapshotSCurve({ snapshot }: { snapshot: PlanningSnapshot }) {
  const v2 = snapshot.v2;
  const reduced = useReducedMotion();
  const [state, setState] = React.useState<CurveState>({ status: "loading" });

  React.useEffect(() => {
    if (!v2) return;
    let cancelled = false;
    const sameBaseline = v2.blnBaselineId === v2.bl0BaselineId;
    void Promise.all([
      planningService.listBaselineCurve(v2.bl0BaselineId),
      sameBaseline ? Promise.resolve(null) : planningService.listBaselineCurve(v2.blnBaselineId),
      planningService.listSnapshotForecastCurve(snapshot.id),
      planningService.listBaselines(snapshot.projectId),
    ])
      .then(([original, current, forecast, baselines]) => {
        if (cancelled) return;
        const bln = baselines.find((baseline) => baseline.id === v2.blnBaselineId);
        setState({ status: "ready", original, current, forecast, blnNumber: bln?.revisionNumber ?? null });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot.id, snapshot.projectId, v2]);

  if (!v2) {
    return (
      <PendingCurve title="No S-curve for this snapshot">
        It was not calculated by the Planning Engine, so it carries no baseline or forecast curve. Publish a Planning
        Snapshot from Baselines &amp; Snapshots to see one.
      </PendingCurve>
    );
  }
  if (state.status === "loading") {
    return <div className="h-64 animate-pulse rounded-lg bg-muted/40 motion-reduce:animate-none" aria-label="Loading the S-curve" />;
  }
  if (state.status === "error") {
    return <PendingCurve title="The S-curve could not be loaded">Try again in a moment.</PendingCurve>;
  }

  const input = { original: state.original, current: state.current, forecast: state.forecast, dataDate: snapshot.dataDate, earned: v2.ev };
  const rows = sCurveRows(input);
  const present = sCurveSeriesPresent(input);
  const blnLabel = state.blnNumber === null ? "BLn" : `BL${state.blnNumber}`;
  const names: Record<SCurveSeries, string> = {
    original: state.current ? "Original baseline (BL0)" : "Baseline (BL0)",
    current: `Current baseline (${blnLabel})`,
    forecast: "Forecast",
    earned: "Earned at Data Date",
  };
  const forecastNote = state.forecast.length === 0 ? forecastCurveReasonText(v2.forecastCurveReason) : null;

  if (rows.length === 0) {
    return (
      <PendingCurve title="S-curve not available for this snapshot">
        Its baselines and forecast carry no curve points.
      </PendingCurve>
    );
  }

  const interval = rows.length > MAX_TICKS ? Math.ceil(rows.length / MAX_TICKS) - 1 : 0;
  const summary = [
    snapshot.dataDate && `Data Date ${formatDate(snapshot.dataDate)}`,
    `EV ${v2.ev.toFixed(3)}%`,
    v2.bl0FinishDate && `BL0 finish ${formatDate(v2.bl0FinishDate)}`,
    state.current && v2.blnFinishDate && `${blnLabel} finish ${formatDate(v2.blnFinishDate)}`,
    v2.forecastFinishDate && `Forecast finish ${formatDate(v2.forecastFinishDate)}`,
  ].filter(Boolean);

  return (
    <figure className="space-y-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Series">
        {present.map((series) => (
          <li key={series} className="inline-flex items-center gap-1.5">
            {series === "earned" ? (
              <span className="size-2 rounded-full" style={{ background: STROKE.earned }} aria-hidden="true" />
            ) : (
              <span
                className="h-0 w-4 border-t-2"
                style={{ borderColor: STROKE[series], borderTopStyle: series === "current" ? "solid" : "dashed" }}
                aria-hidden="true"
              />
            )}
            {names[series]}
          </li>
        ))}
      </ul>
      <div
        role="img"
        aria-label={`S-curve from Published Planning Snapshot v${snapshot.version}: ${present.map((series) => names[series]).join(", ")}. ${summary.join(" · ")}.`}
      >
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS} tickLine={false} axisLine={false} interval={interval} dy={4} />
            <YAxis domain={[0, 100]} unit="%" tick={AXIS} tickLine={false} axisLine={false} width={48} />
            <Tooltip
              labelFormatter={(label) => formatDate(String(label))}
              formatter={(value, name) => [typeof value === "number" ? `${value.toFixed(1)}%` : "—", String(name)]}
              contentStyle={{ fontSize: 12, borderRadius: 8, background: "var(--popover)", color: "var(--popover-foreground)", borderColor: "var(--border)" }}
              cursor={{ stroke: "var(--border)" }}
            />
            {snapshot.dataDate && (
              <ReferenceLine
                x={snapshot.dataDate}
                stroke="var(--muted-foreground)"
                strokeDasharray="2 3"
                label={{ value: "Data Date", position: "insideTopRight", fontSize: 10, fill: "var(--muted-foreground)" }}
              />
            )}
            {present.includes("original") && (
              <Line type="linear" dataKey="original" name={names.original} stroke={STROKE.original} strokeWidth={1.5}
                strokeDasharray="4 4" dot={false} connectNulls isAnimationActive={!reduced} />
            )}
            {present.includes("current") && (
              <Line type="linear" dataKey="current" name={names.current} stroke={STROKE.current} strokeWidth={2}
                dot={false} connectNulls isAnimationActive={!reduced} />
            )}
            {present.includes("forecast") && (
              <Line type="linear" dataKey="forecast" name={names.forecast} stroke={STROKE.forecast} strokeWidth={2}
                strokeDasharray="6 3" dot={false} connectNulls isAnimationActive={!reduced} />
            )}
            {present.includes("earned") && (
              <Line type="linear" dataKey="earned" name={names.earned} stroke="none" legendType="circle"
                dot={{ r: 4, fill: STROKE.earned, strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive={false} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="text-xs text-muted-foreground tabular-nums text-pretty">
        {summary.join(" · ")}. From Published Planning Snapshot v{snapshot.version}; baseline curves are those of the
        approved revisions it was measured against.
        {forecastNote && ` No forecast curve: ${forecastNote}.`}
      </figcaption>
    </figure>
  );
}

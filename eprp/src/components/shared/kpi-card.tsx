"use client";

import * as React from "react";
import { Area, AreaChart } from "recharts";

import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/shared/progress-bar";
import { cn } from "@/lib/utils";

export interface KpiCardProps extends React.ComponentProps<typeof Card> {
  label: string;
  value: string;
  /** Progress toward the target, 0–100. Renders a labeled progress bar. */
  progress?: number;
  /** Displayed next to the progress bar, e.g. "Target 85%". */
  targetLabel?: string;
  /** Recent history rendered as a sparkline behind the value. */
  trend?: number[];
  /** Short context line, e.g. "vs. last quarter". */
  helper?: string;
  /** Plain-language summary of the trend for screen readers. */
  trendDescription?: string;
}

/**
 * Executive KPI tile: headline value with an optional sparkline of recent
 * history and progress toward target. For dense stat rows without history,
 * prefer `StatCard`.
 */
export function KpiCard({
  label,
  value,
  progress,
  targetLabel,
  trend,
  helper,
  trendDescription,
  className,
  ...props
}: KpiCardProps) {
  const chartData = React.useMemo(
    () => trend?.map((y, i) => ({ i, y })) ?? [],
    [trend]
  );

  return (
    <Card
      data-slot="kpi-card"
      className={cn("gap-3 shadow-soft", className)}
      {...props}
    >
      <div className="flex items-start justify-between gap-3 px-(--card-spacing)">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tracking-tight tabular-nums">
            {value}
          </p>
          {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
        </div>
        {trend && trend.length > 1 && (
          <div
            className="h-12 w-24 shrink-0 text-primary"
            role="img"
            aria-label={trendDescription ?? `${label} recent trend`}
          >
            <AreaChart
              width={96}
              height={48}
              data={chartData}
              margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient id="kpi-spark-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="currentColor"
                    stopOpacity={0.25}
                  />
                  <stop
                    offset="100%"
                    stopColor="currentColor"
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="y"
                stroke="currentColor"
                strokeWidth={1.5}
                fill="url(#kpi-spark-fill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </div>
        )}
      </div>
      {progress !== undefined && (
        <div className="px-(--card-spacing)">
          <ProgressBar
            value={progress}
            label={targetLabel ?? "Progress"}
            size="sm"
          />
        </div>
      )}
    </Card>
  );
}

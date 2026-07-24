"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { SectionCard } from "@/components/shared";
import type { CumulativePoint } from "@/features/dashboard/types";

const chartConfig = {
  planned: { label: "Planned Cumulative %", color: "var(--chart-1)" },
  actual: { label: "Actual Cumulative %", color: "var(--chart-2)" },
} satisfies ChartConfig;

export interface CumulativeCurveChartProps {
  data: CumulativePoint[];
}

/** Cumulative Progress Curve — S-curve of planned vs. actual progress. */
export function CumulativeCurveChart({ data }: CumulativeCurveChartProps) {
  return (
    <SectionCard
      title="Cumulative Progress Curve"
      description="Planned vs. actual cumulative progress"
    >
      <ChartContainer config={chartConfig} className="h-56 w-full">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: -16 }}>
          <defs>
            <linearGradient id="fill-planned" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="var(--color-planned)"
                stopOpacity={0.18}
              />
              <stop
                offset="100%"
                stopColor="var(--color-planned)"
                stopOpacity={0.02}
              />
            </linearGradient>
            <linearGradient id="fill-actual" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="var(--color-actual)"
                stopOpacity={0.18}
              />
              <stop
                offset="100%"
                stopColor="var(--color-actual)"
                stopOpacity={0.02}
              />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeOpacity={0.4} />
          <XAxis dataKey="date" tickLine={false} axisLine={false} />
          <YAxis
            tickLine={false}
            axisLine={false}
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Area
            dataKey="planned"
            type="monotone"
            stroke="var(--color-planned)"
            strokeWidth={2}
            fill="url(#fill-planned)"
          />
          <Area
            dataKey="actual"
            type="monotone"
            stroke="var(--color-actual)"
            strokeWidth={2}
            fill="url(#fill-actual)"
          />
        </AreaChart>
      </ChartContainer>
    </SectionCard>
  );
}

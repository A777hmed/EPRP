"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { SectionCard } from "@/components/shared";
import type { WeeklyProgressPoint } from "@/features/dashboard/types";

const chartConfig = {
  planned: { label: "Planned %", color: "var(--chart-1)" },
  actual: { label: "Actual %", color: "var(--chart-2)" },
} satisfies ChartConfig;

export interface ProgressTrendChartProps {
  data: WeeklyProgressPoint[];
}

/** Monthly Progress Trend — planned vs. actual % per reporting week. */
export function ProgressTrendChart({ data }: ProgressTrendChartProps) {
  return (
    <SectionCard
      title="Monthly Progress Trend"
      description="Planned vs. actual progress by week"
    >
      <ChartContainer config={chartConfig} className="h-56 w-full">
        <LineChart data={data} margin={{ top: 8, right: 12, left: -16 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.4} />
          <XAxis dataKey="week" tickLine={false} axisLine={false} />
          <YAxis
            tickLine={false}
            axisLine={false}
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Line
            dataKey="planned"
            type="monotone"
            stroke="var(--color-planned)"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
          <Line
            dataKey="actual"
            type="monotone"
            stroke="var(--color-actual)"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ChartContainer>
    </SectionCard>
  );
}

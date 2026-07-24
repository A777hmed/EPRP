"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { SectionCard } from "@/components/shared";
import type { ProjectProgress } from "@/features/dashboard/types";

const chartConfig = {
  actual: { label: "Actual %", color: "var(--chart-2)" },
  planned: { label: "Planned %", color: "var(--chart-1)" },
} satisfies ChartConfig;

export interface ProjectProgressChartProps {
  data: ProjectProgress[];
}

/** Progress by Project — horizontal bars, actual vs. planned per project. */
export function ProjectProgressChart({ data }: ProjectProgressChartProps) {
  return (
    <SectionCard
      title="Progress by Project"
      description="Actual vs. planned progress across active projects"
    >
      <ChartContainer
        config={chartConfig}
        className="h-64 w-full"
      >
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 16, left: 8 }}
          barCategoryGap={14}
        >
          <CartesianGrid horizontal={false} strokeOpacity={0.4} />
          <XAxis
            type="number"
            domain={[0, 100]}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v}%`}
          />
          <YAxis
            type="category"
            dataKey="project"
            tickLine={false}
            axisLine={false}
            width={130}
            tick={{ fontSize: 12 }}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar
            dataKey="actual"
            fill="var(--color-actual)"
            radius={[0, 4, 4, 0]}
            maxBarSize={14}
          />
          <Bar
            dataKey="planned"
            fill="var(--color-planned)"
            radius={[0, 4, 4, 0]}
            maxBarSize={14}
            fillOpacity={0.35}
          />
        </BarChart>
      </ChartContainer>
    </SectionCard>
  );
}

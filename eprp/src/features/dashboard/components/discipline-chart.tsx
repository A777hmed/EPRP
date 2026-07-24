"use client";

import { Cell, Pie, PieChart } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { SectionCard } from "@/components/shared";
import type { DisciplineProgress } from "@/features/dashboard/types";

const sliceColors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const chartConfig = {
  progress: { label: "Actual %" },
} satisfies ChartConfig;

export interface DisciplineChartProps {
  data: DisciplineProgress[];
}

/**
 * Progress by Discipline — donut with a per-discipline legend showing
 * exact values (kept outside the chart for screen-reader access).
 */
export function DisciplineChart({ data }: DisciplineChartProps) {
  return (
    <SectionCard
      title="Progress by Discipline"
      description="Actual progress per discipline"
    >
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <ChartContainer
          config={chartConfig}
          className="aspect-square h-44 shrink-0"
        >
          <PieChart>
            <ChartTooltip
              content={<ChartTooltipContent nameKey="discipline" />}
            />
            <Pie
              data={data}
              dataKey="progress"
              nameKey="discipline"
              innerRadius={48}
              outerRadius={70}
              strokeWidth={2}
              paddingAngle={2}
            >
              {data.map((entry, i) => (
                <Cell
                  key={entry.discipline}
                  fill={sliceColors[i % sliceColors.length]}
                />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <ul className="w-full space-y-2 text-sm">
          {data.map((d, i) => (
            <li
              key={d.discipline}
              className="flex items-center justify-between gap-2"
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-[2px]"
                  style={{ background: sliceColors[i % sliceColors.length] }}
                />
                {d.discipline}
              </span>
              <span className="font-medium tabular-nums">{d.progress}%</span>
            </li>
          ))}
        </ul>
      </div>
    </SectionCard>
  );
}

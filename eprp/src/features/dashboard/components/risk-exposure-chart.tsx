"use client";

import { Cell, Pie, PieChart } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { SectionCard, StatusBadge } from "@/components/shared";
import type { RiskExposureSlice } from "@/features/dashboard/types";
import type { StatusTone } from "@/components/shared";

const severityMeta: Record<
  RiskExposureSlice["severity"],
  { color: string; tone: StatusTone }
> = {
  High: { color: "var(--color-destructive)", tone: "danger" },
  Medium: { color: "var(--color-warning)", tone: "warning" },
  Low: { color: "var(--color-success)", tone: "success" },
};

const chartConfig = {
  count: { label: "Risks" },
} satisfies ChartConfig;

export interface RiskExposureChartProps {
  data: RiskExposureSlice[];
}

/**
 * Overall Risk Exposure — open risks by severity. Severity is encoded by
 * color, badge, and text so meaning never relies on color alone.
 */
export function RiskExposureChart({ data }: RiskExposureChartProps) {
  const total = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <SectionCard
      title="Overall Risk Exposure"
      description={`${total} open risks by severity`}
    >
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <ChartContainer
          config={chartConfig}
          className="aspect-square h-44 shrink-0"
        >
          <PieChart>
            <ChartTooltip
              content={<ChartTooltipContent nameKey="severity" />}
            />
            <Pie
              data={data}
              dataKey="count"
              nameKey="severity"
              innerRadius={48}
              outerRadius={70}
              strokeWidth={2}
              paddingAngle={2}
            >
              {data.map((entry) => (
                <Cell
                  key={entry.severity}
                  fill={severityMeta[entry.severity].color}
                />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <ul className="w-full space-y-2.5 text-sm">
          {data.map((d) => (
            <li
              key={d.severity}
              className="flex items-center justify-between gap-2"
            >
              <StatusBadge tone={severityMeta[d.severity].tone}>
                {d.severity}
              </StatusBadge>
              <span className="font-medium tabular-nums">
                {d.count} {d.count === 1 ? "risk" : "risks"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </SectionCard>
  );
}

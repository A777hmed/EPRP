"use client";

/**
 * The month-end analytics block — one canonical layout for screen and print.
 *
 * There is a single grid, a single card, a single heading and a single set of
 * notes and empty states. Only the drawing surface inside a card swaps: screen
 * gets the interactive recharts body, paper gets a static SVG of the same data
 * in the same slot. Everything that defines the look of the report — grid,
 * borders, spacing, type — is shared, so the printed page cannot drift into a
 * different composition from the screen.
 *
 * The adaptive decisions live in `monthly-analytics-model.ts`; this file draws
 * what it is given.
 */

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { StatusBadge } from "@/components/shared";
import { KPI_RATING_META } from "@/lib/constants";
import { NOT_RECORDED } from "./monthly-data";
import { EPROM_CHART, type AnalyticsPanel } from "./monthly-analytics-model";
import { PrintChartBody } from "./monthly-print-charts";

const countConfig = { count: { label: "Items", color: EPROM_CHART.navy } } satisfies ChartConfig;

/**
 * Cap a category axis label. Recharts wraps a long tick onto stacked tspans,
 * which stays readable — this only stops a runaway name from pushing the axis
 * into three or four lines.
 */
function axisLabel(value: string, max = 28): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

export function MonthlyAnalytics({ panels }: { panels: AnalyticsPanel[] }) {
  return (
    <div className="monthly-analytics-grid">
      {panels.map((panel) => (
        <div className="monthly-analytics-card" key={panel.id}>
          <div className="monthly-mini-heading">
            <span>{panel.title}</span>
            {(panel.kind === "grouped-bars" || panel.kind === "trend") && (
              <span className="monthly-chart-legend">
                {panel.series.map((serie) => (
                  <span key={serie.key}>
                    <i style={{ background: serie.color }} /> {serie.label}
                  </span>
                ))}
              </span>
            )}
          </div>
          <PanelBody panel={panel} />
        </div>
      ))}
    </div>
  );
}

/**
 * The two drawing surfaces for one card. Exactly one is visible at a time; both
 * sit in the same slot so the card's height and rhythm do not change between
 * screen and paper.
 */
function ChartSlot({ panel, children }: { panel: AnalyticsPanel; children: React.ReactNode }) {
  return (
    <>
      <div className="monthly-chart-screen">{children}</div>
      <div className="monthly-chart-print">
        <PrintChartBody panel={panel} />
      </div>
    </>
  );
}

function PanelBody({ panel }: { panel: AnalyticsPanel }) {
  switch (panel.kind) {
    case "grouped-bars": {
      const data = toRows(panel.categories, panel.series);
      return (
        <ChartSlot panel={panel}>
          <ChartContainer config={seriesConfig(panel.series)} className="monthly-analytics-chart">
            <BarChart data={data} margin={{ top: 6, right: 8, left: -22, bottom: 0 }} barCategoryGap="30%">
              <CartesianGrid vertical={false} stroke="#dbe4ee" />
              <XAxis dataKey="category" tickLine={false} axisLine={{ stroke: "#dbe4ee" }} tick={{ fill: "#63748a", fontSize: 10 }} />
              <YAxis
                domain={[0, panel.maxValue]}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "#63748a", fontSize: 9 }}
                tickFormatter={(value: number) => `${value}${panel.suffix}`}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              {panel.series.map((serie) => (
                <Bar key={serie.key} dataKey={serie.key} fill={serie.color} radius={[2, 2, 0, 0]} maxBarSize={16} />
              ))}
            </BarChart>
          </ChartContainer>
        </ChartSlot>
      );
    }

    case "trend": {
      const data = toRows(panel.categories, panel.series);
      return (
        <ChartSlot panel={panel}>
          <ChartContainer config={seriesConfig(panel.series)} className="monthly-analytics-chart">
            <AreaChart data={data} margin={{ top: 6, right: 10, left: -22, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#dbe4ee" />
              <XAxis dataKey="category" tickLine={false} axisLine={{ stroke: "#dbe4ee" }} tick={{ fill: "#63748a", fontSize: 10 }} />
              <YAxis
                domain={[0, panel.maxValue]}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "#63748a", fontSize: 9 }}
                tickFormatter={(value: number) => `${value}${panel.suffix}`}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              {panel.series.map((serie) => (
                <Area key={serie.key} dataKey={serie.key} type="monotone" stroke={serie.color} fill={serie.color} fillOpacity={0.16} strokeWidth={2} />
              ))}
            </AreaChart>
          </ChartContainer>
        </ChartSlot>
      );
    }

    case "hbars":
      return (
        <>
          <ChartSlot panel={panel}>
            <ChartContainer config={countConfig} className="monthly-analytics-chart">
              <BarChart data={panel.rows} layout="vertical" margin={{ top: 4, right: 20, left: 4, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke="#dbe4ee" />
                <XAxis
                  type="number"
                  domain={[0, panel.maxValue]}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "#63748a", fontSize: 9 }}
                  allowDecimals={false}
                  tickFormatter={(value: number) => `${value}${panel.suffix}`}
                />
                <YAxis
                  dataKey="label"
                  type="category"
                  width={104}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "#63748a", fontSize: 9 }}
                  tickFormatter={(value: string) => axisLabel(value)}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="value" fill={panel.color} radius={[0, 3, 3, 0]} maxBarSize={13} />
              </BarChart>
            </ChartContainer>
          </ChartSlot>
          {panel.note && <small className="monthly-analytics-note">{panel.note}</small>}
        </>
      );

    case "donut":
      return (
        <div className="monthly-donut-layout">
          <ChartSlot panel={panel}>
            <ChartContainer config={countConfig} className="monthly-donut-chart">
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                <Pie data={panel.slices} dataKey="value" nameKey="name" innerRadius={30} outerRadius={50} paddingAngle={2}>
                  {panel.slices.map((slice) => (
                    <Cell key={slice.name} fill={slice.color} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
          </ChartSlot>
          {/* Shared: the legend is HTML and reads identically in both modes. */}
          <div className="monthly-donut-legend">
            {panel.slices.map((slice) => (
              <span key={slice.name}>
                <i style={{ background: slice.color }} />
                {slice.name} <b>{slice.value}</b>
              </span>
            ))}
          </div>
        </div>
      );

    case "stat":
      return (
        <>
          <div className="monthly-compact-stat">
            {panel.items.map((item) => (
              <div key={item.label}>
                <b style={item.color ? { color: item.color } : undefined}>{item.value}</b>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          {panel.note && <small className="monthly-analytics-note">{panel.note}</small>}
        </>
      );

    case "ratings":
      return (
        <>
          <div className="monthly-rating-list">
            {panel.rows.map((row) => (
              <div className="monthly-rating-row" key={row.label}>
                <span>{row.label}</span>
                {row.rating ? (
                  <StatusBadge tone={KPI_RATING_META[row.rating].tone}>{KPI_RATING_META[row.rating].label}</StatusBadge>
                ) : (
                  <b className="muted">{NOT_RECORDED}</b>
                )}
              </div>
            ))}
          </div>
          <small className="monthly-analytics-note">{panel.note}</small>
        </>
      );

    case "empty":
      // Same card, same slot — only the contents say there is nothing to draw.
      return <div className="monthly-chart-empty">{panel.text}</div>;
  }
}

function toRows(categories: string[], series: { key: string; values: number[] }[]) {
  return categories.map((category, index) => ({
    category,
    ...Object.fromEntries(series.map((serie) => [serie.key, serie.values[index] ?? 0])),
  }));
}

function seriesConfig(series: { key: string; label: string; color: string }[]): ChartConfig {
  return Object.fromEntries(series.map((serie) => [serie.key, { label: serie.label, color: serie.color }]));
}

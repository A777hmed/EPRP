"use client";

import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { MonthlyComment, WeeklyReport } from "@/types";
import { MONTHLY_UPDATE_TYPE_OPTIONS } from "./monthly-comment-form";

const plannedColor = "#5f91cf";
const actualColor = "#34a348";
const palette = ["#0d59a8", "#34a348", "#e09b2d", "#7a5bc2", "#e05656", "#2a9d8f", "#6b7c93", "#9a6b2f"];

const trendConfig = {
  planned: { label: "Planned", color: plannedColor },
  actual: { label: "Actual", color: actualColor },
} satisfies ChartConfig;

const countConfig = {
  count: { label: "Count", color: "#0d59a8" },
} satisfies ChartConfig;

const typeLabel = Object.fromEntries(MONTHLY_UPDATE_TYPE_OPTIONS) as Record<MonthlyComment["updateType"], string>;

interface MonthlyAnalyticsProps {
  weeklies?: WeeklyReport[] | null;
  comments?: MonthlyComment[] | null;
  departments?: { id: string; name: string }[] | null;
  scopeLabel?: string | null;
}

export function MonthlyAnalytics({ weeklies, comments, departments, scopeLabel }: MonthlyAnalyticsProps) {
  const safeWeeklies = Array.isArray(weeklies) ? weeklies : [];
  const safeComments = Array.isArray(comments) ? comments : [];
  const safeDepartments = Array.isArray(departments) ? departments : [];
  const safeScopeLabel = scopeLabel?.trim() || "Scope";

  const weeklyData = safeWeeklies.map((weekly) => ({
    week: `W${weekly.weekNumber}`,
    planned: Number(weekly.plannedProgress.toFixed(1)),
    actual: Number(weekly.actualProgress.toFixed(1)),
  }));
  const finalComments = safeComments.filter((comment) => comment.includeInFinal);
  const scopeStatus = Object.entries(groupCount(finalComments.filter((comment) => comment.disciplineId), (comment) => normalizeStatus(comment.status))).map(([name, value], index) => ({ name, value, fill: palette[index % palette.length] }));
  const categoryStatus = Object.entries(groupCount(finalComments, (comment) => typeLabel[comment.updateType] ?? "General")).map(([name, value], index) => ({ name, value, fill: palette[index % palette.length] }));
  const departmentActions = Object.entries(groupCount(finalComments.filter((comment) => comment.departmentId), (comment) => nameOf(comment.departmentId, safeDepartments))).map(([department, count]) => ({ department, count })).sort((a, b) => b.count - a.count).slice(0, 6);
  const latestWeek = safeWeeklies.at(-1);

  return (
    <div className="monthly-analytics-grid">
      <AnalyticsCard title="Weekly Planned vs Actual" legend>
        {weeklyData.length ? (
          <ChartContainer config={trendConfig} className="monthly-analytics-chart">
            <BarChart data={weeklyData} margin={{ top: 8, right: 10, left: -20, bottom: 0 }} barCategoryGap="32%">
              <CartesianGrid vertical={false} stroke="#d7e1ee" strokeOpacity={0.9} />
              <XAxis dataKey="week" tickLine={false} axisLine={{ stroke: "#d7e1ee" }} tick={{ fill: "#63748a", fontSize: 10 }} />
              <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fill: "#63748a", fontSize: 9 }} tickFormatter={(value: number) => `${value}%`} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="planned" fill="var(--color-planned)" radius={[2, 2, 0, 0]} maxBarSize={14} />
              <Bar dataKey="actual" fill="var(--color-actual)" radius={[2, 2, 0, 0]} maxBarSize={14} />
            </BarChart>
          </ChartContainer>
        ) : <CompactEmpty>No Weekly KPI data is available for this month.</CompactEmpty>}
      </AnalyticsCard>

      <AnalyticsCard title="Cumulative Planned vs Actual" legend>
        {weeklyData.length >= 2 ? (
          <ChartContainer config={trendConfig} className="monthly-analytics-chart">
            <LineChart data={weeklyData} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#d7e1ee" strokeOpacity={0.9} />
              <XAxis dataKey="week" tickLine={false} axisLine={{ stroke: "#d7e1ee" }} tick={{ fill: "#63748a", fontSize: 10 }} />
              <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fill: "#63748a", fontSize: 9 }} tickFormatter={(value: number) => `${value}%`} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line dataKey="planned" type="monotone" stroke="var(--color-planned)" strokeWidth={2} dot={{ r: 2 }} />
              <Line dataKey="actual" type="monotone" stroke="var(--color-actual)" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ChartContainer>
        ) : <CompactEmpty>Trend becomes available after at least two Weekly reporting periods.</CompactEmpty>}
      </AnalyticsCard>

      <AnalyticsCard title={`${safeScopeLabel} Status Distribution`}>
        {scopeStatus.length ? <DonutChart data={scopeStatus} /> : <CompactEmpty>No scoped status data is available.</CompactEmpty>}
      </AnalyticsCard>

      <AnalyticsCard title="Monthly Update Category Mix">
        {categoryStatus.length ? <DonutChart data={categoryStatus} /> : <CompactEmpty>No Monthly updates are included in the final report.</CompactEmpty>}
      </AnalyticsCard>

      <AnalyticsCard title="Updates by Department">
        {departmentActions.length ? (
          <ChartContainer config={countConfig} className="monthly-analytics-chart compact">
            <BarChart data={departmentActions} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
              <CartesianGrid horizontal={false} stroke="#d7e1ee" strokeOpacity={0.9} />
              <XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: "#63748a", fontSize: 9 }} allowDecimals={false} />
              <YAxis dataKey="department" type="category" width={86} tickLine={false} axisLine={false} tick={{ fill: "#63748a", fontSize: 9 }} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="count" fill="var(--color-count)" radius={[0, 3, 3, 0]} maxBarSize={12} />
            </BarChart>
          </ChartContainer>
        ) : <CompactEmpty>No department-linked Monthly updates are included.</CompactEmpty>}
      </AnalyticsCard>

      <AnalyticsCard title="HSE Status">
        <div className="monthly-hse-grid analytics">
          {["LTI", "Recordable", "First Aid", "Near Miss"].map((label) => <div className="monthly-hse-value" key={label}><b>-</b><span>{label}</span></div>)}
        </div>
        <small className="monthly-analytics-note">{latestWeek?.hseStatus ? `Latest Weekly HSE rating: ${latestWeek.hseStatus.replaceAll("_", " ")}` : "Detailed HSE event counts are not available in the current Monthly data model."}</small>
      </AnalyticsCard>
    </div>
  );
}

function AnalyticsCard({ title, legend = false, children }: { title: string; legend?: boolean; children: React.ReactNode }) {
  return (
    <div className="monthly-analytics-card">
      <div className="monthly-mini-heading">
        <span>{title}</span>
        {legend && <span className="monthly-chart-legend"><i className="planned" /> Planned <i className="actual" /> Actual</span>}
      </div>
      {children}
    </div>
  );
}

function DonutChart({ data }: { data: { name: string; value: number; fill: string }[] }) {
  return (
    <div className="monthly-donut-layout">
      <ChartContainer config={countConfig} className="monthly-donut-chart">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent hideLabel />} />
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={34} outerRadius={54} paddingAngle={2}>
            {data.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="monthly-donut-legend">
        {data.map((entry) => <span key={entry.name}><i style={{ background: entry.fill }} />{entry.name} <b>{entry.value}</b></span>)}
      </div>
    </div>
  );
}

function CompactEmpty({ children }: { children: React.ReactNode }) {
  return <div className="monthly-chart-empty compact">{children}</div>;
}

function groupCount<T>(rows: T[], getKey: (row: T) => string) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = getKey(row);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function nameOf(id: string | undefined, rows: { id: string; name: string }[], fallback = "Not specified") {
  return rows.find((row) => row.id === id)?.name ?? fallback;
}

function normalizeStatus(status: MonthlyComment["status"]) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

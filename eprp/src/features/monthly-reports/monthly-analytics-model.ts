/**
 * What the analytics section should show, decided once.
 *
 * Screen and print render from these same descriptors, so an adaptive choice
 * ("all one status, chart the progress instead") cannot come out one way on
 * screen and another on paper. Neither renderer makes decisions; they only draw.
 */

import type { KpiRating, MonthlyComment } from "@/types";
import { MONTHLY_UPDATE_TYPE_OPTIONS } from "./monthly-comment-form";
import { nameOf, type NamedRecord, type ScopeStatusRow } from "./monthly-data";

/** The EPROM semantic palette. Every chart colour comes from here. */
export const EPROM_CHART = {
  navy: "#0d59a8",
  navyDeep: "#0a3974",
  navyLight: "#7ba4d6",
  green: "#2e9c43",
  amber: "#d1841f",
  red: "#c0444c",
  muted: "#9aabbd",
} as const;

const typeLabel = Object.fromEntries(MONTHLY_UPDATE_TYPE_OPTIONS) as Record<MonthlyComment["updateType"], string>;

const STATUS_COLOR: Record<string, string> = {
  Open: EPROM_CHART.navy,
  "In Progress": EPROM_CHART.amber,
  Pending: EPROM_CHART.amber,
  Resolved: EPROM_CHART.green,
  Closed: EPROM_CHART.muted,
  Escalated: EPROM_CHART.red,
};

const CATEGORY_COLOR: Record<MonthlyComment["updateType"], string> = {
  achievement: EPROM_CHART.green,
  progress_update: EPROM_CHART.navy,
  challenge_constraint: EPROM_CHART.amber,
  risk_issue: EPROM_CHART.red,
  action: EPROM_CHART.amber,
  decision_management_support: EPROM_CHART.navyDeep,
  next_month_plan: EPROM_CHART.navyLight,
  general: EPROM_CHART.muted,
};

export interface SeriesSpec {
  key: string;
  label: string;
  color: string;
  values: number[];
}

export type AnalyticsPanel =
  | { kind: "grouped-bars"; id: string; title: string; categories: string[]; series: SeriesSpec[]; maxValue: number; suffix: string }
  | { kind: "trend"; id: string; title: string; categories: string[]; series: SeriesSpec[]; maxValue: number; suffix: string }
  | { kind: "hbars"; id: string; title: string; rows: { label: string; value: number }[]; maxValue: number; color: string; suffix: string; note?: string }
  | { kind: "donut"; id: string; title: string; slices: { name: string; value: number; color: string }[] }
  | { kind: "stat"; id: string; title: string; items: { value: string; label: string; color?: string }[]; note?: string }
  | { kind: "ratings"; id: string; title: string; rows: { label: string; rating?: KpiRating }[]; note: string }
  | { kind: "empty"; id: string; title: string; text: string };

/** Panels that carry a real figure. Print collapses everything else. */
export function isInformative(panel: AnalyticsPanel): boolean {
  return panel.kind !== "empty";
}

export interface AnalyticsInput {
  weeklies: { weekNumber: number; plannedProgress: number; actualProgress: number }[];
  comments: MonthlyComment[];
  departments: NamedRecord[];
  scopeRows: ScopeStatusRow[];
  scopeLabel: string;
  hseRating?: KpiRating;
  qualityRating?: KpiRating;
}

export function buildAnalyticsPanels(input: AnalyticsInput): AnalyticsPanel[] {
  const { weeklies, departments, scopeRows, scopeLabel, hseRating, qualityRating } = input;
  const included = input.comments.filter((comment) => comment.includeInFinal);

  const categories = weeklies.map((weekly) => `W${weekly.weekNumber}`);
  const planned = weeklies.map((weekly) => round1(weekly.plannedProgress));
  const actual = weeklies.map((weekly) => round1(weekly.actualProgress));
  const progressSeries: SeriesSpec[] = [
    { key: "planned", label: "Planned", color: EPROM_CHART.navyLight, values: planned },
    { key: "actual", label: "Actual", color: EPROM_CHART.green, values: actual },
  ];

  const panels: AnalyticsPanel[] = [];

  panels.push(
    weeklies.length
      ? { kind: "grouped-bars", id: "weekly", title: "Planned vs Actual by Week", categories, series: progressSeries, maxValue: 100, suffix: "%" }
      : { kind: "empty", id: "weekly", title: "Planned vs Actual by Week", text: "No Weekly KPI data for this month." }
  );

  panels.push(
    weeklies.length >= 2
      ? { kind: "trend", id: "trend", title: "Cumulative Trend", categories, series: progressSeries, maxValue: 100, suffix: "%" }
      : {
          kind: "empty",
          id: "trend",
          title: "Cumulative Trend",
          text: weeklies.length === 1 ? "One reporting week so far — a trend needs at least two." : "No Weekly reporting periods in this month.",
        }
  );

  panels.push(scopePanel(scopeRows, scopeLabel));
  panels.push(categoryPanel(included));

  const byDepartment = Object.entries(
    groupCount(
      included.filter((comment) => comment.departmentId),
      (comment) => nameOf(comment.departmentId, departments, "Unassigned")
    )
  )
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  panels.push(
    byDepartment.length
      ? {
          kind: "hbars",
          id: "departments",
          title: "Updates by Department",
          rows: byDepartment,
          maxValue: Math.max(...byDepartment.map((row) => row.value)),
          color: EPROM_CHART.navy,
          suffix: "",
        }
      : { kind: "empty", id: "departments", title: "Updates by Department", text: "No department-linked updates." }
  );

  panels.push(
    hseRating || qualityRating
      ? {
          kind: "ratings",
          id: "hse",
          title: "HSE & Quality",
          rows: [
            { label: "HSE", rating: hseRating },
            { label: "Quality", rating: qualityRating },
          ],
          note: "Ratings only — LTI, recordable, first-aid and near-miss counts have no field in the Monthly data model.",
        }
      : { kind: "empty", id: "hse", title: "HSE & Quality", text: "No HSE or Quality rating recorded for this month." }
  );

  return panels;
}

/**
 * Scope analytics, in descending order of what the data supports: a spread of
 * statuses, then real progress figures, then a plain count.
 */
function scopePanel(rows: ScopeStatusRow[], label: string): AnalyticsPanel {
  const statuses = rows.map((row) => row.status?.label).filter((value): value is string => Boolean(value));
  const distinct = new Set(statuses);
  const withProgress = rows.filter((row) => typeof row.progressPercent === "number");

  if (distinct.size > 1) {
    return {
      kind: "donut",
      id: "scope",
      title: `${label} Status`,
      slices: Object.entries(groupCount(statuses, (value) => value))
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) => ({ name, value, color: STATUS_COLOR[name] ?? EPROM_CHART.muted })),
    };
  }

  if (withProgress.length) {
    const only = distinct.size === 1 ? [...distinct][0] : undefined;
    return {
      kind: "hbars",
      id: "scope",
      title: `${label} Progress`,
      rows: withProgress
        .map((row) => ({ label: row.scopeName, value: round1(row.progressPercent as number) }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6),
      maxValue: 100,
      color: EPROM_CHART.green,
      suffix: "%",
      note: only ? `All ${rows.length} items are ${only.toLowerCase()} — showing recorded progress instead.` : undefined,
    };
  }

  if (rows.length) {
    const only = distinct.size === 1 ? [...distinct][0] : undefined;
    return {
      kind: "stat",
      id: "scope",
      title: `${label} Status`,
      items: [
        { value: String(rows.length), label: "Reported" },
        ...(only ? [{ value: only, label: "All items", color: STATUS_COLOR[only] }] : []),
      ],
      note: "No progress figures recorded, and no spread of statuses to chart.",
    };
  }

  return { kind: "empty", id: "scope", title: `${label} Status`, text: "No scoped items reported this month." };
}

/** A category ring earns its space only when there is more than one category. */
function categoryPanel(comments: MonthlyComment[]): AnalyticsPanel {
  const entries = Object.entries(groupCount(comments, (comment) => comment.updateType)) as [MonthlyComment["updateType"], number][];

  if (!entries.length) {
    return { kind: "empty", id: "categories", title: "Update Categories", text: "No Monthly updates included." };
  }

  if (entries.length === 1) {
    const [type, count] = entries[0];
    return {
      kind: "stat",
      id: "categories",
      title: "Update Categories",
      items: [
        { value: String(count), label: "Updates" },
        { value: typeLabel[type], label: "Single category", color: CATEGORY_COLOR[type] },
      ],
      note: "Every update this month shares one category — a breakdown would add nothing.",
    };
  }

  return {
    kind: "donut",
    id: "categories",
    title: "Update Categories",
    slices: entries
      .sort((a, b) => b[1] - a[1])
      .map(([type, value]) => ({ name: typeLabel[type], value, color: CATEGORY_COLOR[type] })),
  };
}

function groupCount<T>(rows: T[], getKey: (row: T) => string) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = getKey(row);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function round1(value: number): number {
  return Number(value.toFixed(1));
}

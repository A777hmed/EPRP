/**
 * The Executive analytics panel model.
 *
 * Executive-owned, deliberately. The Monthly panel model cannot express what a
 * portfolio dashboard needs — horizontal clustered bars, progress tracks, a
 * signed zero baseline, a ring with a total in its hole — and widening it would
 * mean editing Monthly. This model is a superset for Executive only; Monthly is
 * untouched and keeps its own.
 *
 * These are DESCRIPTORS. Screen and print render from the same array, so an
 * adaptive decision ("one category — show a KPI instead of a ring") cannot come
 * out one way on screen and another on paper. Nothing here reads the database
 * and nothing here invents a value: every builder returns a compact empty state
 * when its data does not support a chart.
 */

import { MILESTONE_STATUS_META, PRIORITY_META, PROJECT_LIFECYCLE_META } from "@/lib/constants";
import type { MilestoneStatus, MonthlyReport } from "@/types";
import {
  EXEC_HEALTH_META,
  EXEC_HEALTH_ORDER,
  PRIORITY_ORDER_DESC,
  VARIANCE_BUCKET_META,
  VARIANCE_BUCKET_ORDER,
  isApprovedMonthly,
  monthLabelOf,
  projectStatusCounts,
  riskPriorityCounts,
  varianceDistribution,
  type ExecHealth,
  type PortfolioAggregate,
  type ProjectExecutiveRow,
  type VarianceBucket,
} from "./executive-data";

/* --------------------------------- Palette --------------------------------- */

/** EPROM semantic palette. Navy is primary/planned, green is actual/positive. */
export const EXEC_PALETTE = {
  navy: "#0d59a8",
  navyDeep: "#0a3974",
  navyLight: "#9dc0e4",
  teal: "#12857a",
  green: "#2e9c43",
  amber: "#e0912a",
  red: "#c0444c",
  redDeep: "#8f2a31",
  slate: "#8fa3b8",
  track: "#eef3f8",
} as const;

export const HEALTH_COLOR: Record<ExecHealth, string> = {
  on_track: EXEC_PALETTE.green,
  at_risk: EXEC_PALETTE.amber,
  delayed: EXEC_PALETTE.red,
  critical: EXEC_PALETTE.redDeep,
  unknown: EXEC_PALETTE.slate,
};

const PRIORITY_COLOR: Record<string, string> = {
  critical: EXEC_PALETTE.redDeep,
  high: EXEC_PALETTE.red,
  medium: EXEC_PALETTE.amber,
  low: EXEC_PALETTE.green,
};

const VARIANCE_COLOR: Record<VarianceBucket, string> = {
  favourable: EXEC_PALETTE.green,
  acceptable: EXEC_PALETTE.navy,
  unfavourable: EXEC_PALETTE.red,
};

/** Governed Master Milestone status colors. `unresolved` is not a stored
 *  status — it is `state.inConflict`, kept visually distinct from `delayed`. */
const MILESTONE_STATUS_COLOR: Record<MilestoneStatus, string> = {
  not_started: EXEC_PALETTE.slate,
  in_progress: EXEC_PALETTE.navy,
  completed: EXEC_PALETTE.green,
  delayed: EXEC_PALETTE.red,
};
const UNRESOLVED_COLOR = EXEC_PALETTE.redDeep;

const LIFECYCLE_PALETTE = [
  EXEC_PALETTE.navy,
  EXEC_PALETTE.teal,
  EXEC_PALETTE.navyLight,
  EXEC_PALETTE.amber,
  EXEC_PALETTE.slate,
  EXEC_PALETTE.green,
];

/* --------------------------------- Panels ---------------------------------- */

/**
 * Columns this panel occupies out of {@link GRID_COLUMNS}.
 *
 * The dashboard is deliberately NOT a uniform grid: primary performance gets
 * width, distributions are compact, and whichever panel carries the row's
 * message dominates it. Nine equal cards read as a developer's grid, not as a
 * board report.
 */
export const GRID_COLUMNS = 20;

export interface PanelBase {
  id: string;
  title: string;
  subtitle?: string;
  note?: string;
  /** Assigned centrally by {@link buildExecutivePanels}, never per builder. */
  span?: number;
}

export interface SeriesSpec {
  key: string;
  label: string;
  color: string;
}

export type ExecPanel =
  /** Horizontal clustered bars — one row per project, one bar per series. */
  | (PanelBase & {
      kind: "hgrouped";
      rows: { label: string; values: number[] }[];
      series: SeriesSpec[];
      maxValue: number;
      suffix: string;
    })
  /** Line/area over reporting periods, with markers and end labels. */
  | (PanelBase & {
      kind: "trend";
      categories: string[];
      series: (SeriesSpec & { values: number[] })[];
      maxValue: number;
      suffix: string;
    })
  /** Ring with a total in the hole and a counted legend. */
  | (PanelBase & {
      kind: "donut";
      slices: { name: string; value: number; color: string }[];
      total: number;
      totalLabel: string;
    })
  /** Ranked horizontal bars. `track` draws a 0–max rail behind each bar. */
  | (PanelBase & {
      kind: "hbars";
      rows: { label: string; value: number; color: string }[];
      maxValue: number;
      suffix: string;
      track?: boolean;
    })
  /** Signed bars against a zero baseline, for variance. */
  | (PanelBase & {
      kind: "hvariance";
      rows: { label: string; value: number }[];
      minValue: number;
      suffix: string;
    })
  /**
   * An exception summary — counts that demand attention, not a progress chart.
   *
   * Management Attention answers "what needs leadership?", which is a list of
   * exceptions with magnitudes, not a measurement against a target. Drawing it
   * as bars made it read like every other ranked chart on the page.
   */
  | (PanelBase & {
      kind: "exception";
      items: { label: string; value: number; color: string; hint?: string }[];
      total: number;
    })
  /** A figure, where a chart would say less. */
  | (PanelBase & { kind: "stat"; items: { value: string; label: string; color?: string }[] })
  | (PanelBase & { kind: "empty"; text: string });

/* -------------------------------- Helpers ---------------------------------- */

function shortLabel(row: ProjectExecutiveRow): string {
  return row.project.shortName?.trim() || row.project.code?.trim() || row.projectName;
}

function round1(value: number): number {
  return Number(value.toFixed(1));
}

/**
 * Charts show at most this many projects.
 *
 * Eight keeps every row legible and stops one tall chart stretching its
 * neighbours into empty space — and it is the same cap on paper, so a printed
 * chart never runs past its page. Truncation is always stated in the panel's
 * note; the Project Status Overview below carries every project.
 */
const MAX_BARS = 8;

/** Says plainly that a chart is showing part of the portfolio. */
function cappedNote(total: number, ranked: string, note?: string): string | undefined {
  const parts = [
    total > MAX_BARS ? `Showing ${MAX_BARS} of ${total} projects, ${ranked}.` : undefined,
    note,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

function draftNote(rows: ProjectExecutiveRow[]): string | undefined {
  const draft = rows.filter((row) => row.basis === "draft").length;
  if (draft === 0) return undefined;
  return `Includes ${draft} unapproved Monthly position${draft === 1 ? "" : "s"}.`;
}

export interface ExecutiveAnalyticsInput {
  rows: ProjectExecutiveRow[];
  aggregate: PortfolioAggregate;
  allMonthlies: MonthlyReport[];
  visibleProjectIds: Set<string>;
  month: string;
}

/**
 * The nine panels, in the order the dashboard reads them: position, then
 * distribution, then where attention is needed.
 */
/**
 * The dashboard layout, in grid columns out of {@link GRID_COLUMNS}.
 *
 *   Row 1 — primary performance ...... 8 · 8 · 4
 *   Row 2 — distribution and risk .... 5 · 5 · 10   (risks dominate)
 *   Row 3 — management focus ......... 7 · 7 · 6
 *
 * Held here rather than in each builder so the composition can be read in one
 * place and each row provably sums to the full width.
 */
const PANEL_SPAN: Record<string, number> = {
  "planned-actual": 8,
  trend: 8,
  health: 4,
  lifecycle: 5,
  "variance-dist": 5,
  "risk-priority": 10,
  actual: 7,
  variance: 7,
  attention: 6,
  // Compact, like Schedule Health — sits in a widened last row alongside it
  // rather than claiming a row of its own (see `assignSpans`'s merge step).
  "milestone-status": 4,
};

/** No panel may shrink below this and stay legible. */
const MIN_SPAN = 4;

/**
 * How much a panel has to say, which decides how much width it earns.
 *
 * A panel with nothing to show should not hold a full card: an empty Portfolio
 * Trend beside an empty Top Risks was two large boxes of prose in a dashboard
 * that is supposed to be dense. A bar chart of ONE project is nearly as thin —
 * it repeats what the project table already states — so it yields width too.
 *
 * This is what stops the grid reading as nine equal tiles: the sizes differ
 * because the CONTENT differs, not because a designer picked numbers.
 */
function informationWeight(panel: ExecPanel): "empty" | "thin" | "full" {
  if (panel.kind === "empty") return "empty";
  if (panel.kind === "hgrouped" && panel.rows.length <= 1) return "thin";
  if (panel.kind === "hbars" && panel.rows.length <= 1) return "thin";
  if (panel.kind === "hvariance" && panel.rows.length <= 1) return "thin";
  return "full";
}

/**
 * Assign spans a row at a time, and give whatever an empty panel gives up to
 * its neighbours — so every row still fills the grid exactly.
 */
function assignSpans(panels: ExecPanel[]): ExecPanel[] {
  const out: ExecPanel[] = [];

  const rowChunks: ExecPanel[][] = [];
  for (let i = 0; i < panels.length; i += 3) {
    rowChunks.push(panels.slice(i, i + 3));
  }
  /*
   * A trailing row of exactly one panel would inherit the whole row's spare
   * width below and read as a single oversized chart — the opposite of
   * "compact". Folding it into the previous row keeps every panel sized by
   * what it has to say, not by how the panel count happens to divide by 3.
   */
  if (rowChunks.length > 1 && rowChunks[rowChunks.length - 1].length === 1) {
    const lone = rowChunks.pop();
    rowChunks[rowChunks.length - 1].push(...(lone as ExecPanel[]));
  }

  for (const row of rowChunks) {
    const weights = row.map(informationWeight);

    // Start from the designed proportions, then shrink what has little to say.
    const spans = row.map((panel, index) => {
      const base = PANEL_SPAN[panel.id] ?? 7;
      if (weights[index] === "empty") return MIN_SPAN;
      if (weights[index] === "thin") return Math.max(MIN_SPAN, base - 2);
      return base;
    });

    /*
     * Redistribute freed columns to the panels that earned them — but CAP the
     * growth. Spreading the spare evenly once handed a compact donut half the
     * row; a ring does not become more informative by getting wider. Each panel
     * may grow by at most three columns beyond its designed proportion, and the
     * spare goes first to the panel with the largest designed share, which is
     * the one built to use the width.
     */
    const cap = (index: number) => (PANEL_SPAN[row[index].id] ?? 7) + 3;
    let spare = GRID_COLUMNS - spans.reduce((sum, span) => sum + span, 0);
    const growable = spans.map((_, index) => index).filter((index) => weights[index] === "full");
    const targets = growable.length ? growable : spans.map((_, index) => index);

    while (spare > 0) {
      const eligible = targets.filter((index) => spans[index] < cap(index));
      if (eligible.length === 0) break;
      const pick = eligible.reduce(
        (best, index) => ((PANEL_SPAN[row[index].id] ?? 7) > (PANEL_SPAN[row[best].id] ?? 7) ? index : best),
        eligible[0]
      );
      spans[pick] += 1;
      spare -= 1;
    }
    // Anything still unclaimed widens the collapsed panels rather than leaving
    // a hole in the grid.
    let cursor = 0;
    while (spare > 0) {
      spans[cursor % spans.length] += 1;
      spare -= 1;
      cursor += 1;
    }
    // If the row somehow overflows, trim the widest first.
    while (spare < 0) {
      const widest = spans.indexOf(Math.max(...spans));
      spans[widest] -= 1;
      spare += 1;
    }

    row.forEach((panel, index) => out.push({ ...panel, span: spans[index] }));
  }

  return out;
}

export function buildExecutivePanels(input: ExecutiveAnalyticsInput): ExecPanel[] {
  const { rows, aggregate, allMonthlies, visibleProjectIds, month } = input;
  const reported = rows.filter((row) => row.monthly !== undefined);
  const note = draftNote(reported);

  const panels: ExecPanel[] = [
    // Row 1 — where the portfolio stands.
    plannedVsActual(reported, note),
    portfolioTrend(allMonthlies, visibleProjectIds, month),
    healthDistribution(rows),
    // Row 2 — how it distributes, and what threatens it.
    lifecycleDistribution(rows),
    varianceDistributionPanel(reported),
    topRisksByPriority(rows),
    // Row 3 — where management attention goes.
    actualProgress(reported, note),
    behindPlan(reported, note),
    attentionRanking(aggregate),
    // Row 4 (folded into Row 3 by `assignSpans` when alone) — the governed
    // register's own position, read-only.
    milestoneStatusDistribution(rows),
  ];

  return assignSpans(panels);
}

/* 1 · Planned vs Actual --------------------------------------------------- */

function plannedVsActual(rows: ProjectExecutiveRow[], note?: string): ExecPanel {
  if (rows.length === 0) {
    return {
      kind: "empty",
      id: "planned-actual",
      title: "Planned vs Actual by Project",
      text: "No Monthly position reported for any project this month.",
    };
  }

  // Widest gap first: the comparison exists to expose outliers.
  const ordered = [...rows].sort((a, b) => (a.variance ?? 0) - (b.variance ?? 0)).slice(0, MAX_BARS);

  return {
    kind: "hgrouped",
    id: "planned-actual",
    title: "Planned vs Actual by Project",
    subtitle: "Cumulative progress against plan",
    rows: ordered.map((row) => ({
      label: shortLabel(row),
      values: [round1(row.planned ?? 0), round1(row.actual ?? 0)],
    })),
    series: [
      { key: "planned", label: "Planned %", color: EXEC_PALETTE.navyLight },
      { key: "actual", label: "Actual %", color: EXEC_PALETTE.teal },
    ],
    maxValue: 100,
    suffix: "%",
    note: cappedNote(rows.length, "widest variance first", note),
  };
}

/* 2 · Portfolio trend ------------------------------------------------------ */

function portfolioTrend(
  allMonthlies: MonthlyReport[],
  visibleProjectIds: Set<string>,
  month: string
): ExecPanel {
  // Months after the selected period are excluded: a later Monthly is not part
  // of this period's official position.
  const visible = allMonthlies.filter(
    (report) => visibleProjectIds.has(report.projectId) && report.reportingMonth.slice(0, 7) <= month
  );

  const group = (reports: MonthlyReport[]) => {
    const byMonth = new Map<string, MonthlyReport[]>();
    for (const report of reports) {
      const key = report.reportingMonth.slice(0, 7);
      byMonth.set(key, [...(byMonth.get(key) ?? []), report]);
    }
    return [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };

  const approved = group(visible.filter(isApprovedMonthly));
  const useApproved = approved.length >= 2;
  const months = useApproved ? approved : group(visible);

  if (months.length < 2) {
    return {
      kind: "empty",
      id: "trend",
      title: "Portfolio Trend",
      text:
        months.length === 1
          ? "One reporting month so far — a trend needs at least two."
          : "No Monthly Reports available to trend.",
    };
  }

  const avg = (reports: MonthlyReport[], pick: (r: MonthlyReport) => number) =>
    round1(reports.reduce((sum, r) => sum + pick(r), 0) / reports.length);

  return {
    kind: "trend",
    id: "trend",
    title: "Portfolio Trend",
    subtitle: useApproved ? "Approved Monthly basis" : "Includes unapproved months",
    categories: months.map(([key]) => monthLabelOf(key).replace(/ (\d{2})(\d{2})$/, " $2").toUpperCase()),
    series: [
      {
        key: "actual",
        label: "Actual %",
        color: EXEC_PALETTE.teal,
        values: months.map(([, reports]) => avg(reports, (r) => r.actualProgress)),
      },
      {
        key: "planned",
        label: "Planned %",
        color: EXEC_PALETTE.navyLight,
        values: months.map(([, reports]) => avg(reports, (r) => r.plannedProgress)),
      },
    ],
    maxValue: 100,
    suffix: "%",
  };
}

/* 3 · Schedule health ------------------------------------------------------ */

function healthDistribution(rows: ProjectExecutiveRow[]): ExecPanel {
  const counts = EXEC_HEALTH_ORDER.map((health) => ({
    health,
    value: rows.filter((row) => row.reading.health === health).length,
  })).filter((entry) => entry.value > 0);

  if (counts.length === 0) {
    return { kind: "empty", id: "health", title: "Schedule Health Distribution", text: "No projects in view." };
  }

  /*
   * A single category still draws a ring.
   *
   * Swapping it for a text tile made the dashboard change shape with the data,
   * so a one-project portfolio looked like a different product from a
   * twenty-project one. The ring is the design; the data decides its segments.
   */
  return {
    kind: "donut",
    id: "health",
    title: "Schedule Health Distribution",
    slices: counts.map((entry) => ({
      name: EXEC_HEALTH_META[entry.health].label,
      value: entry.value,
      color: HEALTH_COLOR[entry.health],
    })),
    total: rows.length,
    totalLabel: "Total Projects",
  };
}

/* 4 · Lifecycle ------------------------------------------------------------ */

function lifecycleDistribution(rows: ProjectExecutiveRow[]): ExecPanel {
  const counts = [...projectStatusCounts(rows).entries()]
    .map(([status, value]) => ({
      name: PROJECT_LIFECYCLE_META[status as keyof typeof PROJECT_LIFECYCLE_META]?.label ?? status,
      value,
    }))
    .sort((a, b) => b.value - a.value);

  if (counts.length === 0) {
    return { kind: "empty", id: "lifecycle", title: "Project Lifecycle Status", text: "No projects in view." };
  }

  return {
    kind: "donut",
    id: "lifecycle",
    title: "Project Lifecycle Status",
    slices: counts.map((entry, index) => ({
      ...entry,
      color: LIFECYCLE_PALETTE[index % LIFECYCLE_PALETTE.length],
    })),
    total: rows.length,
    totalLabel: "Total Projects",
  };
}

/* 5 · Top risks ------------------------------------------------------------ */

function topRisksByPriority(rows: ProjectExecutiveRow[]): ExecPanel {
  const counts = riskPriorityCounts(rows);
  const bars = PRIORITY_ORDER_DESC.map((priority) => ({
    label: PRIORITY_META[priority].label,
    value: counts[priority],
    color: PRIORITY_COLOR[priority],
  })).filter((bar) => bar.value > 0);

  if (bars.length === 0) {
    return {
      kind: "empty",
      id: "risk-priority",
      title: "Top Risks by Priority",
      text: "No open risks recorded across the portfolio.",
    };
  }

  return {
    kind: "hbars",
    id: "risk-priority",
    title: "Top Risks by Priority",
    subtitle: "Open risks, ranked by severity",
    rows: bars,
    maxValue: Math.max(...bars.map((bar) => bar.value)),
    suffix: "",
  };
}

/* 6 · Variance distribution ------------------------------------------------ */

function varianceDistributionPanel(rows: ProjectExecutiveRow[]): ExecPanel {
  const counts = varianceDistribution(rows);
  const slices = VARIANCE_BUCKET_ORDER.map((bucket) => ({
    name: VARIANCE_BUCKET_META[bucket].label,
    value: counts[bucket],
    color: VARIANCE_COLOR[bucket],
  })).filter((slice) => slice.value > 0);

  if (slices.length === 0) {
    return {
      kind: "empty",
      id: "variance-dist",
      title: "Variance Distribution",
      text: "No project reported a variance this month.",
    };
  }

  return {
    kind: "donut",
    id: "variance-dist",
    title: "Variance Distribution",
    subtitle: "Acceptable = within the on-schedule tolerance",
    slices,
    total: rows.length,
    totalLabel: "Total Projects",
  };
}

/* 7 · Actual progress ------------------------------------------------------ */

function actualProgress(rows: ProjectExecutiveRow[], note?: string): ExecPanel {
  const bars = rows
    .filter((row) => typeof row.actual === "number")
    .map((row) => ({ label: shortLabel(row), value: round1(row.actual ?? 0), color: EXEC_PALETTE.teal }))
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_BARS);

  if (bars.length === 0) {
    return {
      kind: "empty",
      id: "actual",
      title: "Actual Progress by Project",
      text: "No actual progress reported this month.",
    };
  }

  return {
    kind: "hbars",
    id: "actual",
    title: "Actual Progress by Project",
    subtitle: "Cumulative actual %",
    rows: bars,
    maxValue: 100,
    suffix: "%",
    track: true,
    note: cappedNote(rows.filter((row) => typeof row.actual === "number").length, "highest first", note),
  };
}

/* 8 · Behind plan ---------------------------------------------------------- */

function behindPlan(rows: ProjectExecutiveRow[], note?: string): ExecPanel {
  const behind = rows
    .filter((row) => (row.variance ?? 0) < 0)
    .map((row) => ({ label: shortLabel(row), value: round1(row.variance ?? 0) }))
    .sort((a, b) => a.value - b.value)
    .slice(0, MAX_BARS);

  const atOrAhead = rows.filter((row) => (row.variance ?? 0) >= 0).length;

  if (behind.length === 0) {
    return {
      kind: "empty",
      id: "variance",
      title: "Behind Plan",
      text: rows.length
        ? `No project is behind plan — all ${rows.length} reported at or ahead of schedule.`
        : "No Monthly position reported this month.",
    };
  }

  return {
    kind: "hvariance",
    id: "variance",
    title: "Behind Plan (percentage points)",
    subtitle: "Schedule variance against plan",
    rows: behind,
    minValue: Math.min(...behind.map((row) => row.value)),
    suffix: "",
    note: cappedNote(
      rows.filter((row) => (row.variance ?? 0) < 0).length,
      "furthest behind first",
      [atOrAhead ? `${atOrAhead} project${atOrAhead === 1 ? "" : "s"} at or ahead of plan.` : undefined, note]
        .filter(Boolean)
        .join(" ") || undefined
    ),
  };
}

/* 9 · Management attention -------------------------------------------------- */

/**
 * The exception list, in the order leadership acts on it.
 *
 * Every line is shown even at zero, so the reader can see that a category was
 * checked and found clear — a disappearing row is indistinguishable from a
 * category nobody measured.
 */
function attentionRanking(aggregate: PortfolioAggregate): ExecPanel {
  const items = [
    { label: "Decisions Required", value: aggregate.openDecisions, color: EXEC_PALETTE.redDeep },
    { label: "Overdue Actions", value: aggregate.overdueActions, color: EXEC_PALETTE.red },
    { label: "Open Risks", value: aggregate.openRisks, color: EXEC_PALETTE.amber },
    { label: "Client Dependencies", value: aggregate.clientPendingActions, color: EXEC_PALETTE.navy },
    { label: "Open Actions", value: aggregate.openActionsTotal, color: EXEC_PALETTE.slate },
  ];

  return {
    kind: "exception",
    id: "attention",
    title: "Management Attention",
    subtitle: "Open exceptions across the portfolio",
    items,
    total: items.reduce((sum, item) => sum + item.value, 0),
  };
}

/* 10 · Governed Master Milestone status -------------------------------------- */

/**
 * Governed Master Milestone status, portfolio-wide.
 *
 * Counts `row.milestoneStates` — already derived by `milestone-state.ts`, the
 * same frozen logic Weekly, Monthly and the Project Executive drill-down read.
 * No progress is averaged or weighted here; this is a distribution of the
 * OFFICIAL status field only, one governed milestone contributing to exactly
 * one slice. A milestone with `inConflict` is counted under "Unresolved"
 * instead of its nominal status — it has no resolved official state yet.
 */
function milestoneStatusDistribution(rows: ProjectExecutiveRow[]): ExecPanel {
  const states = rows.flatMap((row) => row.milestoneStates);

  if (states.length === 0) {
    return {
      kind: "empty",
      id: "milestone-status",
      title: "Governed Master Milestone Status",
      text: "No active Master Milestones are recorded for the visible projects.",
    };
  }

  const counts = new Map<MilestoneStatus | "unresolved", number>();
  for (const state of states) {
    const key = state.inConflict ? "unresolved" : state.status;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const order: (MilestoneStatus | "unresolved")[] = [
    "not_started",
    "in_progress",
    "completed",
    "delayed",
    "unresolved",
  ];
  const slices = order
    .map((key) => {
      const value = counts.get(key) ?? 0;
      if (value === 0) return undefined;
      if (key === "unresolved") return { name: "Unresolved", value, color: UNRESOLVED_COLOR };
      return { name: MILESTONE_STATUS_META[key].label, value, color: MILESTONE_STATUS_COLOR[key] };
    })
    .filter((slice): slice is { name: string; value: number; color: string } => Boolean(slice));

  return {
    kind: "donut",
    id: "milestone-status",
    title: "Governed Master Milestone Status",
    subtitle: "Official position, as approved by Project Control",
    slices,
    total: states.length,
    totalLabel: "Total Milestones",
  };
}

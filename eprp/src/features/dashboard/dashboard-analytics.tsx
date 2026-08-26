"use client";

/**
 * Dashboard analytics — the chart surface of the Control Center.
 *
 * Everything here is derived by `dashboard-data.ts` and handed in as props.
 * Nothing is fetched, recomputed or invented: the KPI strip and every panel
 * read the SAME scoped positions/totals the page already computed, so one card
 * can never disagree with another.
 *
 * THE COMPOSITION ADAPTS TO WHAT THE PLATFORM ACTUALLY HOLDS. A panel whose
 * dataset is too thin swaps to a different REAL reading in the same slot at the
 * same visual weight, or removes itself. It never reserves a chart's worth of
 * blank canvas and never draws an empty axis — an empty axis reads as "zero",
 * which is a different and wrong statement.
 */

import * as React from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CircleCheck, TriangleAlert } from "lucide-react";

import {
  HEALTH_META,
  round,
  type DashboardMilestone,
  type PortfolioTotals,
  type ProjectPosition,
  type TrendPoint,
} from "./dashboard-data";

/* --------------------------------- Chrome ---------------------------------- */

/* Chart chrome reads the workspace tokens, so axes follow the theme with no JS
   theme detection — a hardcoded light hex would glow on the dark ground. */
const AXIS = { fontSize: 10, fill: "var(--dash-muted)" } as const;
const GRID = "var(--dash-hairline)";
const PLANNED = "var(--dash-chart-planned)";
const ACTUAL = "var(--dash-chart-actual)";

type HealthKey = ProjectPosition["health"];
type Tone = "success" | "warning" | "behind" | "danger" | "default";

/* ================================ KPI strip ================================= */

/**
 * Five blocks, five DIFFERENT marks — ring, ring, columns, sparkline, status
 * icon. Two rings on purpose: they read as a matched pair of rate metrics, and
 * the three that follow deliberately break the rhythm so the strip cannot be
 * skimmed as one repeated card.
 */
export function KpiStrip({
  totals,
  trend,
  overdueWeekly,
  overdueMonthly,
}: {
  totals: PortfolioTotals;
  trend: TrendPoint[];
  overdueWeekly: number;
  overdueMonthly: number;
}) {
  const coverage = totals.totalProjects
    ? Math.round((totals.reportedProjects / totals.totalProjects) * 100)
    : undefined;
  const bands = healthRows(totals);
  const spark = trend.filter((point) => point.variance !== undefined);

  return (
    <section className="dash-kpis" aria-label="Portfolio summary">
      {/* 1 — ring */}
      <article className="dash-kpi">
        <div className="dash-kpi-text">
          <span>Portfolio Progress</span>
          <b>{totals.actual === undefined ? "—" : `${round(totals.actual)}%`}</b>
          <small>Planned {totals.planned === undefined ? "—" : `${round(totals.planned)}%`}</small>
          <Delta series={trend} field="actual" enabled={totals.actual !== undefined} />
        </div>
        <Ring value={totals.actual} tone="primary" label="Portfolio actual progress" />
      </article>

      {/* 2 — ring, paired with the first */}
      <article className="dash-kpi">
        <div className="dash-kpi-text">
          <span>Reporting Coverage</span>
          <b>{coverage === undefined ? "—" : `${coverage}%`}</b>
          <small>
            {totals.totalProjects
              ? `${totals.reportedProjects} of ${totals.totalProjects} projects`
              : "No projects in view"}
          </small>
          <p className="dash-kpi-note">
            {totals.notReported ? `${totals.notReported} without a basis` : "Every project reporting"}
          </p>
        </div>
        <Ring value={coverage} tone="success" label="Reporting coverage" />
      </article>

      {/* 3 — mini vertical bars */}
      <article className="dash-kpi">
        <div className="dash-kpi-text">
          <span>Projects On Track</span>
          <b>{totals.onTrack}</b>
          <small>of {totals.totalProjects} in view</small>
          <p className="dash-kpi-note">
            {bands.length ? `${bands.length} status ${plural(bands.length, "band")} present` : "Nothing to rank"}
          </p>
        </div>
        <div className="dash-kpi-columns" role="img" aria-label={healthSummary(bands)}>
          {bands.length ? (
            bands.map((row) => (
              <i
                key={row.key}
                className={`is-${row.tone}`}
                style={{ "--h": `${columnHeight(row.value, totals.totalProjects)}%` } as React.CSSProperties}
                title={`${row.label}: ${row.value}`}
              />
            ))
          ) : (
            <i className="is-default" style={{ "--h": "14%" } as React.CSSProperties} />
          )}
        </div>
      </article>

      {/* 4 — sparkline */}
      <article className="dash-kpi">
        <div className="dash-kpi-text">
          <span>Schedule Variance</span>
          <b className={`is-${varianceTone(totals.variance)}`}>{signed(totals.variance)}</b>
          <small>Actual less planned</small>
          <Delta series={trend} field="variance" unit="pts" enabled={totals.variance !== undefined} />
        </div>
        <div className="dash-kpi-spark" role="img" aria-label="Schedule variance across recent reporting weeks">
          {spark.length >= 2 ? (
            <ResponsiveContainer width="100%" height={42}>
              <AreaChart data={spark} margin={{ top: 4, right: 0, bottom: 2, left: 0 }}>
                <defs>
                  <linearGradient id="dashSparkFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ACTUAL} stopOpacity={0.34} />
                    <stop offset="100%" stopColor={ACTUAL} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="variance"
                  stroke={ACTUAL}
                  strokeWidth={1.75}
                  fill="url(#dashSparkFill)"
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <span className="dash-kpi-flat" aria-hidden />
          )}
        </div>
      </article>

      {/* 5 — a STATE, so a status icon rather than a chart */}
      <article className={`dash-kpi ${totals.overdueReports ? "is-danger" : "is-clear"}`}>
        <div className="dash-kpi-text">
          <span>Overdue Reports</span>
          <b className={totals.overdueReports ? "is-danger" : "is-success"}>{totals.overdueReports}</b>
          <small>Past period end, not approved</small>
          <p className={`dash-kpi-note ${totals.overdueReports ? "is-danger" : ""}`}>
            {totals.overdueReports
              ? `${overdueWeekly} Weekly · ${overdueMonthly} Monthly`
              : "Reporting is current"}
          </p>
        </div>
        <div className="dash-kpi-status" aria-hidden>
          {totals.overdueReports ? <TriangleAlert /> : <CircleCheck />}
        </div>
      </article>
    </section>
  );
}

/* =============================== Main row ================================== */

/**
 * Left panel. A trend is the preferred reading, but it needs at least two
 * reporting weeks — one week is a POSITION, not a trend. Below that the panel
 * swaps to a per-project planned-against-actual comparison: the same fact,
 * compared across projects instead of across weeks, at the same visual weight.
 */
export function TrendPanel({
  positions,
  trend,
}: {
  positions: ProjectPosition[];
  trend: TrendPoint[];
}) {
  const reduced = useReducedMotion();
  const [visible, setVisible] = React.useState({ planned: true, actual: true });
  const reported = positions.filter(
    (position) => position.planned !== undefined && position.actual !== undefined
  );

  if (trend.length < 2) {
    if (reported.length === 0) {
      return (
        <Panel title="Project Performance" hint="Planned against actual">
          <PanelEmpty>
            No project in view has reported planned and actual progress for this period.
          </PanelEmpty>
        </Panel>
      );
    }

    /* The basis is DERIVED, never asserted. This branch also fires when there
       is no weekly at all — a monthly-only portfolio — so hardcoding "single
       reporting week" would state a week that does not exist. */
    const bases = new Set(reported.map((position) => position.basis));
    const basis =
      bases.size > 1
        ? "mixed Weekly and Monthly basis"
        : bases.has("monthly")
          ? "latest Monthly per project"
          : trend.length === 1
            ? "single reporting week"
            : "latest Weekly per project";

    const rows = reported.slice(0, 7).map((position) => ({
      name: position.basis === "monthly" ? `${shortName(position)} (M)` : shortName(position),
      Planned: round(position.planned as number),
      Actual: round(position.actual as number),
    }));

    return (
      <Panel
        title="Planned vs Actual"
        hint={`${reported.length} reporting ${plural(reported.length, "project")} · ${basis}`}
      >
        <div className="dash-plot" role="img" aria-label="Planned against actual progress by project">
          <ResponsiveContainer width="100%" height={214}>
            <BarChart layout="vertical" data={rows} margin={{ top: 4, right: 24, bottom: 0, left: 4 }} barGap={3}>
              <CartesianGrid stroke={GRID} horizontal={false} />
              <XAxis type="number" unit="%" domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" width={96} tick={AXIS} tickLine={false} axisLine={false} />
              <Tooltip formatter={percent} cursor={{ fill: "var(--dash-surface-2)" }} />
              <Bar dataKey="Planned" fill={PLANNED} radius={[0, 3, 3, 0]} maxBarSize={10} isAnimationActive={!reduced} />
              <Bar dataKey="Actual" fill={ACTUAL} radius={[0, 3, 3, 0]} maxBarSize={10} isAnimationActive={!reduced} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <PlotKeys visible={{ planned: true, actual: true }} onToggle={() => {}} readOnly />
      </Panel>
    );
  }

  return (
    <Panel title="Project Progress Trend" hint="Planned against actual, by reporting week">
      <div className="dash-plot" role="img" aria-label="Planned and actual progress by reporting week">
        <ResponsiveContainer width="100%" height={214}>
          <AreaChart data={trend} margin={{ top: 10, right: 14, bottom: 0, left: -16 }}>
            <defs>
              <linearGradient id="dashActualFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ACTUAL} stopOpacity={0.22} />
                <stop offset="100%" stopColor={ACTUAL} stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} dy={4} />
            <YAxis unit="%" domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} width={44} />
            <Tooltip formatter={percent} cursor={{ stroke: GRID }} />
            {visible.planned && (
              <Area
                type="monotone"
                dataKey="planned"
                name="Planned"
                stroke={PLANNED}
                strokeWidth={1.75}
                strokeDasharray="5 4"
                fill="transparent"
                dot={false}
                isAnimationActive={!reduced}
                animationDuration={600}
              />
            )}
            {visible.actual && (
              <Area
                type="monotone"
                dataKey="actual"
                name="Actual"
                stroke={ACTUAL}
                strokeWidth={2.25}
                fill="url(#dashActualFill)"
                dot={{ r: 2.5, fill: ACTUAL, strokeWidth: 0 }}
                activeDot={{ r: 4.5 }}
                isAnimationActive={!reduced}
                animationDuration={700}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <PlotKeys
        visible={visible}
        onToggle={(key) => setVisible((state) => ({ ...state, [key]: !state[key] }))}
      />
    </Panel>
  );
}

/** Centre panel — the distribution, with the scope total in the hole. */
export function StatusPanel({ totals }: { totals: PortfolioTotals }) {
  const reduced = useReducedMotion();
  const [focus, setFocus] = React.useState<HealthKey | null>(null);
  const bands = healthRows(totals);
  const focused = bands.find((row) => row.key === focus);

  return (
    <Panel title="Projects by Status" hint="Schedule health in scope">
      {bands.length === 0 ? (
        <PanelEmpty>No projects match the current filters.</PanelEmpty>
      ) : (
        <div className="dash-donut">
          <div className="dash-donut-plot" role="img" aria-label={healthSummary(bands)}>
            <ResponsiveContainer width="100%" height={186}>
              <PieChart>
                <Pie
                  data={bands}
                  dataKey="value"
                  nameKey="label"
                  innerRadius={58}
                  outerRadius={82}
                  paddingAngle={bands.length > 1 ? 2 : 0}
                  stroke="var(--dash-surface)"
                  strokeWidth={2}
                  isAnimationActive={!reduced}
                  animationDuration={700}
                  onMouseEnter={(_, index) => setFocus(bands[index]?.key ?? null)}
                  onMouseLeave={() => setFocus(null)}
                >
                  {bands.map((row) => (
                    <Cell
                      key={row.key}
                      fill={`var(--dash-health-${row.tone})`}
                      opacity={focus === null || focus === row.key ? 1 : 0.2}
                    />
                  ))}
                </Pie>
                {/* No floating <Tooltip>: a Recharts tooltip follows the cursor
                    and lands squarely on the hole, hiding the very figure the
                    hole exists to show. The readout is pinned above the chart
                    instead, where it can never occlude the centre. */}
              </PieChart>
            </ResponsiveContainer>
            <div className="dash-donut-hole" aria-hidden>
              <b>{totals.totalProjects}</b>
              <span>Projects</span>
            </div>
          </div>
          <p className="dash-donut-readout" aria-live="polite">
            {focused ? (
              <>
                <i className={`is-${focused.tone}`} aria-hidden />
                <b>{focused.label}</b>
                <span>
                  {focused.value} {plural(focused.value, "project")} ·{" "}
                  {share(focused.value, totals.totalProjects)}%
                </span>
              </>
            ) : (
              <span className="is-hint">Hover a segment for detail</span>
            )}
          </p>
          <ul className="dash-keys">
            {bands.map((row) => (
              <li key={row.key}>
                <button
                  type="button"
                  aria-pressed={focus === row.key}
                  onMouseEnter={() => setFocus(row.key)}
                  onMouseLeave={() => setFocus(null)}
                  onClick={() => setFocus((current) => (current === row.key ? null : row.key))}
                >
                  <i className={`is-${row.tone}`} aria-hidden />
                  <span>{row.label}</span>
                  <b>{row.value}</b>
                  <em>({share(row.value, totals.totalProjects)}%)</em>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

/**
 * Right panel — a radar over portfolio health.
 *
 * EVERY AXIS IS A REAL RATIO the platform already computes. The blueprint's own
 * radar runs Schedule / Budget / Quality / Resources / Risks; EPROM records
 * none of the last four, so those axes are not drawn. What IS recorded is
 * whether projects are on plan, whether they are reporting at all, how far
 * they have actually got, whether anything is overdue, and whether dated
 * milestones are still ahead of their date — five compliance ratios, each
 * already derived elsewhere on this page.
 *
 * The TARGET ring is not a guess. For Progress Attainment it is the plan's own
 * figure (`totals.planned`). For the four compliance ratios the target is 100%
 * by definition — every project reporting, nothing overdue, nothing late. An
 * axis is omitted entirely when its input does not exist, so the polygon never
 * dips toward zero merely because a dataset is absent.
 */
export interface HealthAxis {
  axis: string;
  current: number;
  target: number;
  detail: string;
}

export function HealthPanel({ axes }: { axes: HealthAxis[] }) {
  const reduced = useReducedMotion();

  /* Below three axes a radar has no polygon to draw. */
  if (axes.length < 3) {
    return (
      <Panel title="Project Health" hint="Portfolio health dimensions">
        <PanelEmpty>
          {axes.length === 0
            ? "No health dimension can be derived for the current scope."
            : `Only ${axes.length} health ${plural(axes.length, "dimension")} can be derived for this scope — a radar needs at least three.`}
        </PanelEmpty>
      </Panel>
    );
  }

  return (
    <Panel title="Project Health" hint={`${axes.length} derived dimensions`}>
      <div className="dash-radar" role="img" aria-label={axes.map((a) => `${a.axis} ${a.current}%`).join(", ")}>
        <ResponsiveContainer width="100%" height={222}>
          <RadarChart data={axes} outerRadius="78%" margin={{ top: 10, right: 20, bottom: 6, left: 20 }}>
            <PolarGrid stroke={GRID} />
            <PolarAngleAxis
              dataKey="axis"
              tick={{ fontSize: 11, fill: "var(--dash-ink-soft)", fontWeight: 600 }}
            />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Radar
              name="Target"
              dataKey="target"
              stroke={PLANNED}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              fill="none"
              isAnimationActive={!reduced}
              animationDuration={650}
            />
            <Radar
              name="Current"
              dataKey="current"
              stroke={ACTUAL}
              strokeWidth={2}
              fill={ACTUAL}
              fillOpacity={0.16}
              isAnimationActive={!reduced}
              animationDuration={750}
            />
            <Tooltip formatter={percent} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <div className="dash-plotkeys">
        <span className="dash-plotkey is-actual">
          <i aria-hidden />
          Current
        </span>
        <span className="dash-plotkey is-planned">
          <i aria-hidden />
          Target
        </span>
      </div>
    </Panel>
  );
}

/**
 * Secondary analytics — where each project has actually got to.
 *
 * A horizontal bar per project reads the figure against a labelled 0-100 track.
 * The ring this replaces was misleading: a full-circumference arc at 65% still
 * looked like a completed circle.
 */
export function ProgressByProjectPanel({ positions }: { positions: ProjectPosition[] }) {
  const rows = positions
    .filter((position) => position.actual !== undefined)
    .sort((a, b) => (b.actual as number) - (a.actual as number))
    .slice(0, 6);

  return (
    <Panel
      title="Progress by Project"
      hint="Actual reported progress"
      className={rows.length ? "dash-progress" : "dash-progress is-collapsed"}
    >
      {rows.length === 0 ? (
        <PanelEmpty>No project in view has reported actual progress.</PanelEmpty>
      ) : (
        <ul className="dash-bars is-progress">
          {rows.map((position) => {
            const value = round(position.actual as number);
            return (
              <li key={position.project.id}>
                <span className="dash-bar-name" title={position.project.name}>
                  {position.project.name}
                </span>
                <b className={`is-${toneOf(position)}`}>{value}%</b>
                <span
                  className="dash-bar-track is-solid"
                  role="progressbar"
                  aria-label={`${position.project.name} actual progress`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={value}
                >
                  <i
                    className={`is-${toneOf(position)}`}
                    style={{ "--p": `${clamp(value)}%` } as React.CSSProperties}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* =============================== Lower row ================================= */

/**
 * Milestone progress, read from LIFECYCLE STAGE rather than a percentage.
 *
 * `DashboardMilestone.percentComplete` is declared optional on the type but
 * `loadUpcomingMilestones` never populates it from either plan table — so a
 * panel filtered on it renders empty 100% of the time. A completed-over-total
 * ratio is no better: the feed is queried `gte(due, today)`, so it holds only
 * UPCOMING milestones and any such ratio would sit near zero by construction.
 *
 * `status` is real and per-row, so the track encodes the stage it actually
 * reports — recorded, in progress, complete — and the label states that stage
 * in words. Three discrete segments, no invented number.
 */
const STAGES: Record<string, { step: number; label: string; tone: Tone }> = {
  not_started: { step: 1, label: "Not Started", tone: "default" },
  planned: { step: 1, label: "Planned", tone: "default" },
  in_progress: { step: 2, label: "In Progress", tone: "warning" },
  delayed: { step: 2, label: "Delayed", tone: "danger" },
  at_risk: { step: 2, label: "At Risk", tone: "danger" },
  completed: { step: 3, label: "Completed", tone: "success" },
  done: { step: 3, label: "Completed", tone: "success" },
};

export function MilestonePanel({ milestones }: { milestones: DashboardMilestone[] }) {
  const rows = milestones.slice(0, 5);

  return (
    <Panel
      title="Milestone Progress"
      hint="Lifecycle stage"
      href="/weekly-reports"
      className={rows.length ? "dash-milestones" : "dash-milestones is-collapsed"}
    >
      {rows.length === 0 ? (
        <PanelEmpty>No dated milestone is recorded ahead of today for this scope.</PanelEmpty>
      ) : (
        <ul className="dash-bars">
          {rows.map((milestone) => {
            const stage = STAGES[milestone.status] ?? {
              step: 1,
              label: titleCase(milestone.status),
              tone: "default" as Tone,
            };
            return (
              <li key={milestone.id}>
                <span className="dash-bar-name" title={`${milestone.title} — ${milestone.projectName}`}>
                  {milestone.title}
                </span>
                <b className={`is-${stage.tone}`}>{stage.label}</b>
                <span
                  className="dash-bar-track"
                  role="img"
                  aria-label={`${milestone.title}: stage ${stage.step} of 3, ${stage.label}`}
                >
                  {[1, 2, 3].map((step) => (
                    <i
                      key={step}
                      className={step <= stage.step ? `is-${stage.tone}` : undefined}
                      style={{ "--d": `${step * 90}ms` } as React.CSSProperties}
                    />
                  ))}
                </span>
                <small>{milestone.projectName}</small>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* ================================ Fragments ================================= */

export function Panel({
  title,
  hint,
  href,
  linkLabel = "View All",
  className,
  children,
}: {
  title: string;
  hint?: string;
  href?: string;
  linkLabel?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={["dash-panel", className].filter(Boolean).join(" ")}>
      <header>
        <div>
          <b>{title}</b>
          {hint && <small>{hint}</small>}
        </div>
        {href && (
          <Link href={href} className="dash-link">
            {linkLabel}
          </Link>
        )}
      </header>
      <div className="dash-panel-body">{children}</div>
    </section>
  );
}

export function PanelEmpty({ children }: { children: React.ReactNode }) {
  return <p className="dash-note">{children}</p>;
}

/** Rotated so it fills clockwise from twelve o'clock. */
function Ring({
  value,
  tone,
  label,
}: {
  value: number | undefined;
  tone: "primary" | "success";
  label: string;
}) {
  const circumference = 2 * Math.PI * 25;
  const filled = value === undefined ? 0 : (clamp(value) / 100) * circumference;
  return (
    <svg
      className={`dash-ring is-${tone}`}
      viewBox="0 0 60 60"
      role="img"
      aria-label={`${label}: ${value === undefined ? "no data" : `${round(value)} percent`}`}
    >
      <circle className="dash-ring-track" cx="30" cy="30" r="25" />
      {value !== undefined && (
        <circle
          className="dash-ring-fill"
          cx="30"
          cy="30"
          r="25"
          strokeDasharray={`${filled} ${circumference}`}
        />
      )}
    </svg>
  );
}

function PlotKeys({
  visible,
  onToggle,
  readOnly,
}: {
  visible: { planned: boolean; actual: boolean };
  onToggle: (key: "planned" | "actual") => void;
  readOnly?: boolean;
}) {
  const entries = [
    { key: "planned" as const, label: "Planned Progress" },
    { key: "actual" as const, label: "Actual Progress" },
  ];
  return (
    <div className="dash-plotkeys">
      {entries.map((entry) =>
        readOnly ? (
          <span key={entry.key} className={`dash-plotkey is-${entry.key}`}>
            <i aria-hidden />
            {entry.label}
          </span>
        ) : (
          <button
            key={entry.key}
            type="button"
            className={`dash-plotkey is-${entry.key}`}
            aria-pressed={visible[entry.key]}
            onClick={() => onToggle(entry.key)}
          >
            <i aria-hidden />
            {entry.label}
          </button>
        )
      )}
    </div>
  );
}

/**
 * Week-on-week movement, from the SAME series the chart plots.
 *
 * `enabled` gates it on the figure it sits under. The weekly series and the
 * headline are not always drawn from the same population — `positionsFor`
 * falls back to Monthly reports, which the weekly series knows nothing about —
 * so an ungated delta could annotate an em-dash with "↑ 2.4% vs last week".
 * A delta must never describe a value it did not derive.
 */
function Delta({
  series,
  field,
  unit = "%",
  enabled = true,
}: {
  series: TrendPoint[];
  field: "actual" | "variance";
  unit?: string;
  enabled?: boolean;
}) {
  const points = series.filter((point) => point[field] !== undefined);
  if (!enabled) return <p className="dash-kpi-note">No comparable prior week</p>;
  if (points.length < 2) return <p className="dash-kpi-note">No prior reporting week</p>;

  const change = round((points[points.length - 1][field] as number) - (points[points.length - 2][field] as number));
  if (change === 0) return <p className="dash-kpi-note">Unchanged vs last week</p>;

  return (
    <p className={`dash-kpi-delta ${change > 0 ? "is-up" : "is-down"}`}>
      <span aria-hidden>{change > 0 ? "↑" : "↓"}</span>
      {`${Math.abs(change)}${unit} vs last week`}
    </p>
  );
}

/* --------------------------------- Helpers --------------------------------- */

function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function shortName(position: ProjectPosition): string {
  return position.project.shortName || position.project.code || position.project.name;
}

function toneOf(position: ProjectPosition): Tone {
  const tone = HEALTH_META[position.health].tone;
  return tone === "info" ? "default" : (tone as Tone);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function share(value: number, total: number): number {
  return total ? Math.round((value / total) * 100) : 0;
}

/** Floored so a band holding one project still shows a readable column. */
function columnHeight(value: number, total: number): number {
  if (!total) return 14;
  return Math.max(22, Math.round((value / total) * 100));
}

function signed(value: number | undefined): string {
  if (value === undefined) return "—";
  return `${value > 0 ? "+" : ""}${round(value)}%`;
}

function varianceTone(value: number | undefined): Tone {
  if (value === undefined) return "default";
  if (value >= -3) return "success";
  if (value >= -10) return "warning";
  return "danger";
}

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function percent(value: unknown): string {
  return typeof value === "number" ? `${value}%` : String(value ?? "—");
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

/** The bands actually present, in severity order. Empty bands are dropped so a
    legend never lists a status nothing is in. */
function healthRows(totals: PortfolioTotals): Array<{
  key: HealthKey;
  label: string;
  value: number;
  tone: Tone;
}> {
  const rows: Array<{ key: HealthKey; label: string; value: number; tone: Tone }> = [
    { key: "on_track", label: HEALTH_META.on_track.label, value: totals.onTrack, tone: "success" },
    { key: "at_risk", label: HEALTH_META.at_risk.label, value: totals.atRisk, tone: "warning" },
    { key: "behind", label: HEALTH_META.behind.label, value: totals.behind, tone: "behind" },
    { key: "critical", label: HEALTH_META.critical.label, value: totals.critical, tone: "danger" },
    { key: "not_reported", label: HEALTH_META.not_reported.label, value: totals.notReported, tone: "default" },
  ];
  return rows.filter((row) => row.value > 0);
}

function healthSummary(rows: ReturnType<typeof healthRows>): string {
  return rows.length ? rows.map((row) => `${row.label}: ${row.value}`).join(", ") : "No projects in view";
}

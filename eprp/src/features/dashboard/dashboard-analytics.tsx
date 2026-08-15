"use client";

/**
 * Dashboard analytics — an application surface, not a report page.
 *
 * THE COMPOSITION ADAPTS TO THE PORTFOLIO SIZE, which is the whole point.
 *
 * A grouped bar chart is the right way to COMPARE projects. With one project it
 * is one bar floating in a white canvas: a chart that communicates a single
 * number, which a KPI communicates better. So below three reporting projects
 * the section switches to compact executive visuals — bullet bars, a variance
 * gauge, a status strip — and above it expands into ranking and comparison
 * charts. The page therefore looks deliberate at 1 project and at 20.
 *
 * Nothing here reads or derives data. It renders the positions and totals the
 * Dashboard already computed; no calculation is duplicated or changed.
 */

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  HEALTH_META,
  round,
  type PortfolioTotals,
  type ProjectPosition,
  type TrendPoint,
} from "./dashboard-data";

/** Below this, comparison charts have nothing to compare. */
const COMPARISON_THRESHOLD = 3;

/*
 * Chart chrome reads from the SAME tokens as the rest of the Control Center.
 *
 * These were hardcoded light values (`#7d8fa4` ticks on an `#eef2f7` grid),
 * which meant every Recharts axis and gridline stayed light-mode while the
 * surrounding card went dark — pale grey rules glowing on a navy card. CSS
 * custom properties resolve inside SVG presentation attributes, so the charts
 * now follow the theme with no JS theme detection.
 */
const AXIS = { fontSize: 10, fill: "var(--dash-muted)" } as const;
const GRID = "var(--dash-edge)";
const SERIES_PLANNED = "var(--dash-tint-blue)";
const SERIES_ACTUAL = "var(--dash-blue)";
const CURSOR_FILL = "var(--dash-surface-2)";

export function DashboardAnalytics({
  positions,
  totals,
  trend,
}: {
  positions: ProjectPosition[];
  totals: PortfolioTotals;
  trend: TrendPoint[];
}) {
  const reported = positions.filter((p) => p.planned !== undefined && p.actual !== undefined);
  const comparison = reported.length >= COMPARISON_THRESHOLD;

  return (
    <>
      <Card
        title="Progress against plan"
        hint={comparison ? "Per project, cumulative" : "Actual against planned"}
        span={5}
      >
        {reported.length === 0 ? (
          <Empty>No project in view has reported progress for this period.</Empty>
        ) : comparison ? (
          <ResponsiveContainer width="100%" height={198}>
            <BarChart
              data={reported.map((p) => ({
                name: shortName(p),
                Planned: round(p.planned as number),
                Actual: round(p.actual as number),
              }))}
              margin={{ top: 4, right: 4, bottom: 0, left: -22 }}
              barGap={2}
            >
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} />
              <YAxis unit="%" tick={AXIS} tickLine={false} axisLine={false} width={38} />
              <Tooltip formatter={pct} cursor={{ fill: CURSOR_FILL }} />
              <Legend wrapperStyle={{ fontSize: 10 }} iconType="circle" iconSize={7} />
              <Bar dataKey="Planned" fill={SERIES_PLANNED} radius={[2, 2, 0, 0]} maxBarSize={22} />
              <Bar dataKey="Actual" fill={SERIES_ACTUAL} radius={[2, 2, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          /* One or two projects: a bullet bar reads the same fact in a fraction
             of the space, and leaves no empty canvas. */
          <ul className="dash-bullets">
            {reported.map((p) => (
              <li key={p.project.id}>
                <div className="dash-bullet-head">
                  <b>{p.project.name}</b>
                  <span className={`dash-delta is-${HEALTH_META[p.health].tone}`}>
                    {signed(p.variance as number)}
                  </span>
                </div>
                <div
                  className="dash-bullet-track"
                  role="img"
                  aria-label={`Actual ${round(p.actual as number)} percent against planned ${round(p.planned as number)} percent`}
                >
                  <i className="dash-bullet-plan" style={{ width: `${clamp(p.planned as number)}%` }} />
                  <i
                    className="dash-bullet-actual"
                    style={{
                      width: `${clamp(p.actual as number)}%`,
                      background: HEALTH_META[p.health].color,
                    }}
                  />
                  <i className="dash-bullet-marker" style={{ left: `${clamp(p.planned as number)}%` }} />
                </div>
                {/* A labelled scale under the track, so the bar is read against
                    0–100 rather than as an unquantified fill. */}
                <div className="dash-bullet-scale" aria-hidden>
                  <span>0</span>
                  <span>25</span>
                  <span>50</span>
                  <span>75</span>
                  <span>100</span>
                </div>
                <div className="dash-bullet-foot">
                  <span>
                    Actual <b>{round(p.actual as number)}%</b>
                  </span>
                  <span>
                    Planned <b>{round(p.planned as number)}%</b>
                  </span>
                  <span className={`dash-bullet-state is-${HEALTH_META[p.health].tone}`}>
                    {HEALTH_META[p.health].label}
                  </span>
                  <span className="dash-bullet-basis">
                    {p.basis === "weekly" ? "Latest Weekly" : "Monthly"}
                    {p.reportedOn ? ` · ${p.reportedOn}` : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Schedule variance trend" hint="Actual less planned, by reporting week" span={4}>
        {trend.length >= 2 ? (
          <ResponsiveContainer width="100%" height={198}>
            <LineChart data={trend} margin={{ top: 6, right: 8, bottom: 0, left: -22 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
              <YAxis unit="%" tick={AXIS} tickLine={false} axisLine={false} width={38} />
              <Tooltip formatter={pct} cursor={{ stroke: "var(--dash-edge)" }} />
              <Line
                type="monotone"
                dataKey="variance"
                name="Variance"
                stroke={SERIES_ACTUAL}
                strokeWidth={2}
                dot={{ r: 2.5, fill: SERIES_ACTUAL }}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          /*
            One reporting week is a POSITION, not a trend. Show the position —
            with a labelled scale, so the bar reads as a measurement against
            ±20 points rather than as an unquantified decoration.
          */
          <div className="dash-gauge">
            <div className="dash-gauge-top">
              <span className="dash-gauge-label">Current variance</span>
              <b className={`dash-gauge-value is-${varianceTone(totals.variance)}`}>
                {totals.variance === undefined ? "—" : signed(totals.variance)}
              </b>
            </div>
            <div className="dash-gauge-track" aria-hidden>
              <i className="dash-gauge-zero" />
              <i
                className={`dash-gauge-fill is-${varianceTone(totals.variance)}`}
                style={gaugeStyle(totals.variance)}
              />
            </div>
            <div className="dash-gauge-scale" aria-hidden>
              <span>−20</span>
              <span>0</span>
              <span>+20</span>
            </div>
            <dl className="dash-gauge-facts">
              <div>
                <dt>Planned</dt>
                <dd>{totals.planned === undefined ? "—" : `${round(totals.planned)}%`}</dd>
              </div>
              <div>
                <dt>Actual</dt>
                <dd>{totals.actual === undefined ? "—" : `${round(totals.actual)}%`}</dd>
              </div>
              <div>
                <dt>Weeks</dt>
                <dd>{trend.length}</dd>
              </div>
            </dl>
            <p>Position shown — a trend needs two reporting weeks.</p>
          </div>
        )}
      </Card>

      {/*
        Health reads as ONE segmented distribution bar plus a legend, not a
        donut and not a bar per row.

        The row-per-status version drew a separate track for every state, so a
        scope with a single status showed one short bar in a tall card and the
        proportions could not be compared at a glance. A single stacked bar
        carries the whole distribution in one line and stays legible from one
        project to twenty.
      */}
      <Card title="Schedule health" hint="Across the current scope" span={3}>
        {totals.totalProjects === 0 ? (
          <Empty>No projects are in view for the current filters.</Empty>
        ) : (
          <div className="dash-dist">
            <div className="dash-dist-bar" role="img" aria-label={healthSummary(totals)}>
              {healthRows(totals).map((row) => (
                <i
                  key={row.label}
                  style={{
                    width: `${(row.value / totals.totalProjects) * 100}%`,
                    background: row.color,
                  }}
                  title={`${row.label}: ${row.value}`}
                />
              ))}
            </div>
            <ul className="dash-dist-legend">
              {healthRows(totals).map((row) => (
                <li key={row.label}>
                  <i style={{ background: row.color }} aria-hidden />
                  <span>{row.label}</span>
                  <b>{row.value}</b>
                </li>
              ))}
            </ul>
            <p className="dash-dist-foot">
              <b>{totals.reportedProjects}</b> of <b>{totals.totalProjects}</b> reporting
              {totals.notReported > 0 && ` · ${totals.notReported} not reported`}
            </p>
          </div>
        )}
      </Card>

      {/* Ranking only earns its place when there is a ranking to read. */}
      {comparison && (
        <Card title="Variance ranking" hint="Worst first" span={12}>
          <ResponsiveContainer width="100%" height={Math.max(150, reported.length * 26)}>
            <BarChart
              layout="vertical"
              data={[...reported]
                .sort((a, b) => (a.variance as number) - (b.variance as number))
                .slice(0, 8)
                .map((p) => ({ name: shortName(p), Variance: round(p.variance as number), health: p.health }))}
              margin={{ top: 0, right: 26, bottom: 0, left: 6 }}
            >
              <CartesianGrid stroke={GRID} horizontal={false} />
              <XAxis type="number" unit="%" tick={AXIS} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" width={86} tick={AXIS} tickLine={false} axisLine={false} />
              <Tooltip formatter={pct} cursor={{ fill: CURSOR_FILL }} />
              <Bar dataKey="Variance" radius={[0, 2, 2, 0]} maxBarSize={15}>
                {[...reported]
                  .sort((a, b) => (a.variance as number) - (b.variance as number))
                  .slice(0, 8)
                  .map((p) => (
                    <Cell key={p.project.id} fill={HEALTH_META[p.health].color} />
                  ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Attention: every project not on track, named. */}
      <Card
        title="Management attention"
        hint="Projects off plan or not reporting"
        span={4}
      >
        <AttentionList positions={positions} />
      </Card>
    </>
  );
}

/* -------------------------------- Fragments -------------------------------- */

function AttentionList({ positions }: { positions: ProjectPosition[] }) {
  const flagged = positions
    .filter((p) => p.health !== "on_track")
    .sort((a, b) => (a.variance ?? 0) - (b.variance ?? 0));

  if (!flagged.length) {
    return (
      <p className="dash-clear">
        <span aria-hidden>✓</span>
        Every project in view is reporting and on track.
      </p>
    );
  }

  return (
    <ul className="dash-attention">
      {flagged.slice(0, 6).map((p) => (
        <li key={p.project.id}>
          <i className={`dash-pip is-${HEALTH_META[p.health].tone}`} aria-hidden />
          <span className="dash-attention-name">{p.project.name}</span>
          <span className={`dash-attention-tag is-${HEALTH_META[p.health].tone}`}>
            {HEALTH_META[p.health].label}
          </span>
          <b>{p.variance === undefined ? "—" : signed(p.variance)}</b>
        </li>
      ))}
    </ul>
  );
}

function Card({
  title,
  hint,
  span,
  children,
}: {
  title: string;
  hint?: string;
  /** Columns out of 12, so rows vary instead of repeating one card width. */
  span: number;
  children: React.ReactNode;
}) {
  return (
    <section className="dash-card" style={{ "--span": span } as React.CSSProperties}>
      <header>
        <b>{title}</b>
        {hint && <small>{hint}</small>}
      </header>
      <div className="dash-card-body">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="dash-empty">{children}</p>;
}

/* --------------------------------- Helpers --------------------------------- */

function shortName(p: ProjectPosition): string {
  return p.project.shortName || p.project.code || p.project.name;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${round(value)}%`;
}

function pct(value: unknown): string {
  return typeof value === "number" ? `${value}%` : String(value ?? "—");
}

function varianceTone(variance: number | undefined): string {
  if (variance === undefined) return "default";
  if (variance >= -3) return "success";
  if (variance >= -10) return "warning";
  return "danger";
}

/** Centre is zero; the bar grows left for negative, right for positive. */
function gaugeStyle(variance: number | undefined): React.CSSProperties {
  if (variance === undefined) return { display: "none" };
  const magnitude = Math.min(Math.abs(variance), 20) / 20; // ±20 points fills the half
  const half = magnitude * 50;
  return variance < 0
    ? { right: "50%", width: `${half}%` }
    : { left: "50%", width: `${half}%` };
}

function healthSummary(totals: PortfolioTotals): string {
  return healthRows(totals)
    .map((row) => `${row.label}: ${row.value}`)
    .join(", ");
}

function healthRows(totals: PortfolioTotals) {
  return [
    { label: HEALTH_META.on_track.label, value: totals.onTrack, color: HEALTH_META.on_track.color },
    { label: HEALTH_META.at_risk.label, value: totals.atRisk, color: HEALTH_META.at_risk.color },
    { label: HEALTH_META.behind.label, value: totals.behind, color: HEALTH_META.behind.color },
    { label: HEALTH_META.critical.label, value: totals.critical, color: HEALTH_META.critical.color },
    {
      label: HEALTH_META.not_reported.label,
      value: totals.notReported,
      color: HEALTH_META.not_reported.color,
    },
  ].filter((row) => row.value > 0);
}

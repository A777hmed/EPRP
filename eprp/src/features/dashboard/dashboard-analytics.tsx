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
} from "recharts";
import { CircleCheck, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";

import {
  HEALTH_META,
  compareMilestonesByAttention,
  round,
  sortMilestonesByAttention,
  type DashboardMilestone,
  type PortfolioTotals,
  type ProjectPosition,
} from "./dashboard-data";
import type { SummaryModalKind } from "./components/summary-modals";

/* --------------------------------- Chrome ---------------------------------- */

/* Chart chrome reads the workspace tokens, so axes follow the theme with no JS
   theme detection — a hardcoded light hex would glow on the dark ground. */
const GRID = "var(--dash-hairline)";
const PLANNED = "var(--dash-chart-planned)";
const ACTUAL = "var(--dash-chart-actual)";

type HealthKey = ProjectPosition["health"];
export type Tone = "success" | "warning" | "behind" | "danger" | "default";

/* ================================ KPI strip ================================= */

/**
 * Five blocks, five DIFFERENT marks — ring, ring, columns, sparkline, status
 * icon. Two rings on purpose: they read as a matched pair of rate metrics, and
 * the three that follow deliberately break the rhythm so the strip cannot be
 * skimmed as one repeated card.
 *
 * Dashboard UX Part 1: each card is now title + large value + ONE short
 * supporting line + its visual mark — methodology, week-over-week delta and
 * every other explanation moved into the card's own quick-detail modal
 * (`summary-modals.tsx`), reached by clicking it. A card states a fact; the
 * modal explains it.
 */
export function KpiStrip({
  totals,
  onSelectCard,
}: {
  totals: PortfolioTotals;
  /** Opens a compact centered quick-detail modal for one card (§A) — a
      management quick-look, never the wide Project Workspace. */
  onSelectCard: (kind: SummaryModalKind) => void;
}) {
  const coverage = totals.totalProjects
    ? Math.round((totals.reportedProjects / totals.totalProjects) * 100)
    : undefined;
  const bands = healthRows(totals);

  /* Final Micro-Polish: keyed on the figures the five cards actually
     render — not `totals` identity, which is stable across an unrelated
     re-render — so the strip cleanly re-mounts and its short fade/
     translate stagger replays once per relevant filter/scope change,
     never on an incidental re-render, never looping. */
  const stripKey = [
    totals.totalProjects,
    totals.reportedProjects,
    totals.onTrack,
    totals.actual,
    totals.planned,
    totals.variance,
    totals.overdueReports,
  ].join(":");

  return (
    <section key={stripKey} className="dash-kpis" aria-label="Portfolio summary">
      {/* 1 — ring */}
      <button type="button" className="dash-kpi" onClick={() => onSelectCard("portfolio")} aria-label="Open Portfolio Progress detail">
        <div className="dash-kpi-text">
          <span>Portfolio Progress</span>
          <b>{totals.actual === undefined ? "—" : `${round(totals.actual)}%`}</b>
          <small>Planned {totals.planned === undefined ? "—" : `${round(totals.planned)}%`}</small>
        </div>
        <Ring value={totals.actual} tone="primary" label="Portfolio actual progress" />
      </button>

      {/* 2 — ring, paired with the first */}
      <button type="button" className="dash-kpi" onClick={() => onSelectCard("coverage")} aria-label="Open Reporting Coverage detail">
        <div className="dash-kpi-text">
          <span>Reporting Coverage</span>
          <b>{coverage === undefined ? "—" : `${coverage}%`}</b>
          <small>
            {totals.totalProjects
              ? `${totals.reportedProjects} of ${totals.totalProjects} projects`
              : "No projects in view"}
          </small>
        </div>
        <Ring value={coverage} tone="success" label="Reporting coverage" />
      </button>

      {/* 3 — mini vertical bars */}
      <button type="button" className="dash-kpi" onClick={() => onSelectCard("onTrack")} aria-label="Open Projects On Track detail">
        <div className="dash-kpi-text">
          <span>Projects On Track</span>
          <b>{totals.onTrack}</b>
          <small>of {totals.totalProjects} in view</small>
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
      </button>

      {/* 4 — sparkline */}
      <button type="button" className="dash-kpi" onClick={() => onSelectCard("variance")} aria-label="Open Schedule Variance detail">
        <div className="dash-kpi-text">
          <span>Schedule Variance</span>
          <b className={`is-${varianceTone(totals.variance)}`}>{signed(totals.variance)}</b>
          <small>Actual less planned</small>
        </div>
        <div className="dash-kpi-status" aria-hidden>
          {(totals.variance ?? 0) >= 0 ? (
            <TrendingUp className={`is-${varianceTone(totals.variance)}`} />
          ) : (
            <TrendingDown className={`is-${varianceTone(totals.variance)}`} />
          )}
        </div>
      </button>

      {/* 5 — a STATE, so a status icon rather than a chart */}
      <button
        type="button"
        className={`dash-kpi ${totals.overdueReports ? "is-danger" : "is-clear"}`}
        onClick={() => onSelectCard("overdue")}
        aria-label="Open Overdue Reports detail"
      >
        <div className="dash-kpi-text">
          <span>Overdue Reports</span>
          <b className={totals.overdueReports ? "is-danger" : "is-success"}>{totals.overdueReports}</b>
          <small>Past period end, not approved</small>
        </div>
        <div className="dash-kpi-status" aria-hidden>
          {totals.overdueReports ? <TriangleAlert /> : <CircleCheck />}
        </div>
      </button>
    </section>
  );
}

/* =============================== Main row ================================== */

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
                  /* Dashboard UX Part 1: keyed on the distribution itself
                     (not on `totals` identity, which is stable across a
                     hover) — the ring cleanly re-mounts and replays its one
                     700ms reveal exactly when the scope/filter change moves
                     a project between bands, never on hover, never looping. */
                  key={bands.map((row) => `${row.key}:${row.value}`).join("|")}
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
          <RadarChart
            /* Final Micro-Polish: keyed on the axes' own values (not
               `axes` identity, which is stable across an unrelated
               re-render) — the radar cleanly re-mounts and replays its
               one grow-from-center reveal exactly when a relevant filter/
               scope change actually moves it, never looping. */
            key={axes.map((a) => `${a.axis}:${a.current}:${a.target}`).join("|")}
            data={axes}
            outerRadius="78%"
            margin={{ top: 10, right: 20, bottom: 6, left: 20 }}
          >
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
export function ProgressByProjectPanel({
  positions,
  onSelectProject,
}: {
  positions: ProjectPosition[];
  /** Opens the Project Workspace for one row (Top-Level 5A1 correction, §C). */
  onSelectProject?: (projectId: string) => void;
}) {
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
            const row = (
              <>
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
              </>
            );
            return (
              <li key={position.project.id}>
                {onSelectProject ? (
                  <button
                    type="button"
                    className="dash-bar-row"
                    onClick={() => onSelectProject(position.project.id)}
                    aria-label={`Open ${position.project.name} in the Project Workspace`}
                  >
                    {row}
                  </button>
                ) : (
                  row
                )}
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
export const MILESTONE_STAGES: Record<string, { step: number; label: string; tone: Tone }> = {
  not_started: { step: 1, label: "Not Started", tone: "default" },
  planned: { step: 1, label: "Planned", tone: "default" },
  in_progress: { step: 2, label: "In Progress", tone: "warning" },
  delayed: { step: 2, label: "Delayed", tone: "danger" },
  at_risk: { step: 2, label: "At Risk", tone: "danger" },
  completed: { step: 3, label: "Completed", tone: "success" },
  done: { step: 3, label: "Completed", tone: "success" },
};

/** The one place a milestone's raw `status` becomes a step/label/tone — shared
    by the lifecycle bars here and the drawer's detail view, so neither can
    describe a status differently from the other. */
export function milestoneStageOf(status: string): { step: number; label: string; tone: Tone } {
  return MILESTONE_STAGES[status] ?? { step: 1, label: titleCase(status), tone: "default" };
}

/** Fixed-size preview cards, so the panel stays useful with 5 projects or
    500 — one representative row each, everything else behind "+N". */
const MAX_PROJECT_PREVIEW = 5;
const MAX_MILESTONE_PREVIEW = 5;

export function MilestonePanel({
  milestones,
  singleProject,
  onViewAll,
  onSelectMilestone,
}: {
  /** The FULL scoped set, not capped — the panel does its own capping so its
      "+N" and overflow counts are always accurate against everything in
      scope, not just whatever a caller happened to slice off first. */
  milestones: DashboardMilestone[];
  /** True once the Dashboard is scoped to one project — previews milestones
      directly instead of one row per project. */
  singleProject: boolean;
  onViewAll: () => void;
  /** Opens the Milestone Modal straight to this milestone's detail. */
  onSelectMilestone: (milestoneId: string) => void;
}) {
  const hasMilestones = milestones.length > 0;

  return (
    <Panel
      title="Milestone Progress"
      hint={singleProject ? "Attention priority" : "By project · attention priority"}
      onAction={onViewAll}
      className={hasMilestones ? "dash-milestones" : "dash-milestones is-collapsed"}
    >
      {!hasMilestones ? (
        <PanelEmpty>No dated milestone is recorded ahead of today for this scope.</PanelEmpty>
      ) : singleProject ? (
        <MilestoneRowsPreview milestones={milestones} onSelect={onSelectMilestone} onViewAll={onViewAll} />
      ) : (
        <ProjectSummaryRows milestones={milestones} onSelect={onSelectMilestone} onViewAll={onViewAll} />
      )}
    </Panel>
  );
}

/**
 * Single-project mode: the scope is already one project, so the preview
 * shows milestones directly — worst status first, then nearest due date —
 * rather than the (redundant, here) project-summary rows below.
 */
function MilestoneRowsPreview({
  milestones,
  onSelect,
  onViewAll,
}: {
  milestones: DashboardMilestone[];
  onSelect: (id: string) => void;
  onViewAll: () => void;
}) {
  const ordered = sortMilestonesByAttention(milestones);
  const shown = ordered.slice(0, MAX_MILESTONE_PREVIEW);
  const hidden = ordered.length - shown.length;

  return (
    <>
      <ul className="dash-bars">
        {shown.map((milestone) => {
          const stage = milestoneStageOf(milestone.status);
          return (
            <li key={milestone.id}>
              <button type="button" className="dash-bar-row" onClick={() => onSelect(milestone.id)}>
                <span className="dash-bar-name" title={milestone.title}>
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
                <small>{formatShortDate(milestone.dueDate)}</small>
              </button>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <button type="button" className="dash-more-footer" onClick={onViewAll}>
          + {hidden} more {plural(hidden, "milestone")}
        </button>
      )}
    </>
  );
}

interface ProjectMilestoneSummary {
  projectId: string;
  projectName: string;
  /** The one milestone this project's row previews — see `buildProjectSummaries`. */
  representative: DashboardMilestone;
  /** Other dated milestones on this project, not individually shown. */
  extraCount: number;
}

/**
 * All Projects mode: ONE row per project (never several from the same
 * project), so the card stays a fixed height with 2 projects or 200. Each
 * row previews that project's single most attention-worthy milestone; a
 * "+N" marks the rest.
 */
function ProjectSummaryRows({
  milestones,
  onSelect,
  onViewAll,
}: {
  milestones: DashboardMilestone[];
  onSelect: (id: string) => void;
  onViewAll: () => void;
}) {
  const summaries = buildProjectSummaries(milestones);
  const shown = summaries.slice(0, MAX_PROJECT_PREVIEW);
  const hiddenSummaries = summaries.slice(MAX_PROJECT_PREVIEW);
  /* Milestones already counted by a VISIBLE row's own "+N" badge are not
     counted again here — the footer covers only entire projects the 5-row
     cap pushed out of view, never the overflow a shown row already states. */
  const hiddenMilestones = hiddenSummaries.reduce((sum, summary) => sum + summary.extraCount + 1, 0);

  return (
    <>
      <ul className="dash-bars">
        {shown.map((summary) => {
          const stage = milestoneStageOf(summary.representative.status);
          return (
            <li key={summary.projectId}>
              <button
                type="button"
                className="dash-bar-row"
                onClick={() => onSelect(summary.representative.id)}
              >
                <span className="dash-bar-name" title={summary.projectName}>
                  {summary.projectName}
                </span>
                <span className="dash-bar-badges">
                  <b className={`is-${stage.tone}`}>{stage.label}</b>
                  {summary.extraCount > 0 && <em className="dash-bar-more">+{summary.extraCount}</em>}
                </span>
                <span
                  className="dash-bar-track"
                  role="img"
                  aria-label={`${summary.representative.title}: stage ${stage.step} of 3, ${stage.label}`}
                >
                  {[1, 2, 3].map((step) => (
                    <i
                      key={step}
                      className={step <= stage.step ? `is-${stage.tone}` : undefined}
                      style={{ "--d": `${step * 90}ms` } as React.CSSProperties}
                    />
                  ))}
                </span>
                <small title={summary.representative.title}>{summary.representative.title}</small>
              </button>
            </li>
          );
        })}
      </ul>
      {hiddenSummaries.length > 0 && (
        <button type="button" className="dash-more-footer" onClick={onViewAll}>
          {overflowLabel(hiddenSummaries.length, hiddenMilestones)}
        </button>
      )}
    </>
  );
}

/**
 * One summary per project: its representative milestone (priority: Delayed
 * -> In Progress -> Not Started -> Completed, then nearest due date) and how
 * many others it has. Projects then surface in that same attention order,
 * so a project whose worst milestone is Delayed leads a project whose worst
 * is merely Not Started.
 */
function buildProjectSummaries(milestones: DashboardMilestone[]): ProjectMilestoneSummary[] {
  const groups = new Map<string, DashboardMilestone[]>();
  for (const milestone of milestones) {
    const list = groups.get(milestone.projectId);
    if (list) list.push(milestone);
    else groups.set(milestone.projectId, [milestone]);
  }

  const summaries = [...groups.entries()].map(([projectId, items]) => {
    const ordered = sortMilestonesByAttention(items);
    return {
      projectId,
      projectName: items[0].projectName,
      representative: ordered[0],
      extraCount: ordered.length - 1,
    };
  });

  return summaries.sort((a, b) => compareMilestonesByAttention(a.representative, b.representative));
}

/** Called only once the 5-project cap has actually hidden a whole project,
    so both counts are always positive — never the "0 more" a shown row's
    own "+N" already speaks for. */
function overflowLabel(hiddenProjects: number, hiddenMilestones: number): string {
  return `+ ${hiddenProjects} more ${plural(hiddenProjects, "project")} · ${hiddenMilestones} ${plural(hiddenMilestones, "milestone")}`;
}

function formatShortDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/* ================================ Fragments ================================= */

export function Panel({
  title,
  hint,
  href,
  onAction,
  linkLabel = "View All",
  className,
  children,
}: {
  title: string;
  hint?: string;
  href?: string;
  /** Alternative to `href` for a "View All" that opens something in-page
      (a drawer) rather than navigating — e.g. Milestone Progress. */
  onAction?: () => void;
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
        {href ? (
          <Link href={href} className="dash-link">
            {linkLabel}
          </Link>
        ) : (
          onAction && (
            <button type="button" className="dash-link" onClick={onAction}>
              {linkLabel}
            </button>
          )
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

/* --------------------------------- Helpers --------------------------------- */

/** Exported so `dashboard-view.tsx` can gate the Expanded Progress Analysis
    curve chart the same way every in-panel chart already is — one shared
    media-query listener rather than a second, silently-hardcoded copy. */
export function useReducedMotion(): boolean {
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

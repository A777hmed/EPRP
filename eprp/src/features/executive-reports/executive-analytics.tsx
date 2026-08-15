"use client";

/**
 * The Executive analytics block.
 *
 * ONE renderer for screen and print. The charts in `executive-charts.tsx` are
 * hand-built SVG with a fixed viewBox, so the same element scales to a screen
 * card and to an A4 landscape print cell without a second implementation.
 *
 * That is the point: the previous arrangement drew the screen with a chart
 * library and paper with a separate static renderer, which could drift. There
 * is now nothing to drift — the printed dashboard is literally the screen
 * dashboard at a different width.
 *
 * Adaptive decisions live in `executive-panels.ts`. This file only draws.
 */

import {
  ClusteredBars,
  DivergingBars,
  DonutChart,
  RankedBars,
  TrendChart,
} from "./executive-charts";
import { GRID_COLUMNS, type ExecPanel } from "./executive-panels";

/**
 * viewBox units per grid column.
 *
 * Chart width scales with the card, so units-per-pixel stays constant and a
 * 9.2-unit label is the same physical size in a 4-column card as in a 10-column
 * one. Without this, narrow cards would render visibly smaller type.
 */
const UNITS_PER_COLUMN = 46;

function widthOf(panel: ExecPanel): number {
  return (panel.span ?? 7) * UNITS_PER_COLUMN;
}

export function ExecutiveAnalytics({ panels }: { panels: ExecPanel[] }) {
  return (
    <div className="exec-analytics" style={{ ["--exec-cols" as string]: GRID_COLUMNS }}>
      {panels.map((panel) => (
        <article
          className={`exec-card exec-card-${panel.kind}`}
          key={panel.id}
          style={{ ["--span" as string]: panel.span ?? 7 }}
        >
          <header className="exec-card-head">
            <div>
              <h3>{panel.title}</h3>
              {panel.subtitle && <p>{panel.subtitle}</p>}
            </div>
            <Legend panel={panel} />
          </header>
          <div className="exec-card-body">
            <PanelBody panel={panel} />
          </div>
          {panel.note && <small className="exec-card-note">{panel.note}</small>}
        </article>
      ))}
    </div>
  );
}

/** Compact legend, only where more than one series needs naming. */
function Legend({ panel }: { panel: ExecPanel }) {
  if (panel.kind !== "hgrouped" && panel.kind !== "trend") return null;
  return (
    <span className="exec-legend">
      {panel.series.map((serie) => (
        <span key={serie.key}>
          <i style={{ background: serie.color }} />
          {serie.label}
        </span>
      ))}
    </span>
  );
}

function PanelBody({ panel }: { panel: ExecPanel }) {
  const vw = widthOf(panel);

  switch (panel.kind) {
    case "hgrouped":
      return (
        <ClusteredBars
          vw={vw}
          title={panel.title}
          rows={panel.rows}
          series={panel.series}
          maxValue={panel.maxValue}
          suffix={panel.suffix}
        />
      );

    case "trend":
      return (
        <TrendChart
          vw={vw}
          title={panel.title}
          categories={panel.categories}
          maxValue={panel.maxValue}
          suffix={panel.suffix}
          series={panel.series.map((serie, index) => ({
            label: serie.label,
            color: serie.color,
            values: serie.values,
            // The plan line is the reference, drawn dashed behind actual.
            dashed: index > 0,
          }))}
        />
      );

    case "donut":
      return (
        <DonutChart
          vw={vw}
          title={panel.title}
          slices={panel.slices}
          total={panel.total}
          totalLabel={panel.totalLabel}
        />
      );

    case "hbars":
      return (
        <RankedBars
          vw={vw}
          title={panel.title}
          rows={panel.rows}
          maxValue={panel.maxValue}
          suffix={panel.suffix}
          track={panel.track}
        />
      );

    case "hvariance":
      return (
        <DivergingBars
          vw={vw}
          title={panel.title}
          rows={panel.rows}
          minValue={panel.minValue}
          suffix={panel.suffix}
        />
      );

    /*
     * Exceptions read as a list of counts, not as bars.
     * A zero line stays visible and greys out — "checked, nothing open" is
     * information; a missing row is not.
     */
    case "exception":
      return (
        <ul className="exec-exceptions">
          {panel.items.map((item) => (
            <li key={item.label} className={item.value === 0 ? "is-clear" : undefined}>
              <i style={{ background: item.value === 0 ? undefined : item.color }} />
              <span>{item.label}</span>
              <b style={item.value === 0 ? undefined : { color: item.color }}>{item.value}</b>
            </li>
          ))}
        </ul>
      );

    case "stat":
      return (
        <div className="exec-stat">
          {panel.items.map((item) => (
            <div key={item.label}>
              <b style={item.color ? { color: item.color } : undefined}>{item.value}</b>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      );

    case "empty":
      return <div className="exec-empty-chart">{panel.text}</div>;
  }
}

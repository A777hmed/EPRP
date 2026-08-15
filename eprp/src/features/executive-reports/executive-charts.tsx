"use client";

/**
 * The Executive chart set — hand-built SVG, one renderer for screen AND print.
 *
 * WHY NOT A CHART LIBRARY
 *   The board layout needs a dedicated left label column, values pinned outside
 *   bar ends, a real zero baseline and guaranteed non-overlap at any project
 *   count. Fighting a generic library into that shape produced collisions at
 *   the edges and then needed a SECOND static renderer for print, which could
 *   drift. These draw once and serve both media.
 *
 * WHY EVERY CHART TAKES `vw`
 *   The dashboard is deliberately NOT nine equal cards — panels span different
 *   widths. A fixed viewBox would then render the same drawing scaled down in a
 *   narrow card, making its type visibly smaller than its neighbour's. Instead
 *   each chart's viewBox width is proportional to its card, so units-per-pixel
 *   stays constant and a 9.5-unit label is the same physical size in a 20% card
 *   as in a 40% one.
 *
 * NON-OVERLAP
 *   Label column, plot area and value column are disjoint bands derived from
 *   `vw`. A long name is truncated to its band and carries a `<title>` for the
 *   full text. Nothing is drawn outside its own band, at any width.
 */

import * as React from "react";

const INK = "#33506f";
const MUTED = "#7a8da0";
const GRID = "#f0f4f9";
const AXIS = "#d6e0ea";
const TRACK = "#f3f7fa";

/**
 * The three disjoint bands, derived from the chart's own width.
 *
 * The label band is 27% and the value band 9%. They remain disjoint, so the
 * non-overlap guarantee is arithmetic, not a matter of tuning.
 */
function bands(vw: number) {
  const label = Math.max(74, Math.round(vw * 0.27));
  const value = Math.max(28, Math.round(vw * 0.09));
  const left = label + 6;
  const right = vw - value;
  return { label, value, left, right, width: right - left };
}

/**
 * Every bar chart is the SAME height, whatever the project count.
 *
 * Height used to be `rows × rowHeight`, so a one-project portfolio drew a chart
 * a fraction of the height of the donut beside it and the row filled with
 * empty space. Fixing the plot height and dividing it by the row count instead
 * means one project gets one thick bar and twenty get thin ones — the card is
 * always full, the dashboard keeps its proportions from 1 to 20+ projects, and
 * the whitespace disappears at its source rather than being padded around.
 */
const PLOT_H = 112;
/*
 * The axis strip must contain the tick LABELS, not just the baseline.
 * At 15 the label baseline sat exactly on the frame edge and every tick was
 * reported outside the viewBox; 18 leaves room for the glyph box below it.
 */
const AXIS_H = 18;

interface RowGeometry {
  height: number;
  rowH: number;
  barH: number;
  axisY: number;
  top: (index: number) => number;
}

function rowGeometry(count: number, opts: { series?: number } = {}): RowGeometry {
  const series = opts.series ?? 1;
  const rowH = PLOT_H / Math.max(count, 1);
  /*
   * Bar weight scales with how few bars there are.
   *
   * A fixed cap meant a single project drew one thin bar floating in a tall
   * plot — the chart was full height but visually empty. Letting a small set
   * use thicker bars fills the same box with data instead of air, while a
   * large set stays fine because `rowH * 0.62` binds first.
   */
  const weightCap = count <= 2 ? 46 : count <= 4 ? 34 : 26;
  const groupH = Math.min(rowH * 0.62, series > 1 ? weightCap : weightCap * 0.72);
  const barH = Math.max(3, groupH / series - (series > 1 ? 1.6 : 0));
  return {
    height: PLOT_H + AXIS_H,
    rowH,
    barH,
    axisY: PLOT_H + 6,
    top: (index: number) => rowH * index + (rowH - groupH) / 2,
  };
}

/** Characters that fit a band at the given type size. */
function fit(value: string, size: number, width: number): string {
  const max = Math.max(4, Math.floor(width / (size * 0.53)));
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

function Frame({
  label,
  vw,
  height,
  children,
}: {
  label: string;
  vw: number;
  height: number;
  children: React.ReactNode;
}) {
  return (
    <svg
      viewBox={`0 0 ${vw} ${height}`}
      role="img"
      aria-label={label}
      preserveAspectRatio="xMinYMin meet"
      style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
    >
      {children}
    </svg>
  );
}

interface Sized {
  /** viewBox width, proportional to the card's span. */
  vw: number;
  title: string;
}

/* ------------------------- 1 · Horizontal clustered ------------------------ */

export function ClusteredBars({
  vw,
  title,
  rows,
  series,
  maxValue,
  suffix,
}: Sized & {
  rows: { label: string; values: number[] }[];
  series: { label: string; color: string }[];
  maxValue: number;
  suffix: string;
}) {
  const b = bands(vw);
  const g = rowGeometry(rows.length, { series: series.length });
  const barH = g.barH;
  const gap = 1.6;
  const groupH = series.length * barH + (series.length - 1) * gap;
  const height = g.height;
  const axisY = g.axisY;

  return (
    <Frame label={title} vw={vw} height={height}>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const x = b.left + f * b.width;
        return (
          <g key={f}>
            <line x1={x} y1={1} x2={x} y2={axisY - 5} stroke={f === 0 ? AXIS : GRID} strokeWidth={0.7} />
            <text x={x} y={axisY + 5} fill={MUTED} fontSize={8} textAnchor="middle">
              {Math.round(f * maxValue)}
              {suffix}
            </text>
          </g>
        );
      })}

      {rows.map((row, index) => {
        const top = g.top(index);
        return (
          <g key={row.label}>
            <text x={0} y={top + groupH / 2 + 3} fill={INK} fontSize={9.2}>
              {fit(row.label, 9.2, b.label)}
              <title>{row.label}</title>
            </text>
            {row.values.map((value, s) => {
              const width = maxValue > 0 ? Math.max((value / maxValue) * b.width, 1) : 1;
              const y = top + s * (barH + gap);
              return (
                <g key={s}>
                  <rect x={b.left} y={y} width={b.width} height={barH} rx={2} fill={TRACK} />
                  <rect x={b.left} y={y} width={width} height={barH} rx={2} fill={series[s].color}>
                    <title>{`${series[s].label}: ${value}${suffix}`}</title>
                  </rect>
                </g>
              );
            })}
            {row.values.map((value, s) => {
              const last = s === row.values.length - 1;
              return (
                <text
                  key={s}
                  x={b.right + 4}
                  y={top + s * (barH + gap) + barH - 1}
                  fill={last ? INK : MUTED}
                  fontSize={8.4}
                  fontWeight={last ? 700 : 500}
                >
                  {value}
                  {suffix}
                </text>
              );
            })}
          </g>
        );
      })}
      <line x1={b.left} y1={axisY - 5} x2={b.right} y2={axisY - 5} stroke={AXIS} strokeWidth={0.7} />
    </Frame>
  );
}

/* -------------------------------- 2 · Trend -------------------------------- */

export function TrendChart({
  vw,
  title,
  categories,
  series,
  maxValue,
  suffix,
}: Sized & {
  categories: string[];
  series: { label: string; color: string; values: number[]; dashed?: boolean }[];
  maxValue: number;
  suffix: string;
}) {
  const height = 146;
  const pad = { top: 18, right: 12, bottom: 20, left: 26 };
  const plotW = vw - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const step = categories.length > 1 ? plotW / (categories.length - 1) : 0;
  const x = (i: number) => pad.left + step * i;
  const y = (v: number) => pad.top + plotH * (1 - Math.min(v, maxValue) / maxValue);

  return (
    <Frame label={title} vw={vw} height={height}>
      {[0, 25, 50, 75, 100].map((t) => (
        <g key={t}>
          <line x1={pad.left} y1={y(t)} x2={vw - pad.right} y2={y(t)} stroke={t === 0 ? AXIS : GRID} strokeWidth={0.7} />
          <text x={pad.left - 4} y={y(t) + 3} fill={MUTED} fontSize={8} textAnchor="end">
            {t}
          </text>
        </g>
      ))}

      {series.map((serie) => {
        const points = serie.values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
        return (
          <g key={serie.label}>
            {!serie.dashed && (
              <polygon
                points={`${x(0)},${y(0)} ${points} ${x(serie.values.length - 1)},${y(0)}`}
                fill={serie.color}
                fillOpacity={0.11}
              />
            )}
            <polyline
              points={points}
              fill="none"
              stroke={serie.color}
              strokeWidth={2.2}
              strokeLinejoin="round"
              strokeDasharray={serie.dashed ? "5 4" : undefined}
            />
            {serie.values.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={3} fill="#ffffff" stroke={serie.color} strokeWidth={1.9}>
                <title>{`${serie.label} ${categories[i]}: ${v}${suffix}`}</title>
              </circle>
            ))}
          </g>
        );
      })}

      {series[0]?.values.map((v, i) => (
        <text key={i} x={x(i)} y={y(v) - 7} fill={INK} fontSize={8.8} fontWeight={700} textAnchor="middle">
          {v}
          {suffix}
        </text>
      ))}

      {categories.map((c, i) => (
        <text key={c} x={x(i)} y={height - 6} fill={MUTED} fontSize={8} textAnchor="middle">
          {c}
        </text>
      ))}
    </Frame>
  );
}

/* -------------------------------- 3 · Donut -------------------------------- */

export interface Slice {
  name: string;
  value: number;
  color: string;
}

function arc(from: number, to: number, cx: number, cy: number, rOut: number, rIn: number): string {
  const a0 = from * Math.PI * 2 - Math.PI / 2;
  const a1 = to * Math.PI * 2 - Math.PI / 2;
  const large = to - from > 0.5 ? 1 : 0;
  const p = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  return [
    `M${p(rOut, a0)}`,
    `A${rOut},${rOut} 0 ${large} 1 ${p(rOut, a1)}`,
    `L${p(rIn, a1)}`,
    `A${rIn},${rIn} 0 ${large} 0 ${p(rIn, a0)}`,
    "Z",
  ].join(" ");
}

/**
 * A refined ring with the total in the hole and a `category | count | %` legend.
 *
 * Narrow cards stack the legend beneath the ring; wide cards place it alongside.
 * The ring itself stays small either way — a donut that swells to fill a large
 * card reads as decoration, not as data.
 */
export function DonutChart({
  vw,
  title,
  slices,
  total,
  totalLabel,
}: Sized & { slices: Slice[]; total: number; totalLabel: string }) {
  const sum = slices.reduce((acc, slice) => acc + slice.value, 0) || 1;
  const stacked = vw < 300;

  /*
   * Sized to the same plot height as the bar charts, so a donut card and a bar
   * card in the same row are the same height and neither carries dead space.
   * Refined, not swollen: the ring is generous but the hole keeps it a data
   * mark rather than a decorative circle.
   */
  const rOut = stacked ? 46 : 50;
  const rIn = stacked ? 30 : 33;
  const rowH = 18;
  const legendH = slices.length * rowH;

  const cx = stacked ? vw / 2 : rOut + 8;
  const ringH = rOut * 2 + 8;
  /* Never shorter than a bar chart, so rows stay level. */
  const height = Math.max(
    PLOT_H + AXIS_H,
    stacked ? ringH + legendH + 10 : Math.max(ringH, legendH + 12)
  );
  const cy = stacked ? rOut + 4 : height / 2;

  const legendX = stacked ? 6 : rOut * 2 + 22;
  /*
   * The legend keeps its own measure instead of stretching to the card edge.
   * On a wide donut card it was pinned to the far right, leaving a channel of
   * white between each label and its own count.
   */
  const legendW = Math.min(stacked ? vw - 12 : vw - legendX, 190);
  const legendTop = stacked ? ringH + 12 : (height - legendH) / 2 + 12;

  return (
    <Frame label={title} vw={vw} height={height}>
      {slices.length === 1 ? (
        <circle cx={cx} cy={cy} r={(rOut + rIn) / 2} fill="none" stroke={slices[0].color} strokeWidth={rOut - rIn}>
          <title>{`${slices[0].name}: ${slices[0].value}`}</title>
        </circle>
      ) : (
        slices.map((slice, index) => {
          const start = slices.slice(0, index).reduce((acc, s) => acc + s.value, 0) / sum;
          return (
            <path key={slice.name} d={arc(start, start + slice.value / sum, cx, cy, rOut, rIn)} fill={slice.color}>
              <title>{`${slice.name}: ${slice.value}`}</title>
            </path>
          );
        })
      )}

      {/* The count sits clear of its caption: at 20px the glyph box of the
          total reached the caption's box and the two were reported colliding. */}
      <text x={cx} y={cy - 3} fill={INK} fontSize={19} fontWeight={800} textAnchor="middle">
        {total}
      </text>
      {/* The subtitle may overhang the hole slightly — it sits over the ring's
          inner edge, not outside the chart, so it stays legible without
          forcing a bigger ring. */}
      <text x={cx} y={cy + 12} fill={MUTED} fontSize={7} textAnchor="middle">
        {fit(totalLabel, 7, rOut * 1.75)}
      </text>

      {slices.map((slice, index) => {
        const y = legendTop + rowH * index;
        const pct = Math.round((slice.value / sum) * 100);
        // Count and percent occupy a fixed right strip; the name gets the rest.
        const metaW = 46;
        return (
          <g key={slice.name}>
            <circle cx={legendX + 4} cy={y - 3} r={4} fill={slice.color} />
            <text x={legendX + 13} y={y} fill={INK} fontSize={9}>
              {fit(slice.name, 9, legendW - metaW - 18)}
              <title>{slice.name}</title>
            </text>
            <text x={legendX + legendW - 2} y={y} fill={MUTED} fontSize={8.6} textAnchor="end">
              <tspan fill={INK} fontWeight={700}>
                {slice.value}
              </tspan>
              {`  ${pct}%`}
            </text>
          </g>
        );
      })}
    </Frame>
  );
}

/* ------------------- 5, 7 & 9 · Ranked / progress bars --------------------- */

export function RankedBars({
  vw,
  title,
  rows,
  maxValue,
  suffix,
  track = false,
}: Sized & {
  rows: { label: string; value: number; color: string }[];
  maxValue: number;
  suffix: string;
  track?: boolean;
}) {
  const b = bands(vw);
  const g = rowGeometry(rows.length);
  const barH = g.barH;
  const height = g.height;
  const axisY = g.axisY;
  const safeMax = maxValue > 0 ? maxValue : 1;

  return (
    <Frame label={title} vw={vw} height={height}>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const x = b.left + f * b.width;
        return (
          <g key={f}>
            <line x1={x} y1={1} x2={x} y2={axisY - 5} stroke={f === 0 ? AXIS : GRID} strokeWidth={0.7} />
            <text x={x} y={axisY + 5} fill={MUTED} fontSize={8} textAnchor="middle">
              {Math.round(f * safeMax)}
              {suffix}
            </text>
          </g>
        );
      })}

      {rows.map((row, index) => {
        const top = g.top(index);
        const width = Math.max((row.value / safeMax) * b.width, 1.5);
        return (
          <g key={row.label}>
            <text x={0} y={top + barH / 2 + 3.4} fill={INK} fontSize={9.2}>
              {fit(row.label, 9.2, b.label)}
              <title>{row.label}</title>
            </text>
            {track && <rect x={b.left} y={top} width={b.width} height={barH} rx={3} fill={TRACK} />}
            <rect x={b.left} y={top} width={width} height={barH} rx={3} fill={row.color}>
              <title>{`${row.label}: ${row.value}${suffix}`}</title>
            </rect>
            <text x={b.right + 4} y={top + barH / 2 + 3.4} fill={INK} fontSize={9} fontWeight={700}>
              {row.value}
              {suffix}
            </text>
          </g>
        );
      })}
    </Frame>
  );
}

/* ------------------------- 8 · Diverging variance -------------------------- */

/**
 * Behind-plan variance against a real zero baseline.
 *
 * The baseline sits at the right edge of the plot and bars grow leftward. Label
 * column, plot band and value column are disjoint at every width, so a name, a
 * bar, a value and the axis cannot collide however long the name or large the
 * number.
 */
export function DivergingBars({
  vw,
  title,
  rows,
  minValue,
  suffix,
}: Sized & { rows: { label: string; value: number }[]; minValue: number; suffix: string }) {
  const b = bands(vw);
  const g = rowGeometry(rows.length);
  const barH = g.barH;
  const height = g.height;
  const axisY = g.axisY;
  const zeroX = b.right;
  const span = Math.abs(Math.min(minValue, -1));

  return (
    <Frame label={title} vw={vw} height={height}>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const x = zeroX - f * b.width;
        return (
          <g key={f}>
            <line
              x1={x}
              y1={1}
              x2={x}
              y2={axisY - 5}
              stroke={f === 0 ? "#9fb4c9" : GRID}
              strokeWidth={f === 0 ? 1.3 : 0.7}
            />
            <text x={x} y={axisY + 5} fill={MUTED} fontSize={8} textAnchor="middle">
              {f === 0 ? 0 : -Math.round(f * span * 10) / 10}
            </text>
          </g>
        );
      })}

      {rows.map((row, index) => {
        const top = g.top(index);
        const width = Math.max((Math.abs(row.value) / span) * b.width, 1.5);
        return (
          <g key={row.label}>
            <text x={0} y={top + barH / 2 + 3.4} fill={INK} fontSize={9.2}>
              {fit(row.label, 9.2, b.label)}
              <title>{row.label}</title>
            </text>
            <rect x={zeroX - width} y={top} width={width} height={barH} rx={3} fill="#c0444c">
              <title>{`${row.label}: ${row.value}${suffix}`}</title>
            </rect>
            {/* Value in its own right-hand column, clear of the baseline. */}
            <text x={zeroX + 4} y={top + barH / 2 + 3.4} fill={INK} fontSize={9} fontWeight={700}>
              {row.value}
              {suffix}
            </text>
          </g>
        );
      })}
    </Frame>
  );
}

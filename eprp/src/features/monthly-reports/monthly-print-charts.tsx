"use client";

/**
 * Print-safe chart bodies: static SVG, fixed dimensions, no library.
 *
 * These are *only* the drawing surface. They carry no panel, no border, no
 * heading and no grid — those belong to the one canonical report card in
 * `monthly-analytics.tsx`, which both screen and print share. Swapping only the
 * inside of the card is what keeps the printed report identical in structure to
 * the screen report.
 *
 * Why static at all: recharts sizes itself by measuring its container at render
 * time and writing pixel values onto `.recharts-wrapper` and
 * `svg.recharts-surface`. The print layout is a different width, and refitting
 * that subtree with percentage or auto sizing collapses it to zero — the SVG
 * survives (so the card and title print) but paints nothing. Every coordinate
 * here is computed from constants and data, and `width`/`height` are literal on
 * the `<svg>`, so a print re-layout has nothing to resolve differently. They are
 * mounted with the document and revealed by `@media print`, so there is no
 * dependency on print-event timing either.
 */

import * as React from "react";

import type { AnalyticsPanel } from "./monthly-analytics-model";

/**
 * Sized to the print card's content box (measured: 232px at A4 with the report's
 * own padding), at roughly the screen chart's aspect, so the drawing occupies
 * the same slot and proportion on paper as it does on screen.
 */
const W = 228;
const H = 96;
const PAD = { top: 6, right: 4, bottom: 13, left: 21 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const AXIS = "#c9d6e4";
const GRID = "#e2eaf2";
const LABEL = "#63748a";
const TICKS = [0, 25, 50, 75, 100];

function yFor(value: number, max: number): number {
  return PAD.top + PLOT_H * (1 - Math.min(value, max) / max);
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

function PrintSvg({ label, width = W, height = H, children }: { label: string; width?: number; height?: number; children: React.ReactNode }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      /* Literal px on the element itself: nothing resolves against a parent, so
         a print re-layout cannot collapse it. */
      style={{ width, height, display: "block" }}
    >
      {children}
    </svg>
  );
}

function Gridlines({ maxValue, suffix }: { maxValue: number; suffix: string }) {
  return (
    <g>
      {TICKS.map((tick) => {
        const y = yFor((tick / 100) * maxValue, maxValue);
        return (
          <g key={tick}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke={tick === 0 ? AXIS : GRID} strokeWidth={0.6} />
            <text x={PAD.left - 3} y={y + 2.2} fill={LABEL} fontSize={6.4} textAnchor="end">
              {Math.round((tick / 100) * maxValue)}
              {suffix}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function GroupedBars({ panel }: { panel: Extract<AnalyticsPanel, { kind: "grouped-bars" }> }) {
  const { categories, series, maxValue, suffix } = panel;
  const groupW = PLOT_W / Math.max(categories.length, 1);
  const barW = Math.min(10, (groupW - 4) / series.length);

  return (
    <PrintSvg label={panel.title}>
      <Gridlines maxValue={maxValue} suffix={suffix} />
      {categories.map((category, index) => {
        const groupLeft = PAD.left + groupW * index;
        const start = groupLeft + (groupW - barW * series.length) / 2;
        return (
          <g key={category}>
            {series.map((serie, sIndex) => {
              const y = yFor(serie.values[index] ?? 0, maxValue);
              return (
                <rect
                  key={serie.key}
                  x={start + barW * sIndex}
                  y={y}
                  width={Math.max(barW - 1, 1)}
                  height={Math.max(PAD.top + PLOT_H - y, 0.5)}
                  fill={serie.color}
                />
              );
            })}
            <text x={groupLeft + groupW / 2} y={H - 4} fill={LABEL} fontSize={7} textAnchor="middle">
              {category}
            </text>
          </g>
        );
      })}
    </PrintSvg>
  );
}

function Trend({ panel }: { panel: Extract<AnalyticsPanel, { kind: "trend" }> }) {
  const { categories, series, maxValue, suffix } = panel;
  const step = categories.length > 1 ? PLOT_W / (categories.length - 1) : 0;
  const xFor = (index: number) => PAD.left + step * index;

  return (
    <PrintSvg label={panel.title}>
      <Gridlines maxValue={maxValue} suffix={suffix} />
      {series.map((serie) => {
        const points = serie.values.map((value, index) => `${xFor(index)},${yFor(value, maxValue)}`).join(" ");
        return (
          <g key={serie.key}>
            <polygon
              points={`${PAD.left},${PAD.top + PLOT_H} ${points} ${xFor(serie.values.length - 1)},${PAD.top + PLOT_H}`}
              fill={serie.color}
              fillOpacity={0.14}
            />
            <polyline points={points} fill="none" stroke={serie.color} strokeWidth={1.6} strokeLinejoin="round" />
            {serie.values.map((value, index) => (
              <circle key={index} cx={xFor(index)} cy={yFor(value, maxValue)} r={1.5} fill={serie.color} />
            ))}
          </g>
        );
      })}
      {categories.map((category, index) => (
        <text key={category} x={xFor(index)} y={H - 4} fill={LABEL} fontSize={7} textAnchor="middle">
          {category}
        </text>
      ))}
    </PrintSvg>
  );
}

function HorizontalBars({ panel }: { panel: Extract<AnalyticsPanel, { kind: "hbars" }> }) {
  const { rows, maxValue, color, suffix } = panel;
  const labelW = 76;
  const valueW = 18;
  const trackLeft = labelW + 2;
  const trackW = W - trackLeft - valueW;
  const rowH = Math.min(13, (H - 6) / Math.max(rows.length, 1));
  const barH = Math.min(8, rowH - 3);

  return (
    <PrintSvg label={panel.title}>
      {rows.map((row, index) => {
        const top = 3 + rowH * index;
        const width = maxValue > 0 ? Math.max((row.value / maxValue) * trackW, 0.5) : 0.5;
        return (
          <g key={row.label}>
            <text x={0} y={top + barH / 2 + 2.3} fill={LABEL} fontSize={6.2}>
              {clip(row.label, 24)}
            </text>
            <rect x={trackLeft} y={top} width={trackW} height={barH} fill={GRID} />
            <rect x={trackLeft} y={top} width={width} height={barH} fill={color} />
            <text x={trackLeft + trackW + 2} y={top + barH / 2 + 2.3} fill={LABEL} fontSize={6.4}>
              {row.value}
              {suffix}
            </text>
          </g>
        );
      })}
    </PrintSvg>
  );
}

const DONUT = 56;
const R_OUTER = 26;
const R_INNER = 15.5;

/** Annulus segment between two fractions of a turn, starting at 12 o'clock. */
function ringSegment(startFraction: number, endFraction: number): string {
  const c = DONUT / 2;
  const a0 = startFraction * Math.PI * 2 - Math.PI / 2;
  const a1 = endFraction * Math.PI * 2 - Math.PI / 2;
  const large = endFraction - startFraction > 0.5 ? 1 : 0;
  const point = (radius: number, angle: number) =>
    `${(c + radius * Math.cos(angle)).toFixed(2)},${(c + radius * Math.sin(angle)).toFixed(2)}`;

  return [
    `M${point(R_OUTER, a0)}`,
    `A${R_OUTER},${R_OUTER} 0 ${large} 1 ${point(R_OUTER, a1)}`,
    `L${point(R_INNER, a1)}`,
    `A${R_INNER},${R_INNER} 0 ${large} 0 ${point(R_INNER, a0)}`,
    "Z",
  ].join(" ");
}

function Ring({ panel }: { panel: Extract<AnalyticsPanel, { kind: "donut" }> }) {
  const total = panel.slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) return <PrintSvg label={panel.title} width={DONUT} height={DONUT}>{null}</PrintSvg>;

  return (
    <PrintSvg label={panel.title} width={DONUT} height={DONUT}>
      {panel.slices.length === 1 ? (
        // One slice is a full circle; an arc from 0 to 2π degenerates, so stroke
        // a circle instead.
        <circle cx={DONUT / 2} cy={DONUT / 2} r={(R_OUTER + R_INNER) / 2} fill="none" stroke={panel.slices[0].color} strokeWidth={R_OUTER - R_INNER} />
      ) : (
        panel.slices.map((slice, index) => {
          const start = panel.slices.slice(0, index).reduce((sum, s) => sum + s.value, 0) / total;
          return <path key={slice.name} d={ringSegment(start, start + slice.value / total)} fill={slice.color} />;
        })
      )}
    </PrintSvg>
  );
}

/**
 * The print drawing for one panel, or null when the panel's content is plain
 * HTML (stat, ratings, empty) that both modes already share.
 */
export function PrintChartBody({ panel }: { panel: AnalyticsPanel }): React.ReactElement | null {
  switch (panel.kind) {
    case "grouped-bars":
      return <GroupedBars panel={panel} />;
    case "trend":
      return <Trend panel={panel} />;
    case "hbars":
      return <HorizontalBars panel={panel} />;
    case "donut":
      return <Ring panel={panel} />;
    default:
      return null;
  }
}

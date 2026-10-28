/**
 * Phase 13.12 closure — the Project Progress S-curve, read from what 13.12
 * already froze (`docs/02` §26.7):
 *
 *   Original baseline  the approved BL0 revision's engine-calculated curve
 *   Current baseline   the approved BLn revision's curve (omitted when BLn is BL0)
 *   Forecast           the snapshot's frozen forecast curve, opening at EV
 *   Earned             the snapshot's own EV, at its Data Date
 *
 * Pure. Nothing is calculated here: every value is a stored point, plotted at
 * its own date. Points are never interpolated onto another series' dates and
 * a missing value is never plotted as zero — a series simply has no value on
 * a date it was not sampled at. The earned history across earlier snapshots
 * (one EV point per Data Date) is the 13.14 consumer slice.
 */

import type { PlanningCurvePoint } from "@/types";

export type SCurveSeries = "original" | "current" | "forecast" | "earned";

export interface SCurveRow {
  date: string;
  original?: number;
  current?: number;
  forecast?: number;
  earned?: number;
}

export interface SCurveInput {
  original: readonly PlanningCurvePoint[];
  /** `null` when the current baseline IS the original (BLn = BL0). */
  current: readonly PlanningCurvePoint[] | null;
  forecast: readonly PlanningCurvePoint[];
  dataDate?: string;
  earned?: number | null;
}

/** One row per sampled date, ascending; each series only where it has a point. */
export function sCurveRows(input: SCurveInput): SCurveRow[] {
  const rows = new Map<string, SCurveRow>();
  const at = (date: string) => {
    let row = rows.get(date);
    if (!row) {
      row = { date };
      rows.set(date, row);
    }
    return row;
  };
  for (const point of input.original) at(point.date).original = point.value;
  for (const point of input.current ?? []) at(point.date).current = point.value;
  for (const point of input.forecast) at(point.date).forecast = point.value;
  if (input.dataDate && typeof input.earned === "number" && Number.isFinite(input.earned)) {
    at(input.dataDate).earned = input.earned;
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** The series that actually have data, in legend order. */
export function sCurveSeriesPresent(input: SCurveInput): SCurveSeries[] {
  const present: SCurveSeries[] = [];
  if (input.original.length > 0) present.push("original");
  if (input.current && input.current.length > 0) present.push("current");
  if (input.forecast.length > 0) present.push("forecast");
  if (input.dataDate && typeof input.earned === "number" && Number.isFinite(input.earned)) present.push("earned");
  return present;
}

/** Why a frozen forecast curve is absent, in words (the writer stores the engine's reason code). */
export function forecastCurveReasonText(reason: string | undefined): string | null {
  if (!reason) return null;
  if (reason === "forecast_missing") return "an incomplete activity had no forecast finish when the snapshot was published";
  if (reason === "baseline_missing") return "an activity had no baseline dates when the snapshot was published";
  return "the forecast could not be calculated when the snapshot was published";
}

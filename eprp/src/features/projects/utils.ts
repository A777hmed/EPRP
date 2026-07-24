import type { Project } from "@/types";
import { calculateSpi, scheduleVariance } from "@/lib/reporting";

/**
 * Project progress and date logic (Phase 5A). Pure functions — UI
 * components call these instead of embedding calculations.
 */

/** Schedule variance in percentage points (actual − planned). */
export function projectVariance(project: Pick<Project, "plannedProgress" | "actualProgress">): number {
  return scheduleVariance(project.plannedProgress, project.actualProgress);
}

/** SPI (actual / planned); 0 when nothing is planned yet. */
export function projectSpi(project: Pick<Project, "plannedProgress" | "actualProgress">): number {
  return calculateSpi(project.plannedProgress, project.actualProgress);
}

export function isValidProgress(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

export function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** True when `b` is on or after `a`. Empty/undefined values pass. */
export function isDateOnOrAfter(a?: string, b?: string): boolean {
  if (!a || !b) return true;
  return b >= a; // ISO date strings compare lexicographically
}

/** Variance display, e.g. "+2%" / "-12%" / "0%". */
export function formatVariance(variance: number): string {
  if (variance > 0) return `+${variance}%`;
  return `${variance}%`;
}

/** Tone for a variance value (not color-only — callers pair it with text). */
export function varianceTone(
  variance: number
): "success" | "warning" | "danger" | "neutral" {
  if (variance > 0) return "success";
  if (variance === 0) return "neutral";
  if (variance >= -5) return "warning";
  return "danger";
}

/** Total systems across all department assignments. */
export function countSystems(project: Pick<Project, "departments">): number {
  return project.departments.reduce((sum, d) => sum + d.systems.length, 0);
}

/**
 * Small formatting helpers shared across the Dashboard's detail surfaces
 * (summary modals, the expanded progress-curve modal, the Project
 * Workspace). Pure presentation only — every value it formats was already
 * computed by `dashboard-data.ts` / `planning-integration.ts`; nothing here
 * derives a figure of its own.
 */

import type { DrawerTone } from "@/components/shared";
import { HEALTH_META, round, type ProjectPosition } from "../dashboard-data";

export function pct(value: number | undefined | null): string {
  return typeof value === "number" ? `${round(value)}%` : "—";
}

export function signedPct(value: number | undefined | null): string {
  if (typeof value !== "number") return "—";
  return `${value > 0 ? "+" : ""}${round(value)}%`;
}

/** Matches `healthOf`'s own bands (`dashboard-data.ts`) — never a second
    threshold set. */
export function varianceTone(variance: number | undefined | null): DrawerTone {
  if (typeof variance !== "number") return "default";
  if (variance >= -3) return "success";
  if (variance >= -10) return "warning";
  return "danger";
}

/** `HEALTH_META`'s tone vocabulary ("default") is Dashboard-local; the
    shared `StatusBadge`/`DrawerTone` vocabulary speaks "neutral"/"default"
    respectively. One mapping each, so no call site needs its own. */
export function healthStatusBadgeTone(
  health: ProjectPosition["health"]
): "success" | "warning" | "danger" | "info" | "neutral" {
  const tone = HEALTH_META[health].tone;
  return tone === "default" ? "neutral" : tone;
}

export function healthDrawerTone(health: ProjectPosition["health"]): DrawerTone {
  const tone = HEALTH_META[health].tone;
  return tone === "default" || tone === "info" ? "default" : tone;
}

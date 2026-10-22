"use client";

import * as React from "react";

import {
  browserEnvironment,
  type ForegroundPollEnvironment,
} from "@/features/notifications/foreground-poll";

/**
 * Phase 13.11 UAT — fresh governance and planning state when the user comes
 * back to a tab. An amendment approved in another tab (or by another person)
 * must show here without a manual browser refresh.
 *
 * Reuses the notification layer's foreground signal (`visibilitychange` +
 * window `focus`); there is no timer and no polling. The two events usually
 * arrive together, so returns closer than `minGapMs` count once.
 */
export function subscribeToReturn(
  onReturn: () => void,
  options: {
    environment?: Pick<ForegroundPollEnvironment, "isVisible" | "onVisibilityChange">;
    now?: () => number;
    minGapMs?: number;
  } = {}
): () => void {
  const environment = options.environment ?? browserEnvironment;
  const now = options.now ?? Date.now;
  const minGapMs = options.minGapMs ?? 1_000;
  let last = Number.NEGATIVE_INFINITY;
  return environment.onVisibilityChange(() => {
    if (!environment.isVisible()) return;
    const at = now();
    if (at - last < minGapMs) return;
    last = at;
    onReturn();
  });
}

/**
 * A counter that increases each time the user returns to this tab. Add it to
 * a loader's effect dependencies to re-read on return; the loader keeps its
 * previous data on screen while it re-reads.
 */
export function useReturnRefresh(): number {
  const [token, setToken] = React.useState(0);
  React.useEffect(() => subscribeToReturn(() => setToken((current) => current + 1)), []);
  return token;
}

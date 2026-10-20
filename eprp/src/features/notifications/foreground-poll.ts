/**
 * Foreground-only refresh for the notification toasts (13.9B UAT polish).
 *
 * Runs `run` once at start, again whenever the tab becomes visible, and then
 * every `intervalMs` — but only while the page is visible: a hidden tab starts
 * no timer and makes no request. No realtime / WebSocket infrastructure.
 * Environment access is injected so the behaviour is testable.
 */

export interface ForegroundPollEnvironment {
  isVisible(): boolean;
  onVisibilityChange(listener: () => void): () => void;
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const browserEnvironment: ForegroundPollEnvironment = {
  isVisible: () => typeof document === "undefined" || document.visibilityState === "visible",
  onVisibilityChange(listener) {
    document.addEventListener("visibilitychange", listener);
    window.addEventListener("focus", listener);
    return () => {
      document.removeEventListener("visibilitychange", listener);
      window.removeEventListener("focus", listener);
    };
  },
  setInterval: (handler, ms) => window.setInterval(handler, ms),
  clearInterval: (handle) => window.clearInterval(handle as number),
};

export function startForegroundPoll(
  run: () => Promise<void>,
  options: { intervalMs?: number; environment?: ForegroundPollEnvironment; onError?: (error: unknown) => void } = {}
): () => void {
  const intervalMs = options.intervalMs ?? 30_000;
  const environment = options.environment ?? browserEnvironment;
  let timer: unknown = null;
  let inFlight = false;
  let catchUp = false;
  let stopped = false;

  /*
   * `catchUpRequest`: the tab became visible or the window gained focus. That
   * refresh is GUARANTEED: if a run is already in flight it is not dropped but
   * queued, and exactly one catch-up run follows as soon as the current one
   * finishes (never two in parallel). An interval tick behind a slow run is
   * still simply skipped, so the 30 s cadence is unchanged.
   */
  const tick = (catchUpRequest: boolean) => {
    if (stopped || !environment.isVisible()) return;
    if (inFlight) {
      if (catchUpRequest) catchUp = true;
      return;
    }
    inFlight = true;
    void run()
      .catch((error: unknown) => options.onError?.(error))
      .finally(() => {
        inFlight = false;
        if (catchUp) {
          catchUp = false;
          tick(false);
        }
      });
  };
  const startTimer = () => {
    if (timer === null) timer = environment.setInterval(() => tick(false), intervalMs);
  };
  const stopTimer = () => {
    if (timer !== null) {
      environment.clearInterval(timer);
      timer = null;
    }
  };
  const sync = () => {
    if (environment.isVisible()) {
      startTimer();
      tick(true);
    } else {
      stopTimer();
    }
  };

  const unsubscribe = environment.onVisibilityChange(sync);
  sync();
  return () => {
    stopped = true;
    stopTimer();
    unsubscribe();
  };
}

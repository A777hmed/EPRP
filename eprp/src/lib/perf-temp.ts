/**
 * TEMPORARY DIAGNOSTIC — Project Reporting latency investigation.
 *
 * =========================================================================
 * DELETE THIS FILE, AND EVERY `[reporting-perf]` CALL SITE, WHEN THE
 * INVESTIGATION IS CLOSED. Search the repo for "reporting-perf" to find them.
 * =========================================================================
 *
 * Measures only. Changes no behaviour, no data, no authorization: every helper
 * runs the work it was given, returns its result untouched, and writes one
 * console line. Errors propagate exactly as they would without it — the timing
 * is recorded in a `finally`, so a throwing stage is still reported and still
 * throws.
 *
 * Works on both sides of the boundary: `performance.now()` is available in
 * Node and in the browser, and the label carries `server:` / `client:` so a
 * single log stream stays readable.
 */

const PREFIX = "[reporting-perf]";

function where(): string {
  return typeof window === "undefined" ? "server" : "client";
}

function report(label: string, ms: number): void {
  console.log(`${PREFIX} ${where()}:${label} ${Math.round(ms)}ms`);
}

/** Time one awaited stage. Returns the awaited value unchanged. */
export async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    return await run();
  } finally {
    report(label, performance.now() - started);
  }
}

/** Time a synchronous stage (mapping, transforms). Returns its value. */
export function timedSync<T>(label: string, run: () => T): T {
  const started = performance.now();
  try {
    return run();
  } finally {
    report(label, performance.now() - started);
  }
}

/**
 * A manual stopwatch, for spans that do not wrap a single call — a whole
 * effect, or a total that closes after several awaits.
 */
export function startTimer(label: string): () => void {
  const started = performance.now();
  return () => report(label, performance.now() - started);
}

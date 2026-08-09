/**
 * Supabase transport resilience.
 *
 * `fetch` rejects with a `TypeError` when a request never completes — DNS
 * failure, refused connection, dropped socket. The browser words it
 * "Failed to fetch", Node "fetch failed". Supabase logs that raw error to the
 * console and re-throws it as an `AuthRetryableFetchError`, which callers were
 * reading as "no session": a signed-in user got bounced to /login and a
 * correct password was reported as incorrect.
 *
 * Two pieces fix that at the source — recover the request when it is safe to
 * repeat, and let callers tell "Supabase said no" apart from "Supabase never
 * answered".
 */

/** Methods with no side effect, so repeating them can never duplicate work. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Two extra attempts; a transient lookup failure clears well inside this. */
const RETRY_DELAYS_MS = [150, 400];

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input === "object" && "method" in input) {
    return input.method.toUpperCase();
  }
  return "GET";
}

/**
 * A rejected `fetch` means no response was received at all. An abort arrives
 * as a `DOMException`, never a `TypeError`, so a cancelled request is
 * excluded here rather than needing a separate check.
 */
function isTransportFailure(error: unknown): boolean {
  return error instanceof TypeError;
}

/**
 * Whether the request can be sent again without changing the outcome.
 *
 * Safe methods always can. Supabase auth calls (sign-in, token refresh, user
 * lookup) also can: they either never left the machine or simply re-issue the
 * same session. PostgREST writes are deliberately excluded — replaying an
 * insert whose response was lost would create a duplicate row.
 */
function isReplayable(input: RequestInfo | URL, init?: RequestInit): boolean {
  const body = init?.body ?? null;
  // A streaming body is consumed by the first attempt and cannot be re-read.
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    return false;
  }
  if (SAFE_METHODS.has(requestMethod(input, init))) return true;
  return requestUrl(input).includes("/auth/v1/");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps `fetch` so a transient network failure is retried a bounded number of
 * times. Any HTTP response — 400, 401, 500 — is returned untouched, so real
 * authentication failures still surface immediately and nothing is masked.
 */
export function createRetryingFetch(baseFetch?: typeof fetch): typeof fetch {
  const send: typeof fetch =
    baseFetch ?? ((input, init) => globalThis.fetch(input, init));

  return async function retryingFetch(input, init) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await send(input, init);
      } catch (error) {
        const canRetry =
          attempt < RETRY_DELAYS_MS.length &&
          isTransportFailure(error) &&
          isReplayable(input, init);

        if (!canRetry) throw error;
        await delay(RETRY_DELAYS_MS[attempt]);
      }
    }
  };
}

/**
 * True when Supabase could not be reached or could not answer, so the session
 * state is simply unknown.
 *
 * `getUser()` reports `user: null` both for "this visitor is signed out" and
 * for "the request failed", which is why the two must be separated before any
 * redirect or error message is chosen. `status` is 0 when the request never
 * got a response and 5xx when the service itself failed; every other answer
 * (400 for a missing session, 401, 403) is Supabase genuinely saying no.
 */
export function isSupabaseUnreachable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const { name, status } = error as { name?: unknown; status?: unknown };
  if (name === "AuthRetryableFetchError") return true;
  if (typeof status !== "number") return false;
  return status === 0 || status >= 500;
}

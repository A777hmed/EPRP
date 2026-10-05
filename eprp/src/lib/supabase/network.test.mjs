// Supabase transport resilience (src/lib/supabase/network.ts): what is retried,
// what is not, and what a caller reads afterwards. No network: every request
// goes to an injected fake `fetch`.
//   node --import ./src/features/notifications/test-runtime.mjs --experimental-transform-types --test src/lib/supabase/network.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { createRetryingFetch, isSupabaseUnreachable } from "./network.ts";

const REST = "http://127.0.0.1:54321/rest/v1/profiles?select=role";
const AUTH_USER = "http://127.0.0.1:54321/auth/v1/user";
const AUTH_TOKEN = "http://127.0.0.1:54321/auth/v1/token?grant_type=refresh_token";

/** A fake fetch that answers each attempt from a script, recording every call. */
function scripted(...outcomes) {
  const calls = [];
  const send = async (input, init) => {
    calls.push({ input, init, at: performance.now() });
    const next = outcomes[Math.min(calls.length - 1, outcomes.length - 1)];
    if (next instanceof Error || next instanceof DOMException) throw next;
    return next;
  };
  return { calls, fetch: createRetryingFetch(send) };
}

/** The exact reason the wrapper's own deadline produces: AbortSignal.timeout(). */
async function ownTimeoutReason() {
  const signal = AbortSignal.timeout(1);
  await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
  return signal.reason;
}

// The wrapper logs one [reporting-perf] line per attempt; keep test output clean.
test.beforeEach(() => {
  test.mock.method(console, "log", () => {});
});
test.afterEach(() => test.mock.restoreAll());

test("a successful request is returned untouched, in one attempt, with a deadline attached", async () => {
  const response = new Response("ok", { status: 200 });
  const { calls, fetch } = scripted(response);
  const init = { method: "GET", headers: { apikey: "k" } };
  assert.equal(await fetch(REST, init), response);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].init.headers, init.headers);
  assert.equal(calls[0].init.method, "GET");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(calls[0].init.signal.aborted, false);
  // Any HTTP answer is an answer — never retried, never masked.
  const refused = scripted(new Response("no", { status: 401 }));
  assert.equal((await refused.fetch(AUTH_USER)).status, 401);
  assert.equal(refused.calls.length, 1);
});

test("a TypeError transport failure is retried: 3 attempts, 150 ms then 400 ms apart", async () => {
  const response = new Response("ok");
  const { calls, fetch } = scripted(new TypeError("fetch failed"), new TypeError("fetch failed"), response);
  assert.equal(await fetch(REST), response);
  assert.equal(calls.length, 3);
  const gaps = [calls[1].at - calls[0].at, calls[2].at - calls[1].at];
  assert.ok(gaps[0] >= 140 && gaps[0] < 390, `first backoff ${gaps[0]} ms`);
  assert.ok(gaps[1] >= 390, `second backoff ${gaps[1]} ms`);
});

test("a persistent TypeError fails after exactly 3 attempts with the original error", async () => {
  const failure = new TypeError("fetch failed");
  const { calls, fetch } = scripted(failure);
  await assert.rejects(fetch(AUTH_USER), (error) => error === failure);
  assert.equal(calls.length, 3);
});

test("the wrapper's own timeout is NOT retried: it fails once, promptly", async () => {
  const reason = await ownTimeoutReason();
  assert.equal(reason.name, "TimeoutError");
  for (const url of [REST, AUTH_USER, AUTH_TOKEN]) {
    const { calls, fetch } = scripted(reason);
    const started = performance.now();
    await assert.rejects(fetch(url, { method: url === AUTH_TOKEN ? "POST" : "GET" }), (error) => error === reason);
    assert.equal(calls.length, 1, url);
    // No backoff wait: control returns to the caller at once.
    assert.ok(performance.now() - started < 100, url);
  }
  // Callers still read it as "unreachable", never as "signed out".
  assert.equal(isSupabaseUnreachable(reason), true);
});

test("an abort raised by the wrapper's deadline signal is not retried", async () => {
  // The fake honours the signal it is given, as fetch does: it rejects with
  // the signal's reason when that signal aborts. A caller signal that is
  // already aborted stands in for the deadline firing.
  const deadline = AbortSignal.abort(await ownTimeoutReason());
  const calls = [];
  const fetch = createRetryingFetch(async (input, init) => {
    calls.push(init);
    if (init.signal.aborted) throw init.signal.reason;
    return new Response("unreachable");
  });
  await assert.rejects(fetch(REST, { signal: deadline }), (error) => error.name === "TimeoutError");
  assert.equal(calls.length, 1);
});

test("a caller's own abort (AbortError) propagates at once and is not retried", async () => {
  const abort = new DOMException("The operation was aborted.", "AbortError");
  const { calls, fetch } = scripted(abort);
  await assert.rejects(fetch(REST), (error) => error === abort);
  assert.equal(calls.length, 1);
});

test("writes stay non-retried; auth calls stay retryable on a TypeError, as before", async () => {
  const failure = new TypeError("fetch failed");
  for (const method of ["POST", "PATCH", "DELETE"]) {
    const { calls, fetch } = scripted(failure);
    await assert.rejects(fetch(REST, { method, body: "{}" }), (error) => error === failure);
    assert.equal(calls.length, 1, method);
  }
  // Supabase auth calls (token refresh is a POST) re-issue the same session.
  const response = new Response("{}");
  const token = scripted(failure, response);
  assert.equal(await token.fetch(AUTH_TOKEN, { method: "POST", body: "{}" }), response);
  assert.equal(token.calls.length, 2);
  // A streaming body cannot be re-read, so it is never retried.
  const stream = scripted(failure);
  await assert.rejects(stream.fetch(AUTH_TOKEN, { method: "POST", body: new ReadableStream() }));
  assert.equal(stream.calls.length, 1);
});

test("isSupabaseUnreachable is unchanged: transport, timeout and 5xx yes; a real answer no", () => {
  assert.equal(isSupabaseUnreachable({ name: "AuthRetryableFetchError" }), true);
  assert.equal(isSupabaseUnreachable({ status: 0 }), true);
  assert.equal(isSupabaseUnreachable({ status: 503 }), true);
  assert.equal(isSupabaseUnreachable({ status: 401 }), false);
  assert.equal(isSupabaseUnreachable({ status: 400 }), false);
  assert.equal(isSupabaseUnreachable(null), false);
});

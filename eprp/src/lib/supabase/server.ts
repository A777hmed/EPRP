import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import type { Database } from "./database.types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
// [reporting-perf] TEMPORARY diagnostic import — remove with src/lib/perf-temp.ts
import { timed } from "@/lib/perf-temp";
import { createRetryingFetch } from "./network";

/**
 * Server Supabase client (anon key + request cookies). For Server
 * Components, Route Handlers, and Server Actions. Subject to RLS.
 *
 * `cache()`d, so one request builds ONE client however many callers ask for
 * it. `getAuthenticatedUser()` and the profile read in `getCurrentUserIdentity()`
 * were each constructing their own — two `await cookies()` calls and two GoTrue
 * client instances per request, for a client that is identical both times
 * because it is bound to the same request's cookies.
 *
 * Request-scoped, exactly like the callers that already use `cache()`: React
 * clears it between requests, so no client, cookie or session is ever shared
 * across requests or across users. Authorization semantics are untouched —
 * the same anon key, the same cookies, the same RLS.
 */
export const createSupabaseServerClient = cache(async () => {
  /* [reporting-perf] TEMPORARY — see src/lib/perf-temp.ts. One line per REAL
     construction. If `cache()` is working, exactly one appears per request
     however many callers ask; more than one would disprove the dedup. The
     `cookies()` await is timed separately because it is a Next dynamic API
     and its cost is not obviously zero. */
  const cookieStore = await timed("supabaseServerClient.cookies", async () =>
    cookies()
  );

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    // Sign-in and every server read go through here, so a transient DNS
    // failure would otherwise read as "wrong password" or "signed out".
    global: { fetch: createRetryingFetch() },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `setAll` called from a Server Component — safe to ignore when
          // middleware refreshes the session.
        }
      },
    },
  });
});

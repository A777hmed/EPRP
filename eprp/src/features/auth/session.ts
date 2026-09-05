import "server-only";

import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
// [reporting-perf] TEMPORARY diagnostic import — remove with src/lib/perf-temp.ts
import { timed } from "@/lib/perf-temp";

/**
 * Server-side session access (Phase A2).
 *
 * Always `getUser()`, never `getSession()`. `getSession()` reads the cookie
 * without contacting Supabase, so a forged or stale cookie would be trusted;
 * `getUser()` revalidates the token against the auth server. Authorization
 * decisions must only ever use this.
 *
 * `cache` de-duplicates the call within a single request, so a layout and a
 * page asking for the user do not produce two round trips.
 */
export const getAuthenticatedUser = cache(async () => {
  // Without env vars the app still runs on mock data; treat that as signed out
  // rather than throwing on every request.
  if (!isSupabaseConfigured()) return null;

  /* [reporting-perf] TEMPORARY — see src/lib/perf-temp.ts. `cache()` means
     this body runs at most once per request, so a single line here is one
     real round trip to the auth server, not one per caller. */
  return timed("auth.getUser", async () => {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user ?? null;
  });
});

import "server-only";

import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

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

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user ?? null;
});

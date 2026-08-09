"use client";

import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./database.types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { createRetryingFetch } from "./network";

/**
 * Browser Supabase client (anon key). Safe for client components — subject
 * to Row Level Security. Returns a singleton per browser session.
 */
let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function getSupabaseBrowserClient() {
  if (!client) {
    client = createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      // A dropped connection surfaced as "TypeError: Failed to fetch" in the
      // console and an empty screen; retrying rides out the blip. Writes are
      // never replayed — see `createRetryingFetch`.
      global: { fetch: createRetryingFetch() },
    });
  }
  return client;
}

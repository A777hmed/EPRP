import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import type { Database } from "./database.types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { createRetryingFetch } from "./network";

/**
 * Server Supabase client (anon key + request cookies). For Server
 * Components, Route Handlers, and Server Actions. Subject to RLS.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

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
}

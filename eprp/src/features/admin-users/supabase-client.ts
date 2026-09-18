import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Loosely-typed client for `profiles` reads/writes.
 *
 * The generated `Database` type resolves `.select()`/`.insert()`/`.update()`
 * on `profiles` to `never` (see admin-users/data.ts), so mutations go through
 * this cast instead of relying on inference — the same pattern already used
 * elsewhere in the app (e.g. `supabase-project-service.ts`). Shared by every
 * admin-users component that writes to `profiles` so the cast exists once.
 */
export function client(): SupabaseClient {
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

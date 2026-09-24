import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getAuthenticatedUser } from "./session";

/**
 * The fourth authorization axis (Phase B): a portfolio-wide READ ONLY
 * entitlement (`portfolio_read_grants`), independent of `profiles.role`,
 * `project_contacts.role` and `project_contacts.assignment_role`.
 *
 * "none" rather than `null` so every caller handles all three states
 * explicitly instead of treating a missing grant as falsy along with every
 * other unrelated absence.
 */
export type PortfolioReadTier = "full" | "published" | "none";

/**
 * The signed-in user's OWN current portfolio-read tier.
 *
 * Reads `portfolio_read_grants` directly for `profile_id = auth.uid()` —
 * exactly the row `portfolio_read_grants_select`'s own policy admits a
 * non-admin caller (own row, or System Administrator). Deliberately NOT
 * `listPortfolioReadGrants()` (`features/admin-users/actions.ts`): that
 * function exists to list EVERY account's grant for the Users & Roles screen
 * and is reached only from admin UI. Viewer-scope resolution asks a
 * narrower question — "what is MY OWN grant?" — so it reads its own row
 * directly rather than going through an admin-listing API.
 *
 * Presentation only, like the rest of this module: RLS is the actual
 * boundary. `has_full_portfolio_read()` / `has_published_portfolio_read()`
 * additionally require the underlying profile to be `active`; this read
 * does not repeat that check, so a deactivated account may see a tier here
 * that the database independently refuses to honour on every row it would
 * otherwise reach — the same "presentation vs. enforcement" split already
 * documented on `getCurrentUserIdentity()`.
 */
export const getCurrentPortfolioReadTier = cache(
  async (): Promise<PortfolioReadTier> => {
    if (!isSupabaseConfigured()) return "none";

    const user = await getAuthenticatedUser();
    if (!user) return "none";

    // `portfolio_read_grants` is not in the generated `Database` type yet
    // (see `admin-users/actions.ts`, same cast, same reason): `.select()`
    // against it resolves to `never` on the typed client otherwise.
    const supabase = (await createSupabaseServerClient()) as unknown as SupabaseClient;
    const { data } = await supabase
      .from("portfolio_read_grants")
      .select("tier")
      .eq("profile_id", user.id)
      .is("revoked_at", null)
      .maybeSingle();

    const tier = (data as { tier?: string } | null)?.tier;
    return tier === "full" || tier === "published" ? tier : "none";
  }
);

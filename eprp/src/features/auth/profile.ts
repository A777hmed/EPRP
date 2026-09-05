import "server-only";

import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { ProfileRow } from "@/lib/supabase/database.types";
import type { UserRole } from "@/types";
import { ROLE_LABELS } from "@/config/permissions";
// [reporting-perf] TEMPORARY diagnostic import — remove with src/lib/perf-temp.ts
import { timed } from "@/lib/perf-temp";
import { getAuthenticatedUser } from "./session";

/**
 * The signed-in user's application identity, for display.
 *
 * Reads the `profiles` row created in Phase A1. This is a read only — it
 * creates nothing and changes no policy; RLS already restricts each user to
 * their own row.
 */
export interface CurrentUserIdentity {
  fullName: string;
  /** Localised role name, or undefined when no profile row exists yet. */
  roleLabel?: string;
  initials: string;
  /** Login credential address. Any provider; never used for authorization. */
  email: string;
  /**
   * The raw role, as opposed to `roleLabel` which is for display.
   *
   * Needed because scope resolution asks "is this a system administrator?",
   * a question a translated label cannot answer.
   */
  role?: UserRole;
  /**
   * The `contacts` row this account is linked to, or null when the
   * administrator has not linked it yet.
   *
   * This is the join that makes project scope resolvable: assignments hang
   * off a contact, not off a login. A null here means the account has no
   * scoped access at all — which is correct, and is why it is surfaced
   * rather than defaulted.
   */
  contactId: string | null;
}

function isKnownRole(value: string): value is UserRole {
  return value in ROLE_LABELS;
}

/** "Ahmed Morsy" → "AM"; falls back to the first character available. */
function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export const getCurrentUserIdentity = cache(
  async (): Promise<CurrentUserIdentity | null> => {
    if (!isSupabaseConfigured()) return null;

    const user = await getAuthenticatedUser();
    if (!user) return null;

    /* [reporting-perf] TEMPORARY — see src/lib/perf-temp.ts. Also `cache()`d,
       so this is the single profiles read for the whole request even though
       TopBar and SidebarWelcomeCard both ask for it. */
    const { data } = await timed("identity.profileRow", async () => {
      const supabase = await createSupabaseServerClient();
      return supabase
        .from("profiles")
        .select("full_name, role, email, contact_id")
        .eq("id", user.id)
        .maybeSingle();
    });

    const profile = data as Pick<
      ProfileRow,
      "full_name" | "role" | "email" | "contact_id"
    > | null;

    // An account can exist in auth.users before the administrator creates its
    // profile row, so fall back to the email local part rather than failing.
    const email = profile?.email ?? user.email ?? "";
    const fullName = profile?.full_name?.trim() || email.split("@")[0] || "there";

    const role =
      profile?.role && isKnownRole(profile.role) ? profile.role : undefined;

    return {
      fullName,
      roleLabel: role ? ROLE_LABELS[role] : undefined,
      initials: initialsFrom(fullName),
      email,
      role,
      contactId: profile?.contact_id ?? null,
    };
  }
);

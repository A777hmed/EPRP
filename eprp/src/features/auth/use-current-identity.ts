"use client";

import * as React from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
// [reporting-perf] TEMPORARY diagnostic import — remove with src/lib/perf-temp.ts
import { startTimer, timed } from "@/lib/perf-temp";

/**
 * The signed-in account's authorization identity, resolved in the browser.
 *
 * Client views that must decide what to RENDER need two facts about the
 * caller — the platform role, and the `contacts` row the login is linked to —
 * and every one of them was fetching those two facts for itself. This is that
 * one read, not a new rule: it resolves identity and stops. Who may do what is
 * still answered by the existing pure predicates in `assignment-rules.ts`,
 * which are the committed mirrors of the SQL policies.
 *
 * PRESENTATION AUTHORITY ONLY. Row-level security is the boundary and applies
 * the same rules independently — an account that defeats this gets a refused
 * write, never a wider one.
 */
export interface CurrentIdentity {
  /** The `contacts` row this login is linked to; "" when unlinked. */
  contactId: string;
  /** Raw `profiles.role`; "" when no profile row resolved. */
  role: string;
  /** `profiles.role = 'system_admin'`. */
  isAdmin: boolean;
  /**
   * Mirror of `has_global_operational_authority()` — System Admin or Project
   * Control Admin. Kept distinct from `isAdmin` because the scope resolver
   * takes the narrower one and the operations predicates take this.
   */
  isGlobalAuthority: boolean;
  /** False until the lookup settles, so no action flashes before it is known. */
  resolved: boolean;
}

/** Nobody. Also the correct answer for an unconfigured environment. */
export const NO_IDENTITY: CurrentIdentity = {
  contactId: "",
  role: "",
  isAdmin: false,
  isGlobalAuthority: false,
  resolved: false,
};

/* -------------------------- Shared resolution ---------------------------- */

/*
 * ONE identity resolution per browser session, not one per component.
 *
 * Every component that needed to know who is asking called this hook, and each
 * one ran its own `auth.getUser()` followed by its own `profiles` read. On the
 * project Reporting route that was four independent resolutions — eight network
 * requests for a single answer — issued simultaneously, so they also queued
 * behind each other and behind the page's real data. Measured in the browser:
 * `auth.getUser()` alone took 1230–1420 ms under that contention, against
 * ~150 ms for the same call made on its own.
 *
 * This is a request-deduplication layer, NOT a new authorization model. It
 * changes nothing about what is resolved or who may do what — the same two
 * reads produce the same `CurrentIdentity`, and RLS remains the boundary. It
 * only stops the same question being asked four times at once.
 */

/** Resolved answer for the current session, or null when not yet known. */
let cached: CurrentIdentity | null = null;
/** The auth user the cached answer belongs to, so a user change invalidates. */
let cachedUserId: string | null = null;
/** In-flight resolution, shared by every caller that arrives while it runs. */
let inFlight: Promise<CurrentIdentity> | null = null;
/** Subscribers to re-run when the cache is invalidated by an auth change. */
const listeners = new Set<() => void>();
let authWatch = false;

function invalidate(): void {
  cached = null;
  cachedUserId = null;
  inFlight = null;
  for (const listener of listeners) listener();
}

/**
 * Drop the cache when the ACCOUNT changes — never on a token refresh, which
 * is the same person with a new token and must not cause a re-resolve storm.
 */
function watchAuthChanges(sb: SupabaseClient): void {
  if (authWatch) return;
  authWatch = true;
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      invalidate();
      return;
    }
    const nextUserId = session?.user?.id ?? null;
    if (cachedUserId !== null && nextUserId !== cachedUserId) invalidate();
  });
}

async function readIdentity(sb: SupabaseClient): Promise<CurrentIdentity> {
  // [reporting-perf] TEMPORARY — see src/lib/perf-temp.ts. One line per REAL
  // resolution; concurrent callers share it and produce no extra lines.
  const doneAll = startTimer("useCurrentIdentity.total");
  try {
    const { data: auth } = await timed("useCurrentIdentity.getUser", () =>
      sb.auth.getUser()
    );
    const userId = auth.user?.id;
    if (!userId) {
      cachedUserId = null;
      return { ...NO_IDENTITY, resolved: true };
    }

    // The account's own profile row, reachable through `profiles_select_own`.
    // `contact_id` is what links a login to a person projects assign work to;
    // without it nobody can be matched to an assignment.
    // `async` so the Supabase query builder (a thenable, not a Promise) is
    // awaited into a real Promise for the timing wrapper.
    const { data } = await timed("useCurrentIdentity.profileRow", async () =>
      sb.from("profiles").select("role, contact_id").eq("id", userId).maybeSingle()
    );

    const profile = data as {
      role?: string;
      contact_id?: string | null;
    } | null;
    const role = profile?.role ?? "";

    cachedUserId = userId;
    return {
      contactId: profile?.contact_id ?? "",
      role,
      isAdmin: role === "system_admin",
      isGlobalAuthority:
        role === "system_admin" || role === "project_control_admin",
      resolved: true,
    };
  } finally {
    doneAll();
  }
}

function resolveIdentity(): Promise<CurrentIdentity> {
  if (cached) return Promise.resolve(cached);
  if (inFlight) return inFlight;

  const sb = getSupabaseBrowserClient() as unknown as SupabaseClient;
  watchAuthChanges(sb);

  inFlight = readIdentity(sb)
    .then((identity) => {
      cached = identity;
      inFlight = null;
      return identity;
    })
    .catch((error: unknown) => {
      // A failure must never be cached — the next caller retries rather than
      // inheriting a permanent "nobody".
      inFlight = null;
      throw error;
    });

  return inFlight;
}

/* -------------------------------- The hook -------------------------------- */

export function useCurrentIdentity(): CurrentIdentity {
  // No backend means no login to resolve. Settle immediately as "nobody"
  // rather than leaving callers spinning on an identity that cannot arrive.
  // A resolution already completed for this session is adopted synchronously,
  // so a later-mounting component never re-renders through an unresolved state.
  const [identity, setIdentity] = React.useState<CurrentIdentity>(() => {
    if (!isSupabaseConfigured()) return { ...NO_IDENTITY, resolved: true };
    return cached ?? NO_IDENTITY;
  });

  React.useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let active = true;

    const sync = () => {
      resolveIdentity()
        .then((next) => {
          if (active) setIdentity(next);
        })
        .catch(() => {
          if (active) setIdentity({ ...NO_IDENTITY, resolved: true });
        });
    };

    // Re-run whenever the shared cache is invalidated by an auth change.
    listeners.add(sync);
    sync();

    return () => {
      active = false;
      listeners.delete(sync);
    };
  }, []);

  return identity;
}

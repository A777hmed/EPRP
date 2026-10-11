"use client";

import { isSupabaseConfigured } from "@/lib/supabase/config";
import { useCurrentIdentity, type CurrentIdentity } from "./use-current-identity";

/**
 * Who may create or edit canonical People (the global `contacts` master).
 *
 * Mirrors the `contacts` write policies: `has_global_operational_authority()`
 * — System Admin or Project Control Admin. Project Control / Planning may
 * assign EXISTING people to their own projects, but never edit the master,
 * so direct Edit Person / Add Person controls are hidden for them (2C.3C).
 *
 * PRESENTATION ONLY: row-level security is the boundary. Without a backend
 * (the in-memory mock) there is no authority model, so editing stays open.
 */
export function canEditPeopleMaster(
  identity: Pick<CurrentIdentity, "isGlobalAuthority">,
  configured: boolean = isSupabaseConfigured()
): boolean {
  return !configured || identity.isGlobalAuthority;
}

export function usePeopleMasterAuthority(): boolean {
  return canEditPeopleMaster(useCurrentIdentity());
}

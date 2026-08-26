"use client";

import * as React from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { resolveWeeklyScope, type WeeklyScope } from "@/features/weekly-reports/scope";
import { isProjectControlPlanning } from "./assignment-rules";
import type { Project } from "@/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the signed-in account may do with this project's milestones.
 *
 * The rule is NOT restated here. `resolveWeeklyScope()` already answers "what
 * of this project may this contact reach?", and the milestone policies were
 * written against the same two helpers it mirrors — `weekly_can_manage_project`
 * for identity and approval, `weekly_can_access_scope` for submitting an
 * update. This hook only supplies the caller and reads the answer off.
 *
 * PRESENTATION AUTHORITY ONLY, exactly as `useDocumentPermissions` is. Row-level
 * security is the boundary and applies the same rules independently: someone who
 * defeats this gets a refused write, not a wider one.
 *
 * Resolved on the client because the milestone panel is mounted inside client
 * section views that already hold the loaded `Project`; the server-side
 * equivalent for Weekly is `getWeeklyViewerScope`.
 */
export interface MilestoneAuthority {
  /** The viewer's resolved project scope, or null before it is known. */
  scope: WeeklyScope | null;
  /** Create, edit and archive milestone identities; decide pending updates. */
  canManage: boolean;
  /**
   * Declare the official progress for a cut-off (13.2d).
   *
   * Mirrors `can_reconcile_milestone`, which delegates through
   * `can_manage_project_setup` to `can_manage_project_operations`. That is now
   * the SAME predicate as `canManage` and `canSubmit` — the three were split
   * only while `canManage` still resolved through the consolidator pair.
   */
  canReconcile: boolean;
  /** Append an update to a milestone on this project. Operations authority. */
  canSubmit: boolean;
  /**
   * Departments the viewer may READ against. Retained for read filtering only —
   * it no longer widens `canSubmit`, because department-scoped milestone
   * submission is refused by RLS and by the approved role model.
   */
  departmentIds: string[];
  /** False until the lookup settles, so no action flashes before it is known. */
  resolved: boolean;
}

const UNRESOLVED: MilestoneAuthority = {
  scope: null,
  canManage: false,
  canReconcile: false,
  canSubmit: false,
  departmentIds: [],
  resolved: false,
};

/*
 * `managesProject(scope)` used to answer "may this account manage milestones?"
 * by reading the scope resolver's `project` capability. It has been removed.
 *
 * That capability resolves through `isProjectConsolidator()`, which admits the
 * Reporting Coordinator. It is the right answer for Weekly consolidation and
 * the WRONG answer here: the register's policies were moved to
 * `can_manage_project_operations()`, which admits Project Control only. The
 * hook was therefore offering Add / Edit / Archive and the approval queue to a
 * Reporting Coordinator, who received a refusal from the database on every
 * click. `isProjectControlPlanning()` is the mirror of that policy and is now
 * the single source for all three capabilities below.
 */

export function useMilestoneAuthority(
  project: Project | null | undefined
): MilestoneAuthority {
  const [identity, setIdentity] = React.useState<{
    contactId: string;
    isAdmin: boolean;
    role: string;
    resolved: boolean;
  }>(() =>
    // No backend means no login to resolve. Settle immediately as "nobody"
    // rather than leaving the panel spinning on an identity that cannot arrive.
    isSupabaseConfigured()
      ? { contactId: "", isAdmin: false, role: "", resolved: false }
      : { contactId: "", isAdmin: false, role: "", resolved: true }
  );

  React.useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let active = true;

    const run = async () => {
      const sb = getSupabaseBrowserClient() as unknown as SupabaseClient;
      const { data: auth } = await sb.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) {
        if (active) setIdentity({ contactId: "", isAdmin: false, role: "", resolved: true });
        return;
      }

      // The account's own profile row, reachable through `profiles_select_own`.
      // `contact_id` is what links a login to a person the project assigns work
      // to; without it nobody can be matched to an assignment.
      const { data } = await sb
        .from("profiles")
        .select("role, contact_id")
        .eq("id", userId)
        .maybeSingle();
      if (!active) return;

      const profile = data as { role?: string; contact_id?: string | null } | null;
      setIdentity({
        contactId: profile?.contact_id ?? "",
        isAdmin: profile?.role === "system_admin",
        role: profile?.role ?? "",
        resolved: true,
      });
    };

    void run().catch(() => {
      if (active) setIdentity({ contactId: "", isAdmin: false, role: "", resolved: true });
    });
    return () => {
      active = false;
    };
  }, []);

  return React.useMemo(() => {
    if (!project || !identity.resolved) return UNRESOLVED;

    /* Read scope is unchanged: it still resolves through the consolidator pair,
       because seeing the register is a reporting concern. Only WRITE authority
       moved. */
    const scope = resolveWeeklyScope(project, identity.contactId, {
      isAdmin: identity.isAdmin,
    });

    /*
     * One predicate for all three write capabilities, because the database uses
     * one for all three: `master_milestones` insert/update, `milestone_updates`
     * insert/update and the reconciliation branch all resolve to
     * `can_manage_project_operations()`.
     *
     * Department-scoped submission is deliberately NOT admitted. RLS refuses it
     * and the approved role model confirms that refusal is correct: a
     * Department User's write access is limited to their own department's
     * comments in Weekly and Monthly.
     */
    const managesOperations = isProjectControlPlanning(project, identity.contactId, {
      isGlobalAuthority:
        identity.isAdmin || identity.role === "project_control_admin",
    });

    return {
      scope,
      canManage: managesOperations,
      canReconcile: managesOperations,
      canSubmit: managesOperations,
      departmentIds: scope.departmentIds,
      resolved: true,
    };
  }, [project, identity]);
}

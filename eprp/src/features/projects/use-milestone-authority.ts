"use client";

import * as React from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { resolveWeeklyScope, type WeeklyScope } from "@/features/weekly-reports/scope";
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
   * Mirrors `can_reconcile_milestone`, which delegates to P1-A's
   * `can_manage_project_setup`: Project Control on this project, OR the
   * portfolio-wide `project_control_admin` role. Wider than `canManage` by
   * exactly that one role, and never extended to contributors.
   */
  canReconcile: boolean;
  /** Append an update to at least one milestone on this project. */
  canSubmit: boolean;
  /** Departments the viewer may submit against. Empty for a manager means all. */
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

/**
 * Project Control, in the database's terms.
 *
 * `weekly_can_manage_project` admits the system administrator, the Project
 * Control Manager and the Reporting Coordinator — which is precisely the two
 * widest capabilities the scope resolver reports. Comparing capabilities rather
 * than re-reading the project's two contact columns keeps this from becoming a
 * second, drifting copy of the rule.
 */
function managesProject(scope: WeeklyScope): boolean {
  return scope.capability === "all_projects" || scope.capability === "project";
}

/**
 * The project's assigned Project Control Manager, and ONLY them.
 *
 * Not `isProjectConsolidator()`, which also admits the Reporting Coordinator.
 * That pairing is right for setup and for accepting a report, and wrong for
 * deciding the governed official figure — a Reporting Coordinator surfaces a
 * conflict, they do not adjudicate it.
 *
 * Mirrors `can_reconcile_milestone()` clause for clause, including the union of
 * the project's own column and the project assignment. This is presentation
 * only; the database refuses the write independently either way.
 */
function isProjectControlManager(
  project: Project,
  contactId: string
): boolean {
  if (!contactId) return false;
  if (project.projectControlManagerId === contactId) return true;
  return (project.team ?? []).some(
    (member) =>
      member.contactId === contactId &&
      member.role === "project_control_manager"
  );
}

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

    const scope = resolveWeeklyScope(project, identity.contactId, {
      isAdmin: identity.isAdmin,
    });
    const canManage = managesProject(scope);

    return {
      scope,
      canManage,
      /*
       * PROJECT CONTROL ONLY — deliberately NOT `canManage`.
       *
       * `canManage` resolves through the consolidator pair and so includes the
       * Reporting Coordinator, who may accept a report but may not decide the
       * governed official figure. Mirrors `can_reconcile_milestone()`.
       */
      canReconcile:
        identity.isAdmin ||
        identity.role === "project_control_admin" ||
        isProjectControlManager(project, identity.contactId),
      // A manager may report on anything; anyone else needs at least one
      // department they are actually assigned to.
      canSubmit: canManage || scope.departmentIds.length > 0,
      departmentIds: scope.departmentIds,
      resolved: true,
    };
  }, [project, identity]);
}

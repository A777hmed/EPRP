"use client";

import * as React from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CONSOLIDATOR_ROLES, isProjectConsolidator } from "./assignment-rules";

/**
 * What the signed-in account may do to this project's reference documents.
 *
 * PRESENTATION AUTHORITY ONLY. The boundary is row-level security, which
 * independently applies the same rules to every write: a trigger refuses the
 * `deleted_at` transition for anyone but a System Administrator or the
 * project's Project Control Manager, and the DELETE policy admits System
 * Administrators alone. Hiding a button is a courtesy; the database is what
 * enforces it.
 *
 * Resolved here rather than passed down from the server page so the whole
 * change stays inside the documents feature — the two views that render the
 * panel are client components shared with unrelated sections.
 */
export interface DocumentPermissions {
  /** Metadata edit and supersede. Also granted to the Reporting Coordinator. */
  canEdit: boolean;
  /** Move to Trash and restore. NOT the Reporting Coordinator. */
  canBin: boolean;
  /** Remove the row and the stored file. System Administrator only. */
  canPurge: boolean;
  /** False until the lookup settles, so nothing flashes before it is known. */
  resolved: boolean;
}

const NONE: DocumentPermissions = {
  canEdit: false,
  canBin: false,
  canPurge: false,
  resolved: false,
};

export function useDocumentPermissions(
  projectId: string
): DocumentPermissions {
  // An unconfigured environment resolves immediately to "no rights" as the
  // INITIAL state, rather than being set from inside the effect.
  const [permissions, setPermissions] = React.useState<DocumentPermissions>(() =>
    isSupabaseConfigured() ? NONE : { ...NONE, resolved: true }
  );

  React.useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let active = true;

    const run = async () => {
      const sb = getSupabaseBrowserClient() as unknown as SupabaseClient;
      const { data: auth } = await sb.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) {
        if (active) setPermissions({ ...NONE, resolved: true });
        return;
      }

      /*
       * Three reads, all RLS-protected and issued together: the account's own
       * profile row (`profiles_select_own`), the project's two singular
       * responsibility columns, and the project's consolidator ASSIGNMENTS.
       *
       * The third is P0.6. Reading only the singular columns implemented the
       * consolidator rule a second time, and more narrowly than the database
       * does — a Reporting Coordinator assigned through `project_contacts` was
       * allowed to edit by policy and refused by this hook. It is filtered by
       * project and role rather than by contact so it can run in parallel with
       * the profile lookup that resolves `contactId`.
       */
      const [{ data: profile }, { data: project }, { data: assignments }] =
        await Promise.all([
          sb.from("profiles").select("role, contact_id").eq("id", userId).maybeSingle(),
          sb
            .from("projects")
            .select("project_control_manager_id, reporting_coordinator_id")
            .eq("id", projectId)
            .maybeSingle(),
          sb
            .from("project_contacts")
            .select("contact_id, role")
            .eq("project_id", projectId)
            .in("role", CONSOLIDATOR_ROLES as unknown as string[]),
        ]);
      if (!active) return;

      const role = (profile as { role?: string } | null)?.role;
      const contactId = (profile as { contact_id?: string | null } | null)?.contact_id;
      const projectRow = project as {
        project_control_manager_id?: string | null;
        reporting_coordinator_id?: string | null;
      } | null;
      const consolidatorRows = (assignments ?? []) as {
        contact_id: string;
        role: string;
      }[];

      const isAdmin = role === "system_admin";
      /*
       * `canBin` stays the NARROWER rule — Project Control Manager only, never
       * the Reporting Coordinator — matching `can_bin_project_document()`,
       * which 20260819000002 deliberately kept separate from
       * `weekly_can_manage_project()`. P0.6 must not widen it.
       */
      const isControlManager =
        Boolean(contactId) &&
        projectRow?.project_control_manager_id === contactId;
      /*
       * `canEdit` is the consolidator rule — and it CALLS the canonical helper
       * rather than restating its union here, so this hook cannot drift from
       * `scope.ts`, `executive-scope.ts` or `is_project_consolidator()` in SQL.
       * The rows are adapted to the shape the helper reads; nothing is invented.
       */
      const isConsolidator = isProjectConsolidator(
        {
          projectControlManagerId: projectRow?.project_control_manager_id ?? undefined,
          reportingCoordinatorId: projectRow?.reporting_coordinator_id ?? undefined,
          team: consolidatorRows.map((row) => ({
            contactId: row.contact_id,
            role: row.role,
          })),
        },
        contactId
      );

      setPermissions({
        canEdit: isAdmin || isConsolidator,
        canBin: isAdmin || isControlManager,
        canPurge: isAdmin,
        resolved: true,
      });
    };

    void run().catch(() => {
      if (active) setPermissions({ ...NONE, resolved: true });
    });
    return () => {
      active = false;
    };
  }, [projectId]);

  return permissions;
}

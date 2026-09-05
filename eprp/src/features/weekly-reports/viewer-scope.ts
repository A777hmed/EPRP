import "server-only";

import { cache } from "react";

import { getCurrentUserIdentity } from "@/features/auth/profile";
import type { Project, ProjectType } from "@/types";
import { resolveWeeklyScope, type WeeklyScope } from "./scope";

/**
 * The signed-in user's Weekly scope for one project.
 *
 * This is the bridge the Weekly UI was missing. `resolveWeeklyScope()` has
 * always been able to answer "what may this contact reach?", but nothing on
 * the page could say WHICH contact was asking: `getCurrentUserIdentity()`
 * returned a display name and a translated role label, neither of which
 * identifies a contact or distinguishes an administrator.
 *
 * With `contactId` and the raw `role` now carried on the identity, the two
 * halves join here. The rule itself is not restated — this only supplies the
 * caller and delegates.
 *
 * Resolved on the server so the answer arrives with the page rather than
 * after a round trip, and `cache()`d so several sections of one render share
 * a single profile read.
 *
 * IMPORTANT: this decides what to SHOW. It is not the security boundary —
 * row-level security is, and it enforces the same rules independently. A user
 * who defeats this sees an empty screen, not other people's data.
 */
export const getWeeklyViewerScope = cache(
  async (
    project: Project,
    projectType?: ProjectType | null
  ): Promise<WeeklyScope> => {
    const identity = await getCurrentUserIdentity();

    // No identity at all: resolve against a contact that cannot match any
    // assignment, so the result is a well-formed "none" scope rather than a
    // null the callers would each have to special-case.
    const contactId = identity?.contactId ?? "";

    return resolveWeeklyScope(project, contactId, {
      /*
       * BOTH global operational authorities, mirroring
       * `has_global_operational_authority()`.
       *
       * This read `system_admin` alone, which scoped a Project Control Admin
       * down to their own assignments even though the model and every RLS
       * policy treat them as portfolio-wide — the same defect
       * `executive-access.ts` records having fixed on its side. It mattered
       * once `canConsolidate` began gating the Weekly management actions:
       * an unassigned Project Control Admin would have lost Duplicate and
       * Archive on reports the database still lets them manage.
       */
      isAdmin:
        identity?.role === "system_admin" ||
        identity?.role === "project_control_admin",
      projectType,
    });
  }
);

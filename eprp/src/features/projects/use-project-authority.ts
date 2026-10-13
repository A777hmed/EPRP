"use client";

import * as React from "react";

import { useCurrentIdentity } from "@/features/auth/use-current-identity";
import type { Project } from "@/types";
import {
  hasProjectAssignment,
  isProjectConsolidator,
  isProjectControlPlanning,
} from "./assignment-rules";

/**
 * What the signed-in account may do with one project, for rendering.
 *
 * No rule is invented here. Each field names the SQL policy predicate it
 * mirrors, and delegates to the pure function already committed as that
 * predicate's TypeScript counterpart:
 *
 *   canManageOperations  can_manage_project_operations()  — and therefore
 *                        can_manage_project_setup(), which is defined as it
 *   canManageReporting   can_manage_reporting_workflow()
 *   canAccessProject     weekly_can_access_project()
 *
 * The split matters and must not be collapsed. Project Setup, Master
 * Milestones and Master Deliverables are OPERATIONS (Project Control only);
 * raising and consolidating Weekly/Monthly is REPORTING, which additionally
 * admits the assigned Report Coordinator. Conflating them is how the Report
 * Coordinator came to be offered Master Milestone management the database
 * refuses.
 *
 * PRESENTATION AUTHORITY ONLY, exactly as `useMilestoneAuthority` and
 * `useDocumentPermissions` are. Row-level security is the boundary and applies
 * the same rules independently, so a mismatch here produces a wrong button,
 * never a wrong write.
 */
export interface ProjectAuthority {
  /** Edit Project, Project Setup, project scope, Milestones, Deliverables. */
  canManageOperations: boolean;
  /** Raise and manage this project's Weekly and Monthly reports. */
  canManageReporting: boolean;
  /** This project concerns the viewer at all — the read predicate. */
  canAccessProject: boolean;
  /**
   * Holds Project Setup / operations authority here, whatever the project's
   * lifecycle state (2C.3E). On an archived project this account may VIEW
   * Project Setup read-only; `canManageOperations` stays false.
   */
  holdsOperations: boolean;
  /** Archived: historical and read-only for every role (2C.3E). */
  archived: boolean;
  /** False until identity settles, so no action flashes before it is known. */
  resolved: boolean;
}

const UNRESOLVED: ProjectAuthority = {
  canManageOperations: false,
  canManageReporting: false,
  canAccessProject: false,
  holdsOperations: false,
  archived: false,
  resolved: false,
};

/**
 * The rule behind {@link useProjectAuthority}, pure so it can be tested.
 *
 * Authority comes ONLY from the explicit sources the database reads: a global
 * role, or the project's named Project Control Manager / Reporting
 * Coordinator (`isProjectControlPlanning` / `isProjectConsolidator`).
 * Project membership, Party, Project Role, Reports To, positions and
 * Other-project Unit Lead / Member / Responsible / Backup are never consulted.
 *
 * Access & Visibility hotfix — an archived project is historical and
 * read-only (§D of the original hotfix ticket), for EVERY role, including the
 * two global authorities. Before this, neither `canManageOperations` nor
 * `canManageReporting` had any archived awareness at all, so "+ New Weekly
 * Report" / "+ New Monthly Report" (`project-reporting-workspace.tsx`) and
 * every Project Setup / Milestones / Deliverables action gated on this hook
 * stayed offered on an archived project's own pages. This is PRESENTATION
 * authority only — see the header comment. Since 2C.3E the database also
 * refuses every archived Project Setup write (block_archived_project_setup);
 * reporting already refused (`can_manage_reporting_workflow()`).
 */
export function resolveProjectAuthority(
  project: Project,
  identity: { contactId?: string | null; isGlobalAuthority: boolean }
): ProjectAuthority {
  const { contactId, isGlobalAuthority } = identity;
  const archived = project.status === "archived";
  const holdsOperations = isProjectControlPlanning(project, contactId, { isGlobalAuthority });
  return {
    canManageOperations: !archived && holdsOperations,
    canManageReporting:
      !archived && (isGlobalAuthority || isProjectConsolidator(project, contactId)),
    canAccessProject:
      isGlobalAuthority || hasProjectAssignment(project, contactId),
    holdsOperations,
    archived,
    resolved: true,
  };
}

export function useProjectAuthority(
  project: Project | null | undefined
): ProjectAuthority {
  const identity = useCurrentIdentity();

  return React.useMemo(() => {
    if (!project || !identity.resolved) return UNRESOLVED;
    return resolveProjectAuthority(project, identity);
  }, [project, identity]);
}

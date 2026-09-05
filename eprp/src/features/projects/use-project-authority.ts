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
  /** False until identity settles, so no action flashes before it is known. */
  resolved: boolean;
}

const UNRESOLVED: ProjectAuthority = {
  canManageOperations: false,
  canManageReporting: false,
  canAccessProject: false,
  resolved: false,
};

export function useProjectAuthority(
  project: Project | null | undefined
): ProjectAuthority {
  const identity = useCurrentIdentity();

  return React.useMemo(() => {
    if (!project || !identity.resolved) return UNRESOLVED;

    const { contactId, isGlobalAuthority } = identity;

    return {
      canManageOperations: isProjectControlPlanning(project, contactId, {
        isGlobalAuthority,
      }),
      canManageReporting:
        isGlobalAuthority || isProjectConsolidator(project, contactId),
      canAccessProject:
        isGlobalAuthority || hasProjectAssignment(project, contactId),
      resolved: true,
    };
  }, [project, identity]);
}

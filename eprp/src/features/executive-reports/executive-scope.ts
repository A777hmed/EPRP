/**
 * Which projects an Executive viewer may see.
 *
 * Pure and framework-free so the same rule can be applied on the server and in
 * the browser without being written twice.
 *
 * The predicate deliberately MIRRORS the SQL function
 * `public.weekly_can_access_project()` (`20260810000002_weekly_rls.sql`):
 *
 *     system admin ............... every project
 *     project control / reporting  their own projects, via the project's own fields
 *     any scoped assignment ...... the projects they are assigned to
 *     anyone else ................ nothing
 *
 * IMPORTANT — this decides what to RENDER, and at portfolio altitude it is NOT
 * yet a security boundary. The four Weekly tables and the four Monthly tables
 * carry real scoped policies, but `projects` still carries the temporary
 * `for all to authenticated using (true)` policy from Phase 3. Until that is
 * replaced (roadmap Phase 12), a determined caller could read project master
 * data directly through PostgREST regardless of this filter. Portfolio RLS
 * hardening is a production prerequisite for this module — see the Executive
 * limitations note in `docs/15_DEVELOPMENT_ROADMAP.md`.
 *
 * The reporting rule this satisfies: a portfolio view is filtered by the
 * reader's access BEFORE it is aggregated, never after
 * (`03_REPORTING_ARCHITECTURE.md` §7.2) — otherwise a total would leak the
 * existence and magnitude of projects the reader cannot open.
 */

import type { Project } from "@/types";

export interface ExecutiveScopeInput {
  /** The `contacts` row this login is linked to, or null when unlinked. */
  contactId: string | null;
  /** Platform administrator — project-agnostic by definition. */
  isAdmin: boolean;
}

/** Whether one project is within the viewer's reach. */
export function canAccessProject(project: Project, scope: ExecutiveScopeInput): boolean {
  if (scope.isAdmin) return true;
  if (!scope.contactId) return false;

  if (
    project.projectControlManagerId === scope.contactId ||
    project.reportingCoordinatorId === scope.contactId
  ) {
    return true;
  }

  return (project.team ?? []).some((member) => member.contactId === scope.contactId);
}

/** The projects a viewer may aggregate over. Order is preserved. */
export function visibleProjects(projects: Project[], scope: ExecutiveScopeInput): Project[] {
  return projects.filter((project) => canAccessProject(project, scope));
}

/**
 * Why the portfolio is empty, when it is.
 *
 * An empty portfolio has three quite different causes and they must not read
 * the same: no projects exist at all, none are visible to this account, or
 * every visible one was filtered out on screen. Saying which is the difference
 * between a user knowing to ask for access and assuming the platform is broken.
 */
export function emptyPortfolioReason(input: {
  totalProjects: number;
  visibleCount: number;
  filteredCount: number;
  isAdmin: boolean;
}): string | undefined {
  const { totalProjects, visibleCount, filteredCount, isAdmin } = input;
  if (filteredCount > 0) return undefined;

  if (totalProjects === 0) {
    return "No projects exist in the platform yet.";
  }
  if (visibleCount === 0) {
    return isAdmin
      ? "No projects are available."
      : "You have no assignments on any project, so no portfolio data is available to you. Ask an administrator to assign you to a project or to link your account to a contact record.";
  }
  return "No projects match the current filters.";
}

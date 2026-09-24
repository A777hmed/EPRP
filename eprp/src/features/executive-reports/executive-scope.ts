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
import { isProjectConsolidator } from "@/features/projects/assignment-rules";
import { currentExecutiveScope } from "./executive-current-scope";

export interface ExecutiveScopeInput {
  /** The `contacts` row this login is linked to, or null when unlinked. */
  contactId: string | null;
  /** Platform administrator — project-agnostic by definition. */
  isAdmin: boolean;
  /**
   * Phase B: a portfolio-wide READ ONLY entitlement (`portfolio_read_grants`),
   * independent of `contactId`/`isAdmin` above — the same fourth axis
   * `resolveWeeklyScope()` now consults (`features/weekly-reports/scope.ts`).
   *
   * Sourced from the SAME helper, `getCurrentPortfolioReadTier()`
   * (`features/auth/portfolio-read.ts`) — this is not a second entitlement
   * mechanism, just this module's own consumption of the one that already
   * exists. `"none"` and `undefined` are equivalent (no grant).
   *
   * Grants READ reach on the project only — see {@link canAccessProject}.
   * Never consulted by anything write-side in this module
   * (`canManageExecutivePortfolio`, `canPrepareProjectExecutive` take no
   * scope at all), so it cannot widen edit/prepare/approve/finalize
   * authority.
   */
  portfolioReadTier?: "full" | "published" | "none";
}

/**
 * Whether one project is within the viewer's reach.
 *
 * A plain OR of independent conditions, so adding the portfolio-read branch
 * can only ever WIDEN what this returns — there is no "narrower wins"
 * precedence to protect here, unlike `resolveWeeklyScope()`'s capability
 * levels (which carry write authority tied to level). This function grants
 * no write authority of any kind either way.
 */
export function canAccessProject(project: Project, scope: ExecutiveScopeInput): boolean {
  if (scope.isAdmin) return true;

  /*
   * Both portfolio-read tiers see the PROJECT itself here, mirroring
   * `projects_select`'s own added branch (`has_full_portfolio_read() or
   * has_published_portfolio_read()`). Which Weekly/Monthly/Executive
   * CONTENT actually comes back for a published-tier reader is decided by
   * RLS alone (`weekly_report_viewable`, `monthly_report_viewable`,
   * `executive_reports_select`'s existing `report_status_is_approved()`
   * branch) — never re-derived or duplicated here. A published-tier reader
   * on a project with no approved/finalized/locked report yet simply sees
   * no report content for it, the same "absence is never zero" behaviour
   * Dashboard already has, rather than the project being hidden outright.
   */
  if (scope.portfolioReadTier === "full" || scope.portfolioReadTier === "published") {
    return true;
  }

  if (!scope.contactId) return false;

  // Consolidation authority comes from the canonical rule, not from a second
  // reading of the project's two singular columns — P0.6. Any other assignment
  // on the project is reach enough for the portfolio view.
  if (isProjectConsolidator(project, scope.contactId)) return true;

  return (project.team ?? []).some((member) => member.contactId === scope.contactId);
}

/** The projects a viewer may aggregate over. Order is preserved. */
export function visibleProjects(projects: Project[], scope: ExecutiveScopeInput): Project[] {
  return projects.filter((project) => canAccessProject(project, scope));
}

/**
 * Live Executive management scope: access-filtered AND non-archived.
 *
 * Keep this separate from {@link visibleProjects}. The latter intentionally
 * remains access-only so historical Executive registers can still expose an
 * archived project's retained Monthly history.
 */
export function currentExecutiveProjects(
  projects: Project[],
  scope: ExecutiveScopeInput
): Project[] {
  return currentExecutiveScope(visibleProjects(projects, scope));
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

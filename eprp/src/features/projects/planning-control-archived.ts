import type { Project } from "@/types";

/**
 * Phase 13.9 — an archived project's Planning, Master Milestones and Master
 * Deliverables are history: visible, never changed.
 *
 * The database refuses every such write with `[PROJECT_ARCHIVED]` and this
 * sentence (`guard_archived_project_planning()`, migration
 * 20261014090000); the screens withdraw the actions first and say the same
 * words. Same shape as the 2C.3E Project Setup rule in `setup-save.ts`.
 */
export const PLANNING_CONTROL_ARCHIVED_MESSAGE =
  "This project is archived; its planning, milestones and deliverables are read-only.";

/** True when the project's Planning / Milestone / Deliverable records are frozen. */
export function isPlanningControlReadOnly(
  project: Pick<Project, "status"> | null | undefined
): boolean {
  return project?.status === "archived";
}

/**
 * Was this database failure the archived-project freeze?
 *
 * Matched on the tag, not the SQLSTATE: 42501 is also what an ordinary RLS
 * refusal raises, and the two need different words.
 */
export function isArchivedProjectRefusal(error: { message?: string | null }): boolean {
  return /\[PROJECT_ARCHIVED\]/.test(error.message ?? "");
}

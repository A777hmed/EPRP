import type { ProjectType } from "@/types";

/**
 * User-facing terminology for the project hierarchy.
 *
 * PSM / PSAIM projects call the level below a System a "Program & Study"
 * rather than a "Discipline". This is a **label change only** — the entity is
 * still `disciplines` / `discipline_id` everywhere in the database, services,
 * routes, and types. Nothing here may be used to branch behaviour: it feeds
 * display strings and nothing else.
 *
 * All conditional wording lives in this one resolver so components never
 * re-implement the check.
 */

export interface HierarchyTerms {
  /** "Discipline" / "Program & Study" — sentence-start or standalone label. */
  singular: string;
  /** "Disciplines" / "Programs & Studies". */
  plural: string;
  /** Lower-case singular for mid-sentence use. */
  singularLower: string;
  /** Lower-case plural for mid-sentence use. */
  pluralLower: string;
}

export const DEFAULT_HIERARCHY_TERMS: HierarchyTerms = {
  singular: "Discipline",
  plural: "Disciplines",
  singularLower: "discipline",
  pluralLower: "disciplines",
};

export const PSM_HIERARCHY_TERMS: HierarchyTerms = {
  singular: "Program & Study",
  plural: "Programs & Studies",
  singularLower: "program & study",
  pluralLower: "programs & studies",
};

/**
 * Structured project-type codes that mean PSM / PSAIM.
 *
 * Anchored at the start and closed with a word boundary on purpose: the real
 * data contains both `PSAIM-01` (Process Safety and Asset Integrity
 * Management System — a match) and `AIM-01` (Asset Integrity — *not* a
 * match). A bare `includes("AIM")` would wrongly catch both, and a bare
 * `includes("PSM")` would miss `PSAIM`.
 */
const PSM_CODE_PATTERN = /^(?:PSM|PSAIM)\b/i;

/**
 * Name fallback, used only when a type carries no code. The structured code
 * is always preferred — free text alone must not decide this.
 */
const PSM_NAME_PATTERN = /process\s+safety/i;

/** Whether a project type is a PSM / PSAIM classification. */
export function isPsmProjectType(type: ProjectType | undefined | null): boolean {
  if (!type) return false;
  const code = type.code?.trim();
  if (code) return PSM_CODE_PATTERN.test(code);
  return PSM_NAME_PATTERN.test(type.name ?? "");
}

/** Hierarchy wording for a project type. Unknown / absent falls back to Discipline. */
export function hierarchyTermsFor(
  type: ProjectType | undefined | null
): HierarchyTerms {
  return isPsmProjectType(type) ? PSM_HIERARCHY_TERMS : DEFAULT_HIERARCHY_TERMS;
}

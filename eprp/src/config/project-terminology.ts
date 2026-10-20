import type { ProjectType, StructureFamily } from "@/types";

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

/**
 * The PSM / PSAIM token as a whole word anywhere in free text — "PSM",
 * "PSM Project", "PSAIM Program" — but not letters inside another word.
 */
const PSM_NAME_TOKEN_PATTERN = /\b(?:PSM|PSAIM)\b/i;

/**
 * Whether a code is reserved for the PSM / PSAIM family: the same anchored,
 * word-boundary rule {@link isPsmProjectType} applies to a code
 * (`PSM`, `PSM-01`, `PSAIM-TEST`; never `AIM-01`).
 */
export function isReservedPsmCode(code: string | undefined | null): boolean {
  const value = code?.trim();
  return Boolean(value) && PSM_CODE_PATTERN.test(value as string);
}

/**
 * Whether a name is reserved for the PSM / PSAIM family, judged on its own:
 * the PSM / PSAIM token as a whole word, or "process safety" (the same name
 * pattern {@link isPsmProjectType} falls back to), in any case and spacing.
 *
 * Stricter than the family rule on purpose: it is for refusing a NEW
 * category, where a non-PSM code must not smuggle in a reserved name. It does
 * not reclassify existing records — {@link isPsmProjectType} still decides
 * which family a stored category belongs to.
 */
export function isReservedPsmName(name: string | undefined | null): boolean {
  const value = name?.trim() ?? "";
  return PSM_NAME_TOKEN_PATTERN.test(value) || PSM_NAME_PATTERN.test(value);
}

/** Hierarchy wording for a project type. Unknown / absent falls back to Discipline. */
export function hierarchyTermsFor(
  type: ProjectType | undefined | null
): HierarchyTerms {
  return isPsmProjectType(type) ? PSM_HIERARCHY_TERMS : DEFAULT_HIERARCHY_TERMS;
}

/**
 * Whether a project is PSM (Phase 2C.1). The project's explicit
 * `structureFamily` wins. A legacy project with none (never classified) is
 * judged by its project type; failing that, by the PSM / PSAIM token as a whole
 * word in its own project CODE (e.g. `MDP-PSAIM-01`).
 *
 * The code fallback exists because an unclassified legacy project's type is
 * its Project Category, which a governed amendment may legitimately change
 * (13.9B UAT: PSAIM → Asset Integrity). That must not silently relabel its
 * Programs & Studies as Disciplines. It is wording only, never a branch of
 * behaviour, and it can only ever apply to a project with no explicit family.
 */
export function isPsmProject(
  project: { structureFamily?: StructureFamily; code?: string } | undefined | null,
  type: ProjectType | undefined | null
): boolean {
  const family = project?.structureFamily;
  if (family) return family === "psm";
  if (isPsmProjectType(type)) return true;
  return PSM_NAME_TOKEN_PATTERN.test(project?.code ?? "");
}

/** Hierarchy wording for a project — explicit family first, then its type, then (legacy only) its code. */
export function hierarchyTermsForProject(
  project: { structureFamily?: StructureFamily; code?: string } | undefined | null,
  type: ProjectType | undefined | null
): HierarchyTerms {
  return isPsmProject(project, type) ? PSM_HIERARCHY_TERMS : DEFAULT_HIERARCHY_TERMS;
}

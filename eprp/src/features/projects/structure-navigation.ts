/**
 * The project's structure vocabulary for navigation (one shared model).
 *
 * A PSM / legacy project's structure is the fixed Departments → Systems →
 * Programs & Studies (or Disciplines, per its terminology). An OTHER project's
 * structure is its own configured hierarchy — one to four levels with names
 * the project chose (e.g. Function → Workstream). Every project-local surface
 * that names the structure — sidebar, overview navigation, breadcrumbs, the
 * Scope & Structure summary, the structure pages — asks THIS module, so no
 * screen hard-codes Departments / Systems / Disciplines for an Other project
 * (and none hard-codes a level name).
 *
 * Pure: no React, no service. Display and routing only — never behaviour.
 */

import type { HierarchyTerms } from "@/config/project-terminology";

/** The three fixed PSM / legacy structure sections (their ids and routes are unchanged). */
export const PSM_STRUCTURE_SECTION_IDS = ["departments", "systems", "disciplines"] as const;
export type PsmStructureSectionId = (typeof PSM_STRUCTURE_SECTION_IDS)[number];

export const isPsmStructureSectionId = (value: string): value is PsmStructureSectionId =>
  (PSM_STRUCTURE_SECTION_IDS as readonly string[]).includes(value);

/** The configured level names of an Other project. */
export interface StructureNavLevel {
  levelNumber: number;
  singularLabel: string;
  pluralLabel: string;
}

export type StructureNavItem =
  /** A fixed PSM / legacy section (route `/projects/:id/<id>`). */
  | { kind: "section"; id: PsmStructureSectionId; label: string; singular: string }
  /** One configured level of an Other project (route `/projects/:id/structure/<n>`). */
  | { kind: "level"; id: string; levelNumber: number; label: string; singular: string };

export interface StructureNav {
  /** An Other project's levels are still loading: show no structure items (never the PSM words). */
  pending: boolean;
  /** True for an Other project (its structure is the configured hierarchy). */
  other: boolean;
  items: StructureNavItem[];
}

/** The route of one level of an Other project's structure. */
export const structureLevelHref = (projectId: string, levelNumber: number) =>
  `/projects/${projectId}/structure/${levelNumber}`;

/** Where an Other project's structure is configured. */
export const structureSetupHref = (projectId: string) => `/projects/${projectId}/setup/structure`;

/** Parse a `/structure/<n>` route segment (1–4), or null. */
export function parseStructureLevel(segment: string | undefined): number | null {
  if (!segment || !/^[1-4]$/.test(segment)) return null;
  return Number(segment);
}

/**
 * The structure navigation of a project.
 *
 * - Other: the configured levels, in order — exactly as many as configured
 *   (no invented third level). Levels not loaded yet → `pending` (no items). A
 *   project with no levels configured yet → one "Project Structure" item.
 * - PSM / legacy: Departments, Systems and its terminology's third level.
 */
export function structureNavFor(input: {
  structureFamily: "psm" | "other" | undefined | null;
  terms: HierarchyTerms;
  /** An Other project's levels, or null while they load. */
  levels: readonly StructureNavLevel[] | null;
}): StructureNav {
  const { structureFamily, terms, levels } = input;
  if (structureFamily === "other") {
    if (levels === null) return { pending: true, other: true, items: [] };
    const ordered = [...levels].sort((a, b) => a.levelNumber - b.levelNumber);
    return {
      pending: false,
      other: true,
      items: ordered.map((level) => ({
        kind: "level" as const,
        id: `structure-level-${level.levelNumber}`,
        levelNumber: level.levelNumber,
        label: level.pluralLabel,
        singular: level.singularLabel,
      })),
    };
  }
  return {
    pending: false,
    other: false,
    items: [
      { kind: "section", id: "departments", label: "Departments", singular: "Department" },
      { kind: "section", id: "systems", label: "Systems", singular: "System" },
      { kind: "section", id: "disciplines", label: terms.plural, singular: terms.singular },
    ],
  };
}

/** "Function → Workstream": the configured hierarchy in one line (plural names, in order). */
export function hierarchyLine(levels: readonly StructureNavLevel[]): string {
  return [...levels]
    .sort((a, b) => a.levelNumber - b.levelNumber)
    .map((level) => level.singularLabel)
    .join(" → ");
}

/**
 * Breadcrumb / title label for the project route `segment` (+ optional `rest`).
 * Returns the configured level name for `/structure/<n>`.
 */
export function structureRouteLabel(
  segment: string | undefined,
  rest: string | undefined,
  levels: readonly StructureNavLevel[] | null
): string | null {
  if (segment !== "structure") return null;
  const number = parseStructureLevel(rest);
  if (number === null) return "Project Structure";
  return levels?.find((level) => level.levelNumber === number)?.pluralLabel ?? "Project Structure";
}

/**
 * Descriptions of the fixed project sections that mention departments, worded
 * for an Other project (its structure is its configured hierarchy). Sections
 * not listed need no change.
 */
export const OTHER_SECTION_DESCRIPTION: Readonly<Record<string, string>> = {
  setup: "Guided setup: project structure, team and responsibilities.",
  team: "People accountable for this project and its structure.",
  contacts: "People linked to this project through its structure units.",
};

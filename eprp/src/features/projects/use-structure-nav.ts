"use client";

import * as React from "react";

import type { Project } from "@/types";
import type { ProjectStructure } from "@/types/project-structure";
import {
  structureNavFor,
  type StructureNav,
  type StructureNavLevel,
} from "./structure-navigation";
import { useHierarchyTerms } from "./use-hierarchy-terms";
import { useProjectStructure } from "./use-project-structure";

/** The configured levels of a structure, in the navigation model's shape. */
export function levelsOf(structure: ProjectStructure | null): StructureNavLevel[] | null {
  return structure
    ? structure.levels.map((level) => ({
        levelNumber: level.levelNumber,
        singularLabel: level.singularLabel,
        pluralLabel: level.pluralLabel,
      }))
    : null;
}

/**
 * The project's structure vocabulary for navigation: Departments → Systems →
 * Programs & Studies for a PSM / legacy project, or the project's own
 * configured levels for an Other project. The structure is read only for an
 * Other project, and until it has loaded the Other project shows NO structure
 * items — never the PSM words.
 */
export function useStructureNav(project: Project | null | undefined): StructureNav & {
  structure: ProjectStructure | null;
} {
  const terms = useHierarchyTerms(project);
  const other = project?.structureFamily === "other";
  const { structure } = useProjectStructure(other ? project?.id : undefined);
  const levels = React.useMemo(() => levelsOf(structure), [structure]);
  // A project that is not loaded yet is neither: keep the structure group empty.
  const nav = React.useMemo(
    () =>
      project
        ? structureNavFor({ structureFamily: project.structureFamily, terms, levels })
        : ({ pending: true, other: false, items: [] } as StructureNav),
    [project, terms, levels]
  );
  return { ...nav, structure };
}

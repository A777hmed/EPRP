"use client";

import * as React from "react";

import { useMasterData } from "@/features/master-data/use-master-data";
import { useProjectById } from "./use-project-by-id";
import {
  DEFAULT_HIERARCHY_TERMS,
  hierarchyTermsForProject,
  type HierarchyTerms,
} from "@/config/project-terminology";
import type { Project, ProjectType } from "@/types";

/**
 * Hierarchy wording for a project, resolved from its project type.
 *
 * Subscribes to the project-type store so the labels settle correctly once
 * master data finishes loading, instead of freezing on the default from the
 * first render. Display only — never branch behaviour on the result.
 */
export function useHierarchyTerms(
  project: Project | null | undefined
): HierarchyTerms {
  const { records } = useMasterData("projectType");
  // Hoisted so the memo depends on the id itself rather than the whole
  // project — a new project object with the same type must not recompute.
  const projectTypeId = project?.projectTypeId;
  const structureFamily = project?.structureFamily;
  const code = project?.code;

  return React.useMemo(() => {
    // An explicit PSM / Other choice wins over the project-type inference.
    if (structureFamily) return hierarchyTermsForProject({ structureFamily }, null);
    // An unclassified legacy project: its type, then its PSM / PSAIM code.
    const type = projectTypeId
      ? (records as ProjectType[]).find((candidate) => candidate.id === projectTypeId)
      : undefined;
    if (!type && !code) return DEFAULT_HIERARCHY_TERMS;
    return hierarchyTermsForProject({ code }, type);
  }, [projectTypeId, structureFamily, code, records]);
}

/**
 * Same wording, for surfaces that only know the project id — the sidebar
 * reads it from the URL and never loads the project itself.
 *
 * Falls back to the default wording while the project is loading or when the
 * id resolves to nothing, so the label is always sensible.
 */
export function useHierarchyTermsByProjectId(
  projectId: string | undefined
): HierarchyTerms {
  return useHierarchyTerms(useProjectById(projectId));
}

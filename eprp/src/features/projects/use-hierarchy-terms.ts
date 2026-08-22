"use client";

import * as React from "react";

import { useMasterData } from "@/features/master-data/use-master-data";
import { projectService } from "@/services/project-service";
import {
  DEFAULT_HIERARCHY_TERMS,
  hierarchyTermsFor,
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

  return React.useMemo(() => {
    if (!projectTypeId) return DEFAULT_HIERARCHY_TERMS;
    const type = (records as ProjectType[]).find(
      (candidate) => candidate.id === projectTypeId
    );
    return hierarchyTermsFor(type);
  }, [projectTypeId, records]);
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
  const [loaded, setLoaded] = React.useState<Project | null>(null);

  React.useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    projectService
      .getProjectById(projectId)
      .then((result) => {
        if (!cancelled) setLoaded(result);
      })
      // A label is not worth surfacing an error for — keep the default.
      .catch(() => {
        if (!cancelled) setLoaded(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Derived rather than stored, so a result left over from a previous project
  // (or from before the id cleared) can never label the current one.
  const project = projectId && loaded?.id === projectId ? loaded : null;

  return useHierarchyTerms(project);
}

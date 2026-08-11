"use client";

import * as React from "react";

import {
  DEFAULT_HIERARCHY_TERMS,
  hierarchyTermsFor,
  type HierarchyTerms,
} from "@/config/project-terminology";
import { useMasterData } from "@/features/master-data";
import type { Project, ProjectType } from "@/types";

/**
 * The project's own wording for the level below a System, for client screens.
 *
 * Subscribes through `useMasterData` rather than reading the cache
 * synchronously, for the same reason `useWeeklyNameLookup` does: the
 * Supabase-backed stores hydrate lazily on first subscription, so a bare
 * `getProjectTypeById()` on a freshly loaded page resolves nothing and every
 * PSM screen would silently fall back to "Discipline" — which is precisely the
 * bug this hook exists to prevent.
 *
 * The workspace does not use this: its terms arrive already resolved on the
 * server, inside the viewer's scope. This is for the Edit form and the
 * Preview, which have a project but no scope object.
 */
export function useHierarchyTerms(
  project: Project | null | undefined
): HierarchyTerms {
  const { records } = useMasterData("projectType");
  // Read out first: the memo depends on the id, not on the whole project.
  const projectTypeId = project?.projectTypeId;

  return React.useMemo(() => {
    if (!projectTypeId) return DEFAULT_HIERARCHY_TERMS;
    const type = (records as ProjectType[]).find(
      (record) => record.id === projectTypeId
    );
    return hierarchyTermsFor(type);
  }, [projectTypeId, records]);
}

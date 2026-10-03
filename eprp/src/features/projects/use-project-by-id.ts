"use client";

import * as React from "react";

import { projectService } from "@/services/project-service";
import type { Project } from "@/types";

/** Read through the active service; never show a previous project's identity. */
export function useProjectById(projectId: string | undefined): Project | null {
  const [loaded, setLoaded] = React.useState<Project | null>(null);

  React.useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    projectService
      .getProjectById(projectId)
      .then((result) => {
        if (!cancelled) setLoaded(result);
      })
      // Navigation stays usable when the project is missing or unavailable.
      .catch(() => {
        if (!cancelled) setLoaded(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return projectId && loaded?.id === projectId ? loaded : null;
}

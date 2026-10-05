"use client";

import * as React from "react";

import { projectStructureService } from "@/services/project-structure-service";
import type { ProjectStructure } from "@/types/project-structure";

/**
 * An Other project's structure, loaded through the active service (Phase
 * 2C.1c). Read-only plumbing: no authority, no UI, no fallback structure.
 *
 * - `structure` is null until the first load for THIS project completes, and
 *   never shows another project's structure. An Other project with nothing
 *   configured yet is `{ levels: [], nodes: [] }`, not null.
 * - `refresh()` reloads (e.g. after a write advanced the project version);
 *   the previous structure of the same project stays visible meanwhile.
 * - `error` is the service's plain-language message, never database text.
 */
export interface ProjectStructureState {
  structure: ProjectStructure | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

interface LoadResult {
  key: string;
  projectId: string;
  structure: ProjectStructure | null;
  error: string | null;
}

const LOAD_FAILED = "The project structure could not be loaded. Reload the page.";

/** Only the structure service's own (already plain) wording is shown. */
function plainMessage(error: unknown): string {
  const candidate = error as { name?: unknown; message?: unknown } | null;
  return candidate?.name === "ProjectStructureError" && typeof candidate.message === "string"
    ? candidate.message
    : LOAD_FAILED;
}

export function useProjectStructure(projectId: string | undefined): ProjectStructureState {
  const [nonce, setNonce] = React.useState(0);
  const [result, setResult] = React.useState<LoadResult | null>(null);
  const key = projectId ? `${projectId}#${nonce}` : null;

  React.useEffect(() => {
    if (!projectId || !key) return;
    let cancelled = false;
    projectStructureService
      .getStructure(projectId)
      .then((structure) => {
        if (!cancelled) setResult({ key, projectId, structure, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setResult({ key, projectId, structure: null, error: plainMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, key]);

  const refresh = React.useCallback(() => setNonce((value) => value + 1), []);

  // Derived, not stored: a result left over from another project never shows.
  const own = projectId && result?.projectId === projectId ? result : null;
  return {
    structure: own?.structure ?? null,
    loading: key !== null && own?.key !== key,
    error: own?.key === key ? own.error : null,
    refresh,
  };
}

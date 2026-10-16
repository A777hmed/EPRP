"use client";

import * as React from "react";

/** The medium / tablet band, between the mobile sheet and roomy desktop. */
export const COMPACT_VIEWPORT_QUERY = "(min-width: 768px) and (max-width: 1023.98px)";

/**
 * True in the medium/tablet band (768–1023px), where neither the project
 * column nor the full global rail can sit permanently beside the workspace.
 * Shared by `ProjectContextSidebar` (icon strip + overlay) and
 * `RouteSidebarSync` (global rail kept collapsed inside a project).
 */
export function useCompactViewport() {
  const [isCompact, setIsCompact] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia(COMPACT_VIEWPORT_QUERY);
    const update = () => setIsCompact(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  return isCompact;
}

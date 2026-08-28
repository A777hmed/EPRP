"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { useSidebar } from "@/components/ui/sidebar";
import { activeProjectId } from "@/config/project-sections";
import { cn } from "@/lib/utils";
import { ProjectContextNav } from "./project-nav-group";

const COLLAPSE_STORAGE_KEY = "eprp:project-sidebar-collapsed";

/**
 * A hair lighter than the rail's navy, never a harsh white — enough for the
 * eye to tell "global" from "project" apart without a loud boundary. The
 * `border-sidebar-border` edge does the rest of the separating work.
 */
const PANEL_SURFACE =
  "bg-[color-mix(in_oklab,var(--sidebar)_96%,var(--sidebar-foreground)_4%)]";

/** True in the medium/laptop band where a permanent 216px column is too wide. */
function useCompactViewport() {
  const [isCompact, setIsCompact] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia(
      "(min-width: 768px) and (max-width: 1023.98px)"
    );
    const update = () => setIsCompact(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  return isCompact;
}

/**
 * The second-level, project-contextual sidebar column: desktop only, and
 * only while a project is open. Outside a project it renders nothing — no
 * empty column competing with the workspace for width.
 *
 * Pinned to the viewport (`sticky top-0 h-svh`) rather than stretched by
 * flex to the document's height — a tall page must not drag an empty block
 * of sidebar colour down with it. Only the navigation list inside scrolls
 * (see `ProjectContextNav`); the identity block and collapse footer stay in
 * place.
 *
 * Two desktop behaviors:
 * - Roomier desktop (≥1024px): an inline column, collapsible to a 44px icon
 *   strip that gives the width back to the workspace (choice remembered).
 * - Medium/laptop widths (768–1023px): stays a permanent 44px icon strip,
 *   expanding into a floating overlay (with a scrim) instead of a column
 *   that would permanently eat into the workspace. Closes on outside click
 *   or Escape.
 *
 * Mobile reaches the same content through the platform sidebar's sheet
 * (see `AppSidebar`), so there is no navigation dead-end below `md`.
 */
export function ProjectContextSidebar() {
  const pathname = usePathname();
  const projectId = activeProjectId(pathname);
  const isCompact = useCompactViewport();
  // The global rail's own open state, shared via the same SidebarProvider
  // this component is a sibling of. Expanding the rail must not sit beside
  // a fully expanded project column too — that's three wide columns at
  // once — so this sidebar temporarily collapses whenever the rail opens.
  const { open: globalOpen } = useSidebar();

  const [userCollapsed, setUserCollapsed] = React.useState(false);
  const [overlayOpen, setOverlayOpen] = React.useState(false);
  const overlayRef = React.useRef<HTMLElement>(null);

  // What's actually shown: the user's own preference, OR forced collapsed
  // while the rail is expanded. Once the rail collapses again this reduces
  // straight back to `userCollapsed` — automatic restore, but never
  // overriding a collapse the user chose themselves.
  const collapsed = userCollapsed || globalOpen;

  React.useEffect(() => {
    // Reads a client-only source (localStorage) once after mount, so the
    // server and the first client render both default to expanded and stay
    // hydration-safe; only this second pass may differ from the server.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUserCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1");
    } catch {
      // Preference is a convenience only — default (expanded) is fine.
    }
  }, []);

  const toggleCollapsed = React.useCallback(() => {
    setUserCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Non-fatal: the choice just won't persist across visits.
      }
      return next;
    });
  }, []);

  React.useEffect(() => {
    if (!overlayOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (
        overlayRef.current &&
        !overlayRef.current.contains(event.target as Node)
      ) {
        setOverlayOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOverlayOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [overlayOpen]);

  // Leaving the compact band (resize to a wider desktop) drops any open
  // overlay, so it can't resurface stale if the viewport narrows again —
  // this can't be a derived render value since it must forget open once
  // the band is left, not just hide while outside it.
  React.useEffect(() => {
    if (!isCompact) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOverlayOpen(false);
    }
  }, [isCompact]);

  // Same reasoning as the rename above, for the compact band's overlay:
  // the rail expanding must close it rather than sit beside it.
  React.useEffect(() => {
    if (globalOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOverlayOpen(false);
    }
  }, [globalOpen]);

  if (!projectId) return null;

  if (isCompact) {
    return (
      <div className="sticky top-0 hidden h-svh shrink-0 md:block">
        <aside
          aria-label="Project"
          className={cn(
            "flex h-full w-11 flex-col border-r border-sidebar-border text-sidebar-foreground",
            PANEL_SURFACE
          )}
        >
          <ProjectContextNav
            pathname={pathname}
            collapsed
            onToggleCollapsed={
              globalOpen ? undefined : () => setOverlayOpen(true)
            }
          />
        </aside>
        {overlayOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/20"
              aria-hidden="true"
              onClick={() => setOverlayOpen(false)}
            />
            <aside
              ref={overlayRef}
              aria-label="Project"
              className={cn(
                "absolute top-0 left-full z-50 flex h-full w-[216px] flex-col border-r border-sidebar-border text-sidebar-foreground shadow-lg",
                PANEL_SURFACE
              )}
            >
              <ProjectContextNav
                pathname={pathname}
                onToggleCollapsed={() => setOverlayOpen(false)}
              />
            </aside>
          </>
        )}
      </div>
    );
  }

  return (
    <aside
      aria-label="Project"
      className={cn(
        "sticky top-0 hidden h-svh shrink-0 flex-col border-r border-sidebar-border text-sidebar-foreground md:flex",
        PANEL_SURFACE,
        collapsed ? "w-11" : "w-[216px]"
      )}
    >
      <ProjectContextNav
        pathname={pathname}
        collapsed={collapsed}
        // Hidden while the rail forces this collapsed: there's nothing to
        // expand into without the rail closing first, and letting the click
        // through would silently flip the user's own saved preference.
        onToggleCollapsed={globalOpen ? undefined : toggleCollapsed}
      />
    </aside>
  );
}

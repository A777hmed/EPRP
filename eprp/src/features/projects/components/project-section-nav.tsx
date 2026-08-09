"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export interface ProjectSection {
  id: string;
  label: string;
}

/** In-page sections of the project detail view, in document order. */
export const projectSections: ProjectSection[] = [
  { id: "overview", label: "Overview" },
  { id: "project-information", label: "Project Information" },
  { id: "team", label: "Team & Responsibilities" },
  { id: "departments", label: "Departments" },
  { id: "disciplines", label: "Programs & Studies" },
  { id: "systems", label: "Systems" },
  { id: "kpis", label: "KPIs" },
  { id: "weekly-reports", label: "Weekly Reports" },
  { id: "monthly-reports", label: "Monthly Reports" },
  { id: "documents", label: "Documents" },
  { id: "attachments", label: "Attachments" },
  { id: "history", label: "History" },
];

/**
 * Must match the `scroll-mt-*` on each section: below `lg` the sections have
 * to clear the top bar *and* the horizontal chip row, which is why the two
 * breakpoints differ.
 */
const SCROLL_MARGIN_PX = { base: 128, lg: 112 };

/**
 * A few pixels of slack. Clicking a nav item parks the section exactly on its
 * scroll margin, so the activation line has to sit just below it — otherwise
 * the section you just jumped to would not light up.
 */
const ACTIVE_TOLERANCE_PX = 8;

function activeOffset(): number {
  const isLarge = window.matchMedia("(min-width: 64rem)").matches;
  const margin = isLarge ? SCROLL_MARGIN_PX.lg : SCROLL_MARGIN_PX.base;
  return margin + ACTIVE_TOLERANCE_PX;
}

/**
 * Tracks which section is currently in view.
 *
 * Uses scroll position rather than IntersectionObserver: sections vary a lot
 * in height here, and "the last heading scrolled past" matches what a reader
 * expects far better than intersection ratios do.
 */
export function useActiveSection(
  sections: ProjectSection[]
): [string, (id: string) => void] {
  const [activeId, setActiveId] = React.useState(sections[0]?.id ?? "");

  React.useEffect(() => {
    const pick = () => {
      const elements = sections
        .map((section) => document.getElementById(section.id))
        .filter((element): element is HTMLElement => element !== null);
      if (elements.length === 0) return;

      const offset = activeOffset();
      let current = elements[0].id;
      for (const element of elements) {
        if (element.getBoundingClientRect().top <= offset) {
          current = element.id;
        }
      }
      // The final section is often too short to reach the line — at the
      // bottom of the page it is unambiguously the one being read.
      const atBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 2;
      if (atBottom) current = elements[elements.length - 1].id;

      setActiveId(current);
    };

    // Deferred so the first measurement happens after paint, not during the
    // effect itself.
    const frame = requestAnimationFrame(pick);
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", pick);
      window.removeEventListener("resize", pick);
    };
  }, [sections]);

  return [activeId, setActiveId];
}

export interface ProjectSectionNavProps {
  sections?: ProjectSection[];
  className?: string;
}

/**
 * Sticky in-page navigation. Scrolls to the chosen section and highlights
 * whichever one is in view. Renders as a scrollable chip row on small
 * screens and a sticky column from `lg` up.
 */
export function ProjectSectionNav({
  sections = projectSections,
  className,
}: ProjectSectionNavProps) {
  const [activeId, setActiveId] = useActiveSection(sections);

  const handleClick = (
    event: React.MouseEvent<HTMLAnchorElement>,
    id: string
  ) => {
    const target = document.getElementById(id);
    if (!target) return; // Let the browser fall back to the plain hash jump.
    event.preventDefault();
    // Highlight straight away rather than waiting out the smooth scroll.
    setActiveId(id);
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    // Keep the section linkable without triggering a second jump.
    window.history.replaceState(null, "", `#${id}`);
  };

  return (
    <nav
      aria-label="Project sections"
      className={cn(
        "sticky top-14 z-30 -mx-4 border-b bg-background/95 px-4 py-2 backdrop-blur",
        "lg:top-[4.5rem] lg:mx-0 lg:self-start lg:rounded-xl lg:border lg:px-2 lg:py-2 lg:backdrop-blur-none",
        className
      )}
    >
      <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
        {sections.map((section) => {
          const active = section.id === activeId;
          return (
            <li key={section.id} className="shrink-0 lg:shrink">
              <a
                href={`#${section.id}`}
                onClick={(event) => handleClick(event, section.id)}
                aria-current={active ? "location" : undefined}
                className={cn(
                  "block rounded-lg px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors",
                  "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  active
                    ? "bg-primary/10 font-semibold text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {section.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

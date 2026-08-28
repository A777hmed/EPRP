"use client";

import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  activeProjectId,
  projectSectionHref,
  projectSections,
  type ProjectSection,
  type ProjectSectionId,
} from "@/config/project-sections";
import { useHierarchyTermsByProjectId } from "@/features/projects/use-hierarchy-terms";
import { listProjectsSync } from "@/services/project-service";
import { cn } from "@/lib/utils";

/**
 * Presentational-only regrouping for the contextual sidebar. The routes,
 * ids, icons, and relative order within each bucket are untouched — only
 * which heading a section sits under, and the heading order, changed to
 * match the Setup → Planning & Control → Reporting → Master/Reference Data
 * → Records workflow hierarchy.
 */
const SECTION_GROUP: Partial<Record<ProjectSectionId, string>> = {
  setup: "Setup",
  team: "Setup",
  "organization-chart": "Setup",
  kpis: "Planning & Control",
  milestones: "Planning & Control",
  deliverables: "Planning & Control",
  reporting: "Reporting",
  departments: "Master / Reference Data",
  systems: "Master / Reference Data",
  disciplines: "Master / Reference Data",
  contacts: "Master / Reference Data",
  documents: "Records / Documents",
  attachments: "Records / Documents",
  history: "Records / Documents",
};

const GROUP_ORDER = [
  "Setup",
  "Planning & Control",
  "Reporting",
  "Master / Reference Data",
  "Records / Documents",
] as const;

/**
 * Same interaction language as the global rail (`.epr-nav-link` in
 * globals.css) — a light, off-white rounded row on hover/active, navy-toned
 * text — but quieter: a lower white mix, since this column is the
 * secondary one and shouldn't compete with the platform rail.
 */
const ROW_HOVER_BG =
  "hover:bg-[color-mix(in_oklab,white_80%,var(--sidebar)_20%)]";
const ROW_ACTIVE_BG = "bg-[color-mix(in_oklab,white_90%,var(--sidebar)_10%)]";

function isSectionActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Weekly/Monthly/Project Executive reports open under
 * `/projects/[projectId]/reports/...` (see `weekly-reports`/`monthly-reports`
 * project-scoped route aliases) rather than under the Reporting section's
 * own `/projects/[projectId]/reporting` href, so the generic href-prefix
 * check above never matches them. Reporting must still read as active for
 * the whole reporting workflow, not just its own landing tab.
 */
function isReportingRouteActive(pathname: string, projectId: string) {
  return pathname.startsWith(`/projects/${projectId}/reports/`);
}

/** Compact identity: a "Project" eyebrow, code + short name, name secondary. */
function ProjectIdentity({
  projectId,
  collapsed,
}: {
  projectId: string;
  collapsed: boolean;
}) {
  const project = listProjectsSync().find(
    (candidate) => candidate.id === projectId
  );
  // Never the raw id: a project's code (e.g. "PSAIM-001") is the intended
  // human-readable identity; "Project" is the only acceptable fallback while
  // project data hasn't loaded or the id doesn't resolve.
  const primary = project?.code ?? "Project";
  const secondary = project?.shortName ?? project?.name ?? null;

  if (collapsed) {
    return (
      <div
        className="flex shrink-0 items-center justify-center border-b border-sidebar-border py-2"
        title={project?.name ?? "Project"}
      >
        <span className="flex size-7 items-center justify-center rounded-sm bg-sidebar-primary/15 font-mono text-[10px] font-semibold text-sidebar-primary">
          {(project?.code ?? "PRJ").slice(0, 3)}
        </span>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b border-sidebar-border px-2.5 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-sidebar-foreground/40">
        Project
      </div>
      <div
        className="mt-0.5 truncate font-mono text-[13px] font-semibold leading-tight text-sidebar-foreground"
        title={primary}
      >
        {primary}
      </div>
      {secondary && (
        <div
          className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-sidebar-foreground/50"
          title={secondary}
        >
          {secondary}
        </div>
      )}
    </div>
  );
}

/** Bottom footer: the collapse/expand control, always in the same place. */
function ContextFooter({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed?: () => void;
}) {
  if (!onToggleCollapsed) return null;

  return (
    <div className="shrink-0 border-t border-sidebar-border p-1.5">
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-label={
          collapsed ? "Expand project navigation" : "Collapse project navigation"
        }
        title={collapsed ? "Expand" : "Collapse"}
        className={cn(
          "flex h-7 w-full items-center justify-center gap-1.5 rounded-md text-[11px] text-sidebar-foreground/55 transition-colors",
          ROW_HOVER_BG,
          "hover:text-sidebar"
        )}
      >
        {collapsed ? (
          <PanelLeftOpen className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <>
            <PanelLeftClose className="size-3.5 shrink-0" aria-hidden="true" />
            <span>Collapse</span>
          </>
        )}
      </button>
    </div>
  );
}

/** One expanded row: icon column + label column, same left grid for every row. */
function SectionLink({
  href,
  active,
  section,
  label,
}: {
  href: string;
  active: boolean;
  section: ProjectSection;
  label: string;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        // Every section link is mounted at once, so Next's default
        // viewport prefetch would fire one RSC request per item just from
        // rendering — click navigation still works normally, only the
        // automatic prefetch is disabled.
        prefetch={false}
        className={cn(
          "flex h-8 items-center gap-2 rounded-md pr-2 pl-2.5 text-[13px] transition-colors",
          active
            ? cn(ROW_ACTIVE_BG, "font-semibold text-sidebar-primary")
            : cn(
                "text-sidebar-foreground/70 hover:text-sidebar",
                ROW_HOVER_BG
              )
        )}
      >
        <section.icon className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </Link>
    </li>
  );
}

/** Icon-only row for the collapsed strip — same link, tooltip carries the label. */
function CollapsedSectionLink({
  href,
  active,
  section,
  label,
}: {
  href: string;
  active: boolean;
  section: ProjectSection;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={href}
          aria-current={active ? "page" : undefined}
          aria-label={label}
          prefetch={false}
          className={cn(
            "flex size-8 items-center justify-center rounded-md transition-colors",
            active
              ? cn(ROW_ACTIVE_BG, "text-sidebar-primary")
              : cn("text-sidebar-foreground/55 hover:text-sidebar", ROW_HOVER_BG)
          )}
        >
          <section.icon className="size-4" aria-hidden="true" />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Contextual project navigation content: a fixed identity block, a
 * scrollable middle section for the workflow groups, and a fixed footer
 * carrying the collapse control — so only the navigation list scrolls, the
 * column never grows with the page, and the toggle is always reachable.
 *
 * Same config, same routes, same order within a group as before — this is
 * the single source of truth for project navigation, just presented as a
 * dedicated column instead of a nested collapsible.
 *
 * Rendered as its own column on desktop (`ProjectContextSidebar`, expanded
 * or collapsed to an icon strip) and inline inside the platform sidebar's
 * mobile sheet — two shells, one component, so there is no second
 * navigation source to keep in sync.
 */
export function ProjectContextNav({
  pathname,
  collapsed = false,
  onToggleCollapsed,
}: {
  pathname: string;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const projectId = activeProjectId(pathname);
  const terms = useHierarchyTermsByProjectId(projectId);

  if (!projectId) return null;

  const sectionLabel = (section: ProjectSection) =>
    section.id === "disciplines" ? terms.plural : section.label;

  const overview = projectSections.find((section) => section.id === "overview");
  const grouped = GROUP_ORDER.map((group) => ({
    group,
    items: projectSections.filter(
      (section) => SECTION_GROUP[section.id] === group
    ),
  })).filter((bucket) => bucket.items.length > 0);

  if (collapsed) {
    return (
      <nav aria-label="Project navigation" className="flex h-full flex-col">
        <ProjectIdentity projectId={projectId} collapsed />
        <div className="flex min-h-0 flex-1 flex-col items-center gap-0.5 overflow-y-auto px-1 py-2">
          {overview && (
            <CollapsedSectionLink
              href={projectSectionHref(projectId, overview.id)}
              active={isSectionActive(
                pathname,
                projectSectionHref(projectId, overview.id)
              )}
              section={overview}
              label={sectionLabel(overview)}
            />
          )}
          {grouped.flatMap((bucket) =>
            bucket.items.map((section) => {
              const href = projectSectionHref(projectId, section.id);
              const active =
                isSectionActive(pathname, href) ||
                (section.id === "reporting" &&
                  isReportingRouteActive(pathname, projectId));
              return (
                <CollapsedSectionLink
                  key={section.id}
                  href={href}
                  active={active}
                  section={section}
                  label={sectionLabel(section)}
                />
              );
            })
          )}
        </div>
        <ContextFooter collapsed onToggleCollapsed={onToggleCollapsed} />
      </nav>
    );
  }

  return (
    <nav aria-label="Project navigation" className="flex h-full flex-col">
      <ProjectIdentity projectId={projectId} collapsed={false} />
      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {overview && (
          <ul className="flex flex-col gap-0.5 px-2">
            <SectionLink
              href={projectSectionHref(projectId, overview.id)}
              active={isSectionActive(
                pathname,
                projectSectionHref(projectId, overview.id)
              )}
              section={overview}
              label={sectionLabel(overview)}
            />
          </ul>
        )}
        {grouped.map((bucket, index) => (
          <div
            key={bucket.group}
            className={cn(
              "flex flex-col gap-0.5 px-2 pt-2",
              index > 0 && "mt-1 border-t border-sidebar-border/60 pt-2"
            )}
          >
            <span className="pb-1 pl-2.5 text-[10px] font-medium uppercase tracking-wide text-sidebar-foreground/45">
              {bucket.group}
            </span>
            <ul className="flex flex-col gap-0.5">
              {bucket.items.map((section) => {
                const href = projectSectionHref(projectId, section.id);
                const active =
                  isSectionActive(pathname, href) ||
                  (section.id === "reporting" &&
                    isReportingRouteActive(pathname, projectId));
                return (
                  <SectionLink
                    key={section.id}
                    href={href}
                    active={active}
                    section={section}
                    label={sectionLabel(section)}
                  />
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <ContextFooter collapsed={false} onToggleCollapsed={onToggleCollapsed} />
    </nav>
  );
}

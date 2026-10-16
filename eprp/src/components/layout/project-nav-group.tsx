"use client";

import * as React from "react";
import Link from "next/link";
import {
  Building2,
  CheckCheck,
  ClipboardList,
  Contact,
  Layers,
  ListTree,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Server,
  Users,
  type LucideIcon,
} from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  activeProjectId,
  isNewProjectRoute,
  projectSectionHref,
  projectSections,
  type ProjectSection,
  type ProjectSectionId,
} from "@/config/project-sections";
import {
  newProjectSetupNavItems,
  type NewProjectNavItem,
  type ProjectWorkflowStepId,
} from "@/config/project-workflow";
import {
  getNewProjectDraft,
  getServerNewProjectDraft,
  subscribeNewProjectDraft,
} from "@/features/projects/new-project-draft-store";
import { useHierarchyTerms } from "@/features/projects/use-hierarchy-terms";
import { useProjectById } from "@/features/projects/use-project-by-id";
import type { Project } from "@/types";
import { cn } from "@/lib/utils";

/**
 * Presentational-only grouping for the contextual sidebar (Phase 13.9A,
 * `docs/02` §26.23.2). The routes, ids and icons are untouched; relative order
 * within a bucket follows `projectSections`.
 *
 * - Planning Workspace is a first-class item under Planning & Control.
 * - Project Structure holds the project's own scope levels; the third level
 *   is labelled by the project's terminology (Programs & Studies on PSM).
 * - Contacts stays reachable, transitionally under Setup beside the people
 *   pages, until its convergence with Team & Responsibilities is assessed —
 *   it is not part of Project Structure.
 */
const SECTION_GROUP: Partial<Record<ProjectSectionId, string>> = {
  setup: "Setup",
  team: "Setup",
  "organization-chart": "Setup",
  contacts: "Setup",
  planning: "Planning & Control",
  kpis: "Planning & Control",
  milestones: "Planning & Control",
  deliverables: "Planning & Control",
  reporting: "Reporting",
  departments: "Project Structure",
  systems: "Project Structure",
  disciplines: "Project Structure",
  documents: "Records",
  attachments: "Records",
  history: "Records",
};

const GROUP_ORDER = [
  "Setup",
  "Planning & Control",
  "Reporting",
  "Project Structure",
  "Records",
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
  project,
  collapsed,
}: {
  project: Project | null;
  collapsed: boolean;
}) {
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

/* -------------------- New-project setup navigation (2C.1b) ---------------- */

const SETUP_STEP_ICON: Record<ProjectWorkflowStepId, LucideIcon> = {
  info: ClipboardList,
  structure: Layers,
  departments: Building2,
  systems: Server,
  disciplines: ListTree,
  contacts: Contact,
  team: Users,
  review: CheckCheck,
};

/** Identity block before the project exists: never an id or a fake code. */
function NewProjectIdentity({ collapsed }: { collapsed: boolean }) {
  if (collapsed) {
    return (
      <div
        className="flex shrink-0 items-center justify-center border-b border-sidebar-border py-2"
        title="New Project — not saved yet"
      >
        <span className="flex size-7 items-center justify-center rounded-sm bg-sidebar-primary/15 font-mono text-[10px] font-semibold text-sidebar-primary">
          NEW
        </span>
      </div>
    );
  }
  return (
    <div className="shrink-0 border-b border-sidebar-border px-2.5 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-sidebar-foreground/40">
        Project
      </div>
      <div className="mt-0.5 truncate text-[13px] font-semibold leading-tight text-sidebar-foreground">
        New Project
      </div>
      <div className="mt-0.5 text-[11px] leading-snug text-sidebar-foreground/50">
        Not saved yet
      </div>
    </div>
  );
}

function NewProjectStepRow({
  item,
  collapsed,
}: {
  item: NewProjectNavItem;
  collapsed: boolean;
}) {
  const Icon = SETUP_STEP_ICON[item.id];
  if (item.href) {
    const link = (
      <Link
        href={item.href}
        aria-current={item.active ? "page" : undefined}
        aria-label={collapsed ? item.label : undefined}
        prefetch={false}
        className={cn(
          collapsed
            ? "flex size-8 items-center justify-center rounded-md"
            : "flex h-8 items-center gap-2 rounded-md pr-2 pl-2.5 text-[13px]",
          "transition-colors",
          item.active
            ? cn(ROW_ACTIVE_BG, "font-semibold text-sidebar-primary")
            : cn("text-sidebar-foreground/70 hover:text-sidebar", ROW_HOVER_BG)
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    );
    return collapsed ? (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    ) : (
      <li>{link}</li>
    );
  }

  // Disabled: visible so the whole setup is legible, but not a link.
  const disabled = (
    <span
      aria-disabled="true"
      title={`${item.label} — ${item.disabledReason}`}
      className={cn(
        collapsed
          ? "flex size-8 items-center justify-center rounded-md"
          : "flex min-h-8 items-start gap-2 rounded-md py-1.5 pr-2 pl-2.5 text-[13px]",
        "cursor-not-allowed text-sidebar-foreground/40"
      )}
    >
      <Icon className={cn("size-4 shrink-0", !collapsed && "mt-0.5")} aria-hidden="true" />
      {!collapsed && (
        <span className="min-w-0">
          <span className="block truncate">{item.label}</span>
          <span className="flex items-center gap-1 text-[10px] leading-tight">
            <Lock className="size-2.5 shrink-0" aria-hidden="true" />
            {item.disabledReason}
          </span>
        </span>
      )}
      {collapsed && <span className="sr-only">{`${item.label} — ${item.disabledReason}`}</span>}
    </span>
  );
  return collapsed ? (
    <Tooltip>
      <TooltipTrigger asChild>{disabled}</TooltipTrigger>
      <TooltipContent side="right">{`${item.label} — ${item.disabledReason}`}</TooltipContent>
    </Tooltip>
  ) : (
    <li>{disabled}</li>
  );
}

/**
 * The setup sidebar for /projects/new, in the same column as the project
 * sidebar: "New Project · Not saved yet", step 1 live, the chosen Project
 * Type's later steps visible but disabled. Saved-project sections (Overview,
 * Reporting, …) are not shown — none of them exist before the first save.
 * After that save the route carries the real id and {@link ProjectContextNav}
 * renders the normal project navigation in this same place.
 */
export function NewProjectSetupNav({
  collapsed = false,
  onToggleCollapsed,
}: {
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const draft = React.useSyncExternalStore(
    subscribeNewProjectDraft,
    getNewProjectDraft,
    getServerNewProjectDraft
  );
  const items = newProjectSetupNavItems(draft.structureFamily);

  return (
    <nav aria-label="New project setup" className="flex h-full flex-col">
      <NewProjectIdentity collapsed={collapsed} />
      {collapsed ? (
        <div className="flex min-h-0 flex-1 flex-col items-center gap-0.5 overflow-y-auto px-1 py-2">
          {items.map((item) => (
            <NewProjectStepRow key={item.id} item={item} collapsed />
          ))}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
          <div className="flex flex-col gap-0.5 px-2 pt-2">
            <span className="pb-1 pl-2.5 text-[10px] font-medium uppercase tracking-wide text-sidebar-foreground/45">
              Project Setup
            </span>
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => (
                <NewProjectStepRow key={item.id} item={item} collapsed={false} />
              ))}
            </ul>
            {!draft.structureFamily && (
              <p className="px-2.5 pt-2 text-[11px] leading-snug text-sidebar-foreground/45">
                Choose a Project Type to see the remaining setup steps.
              </p>
            )}
          </div>
        </div>
      )}
      <ContextFooter collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} />
    </nav>
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
  const project = useProjectById(projectId);
  const terms = useHierarchyTerms(project);

  // Before the first save: setup navigation only, never a project id.
  if (!projectId && isNewProjectRoute(pathname)) {
    return (
      <NewProjectSetupNav
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
      />
    );
  }
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
        <ProjectIdentity project={project} collapsed />
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
      <ProjectIdentity project={project} collapsed={false} />
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

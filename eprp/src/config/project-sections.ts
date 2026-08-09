import {
  Building2,
  CalendarDays,
  CalendarRange,
  Contact,
  FolderOpen,
  Gauge,
  History,
  Layers,
  LayoutDashboard,
  ListChecks,
  Network,
  Paperclip,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/**
 * The pages that live inside a single project.
 *
 * Every one is reached at `/projects/[projectId]/[section]`, so the project
 * id is never lost while moving between them. Grouped exactly as they appear
 * under the collapsible "Projects" item in the sidebar.
 */

import {
  DEFAULT_HIERARCHY_TERMS,
  type HierarchyTerms,
} from "./project-terminology";

export type ProjectSectionId =
  | "overview"
  | "setup"
  | "team"
  | "organization-chart"
  | "departments"
  | "systems"
  | "disciplines"
  | "contacts"
  | "kpis"
  | "weekly-reports"
  | "monthly-reports"
  | "documents"
  | "attachments"
  | "history";

export interface ProjectSection {
  id: ProjectSectionId;
  label: string;
  icon: LucideIcon;
  /** Sub-heading the item sits under; ungrouped items come first. */
  group?: "Master Data" | "Monitoring" | "Records";
  description: string;
}

export const projectSections: ProjectSection[] = [
  {
    id: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    description: "Project summary, progress, and scope at a glance.",
  },
  {
    id: "setup",
    label: "Project Setup",
    icon: ListChecks,
    description: "Guided setup: departments, systems, disciplines, contacts.",
  },
  {
    id: "team",
    label: "Team & Responsibilities",
    icon: Users,
    description: "People accountable for this project and its departments.",
  },
  {
    id: "organization-chart",
    label: "Organization Chart",
    icon: Network,
    description: "Build and manage the project organization structure.",
  },
  {
    id: "departments",
    label: "Departments",
    icon: Building2,
    group: "Master Data",
    description: "Departments assigned to this project.",
  },
  {
    id: "systems",
    label: "Systems",
    icon: Layers,
    group: "Master Data",
    description: "Systems in scope, grouped by owning department.",
  },
  {
    id: "disciplines",
    label: "Programs & Studies",
    icon: Wrench,
    group: "Master Data",
    description: "Programs and studies linked to this project's systems.",
  },
  {
    id: "contacts",
    label: "Contacts",
    icon: Contact,
    group: "Master Data",
    description: "People linked to this project through its departments.",
  },
  {
    id: "kpis",
    label: "KPIs",
    icon: Gauge,
    group: "Monitoring",
    description: "Baseline progress and schedule performance.",
  },
  {
    id: "weekly-reports",
    label: "Weekly Reports",
    icon: CalendarDays,
    group: "Monitoring",
    description: "Weekly progress reports raised for this project.",
  },
  {
    id: "monthly-reports",
    label: "Monthly Reports",
    icon: CalendarRange,
    group: "Monitoring",
    description: "Monthly reports compiled from approved weeklies.",
  },
  {
    id: "documents",
    label: "Documents",
    icon: FolderOpen,
    group: "Records",
    description: "Generated and uploaded project documents.",
  },
  {
    id: "attachments",
    label: "Attachments",
    icon: Paperclip,
    group: "Records",
    description: "Files attached to this project and its reports.",
  },
  {
    id: "history",
    label: "History",
    icon: History,
    group: "Records",
    description: "Audit trail of changes on this project.",
  },
];

const sectionIds = projectSections.map((section) => section.id);

export function isProjectSection(value: string): value is ProjectSectionId {
  return (sectionIds as string[]).includes(value);
}

export function getProjectSection(id: ProjectSectionId): ProjectSection {
  const section = projectSections.find((candidate) => candidate.id === id);
  if (!section) throw new Error(`Unknown project section: ${id}`);
  return section;
}

/** Section URL — the project id always travels in the path. */
export function projectSectionHref(
  projectId: string,
  section: ProjectSectionId
): string {
  return `/projects/${projectId}/${section}`;
}

/** Sections in sidebar order, bucketed by their group heading. */
export function groupedProjectSections(): {
  group?: ProjectSection["group"];
  items: ProjectSection[];
}[] {
  const buckets: { group?: ProjectSection["group"]; items: ProjectSection[] }[] =
    [];
  for (const section of projectSections) {
    const last = buckets[buckets.length - 1];
    if (last && last.group === section.group) {
      last.items.push(section);
    } else {
      buckets.push({ group: section.group, items: [section] });
    }
  }
  return buckets;
}

/**
 * The project id currently being viewed, read from the pathname.
 * Returns undefined on `/projects` and `/projects/new`.
 */
/**
 * The same section, relabelled for the project's hierarchy terminology.
 *
 * Only the `disciplines` section has alternate wording; everything else is
 * returned untouched. The section **id, href, icon, group, and order are
 * unchanged** — display text only.
 */
export function localizeProjectSection(
  section: ProjectSection,
  terms: HierarchyTerms
): ProjectSection {
  // Default terminology is a no-op, so non-PSM projects keep the configured
  // wording verbatim.
  if (terms.plural === DEFAULT_HIERARCHY_TERMS.plural) return section;
  if (section.id !== "disciplines") return section;
  return {
    ...section,
    label: terms.plural,
    description: `${terms.plural} linked to this project's systems.`,
  };
}

export function activeProjectId(pathname: string): string | undefined {
  const match = /^\/projects\/([^/]+)/.exec(pathname);
  const id = match?.[1];
  if (!id || id === "new") return undefined;
  return id;
}

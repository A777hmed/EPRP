import {
  BarChart3,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Contact,
  FolderKanban,
  FolderOpen,
  IdCard,
  Layers,
  LayoutDashboard,
  MessageSquareWarning,
  Presentation,
  Settings,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  description?: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/**
 * Navigation groups.
 *
 * Regrouped to the four-band enterprise structure — Planning & Reporting,
 * Reporting, Tools & Analytics, Administration — with Dashboard standing alone
 * above them as the Control Center.
 *
 * EVERY ITEM RESOLVES TO A REAL ROUTE. The visual reference also shows
 * Notifications and Reports Archive; neither exists in this platform (no route,
 * no table), so neither is listed. A nav entry that leads nowhere is worse than
 * an absent one — it advertises a capability the product does not have.
 *
 * "Programs & Studies" is likewise NOT listed beside Disciplines. Which of the
 * two a project uses is a property of its project type (PSM/PSAIM projects use
 * Programs & Studies, others use Disciplines), so it belongs to the project
 * workspace, not to a global sidebar that would show both to everyone.
 */
export const mainNavigation: NavSection[] = [
  {
    label: "Overview",
    items: [
      {
        title: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        description: "Control Center — portfolio KPIs, analytics and calendar",
      },
    ],
  },
  {
    label: "Planning & Reporting",
    items: [
      {
        title: "Projects",
        href: "/projects",
        icon: FolderKanban,
        description: "Project portfolio and progress tracking",
      },
      {
        title: "Departments",
        href: "/departments",
        icon: Building2,
        description: "Departments participating in reporting",
      },
      {
        title: "Systems",
        href: "/systems",
        icon: Layers,
        description: "Plant and facility systems by department",
      },
      {
        title: "Disciplines",
        href: "/disciplines",
        icon: Wrench,
        description: "Engineering disciplines by department",
      },
      {
        title: "Contacts",
        href: "/contacts",
        icon: Contact,
        description: "People referenced across projects",
      },
    ],
  },
  {
    label: "Reporting",
    items: [
      {
        title: "Weekly Reports",
        href: "/weekly-reports",
        icon: CalendarDays,
        description: "Weekly progress reports by project",
      },
      {
        title: "Monthly Reports",
        href: "/monthly-reports",
        icon: CalendarRange,
        description: "Monthly consolidated progress reports",
      },
      {
        title: "Executive Reports",
        href: "/executive-reports",
        icon: Presentation,
        description: "Executive summaries for leadership",
      },
      {
        title: "Important Comments",
        href: "/comments",
        icon: MessageSquareWarning,
        description: "Flagged comments requiring attention",
      },
    ],
  },
  {
    label: "Tools & Analytics",
    items: [
      {
        title: "Calendar",
        href: "/calendar",
        icon: CalendarClock,
        description: "Meetings, MOM/KOM, milestones and report due dates",
      },
      {
        title: "Analytics",
        href: "/analytics",
        icon: BarChart3,
        description: "Trends, forecasts, and performance analysis",
      },
      {
        title: "Documents",
        href: "/documents",
        icon: FolderOpen,
        description: "Project documents and attachments",
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        title: "Users & Roles",
        href: "/administration",
        icon: ShieldCheck,
        description: "Users, roles, and permissions",
      },
      {
        title: "Job Titles",
        href: "/administration/job-titles",
        icon: IdCard,
        description: "Admin-managed job titles used across the directory",
      },
      {
        title: "Settings",
        href: "/settings",
        icon: Settings,
        description: "Platform configuration",
      },
    ],
  },
];

/** Flat list of every navigation item, for lookups such as breadcrumbs. */
export const allNavItems: (NavItem & { section: string })[] =
  mainNavigation.flatMap((section) =>
    section.items.map((item) => ({ ...item, section: section.label }))
  );

/** Resolve the nav item (and its section) for a pathname, if any. */
export function findNavItem(pathname: string) {
  return (
    allNavItems.find((item) => item.href === pathname) ??
    allNavItems.find(
      (item) => item.href !== "/" && pathname.startsWith(`${item.href}/`)
    )
  );
}

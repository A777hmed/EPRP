"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useCurrentIdentity } from "@/features/auth/use-current-identity";
import { mainNavigation } from "@/config/navigation";
import { activeProjectId } from "@/config/project-sections";
import { siteConfig } from "@/config/site";
import { ProjectContextNav } from "./project-nav-group";

function isItemActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Routes already covered, in full, by the project-contextual sidebar. While
 * a project is open, showing these again in the global rail would just be a
 * second, cross-project version of the same detail links — pure duplication,
 * not a platform destination. Their routes are untouched; this only hides
 * the rail's copy of the link while a project is active.
 */
const HIDDEN_INSIDE_PROJECT = new Set([
  "/departments",
  "/systems",
  "/disciplines",
  "/contacts",
  "/weekly-reports",
  "/monthly-reports",
  "/executive-reports",
]);

/**
 * Forces the global rail's open state to match the route category —
 * expanded on platform routes, compact inside a project — on first paint
 * and on every crossing between the two, regardless of what a previous
 * visit's cookie says. `SidebarProvider`'s `defaultOpen` alone can't do
 * this: it's a static prop on a Server Component and has no route
 * awareness, so a cookie-restored "closed" state was winning even on
 * `/dashboard`.
 *
 * Only fires `setOpen` when the project/global category actually changes
 * (tracked via a ref, not state, so this can't itself trigger a re-render
 * loop) — never on every render or on navigation *within* one category, so
 * a manual toggle during a browsing session is left alone until the user
 * actually crosses into or out of a project.
 */
export function RouteSidebarSync() {
  const pathname = usePathname();
  const insideProject = Boolean(activeProjectId(pathname));
  const { setOpen } = useSidebar();
  const previousRef = React.useRef<boolean | null>(null);

  React.useEffect(() => {
    if (previousRef.current === insideProject) return;
    previousRef.current = insideProject;
    setOpen(!insideProject);
  }, [insideProject, setOpen]);

  return null;
}

/**
 * Primary application sidebar in EPROM branding: deep navy surface, the
 * official logo on a light panel (the lockup is designed for light
 * backgrounds), and royal-blue active items. Collapses to an icon rail
 * showing the compact drop mark + EPR abbreviation; becomes an off-canvas
 * sheet on mobile (handled by the sidebar primitives).
 */
export interface AppSidebarProps {
  /**
   * Welcome card, passed from the server layout so it can read the
   * signed-in profile while this component stays client-side.
   */
  welcome?: React.ReactNode;
}

export function AppSidebar({ welcome }: AppSidebarProps) {
  const pathname = usePathname();
  const { isMobile } = useSidebar();
  const projectId = activeProjectId(pathname);
  const { isGlobalAuthority } = useCurrentIdentity();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <Link
          href="/dashboard"
          aria-label={`${siteConfig.fullName} home`}
          className="flex flex-col gap-2 rounded-md p-1.5 outline-none ring-sidebar-ring transition-colors focus-visible:ring-2 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:gap-1 group-data-[collapsible=icon]:p-0"
        >
          {/* Full lockup — expanded state */}
          <span className="flex items-center justify-center rounded-lg bg-white px-3 py-2 group-data-[collapsible=icon]:hidden">
            <Image
              src={siteConfig.logo.full}
              alt={siteConfig.company}
              width={siteConfig.logo.fullWidth}
              height={siteConfig.logo.fullHeight}
              priority
              className="h-11 w-auto"
            />
          </span>
          <span className="flex items-center justify-between gap-2 group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-semibold">
              {siteConfig.fullName}
            </span>
            <span className="shrink-0 rounded-sm bg-sidebar-primary px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-sidebar-primary-foreground">
              {siteConfig.name}
            </span>
          </span>

          {/* Compact mark — collapsed icon rail */}
          <span className="hidden size-8 items-center justify-center rounded-lg bg-white p-1 group-data-[collapsible=icon]:flex">
            <Image
              src={siteConfig.logo.mark}
              alt=""
              width={siteConfig.logo.markWidth}
              height={siteConfig.logo.markHeight}
              className="h-6 w-auto"
            />
          </span>
          <span
            aria-hidden="true"
            className="hidden text-[9px] font-bold tracking-widest group-data-[collapsible=icon]:block"
          >
            {siteConfig.name}
          </span>
        </Link>
        {welcome}
      </SidebarHeader>
      <SidebarContent>
        {mainNavigation.map((section) => {
          const inScope = projectId
            ? section.items.filter((item) => !HIDDEN_INSIDE_PROJECT.has(item.href))
            : section.items;
          /*
           * Management-only destinations are withheld from accounts that are
           * refused them anyway. Everything else stays: read-only navigation is
           * useful to a department-scoped user and hiding it would remove
           * context without removing any capability.
           *
           * While identity is unresolved these items are hidden rather than
           * shown, so a management link never flashes in and out on load.
           */
          const items = inScope.filter(
            (item) => !item.requiresGlobalAuthority || isGlobalAuthority
          );
          if (items.length === 0) return null;

          return (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {items.map((item) => {
                  const active = isItemActive(pathname, item.href);
                  return (
                    <SidebarMenuItem key={item.href} className="epr-nav-item">
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.title}
                        // `.epr-nav-link` (globals.css) owns hover/active — a
                        // flat off-white surface, not a Tailwind bg utility.
                        className="epr-nav-link"
                      >
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          // Every item in this list is mounted and visible at
                          // once, so Next's default viewport prefetch fires an
                          // RSC request per item just from being rendered —
                          // a self-inflicted request storm on a dense nav.
                          // Click navigation is unaffected; only the
                          // automatic prefetch is disabled.
                          prefetch={false}
                        >
                          <span className="epr-nav-icon" aria-hidden="true">
                            <item.icon aria-hidden="true" />
                          </span>
                          <span className="epr-nav-label">{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          );
        })}
        {/*
         * The project-contextual sidebar is a separate desktop column
         * (`ProjectContextSidebar`); on mobile there is no room for a second
         * column, so the same content is appended here, inside this sheet.
         */}
        {isMobile && projectId && (
          <SidebarGroup>
            <SidebarGroupContent>
              <ProjectContextNav pathname={pathname} />
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

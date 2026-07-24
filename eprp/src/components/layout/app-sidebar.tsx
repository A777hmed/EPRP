"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FileText,
  FileType2,
  Mail,
  Share2,
  type LucideIcon,
} from "lucide-react";

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
} from "@/components/ui/sidebar";
import { mainNavigation } from "@/config/navigation";
import { siteConfig } from "@/config/site";
import { ProjectNavGroup } from "./project-nav-group";

function isItemActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Report shortcuts from the reference design. Wired to the export engine in a later phase. */
const quickActions: { title: string; icon: LucideIcon }[] = [
  { title: "Generate PDF", icon: FileText },
  { title: "Generate DOCX", icon: FileType2 },
  { title: "Email Report", icon: Mail },
  { title: "Share Report", icon: Share2 },
];

/**
 * Primary application sidebar in EPROM branding: deep navy surface, the
 * official logo on a light panel (the lockup is designed for light
 * backgrounds), and royal-blue active items. Collapses to an icon rail
 * showing the compact drop mark + EPR abbreviation; becomes an off-canvas
 * sheet on mobile (handled by the sidebar primitives).
 */
export function AppSidebar() {
  const pathname = usePathname();

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
      </SidebarHeader>
      <SidebarContent>
        {mainNavigation.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  // Projects expands into the current project's sections.
                  if (item.href === "/projects") {
                    return (
                      <ProjectNavGroup key={item.href} pathname={pathname} />
                    );
                  }
                  const active = isItemActive(pathname, item.href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.title}
                        className="data-active:bg-sidebar-primary! data-active:text-sidebar-primary-foreground!"
                      >
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                        >
                          <item.icon aria-hidden="true" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
        <SidebarGroup>
          <SidebarGroupLabel>Quick Actions</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {quickActions.map((action) => (
                <SidebarMenuItem key={action.title}>
                  <SidebarMenuButton
                    tooltip={action.title}
                    disabled
                    aria-disabled="true"
                    title="Available in a later phase"
                  >
                    <action.icon aria-hidden="true" />
                    <span>{action.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, FolderKanban } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import {
  activeProjectId,
  groupedProjectSections,
  projectSectionHref,
} from "@/config/project-sections";
import { useHierarchyTermsByProjectId } from "@/features/projects/use-hierarchy-terms";
import { cn } from "@/lib/utils";

/**
 * The "Projects" sidebar entry: a collapsible parent whose children are the
 * sections of the project currently being viewed.
 *
 * The sub-items only appear once a project is in the URL — without a project
 * id there is nothing meaningful to link to, so the parent simply behaves as
 * a link to the portfolio list.
 */
export function ProjectNavGroup({ pathname }: { pathname: string }) {
  const projectId = activeProjectId(pathname);
  const terms = useHierarchyTermsByProjectId(projectId);
  // Display only: the section id, href, order, and grouping are untouched.
  const sectionLabel = (section: { id: string; label: string }) =>
    section.id === "disciplines" ? terms.plural : section.label;
  const inProjects = pathname === "/projects" || pathname.startsWith("/projects/");

  const listActive = pathname === "/projects";

  return (
    // Uncontrolled, but keyed on whether we are inside Projects: crossing
    // that boundary remounts and re-applies the default, so entering a
    // project opens the group while a manual collapse still sticks as long
    // as the user stays put.
    <Collapsible
      key={inProjects ? "in-projects" : "outside-projects"}
      defaultOpen={inProjects}
      className="group/collapsible"
      asChild
    >
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            tooltip="Projects"
            isActive={inProjects && !projectId}
            className="data-active:bg-sidebar-primary! data-active:text-sidebar-primary-foreground!"
          >
            <FolderKanban aria-hidden="true" />
            <span>Projects</span>
            <ChevronRight
              aria-hidden="true"
              className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90"
            />
          </SidebarMenuButton>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <SidebarMenuSub>
            <SidebarMenuSubItem>
              <SidebarMenuSubButton
                asChild
                isActive={listActive}
                className="data-active:bg-sidebar-primary! data-active:text-sidebar-primary-foreground!"
              >
                <Link
                  href="/projects"
                  aria-current={listActive ? "page" : undefined}
                >
                  All Projects
                </Link>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>

            {projectId ? (
              groupedProjectSections().map((bucket) => (
                <React.Fragment key={bucket.group ?? "general"}>
                  {bucket.group && (
                    <li
                      className={cn(
                        "px-2 pt-2 pb-0.5 text-[0.7rem] font-medium",
                        "text-sidebar-foreground/60"
                      )}
                    >
                      {bucket.group}
                    </li>
                  )}
                  {bucket.items.map((section) => {
                    const href = projectSectionHref(projectId, section.id);
                    // `setup` also covers the wizard's own step routes.
                    const active =
                      pathname === href || pathname.startsWith(`${href}/`);
                    return (
                      <SidebarMenuSubItem key={section.id}>
                        <SidebarMenuSubButton
                          asChild
                          isActive={active}
                          className="data-active:bg-sidebar-primary! data-active:text-sidebar-primary-foreground!"
                        >
                          <Link
                            href={href}
                            aria-current={active ? "page" : undefined}
                          >
                            <section.icon aria-hidden="true" />
                            <span>{sectionLabel(section)}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    );
                  })}
                </React.Fragment>
              ))
            ) : (
              <li className="px-2 py-1.5 text-xs text-sidebar-foreground/60">
                Open a project to see its sections.
              </li>
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

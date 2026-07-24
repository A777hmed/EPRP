"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { findNavItem } from "@/config/navigation";
import {
  activeProjectId,
  getProjectSection,
  isProjectSection,
} from "@/config/project-sections";
import { siteConfig } from "@/config/site";
import { listProjectsSync } from "@/services/project-service";

/** A single crumb; the last one in the list renders as the current page. */
interface Crumb {
  label: string;
  href?: string;
}

/**
 * Inside a project the trail names the project and the section being
 * viewed — `Projects › Storage Tank Rehabilitation › Organization Chart` —
 * rather than stopping at the portfolio list.
 */
function projectCrumbs(pathname: string): Crumb[] | null {
  const projectId = activeProjectId(pathname);
  if (!projectId) return null;

  const project = listProjectsSync().find(
    (candidate) => candidate.id === projectId
  );
  const crumbs: Crumb[] = [{ label: "Projects", href: "/projects" }];

  // Fall back to the id while the store is still warming up, so the trail
  // never renders a blank segment.
  crumbs.push({
    label: project ? (project.shortName ?? project.name) : projectId,
    href: `/projects/${projectId}`,
  });

  const segment = pathname.split("/")[3];
  if (segment && isProjectSection(segment)) {
    crumbs.push({ label: getProjectSection(segment).label });
  } else if (segment === "edit") {
    crumbs.push({ label: "Edit" });
  } else if (segment === "setup") {
    crumbs.push({ label: "Project Setup" });
  }

  return crumbs;
}

/**
 * Location breadcrumbs: EPRP › Section › Page, or the project-aware trail
 * when inside a project. Hidden on small screens (the page header already
 * names the page there).
 */
export function Breadcrumbs() {
  const pathname = usePathname();
  const projectTrail = projectCrumbs(pathname);
  const item = projectTrail ? null : findNavItem(pathname);

  if (!projectTrail && !item) return null;

  const crumbs: Crumb[] =
    projectTrail ??
    (item
      ? [
          ...(item.href === "/dashboard"
            ? []
            : [{ label: item.section }]),
          { label: item.title },
        ]
      : []);

  return (
    <Breadcrumb className="hidden md:block">
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href="/dashboard">{siteConfig.name}</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            // Separator and item are both <li>, so they stay siblings.
            <React.Fragment key={`${crumb.label}-${index}`}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : crumb.href ? (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                ) : (
                  crumb.label
                )}
              </BreadcrumbItem>
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

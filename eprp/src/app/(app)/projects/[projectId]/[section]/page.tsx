import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProjectSectionView } from "@/features/projects";
import {
  getProjectSection,
  isProjectSection,
} from "@/config/project-sections";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string }>;
}): Promise<Metadata> {
  const { section } = await params;
  if (!isProjectSection(section)) return { title: "Project" };
  return { title: getProjectSection(section).label };
}

/**
 * One project section in the main content area. Static sibling routes such as
 * `edit` and `setup` take precedence over this dynamic segment.
 *
 * No `generateStaticParams` here on purpose — see the sibling
 * `setup/[step]/page.tsx` for the full reasoning. In short: this route has two
 * dynamic segments (`[projectId]` and `[section]`) and returning only
 * `{ section }` left `projectId` undefined, poisoning route resolution for the
 * whole `/projects/[projectId]` subtree. Project ids are database values and
 * cannot be enumerated at build time.
 */
export default async function ProjectSectionPage({
  params,
}: {
  params: Promise<{ projectId: string; section: string }>;
}) {
  const { projectId, section } = await params;
  if (!isProjectSection(section)) notFound();
  return <ProjectSectionView projectId={projectId} section={section} />;
}

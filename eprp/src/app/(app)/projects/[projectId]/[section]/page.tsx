import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProjectSectionView } from "@/features/projects";
import {
  getProjectSection,
  isProjectSection,
  projectSections,
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

export function generateStaticParams() {
  return projectSections.map((section) => ({ section: section.id }));
}

/**
 * One project section in the main content area. Static sibling routes such as
 * `edit` and `setup` take precedence over this dynamic segment.
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

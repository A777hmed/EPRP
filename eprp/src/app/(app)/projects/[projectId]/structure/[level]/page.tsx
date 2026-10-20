import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProjectStructureLevelView } from "@/features/projects/components/sections/project-structure-level-view";
import { parseStructureLevel } from "@/features/projects/structure-navigation";

export const metadata: Metadata = {
  title: "Project Structure",
};

/**
 * One configured structure level of an Other project (e.g. "Functions"). The
 * level's name is the project's own and is resolved on the client from its
 * structure; the route carries only the level number (1–4).
 *
 * No `generateStaticParams`: project ids are database values (see the sibling
 * `[section]/page.tsx`).
 */
export default async function ProjectStructureLevelPage({
  params,
}: {
  params: Promise<{ projectId: string; level: string }>;
}) {
  const { projectId, level } = await params;
  const levelNumber = parseStructureLevel(level);
  if (levelNumber === null) notFound();
  return <ProjectStructureLevelView projectId={projectId} levelNumber={levelNumber} />;
}

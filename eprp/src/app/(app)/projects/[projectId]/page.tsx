import type { Metadata } from "next";

import { ProjectDetailsView } from "@/features/projects";

export const metadata: Metadata = {
  title: "Project Details",
};

export default async function ProjectDetailsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectDetailsView projectId={projectId} />;
}

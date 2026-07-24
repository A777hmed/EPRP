import type { Metadata } from "next";

import { ProjectFormView } from "@/features/projects";

export const metadata: Metadata = {
  title: "Edit Project",
};

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectFormView projectId={projectId} />;
}

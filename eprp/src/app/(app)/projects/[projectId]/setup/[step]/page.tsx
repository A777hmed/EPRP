import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProjectSetupView } from "@/features/projects";
import {
  getProjectWorkflowStep,
  isProjectWorkflowStep,
  projectWorkflowSteps,
} from "@/config/project-workflow";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ step: string }>;
}): Promise<Metadata> {
  const { step } = await params;
  if (!isProjectWorkflowStep(step)) return { title: "Project Setup" };
  return { title: `${getProjectWorkflowStep(step).label} — Setup` };
}

export function generateStaticParams() {
  return projectWorkflowSteps.map((step) => ({ step: step.id }));
}

export default async function ProjectSetupStepPage({
  params,
}: {
  params: Promise<{ projectId: string; step: string }>;
}) {
  const { projectId, step } = await params;
  if (!isProjectWorkflowStep(step)) notFound();
  return <ProjectSetupView projectId={projectId} step={step} />;
}

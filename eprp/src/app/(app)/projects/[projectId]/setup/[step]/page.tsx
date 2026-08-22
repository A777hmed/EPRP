import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProjectSetupView } from "@/features/projects";
import {
  getProjectWorkflowStep,
  isProjectWorkflowStep,
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

/**
 * No `generateStaticParams` here on purpose.
 *
 * This route has two dynamic segments — `[projectId]` and `[step]` — and
 * `generateStaticParams` must return every one of them for a route
 * (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-static-params.md`:
 * "each object represents the populated dynamic segments of a single route").
 * Returning only `{ step }` left `projectId` undefined, which marked the route
 * SSG while prerendering nothing, and intermittently 404'd it in dev.
 *
 * Project ids come from the database and are unknowable at build time, so
 * this route is dynamic by nature. The step is still validated below.
 */
export default async function ProjectSetupStepPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; step: string }>;
  searchParams: Promise<{ disciplineId?: string | string[] }>;
}) {
  const { projectId, step } = await params;
  const { disciplineId } = await searchParams;
  if (!isProjectWorkflowStep(step)) notFound();
  return (
    <ProjectSetupView
      projectId={projectId}
      step={step}
      initialDisciplineId={
        Array.isArray(disciplineId) ? disciplineId[0] : disciplineId
      }
    />
  );
}

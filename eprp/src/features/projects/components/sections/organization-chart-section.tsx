"use client";

import { OrgChartView } from "@/features/organization";
import type { Project } from "@/types";

export interface OrganizationChartSectionProps {
  project: Project;
}

/**
 * OC-3 — the project's organization chart surface.
 *
 * Every chart belongs to a project, so this page is only reachable through
 * `/projects/[projectId]/organization-chart` and the chart is looked up by
 * that id. The chart itself lives in the organization feature.
 */
export function OrganizationChartSection({
  project,
}: OrganizationChartSectionProps) {
  return <OrgChartView project={project} />;
}

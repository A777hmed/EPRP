import type { Metadata } from "next";

import { ProjectReportCreateGate } from "@/features/projects/components/sections/project-report-create-gate";

export const metadata: Metadata = {
  title: "New Monthly Report",
};

/**
 * Project-scoped alias for Monthly report creation.
 *
 * Same view and same two-step creation as `/monthly-reports/new` — create the
 * report, then `compileFromWeeklies` — so the Weekly-consolidation rule is
 * applied identically however the form was reached. Only the project comes
 * from the route rather than a selector.
 *
 * Static segment beside `[reportId]`; see the Weekly sibling for the route
 * resolution note and for the authorization note — `ProjectReportCreateGate`
 * applies the same `canManageReporting` here, so direct URL entry cannot
 * expose the create form, the project field or the Create control to an
 * account that may not raise a Monthly.
 */
export default async function ProjectNewMonthlyReportPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectReportCreateGate projectId={projectId} kind="monthly" />;
}

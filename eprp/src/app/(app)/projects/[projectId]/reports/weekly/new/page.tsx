import type { Metadata } from "next";

import { ProjectReportCreateGate } from "@/features/projects/components/sections/project-report-create-gate";

export const metadata: Metadata = {
  title: "New Weekly Report",
};

/**
 * Project-scoped alias for Weekly report creation.
 *
 * Same view, same service, same validation as `/weekly-reports/new` — the
 * only difference is that the project is supplied by the route instead of
 * chosen in a picker, so a user already standing inside a project is never
 * sent out to the global register to raise that project's own report.
 *
 * A static segment beside the `[reportId]` sibling: Next resolves static
 * segments before dynamic ones, so `/reports/weekly/new` reaches this page
 * and never matches `[reportId]` — the same arrangement `/projects/new`
 * already has beside `/projects/[projectId]`.
 *
 * Authorization is not re-implemented here either: `ProjectReportCreateGate`
 * resolves the SAME `canManageReporting` that gates the "+ New Weekly Report"
 * action, so reaching this URL directly cannot expose a create form to an
 * account the action was withheld from. `weekly_reports_insert`
 * (`can_manage_reporting_workflow()`) remains the security boundary.
 */
export default async function ProjectNewWeeklyReportPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectReportCreateGate projectId={projectId} kind="weekly" />;
}

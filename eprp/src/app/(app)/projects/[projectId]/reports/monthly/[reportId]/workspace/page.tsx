import type { Metadata } from "next";

import { MonthlyWorkspaceView } from "@/features/monthly-reports";

export const metadata: Metadata = { title: "Monthly Report Workspace" };

/**
 * Project-scoped alias for the Monthly workspace route — see the sibling
 * detail page for why this exists. Same component, same save path; only the
 * route (and the links this view produces) are project-scoped.
 *
 * Only `projectId` (a plain string) crosses this Server → Client Component
 * boundary — see the sibling detail page for why.
 */
export default async function ProjectMonthlyReportWorkspacePage({
  params,
}: {
  params: Promise<{ projectId: string; reportId: string }>;
}) {
  const { projectId, reportId } = await params;

  return <MonthlyWorkspaceView reportId={reportId} projectId={projectId} />;
}

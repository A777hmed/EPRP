import type { Metadata } from "next";

import { WeeklyReportDetailView } from "@/features/weekly-reports";
import { getWeeklyViewerContext } from "@/features/weekly-reports/viewer-context";

export const metadata: Metadata = {
  title: "Weekly Report Workspace",
};

/**
 * Project-scoped alias for the Weekly workspace route — see the sibling
 * detail page for why this exists. Same server context, same editable
 * workspace, same save path; only the route (and the links this view
 * produces) are project-scoped.
 *
 * Only `projectId` (a plain string) crosses this Server → Client Component
 * boundary — see the sibling detail page for why.
 */
export default async function ProjectWeeklyReportWorkspacePage({
  params,
}: {
  params: Promise<{ projectId: string; reportId: string }>;
}) {
  const { projectId, reportId } = await params;
  const context = await getWeeklyViewerContext(reportId);

  return (
    <WeeklyReportDetailView
      reportId={reportId}
      viewerScope={context.scope}
      editability={context.editability}
      serverReportStatus={context.reportStatus}
      demoMode={context.demoMode}
      viewerName={context.viewerName}
      viewerRoleLabel={context.viewerRoleLabel}
      mode="workspace"
      projectId={projectId}
    />
  );
}

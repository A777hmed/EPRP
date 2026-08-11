import type { Metadata } from "next";

import { WeeklyReportDetailView } from "@/features/weekly-reports";
import { getWeeklyViewerContext } from "@/features/weekly-reports/viewer-context";

export const metadata: Metadata = {
  title: "Weekly Report Workspace",
};

/**
 * The existing editable Weekly workspace, under its explicit route.
 * Authorization and editability remain resolved by the same server context;
 * the client receives no new authority and uses the existing save path.
 */
export default async function WeeklyReportWorkspacePage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
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
      backHref={`/weekly-reports/${reportId}`}
      mode="workspace"
    />
  );
}

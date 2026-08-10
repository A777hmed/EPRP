import type { Metadata } from "next";

import { WeeklyReportDetailView } from "@/features/weekly-reports";
import { getWeeklyViewerContext } from "@/features/weekly-reports/viewer-context";

export const metadata: Metadata = {
  title: "Weekly Report",
};

/**
 * The Weekly workspace route.
 *
 * Scope is resolved here, on the server, because it depends on the auth cookie
 * and on the `profiles` row linking that login to a contact — neither of which
 * the client can be trusted to assert. The workspace itself stays a client
 * component; it receives the ANSWER as props rather than the means to compute
 * one, so there is no second authorization model to keep in step.
 */
export default async function WeeklyReportDetailPage({
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
    />
  );
}

import type { Metadata } from "next";

import { WeeklyReportDetailView } from "@/features/weekly-reports";
import { getWeeklyViewerContext } from "@/features/weekly-reports/viewer-context";

export const metadata: Metadata = {
  title: "Weekly Report",
};

/**
 * Project-scoped alias for the Weekly Report detail route.
 *
 * Same server context, same view as `/weekly-reports/[reportId]` — only the
 * URL and the links this view's own actions produce differ, so a report
 * opened from a project's Reporting tab stays under `/projects/[projectId]/
 * ...` and the project sidebar never disappears. No report logic is
 * duplicated; `getWeeklyViewerContext` and `WeeklyReportDetailView` are the
 * exact same functions the global route uses.
 *
 * Only `projectId` (a plain string) crosses this Server → Client Component
 * boundary — `WeeklyReportDetailView` builds its own project-scoped href
 * functions internally from it, since functions themselves cannot be
 * serialized across that boundary.
 */
export default async function ProjectWeeklyReportDetailPage({
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
      projectId={projectId}
    />
  );
}

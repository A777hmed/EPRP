import type { Metadata } from "next";

import { MonthlyWorkspaceView } from "@/features/monthly-reports";
import { getMonthlyViewerContext } from "@/features/monthly-reports/monthly-viewer-context";

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
  /*
   * Authority is resolved HERE, on the server, and the ANSWER is passed down —
   * the client never re-derives it. Only plain data crosses the boundary.
   */
  const { scope, editability, viewerName, viewerRoleLabel } =
    await getMonthlyViewerContext(reportId);

  return (
    <MonthlyWorkspaceView
      reportId={reportId}
      projectId={projectId}
      viewer={{
        scope: scope
          ? {
              contactId: scope.contactId,
              canConsolidate: scope.canConsolidate,
              canControlReportLifecycle: scope.canControlReportLifecycle,
              departmentIds: scope.departmentIds,
              managedDepartmentIds: scope.managedDepartmentIds,
            }
          : null,
        editability,
        viewerName,
        viewerRoleLabel,
      }}
    />
  );
}

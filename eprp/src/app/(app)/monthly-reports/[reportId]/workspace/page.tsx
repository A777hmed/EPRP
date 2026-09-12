import type { Metadata } from "next";
import { MonthlyWorkspaceView } from "@/features/monthly-reports";
import { getMonthlyViewerContext } from "@/features/monthly-reports/monthly-viewer-context";

export const metadata: Metadata = { title: "Monthly Report Workspace" };

export default async function MonthlyReportWorkspacePage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  /*
   * Authority is resolved HERE, on the server, and the ANSWER is passed down —
   * the client never re-derives it. Only plain data crosses the boundary.
   */
  const { scope, editability, viewerName, viewerRoleLabel } =
    await getMonthlyViewerContext(reportId);

  return (
    <MonthlyWorkspaceView
      reportId={reportId}
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

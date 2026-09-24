import type { Metadata } from "next";
import { MonthlyWorkspaceView } from "@/features/monthly-reports";
import { getMonthlyViewerContext } from "@/features/monthly-reports/monthly-viewer-context";

export const metadata: Metadata = {
  title: "Edit Monthly Report",
};

/**
 * This route rendered `MonthlyWorkspaceView` with no `viewer` prop at all.
 * `MonthlyWorkspaceView` treats a missing viewer as "pre-existing behavior:
 * this workspace was only ever reachable by Project Control" and falls back
 * to full authoring authority — every panel unlocked, `canManage: true`,
 * `canControlReportLifecycle: true` (see `monthly-workspace.tsx`). That
 * assumption held only while every path to this component resolved a real
 * viewer first, which this route never did: any authenticated account could
 * open it, on any project, and see the full approval/lifecycle workspace
 * enabled regardless of assignment.
 *
 * Authorization is now resolved HERE, on the server, exactly as the sibling
 * `/monthly-reports/[reportId]/workspace` route already does — same
 * `getMonthlyViewerContext` call, same `viewer` shape. The workspace's own
 * existing fallbacks (the department-only view, the portfolio-read-only
 * disabled fieldsets) then apply correctly instead of the fail-open default.
 */
export default async function EditMonthlyReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
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
              isPortfolioReadOnly: scope.capability === "portfolio_read",
            }
          : null,
        editability,
        viewerName,
        viewerRoleLabel,
      }}
    />
  );
}

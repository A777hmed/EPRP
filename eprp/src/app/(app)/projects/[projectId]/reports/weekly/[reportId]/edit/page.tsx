import type { Metadata } from "next";

import { WeeklyReportEditDenied, WeeklyReportFormView } from "@/features/weekly-reports";
import { getWeeklyViewerContext } from "@/features/weekly-reports/viewer-context";
import { isEditableReportStatus } from "@/features/weekly-reports/utils";

export const metadata: Metadata = {
  title: "Edit Weekly Report",
};

/**
 * Project-scoped alias for Weekly report header editing (Top-Level
 * Reporting 4A).
 *
 * Same view, same service, same validation as `/weekly-reports/[reportId]/
 * edit` — the only difference is that the project is supplied by the route
 * instead of being read back off the loaded report, so every save/cancel
 * exit stays under `/projects/[projectId]/...` rather than dropping a
 * project-context user into the global register.
 *
 * Authorization is resolved HERE, on the server, mirroring the global edit
 * route and the report detail page's own Edit-link gate
 * (`scope?.canConsolidate`). Reaching this URL directly used to hand out the
 * header edit form to any authenticated account, on any project, regardless
 * of assignment — including a project this viewer has no authority on.
 * `weekly_reports_update` (`can_manage_reporting_workflow()`) remains the
 * write boundary; this closes the "shown a form you cannot submit" gap in
 * front of it, per the Access & Visibility hotfix (05_PERMISSION_MODEL.md).
 */
export default async function ProjectEditWeeklyReportPage({
  params,
}: {
  params: Promise<{ projectId: string; reportId: string }>;
}) {
  const { projectId, reportId } = await params;
  const context = await getWeeklyViewerContext(reportId);

  const authorized =
    context.demoMode ||
    (context.scope?.canConsolidate === true &&
      context.editability?.canEdit === true &&
      context.reportStatus !== null &&
      isEditableReportStatus(context.reportStatus));

  if (!authorized) {
    return (
      <WeeklyReportEditDenied
        backHref={`/projects/${projectId}/reports/weekly/${reportId}`}
      />
    );
  }

  return <WeeklyReportFormView reportId={reportId} projectId={projectId} />;
}

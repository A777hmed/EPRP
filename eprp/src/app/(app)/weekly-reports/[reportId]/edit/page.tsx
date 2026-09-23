import type { Metadata } from "next";

import { WeeklyReportEditDenied, WeeklyReportFormView } from "@/features/weekly-reports";
import { getWeeklyViewerContext } from "@/features/weekly-reports/viewer-context";
import { isEditableReportStatus } from "@/features/weekly-reports/utils";

export const metadata: Metadata = {
  title: "Edit Weekly Report",
};

/**
 * Authorization is resolved HERE, on the server, before the header edit form
 * is ever rendered — the same three-part rule the report detail page already
 * uses to decide whether its Edit link appears at all
 * (`isEditableReport(report) && editability.canEdit && scope?.canConsolidate`,
 * see `weekly-report-detail-view.tsx`). This route used to render
 * `WeeklyReportFormView` unconditionally, so any authenticated account could
 * reach the edit form for any project's Weekly Report by URL regardless of
 * its own assignment; RLS refused the eventual save, but only after handing
 * out a live mutation form. Demo mode (no Supabase configured, so no login
 * exists to scope) keeps its pre-existing open behavior.
 */
export default async function EditWeeklyReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  const context = await getWeeklyViewerContext(reportId);

  const authorized =
    context.demoMode ||
    (context.scope?.canConsolidate === true &&
      context.editability?.canEdit === true &&
      context.reportStatus !== null &&
      isEditableReportStatus(context.reportStatus));

  if (!authorized) {
    return <WeeklyReportEditDenied backHref="/weekly-reports" />;
  }

  return <WeeklyReportFormView reportId={reportId} />;
}

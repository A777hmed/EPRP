import type { Metadata } from "next";

import { WeeklyReportPreview } from "@/features/weekly-reports";
import { getWeeklyViewerContext } from "@/features/weekly-reports/viewer-context";

export const metadata: Metadata = {
  title: "Weekly Report Preview",
};

/**
 * The preview resolves the viewer's scope on the server, exactly as the
 * workspace route does and through the same cached resolver — so the printed
 * document shows what that person may see and nothing else. Rendering it any
 * other way would make the preview a second, weaker answer to a question row
 * level security has already answered.
 */
export default async function PreviewWeeklyReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  const context = await getWeeklyViewerContext(reportId);

  return (
    <WeeklyReportPreview
      reportId={reportId}
      viewerScope={context.scope}
      demoMode={context.demoMode}
    />
  );
}

import type { Metadata } from "next";

import { MonthlyReportView } from "@/features/monthly-reports";

export const metadata: Metadata = {
  title: "Monthly Report",
};

/**
 * Project-scoped alias for the Monthly Report detail route.
 *
 * Same view as `/monthly-reports/[reportId]` — only the URL and the links
 * this view's own actions produce differ, so a report opened from a
 * project's Reporting tab stays under `/projects/[projectId]/...` and the
 * project sidebar never disappears. No report logic is duplicated;
 * `MonthlyReportView` is the exact same component the global route uses.
 *
 * Only `projectId` (a plain string) crosses this Server → Client Component
 * boundary — `MonthlyReportView` builds its own project-scoped href
 * functions internally from it, since functions themselves cannot be
 * serialized across that boundary.
 */
export default async function ProjectMonthlyReportDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; reportId: string }>;
}) {
  const { projectId, reportId } = await params;

  return <MonthlyReportView reportId={reportId} projectId={projectId} />;
}

import type { Metadata } from "next";

import { WeeklyReportFormView } from "@/features/weekly-reports";

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
 * Added alongside the 4A consolidation of `/weekly-reports` into a
 * read-only register: before that change, this was the ONLY project-scoped
 * path to `WeeklyReportFormView`'s header-field editing (Planned/Actual,
 * disciplines, prepared-by, KPIs, Major Activities) — the workspace at
 * `/projects/[projectId]/reports/weekly/[reportId]/workspace` covers
 * department input and management items, a different set of fields, not
 * this form's.
 *
 * Authorization is not re-implemented here: `WeeklyReportFormView` and
 * `weeklyReportService.update()` are the exact same functions the global
 * edit route uses, and `weekly_reports_update`
 * (`can_manage_reporting_workflow()`) remains the security boundary. An
 * account without edit authority on this project reaches the same form
 * the global route would show it and is refused by RLS on save, exactly as
 * before.
 */
export default async function ProjectEditWeeklyReportPage({
  params,
}: {
  params: Promise<{ projectId: string; reportId: string }>;
}) {
  const { projectId, reportId } = await params;
  return <WeeklyReportFormView reportId={reportId} projectId={projectId} />;
}

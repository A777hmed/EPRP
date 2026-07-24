import type { Metadata } from "next";

import { WeeklyReportFormView } from "@/features/weekly-reports";

export const metadata: Metadata = {
  title: "Edit Weekly Report",
};

export default async function EditWeeklyReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  return <WeeklyReportFormView reportId={reportId} />;
}

import type { Metadata } from "next";

import { WeeklyReportPreview } from "@/features/weekly-reports";

export const metadata: Metadata = {
  title: "Weekly Report Preview",
};

export default async function PreviewWeeklyReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  return <WeeklyReportPreview reportId={reportId} />;
}

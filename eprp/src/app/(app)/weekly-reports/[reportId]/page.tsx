import type { Metadata } from "next";

import { WeeklyReportDetailView } from "@/features/weekly-reports";

export const metadata: Metadata = {
  title: "Weekly Report",
};

export default async function WeeklyReportDetailPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  return <WeeklyReportDetailView reportId={reportId} />;
}

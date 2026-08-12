import type { Metadata } from "next";
import { MonthlyReportView } from "@/features/monthly-reports";

export const metadata: Metadata = {
  title: "Monthly Report",
};

export default async function MonthlyReportDetailPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;

  return <MonthlyReportView reportId={reportId} />;
}

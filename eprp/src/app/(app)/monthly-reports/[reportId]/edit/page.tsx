import type { Metadata } from "next";
import { MonthlyWorkspaceView } from "@/features/monthly-reports";

export const metadata: Metadata = {
  title: "Edit Monthly Report",
};

export default async function EditMonthlyReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;

  return <MonthlyWorkspaceView reportId={reportId} />;
}

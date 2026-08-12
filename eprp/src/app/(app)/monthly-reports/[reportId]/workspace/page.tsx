import type { Metadata } from "next";
import { MonthlyWorkspaceView } from "@/features/monthly-reports";

export const metadata: Metadata = { title: "Monthly Report Workspace" };

export default async function MonthlyReportWorkspacePage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  return <MonthlyWorkspaceView reportId={reportId} />;
}

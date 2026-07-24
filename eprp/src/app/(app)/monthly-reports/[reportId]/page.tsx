import type { Metadata } from "next";
import { CalendarRange } from "lucide-react";

import { PlaceholderPage } from "@/components/shared";

export const metadata: Metadata = {
  title: "Monthly Report",
};

export default async function MonthlyReportDetailPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;

  return (
    <PlaceholderPage
      eyebrow="Reporting"
      title="Monthly Report"
      description={`Monthly report details, compilation, and approvals (report ${reportId})`}
      icon={CalendarRange}
    />
  );
}

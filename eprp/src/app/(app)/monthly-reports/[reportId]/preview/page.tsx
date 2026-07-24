import type { Metadata } from "next";
import { Eye } from "lucide-react";

import { PlaceholderPage } from "@/components/shared";

export const metadata: Metadata = {
  title: "Monthly Report Preview",
};

export default async function PreviewMonthlyReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;

  return (
    <PlaceholderPage
      eyebrow="Reporting"
      title="Monthly Report Preview"
      description={`Print-ready preview of the monthly report (report ${reportId})`}
      icon={Eye}
    />
  );
}

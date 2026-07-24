import type { Metadata } from "next";
import { Presentation } from "lucide-react";

import { PlaceholderPage } from "@/components/shared";

export const metadata: Metadata = {
  title: "Executive Report",
};

export default async function ExecutiveReportDetailPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;

  return (
    <PlaceholderPage
      eyebrow="Reporting"
      title="Executive Report"
      description={`Executive report details and approvals (report ${reportId})`}
      icon={Presentation}
    />
  );
}

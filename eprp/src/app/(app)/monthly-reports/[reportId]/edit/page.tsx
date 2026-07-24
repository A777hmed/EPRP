import type { Metadata } from "next";
import { PenLine } from "lucide-react";

import { PlaceholderPage } from "@/components/shared";

export const metadata: Metadata = {
  title: "Edit Monthly Report",
};

export default async function EditMonthlyReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;

  return (
    <PlaceholderPage
      eyebrow="Reporting"
      title="Edit Monthly Report"
      description={`Edit the monthly report content (report ${reportId})`}
      icon={PenLine}
    />
  );
}

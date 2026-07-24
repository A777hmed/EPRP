import type { Metadata } from "next";
import { PenLine } from "lucide-react";

import { PlaceholderPage } from "@/components/shared";

export const metadata: Metadata = {
  title: "Edit Executive Report",
};

export default async function EditExecutiveReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;

  return (
    <PlaceholderPage
      eyebrow="Reporting"
      title="Edit Executive Report"
      description={`Edit the executive report content (report ${reportId})`}
      icon={PenLine}
    />
  );
}

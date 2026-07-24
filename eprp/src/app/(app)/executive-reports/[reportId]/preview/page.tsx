import type { Metadata } from "next";
import { Eye } from "lucide-react";

import { PlaceholderPage } from "@/components/shared";

export const metadata: Metadata = {
  title: "Executive Report Preview",
};

export default async function PreviewExecutiveReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;

  return (
    <PlaceholderPage
      eyebrow="Reporting"
      title="Executive Report Preview"
      description={`Print-ready preview of the executive report (report ${reportId})`}
      icon={Eye}
    />
  );
}

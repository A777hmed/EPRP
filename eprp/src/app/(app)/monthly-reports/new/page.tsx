import type { Metadata } from "next";
import { FilePlus2 } from "lucide-react";

import { PlaceholderPage } from "@/components/shared";

export const metadata: Metadata = {
  title: "New Monthly Report",
};

export default function NewMonthlyReportPage() {
  return (
    <PlaceholderPage
      eyebrow="Reporting"
      title="New Monthly Report"
      description="Compile a monthly report from approved weekly reports."
      icon={FilePlus2}
    />
  );
}

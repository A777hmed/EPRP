import type { Metadata } from "next";
import { FilePlus2 } from "lucide-react";

import { PlaceholderPage } from "@/components/shared";

export const metadata: Metadata = {
  title: "New Executive Report",
};

export default function NewExecutiveReportPage() {
  return (
    <PlaceholderPage
      eyebrow="Reporting"
      title="New Executive Report"
      description="Create an executive summary from approved reports."
      icon={FilePlus2}
    />
  );
}

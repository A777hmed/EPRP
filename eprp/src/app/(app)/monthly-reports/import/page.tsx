import type { Metadata } from "next";
import { Upload } from "lucide-react";

import { PlaceholderPage } from "@/components/shared";

export const metadata: Metadata = {
  title: "Import Monthly Reports",
};

export default function ImportMonthlyReportsPage() {
  return (
    <PlaceholderPage
      eyebrow="Reporting"
      title="Import Monthly Reports"
      description="Import monthly reports from Excel or DOCX templates."
      icon={Upload}
    />
  );
}

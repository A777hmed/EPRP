import type { Metadata } from "next";
import { Upload } from "lucide-react";

import { PlaceholderPage } from "@/components/shared";

export const metadata: Metadata = {
  title: "Import Weekly Reports",
};

export default function ImportWeeklyReportsPage() {
  return (
    <PlaceholderPage
      eyebrow="Reporting"
      title="Import Weekly Reports"
      description="Import weekly reports from Excel or DOCX templates."
      icon={Upload}
    />
  );
}

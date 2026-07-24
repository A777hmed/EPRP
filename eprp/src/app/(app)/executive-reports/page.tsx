import type { Metadata } from "next";
import { Presentation } from "lucide-react";

import { PlaceholderPage } from "@/components/shared";

export const metadata: Metadata = {
  title: "Executive Reports",
};

export default function ExecutiveReportsPage() {
  return (
    <PlaceholderPage
      eyebrow="Reporting"
      title="Executive Reports"
      description="Executive summaries prepared for leadership review."
      icon={Presentation}
    />
  );
}

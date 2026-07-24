import type { Metadata } from "next";
import { MessageSquareWarning } from "lucide-react";

import { PlaceholderPage } from "@/components/shared";

export const metadata: Metadata = {
  title: "Important Comments",
};

export default function ImportantCommentsPage() {
  return (
    <PlaceholderPage
      eyebrow="Reporting"
      title="Important Comments"
      description="Flagged comments and escalations that need attention."
      icon={MessageSquareWarning}
    />
  );
}

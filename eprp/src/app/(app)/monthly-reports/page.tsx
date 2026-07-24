import type { Metadata } from "next";
import { CalendarRange } from "lucide-react";

import { PlaceholderPage } from "@/components/shared";

export const metadata: Metadata = {
  title: "Monthly Reports",
};

export default function MonthlyReportsPage() {
  return (
    <PlaceholderPage
      eyebrow="Reporting"
      title="Monthly Reports"
      description="Monthly consolidated progress reports across the portfolio."
      icon={CalendarRange}
    />
  );
}

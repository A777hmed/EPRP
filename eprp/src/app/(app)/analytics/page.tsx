import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";

import { PlaceholderPage } from "@/components/shared";

export const metadata: Metadata = {
  title: "Analytics",
};

export default function AnalyticsPage() {
  return (
    <PlaceholderPage
      eyebrow="Insights"
      title="Analytics"
      description="Trends, forecasts, and performance analysis across the portfolio."
      icon={BarChart3}
    />
  );
}

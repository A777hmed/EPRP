import type { Metadata } from "next";
import { MonthlyNewView } from "@/features/monthly-reports";

export const metadata: Metadata = {
  title: "New Monthly Report",
};

export default function NewMonthlyReportPage() {
  return <MonthlyNewView />;
}

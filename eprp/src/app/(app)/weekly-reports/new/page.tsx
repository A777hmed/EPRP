import type { Metadata } from "next";

import { WeeklyReportFormView } from "@/features/weekly-reports";

export const metadata: Metadata = {
  title: "New Weekly Report",
};

export default function NewWeeklyReportPage() {
  return <WeeklyReportFormView />;
}

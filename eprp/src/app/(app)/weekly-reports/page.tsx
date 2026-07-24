import type { Metadata } from "next";

import { WeeklyReportsView } from "@/features/weekly-reports";

export const metadata: Metadata = {
  title: "Weekly Reports",
};

export default function WeeklyReportsPage() {
  return <WeeklyReportsView />;
}

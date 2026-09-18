import type { Metadata } from "next";
import { MonthlyReportsView } from "@/features/monthly-reports";

export const metadata: Metadata = {
  title: "Monthly Reports",
};

export default function MonthlyReportsPage() {
  return <MonthlyReportsView />;
}

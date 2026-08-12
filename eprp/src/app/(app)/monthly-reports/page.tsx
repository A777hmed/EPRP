import type { Metadata } from "next";
import { MonthlyReportsView } from "@/features/monthly-reports";
import { getCurrentUserIdentity } from "@/features/auth/profile";

export const metadata: Metadata = {
  title: "Monthly Reports",
};

export default async function MonthlyReportsPage() {
  // Resolved on the server: the browser has no trustworthy identity source, and
  // the row actions must offer only what this role is permitted to do. RLS
  // remains the enforcement; this just avoids showing doors that will not open.
  const identity = await getCurrentUserIdentity();

  return <MonthlyReportsView role={identity?.role} />;
}

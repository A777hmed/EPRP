import type { Metadata } from "next";

import { DashboardView } from "@/features/dashboard/dashboard-view";
import { getCalendarViewerContext } from "@/features/calendar/calendar-access";

export const metadata: Metadata = {
  title: "Control Center",
};

/**
 * The EPR Control Center.
 *
 * Every figure is derived from real records on load — the previous version of
 * this page rendered entirely from `@/data/mock`. `canManage` only decides
 * which Quick Actions are offered; row-level security remains the boundary for
 * everything the panels read and for anything the calendar writes.
 */
export default async function DashboardPage() {
  const { canManage } = await getCalendarViewerContext();
  return <DashboardView canManage={canManage} />;
}

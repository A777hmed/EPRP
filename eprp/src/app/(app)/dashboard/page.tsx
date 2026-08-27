import type { Metadata } from "next";
import { Suspense } from "react";

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
 *
 * `canManage` is resolved behind a Suspense boundary rather than awaited here
 * directly: it's the only identity/role lookup any page makes synchronously
 * at the page level (every other route defers that entirely to the shared
 * sidebar's already-Suspense-wrapped welcome card), so it was the one route
 * whose whole response blocked on however long that lookup took. Streaming
 * it means the page paints immediately with Quick Actions temporarily
 * unavailable, then upgrades once the real permission resolves — the check
 * itself, and what it allows, is unchanged.
 */
export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardView canManage={false} />}>
      <DashboardCanManage />
    </Suspense>
  );
}

async function DashboardCanManage() {
  const { canManage } = await getCalendarViewerContext();
  return <DashboardView canManage={canManage} />;
}

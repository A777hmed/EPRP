import type { Metadata } from "next";

import { CalendarWorkspace } from "@/features/calendar";
import { getCalendarViewerContext } from "@/features/calendar/calendar-access";

export const metadata: Metadata = {
  title: "Calendar",
};

/**
 * The full Calendar workspace.
 *
 * Reading is not gated here: row-level security on `project_events` returns
 * only events for projects the account already has scope on, so an account with
 * no assignments correctly sees an empty calendar rather than a refusal.
 * `canManage` governs only whether Add/Edit/Delete are offered — RLS enforces
 * the same rule again on every write.
 */
export default async function CalendarPage() {
  const { canManage } = await getCalendarViewerContext();
  return <CalendarWorkspace canManage={canManage} />;
}

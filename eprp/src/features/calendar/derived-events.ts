/**
 * Calendar entries that already exist somewhere else.
 *
 * Milestones and report due dates are NOT copied into `project_events`. They
 * are owned by the Weekly and Monthly tiers, and duplicating them would create
 * a second source of truth that drifts the moment somebody edits a plan item —
 * exactly the failure `03_REPORTING_ARCHITECTURE.md` Law 1 exists to prevent.
 *
 * They are instead read on demand and presented as read-only calendar entries
 * that link back to the record that owns them.
 *
 * The queries below go straight to the tables rather than through the report
 * services, because those expose plan items per report: rendering one month
 * would otherwise cost one round trip per report in the period. Row-level
 * security applies either way — a reader without scope on a project simply gets
 * none of its rows back.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { CalendarEvent, CalendarEventStatus } from "./calendar-types";

function client(): SupabaseClient {
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

const MISSING_TABLE = new Set(["42P01", "PGRST205"]);
function isMissingTable(error: { code?: string } | null): boolean {
  return Boolean(error?.code && MISSING_TABLE.has(error.code));
}

/** Plan-item status → calendar status, without inventing a state. */
function statusOf(value: string | null): CalendarEventStatus {
  if (value === "completed") return "completed";
  if (value === "delayed") return "postponed";
  return "scheduled";
}

interface WeeklyMilestoneRow {
  id: string;
  title: string;
  end_date: string;
  status: string | null;
  department_id: string | null;
  weekly_reports: { id: string; project_id: string } | null;
}

interface MonthlyMilestoneRow {
  id: string;
  title: string;
  target_date: string | null;
  status: string | null;
  department_id: string | null;
  monthly_reports: { id: string; project_id: string } | null;
}

interface WeeklyReportRow {
  id: string;
  project_id: string;
  period_end: string;
  status: string;
  report_number: string | null;
}

/**
 * Monthly reports are keyed by `reporting_month` (the FIRST of the month), not
 * by a period end — the two report tiers genuinely differ here. The due date a
 * calendar should show is the last day of that month, computed below rather
 * than stored anywhere.
 */
interface MonthlyReportRow {
  id: string;
  project_id: string;
  reporting_month: string;
  status: string;
  report_number: string | null;
}

function endOfMonth(monthStart: string): string {
  const [year, month] = monthStart.split("-").map(Number);
  // Day 0 of the NEXT month is the last day of this one.
  const last = new Date(Date.UTC(year, month, 0));
  return last.toISOString().slice(0, 10);
}

export interface DerivedContext {
  projectName: (id: string) => string;
  departmentName: (id: string | undefined) => string | undefined;
}

/**
 * Every derived calendar entry in a date window.
 *
 * Four queries, run together: Weekly milestones, Monthly milestones, and the
 * period end of each Weekly and Monthly report. A report that is already
 * approved, finalized or locked is NOT shown as due — it has been delivered,
 * and a calendar full of satisfied deadlines buries the ones that matter.
 */
export async function loadDerivedEvents(
  from: string,
  to: string,
  ctx: DerivedContext
): Promise<CalendarEvent[]> {
  const supabase = client();

  const [weeklyMilestones, monthlyMilestones, weeklyReports, monthlyReports] =
    await Promise.all([
      supabase
        .from("weekly_plan_items")
        .select("id, title, end_date, status, department_id, weekly_reports!inner(id, project_id)")
        .eq("kind", "milestone")
        .gte("end_date", from)
        .lte("end_date", to),
      supabase
        .from("monthly_plan_items")
        .select("id, title, target_date, status, department_id, monthly_reports!inner(id, project_id)")
        .not("target_date", "is", null)
        .gte("target_date", from)
        .lte("target_date", to),
      supabase
        .from("weekly_reports")
        .select("id, project_id, period_end, status, report_number")
        .eq("active", true)
        .gte("period_end", from)
        .lte("period_end", to),
      // Widened to the start of the window's own month, because a month-end due
      // date inside the window belongs to a row dated on the 1st.
      supabase
        .from("monthly_reports")
        .select("id, project_id, reporting_month, status, report_number")
        .eq("active", true)
        .gte("reporting_month", `${from.slice(0, 7)}-01`)
        .lte("reporting_month", to),
    ]);

  const events: CalendarEvent[] = [];
  const DELIVERED = new Set(["approved", "finalized", "locked", "archived"]);

  const fail = (error: { code?: string; message: string } | null) => {
    if (!error) return false;
    if (isMissingTable(error)) return true;
    throw new Error(error.message);
  };

  if (!fail(weeklyMilestones.error)) {
    for (const row of (weeklyMilestones.data ?? []) as unknown as WeeklyMilestoneRow[]) {
      const report = row.weekly_reports;
      if (!report) continue;
      events.push({
        id: `wpi-${row.id}`,
        origin: "derived",
        projectId: report.project_id,
        projectName: ctx.projectName(report.project_id),
        departmentId: row.department_id ?? undefined,
        departmentName: ctx.departmentName(row.department_id ?? undefined),
        type: "milestone",
        title: row.title,
        date: row.end_date,
        status: statusOf(row.status),
        attendees: [],
        sourceLabel: "Weekly plan milestone",
        sourceHref: `/weekly-reports/${report.id}`,
      });
    }
  }

  if (!fail(monthlyMilestones.error)) {
    for (const row of (monthlyMilestones.data ?? []) as unknown as MonthlyMilestoneRow[]) {
      const report = row.monthly_reports;
      if (!report || !row.target_date) continue;
      events.push({
        id: `mpi-${row.id}`,
        origin: "derived",
        projectId: report.project_id,
        projectName: ctx.projectName(report.project_id),
        departmentId: row.department_id ?? undefined,
        departmentName: ctx.departmentName(row.department_id ?? undefined),
        type: "milestone",
        title: row.title,
        date: row.target_date,
        status: statusOf(row.status),
        attendees: [],
        sourceLabel: "Monthly plan milestone",
        sourceHref: `/monthly-reports/${report.id}`,
      });
    }
  }

  const addDue = (
    row: { id: string; project_id: string; status: string; report_number: string | null },
    date: string,
    kind: "Weekly" | "Monthly",
    hrefBase: string,
    prefix: string
  ) => {
    // A delivered report is not a deadline. Showing satisfied due dates buries
    // the ones that still need action.
    if (DELIVERED.has(row.status)) return;
    if (date < from || date > to) return;
    events.push({
      id: `${prefix}-${row.id}`,
      origin: "derived",
      projectId: row.project_id,
      projectName: ctx.projectName(row.project_id),
      type: "report_due",
      title: `${kind} Report due${row.report_number ? ` · ${row.report_number}` : ""}`,
      date,
      status: "scheduled",
      attendees: [],
      sourceLabel: `${kind} Report`,
      sourceHref: `${hrefBase}/${row.id}`,
    });
  };

  if (!fail(weeklyReports.error)) {
    for (const row of (weeklyReports.data ?? []) as WeeklyReportRow[]) {
      addDue(row, row.period_end, "Weekly", "/weekly-reports", "wr");
    }
  }
  if (!fail(monthlyReports.error)) {
    for (const row of (monthlyReports.data ?? []) as MonthlyReportRow[]) {
      addDue(row, endOfMonth(row.reporting_month), "Monthly", "/monthly-reports", "mr");
    }
  }

  return events;
}

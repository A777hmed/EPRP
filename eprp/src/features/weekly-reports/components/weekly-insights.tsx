"use client";

import { AlertTriangle, CalendarClock, History, Inbox } from "lucide-react";

import { SectionCard, StatusBadge, type StatusTone } from "@/components/shared";
import { ENTRY_STATUS_META, REPORT_STATUS_META } from "@/lib/constants";
import { formatDate } from "@/lib/formatters";
import type { WeeklyEntry, WeeklyPlanItem, WeeklyReport } from "@/types";
import { isWeeklyComment, WEEKLY_UPDATE_TYPE_META } from "../weekly-update";
import type { WeeklyWorkspace } from "../workspace";
import type { WeeklyNameLookup } from "./weekly-department-section";

export interface PreviousWeeklyData {
  report: WeeklyReport;
  workspace: WeeklyWorkspace | null;
  entries: WeeklyEntry[];
  planItems: WeeklyPlanItem[];
}

interface AlertItem {
  key: string;
  label: string;
  detail: string;
  tone: StatusTone;
}

const closed = new Set(["resolved", "closed"]);
const completedPlan = (item: WeeklyPlanItem) => item.status === "completed";

export function reachableWeeklyUpdates(workspace: WeeklyWorkspace): WeeklyEntry[] {
  const updates = workspace.departments.flatMap((department) =>
    department.scopeItems.flatMap((item) => item.entries)
  );
  if (workspace.projectLevelItems.length > 0) {
    updates.push(...workspace.projectLevelItems.filter(isWeeklyComment));
  }
  return [...new Map(updates.map((entry) => [entry.id, entry])).values()];
}

export function deriveWeeklyAlerts(
  report: WeeklyReport,
  workspace: WeeklyWorkspace,
  planItems: WeeklyPlanItem[],
  previous: PreviousWeeklyData | null,
  names: WeeklyNameLookup
): AlertItem[] {
  const alerts: AlertItem[] = [];
  const entries = reachableWeeklyUpdates(workspace);
  const periodStart = report.periodStart;
  const periodEnd = report.periodEnd;

  const overdue = entries.filter(
    (entry) => entry.dueDate && entry.dueDate < periodStart && !closed.has(entry.status)
  );
  if (overdue.length) {
    alerts.push({ key: "overdue", label: "Overdue", detail: `${overdue.length} Weekly update${overdue.length === 1 ? " is" : "s are"} overdue.`, tone: "danger" });
  }

  const dueThisWeek = entries.filter(
    (entry) => entry.dueDate && entry.dueDate >= periodStart && entry.dueDate <= periodEnd && !closed.has(entry.status)
  );
  if (dueThisWeek.length) {
    alerts.push({ key: "due", label: "Due this week", detail: `${dueThisWeek.length} open update${dueThisWeek.length === 1 ? " reaches" : "s reach"} a target date this week.`, tone: "warning" });
  }

  if (workspace.awaitingInput.length) {
    const labels = workspace.awaitingInput.map((id) => names.department(id)?.name ?? "Department");
    alerts.push({ key: "missing", label: "Missing submissions", detail: labels.join(", "), tone: "warning" });
  }

  const emptyScopes = workspace.departments.reduce(
    (count, department) => count + department.scopeItems.filter((item) => !item.reported && item.entries.length === 0 && !item.detached).length,
    0
  );
  if (emptyScopes) {
    alerts.push({ key: "empty", label: "Assigned scope without update", detail: `${emptyScopes} assigned scope item${emptyScopes === 1 ? " has" : "s have"} no Weekly input.`, tone: "warning" });
  }

  const delayed = planItems.filter((item) => item.status === "delayed");
  if (delayed.length) {
    alerts.push({ key: "delayed", label: "Delayed milestones", detail: delayed.map((item) => item.title).join(", "), tone: "danger" });
  }

  const carried = previous?.entries.filter(
    (entry) => !closed.has(entry.status) && (entry.entryType === "action" || entry.updateType === "action_required")
  ) ?? [];
  if (carried.length) {
    alerts.push({ key: "carried", label: "Previous week still open", detail: `${carried.length} action${carried.length === 1 ? " remains" : "s remain"} open.`, tone: "info" });
  }

  return alerts;
}

export function WeeklyAlerts({ report, workspace, planItems, previous, names }: {
  report: WeeklyReport;
  workspace: WeeklyWorkspace;
  planItems: WeeklyPlanItem[];
  previous: PreviousWeeklyData | null;
  names: WeeklyNameLookup;
}) {
  const alerts = deriveWeeklyAlerts(report, workspace, planItems, previous, names);
  return (
    <SectionCard title="Attention / Weekly Alerts" description="Automatically derived from Weekly scope, target dates, submissions, and Project Control plans.">
      {alerts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Weekly attention items were derived for this reporting period.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {alerts.map((alert) => (
            <div key={alert.key} className="rounded-lg border bg-background p-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
                <StatusBadge tone={alert.tone}>{alert.label}</StatusBadge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{alert.detail}</p>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

export function PreviousWeekSnapshot({ previous, names }: {
  previous: PreviousWeeklyData | null;
  names: WeeklyNameLookup;
}) {
  if (!previous) {
    return (
      <SectionCard title="Previous Week Snapshot" description="Continuity from the immediately previous Weekly Report for this project.">
        <p className="text-sm text-muted-foreground">No previous Weekly Report is available for this project.</p>
      </SectionCard>
    );
  }

  const openActions = previous.entries.filter(
    (entry) => !closed.has(entry.status) && (entry.entryType === "action" || entry.updateType === "action_required")
  );
  const planned = previous.planItems.filter((item) => item.kind === "next_week");
  const incomplete = previous.planItems.filter(
    (item) => !completedPlan(item) && item.endDate <= previous.report.periodEnd
  );
  const important = previous.entries.filter(
    (entry) => !closed.has(entry.status) && ["risk", "issue", "delay_constraint"].includes(entry.updateType)
  );

  return (
    <SectionCard title="Previous Week Snapshot" description={`${previous.report.reportNumber} · Week ${previous.report.weekNumber}`}>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-lg border bg-background p-3">
          <p className="text-xs text-muted-foreground">Previous Weekly Progress Status</p>
          <StatusBadge tone={REPORT_STATUS_META[previous.report.status].tone}>{REPORT_STATUS_META[previous.report.status].label}</StatusBadge>
          <p className="mt-2 text-sm whitespace-pre-wrap">{previous.report.summary || "No executive summary was recorded."}</p>
        </div>
        <SnapshotList icon={History} title="Open actions carried forward" rows={openActions.map((entry) => entry.description)} />
        <SnapshotList icon={CalendarClock} title="Last week’s planned items" rows={planned.map((item) => `${item.title} · ${formatDate(item.endDate)}`)} />
        <SnapshotList icon={AlertTriangle} title="Expected complete, still open" rows={incomplete.map((item) => item.title)} />
        <SnapshotList icon={Inbox} title="Important comments carried forward" rows={important.map((entry) => `${names.department(entry.departmentId)?.name ?? "Project"}: ${entry.description}`)} />
      </div>
    </SectionCard>
  );
}

function SnapshotList({ icon: Icon, title, rows }: { icon: typeof History; title: string; rows: string[] }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="flex items-center gap-2 text-xs font-semibold"><Icon className="size-4 text-primary" aria-hidden="true" />{title}</p>
      {rows.length ? (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">{rows.slice(0, 5).map((row, index) => <li key={`${row}-${index}`}>• {row}</li>)}</ul>
      ) : <p className="mt-2 text-xs text-muted-foreground">None.</p>}
    </div>
  );
}

export function MonthlyReportTray({ workspace, names, weekNumber }: {
  workspace: WeeklyWorkspace;
  names: WeeklyNameLookup;
  weekNumber: number;
}) {
  const flagged = reachableWeeklyUpdates(workspace).filter((entry) => entry.includeInMonthly);
  return (
    <SectionCard title="Monthly Report Tray" description="Weekly updates flagged for later Monthly compilation. This view does not write to Monthly Reports.">
      {flagged.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Weekly updates are flagged for Monthly.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-xs">
            <thead><tr className="border-b text-muted-foreground"><th className="py-2 pr-3">Department</th><th className="py-2 pr-3">System</th><th className="py-2 pr-3">{workspace.scopeItemLabel}</th><th className="py-2 pr-3">Update Type</th><th className="py-2 pr-3">Comment</th><th className="py-2 pr-3">Author</th><th className="py-2">Week</th></tr></thead>
            <tbody>{flagged.map((entry) => (
              <tr key={entry.id} className="border-b align-top last:border-0">
                <td className="py-2 pr-3">{names.department(entry.departmentId)?.name ?? "Project"}</td>
                <td className="py-2 pr-3">{names.system(entry.systemId)?.name ?? "—"}</td>
                <td className="py-2 pr-3">{names.scopeItem(entry.disciplineId)?.name ?? "—"}</td>
                <td className="py-2 pr-3"><StatusBadge tone={ENTRY_STATUS_META[entry.status].tone}>{WEEKLY_UPDATE_TYPE_META[entry.updateType].label}</StatusBadge></td>
                <td className="max-w-md py-2 pr-3 whitespace-pre-wrap">{entry.description}</td>
                <td className="py-2 pr-3">{names.person(entry.createdByContactId)?.name ?? "Legacy / not recorded"}</td>
                <td className="py-2 tabular-nums">Week {weekNumber}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

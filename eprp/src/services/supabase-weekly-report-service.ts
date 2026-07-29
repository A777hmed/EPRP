import type { SupabaseClient } from "@supabase/supabase-js";
import { format } from "date-fns";

import type {
  ReportStatus,
  WeeklyActivity,
  WeeklyEntry,
  WeeklyReport,
  WeeklySubmission,
} from "@/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  WeeklyActivityRow,
  WeeklyEntryRow,
  WeeklyReportRow,
  WeeklySubmissionRow,
} from "@/lib/supabase/database.types";
import {
  formatReportNumber,
  getReportingWeekRange,
  getReportingYear,
  getWeekNumber,
} from "@/lib/reporting";
import { canTransition } from "@/config/workflows";
import { projectService } from "./project-service";
import type {
  WeeklyReportCreateInput,
  WeeklyReportService,
  WeeklyReportUpdateInput,
} from "./weekly-report-service";

/**
 * Supabase-backed weekly-report service (Phase 6A). Activated only when
 * Supabase is configured; the mock service is used otherwise. Maps the
 * `weekly_reports` + `weekly_submissions` tables to the domain model.
 */

function client(): SupabaseClient {
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

function toIsoDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function rowToSubmission(row: WeeklySubmissionRow): WeeklySubmission {
  return {
    id: row.id,
    weeklyReportId: row.weekly_report_id,
    departmentId: row.department_id,
    disciplineId: row.discipline_id ?? undefined,
    status: row.status as WeeklySubmission["status"],
    progressDelta: row.progress_delta ?? undefined,
    progressPercent: row.progress_percent ?? undefined,
    summary: row.summary ?? undefined,
    keyAchievement: row.key_achievement ?? undefined,
    delayConstraint: row.delay_constraint ?? undefined,
    nextWeekPlan: row.next_week_plan ?? undefined,
    responsibleContactId: row.responsible_contact_id ?? undefined,
    healthStatus:
      (row.health_status as WeeklySubmission["healthStatus"]) ?? undefined,
    risksIssues: row.risks_issues ?? undefined,
    returnReason: row.return_reason ?? undefined,
    reviewedByContactId: row.reviewed_by_contact_id ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    targetDate: row.target_date ?? undefined,
    accomplishments: row.accomplishments ?? [],
    plannedNextWeek: row.planned_next_week ?? [],
    blockers: row.blockers ?? [],
    submittedByContactId: row.submitted_by_contact_id ?? undefined,
    submittedAt: row.submitted_at ?? undefined,
  };
}

function rowToEntry(row: WeeklyEntryRow): WeeklyEntry {
  return {
    id: row.id,
    weeklyReportId: row.weekly_report_id,
    entryType: row.entry_type as WeeklyEntry["entryType"],
    category: row.category as WeeklyEntry["category"],
    description: row.description,
    priority: row.priority as WeeklyEntry["priority"],
    status: row.status as WeeklyEntry["status"],
    ownerContactId: row.owner_contact_id ?? undefined,
    dueDate: row.due_date ?? undefined,
    departmentId: row.department_id ?? undefined,
    systemId: row.system_id ?? undefined,
    disciplineId: row.discipline_id ?? undefined,
    includeInMonthly: row.include_in_monthly,
    createdAt: row.created_at,
  };
}

function rowToActivity(row: WeeklyActivityRow): WeeklyActivity {
  return {
    id: row.id,
    weeklyReportId: row.weekly_report_id,
    title: row.title,
    departmentId: row.department_id ?? undefined,
    disciplineId: row.discipline_id ?? undefined,
    ownerContactId: row.owner_contact_id ?? undefined,
    status: row.status as WeeklyActivity["status"],
    progressPercent: row.progress_percent ?? undefined,
    remarks: row.remarks ?? undefined,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToReport(
  row: WeeklyReportRow,
  submissionIds: string[],
  entryIds: string[],
  activityIds: string[] = []
): WeeklyReport {
  return {
    id: row.id,
    reportNumber: row.report_number,
    projectId: row.project_id,
    status: row.status as ReportStatus,
    source: row.source as WeeklyReport["source"],
    weekNumber: row.week_number,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    plannedProgress: row.planned_progress,
    actualProgress: row.actual_progress,
    preparedByContactId: row.prepared_by_contact_id ?? undefined,
    reviewedByContactId: row.reviewed_by_contact_id ?? undefined,
    approvedByContactId: row.approved_by_contact_id ?? undefined,
    disciplineIds: row.discipline_ids,
    manHoursToDate: row.man_hours_to_date ?? undefined,
    hseStatus: (row.hse_status as WeeklyReport["hseStatus"]) ?? undefined,
    qualityStatus:
      (row.quality_status as WeeklyReport["qualityStatus"]) ?? undefined,
    overallProgressStatus:
      (row.overall_progress_status as WeeklyReport["overallProgressStatus"]) ??
      undefined,
    submissionIds,
    entryIds,
    activityIds,
    attachmentIds: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Collect child-row ids per report, so a list view needs one query per table. */
async function childIdsByReport(
  table: "weekly_submissions" | "weekly_entries" | "weekly_activities",
  reportIds: string[]
): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>();
  if (reportIds.length === 0) return grouped;
  const { data, error } = await client()
    .from(table)
    .select("id, weekly_report_id")
    .in("weekly_report_id", reportIds);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as {
    id: string;
    weekly_report_id: string;
  }[]) {
    const list = grouped.get(row.weekly_report_id) ?? [];
    list.push(row.id);
    grouped.set(row.weekly_report_id, list);
  }
  return grouped;
}

export const supabaseWeeklyReportService: WeeklyReportService = {
  async list() {
    const { data, error } = await client()
      .from("weekly_reports")
      .select("*")
      .order("period_start", { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as WeeklyReportRow[];
    const ids = rows.map((r) => r.id);
    const [subs, entries, acts] = await Promise.all([
      childIdsByReport("weekly_submissions", ids),
      childIdsByReport("weekly_entries", ids),
      childIdsByReport("weekly_activities", ids),
    ]);
    return rows.map((row) =>
      rowToReport(
        row,
        subs.get(row.id) ?? [],
        entries.get(row.id) ?? [],
        acts.get(row.id) ?? []
      )
    );
  },

  async getById(id) {
    const { data, error } = await client()
      .from("weekly_reports")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const row = data as WeeklyReportRow;
    const [subs, entries, acts] = await Promise.all([
      childIdsByReport("weekly_submissions", [row.id]),
      childIdsByReport("weekly_entries", [row.id]),
      childIdsByReport("weekly_activities", [row.id]),
    ]);
    return rowToReport(
      row,
      subs.get(row.id) ?? [],
      entries.get(row.id) ?? [],
      acts.get(row.id) ?? []
    );
  },

  async create(input: WeeklyReportCreateInput) {
    const project = await projectService.getProjectById(input.projectId);
    if (!project) throw new Error("Selected project not found");
    const { start, end, anchor } = getReportingWeekRange(input.periodStart);
    // Week numbering uses the Monday anchor — see getReportingWeekRange.
    const weekNumber = getWeekNumber(anchor);
    const year = getReportingYear(anchor);

    const { data, error } = await client()
      .from("weekly_reports")
      .insert({
        report_number: formatReportNumber(
          "weekly",
          project.code,
          year,
          weekNumber
        ),
        project_id: project.id,
        status: "draft",
        source: "platform",
        week_number: weekNumber,
        period_start: toIsoDate(start),
        period_end: toIsoDate(end),
        planned_progress: input.plannedProgress ?? project.plannedProgress,
        actual_progress: input.actualProgress ?? project.actualProgress,
        prepared_by_contact_id:
          input.preparedByContactId ?? project.reportingCoordinatorId ?? null,
        discipline_ids: input.disciplineIds,
        man_hours_to_date: input.manHoursToDate ?? null,
        hse_status: input.hseStatus ?? null,
        quality_status: input.qualityStatus ?? null,
        overall_progress_status: input.overallProgressStatus ?? null,
        summary: input.summary || null,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const row = data as WeeklyReportRow;

    const reportingDepts = project.departments.filter(
      (d) => d.reportingRequired
    );
    const depts =
      reportingDepts.length > 0 ? reportingDepts : project.departments;
    if (depts.length > 0) {
      const { error: subError } = await client()
        .from("weekly_submissions")
        .insert(
          depts.map((d) => ({
            weekly_report_id: row.id,
            department_id: d.departmentId,
            status: "pending",
            accomplishments: [],
            planned_next_week: [],
            blockers: [],
          }))
        );
      if (subError) throw new Error(subError.message);
    }

    const created = await supabaseWeeklyReportService.getById(row.id);
    if (!created) throw new Error("Report created but could not be read back.");
    return created;
  },

  async update(id, input: WeeklyReportUpdateInput) {
    const patch: Record<string, unknown> = {};
    if (input.periodStart) {
      const { start, end, anchor } = getReportingWeekRange(input.periodStart);
      patch.period_start = toIsoDate(start);
      patch.period_end = toIsoDate(end);
      patch.week_number = getWeekNumber(anchor);
      const current = await supabaseWeeklyReportService.getById(id);
      if (!current) throw new Error(`Weekly report ${id} not found`);
      const project = await projectService.getProjectById(current.projectId);
      if (!project) throw new Error("Report project not found");
      patch.report_number = formatReportNumber(
        "weekly",
        project.code,
        getReportingYear(anchor),
        getWeekNumber(anchor)
      );
    }
    if (input.preparedByContactId !== undefined)
      patch.prepared_by_contact_id = input.preparedByContactId || null;
    if (input.reviewedByContactId !== undefined)
      patch.reviewed_by_contact_id = input.reviewedByContactId || null;
    if (input.approvedByContactId !== undefined)
      patch.approved_by_contact_id = input.approvedByContactId || null;
    if (input.plannedProgress !== undefined)
      patch.planned_progress = input.plannedProgress;
    if (input.actualProgress !== undefined)
      patch.actual_progress = input.actualProgress;
    if (input.disciplineIds !== undefined)
      patch.discipline_ids = input.disciplineIds;
    if (input.manHoursToDate !== undefined)
      patch.man_hours_to_date = input.manHoursToDate;
    if (input.hseStatus !== undefined) patch.hse_status = input.hseStatus;
    if (input.qualityStatus !== undefined)
      patch.quality_status = input.qualityStatus;
    if (input.overallProgressStatus !== undefined)
      patch.overall_progress_status = input.overallProgressStatus;
    // Empty string clears the narrative, matching the position editor rule.
    if (input.summary !== undefined) patch.summary = input.summary || null;

    const { error } = await client()
      .from("weekly_reports")
      .update(patch)
      .eq("id", id);
    if (error) throw new Error(error.message);
    const updated = await supabaseWeeklyReportService.getById(id);
    if (!updated) throw new Error(`Weekly report ${id} not found`);
    return updated;
  },

  async duplicate(id) {
    const source = await supabaseWeeklyReportService.getById(id);
    if (!source) throw new Error(`Weekly report ${id} not found`);
    const { data, error } = await client()
      .from("weekly_reports")
      .insert({
        report_number: `${source.reportNumber}-COPY`,
        project_id: source.projectId,
        status: "draft",
        source: source.source,
        week_number: source.weekNumber,
        period_start: source.periodStart,
        period_end: source.periodEnd,
        planned_progress: source.plannedProgress,
        actual_progress: source.actualProgress,
        prepared_by_contact_id: source.preparedByContactId ?? null,
        discipline_ids: source.disciplineIds,
        man_hours_to_date: source.manHoursToDate ?? null,
        hse_status: source.hseStatus ?? null,
        quality_status: source.qualityStatus ?? null,
        overall_progress_status: source.overallProgressStatus ?? null,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const row = data as WeeklyReportRow;

    const submissions = await supabaseWeeklyReportService.listSubmissions(id);
    if (submissions.length > 0) {
      await client()
        .from("weekly_submissions")
        .insert(
          submissions.map((s) => ({
            weekly_report_id: row.id,
            department_id: s.departmentId,
            status: "pending",
            accomplishments: [],
            planned_next_week: [],
            blockers: [],
          }))
        );
    }
    const created = await supabaseWeeklyReportService.getById(row.id);
    if (!created) throw new Error("Report created but could not be read back.");
    return created;
  },

  async archive(id) {
    const { error } = await client()
      .from("weekly_reports")
      .update({
        status: "archived",
        active: false,
        archived_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw new Error(error.message);
    const archived = await supabaseWeeklyReportService.getById(id);
    if (!archived) throw new Error(`Weekly report ${id} not found`);
    return archived;
  },

  async changeStatus(id, to: ReportStatus) {
    const current = await supabaseWeeklyReportService.getById(id);
    if (!current) throw new Error(`Weekly report ${id} not found`);
    if (to !== "archived" && !canTransition("weekly", current.status, to)) {
      throw new Error(
        `Cannot move a weekly report from ${current.status} to ${to}.`
      );
    }
    const { error } = await client()
      .from("weekly_reports")
      .update({ status: to })
      .eq("id", id);
    if (error) throw new Error(error.message);
    const updated = await supabaseWeeklyReportService.getById(id);
    if (!updated) throw new Error(`Weekly report ${id} not found`);
    return updated;
  },

  async listSubmissions(reportId) {
    const { data, error } = await client()
      .from("weekly_submissions")
      .select("*")
      .eq("weekly_report_id", reportId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as WeeklySubmissionRow[]).map(rowToSubmission);
  },

  async saveSubmissions(reportId, updates) {
    const sb = client();
    // Remove rows the user deleted, then insert the submitted set.
    const { error: deleteError } = await sb
      .from("weekly_submissions")
      .delete()
      .eq("weekly_report_id", reportId);
    if (deleteError) throw new Error(deleteError.message);

    if (updates.length === 0) return [];

    const { data, error } = await sb
      .from("weekly_submissions")
      .insert(
        updates.map((update) => ({
          weekly_report_id: reportId,
          department_id: update.departmentId,
          discipline_id: update.disciplineId ?? null,
          status: update.status,
          progress_percent: update.progressPercent ?? null,
          summary: update.summary ?? null,
          key_achievement: update.keyAchievement ?? null,
          delay_constraint: update.delayConstraint ?? null,
          next_week_plan: update.nextWeekPlan ?? null,
          responsible_contact_id: update.responsibleContactId ?? null,
          target_date: update.targetDate ?? null,
          health_status: update.healthStatus ?? null,
          risks_issues: update.risksIssues || null,
          accomplishments: [],
          planned_next_week: [],
          blockers: [],
        }))
      )
      .select("*");
    if (error) throw new Error(error.message);
    return ((data ?? []) as WeeklySubmissionRow[]).map(rowToSubmission);
  },

  async listActivities(reportId) {
    const { data, error } = await client()
      .from("weekly_activities")
      .select("*")
      .eq("weekly_report_id", reportId)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as WeeklyActivityRow[]).map(rowToActivity);
  },

  async saveActivities(reportId, activities) {
    const sb = client();
    // Rows absent from the payload were removed by the user.
    const { error: deleteError } = await sb
      .from("weekly_activities")
      .delete()
      .eq("weekly_report_id", reportId);
    if (deleteError) throw new Error(deleteError.message);

    if (activities.length === 0) return [];

    const { data, error } = await sb
      .from("weekly_activities")
      .insert(
        activities.map((activity, index) => ({
          weekly_report_id: reportId,
          title: activity.title,
          department_id: activity.departmentId || null,
          discipline_id: activity.disciplineId || null,
          owner_contact_id: activity.ownerContactId || null,
          status: activity.status,
          progress_percent:
            activity.progressPercent === undefined ||
            Number.isNaN(activity.progressPercent)
              ? null
              : activity.progressPercent,
          remarks: activity.remarks || null,
          // Array order is the authoring order.
          sort_order: index,
        }))
      )
      .select("*");
    if (error) throw new Error(error.message);
    return ((data ?? []) as WeeklyActivityRow[])
      .map(rowToActivity)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },

  async listEntries(reportId) {
    const { data, error } = await client()
      .from("weekly_entries")
      .select("*")
      .eq("weekly_report_id", reportId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as WeeklyEntryRow[]).map(rowToEntry);
  },

  async saveEntries(reportId, entries) {
    const sb = client();
    // Rows absent from the payload were removed by the user.
    const { error: deleteError } = await sb
      .from("weekly_entries")
      .delete()
      .eq("weekly_report_id", reportId);
    if (deleteError) throw new Error(deleteError.message);

    if (entries.length === 0) return [];

    const { data, error } = await sb
      .from("weekly_entries")
      .insert(
        entries.map((entry) => ({
          weekly_report_id: reportId,
          entry_type: entry.entryType,
          category: entry.category,
          description: entry.description,
          priority: entry.priority,
          status: entry.status,
          owner_contact_id: entry.ownerContactId ?? null,
          due_date: entry.dueDate ?? null,
          department_id: entry.departmentId ?? null,
          system_id: entry.systemId ?? null,
          discipline_id: entry.disciplineId ?? null,
          include_in_monthly: entry.includeInMonthly,
        }))
      )
      .select("*");
    if (error) throw new Error(error.message);
    return ((data ?? []) as WeeklyEntryRow[]).map(rowToEntry);
  },
};

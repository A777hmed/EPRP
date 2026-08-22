import type { SupabaseClient } from "@supabase/supabase-js";
import { format } from "date-fns";

import type {
  ReportStatus,
  WeeklyActivity,
  WeeklyEntry,
  WeeklyPlanItem,
  WeeklyReport,
  WeeklySubmission,
} from "@/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  parseSignatorySnapshot,
  serializeSignatorySnapshot,
} from "@/lib/report-signatories";
import type {
  WeeklyActivityRow,
  WeeklyEntryRow,
  WeeklyPlanItemRow,
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
import {
  checkWeeklyTransition,
  contentFrozenReason,
} from "@/features/weekly-reports/lifecycle-guards";
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

/**
 * Refuse to write a report whose content is frozen.
 *
 * Read from the database rather than trusted from the caller: a client holding
 * a stale copy of the report may believe it is still open long after it was
 * finalized. Shared by every in-place write so one rule covers them all.
 */
async function assertContentEditable(
  sb: SupabaseClient,
  reportId: string
): Promise<void> {
  const { data, error } = await sb
    .from("weekly_reports")
    .select("status")
    .eq("id", reportId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Weekly report ${reportId} not found`);

  const frozen = contentFrozenReason(
    (data as { status: string }).status as ReportStatus
  );
  if (frozen) throw new Error(frozen);
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
    sentAt: row.sent_at ?? undefined,
    dueAt: row.due_at ?? undefined,
  };
}

function rowToEntry(row: WeeklyEntryRow): WeeklyEntry {
  return {
    id: row.id,
    weeklyReportId: row.weekly_report_id,
    entryType: row.entry_type as WeeklyEntry["entryType"],
    updateType: row.update_type as WeeklyEntry["updateType"],
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
    createdByContactId: row.created_by_contact_id ?? undefined,
    updatedByContactId: row.updated_by_contact_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToPlanItem(row: WeeklyPlanItemRow): WeeklyPlanItem {
  return {
    id: row.id,
    weeklyReportId: row.weekly_report_id,
    kind: row.kind as WeeklyPlanItem["kind"],
    title: row.title,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date,
    ownerContactId: row.owner_contact_id ?? undefined,
    departmentId: row.department_id ?? undefined,
    status: row.status as WeeklyPlanItem["status"],
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    // Defensive parse: the column is JSON, so its shape is not guaranteed by
    // the type system. A malformed block is dropped rather than allowed to
    // throw and take the whole report down with it.
    signatories: parseSignatorySnapshot(row.signatories),
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
    if (input.signatories !== undefined)
      patch.signatories = serializeSignatorySnapshot(input.signatories);
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
    /*
     * Routed through the same controlled function as every other transition:
     * the status guard refuses a direct write, and the function sets `active`
     * and `archived_at` alongside the status so the three cannot drift apart.
     */
    const { error } = await client().rpc("set_weekly_report_status", {
      p_report: id,
      p_to: "archived",
    });
    if (error) throw new Error(error.message);
    const archived = await supabaseWeeklyReportService.getById(id);
    if (!archived) throw new Error(`Weekly report ${id} not found`);
    return archived;
  },

  async changeStatus(id, to: ReportStatus) {
    const current = await supabaseWeeklyReportService.getById(id);
    if (!current) throw new Error(`Weekly report ${id} not found`);

    /*
     * These two checks are PRE-FLIGHT only, kept so the UI can refuse early and
     * list every unmet condition rather than surfacing one database error.
     *
     * They are no longer the boundary. P0.3 moved enforcement into
     * `set_weekly_report_status()`, which re-proves authority, transition shape
     * and stage conditions in the database, and a BEFORE UPDATE trigger refuses
     * any status write that does not come through it. Deleting these would lose
     * the good error message; trusting them would lose the boundary.
     */
    if (to !== "archived" && !canTransition("weekly", current.status, to)) {
      throw new Error(
        `Cannot move a weekly report from ${current.status} to ${to}.`
      );
    }
    if (to !== "archived") {
      const submissions = await supabaseWeeklyReportService.listSubmissions(id);
      const guard = checkWeeklyTransition(to, {
        report: current,
        submissions,
      });
      if (!guard.allowed) {
        throw new Error(
          `Cannot move this weekly report to ${to}:\n• ${guard.reasons.join("\n• ")}`
        );
      }
    }

    const { error } = await client().rpc("set_weekly_report_status", {
      p_report: id,
      p_to: to,
    });
    if (error) throw new Error(error.message);
    const updated = await supabaseWeeklyReportService.getById(id);
    if (!updated) throw new Error(`Weekly report ${id} not found`);
    return updated;
  },

  async startCollection(reportId, departmentIds, dueAt) {
    if (departmentIds.length === 0) {
      return supabaseWeeklyReportService.listSubmissions(reportId);
    }
    /*
     * Only sent_at and due_at are written. Status is deliberately untouched:
     * distributing a Weekly does not mean the department has begun it, and
     * overwriting an in-progress or submitted row here would silently undo
     * work. Re-sending simply re-stamps the timing.
     */
    const { error } = await client()
      .from("weekly_submissions")
      .update({ sent_at: new Date().toISOString(), due_at: dueAt })
      .eq("weekly_report_id", reportId)
      .in("department_id", departmentIds);
    if (error) throw new Error(error.message);
    return supabaseWeeklyReportService.listSubmissions(reportId);
  },

  async setDepartmentScope(reportId, departmentIds) {
    const existing = await supabaseWeeklyReportService.listSubmissions(reportId);
    const wanted = new Set(departmentIds);
    const held = new Set(existing.map((s) => s.departmentId));

    const toAdd = departmentIds.filter((id) => !held.has(id));
    if (toAdd.length > 0) {
      const { error } = await client()
        .from("weekly_submissions")
        .insert(
          toAdd.map((departmentId) => ({
            weekly_report_id: reportId,
            department_id: departmentId,
            status: "pending",
            accomplishments: [],
            planned_next_week: [],
            blockers: [],
          }))
        );
      if (error) throw new Error(error.message);
    }

    /*
     * Removal never destroys work. A row is dropped only while it is untouched:
     * still pending, never submitted, and carrying no written input. Anything
     * else is refused and reported back by department id.
     */
    const refusedDepartmentIds: string[] = [];
    const removable: string[] = [];
    for (const submission of existing) {
      if (wanted.has(submission.departmentId)) continue;
      const untouched =
        submission.status === "pending" &&
        !submission.submittedAt &&
        !submission.summary &&
        !submission.keyAchievement &&
        !submission.nextWeekPlan &&
        submission.progressPercent === undefined &&
        submission.accomplishments.length === 0 &&
        submission.plannedNextWeek.length === 0 &&
        submission.blockers.length === 0;
      if (untouched) removable.push(submission.id);
      else refusedDepartmentIds.push(submission.departmentId);
    }

    if (removable.length > 0) {
      const { error } = await client()
        .from("weekly_submissions")
        .delete()
        .in("id", removable);
      if (error) throw new Error(error.message);
    }

    return {
      submissions: await supabaseWeeklyReportService.listSubmissions(reportId),
      refusedDepartmentIds,
    };
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

  async saveDepartmentUpdate(reportId, input) {
    const sb = client();
    await assertContentEditable(sb, reportId);

    /*
     * The row this save is aimed at is identified by the triple (report,
     * department, scope item) — exactly the key the
     * `weekly_submissions_report_department_discipline_unique` index enforces,
     * so it matches at most one row. A NULL `discipline_id` is the stored
     * meaning of "department-level", not a missing value, which is why the
     * general update is matched with `is(…, null)` and can never be confused
     * with a scope item's own row.
     */
    const scopeItemId = input.disciplineId ?? null;

    /*
     * Look the row up before writing. Matching on the key — not only on the id
     * the client happens to hold — is what makes a repeated save idempotent: a
     * client that saved before it had read the row back would otherwise insert
     * a second update for the same scope. Oldest first, so the match is
     * deterministic if historical data already holds more than one.
     */
    const lookup = sb
      .from("weekly_submissions")
      .select("id")
      .eq("weekly_report_id", reportId)
      .eq("department_id", input.departmentId);

    const { data: existingData, error: existingError } = await (scopeItemId
      ? lookup.eq("discipline_id", scopeItemId)
      : lookup.is("discipline_id", null)
    )
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    const existingId = (existingData as { id: string } | null)?.id ?? input.id;

    const fields = {
      status: input.status,
      progress_percent: input.progressPercent ?? null,
      summary: input.summary || null,
      key_achievement: input.keyAchievement || null,
      delay_constraint: input.delayConstraint || null,
      next_week_plan: input.nextWeekPlan || null,
      responsible_contact_id: input.responsibleContactId || null,
      target_date: input.targetDate || null,
      /*
       * Included ONLY when the caller supplies one. The workspace does not
       * edit this field, so sending `null` for it cleared any verdict recorded
       * earlier — a save wiping a column its own form never showed. Omitting
       * the key leaves the stored value untouched.
       */
      ...(input.healthStatus !== undefined
        ? { health_status: input.healthStatus }
        : {}),
    };

    /*
     * The update carries the full scope predicate as well as the id, so a
     * stale or borrowed id cannot steer the write onto another report,
     * department, or scope item — it simply matches nothing. RLS is still the
     * boundary: an update the viewer may not perform also matches no row,
     * which is why a missing result below is reported as refused rather than
     * assumed to be a success.
     */
    const target = existingId
      ? sb
          .from("weekly_submissions")
          .update(fields)
          .eq("id", existingId)
          .eq("weekly_report_id", reportId)
          .eq("department_id", input.departmentId)
      : null;

    const { data, error } = target
      ? await (scopeItemId
          ? target.eq("discipline_id", scopeItemId)
          : target.is("discipline_id", null)
        )
          .select("*")
          .maybeSingle()
      : await sb
          .from("weekly_submissions")
          .insert({
            ...fields,
            weekly_report_id: reportId,
            department_id: input.departmentId,
            discipline_id: scopeItemId,
            accomplishments: [],
            planned_next_week: [],
            blockers: [],
          })
          .select("*")
          .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      throw new Error(
        "This update was not saved. You may not have permission to change this department's input."
      );
    }
    return rowToSubmission(data as WeeklySubmissionRow);
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
          update_type: entry.updateType ?? "general",
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
          created_by_contact_id: null,
          updated_by_contact_id: null,
        }))
      )
      .select("*");
    if (error) throw new Error(error.message);
    return ((data ?? []) as WeeklyEntryRow[]).map(rowToEntry);
  },

  async saveEntry(reportId, input) {
    const sb = client();
    await assertContentEditable(sb, reportId);

    const fields = {
      entry_type: input.entryType,
      update_type: input.updateType ?? "general",
      category: input.category,
      description: input.description,
      priority: input.priority,
      status: input.status,
      owner_contact_id: input.ownerContactId ?? null,
      due_date: input.dueDate ?? null,
      department_id: input.departmentId ?? null,
      system_id: input.systemId ?? null,
      discipline_id: input.disciplineId ?? null,
      include_in_monthly: input.includeInMonthly,
    };

    /*
     * Updates are pinned to this report as well as to the id, so an id from
     * another report matches nothing instead of being edited into this one.
     * RLS decides whether the row may be written at all; a refusal matches no
     * row, which is why an empty result is reported rather than assumed to be
     * a success.
     */
    const { data, error } = input.id
      ? await sb
          .from("weekly_entries")
          .update(fields)
          .eq("id", input.id)
          .eq("weekly_report_id", reportId)
          .select("*")
          .maybeSingle()
      : await sb
          .from("weekly_entries")
          .insert({ ...fields, weekly_report_id: reportId })
          .select("*")
          .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      throw new Error(
        "This entry was not saved. You may not have permission to change this department's input."
      );
    }
    return rowToEntry(data as WeeklyEntryRow);
  },

  async deleteEntry(reportId, entryId) {
    const sb = client();
    await assertContentEditable(sb, reportId);

    const { error } = await sb
      .from("weekly_entries")
      .delete()
      .eq("id", entryId)
      .eq("weekly_report_id", reportId);
    if (error) throw new Error(error.message);
  },

  async listPlanItems(reportId) {
    const { data, error } = await client()
      .from("weekly_plan_items")
      .select("*")
      .eq("weekly_report_id", reportId)
      .order("kind", { ascending: true })
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as WeeklyPlanItemRow[]).map(rowToPlanItem);
  },

  async savePlanItem(reportId, input) {
    const sb = client();
    await assertContentEditable(sb, reportId);
    const fields = {
      kind: input.kind,
      title: input.title.trim(),
      start_date: input.startDate ?? null,
      end_date: input.endDate,
      owner_contact_id: input.ownerContactId ?? null,
      department_id: input.departmentId ?? null,
      status: input.status,
      sort_order: input.sortOrder ?? 0,
    };
    const { data, error } = input.id
      ? await sb
          .from("weekly_plan_items")
          .update(fields)
          .eq("id", input.id)
          .eq("weekly_report_id", reportId)
          .select("*")
          .maybeSingle()
      : await sb
          .from("weekly_plan_items")
          .insert({ ...fields, weekly_report_id: reportId })
          .select("*")
          .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      throw new Error(
        "This Project Control plan item was not saved. Your role may be read-only."
      );
    }
    return rowToPlanItem(data as WeeklyPlanItemRow);
  },

  async deletePlanItem(reportId, itemId) {
    const sb = client();
    await assertContentEditable(sb, reportId);
    const { error } = await sb
      .from("weekly_plan_items")
      .delete()
      .eq("id", itemId)
      .eq("weekly_report_id", reportId);
    if (error) throw new Error(error.message);
  },
};

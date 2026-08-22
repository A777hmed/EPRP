import { format, parseISO, startOfMonth } from "date-fns";
import { isApprovedReportStatus } from "@/config/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { MonthlyComment, MonthlyDepartmentSummary, MonthlyPlanItem, MonthlyReport, WeeklyEntry } from "@/types";
import { calculateSpi, formatReportNumber, scheduleVariance } from "@/lib/reporting";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { projectService } from "./project-service";
import { weeklyReportService } from "./weekly-report-service";
import type { MonthlyCommentRow, MonthlyDepartmentSummaryRow, MonthlyPlanItemRow, MonthlyReportRow } from "@/lib/supabase/database.types";

export type MonthlyCommentInput = Omit<MonthlyComment, "id" | "monthlyReportId" | "sourceKind" | "sourceWeeklyEntryId" | "sourceWeeklyReportId" | "weekNumber" | "createdByContactId" | "updatedByContactId" | "createdAt" | "updatedAt" | "sourceCreatedAt"> & { id?: string };
export type MonthlyPlanItemInput = Omit<MonthlyPlanItem, "id" | "monthlyReportId" | "createdAt" | "updatedAt"> & { id?: string };
export type MonthlySummaryInput = Omit<MonthlyDepartmentSummary, "id" | "monthlyReportId" | "createdAt" | "updatedAt" | "createdByContactId" | "updatedByContactId">;

/** What one compilation run did, and what it left out and why. */
export interface MonthlyCompilationResult {
  comments: MonthlyComment[];
  /** Weekly reports in the month that were eligible and were read. */
  compiledFromReports: number;
  /** Weekly reports in the month skipped because they are not yet approved. */
  skippedUnapprovedReports: number;
  /** The distinct statuses that caused a skip, for an honest message. */
  skippedStatuses: string[];
}

export interface MonthlyReportService {
  list(projectId?: string): Promise<MonthlyReport[]>;
  getById(id: string): Promise<MonthlyReport | null>;
  create(projectId: string, reportingMonth: string): Promise<MonthlyReport>;
  update(id: string, input: Partial<Pick<MonthlyReport, "executiveSummary" | "plannedProgress" | "actualProgress" | "hseStatus" | "qualityStatus" | "overallProgressStatus" | "preparedByContactId" | "reviewedByContactId" | "approvedByContactId">> & { reportNumber?: string }): Promise<MonthlyReport>;
  /**
   * Move the report through its lifecycle.
   *
   * Separate from update() because P0.3 made status a governed field: a BEFORE
   * UPDATE trigger refuses any direct status write, and
   * set_monthly_report_status() re-proves authority and transition shape in the
   * database. Leaving status on update() would have produced a call that always
   * failed at the trigger.
   */
  changeStatus(id: string, to: MonthlyReport["status"]): Promise<MonthlyReport>;
  /**
   * Compile Weekly-flagged entries into this Monthly Report.
   *
   * Reads ONLY Weekly reports whose status is approved, finalized or locked
   * (P0.4). Returns what it compiled and what it deliberately skipped, so the
   * caller can say so rather than leaving the user to wonder why a Weekly they
   * can see did not appear.
   */
  compileFromWeeklies(reportId: string): Promise<MonthlyCompilationResult>;
  listComments(reportId: string): Promise<MonthlyComment[]>;
  saveComment(reportId: string, input: MonthlyCommentInput): Promise<MonthlyComment>;
  deleteComment(reportId: string, id: string): Promise<void>;
  listSummaries(reportId: string): Promise<MonthlyDepartmentSummary[]>;
  saveSummary(reportId: string, input: MonthlySummaryInput): Promise<MonthlyDepartmentSummary>;
  listPlanItems(reportId: string): Promise<MonthlyPlanItem[]>;
  savePlanItem(reportId: string, input: MonthlyPlanItemInput): Promise<MonthlyPlanItem>;
  deletePlanItem(reportId: string, id: string): Promise<void>;
}

function client(): SupabaseClient { return getSupabaseBrowserClient() as unknown as SupabaseClient; }
function monthStart(value: string) { return format(startOfMonth(parseISO(value)), "yyyy-MM-dd"); }
function reportFromRow(row: MonthlyReportRow): MonthlyReport {
  return { id:row.id, reportNumber:row.report_number, projectId:row.project_id, status:row.status as MonthlyReport["status"], source:"platform", periodStart:row.reporting_month, periodEnd:format(new Date(new Date(row.reporting_month).getFullYear(), new Date(row.reporting_month).getMonth()+1,0),"yyyy-MM-dd"), reportingMonth:row.reporting_month, preparedByContactId:row.prepared_by_contact_id ?? undefined, reviewedByContactId:row.reviewed_by_contact_id ?? undefined, approvedByContactId:row.approved_by_contact_id ?? undefined, plannedProgress:Number(row.planned_progress), actualProgress:Number(row.actual_progress), scheduleVariance:scheduleVariance(Number(row.planned_progress),Number(row.actual_progress)), spi:calculateSpi(Number(row.planned_progress),Number(row.actual_progress)), hseStatus:row.hse_status as MonthlyReport["hseStatus"], qualityStatus:row.quality_status as MonthlyReport["qualityStatus"], overallProgressStatus:row.overall_progress_status as MonthlyReport["overallProgressStatus"], executiveSummary:row.executive_summary ?? undefined, attachmentIds:[], createdAt:row.created_at, updatedAt:row.updated_at };
}
function commentFromRow(row: MonthlyCommentRow): MonthlyComment {
  return { id:row.id, monthlyReportId:row.monthly_report_id, sourceKind:row.source_kind as MonthlyComment["sourceKind"], sourceWeeklyEntryId:row.source_weekly_entry_id ?? undefined, sourceWeeklyReportId:row.source_weekly_report_id ?? undefined, weekNumber:row.week_number ?? undefined, departmentId:row.department_id ?? undefined, systemId:row.system_id ?? undefined, disciplineId:row.discipline_id ?? undefined, updateType:row.update_type as MonthlyComment["updateType"], originalText:row.original_text, presentationText:row.presentation_text ?? undefined, priority:row.priority as MonthlyComment["priority"], status:row.status as MonthlyComment["status"], responsibleContactId:row.responsible_contact_id ?? undefined, targetDate:row.target_date ?? undefined, includeInFinal:row.include_in_final, escalateToManagement:row.escalate_to_management, isMajorAchievement:row.is_major_achievement, createdByContactId:row.created_by_contact_id ?? undefined, updatedByContactId:row.updated_by_contact_id ?? undefined, sourceCreatedAt:row.source_created_at ?? undefined, createdAt:row.created_at, updatedAt:row.updated_at };
}
function summaryFromRow(row: MonthlyDepartmentSummaryRow): MonthlyDepartmentSummary { return { id:row.id, monthlyReportId:row.monthly_report_id, departmentId:row.department_id, systemId:row.system_id ?? undefined, disciplineId:row.discipline_id ?? undefined, monthlySummary:row.monthly_summary ?? undefined, keyAchievements:row.key_achievements ?? undefined, challenges:row.challenges ?? undefined, outstandingActions:row.outstanding_actions ?? undefined, nextMonthPlan:row.next_month_plan ?? undefined, createdByContactId:row.created_by_contact_id ?? undefined, updatedByContactId:row.updated_by_contact_id ?? undefined, createdAt:row.created_at, updatedAt:row.updated_at }; }
function planFromRow(row: MonthlyPlanItemRow): MonthlyPlanItem { return { id:row.id, monthlyReportId:row.monthly_report_id, title:row.title, departmentId:row.department_id ?? undefined, startDate:row.start_date ?? undefined, targetDate:row.target_date ?? undefined, ownerContactId:row.owner_contact_id ?? undefined, status:row.status as MonthlyPlanItem["status"], remarks:row.remarks ?? undefined, sortOrder:row.sort_order, createdAt:row.created_at, updatedAt:row.updated_at }; }
function monthlyType(entry: WeeklyEntry): MonthlyComment["updateType"] { if (entry.updateType === "achievement") return "achievement"; if (entry.updateType === "risk" || entry.updateType === "issue") return "risk_issue"; if (entry.updateType === "delay_constraint") return "challenge_constraint"; if (entry.updateType === "action_required") return "action"; return entry.updateType === "progress_update" ? "progress_update" : "general"; }

const supabaseMonthlyReportService: MonthlyReportService = {
  async list(projectId) { let q=client().from("monthly_reports").select("*").order("reporting_month",{ascending:false}); if(projectId) q=q.eq("project_id",projectId); const {data,error}=await q; if(error) throw new Error(error.message); return (data??[] as MonthlyReportRow[]).map(reportFromRow); },
  async getById(id) { const {data,error}=await client().from("monthly_reports").select("*").eq("id",id).maybeSingle(); if(error) throw new Error(error.message); return data ? reportFromRow(data as MonthlyReportRow) : null; },
  async create(projectId, reportingMonth) { const project=await projectService.getProjectById(projectId); if(!project) throw new Error("Selected project not found"); const month=monthStart(reportingMonth); const date=parseISO(month); const {data,error}=await client().from("monthly_reports").insert({report_number:formatReportNumber("monthly",project.code,date.getFullYear(),date.getMonth()+1),project_id:projectId,reporting_month:month,prepared_by_contact_id:project.reportingCoordinatorId??null,planned_progress:project.plannedProgress,actual_progress:project.actualProgress,status:"draft"}).select("*").single(); if(error) throw new Error(error.message); return reportFromRow(data as MonthlyReportRow); },
  async update(id,input) { const fields={...(input.reportNumber !== undefined ? {report_number:input.reportNumber.trim()} : {}),...(input.executiveSummary !== undefined ? {executive_summary:input.executiveSummary} : {}),...(input.plannedProgress !== undefined ? {planned_progress:input.plannedProgress} : {}),...(input.actualProgress !== undefined ? {actual_progress:input.actualProgress} : {}),...(input.hseStatus !== undefined ? {hse_status:input.hseStatus} : {}),...(input.qualityStatus !== undefined ? {quality_status:input.qualityStatus} : {}),...(input.overallProgressStatus !== undefined ? {overall_progress_status:input.overallProgressStatus} : {}),...(input.preparedByContactId !== undefined ? {prepared_by_contact_id:input.preparedByContactId||null} : {}),...(input.reviewedByContactId !== undefined ? {reviewed_by_contact_id:input.reviewedByContactId||null} : {}),...(input.approvedByContactId !== undefined ? {approved_by_contact_id:input.approvedByContactId||null} : {})}; const {data,error}=await client().from("monthly_reports").update(fields).eq("id",id).select("*").single(); if(error) throw new Error(error.message); return reportFromRow(data as MonthlyReportRow); },
  async changeStatus(id,to) { const {error}=await client().rpc("set_monthly_report_status",{p_report:id,p_to:to}); if(error) throw new Error(error.message); const updated=await supabaseMonthlyReportService.getById(id); if(!updated) throw new Error("Monthly report not found"); return updated; },
  async compileFromWeeklies(reportId) {
    const report = await this.getById(reportId);
    if (!report) throw new Error("Monthly report not found");

    const month = report.reportingMonth.slice(0, 7);
    const inMonth = (await weeklyReportService.list()).filter(
      (w) => w.projectId === report.projectId && w.periodStart.slice(0, 7) === month
    );

    /*
     * P0.4 — the compilation basis.
     *
     * Monthly compiles APPROVED Weekly data only. This previously filtered by
     * project and month alone, so a draft or in-collection Weekly was compiled
     * into the Monthly and from there fed the Executive tier's approved-only
     * aggregates: an unapproved position reaching leadership through a tier that
     * believed everything it received had been approved.
     *
     * The status set is the shared one, not a local list, so compilation,
     * visibility and aggregation cannot drift apart. The database enforces the
     * same rule independently through guard_monthly_comment_source().
     */
    const eligible = inMonth.filter((w) => isApprovedReportStatus(w.status));
    const skipped = inMonth.filter((w) => !isApprovedReportStatus(w.status));

    const rows = (
      await Promise.all(
        eligible.map(async (weekly) =>
          (await weeklyReportService.listEntries(weekly.id))
            .filter((e) => e.includeInMonthly)
            .map((e) => ({ weekly, e }))
        )
      )
    ).flat();

    const summary = {
      compiledFromReports: eligible.length,
      skippedUnapprovedReports: skipped.length,
      skippedStatuses: [...new Set(skipped.map((w) => w.status))].sort(),
    };

    if (rows.length === 0) {
      return { comments: await this.listComments(reportId), ...summary };
    }

    const payload = rows.map(({ weekly, e }) => ({
      monthly_report_id: reportId,
      source_weekly_entry_id: e.id,
      source_weekly_report_id: weekly.id,
      source_kind: "weekly",
      week_number: weekly.weekNumber,
      department_id: e.departmentId ?? null,
      system_id: e.systemId ?? null,
      discipline_id: e.disciplineId ?? null,
      update_type: monthlyType(e),
      original_text: e.description,
      presentation_text: null,
      priority: e.priority,
      status: e.status,
      responsible_contact_id: e.ownerContactId ?? null,
      target_date: e.dueDate ?? null,
      include_in_final: true,
      escalate_to_management: e.entryType === "decision",
      is_major_achievement: e.updateType === "achievement",
      created_by_contact_id: e.createdByContactId ?? null,
      source_created_at: e.createdAt,
    }));

    /*
     * Idempotent: source_weekly_entry_id carries a UNIQUE constraint, and
     * ignoreDuplicates leaves an already-compiled row exactly as it is —
     * including any presentation_text an editor has since written on it.
     * Recompiling adds what is new and rewrites nothing.
     */
    const { error } = await client()
      .from("monthly_comments")
      .upsert(payload, { onConflict: "source_weekly_entry_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);

    return { comments: await this.listComments(reportId), ...summary };
  },
  async listComments(reportId) { const {data,error}=await client().from("monthly_comments").select("*").eq("monthly_report_id",reportId).order("created_at"); if(error) throw new Error(error.message); return (data??[] as MonthlyCommentRow[]).map(commentFromRow); },
  async saveComment(reportId,input) {
    const text=input.originalText.trim();
    if(!text) throw new Error("Comment text is required.");
    if(input.id){
      const {data:existing,error:existingError}=await client().from("monthly_comments").select("*").eq("id",input.id).eq("monthly_report_id",reportId).maybeSingle();
      if(existingError) throw new Error(existingError.message);
      if(!existing) throw new Error("Monthly comment not found.");
      const isWeeklySource=(existing as MonthlyCommentRow).source_kind==="weekly";
      const fields={department_id:input.departmentId??null,system_id:input.systemId??null,discipline_id:input.disciplineId??null,update_type:input.updateType,presentation_text:isWeeklySource?text:(input.presentationText?.trim()||null),...(isWeeklySource?{}:{original_text:text}),priority:input.priority,status:input.status,responsible_contact_id:input.responsibleContactId??null,target_date:input.targetDate??null,include_in_final:input.includeInFinal,escalate_to_management:input.escalateToManagement,is_major_achievement:input.isMajorAchievement};
      const {data,error}=await client().from("monthly_comments").update(fields).eq("id",input.id).eq("monthly_report_id",reportId).select("*").single();
      if(error) throw new Error(error.message);
      return commentFromRow(data as MonthlyCommentRow);
    }
    const fields={monthly_report_id:reportId,source_kind:"monthly_manual",department_id:input.departmentId??null,system_id:input.systemId??null,discipline_id:input.disciplineId??null,update_type:input.updateType,original_text:text,presentation_text:input.presentationText?.trim()||null,priority:input.priority,status:input.status,responsible_contact_id:input.responsibleContactId??null,target_date:input.targetDate??null,include_in_final:input.includeInFinal,escalate_to_management:input.escalateToManagement,is_major_achievement:input.isMajorAchievement};
    const {data,error}=await client().from("monthly_comments").insert(fields).select("*").single();
    if(error) throw new Error(error.message);
    return commentFromRow(data as MonthlyCommentRow);
  },
  async deleteComment(reportId,id) { const {error}=await client().from("monthly_comments").delete().eq("id",id).eq("monthly_report_id",reportId); if(error) throw new Error(error.message); },
  async listSummaries(reportId) { const {data,error}=await client().from("monthly_department_summaries").select("*").eq("monthly_report_id",reportId); if(error) throw new Error(error.message); return (data??[] as MonthlyDepartmentSummaryRow[]).map(summaryFromRow); },
  async saveSummary(reportId,input) { const fields={monthly_report_id:reportId,department_id:input.departmentId,system_id:input.systemId??null,discipline_id:input.disciplineId??null,monthly_summary:input.monthlySummary??null,key_achievements:input.keyAchievements??null,challenges:input.challenges??null,outstanding_actions:input.outstandingActions??null,next_month_plan:input.nextMonthPlan??null}; const {data,error}=await client().from("monthly_department_summaries").upsert(fields,{onConflict:"monthly_report_id,department_id,system_id,discipline_id"}).select("*").single(); if(error) throw new Error(error.message); return summaryFromRow(data as MonthlyDepartmentSummaryRow); },
  async listPlanItems(reportId) { const {data,error}=await client().from("monthly_plan_items").select("*").eq("monthly_report_id",reportId).order("sort_order"); if(error) throw new Error(error.message); return (data??[] as MonthlyPlanItemRow[]).map(planFromRow); },
  async savePlanItem(reportId,input) { const fields={monthly_report_id:reportId,title:input.title.trim(),department_id:input.departmentId??null,start_date:input.startDate??null,target_date:input.targetDate??null,owner_contact_id:input.ownerContactId??null,status:input.status,remarks:input.remarks??null,sort_order:input.sortOrder}; const query=input.id?client().from("monthly_plan_items").update(fields).eq("id",input.id).eq("monthly_report_id",reportId):client().from("monthly_plan_items").insert(fields); const {data,error}=await query.select("*").single(); if(error) throw new Error(error.message); return planFromRow(data as MonthlyPlanItemRow); },
  async deletePlanItem(reportId,id) { const {error}=await client().from("monthly_plan_items").delete().eq("id",id).eq("monthly_report_id",reportId); if(error) throw new Error(error.message); },
};

export const monthlyReportService: MonthlyReportService = supabaseMonthlyReportService;

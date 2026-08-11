import { format } from "date-fns";

import type {
  ActivityStatus,
  CommentCategory,
  SubmissionHealthStatus,
  EntryStatus,
  IsoDate,
  KpiRating,
  Priority,
  ProgressStatus,
  ReportStatus,
  SubmissionStatus,
  WeeklyActivity,
  WeeklyEntry,
  WeeklyEntryType,
  WeeklyPlanItem,
  WeeklyPlanStatus,
  WeeklyReport,
  WeeklySubmission,
  WeeklyUpdateType,
} from "@/types";
import {
  formatReportNumber,
  getReportingWeekRange,
  getReportingYear,
  getWeekNumber,
} from "@/lib/reporting";
import { canTransition } from "@/config/workflows";
import { contentFrozenReason } from "@/features/weekly-reports/lifecycle-guards";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  mockWeeklyReports,
  mockWeeklySubmissions,
  mockWeeklyEntries,
  mockWeeklyPlanItems,
} from "@/data/mock/weekly-reports.mock";
import { projectService } from "./project-service";
import { supabaseWeeklyReportService } from "./supabase-weekly-report-service";

/** Fields captured by the Phase 6A.1 header and Phase 6A.2 KPI form.
 * Project data and report identity are derived by the service. */
export interface WeeklyReportCreateInput {
  projectId: string;
  /** Any date within the reporting week; the week is derived from it. */
  periodStart: IsoDate;
  preparedByContactId?: string;
  disciplineIds: string[];
  /** Phase 6A.2 KPIs — default to the project's figures when omitted. */
  plannedProgress?: number;
  actualProgress?: number;
  manHoursToDate?: number | null;
  hseStatus?: KpiRating;
  qualityStatus?: KpiRating;
  overallProgressStatus?: ProgressStatus;
  /** Executive Summary narrative. */
  summary?: string;
}

/** One Major Activity row submitted from the form (Phase W2). */
export interface WeeklyActivityInput {
  /** Present when editing an existing row. */
  id?: string;
  title: string;
  departmentId?: string;
  disciplineId?: string;
  ownerContactId?: string;
  status: ActivityStatus;
  progressPercent?: number;
  remarks?: string;
}

export interface WeeklyReportUpdateInput {
  periodStart?: IsoDate;
  preparedByContactId?: string;
  reviewedByContactId?: string;
  approvedByContactId?: string;
  plannedProgress?: number;
  actualProgress?: number;
  disciplineIds?: string[];
  /** `null` explicitly clears a previously saved value. */
  manHoursToDate?: number | null;
  hseStatus?: KpiRating;
  qualityStatus?: KpiRating;
  overallProgressStatus?: ProgressStatus;
  /** Empty string clears the saved narrative. */
  summary?: string;
}

/** One "Department Updates" row submitted from the weekly form (Phase 6A.3). */
export interface WeeklySubmissionInput {
  /** Existing submission id when editing; omitted for new rows. */
  id?: string;
  departmentId: string;
  disciplineId?: string;
  status: SubmissionStatus;
  progressPercent?: number;
  summary?: string;
  keyAchievement?: string;
  delayConstraint?: string;
  nextWeekPlan?: string;
  responsibleContactId?: string;
  targetDate?: IsoDate;
  healthStatus?: SubmissionHealthStatus;
  risksIssues?: string;
}

/**
 * ONE department-owned Weekly row — either the General Department Update
 * (scope item NULL) or one Program & Study / Discipline update beneath it.
 *
 * Both are the same kind of record: the specification makes the department the
 * owner of the row and the scope item a structured field ON it, not a second
 * owner. One input and one save path therefore serve both, rather than two
 * that could drift apart.
 *
 * Deliberately separate from {@link WeeklySubmissionInput}: that one belongs to
 * the whole-report edit form and is saved replace-all, which is correct there
 * and catastrophic in the workspace, where a Department Manager saving their
 * own department would delete every other department's rows. This input names
 * ONE row and is saved in place.
 */
export interface WeeklyDepartmentUpdateInput {
  /**
   * The row being edited, when the caller already knows it. Optional because
   * the save also matches on department and scope item, so a client that never
   * loaded the id still updates rather than inserts.
   */
  id?: string;
  departmentId: string;
  /**
   * The scope item this update belongs to. Stored as `discipline_id` whatever
   * the project type calls it on screen. Omitted for the General Department
   * Update, whose column stays NULL — the recorded meaning of "department
   * level", not a missing value.
   */
  disciplineId?: string;
  status: SubmissionStatus;
  progressPercent?: number;
  summary?: string;
  keyAchievement?: string;
  delayConstraint?: string;
  nextWeekPlan?: string;
  healthStatus?: SubmissionHealthStatus;
  /**
   * Who owns this scope item's work this week, and by when.
   *
   * Both columns already existed and already held data — `target_date` was
   * populated on live rows — but no editor wrote them, so the values could be
   * read and never corrected. They belong on the scope item, which is where
   * the work is.
   */
  responsibleContactId?: string;
  targetDate?: IsoDate;
}

/** One comment / risk / issue / action row from the weekly form (Phase 6A.4). */
export interface WeeklyEntryInput {
  id?: string;
  entryType: WeeklyEntryType;
  updateType?: WeeklyUpdateType;
  category: CommentCategory;
  description: string;
  priority: Priority;
  status: EntryStatus;
  ownerContactId?: string;
  dueDate?: IsoDate;
  departmentId?: string;
  systemId?: string;
  disciplineId?: string;
  includeInMonthly: boolean;
  /** Mock-mode attribution only; live DB derives identity from auth.uid(). */
  authorContactId?: string;
}

export interface WeeklyPlanItemInput {
  id?: string;
  kind: "milestone" | "next_week";
  title: string;
  startDate?: IsoDate;
  endDate: IsoDate;
  ownerContactId?: string;
  departmentId?: string;
  status: WeeklyPlanStatus;
  sortOrder?: number;
}

export interface WeeklyReportService {
  list(): Promise<WeeklyReport[]>;
  getById(id: string): Promise<WeeklyReport | null>;
  create(input: WeeklyReportCreateInput): Promise<WeeklyReport>;
  update(id: string, input: WeeklyReportUpdateInput): Promise<WeeklyReport>;
  duplicate(id: string): Promise<WeeklyReport>;
  archive(id: string): Promise<WeeklyReport>;
  changeStatus(id: string, to: ReportStatus): Promise<WeeklyReport>;
  listSubmissions(reportId: string): Promise<WeeklySubmission[]>;
  /** Replace the report's department updates with exactly these rows. */
  saveSubmissions(
    reportId: string,
    updates: WeeklySubmissionInput[]
  ): Promise<WeeklySubmission[]>;
  /**
   * Save ONE department-owned row — the General Department Update, or one
   * scope item's update — in place.
   *
   * Touches only the row identified by (report, department, scope item): an
   * existing row is updated and keeps its id, so saving twice cannot produce a
   * duplicate, and no other department's or scope item's input is read,
   * rewritten, or deleted.
   */
  saveDepartmentUpdate(
    reportId: string,
    input: WeeklyDepartmentUpdateInput
  ): Promise<WeeklySubmission>;
  listActivities(reportId: string): Promise<WeeklyActivity[]>;
  /** Replace-all: rows missing from the payload are deleted. */
  saveActivities(
    reportId: string,
    activities: WeeklyActivityInput[]
  ): Promise<WeeklyActivity[]>;
  listEntries(reportId: string): Promise<WeeklyEntry[]>;
  /** Replace the report's comments / risks / issues / actions. */
  saveEntries(
    reportId: string,
    entries: WeeklyEntryInput[]
  ): Promise<WeeklyEntry[]>;
  /**
   * Insert or update ONE narrative row, in place.
   *
   * The workspace edits entries a scope item at a time, where the replace-all
   * `saveEntries` would delete every other department's rows as a side effect
   * of saving one item's. This touches only the row it names.
   */
  saveEntry(reportId: string, input: WeeklyEntryInput): Promise<WeeklyEntry>;
  /** Remove ONE narrative row, leaving the rest of the report alone. */
  deleteEntry(reportId: string, entryId: string): Promise<void>;
  listPlanItems(reportId: string): Promise<WeeklyPlanItem[]>;
  savePlanItem(
    reportId: string,
    input: WeeklyPlanItemInput
  ): Promise<WeeklyPlanItem>;
  deletePlanItem(reportId: string, itemId: string): Promise<void>;
}

/* --------------------------------- Helpers -------------------------------- */

function clone<T>(value: T): T {
  return structuredClone(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

function delay(ms = 200): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toIsoDate(date: Date): IsoDate {
  return format(date, "yyyy-MM-dd");
}

/* ------------------------------ Mock service ------------------------------ */

const reportStore = new Map<string, WeeklyReport>(
  mockWeeklyReports.map((r) => [r.id, clone(r)])
);
const submissionStore = new Map<string, WeeklySubmission>(
  mockWeeklySubmissions.map((s) => [s.id, clone(s)])
);
const entryStore = new Map<string, WeeklyEntry>(
  mockWeeklyEntries.map((entry) => [entry.id, clone(entry)])
);
const activityStore = new Map<string, WeeklyActivity>();
const planStore = new Map<string, WeeklyPlanItem>(
  mockWeeklyPlanItems.map((item) => [item.id, clone(item)])
);

let sequence = reportStore.size;
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-new-${sequence}`;
}

const mockWeeklyReportService: WeeklyReportService = {
  async list() {
    await delay();
    return [...reportStore.values()]
      .map(clone)
      .sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  },

  async getById(id) {
    await delay(150);
    const report = reportStore.get(id);
    return report ? clone(report) : null;
  },

  async create(input) {
    await delay();
    const project = await projectService.getProjectById(input.projectId);
    if (!project) throw new Error("Selected project not found");

    const { start, end, anchor } = getReportingWeekRange(input.periodStart);
    // Week numbering uses the Monday anchor — see getReportingWeekRange.
    const weekNumber = getWeekNumber(anchor);
    const year = getReportingYear(anchor);
    const timestamp = nowIso();
    const reportId = nextId("wr");

    // One submission per reporting-required department (or all if none).
    const reportingDepts = project.departments.filter(
      (d) => d.reportingRequired
    );
    const depts =
      reportingDepts.length > 0 ? reportingDepts : project.departments;
    const submissionIds: string[] = [];
    for (const dept of depts) {
      const sub: WeeklySubmission = {
        id: nextId("sub"),
        weeklyReportId: reportId,
        departmentId: dept.departmentId,
        status: "pending",
        accomplishments: [],
        plannedNextWeek: [],
        blockers: [],
      };
      submissionStore.set(sub.id, sub);
      submissionIds.push(sub.id);
    }

    const report: WeeklyReport = {
      id: reportId,
      reportNumber: formatReportNumber("weekly", project.code, year, weekNumber),
      projectId: project.id,
      status: "draft",
      source: "platform",
      weekNumber,
      periodStart: toIsoDate(start),
      periodEnd: toIsoDate(end),
      plannedProgress: input.plannedProgress ?? project.plannedProgress,
      actualProgress: input.actualProgress ?? project.actualProgress,
      preparedByContactId:
        input.preparedByContactId ?? project.reportingCoordinatorId,
      disciplineIds: [...input.disciplineIds],
      manHoursToDate: input.manHoursToDate ?? undefined,
      hseStatus: input.hseStatus,
      qualityStatus: input.qualityStatus,
      overallProgressStatus: input.overallProgressStatus,
      summary: input.summary || undefined,
      submissionIds,
      entryIds: [],
      activityIds: [],
      attachmentIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    reportStore.set(report.id, report);
    return clone(report);
  },

  async update(id, input) {
    await delay();
    const existing = reportStore.get(id);
    if (!existing) throw new Error(`Weekly report ${id} not found`);

    const patch: Partial<WeeklyReport> = {};
    if (input.periodStart) {
      const { start, end, anchor } = getReportingWeekRange(input.periodStart);
      patch.periodStart = toIsoDate(start);
      patch.periodEnd = toIsoDate(end);
      patch.weekNumber = getWeekNumber(anchor);
      const project = await projectService.getProjectById(existing.projectId);
      if (!project) throw new Error("Report project not found");
      patch.reportNumber = formatReportNumber(
        "weekly",
        project.code,
        getReportingYear(anchor),
        getWeekNumber(anchor)
      );
    }
    if (input.preparedByContactId !== undefined)
      patch.preparedByContactId = input.preparedByContactId || undefined;
    if (input.reviewedByContactId !== undefined)
      patch.reviewedByContactId = input.reviewedByContactId || undefined;
    if (input.approvedByContactId !== undefined)
      patch.approvedByContactId = input.approvedByContactId || undefined;
    if (input.plannedProgress !== undefined)
      patch.plannedProgress = input.plannedProgress;
    if (input.actualProgress !== undefined)
      patch.actualProgress = input.actualProgress;
    if (input.disciplineIds !== undefined)
      patch.disciplineIds = [...input.disciplineIds];
    if (input.manHoursToDate !== undefined)
      patch.manHoursToDate = input.manHoursToDate ?? undefined;
    if (input.hseStatus !== undefined) patch.hseStatus = input.hseStatus;
    if (input.qualityStatus !== undefined)
      patch.qualityStatus = input.qualityStatus;
    if (input.overallProgressStatus !== undefined)
      patch.overallProgressStatus = input.overallProgressStatus;
    // Empty string clears the narrative, matching the Supabase NULL write.
    if (input.summary !== undefined) patch.summary = input.summary || undefined;

    const updated: WeeklyReport = {
      ...existing,
      ...patch,
      updatedAt: nowIso(),
    };
    reportStore.set(id, updated);
    return clone(updated);
  },

  async duplicate(id) {
    await delay();
    const source = reportStore.get(id);
    if (!source) throw new Error(`Weekly report ${id} not found`);
    const timestamp = nowIso();
    const newId = nextId("wr");

    const submissionIds: string[] = [];
    for (const subId of source.submissionIds) {
      const sub = submissionStore.get(subId);
      if (!sub) continue;
      const copy: WeeklySubmission = {
        ...clone(sub),
        id: nextId("sub"),
        weeklyReportId: newId,
        status: "pending",
        summary: undefined,
        accomplishments: [],
        plannedNextWeek: [],
        blockers: [],
        submittedByContactId: undefined,
        submittedAt: undefined,
      };
      submissionStore.set(copy.id, copy);
      submissionIds.push(copy.id);
    }

    const copy: WeeklyReport = {
      ...clone(source),
      id: newId,
      reportNumber: `${source.reportNumber}-COPY`,
      status: "draft",
      submissionIds,
      entryIds: [],
      reviewedByContactId: undefined,
      approvedByContactId: undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    reportStore.set(copy.id, copy);
    return clone(copy);
  },

  async archive(id) {
    await delay();
    return mockWeeklyReportService.changeStatus(id, "archived");
  },

  async changeStatus(id, to) {
    await delay();
    const existing = reportStore.get(id);
    if (!existing) throw new Error(`Weekly report ${id} not found`);
    if (
      to !== "archived" &&
      !canTransition("weekly", existing.status, to)
    ) {
      throw new Error(
        `Cannot move a weekly report from ${existing.status} to ${to}.`
      );
    }
    const updated: WeeklyReport = {
      ...existing,
      status: to,
      updatedAt: nowIso(),
    };
    reportStore.set(id, updated);
    return clone(updated);
  },

  async listSubmissions(reportId) {
    await delay(120);
    return [...submissionStore.values()]
      .filter((s) => s.weeklyReportId === reportId)
      .map(clone);
  },

  async saveSubmissions(reportId, updates) {
    await delay();
    const report = reportStore.get(reportId);
    if (!report) throw new Error(`Weekly report ${reportId} not found`);

    // Drop rows the user removed, then upsert the submitted set in order.
    for (const existing of [...submissionStore.values()]) {
      if (existing.weeklyReportId === reportId) {
        submissionStore.delete(existing.id);
      }
    }

    const saved: WeeklySubmission[] = updates.map((update) => {
      const submission: WeeklySubmission = {
        id: update.id ?? nextId("sub"),
        weeklyReportId: reportId,
        departmentId: update.departmentId,
        disciplineId: update.disciplineId,
        status: update.status,
        progressPercent: update.progressPercent,
        summary: update.summary,
        keyAchievement: update.keyAchievement,
        delayConstraint: update.delayConstraint,
        nextWeekPlan: update.nextWeekPlan,
        responsibleContactId: update.responsibleContactId,
        targetDate: update.targetDate,
        healthStatus: update.healthStatus,
        risksIssues: update.risksIssues || undefined,
        accomplishments: [],
        plannedNextWeek: [],
        blockers: [],
      };
      submissionStore.set(submission.id, submission);
      return clone(submission);
    });

    reportStore.set(reportId, {
      ...report,
      submissionIds: saved.map((s) => s.id),
      updatedAt: nowIso(),
    });
    return saved;
  },

  async saveDepartmentUpdate(reportId, input) {
    await delay();
    const report = reportStore.get(reportId);
    if (!report) throw new Error(`Weekly report ${reportId} not found`);

    const frozen = contentFrozenReason(report.status);
    if (frozen) throw new Error(frozen);

    /*
     * The row is identified by (report, department, scope item) — the same key
     * the database's unique index uses. Matching on it rather than only on the
     * id the client happens to hold is what makes a repeated save idempotent:
     * a client that saved before it had ever read the row back would otherwise
     * insert a second update for the same scope.
     */
    const scopeItemId = input.disciplineId ?? undefined;
    const sameRow = (s: WeeklySubmission) =>
      s.weeklyReportId === reportId &&
      s.departmentId === input.departmentId &&
      (s.disciplineId ?? undefined) === scopeItemId;

    const byId = input.id ? submissionStore.get(input.id) : undefined;
    const existing =
      byId && sameRow(byId)
        ? byId
        : [...submissionStore.values()].find(sameRow);

    const saved: WeeklySubmission = {
      // Everything not part of this form — review marks, submission stamps,
      // the detailed arrays — is carried through untouched.
      ...(existing ?? {
        id: nextId("sub"),
        weeklyReportId: reportId,
        departmentId: input.departmentId,
        accomplishments: [],
        plannedNextWeek: [],
        blockers: [],
      }),
      // Taken from the input, never from the row being replaced: the scope a
      // save was aimed at cannot be changed by the row it happens to land on.
      disciplineId: scopeItemId,
      status: input.status,
      progressPercent: input.progressPercent,
      summary: input.summary || undefined,
      keyAchievement: input.keyAchievement || undefined,
      delayConstraint: input.delayConstraint || undefined,
      nextWeekPlan: input.nextWeekPlan || undefined,
      responsibleContactId: input.responsibleContactId || undefined,
      targetDate: input.targetDate || undefined,
      /*
       * Only written when the caller actually supplies one. The workspace does
       * not edit this field, so assigning `input.healthStatus` unconditionally
       * cleared any verdict recorded earlier — a save wiping a value its own
       * form never showed. Absent means "leave it alone", not "set it to null".
       */
      healthStatus: input.healthStatus ?? existing?.healthStatus,
    };

    submissionStore.set(saved.id, saved);
    reportStore.set(reportId, {
      ...report,
      submissionIds: report.submissionIds.includes(saved.id)
        ? report.submissionIds
        : [...report.submissionIds, saved.id],
      updatedAt: nowIso(),
    });
    return clone(saved);
  },

  async listActivities(reportId) {
    await delay(120);
    return [...activityStore.values()]
      .filter((a) => a.weeklyReportId === reportId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(clone);
  },

  async saveActivities(reportId, activities) {
    await delay();
    const report = reportStore.get(reportId);
    if (!report) throw new Error(`Weekly report ${reportId} not found`);

    // Rows absent from the payload were removed by the user.
    const previous = new Map(
      [...activityStore.values()]
        .filter((a) => a.weeklyReportId === reportId)
        .map((a) => [a.id, a])
    );
    for (const id of previous.keys()) activityStore.delete(id);

    const saved: WeeklyActivity[] = activities.map((input, index) => {
      const id = input.id ?? nextId("act");
      const activity: WeeklyActivity = {
        id,
        weeklyReportId: reportId,
        title: input.title,
        departmentId: input.departmentId || undefined,
        disciplineId: input.disciplineId || undefined,
        ownerContactId: input.ownerContactId || undefined,
        status: input.status,
        progressPercent: input.progressPercent,
        remarks: input.remarks || undefined,
        // Array order is the authoring order.
        sortOrder: index,
        createdAt: previous.get(id)?.createdAt ?? nowIso(),
        updatedAt: nowIso(),
      };
      activityStore.set(activity.id, activity);
      return clone(activity);
    });

    reportStore.set(reportId, {
      ...report,
      activityIds: saved.map((a) => a.id),
      updatedAt: nowIso(),
    });
    return saved;
  },

  async listEntries(reportId) {
    await delay(120);
    return [...entryStore.values()]
      .filter((e) => e.weeklyReportId === reportId)
      .map(clone);
  },

  async saveEntries(reportId, entries) {
    await delay();
    const report = reportStore.get(reportId);
    if (!report) throw new Error(`Weekly report ${reportId} not found`);

    // Rows absent from the payload were removed by the user.
    const previous = new Map(
      [...entryStore.values()]
        .filter((e) => e.weeklyReportId === reportId)
        .map((e) => [e.id, e])
    );
    for (const id of previous.keys()) entryStore.delete(id);

    const saved: WeeklyEntry[] = entries.map((input) => {
      const id = input.id ?? nextId("entry");
      const now = nowIso();
      const prior = previous.get(id);
      const entry: WeeklyEntry = {
        id,
        weeklyReportId: reportId,
        entryType: input.entryType,
        updateType: input.updateType ?? "general",
        category: input.category,
        description: input.description,
        priority: input.priority,
        status: input.status,
        ownerContactId: input.ownerContactId,
        dueDate: input.dueDate,
        departmentId: input.departmentId,
        systemId: input.systemId,
        disciplineId: input.disciplineId,
        includeInMonthly: input.includeInMonthly,
        createdByContactId:
          prior?.createdByContactId ?? input.authorContactId,
        updatedByContactId: prior ? input.authorContactId : undefined,
        createdAt: prior?.createdAt ?? now,
        updatedAt: now,
      };
      entryStore.set(entry.id, entry);
      return clone(entry);
    });

    reportStore.set(reportId, {
      ...report,
      entryIds: saved.map((e) => e.id),
      updatedAt: nowIso(),
    });
    return saved;
  },

  async saveEntry(reportId, input) {
    await delay();
    const report = reportStore.get(reportId);
    if (!report) throw new Error(`Weekly report ${reportId} not found`);

    const frozen = contentFrozenReason(report.status);
    if (frozen) throw new Error(frozen);

    // An id from another report is never followed: it would move a row
    // between reports rather than edit this one's.
    const existing = input.id ? entryStore.get(input.id) : undefined;
    const target =
      existing && existing.weeklyReportId === reportId ? existing : undefined;
    const now = nowIso();

    const entry: WeeklyEntry = {
      id: target?.id ?? nextId("entry"),
      weeklyReportId: reportId,
      entryType: input.entryType,
      updateType: input.updateType ?? target?.updateType ?? "general",
      category: input.category,
      description: input.description,
      priority: input.priority,
      status: input.status,
      ownerContactId: input.ownerContactId,
      dueDate: input.dueDate,
      departmentId: input.departmentId,
      systemId: input.systemId,
      disciplineId: input.disciplineId,
      includeInMonthly: input.includeInMonthly,
      createdByContactId:
        target?.createdByContactId ?? input.authorContactId,
      updatedByContactId: target ? input.authorContactId : undefined,
      // Creation time belongs to the row, not to the edit that touched it.
      createdAt: target?.createdAt ?? now,
      updatedAt: now,
    };

    entryStore.set(entry.id, entry);
    reportStore.set(reportId, {
      ...report,
      entryIds: report.entryIds.includes(entry.id)
        ? report.entryIds
        : [...report.entryIds, entry.id],
      updatedAt: nowIso(),
    });
    return clone(entry);
  },

  async deleteEntry(reportId, entryId) {
    await delay();
    const report = reportStore.get(reportId);
    if (!report) throw new Error(`Weekly report ${reportId} not found`);

    const frozen = contentFrozenReason(report.status);
    if (frozen) throw new Error(frozen);

    const existing = entryStore.get(entryId);
    if (!existing || existing.weeklyReportId !== reportId) return;

    entryStore.delete(entryId);
    reportStore.set(reportId, {
      ...report,
      entryIds: report.entryIds.filter((id) => id !== entryId),
      updatedAt: nowIso(),
    });
  },

  async listPlanItems(reportId) {
    await delay(100);
    return [...planStore.values()]
      .filter((item) => item.weeklyReportId === reportId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(clone);
  },

  async savePlanItem(reportId, input) {
    await delay();
    const report = reportStore.get(reportId);
    if (!report) throw new Error(`Weekly report ${reportId} not found`);
    const frozen = contentFrozenReason(report.status);
    if (frozen) throw new Error(frozen);
    const existing = input.id ? planStore.get(input.id) : undefined;
    const target =
      existing?.weeklyReportId === reportId ? existing : undefined;
    const item: WeeklyPlanItem = {
      id: target?.id ?? nextId("plan"),
      weeklyReportId: reportId,
      kind: input.kind,
      title: input.title.trim(),
      startDate: input.startDate,
      endDate: input.endDate,
      ownerContactId: input.ownerContactId,
      departmentId: input.departmentId,
      status: input.status,
      sortOrder: input.sortOrder ?? target?.sortOrder ?? planStore.size,
      createdAt: target?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    };
    planStore.set(item.id, item);
    return clone(item);
  },

  async deletePlanItem(reportId, itemId) {
    await delay();
    const report = reportStore.get(reportId);
    if (!report) throw new Error(`Weekly report ${reportId} not found`);
    const frozen = contentFrozenReason(report.status);
    if (frozen) throw new Error(frozen);
    const item = planStore.get(itemId);
    if (item?.weeklyReportId === reportId) planStore.delete(itemId);
  },
};

/**
 * Active weekly-report service — Supabase when configured, in-memory mock
 * otherwise. Both satisfy the same interface.
 */
export const weeklyReportService: WeeklyReportService = isSupabaseConfigured()
  ? supabaseWeeklyReportService
  : mockWeeklyReportService;

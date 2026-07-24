import { format, getISODay, isValid, parseISO } from "date-fns";
import { z } from "zod";

import { getReportingWeekRange } from "@/lib/reporting";
import type { WeeklyEntry, WeeklyReport, WeeklySubmission } from "@/types";

const reportStatuses = [
  "draft",
  "collecting",
  "submitted",
  "under_review",
  "approved",
  "finalized",
  "locked",
  "returned",
  "rejected",
  "archived",
] as const;

function isRealIsoDate(value: string): boolean {
  const date = parseISO(value);
  return isValid(date) && format(date, "yyyy-MM-dd") === value;
}

const weeklyPeriodStartSchema = z
  .string()
  .min(1, "Select the reporting period")
  .refine(isRealIsoDate, "Enter a valid reporting date")
  .refine(
    (value) => !isRealIsoDate(value) || getISODay(parseISO(value)) === 1,
    "The reporting period must start on Monday"
  );

const kpiRatings = [
  "excellent",
  "good",
  "fair",
  "at_risk",
  "critical",
] as const;

const progressStatuses = [
  "ahead",
  "on_track",
  "at_risk",
  "behind",
  "critical",
] as const;

/**
 * Empty numeric inputs are represented as NaN, which `z.number()` rejects
 * outright — so numeric fields build on a NaN-tolerant base and express
 * their own "required" and range rules with readable messages.
 */
const looseNumber = z.union([z.number(), z.nan()]);

/** Progress percentage: required whole number, 0–100 (matches storage). */
const progressPercentSchema = looseNumber.superRefine((value, ctx) => {
  if (Number.isNaN(value)) {
    ctx.addIssue({ code: "custom", message: "Enter a progress percentage" });
    return;
  }
  if (value < 0 || value > 100) {
    ctx.addIssue({ code: "custom", message: "Must be between 0 and 100" });
    return;
  }
  if (!Number.isInteger(value)) {
    ctx.addIssue({ code: "custom", message: "Enter a whole percentage" });
  }
});

/** Man-hours: optional (NaN = not entered), non-negative whole number. */
const manHoursSchema = looseNumber.superRefine((value, ctx) => {
  if (Number.isNaN(value)) return;
  if (!Number.isInteger(value)) {
    ctx.addIssue({ code: "custom", message: "Enter a whole number" });
    return;
  }
  if (value < 0) {
    ctx.addIssue({ code: "custom", message: "Man-hours cannot be negative" });
  }
});

const submissionStatuses = [
  "pending",
  "in_progress",
  "submitted",
  "returned",
  "approved",
] as const;

const optionalIsoDate = z
  .string()
  .refine(
    (value) => value === "" || isRealIsoDate(value),
    "Enter a valid date"
  );

/** One "Department Updates" row (Phase 6A.3). */
export const departmentUpdateSchema = z.object({
  id: z.string().optional(),
  departmentId: z.string().trim().min(1, "Select a department"),
  disciplineId: z.string().trim(),
  status: z.enum(submissionStatuses),
  summary: z.string().trim().max(1000).optional().or(z.literal("")),
  progressPercent: looseNumber.superRefine((value, ctx) => {
    if (Number.isNaN(value)) return; // optional per row
    if (value < 0 || value > 100) {
      ctx.addIssue({ code: "custom", message: "Must be between 0 and 100" });
      return;
    }
    if (!Number.isInteger(value)) {
      ctx.addIssue({ code: "custom", message: "Enter a whole percentage" });
    }
  }),
  keyAchievement: z.string().trim().max(1000).optional().or(z.literal("")),
  delayConstraint: z.string().trim().max(1000).optional().or(z.literal("")),
  nextWeekPlan: z.string().trim().max(1000).optional().or(z.literal("")),
  responsibleContactId: z.string().trim(),
  targetDate: optionalIsoDate,
});

export type DepartmentUpdateValues = z.infer<typeof departmentUpdateSchema>;

export function emptyDepartmentUpdate(
  departmentId = ""
): DepartmentUpdateValues {
  return {
    departmentId,
    disciplineId: "",
    status: "pending",
    summary: "",
    progressPercent: Number.NaN,
    keyAchievement: "",
    delayConstraint: "",
    nextWeekPlan: "",
    responsibleContactId: "",
    targetDate: "",
  };
}

const entryTypes = ["comment", "risk", "issue", "action"] as const;

const entryCategories = [
  "progress",
  "risk",
  "issue",
  "hse",
  "quality",
  "financial",
  "escalation",
  "general",
] as const;

const entryStatuses = [
  "open",
  "in_progress",
  "resolved",
  "closed",
  "escalated",
] as const;

const priorities = ["low", "medium", "high", "critical"] as const;

/** One key comment / risk / issue / action item row (Phase 6A.4). */
export const weeklyEntrySchema = z
  .object({
    id: z.string().optional(),
    entryType: z.enum(entryTypes),
    category: z.enum(entryCategories),
    description: z
      .string()
      .trim()
      .min(1, "Describe this entry")
      .max(2000, "Keep the description under 2000 characters"),
    priority: z.enum(priorities),
    status: z.enum(entryStatuses),
    ownerContactId: z.string().trim(),
    dueDate: optionalIsoDate,
    departmentId: z.string().trim(),
    systemId: z.string().trim(),
    disciplineId: z.string().trim(),
    includeInMonthly: z.boolean(),
  })
  .superRefine((row, ctx) => {
    // An action item is only actionable with someone accountable and a date.
    if (row.entryType !== "action") return;
    if (!row.ownerContactId) {
      ctx.addIssue({
        code: "custom",
        path: ["ownerContactId"],
        message: "An action item needs an owner",
      });
    }
    if (!row.dueDate) {
      ctx.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "An action item needs a due date",
      });
    }
  });

export type WeeklyEntryValues = z.infer<typeof weeklyEntrySchema>;

export function emptyWeeklyEntry(
  entryType: WeeklyEntryValues["entryType"]
): WeeklyEntryValues {
  return {
    entryType,
    // Default the category to the section it was added from where one matches.
    category:
      entryType === "risk" || entryType === "issue" ? entryType : "general",
    description: "",
    priority: "medium",
    status: "open",
    ownerContactId: "",
    dueDate: "",
    departmentId: "",
    systemId: "",
    disciplineId: "",
    includeInMonthly: false,
  };
}

/**
 * Zod contract for the weekly-report form: Phase 6A.1 header, the
 * Phase 6A.2 progress KPIs, the Phase 6A.3 department updates, and the
 * Phase 6A.4 comments, risks, issues, and action items.
 * Schedule variance and SPI are derived from planned/actual progress and
 * are therefore never part of the input.
 */
export const weeklyReportHeaderSchema = z.object({
  projectId: z.string().trim().min(1, "Select a project"),
  periodStart: weeklyPeriodStartSchema,
  preparedByContactId: z.string().trim().min(1, "Select who prepared the report"),
  status: z.enum(reportStatuses),
  disciplineIds: z
    .array(z.string().trim().min(1))
    .min(1, "Select at least one discipline")
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "A discipline can only be selected once"
    ),
  plannedProgress: progressPercentSchema,
  actualProgress: progressPercentSchema,
  manHoursToDate: manHoursSchema,
  hseStatus: z.enum(kpiRatings, "Select an HSE status"),
  qualityStatus: z.enum(kpiRatings, "Select a quality status"),
  overallProgressStatus: z.enum(progressStatuses, "Select an overall status"),
  departmentUpdates: z
    .array(departmentUpdateSchema)
    .superRefine((rows, ctx) => {
      const seen = new Map<string, number>();
      rows.forEach((row, index) => {
        if (!row.departmentId) return;
        // A department may appear once per discipline, not twice for the same one.
        const key = `${row.departmentId}::${row.disciplineId}`;
        const first = seen.get(key);
        if (first !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: [index, "departmentId"],
            message:
              "This department and discipline combination is already listed",
          });
        } else {
          seen.set(key, index);
        }
      });
    }),
  entries: z.array(weeklyEntrySchema),
});

export type WeeklyReportHeaderValues = z.infer<
  typeof weeklyReportHeaderSchema
>;

/** Snap any selected date to the Monday that starts its ISO reporting week. */
export function normalizeWeeklyPeriodStart(value: string): string {
  if (!isRealIsoDate(value)) return value;
  return format(getReportingWeekRange(value).start, "yyyy-MM-dd");
}

export function emptyWeeklyReportHeaderValues(): WeeklyReportHeaderValues {
  return {
    projectId: "",
    periodStart: normalizeWeeklyPeriodStart(format(new Date(), "yyyy-MM-dd")),
    preparedByContactId: "",
    status: "draft",
    disciplineIds: [],
    plannedProgress: Number.NaN,
    actualProgress: Number.NaN,
    manHoursToDate: Number.NaN,
    hseStatus: "good",
    qualityStatus: "good",
    overallProgressStatus: "on_track",
    departmentUpdates: [],
    entries: [],
  };
}

export function entriesToEntryValues(
  entries: WeeklyEntry[]
): WeeklyEntryValues[] {
  return entries.map((entry) => ({
    id: entry.id,
    entryType: entry.entryType,
    category: entry.category,
    description: entry.description,
    priority: entry.priority,
    status: entry.status,
    ownerContactId: entry.ownerContactId ?? "",
    dueDate: entry.dueDate ?? "",
    departmentId: entry.departmentId ?? "",
    systemId: entry.systemId ?? "",
    disciplineId: entry.disciplineId ?? "",
    includeInMonthly: entry.includeInMonthly,
  }));
}

export function submissionsToDepartmentUpdates(
  submissions: WeeklySubmission[]
): DepartmentUpdateValues[] {
  return submissions.map((submission) => ({
    id: submission.id,
    departmentId: submission.departmentId,
    disciplineId: submission.disciplineId ?? "",
    status: submission.status,
    summary: submission.summary ?? "",
    progressPercent: submission.progressPercent ?? Number.NaN,
    keyAchievement: submission.keyAchievement ?? "",
    delayConstraint: submission.delayConstraint ?? "",
    nextWeekPlan: submission.nextWeekPlan ?? "",
    responsibleContactId: submission.responsibleContactId ?? "",
    targetDate: submission.targetDate ?? "",
  }));
}

export function weeklyReportToHeaderValues(
  report: WeeklyReport,
  submissions: WeeklySubmission[] = [],
  entries: WeeklyEntry[] = []
): WeeklyReportHeaderValues {
  return {
    projectId: report.projectId,
    periodStart: report.periodStart,
    preparedByContactId: report.preparedByContactId ?? "",
    status: report.status,
    disciplineIds: [...report.disciplineIds],
    plannedProgress: report.plannedProgress,
    actualProgress: report.actualProgress,
    manHoursToDate: report.manHoursToDate ?? Number.NaN,
    hseStatus: report.hseStatus ?? "good",
    qualityStatus: report.qualityStatus ?? "good",
    overallProgressStatus: report.overallProgressStatus ?? "on_track",
    departmentUpdates: submissionsToDepartmentUpdates(submissions),
    entries: entriesToEntryValues(entries),
  };
}

import { format, getISODay, isValid, parseISO } from "date-fns";
import { z } from "zod";

import { getReportingWeekRange } from "@/lib/reporting";
import type { WeeklyActivity, WeeklyReport } from "@/types";

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
    // The work week runs Sunday–Thursday (spec §5), so the period starts on
    // a Sunday — ISO day 7.
    (value) => !isRealIsoDate(value) || getISODay(parseISO(value)) === 7,
    "The reporting period must start on Sunday"
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

/*
 * The "Department Updates" row schema that used to live here is gone.
 *
 * It backed a second editor for `weekly_submissions` — the same rows the
 * Weekly workspace edits per (report, department, scope item) — and it saved
 * through `saveSubmissions`, which DELETES every submission row on the report
 * and re-inserts the form's set. A department update written in the workspace
 * and then a Save Draft from this form would rewrite every row and reissue
 * every id; removing a row here deleted the workspace's work outright.
 *
 * Department and scope-item input now has exactly one editor: the workspace.
 * No stored data was dropped — the columns and every existing row are
 * untouched, and the report edit form simply no longer writes them.
 */

const activityStatuses = ["not_started", "in_progress", "completed"] as const;

/** One "Major Activities Completed" row (Phase W2). */
export const weeklyActivitySchema = z.object({
  id: z.string().optional(),
  title: z
    .string()
    .trim()
    .min(1, "Enter the activity")
    .max(300, "Keep the activity under 300 characters"),
  departmentId: z.string().trim(),
  disciplineId: z.string().trim(),
  ownerContactId: z.string().trim(),
  status: z.enum(activityStatuses),
  // Optional per row; NaN means "not tracked".
  progressPercent: looseNumber.superRefine((value, ctx) => {
    if (Number.isNaN(value)) return;
    if (value < 0 || value > 100) {
      ctx.addIssue({ code: "custom", message: "Must be between 0 and 100" });
      return;
    }
    if (!Number.isInteger(value)) {
      ctx.addIssue({ code: "custom", message: "Enter a whole percentage" });
    }
  }),
  remarks: z.string().trim().max(1000).optional().or(z.literal("")),
});

export type WeeklyActivityValues = z.infer<typeof weeklyActivitySchema>;

export function emptyWeeklyActivity(): WeeklyActivityValues {
  return {
    title: "",
    departmentId: "",
    disciplineId: "",
    ownerContactId: "",
    status: "not_started",
    progressPercent: Number.NaN,
    remarks: "",
  };
}

function activitiesToValues(
  activities: WeeklyActivity[]
): WeeklyActivityValues[] {
  return [...activities]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((activity) => ({
      id: activity.id,
      title: activity.title,
      departmentId: activity.departmentId ?? "",
      disciplineId: activity.disciplineId ?? "",
      ownerContactId: activity.ownerContactId ?? "",
      status: activity.status,
      progressPercent: activity.progressPercent ?? Number.NaN,
      remarks: activity.remarks ?? "",
    }));
}

/*
 * The entry schemas that used to live here are gone.
 *
 * They backed a second editor over `weekly_entries` — the same rows the
 * workspace edits — and saved through `saveEntries`, which DELETES every entry
 * on the report and re-inserts the form's set WITHOUT ids, so each surviving
 * row came back with a new uuid and a new `created_at`. A workspace tab open
 * at the time would then insert twins instead of updating, and the original
 * timestamps were lost — against the standing rule that comments and
 * snapshots stay immutable. The form also required an owner and a due date on
 * EVERY action, so one ownerless row aborted the whole Save Draft and
 * discarded unrelated header and KPI edits.
 *
 * Management items now have one editor (the workspace) and one save path
 * (`saveEntry` / `deleteEntry`, in place, one row at a time). No stored data
 * was removed.
 */

/**
 * Zod contract for the weekly-report form.
 *
 * Covers only what this form still owns: report identity, the progress KPIs,
 * the Executive Summary and the Major Activities. Department input and
 * management items are the workspace's, and are saved row by row there.
 * Schedule variance and SPI are derived from planned/actual progress and are
 * therefore never part of the input.
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
  /** Optional narrative; blank is a valid "not written yet" state. */
  executiveSummary: z
    .string()
    .trim()
    .max(5000, "Keep the executive summary under 5000 characters"),
  activities: z.array(weeklyActivitySchema),
});

export type WeeklyReportHeaderValues = z.infer<
  typeof weeklyReportHeaderSchema
>;

/**
 * Save Draft contract.
 *
 * Any selector can be cleared with its "×" while the report is being written,
 * so a required selector left empty must not block a draft. Only the required
 * *selectors* are relaxed here — formats, ranges, duplicate rules, and the
 * action-item rules all still apply, and `weeklyReportHeaderSchema` keeps
 * enforcing the full set for submission.
 *
 * `projectId` stays required even for a draft, because the row cannot exist
 * without it: `weekly_reports.project_id` is `not null` and the report number
 * is derived from the project code. It keeps its existing message.
 */
export const weeklyReportDraftSchema = weeklyReportHeaderSchema.extend({
  preparedByContactId: z.string().trim(),
  disciplineIds: z
    .array(z.string().trim().min(1))
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "A discipline can only be selected once"
    ),
});

/** Snap any selected date to the Sunday that starts its reporting week. */
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
    executiveSummary: "",
    activities: [],
  };
}

export function weeklyReportToHeaderValues(
  report: WeeklyReport,
  activities: WeeklyActivity[] = []
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
    executiveSummary: report.summary ?? "",
    activities: activitiesToValues(activities),
  };
}

import { z } from "zod";

/**
 * Initial reusable validation schemas (Phase 4C). Full report form schemas
 * are built on top of these in the form phases.
 */

export const reportStatusSchema = z.enum([
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
]);

export const prioritySchema = z.enum(["low", "medium", "high", "critical"]);

export const reportSourceSchema = z.enum([
  "platform",
  "admin_manual",
  "excel_import",
  "docx_import",
  "secure_link",
]);

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date (YYYY-MM-DD)");

export const reportingPeriodSchema = z
  .object({
    periodStart: isoDateSchema,
    periodEnd: isoDateSchema,
  })
  .refine((p) => p.periodStart <= p.periodEnd, {
    message: "Period start must be on or before period end",
    path: ["periodEnd"],
  });

/** Core project master-data fields (Phase 5A expands this). */
export const projectMetadataSchema = z.object({
  code: z
    .string()
    .min(2, "Project code is required")
    .max(20)
    .regex(/^[A-Z0-9-]+$/i, "Use letters, numbers, and dashes only"),
  name: z.string().min(3, "Project name is required").max(120),
  description: z.string().max(2000).optional(),
  clientId: z.string().optional(),
  status: z.enum([
    "draft",
    "planning",
    "active",
    "on_hold",
    "delayed",
    "completed",
    "cancelled",
    "archived",
  ]),
  priority: prioritySchema,
  startDate: isoDateSchema,
  endDate: isoDateSchema,
});

/** Identity of a weekly report (used by routes, imports, and numbering). */
export const weeklyReportIdentitySchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  year: z.number().int().min(2020).max(2100),
  weekNumber: z.number().int().min(1).max(53),
});

export const monthlyReportIdentitySchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
});

export const executiveReportIdentitySchema = z.object({
  title: z.string().min(3, "Title is required").max(160),
  periodType: z.enum(["weekly", "monthly", "quarterly", "annual"]),
  year: z.number().int().min(2020).max(2100),
});

export type ProjectMetadataInput = z.infer<typeof projectMetadataSchema>;
export type ReportingPeriodInput = z.infer<typeof reportingPeriodSchema>;
export type WeeklyReportIdentity = z.infer<typeof weeklyReportIdentitySchema>;
export type MonthlyReportIdentity = z.infer<typeof monthlyReportIdentitySchema>;
export type ExecutiveReportIdentity = z.infer<
  typeof executiveReportIdentitySchema
>;

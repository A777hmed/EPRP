import { z } from "zod";

/**
 * Zod schemas for database rows (Phase 5C). Used to validate data read
 * back from Supabase before it enters the UI, catching drift between the
 * schema and the app's expectations at runtime.
 */

const base = {
  id: z.string().uuid(),
  active: z.boolean(),
  archived_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
};

const nstr = z.string().nullable().optional();

export const clientRowSchema = z.object({
  ...base,
  name: z.string(),
  code: nstr,
  short_name: nstr,
  contact_name: nstr,
  contact_email: nstr,
  contact_phone: nstr,
  country: nstr,
  city: nstr,
  address: nstr,
  logo_ref: nstr,
});

export const projectTypeRowSchema = z.object({
  ...base,
  name: z.string(),
  code: nstr,
  description: nstr,
});

export const projectPhaseRowSchema = z.object({
  ...base,
  name: z.string(),
  code: nstr,
  description: nstr,
  display_order: z.number(),
});

export const departmentRowSchema = z.object({
  ...base,
  name: z.string(),
  code: z.string(),
  description: nstr,
  lead_contact_id: nstr,
});

export const contactRowSchema = z.object({
  ...base,
  name: z.string(),
  position: nstr,
  role: nstr,
  organization: nstr,
  email: nstr,
  phone: nstr,
  department_id: nstr,
});

export const systemRowSchema = z.object({
  ...base,
  name: z.string(),
  code: z.string(),
  department_id: nstr,
  description: nstr,
});

export const disciplineRowSchema = z.object({
  ...base,
  name: z.string(),
  code: z.string(),
  department_id: nstr,
  description: nstr,
});

export type ClientRowParsed = z.infer<typeof clientRowSchema>;

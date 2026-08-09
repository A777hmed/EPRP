/**
 * Typed database model (Phase 5C).
 *
 * Hand-written to match `supabase/migrations`. Once a Supabase project is
 * linked, this can be regenerated with:
 *   supabase gen types typescript --local > src/lib/supabase/database.types.ts
 */

type Timestamps = {
  active: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export interface ClientRow extends Timestamps {
  id: string;
  name: string;
  code: string | null;
  short_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  logo_ref: string | null;
}

export interface ProjectTypeRow extends Timestamps {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
}

export interface ProjectPhaseRow extends Timestamps {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  display_order: number;
}

export interface DepartmentRow extends Timestamps {
  id: string;
  name: string;
  code: string;
  description: string | null;
  lead_contact_id: string | null;
}

/** Collaboration Phase C1 — admin-managed job titles. */
export interface JobTitleRow extends Timestamps {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
}

export interface ContactRow extends Timestamps {
  id: string;
  name: string;
  position: string | null;
  /** Phase C1. Nullable; `position` is retained alongside it. */
  job_title_id: string | null;
  role: string | null;
  organization: string | null;
  email: string | null;
  phone: string | null;
  department_id: string | null;
}

export interface SystemRow extends Timestamps {
  id: string;
  name: string;
  code: string;
  department_id: string | null;
  description: string | null;
}

export interface DisciplineRow extends Timestamps {
  id: string;
  name: string;
  code: string;
  department_id: string | null;
  description: string | null;
}

export interface ProjectRow extends Timestamps {
  id: string;
  code: string;
  name: string;
  short_name: string | null;
  description: string | null;
  project_type_id: string | null;
  client_id: string;
  contract_number: string | null;
  purchase_order_number: string | null;
  contract_start_date: string | null;
  planned_start_date: string;
  actual_start_date: string | null;
  planned_finish_date: string;
  forecast_finish_date: string | null;
  actual_finish_date: string | null;
  project_manager_id: string;
  project_control_manager_id: string | null;
  client_representative_id: string | null;
  reporting_coordinator_id: string | null;
  project_sponsor_id: string | null;
  status: string;
  overall_status: string;
  planned_progress: number;
  actual_progress: number;
  current_phase_id: string | null;
  priority: string;
  weekly_enabled: boolean;
  monthly_enabled: boolean;
  executive_enabled: boolean;
  weekly_reporting_day: string;
  monthly_cutoff_day: number;
  currency: string;
  working_week: string;
  time_zone: string;
  site: string | null;
  country: string | null;
  city: string | null;
  client_contact_name: string | null;
  client_contact_email: string | null;
  client_contact_phone: string | null;
  project_logo_ref: string | null;
  client_logo_ref: string | null;
  report_header_title: string | null;
  report_footer_text: string | null;
  report_reference_prefix: string | null;
  default_language: string;
  include_qr_code: boolean;
  include_signature_section: boolean;
}

export interface ProjectDepartmentRow {
  id: string;
  project_id: string;
  department_id: string;
  lead_name: string | null;
  reporting_required: boolean;
  systems: { id: string; name: string; code?: string }[];
  created_at: string;
  updated_at: string;
}

export interface ProjectContactRow {
  id: string;
  project_id: string;
  contact_id: string;
  /** Responsibility role name, or "team_member" for wizard-added rows. */
  role: string;
  department_id: string | null;
  system_id: string | null;
  discipline_id: string | null;
  /** Project-specific team role; null on responsibility rows. */
  assignment_role: string | null;
  /** Free-text functional responsibility for this assignment. */
  functional_title: string | null;
  reports_to_contact_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Temporary weekly-responsibility delegation inside one project department. */
export interface ProjectDelegationRow {
  id: string;
  project_id: string;
  department_id: string;
  delegate_contact_id: string;
  responsibilities: string[];
  start_date: string;
  end_date: string;
  note: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectDisciplineRow {
  id: string;
  project_id: string;
  discipline_id: string;
  department_id: string | null;
  system_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Application identity for a Supabase auth user (Phase A1). */
export interface ProfileRow {
  /** Same id as the auth.users row. */
  id: string;
  email: string;
  full_name: string;
  role: string;
  contact_id: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WeeklyReportRow {
  id: string;
  report_number: string;
  project_id: string;
  status: string;
  source: string;
  week_number: number;
  period_start: string;
  period_end: string;
  planned_progress: number;
  actual_progress: number;
  prepared_by_contact_id: string | null;
  reviewed_by_contact_id: string | null;
  approved_by_contact_id: string | null;
  discipline_ids: string[];
  man_hours_to_date: number | null;
  hse_status: string | null;
  quality_status: string | null;
  overall_progress_status: string | null;
  /** Report-level Executive Summary (spec section 5). */
  summary: string | null;
  active: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WeeklySubmissionRow {
  id: string;
  weekly_report_id: string;
  department_id: string;
  discipline_id: string | null;
  status: string;
  progress_delta: number | null;
  progress_percent: number | null;
  summary: string | null;
  key_achievement: string | null;
  delay_constraint: string | null;
  next_week_plan: string | null;
  responsible_contact_id: string | null;
  target_date: string | null;
  /** Department verdict on the work (spec section 7). */
  health_status: string | null;
  risks_issues: string | null;
  /** Written by the review workflow in a later phase. */
  return_reason: string | null;
  reviewed_by_contact_id: string | null;
  reviewed_at: string | null;
  accomplishments: string[];
  planned_next_week: string[];
  blockers: string[];
  submitted_by_contact_id: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WeeklyEntryRow {
  id: string;
  weekly_report_id: string;
  entry_type: string;
  category: string;
  description: string;
  priority: string;
  status: string;
  owner_contact_id: string | null;
  due_date: string | null;
  department_id: string | null;
  system_id: string | null;
  discipline_id: string | null;
  include_in_monthly: boolean;
  created_at: string;
  updated_at: string;
}

export interface WeeklyActivityRow {
  id: string;
  weekly_report_id: string;
  title: string;
  department_id: string | null;
  discipline_id: string | null;
  owner_contact_id: string | null;
  status: string;
  progress_percent: number | null;
  remarks: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface OrganizationChartRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  status: string;
  source: string;
  chart_type: string | null;
  effective_date: string | null;
  version: number;
  is_current: boolean;
  supersedes_chart_id: string | null;
  active: boolean;
  archived_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrganizationPositionRow {
  id: string;
  chart_id: string;
  project_id: string;
  parent_position_id: string | null;
  title: string;
  code: string | null;
  role: string | null;
  notes: string | null;
  department_id: string | null;
  discipline_id: string | null;
  contact_id: string | null;
  company: string | null;
  employment_type: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  sort_order: number;
  active: boolean;
  archived_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PositionAssignmentHistoryRow {
  id: string;
  position_id: string;
  chart_id: string;
  project_id: string;
  contact_id: string | null;
  previous_contact_id: string | null;
  action: string;
  effective_from: string;
  effective_to: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

type TableDef<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
};

/** Insert/Update payloads omit server-managed columns. */
type Writable<Row> = Partial<
  Omit<Row, "id" | "created_at" | "updated_at" | "archived_at">
>;

export interface Database {
  public: {
    Tables: {
      clients: TableDef<ClientRow, Writable<ClientRow> & { name: string }, Writable<ClientRow>>;
      project_types: TableDef<ProjectTypeRow, Writable<ProjectTypeRow> & { name: string }, Writable<ProjectTypeRow>>;
      project_phases: TableDef<ProjectPhaseRow, Writable<ProjectPhaseRow> & { name: string }, Writable<ProjectPhaseRow>>;
      departments: TableDef<DepartmentRow, Writable<DepartmentRow> & { name: string; code: string }, Writable<DepartmentRow>>;
      contacts: TableDef<ContactRow, Writable<ContactRow> & { name: string }, Writable<ContactRow>>;
      job_titles: TableDef<JobTitleRow, Writable<JobTitleRow> & { name: string }, Writable<JobTitleRow>>;
      systems: TableDef<SystemRow, Writable<SystemRow> & { name: string; code: string }, Writable<SystemRow>>;
      disciplines: TableDef<DisciplineRow, Writable<DisciplineRow> & { name: string; code: string }, Writable<DisciplineRow>>;
      projects: TableDef<ProjectRow, Writable<ProjectRow>, Writable<ProjectRow>>;
      project_departments: TableDef<ProjectDepartmentRow, Omit<ProjectDepartmentRow, "id" | "created_at" | "updated_at">, Partial<ProjectDepartmentRow>>;
      project_contacts: TableDef<ProjectContactRow, Omit<ProjectContactRow, "id" | "created_at" | "updated_at">, Partial<ProjectContactRow>>;
      project_delegations: TableDef<ProjectDelegationRow, Omit<ProjectDelegationRow, "id" | "created_at" | "updated_at" | "created_by">, Partial<ProjectDelegationRow>>;
      project_disciplines: TableDef<ProjectDisciplineRow, Omit<ProjectDisciplineRow, "id" | "created_at" | "updated_at">, Partial<ProjectDisciplineRow>>;
      organization_charts: TableDef<OrganizationChartRow, Writable<OrganizationChartRow> & { project_id: string; name: string }, Writable<OrganizationChartRow>>;
      organization_positions: TableDef<OrganizationPositionRow, Writable<OrganizationPositionRow> & { chart_id: string; project_id: string; title: string }, Writable<OrganizationPositionRow>>;
      position_assignment_history: TableDef<PositionAssignmentHistoryRow, Omit<PositionAssignmentHistoryRow, "id" | "created_at">, Partial<PositionAssignmentHistoryRow>>;
      profiles: TableDef<ProfileRow, Omit<ProfileRow, "created_at" | "updated_at">, Partial<ProfileRow>>;
      weekly_reports: TableDef<WeeklyReportRow, Writable<WeeklyReportRow> & { report_number: string; project_id: string; week_number: number; period_start: string; period_end: string }, Writable<WeeklyReportRow>>;
      weekly_submissions: TableDef<WeeklySubmissionRow, Omit<WeeklySubmissionRow, "id" | "created_at" | "updated_at">, Partial<WeeklySubmissionRow>>;
      weekly_entries: TableDef<WeeklyEntryRow, Omit<WeeklyEntryRow, "id" | "created_at" | "updated_at">, Partial<WeeklyEntryRow>>;
      weekly_activities: TableDef<WeeklyActivityRow, Omit<WeeklyActivityRow, "id" | "created_at" | "updated_at">, Partial<WeeklyActivityRow>>;
    };
  };
}

export type TableName = keyof Database["public"]["Tables"];

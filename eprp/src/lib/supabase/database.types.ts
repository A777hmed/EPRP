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
  /** Nullable only during membership-first project creation staging. */
  project_manager_id: string | null;
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

export interface ProjectSiteRow extends Timestamps {
  id: string;
  project_id: string;
  name: string;
  country: string | null;
  city: string | null;
  is_primary: boolean;
  sort_order: number;
}

/** Additional project positions — see 20260818000001_project_positions.sql. */
export interface ProjectPositionRow extends Timestamps {
  id: string;
  project_id: string;
  job_title_id: string;
  contact_id: string;
  notes: string | null;
  sort_order: number;
}

/** Phase 13.2 — see 20260819000003_master_milestones.sql. */
export interface MasterMilestoneRow extends Timestamps {
  id: string;
  project_id: string;
  code: string;
  name: string;
  description: string | null;
  department_id: string | null;
  system_id: string | null;
  discipline_id: string | null;
  baseline_date: string | null;
  priority: string;
  owner_contact_id: string | null;
  source: string;
  source_document_id: string | null;
  active: boolean;
  archived_at: string | null;

  /* Phase 13.2c — see 20260822000003_master_milestone_completion.sql. */
  /** technical | contractual | commercial. Decides which fields apply. */
  milestone_type: string;
  /** Project-chosen label within the type. Free text, never a lookup. */
  category: string | null;
  /** The current agreed date. `baseline_date` stays the frozen reference. */
  planned_date: string | null;
  /** Share of PHYSICAL scope. Refused on commercial rows by CHECK. */
  weight_percent: number | null;
  planned_progress_percent: number | null;
  predecessor_milestone_id: string | null;
  client_approval_required: boolean;
  notes: string | null;
  /* Commercial PLAN — what was agreed. Actuals are reported per update. */
  payment_percent: number | null;
  payment_amount: number | null;
  payment_due_date: string | null;
  is_advance_payment: boolean;
}

export interface MilestoneUpdateRow {
  id: string;
  milestone_id: string;
  source: string;
  weekly_report_id: string | null;
  monthly_report_id: string | null;
  department_id: string | null;
  discipline_id: string | null;
  status: string;
  progress_percent: number | null;
  forecast_date: string | null;
  actual_date: string | null;
  narrative: string | null;
  approval_status: string;
  approved_by_contact_id: string | null;
  approved_at: string | null;
  decision_note: string | null;
  is_regression: boolean;
  regression_reason: string | null;
  submitted_by_contact_id: string | null;
  submitted_at: string;

  /* Phase 13.2c — commercial ACTUALS, reported and governed like progress. */
  payment_status: string | null;
  invoice_reference: string | null;
  invoiced_date: string | null;
  received_date: string | null;
  /** Money recovered. Recovery % and outstanding advance are derived. */
  recovered_amount: number | null;
  /** What the CLIENT did — never the same field as `approval_status`. */
  client_approval_status: string | null;
  client_approval_date: string | null;

  /* Phase 13.2d — see 20260822000004_milestone_reconciliation.sql. */
  /** The cut-off this describes. Not `submitted_at`, which is when it arrived. */
  as_of_date: string | null;
  /** For a reconciliation: the reported row whose value was adopted. */
  adopted_from_update_id: string | null;
  reconciliation_reason: string | null;
}

/** Phase 13.3 — see 20260819000004_master_deliverables.sql. */
export interface MasterDeliverableRow extends Timestamps {
  id: string;
  project_id: string;
  code: string;
  title: string;
  description: string | null;
  department_id: string | null;
  system_id: string | null;
  discipline_id: string | null;
  owner_contact_id: string | null;
  /** References master_milestones — never a copy of anything on it. */
  milestone_id: string | null;
  planned_submission_date: string | null;
  revision: string | null;
  document_id: string | null;
  active: boolean;
  archived_at: string | null;
}

export interface DeliverableUpdateRow {
  id: string;
  deliverable_id: string;
  source: string;
  weekly_report_id: string | null;
  monthly_report_id: string | null;
  department_id: string | null;
  discipline_id: string | null;
  /** D6 — REPORTED DATA: what the client did. Not a decision of ours. */
  client_review_status: string;
  client_review_date: string | null;
  client_reference: string | null;
  forecast_date: string | null;
  actual_submission_date: string | null;
  revision: string | null;
  narrative: string | null;
  /** D6 — GOVERNANCE: whether Project Control accepts the report above. */
  approval_status: string;
  approved_by_contact_id: string | null;
  approved_at: string | null;
  decision_note: string | null;
  submitted_by_contact_id: string | null;
  submitted_at: string;
}

export interface ProjectDocumentRow {
  id: string;
  project_id: string;
  title: string;
  document_type: string;
  document_number: string | null;
  revision: string | null;
  issue_date: string | null;
  /** Phase 13.1 — see 20260819000001_reference_input_metadata.sql. */
  effective_date: string | null;
  source: string | null;
  superseded_by_document_id: string | null;
  /** Phase 13.1 two-stage delete — see 20260819000002_document_soft_delete.sql. */
  deleted_at: string | null;
  deleted_by: string | null;
  deleted_by_name: string | null;
  delete_reason: string | null;
  status: string;
  notes: string | null;
  file_name: string;
  mime_type: string;
  file_size: number;
  storage_path: string;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectDepartmentRow {
  id: string;
  project_id: string;
  department_id: string;
  project_description: string | null;
  lead_name: string | null;
  reporting_required: boolean;
  systems: {
    id: string;
    name: string;
    code?: string;
    projectDescription?: string;
  }[];
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
  /**
   * Sign-off snapshot — `{ prepared: [...], reviewed: [...], approved: [...] }`.
   * `unknown` because the column is jsonb and its shape is enforced by a
   * database check constraint, not by this type; readers must parse it
   * defensively. See migration 20260816000001_weekly_signatories.sql.
   */
  signatories: unknown;
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
  /** Distribution timing — see 20260816000002_weekly_distribution.sql. */
  sent_at: string | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WeeklyEntryRow {
  id: string;
  weekly_report_id: string;
  entry_type: string;
  update_type: string;
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
  created_by_contact_id: string | null;
  updated_by_contact_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WeeklyPlanItemRow {
  id: string;
  weekly_report_id: string;
  kind: string;
  title: string;
  start_date: string | null;
  end_date: string;
  owner_contact_id: string | null;
  department_id: string | null;
  status: string;
  sort_order: number;
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

export interface MonthlyReportRow {
  id: string;
  report_number: string;
  project_id: string;
  reporting_month: string;
  status: string;
  prepared_by_contact_id: string | null;
  reviewed_by_contact_id: string | null;
  approved_by_contact_id: string | null;
  planned_progress: number;
  actual_progress: number;
  hse_status: string | null;
  quality_status: string | null;
  overall_progress_status: string | null;
  executive_summary: string | null;
  active: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MonthlyCommentRow {
  id: string;
  monthly_report_id: string;
  source_weekly_entry_id: string | null;
  source_weekly_report_id: string | null;
  source_kind: string;
  week_number: number | null;
  department_id: string | null;
  system_id: string | null;
  discipline_id: string | null;
  update_type: string;
  original_text: string;
  presentation_text: string | null;
  priority: string;
  status: string;
  responsible_contact_id: string | null;
  target_date: string | null;
  include_in_final: boolean;
  escalate_to_management: boolean;
  is_major_achievement: boolean;
  created_by_contact_id: string | null;
  updated_by_contact_id: string | null;
  source_created_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MonthlyDepartmentSummaryRow {
  id: string;
  monthly_report_id: string;
  department_id: string;
  system_id: string | null;
  discipline_id: string | null;
  monthly_summary: string | null;
  key_achievements: string | null;
  challenges: string | null;
  outstanding_actions: string | null;
  next_month_plan: string | null;
  created_by_contact_id: string | null;
  updated_by_contact_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MonthlyPlanItemRow {
  id: string;
  monthly_report_id: string;
  title: string;
  department_id: string | null;
  start_date: string | null;
  target_date: string | null;
  owner_contact_id: string | null;
  status: string;
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
      project_sites: TableDef<
        ProjectSiteRow,
        Writable<ProjectSiteRow>,
        Writable<ProjectSiteRow>
      >;
      project_positions: TableDef<
        ProjectPositionRow,
        Writable<ProjectPositionRow>,
        Writable<ProjectPositionRow>
      >;
      master_milestones: TableDef<
        MasterMilestoneRow,
        Writable<MasterMilestoneRow>,
        Writable<MasterMilestoneRow>
      >;
      milestone_updates: TableDef<
        MilestoneUpdateRow,
        Omit<MilestoneUpdateRow, "id" | "submitted_at"> & {
          id?: string;
          submitted_at?: string;
        },
        Partial<MilestoneUpdateRow>
      >;
      master_deliverables: TableDef<
        MasterDeliverableRow,
        Writable<MasterDeliverableRow>,
        Writable<MasterDeliverableRow>
      >;
      deliverable_updates: TableDef<
        DeliverableUpdateRow,
        Omit<DeliverableUpdateRow, "id" | "submitted_at"> & {
          id?: string;
          submitted_at?: string;
        },
        Partial<DeliverableUpdateRow>
      >;
      project_documents: TableDef<
        ProjectDocumentRow,
        Omit<
          ProjectDocumentRow,
          "created_at" | "updated_at" | "uploaded_by" | "uploaded_by_name"
        > & {
          uploaded_by?: string | null;
          uploaded_by_name?: string | null;
        },
        Partial<ProjectDocumentRow>
      >;
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
      weekly_plan_items: TableDef<WeeklyPlanItemRow, Omit<WeeklyPlanItemRow, "id" | "created_at" | "updated_at">, Partial<WeeklyPlanItemRow>>;
      weekly_activities: TableDef<WeeklyActivityRow, Omit<WeeklyActivityRow, "id" | "created_at" | "updated_at">, Partial<WeeklyActivityRow>>;
      monthly_reports: TableDef<MonthlyReportRow, Omit<MonthlyReportRow, "id" | "created_at" | "updated_at" | "active" | "archived_at">, Partial<MonthlyReportRow>>;
      monthly_comments: TableDef<MonthlyCommentRow, Omit<MonthlyCommentRow, "id" | "created_at" | "updated_at" | "created_by_contact_id" | "updated_by_contact_id">, Partial<MonthlyCommentRow>>;
      monthly_department_summaries: TableDef<MonthlyDepartmentSummaryRow, Omit<MonthlyDepartmentSummaryRow, "id" | "created_at" | "updated_at" | "created_by_contact_id" | "updated_by_contact_id">, Partial<MonthlyDepartmentSummaryRow>>;
      monthly_plan_items: TableDef<MonthlyPlanItemRow, Omit<MonthlyPlanItemRow, "id" | "created_at" | "updated_at">, Partial<MonthlyPlanItemRow>>;
    };
  };
}

export type TableName = keyof Database["public"]["Tables"];

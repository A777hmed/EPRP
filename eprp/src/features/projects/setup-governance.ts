/**
 * Phase 13.9B — Project Setup Governance (Step 1: governance core).
 *
 * The TypeScript mirror of the database's authoritative field registry,
 * `project_setup_field_registry()` (migration 20261016090000). It must stay
 * IDENTICAL to the SQL rows: `setup-governance.test.mjs` parses the migration
 * and compares every field. The database is what enforces the classes; this
 * copy lets the application label fields and choose the right action without
 * a round trip. Docs: `02` §26.24.2 / §26.24.2a, `06` §10A.11.7.
 *
 * Classes: free_logged · lightweight · governed · system_admin_correction ·
 * superseded · planning_owned · retired. `futureClass` / `futureSlice` record
 * the approved later state; nothing enforces them before that slice ships.
 */

export type SetupFieldClass =
  | "free_logged"
  | "lightweight"
  | "governed"
  | "system_admin_correction"
  | "superseded"
  | "planning_owned"
  | "retired";

export const SETUP_FIELD_CLASSES: readonly SetupFieldClass[] = [
  "free_logged",
  "lightweight",
  "governed",
  "system_admin_correction",
  "superseded",
  "planning_owned",
  "retired",
];

export interface SetupFieldRegistryEntry {
  fieldKey: string;
  /** `column`: stored columns of `targetTable`. `relation`: governed elsewhere (`enforcedFrom`). */
  kind: "column" | "relation";
  targetTable: string;
  targetColumns: readonly string[];
  fieldClass: SetupFieldClass;
  futureClass: SetupFieldClass | null;
  futureSlice: string | null;
  enforcedFrom: string;
  label: string;
  impactCode: string | null;
  impactWarning: string | null;
}

export const SETUP_FIELD_REGISTRY: readonly SetupFieldRegistryEntry[] = [
  { fieldKey: "status", kind: "column", targetTable: "projects", targetColumns: ["status"], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Project Lifecycle Status", impactCode: null, impactWarning: null },
  { fieldKey: "current_phase_id", kind: "column", targetTable: "projects", targetColumns: ["current_phase_id"], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Project Lifecycle Phase", impactCode: null, impactWarning: null },
  { fieldKey: "portfolio_group_id", kind: "column", targetTable: "projects", targetColumns: ["portfolio_group_id"], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Portfolio / Reporting Group", impactCode: null, impactWarning: null },
  { fieldKey: "description", kind: "column", targetTable: "projects", targetColumns: ["description"], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Description", impactCode: null, impactWarning: null },
  { fieldKey: "project_manager_id", kind: "column", targetTable: "projects", targetColumns: ["project_manager_id"], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Project Manager", impactCode: null, impactWarning: null },
  { fieldKey: "project_control_manager_id", kind: "column", targetTable: "projects", targetColumns: ["project_control_manager_id"], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Project Control Manager", impactCode: null, impactWarning: null },
  { fieldKey: "client_representative_id", kind: "column", targetTable: "projects", targetColumns: ["client_representative_id"], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Client Representative", impactCode: null, impactWarning: null },
  { fieldKey: "reporting_coordinator_id", kind: "column", targetTable: "projects", targetColumns: ["reporting_coordinator_id"], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Reporting Coordinator", impactCode: null, impactWarning: null },
  { fieldKey: "project_sponsor_id", kind: "column", targetTable: "projects", targetColumns: ["project_sponsor_id"], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Project Sponsor", impactCode: null, impactWarning: null },
  { fieldKey: "site", kind: "column", targetTable: "projects", targetColumns: ["site"], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Site", impactCode: null, impactWarning: null },
  { fieldKey: "country", kind: "column", targetTable: "projects", targetColumns: ["country"], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Country", impactCode: null, impactWarning: null },
  { fieldKey: "city", kind: "column", targetTable: "projects", targetColumns: ["city"], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "City", impactCode: null, impactWarning: null },
  { fieldKey: "client_contact_name", kind: "column", targetTable: "projects", targetColumns: ["client_contact_name"], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Client Contact Name", impactCode: null, impactWarning: null },
  { fieldKey: "client_contact_email", kind: "column", targetTable: "projects", targetColumns: ["client_contact_email"], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Client Contact Email", impactCode: null, impactWarning: null },
  { fieldKey: "client_contact_phone", kind: "column", targetTable: "projects", targetColumns: ["client_contact_phone"], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Client Contact Phone", impactCode: null, impactWarning: null },
  { fieldKey: "project_logo_ref", kind: "column", targetTable: "projects", targetColumns: ["project_logo_ref"], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Project Logo", impactCode: null, impactWarning: null },
  { fieldKey: "client_logo_ref", kind: "column", targetTable: "projects", targetColumns: ["client_logo_ref"], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Client Logo", impactCode: null, impactWarning: null },
  { fieldKey: "report_header_title", kind: "column", targetTable: "projects", targetColumns: ["report_header_title"], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Report Header Title", impactCode: null, impactWarning: null },
  { fieldKey: "report_footer_text", kind: "column", targetTable: "projects", targetColumns: ["report_footer_text"], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Report Footer Text", impactCode: null, impactWarning: null },
  { fieldKey: "report_reference_prefix", kind: "column", targetTable: "projects", targetColumns: ["report_reference_prefix"], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Report Reference Prefix", impactCode: null, impactWarning: null },
  { fieldKey: "default_language", kind: "column", targetTable: "projects", targetColumns: ["default_language"], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Default Language", impactCode: null, impactWarning: null },
  { fieldKey: "include_qr_code", kind: "column", targetTable: "projects", targetColumns: ["include_qr_code"], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Include QR Code", impactCode: null, impactWarning: null },
  { fieldKey: "include_signature_section", kind: "column", targetTable: "projects", targetColumns: ["include_signature_section"], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Include Signature Section", impactCode: null, impactWarning: null },
  { fieldKey: "team", kind: "relation", targetTable: "project_members", targetColumns: [], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "own_history", label: "Project Team and Responsibilities", impactCode: null, impactWarning: null },
  { fieldKey: "positions", kind: "relation", targetTable: "organization_positions", targetColumns: [], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "own_history", label: "Positions", impactCode: null, impactWarning: null },
  { fieldKey: "contacts", kind: "relation", targetTable: "project_contacts", targetColumns: [], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-3", label: "Contacts", impactCode: null, impactWarning: null },
  { fieldKey: "sites", kind: "relation", targetTable: "project_sites", targetColumns: [], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-3", label: "Sites", impactCode: null, impactWarning: null },
  { fieldKey: "parties", kind: "relation", targetTable: "project_parties", targetColumns: [], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-3", label: "Subcontractors and Parties", impactCode: null, impactWarning: null },
  { fieldKey: "structure_display_order", kind: "relation", targetTable: "project_structure_nodes", targetColumns: [], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-4", label: "Structure Display Order", impactCode: null, impactWarning: null },
  { fieldKey: "structure_notes", kind: "relation", targetTable: "project_structure_nodes", targetColumns: [], fieldClass: "free_logged", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-4", label: "Structure Descriptions and Notes", impactCode: null, impactWarning: null },
  { fieldKey: "name", kind: "column", targetTable: "projects", targetColumns: ["name"], fieldClass: "lightweight", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Project Name", impactCode: "DISPLAY_IDENTITY", impactWarning: "Approved reports keep the name they were approved with." },
  { fieldKey: "short_name", kind: "column", targetTable: "projects", targetColumns: ["short_name"], fieldClass: "lightweight", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Short Name", impactCode: "DISPLAY_IDENTITY", impactWarning: "Approved reports keep the short name they were approved with." },
  { fieldKey: "contract_number", kind: "column", targetTable: "projects", targetColumns: ["contract_number"], fieldClass: "lightweight", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Contract Number", impactCode: "COMMERCIAL_REFERENCE", impactWarning: "Approved reports keep the contract number they were approved with." },
  { fieldKey: "purchase_order_number", kind: "column", targetTable: "projects", targetColumns: ["purchase_order_number"], fieldClass: "lightweight", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "PO Number", impactCode: "COMMERCIAL_REFERENCE", impactWarning: "Approved reports keep the PO number they were approved with." },
  { fieldKey: "actual_start_date", kind: "column", targetTable: "projects", targetColumns: ["actual_start_date"], fieldClass: "lightweight", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Actual Start", impactCode: "RECORDED_DATE", impactWarning: "Approved reports keep the actual start they were approved with." },
  { fieldKey: "actual_finish_date", kind: "column", targetTable: "projects", targetColumns: ["actual_finish_date"], fieldClass: "lightweight", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Actual Finish", impactCode: "RECORDED_DATE", impactWarning: "Approved reports keep the actual finish they were approved with." },
  { fieldKey: "code", kind: "column", targetTable: "projects", targetColumns: ["code"], fieldClass: "governed", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Project Code", impactCode: "REPORT_IDENTITY", impactWarning: "Approved reports keep the old code. Report references issued from now on use the new code." },
  { fieldKey: "client_id", kind: "column", targetTable: "projects", targetColumns: ["client_id"], fieldClass: "governed", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Client / Owner", impactCode: "REPORT_IDENTITY", impactWarning: "Approved reports keep the client they were approved with." },
  { fieldKey: "project_category", kind: "column", targetTable: "projects", targetColumns: ["project_type_id", "project_category_detail"], fieldClass: "governed", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Project Category / Classification", impactCode: "CLASSIFICATION", impactWarning: "Changes how the project is grouped and filtered. Approved reports keep their recorded classification." },
  { fieldKey: "onboarding_mode", kind: "column", targetTable: "project_planning_settings", targetColumns: ["onboarding_mode"], fieldClass: "governed", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Planning Onboarding Mode", impactCode: "PLANNING_GOVERNANCE", impactWarning: "Changes how this project is planned. Published snapshots, Opening Positions and reported progress stay as recorded history." },
  { fieldKey: "weekly_enabled", kind: "column", targetTable: "projects", targetColumns: ["weekly_enabled"], fieldClass: "governed", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Weekly Reporting", impactCode: "REPORTING_FREQUENCY", impactWarning: "Applies from the next unopened period; existing periods and reports are unchanged." },
  { fieldKey: "monthly_enabled", kind: "column", targetTable: "projects", targetColumns: ["monthly_enabled"], fieldClass: "governed", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Monthly Reporting", impactCode: "REPORTING_FREQUENCY", impactWarning: "Applies from the next unopened period; existing periods and reports are unchanged." },
  { fieldKey: "executive_enabled", kind: "column", targetTable: "projects", targetColumns: ["executive_enabled"], fieldClass: "governed", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Executive Reporting", impactCode: "REPORTING_FREQUENCY", impactWarning: "Applies from the next unopened period; existing periods and reports are unchanged." },
  { fieldKey: "weekly_reporting_day", kind: "column", targetTable: "projects", targetColumns: ["weekly_reporting_day"], fieldClass: "governed", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Weekly Reporting Day", impactCode: "REPORTING_PERIOD", impactWarning: "Applies from the next unopened period; existing periods are unchanged." },
  { fieldKey: "monthly_cutoff_day", kind: "column", targetTable: "projects", targetColumns: ["monthly_cutoff_day"], fieldClass: "governed", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Reporting Cut-off", impactCode: "REPORTING_PERIOD", impactWarning: "Applies from the next unopened period; existing periods are unchanged." },
  { fieldKey: "working_week", kind: "column", targetTable: "projects", targetColumns: ["working_week"], fieldClass: "governed", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Working Week", impactCode: "REPORTING_PERIOD", impactWarning: "Applies from the next unopened period; existing periods are unchanged." },
  { fieldKey: "time_zone", kind: "column", targetTable: "projects", targetColumns: ["time_zone"], fieldClass: "governed", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Time Zone", impactCode: "REPORTING_PERIOD", impactWarning: "Applies from the next unopened period; existing periods and recorded dates are unchanged." },
  { fieldKey: "currency", kind: "column", targetTable: "projects", targetColumns: ["currency"], fieldClass: "governed", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Currency", impactCode: "COMMERCIAL_INTERPRETATION", impactWarning: "Recorded amounts are not converted. Approved reports keep the currency they were approved with." },
  { fieldKey: "milestone_update_approval", kind: "column", targetTable: "projects", targetColumns: ["milestone_update_approval"], fieldClass: "governed", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Milestone Update Approval", impactCode: "APPROVAL_POLICY", impactWarning: "Applies to milestone updates submitted from now on; decided updates are unchanged." },
  { fieldKey: "contract_start_date", kind: "column", targetTable: "projects", targetColumns: ["contract_start_date"], fieldClass: "governed", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Contract Start", impactCode: "CONTRACTUAL_DATE", impactWarning: "Approved reports keep the contract start they were approved with." },
  { fieldKey: "forecast_finish_date", kind: "column", targetTable: "projects", targetColumns: ["forecast_finish_date"], fieldClass: "governed", futureClass: "planning_owned", futureSlice: "13.14", enforcedFrom: "13.9B-1", label: "Forecast Finish", impactCode: "SCHEDULE_REFERENCE", impactWarning: "Approved reports keep the forecast they were approved with. Published Planning Snapshots are unchanged." },
  { fieldKey: "planned_start_date", kind: "column", targetTable: "projects", targetColumns: ["planned_start_date"], fieldClass: "governed", futureClass: "superseded", futureSlice: "13.12", enforcedFrom: "13.9B-1", label: "Planned Start", impactCode: "SCHEDULE_REFERENCE", impactWarning: "Approved reports and Published Planning Snapshots keep their recorded dates." },
  { fieldKey: "planned_finish_date", kind: "column", targetTable: "projects", targetColumns: ["planned_finish_date"], fieldClass: "governed", futureClass: "superseded", futureSlice: "13.12", enforcedFrom: "13.9B-1", label: "Planned Finish", impactCode: "SCHEDULE_REFERENCE", impactWarning: "Approved reports and Published Planning Snapshots keep their recorded dates." },
  { fieldKey: "structure_departments", kind: "relation", targetTable: "project_departments", targetColumns: [], fieldClass: "governed", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-4", label: "Departments and their scope", impactCode: "STRUCTURE_SCOPE", impactWarning: "Changes the reporting structure. Approved reports keep the structure they were approved with." },
  { fieldKey: "structure_disciplines", kind: "relation", targetTable: "project_disciplines", targetColumns: [], fieldClass: "governed", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-4", label: "Systems and Programs & Studies", impactCode: "STRUCTURE_SCOPE", impactWarning: "Changes the reporting structure. Approved reports keep the structure they were approved with." },
  { fieldKey: "structure_levels", kind: "relation", targetTable: "project_structure_levels", targetColumns: [], fieldClass: "governed", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-4", label: "Structure Levels (add, remove, rename)", impactCode: "STRUCTURE_SCOPE", impactWarning: "Changes the reporting structure. Approved reports keep the structure they were approved with." },
  { fieldKey: "structure_units", kind: "relation", targetTable: "project_structure_nodes", targetColumns: [], fieldClass: "governed", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-4", label: "Structure Units (add, remove, archive, re-parent, rename, reporting scope)", impactCode: "STRUCTURE_SCOPE", impactWarning: "Changes the reporting structure. Approved reports keep the structure they were approved with." },
  { fieldKey: "structure_family", kind: "column", targetTable: "projects", targetColumns: ["structure_family"], fieldClass: "system_admin_correction", futureClass: null, futureSlice: null, enforcedFrom: "2C.1", label: "Project Type", impactCode: null, impactWarning: null },
  { fieldKey: "priority", kind: "column", targetTable: "projects", targetColumns: ["priority"], fieldClass: "retired", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Priority", impactCode: null, impactWarning: null },
  { fieldKey: "overall_status", kind: "column", targetTable: "projects", targetColumns: ["overall_status"], fieldClass: "retired", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Overall Status", impactCode: null, impactWarning: null },
  { fieldKey: "planned_progress", kind: "column", targetTable: "projects", targetColumns: ["planned_progress"], fieldClass: "retired", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Typed Planned Progress", impactCode: null, impactWarning: null },
  { fieldKey: "actual_progress", kind: "column", targetTable: "projects", targetColumns: ["actual_progress"], fieldClass: "retired", futureClass: null, futureSlice: null, enforcedFrom: "13.9B-1", label: "Typed Actual Progress", impactCode: null, impactWarning: null },
];

/** `projects` columns the registry deliberately leaves out (`project_setup_system_columns()`). */
export const SETUP_SYSTEM_COLUMNS: readonly string[] = ["id", "active", "archived_at", "created_at", "updated_at"];

export function setupFieldEntry(fieldKey: string): SetupFieldRegistryEntry | undefined {
  return SETUP_FIELD_REGISTRY.find((entry) => entry.fieldKey === fieldKey);
}

/** The registry entry that governs a stored `projects` column, if any. */
export function setupFieldForColumn(column: string): SetupFieldRegistryEntry | undefined {
  return SETUP_FIELD_REGISTRY.find(
    (entry) => entry.kind === "column" && entry.targetTable === "projects" && entry.targetColumns.includes(column)
  );
}

/**
 * The tagged refusals the 13.9B database functions and guards raise. Each
 * message is written as a sentence for the user after its tag, so the
 * application shows the sentence and never the tag or the SQLSTATE.
 */
export const SETUP_GOVERNANCE_REFUSAL_TAGS = [
  "SETUP_CONTROLLED",
  "SETUP_FIELD_RETIRED",
  "SETUP_NOT_CONTROLLED",
  "SETUP_CONTROL_CONFIRMATION_REQUIRED",
  "NO_FORMAL_SCHEDULE",
  "ONBOARDING_TRANSITION_PROHIBITED",
  "FIELD_NOT_AMENDABLE",
  "REASON_REQUIRED",
  "INVALID_VALUE",
  "NO_CHANGE",
  "STALE_BASE",
  "AMENDMENT_PENDING",
  "AMENDMENT_NOT_PENDING",
  "SELF_APPROVAL",
  "DECISION_COMMENT_REQUIRED",
  "INVALID_DECISION",
  "SETUP_HISTORY_IMMUTABLE",
  // Step 2: Setup Finalisation and Reported Progress (migration 20261017090000).
  "FINALISE_CONFIRMATION_REQUIRED",
  "FINALISE_WRONG_MODE",
  "SETUP_ALREADY_CONTROLLED",
  "SETUP_ALREADY_FINALISED",
  "SETUP_NOT_FINALISED",
  "REPORTED_PROGRESS_NOT_ALLOWED",
  "REPORTED_PROGRESS_DATE_EXISTS",
  "DATA_DATE_IN_FUTURE",
  "BACKDATE_REASON_REQUIRED",
  "NARRATIVE_REQUIRED",
  "ENTRY_NOT_CURRENT",
  "ENTRY_WITHDRAWN",
] as const;

export type SetupGovernanceRefusalTag = (typeof SETUP_GOVERNANCE_REFUSAL_TAGS)[number];

/**
 * The user-facing sentence of a 13.9B governance refusal, or `null` when the
 * failure is something else. Matched on the tag, never on the SQLSTATE: the
 * guards raise 42501, which an ordinary RLS refusal also raises, and "you do
 * not have permission" would be the wrong thing to say.
 */
export function setupGovernanceRefusalMessage(error: { message?: string | null }): string | null {
  const tagged = /^\[([A-Z_]+)\]\s*([\s\S]+)$/.exec((error.message ?? "").trim());
  if (!tagged) return null;
  return (SETUP_GOVERNANCE_REFUSAL_TAGS as readonly string[]).includes(tagged[1]) ? tagged[2] : null;
}

import type {
  IsoDate,
  IsoDateTime,
  OverallStatus,
  Priority,
  ProjectLifecycleStatus,
  ProjectStatus,
  RiskSeverity,
  Weekday,
} from "./core";

/**
 * Base shape shared by admin-managed master-data records (clients,
 * project types, project phases). One generic service/UI pattern manages
 * every kind.
 */
export interface MasterRecordBase {
  id: string;
  name: string;
  code?: string;
  description?: string;
  active: boolean;
}

/** External client / owner organization a project is delivered for. */
export interface Client extends MasterRecordBase {
  shortName?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  country?: string;
  city?: string;
  address?: string;
  /** Placeholder storage ref until real upload exists. */
  logoRef?: string;
}

/** Project classification, e.g. Turnaround, EPC. */
export type ProjectType = MasterRecordBase;

/** Project phase, e.g. Engineering, Commissioning. */
export interface ProjectPhase extends MasterRecordBase {
  displayOrder: number;
}

/** Internal EPROM department participating in reporting (admin-managed). */
export interface Department extends MasterRecordBase {
  /** Default department lead (Contact id). */
  leadContactId?: string;
}

/** Plant / facility system in a project scope, e.g. Tank Farm (admin-managed). */
export interface System extends MasterRecordBase {
  /** Owning department (Department id). */
  departmentId?: string;
}

/** Engineering discipline used for progress breakdowns (admin-managed). */
/**
 * The level below a System.
 *
 * Canonical hierarchy: Project → Department → System → this level.
 *
 * The user-facing name depends on the PROJECT TYPE and is resolved at render
 * time by hierarchyTermsFor() in config/project-terminology.ts:
 * PSM / PSAIM projects say "Programs & Studies", every other project type
 * says "Disciplines". The table, type and column names stay `discipline`
 * deliberately — they are storage identifiers, not labels.
 */
export interface Discipline extends MasterRecordBase {
  /** Owning department (Department id). */
  departmentId?: string;
  /**
   * Owning System. Must belong to `departmentId` — enforced by the
   * `trg_disciplines_system_department` trigger as well as the form.
   * Nullable: not every project type uses the System level.
   */
  systemId?: string;
}

/**
 * Admin-managed job title, e.g. "Project Manager", "PSM Manager"
 * (Collaboration Phase C1).
 *
 * A display label only — never a permission. Platform access comes from
 * `UserRole` and, later, project/department assignments. Nothing may derive
 * authority from a job title.
 */
export type JobTitle = MasterRecordBase;

/** Person referenced by projects, submissions, and approvals (admin-managed). */
export interface Contact extends MasterRecordBase {
  /** Free-text job title, e.g. "Senior Project Manager". */
  position: string;
  /**
   * Optional managed job title (Phase C1). Kept alongside `position` rather
   * than replacing it, so existing contacts stay valid and nothing has to be
   * backfilled.
   */
  jobTitleId?: string;
  /** Functional role, e.g. "Project Manager", "Reviewer". */
  role?: string;
  email?: string;
  phone?: string;
  organization?: string;
  departmentId?: string;
}

export interface Milestone {
  id: string;
  projectId: string;
  title: string;
  dueDate: IsoDate;
  completedDate?: IsoDate;
  progress: number; // 0-100
  status: ProjectStatus;
}

/** A system assigned to a department within a project scope. */
export interface SystemAssignment {
  id: string;
  name: string;
  code?: string;
  /** Project-specific scope; absent falls back to the System master description. */
  projectDescription?: string;
}

/** A department participating in a project, with its systems. */
export interface DepartmentAssignment {
  departmentId: string;
  /** Project-specific scope; absent falls back to the Department master description. */
  projectDescription?: string;
  /** Legacy project-link lead text; structured managers live in project.team. */
  leadName?: string;
  /** Whether this department must submit weekly report input. */
  reportingRequired: boolean;
  systems: SystemAssignment[];
}

/**
 * A discipline brought into a project, scoped to the department (and
 * optionally the system) it was selected under in the setup wizard.
 *
 * Project-scoped rather than a column on the shared `Discipline` master
 * record, because the same discipline can serve different systems on
 * different projects.
 */
export interface ProjectDisciplineLink {
  disciplineId: string;
  departmentId?: string;
  systemId?: string;
}

/**
 * A person on the project team, scoped to the department and discipline they
 * were added under. Distinct from the five responsibility roles on the
 * project itself, which stay as direct contact ids.
 */
/**
 * Project-specific assignment role inside a department team.
 *
 * Not a corporate job title and not a platform permission role — the same
 * person can hold different assignment roles on different projects. Weekly
 * authority continues to depend on platform permissions plus any active
 * delegation, never on this label alone.
 */
export type AssignmentRole =
  | "department_manager"
  | "team_member_lead"
  | "team_member";

export interface ProjectTeamMember {
  contactId: string;
  role?: string;
  departmentId?: string;
  /** Optional narrower scope within the department. */
  systemId?: string;
  disciplineId?: string;
  /** Project-specific assignment role. Defaults to a plain team member. */
  assignmentRole?: AssignmentRole;
  /**
   * Free-text functional responsibility, e.g. "RBI Lead", "Element 10 Owner".
   * Belongs to this project assignment only — never the global person record —
   * and grants no permissions regardless of wording.
   */
  functionalTitle?: string;
  /**
   * Who this member reports to on this project: a Department Manager or Team
   * Member Lead in the same project and department.
   */
  reportsToContactId?: string;
}

/**
 * A temporary hand-over of selected Weekly responsibilities inside one
 * project department. The primary Department Manager remains assigned and
 * visible; the delegate acts alongside them until `endDate`.
 *
 * Status is derived from `active` + the date window rather than stored, so an
 * expired delegation can never keep authority through a stale flag.
 */
export interface ProjectDelegation {
  id?: string;
  departmentId: string;
  delegateContactId: string;
  /** Selected responsibility keys — see WEEKLY_DELEGABLE_RESPONSIBILITIES. */
  responsibilities: string[];
  startDate: IsoDate;
  endDate: IsoDate;
  note?: string;
  /** False once revoked; expiry is derived from `endDate`, never a job. */
  active: boolean;
}

export interface ProjectReportingConfig {
  weeklyEnabled: boolean;
  monthlyEnabled: boolean;
  executiveEnabled: boolean;
  weeklyReportingDay: Weekday;
  /** Day of month (1–28) monthly reports cut off. */
  monthlyCutoffDay: number;
  currency: string;
  workingWeek: string;
  timeZone: string;
}

export interface ProjectBranding {
  /** EPROM/company logo override (data URL until real logo storage exists). */
  projectLogoRef?: string;
  /** Client logo override, kept separate from EPROM/company identity. */
  clientLogoRef?: string;
  reportHeaderTitle?: string;
  reportFooterText?: string;
  /** Prefix for report numbers, e.g. "EPR-PSAIM". */
  reportReferencePrefix?: string;
  defaultLanguage: "en" | "ar";
  includeQrCode: boolean;
  includeSignatureSection: boolean;
}

export interface ProjectLocation {
  site?: string;
  country?: string;
  city?: string;
}

/**
 * One additional, admin-configurable position on a project.
 *
 * Sits BESIDE the five fixed responsibility roles rather than replacing any of
 * them. `jobTitleId` is a managed Job Title record and `contactId` a Person
 * record — this row links them for one project and copies neither, so a
 * person holding a position here still has exactly one Person record and one
 * Home Department.
 */
export interface ProjectPosition {
  /** Present for persisted rows; omitted while a new form row is unsaved. */
  id?: string;
  jobTitleId: string;
  contactId: string;
  notes?: string;
  sortOrder: number;
}

/* ------------------------- Master Milestones (13.2) ----------------------- */

export type MilestoneStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "delayed";

export type MilestonePriority = "low" | "medium" | "high" | "critical";

/** Where a milestone identity came from. `schedule` arrives with 13.5. */
export type MilestoneSource = "manual" | "scope";

/** Which channel proposed an update. `schedule_import` arrives with 13.5. */
export type MilestoneUpdateSource = "weekly" | "monthly" | "planning";

export type MilestoneApprovalStatus = "pending" | "approved" | "rejected";

/**
 * A milestone's IDENTITY — what it is, not how it is going.
 *
 * Status, progress and forecast are deliberately absent: they are derived from
 * the latest approved `MilestoneUpdate`, so there is exactly one writable store
 * of the current figure.
 */
export interface MasterMilestone {
  id: string;
  projectId: string;
  code: string;
  name: string;
  description?: string;
  departmentId?: string;
  systemId?: string;
  /** Storage name is stable; PSM projects display it as Program & Study. */
  disciplineId?: string;
  baselineDate?: IsoDate;
  priority: MilestonePriority;
  ownerContactId?: string;
  source: MilestoneSource;
  sourceDocumentId?: string;
  active: boolean;
  archivedAt?: IsoDateTime;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/**
 * One entry in a milestone's append-only state stream.
 *
 * The reported facts are immutable once written — a database trigger refuses
 * any edit to them. Only the approval decision may transition, once.
 */
export interface MilestoneUpdate {
  id: string;
  milestoneId: string;
  source: MilestoneUpdateSource;
  weeklyReportId?: string;
  monthlyReportId?: string;
  departmentId?: string;
  disciplineId?: string;
  status: MilestoneStatus;
  progressPercent?: number;
  forecastDate?: IsoDate;
  actualDate?: IsoDate;
  narrative?: string;
  approvalStatus: MilestoneApprovalStatus;
  approvedByContactId?: string;
  approvedAt?: IsoDateTime;
  decisionNote?: string;
  /** True when this reported less progress than the current approved figure. */
  isRegression: boolean;
  regressionReason?: string;
  submittedByContactId?: string;
  submittedAt: IsoDateTime;
}

/* ------------------------ Master Deliverables (13.3) ---------------------- */

/**
 * Where a deliverable stands with the CLIENT.
 *
 * D6: this is reported data — a fact about what the client did — and is never
 * the same thing as {@link MilestoneApprovalStatus}, which records whether
 * Project Control accepts the report. `approved` here means the client
 * approved, and says nothing about whether we have confirmed that.
 *
 * `approved_with_comments` is its own state rather than `approved` plus a note:
 * it carries an obligation to respond, and collapsing it would lose that.
 */
export type ClientReviewStatus =
  | "not_submitted"
  | "submitted"
  | "under_review"
  | "approved"
  | "approved_with_comments"
  | "rejected"
  | "resubmit";

/** Which channel proposed a deliverable update. */
export type DeliverableUpdateSource = "weekly" | "monthly" | "planning";

/**
 * A deliverable's IDENTITY — what it is, not where it stands.
 *
 * Client review status, actual submission date and the submitted revision are
 * deliberately absent: they are derived from the latest approved
 * {@link DeliverableUpdate}.
 */
export interface MasterDeliverable {
  id: string;
  projectId: string;
  code: string;
  title: string;
  description?: string;
  departmentId?: string;
  systemId?: string;
  /** Storage name is stable; PSM projects display it as Program & Study. */
  disciplineId?: string;
  ownerContactId?: string;
  /**
   * The milestone this deliverable serves. A REFERENCE into the master
   * register — no milestone code, name or date is ever copied onto this record.
   */
  milestoneId?: string;
  plannedSubmissionDate?: IsoDate;
  /** The revision this is PLANNED at; the submitted one is reported per update. */
  revision?: string;
  /** Evidence, held in `project_documents` rather than a second file store. */
  documentId?: string;
  active: boolean;
  archivedAt?: IsoDateTime;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/**
 * One entry in a deliverable's append-only state stream.
 *
 * Carries two independent statuses by design (D6). `clientReviewStatus` is what
 * was reported; `approvalStatus` is whether Project Control accepts the report.
 * A row may legitimately read client-approved / internally-pending, and no UI
 * may render the two in one control.
 */
export interface DeliverableUpdate {
  id: string;
  deliverableId: string;
  source: DeliverableUpdateSource;
  weeklyReportId?: string;
  monthlyReportId?: string;
  departmentId?: string;
  disciplineId?: string;
  clientReviewStatus: ClientReviewStatus;
  clientReviewDate?: IsoDate;
  /** The client's own transmittal or comment-sheet reference. */
  clientReference?: string;
  forecastDate?: IsoDate;
  actualSubmissionDate?: IsoDate;
  /** The revision actually submitted, which can differ from the planned one. */
  revision?: string;
  narrative?: string;
  approvalStatus: MilestoneApprovalStatus;
  approvedByContactId?: string;
  approvedAt?: IsoDateTime;
  decisionNote?: string;
  submittedByContactId?: string;
  submittedAt: IsoDateTime;
}

/** How milestone updates become official on a project. */
export type MilestoneApprovalMode = "manual" | "auto_on_report_finalized";

/** A named physical site belonging to one Project. */
export interface ProjectSite {
  /** Present for persisted rows; omitted while a new form row is unsaved. */
  id?: string;
  name: string;
  country?: string;
  city?: string;
  isPrimary: boolean;
  sortOrder: number;
}

export type ProjectDocumentType =
  | "scope_of_work"
  | "baseline_schedule"
  /** A revision or update to the baseline schedule (Phase 13.1). */
  | "schedule_update"
  | "contract_purchase_order"
  | "approved_proposal"
  | "organization_chart"
  | "kickoff_mom"
  | "other";

/**
 * Where a reference document came from — distinct from `uploadedBy`, which is
 * who put it into the platform.
 */
export type ProjectDocumentSource =
  | "client_issued"
  | "internal"
  | "contractor"
  | "other";

export type ProjectDocumentStatus =
  | "current"
  | "superseded"
  | "draft"
  | "approved"
  | "cancelled";

/** Metadata for an immutable uploaded revision of an official Project file. */
export interface ProjectDocument {
  id: string;
  projectId: string;
  title: string;
  documentType: ProjectDocumentType;
  documentNumber?: string;
  revision?: string;
  issueDate?: IsoDate;
  /** When the document takes effect, which is not always when it was issued. */
  effectiveDate?: IsoDate;
  source?: ProjectDocumentSource;
  status: ProjectDocumentStatus;
  /**
   * The document that replaced this one.
   *
   * Set only through `projectDocumentService.supersede()`, which writes it and
   * `status: "superseded"` in the same statement. A database CHECK enforces
   * that a document carrying this link is necessarily superseded, so the two
   * can never disagree.
   */
  supersededByDocumentId?: string;
  notes?: string;
  /**
   * Soft-delete discriminator. Present means the document is in Trash.
   *
   * Deliberately separate from `status`, which keeps its own value throughout —
   * a superseded document that is binned is still superseded, and Restore has
   * to return it to exactly that.
   */
  deletedAt?: IsoDateTime;
  deletedBy?: string;
  deletedByName?: string;
  deleteReason?: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  uploadedBy?: string;
  uploadedByName?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ProjectClientContact {
  name?: string;
  email?: string;
  phone?: string;
}

/** Project master data — the anchor entity for all reporting. */
export interface Project {
  id: string;
  code: string;
  name: string;
  shortName?: string;
  description?: string;
  /** Managed master-data reference (ProjectType). */
  projectTypeId?: string;
  clientId: string;
  contractNumber?: string;
  purchaseOrderNumber?: string;

  // Dates
  contractStartDate?: IsoDate;
  plannedStartDate: IsoDate;
  actualStartDate?: IsoDate;
  plannedFinishDate: IsoDate;
  forecastFinishDate?: IsoDate;
  actualFinishDate?: IsoDate;

  // Responsibility (contact ids from master data)
  projectManagerId: string;
  projectControlManagerId?: string;
  clientRepresentativeId?: string;
  reportingCoordinatorId?: string;
  projectSponsorId?: string;

  // Status & progress
  status: ProjectLifecycleStatus;
  overallStatus: OverallStatus;
  plannedProgress: number; // 0-100
  actualProgress: number; // 0-100
  /** Managed master-data reference (ProjectPhase). */
  currentPhaseId?: string;
  priority: Priority;

  reporting: ProjectReportingConfig;
  /** Additive multi-site model; legacy `location` remains the primary fallback. */
  sites?: ProjectSite[];
  /**
   * Additional project positions beyond the five fixed responsibility roles.
   * Optional so projects created before it existed stay valid — read as `?? []`.
   */
  positions?: ProjectPosition[];
  location: ProjectLocation;
  clientContact: ProjectClientContact;
  departments: DepartmentAssignment[];
  /**
   * Set by the setup wizard. Optional so projects created before it existed
   * stay valid — read them as `?? []`.
   */
  disciplines?: ProjectDisciplineLink[];
  team?: ProjectTeamMember[];
  /** Weekly-responsibility delegations, per department. */
  delegations?: ProjectDelegation[];
  branding: ProjectBranding;

  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Risk {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  severity: RiskSeverity;
  mitigation?: string;
  ownerContactId?: string;
  raisedAt: IsoDate;
  closedAt?: IsoDate;
}

export interface Issue {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  priority: Priority;
  ownerContactId?: string;
  raisedAt: IsoDate;
  resolvedAt?: IsoDate;
}

export interface ActionItem {
  id: string;
  projectId: string;
  title: string;
  priority: Priority;
  ownerContactId?: string;
  dueDate?: IsoDate;
  completedAt?: IsoDate;
  sourceReportId?: string;
}

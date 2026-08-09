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
 * A Program & Study (legacy table/type name: Discipline — kept to avoid
 * pointless migration risk; the UI says "Programs & Studies").
 *
 * Canonical hierarchy: Project → Department → System → Program & Study.
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
}

/** A department participating in a project, with its systems. */
export interface DepartmentAssignment {
  departmentId: string;
  /** Department lead for this project (free text until user management). */
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
  /** Mock-uploaded logo (data URL) until real file storage exists. */
  projectLogoRef?: string;
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

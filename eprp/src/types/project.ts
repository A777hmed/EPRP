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

/**
 * Admin-managed Portfolio/Reporting Group (e.g. PSM, PSAIM, Construction),
 * for future grouped portfolio S-curves. Never a hardcoded list — a project
 * assigns one via `Project.portfolioGroupId`; the group is never duplicated
 * into the project.
 */
export type PortfolioGroup = MasterRecordBase;

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
  /**
   * Manual remains the safe default. The automatic option is mapped for the
   * existing database contract but is not activated until report finalization
   * and governed milestone authority are aligned.
   */
  milestoneUpdateApproval: "manual" | "auto_on_report_finalized";
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

/**
 * The CLASS of a milestone (13.2c).
 *
 * A small closed set, because it drives behaviour: it decides which fields
 * apply and — critically — whether the milestone counts toward **physical**
 * progress or **commercial** progress. The freely configurable, project-chosen
 * label is `MasterMilestone.category`; individual milestone names are never
 * hardcoded anywhere in the platform.
 */
export type MilestoneType = "technical" | "contractual" | "commercial";

/**
 * Where a commercial milestone's money stands, as reported.
 *
 * `partially_recovered` / `fully_recovered` apply to an advance payment, which
 * is repaid out of later certificates rather than earned by work.
 */
export type MilestonePaymentStatus =
  | "planned"
  | "due"
  | "invoiced"
  | "received"
  | "partially_recovered"
  | "fully_recovered";

/**
 * What the CLIENT decided about a milestone, as reported.
 *
 * Never the same thing as {@link MilestoneApprovalStatus}, which records
 * whether Project Control accepts the report of that decision. The two must
 * never share a UI control — the same rule {@link ClientReviewStatus} carries.
 */
export type MilestoneClientApprovalStatus = "pending" | "approved" | "rejected";

/** Where a milestone identity came from. `schedule` arrives with 13.5. */
export type MilestoneSource = "manual" | "scope";

/**
 * Which channel produced an update. `schedule_import` arrives with 13.5.
 *
 * `weekly` / `monthly` / `planning` are OBSERVATIONS — they propose a figure.
 * `reconciliation` (13.2d) is the governance act that declares the official
 * figure for a cut-off when observations disagree. Only Project Control may
 * write one.
 */
export type MilestoneUpdateSource =
  | "weekly"
  | "monthly"
  | "planning"
  | "reconciliation";

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
  /** The frozen contractual reference. `plannedDate` is the current agreement. */
  baselineDate?: IsoDate;
  priority: MilestonePriority;
  ownerContactId?: string;
  source: MilestoneSource;
  sourceDocumentId?: string;
  active: boolean;
  archivedAt?: IsoDateTime;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;

  /* ------------------------- 13.2c — the plan --------------------------- */
  type: MilestoneType;
  /** Project-chosen label within the type. Free text, never a lookup. */
  category?: string;
  /** The current agreed date, which may move in a re-plan. */
  plannedDate?: IsoDate;
  /**
   * Share of PHYSICAL project scope, 0–100. A commercial milestone cannot
   * carry one — the database refuses it, because money is not delivered work.
   */
  weightPercent?: number;
  /** What progress the plan says should be reached. Actual is reported. */
  plannedProgressPercent?: number;
  /** The milestone this one waits on. Same project, and never circular. */
  predecessorMilestoneId?: string;
  /** Whether the client must approve. Whether they DID is reported. */
  clientApprovalRequired: boolean;
  notes?: string;

  /* ------------- 13.2c — commercial plan (type === "commercial") --------- */
  /** Share of contract value this payment represents. */
  paymentPercent?: number;
  paymentAmount?: number;
  paymentDueDate?: IsoDate;
  /** Paid up front and recovered later. Inside contract value, never above it. */
  isAdvancePayment: boolean;
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

  /* --------------- 13.2c — commercial actuals, as reported -------------- */
  paymentStatus?: MilestonePaymentStatus;
  invoiceReference?: string;
  invoicedDate?: IsoDate;
  receivedDate?: IsoDate;
  /**
   * Advance recovered to date, in money. Recovery % and the outstanding
   * advance are derived against the agreed `paymentAmount` rather than stored
   * a second time.
   */
  recoveredAmount?: number;

  /* ------------------ 13.2c — client approval, as reported -------------- */
  /** What the CLIENT decided. Not `approvalStatus`, which is our governance. */
  clientApprovalStatus?: MilestoneClientApprovalStatus;
  clientApprovalDate?: IsoDate;

  /* ---------------------- 13.2d — reconciliation ------------------------ */
  /**
   * The reporting cut-off this observation describes.
   *
   * Not `submittedAt`, which is when it arrived. Two figures at different
   * cut-offs are both valid history; two approved figures at the SAME cut-off
   * are a conflict that only Project Control may resolve.
   *
   * Undefined on rows written before 13.2d, and on any row that declines to
   * state a cut-off — those are exempt from conflict detection.
   */
  asOfDate?: IsoDate;
  /**
   * On a reconciliation row: the reported update whose value was adopted.
   * Undefined when Project Control entered an independent figure.
   */
  adoptedFromUpdateId?: string;
  /** Required on a reconciliation row. */
  reconciliationReason?: string;
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

/* ---------------------- Planning & Control (Slice 1) ---------------------- */

/**
 * How a project enters Planning. The three onboarding paths the product
 * model requires:
 *   new_project             — no schedule exists yet; plan from zero.
 *   existing_active_project — already running; must publish an Opening
 *                             Position as Snapshot V1, never a fabricated
 *                             from-zero history — see {@link PlanningOpeningPosition}.
 *   no_formal_schedule      — tracked without a formal schedule at all;
 *                             Planning stays available but nothing is implied.
 */
export type PlanningOnboardingMode =
  | "new_project"
  | "existing_active_project"
  | "no_formal_schedule";

/** The formats Planning Slice 1 recognises. Native XER/MPP is out of scope. */
export type PlanningImportSourceType = "eprp_excel" | "p6" | "msproject";

/** A project's Planning configuration. One row per project. */
export interface ProjectPlanningSettings {
  projectId: string;
  onboardingMode: PlanningOnboardingMode;
  defaultImportSource?: PlanningImportSourceType | "manual";
  planningEnabled: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Whether an Opening Position is still editable or has produced Snapshot V1. */
export type PlanningOpeningPositionStatus = "draft" | "promoted";

/**
 * A declared starting position for a project onboarded mid-execution
 * (`onboardingMode: "existing_active_project"`), as of a data date.
 *
 * "Do not create fake history": an already-running project has no from-zero
 * activity history to import, so this is the honest alternative — one
 * declared position, promoted into Snapshot V1 with no fabricated work items
 * or activities beneath it. Absence is not zero: planned/actual progress and
 * forecast finish are all independently nullable.
 */
export interface PlanningOpeningPosition {
  id: string;
  projectId: string;
  dataDate: IsoDate;
  plannedProgressPercent?: number;
  actualProgressPercent?: number;
  forecastFinishDate?: IsoDate;
  /** Free text provenance (e.g. "Prior contractor S-curve"), not a lookup. */
  source: string;
  status: PlanningOpeningPositionStatus;
  promotedAt?: IsoDateTime;
  promotedToSnapshotId?: string;
  createdByContactId?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/**
 * The Published Planning Snapshot — the planning source of truth.
 *
 * Written exactly once, by `publish_planning_snapshot()`, and never edited or
 * regenerated. Weekly and Monthly link to an exact snapshot id, never to
 * "current planning" — the same reference-while-drafting / snapshot-at-
 * approval discipline reports already apply to their own compiled content.
 */
export interface PlanningSnapshot {
  id: string;
  projectId: string;
  /** Sequential per project. The current snapshot is the highest version. */
  version: number;
  sourceImportBatchId?: string;
  /** Set when this snapshot was promoted from an Opening Position. */
  sourceOpeningPositionId?: string;
  baselineId?: string;
  isOpeningSnapshot: boolean;
  label?: string;
  /**
   * The schedule position this snapshot reports as of (Planning
   * Integration 3A) — the real Data Date from the Opening Position or the
   * import batch, never publishedAt. Optional only because a snapshot
   * published before this existed may have no recoverable one; every
   * snapshot published going forward is guaranteed one by
   * `publish_planning_snapshot()`, which refuses to publish without it.
   */
  dataDate?: IsoDate;
  /** Captured work items, activities and milestone links at publish time. */
  snapshotData: unknown;
  publishedByContactId?: string;
  publishedAt: IsoDateTime;
}

/**
 * Normalized, immutable per-activity record owned by one {@link PlanningSnapshot}.
 *
 * This is the queryable drill-down/provenance path for a snapshot's activity
 * data — `PlanningSnapshot.snapshotData`'s JSON is a convenience archive, not
 * the only record. A later edit to the live `planning_activities` register
 * can never alter a row here.
 */
export interface PlanningSnapshotActivity {
  id: string;
  snapshotId: string;
  /** Traceability only: the working row may since have moved or archived. */
  sourceActivityId?: string;
  sourceWorkItemId?: string;
  /** The stable source-system id — what Planning Review matches across snapshots. */
  externalId?: string;
  code?: string;
  name: string;
  isMilestone: boolean;
  plannedStartDate?: IsoDate;
  plannedFinishDate?: IsoDate;
  baselineStartDate?: IsoDate;
  baselineFinishDate?: IsoDate;
  actualStartDate?: IsoDate;
  actualFinishDate?: IsoDate;
  remainingDurationDays?: number;
  percentCompletePlanned?: number;
  percentCompleteActual?: number;
  percentCompletePhysical?: number;
  weightPercent?: number;
  status?: string;
  plannedValue?: number;
  earnedValue?: number;
  createdAt: IsoDateTime;
}

/* ------------------------- Master Plan (Slice 2) --------------------------- */

/**
 * Master Plan classification — a behaviour-neutral taxonomy for display,
 * grouping and filtering. Not project-hierarchy scope (department/system/
 * discipline stay separate columns); not a substitute for the governed
 * Master Milestone / Master Deliverable registers, which a "milestone" or
 * "deliverable" item should link to rather than duplicate.
 */
export type PlanningWorkItemType =
  | "study"
  | "deliverable"
  | "report"
  | "activity"
  | "engineering"
  | "procurement"
  | "construction"
  | "inspection"
  | "commissioning"
  | "milestone"
  | "other";

/** Whether a row originated from an import or was entered directly. */
export type PlanningItemSource = "import" | "manual";

/**
 * A node in the project's governed WBS register (Master Plan).
 *
 * Identity and state are not split here the way Master Milestones splits
 * them — a work item is structural (what the plan IS), and its planned/
 * baseline figures are themselves the confirmable content; adjustments are
 * logged in {@link PlanningConfirmation}, not held in a separate state stream.
 */
export interface PlanningWorkItem {
  id: string;
  projectId: string;
  parentWorkItemId?: string;
  originImportRowId?: string;
  departmentId?: string;
  systemId?: string;
  disciplineId?: string;
  /** Reference only — set when item_type is "deliverable" and one exists. */
  masterDeliverableId?: string;
  code: string;
  name: string;
  itemType: PlanningWorkItemType;
  level: number;
  sortOrder: number;
  isMilestone: boolean;
  weightPercent?: number;
  plannedStartDate?: IsoDate;
  plannedFinishDate?: IsoDate;
  baselineStartDate?: IsoDate;
  baselineFinishDate?: IsoDate;
  plannedDurationDays?: number;
  source: PlanningItemSource;
  active: boolean;
  archivedAt?: IsoDateTime;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/**
 * A schedule-level activity (P6 activity / MS Project task) under a
 * {@link PlanningWorkItem}, or standing alone when no WBS match was found on
 * import. The full import/review column model lives here.
 */
export interface PlanningActivity {
  id: string;
  projectId: string;
  workItemId?: string;
  originImportRowId?: string;
  /** The source system's own stable id (e.g. P6 Activity ID). */
  externalId?: string;
  code?: string;
  name: string;
  isMilestone: boolean;
  plannedStartDate?: IsoDate;
  plannedFinishDate?: IsoDate;
  baselineStartDate?: IsoDate;
  baselineFinishDate?: IsoDate;
  actualStartDate?: IsoDate;
  actualFinishDate?: IsoDate;
  /** "Original Duration" in most schedule tools. */
  plannedDurationDays?: number;
  remainingDurationDays?: number;
  percentCompletePlanned?: number;
  percentCompleteActual?: number;
  percentCompletePhysical?: number;
  weightPercent?: number;
  /** Raw, as reported by the source — never normalized to a platform enum. */
  status?: string;
  plannedValue?: number;
  earnedValue?: number;
  source: PlanningItemSource;
  active: boolean;
  archivedAt?: IsoDateTime;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** The formats Planning Slice 2 recognises. Native XER/MPP is out of scope. */
export type PlanningImportSourceFormat = "eprp_excel" | "p6" | "msproject";

export type PlanningImportBatchStatus =
  | "uploaded"
  | "validated"
  | "rejected"
  | "published";

/** One uploaded planning source file. Never auto-published. */
export interface PlanningImportBatch {
  id: string;
  projectId: string;
  sourceType: PlanningImportSourceFormat;
  fileName?: string;
  sourceDocumentId?: string;
  /**
   * The schedule's own Data Date / Status Date (Planning Integration 3A)
   * — detected from a recognizable column in the source file, or entered
   * by the user in the import wizard. Required before this batch can be
   * published; `publish_planning_snapshot()` refuses one with none.
   */
  dataDate?: IsoDate;
  status: PlanningImportBatchStatus;
  rowCount: number;
  uploadedByContactId?: string;
  uploadedAt: IsoDateTime;
  validatedAt?: IsoDateTime;
  validatedByContactId?: string;
  rejectionReason?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type PlanningImportRowParseStatus = "ok" | "warning" | "error";

/**
 * One raw row from a planning source file, exactly as parsed. Insert-only —
 * `rawData` is the full mapped column set (see the column model) and is
 * never edited. This is what an imported value can always be checked
 * against; {@link PlanningActivity}/{@link PlanningWorkItem} hold the
 * confirmed, adjustable working copy.
 */
export interface PlanningImportRow {
  id: string;
  batchId: string;
  externalId?: string;
  wbsPath?: string;
  name?: string;
  rawData: Record<string, unknown>;
  parseStatus: PlanningImportRowParseStatus;
  parseNotes?: string;
  createdAt: IsoDateTime;
}

export type PlanningConfirmationAction = "confirm" | "adjust";

/**
 * One confirm/adjust decision against a work item or activity value, with a
 * required reason. Append-only — never edited or removed. Exactly one of
 * `workItemId`/`activityId` is set.
 */
export interface PlanningConfirmation {
  id: string;
  workItemId?: string;
  activityId?: string;
  importRowId?: string;
  action: PlanningConfirmationAction;
  fieldName: string;
  previousValue?: string;
  newValue?: string;
  reason: string;
  confirmedByContactId?: string;
  confirmedAt: IsoDateTime;
}

/** A named, immutable capture of the plan at a point in time. */
export interface PlanningBaseline {
  id: string;
  projectId: string;
  name: string;
  baselineDate: IsoDate;
  capturedItems: unknown;
  notes?: string;
  createdByContactId?: string;
  createdAt: IsoDateTime;
}

/** Links a work item or activity to its governed Master Milestone identity. */
export interface PlanningMilestoneLink {
  id: string;
  masterMilestoneId: string;
  workItemId?: string;
  activityId?: string;
  createdByContactId?: string;
  createdAt: IsoDateTime;
}

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
  /** Managed master-data reference (PortfolioGroup) — Planning Slice 1. */
  portfolioGroupId?: string;
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

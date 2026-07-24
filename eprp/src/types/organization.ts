import type { IsoDate, IsoDateTime } from "./core";

/**
 * Project organization charts (OC-2).
 *
 * Hierarchy is relational — a position points at its parent and carries a
 * sibling order. No canvas coordinates are stored; any layout the editor
 * needs is derived when the chart is drawn.
 */

/**
 * Review lifecycle of a chart.
 *
 * Draft, In Progress and Under Review are working states and stay editable.
 * Approved and Locked are settled — the chart becomes read-only and changes
 * go into a new revision instead. Archived is the soft-retired end state.
 *
 * Deliberately separate from `isCurrent`: which chart is live for a project
 * is a different question from where it sits in review.
 */
export type OrganizationChartStatus =
  | "draft"
  | "in_progress"
  | "under_review"
  | "approved"
  | "locked"
  | "archived";

/** How a chart was started. */
export type OrganizationChartSource = "blank" | "template" | "excel_import";

/** The kind of project structure a chart represents. Editable metadata. */
export type OrganizationChartType =
  | "epc"
  | "epcm"
  | "construction"
  | "turnaround"
  | "custom";

/** Lifecycle of a single seat on the chart. */
export type PositionStatus =
  | "active"
  | "vacant"
  | "planned"
  | "on_hold"
  | "closed";

export type EmploymentType = "staff" | "contract" | "secondment" | "agency";

export interface OrganizationChart {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  status: OrganizationChartStatus;
  source: OrganizationChartSource;
  /** Project structure kind, e.g. EPC/EPCM. Distinct from how it was started. */
  chartType?: OrganizationChartType;
  /** The date this chart takes effect from. */
  effectiveDate?: IsoDate;
  version: number;
  /** The project's live chart. At most one at a time. */
  isCurrent: boolean;
  /** The chart this one was revised from, if any. */
  supersedesChartId?: string;
  /** Soft delete: false once the chart has been removed. */
  active: boolean;
  archivedAt?: IsoDateTime;
  createdBy?: string;
  updatedBy?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface OrganizationPosition {
  id: string;
  chartId: string;
  /** Denormalised from the chart so the scope is provable in the database. */
  projectId: string;
  /** Null for the root position(s) of a chart. */
  parentPositionId?: string;

  title: string;
  code?: string;
  /** The role this seat plays on the project. */
  role?: string;
  notes?: string;

  departmentId?: string;
  disciplineId?: string;
  /** The person filling the position; undefined means vacant. */
  contactId?: string;

  /** Employing organisation for the seat, independent of its occupant. */
  company?: string;
  employmentType?: EmploymentType;
  /** Role contact details. Fall back to the occupant when unset. */
  email?: string;
  phone?: string;
  status: PositionStatus;
  startDate?: IsoDate;
  endDate?: IsoDate;

  /** Order among siblings — presentation only, not a coordinate. */
  sortOrder: number;

  active: boolean;
  archivedAt?: IsoDateTime;
  createdBy?: string;
  updatedBy?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type PositionAssignmentAction = "assigned" | "reassigned" | "vacated";

/** Append-only: who held a position and when. */
export interface PositionAssignmentHistoryEntry {
  id: string;
  positionId: string;
  chartId: string;
  projectId: string;
  /** Null records a vacancy. */
  contactId?: string;
  previousContactId?: string;
  action: PositionAssignmentAction;
  effectiveFrom: IsoDate;
  effectiveTo?: IsoDate;
  note?: string;
  createdBy?: string;
  createdAt: IsoDateTime;
}

/**
 * A position with its children resolved, for rendering. Built from the flat
 * position list rather than stored.
 */
export interface OrganizationPositionNode extends OrganizationPosition {
  children: OrganizationPositionNode[];
  /** Depth from the root, starting at 0. */
  depth: number;
}

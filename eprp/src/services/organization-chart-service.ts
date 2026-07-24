import { isSupabaseConfigured } from "@/lib/supabase/config";
import type {
  EmploymentType,
  OrganizationChart,
  OrganizationChartSource,
  OrganizationChartStatus,
  OrganizationChartType,
  OrganizationPosition,
  OrganizationPositionNode,
  PositionAssignmentHistoryEntry,
  PositionStatus,
} from "@/types";
import {
  buildPositionTree,
  collectDescendantIds,
  wouldCreateCycle,
} from "@/lib/organization-tree";
import { canTransitionTo, isChartEditable, lockReason } from "@/lib/organization-lock";
import { supabaseOrganizationChartService } from "./supabase-organization-chart-service";

/* --------------------------------- Inputs --------------------------------- */

export interface OrganizationChartCreateInput {
  projectId: string;
  name: string;
  description?: string;
  source?: OrganizationChartSource;
}

export interface OrganizationChartUpdateInput {
  name?: string;
  /** Empty string clears the field, matching the position editor's rule. */
  description?: string;
  chartType?: OrganizationChartType;
  effectiveDate?: string;
}

export interface OrganizationPositionCreateInput {
  chartId: string;
  projectId: string;
  parentPositionId?: string;
  title: string;
  code?: string;
  role?: string;
  notes?: string;
  departmentId?: string;
  disciplineId?: string;
  contactId?: string;
  /** Appended to the end of its siblings when omitted. */
  sortOrder?: number;
}

/**
 * Every editable attribute of a position. `undefined` leaves a field
 * untouched; an empty string clears it, which is how the editor removes a
 * value without a separate "clear" action.
 */
export interface OrganizationPositionUpdateInput {
  title?: string;
  code?: string;
  role?: string;
  notes?: string;
  departmentId?: string;
  disciplineId?: string;
  company?: string;
  employmentType?: EmploymentType | "";
  email?: string;
  phone?: string;
  status?: PositionStatus;
  startDate?: string;
  endDate?: string;
}

/**
 * A nested structure to generate positions from. Deliberately generic: both
 * the template loader and any future importer describe a chart this way, and
 * neither needs to know about ids or ordering.
 */
export interface PositionTreeInput {
  code?: string;
  title: string;
  role?: string;
  children?: PositionTreeInput[];
}

export interface ApplyTemplateOptions {
  /** Archive every existing position first. Off by default. */
  replaceExisting?: boolean;
}

export interface OrganizationChartService {
  listCharts(projectId: string): Promise<OrganizationChart[]>;
  getChart(chartId: string): Promise<OrganizationChart | null>;
  /** The project's live chart, or null when it has none. */
  getActiveChart(projectId: string): Promise<OrganizationChart | null>;
  createChart(input: OrganizationChartCreateInput): Promise<OrganizationChart>;
  updateChart(
    chartId: string,
    input: OrganizationChartUpdateInput
  ): Promise<OrganizationChart>;
  /** Makes this the project's live chart, standing down any previous one. */
  activateChart(chartId: string): Promise<OrganizationChart>;
  /** Move through the review lifecycle. Rejects invalid transitions. */
  setChartStatus(
    chartId: string,
    status: OrganizationChartStatus
  ): Promise<OrganizationChart>;
  /**
   * Copy a settled chart into a new editable draft, positions and all, and
   * make it the live one. The original is kept as the record of what was
   * approved.
   */
  createRevision(chartId: string): Promise<OrganizationChart>;
  archiveChart(chartId: string): Promise<OrganizationChart>;

  listPositions(chartId: string): Promise<OrganizationPosition[]>;
  /** The chart's positions assembled into a tree. */
  getPositionTree(chartId: string): Promise<OrganizationPositionNode[]>;
  createPosition(
    input: OrganizationPositionCreateInput
  ): Promise<OrganizationPosition>;
  updatePosition(
    positionId: string,
    input: OrganizationPositionUpdateInput
  ): Promise<OrganizationPosition>;
  /** Re-parent and/or reorder. Rejects moves that would create a cycle. */
  movePosition(
    positionId: string,
    parentPositionId: string | undefined,
    sortOrder?: number
  ): Promise<OrganizationPosition>;
  /**
   * Copy a position as a sibling. Attributes carry over but the seat comes
   * back vacant — duplicating a role does not duplicate the person in it.
   */
  duplicatePosition(positionId: string): Promise<OrganizationPosition>;
  /** Rewrite `sortOrder` across one sibling group, in the order given. */
  reorderSiblings(orderedIds: string[]): Promise<void>;
  /**
   * Create positions from a nested structure, wiring parentage as it goes.
   * Codes carry through untouched; every seat arrives vacant.
   */
  applyPositionTree(
    chartId: string,
    nodes: PositionTreeInput[],
    options?: ApplyTemplateOptions
  ): Promise<OrganizationPosition[]>;
  /** Soft-deletes the position and everything beneath it. */
  archivePosition(positionId: string): Promise<OrganizationPosition>;

  /** Assign, reassign, or vacate (pass undefined). Records history. */
  assignContact(
    positionId: string,
    contactId: string | undefined,
    options?: { note?: string; effectiveFrom?: string }
  ): Promise<OrganizationPosition>;
  listAssignmentHistory(
    scope: { positionId: string } | { chartId: string }
  ): Promise<PositionAssignmentHistoryEntry[]>;
}

/* --------------------------------- Helpers -------------------------------- */

function clone<T>(value: T): T {
  return structuredClone(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function delay(ms = 180): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------ Mock service ------------------------------ */

// Starts empty on purpose: a chart only exists once someone creates one.
const chartStore = new Map<string, OrganizationChart>();
const positionStore = new Map<string, OrganizationPosition>();
const historyStore = new Map<string, PositionAssignmentHistoryEntry>();

let sequence = 0;
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

function activePositionsOf(chartId: string): OrganizationPosition[] {
  return [...positionStore.values()].filter(
    (position) => position.chartId === chartId && position.active
  );
}

function requirePosition(positionId: string): OrganizationPosition {
  const position = positionStore.get(positionId);
  if (!position) throw new Error(`Position ${positionId} not found`);
  return position;
}

/** How many parents sit above a position, used to copy a chart top-down. */
function depthOf(
  position: OrganizationPosition,
  all: OrganizationPosition[]
): number {
  let depth = 0;
  let current = position;
  while (current.parentPositionId) {
    const parent = all.find(
      (candidate) => candidate.id === current.parentPositionId
    );
    if (!parent) break;
    current = parent;
    depth += 1;
  }
  return depth;
}

/**
 * Refuses a write to a settled chart. The interface hides these actions, but
 * the rule belongs here too — the UI is not the thing being protected.
 */
function requireEditableChart(chartId: string): OrganizationChart {
  const chart = chartStore.get(chartId);
  if (!chart) throw new Error(`Chart ${chartId} not found`);
  if (!isChartEditable(chart.status)) {
    throw new Error(lockReason(chart.status) ?? "This chart is read-only");
  }
  return chart;
}

const mockOrganizationChartService: OrganizationChartService = {
  async listCharts(projectId) {
    await delay();
    return [...chartStore.values()]
      .filter((chart) => chart.projectId === projectId && chart.active)
      .map(clone)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async getChart(chartId) {
    await delay(120);
    const chart = chartStore.get(chartId);
    return chart ? clone(chart) : null;
  },

  async getActiveChart(projectId) {
    await delay(120);
    const chart = [...chartStore.values()].find(
      (candidate) =>
        candidate.projectId === projectId &&
        candidate.active &&
        candidate.isCurrent
    );
    return chart ? clone(chart) : null;
  },

  async createChart(input) {
    await delay();
    const timestamp = nowIso();
    const chart: OrganizationChart = {
      id: nextId("chart"),
      projectId: input.projectId,
      name: input.name,
      description: input.description,
      status: "draft",
      source: input.source ?? "blank",
      version: 1,
      isCurrent: false,
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    chartStore.set(chart.id, chart);
    return clone(chart);
  },

  async updateChart(chartId, input) {
    await delay();
    const existing = chartStore.get(chartId);
    if (!existing) throw new Error(`Chart ${chartId} not found`);
    const updated: OrganizationChart = {
      ...existing,
      name: input.name === undefined ? existing.name : input.name,
      // Empty string clears, matching the Supabase NULL write.
      description:
        input.description === undefined
          ? existing.description
          : input.description || undefined,
      chartType:
        input.chartType === undefined ? existing.chartType : input.chartType,
      effectiveDate:
        input.effectiveDate === undefined
          ? existing.effectiveDate
          : input.effectiveDate || undefined,
      updatedAt: nowIso(),
    };
    chartStore.set(chartId, updated);
    return clone(updated);
  },

  async activateChart(chartId) {
    await delay();
    const existing = chartStore.get(chartId);
    if (!existing) throw new Error(`Chart ${chartId} not found`);

    // Only one live chart per project — stand the previous one down. Its
    // review status is left alone; being superseded is not a review outcome.
    for (const chart of chartStore.values()) {
      if (
        chart.projectId === existing.projectId &&
        chart.id !== chartId &&
        chart.isCurrent
      ) {
        chartStore.set(chart.id, {
          ...chart,
          isCurrent: false,
          updatedAt: nowIso(),
        });
      }
    }

    const updated: OrganizationChart = {
      ...existing,
      isCurrent: true,
      updatedAt: nowIso(),
    };
    chartStore.set(chartId, updated);
    return clone(updated);
  },

  async setChartStatus(chartId, status) {
    await delay();
    const existing = chartStore.get(chartId);
    if (!existing) throw new Error(`Chart ${chartId} not found`);
    if (!canTransitionTo(existing.status, status)) {
      throw new Error(
        `A ${existing.status} chart cannot be moved to ${status}`
      );
    }
    const updated: OrganizationChart = {
      ...existing,
      status,
      updatedAt: nowIso(),
    };
    chartStore.set(chartId, updated);
    return clone(updated);
  },

  async createRevision(chartId) {
    await delay();
    const source = chartStore.get(chartId);
    if (!source) throw new Error(`Chart ${chartId} not found`);

    const timestamp = nowIso();
    const revision: OrganizationChart = {
      ...source,
      id: nextId("chart"),
      status: "draft",
      version: source.version + 1,
      supersedesChartId: source.id,
      isCurrent: true,
      active: true,
      archivedAt: undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    chartStore.set(revision.id, revision);

    // Copy the positions across, keeping parentage by mapping old id to new.
    const idMap = new Map<string, string>();
    const ordered = activePositionsOf(chartId).sort(
      (a, b) => a.sortOrder - b.sortOrder
    );
    // Parents first, so a child's new parent id already exists.
    const byDepth = [...ordered].sort(
      (a, b) => depthOf(a, ordered) - depthOf(b, ordered)
    );
    for (const position of byDepth) {
      const copy: OrganizationPosition = {
        ...position,
        id: nextId("pos"),
        chartId: revision.id,
        parentPositionId: position.parentPositionId
          ? idMap.get(position.parentPositionId)
          : undefined,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      idMap.set(position.id, copy.id);
      positionStore.set(copy.id, copy);
    }

    // The source stays as the record of what was approved.
    chartStore.set(source.id, {
      ...source,
      isCurrent: false,
      updatedAt: timestamp,
    });

    return clone(revision);
  },

  async archiveChart(chartId) {
    await delay();
    const existing = chartStore.get(chartId);
    if (!existing) throw new Error(`Chart ${chartId} not found`);
    const timestamp = nowIso();
    const updated: OrganizationChart = {
      ...existing,
      status: "archived",
      isCurrent: false,
      active: false,
      archivedAt: timestamp,
      updatedAt: timestamp,
    };
    chartStore.set(chartId, updated);
    return clone(updated);
  },

  async listPositions(chartId) {
    await delay(120);
    return activePositionsOf(chartId).map(clone);
  },

  async getPositionTree(chartId) {
    await delay(120);
    return buildPositionTree(activePositionsOf(chartId));
  },

  async createPosition(input) {
    await delay();
    requireEditableChart(input.chartId);
    const siblings = activePositionsOf(input.chartId).filter(
      (position) =>
        (position.parentPositionId ?? undefined) ===
        (input.parentPositionId ?? undefined)
    );
    const timestamp = nowIso();
    const position: OrganizationPosition = {
      id: nextId("pos"),
      chartId: input.chartId,
      projectId: input.projectId,
      parentPositionId: input.parentPositionId,
      title: input.title,
      code: input.code,
      role: input.role,
      notes: input.notes,
      departmentId: input.departmentId,
      disciplineId: input.disciplineId,
      contactId: input.contactId,
      // A new seat is vacant until somebody is put in it.
      status: input.contactId ? "active" : "vacant",
      sortOrder: input.sortOrder ?? siblings.length,
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    positionStore.set(position.id, position);

    if (input.contactId) {
      recordHistory(position, undefined, input.contactId, "assigned");
    }
    return clone(position);
  },

  async updatePosition(positionId, input) {
    await delay();
    const existing = requirePosition(positionId);
    requireEditableChart(existing.chartId);

    // An empty string clears the field, matching how the Supabase
    // implementation writes NULL — the two must agree or the mock would
    // hide bugs that only appear against a real database.
    const text = (
      next: string | undefined,
      current: string | undefined
    ): string | undefined => (next === undefined ? current : next || undefined);

    const updated: OrganizationPosition = {
      ...existing,
      title: input.title === undefined ? existing.title : input.title,
      code: text(input.code, existing.code),
      role: text(input.role, existing.role),
      notes: text(input.notes, existing.notes),
      departmentId: text(input.departmentId, existing.departmentId),
      disciplineId: text(input.disciplineId, existing.disciplineId),
      company: text(input.company, existing.company),
      employmentType:
        input.employmentType === undefined
          ? existing.employmentType
          : input.employmentType || undefined,
      email: text(input.email, existing.email),
      phone: text(input.phone, existing.phone),
      status: input.status ?? existing.status,
      startDate: text(input.startDate, existing.startDate),
      endDate: text(input.endDate, existing.endDate),
      updatedAt: nowIso(),
    };
    positionStore.set(positionId, updated);
    return clone(updated);
  },

  async movePosition(positionId, parentPositionId, sortOrder) {
    await delay();
    const existing = requirePosition(positionId);
    requireEditableChart(existing.chartId);
    const positions = activePositionsOf(existing.chartId);
    if (wouldCreateCycle(positions, positionId, parentPositionId)) {
      throw new Error("A position cannot be moved beneath itself.");
    }
    const siblings = positions.filter(
      (position) =>
        position.id !== positionId &&
        (position.parentPositionId ?? undefined) ===
          (parentPositionId ?? undefined)
    );
    const updated: OrganizationPosition = {
      ...existing,
      parentPositionId,
      sortOrder: sortOrder ?? siblings.length,
      updatedAt: nowIso(),
    };
    positionStore.set(positionId, updated);
    return clone(updated);
  },

  async applyPositionTree(chartId, nodes, options) {
    await delay();
    const chart = requireEditableChart(chartId);

    if (options?.replaceExisting) {
      const timestamp = nowIso();
      for (const position of activePositionsOf(chartId)) {
        positionStore.set(position.id, {
          ...position,
          active: false,
          archivedAt: timestamp,
          updatedAt: timestamp,
        });
      }
    }

    const created: OrganizationPosition[] = [];
    // Depth-first, so a parent always exists before its children are made.
    const walk = (
      list: PositionTreeInput[],
      parentPositionId: string | undefined
    ) => {
      list.forEach((node, index) => {
        const timestamp = nowIso();
        const position: OrganizationPosition = {
          id: nextId("pos"),
          chartId,
          projectId: chart.projectId,
          parentPositionId,
          title: node.title,
          code: node.code,
          role: node.role,
          status: "vacant",
          sortOrder: index,
          active: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        positionStore.set(position.id, position);
        created.push(position);
        walk(node.children ?? [], position.id);
      });
    };
    walk(nodes, undefined);

    return created.map(clone);
  },

  async duplicatePosition(positionId) {
    await delay();
    const source = requirePosition(positionId);
    requireEditableChart(source.chartId);
    const siblings = activePositionsOf(source.chartId).filter(
      (candidate) =>
        (candidate.parentPositionId ?? undefined) ===
        (source.parentPositionId ?? undefined)
    );
    const timestamp = nowIso();
    const copy: OrganizationPosition = {
      ...clone(source),
      id: nextId("pos"),
      title: source.title + " (copy)",
      // Codes identify a single seat, so the copy starts without one.
      code: undefined,
      // A seat is duplicated, not its occupant.
      contactId: undefined,
      status: "vacant",
      sortOrder: siblings.length,
      active: true,
      archivedAt: undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    positionStore.set(copy.id, copy);
    return clone(copy);
  },

  async reorderSiblings(orderedIds) {
    await delay(120);
    const first = orderedIds[0] ? positionStore.get(orderedIds[0]) : undefined;
    if (first) requireEditableChart(first.chartId);
    orderedIds.forEach((id, index) => {
      const position = positionStore.get(id);
      if (!position || position.sortOrder === index) return;
      positionStore.set(id, {
        ...position,
        sortOrder: index,
        updatedAt: nowIso(),
      });
    });
  },

  async archivePosition(positionId) {
    await delay();
    const existing = requirePosition(positionId);
    requireEditableChart(existing.chartId);
    const timestamp = nowIso();

    // Archive the whole branch, matching the database's cascade.
    const doomed = collectDescendantIds(
      activePositionsOf(existing.chartId),
      positionId
    );
    for (const id of doomed) {
      const position = positionStore.get(id);
      if (!position) continue;
      positionStore.set(id, {
        ...position,
        active: false,
        archivedAt: timestamp,
        updatedAt: timestamp,
      });
    }

    return clone(positionStore.get(positionId)!);
  },

  async assignContact(positionId, contactId, options) {
    await delay();
    const existing = requirePosition(positionId);
    requireEditableChart(existing.chartId);
    const previous = existing.contactId;
    if (previous === contactId) return clone(existing);

    const updated: OrganizationPosition = {
      ...existing,
      contactId,
      updatedAt: nowIso(),
    };
    positionStore.set(positionId, updated);

    const action = !contactId ? "vacated" : previous ? "reassigned" : "assigned";
    recordHistory(updated, previous, contactId, action, options);
    return clone(updated);
  },

  async listAssignmentHistory(scope) {
    await delay(120);
    return [...historyStore.values()]
      .filter((entry) =>
        "positionId" in scope
          ? entry.positionId === scope.positionId
          : entry.chartId === scope.chartId
      )
      .map(clone)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
};

function recordHistory(
  position: OrganizationPosition,
  previousContactId: string | undefined,
  contactId: string | undefined,
  action: PositionAssignmentHistoryEntry["action"],
  options?: { note?: string; effectiveFrom?: string }
): void {
  const entry: PositionAssignmentHistoryEntry = {
    id: nextId("assign"),
    positionId: position.id,
    chartId: position.chartId,
    projectId: position.projectId,
    contactId,
    previousContactId,
    action,
    effectiveFrom: options?.effectiveFrom ?? today(),
    note: options?.note,
    createdAt: nowIso(),
  };
  historyStore.set(entry.id, entry);
}

/**
 * Active organization-chart service — Supabase when configured, in-memory
 * mock otherwise. Both satisfy the same interface.
 */
export const organizationChartService: OrganizationChartService =
  isSupabaseConfigured()
    ? supabaseOrganizationChartService
    : mockOrganizationChartService;

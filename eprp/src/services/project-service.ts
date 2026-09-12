import type { Project } from "@/types";
import { mockContacts } from "@/data/mock/master-data.mock";
import { mockProjects } from "@/data/mock/projects.mock";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { hasProjectAssignment } from "@/features/projects/assignment-rules";
import {
  ReplacePersonError,
  type ReplacePersonInput,
  type ReplacePersonResult,
  type ReplacePersonUnit,
} from "./replace-person";
import { supabaseProjectService } from "./supabase-project-service";

// Re-exported so existing imports of these from "@/services/project-service"
// keep working unchanged. The canonical definitions live in "./replace-person"
// — a module neither this file nor supabase-project-service.ts may ever
// import a runtime value FROM each other through. See that file's header for
// why: the two service modules already depend on each other one way
// (this file picks `supabaseProjectService` at load time), and
// supabase-project-service.ts needs `ReplacePersonError` as a real value
// (for `instanceof`), so defining it here instead of there turned that
// existing one-way edge into a cycle — the exact cause of "Cannot access
// 'supabaseProjectService' before initialization".
export type {
  ReplacePersonErrorReason,
  ReplacePersonInput,
  ReplacePersonResult,
  ReplacePersonUnit,
  ReplacePersonUnitKind,
} from "./replace-person";
export { ReplacePersonError } from "./replace-person";

/**
 * Project master-data service (Phase 5A: mock implementation).
 *
 * Backed by an in-memory store seeded from mock data. The interface is the
 * contract the Supabase implementation must satisfy later — UI code never
 * touches the store directly.
 */
/** Which parts of the assignment feature the database can currently store. */
export interface AssignmentSupport {
  /** project_contacts.assignment_role / functional_title / reports_to_contact_id */
  assignmentColumns: boolean;
  /** project_delegations table */
  delegations: boolean;
}

export interface ProjectService {
  getProjects(): Promise<Project[]>;
  getProjectById(id: string): Promise<Project | null>;
  createProject(
    input: Omit<Project, "id" | "createdAt" | "updatedAt">
  ): Promise<Project>;
  updateProject(
    id: string,
    input: Partial<Omit<Project, "id" | "createdAt" | "updatedAt">>
  ): Promise<Project>;
  duplicateProject(id: string): Promise<Project>;
  archiveProject(id: string): Promise<Project>;
  /** Codes in use, for uniqueness validation (excluding one project id). */
  getUsedCodes(excludeId?: string): Promise<string[]>;
  /**
   * Whether the additive assignment migration is applied, so the UI can
   * disable just the affected editors instead of letting a save fail.
   */
  getAssignmentSupport(): Promise<AssignmentSupport>;
  /**
   * Replace Person — project-level, responsibility-scoped. Swaps who holds
   * ONE identified assignment; never a blanket replace-everywhere. Throws
   * {@link ReplacePersonError} on any refusal. See Pass A migration
   * `20260909000001_replace_person_foundation.sql` for the authoritative
   * (Supabase-backed) validation and history behaviour this mirrors.
   */
  replacePerson(input: ReplacePersonInput): Promise<ReplacePersonResult>;
}

/** Deep-clone so callers can't mutate the store. */
function clone<T>(value: T): T {
  return structuredClone(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Small artificial latency so loading states behave like a real backend. */
function delay(ms = 250): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const store: Map<string, Project> = new Map(
  mockProjects.map((p) => [p.id, clone(p)])
);

let sequence = store.size;

function nextId(): string {
  sequence += 1;
  return `prj-new-${sequence}`;
}

/**
 * In-memory mirror of `project_responsibility_history` — mock-phase only, so
 * `replacePerson` behaves identically whether or not Supabase is configured.
 * Nothing reads this yet; it exists so the mock does not silently diverge from
 * what the real migration records.
 */
interface MockReplacePersonHistoryEntry {
  id: string;
  projectId: string;
  unit: ReplacePersonUnit;
  previousContactId: string;
  contactId: string;
  reason: string;
  createdAt: string;
}

const replacePersonHistory: MockReplacePersonHistoryEntry[] = [];
let replacePersonHistorySequence = 0;

/**
 * Synchronous snapshot of the project store — mock-phase only, used by the
 * master-data services for reference/usage checks. The database phase
 * replaces this with real relational queries.
 */
export function listProjectsSync(): Project[] {
  return [...store.values()].map(clone);
}

const mockProjectService: ProjectService = {
  async getProjects() {
    await delay();
    return [...store.values()]
      .map(clone)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async getProjectById(id) {
    await delay(150);
    const project = store.get(id);
    return project ? clone(project) : null;
  },

  async createProject(input) {
    await delay();
    const timestamp = nowIso();
    const project: Project = {
      ...clone(input),
      id: nextId(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.set(project.id, project);
    return clone(project);
  },

  async updateProject(id, input) {
    await delay();
    const existing = store.get(id);
    if (!existing) {
      throw new Error(`Project ${id} not found`);
    }
    const updated: Project = {
      ...existing,
      ...clone(input),
      id,
      createdAt: existing.createdAt,
      updatedAt: nowIso(),
    };
    store.set(id, updated);
    return clone(updated);
  },

  async duplicateProject(id) {
    await delay();
    const source = store.get(id);
    if (!source) {
      throw new Error(`Project ${id} not found`);
    }
    const timestamp = nowIso();
    const copy: Project = {
      ...clone(source),
      id: nextId(),
      code: `${source.code}-COPY`,
      name: `${source.name} (Copy)`,
      status: "planning",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.set(copy.id, copy);
    return clone(copy);
  },

  async archiveProject(id) {
    await delay();
    return mockProjectService.updateProject(id, { status: "archived" });
  },

  async getAssignmentSupport() {
    // The in-memory store has no schema to lag behind.
    return { assignmentColumns: true, delegations: true };
  },

  async getUsedCodes(excludeId) {
    return [...store.values()]
      .filter((p) => p.id !== excludeId)
      .map((p) => p.code.toUpperCase());
  },

  /**
   * Mirrors `replace_project_responsibility()` (Pass A migration) against the
   * in-memory store: same three shapes, same validation order, same refusal
   * reasons. Kept separate from `assignment-rules.ts`'s `managerConflict()` —
   * that predicate flags the CURRENT incumbent as a conflict, which is right
   * for "promote this person" but wrong here, since removing the incumbent is
   * exactly what this call does. Only a genuinely different third manager is
   * refused.
   */
  async replacePerson(input) {
    await delay();
    const { projectId, unit, fromContactId, toContactId, reason } = input;

    if (fromContactId === toContactId) {
      throw new ReplacePersonError(
        "same_person",
        "Choose a different person to replace them with."
      );
    }

    // A replacement is a governed responsibility change, not a data edit —
    // required in both backends, identically, per the Pass A security review.
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      throw new ReplacePersonError(
        "reason_required",
        "A reason is required to replace this responsibility."
      );
    }

    const project = store.get(projectId);
    if (!project) {
      throw new ReplacePersonError("not_found", "Project not found.");
    }
    if (!mockContacts.some((c) => c.id === fromContactId)) {
      throw new ReplacePersonError("not_found", "The person being replaced was not found.");
    }
    const toContact = mockContacts.find((c) => c.id === toContactId);
    if (!toContact) {
      throw new ReplacePersonError("not_found", "Replacement person not found.");
    }
    if (!toContact.active) {
      throw new ReplacePersonError(
        "invalid_replacement",
        "The replacement person is not active. Choose an active person."
      );
    }

    let updated: Project = clone(project);
    let rowsUpdated = 0;
    let reportsRepointed = 0;
    let delegationsAsDelegate = 0;
    let delegationsRequiringReview = 0;

    if (unit.kind === "fixed_responsibility") {
      const field = unit.responsibilityField;
      if (!field) {
        throw new ReplacePersonError("invalid_replacement", "Unrecognized responsibility.");
      }
      if (updated[field] !== fromContactId) {
        throw new ReplacePersonError(
          "stale_assignment",
          "This responsibility is no longer held by the selected person. Reload and try again."
        );
      }
      // Mirrors guard_fixed_project_responsibility_membership() — a fixed
      // responsibility (and, below, a project_positions row) may only be
      // assigned to someone already on the project team, elsewhere in the
      // fixed roles, or matches the DB's own trigger predicate.
      if (!hasProjectAssignment(updated, toContactId)) {
        throw new ReplacePersonError(
          "not_project_member",
          "The replacement person must already be part of this project before they can hold this responsibility."
        );
      }
      updated = { ...updated, [field]: toContactId };
      rowsUpdated = 1;
    } else if (unit.kind === "department_assignment") {
      const { departmentId, assignmentRole } = unit;
      if (!departmentId || !assignmentRole) {
        throw new ReplacePersonError(
          "invalid_replacement",
          "Department and assignment role are required."
        );
      }
      const team = updated.team ?? [];
      const holds = (m: (typeof team)[number], contactId: string) =>
        m.departmentId === departmentId &&
        m.contactId === contactId &&
        (m.assignmentRole ?? "team_member") === assignmentRole;

      const matching = team.filter((m) => holds(m, fromContactId));
      if (matching.length === 0) {
        throw new ReplacePersonError(
          "stale_assignment",
          "This assignment is no longer held by the selected person. Reload and try again."
        );
      }
      if (team.some((m) => holds(m, toContactId))) {
        throw new ReplacePersonError(
          "duplicate_assignment",
          "The replacement person already holds this role in this department."
        );
      }
      if (
        assignmentRole === "department_manager" &&
        team.some(
          (m) =>
            m.departmentId === departmentId &&
            m.contactId !== fromContactId &&
            (m.assignmentRole ?? "team_member") === "department_manager"
        )
      ) {
        throw new ReplacePersonError(
          "manager_conflict",
          "Another person already manages this department. Resolve that conflict before replacing the manager."
        );
      }

      // Mirrors trg_project_contact_membership_removal's own guard: would this
      // retarget leave the outgoing person with no team row left on this
      // project at all, while they still hold a fixed responsibility or an
      // additional position here? Refuse rather than orphan that reference —
      // never reassign it, never fabricate a replacement membership.
      const remainingElsewhere = team.some((m) => m.contactId === fromContactId && !holds(m, fromContactId));
      if (!remainingElsewhere) {
        const stillReferenced =
          [
            updated.projectManagerId,
            updated.projectControlManagerId,
            updated.reportingCoordinatorId,
            updated.clientRepresentativeId,
            updated.projectSponsorId,
          ].includes(fromContactId) ||
          (updated.positions ?? []).some((p) => p.contactId === fromContactId);
        if (stillReferenced) {
          throw new ReplacePersonError(
            "last_membership_referenced",
            "This person still holds another project responsibility. Reassign that responsibility first before removing their final project team assignment."
          );
        }
      }

      let nextTeam = team.map((m) =>
        holds(m, fromContactId) ? { ...m, contactId: toContactId } : m
      );
      rowsUpdated = matching.length;

      if (assignmentRole === "department_manager") {
        nextTeam = nextTeam.map((m) =>
          m.departmentId === departmentId && m.contactId === toContactId && m.reportsToContactId
            ? { ...m, reportsToContactId: undefined }
            : m
        );
        const beforeRepoint = nextTeam;
        nextTeam = beforeRepoint.map((m) =>
          m.departmentId === departmentId &&
          m.reportsToContactId === fromContactId &&
          m.contactId !== toContactId
            ? { ...m, reportsToContactId: toContactId }
            : m
        );
        reportsRepointed = beforeRepoint.filter(
          (m, i) => m.reportsToContactId !== nextTeam[i].reportsToContactId
        ).length;
      }
      updated = { ...updated, team: nextTeam };

      const delegations = updated.delegations ?? [];
      delegationsAsDelegate = delegations.filter(
        (d) => d.departmentId === departmentId && d.delegateContactId === fromContactId && d.active
      ).length;
      // Not "granted by the outgoing manager" — project_delegations has no
      // delegator column, so that causal link is not a fact this schema can
      // prove. Every active delegation in the department is surfaced for
      // separate human review instead.
      delegationsRequiringReview =
        assignmentRole === "department_manager"
          ? delegations.filter((d) => d.departmentId === departmentId && d.active).length
          : 0;
    } else {
      const positionId = unit.positionId;
      if (!positionId) {
        throw new ReplacePersonError("invalid_replacement", "Position is required.");
      }
      const positions = updated.positions ?? [];
      const position = positions.find((p) => p.id === positionId);
      if (!position || position.contactId !== fromContactId) {
        throw new ReplacePersonError(
          "stale_assignment",
          "This position is no longer held by the selected person. Reload and try again."
        );
      }
      if (
        positions.some(
          (p) =>
            p.id !== positionId &&
            p.jobTitleId === position.jobTitleId &&
            p.contactId === toContactId
        )
      ) {
        throw new ReplacePersonError(
          "duplicate_assignment",
          "The replacement person already holds this position."
        );
      }
      if (!hasProjectAssignment(updated, toContactId)) {
        throw new ReplacePersonError(
          "not_project_member",
          "The replacement person must already be part of this project before they can hold this position."
        );
      }
      updated = {
        ...updated,
        positions: positions.map((p) =>
          p.id === positionId ? { ...p, contactId: toContactId } : p
        ),
      };
      rowsUpdated = 1;
    }

    updated.updatedAt = nowIso();
    store.set(projectId, updated);

    replacePersonHistorySequence += 1;
    const historyId = `rph-${replacePersonHistorySequence}`;
    replacePersonHistory.push({
      id: historyId,
      projectId,
      unit,
      previousContactId: fromContactId,
      contactId: toContactId,
      reason: trimmedReason,
      createdAt: nowIso(),
    });

    return {
      historyId,
      unitKind: unit.kind,
      rowsUpdated,
      reportsRepointed,
      delegationsAsDelegate,
      delegationsRequiringReview,
    };
  },
};

/**
 * Active project service — Supabase when configured, in-memory mock
 * otherwise. UI code imports `projectService` and is unaffected by the
 * choice (both satisfy the same interface).
 */
export const projectService: ProjectService = isSupabaseConfigured()
  ? supabaseProjectService
  : mockProjectService;

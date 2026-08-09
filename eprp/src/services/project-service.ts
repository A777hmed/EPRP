import type { Project } from "@/types";
import { mockProjects } from "@/data/mock/projects.mock";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { supabaseProjectService } from "./supabase-project-service";

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
};

/**
 * Active project service — Supabase when configured, in-memory mock
 * otherwise. UI code imports `projectService` and is unaffected by the
 * choice (both satisfy the same interface).
 */
export const projectService: ProjectService = isSupabaseConfigured()
  ? supabaseProjectService
  : mockProjectService;

import type {
  Client,
  Contact,
  Department,
  Discipline,
  MasterRecordBase,
  ProjectPhase,
  ProjectType,
  System,
} from "@/types";

/**
 * Admin-managed master-data kinds.
 * Phase 5A: client, project type, phase, contact.
 * Phase 5B: department, system, discipline.
 */
export type MasterKind =
  | "client"
  | "projectType"
  | "projectPhase"
  | "contact"
  | "department"
  | "system"
  | "discipline";

export interface MasterRecordMap {
  client: Client;
  projectType: ProjectType;
  projectPhase: ProjectPhase;
  contact: Contact;
  department: Department;
  system: System;
  discipline: Discipline;
}

export interface MasterFieldConfig {
  /** Property key on the record. */
  key: string;
  label: string;
  type: "text" | "email" | "tel" | "textarea" | "number" | "reference";
  required?: boolean;
  placeholder?: string;
  /** For `type: "reference"` — the master-data kind this field points to. */
  refKind?: MasterKind;
}

export interface CanDeleteResult {
  allowed: boolean;
  /** Human-readable references blocking deletion, e.g. "Project PSAIM-001". */
  usedBy: string[];
}

export interface MasterDataService<T extends MasterRecordBase> {
  getAll(): Promise<T[]>;
  getActive(): Promise<T[]>;
  getById(id: string): Promise<T | null>;
  create(input: Partial<T> & { name: string }): Promise<T>;
  update(id: string, input: Partial<Omit<T, "id">>): Promise<T>;
  archive(id: string): Promise<T>;
  restore(id: string): Promise<T>;
  canDelete(id: string): Promise<CanDeleteResult>;
  /** Permanent delete; rejects when the record is still referenced. */
  delete(id: string): Promise<void>;
  /** Mock-phase change notifications for auto-refreshing selects. */
  subscribe(listener: () => void): () => void;
  /** Referentially-stable sync snapshot (mock phase display resolution). */
  getAllSync(): T[];
  getByIdSync(id: string | undefined): T | undefined;
}

export interface MasterKindConfig {
  kind: MasterKind;
  singular: string;
  plural: string;
  /** Form + table fields beyond the implicit name/code/active. */
  fields: MasterFieldConfig[];
  /** Secondary line shown under the option label, e.g. client short name. */
  optionSublabel?: (record: MasterRecordBase) => string | undefined;
}

/** Thrown by create/update when a name or code already exists. */
export class DuplicateRecordError extends Error {
  constructor(
    public readonly field: "name" | "code",
    message: string
  ) {
    super(message);
    this.name = "DuplicateRecordError";
  }
}

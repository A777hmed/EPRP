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
import {
  mockClients,
  mockContacts,
  mockDepartments,
  mockDisciplines,
  mockProjectPhases,
  mockProjectTypes,
  mockSystems,
} from "@/data/mock/master-data.mock";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { listProjectsSync } from "@/services/project-service";
import { createSupabaseMasterDataService } from "./supabase-service";
import {
  DuplicateRecordError,
  type MasterDataService,
  type MasterKind,
  type MasterKindConfig,
} from "./types";

/**
 * Mock master-data services (Phase 5A): in-memory stores with change
 * notifications so managed selects refresh automatically. The service
 * interface is the contract the Supabase implementation adopts later.
 */

function delay(ms = 150): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

interface FactoryOptions<T extends MasterRecordBase> {
  idPrefix: string;
  seed: T[];
  /** Human-readable references blocking deletion. */
  usedBy: (id: string) => string[];
  /** Extra defaults applied on create (e.g. next displayOrder). */
  createDefaults?: (existing: T[]) => Partial<T>;
  sort?: (a: T, b: T) => number;
}

function createMasterDataService<T extends MasterRecordBase>({
  idPrefix,
  seed,
  usedBy,
  createDefaults,
  sort,
}: FactoryOptions<T>): MasterDataService<T> {
  const store = new Map<string, T>(seed.map((r) => [r.id, clone(r)]));
  const listeners = new Set<() => void>();
  let snapshot: T[] | null = null;
  let sequence = 0;

  const sortFn = sort ?? ((a: T, b: T) => a.name.localeCompare(b.name));

  const invalidate = () => {
    snapshot = null;
    for (const listener of listeners) listener();
  };

  const all = () => [...store.values()].sort(sortFn);

  const assertNoDuplicate = (
    input: { name?: string; code?: string },
    excludeId?: string
  ) => {
    const records = [...store.values()].filter((r) => r.id !== excludeId);
    if (
      input.name &&
      records.some((r) => r.name.toLowerCase() === input.name!.toLowerCase())
    ) {
      throw new DuplicateRecordError("name", "This name already exists");
    }
    if (
      input.code &&
      records.some(
        (r) => r.code && r.code.toLowerCase() === input.code!.toLowerCase()
      )
    ) {
      throw new DuplicateRecordError("code", "This code already exists");
    }
  };

  const mustGet = (id: string): T => {
    const record = store.get(id);
    if (!record) throw new Error(`Record ${id} not found`);
    return record;
  };

  return {
    async getAll() {
      await delay();
      return all().map(clone);
    },
    async getActive() {
      await delay();
      return all()
        .filter((r) => r.active)
        .map(clone);
    },
    async getById(id) {
      await delay(80);
      const record = store.get(id);
      return record ? clone(record) : null;
    },
    async create(input) {
      await delay();
      assertNoDuplicate(input);
      sequence += 1;
      const record = {
        active: true,
        ...createDefaults?.(all()),
        ...clone(input),
        id: `${idPrefix}-new-${sequence}`,
      } as T;
      store.set(record.id, record);
      invalidate();
      return clone(record);
    },
    async update(id, input) {
      await delay();
      const existing = mustGet(id);
      assertNoDuplicate(
        { name: input.name as string | undefined, code: input.code as string | undefined },
        id
      );
      const updated = { ...existing, ...clone(input), id } as T;
      store.set(id, updated);
      invalidate();
      return clone(updated);
    },
    async archive(id) {
      await delay();
      const updated = { ...mustGet(id), active: false };
      store.set(id, updated);
      invalidate();
      return clone(updated);
    },
    async restore(id) {
      await delay();
      const updated = { ...mustGet(id), active: true };
      store.set(id, updated);
      invalidate();
      return clone(updated);
    },
    async canDelete(id) {
      await delay(80);
      const references = usedBy(id);
      return { allowed: references.length === 0, usedBy: references };
    },
    async delete(id) {
      await delay();
      const references = usedBy(id);
      if (references.length > 0) {
        throw new Error(
          `Cannot delete — still referenced by ${references.join(", ")}`
        );
      }
      store.delete(id);
      invalidate();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getAllSync() {
      if (!snapshot) snapshot = all().map(clone);
      return snapshot;
    },
    getByIdSync(id) {
      if (!id) return undefined;
      const record = store.get(id);
      return record ? clone(record) : undefined;
    },
  };
}

/* ------------------------------- Usage checks ----------------------------- */

const projectLabel = (code: string, name: string) => `Project ${code} (${name})`;

function projectsUsing(predicate: (p: ReturnType<typeof listProjectsSync>[number]) => boolean): string[] {
  return listProjectsSync()
    .filter(predicate)
    .map((p) => projectLabel(p.code, p.shortName ?? p.name));
}

/* ----------------------------- Mock instances ----------------------------- */

const mockClientService: MasterDataService<Client> = createMasterDataService({
  idPrefix: "cl",
  seed: mockClients,
  usedBy: (id) => projectsUsing((p) => p.clientId === id),
});

const mockProjectTypeService: MasterDataService<ProjectType> =
  createMasterDataService({
    idPrefix: "pt",
    seed: mockProjectTypes,
    usedBy: (id) => projectsUsing((p) => p.projectTypeId === id),
  });

const mockProjectPhaseService: MasterDataService<ProjectPhase> =
  createMasterDataService({
    idPrefix: "ph",
    seed: mockProjectPhases,
    usedBy: (id) => projectsUsing((p) => p.currentPhaseId === id),
    createDefaults: (existing) => ({
      displayOrder: Math.max(0, ...existing.map((p) => p.displayOrder)) + 1,
    }),
    sort: (a, b) => a.displayOrder - b.displayOrder,
  });

const mockContactService: MasterDataService<Contact> =
  createMasterDataService({
    idPrefix: "ct",
    seed: mockContacts,
    usedBy: (id) => [
      ...projectsUsing(
        (p) =>
          p.projectManagerId === id ||
          p.projectControlManagerId === id ||
          p.clientRepresentativeId === id ||
          p.reportingCoordinatorId === id ||
          p.projectSponsorId === id
      ),
      ...mockDepartmentService
        .getAllSync()
        .filter((d) => d.leadContactId === id)
        .map((d) => `Department lead: ${d.name}`),
    ],
  });

const mockDepartmentService: MasterDataService<Department> =
  createMasterDataService({
    idPrefix: "dp",
    seed: mockDepartments,
    usedBy: (id) => [
      ...projectsUsing((p) =>
        p.departments.some((d) => d.departmentId === id)
      ),
      ...mockSystemService
        .getAllSync()
        .filter((s) => s.departmentId === id)
        .map((s) => `System: ${s.name}`),
      ...mockDisciplineService
        .getAllSync()
        .filter((d) => d.departmentId === id)
        .map((d) => `Discipline: ${d.name}`),
      ...mockContactService
        .getAllSync()
        .filter((c) => c.departmentId === id)
        .map((c) => `Contact: ${c.name}`),
    ],
  });

const mockSystemService: MasterDataService<System> =
  createMasterDataService({
    idPrefix: "sy",
    seed: mockSystems,
    // Project system assignments are denormalized copies, so master
    // systems are not directly referenced yet.
    usedBy: () => [],
  });

const mockDisciplineService: MasterDataService<Discipline> =
  createMasterDataService({
    idPrefix: "di",
    seed: mockDisciplines,
    usedBy: () => [],
  });

/* ------------------------- Active service selection ----------------------- */

const supabaseClientService = createSupabaseMasterDataService<Client>({
  table: "clients",
  references: [{ table: "projects", column: "client_id", label: "project" }],
});

const supabaseProjectTypeService =
  createSupabaseMasterDataService<ProjectType>({
    table: "project_types",
    references: [
      { table: "projects", column: "project_type_id", label: "project" },
    ],
  });

const supabaseProjectPhaseService =
  createSupabaseMasterDataService<ProjectPhase>({
    table: "project_phases",
    references: [
      { table: "projects", column: "current_phase_id", label: "project" },
    ],
    orderBy: "display_order",
  });

const supabaseContactService = createSupabaseMasterDataService<Contact>({
  table: "contacts",
  references: [
    { table: "departments", column: "lead_contact_id", label: "department" },
    { table: "projects", column: "project_manager_id", label: "project" },
    {
      table: "projects",
      column: "project_control_manager_id",
      label: "project",
    },
    {
      table: "projects",
      column: "client_representative_id",
      label: "project",
    },
    {
      table: "projects",
      column: "reporting_coordinator_id",
      label: "project",
    },
    { table: "projects", column: "project_sponsor_id", label: "project" },
    { table: "project_contacts", column: "contact_id", label: "project role" },
    {
      table: "weekly_reports",
      column: "prepared_by_contact_id",
      label: "weekly report",
    },
    {
      table: "weekly_submissions",
      column: "responsible_contact_id",
      label: "department update",
    },
  ],
});

const supabaseDepartmentService =
  createSupabaseMasterDataService<Department>({
    table: "departments",
    references: [
      {
        table: "project_departments",
        column: "department_id",
        label: "project assignment",
      },
      { table: "systems", column: "department_id", label: "system" },
      { table: "disciplines", column: "department_id", label: "discipline" },
      { table: "contacts", column: "department_id", label: "contact" },
      {
        table: "weekly_submissions",
        column: "department_id",
        label: "department update",
      },
    ],
  });

const supabaseSystemService = createSupabaseMasterDataService<System>({
  table: "systems",
  references: [],
});

const supabaseDisciplineService =
  createSupabaseMasterDataService<Discipline>({
    table: "disciplines",
    references: [
      {
        table: "weekly_submissions",
        column: "discipline_id",
        label: "department update",
      },
    ],
  });

/** Managed selectors use Supabase whenever configured; local development
 * keeps the in-memory stores as the offline fallback. */
const useSupabase = isSupabaseConfigured();

export const clientService: MasterDataService<Client> = useSupabase
  ? supabaseClientService
  : mockClientService;

export const projectTypeService: MasterDataService<ProjectType> = useSupabase
  ? supabaseProjectTypeService
  : mockProjectTypeService;

export const projectPhaseService: MasterDataService<ProjectPhase> = useSupabase
  ? supabaseProjectPhaseService
  : mockProjectPhaseService;

export const contactService: MasterDataService<Contact> = useSupabase
  ? supabaseContactService
  : mockContactService;

export const departmentService: MasterDataService<Department> = useSupabase
  ? supabaseDepartmentService
  : mockDepartmentService;

export const systemService: MasterDataService<System> = useSupabase
  ? supabaseSystemService
  : mockSystemService;

export const disciplineService: MasterDataService<Discipline> = useSupabase
  ? supabaseDisciplineService
  : mockDisciplineService;

/* ------------------------------- Kind registry ---------------------------- */

export const MASTER_KIND_CONFIG: Record<MasterKind, MasterKindConfig> = {
  client: {
    kind: "client",
    singular: "Client",
    plural: "Clients",
    fields: [
      { key: "name", label: "Client Name", type: "text", required: true },
      { key: "code", label: "Client Code", type: "text" },
      { key: "shortName", label: "Short Name", type: "text" },
      { key: "contactName", label: "Contact Name", type: "text" },
      { key: "contactEmail", label: "Contact Email", type: "email" },
      { key: "contactPhone", label: "Contact Phone", type: "tel" },
      { key: "country", label: "Country", type: "text" },
      { key: "city", label: "City", type: "text" },
      { key: "address", label: "Address", type: "textarea" },
    ],
    optionSublabel: (record) => (record as Client).shortName,
  },
  projectType: {
    kind: "projectType",
    singular: "Project Type",
    plural: "Project Types",
    fields: [
      { key: "name", label: "Type Name", type: "text", required: true },
      { key: "code", label: "Type Code", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
    ],
  },
  projectPhase: {
    kind: "projectPhase",
    singular: "Phase",
    plural: "Phases",
    fields: [
      { key: "name", label: "Phase Name", type: "text", required: true },
      { key: "code", label: "Phase Code", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
      { key: "displayOrder", label: "Display Order", type: "number" },
    ],
  },
  contact: {
    kind: "contact",
    singular: "Person",
    plural: "People",
    fields: [
      { key: "name", label: "Full Name", type: "text", required: true },
      { key: "position", label: "Job Title", type: "text", required: true },
      { key: "role", label: "Role", type: "text" },
      { key: "organization", label: "Organization", type: "text" },
      { key: "email", label: "Email", type: "email" },
      { key: "phone", label: "Phone", type: "tel" },
      {
        key: "departmentId",
        label: "Department",
        type: "reference",
        refKind: "department",
      },
    ],
    optionSublabel: (record) => (record as Contact).position,
  },
  department: {
    kind: "department",
    singular: "Department",
    plural: "Departments",
    fields: [
      { key: "name", label: "Department Name", type: "text", required: true },
      { key: "code", label: "Department Code", type: "text", required: true },
      { key: "description", label: "Description", type: "textarea" },
      {
        key: "leadContactId",
        label: "Department Lead",
        type: "reference",
        refKind: "contact",
      },
    ],
  },
  system: {
    kind: "system",
    singular: "System",
    plural: "Systems",
    fields: [
      { key: "name", label: "System Name", type: "text", required: true },
      { key: "code", label: "System Code", type: "text", required: true },
      {
        key: "departmentId",
        label: "Related Department",
        type: "reference",
        refKind: "department",
      },
      { key: "description", label: "Description", type: "textarea" },
    ],
  },
  discipline: {
    kind: "discipline",
    singular: "Discipline",
    plural: "Disciplines",
    fields: [
      { key: "name", label: "Discipline Name", type: "text", required: true },
      { key: "code", label: "Discipline Code", type: "text", required: true },
      {
        key: "departmentId",
        label: "Related Department",
        type: "reference",
        refKind: "department",
      },
      { key: "description", label: "Description", type: "textarea" },
    ],
  },
};

const services: Record<MasterKind, MasterDataService<MasterRecordBase>> = {
  client: clientService,
  projectType: projectTypeService,
  projectPhase: projectPhaseService,
  contact: contactService,
  department: departmentService,
  system: systemService,
  discipline: disciplineService,
};

export function getMasterService(
  kind: MasterKind
): MasterDataService<MasterRecordBase> {
  return services[kind];
}

/* --------------------------- Display resolution --------------------------- */

export function getClientById(id: string | undefined): Client | undefined {
  return clientService.getByIdSync(id);
}

export function getProjectTypeById(
  id: string | undefined
): ProjectType | undefined {
  return projectTypeService.getByIdSync(id);
}

export function getProjectPhaseById(
  id: string | undefined
): ProjectPhase | undefined {
  return projectPhaseService.getByIdSync(id);
}

export function getContactById(id: string | undefined): Contact | undefined {
  return contactService.getByIdSync(id);
}

export function getDepartmentById(
  id: string | undefined
): Department | undefined {
  return departmentService.getByIdSync(id);
}

export function getSystemById(id: string | undefined): System | undefined {
  return systemService.getByIdSync(id);
}

export function getDisciplineById(
  id: string | undefined
): Discipline | undefined {
  return disciplineService.getByIdSync(id);
}

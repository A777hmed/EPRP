import type { Contact, Department, Discipline } from "@/types";
import { notImplemented } from "./not-implemented";

/** Master data for departments, disciplines, and their contacts. */
export interface DepartmentService {
  list(): Promise<Department[]>;
  getById(id: string): Promise<Department | null>;
  create(input: Omit<Department, "id">): Promise<Department>;
  update(id: string, input: Partial<Department>): Promise<Department>;
  listDisciplines(): Promise<Discipline[]>;
  listContacts(departmentId: string): Promise<Contact[]>;
}

export const departmentService: DepartmentService = {
  list: notImplemented("departmentService.list"),
  getById: notImplemented("departmentService.getById"),
  create: notImplemented("departmentService.create"),
  update: notImplemented("departmentService.update"),
  listDisciplines: notImplemented("departmentService.listDisciplines"),
  listContacts: notImplemented("departmentService.listContacts"),
};

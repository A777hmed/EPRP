import { getDisciplineById, getSystemById } from "@/features/master-data";
import type { MasterKind } from "@/features/master-data";
import { projectService } from "@/services/project-service";
import type {
  DepartmentAssignment,
  MasterRecordBase,
  Project,
  ProjectDisciplineLink,
  ProjectTeamMember,
} from "@/types";
import type { ProjectLinkContext } from "./project-link-context";

/**
 * Attach a freshly created (or edited) master record to the project the user
 * came from, at the scope implied by the parent they came through.
 *
 * Every branch is idempotent: an equivalent link is left alone rather than
 * appended, so bouncing between steps or using "Save & Add Another" can
 * never fan out duplicates. Returns true when the project was written to.
 */
export async function linkRecordToProject(
  kind: MasterKind,
  record: MasterRecordBase,
  context: ProjectLinkContext
): Promise<boolean> {
  const { projectId } = context;
  if (!projectId) return false;

  const project = await projectService.getProjectById(projectId);
  if (!project) return false;

  switch (kind) {
    case "department":
      return linkDepartment(project, record.id);
    case "system":
      return linkSystem(project, record, context);
    case "discipline":
      return linkDiscipline(project, record.id, context);
    case "contact":
      return linkContact(project, record.id, context);
    default:
      return false;
  }
}

/** The department a scope hangs off, resolved from whatever parent we have. */
function resolveDepartmentId(
  context: ProjectLinkContext
): string | undefined {
  if (context.departmentId) return context.departmentId;
  switch (context.sourceType) {
    case "department":
      return context.parentId;
    case "system":
      return getSystemById(context.parentId)?.departmentId;
    case "discipline":
      return getDisciplineById(context.parentId)?.departmentId;
    default:
      return undefined;
  }
}

async function linkDepartment(
  project: Project,
  departmentId: string
): Promise<boolean> {
  if (
    project.departments.some(
      (assignment) => assignment.departmentId === departmentId
    )
  ) {
    return false;
  }
  const next: DepartmentAssignment[] = [
    ...project.departments,
    { departmentId, leadName: "", reportingRequired: true, systems: [] },
  ];
  await projectService.updateProject(project.id, { departments: next });
  return true;
}

async function linkSystem(
  project: Project,
  system: MasterRecordBase,
  context: ProjectLinkContext
): Promise<boolean> {
  // A system belongs to one department; prefer its own over the parent hint
  // so the assignment lands under the department that actually owns it.
  const departmentId =
    (system as { departmentId?: string }).departmentId ??
    resolveDepartmentId(context);
  if (!departmentId) return false;

  const assignment = project.departments.find(
    (candidate) => candidate.departmentId === departmentId
  );
  if (!assignment) return false; // Department is not on the project.
  if (assignment.systems.some((assigned) => assigned.id === system.id)) {
    return false;
  }

  const next = project.departments.map((candidate) =>
    candidate.departmentId === departmentId
      ? {
          ...candidate,
          systems: [
            ...candidate.systems,
            { id: system.id, name: system.name, code: system.code },
          ],
        }
      : candidate
  );
  await projectService.updateProject(project.id, { departments: next });
  return true;
}

async function linkDiscipline(
  project: Project,
  disciplineId: string,
  context: ProjectLinkContext
): Promise<boolean> {
  const systemId =
    context.sourceType === "system" ? context.parentId : undefined;
  const departmentId =
    getDisciplineById(disciplineId)?.departmentId ??
    resolveDepartmentId(context);
  if (!departmentId) return false;

  const links = project.disciplines ?? [];
  const exists = links.some(
    (link) =>
      link.disciplineId === disciplineId &&
      (link.systemId ?? undefined) === (systemId ?? undefined)
  );
  if (exists) return false;

  const next: ProjectDisciplineLink[] = [
    ...links,
    { disciplineId, departmentId, systemId },
  ];
  await projectService.updateProject(project.id, { disciplines: next });
  return true;
}

async function linkContact(
  project: Project,
  contactId: string,
  context: ProjectLinkContext
): Promise<boolean> {
  const systemId =
    context.sourceType === "system" ? context.parentId : undefined;
  const disciplineId =
    context.sourceType === "discipline" ? context.parentId : undefined;
  const departmentId = resolveDepartmentId(context);
  if (!departmentId) return false;

  const team = project.team ?? [];
  const exists = team.some(
    (member) =>
      member.contactId === contactId &&
      member.departmentId === departmentId &&
      (member.systemId ?? undefined) === (systemId ?? undefined) &&
      (member.disciplineId ?? undefined) === (disciplineId ?? undefined)
  );
  if (exists) return false;

  const next: ProjectTeamMember[] = [
    ...team,
    { contactId, departmentId, systemId, disciplineId },
  ];
  await projectService.updateProject(project.id, { team: next });
  return true;
}

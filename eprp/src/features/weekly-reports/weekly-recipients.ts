/**
 * Who receives a department's Weekly, resolved from project assignment data.
 *
 * NOBODY IS INVENTED, AND NOBODY IS INFERRED FROM PAST SUBMISSIONS.
 *
 * Phase 1 derived "contributors" from whoever happened to be named on previous
 * submission rows. That was the wrong source twice over: it reports history
 * rather than assignment, and it is empty for a Weekly nobody has filled in
 * yet — which is exactly when Project Control needs the recipient list. The
 * roster lives on the project (`Project.team`, one entry per department
 * assignment) and that is what this module reads.
 *
 * Resolution, per department:
 *
 *   Manager ....... the project team member assigned `department_manager` for
 *                   this department, else the department's own master-data lead
 *                   (`Department.leadContactId`), else the free-text lead name
 *                   recorded on the project's department assignment.
 *   Contributors .. every other project team member assigned to the department.
 *   Emails ........ read from each resolved Contact; absent where not stored.
 *
 * Scope is always project AND department together, so a person assigned to a
 * department on another project never appears here.
 */

import type { Contact, Department, Project } from "@/types";

export interface Recipient {
  contactId?: string;
  name: string;
  email?: string;
  /** Free-text project assignment label, never a permission. */
  functionalTitle?: string;
  /** True when the name came from free text with no contact record behind it. */
  unlinked?: boolean;
}

export interface DepartmentRecipients {
  departmentId: string;
  departmentName: string;
  manager?: Recipient;
  /** Where the manager came from, so the UI can be honest about it. */
  managerSource?: "project_team" | "department_lead" | "project_lead_text";
  contributors: Recipient[];
  /** Everyone with a usable address, manager first. */
  emails: string[];
  /** Nobody at all — the department cannot receive the Weekly. */
  hasNoRecipients: boolean;
  /** Assignment gaps worth naming before collection starts. */
  gaps: RecipientGap[];
}

export type RecipientGap = "no_manager" | "no_contributors" | "no_emails";

export const GAP_LABEL: Record<RecipientGap, string> = {
  no_manager: "No department manager assigned",
  no_contributors: "No contributors assigned",
  no_emails: "No email addresses stored",
};

function toRecipient(
  contact: Contact | undefined,
  fallbackName: string | undefined,
  functionalTitle?: string
): Recipient | undefined {
  if (contact) {
    return {
      contactId: contact.id,
      name: contact.name,
      email: contact.email?.trim() || undefined,
      functionalTitle,
    };
  }
  // A free-text lead is a real person the project recorded, but with no contact
  // record there is no address and no link — say so rather than drop them.
  if (fallbackName?.trim()) {
    return { name: fallbackName.trim(), unlinked: true, functionalTitle };
  }
  return undefined;
}

/**
 * Recipients for one department of one project.
 *
 * `departments` is master data; `contacts` is the person directory. Both are
 * already loaded by the Weekly workspace, so this stays a pure function and
 * performs no I/O.
 */
export function resolveDepartmentRecipients(
  project: Project | null,
  departmentId: string,
  departments: Department[],
  contacts: Contact[]
): DepartmentRecipients {
  const department = departments.find((entry) => entry.id === departmentId);
  const departmentName = department?.name ?? "Department";
  const contactById = (id: string | undefined) =>
    id ? contacts.find((entry) => entry.id === id) : undefined;

  // Team members assigned to THIS department on THIS project.
  const team = (project?.team ?? []).filter(
    (member) => member.departmentId === departmentId
  );

  const managerAssignment = team.find(
    (member) => member.assignmentRole === "department_manager"
  );
  const projectDepartment = project?.departments.find(
    (entry) => entry.departmentId === departmentId
  );

  let manager: Recipient | undefined;
  let managerSource: DepartmentRecipients["managerSource"];

  if (managerAssignment) {
    manager = toRecipient(
      contactById(managerAssignment.contactId),
      undefined,
      managerAssignment.functionalTitle
    );
    if (manager) managerSource = "project_team";
  }
  if (!manager && department?.leadContactId) {
    manager = toRecipient(contactById(department.leadContactId), undefined);
    if (manager) managerSource = "department_lead";
  }
  if (!manager) {
    manager = toRecipient(undefined, projectDepartment?.leadName);
    if (manager) managerSource = "project_lead_text";
  }

  const contributors = team
    .filter((member) => member.contactId !== managerAssignment?.contactId)
    .map((member) =>
      toRecipient(contactById(member.contactId), undefined, member.functionalTitle)
    )
    .filter((entry): entry is Recipient => Boolean(entry))
    .sort((a, b) => a.name.localeCompare(b.name));

  const emails = [manager, ...contributors]
    .map((entry) => entry?.email)
    .filter((email): email is string => Boolean(email));

  const gaps: RecipientGap[] = [];
  if (!manager) gaps.push("no_manager");
  if (contributors.length === 0) gaps.push("no_contributors");
  if (emails.length === 0) gaps.push("no_emails");

  return {
    departmentId,
    departmentName,
    manager,
    managerSource,
    contributors,
    emails,
    hasNoRecipients: !manager && contributors.length === 0,
    gaps,
  };
}

/** Where Project Control goes to fix an assignment gap. */
export function manageContactsHref(projectId: string | undefined): string {
  return projectId ? `/projects/${projectId}/team` : "/projects";
}

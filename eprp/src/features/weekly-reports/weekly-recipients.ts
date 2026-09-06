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

/* --------------------------- Reaching a recipient -------------------------- */

/**
 * The canonical destination a department recipient is sent to.
 *
 * PROJECT-SCOPED, DELIBERATELY. This used to hand out
 * `/weekly-reports/{id}/workspace#dept-{d}` — the global register's route.
 * Following it dropped the recipient out of the project they were being asked
 * to report on: no project sidebar, no project breadcrumb, and a "back" that
 * led to the whole-portfolio Weekly list. The project the Weekly belongs to is
 * already known wherever this link is built, so the link carries it.
 *
 * The department is carried TWICE, on purpose:
 *
 *   ?dept=<id>   survives the sign-in round trip. The proxy preserves
 *                `pathname + search` in `?next=`, and a URL fragment is never
 *                sent to the server at all — so a recipient who is signed out
 *                when they click would otherwise land on the Weekly with no
 *                idea which department was asked of them.
 *   #dept-<id>   is the anchor the departments panel already renders, so an
 *                already-signed-in recipient jumps straight to their section
 *                with no scripting involved.
 */
export function weeklyDepartmentLink(
  origin: string,
  projectId: string | undefined,
  reportId: string,
  departmentId: string
): string {
  const path = projectId
    ? `/projects/${projectId}/reports/weekly/${reportId}/workspace`
    : `/weekly-reports/${reportId}/workspace`;
  return `${origin}${path}?dept=${encodeURIComponent(departmentId)}#dept-${departmentId}`;
}

/** What the recipient needs to know, beyond the link itself. */
export interface WeeklyInvitationContext {
  projectName: string;
  projectCode?: string;
  reportNumber: string;
  periodStart: string;
  periodEnd: string;
  departmentName: string;
  /** ISO timestamp; omitted when the Weekly carries no deadline. */
  dueAt?: string;
  link: string;
}

function shortDate(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

function shortDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : `${shortDate(value)} ${date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
}

/**
 * The request for department input, as plain text.
 *
 * Concise on purpose: the facts a department manager needs to act, and the
 * link. No branding, no HTML — it is pasted into, or opened in, the sender's
 * own mail client, which supplies both.
 */
export function weeklyInvitationMessage(context: WeeklyInvitationContext): {
  subject: string;
  body: string;
} {
  const project = context.projectCode
    ? `${context.projectName} (${context.projectCode})`
    : context.projectName;

  const subject = `Weekly Report ${context.reportNumber} — ${context.departmentName} input required`;

  const lines = [
    `Department input is requested for the Weekly Report below.`,
    ``,
    `Project:      ${project}`,
    `Report:       ${context.reportNumber}`,
    `Period:       ${shortDate(context.periodStart)} – ${shortDate(context.periodEnd)}`,
    `Department:   ${context.departmentName}`,
  ];
  if (context.dueAt) {
    lines.push(`Deadline:     ${shortDateTime(context.dueAt)}`);
  }
  lines.push(
    ``,
    `Open the Weekly Report:`,
    context.link,
    ``,
    `Sign in if prompted — you will be returned to this report.`,
    ``,
    `EPROM Progress Report`
  );

  return { subject, body: lines.join("\n") };
}

/**
 * A `mailto:` the sender's own mail client opens as a pre-filled draft.
 *
 * This is NOT delivery by the platform, and nothing that uses it may say that
 * it is: the message is handed to the sender, who sends it. It exists because
 * the alternative — a third-party mail provider — is a dependency and a
 * credential this platform does not have, and copying a link by hand loses
 * every fact the recipient needs.
 */
export function weeklyInvitationMailto(
  emails: string[],
  context: WeeklyInvitationContext
): string {
  const { subject, body } = weeklyInvitationMessage(context);
  const query = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `mailto:${emails.map(encodeURIComponent).join(",")}?${query}`;
}

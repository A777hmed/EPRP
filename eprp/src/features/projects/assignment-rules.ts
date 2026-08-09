import type {
  AssignmentRole,
  Project,
  ProjectDelegation,
  ProjectTeamMember,
} from "@/types";

/**
 * Project-specific team assignment rules.
 *
 * Pure functions over the existing `project.team` / `project.delegations`
 * arrays — no new storage, no parallel hierarchy. The wizard already links a
 * person to a project through a discipline (one `project_contacts` row per
 * contact + discipline), so a person working two disciplines in the same
 * department has two rows. An *assignment* is logically per
 * (project, contact, department), so every helper here reads and writes the
 * whole group of rows for that pair, keeping them consistent.
 *
 * Nothing here grants permissions. `functionalTitle` is free text and is
 * never consulted for authority — see `canCompleteDepartmentWeekly`.
 */

/** One person's assignment within a project department. */
export interface DepartmentAssignmentEntry {
  contactId: string;
  departmentId: string;
  assignmentRole: AssignmentRole;
  functionalTitle?: string;
  reportsToContactId?: string;
  /** Every team row backing this assignment (one per discipline). */
  rows: ProjectTeamMember[];
}

const DEFAULT_ROLE: AssignmentRole = "team_member";

function teamOf(project: Project): ProjectTeamMember[] {
  return project.team ?? [];
}

/**
 * Unique people assigned to a department, collapsed from their per-discipline
 * rows. The first row wins for the assignment fields; `setAssignment` keeps
 * them identical, so any row is representative.
 */
export function departmentAssignments(
  project: Project,
  departmentId: string
): DepartmentAssignmentEntry[] {
  const grouped = new Map<string, DepartmentAssignmentEntry>();
  for (const member of teamOf(project)) {
    if (member.departmentId !== departmentId) continue;
    const existing = grouped.get(member.contactId);
    if (existing) {
      existing.rows.push(member);
      continue;
    }
    grouped.set(member.contactId, {
      contactId: member.contactId,
      departmentId,
      assignmentRole: member.assignmentRole ?? DEFAULT_ROLE,
      functionalTitle: member.functionalTitle,
      reportsToContactId: member.reportsToContactId,
      rows: [member],
    });
  }
  return [...grouped.values()];
}

/** The single Department Manager for a department, if one is assigned. */
export function departmentManager(
  project: Project,
  departmentId: string
): DepartmentAssignmentEntry | undefined {
  return departmentAssignments(project, departmentId).find(
    (entry) => entry.assignmentRole === "department_manager"
  );
}

/**
 * Who a person may report to, within the **same project and department** and
 * never themselves:
 *
 * - a Department Manager reports to nobody, so the list is empty;
 * - a Team Member Lead reports to the Department Manager and to no one else;
 * - a Team Member reports to a Team Member Lead or the Department Manager.
 *
 * The list is the same set `validateDepartmentAssignments` accepts, so the
 * picker cannot offer a choice that would later be rejected on save.
 */
export function eligibleReportsTo(
  project: Project,
  departmentId: string,
  contactId: string
): DepartmentAssignmentEntry[] {
  const entries = departmentAssignments(project, departmentId);
  const role = entries.find((candidate) => candidate.contactId === contactId)
    ?.assignmentRole;

  if (role === "department_manager") return [];

  const others = entries.filter(
    (candidate) => candidate.contactId !== contactId
  );
  if (role === "team_member_lead") {
    return others.filter(
      (candidate) => candidate.assignmentRole === "department_manager"
    );
  }
  return others.filter(
    (candidate) =>
      candidate.assignmentRole === "department_manager" ||
      candidate.assignmentRole === "team_member_lead"
  );
}

/* ------------------------------ Validation -------------------------------- */

/** One thing wrong with a department's assignments. */
export interface AssignmentIssue {
  departmentId: string;
  /** Absent when the problem is with the department rather than a person. */
  contactId?: string;
  message: string;
}

/**
 * Check one department's reporting structure.
 *
 * Every non-manager needs a Reports To, which is why a staffed department
 * without a Department Manager is reported once at department level instead of
 * repeating "Reports To is required" for every person in it.
 *
 * An unstaffed department is not an error — it simply has nothing to check.
 */
export function validateDepartmentAssignments(
  project: Project,
  departmentId: string
): AssignmentIssue[] {
  const entries = departmentAssignments(project, departmentId);
  if (entries.length === 0) return [];

  const issues: AssignmentIssue[] = [];
  const managers = entries.filter(
    (entry) => entry.assignmentRole === "department_manager"
  );

  if (managers.length === 0) {
    issues.push({
      departmentId,
      message:
        "No Department Manager assigned. Every other role has to report to one.",
    });
  }
  if (managers.length > 1) {
    issues.push({
      departmentId,
      message:
        "More than one Department Manager assigned. A department has exactly one.",
    });
  }

  for (const entry of entries) {
    const at = (message: string): AssignmentIssue => ({
      departmentId,
      contactId: entry.contactId,
      message,
    });

    if (entry.assignmentRole === "department_manager") {
      if (entry.reportsToContactId) {
        issues.push(
          at("A Department Manager does not report to anyone in the department.")
        );
      }
      continue;
    }

    if (!entry.reportsToContactId) {
      // Already explained at department level when there is no manager to
      // point at; repeating it per person would only add noise.
      if (managers.length > 0) issues.push(at("Reports To is required."));
      continue;
    }
    if (entry.reportsToContactId === entry.contactId) {
      issues.push(at("Cannot report to themselves."));
      continue;
    }

    const target = entries.find(
      (candidate) => candidate.contactId === entry.reportsToContactId
    );
    if (!target) {
      issues.push(
        at("Reports To points at someone who is not in this department.")
      );
      continue;
    }

    if (entry.assignmentRole === "team_member_lead") {
      if (target.assignmentRole !== "department_manager") {
        issues.push(at("A Team Member Lead must report to the Department Manager."));
      }
      continue;
    }
    if (
      target.assignmentRole !== "department_manager" &&
      target.assignmentRole !== "team_member_lead"
    ) {
      issues.push(
        at(
          "A Team Member must report to a Team Member Lead or the Department Manager."
        )
      );
    }
  }

  return issues;
}

/** Every assignment problem across the project, in department order. */
export function validateAssignments(project: Project): AssignmentIssue[] {
  const departmentIds = [
    ...new Set(
      teamOf(project)
        .map((member) => member.departmentId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  return [
    ...departmentIds.flatMap((id) => validateDepartmentAssignments(project, id)),
    ...validateDelegations(project),
  ];
}

/**
 * Delegation date rules, validated by business meaning rather than by banning
 * the past outright — an existing delegation may legitimately have started or
 * ended earlier, and that history must stay editable.
 *
 * Only two things are genuinely invalid:
 *  - a period that ends before it begins, which is never meaningful;
 *  - an *active* delegation whose period has already elapsed, which claims
 *    authority it cannot hold. Revoking it (active = false) records that it
 *    once applied and is accepted.
 */
export function validateDelegations(
  project: Project,
  today: string = new Date().toISOString().slice(0, 10)
): AssignmentIssue[] {
  const issues: AssignmentIssue[] = [];

  for (const delegation of project.delegations ?? []) {
    const at = (message: string): AssignmentIssue => ({
      departmentId: delegation.departmentId,
      contactId: delegation.delegateContactId,
      message,
    });

    if (!delegation.startDate || !delegation.endDate) {
      issues.push(at("A delegation needs both a start date and an end date."));
      continue;
    }
    if (delegation.endDate < delegation.startDate) {
      issues.push(at("Delegation end date cannot be before its start date."));
      continue;
    }
    if (delegation.active && delegation.endDate < today) {
      issues.push(
        at(
          "This delegation is still marked active but its period has already ended. Extend the end date, or revoke it."
        )
      );
    }
  }

  return issues;
}

/** Apply a patch to every row backing one person's department assignment. */
function patchRows(
  team: ProjectTeamMember[],
  departmentId: string,
  contactId: string,
  patch: Partial<ProjectTeamMember>
): ProjectTeamMember[] {
  return team.map((member) =>
    member.departmentId === departmentId && member.contactId === contactId
      ? { ...member, ...patch }
      : member
  );
}

/**
 * Update one person's assignment.
 *
 * Enforces the single-manager rule: promoting someone to Department Manager
 * demotes the incumbent to Team Member rather than silently allowing two.
 * The demoted person stays on the team — the assignment changes, the person
 * is never removed, so Weekly history keeps its owner.
 *
 * Also keeps the reporting graph valid: a person who becomes a manager
 * reports to nobody, and anyone who reported to a now-demoted manager is
 * re-pointed at the new manager.
 */
export function setAssignment(
  project: Project,
  departmentId: string,
  contactId: string,
  patch: {
    assignmentRole?: AssignmentRole;
    functionalTitle?: string;
    reportsToContactId?: string;
  }
): ProjectTeamMember[] {
  let team = teamOf(project);
  const nextRole = patch.assignmentRole;

  if (nextRole === "department_manager") {
    const incumbent = departmentManager(project, departmentId);
    if (incumbent && incumbent.contactId !== contactId) {
      // Demote, never remove.
      team = patchRows(team, departmentId, incumbent.contactId, {
        assignmentRole: "team_member",
        reportsToContactId: contactId,
      });
      // Anyone reporting to the old manager now reports to the new one.
      team = team.map((member) =>
        member.departmentId === departmentId &&
        member.reportsToContactId === incumbent.contactId &&
        member.contactId !== contactId
          ? { ...member, reportsToContactId: contactId }
          : member
      );
    }
  }

  const applied: Partial<ProjectTeamMember> = { ...patch };
  // A manager has no one to report to inside their own department.
  if (nextRole === "department_manager") applied.reportsToContactId = undefined;

  team = patchRows(team, departmentId, contactId, applied);

  // Demoting a lead must not orphan the people who reported to them.
  if (nextRole === "team_member") {
    team = reassignReports(team, project, departmentId, contactId);
  }

  /*
   * A role change can invalidate the person's own reporting line — promoting a
   * member who reported to a lead makes that lead an illegal target, since a
   * lead reports only to the Department Manager. Correct it here rather than
   * letting it be typed in and then rejected on save. An explicit
   * `reportsToContactId` in the same patch is the caller's decision and is
   * left alone; validation still has the final word.
   */
  if (nextRole && nextRole !== "department_manager" && !("reportsToContactId" in patch)) {
    team = alignReportsTo(team, project, departmentId, contactId, nextRole);
  }
  return team;
}

/**
 * Point someone at a valid superior when their current one no longer fits
 * their role, falling back to the Department Manager.
 */
function alignReportsTo(
  team: ProjectTeamMember[],
  project: Project,
  departmentId: string,
  contactId: string,
  role: AssignmentRole
): ProjectTeamMember[] {
  const entries = departmentAssignments({ ...project, team }, departmentId);
  const entry = entries.find((candidate) => candidate.contactId === contactId);
  const manager = entries.find(
    (candidate) => candidate.assignmentRole === "department_manager"
  );

  const target = entries.find(
    (candidate) => candidate.contactId === entry?.reportsToContactId
  );
  const valid =
    target !== undefined &&
    target.contactId !== contactId &&
    (role === "team_member_lead"
      ? target.assignmentRole === "department_manager"
      : target.assignmentRole === "department_manager" ||
        target.assignmentRole === "team_member_lead");

  if (valid) return team;
  return patchRows(team, departmentId, contactId, {
    reportsToContactId: manager?.contactId,
  });
}

/**
 * Re-point everyone who reported to `contactId` at another eligible lead, or
 * the Department Manager, so no one is left orphaned.
 */
function reassignReports(
  team: ProjectTeamMember[],
  project: Project,
  departmentId: string,
  contactId: string
): ProjectTeamMember[] {
  const stillEligible = departmentAssignments(
    { ...project, team },
    departmentId
  ).filter(
    (entry) =>
      entry.contactId !== contactId &&
      (entry.assignmentRole === "department_manager" ||
        entry.assignmentRole === "team_member_lead")
  );
  const fallback =
    stillEligible.find((e) => e.assignmentRole === "department_manager") ??
    stillEligible[0];

  return team.map((member) =>
    member.departmentId === departmentId &&
    member.reportsToContactId === contactId
      ? { ...member, reportsToContactId: fallback?.contactId }
      : member
  );
}

/**
 * Remove one person's assignment from a department.
 *
 * Only the project link is dropped — the global contact record is untouched.
 * Anyone reporting to them is reassigned first so no member is orphaned.
 */
export function removeAssignment(
  project: Project,
  departmentId: string,
  contactId: string
): ProjectTeamMember[] {
  const reassigned = reassignReports(
    teamOf(project),
    project,
    departmentId,
    contactId
  );
  return reassigned.filter(
    (member) =>
      !(member.departmentId === departmentId && member.contactId === contactId)
  );
}

/* ------------------------------ Delegation -------------------------------- */

export type DelegationStatus = "active" | "scheduled" | "expired" | "revoked";

/** Status is derived, so an expired delegation can never retain authority. */
export function delegationStatus(
  delegation: ProjectDelegation,
  today: string
): DelegationStatus {
  if (!delegation.active) return "revoked";
  if (delegation.endDate < today) return "expired";
  if (delegation.startDate > today) return "scheduled";
  return "active";
}

/** Delegations currently in force for a department. */
export function activeDelegations(
  project: Project,
  departmentId: string,
  today: string
): ProjectDelegation[] {
  return (project.delegations ?? []).filter(
    (delegation) =>
      delegation.departmentId === departmentId &&
      delegationStatus(delegation, today) === "active"
  );
}

/**
 * Whether a person may complete the department's Weekly input.
 *
 * The Department Manager always may. A Team Member Lead may **only** through
 * an active delegation carrying `complete_department` — never by virtue of
 * their role, and never because their functional title contains "Lead".
 */
export function canCompleteDepartmentWeekly(
  project: Project,
  departmentId: string,
  contactId: string,
  today: string
): boolean {
  if (departmentManager(project, departmentId)?.contactId === contactId) {
    return true;
  }
  return activeDelegations(project, departmentId, today).some(
    (delegation) =>
      delegation.delegateContactId === contactId &&
      delegation.responsibilities.includes("complete_department")
  );
}

/**
 * People a Team Member Lead is responsible for: those reporting to them in
 * that department. A lead monitors only their own group.
 */
export function membersReportingTo(
  project: Project,
  departmentId: string,
  contactId: string
): DepartmentAssignmentEntry[] {
  return departmentAssignments(project, departmentId).filter(
    (entry) => entry.reportsToContactId === contactId
  );
}

/** Who may receive a delegation: leads and members, never the manager. */
export function eligibleDelegates(
  project: Project,
  departmentId: string
): DepartmentAssignmentEntry[] {
  return departmentAssignments(project, departmentId).filter(
    (entry) => entry.assignmentRole !== "department_manager"
  );
}

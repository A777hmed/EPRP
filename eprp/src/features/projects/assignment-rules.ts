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
 * Authority order, used to pick the role that represents a person whose
 * scope items carry different Assignment Roles. Higher wins.
 */
const ROLE_RANK: Record<AssignmentRole, number> = {
  department_manager: 3,
  team_member_lead: 2,
  team_member: 1,
};

const roleOf = (member: ProjectTeamMember): AssignmentRole =>
  member.assignmentRole ?? DEFAULT_ROLE;

/**
 * One entry per scoped assignment — the row as the business means it:
 * a person, on one scope item, with their own Assignment Role.
 *
 * A person may hold several of these in the same department. They are
 * genuinely separate assignments, not duplicates of each other.
 */
export interface ScopedAssignment {
  contactId: string;
  departmentId: string;
  systemId?: string;
  /** The scope item: Program & Study on PSM/PSAIM, Discipline elsewhere. */
  disciplineId?: string;
  assignmentRole: AssignmentRole;
  functionalTitle?: string;
  reportsToContactId?: string;
}

/** Every scoped assignment in a department, one per scope item per person. */
export function scopedAssignments(
  project: Project,
  departmentId: string,
  contactId?: string
): ScopedAssignment[] {
  return teamOf(project)
    .filter(
      (member) =>
        member.departmentId === departmentId &&
        (contactId === undefined || member.contactId === contactId)
    )
    .map((member) => ({
      contactId: member.contactId,
      departmentId,
      systemId: member.systemId,
      disciplineId: member.disciplineId,
      assignmentRole: roleOf(member),
      functionalTitle: member.functionalTitle,
      reportsToContactId: member.reportsToContactId,
    }));
}

/**
 * Unique PEOPLE assigned to a department, collapsed from their scoped rows.
 *
 * Collapsing by person is what makes "one Department Manager per department"
 * mean one *person*: someone who manages five scope items is one manager, not
 * five. Where their rows disagree on Assignment Role — which is now allowed,
 * since each scope item carries its own — the highest-authority role
 * represents them, so the reporting-line rules judge them by the most senior
 * hat they wear. `rows` keeps every underlying assignment for callers that
 * need the per-scope-item detail.
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
      if (ROLE_RANK[roleOf(member)] > ROLE_RANK[existing.assignmentRole]) {
        existing.assignmentRole = roleOf(member);
        // The reporting line belongs to the role that represents them.
        existing.reportsToContactId = member.reportsToContactId;
        existing.functionalTitle = member.functionalTitle;
      }
      continue;
    }
    grouped.set(member.contactId, {
      contactId: member.contactId,
      departmentId,
      assignmentRole: roleOf(member),
      functionalTitle: member.functionalTitle,
      reportsToContactId: member.reportsToContactId,
      rows: [member],
    });
  }
  return [...grouped.values()];
}

/**
 * Same person, same department, same scope item, same Assignment Role — the
 * only combination ever refused.
 *
 * `systemId` is deliberately NOT part of the comparison. It is derived from
 * the scope item's own project link, not chosen independently, so treating it
 * as part of the identity would let the same person hold the same scope item
 * twice in the same role merely because one row had the System filled in and
 * the other did not. The database constraint still carries it as a backstop.
 */
export function isDuplicateScopedAssignment(
  project: Project,
  candidate: {
    departmentId: string;
    contactId: string;
    disciplineId?: string;
    assignmentRole: AssignmentRole;
  }
): boolean {
  return teamOf(project).some(
    (member) =>
      member.departmentId === candidate.departmentId &&
      member.contactId === candidate.contactId &&
      (member.disciplineId ?? undefined) ===
        (candidate.disciplineId ?? undefined) &&
      roleOf(member) === candidate.assignmentRole
  );
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

/* --------------------------- Scoped assignments ---------------------------- */

const sameScope = (
  member: ProjectTeamMember,
  departmentId: string,
  contactId: string,
  disciplineId: string | undefined
) =>
  member.departmentId === departmentId &&
  member.contactId === contactId &&
  (member.disciplineId ?? undefined) === (disciplineId ?? undefined);

/**
 * Edit ONE scoped assignment — its Assignment Role, functional title,
 * reporting line, or the scope item itself.
 *
 * Unlike `setAssignment`, which applies a person-level change across every row
 * they hold in the department, this touches a single assignment and leaves
 * their others exactly as they are. That is what lets the same person carry
 * different Assignment Roles on different scope items.
 */
export function setScopedAssignment(
  project: Project,
  departmentId: string,
  contactId: string,
  disciplineId: string | undefined,
  patch: {
    assignmentRole?: AssignmentRole;
    functionalTitle?: string;
    reportsToContactId?: string;
    disciplineId?: string;
    systemId?: string;
  }
): ProjectTeamMember[] {
  const team = teamOf(project);

  // Moving an assignment onto a scope item the person already holds in the
  // same role would be an exact duplicate; nothing else about it is invalid.
  if ("disciplineId" in patch) {
    const target = patch.disciplineId ?? undefined;
    const current = team.find((m) => sameScope(m, departmentId, contactId, disciplineId));
    const nextRole = patch.assignmentRole ?? (current ? roleOf(current) : DEFAULT_ROLE);
    const collides = team.some(
      (member) =>
        !sameScope(member, departmentId, contactId, disciplineId) &&
        sameScope(member, departmentId, contactId, target) &&
        roleOf(member) === nextRole
    );
    if (collides) return team;
  }

  return team.map((member) =>
    sameScope(member, departmentId, contactId, disciplineId)
      ? {
          ...member,
          ...patch,
          assignmentRole: patch.assignmentRole ?? member.assignmentRole,
          // A manager has no one to report to inside their own department.
          reportsToContactId:
            (patch.assignmentRole ?? roleOf(member)) === "department_manager"
              ? undefined
              : patch.reportsToContactId ?? member.reportsToContactId,
        }
      : member
  );
}

/**
 * Remove ONE scoped assignment.
 *
 * The contact master record, the person's other assignments, and every
 * unrelated project row are left untouched. Reporting lines are only repaired
 * when this was the person's LAST assignment in the department — while they
 * still hold another, they remain a valid target and nothing is orphaned.
 */
export function removeScopedAssignment(
  project: Project,
  departmentId: string,
  contactId: string,
  disciplineId: string | undefined
): ProjectTeamMember[] {
  const team = teamOf(project);
  const remaining = team.filter(
    (member) => !sameScope(member, departmentId, contactId, disciplineId)
  );

  const stillPresent = remaining.some(
    (member) =>
      member.departmentId === departmentId && member.contactId === contactId
  );
  if (stillPresent) return remaining;

  return reassignReports(remaining, project, departmentId, contactId);
}

/**
 * Add a person to several scope items at once, all with the same Assignment
 * Role — the bulk path for "this person covers these five items".
 *
 * Scope items they already hold in that role are skipped rather than
 * duplicated, so the operation is safe to repeat.
 */
export function addScopedAssignments(
  project: Project,
  departmentId: string,
  contactId: string,
  disciplineIds: string[],
  options: {
    assignmentRole?: AssignmentRole;
    functionalTitle?: string;
    reportsToContactId?: string;
    systemIdFor?: (disciplineId: string) => string | undefined;
  } = {}
): ProjectTeamMember[] {
  const assignmentRole = options.assignmentRole ?? DEFAULT_ROLE;
  const team = teamOf(project);
  const additions: ProjectTeamMember[] = [];

  for (const disciplineId of disciplineIds) {
    const candidate = {
      departmentId,
      contactId,
      disciplineId,
      systemId: options.systemIdFor?.(disciplineId),
      assignmentRole,
    };
    if (isDuplicateScopedAssignment({ ...project, team: [...team, ...additions] }, candidate)) {
      continue;
    }
    additions.push({
      contactId,
      departmentId,
      disciplineId,
      systemId: candidate.systemId,
      assignmentRole,
      functionalTitle: options.functionalTitle,
      reportsToContactId:
        assignmentRole === "department_manager"
          ? undefined
          : options.reportsToContactId,
    });
  }

  return [...team, ...additions];
}

/**
 * The scope items a person covers in a department, with the Assignment Role
 * they hold on each.
 *
 * This is the lookup Weekly will resolve against — user → project →
 * department → scope item(s) → Assignment Role — so a user can be shown only
 * the Weekly scope their assignments cover. Nothing in Weekly is changed yet;
 * this just makes the question answerable from the model as it now stands.
 */
export function assignedScopeItems(
  project: Project,
  departmentId: string,
  contactId: string
): { disciplineId: string; assignmentRole: AssignmentRole }[] {
  return scopedAssignments(project, departmentId, contactId)
    .filter((assignment) => Boolean(assignment.disciplineId))
    .map((assignment) => ({
      disciplineId: assignment.disciplineId!,
      assignmentRole: assignment.assignmentRole,
    }));
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

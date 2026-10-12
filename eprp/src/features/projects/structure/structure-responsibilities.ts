import type { Contact, Project, ProjectMember, ProjectReportingConfig } from "@/types";
import type {
  ProjectStructure,
  ProjectStructureNode,
  StructureAssignments,
  StructureReportKind,
  StructureResponsibilityKind,
  StructureUnitPeopleInput,
} from "@/types/project-structure";
import {
  PROJECT_STRUCTURE_MESSAGES,
  type ProjectStructureErrorReason,
} from "@/services/project-structure-errors";
import { activeMembers, memberNeedsParty, memberNeedsProjectRole, partyLabel } from "../project-team";
import { buildStructureTree, isActiveNode, type StructureTreeNode } from "./structure-rules";

/**
 * Other Project Structure Responsibilities (Phase 2C.3D Wave 1) — pure rules
 * shared by the UI, the in-memory service and the tests.
 *
 * Four concepts stay separate: project membership and Reports To
 * (project_members), unit membership and leadership, and Weekly / Monthly
 * reporting responsibility. Every person is an ACTIVE project member; nobody
 * is chosen from the global People master directly.
 *
 * AUTHORITY-FREE: Unit Member, Unit Lead, Responsible and Backup grant no
 * platform or project authority and no report-writing right. The database
 * enforces the same rules (save_structure_unit_responsibilities and its
 * guards); these mirrors only keep the screen honest before a save.
 */

export const STRUCTURE_REPORT_KINDS: readonly StructureReportKind[] = ["weekly", "monthly"];

export const REPORT_KIND_LABEL: Record<StructureReportKind, string> = { weekly: "Weekly", monthly: "Monthly" };
export const RESPONSIBILITY_LABEL: Record<StructureResponsibilityKind, string> = { responsible: "Responsible", backup: "Backup" };

/* ------------------------------- directory ------------------------------- */

/** An active project member as the structure screens show them. */
export interface StructureTeamMember {
  /** `project_members.id`. */
  id: string;
  contactId: string;
  name: string;
  /** Absent when the membership needs a Party. */
  partyLabel?: string;
  /** Absent when the membership needs a Project Role. */
  projectRole?: string;
  needsParty: boolean;
  needsProjectRole: boolean;
  /** Party and Project Role present: may be Unit Lead, Responsible or Backup. */
  accountable: boolean;
}

/** The project's active members, display-ready. The only person pool here. */
export interface StructureTeamDirectory {
  members: StructureTeamMember[];
}

export function buildTeamDirectory(
  project: Pick<Project, "members" | "parties">,
  contacts: readonly Pick<Contact, "id" | "name">[],
  clientName?: string
): StructureTeamDirectory {
  const members = activeMembers(project.members).map((member): StructureTeamMember => {
    const needsParty = memberNeedsParty(member);
    const needsProjectRole = memberNeedsProjectRole(member);
    const party = project.parties?.find((entry) => entry.id === member.partyId);
    return {
      id: member.id,
      contactId: member.contactId,
      name: contacts.find((contact) => contact.id === member.contactId)?.name ?? "Unknown person",
      partyLabel: needsParty ? undefined : partyLabel(party, clientName),
      projectRole: needsProjectRole ? undefined : member.projectRole?.trim(),
      needsParty,
      needsProjectRole,
      accountable: !needsParty && !needsProjectRole,
    };
  });
  return { members: members.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) };
}

/**
 * The directory as membership facts for {@link unitPeopleIssues}: only active
 * members are in it, and a member's Party / Project Role is present exactly
 * when they are accountable-ready.
 */
export function membershipFactsOf(directory: StructureTeamDirectory): MembershipFacts[] {
  return directory.members.map((member) => ({
    id: member.id,
    endedAt: undefined,
    partyId: member.needsParty ? undefined : "party",
    projectRole: member.projectRole,
  }));
}

export const memberName = (directory: StructureTeamDirectory | undefined, memberId: string | undefined) =>
  memberId ? directory?.members.find((member) => member.id === memberId)?.name ?? "Unknown person" : undefined;

/* ------------------------------- read model ------------------------------ */

export interface ReportPeople {
  responsibleId?: string;
  backupId?: string;
}

/** One unit's ACTIVE people (ended rows are history and never shown here). */
export interface UnitPeople {
  nodeId: string;
  memberIds: string[];
  leadId?: string;
  weekly: ReportPeople;
  monthly: ReportPeople;
}

export function unitPeople(assignments: StructureAssignments | undefined, nodeId: string): UnitPeople {
  const rows = (assignments?.unitMembers ?? []).filter((row) => row.nodeId === nodeId && !row.endedAt);
  const reports = (assignments?.reportResponsibilities ?? []).filter((row) => row.nodeId === nodeId && !row.endedAt);
  const slot = (kind: StructureReportKind, responsibility: StructureResponsibilityKind) =>
    reports.find((row) => row.reportKind === kind && row.responsibility === responsibility)?.memberId;
  return {
    nodeId,
    memberIds: rows.filter((row) => row.unitRole === "member").map((row) => row.memberId),
    leadId: rows.find((row) => row.unitRole === "lead")?.memberId,
    weekly: { responsibleId: slot("weekly", "responsible"), backupId: slot("weekly", "backup") },
    monthly: { responsibleId: slot("monthly", "responsible"), backupId: slot("monthly", "backup") },
  };
}

/** The per-unit save's input for a unit's people. */
export function peopleInput(people: UnitPeople): StructureUnitPeopleInput {
  return {
    nodeId: people.nodeId,
    memberIds: [...people.memberIds],
    leadMemberId: people.leadId,
    weeklyResponsibleId: people.weekly.responsibleId,
    weeklyBackupId: people.weekly.backupId,
    monthlyResponsibleId: people.monthly.responsibleId,
    monthlyBackupId: people.monthly.backupId,
  };
}

/** Whether two desired states are the same (member order does not matter). */
export function samePeople(a: StructureUnitPeopleInput, b: StructureUnitPeopleInput): boolean {
  const members = (input: StructureUnitPeopleInput) => [...new Set(input.memberIds)].sort().join(",");
  return a.nodeId === b.nodeId && members(a) === members(b)
    && a.leadMemberId === b.leadMemberId
    && a.weeklyResponsibleId === b.weeklyResponsibleId && a.weeklyBackupId === b.weeklyBackupId
    && a.monthlyResponsibleId === b.monthlyResponsibleId && a.monthlyBackupId === b.monthlyBackupId;
}

/** Adds a person to the unit's members. */
export function withMember(input: StructureUnitPeopleInput, memberId: string): StructureUnitPeopleInput {
  return input.memberIds.includes(memberId) ? input : { ...input, memberIds: [...input.memberIds, memberId] };
}

/**
 * Removes a person from the unit and, visibly in the same draft, from any
 * Lead / Responsible / Backup slot they held. Nobody else's slot changes: if
 * the removed person was the Responsible, a remaining Backup is reported as
 * an issue ("Assign the Responsible before the Backup"), never cleared.
 */
export function withoutMember(input: StructureUnitPeopleInput, memberId: string): StructureUnitPeopleInput {
  const keep = (id: string | undefined) => (id === memberId ? undefined : id);
  return {
    ...input,
    memberIds: input.memberIds.filter((id) => id !== memberId),
    leadMemberId: keep(input.leadMemberId),
    weeklyResponsibleId: keep(input.weeklyResponsibleId),
    weeklyBackupId: keep(input.weeklyBackupId),
    monthlyResponsibleId: keep(input.monthlyResponsibleId),
    monthlyBackupId: keep(input.monthlyBackupId),
  };
}

export type ReportSlot = "weeklyResponsibleId" | "weeklyBackupId" | "monthlyResponsibleId" | "monthlyBackupId";

export const reportSlot = (kind: StructureReportKind, responsibility: StructureResponsibilityKind): ReportSlot =>
  `${kind}${responsibility === "responsible" ? "Responsible" : "Backup"}Id` as ReportSlot;

/* ------------------------------- candidates ------------------------------ */

/** Unit members whose membership is complete — eligible for the Lead. */
export function leadCandidates(input: StructureUnitPeopleInput, directory: StructureTeamDirectory): StructureTeamMember[] {
  return directory.members.filter((member) => member.accountable && input.memberIds.includes(member.id));
}

/**
 * Eligible for one report slot: an accountable member of THIS unit, never the
 * person in the other slot of the same report.
 */
export function reportCandidates(
  input: StructureUnitPeopleInput,
  directory: StructureTeamDirectory,
  kind: StructureReportKind,
  responsibility: StructureResponsibilityKind
): StructureTeamMember[] {
  const other = input[reportSlot(kind, responsibility === "responsible" ? "backup" : "responsible")];
  return leadCandidates(input, directory).filter((member) => member.id !== other);
}

/* ------------------------------- validation ------------------------------ */

export type UnitPeopleField = "members" | "lead" | ReportSlot;

export interface UnitPeopleIssue {
  reason: ProjectStructureErrorReason;
  field?: UnitPeopleField;
  message: string;
}

/** The membership facts the rules need (a ProjectMember satisfies this). */
export type MembershipFacts = Pick<ProjectMember, "id" | "endedAt" | "partyId" | "projectRole">;

const issue = (reason: ProjectStructureErrorReason, field?: UnitPeopleField): UnitPeopleIssue =>
  ({ reason, field, message: PROJECT_STRUCTURE_MESSAGES[reason] });

/**
 * Everything the per-unit save would refuse, in the database's own order.
 * `members` are this project's memberships (active and ended).
 */
export function unitPeopleIssues(
  input: StructureUnitPeopleInput,
  node: Pick<ProjectStructureNode, "id" | "archivedAt" | "weeklyReportingRequired" | "monthlyReportingRequired"> | undefined,
  members: readonly MembershipFacts[]
): UnitPeopleIssue[] {
  const issues: UnitPeopleIssue[] = [];
  if (new Set(input.memberIds).size !== input.memberIds.length) issues.push(issue("invalid_people", "members"));
  const inUnit = (id: string | undefined) => !id || input.memberIds.includes(id);
  if (!inUnit(input.leadMemberId)) issues.push(issue("lead_not_unit_member", "lead"));
  for (const slot of ["weeklyResponsibleId", "weeklyBackupId", "monthlyResponsibleId", "monthlyBackupId"] as const) {
    if (!inUnit(input[slot])) issues.push(issue("responsible_not_unit_member", slot));
  }
  for (const kind of STRUCTURE_REPORT_KINDS) {
    const responsible = input[reportSlot(kind, "responsible")];
    const backup = input[reportSlot(kind, "backup")];
    if (backup && !responsible) issues.push(issue("backup_without_responsible", reportSlot(kind, "backup")));
    if (backup && backup === responsible) issues.push(issue("same_person", reportSlot(kind, "backup")));
  }
  if (!node) return [...issues, issue("not_found")];
  if (node.archivedAt) issues.push(issue("unit_archived"));
  if (!node.weeklyReportingRequired && (input.weeklyResponsibleId || input.weeklyBackupId)) {
    issues.push(issue("unit_not_reporting", "weeklyResponsibleId"));
  }
  if (!node.monthlyReportingRequired && (input.monthlyResponsibleId || input.monthlyBackupId)) {
    issues.push(issue("unit_not_reporting", "monthlyResponsibleId"));
  }
  const membership = (id: string) => members.find((member) => member.id === id);
  if (input.memberIds.some((id) => !membership(id) || membership(id)?.endedAt)) issues.push(issue("member_not_active", "members"));
  const accountable = [
    ["lead", input.leadMemberId],
    ["weeklyResponsibleId", input.weeklyResponsibleId],
    ["weeklyBackupId", input.weeklyBackupId],
    ["monthlyResponsibleId", input.monthlyResponsibleId],
    ["monthlyBackupId", input.monthlyBackupId],
  ] as const;
  for (const [field, id] of accountable) {
    const member = id ? membership(id) : undefined;
    if (member && (!member.partyId || !member.projectRole?.trim())) {
      issues.push(issue("membership_incomplete", field));
      break;
    }
  }
  return issues;
}

/* --------------------------- completion and warnings ---------------------- */

/**
 * Whether a missing Responsible for this report blocks Project Setup: the
 * project uses the report AND the unit is flagged to provide its input.
 */
export function requiresResponsible(
  reporting: Pick<ProjectReportingConfig, "weeklyEnabled" | "monthlyEnabled">,
  node: Pick<ProjectStructureNode, "archivedAt" | "weeklyReportingRequired" | "monthlyReportingRequired">,
  kind: StructureReportKind
): boolean {
  if (!isActiveNode(node as ProjectStructureNode)) return false;
  return kind === "weekly"
    ? reporting.weeklyEnabled && node.weeklyReportingRequired
    : reporting.monthlyEnabled && node.monthlyReportingRequired;
}

export interface ResponsibilityGaps {
  /** BLOCKERS: units that must have a Weekly Responsible and do not. */
  weekly: ProjectStructureNode[];
  /** BLOCKERS: units that must have a Monthly Responsible and do not. */
  monthly: ProjectStructureNode[];
  /** WARNING only: active units with no Unit Lead. */
  withoutLead: ProjectStructureNode[];
}

/** Tree order, active units only. */
export function activeUnitsInOrder(structure: Pick<ProjectStructure, "levels" | "nodes">): ProjectStructureNode[] {
  const out: ProjectStructureNode[] = [];
  const walk = (entries: StructureTreeNode[]) => {
    for (const entry of entries) {
      out.push(entry.node);
      walk(entry.children);
    }
  };
  walk(buildStructureTree(structure as ProjectStructure));
  return out.filter(isActiveNode);
}

export function responsibilityGaps(
  reporting: Pick<ProjectReportingConfig, "weeklyEnabled" | "monthlyEnabled">,
  structure: Pick<ProjectStructure, "levels" | "nodes" | "assignments">
): ResponsibilityGaps {
  const units = activeUnitsInOrder(structure);
  const people = new Map(units.map((node) => [node.id, unitPeople(structure.assignments, node.id)]));
  const missing = (kind: StructureReportKind) =>
    units.filter((node) => requiresResponsible(reporting, node, kind) && !people.get(node.id)?.[kind].responsibleId);
  return {
    weekly: missing("weekly"),
    monthly: missing("monthly"),
    withoutLead: units.filter((node) => !people.get(node.id)?.leadId),
  };
}

/* ------------------------------ summaries -------------------------------- */

export interface ReportPeopleSummary {
  responsibleName?: string;
  backupName?: string;
  /** A missing Responsible blocks Project Setup (report enabled + unit flagged). */
  required: boolean;
}

/** Concise people facts for one unit; reports appear only where the unit owes them. */
export interface UnitPeopleSummary {
  leadName?: string;
  memberCount: number;
  weekly?: ReportPeopleSummary;
  monthly?: ReportPeopleSummary;
}

export function unitPeopleSummary(
  node: ProjectStructureNode,
  structure: Pick<ProjectStructure, "assignments">,
  directory: StructureTeamDirectory | undefined,
  reporting: Pick<ProjectReportingConfig, "weeklyEnabled" | "monthlyEnabled">
): UnitPeopleSummary | undefined {
  if (!structure.assignments) return undefined;
  const people = unitPeople(structure.assignments, node.id);
  const report = (kind: StructureReportKind): ReportPeopleSummary | undefined =>
    (kind === "weekly" ? node.weeklyReportingRequired : node.monthlyReportingRequired)
      ? {
          responsibleName: memberName(directory, people[kind].responsibleId),
          backupName: memberName(directory, people[kind].backupId),
          required: requiresResponsible(reporting, node, kind),
        }
      : undefined;
  return {
    leadName: memberName(directory, people.leadId),
    memberCount: people.memberIds.length,
    weekly: report("weekly"),
    monthly: report("monthly"),
  };
}

/**
 * Why a project membership cannot end yet (mirrors the database guard
 * guard_project_member_unit_assignments): a Unit Lead, Weekly / Monthly
 * Responsible or Backup role first, then any plain unit membership. Ended
 * rows are history and never block. Nothing is ever ended on the user's behalf.
 */
export function membershipEndBlocker(
  assignments: StructureAssignments | undefined,
  memberId: string
): "unit_responsibility" | "unit_assignments" | undefined {
  if (!assignments) return undefined;
  const active = <T extends { memberId: string; endedAt?: string }>(rows: readonly T[]) =>
    rows.filter((row) => row.memberId === memberId && !row.endedAt);
  if (active(assignments.reportResponsibilities).length > 0
      || active(assignments.unitMembers).some((row) => row.unitRole === "lead")) {
    return "unit_responsibility";
  }
  if (active(assignments.unitMembers).length > 0) return "unit_assignments";
  return undefined;
}

/** One unit a member works in, with what they hold there. */
export interface MemberUnitAssignment {
  nodeId: string;
  unitName: string;
  lead: boolean;
  responsibilities: { reportKind: StructureReportKind; responsibility: StructureResponsibilityKind }[];
}

/** The reverse view: a member's active units, in structure order. */
export function memberUnitAssignments(
  structure: Pick<ProjectStructure, "levels" | "nodes" | "assignments">,
  memberId: string
): MemberUnitAssignment[] {
  if (!structure.assignments) return [];
  return activeUnitsInOrder(structure).flatMap((node) => {
    const people = unitPeople(structure.assignments, node.id);
    if (!people.memberIds.includes(memberId)) return [];
    const responsibilities = STRUCTURE_REPORT_KINDS.flatMap((reportKind) =>
      (["responsible", "backup"] as const)
        .filter((responsibility) => people[reportKind][responsibility === "responsible" ? "responsibleId" : "backupId"] === memberId)
        .map((responsibility) => ({ reportKind, responsibility })));
    return [{ nodeId: node.id, unitName: node.name, lead: people.leadId === memberId, responsibilities }];
  });
}

/** "Civil (Lead, Weekly Responsible) · Earthworks (Monthly Backup)". */
export function describeMemberUnits(assignments: readonly MemberUnitAssignment[]): string {
  return assignments.map((entry) => {
    const roles = [
      ...(entry.lead ? ["Lead"] : []),
      ...entry.responsibilities.map((role) => `${REPORT_KIND_LABEL[role.reportKind]} ${RESPONSIBILITY_LABEL[role.responsibility]}`),
    ];
    return roles.length > 0 ? `${entry.unitName} (${roles.join(", ")})` : entry.unitName;
  }).join(" · ");
}

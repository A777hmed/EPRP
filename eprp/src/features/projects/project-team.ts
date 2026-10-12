import type { Project, ProjectMember, ProjectParty } from "@/types";
import {
  FIXED_RESPONSIBILITIES,
  type FixedResponsibilityField,
} from "./responsibilities";
import { subcontractorDisplayName } from "./project-parties";

/**
 * Project Team Membership (Phase 2C.3C) — pure rules shared by the UI, the
 * mock service and the tests. Identical for PSM, Other and legacy projects.
 *
 * Membership is AUTHORITY-FREE: nothing here is consulted for permission.
 * The database enforces the same rules (same-project Party and Reports To,
 * no self-reporting, no cycles, one active membership per person); these
 * mirrors only keep the screen honest before a save.
 */

/** Mirrors project_members_project_role_shape. */
export const PROJECT_ROLE_MAX = 80;

export const isActiveMember = (member: ProjectMember): boolean => !member.endedAt;

export function activeMembers(members: readonly ProjectMember[] | undefined): ProjectMember[] {
  return (members ?? []).filter(isActiveMember);
}

export function memberNeedsParty(member: ProjectMember): boolean {
  return !member.partyId;
}

export function memberNeedsProjectRole(member: ProjectMember): boolean {
  return !member.projectRole?.trim();
}

export interface MemberDraft {
  contactId?: string;
  partyId?: string;
  projectRole?: string;
  reportsToMemberId?: string;
}

export interface MemberDraftIssues {
  contactId?: string;
  partyId?: string;
  projectRole?: string;
}

/** What a new or edited membership must satisfy before it is saved. */
export function memberDraftIssues(
  draft: MemberDraft,
  options: { requirePerson?: boolean } = {}
): MemberDraftIssues {
  const issues: MemberDraftIssues = {};
  if (options.requirePerson && !draft.contactId) issues.contactId = "Choose a person";
  if (!draft.partyId) issues.partyId = "Choose the party this person represents";
  const role = draft.projectRole?.trim() ?? "";
  if (!role) issues.projectRole = "Enter this person's project role";
  else if (role.length > PROJECT_ROLE_MAX) {
    issues.projectRole = `Use at most ${PROJECT_ROLE_MAX} characters`;
  }
  return issues;
}

/* ------------------------------- Reports To -------------------------------- */

/**
 * True when `memberId` reporting to `candidateId` would close a loop: walking
 * up from the candidate reaches the member. Self is a loop of length zero.
 * Bounded by the member count, so malformed data can never spin forever.
 */
export function wouldCreateCycle(
  members: readonly ProjectMember[],
  memberId: string | undefined,
  candidateId: string
): boolean {
  if (!memberId) return false;
  const managerOf = new Map(members.map((member) => [member.id, member.reportsToMemberId]));
  let current: string | undefined = candidateId;
  for (let steps = 0; current && steps <= members.length; steps++) {
    if (current === memberId) return true;
    current = managerOf.get(current);
  }
  return false;
}

/**
 * Who a member may report to: active members of the same project, any party,
 * never themselves and never anyone who would create a reporting loop.
 * `memberId` is undefined for a person not yet on the team.
 */
export function reportsToCandidates(
  members: readonly ProjectMember[] | undefined,
  memberId?: string
): ProjectMember[] {
  const all = members ?? [];
  return activeMembers(all).filter(
    (candidate) => candidate.id !== memberId && !wouldCreateCycle(all, memberId, candidate.id)
  );
}

/* -------------------------------- Leadership -------------------------------- */

export interface LeadershipGroup {
  key: "governance" | "controls";
  title: string;
  roles: { field: FixedResponsibilityField; label: string; required: boolean; contactId?: string }[];
}

const LEADERSHIP_LAYOUT: { key: LeadershipGroup["key"]; title: string; fields: FixedResponsibilityField[] }[] = [
  {
    key: "governance",
    title: "Project Leadership & Governance",
    fields: ["projectSponsorId", "projectManagerId", "clientRepresentativeId"],
  },
  {
    key: "controls",
    title: "Project Controls & Coordination",
    fields: ["projectControlManagerId", "reportingCoordinatorId"],
  },
];

/** The five existing fixed roles, presented in two groups (not "Top Management"). */
export function leadershipGroups(project: Pick<Project, FixedResponsibilityField>): LeadershipGroup[] {
  return LEADERSHIP_LAYOUT.map((group) => ({
    key: group.key,
    title: group.title,
    roles: group.fields.map((field) => {
      const meta = FIXED_RESPONSIBILITIES.find((entry) => entry.field === field)!;
      return { field, label: meta.label, required: meta.required, contactId: project[field] || undefined };
    }),
  }));
}

/** Fixed leadership roles a person currently holds on this project (badges). */
export function leadershipRolesOf(
  project: Pick<Project, FixedResponsibilityField>,
  contactId: string
): string[] {
  return FIXED_RESPONSIBILITIES.filter((meta) => project[meta.field] === contactId).map((meta) => meta.label);
}

/* ------------------------------ Party sections ------------------------------ */

export interface TeamSection {
  key: string;
  kind: "eprom" | "owner" | "subcontractor" | "needs_party";
  title: string;
  party?: ProjectParty;
  members: ProjectMember[];
}

/**
 * EPROM Team, Owner / Client Team, then one section per configured
 * Subcontractor (keyed by its stable party UUID, in configured order). A
 * "Needs party" section appears only while legacy members lack a party.
 * Active members only; a project with no subcontractors gets no
 * subcontractor section.
 */
export function teamSections(project: Pick<Project, "parties" | "members">): TeamSection[] {
  const parties = project.parties ?? [];
  const active = activeMembers(project.members);
  const membersOf = (partyId?: string) => active.filter((member) => member.partyId === partyId);
  const sections: TeamSection[] = [];
  const eprom = parties.find((party) => party.kind === "eprom");
  const owner = parties.find((party) => party.kind === "owner");
  sections.push({ key: eprom?.id ?? "eprom", kind: "eprom", title: "EPROM Team", party: eprom,
    members: eprom?.id ? membersOf(eprom.id) : [] });
  sections.push({ key: owner?.id ?? "owner", kind: "owner", title: "Owner / Client Team", party: owner,
    members: owner?.id ? membersOf(owner.id) : [] });
  for (const party of parties.filter((entry) => entry.kind === "subcontractor").sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (!party.id) continue;
    sections.push({
      key: party.id,
      kind: "subcontractor",
      title: `${subcontractorDisplayName(party) || "Subcontractor"} Team`,
      party,
      members: membersOf(party.id),
    });
  }
  const unassigned = active.filter(memberNeedsParty);
  if (unassigned.length > 0) {
    sections.push({ key: "needs-party", kind: "needs_party", title: "Needs party", members: unassigned });
  }
  return sections;
}

/** "EPROM" / client name / subcontractor short-or-registered name. */
export function partyLabel(party: ProjectParty | undefined, clientName?: string): string {
  if (!party) return "Needs party";
  if (party.kind === "eprom") return "EPROM";
  if (party.kind === "owner") return clientName ? `Owner / Client — ${clientName}` : "Owner / Client";
  return subcontractorDisplayName(party) || "Subcontractor";
}

/* ---------------------------- Warnings (not blockers) ------------------------ */

export interface TeamWarnings {
  needsParty: number;
  needsProjectRole: number;
  noReportsTo: number;
  messages: string[];
}

const plural = (count: number, singular: string, many: string) =>
  `${count} ${count === 1 ? singular : many}`;

/**
 * Completion facts for 2C.3C. WARNINGS ONLY: legacy members needing a Party
 * or Project Role, and members without a Reports To, never block a setup
 * step or invalidate an existing project. The Project Manager and Project
 * Sponsor head the project, so their missing Reports To is not counted.
 */
export function teamWarnings(project: Pick<Project, "members" | "projectManagerId" | "projectSponsorId">): TeamWarnings {
  const active = activeMembers(project.members);
  const heads = new Set([project.projectManagerId, project.projectSponsorId].filter(Boolean));
  const needsParty = active.filter(memberNeedsParty).length;
  const needsProjectRole = active.filter(memberNeedsProjectRole).length;
  const noReportsTo = active.filter((member) => !member.reportsToMemberId && !heads.has(member.contactId)).length;
  const messages = [
    needsParty > 0 ? `${plural(needsParty, "member needs", "members need")} Party` : "",
    needsProjectRole > 0 ? `${plural(needsProjectRole, "member needs", "members need")} Project Role` : "",
    noReportsTo > 0 ? `${plural(noReportsTo, "member has", "members have")} no Reports To` : "",
  ].filter(Boolean);
  return { needsParty, needsProjectRole, noReportsTo, messages };
}

/* ----------------------- Ending a membership (2C.3D Wave 2) ---------------- */

/**
 * Why a membership cannot end yet because of PROJECT-level responsibility
 * (mirrors the database guard guard_project_member_psm_responsibilities):
 * a fixed responsibility or project position first, then any department-team
 * assignment (Department Manager, Team Member Lead, Team Member). Nothing is
 * ever removed or reassigned on the user's behalf.
 */
export function membershipEndResponsibility(
  project: Pick<Project, FixedResponsibilityField | "team" | "positions">,
  contactId: string
): "project_responsibility" | "psm_assignments" | undefined {
  if (FIXED_RESPONSIBILITIES.some((meta) => project[meta.field] === contactId)
      || (project.positions ?? []).some((position) => position.contactId === contactId)) {
    return "project_responsibility";
  }
  // Department-team rows carry no responsibility `role` (fixed mirrors do).
  if ((project.team ?? []).some((row) => row.contactId === contactId && !row.role)) return "psm_assignments";
  return undefined;
}

/* --------------------------- Party removal (mock) --------------------------- */

export const PARTY_TEAM_HISTORY_MESSAGE =
  "This subcontractor cannot be removed because project team history exists.";

/** Mirrors guard_project_party_team_history: any current or ended member blocks removal. */
export function partyHasTeamHistory(members: readonly ProjectMember[] | undefined, partyId: string): boolean {
  return (members ?? []).some((member) => member.partyId === partyId);
}

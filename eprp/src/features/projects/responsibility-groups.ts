import type { Project } from "@/types";
import { activeMembers, partyLabel } from "./project-team";
import type { ResponsibilityEntry } from "./responsibilities";

/**
 * Project Responsibility, grouped by the party its holder represents on this
 * project. Presentation only: grouping never changes what a responsibility
 * is, who may hold it, or how it saves.
 *
 * The party comes from the holder's ACTIVE Project Team membership (2C.3C):
 *   eprom              — EPROM party
 *   client             — Owner / Client party
 *   subcontractor      — any subcontractor party
 *   party_not_recorded — a holder who is not an active member, or whose
 *                        membership has no party yet (legacy data)
 *   assigned           — a NEW project: it has no Project Team yet, so a
 *                        holder's party cannot be known
 *   unassigned         — no holder
 */
export type ResponsibilityGroupKey =
  | "eprom"
  | "client"
  | "subcontractor"
  | "party_not_recorded"
  | "assigned"
  | "unassigned";

export const RESPONSIBILITY_GROUP_ORDER: readonly ResponsibilityGroupKey[] = [
  "eprom",
  "client",
  "subcontractor",
  "party_not_recorded",
  "assigned",
  "unassigned",
];

export interface ResponsibilityGroup {
  key: ResponsibilityGroupKey;
  entries: ResponsibilityEntry[];
}

type PartyProject = Pick<Project, "members" | "parties">;

/** The group a holder belongs to on this project. */
export function holderGroup(
  project: PartyProject | null | undefined,
  contactId: string | null | undefined
): ResponsibilityGroupKey {
  if (!contactId) return "unassigned";
  if (!project) return "assigned";
  const member = activeMembers(project.members).find((candidate) => candidate.contactId === contactId);
  const kind = member?.partyId
    ? (project.parties ?? []).find((party) => party.id === member.partyId)?.kind
    : undefined;
  if (kind === "eprom") return "eprom";
  if (kind === "owner") return "client";
  if (kind === "subcontractor") return "subcontractor";
  return "party_not_recorded";
}

/**
 * The holder's party on this project as a short label ("EPROM",
 * "Owner / Client", a subcontractor's name), or undefined when it is not
 * recorded. Display only.
 */
export function holderPartyLabel(
  project: PartyProject | null | undefined,
  contactId: string | null | undefined
): string | undefined {
  if (!project || !contactId) return undefined;
  const member = activeMembers(project.members).find((candidate) => candidate.contactId === contactId);
  const party = member?.partyId ? (project.parties ?? []).find((candidate) => candidate.id === member.partyId) : undefined;
  return party ? partyLabel(party) : undefined;
}

/** Who held this responsibility when the project was last saved ("" = nobody). */
export function savedHolderOf(
  entry: ResponsibilityEntry,
  savedProject: Project | null | undefined
): string {
  if (!savedProject) return "";
  if (entry.kind === "fixed") return (entry.fixedField && savedProject[entry.fixedField]) || "";
  return (savedProject.positions ?? []).find((position) => position.id && position.id === entry.positionId)?.contactId ?? "";
}

/**
 * The visible groups, in order, each with its entries in their original
 * order.
 *
 * A row being EDITED stays in the group of the holder it was SAVED with, so
 * its editor does not jump between groups while a person is being picked; it
 * moves to its new holder's group when editing ends.
 *
 * Visibility: on an existing project EPROM and Client always show (an empty
 * one says so), Subcontractor shows when it has cards or the project has a
 * subcontractor party, and every other group only when it has cards.
 */
export function groupResponsibilities(
  entries: readonly ResponsibilityEntry[],
  options: {
    savedProject: Project | null | undefined;
    editingKey?: string | null;
  }
): ResponsibilityGroup[] {
  const { savedProject, editingKey } = options;
  const buckets = new Map<ResponsibilityGroupKey, ResponsibilityEntry[]>(
    RESPONSIBILITY_GROUP_ORDER.map((key) => [key, []])
  );
  for (const entry of entries) {
    const holder = entry.key === editingKey ? savedHolderOf(entry, savedProject) : entry.contactId;
    buckets.get(holderGroup(savedProject, holder))!.push(entry);
  }
  const hasSubcontractorParty = (savedProject?.parties ?? []).some((party) => party.kind === "subcontractor");
  return RESPONSIBILITY_GROUP_ORDER
    .map((key) => ({ key, entries: buckets.get(key)! }))
    .filter(({ key, entries: grouped }) => {
      if (grouped.length > 0) return true;
      if (!savedProject) return false;
      if (key === "eprom" || key === "client") return true;
      return key === "subcontractor" && hasSubcontractorParty;
    });
}

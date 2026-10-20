/**
 * Phase 13.9B — dependency-aware governed removal (shared logic).
 *
 * A parent in a Controlled project's structure must never be removed while
 * governed child structure still hangs from it: the database refuses such a
 * request, so the screens must not offer to submit one. This module answers,
 * for every governed removal, in the project's own words:
 *   - what the removal takes with it (impact), and
 *   - what is still assigned underneath and must be moved / removed first
 *     (blockers), naming each child by its real name and code.
 *
 * Pure (no React, no service). It mirrors the database rules in
 * `project_structure_validate()` (migration 20261019090000) — the database
 * stays authoritative; this only stops a request that is guaranteed to be
 * refused, and explains why.
 */

import type { HierarchyTerms } from "@/config/project-terminology";
import type { ProjectStructure, ProjectStructureLevel, ProjectStructureNode } from "@/types/project-structure";

/* ------------------------------ wording helpers ---------------------------- */

/** "1 Program & Study" / "2 Programs & Studies" — a count with a correct, spaced noun. */
export function countNoun(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** "is" / "are" agreeing with a count. */
export const isAre = (count: number): string => (count === 1 ? "is" : "are");

/** The placeholder older code wrote into a stored system snapshot when it could not find the record. */
const LEGACY_SENTINEL = /^unknown (system|department|discipline|program & study)$/i;

/** True for a name that is really a "could not resolve" placeholder. */
export function isUnresolvedName(name: string | null | undefined): boolean {
  const value = name?.trim();
  return !value || LEGACY_SENTINEL.test(value);
}

export type StructureRecordKind = "Department" | "System" | "Program & Study" | "Discipline" | "Unit";

/**
 * A controlled, traceable label for a record that genuinely cannot be found
 * (deleted from Master Data): never a bare "Unknown …", always with a short
 * reference so the row can still be traced.
 */
export function unresolvedLabel(kind: StructureRecordKind, id: string | undefined): string {
  return id ? `${kind} (record unavailable) · ref ${id.slice(0, 8)}` : `${kind} (not set)`;
}

export interface NamedRecord {
  id: string;
  name?: string | null;
  code?: string | null;
}

export interface ResolvedRecord {
  /** The name to show — never a vague placeholder. */
  label: string;
  code?: string;
  /** False when only a traceable fallback could be produced. */
  resolved: boolean;
}

/**
 * Resolve a stored reference (id + optional snapshot) to a real name and code:
 * the Master Data record first (active OR archived — a snapshot may point at
 * an archived record), then the snapshot unless it is a placeholder, then the
 * traceable fallback.
 */
export function resolveRecord(
  kind: StructureRecordKind,
  reference: { id: string; name?: string | null; code?: string | null },
  master: readonly NamedRecord[]
): ResolvedRecord {
  const record = master.find((candidate) => candidate.id === reference.id);
  const name = !isUnresolvedName(record?.name) ? record?.name : !isUnresolvedName(reference.name) ? reference.name : undefined;
  const code = record?.code ?? reference.code ?? undefined;
  if (name) return { label: name.trim(), code: code ?? undefined, resolved: true };
  if (code) return { label: code, code, resolved: true };
  return { label: unresolvedLabel(kind, reference.id), resolved: false };
}

/** "Crude Distillation Unit (CDU)". */
export const labelWithCode = (item: Pick<ResolvedRecord, "label" | "code">): string =>
  item.code && item.code !== item.label ? `${item.label} (${item.code})` : item.label;

/* ------------------------------- assessment -------------------------------- */

/** One thing that is in the way, named for the person who must clear it. */
export interface BlockerItem {
  id: string;
  label: string;
  /** Where it sits, e.g. "Process · Crude Distillation Unit". */
  detail?: string;
  /** Set when a request to clear it is already awaiting approval. */
  note?: string;
  /** A request that clears this item, offered in place (Other projects). */
  fix?: { label: string; unitId: string };
}

export interface BlockerGroup {
  /** "1 Program & Study is still assigned to this department." */
  heading: string;
  items: BlockerItem[];
  /** What must happen first. */
  todo: string;
  /** Where to do it. */
  link?: { label: string; href: string };
}

export interface RemovalAssessment {
  /** What the removal takes with it, in sentences. */
  impact: string[];
  /** Empty = the request can be submitted. */
  blockers: BlockerGroup[];
}

export const isBlocked = (assessment: Pick<RemovalAssessment, "blockers">): boolean => assessment.blockers.length > 0;

/** A one-line reason for a disabled Submit button. */
export function blockedSummary(assessment: Pick<RemovalAssessment, "blockers">): string {
  return assessment.blockers.map((group) => group.heading).join(" ");
}

/* --------------------------------- PSM ------------------------------------ */

interface PsmProject {
  id: string;
  departments: readonly {
    departmentId: string;
    reportingRequired?: boolean;
    systems: readonly { id: string; name?: string; code?: string }[];
  }[];
  disciplines?: readonly { disciplineId: string; departmentId?: string; systemId?: string }[];
}

export interface PsmLookups {
  departments: readonly NamedRecord[];
  systems: readonly NamedRecord[];
  disciplines: readonly NamedRecord[];
}

/** Project Setup step hrefs the fix links point at (injected so the module stays pure). */
export interface PsmStepHrefs {
  disciplines: string;
  systems: string;
}

/** Requests already awaiting approval, keyed by the same target keys the database writes. */
export type PendingTargets = ReadonlySet<string>;

/** The real name and code of a system on a department's scope. */
export function systemLabelFor(
  system: { id: string; name?: string; code?: string },
  lookups: Pick<PsmLookups, "systems">
): string {
  return labelWithCode(resolveRecord("System", system, lookups.systems));
}

/** "Process · Crude Distillation Unit" for a Program & Study link. */
function placement(
  link: { departmentId?: string; systemId?: string },
  project: PsmProject,
  lookups: PsmLookups
): string {
  const department = link.departmentId
    ? resolveRecord("Department", { id: link.departmentId }, lookups.departments).label
    : undefined;
  const snapshot = project.departments
    .find((assignment) => assignment.departmentId === link.departmentId)
    ?.systems.find((system) => system.id === link.systemId);
  const system = link.systemId
    ? labelWithCode(resolveRecord("System", { id: link.systemId, name: snapshot?.name, code: snapshot?.code }, lookups.systems))
    : "no system";
  return [department, system].filter(Boolean).join(" · ");
}

function disciplineItems(
  links: readonly { disciplineId: string; departmentId?: string; systemId?: string }[],
  project: PsmProject,
  lookups: PsmLookups,
  pending: PendingTargets
): BlockerItem[] {
  return links.map((link) => {
    const record = resolveRecord("Program & Study", { id: link.disciplineId }, lookups.disciplines);
    return {
      id: link.disciplineId,
      label: labelWithCode(record),
      detail: placement(link, project, lookups),
      note: pending.has(`discipline:${link.disciplineId}`) ? "A request for this is awaiting approval" : undefined,
    };
  });
}

/**
 * Removing a department from a Controlled PSM project: it takes its systems
 * with it and is refused while any Program & Study is still assigned to it.
 */
export function departmentRemovalAssessment(input: {
  project: PsmProject;
  departmentId: string;
  lookups: PsmLookups;
  terms: HierarchyTerms;
  hrefs: PsmStepHrefs;
  pending?: PendingTargets;
}): RemovalAssessment {
  const { project, departmentId, lookups, terms, hrefs } = input;
  const pending = input.pending ?? new Set<string>();
  const assignment = project.departments.find((candidate) => candidate.departmentId === departmentId);
  const department = resolveRecord("Department", { id: departmentId }, lookups.departments).label;
  const systems = (assignment?.systems ?? []).map((system) => systemLabelFor(system, lookups));
  const assigned = (project.disciplines ?? []).filter((link) => link.departmentId === departmentId);

  const impact = [
    systems.length > 0
      ? `Once approved, ${department} leaves this project's scope together with ${countNoun(systems.length, "system", "systems")}: ${systems.join(", ")}.`
      : `Once approved, ${department} leaves this project's scope.`,
    "The shared Department record in Master Data is not changed.",
  ];
  const blockers: BlockerGroup[] = [];
  if (assigned.length > 0) {
    blockers.push({
      heading: `${countNoun(assigned.length, terms.singular, terms.plural)} ${isAre(assigned.length)} still assigned to ${department}.`,
      items: disciplineItems(assigned, project, lookups, pending),
      todo: `Move ${assigned.length === 1 ? "it" : "them"} to another department, or remove ${assigned.length === 1 ? "it" : "them"} from the project, before ${department} can be removed.`,
      link: { label: `Open ${terms.plural}`, href: hrefs.disciplines },
    });
  }
  return { impact, blockers };
}

/**
 * Changing a department's systems: a system can only leave the scope when no
 * Program & Study is still filed under it.
 */
export function departmentScopeAssessment(input: {
  project: PsmProject;
  departmentId: string;
  proposedSystemIds: readonly string[];
  lookups: PsmLookups;
  terms: HierarchyTerms;
  hrefs: PsmStepHrefs;
  pending?: PendingTargets;
}): RemovalAssessment {
  const { project, departmentId, proposedSystemIds, lookups, terms, hrefs } = input;
  const pending = input.pending ?? new Set<string>();
  const assignment = project.departments.find((candidate) => candidate.departmentId === departmentId);
  const department = resolveRecord("Department", { id: departmentId }, lookups.departments).label;
  const leaving = (assignment?.systems ?? []).filter((system) => !proposedSystemIds.includes(system.id));
  const impact =
    leaving.length > 0
      ? [`Once approved, ${countNoun(leaving.length, "system", "systems")} leave${leaving.length === 1 ? "s" : ""} ${department}'s scope in this project: ${leaving.map((system) => systemLabelFor(system, lookups)).join(", ")}.`]
      : [];
  const blockers: BlockerGroup[] = [];
  for (const system of leaving) {
    const stuck = (project.disciplines ?? []).filter(
      (link) => link.departmentId === departmentId && link.systemId === system.id
    );
    if (stuck.length === 0) continue;
    const name = systemLabelFor(system, lookups);
    blockers.push({
      heading: `${countNoun(stuck.length, terms.singular, terms.plural)} ${isAre(stuck.length)} still assigned to ${name}.`,
      items: disciplineItems(stuck, project, lookups, pending),
      todo: `Move ${stuck.length === 1 ? "it" : "them"} to another system, or remove ${stuck.length === 1 ? "it" : "them"}, before ${name} can leave the scope.`,
      link: { label: `Open ${terms.plural}`, href: hrefs.disciplines },
    });
  }
  return { impact, blockers };
}

/* ------------------------------- Other project ----------------------------- */

const isActive = (node: ProjectStructureNode) => !node.archivedAt;

const levelLabel = (levels: readonly ProjectStructureLevel[], number: number, plural = false) => {
  const level = levels.find((candidate) => candidate.levelNumber === number);
  return level ? (plural ? level.pluralLabel : level.singularLabel) : plural ? "units" : "unit";
};

const unitLabel = (node: ProjectStructureNode) => (node.code ? `${node.name} (${node.code})` : node.name);

/**
 * Archiving a unit of an Other project: refused while an active child unit
 * exists, or while the unit still has active people / responsibilities.
 * The child level's own (dynamic) wording is used — never fixed terms.
 */
export function unitArchiveAssessment(input: {
  structure: Pick<ProjectStructure, "levels" | "nodes" | "assignments">;
  unit: ProjectStructureNode;
  pending?: PendingTargets;
}): RemovalAssessment {
  const { structure, unit } = input;
  const pending = input.pending ?? new Set<string>();
  const children = structure.nodes.filter((node) => node.parentId === unit.id && isActive(node));
  const childPlural = levelLabel(structure.levels, unit.levelNumber + 1, true);
  const childSingular = levelLabel(structure.levels, unit.levelNumber + 1);
  const people = structure.assignments;
  // People, not rows: a Unit Lead is held as an extra row beside the person's member row.
  const members = [
    ...new Map(
      (people?.unitMembers ?? [])
        .filter((row) => row.nodeId === unit.id && !row.endedAt)
        .map((row) => [row.memberId, row])
    ).values(),
  ];
  const responsibilities = (people?.reportResponsibilities ?? []).filter((row) => row.nodeId === unit.id && !row.endedAt);

  const impact = [`Once approved, ${unitLabel(unit)} is archived and owes no Weekly or Monthly input. Its history is kept and it can be restored later.`];
  const blockers: BlockerGroup[] = [];
  if (children.length > 0) {
    blockers.push({
      heading: `${countNoun(children.length, childSingular, childPlural)} ${isAre(children.length)} still active under ${unitLabel(unit)}.`,
      items: children.map((child) => ({
        id: child.id,
        label: unitLabel(child),
        detail: levelLabel(structure.levels, child.levelNumber),
        note: pending.has(`unit:${child.id}`) ? "A request for this is awaiting approval" : undefined,
        fix: pending.has(`unit:${child.id}`) ? undefined : { label: "Request archive", unitId: child.id },
      })),
      todo: `Archive ${children.length === 1 ? "it" : "them"} first (each archive is its own request), then archive ${unit.name}.`,
    });
  }
  if (members.length > 0 || responsibilities.length > 0) {
    blockers.push({
      heading: `${unitLabel(unit)} still has ${countNoun(members.length, "active person", "active people")}${responsibilities.length > 0 ? ` and ${countNoun(responsibilities.length, "reporting responsibility", "reporting responsibilities")}` : ""}.`,
      items: [],
      todo: "Remove its Lead, members and Weekly / Monthly responsibilities on the Project Team step before it can be archived.",
    });
  }
  return { impact, blockers };
}

/**
 * Removing the deepest level of an Other project: refused while any unit
 * (archived included — history is kept) still sits on it.
 */
export function levelRemovalAssessment(input: {
  structure: Pick<ProjectStructure, "levels" | "nodes">;
  level: ProjectStructureLevel;
}): RemovalAssessment {
  const { structure, level } = input;
  const units = structure.nodes.filter((node) => node.levelNumber === level.levelNumber);
  const active = units.filter(isActive);
  const impact = [`Once approved, the ${level.singularLabel} level (level ${level.levelNumber}) is removed from this project's structure.`];
  const blockers: BlockerGroup[] = [];
  if (units.length > 0) {
    blockers.push({
      heading: `${countNoun(units.length, level.singularLabel, level.pluralLabel)} ${isAre(units.length)} still on this level${active.length < units.length ? ` (${countNoun(units.length - active.length, "archived", "archived")} included)` : ""}.`,
      items: units.map((node) => ({
        id: node.id,
        label: unitLabel(node),
        detail: node.archivedAt ? "Archived" : "Active",
      })),
      todo: `A level that has units cannot be removed. Move or archive the ${level.pluralLabel.toLowerCase()} first; units with history can never leave their level, so this level may have to stay.`,
    });
  }
  return { impact, blockers };
}

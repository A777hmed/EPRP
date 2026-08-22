import type { Discipline, Project, ProjectDisciplineLink } from "@/types";

/**
 * Integrity of the Department → System → scope-item chain on a project.
 *
 * The Disciplines step already refuses to *create* a link outside that chain:
 * its picker offers only records owned by the selected System and Department.
 * That predicate cannot repair links written before it existed, which is how
 * Process-Safety-owned records such as QRA and FERA ended up sitting under the
 * Asset Integrity Management System on an existing project.
 *
 * Everything here is pure and read-only over the arrays the wizard already
 * holds. Nothing in this module edits a master-data record, and nothing
 * relocates a link on its own — a misplaced link is reported so the user can
 * correct it deliberately, because the alternative is silently moving data
 * whose history somebody may depend on.
 */

export type ScopeLinkProblem =
  /** The record belongs to a different System than the link claims. */
  | "wrong-system"
  /** The record belongs to a different Department than the link claims. */
  | "wrong-department"
  /** No master record exists for this id at all. */
  | "unknown-record";

/** One project link that contradicts the master record it points at. */
export interface MisplacedScopeLink {
  disciplineId: string;
  problem: ScopeLinkProblem;
  /** Where the project currently files it. */
  linkSystemId?: string;
  linkDepartmentId?: string;
  /** Where the master record says it belongs. */
  ownerSystemId?: string;
  ownerDepartmentId?: string;
}

/**
 * Links whose stored System/Department disagree with the owning master record.
 *
 * `disciplines` must be the FULL record set, archived included — passing only
 * active records would report every archived-but-correct link as an orphan.
 *
 * A link is judged only on the levels the record actually populates: a project
 * type that does not use the System level leaves `systemId` empty on both
 * sides, and is checked on Department alone rather than being reported wrong.
 */
export function misplacedScopeLinks(
  project: Project,
  disciplines: Discipline[]
): MisplacedScopeLink[] {
  const byId = new Map(disciplines.map((record) => [record.id, record]));
  const misplaced: MisplacedScopeLink[] = [];

  for (const link of project.disciplines ?? []) {
    const record = byId.get(link.disciplineId);

    if (!record) {
      misplaced.push({
        disciplineId: link.disciplineId,
        problem: "unknown-record",
        linkSystemId: link.systemId,
        linkDepartmentId: link.departmentId,
      });
      continue;
    }

    const base = {
      disciplineId: link.disciplineId,
      linkSystemId: link.systemId,
      linkDepartmentId: link.departmentId,
      ownerSystemId: record.systemId,
      ownerDepartmentId: record.departmentId,
    };

    // System is the more specific level, so it is reported in preference to
    // the department it implies — fixing the System fixes both.
    if (record.systemId && link.systemId && record.systemId !== link.systemId) {
      misplaced.push({ ...base, problem: "wrong-system" });
      continue;
    }
    if (
      record.departmentId &&
      link.departmentId &&
      record.departmentId !== link.departmentId
    ) {
      misplaced.push({ ...base, problem: "wrong-department" });
    }
  }

  return misplaced;
}

/** Every system assigned to the project, flattened with its owning department. */
function projectSystemIndex(project: Project): Map<string, string> {
  const index = new Map<string, string>();
  for (const assignment of project.departments ?? []) {
    for (const system of assignment.systems ?? []) {
      index.set(system.id, assignment.departmentId);
    }
  }
  return index;
}

/**
 * Whether the owning System is already in this project's scope.
 *
 * A correction only re-files an existing link; it never adds a System to the
 * project. When the owner is absent the caller must send the user to the
 * Systems step rather than inventing scope on their behalf.
 */
export function canCorrectScopeLink(
  project: Project,
  misplaced: MisplacedScopeLink
): boolean {
  if (misplaced.problem === "unknown-record") return false;
  if (!misplaced.ownerDepartmentId) return false;

  if (misplaced.ownerSystemId) {
    return projectSystemIndex(project).get(misplaced.ownerSystemId) ===
      misplaced.ownerDepartmentId;
  }
  return (project.departments ?? []).some(
    (assignment) => assignment.departmentId === misplaced.ownerDepartmentId
  );
}

/**
 * Re-file ONE link under the System and Department that own it.
 *
 * Returns the whole `disciplines` array so the caller can hand it straight to
 * the draft. The link is moved, never dropped, and every other link is
 * returned untouched. If the destination already holds this record the
 * duplicate collapses into the existing correct link rather than being added
 * twice.
 */
export function correctScopeLink(
  project: Project,
  misplaced: MisplacedScopeLink
): ProjectDisciplineLink[] {
  const links = project.disciplines ?? [];
  if (!canCorrectScopeLink(project, misplaced)) return links;

  const corrected: ProjectDisciplineLink = {
    disciplineId: misplaced.disciplineId,
    systemId: misplaced.ownerSystemId,
    departmentId: misplaced.ownerDepartmentId,
  };

  const isTheMisplacedOne = (link: ProjectDisciplineLink) =>
    link.disciplineId === misplaced.disciplineId &&
    (link.systemId ?? undefined) === (misplaced.linkSystemId ?? undefined);

  const alreadyCorrect = links.some(
    (link) =>
      !isTheMisplacedOne(link) &&
      link.disciplineId === corrected.disciplineId &&
      (link.systemId ?? undefined) === (corrected.systemId ?? undefined)
  );

  const remaining = links.filter((link) => !isTheMisplacedOne(link));
  return alreadyCorrect ? remaining : [...remaining, corrected];
}

/**
 * Drop ONE link, identified by the System it is filed under.
 *
 * Scoped by `systemId` so removing a record from the System it was wrongly
 * filed under leaves its legitimate link under the correct System in place.
 */
export function removeScopeLink(
  project: Project,
  disciplineId: string,
  systemId: string | undefined
): ProjectDisciplineLink[] {
  return (project.disciplines ?? []).filter(
    (link) =>
      !(
        link.disciplineId === disciplineId &&
        (link.systemId ?? undefined) === (systemId ?? undefined)
      )
  );
}

/** Key used to match a misplaced report back to the row that produced it. */
export function scopeLinkKey(
  disciplineId: string,
  systemId: string | undefined
): string {
  return `${disciplineId}::${systemId ?? ""}`;
}

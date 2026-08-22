"use client";

import * as React from "react";

import { useMasterData } from "@/features/master-data";
import type {
  Contact,
  Department,
  Discipline,
  Project,
  System,
} from "@/types";
import { projectResponsibilities } from "../../responsibilities";
import { projectTeamPeople } from "../../assignment-rules";

/** One selectable scope record, already narrowed to this project. */
export interface ScopeOption {
  id: string;
  name: string;
  /** Present on systems and scope items, so the pickers can cascade. */
  departmentId?: string;
  systemId?: string;
}

export interface MilestoneScopeOptions {
  departments: ScopeOption[];
  systems: ScopeOption[];
  /** Disciplines, or Programs & Studies on PSM/PSAIM projects. Wording only. */
  disciplines: ScopeOption[];
  /** People already on this project — team members and responsibility holders. */
  people: ScopeOption[];
  /** id → display name, across every kind. Ids are uuids, so one map is safe. */
  names: Record<string, string>;
}

/**
 * The scope a milestone may be filed under, read from the project itself.
 *
 * A milestone belongs to the project's scope, never to global master data: a
 * department that exists in master data but was never brought into this project
 * has no place in its register. That is the same rule the project scope
 * sections and the Weekly scope resolver already apply, and it is why the lists
 * are derived from `project.departments` / `project.disciplines` rather than
 * from the master stores directly. Master data supplies the NAMES only.
 */
export function useMilestoneScopeOptions(
  project: Project
): MilestoneScopeOptions {
  const { records: departmentRecords } = useMasterData("department");
  const { records: systemRecords } = useMasterData("system");
  const { records: disciplineRecords } = useMasterData("discipline");
  const { records: contactRecords } = useMasterData("contact");

  return React.useMemo(() => {
    const departmentsMaster = departmentRecords as Department[];
    const systemsMaster = systemRecords as System[];
    const disciplinesMaster = disciplineRecords as Discipline[];
    const contactsMaster = contactRecords as Contact[];

    const nameIn = (list: { id: string; name: string }[], id: string) =>
      list.find((record) => record.id === id)?.name;

    const departments: ScopeOption[] = project.departments.map((assignment) => ({
      id: assignment.departmentId,
      name:
        nameIn(departmentsMaster, assignment.departmentId) ??
        "Unknown department",
    }));

    /*
     * A system is stored on the department that brought it in, so its owning
     * department comes from the assignment rather than from the master record —
     * the same system can serve different departments on different projects.
     */
    const systems: ScopeOption[] = project.departments.flatMap((assignment) =>
      assignment.systems.map((system) => ({
        id: system.id,
        name: system.name || nameIn(systemsMaster, system.id) || "Unknown system",
        departmentId: assignment.departmentId,
      }))
    );

    // De-duplicated by id: the same scope item can be linked under more than
    // one system, and it is still one thing to file a milestone against.
    const disciplines: ScopeOption[] = [];
    const seenDiscipline = new Set<string>();
    for (const link of project.disciplines ?? []) {
      if (seenDiscipline.has(link.disciplineId)) continue;
      seenDiscipline.add(link.disciplineId);
      disciplines.push({
        id: link.disciplineId,
        name: nameIn(disciplinesMaster, link.disciplineId) ?? "Unknown",
        departmentId: link.departmentId,
        systemId: link.systemId,
      });
    }

    /*
     * Everyone the project already knows: the team (grouped to one entry per
     * person, never one per assignment row) plus the responsibility holders,
     * who are not team members but can certainly own a milestone.
     */
    const peopleIds = new Set<string>();
    for (const person of projectTeamPeople(project)) {
      peopleIds.add(person.contactId);
    }
    // The job-title resolver is only needed for role LABELS, which this list
    // does not show — the entries are read for their contact ids alone.
    for (const entry of projectResponsibilities(project, () => undefined)) {
      if (entry.contactId) peopleIds.add(entry.contactId);
    }
    const people: ScopeOption[] = [...peopleIds]
      .map((id) => ({
        id,
        name: contactsMaster.find((record) => record.id === id)?.name ?? "",
      }))
      .filter((option) => option.name)
      .sort((a, b) => a.name.localeCompare(b.name));

    const names: Record<string, string> = {};
    for (const option of [...departments, ...systems, ...disciplines, ...people]) {
      names[option.id] = option.name;
    }
    // Contacts not on the project can still be referenced by historical rows —
    // an owner who has since been removed must still render as a name.
    for (const contact of contactsMaster) {
      names[contact.id] ??= contact.name;
    }

    return { departments, systems, disciplines, people, names };
  }, [
    project,
    departmentRecords,
    systemRecords,
    disciplineRecords,
    contactRecords,
  ]);
}

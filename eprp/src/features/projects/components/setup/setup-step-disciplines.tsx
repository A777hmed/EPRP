"use client";

import * as React from "react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, SectionCard } from "@/components/shared";
import { ManagedMultiSelect } from "@/features/master-data";
import type {
  Discipline,
  MasterRecordBase,
  Project,
  ProjectDisciplineLink,
} from "@/types";
import Link from "next/link";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  withProjectContext,
  type ProjectLinkContext,
} from "../../project-link-context";
import type { HierarchyTerms } from "@/config/project-terminology";
import { LinkedRecordRow } from "./linked-record-row";

export interface SetupStepDisciplinesProps {
  /** Hierarchy wording — display only. */
  terms: HierarchyTerms;
  project: Project;
  context: ProjectLinkContext;
  disciplines: Discipline[];
  departmentName: (id: string) => string;
  onDraftChange: (patch: Partial<Project>) => void;
}

/**
 * Step 4 — link disciplines to the systems and departments they cover.
 *
 * A discipline is chosen per system: pick the system, then the disciplines
 * working on it. Options are limited to disciplines owned by that system's
 * department, so the Discipline → System → Department chain holds.
 */
export function SetupStepDisciplines({
  project,
  context,
  disciplines,
  departmentName,
  onDraftChange,
  terms,
}: SetupStepDisciplinesProps) {
  const links = project.disciplines ?? [];
  const assignments = project.departments;

  // Every system on the project, flattened with its owning department.
  const projectSystems = assignments.flatMap((assignment) =>
    assignment.systems.map((system) => ({
      ...system,
      departmentId: assignment.departmentId,
    }))
  );

  const [systemId, setSystemId] = React.useState(
    () => projectSystems[0]?.id ?? ""
  );
  const activeSystem = projectSystems.find((system) => system.id === systemId);
  const activeDepartmentId = activeSystem?.departmentId ?? "";

  const linksForSystem = links.filter((link) => link.systemId === systemId);

  const setForSystem = (ids: string[]) => {
    const others = links.filter((link) => link.systemId !== systemId);
    const next: ProjectDisciplineLink[] = ids.map((disciplineId) => ({
      disciplineId,
      systemId,
      departmentId: activeDepartmentId,
    }));
    onDraftChange({ disciplines: [...others, ...next] });
  };

  const disciplineName = (id: string) =>
    disciplines.find((discipline) => discipline.id === id)?.name ?? id;

  if (projectSystems.length === 0) {
    return (
      <SectionCard title={terms.plural}>
        <EmptyState
          title="No systems yet"
          description={`Assign systems to departments before linking ${terms.pluralLower}.`}
          className="py-8"
        />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title={`Link ${terms.pluralLower} to a system`}
        description={`${terms.plural} are offered from the department that owns the selected system.`}
        action={
          <Button variant="outline" size="sm" asChild>
            <Link
              href={withProjectContext("/disciplines/new", {
                ...context,
                sourceType: "system",
                parentId: systemId,
              })}
            >
              <Plus data-icon="inline-start" aria-hidden="true" />
              Add {terms.singular}
            </Link>
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="setup-system">System</Label>
            <Select value={systemId} onValueChange={setSystemId}>
              <SelectTrigger id="setup-system" className="w-full">
                <SelectValue placeholder="Select a system" />
              </SelectTrigger>
              <SelectContent>
                {projectSystems.map((system) => (
                  <SelectItem key={system.id} value={system.id}>
                    {system.name}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {departmentName(system.departmentId)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="setup-disciplines">{terms.plural}</Label>
            <ManagedMultiSelect
              kind="discipline"
              value={linksForSystem.map((link) => link.disciplineId)}
              onChange={setForSystem}
              filter={(record: MasterRecordBase) =>
                (record as Discipline).departmentId === activeDepartmentId
              }
              emptyLabel={`No ${terms.pluralLower} belong to this system's department.`}
              placeholder={`Select ${terms.pluralLower}…`}
              controlProps={{ id: "setup-disciplines" }}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={`Linked ${terms.pluralLower}`}
        description={`Every ${terms.singularLower} linked on this project, grouped by system.`}
      >
        {links.length === 0 ? (
          <EmptyState
            title={`No ${terms.pluralLower} linked yet`}
            description={`Pick a system above, then choose the ${terms.pluralLower} covering it.`}
            className="py-8"
          />
        ) : (
          <ul className="space-y-4">
            {projectSystems
              .filter((system) =>
                links.some((link) => link.systemId === system.id)
              )
              .map((system) => (
                <li key={system.id}>
                  <p className="text-xs text-muted-foreground">
                    {system.name} · {departmentName(system.departmentId)}
                  </p>
                  <ul className="mt-1 space-y-2">
                    {links
                      .filter((link) => link.systemId === system.id)
                      .map((link) => (
                        <li key={`${system.id}-${link.disciplineId}`}>
                          <LinkedRecordRow
                            kind="discipline"
                            id={link.disciplineId}
                            name={disciplineName(link.disciplineId)}
                            meta={departmentName(link.departmentId ?? "")}
                            context={context}
                            onRemove={() =>
                              onDraftChange({
                                disciplines: links.filter(
                                  (candidate) =>
                                    !(
                                      candidate.systemId === system.id &&
                                      candidate.disciplineId ===
                                        link.disciplineId
                                    )
                                ),
                              })
                            }
                          />
                        </li>
                      ))}
                  </ul>
                </li>
              ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

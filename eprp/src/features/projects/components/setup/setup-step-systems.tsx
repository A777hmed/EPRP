"use client";

import * as React from "react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, SectionCard } from "@/components/shared";
import {
  ManagedMultiSelect,
  type ManagedMultiSelectHandle,
} from "@/features/master-data";
import type {
  DepartmentAssignment,
  MasterRecordBase,
  Project,
  System,
} from "@/types";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { type ProjectLinkContext } from "../../project-link-context";
import { LinkedRecordRow } from "./linked-record-row";

export interface SetupStepSystemsProps {
  project: Project;
  context: ProjectLinkContext;
  systems: System[];
  departmentName: (id: string) => string;
  onDraftChange: (patch: Partial<Project>) => void;
}

/**
 * Step 3 — assign systems to each department already on the project.
 *
 * The picker for a department only offers systems owned by that department,
 * which is what keeps the System → Department link honest.
 *
 * Creating a System never leaves the wizard. Both "+ Add System" in a card
 * header and "+ Add new system" inside the dropdown open the SAME inline
 * dialog, pre-scoped to that card's department, and the saved record is
 * selected into this step's draft on the way back. Sending the user to
 * /systems/new instead dropped the project sidebar, the step they were on,
 * and any unsaved edits on this step.
 */
export function SetupStepSystems({
  project,
  context,
  systems,
  departmentName,
  onDraftChange,
}: SetupStepSystemsProps) {
  const assignments = project.departments;

  /*
   * One handle per department card, so a header button can open that card's
   * own picker dialog. A map rather than a hook per card — the cards are
   * rendered from a list, and extracting a component just to own a ref would
   * be a much larger change than the fix warrants.
   */
  const pickers = React.useRef(
    new Map<string, ManagedMultiSelectHandle | null>()
  );

  const setSystems = (departmentId: string, ids: string[]) => {
    const next: DepartmentAssignment[] = assignments.map((assignment) =>
      assignment.departmentId === departmentId
        ? {
            ...assignment,
            // Snapshot name/code, matching how assignments are stored.
            systems: ids.map((id) => {
              const record = systems.find((system) => system.id === id);
              const existing = assignment.systems.find(
                (system) => system.id === id
              );
              return {
                id,
                name: record?.name ?? existing?.name ?? id,
                code: record?.code ?? existing?.code,
                projectDescription: existing?.projectDescription,
              };
            }),
          }
        : assignment
    );
    onDraftChange({ departments: next });
  };

  const patchSystemDescription = (
    departmentId: string,
    systemId: string,
    projectDescription: string
  ) =>
    onDraftChange({
      departments: assignments.map((assignment) =>
        assignment.departmentId === departmentId
          ? {
              ...assignment,
              systems: assignment.systems.map((system) =>
                system.id === systemId
                  ? { ...system, projectDescription }
                  : system
              ),
            }
          : assignment
      ),
    });

  if (assignments.length === 0) {
    return (
      <SectionCard title="Systems">
        <EmptyState
          title="No departments yet"
          description="Assign departments before scoping systems."
          className="py-8"
        />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      {assignments.map((assignment) => {
        const available = systems.filter(
          (system) => system.departmentId === assignment.departmentId
        );
        const inputId = `systems-${assignment.departmentId}`;

        return (
          <SectionCard
            key={assignment.departmentId}
            title={departmentName(assignment.departmentId)}
            description={`${available.length} system${
              available.length === 1 ? "" : "s"
            } belong to this department.`}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  pickers.current.get(assignment.departmentId)?.openCreate()
                }
              >
                <Plus data-icon="inline-start" aria-hidden="true" />
                Add System
              </Button>
            }
          >
            <div className="space-y-1.5">
              <Label htmlFor={inputId}>Systems in scope</Label>
              <ManagedMultiSelect
                ref={(handle) => {
                  pickers.current.set(assignment.departmentId, handle);
                }}
                kind="system"
                value={assignment.systems.map((system) => system.id)}
                onChange={(ids) => setSystems(assignment.departmentId, ids)}
                filter={(record: MasterRecordBase) =>
                  (record as System).departmentId === assignment.departmentId
                }
                // The card is already scoped to one department, so a System
                // created here inherits it rather than being saved unowned
                // and then filtered out of the very list that created it.
                createPresetValues={{ departmentId: assignment.departmentId }}
                emptyLabel="No systems belong to this department yet."
                placeholder="Select systems…"
                controlProps={{ id: inputId }}
              />
            </div>

            {assignment.systems.length > 0 && (
              <ul className="mt-3 space-y-2">
                {assignment.systems.map((system) => (
                  <li key={system.id}>
                    <LinkedRecordRow
                      kind="system"
                      id={system.id}
                      name={system.name}
                      meta={system.code}
                      context={context}
                      onRemove={() =>
                        setSystems(
                          assignment.departmentId,
                          assignment.systems
                            .filter((s) => s.id !== system.id)
                            .map((s) => s.id)
                        )
                      }
                    >
                      <div className="mt-3 space-y-1">
                        <Label
                          htmlFor={`system-description-${assignment.departmentId}-${system.id}`}
                          className="text-xs text-muted-foreground"
                        >
                          System Scope in This Project (optional)
                        </Label>
                        <Textarea
                          id={`system-description-${assignment.departmentId}-${system.id}`}
                          value={system.projectDescription ?? ""}
                          rows={2}
                          placeholder={
                            systems.find((record) => record.id === system.id)
                              ?.description ??
                            "Add scope or notes specific to this project"
                          }
                          onChange={(event) =>
                            patchSystemDescription(
                              assignment.departmentId,
                              system.id,
                              event.target.value
                            )
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Leave blank to use the shared System description.
                        </p>
                      </div>
                    </LinkedRecordRow>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        );
      })}
    </div>
  );
}

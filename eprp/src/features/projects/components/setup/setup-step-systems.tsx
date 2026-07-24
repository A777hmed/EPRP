"use client";

import * as React from "react";

import { Label } from "@/components/ui/label";
import { EmptyState, SectionCard } from "@/components/shared";
import { ManagedMultiSelect } from "@/features/master-data";
import type {
  DepartmentAssignment,
  MasterRecordBase,
  Project,
  System,
} from "@/types";
import Link from "next/link";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  withProjectContext,
  type ProjectLinkContext,
} from "../../project-link-context";
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
 */
export function SetupStepSystems({
  project,
  context,
  systems,
  departmentName,
  onDraftChange,
}: SetupStepSystemsProps) {
  const assignments = project.departments;

  const setSystems = (departmentId: string, ids: string[]) => {
    const next: DepartmentAssignment[] = assignments.map((assignment) =>
      assignment.departmentId === departmentId
        ? {
            ...assignment,
            // Snapshot name/code, matching how assignments are stored.
            systems: ids.map((id) => {
              const record = systems.find((system) => system.id === id);
              return {
                id,
                name: record?.name ?? id,
                code: record?.code,
              };
            }),
          }
        : assignment
    );
    onDraftChange({ departments: next });
  };

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
              <Button variant="outline" size="sm" asChild>
                <Link
                  href={withProjectContext("/systems/new", {
                    ...context,
                    sourceType: "department",
                    parentId: assignment.departmentId,
                  })}
                >
                  <Plus data-icon="inline-start" aria-hidden="true" />
                  Add System
                </Link>
              </Button>
            }
          >
            <div className="space-y-1.5">
              <Label htmlFor={inputId}>Systems in scope</Label>
              <ManagedMultiSelect
                kind="system"
                value={assignment.systems.map((system) => system.id)}
                onChange={(ids) => setSystems(assignment.departmentId, ids)}
                filter={(record: MasterRecordBase) =>
                  (record as System).departmentId === assignment.departmentId
                }
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
                    />
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

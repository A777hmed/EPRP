"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { EmptyState, SectionCard } from "@/components/shared";
import { ManagedMultiSelect } from "@/features/master-data";
import type { DepartmentAssignment, Project } from "@/types";
import Link from "next/link";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  withProjectContext,
  type ProjectLinkContext,
} from "../../project-link-context";
import { LinkedRecordRow } from "./linked-record-row";

export interface SetupStepDepartmentsProps {
  project: Project;
  context: ProjectLinkContext;
  departmentName: (id: string) => string;
  onDraftChange: (patch: Partial<Project>) => void;
}

/**
 * Step 2 — choose the departments on the project and describe how each one
 * participates. Selections become `project.departments`, which every later
 * step is scoped by.
 */
export function SetupStepDepartments({
  project,
  context,
  departmentName,
  onDraftChange,
}: SetupStepDepartmentsProps) {
  const assignments = project.departments;
  const selectedIds = assignments.map((a) => a.departmentId);

  const update = (next: DepartmentAssignment[]) =>
    onDraftChange({ departments: next });

  const handleSelectionChange = (ids: string[]) => {
    // Keep the settings already entered for departments that stay selected.
    update(
      ids.map(
        (id) =>
          assignments.find((a) => a.departmentId === id) ?? {
            departmentId: id,
            leadName: "",
            reportingRequired: true,
            systems: [],
          }
      )
    );
  };

  const patchAssignment = (
    departmentId: string,
    patch: Partial<DepartmentAssignment>
  ) =>
    update(
      assignments.map((a) =>
        a.departmentId === departmentId ? { ...a, ...patch } : a
      )
    );

  return (
    <SectionCard
      title="Departments on this project"
      description="Pick the contributing departments, then set each one's lead and reporting duty."
      action={
        <Button variant="outline" size="sm" asChild>
          <Link
            href={withProjectContext("/departments/new", {
              ...context,
              sourceType: "project",
              parentId: context.projectId,
            })}
          >
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add Department
          </Link>
        </Button>
      }
    >
      <div className="space-y-1.5">
        <Label htmlFor="setup-departments">Departments</Label>
        <ManagedMultiSelect
          kind="department"
          value={selectedIds}
          onChange={handleSelectionChange}
          placeholder="Select departments…"
          controlProps={{ id: "setup-departments" }}
        />
      </div>

      {assignments.length === 0 ? (
        <EmptyState
          title="No departments selected"
          description="Choose at least one department to continue."
          className="py-8"
        />
      ) : (
        <ul className="mt-4 space-y-2">
          {assignments.map((assignment) => (
            <li key={assignment.departmentId}>
              <LinkedRecordRow
                kind="department"
                id={assignment.departmentId}
                name={departmentName(assignment.departmentId)}
                context={context}
                onRemove={() =>
                  update(
                    assignments.filter(
                      (a) => a.departmentId !== assignment.departmentId
                    )
                  )
                }
              >
                <div className="flex flex-wrap items-center gap-4">
                  <div className="space-y-1">
                    <Label
                      htmlFor={`lead-${assignment.departmentId}`}
                      className="text-xs text-muted-foreground"
                    >
                      Department lead
                    </Label>
                    <Input
                      id={`lead-${assignment.departmentId}`}
                      value={assignment.leadName ?? ""}
                      placeholder="Lead name"
                      className="h-8 w-44"
                      onChange={(event) =>
                        patchAssignment(assignment.departmentId, {
                          leadName: event.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`reporting-${assignment.departmentId}`}
                      checked={assignment.reportingRequired}
                      onCheckedChange={(checked) =>
                        patchAssignment(assignment.departmentId, {
                          reportingRequired: checked,
                        })
                      }
                    />
                    <Label
                      htmlFor={`reporting-${assignment.departmentId}`}
                      className="font-normal"
                    >
                      Weekly input
                    </Label>
                  </div>
                </div>
              </LinkedRecordRow>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

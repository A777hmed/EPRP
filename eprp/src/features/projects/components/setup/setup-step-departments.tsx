"use client";

import * as React from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, SectionCard } from "@/components/shared";
import { ManagedMultiSelect } from "@/features/master-data";
import type { Department, DepartmentAssignment, Project } from "@/types";
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
  departments: Department[];
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
  departments,
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
            projectDescription: "",
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
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-4">
                    <p className="text-xs text-muted-foreground">
                      Department Manager is selected on the Contacts step and
                      applies to this project only.
                    </p>
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
                  <div className="space-y-1">
                    <Label
                      htmlFor={`description-${assignment.departmentId}`}
                      className="text-xs text-muted-foreground"
                    >
                      Department Scope in This Project (optional)
                    </Label>
                    <Textarea
                      id={`description-${assignment.departmentId}`}
                      value={assignment.projectDescription ?? ""}
                      rows={2}
                      placeholder={
                        departments.find(
                          (department) =>
                            department.id === assignment.departmentId
                        )?.description ??
                        "Add scope or notes specific to this project"
                      }
                      onChange={(event) =>
                        patchAssignment(assignment.departmentId, {
                          projectDescription: event.target.value,
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Leave blank to use the shared Department description.
                    </p>
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

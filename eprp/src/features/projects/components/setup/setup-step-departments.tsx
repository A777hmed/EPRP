"use client";

import * as React from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, SectionCard } from "@/components/shared";
import { ManagedMultiSelect } from "@/features/master-data";
import type { Department, DepartmentAssignment, Project } from "@/types";
import Link from "next/link";
import { Plus, ShieldCheck } from "lucide-react";

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
  /** 2C.3E: an archived project — no Add Department (it would link a new record to it). */
  readOnly?: boolean;
  /**
   * 13.9B Step 4: Project Setup is Controlled. Adding or removing a department
   * is then a governed structure request, never a direct edit: the step shows
   * its values read-only and its buttons open the request dialog.
   */
  governed?: {
    /** Departments with a structure request already awaiting approval. */
    pendingIds: ReadonlySet<string>;
    /** Project Setup authority on this project, project not archived. */
    canRequest: boolean;
    onRequestAdd: () => void;
    onRequestRemoval: (departmentId: string) => void;
  };
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
  readOnly = false,
  governed,
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
      description={
        governed
          ? "Project Setup is controlled, so departments are added or removed by request and take effect after approval."
          : "Pick the contributing departments from the list, then set each one's lead and reporting duty."
      }
      action={
        readOnly ? undefined : governed ? (
          governed.canRequest ? (
            <Button variant="outline" size="sm" onClick={governed.onRequestAdd}>
              <ShieldCheck data-icon="inline-start" aria-hidden="true" />
              Request department
            </Button>
          ) : undefined
        ) : (
          // A Master Data action, not a project-scope change: it creates a new
          // shared Department for every project. Picking an existing department
          // for THIS project is the selector below.
          <Button variant="ghost" size="sm" asChild>
            <Link
              href={withProjectContext("/departments/new", {
                ...context,
                sourceType: "project",
                parentId: context.projectId,
              })}
              title="Creates a new shared Department in Master Data (applies to every project), then returns here."
            >
              <Plus data-icon="inline-start" aria-hidden="true" />
              New Department in Master Data
            </Link>
          </Button>
        )
      }
    >
      {governed && (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-info/25 bg-info/[0.06] p-2.5 text-xs text-muted-foreground text-pretty">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden="true" />
          <span>
            Controlled project: use <b>Request removal</b> on a department, or <b>Request department</b>, to change
            which departments are in scope. The department stays as it is until another Project Control Admin or
            System Administrator approves. The shared Department record is never changed from here.
          </span>
        </p>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="setup-departments">Departments</Label>
        <ManagedMultiSelect
          kind="department"
          value={selectedIds}
          onChange={handleSelectionChange}
          placeholder="Select departments…"
          controlProps={{ id: "setup-departments" }}
          disabled={Boolean(governed)}
        />
        {!governed && !readOnly && (
          <p className="text-xs text-muted-foreground">
            Select existing departments to link them to this project. A department that does not exist yet is created
            in Master Data.
          </p>
        )}
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
                onRemove={
                  governed
                    ? undefined
                    : () =>
                        update(
                          assignments.filter(
                            (a) => a.departmentId !== assignment.departmentId
                          )
                        )
                }
                governedRemoval={
                  governed && governed.canRequest
                    ? {
                        pending: governed.pendingIds.has(assignment.departmentId),
                        onRequest: () => governed.onRequestRemoval(assignment.departmentId),
                      }
                    : undefined
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
                        disabled={Boolean(governed)}
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
                      disabled={Boolean(governed)}
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

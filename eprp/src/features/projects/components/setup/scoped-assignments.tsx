"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ASSIGNMENT_ROLE_META } from "@/lib/constants";
import { useMasterData } from "@/features/master-data";
import type { AssignmentRole, Discipline, Project } from "@/types";
import {
  addScopedAssignments,
  removeScopedAssignment,
  scopedAssignments,
  setScopedAssignment,
} from "../../assignment-rules";
import { useHierarchyTerms } from "../../use-hierarchy-terms";

const ASSIGNMENT_ROLES = Object.keys(ASSIGNMENT_ROLE_META) as AssignmentRole[];

export interface ScopedAssignmentsProps {
  project: Project;
  departmentId: string;
  contactId: string;
  contactLabel: string;
  onDraftChange: (patch: Partial<Project>) => void;
}

/**
 * One person's scope assignments within a department.
 *
 * A person may cover any number of scope items — Programs & Studies on
 * PSM/PSAIM projects, Disciplines elsewhere — and each one carries its own
 * Assignment Role. The same role on several items is normal, and so is a
 * different role on each. Only an exact duplicate (same item, same role) is
 * refused, which is why the add list hides items already held in the role
 * being added rather than erroring after the fact.
 *
 * Removing one assignment removes that row only: never the contact, never
 * their other assignments, never unrelated project data.
 */
export function ScopedAssignments({
  project,
  departmentId,
  contactId,
  contactLabel,
  onDraftChange,
}: ScopedAssignmentsProps) {
  const terms = useHierarchyTerms(project);
  const { records } = useMasterData("discipline");
  const [adding, setAdding] = React.useState(false);
  const [picked, setPicked] = React.useState<string[]>([]);
  const [bulkRole, setBulkRole] = React.useState<AssignmentRole>("team_member");

  const nameOf = React.useCallback(
    (id: string) =>
      (records as Discipline[]).find((record) => record.id === id)?.name ??
      "Unknown",
    [records]
  );

  const held = scopedAssignments(project, departmentId, contactId).filter(
    (assignment) => assignment.disciplineId
  );

  // Scope items this project brought into the department — the only ones that
  // may be assigned. Master data alone is not enough: the item has to be in
  // the project's scope.
  const inScope = (project.disciplines ?? []).filter(
    (link) => link.departmentId === departmentId
  );

  const heldInBulkRole = new Set(
    held
      .filter((assignment) => assignment.assignmentRole === bulkRole)
      .map((assignment) => assignment.disciplineId)
  );
  const addable = inScope.filter((link) => !heldInBulkRole.has(link.disciplineId));

  const systemIdFor = (disciplineId: string) =>
    inScope.find((link) => link.disciplineId === disciplineId)?.systemId;

  const commitAdd = () => {
    if (picked.length === 0) return;
    onDraftChange({
      team: addScopedAssignments(project, departmentId, contactId, picked, {
        assignmentRole: bulkRole,
        systemIdFor,
      }),
    });
    setPicked([]);
    setAdding(false);
  };

  return (
    <div className="rounded-lg bg-muted/40 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          {terms.plural} covered by {contactLabel}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setAdding((open) => !open)}
          aria-expanded={adding}
        >
          <Plus className="mr-1 size-3.5" />
          Add Scope Assignment
        </Button>
      </div>

      {held.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No {terms.pluralLower} assigned yet. This person is on the department
          but covers no specific scope.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {held.map((assignment) => {
            const id = assignment.disciplineId!;
            return (
              <li
                key={`${id}-${assignment.assignmentRole}`}
                className="flex flex-wrap items-center gap-2 rounded-md bg-background px-2 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  {nameOf(id)}
                </span>

                <Select
                  value={assignment.assignmentRole}
                  onValueChange={(value) =>
                    onDraftChange({
                      team: setScopedAssignment(
                        project,
                        departmentId,
                        contactId,
                        id,
                        { assignmentRole: value as AssignmentRole }
                      ),
                    })
                  }
                >
                  <SelectTrigger
                    className="h-7 w-48 text-xs"
                    aria-label={`Assignment Role for ${nameOf(id)}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSIGNMENT_ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {ASSIGNMENT_ROLE_META[role].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={id}
                  onValueChange={(value) =>
                    onDraftChange({
                      team: setScopedAssignment(
                        project,
                        departmentId,
                        contactId,
                        id,
                        { disciplineId: value, systemId: systemIdFor(value) }
                      ),
                    })
                  }
                >
                  <SelectTrigger
                    className="h-7 w-48 text-xs"
                    aria-label={`Change scope item for ${nameOf(id)}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {inScope.map((link) => (
                      <SelectItem
                        key={link.disciplineId}
                        value={link.disciplineId}
                      >
                        {nameOf(link.disciplineId)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Remove ${nameOf(id)} from ${contactLabel}`}
                  onClick={() =>
                    onDraftChange({
                      team: removeScopedAssignment(
                        project,
                        departmentId,
                        contactId,
                        id
                      ),
                    })
                  }
                >
                  <X className="size-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {adding && (
        <div className="space-y-2 rounded-md border bg-background p-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Assignment Role for the selection</Label>
            <Select
              value={bulkRole}
              onValueChange={(value) => {
                setBulkRole(value as AssignmentRole);
                setPicked([]);
              }}
            >
              <SelectTrigger className="h-7 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSIGNMENT_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {ASSIGNMENT_ROLE_META[role].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {addable.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Every {terms.singularLower} in this department is already assigned
              to {contactLabel} in that role.
            </p>
          ) : (
            <ul className="max-h-44 space-y-1 overflow-y-auto">
              {addable.map((link) => (
                <li key={link.disciplineId} className="flex items-center gap-2">
                  <Checkbox
                    id={`pick-${contactId}-${link.disciplineId}`}
                    checked={picked.includes(link.disciplineId)}
                    onCheckedChange={(checked) =>
                      setPicked((current) =>
                        checked
                          ? [...current, link.disciplineId]
                          : current.filter((id) => id !== link.disciplineId)
                      )
                    }
                  />
                  <Label
                    htmlFor={`pick-${contactId}-${link.disciplineId}`}
                    className="text-xs font-normal"
                  >
                    {nameOf(link.disciplineId)}
                  </Label>
                </li>
              ))}
            </ul>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setPicked([]);
                setAdding(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              disabled={picked.length === 0}
              onClick={commitAdd}
            >
              Assign {picked.length > 0 ? picked.length : ""}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

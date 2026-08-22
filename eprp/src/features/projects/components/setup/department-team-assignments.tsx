"use client";

import * as React from "react";
import { Trash2, UserCog } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, SectionCard, StatusBadge } from "@/components/shared";
import {
  ASSIGNMENT_ROLE_META,
  WEEKLY_DELEGABLE_RESPONSIBILITIES,
} from "@/lib/constants";
import type {
  AssignmentRole,
  Project,
  ProjectDelegation,
} from "@/types";
import {
  delegationStatus,
  delegationDateIssues,
  compareTeamDisplayOrder,
  departmentAssignments,
  departmentManager,
  managerConflict,
  eligibleDelegates,
  eligibleReportsTo,
  removeAssignment,
  setAssignment,
  validateDepartmentAssignments,
} from "../../assignment-rules";
import { ScopedAssignments } from "./scoped-assignments";

const ASSIGNMENT_ROLES = Object.keys(ASSIGNMENT_ROLE_META) as AssignmentRole[];

const STATUS_TONE: Record<
  ReturnType<typeof delegationStatus>,
  { label: string; tone: "success" | "info" | "neutral" | "warning" }
> = {
  active: { label: "Acting / Delegated Manager", tone: "success" },
  scheduled: { label: "Scheduled", tone: "info" },
  expired: { label: "Expired", tone: "neutral" },
  revoked: { label: "Revoked", tone: "warning" },
};

/** "Not set" sentinel — Radix Select cannot hold an empty string value. */
const NONE = "__none__";

export interface DepartmentTeamAssignmentsProps {
  project: Project;
  departmentId: string;
  departmentName: string;
  contactName: (id: string) => string;
  onDraftChange: (patch: Partial<Project>) => void;
}

/**
 * Project-specific team structure for one department: assignment role,
 * functional responsibility title, reporting line, and Weekly delegation.
 *
 * Everything is stored on the existing `project.team` link rows plus
 * `project.delegations`; no new hierarchy level and no parallel record. The
 * step's existing Save writes them with the rest of the draft.
 */
export function DepartmentTeamAssignments({
  project,
  departmentId,
  departmentName,
  contactName,
  onDraftChange,
}: DepartmentTeamAssignmentsProps) {
  const today = new Date().toISOString().slice(0, 10);
  const entries = [...departmentAssignments(project, departmentId)].sort(
    (left, right) => compareTeamDisplayOrder(left, right, contactName)
  );
  const manager = departmentManager(project, departmentId);
  const issues = validateDepartmentAssignments(project, departmentId);
  const departmentIssues = issues.filter((issue) => !issue.contactId);
  const delegations = (project.delegations ?? []).filter(
    (delegation) => delegation.departmentId === departmentId
  );

  if (entries.length === 0) {
    return (
      <EmptyState
        title="No one assigned to this department yet"
        description="Add people above, then set their role in this project."
        className="py-6"
      />
    );
  }

  const update = (
    contactId: string,
    patch: Parameters<typeof setAssignment>[3]
  ) => {
    /*
     * This is the person-level control, so promoting here is a deliberate
     * "this person now runs the department" action: `setAssignment` seats them
     * and demotes the incumbent to Team Member, never leaving two managers and
     * never removing anyone. Say who was demoted — the department keeps
     * exactly one manager either way, but the user should not have to notice
     * the change by reading the list afterwards.
     */
    if (patch.assignmentRole === "department_manager") {
      const incumbent = managerConflict(project, departmentId, contactId);
      if (incumbent) {
        toast.info(
          `${contactName(incumbent.contactId)} is no longer Department Manager and stays on the team as a Team Member. A department has exactly one manager.`
        );
      }
    }

    onDraftChange({
      team: setAssignment(project, departmentId, contactId, patch),
    });
  };

  const setDelegations = (next: ProjectDelegation[]) =>
    onDraftChange({
      delegations: [
        ...(project.delegations ?? []).filter(
          (delegation) => delegation.departmentId !== departmentId
        ),
        ...next,
      ],
    });

  const addDelegation = () => {
    const candidate = eligibleDelegates(project, departmentId)[0];
    if (!candidate) return;
    const end = new Date();
    end.setDate(end.getDate() + 7);
    setDelegations([
      ...delegations,
      {
        departmentId,
        delegateContactId: candidate.contactId,
        responsibilities: ["review_submissions"],
        startDate: today,
        endDate: end.toISOString().slice(0, 10),
        active: true,
      },
    ]);
  };

  const patchDelegation = (index: number, patch: Partial<ProjectDelegation>) =>
    setDelegations(
      delegations.map((delegation, i) =>
        i === index ? { ...delegation, ...patch } : delegation
      )
    );

  return (
    <div className="space-y-4">
      <SectionCard
        title={`${departmentName} — team roles`}
        description="Project-specific roles. A functional title is a label only; it grants no permissions."
      >
        {departmentIssues.length > 0 && (
          <ul
            role="alert"
            data-assignment-errors="department"
            className="mb-3 space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
          >
            {departmentIssues.map((issue) => (
              <li key={issue.message} className="text-sm text-destructive text-pretty">
                {issue.message}
              </li>
            ))}
          </ul>
        )}

        <ul className="space-y-2">
          {entries.map((entry) => {
            const reportsToOptions = eligibleReportsTo(
              project,
              departmentId,
              entry.contactId
            );
            const isManager = entry.assignmentRole === "department_manager";
            const entryIssues = issues.filter(
              (issue) => issue.contactId === entry.contactId
            );
            return (
              <li
                key={entry.contactId}
                className="rounded-lg border p-3 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {contactName(entry.contactId)}
                    {entry.functionalTitle && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {entry.functionalTitle}
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-2">
                    <StatusBadge tone={isManager ? "info" : "neutral"}>
                      {ASSIGNMENT_ROLE_META[entry.assignmentRole].label}
                    </StatusBadge>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${contactName(entry.contactId)} from ${departmentName}`}
                      title="Remove from this department (the person record is kept)"
                      onClick={() =>
                        onDraftChange({
                          team: removeAssignment(
                            project,
                            departmentId,
                            entry.contactId
                          ),
                        })
                      }
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </div>

                <ScopedAssignments
                  project={project}
                  departmentId={departmentId}
                  contactId={entry.contactId}
                  contactLabel={contactName(entry.contactId)}
                  onDraftChange={onDraftChange}
                />

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    {/* Person-level: setAssignment writes across every scope
                        item they hold, and carries the manager-demotion and
                        reporting-line repair rules. The per-scope-item selects
                        above override it individually, so the label has to say
                        which one this is. */}
                    <Label htmlFor={`role-${entry.contactId}`}>
                      Overall Role
                      <span className="ml-1 font-normal text-muted-foreground">
                        (sets every scope item)
                      </span>
                    </Label>
                    <Select
                      value={entry.assignmentRole}
                      onValueChange={(value) =>
                        update(entry.contactId, {
                          assignmentRole: value as AssignmentRole,
                        })
                      }
                    >
                      <SelectTrigger
                        id={`role-${entry.contactId}`}
                        className="w-full"
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
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`title-${entry.contactId}`}>
                      Functional Responsibility Title
                    </Label>
                    <Input
                      id={`title-${entry.contactId}`}
                      value={entry.functionalTitle ?? ""}
                      placeholder="e.g. RBI Lead, Element 10 Owner"
                      onChange={(event) =>
                        update(entry.contactId, {
                          functionalTitle: event.target.value || undefined,
                        })
                      }
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`reports-${entry.contactId}`}>
                      Reports To
                    </Label>
                    <Select
                      value={entry.reportsToContactId ?? NONE}
                      onValueChange={(value) =>
                        update(entry.contactId, {
                          reportsToContactId: value === NONE ? undefined : value,
                        })
                      }
                      disabled={isManager || reportsToOptions.length === 0}
                    >
                      <SelectTrigger
                        id={`reports-${entry.contactId}`}
                        className="w-full"
                        aria-invalid={entryIssues.length > 0 || undefined}
                      >
                        <SelectValue
                          placeholder={
                            isManager ? "Department Manager" : "Not set"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Not set</SelectItem>
                        {reportsToOptions.map((option) => (
                          <SelectItem
                            key={option.contactId}
                            value={option.contactId}
                          >
                            {contactName(option.contactId)}
                            <span className="ml-1 text-xs text-muted-foreground">
                              {ASSIGNMENT_ROLE_META[option.assignmentRole].label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {entryIssues.length > 0 && (
                  <ul role="alert" data-assignment-errors={entry.contactId}>
                    {entryIssues.map((issue) => (
                      <li
                        key={issue.message}
                        className="text-sm text-destructive text-pretty"
                      >
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </SectionCard>

      <SectionCard
        title="Weekly delegation"
        description="Temporarily hand selected Weekly responsibilities to a lead or member. The Department Manager stays assigned and visible."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={addDelegation}
            disabled={!manager || eligibleDelegates(project, departmentId).length === 0}
            title={
              manager
                ? undefined
                : "Assign a Department Manager before delegating"
            }
          >
            <UserCog data-icon="inline-start" aria-hidden="true" />
            Delegate
          </Button>
        }
      >
        {!manager && (
          <p className="text-sm text-muted-foreground">
            No Department Manager assigned yet — only the manager can delegate
            Weekly responsibilities.
          </p>
        )}

        {manager && delegations.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {contactName(manager.contactId)} holds all Weekly responsibilities
            for this department.
          </p>
        )}

        {delegations.length > 0 && (
          <ul className="space-y-2">
            {delegations.map((delegation, index) => {
              const status = delegationStatus(delegation, today);
              const meta = STATUS_TONE[status];
              const dateIssues = delegationDateIssues(delegation, today);
              return (
                <li
                  key={delegation.id ?? `${delegation.delegateContactId}-${index}`}
                  className="rounded-lg border p-3 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {contactName(delegation.delegateContactId)}
                    </p>
                    <div className="flex items-center gap-2">
                      <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          patchDelegation(index, { active: false })
                        }
                        disabled={!delegation.active}
                      >
                        Revoke
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`delegate-${index}`}>Delegate</Label>
                      <Select
                        value={delegation.delegateContactId}
                        onValueChange={(value) =>
                          patchDelegation(index, { delegateContactId: value })
                        }
                      >
                        <SelectTrigger id={`delegate-${index}`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {eligibleDelegates(project, departmentId).map(
                            (candidate) => (
                              <SelectItem
                                key={candidate.contactId}
                                value={candidate.contactId}
                              >
                                {contactName(candidate.contactId)}
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`from-${index}`}>Start date</Label>
                      <Input
                        id={`from-${index}`}
                        type="date"
                        min={delegation.id ? undefined : today}
                        value={delegation.startDate}
                        aria-invalid={dateIssues.length > 0 || undefined}
                        onChange={(event) => {
                          const startDate = event.target.value;
                          patchDelegation(index, {
                            startDate,
                            ...(delegation.endDate &&
                            delegation.endDate < startDate
                              ? { endDate: "" }
                              : {}),
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`to-${index}`}>End date</Label>
                      <Input
                        id={`to-${index}`}
                        type="date"
                        min={delegation.startDate}
                        value={delegation.endDate}
                        aria-invalid={dateIssues.length > 0 || undefined}
                        onChange={(event) =>
                          patchDelegation(index, { endDate: event.target.value })
                        }
                      />
                    </div>
                  </div>

                  {dateIssues.length > 0 && (
                    <ul
                      role="alert"
                      className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-2"
                    >
                      {dateIssues.map((message) => (
                        <li key={message} className="text-sm text-destructive">
                          {message}
                        </li>
                      ))}
                    </ul>
                  )}

                  <fieldset className="space-y-1.5">
                    <legend className="text-sm font-medium">
                      Delegated responsibilities
                    </legend>
                    <div className="flex flex-wrap gap-4">
                      {WEEKLY_DELEGABLE_RESPONSIBILITIES.map((responsibility) => {
                        const checked = delegation.responsibilities.includes(
                          responsibility.key
                        );
                        return (
                          <div
                            key={responsibility.key}
                            className="flex items-center gap-2"
                          >
                            <Checkbox
                              id={`${responsibility.key}-${index}`}
                              checked={checked}
                              onCheckedChange={(value) =>
                                patchDelegation(index, {
                                  responsibilities: value
                                    ? [
                                        ...delegation.responsibilities,
                                        responsibility.key,
                                      ]
                                    : delegation.responsibilities.filter(
                                        (key) => key !== responsibility.key
                                      ),
                                })
                              }
                            />
                            <Label
                              htmlFor={`${responsibility.key}-${index}`}
                              className="font-normal"
                            >
                              {responsibility.label}
                            </Label>
                          </div>
                        );
                      })}
                    </div>
                  </fieldset>

                  <div className="space-y-1.5">
                    <Label htmlFor={`note-${index}`}>Note (optional)</Label>
                    <Textarea
                      id={`note-${index}`}
                      rows={2}
                      value={delegation.note ?? ""}
                      placeholder="Why this delegation is in place"
                      onChange={(event) =>
                        patchDelegation(index, {
                          note: event.target.value || undefined,
                        })
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

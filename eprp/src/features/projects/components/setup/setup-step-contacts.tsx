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
import {
  ManagedMultiSelect,
  ManagedPersonSelect,
  MasterDataDialog,
} from "@/features/master-data";
import type {
  Contact,
  Discipline,
  MasterRecordBase,
  Project,
  ProjectTeamMember,
} from "@/types";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { type ProjectLinkContext } from "../../project-link-context";
import type { HierarchyTerms } from "@/config/project-terminology";
import {
  compareTeamDisplayOrder,
  departmentManager,
  managerConflict,
  projectTeamPeople,
  removeScopedAssignment,
  setAssignment,
} from "../../assignment-rules";
import { DepartmentTeamAssignments } from "./department-team-assignments";
import { LinkedRecordRow } from "./linked-record-row";

export interface SetupStepContactsProps {
  /** Hierarchy wording — display only. */
  terms: HierarchyTerms;
  project: Project;
  context: ProjectLinkContext;
  contacts: Contact[];
  disciplines: Discipline[];
  departmentName: (id: string) => string;
  onDraftChange: (patch: Partial<Project>) => void;
  initialDisciplineId?: string;
}

/**
 * Step 5 — build the project team, scoped to a department and discipline.
 *
 * Choosing a discipline fixes the Project assignment scope. Team Members may
 * come from another home Department; the assignment remains explicit and the
 * Person record is never moved.
 *
 * "Add Contact" creates a Person without leaving the step, using the same
 * shared dialog the pickers below open from "Add new person". It deliberately
 * does NOT select the new Person anywhere: creating someone in the People
 * master list and giving them a role on this project are separate decisions,
 * and the pickers refresh from the shared store on their own, so the new
 * Person is immediately available to choose. Navigating to /contacts/new
 * instead dropped the project sidebar and needed a save-and-return round trip.
 */
export function SetupStepContacts({
  project,
  context,
  contacts,
  disciplines,
  departmentName,
  onDraftChange,
  initialDisciplineId,
  terms,
}: SetupStepContactsProps) {
  const team = React.useMemo(() => project.team ?? [], [project.team]);

  // Disciplines actually linked to this project, with their department.
  const projectDisciplines = React.useMemo(() => {
    const seen = new Map<string, { id: string; departmentId: string }>();
    for (const link of project.disciplines ?? []) {
      if (!seen.has(link.disciplineId)) {
        seen.set(link.disciplineId, {
          id: link.disciplineId,
          departmentId: link.departmentId ?? "",
        });
      }
    }
    return [...seen.values()];
  }, [project.disciplines]);

  const [disciplineId, setDisciplineId] = React.useState(
    () =>
      projectDisciplines.some(
        (discipline) => discipline.id === initialDisciplineId
      )
        ? (initialDisciplineId ?? "")
        : (projectDisciplines[0]?.id ?? "")
  );
  const [addPersonOpen, setAddPersonOpen] = React.useState(false);
  const activeDiscipline = projectDisciplines.find(
    (discipline) => discipline.id === disciplineId
  );
  const activeDepartmentId = activeDiscipline?.departmentId ?? "";

  const teamForDiscipline = team.filter(
    (member) => member.disciplineId === disciplineId
  );
  const activeManager = departmentManager(project, activeDepartmentId);

  const setDepartmentManager = (contactId: string) => {
    // Exactly one manager per department: `setAssignment` seats the new one and
    // demotes the incumbent to Team Member, keeping them on the team with
    // their scope assignments intact. Name them so the swap is never silent.
    const incumbent = managerConflict(project, activeDepartmentId, contactId);
    if (incumbent) {
      toast.info(
        `${contactName(incumbent.contactId)} is no longer Department Manager and stays on the team as a Team Member. A department has exactly one manager.`
      );
    }

    const alreadyAssigned = team.some(
      (member) =>
        member.departmentId === activeDepartmentId &&
        member.contactId === contactId
    );
    const nextTeam: ProjectTeamMember[] = alreadyAssigned
      ? team
      : [
          ...team,
          {
            contactId,
            disciplineId,
            departmentId: activeDepartmentId,
            assignmentRole: "team_member",
          },
        ];

    onDraftChange({
      team: setAssignment(
        { ...project, team: nextTeam },
        activeDepartmentId,
        contactId,
        { assignmentRole: "department_manager" }
      ),
    });
  };

  const setForDiscipline = (ids: string[]) => {
    const others = team.filter((member) => member.disciplineId !== disciplineId);
    const managerRows = team.filter(
      (member) =>
        member.disciplineId === disciplineId &&
        member.assignmentRole === "department_manager"
    );

    // Rebuilding every row from the picker used to discard the assignment role,
    // functional title and reporting line of people who were already selected,
    // so an unrelated tick in this list silently wiped their assignment.
    const existing = new Map(
      team
        .filter((member) => member.disciplineId === disciplineId)
        .map((member) => [member.contactId, member])
    );
    // The same person may already be assigned in this department under another
    // discipline; a second row has to carry the same assignment, not a blank one.
    const inDepartment = new Map(
      team
        .filter((member) => member.departmentId === activeDepartmentId)
        .map((member) => [member.contactId, member])
    );
    const manager = departmentManager(project, activeDepartmentId);

    const next: ProjectTeamMember[] = ids
      .filter((contactId) => contactId !== activeManager?.contactId)
      .map((contactId) => {
      const kept = existing.get(contactId);
      if (kept) return kept;
      const sibling = inDepartment.get(contactId);
      return {
        contactId,
        disciplineId,
        departmentId: activeDepartmentId,
        assignmentRole: sibling?.assignmentRole,
        functionalTitle: sibling?.functionalTitle,
        // Reports To is required for everyone below the manager, so default to
        // the department's manager rather than adding an invalid assignment.
        reportsToContactId: sibling?.reportsToContactId ?? manager?.contactId,
      };
    });
    onDraftChange({ team: [...others, ...managerRows, ...next] });
  };

  const contactName = (id: string) =>
    contacts.find((contact) => contact.id === id)?.name ?? id;
  /*
   * `assignmentDepartmentIds` is every department this project assigns the
   * person into — a person may hold scope in more than one. Their Home
   * Department comes from the Person record and is never rewritten by an
   * assignment, so the two disagreeing is exactly the cross-department case
   * rather than a defect.
   */
  const contactMeta = (id: string, assignmentDepartmentIds: string[] = []) => {
    const contact = contacts.find((candidate) => candidate.id === id);
    const homeDepartment = contact?.departmentId
      ? departmentName(contact.departmentId)
      : "Not assigned";
    const crossDepartment =
      Boolean(contact?.departmentId) &&
      assignmentDepartmentIds.length > 0 &&
      !assignmentDepartmentIds.includes(contact!.departmentId!);
    return [
      contact?.position,
      contact?.email,
      `Home Department: ${homeDepartment}${
        crossDepartment ? " · Cross-department assignment" : ""
      }`,
    ]
      .filter(Boolean)
      .join(" · ");
  };

  /**
   * Drop ONE scope assignment. `removeScopedAssignment` also repairs reporting
   * lines, but it matches on department; a legacy row saved without one is
   * removed by identity instead so it stays removable.
   */
  const removeAssignmentRow = (
    contactId: string,
    row: ProjectTeamMember
  ): ProjectTeamMember[] =>
    row.departmentId
      ? removeScopedAssignment(
          project,
          row.departmentId,
          contactId,
          row.disciplineId
        )
      : team.filter(
          (candidate) =>
            !(
              candidate.contactId === contactId &&
              candidate.departmentId === undefined &&
              (candidate.disciplineId ?? undefined) ===
                (row.disciplineId ?? undefined)
            )
        );
  const disciplineName = (id: string) =>
    disciplines.find((discipline) => discipline.id === id)?.name ?? id;

  /*
   * Home Department for a Person created here, taken from the department that
   * owns the selected scope item. Only preset when that actually resolves —
   * otherwise the dialog opens blank and the user chooses, as the global page
   * does. A Home Department is a property of the Person, not a project role.
   */
  const createPresetValues = activeDepartmentId
    ? { departmentId: activeDepartmentId }
    : undefined;

  // Departments that actually have people on them — assignment roles are per
  // department, while the picker above works per discipline.
  const staffedDepartmentIds = React.useMemo(
    () => [
      ...new Set(
        team
          .map((member) => member.departmentId)
          .filter((id): id is string => Boolean(id))
      ),
    ],
    [team]
  );

  if (projectDisciplines.length === 0) {
    return (
      <SectionCard title="Contacts">
        <EmptyState
          title={`No ${terms.pluralLower} yet`}
          description={`Link ${terms.pluralLower} to systems before assigning the team.`}
          className="py-8"
        />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title="Assign the project team"
        description={`The Department Manager belongs to the selected Department. Team Members may be assigned explicitly from any home Department without changing their Person record.`}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddPersonOpen(true)}
          >
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add Contact
          </Button>
        }
      >
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="setup-discipline">{terms.singular}</Label>
            <Select value={disciplineId} onValueChange={setDisciplineId}>
              <SelectTrigger id="setup-discipline" className="w-full">
                <SelectValue placeholder={`Select a ${terms.singularLower}`} />
              </SelectTrigger>
              <SelectContent>
                {projectDisciplines.map((discipline) => (
                  <SelectItem key={discipline.id} value={discipline.id}>
                    {disciplineName(discipline.id)}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {departmentName(discipline.departmentId)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="setup-department-manager">
              Department Manager
            </Label>
            <ManagedPersonSelect
              value={activeManager?.contactId ?? ""}
              onChange={setDepartmentManager}
              filter={(record: MasterRecordBase) =>
                (record as Contact).departmentId === activeDepartmentId
              }
              placeholder="Select department manager…"
              searchPlaceholder="Search department contacts…"
              emptyLabel="No contacts belong to this department yet."
              clearable={false}
              controlProps={{ id: "setup-department-manager" }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="setup-team-members">Team Members</Label>
            <ManagedMultiSelect
              kind="contact"
              value={teamForDiscipline
                .filter(
                  (member) =>
                    member.assignmentRole !== "department_manager"
                )
                .map((member) => member.contactId)}
              onChange={setForDiscipline}
              filter={(record: MasterRecordBase) =>
                record.id !== activeManager?.contactId
              }
              /* Cross-department people stay in the SAME list — assigning one
                 is legal and creates only a project scope assignment — but the
                 headings make it obvious which side of the line someone is on
                 before they are picked. Their Person record and Home
                 Department are untouched either way. */
              optionGroup={(record: MasterRecordBase) =>
                (record as Contact).departmentId === activeDepartmentId
                  ? "Same Department"
                  : "Cross-Department"
              }
              optionGroupOrder={["Same Department", "Cross-Department"]}
              optionSublabel={(record: MasterRecordBase) => {
                const contact = record as Contact;
                const homeDepartment = contact.departmentId
                  ? departmentName(contact.departmentId)
                  : "Not assigned";
                return `${contact.position ? `${contact.position} · ` : ""}Home: ${homeDepartment}${
                  contact.departmentId &&
                  contact.departmentId !== activeDepartmentId
                    ? " · Cross-department"
                    : ""
                }`;
              }}
              emptyLabel="No people are available."
              placeholder="Select people…"
              controlProps={{ id: "setup-team-members" }}
            />
            <p className="text-xs text-muted-foreground">
              Selecting someone from another home Department adds only this
              Project scope assignment; it does not move or duplicate the
              Person.
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Project team"
        description={`One row per person. Someone covering several ${terms.pluralLower} holds several assignments — they are listed together, not repeated as separate people.`}
      >
        {team.length === 0 ? (
          <EmptyState
            title="No team members yet"
            description={`Pick a ${terms.singularLower} above, then choose the people working on it.`}
            className="py-8"
          />
        ) : (
          <ul className="space-y-2">
            {projectTeamPeople(project)
              .sort((left, right) =>
                compareTeamDisplayOrder(left, right, contactName)
              )
              .map((person) => (
                <li key={person.contactId}>
                  <LinkedRecordRow
                    kind="contact"
                    id={person.contactId}
                    name={contactName(person.contactId)}
                    meta={contactMeta(person.contactId, person.departmentIds)}
                    context={context}
                  >
                    {/* Each scope assignment is removable on its own. Removing
                        one leaves the person and their other assignments in
                        place — the Person record is never touched. */}
                    <ul className="flex min-w-0 flex-wrap items-center gap-1.5">
                      {person.rows.map((row) => (
                        <li
                          key={`${row.departmentId ?? ""}-${row.disciplineId ?? ""}`}
                          className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
                        >
                          <span className="truncate">
                            {row.disciplineId
                              ? disciplineName(row.disciplineId)
                              : "No scope item"}
                            <span className="ml-1 text-muted-foreground">
                              {departmentName(row.departmentId ?? "")}
                            </span>
                          </span>
                          <button
                            type="button"
                            className="rounded-sm text-muted-foreground hover:text-foreground"
                            aria-label={`Remove ${
                              row.disciplineId
                                ? disciplineName(row.disciplineId)
                                : "assignment"
                            } from ${contactName(person.contactId)}`}
                            onClick={() =>
                              onDraftChange({
                                team: removeAssignmentRow(
                                  person.contactId,
                                  row
                                ),
                              })
                            }
                          >
                            <X className="size-3" aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </LinkedRecordRow>
                </li>
              ))}
          </ul>
        )}
      </SectionCard>

      {/* Assignment roles, reporting line and Weekly delegation are per
          department, so they follow the discipline-scoped picker above. */}
      {staffedDepartmentIds.map((id) => (
        <DepartmentTeamAssignments
          key={id}
          project={project}
          departmentId={id}
          departmentName={departmentName(id)}
          contactName={contactName}
          onDraftChange={onDraftChange}
        />
      ))}

      {/* No `onCreated`: the Person joins the shared People list and becomes
          selectable in the pickers above, but is given no Department Manager
          seat, Team Member row, or any other project assignment. */}
      <MasterDataDialog
        kind="contact"
        open={addPersonOpen}
        onOpenChange={setAddPersonOpen}
        initialMode="create"
        presetValues={createPresetValues}
      />
    </div>
  );
}

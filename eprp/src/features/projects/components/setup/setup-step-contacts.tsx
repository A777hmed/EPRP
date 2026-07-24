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
  Contact,
  Discipline,
  MasterRecordBase,
  Project,
  ProjectTeamMember,
} from "@/types";
import Link from "next/link";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  withProjectContext,
  type ProjectLinkContext,
} from "../../project-link-context";
import { LinkedRecordRow } from "./linked-record-row";

export interface SetupStepContactsProps {
  project: Project;
  context: ProjectLinkContext;
  contacts: Contact[];
  disciplines: Discipline[];
  departmentName: (id: string) => string;
  onDraftChange: (patch: Partial<Project>) => void;
}

/**
 * Step 5 — build the project team, scoped to a department and discipline.
 *
 * Choosing a discipline narrows the contact list to that discipline's
 * department, so a person is only ever linked where they actually work.
 */
export function SetupStepContacts({
  project,
  context,
  contacts,
  disciplines,
  departmentName,
  onDraftChange,
}: SetupStepContactsProps) {
  const team = project.team ?? [];

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
    () => projectDisciplines[0]?.id ?? ""
  );
  const activeDiscipline = projectDisciplines.find(
    (discipline) => discipline.id === disciplineId
  );
  const activeDepartmentId = activeDiscipline?.departmentId ?? "";

  const teamForDiscipline = team.filter(
    (member) => member.disciplineId === disciplineId
  );

  const setForDiscipline = (ids: string[]) => {
    const others = team.filter((member) => member.disciplineId !== disciplineId);
    const next: ProjectTeamMember[] = ids.map((contactId) => ({
      contactId,
      disciplineId,
      departmentId: activeDepartmentId,
    }));
    onDraftChange({ team: [...others, ...next] });
  };

  const contactName = (id: string) =>
    contacts.find((contact) => contact.id === id)?.name ?? id;
  const contactMeta = (id: string) => {
    const contact = contacts.find((candidate) => candidate.id === id);
    return [contact?.position, contact?.email].filter(Boolean).join(" · ");
  };
  const disciplineName = (id: string) =>
    disciplines.find((discipline) => discipline.id === id)?.name ?? id;

  if (projectDisciplines.length === 0) {
    return (
      <SectionCard title="Contacts">
        <EmptyState
          title="No disciplines yet"
          description="Link disciplines to systems before assigning the team."
          className="py-8"
        />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title="Assign the project team"
        description="Contacts are offered from the department behind the selected discipline."
        action={
          <Button variant="outline" size="sm" asChild>
            <Link
              href={withProjectContext("/contacts/new", {
                ...context,
                sourceType: "discipline",
                parentId: disciplineId,
              })}
            >
              <Plus data-icon="inline-start" aria-hidden="true" />
              Add Contact
            </Link>
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="setup-discipline">Discipline</Label>
            <Select value={disciplineId} onValueChange={setDisciplineId}>
              <SelectTrigger id="setup-discipline" className="w-full">
                <SelectValue placeholder="Select a discipline" />
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
            <Label htmlFor="setup-contacts">Team members</Label>
            <ManagedMultiSelect
              kind="contact"
              value={teamForDiscipline.map((member) => member.contactId)}
              onChange={setForDiscipline}
              filter={(record: MasterRecordBase) =>
                (record as Contact).departmentId === activeDepartmentId
              }
              emptyLabel="No contacts belong to this discipline's department."
              placeholder="Select people…"
              controlProps={{ id: "setup-contacts" }}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Project team"
        description="Everyone linked to this project, grouped by discipline."
      >
        {team.length === 0 ? (
          <EmptyState
            title="No team members yet"
            description="Pick a discipline above, then choose the people working on it."
            className="py-8"
          />
        ) : (
          <ul className="space-y-4">
            {projectDisciplines
              .filter((discipline) =>
                team.some((member) => member.disciplineId === discipline.id)
              )
              .map((discipline) => (
                <li key={discipline.id}>
                  <p className="text-xs text-muted-foreground">
                    {disciplineName(discipline.id)} ·{" "}
                    {departmentName(discipline.departmentId)}
                  </p>
                  <ul className="mt-1 space-y-2">
                    {team
                      .filter((member) => member.disciplineId === discipline.id)
                      .map((member) => (
                        <li key={`${discipline.id}-${member.contactId}`}>
                          <LinkedRecordRow
                            kind="contact"
                            id={member.contactId}
                            name={contactName(member.contactId)}
                            meta={contactMeta(member.contactId)}
                            context={context}
                            onRemove={() =>
                              onDraftChange({
                                team: team.filter(
                                  (candidate) =>
                                    !(
                                      candidate.disciplineId ===
                                        discipline.id &&
                                      candidate.contactId === member.contactId
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

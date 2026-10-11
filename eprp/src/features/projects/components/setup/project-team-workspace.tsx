"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, PenLine, Plus, UserMinus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog, EmptyState, SectionCard, StatusBadge } from "@/components/shared";
import { projectWorkflowHref } from "@/config/project-workflow";
import { MasterRecordEditButton } from "@/features/master-data";
import { projectTeamService, type MemberWriteResult } from "@/services/project-team-service";
import type { Contact, Project, ProjectMember } from "@/types";
import {
  activeMembers,
  leadershipGroups,
  leadershipRolesOf,
  memberNeedsProjectRole,
  partyLabel,
  teamSections,
  teamWarnings,
  type TeamSection,
} from "../../project-team";
import { ProjectTeamMemberDialog } from "./project-team-member-dialog";

export interface ProjectTeamWorkspaceProps {
  /** The SAVED project (its version, parties and memberships). */
  project: Project;
  contacts: Contact[];
  clientName?: string;
  /** Project Responsibility authority on this project, and not archived. */
  canManage: boolean;
  /** May edit the global People master (System Admin / Project Control Admin). */
  canEditPeople: boolean;
  /** Reload the project after a membership write advanced its version. */
  onProjectChanged: () => void;
}

/**
 * Project Team (Phase 2C.3C) — the Contacts step's team, identical for PSM
 * and Other projects: the existing fixed roles as Leadership & Governance and
 * Controls & Coordination, then one team per Project Party.
 *
 * Membership is AUTHORITY-FREE and saved immediately, one person at a time.
 * Legacy members needing a Party or Project Role, and members without a
 * Reports To, are WARNINGS — they never block this step.
 */
export function ProjectTeamWorkspace({
  project,
  contacts,
  clientName,
  canManage,
  canEditPeople,
  onProjectChanged,
}: ProjectTeamWorkspaceProps) {
  const [dialog, setDialog] = React.useState<{ member?: ProjectMember; partyId?: string } | null>(null);
  const [ending, setEnding] = React.useState<ProjectMember | null>(null);
  // A write returns the project's next version; until the reloaded project
  // reaches it, further writes would only be refused as stale.
  const [pendingVersion, setPendingVersion] = React.useState<string | null>(null);
  const busy = pendingVersion !== null && Date.parse(project.updatedAt) < Date.parse(pendingVersion);
  const editable = canManage && !busy;

  const contactOf = (contactId: string) => contacts.find((contact) => contact.id === contactId);
  const nameOf = (contactId: string) => contactOf(contactId)?.name ?? "Unknown person";
  const members = project.members;
  const memberById = new Map((members ?? []).map((member) => [member.id, member]));
  const partyById = new Map((project.parties ?? []).filter((party) => party.id).map((party) => [party.id!, party]));

  const accept = (result: MemberWriteResult) => {
    setPendingVersion(result.version);
    onProjectChanged();
  };

  const endMembership = async () => {
    if (!ending) return;
    try {
      accept(await projectTeamService.endMember({ projectId: project.id, version: project.updatedAt, memberId: ending.id }));
      toast.success(`${nameOf(ending.contactId)} is no longer on the project team`);
      setEnding(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The membership could not be ended.");
    }
  };

  if (!members) {
    return (
      <SectionCard title="Project Team">
        <EmptyState
          title="Project team membership is not available yet"
          description="The project team needs a database update. Contact your administrator."
          className="py-8"
        />
      </SectionCard>
    );
  }

  const warnings = teamWarnings(project);
  const sections = teamSections(project);
  const ended = members.filter((member) => member.endedAt);
  const activeByContact = new Map(activeMembers(members).map((member) => [member.contactId, member]));

  return (
    <div className="space-y-4">
      <SectionCard
        title="Project Team"
        description="Who works on this project and which party they represent. Membership describes the team; it grants no access."
        action={canManage ? (
          <Button size="sm" onClick={() => setDialog({})} disabled={!editable}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add team member
          </Button>
        ) : undefined}
      >
        <div className="space-y-4">
          {warnings.messages.length > 0 && (
            <div role="status" aria-label="Team warnings"
              className="flex flex-wrap items-start gap-x-4 gap-y-1 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {warnings.messages.map((message) => <span key={message}>{message}</span>)}
              <span className="text-muted-foreground">Warnings only — they do not block setup.</span>
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            {leadershipGroups(project).map((group) => (
              <section key={group.key} aria-labelledby={`team-${group.key}`} className="rounded-lg border p-3">
                <h3 id={`team-${group.key}`} className="mb-2 text-sm font-semibold">{group.title}</h3>
                <dl className="space-y-2">
                  {group.roles.map((role) => {
                    const membership = role.contactId ? activeByContact.get(role.contactId) : undefined;
                    return (
                      <div key={role.field} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
                        <dt className="text-muted-foreground">{role.label}</dt>
                        <dd className="text-right">
                          {role.contactId ? (
                            <>
                              <span className="font-medium">{nameOf(role.contactId)}</span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                {membership ? partyLabel(partyById.get(membership.partyId ?? ""), clientName) : "Not on the team"}
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">{role.required ? "Not assigned — required" : "Not assigned"}</span>
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </section>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Leadership roles are assigned on{" "}
            <Link className="underline underline-offset-2" href={projectWorkflowHref(project.id, "info")}>Project Type &amp; Information</Link>.
          </p>
        </div>
      </SectionCard>

      {sections.map((section) => (
        <TeamSectionCard
          key={section.key}
          section={section}
          clientName={clientName}
          editable={editable}
          canManage={canManage}
          canEditPeople={canEditPeople}
          onAdd={() => setDialog({ partyId: section.party?.id })}
          onEdit={(member) => setDialog({ member })}
          onEnd={setEnding}
          renderMember={(member) => ({
            name: nameOf(member.contactId),
            position: contactOf(member.contactId)?.position,
            leadership: leadershipRolesOf(project, member.contactId),
            reportsTo: member.reportsToMemberId
              ? nameOf(memberById.get(member.reportsToMemberId)?.contactId ?? "")
              : undefined,
            party: partyLabel(partyById.get(member.partyId ?? ""), clientName),
          })}
        />
      ))}

      {ended.length > 0 && (
        <SectionCard title={`Former members (${ended.length})`} description="Ended memberships are kept as project history.">
          <ul className="space-y-1 text-sm">
            {ended.map((member) => (
              <li key={member.id} className="flex flex-wrap justify-between gap-2 text-muted-foreground">
                <span>{nameOf(member.contactId)}{member.projectRole ? ` · ${member.projectRole}` : ""}</span>
                <span className="text-xs">Ended {member.endedAt?.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <ProjectTeamMemberDialog
        open={dialog !== null}
        onOpenChange={(open) => { if (!open) setDialog(null); }}
        project={project}
        contacts={contacts}
        clientName={clientName}
        member={dialog?.member}
        defaultPartyId={dialog?.partyId}
        canEditPeople={canEditPeople}
        onSaved={accept}
      />
      <ConfirmDialog
        open={ending !== null}
        onOpenChange={(open) => { if (!open) setEnding(null); }}
        title={ending ? `End ${nameOf(ending.contactId)}'s membership?` : "End membership"}
        description="They leave the current project team. The membership is kept as history, and their person record is not changed."
        confirmLabel="End membership"
        destructive
        onConfirm={endMembership}
      />
    </div>
  );
}

interface MemberView {
  name: string;
  position?: string;
  leadership: string[];
  reportsTo?: string;
  party: string;
}

function TeamSectionCard({
  section, clientName, editable, canManage, canEditPeople, onAdd, onEdit, onEnd, renderMember,
}: {
  section: TeamSection;
  clientName?: string;
  editable: boolean;
  canManage: boolean;
  canEditPeople: boolean;
  onAdd: () => void;
  onEdit: (member: ProjectMember) => void;
  onEnd: (member: ProjectMember) => void;
  renderMember: (member: ProjectMember) => MemberView;
}) {
  const description =
    section.kind === "owner" ? (clientName ? `People representing ${clientName}.` : "People representing the Owner / Client.")
    : section.kind === "eprom" ? "People assigned to this project on behalf of EPROM."
    : section.kind === "needs_party" ? "Carried over from earlier project data. Edit each person to set their party."
    : [section.party?.name, section.party?.scope].filter(Boolean).join(" · ");
  return (
    <SectionCard
      title={`${section.title} (${section.members.length})`}
      description={description}
      data-team-section={section.kind}
      action={canManage && section.kind !== "needs_party" ? (
        <Button variant="outline" size="sm" onClick={onAdd} disabled={!editable}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          Add
        </Button>
      ) : undefined}
    >
      {section.members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members yet.</p>
      ) : (
        <ul className="space-y-2">
          {section.members.map((member) => {
            const view = renderMember(member);
            return (
              <li key={member.id} data-member-id={member.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {view.name}
                    {view.leadership.map((label) => <StatusBadge key={label} tone="info" hideDot>{label}</StatusBadge>)}
                  </p>
                  <p className="text-xs text-muted-foreground">{view.position || "No position on the person record"}</p>
                  <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
                    <div>
                      <dt className="text-muted-foreground">Project Role</dt>
                      <dd>{memberNeedsProjectRole(member)
                        ? <StatusBadge tone="warning">Needs project role</StatusBadge>
                        : member.projectRole}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Reports To</dt>
                      <dd>{view.reportsTo ?? <span className="text-warning">No Reports To</span>}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Party</dt>
                      <dd>{member.partyId ? view.party : <StatusBadge tone="warning">Needs party</StatusBadge>}</dd>
                    </div>
                  </dl>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {canEditPeople && <MasterRecordEditButton kind="contact" recordId={member.contactId} />}
                  {canManage && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => onEdit(member)} disabled={!editable}
                        aria-label={`Edit ${view.name}'s project membership`}>
                        <PenLine data-icon="inline-start" aria-hidden="true" />
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => onEnd(member)} disabled={!editable}
                        aria-label={`End ${view.name}'s membership`}>
                        <UserMinus aria-hidden="true" />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

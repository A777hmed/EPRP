"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ManagedPersonSelect } from "@/features/master-data";
import { projectTeamService, type MemberWriteResult } from "@/services/project-team-service";
import type { Contact, MasterRecordBase, Project, ProjectMember } from "@/types";
import {
  activeMembers,
  memberDraftIssues,
  partyLabel,
  PROJECT_ROLE_MAX,
  reportsToCandidates,
  type MemberDraft,
} from "../../project-team";

const NO_REPORTS_TO = "none";

export interface ProjectTeamMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The saved project: its version, parties and members. */
  project: Project;
  contacts: Contact[];
  clientName?: string;
  /** Undefined = add a person; set = edit that membership. */
  member?: ProjectMember;
  /** Preselect a party when adding from a party's own section. */
  defaultPartyId?: string;
  /** Hide "Add new person" / Manage unless the caller may edit the People master. */
  canEditPeople: boolean;
  onSaved: (result: MemberWriteResult) => void;
}

/**
 * Add an existing person to the project team, or edit a membership's Party,
 * Project Role and Reports To. Saved immediately (not part of the step's
 * draft), one membership at a time, against the project's version.
 */
export function ProjectTeamMemberDialog({
  open,
  onOpenChange,
  project,
  contacts,
  clientName,
  member,
  defaultPartyId,
  canEditPeople,
  onSaved,
}: ProjectTeamMemberDialogProps) {
  const editing = Boolean(member);
  const [draft, setDraft] = React.useState<MemberDraft>({});
  const [attempted, setAttempted] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [openFor, setOpenFor] = React.useState<string | null>(null);

  // Start from the membership (or a blank person) each time the dialog opens.
  const openKey = open ? (member?.id ?? `new:${defaultPartyId ?? ""}`) : null;
  if (openKey !== openFor) {
    setOpenFor(openKey);
    setAttempted(false);
    setDraft(member
      ? { contactId: member.contactId, partyId: member.partyId, projectRole: member.projectRole ?? "",
          reportsToMemberId: member.reportsToMemberId }
      : { partyId: defaultPartyId, projectRole: "" });
  }

  const ids = React.useId();
  const issues = memberDraftIssues(draft, { requirePerson: !editing });
  const shown = attempted ? issues : {};
  const parties = project.parties ?? [];
  const members = project.members ?? [];
  const activeContactIds = new Set(activeMembers(members).map((entry) => entry.contactId));
  const candidates = reportsToCandidates(members, member?.id);
  const contactName = (contactId: string) =>
    contacts.find((contact) => contact.id === contactId)?.name ?? "Unknown person";
  const legacy = Boolean(member && (!member.partyId || !member.projectRole));

  const save = async () => {
    setAttempted(true);
    if (Object.keys(issues).length > 0) return;
    setSaving(true);
    try {
      const result = member
        ? await projectTeamService.updateMember({
            projectId: project.id, version: project.updatedAt, memberId: member.id,
            partyId: draft.partyId!, projectRole: draft.projectRole!, reportsToMemberId: draft.reportsToMemberId,
          })
        : await projectTeamService.addMember({
            projectId: project.id, version: project.updatedAt, contactId: draft.contactId!,
            partyId: draft.partyId!, projectRole: draft.projectRole!, reportsToMemberId: draft.reportsToMemberId,
          });
      toast.success(member ? "Team member updated" : "Team member added");
      onSaved(result);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The project team could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${contactName(member!.contactId)}` : "Add team member"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Party, Project Role and Reports To on this project only. The person's record is not changed."
              : "Choose an existing person. Their person record is reused, never copied."}
          </DialogDescription>
        </DialogHeader>

        {legacy && (
          <p role="note" className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
            This membership was carried over from earlier project data. Complete Party and Project Role to save changes.
          </p>
        )}

        <div className="space-y-4">
          {!editing && (
            <div className="space-y-1.5">
              <Label htmlFor={`${ids}-person`}>
                Person <span className="text-destructive" aria-hidden="true">*</span>
              </Label>
              <ManagedPersonSelect
                value={draft.contactId ?? ""}
                onChange={(contactId) => setDraft((current) => ({ ...current, contactId }))}
                filter={(record: MasterRecordBase) => !activeContactIds.has(record.id)}
                placeholder="Search existing people…"
                emptyLabel="Everyone listed is already on this project team."
                allowManage={canEditPeople}
                controlProps={{ id: `${ids}-person`, "aria-invalid": Boolean(shown.contactId) || undefined }}
              />
              {shown.contactId && <p role="alert" className="text-xs text-destructive">{shown.contactId}</p>}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor={`${ids}-party`}>
              Party <span className="text-destructive" aria-hidden="true">*</span>
            </Label>
            <Select value={draft.partyId ?? ""} onValueChange={(partyId) => setDraft((current) => ({ ...current, partyId }))}>
              <SelectTrigger id={`${ids}-party`} className="w-full" aria-invalid={Boolean(shown.partyId) || undefined}>
                <SelectValue placeholder="Select the party this person represents" />
              </SelectTrigger>
              <SelectContent>
                {parties.filter((party) => party.id).map((party) => (
                  <SelectItem key={party.id} value={party.id!}>
                    {partyLabel(party, clientName)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {shown.partyId && <p role="alert" className="text-xs text-destructive">{shown.partyId}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${ids}-role`}>
              Project Role <span className="text-destructive" aria-hidden="true">*</span>
            </Label>
            <Input
              id={`${ids}-role`}
              value={draft.projectRole ?? ""}
              maxLength={PROJECT_ROLE_MAX}
              placeholder="e.g. Package Engineer, Site Supervisor"
              aria-invalid={Boolean(shown.projectRole) || undefined}
              onChange={(event) => setDraft((current) => ({ ...current, projectRole: event.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Their role on this project. Separate from the position on their person record, and grants no access.
            </p>
            {shown.projectRole && <p role="alert" className="text-xs text-destructive">{shown.projectRole}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${ids}-reports-to`}>
              Reports To <span className="text-xs font-normal text-muted-foreground">Optional</span>
            </Label>
            <Select
              value={draft.reportsToMemberId ?? NO_REPORTS_TO}
              onValueChange={(value) => setDraft((current) => ({
                ...current, reportsToMemberId: value === NO_REPORTS_TO ? undefined : value,
              }))}
            >
              <SelectTrigger id={`${ids}-reports-to`} className="w-full">
                <SelectValue placeholder="No Reports To" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_REPORTS_TO}>No Reports To</SelectItem>
                {candidates.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {contactName(candidate.contactId)}
                    {candidate.projectRole && (
                      <span className="ml-1 text-xs text-muted-foreground">{candidate.projectRole}</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Any active member of this project, from any party. People who would create a reporting loop are not listed.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{editing ? "Save changes" : "Add to team"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

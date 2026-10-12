"use client";

import * as React from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type {
  ProjectStructureNode,
  StructureAssignments,
  StructureReportKind,
  StructureResponsibilityKind,
  StructureUnitPeopleInput,
} from "@/types/project-structure";
import type { StructureWorkspaceProject } from "../../../structure/structure-workspace-contract";
import {
  leadCandidates,
  membershipFactsOf,
  peopleInput,
  REPORT_KIND_LABEL,
  reportCandidates,
  reportSlot,
  requiresResponsible,
  samePeople,
  unitPeople,
  unitPeopleIssues,
  withMember,
  withoutMember,
  type StructureTeamDirectory,
  type StructureTeamMember,
} from "../../../structure/structure-responsibilities";

const NONE = "none";

export interface StructureResponsibilityFormProps {
  project: StructureWorkspaceProject;
  node: ProjectStructureNode;
  /** The unit's level, e.g. "Function". */
  levelLabel: string;
  /** Undefined when this database has no structure responsibilities. */
  assignments: StructureAssignments | undefined;
  directory: StructureTeamDirectory;
  /** Presentation only: the database refuses any write it does not allow. */
  canManage: boolean;
  onSave: (input: StructureUnitPeopleInput) => Promise<void>;
  onClose: () => void;
}

/**
 * The ONE editor of a structure unit's people (Phase 2C.3D): its members,
 * Unit Lead, and Weekly / Monthly Responsible and Backup. Everyone is an
 * ACTIVE project member; nobody comes from the global People master here.
 * The whole unit is saved at once and only the differences are applied.
 * Unit roles grant no platform or project authority.
 */
export function StructureResponsibilityForm({
  project,
  node,
  assignments,
  directory,
  canManage,
  onSave,
  onClose,
}: StructureResponsibilityFormProps) {
  const id = React.useId();
  const initial = React.useMemo(() => peopleInput(unitPeople(assignments, node.id)), [assignments, node.id]);
  const [draft, setDraft] = React.useState<StructureUnitPeopleInput>(initial);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submitting = React.useRef(false);

  const editable = canManage && !saving && Boolean(assignments) && !node.archivedAt;
  const dirty = !samePeople(draft, initial);
  const issues = unitPeopleIssues(draft, node, membershipFactsOf(directory));
  const inUnit = directory.members.filter((member) => draft.memberIds.includes(member.id));
  const leadOptions = leadCandidates(draft, directory);
  const reports = (["weekly", "monthly"] as const).filter((kind) =>
    kind === "weekly" ? node.weeklyReportingRequired : node.monthlyReportingRequired);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable || !dirty || issues.length > 0 || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      toast.success(`${node.name}: people saved`);
      onClose();
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : "The unit's people could not be saved. No changes were made.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  const toggleMember = (member: StructureTeamMember, checked: boolean) =>
    setDraft((current) => (checked ? withMember(current, member.id) : withoutMember(current, member.id)));
  const setSlot = (slot: "leadMemberId" | ReturnType<typeof reportSlot>, value: string) =>
    setDraft((current) => ({ ...current, [slot]: value === NONE ? undefined : value }));

  if (!assignments) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground" role="status">
          Structure responsibilities are not available on this database yet. Contact your administrator.
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>Close</Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form onSubmit={save} noValidate className="min-w-0 space-y-5" aria-busy={saving} aria-label={`People for ${node.name}`}>
      <fieldset className="min-w-0 space-y-2" disabled={!editable}>
        <legend className="text-sm font-medium">Unit members</legend>
        <p id={`${id}-members-hint`} className="text-xs text-muted-foreground">
          Active project team members only. Add people to the project team on the Contacts step.
        </p>
        {directory.members.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
            No active project team members yet.
          </p>
        ) : (
          <ul className="max-h-60 divide-y overflow-y-auto rounded-md border" aria-describedby={`${id}-members-hint`}>
            {directory.members.map((member) => {
              const checked = draft.memberIds.includes(member.id);
              return (
                <li key={member.id}>
                  <label className="flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      checked={checked}
                      onChange={(event) => toggleMember(member, event.target.checked)}
                      data-member-option={member.id}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{member.name}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {member.partyLabel ?? <StatusBadge tone="warning">Needs party</StatusBadge>}
                        <span aria-hidden="true">·</span>
                        {member.projectRole ?? <StatusBadge tone="warning">Needs project role</StatusBadge>}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {inUnit.some((member) => !member.accountable) && (
          <p className="text-xs text-muted-foreground">
            Members still needing a Party or Project Role can work in the unit, but cannot be its Lead, Responsible or Backup until
            their membership is completed on the Contacts step.
          </p>
        )}
      </fieldset>

      <PersonSelect
        id={`${id}-lead`}
        label="Unit Lead"
        hint={draft.leadMemberId ? "Optional. Grants no platform or project authority." : "Optional — a missing Unit Lead is a warning, not a blocker."}
        value={draft.leadMemberId}
        options={leadOptions}
        noneLabel="No Unit Lead"
        disabled={!editable}
        onChange={(value) => setSlot("leadMemberId", value)}
      />

      {reports.map((kind) => (
        <ReportFields
          key={kind}
          id={`${id}-${kind}`}
          kind={kind}
          required={requiresResponsible(project.reporting, node, kind)}
          draft={draft}
          directory={directory}
          disabled={!editable}
          onChange={(responsibility, value) => setSlot(reportSlot(kind, responsibility), value)}
        />
      ))}
      {reports.length === 0 && (
        <p className="text-xs text-muted-foreground">
          This unit does not provide Weekly or Monthly input, so it has no reporting Responsible.
        </p>
      )}

      <div aria-live="polite" className="space-y-1 text-sm">
        {dirty && issues.map((issue) => (
          <p key={`${issue.reason}-${issue.field ?? ""}`} role="alert" className="text-destructive">{issue.message}</p>
        ))}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {node.archivedAt && <p role="status" className="text-muted-foreground">This unit is archived, so its people are read-only.</p>}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" className="min-h-11" disabled={saving} onClick={onClose}>
          {canManage ? "Cancel" : "Close"}
        </Button>
        {canManage && (
          <Button type="submit" className="min-h-11" disabled={!editable || !dirty || issues.length > 0}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}

function PersonSelect({
  id,
  label,
  hint,
  value,
  options,
  noneLabel,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string | undefined;
  options: StructureTeamMember[];
  noneLabel: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0 space-y-1.5" data-person-select={label}>
      <Label htmlFor={id}>{label}</Label>
      <Select value={value ?? NONE} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger id={id} className="min-h-11 w-full" aria-describedby={`${id}-hint`}>
          <SelectValue placeholder={noneLabel} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{noneLabel}</SelectItem>
          {options.map((member) => (
            <SelectItem key={member.id} value={member.id}>
              {member.name} — {member.projectRole}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function ReportFields({
  id,
  kind,
  required,
  draft,
  directory,
  disabled,
  onChange,
}: {
  id: string;
  kind: StructureReportKind;
  required: boolean;
  draft: StructureUnitPeopleInput;
  directory: StructureTeamDirectory;
  disabled: boolean;
  onChange: (responsibility: StructureResponsibilityKind, value: string) => void;
}) {
  const label = REPORT_KIND_LABEL[kind];
  const responsible = draft[reportSlot(kind, "responsible")];
  return (
    <fieldset className="min-w-0 space-y-3 border-t pt-4" data-report-fields={kind}>
      <legend className="text-sm font-medium">{label} input</legend>
      <p className="text-xs text-muted-foreground">
        {required
          ? `This unit provides ${label} input, so a ${label} Responsible is required to complete Project Setup.`
          : `This unit is flagged for ${label} input, but ${label} reporting is off for this project, so a Responsible is not required.`}
        {" "}Configuration only: it grants no report-writing or approval authority.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <PersonSelect
          id={`${id}-responsible`}
          label={`${label} Responsible${required ? " (required)" : ""}`}
          hint="A member of this unit with a Party and Project Role."
          value={responsible}
          options={reportCandidates(draft, directory, kind, "responsible")}
          noneLabel="Not assigned"
          disabled={disabled}
          onChange={(value) => onChange("responsible", value)}
        />
        <PersonSelect
          id={`${id}-backup`}
          label={`${label} Backup`}
          hint={responsible ? "Optional standing alternate; a different person." : "Choose the Responsible first."}
          value={draft[reportSlot(kind, "backup")]}
          options={reportCandidates(draft, directory, kind, "backup")}
          noneLabel="No Backup"
          disabled={disabled || (!responsible && !draft[reportSlot(kind, "backup")])}
          onChange={(value) => onChange("backup", value)}
        />
      </div>
    </fieldset>
  );
}

export interface StructureResponsibilityDialogProps extends StructureResponsibilityFormProps {
  /**
   * Restore focus to the control that opened the dialog; return true when it
   * did, otherwise the dialog's default focus return applies.
   */
  onReturnFocus?: () => boolean;
}

/** The unit people editor in a dialog — the canonical editor used everywhere. */
export function StructureResponsibilityDialog({ onReturnFocus, ...props }: StructureResponsibilityDialogProps) {
  const { node, levelLabel, canManage } = props;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto sm:max-w-xl"
        onCloseAutoFocus={(event) => { if (onReturnFocus?.()) event.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>People · {node.name}</DialogTitle>
          <DialogDescription>
            {levelLabel}, Level {node.levelNumber}. {canManage
              ? "Choose this unit's members, Lead and reporting Responsibles from the active project team."
              : "This unit's members, Lead and reporting Responsibles."}{" "}
            Unit roles grant no platform or project authority.
          </DialogDescription>
        </DialogHeader>
        <StructureResponsibilityForm key={`${node.id}:${node.updatedAt}`} {...props} />
      </DialogContent>
    </Dialog>
  );
}

"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared";
import { getContactById, useMasterData } from "@/features/master-data";
import {
  ReplacePersonError,
  projectService,
  type ReplacePersonUnit,
} from "@/services/project-service";
import type { Contact, Project } from "@/types";
import { hasProjectAssignment } from "../assignment-rules";

export interface ReplacePersonDialogProps {
  project: Project;
  /**
   * Which unit this dialog replaces — one of the five fixed responsibility
   * columns, a department/team assignment (all scope-item rows sharing that
   * department + Assignment Role for the outgoing person), or an additional
   * project position. Passed straight through to `replacePerson()`.
   */
  unit: ReplacePersonUnit;
  /** Exactly the label already shown on the row that opened this dialog. */
  responsibilityLabel: string;
  currentContactId: string;
  /** Rendered with `asChild` — typically the row's own icon button. */
  trigger: React.ReactNode;
  /** Reloads the project data the caller renders from. Awaited on success. */
  onReplaced: () => void | Promise<void>;
}

/**
 * Project-level Replace Person — one dialog for all three responsibility
 * shapes (fixed responsibility, department/team assignment, project
 * position).
 *
 * One dialog, no wizard steps: pick a replacement, the impact this can
 * actually know before mutating appears inline, a reason is required, and
 * Confirm calls `replacePerson()` exactly once. Deliberately built on the raw
 * Dialog primitives rather than the shared `ConfirmDialog` — that component
 * always closes once `onConfirm` settles, which is right for a plain
 * confirm-or-cancel action but wrong here: a refused replacement (stale,
 * duplicate, unauthorized, …) must keep the dialog open with the reason
 * visible so the user can adjust and retry, not lose their selection.
 */
export function ReplacePersonDialog({
  project,
  unit,
  responsibilityLabel,
  currentContactId,
  trigger,
  onReplaced,
}: ReplacePersonDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [toContactId, setToContactId] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const { activeRecords } = useMasterData("contact");
  const currentContact = getContactById(currentContactId);

  /*
   * The backend requires the replacement to already be a project member for
   * a fixed responsibility or a project position (guard_fixed_project_
   * responsibility_membership() / guard_project_position_membership()), so
   * offering anyone else would only ever produce a refusal. A department/team
   * assignment has no such guard — the replacement could be a brand-new
   * project member — but this dialog applies the same "existing member only"
   * rule to every kind anyway: Replace Person changes who holds a
   * responsibility, not who is on the project, so silently adding someone to
   * the team as a side effect of a replace would cross that boundary.
   * `getContactById` (not the base MasterRecordBase records) is what carries
   * `email` for the Review Impact section below.
   */
  const candidates = React.useMemo<Contact[]>(() => {
    return activeRecords
      .filter(
        (record) =>
          record.id !== currentContactId &&
          hasProjectAssignment(project, record.id)
      )
      .map((record) => getContactById(record.id))
      .filter((contact): contact is Contact => Boolean(contact));
  }, [activeRecords, currentContactId, project]);

  const selectedContact = candidates.find((c) => c.id === toContactId);
  const trimmedReason = reason.trim();
  const canConfirm = Boolean(toContactId) && trimmedReason.length > 0 && !pending;

  const handleOpenChange = (next: boolean) => {
    if (pending) return;
    if (!next) {
      setToContactId("");
      setReason("");
      setError(null);
    }
    setOpen(next);
  };

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setPending(true);
    setError(null);
    try {
      const result = await projectService.replacePerson({
        projectId: project.id,
        unit,
        fromContactId: currentContactId,
        toContactId,
        reason: trimmedReason,
      });
      const newName = selectedContact?.name ?? "The replacement";
      toast.success(
        `${newName} is now ${responsibilityLabel} for ${project.shortName ?? project.name}.`
      );
      // Department Manager replacement only: other real, backend-reported
      // side effects the Review Impact step could not know ahead of the
      // call. Left unchanged, surfaced for the user to follow up on — never
      // auto-transferred.
      if (result.reportsRepointed > 0) {
        toast.info(
          `${result.reportsRepointed} team member${result.reportsRepointed === 1 ? "" : "s"} who reported to ${currentContact?.name ?? "the previous holder"} now report${result.reportsRepointed === 1 ? "s" : ""} to ${newName}.`
        );
      }
      if (result.delegationsRequiringReview > 0) {
        toast.info(
          `${result.delegationsRequiringReview} active Weekly delegation${result.delegationsRequiringReview === 1 ? "" : "s"} in this department were left unchanged — review whether they still apply.`
        );
      }
      if (result.delegationsAsDelegate > 0) {
        toast.info(
          `${currentContact?.name ?? "The previous holder"} still holds ${result.delegationsAsDelegate} active Weekly delegation${result.delegationsAsDelegate === 1 ? "" : "s"} as a delegate — unaffected by this change.`
        );
      }
      handleOpenChange(false);
      await onReplaced();
    } catch (err) {
      const isReplaceError = err instanceof ReplacePersonError;
      setError(
        isReplaceError
          ? err.message
          : "Something went wrong. No changes were made."
      );
      // The underlying data moved since this dialog opened — refresh it in
      // the background so a retry (or simply closing and reopening) starts
      // from the current state, without closing the dialog out from under
      // whatever the user was doing.
      if (isReplaceError && err.reason === "stale_assignment") {
        void onReplaced();
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Replace {responsibilityLabel}</DialogTitle>
          <DialogDescription>
            {project.shortName ?? project.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="text-xs text-muted-foreground">
              Current {responsibilityLabel}
            </p>
            <p className="font-medium">{currentContact?.name ?? "Unknown"}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="replace-person-select">Replacement</Label>
            {candidates.length === 0 ? (
              <EmptyState
                title="No eligible replacement"
                description="Only people already on this project's team can take over this responsibility. Add them to the project team first, then replace from here."
                className="py-6"
              />
            ) : (
              <Select
                value={toContactId}
                onValueChange={setToContactId}
                disabled={pending}
              >
                <SelectTrigger id="replace-person-select" className="w-full">
                  <SelectValue placeholder="Select a person…" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {selectedContact && (
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Review impact
              </p>
              <dl className="space-y-1.5 text-sm">
                <ImpactRow
                  label="Project"
                  value={project.shortName ?? project.name}
                />
                <ImpactRow label="Responsibility" value={responsibilityLabel} />
                <ImpactRow
                  label="Current person"
                  value={currentContact?.name ?? "Unknown"}
                />
                <ImpactRow label="Replacement" value={selectedContact.name} />
                <ImpactRow
                  label="Work email"
                  value={selectedContact.email?.trim() || "Not on file"}
                />
              </dl>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="replace-person-reason">Reason</Label>
            <Textarea
              id="replace-person-reason"
              rows={2}
              placeholder="Why this responsibility is being reassigned"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={pending}
              aria-required="true"
            />
          </div>

          <p className="text-xs text-pretty text-muted-foreground">
            This does not change either person&apos;s login, password, or
            platform role, and does not touch Users &amp; Roles, other
            projects, other responsibilities on this project, or historical
            Weekly, Monthly or Executive records.
          </p>

          {error && (
            <ul
              role="alert"
              className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
            >
              <li className="text-sm text-pretty text-destructive">{error}</li>
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            {pending && (
              <Loader2
                data-icon="inline-start"
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            Confirm Replacement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImpactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

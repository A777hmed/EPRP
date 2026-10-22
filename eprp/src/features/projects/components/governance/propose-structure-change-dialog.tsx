"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { compactAmendmentToast } from "../../amendment-toast";
import { CONFIRMATION_TOAST_DURATION_MS, showCompactToast } from "@/features/notifications/compact-toast";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { setupGovernanceService } from "@/services/setup-governance-service";
import type { SetupAmendment } from "../../setup-amendments";
import { setupFieldEntry } from "../../setup-governance";
import type { StructureProposal } from "../../structure-amendments";

/**
 * The one "Propose structure change" dialog (Phase 13.9B Step 4, `07`
 * §10.12). The caller renders the action's own fields and builds the
 * proposal (null while incomplete or unchanged); this dialog adds what every
 * governed request needs — the current state, a mandatory reason, the impact
 * and the approval rule — and submits it. Nothing changes until another
 * Project Control Admin or System Administrator approves it; the database
 * validates the change again on approval.
 */
export function ProposeStructureChangeDialog({
  open,
  projectId,
  projectCode,
  title,
  current,
  proposal,
  onClose,
  onSubmitted,
  blockedReason,
  children,
}: {
  open: boolean;
  projectId: string;
  /** For the confirmation toast ("code · subject"). */
  projectCode?: string;
  /** e.g. "Request rename · Pump House". */
  title: string;
  /** The target as it stands now, in business words. */
  current: React.ReactNode;
  /** The complete proposal, or null while the fields are incomplete or unchanged. */
  proposal: StructureProposal | null;
  onClose: () => void;
  onSubmitted: (amendment: SetupAmendment) => void;
  /**
   * Set when the removal is guaranteed to be refused because child structure is
   * still assigned (see structure-dependencies.ts). Submit is disabled; the
   * dialog's own content explains what is in the way.
   */
  blockedReason?: string;
  /** The action's own fields. */
  children?: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain sm:max-w-lg">
        {open && (
          <ProposeBody projectId={projectId} projectCode={projectCode} title={title} current={current} proposal={proposal}
            onClose={onClose} onSubmitted={onSubmitted} blockedReason={blockedReason}>
            {children}
          </ProposeBody>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProposeBody({
  projectId,
  projectCode,
  title,
  current,
  proposal,
  onClose,
  onSubmitted,
  blockedReason,
  children,
}: {
  projectId: string;
  projectCode?: string;
  title: string;
  current: React.ReactNode;
  proposal: StructureProposal | null;
  onClose: () => void;
  onSubmitted: (amendment: SetupAmendment) => void;
  blockedReason?: string;
  children?: React.ReactNode;
}) {
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const reasonId = React.useId();
  const entry = proposal ? setupFieldEntry(proposal.fieldKey) : undefined;

  const submit = async () => {
    if (!proposal || !reason.trim() || blockedReason) return;
    setSaving(true);
    try {
      const amendment = await setupGovernanceService.requestStructureAmendment({
        projectId,
        proposal,
        reason: reason.trim(),
      });
      // 13.11 UAT: the one compact toast; the record carries the detail.
      const { title, context, tone } = compactAmendmentToast("submitted", { projectCode, amendment });
      showCompactToast({ title, context, tone, duration: CONFIRMATION_TOAST_DURATION_MS });
      onSubmitted(amendment);
      onClose();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "The structure change could not be proposed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          Project Setup is controlled, so this structure change is proposed for approval. Nothing changes until it is
          approved.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <dl className="grid gap-3 rounded-lg border bg-muted/20 p-3 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Now</dt>
          <dd className="min-w-0 text-pretty">{current}</dd>
        </dl>

        {children}

        {blockedReason && (
          <p className="text-xs font-medium text-warning text-pretty">
            Submit for approval is unavailable until the items above are cleared.
          </p>
        )}

        <Field>
          <FieldLabel htmlFor={reasonId}>
            Reason <span className="text-destructive" aria-hidden="true">*</span>
          </FieldLabel>
          <Textarea id={reasonId} aria-required rows={3} maxLength={1000} value={reason}
            onChange={(event) => setReason(event.target.value)} placeholder="Why this structure change is needed" />
        </Field>

        <div className="rounded-lg border border-warning/30 bg-warning/[0.07] p-3 text-xs text-pretty">
          <p className="font-medium text-foreground">Impact</p>
          <p className="mt-0.5 text-muted-foreground">
            {entry?.impactWarning ?? "Changes the reporting structure. Approved reports keep the structure they were approved with."}
          </p>
          <p className="mt-1.5 text-muted-foreground">
            You cannot approve your own request. Another Project Control Admin or System Administrator decides it.
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button
          type="button"
          onClick={() => void submit()}
          disabled={saving || !proposal || !reason.trim() || Boolean(blockedReason)}
          title={blockedReason ? "Clear the items listed above first. Submit becomes available once nothing is blocking this removal." : undefined}
        >
          {saving && <Loader2 data-icon="inline-start" className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          Submit for approval
        </Button>
      </DialogFooter>
    </>
  );
}
